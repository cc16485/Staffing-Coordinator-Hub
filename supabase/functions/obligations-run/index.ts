// Supabase Edge Function: obligations-run (shared hub project)
// ---------------------------------------------------------------------------
// The recurring-obligation engine, running when nobody is looking.
//
// The browser materialises obligations on sign-in, which is fine while somebody
// is working and useless at 6am on a Saturday. A client check-in that fell due
// on Friday should not wait until Monday because nobody opened a laptop.
//
// IT IMPORTS THE HUB'S OWN DECISION FILE — https://cc.mo-care.com/obligations.js
// — the exact bytes the browser loads. A file with no import/export statements
// is still a valid ES module, so Deno executes it and reads globalThis.CCOblig.
// There is no second formula here to drift from the first. If that fetch fails
// this function STOPS rather than guessing, because a runner with its own idea
// of what is due would create real work about real clients that the hub does
// not agree with, and nobody would see the disagreement.
//
// Writes go through upsert_app_data_item, the same per-item RPC the browser
// uses, so both can write ops_items without clobbering each other.
//
// ⚠ DRY RUN BY DEFAULT. It writes nothing unless app_data key 'ops_settings'
// has obligations_live === true. Flip it deliberately.
//
//   ?dry=1   force a dry run even when live
//   ?days=N  override the backlog guard for this run only
// ---------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const OBLIG_URL = 'https://cc.mo-care.com/obligations.js'
/* The caregiver-compliance source consumes chkStatus().nextDue from the
   authoritative rules. Without this the source returns no rows, rows_seen reads
   zero, and the Control Centre says its source is empty — visible rather than
   silent, but still wrong. Loaded here so it is neither. */
const RULES_URL = 'https://cc.mo-care.com/eligibility-rules.js'
/* A first run must never dump a year of history on somebody. Anything that fell
   due more than this many days ago is counted and reported, not created. */
const DEFAULT_MAX_AGE_DAYS = 45
/* Ceiling per run. The age guard cannot stop a flood of legitimately-current
   obligations: 56 caregivers whose records were lost in one incident all become
   due on the same day. Deferred items arrive on the next run rather than being
   dropped, so a first run drips in instead of dumping. */
const DEFAULT_MAX_PER_RUN = 10

/** 'YYYY-MM-DD' in the operating timezone, never the server's. */
function todayCentral(): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const g = (t: string) => p.find(x => x.type === t)?.value ?? ''
  return `${g('year')}-${g('month')}-${g('day')}`
}

