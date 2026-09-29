// Supabase Edge Function: promise-run (shared hub project) · Step 6, 2026-09-26
// ---------------------------------------------------------------------------
// Family updates we owe, and Journey decisions waiting on a person, as My Work
// items. Built in the obligations-run shape on purpose:
//
// IT IMPORTS THE HUB'S OWN DECISION FILE, https://cc.mo-care.com/promise-engine.js,
// the exact bytes the hub loads (CCPromise.workItems). There is no second
// formula here. If that fetch fails this function STOPS rather than guessing.
//
// THE SOURCE IS THE TRUTH, THE ITEM IS THE PROMPT. An item closes itself when the
// Start Contract no longer calls for it (the update was logged, the promise
// moved) or the review was decided. Nothing here contacts a family: it creates
// and closes internal work items only.
//
// ⚠ DRY RUN BY DEFAULT. It writes nothing unless app_data 'ops_settings' has
// promises_live === true. Flip it deliberately, after reading a dry run.
//   ?dry=1   force a dry run even when live
//   ?max=N   per-run ceiling for this run only      ?days=N  age guard for this run only
// Replies to the scheduler (public key) with counts only; names and wording
// appear only for a service-role caller (the owner's report script).
// Writes go through upsert_app_data_item, the same per-item RPC the hub uses.
// ---------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jobCaller } from '../_shared/job-auth.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const ENGINE_URL = 'https://cc.mo-care.com/promise-engine.js'

