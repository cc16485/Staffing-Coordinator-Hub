// Supabase Edge Function: eligibility-sweep
// ---------------------------------------------------------------------------
// Steps 4, 5 and 6 of Eligible to Work — the half that runs when nobody is
// looking. Same pattern as ops-escalate: reads app_data, writes ops_items
// through upsert_app_data_item so the browser and this can both write safely.
//
// THE ONE RULE SET
// It imports https://cc.mo-care.com/eligibility-rules.js — the exact file the
// hub loads. A file with no import/export statements is still a valid ES
// module, so Deno executes it and reads globalThis.CCElig. There is no second
// formula here to drift from the first. If that import fails this function
// STOPS rather than guessing.
//
// ⚠ DRY RUN BY DEFAULT. It writes nothing and posts nothing unless app_data
// key 'ops_settings' has eligibility_sweep_live === true. Flip it deliberately.
// ---------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const RULES_URL = 'https://cc.mo-care.com/eligibility-rules.js'
const AC_VERSION = '2023-10-01'

// Which domain owns which kind of failure. Never a person's name: the domain
// resolves the current owner, so this survives the Staffing Coordinator hire.
const DOMAIN_FOR = (codes: string[]) => {
  if (codes.some(c => ['ojt_overdue','oig_expired','edl_expired','fcsr_expired','annual_training'].includes(c)))
    return 'training_compliance'
  return 'recruiting_orientation'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const SB = Deno.env.get('SUPABASE_URL')!
  const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const site = Deno.env.get('AXISCARE_SITE_NUMBER')
  /* The shared project holds app_data; the AxisCare secret may be set there
     under any of the three names this estate has accumulated. Take whichever
     exists rather than failing on a naming accident. */
  const acTok = Deno.env.get('AXISCARE_VISITS_TOKEN')
             || Deno.env.get('AXISCARE_TOKEN')
             || Deno.env.get('AXISCARE_API_KEY')
  const acSite = site || Deno.env.get('AXISCARE_SITE')
  const supabase = createClient(SB, KEY)

  // ── the shared rules, or nothing ────────────────────────────────────────
  /* FETCHED AND EVALUATED, NOT IMPORTED, AND THE REASON MATTERS.
     Deno Deploy resolves remote modules at DEPLOY time, so `await import(url)`
     of anything outside the bundle fails at runtime with "Module not found".
     A static `import "https://…"` would work, but it would freeze the rules as
     they were on the day this function was last deployed — and a function
     quietly running last month's eligibility rules while the hub runs this
     month's is precisely the drift this design exists to prevent.

     So it fetches the served file and evaluates it. That is `eval` by another
     name, and it is justified here by three things: the source is our own
     origin over HTTPS, the file is the one the hub itself loads, and the
     alternative is two copies that can disagree about whether a real person is
     allowed to work.

     If the fetch fails, this function stops. It never falls back to a local
     copy, because there is no local copy to fall back to. */
  let E: any = null
  let rulesMeta = { url: RULES_URL, bytes: 0, fetched_at: '' }
  try {
    const r = await fetch(RULES_URL + '?v=' + Math.floor(Date.now() / 300000), {
      headers: { 'Accept': 'application/javascript' } })
    if (!r.ok) throw new Error('rules file responded ' + r.status)
    const src = await r.text()
    if (!/CCElig/.test(src)) throw new Error('fetched file does not define CCElig')
    rulesMeta = { url: RULES_URL, bytes: src.length, fetched_at: new Date().toISOString() }
    ;(0, eval)(src)
    E = (globalThis as any).CCElig
  } catch (err) {
    return json({ error: 'Could not load the shared eligibility rules', detail: String(err),
                  note: 'Refusing to evaluate with a second copy of the formula.' }, 502)
  }
  if (!E?.eligibility)
    return json({ error: 'eligibility-rules.js loaded but exported nothing usable' }, 502)

  const body = await req.json().catch(() => ({})) as Record<string, unknown>

  /* ── THE JANE FIXTURE, RUN HERE RATHER THAN SIMULATED ──────────────────
     Exercises the real rules, in the real runtime, through the same branching
     the sweep uses. It touches no real caregiver and writes nothing. The point
     is that "it works in Node" is not evidence about Deno importing a file
     over the network and reaching the same conclusions. */
  if (body.fixture === 'jane') {
    const d = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
    const jane: any = { id: 'fixture_jane', first: 'Jane', last: 'Smith', axiscare_id: 'FIXTURE',
      hire_date: d(-40), r1s: 'Positive', r2s: 'Positive', oig: 'CLEAR', edl: 'Clear', fcsr: 'Clear',
      oig_date: d(-20), edl_date: d(-20), fcsr_date: d(-20), fcsr_reg_date: d(-30),
      orient_date: d(-38), alz_date: d(-38), annual_date: '',
      supv_date: d(-20), perf_date: d(-20), ojt_date: '', ojt_online: '', ojt_signed: '' }
    const visits = [
      { id: 'v1', scheduledStartDate: d(2) + 'T09:00', client: { id: 7, firstName: 'A', lastName: 'B' } },
      { id: 'v2', scheduledStartDate: d(4) + 'T09:00', client: { id: 7, firstName: 'A', lastName: 'B' } },
      { id: 'v3', scheduledStartDate: d(5) + 'T14:00', client: { id: 9, firstName: 'C', lastName: 'D' } }]
    const items: Record<string, any> = {}
    const notes: string[] = []
    const step = (c: any, up: any[]) => {
      const e = E.eligibility(c); E.eligRecord(c, e)
      const bad = e.state !== 'eligible'
      const eid = 'elig_' + c.id, sid = 'eligsched_' + c.id
      if (bad) items[eid] = { status: 'open', priority: e.restricted ? 'high' : 'normal',
                              domain: DOMAIN_FOR((e.reasons || []).map((r: any) => r.code)) }
      else if (items[eid]) items[eid].status = 'done'
      if (bad && up.length) items[sid] = { status: 'open', priority: 'high',
                                           domain: 'scheduling_coverage', shifts: up.length }
      else if (items[sid]) items[sid].status = 'done'
      if (e.restricted && c.axiscare_id) {
        const o: any = (e.lapses || []).find((l: any) => l.code === 'ojt_overdue') || {}
        const k = 'ojt_overdue@' + (o.due || '?')
        if (c.axiscare_note_for !== k) { notes.push(k); c.axiscare_note_for = k }
      } else if (!bad && c.axiscare_note_for) { notes.push('cleared'); c.axiscare_note_for = null }
      return e
    }
    const before = E.eligibility({ ...jane, hire_date: d(-10) })      // inside the window
    let e = step(jane, visits)
    const restricted = jane.eligibility_history.find((h: any) => h.event === 'restricted')
    const snap = JSON.stringify(items), nNotes = notes.length
    step(jane, visits)                                               // rerun, must be inert
    const dupItems = JSON.stringify(items) !== snap, dupNotes = notes.length !== nNotes
    jane.ojt_date = d(0); jane.ojt_online = d(0); jane.ojt_signed = 'yes'
    const after = step(jane, visits)
    const restoredEntry = jane.eligibility_history.find((h: any) => h.event === 'restored')
    const checks = [
      ['1  eligible before the deadline', before.state === 'eligible'],
      ['2  lapses after the OJT deadline', e.state === 'lapsed'],
      ['3  effective date is deadline-derived', !!restricted?.became_overdue &&
          restricted.became_overdue !== new Date().toISOString().slice(0, 10)],
      ['4  three upcoming visits detected', visits.length === 3],
      ['5  exactly one compliance exception', !!items['elig_fixture_jane']],
      ['6  exactly one scheduling exception', !!items['eligsched_fixture_jane']],
      ['7  scheduling exception carries all 3', items['eligsched_fixture_jane']?.shifts === 3],
      ['8  Staffing owns the scheduling work', items['eligsched_fixture_jane']?.domain === 'scheduling_coverage'],
      ['9  one AxisCare restriction note', nNotes === 1],
      ['10 rerun creates no duplicate item', !dupItems],
      ['11 rerun sends no duplicate note', !dupNotes],
      ['12 OJT completion restores eligibility', after.state === 'eligible'],
      ['13 both exceptions would close', items['elig_fixture_jane'].status === 'done' &&
          items['eligsched_fixture_jane'].status === 'done'],
      ['14 restoration recorded in history', !!restoredEntry?.restored_on],
    ]
    return json({ fixture: 'jane', wrote_nothing: true,
      passed: checks.filter(c => c[1]).length, of: checks.length,
      checks: checks.map(c => (c[1] ? 'PASS  ' : 'FAIL  ') + c[0]),
      lapse_date: restricted?.became_overdue, detected_at: restricted?.detected_at,
      history: jane.eligibility_history.map((h: any) => h.event),
      old_shifts_restored: false })
  }

  const key = async (k: string) => {
    const { data } = await supabase.from('app_data').select('data').eq('key', k).maybeSingle()
    return data?.data ?? null
  }
  const settings = (await key('ops_settings')) || {}
  const LIVE = body.live === true || (settings as any).eligibility_sweep_live === true
  const DRY = !LIVE

  const caregivers: any[] = (await key('caregivers')) || []
  const opsItems: any[] = (await key('ops_items')) || []
  const active = caregivers.filter(c => c && c.active !== false && !c.not_hired && c.hire_date)

  // ── upcoming visits, once, for everybody ────────────────────────────────
  const today = new Date().toISOString().slice(0, 10)
  const horizon = new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10)
  const visitsByCaregiver = new Map<string, any[]>()
  let visitsError: string | null = null
  if (acSite && acTok) {
    try {
      let url: string | null =
        `https://${acSite}.axiscare.com/api/visits?startDate=${today}&endDate=${horizon}`
      for (let page = 0; url && page < 12; page++) {
        const r: Response = await fetch(url, { headers: {
          Authorization: `Bearer ${acTok}`, Accept: 'application/json',
          'X-AxisCare-Api-Version': AC_VERSION } })
        if (!r.ok) { visitsError = `AxisCare responded ${r.status}`; break }
        const j: any = await r.json().catch(() => ({}))
        for (const v of (j?.results?.visits ?? j?.visits ?? [])) {
          if (v?.removed) continue                    // superseded or cancelled
          const cg = v?.caregiver?.id
          if (cg == null) continue
          const k = String(cg)
          if (!visitsByCaregiver.has(k)) visitsByCaregiver.set(k, [])
          visitsByCaregiver.get(k)!.push(v)
        }
        url = j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
      }
    } catch (err) { visitsError = String(err) }
  } else { visitsError = 'AxisCare not configured on this project (need AXISCARE_SITE_NUMBER and a token)' }

  // ── evaluate ────────────────────────────────────────────────────────────
  const now = new Date().toISOString()
  const counts = { evaluated: 0, eligible: 0, not_eligible: 0, lapsed: 0,
                   ojt_overdue: 0, fcsr_registration_overdue: 0, with_upcoming_visits: 0,
                   affected_visits: 0, mgmt_overdue_still_eligible: 0 }
  // every reason, counted separately — the breakdown matters far more than a percentage
  const byReason: Record<string, number> = {}
  const bump = (k: string) => { byReason[k] = (byReason[k] || 0) + 1 }
  /* Four different things look identical if you only count "ineligible".
     This separates them from signals already in the record, so a data problem
     is never mistaken for a compliance problem about a real person. */
  const triage = { real: 0, missing_history: 0, bad_dates: 0, probably_former: 0 }
  const triageNotes: Record<string, number> = {}
  const plan = { items_create: [] as any[], items_update: [] as any[], items_close: [] as any[],
                 axiscare_notes: [] as any[], caregivers_written: [] as string[] }
  const byId = (id: string) => opsItems.find(i => i.id === id)

  for (const c of active) {
    counts.evaluated++
    const e = E.eligibility(c)
    counts[e.state as 'eligible' | 'not_eligible' | 'lapsed']++
    if (e.lapses?.some((l: any) => l.code === 'ojt_overdue')) counts.ojt_overdue++
    if (e.tasks?.some((t: any) => t.code === 'fcsr_registration' && t.high)) counts.fcsr_registration_overdue++
    if (e.state === 'eligible' && e.mgmt?.length) counts.mgmt_overdue_still_eligible++
    for (const r of (e.reasons || [])) bump(r.code)

    // ── which of the four is this, really? ───────────────────────────────
    if (e.state !== 'eligible') {
      const tenureDays = c.hire_date
        ? Math.floor((Date.now() - new Date(c.hire_date + 'T00:00:00').getTime()) / 86400000) : null
      const noHire   = !c.hire_date
      const future   = tenureDays !== null && tenureDays < 0
      const tenured  = tenureDays !== null && tenureDays > 365
      const neverOriented = !c.orient_date && !c.alz_date
      const noAxis   = !c.axiscare_id
      let bucket: string
      if (noHire || future) { bucket = 'bad_dates'; triage.bad_dates++ }
      else if (tenured && neverOriented) { bucket = 'missing_history'; triage.missing_history++ }
      else if (noAxis && tenured) { bucket = 'probably_former'; triage.probably_former++ }
      else { bucket = 'real'; triage.real++ }
      triageNotes[bucket + ':' + (e.reasons?.[0]?.code || 'unknown')] =
        (triageNotes[bucket + ':' + (e.reasons?.[0]?.code || 'unknown')] || 0) + 1
    }

    const cgKey = String(c.axiscare_id || '')
    const upcoming = cgKey ? (visitsByCaregiver.get(cgKey) || []) : []
    const ineligible = e.state !== 'eligible'
    if (ineligible && upcoming.length) { counts.with_upcoming_visits++; counts.affected_visits += upcoming.length }

    // history + cached state, only when something actually changed
    const changed = E.eligRecord(c, e)
    if (changed) plan.caregivers_written.push(c.id || `${c.first} ${c.last}`)

    const who = `${c.first || ''} ${c.last || ''}`.trim() || (c.id || 'caregiver')
    const codes = (e.reasons || []).map((r: any) => r.code)

    // ── STEP 4: the eligibility exception ─────────────────────────────────
    const eid = 'elig_' + (c.id || cgKey || who.replace(/\s+/g, '_'))
    const existing = byId(eid)
    if (ineligible) {
      const item = {
        id: eid, kind: 'eligibility', source_id: c.id || null, about: who,
        title: e.label + ' — ' + who,
        detail: e.summary,
        next_action: e.needs_supervisor
          ? 'A supervisor has to decide on the references before this moves on.'
          : 'Clear the outstanding requirement, then eligibility restores itself.',
        status: 'open', domain: DOMAIN_FOR(codes),
        priority: e.restricted ? 'high' : 'normal',
        created_at: existing?.created_at || now, last_activity_at: now,
        due: existing?.due || now.slice(0, 10),
        opened_by: 'eligibility-sweep',
        eligibility: { state: e.state, codes, restricted: !!e.restricted }
      }
      ;(existing ? plan.items_update : plan.items_create).push(item)
    } else if (existing && existing.status === 'open') {
      plan.items_close.push({ ...existing, status: 'done', closed_at: now,
        closed_by: 'eligibility-sweep',
        close_reason: 'Eligibility restored — ' + e.summary, last_activity_at: now })
    }

    // ── STEP 5: on the schedule while not eligible ────────────────────────
    const sid = 'eligsched_' + (c.id || cgKey || who.replace(/\s+/g, '_'))
    const sExisting = byId(sid)
    if (ineligible && upcoming.length) {
      const shifts = upcoming
        .sort((a, b) => String(a.scheduledStartDate).localeCompare(String(b.scheduledStartDate)))
        .map(v => ({ visit_id: v.id,
          when: String(v.scheduledStartDate || v.startDate || '').slice(0, 16).replace('T', ' '),
          client: [v?.client?.firstName, v?.client?.lastName].filter(Boolean).join(' ') ||
                  ('Client #' + (v?.client?.id ?? '?')) }))
      const item = {
        id: sid, kind: 'eligibility_schedule', source_id: c.id || null, about: who,
        title: who + ' is on the schedule but ' + (e.state === 'lapsed' ? 'eligibility has lapsed' : 'is not eligible'),
        detail: e.summary + ' ' + shifts.length + ' upcoming shift' + (shifts.length === 1 ? '' : 's') + ' affected.',
        next_action: 'Remove or replace ' + who + ' on the shifts below. Do not leave the client uncovered.',
        status: 'open', domain: 'scheduling_coverage', priority: 'high',
        created_at: sExisting?.created_at || now, last_activity_at: now,
        due: now.slice(0, 10), opened_by: 'eligibility-sweep',
        affected_shifts: shifts,
        eligibility: { state: e.state, codes }
      }
      ;(sExisting ? plan.items_update : plan.items_create).push(item)
    } else if (sExisting && sExisting.status === 'open') {
      // the shifts are gone, even if the eligibility problem is not
      plan.items_close.push({ ...sExisting, status: 'done', closed_at: now,
        closed_by: 'eligibility-sweep', last_activity_at: now,
        close_reason: upcoming.length ? 'Eligibility restored.' : 'No upcoming shifts remain for this caregiver.' })
    }

    // ── STEP 6: the AxisCare restriction note, once per lapse event ───────
    if (e.restricted && cgKey) {
      const ojt = (e.lapses || []).find((l: any) => l.code === 'ojt_overdue') || {}
      const eventKey = 'ojt_overdue@' + (ojt.due || 'unknown')
      if (c.axiscare_note_for !== eventKey) {
        plan.axiscare_notes.push({ caregiver: who, axiscare_id: cgKey, event: eventKey,
          note: 'DO NOT SCHEDULE — Not eligible to work. Required OJT is overdue. ' +
                'Caregiver may resume client shifts after OJT is completed and eligibility is restored.',
          important: true })
      }
    } else if (!ineligible && c.axiscare_note_for && cgKey) {
      plan.axiscare_notes.push({ caregiver: who, axiscare_id: cgKey, event: 'cleared',
        note: 'Eligibility restored. The earlier DO NOT SCHEDULE restriction is cleared; ' +
              'this caregiver may be scheduled normally again.',
        important: false, clears: true })
    }
  }

  // ── write, or describe ──────────────────────────────────────────────────
  const wrote = { items: 0, caregivers: 0, notes: 0 }
  if (LIVE) {
    for (const it of [...plan.items_create, ...plan.items_update, ...plan.items_close]) {
      const { error } = await supabase.rpc('upsert_app_data_item', { target_key: 'ops_items', item: it })
      if (!error) wrote.items++
    }
    for (const n of plan.axiscare_notes) {
      if (!acSite || !acTok) break
      const r = await fetch(`https://${acSite}.axiscare.com/api/notes/caregiver/${n.axiscare_id}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${acTok}`, Accept: 'application/json',
                   'Content-Type': 'application/json', 'X-AxisCare-Api-Version': AC_VERSION },
        body: JSON.stringify({ note: n.note, dateTime: now, important: !!n.important })
      })
      if (r.ok) {
        wrote.notes++
        const c = active.find(x => String(x.axiscare_id || '') === n.axiscare_id)
        if (c) c.axiscare_note_for = n.clears ? null : n.event
      }
    }
    // caregiver records last, so a failed note does not mark itself sent
    for (const c of active) {
      if (!plan.caregivers_written.includes(c.id || `${c.first} ${c.last}`) &&
          !plan.axiscare_notes.some(n => n.axiscare_id === String(c.axiscare_id || ''))) continue
      const { error } = await supabase.rpc('upsert_app_data_item', { target_key: 'caregivers', item: c })
      if (!error) wrote.caregivers++
    }
  }

  return json({
    mode: DRY ? 'DRY RUN — nothing was written or sent' : 'LIVE',
    rules: rulesMeta,
    axiscare: visitsError ? { ok: false, problem: visitsError } : { ok: true, caregivers_with_visits: visitsByCaregiver.size },
    counts,
    by_reason: byReason,
    triage: { ...triage, detail: triageNotes },
    would: {
      items_create: plan.items_create.length,
      items_create_compliance: plan.items_create.filter(i => i.kind === 'eligibility').length,
      items_create_scheduling: plan.items_create.filter(i => i.kind === 'eligibility_schedule').length,
      items_update: plan.items_update.length,
      items_close: plan.items_close.length,
      axiscare_notes: plan.axiscare_notes.length,
      axiscare_restriction_notes: plan.axiscare_notes.filter(n => !n.clears).length,
      axiscare_cleared_notes: plan.axiscare_notes.filter(n => n.clears).length,
      caregiver_records_written: plan.caregivers_written.length
    },
    wrote: LIVE ? wrote : undefined,
    // enough to inspect without exposing a caregiver file
    sample: {
      items: [...plan.items_create, ...plan.items_update].slice(0, 8)
        .map(i => ({ id: i.id, kind: i.kind, priority: i.priority, domain: i.domain,
                     title: i.title, shifts: i.affected_shifts?.length ?? 0 })),
      notes: plan.axiscare_notes.slice(0, 8).map(n => ({ event: n.event, important: n.important }))
    }
  })
})