Deno.serve(async (req) => {
  // Protocol handshake before any policy or work.
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const url = new URL(req.url)
  const forceDry = url.searchParams.get('dry') === '1'
  const daysParam = Number(url.searchParams.get('days'))
  const maxAgeDays = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : DEFAULT_MAX_AGE_DAYS
  const capParam = Number(url.searchParams.get('max'))
  const maxPerRun = Number.isFinite(capParam) && capParam > 0 ? capParam : DEFAULT_MAX_PER_RUN

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const started = new Date().toISOString()
  const t0 = Date.now()

  /* ── 1. The shared decision file. No local fallback ON PURPOSE. ─────────── */
  let O: any = null
  let meta = { url: OBLIG_URL, bytes: 0, fetched_at: '' }
  try {
    const r = await fetch(OBLIG_URL + '?v=' + Math.floor(Date.now() / 300000),
      { headers: { Accept: 'application/javascript' } })
    if (!r.ok) throw new Error('obligations.js responded ' + r.status)
    const src = await r.text()
    if (!/CCOblig/.test(src)) throw new Error('fetched file does not define CCOblig')
    meta = { url: OBLIG_URL, bytes: src.length, fetched_at: new Date().toISOString() }
    ;(0, eval)(src)
    O = (globalThis as any).CCOblig
  } catch (err) {
    await logRun(supabase, {
      automation: 'obligations', ok: false, started, ms: Date.now() - t0,
      error: 'could not load ' + OBLIG_URL + ': ' + String(err),
    })
    return json({
      error: 'Could not load the shared obligation rules', detail: String(err),
      note: 'Refusing to evaluate with a second copy of the formula.',
    }, 502)
  }
  /* Same fetch-and-eval as eligibility-sweep already proves. A failure here is
     reported rather than fatal: client check-ins can still be evaluated, and
     the compliance source will honestly report an empty read. */
  let rulesMeta: Record<string, unknown> = { url: RULES_URL, bytes: 0, loaded: false }
  try {
    const rr = await fetch(RULES_URL + '?v=' + Math.floor(Date.now() / 300000),
      { headers: { Accept: 'application/javascript' } })
    if (!rr.ok) throw new Error('rules responded ' + rr.status)
    const rsrc = await rr.text()
    if (!/CCElig/.test(rsrc)) throw new Error('fetched file does not define CCElig')
    ;(0, eval)(rsrc)
    rulesMeta = { url: RULES_URL, bytes: rsrc.length, loaded: !!(globalThis as any).CCElig }
  } catch (err) {
    rulesMeta = { url: RULES_URL, bytes: 0, loaded: false, error: String(err) }
  }

  if (!O?.evaluate) {
    await logRun(supabase, { automation: 'obligations', ok: false, started, ms: Date.now() - t0,
      error: 'obligations.js loaded but exported nothing usable' })
    return json({ error: 'obligations.js loaded but exported nothing usable' }, 502)
  }

  /* ── 2. Settings, and whether we are allowed to write. ──────────────────── */
  const blob = async (key: string) => {
    const { data } = await supabase.from('app_data').select('data').eq('key', key).maybeSingle()
    const d = (data as any)?.data
    return Array.isArray(d) ? d : (d ?? null)
  }
  const settings = (await blob('ops_settings')) || {}

  /* TWO SWITCHES, NOT ONE.
     A verification task says "please check a missing record". A work-affecting
     lapse can take a caregiver off shifts. Those carry completely different
     risk and must not share an all-or-nothing flag.

       obligations_live          the base switch. Nothing writes without it.
       obligations_live_lapses   additionally allows work-affecting items

     Stage A is obligations_live alone: verification and management-quality
     obligations only. Stage B adds lapses once Stage A has proven itself
     against real people. */
  const liveBase = settings?.obligations_live === true && !forceDry
  const liveLapses = liveBase && settings?.obligations_live_lapses === true
  const live = liveBase
  const dry = !live

  /* ── 3. Source data and identity resolution. ────────────────────────────── */
  const items = (await blob('ops_items')) || []
  const data: Record<string, unknown> = {
    client_checkins: (await blob('client_checkins')) || [],
    caregivers: (await blob('caregivers')) || [],
  }

  const { data: persons } = await supabase.from('persons').select('person_id, full_name, primary_email')
  const { data: domains } = await supabase.from('domains').select('code, owner_person, entity').eq('entity', 'cc_ihs')
  const people = (persons || []) as any[]
  const emailOf = (pid: string) =>
    String(people.find(p => p.person_id === pid)?.primary_email || '').toLowerCase()

  /* The same rule the browser applies: a name resolves through the person
     registry, never through a second email map. Unresolvable returns '' so the
     caller falls back to the domain owner rather than writing an owner nobody
     can be. */
  const resolveOwner = (v: unknown) => {
    const s = String(v ?? '').trim()
    if (!s) return ''
    if (s.includes('@')) return s.toLowerCase()
    const low = s.toLowerCase()
    const hit = people.find(p => {
      const fn = String(p.full_name || '').trim().toLowerCase()
      return fn === low || fn.split(/\s+/)[0] === low
    })
    return hit ? String(hit.primary_email || '').toLowerCase() : ''
  }
  const domainOwner = (code: string) => {
    const d = (domains || []).find((x: any) => x.code === code) as any
    return d?.owner_person ? emailOf(d.owner_person) : ''
  }
  const ownerName = (email: string) =>
    people.find(p => String(p.primary_email || '').toLowerCase() === String(email).toLowerCase())
      ?.full_name || email

  /* ── 4. Decide. This is the shared file's job, not ours. ────────────────── */
  const result = O.evaluate({
    data, items, today: todayCentral(),
    resolveOwner, domainOwner, ownerName, maxAgeDays, maxPerRun,
  })

  const summary = {
    ok: true, dry,
    live_setting: settings?.obligations_live === true,
    live_lapses_setting: settings?.obligations_live_lapses === true,
    rules: meta, eligibility_rules: rulesMeta,
    today: todayCentral(), max_age_days: maxAgeDays, max_per_run: maxPerRun,
    deferred_to_next_run: result.deferred ?? 0,
    sources_evaluated: Object.keys(result.bySource || {}),
    rows_seen: result.rowsSeen ?? 0,
    by_source: result.bySource,
    would_create: result.create.length,
    would_close: result.stale.length,
    closed_done_at_source: result.satisfied,
    closed_obligation_moved: result.rescheduled,
    closed_source_gone: result.sourceGone,
    skipped_not_due_or_existing: result.skipped,
    skipped_too_old: result.tooOld.length,
    unroutable: result.unroutable,
    errors: result.errors,
    /* Named so a dry run can be read without cross-referencing ids. */
    /* Categorised so a dry run can be read without doing the sums by hand. */
    by_severity: (function () {
      const t: Record<string, number> = { verification: 0, management: 0, legal: 0, other: 0 }
      let restrictions = 0
      for (const i of result.create) {
        const c = (i as any).compliance
        const k = c?.severity
        if (k === 'verification' || k === 'management' || k === 'legal') t[k]++
        else t.other++
        if (c?.restriction === true) restrictions++
      }
      return { ...t, work_restrictions: restrictions }
    })(),
    restrictions_preview: result.create
      .filter((i: any) => i?.compliance?.restriction === true)
      .slice(0, 20)
      .map((i: any) => ({ id: i.id, who: i.about, code: i.compliance.code, due: i.due })),
    create_preview: result.create.slice(0, 10).map((i: any) => ({ id: i.id, title: i.title, owner: i.owner, due: i.due })),
    close_preview: result.stale.slice(0, 10).map((s: any) => ({ id: s.item.id, why: s.why })),
  }

  if (dry) {
    await logRun(supabase, { automation: 'obligations', ok: true, dry: true, started,
      ms: Date.now() - t0, summary })
    return json(summary)
  }

  /* ── 5. Write, one item at a time, through the same RPC the browser uses. ── */
  let created = 0, closed = 0, heldForStageB = 0
  const writeErrors: any[] = []
  for (const it of result.create) {
    /* Severity decides which switch governs it. Anything that is not clearly
       verification or management is treated as work-affecting, because the
       safe default for an unrecognised category is the higher bar. */
    const sev = (it as any)?.compliance?.severity
    const isLowRisk = sev === 'verification' || sev === 'management' || sev === undefined
    if (!isLowRisk && !liveLapses) { heldForStageB++; continue }
    const { error } = await supabase.rpc('upsert_app_data_item', { target_key: 'ops_items', item: it })
    if (error) writeErrors.push({ id: it.id, op: 'create', message: error.message }); else created++
  }
  for (const s of result.stale) {
    const it = { ...s.item }
    it.status = 'done'
    it.closed_at = new Date().toISOString()
    it.closed_by = 'automation:obligations-run'
    it.resolution_code = s.why
    it.auto_closed_reason = s.why
    it.close_note = O.CLOSE_NOTE?.[s.why] || 'Closed automatically.'
    it.history = Array.isArray(it.history) ? it.history : []
    it.history.push({ at: it.closed_at, by: 'automation', text: O.CLOSE_LOG?.[s.why] || 'Closed automatically' })
    it.last_activity_at = it.closed_at
    delete (it as any).__why
    const { error } = await supabase.rpc('upsert_app_data_item', { target_key: 'ops_items', item: it })
    if (error) writeErrors.push({ id: it.id, op: 'close', message: error.message }); else closed++
  }

  const final = { ...summary, dry: false, created, closed,
                  held_for_stage_b: heldForStageB,
                  stage: liveLapses ? 'B (verification, management and lapses)'
                                    : 'A (verification and management only)',
                  write_errors: writeErrors }
  await logRun(supabase, { automation: 'obligations', ok: writeErrors.length === 0, dry: false,
    started, ms: Date.now() - t0, summary: final })
  return json(final)
})