export function jwtRole(authHeader: string | null): string | null {
  const m = /^Bearer\s+(.+)$/.exec(authHeader ?? '')
  if (!m) return null
  const parts = m[1].split('.')
  if (parts.length !== 3) return null
  try {
    const p = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof p.role === 'string' ? p.role : null
  } catch { return null }
}
export function positiveOr(v: string | null, d: number): number {
  const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  /* J2 (2026-09-29): only its hourly schedule or the owner's server key. Everyone else, the public key included, is
     refused before anything is read or written (the ?max and ?days overrides are the owner's only). */
  const caller = await jobCaller(req)
  if (!caller) return json({ error: 'not allowed' }, 401)
  if (new URL(req.url).searchParams.get('auth_check') === '1') return json({ ok: true, caller })
  const url = new URL(req.url)
  const forceDry = url.searchParams.get('dry') === '1'
  /* names in the reply only for the owner's server key (a Desktop report), never from the token's own say-so */
  const full = caller === 'owner'
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const started = new Date().toISOString(), t0 = Date.now()

  /* ── 1. The shared decision file. No local fallback ON PURPOSE. ─────────── */
  // deno-lint-ignore no-explicit-any
  let P: any = null
  let engine: Record<string, unknown> = { url: ENGINE_URL, bytes: 0 }
  try {
    const r = await fetch(ENGINE_URL + '?v=' + Math.floor(Date.now() / 300000), { headers: { Accept: 'application/javascript' } })
    if (!r.ok) throw new Error('promise-engine.js responded ' + r.status)
    const src = await r.text()
    if (!/CCPromise/.test(src) || !/workItems/.test(src)) throw new Error('fetched file does not define CCPromise.workItems')
    ;(0, eval)(src)
    // deno-lint-ignore no-explicit-any
    P = (globalThis as any).CCPromise
    engine = { url: ENGINE_URL, bytes: src.length, version: P?.version ?? null }
  } catch (err) {
    await logRun(supabase, { ok: false, started, ms: Date.now() - t0, error: 'could not load ' + ENGINE_URL + ': ' + String(err) })
    return json({ error: 'Could not load the shared promise engine', detail: String(err),
                  note: 'Refusing to evaluate with a second copy of the rules.' }, 502)
  }
  if (typeof P?.workItems !== 'function') {
    await logRun(supabase, { ok: false, started, ms: Date.now() - t0, error: 'promise-engine.js has no workItems' })
    return json({ error: 'promise-engine.js loaded but has no workItems' }, 502)
  }
  const maxAgeDays = positiveOr(url.searchParams.get('days'), P.MAX_AGE_DAYS || 60)
  const maxPerRun = positiveOr(url.searchParams.get('max'), P.MAX_PER_RUN || 20)

  /* ── 2. Settings: are we allowed to write? ──────────────────────────────── */
  const blob = async (key: string) => {
    const { data } = await supabase.from('app_data').select('data').eq('key', key).maybeSingle()
    // deno-lint-ignore no-explicit-any
    const d = (data as any)?.data
    return Array.isArray(d) ? d : (d ?? null)
  }
  const settings = (await blob('ops_settings')) || {}
  const live = settings?.promises_live === true && !forceDry
  const dry = !live

  /* ── 3. Sources. Read only. ─────────────────────────────────────────────── */
  const q = async (p: PromiseLike<{ data: unknown; error: { message: string } | null }>) => {
    const { data, error } = await p; if (error) throw new Error(error.message); return (data ?? []) as any[]
  }
  let contracts: any[] = [], reviews: any[] = []
  const labels: Record<string, string> = {}, states: Record<string, string> = {}, leads: Record<string, string> = {}, axiscare: Record<string, string> = {}
  try {
    contracts = await q(supabase.from('start_contract_current').select('*'))
    reviews = await q(supabase.from('episode_review').select('review_id, kind, seat, episode_id, created_at').eq('status', 'open'))
    const eps = [...new Set([...contracts.map((c) => c.episode_id), ...reviews.map((r) => r.episode_id)].filter(Boolean))]
    if (eps.length) {
      const epRows = await q(supabase.from('journey_episode').select('episode_id, person_id, state').in('episode_id', eps))
      epRows.forEach((e) => { states[e.episode_id] = e.state })
      const dir = await q(supabase.from('journey_directory').select('episode_id, label').in('episode_id', eps))
      dir.forEach((d) => { labels[d.episode_id] = d.label })
      const pids = [...new Set(epRows.map((e) => e.person_id).filter(Boolean))]
      if (pids.length) {
        const ppl = await q(supabase.from('person_identity').select('id, display_name').in('id', pids))
        const ax = await q(supabase.from('person_source_id').select('person_id, source_id').eq('system', 'axiscare').eq('entity_type', 'client').in('person_id', pids))
        epRows.forEach((e) => {
          if (!labels[e.episode_id]) labels[e.episode_id] = ppl.find((p) => p.id === e.person_id)?.display_name || ''
          const a = ax.find((x) => x.person_id === e.person_id); if (a) axiscare[e.episode_id] = String(a.source_id)
        })
      }
      const src = await q(supabase.from('episode_source').select('episode_id, source_ref').eq('system', 'lead').eq('role', 'origin').in('episode_id', eps))
      src.forEach((s) => { leads[s.episode_id] = s.source_ref })
    }
  } catch (err) {
    await logRun(supabase, { ok: false, started, ms: Date.now() - t0, error: 'could not read the Journey sources: ' + String(err) })
    return json({ error: 'Could not read the Journey sources', detail: String(err) }, 500)
  }
  const items = (await blob('ops_items')) || []
  const { data: persons } = await supabase.from('persons').select('person_id, primary_email')
  const { data: domains } = await supabase.from('domains').select('code, owner_person, entity').eq('entity', 'cc_ihs')
  const domainOwner = (code: string) => {
    // deno-lint-ignore no-explicit-any
    const d = (domains || []).find((x: any) => x.code === code) as any
    // deno-lint-ignore no-explicit-any
    return d?.owner_person ? String((persons || []).find((p: any) => p.person_id === d.owner_person)?.primary_email || '').toLowerCase() : ''
  }

  /* ── 4. Decide. The shared file's job, not ours. ────────────────────────── */
  const result = P.workItems({ contracts, reviews, labels, states, leads, axiscare, today: P.todayChicago(),
                               existing: items, domainOwner, maxAgeDays, maxPerRun })
  const summary: Record<string, unknown> = {
    ok: true, dry, live_setting: settings?.promises_live === true, engine, today: result.today,
    max_age_days: maxAgeDays, max_per_run: maxPerRun, ...result.counts,
    rows_seen: result.counts.contracts_seen + result.counts.reviews_seen,
  }
  if (full) {
    // deno-lint-ignore no-explicit-any
    summary.create_preview = result.create.map((i: any) => ({ id: i.id, kind: i.kind, title: i.title, about: i.about, owner: i.owner || '(unassigned: ' + i.domain + ')', due: i.due, urgency: i.urgency }))
    // deno-lint-ignore no-explicit-any
    summary.close_preview = result.close.map((c: any) => ({ id: c.item.id, title: c.item.title, why: c.why }))
  }
  if (dry) {
    await logRun(supabase, { ok: true, dry: true, started, ms: Date.now() - t0, summary })
    return json(summary)
  }

  /* ── 5. Write, one item at a time, through the same RPC the hub uses. ───── */
  let created = 0, closed = 0
  const writeErrors: unknown[] = []
  const now = new Date().toISOString()
  for (const it of result.create) {
    const item = { ...it, created_at: now, last_activity_at: now,
                   history: [{ at: now, by: 'automation', text: 'Opened by the promise engine from the family\'s Start Contract' }] }
    const { error } = await supabase.rpc('upsert_app_data_item', { target_key: 'ops_items', item })
    if (error) writeErrors.push({ id: it.id, op: 'create', message: error.message }); else created++
  }
  for (const c of result.close) {
    const it = { ...c.item }
    it.status = 'done'; it.closed_at = now; it.closed_by = 'automation:promise-run'
    it.resolution_code = c.why; it.auto_closed_reason = c.why; it.close_note = P.CLOSE_NOTE?.[c.why] || 'Closed automatically.'
    it.history = Array.isArray(it.history) ? it.history : []
    it.history.push({ at: now, by: 'automation', text: it.close_note })
    it.last_activity_at = now
    const { error } = await supabase.rpc('upsert_app_data_item', { target_key: 'ops_items', item: it })
    if (error) writeErrors.push({ id: it.id, op: 'close', message: error.message }); else closed++
  }
  const final = { ...summary, dry: false, created, closed, write_errors: writeErrors }
  await logRun(supabase, { ok: writeErrors.length === 0, dry: false, started, ms: Date.now() - t0, summary: final })
  return json(full ? final : { ok: final.ok, dry: false, created, closed, rows_seen: summary.rows_seen, write_errors: writeErrors.length })
})

/* EVERY RUN IS RECORDED, INCLUDING THE ONES THAT DID NOTHING, so "ran and found
   nothing owed" never looks like "never ran". */
// deno-lint-ignore no-explicit-any
async function logRun(supabase: any, row: Record<string, unknown>) {
  try {
    // deno-lint-ignore no-explicit-any
    const s = (row.summary ?? {}) as any
    await supabase.rpc('upsert_app_data_item', {
      target_key: 'automation_log',
      item: {
        id: 'auto_srv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        at: new Date().toISOString(), automation: 'promises', ran_by: 'server',
        ok: row.ok !== false, dry: row.dry === true, duration_ms: row.ms ?? null,
        sources_evaluated: s.contracts_seen === undefined ? 0 : 2,
        rows_seen: s.rows_seen ?? 0,
        created: s.created ?? s.would_create ?? 0, closed: s.closed ?? s.would_close ?? 0,
        skipped: s.skipped_existing ?? 0, too_old: s.too_old ?? 0, deferred: s.deferred ?? 0,
        errors: (s.write_errors || []).length, error: row.error ?? null,
      },
    })
  } catch (e) { console.error('[promise-run] could not write the run log', e) }
}