/* EVERY RUN IS RECORDED, INCLUDING THE ONES THAT DID NOTHING.
   A run that evaluated its sources and found nothing to do is HEALTHY. A run
   that never happened is a failure. Those two must never look the same, which
   they do the moment the only evidence is the absence of created work. */
async function logRun(supabase: any, row: Record<string, unknown>) {
  try {
    const s = (row.summary ?? {}) as any
    await supabase.rpc('upsert_app_data_item', {
      target_key: 'automation_log',
      item: {
        id: 'auto_srv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        at: new Date().toISOString(),
        automation: 'obligations',
        ran_by: 'server',
        ok: row.ok !== false,
        dry: row.dry === true,
        duration_ms: row.ms ?? null,
        /* Present even when zero, so the Control Centre can say "ran, evaluated
           1 source, nothing to do" rather than showing a bare nothing. */
        sources_evaluated: (s.sources_evaluated || []).length,
        /* Rows the engine actually saw. Zero with sources>0 means the source
           is empty, not that everything is up to date. */
        rows_seen: s.rows_seen ?? 0,
        created: s.created ?? s.would_create ?? 0,
        closed: s.closed ?? s.would_close ?? 0,
        satisfied: s.closed_done_at_source ?? 0,
        rescheduled: s.closed_obligation_moved ?? 0,
        source_gone: s.closed_source_gone ?? 0,
        skipped: s.skipped_not_due_or_existing ?? 0,
        too_old: s.skipped_too_old ?? 0,
        unroutable: (s.unroutable || []).length,
        errors: ((s.errors || []).length) + ((s.write_errors || []).length),
        by_source: s.by_source ?? {},
        error: row.error ?? null,
      },
    })
  } catch (e) {
    // The log itself failing must not take the run down, but it must be loud.
    console.error('[obligations-run] could not write the run log', e)
  }
}
