// Supabase Edge Function: coverage-watch  (shared hub project)
// -----------------------------------------------------------------------------
// Samantha's trigger: "could it be initiated from us unassigning a shift and
// making the reason for modification caregiver call-in?" (2026-09-12). Yes —
// this watches AxisCare for exactly that gesture, so the scheduler's normal
// workflow IS the trigger. No phone-screen step, no second data entry.
//
//   every few minutes (cron, once live) or on demand:
//     GET /api/visits for the next 72 hours
//     keep visits with NO caregiver and a modification reason that matches
//       the call-in/call-off pattern (or the exact names in
//       ops_settings.coverage_watch_reasons, once she sets them)
//     open a Coverage Help case for each — with the REAL client id, date and
//       times straight from the schedule — unless a case for that visit
//       already exists (any status: once handled, never reopened by a robot)
//
// The ranked-wave engine (coverage-run) then takes over, same as a phone
// call-off. The AxisCare webhook `scheduling.visit.caregiver` can make this
// instant later (needs AxisCare support to enable webhook admin); polling
// makes it real today and stays as the safety net.
//
// KNOWN TRAP (documented in AXISCARE-CAPABILITY.md): a null caregiver means
// unassigned OR assigned-to-an-inactive-caregiver — indistinguishable. The
// modification-reason filter is what keeps that ambiguity from opening junk
// cases: no matching reason, no case.
//
// ⚠ DRY RUN BY DEFAULT. It opens nothing unless app_data 'ops_settings' has
//   coverage_watch_live === true. Dry runs list exactly what WOULD open, plus
//   every modification-reason name seen on unassigned upcoming visits, so
//   Samantha can pick the exact reason names before going live.
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 2), { status: s, headers: { 'Content-Type': 'application/json' } })

const AC_VERSION = Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01'
const DEFAULT_REASON_RX = /call[\s-]?(in|off)/i
const HORIZON_HOURS = 72

function axisCreds() {
  const order = ['AXISCARE_VISITS_TOKEN', 'AXISCARE_API_KEY', 'AXISCARE_TOKEN']
  let token = ''
  for (const n of order) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site: /^\d+$/.test(site) ? site : '' }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 })
  const t0 = Date.now()

  const { data: setRow } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const settings: any = setRow?.data ?? {}
  const forceDry = new URL(req.url).searchParams.get('dry') === '1'
  const live = settings.coverage_watch_live === true && !forceDry
  const configuredReasons: string[] = Array.isArray(settings.coverage_watch_reasons)
    ? settings.coverage_watch_reasons.map((r: unknown) => String(r).toLowerCase().trim()).filter(Boolean)
    : []
  const reasonMatches = (name: string) => configuredReasons.length
    ? configuredReasons.includes(name.toLowerCase().trim())
    : DEFAULT_REASON_RX.test(name)

  const { token, site } = axisCreds()
  if (!token || !site) return json({ error: 'AxisCare credentials not set on this project' }, 502)

  // ── The schedule, next 72 hours. ──
  const startDate = new Date().toISOString().slice(0, 10)
  const endDate = new Date(Date.now() + HORIZON_HOURS * 3600000).toISOString().slice(0, 10)
  // deno-lint-ignore no-explicit-any
  const visits: any[] = []
  let fetchError: string | null = null
  try {
    let url: string | null = `https://${site}.axiscare.com/api/visits?startDate=${startDate}&endDate=${endDate}`
    for (let page = 0; url && page < 12; page++) {
      const r: Response = await fetch(url, { headers: {
        Authorization: `Bearer ${token}`, Accept: 'application/json',
        'X-AxisCare-Api-Version': AC_VERSION } })
      if (!r.ok) { fetchError = `AxisCare responded ${r.status}`; break }
      // deno-lint-ignore no-explicit-any
      const j: any = await r.json().catch(() => ({}))
      for (const v of (j?.results?.visits ?? j?.visits ?? [])) {
        if (v?.removed) continue
        visits.push(v)
      }
      url = j?.results?.nextPage ?? j?.nextPage ?? j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
    }
  } catch (err) { fetchError = String(err) }
  if (fetchError && !visits.length) return json({ error: fetchError }, 502)

  // ── Existing cases: one case per visit, ever. ──
  const { data: caseRow } = await sb.from('app_data').select('data').eq('key', 'coverage_cases').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const cases: any[] = Array.isArray(caseRow?.data) ? caseRow!.data : []
  /* Dedupe rules (review findings 6-7):
       - an OPEN case for the visit blocks a new one, always
       - resolved history does NOT block: a visit legitimately unassigned
         AGAIN (second call-off after a fill) deserves a fresh callout
       - the new case id is DETERMINISTIC (visit id + generation), so two
         overlapping watch runs write the SAME item and the per-item RPC
         itself becomes the duplicate guard. */
  const openByVisit = new Set(cases.filter(c => c?.status === 'open')
    .map(c => String(c.axiscare_visit_id ?? '')).filter(Boolean))
  const genByVisit = new Map<string, number>()
  for (const cc of cases) {
    const v = String(cc?.axiscare_visit_id ?? ''); if (!v) continue
    genByVisit.set(v, (genByVisit.get(v) ?? 0) + 1)
  }

  const nowIso = new Date().toISOString()
  const reasonNamesSeen = new Map<string, number>()
  const wouldOpen: Record<string, unknown>[] = []
  let unassigned = 0, reasonMatched = 0, alreadyHandled = 0, inPast = 0, created = 0

  for (const v of visits) {
    if (v?.caregiver?.id != null) continue
    unassigned++
    const reason = String(v?.modificationReason?.name ?? '').trim()
    if (reason) reasonNamesSeen.set(reason, (reasonNamesSeen.get(reason) ?? 0) + 1)
    if (!reason || !reasonMatches(reason)) continue
    reasonMatched++
    const start = String(v?.scheduledStartDate ?? v?.startDate ?? '')
    if (start && new Date(start).getTime() < Date.now()) { inPast++; continue }
    const visitId = String(v?.id ?? '')
    if (!visitId || openByVisit.has(visitId)) { alreadyHandled++; continue }

    const clientName = [String(v?.client?.firstName ?? '').trim(), String(v?.client?.lastName ?? '').trim()]
      .filter(Boolean).join(' ') || '(client name missing on the visit)'
    const end = String(v?.scheduledEndDate ?? v?.endDate ?? '')
    const shiftTime = [start, end].map(s => s ? s.slice(11, 16) : '').filter(Boolean).join('-')
    const entry = {
      client: clientName,
      client_axiscare_id: v?.client?.id != null ? String(v.client.id) : null,
      axiscare_visit_id: visitId,
      shift_date: start.slice(0, 10),
      shift_time: shiftTime,
      modification_reason: reason,
    }
    wouldOpen.push(entry)

    if (live) {
      const c = {
        id: 'cw_' + visitId.replace(/[^A-Za-z0-9]/g, '_') + '_g' + ((genByVisit.get(visitId) ?? 0) + 1),
        ...entry,
        reason: 'call_off',
        note: `Opened automatically: shift unassigned in AxisCare with reason "${reason}".`,
        status: 'open', asked: [],
        opened_at: nowIso, opened_by: 'axiscare-watch',
        caller_phone: '', caller_contact_id: '',
        resolved_at: null, resolved_how: null, covered_by: null,
      }
      const { error } = await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: c })
      if (!error) { created++; openByVisit.add(visitId) }
    }
  }

  /* ── DAILY ATTENDANCE SWEEP (her ask: track EVV misses and tardies, and
     tell admins when someone has too many). Once per day on the first run
     after midnight Chicago: yesterday's visits → missing clock-in, missing
     clock-out, or a late clock-in (past the grace) become attendance
     events, deterministic ids so reruns write nothing twice. Then rolling
     30-day counts per caregiver: at or over the threshold raises ONE item
     per caregiver per type per month for the admins. */
  try {
    const chiYesterday = new Date(Date.now() - 864e5)
      .toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
    const { data: stateRow } = await sb.from('app_data').select('data').eq('key', 'attendance_watch_state').maybeSingle()
    const stateArr: any[] = Array.isArray(stateRow?.data) ? stateRow!.data : []
    const state = stateArr.find(x => x?.id === 'state') ?? { id: 'state', last_date: '' }
    if (state.last_date !== chiYesterday) {
      const grace = Number(settings.att_tardy_grace_min) > 0 ? Number(settings.att_tardy_grace_min) : 10
      const { token: tk, site: st } = axisCreds()
      const dayRows: any[] = []
      let u: string | null = `https://${st}.axiscare.com/api/visits?startDate=${chiYesterday}&endDate=${chiYesterday}`
      for (let page = 0; u && page < 12; page++) {
        const r: Response = await fetch(u, { headers: {
          Authorization: `Bearer ${tk}`, Accept: 'application/json',
          'X-AxisCare-Api-Version': AC_VERSION } })
        if (!r.ok) { u = null; break }
        const j: any = await r.json().catch(() => ({}))
        for (const v of (Array.isArray(j?.results?.visits) ? j.results.visits
          : Object.values(j?.results?.visits ?? {}))) if (!(v as any)?.removed) dayRows.push(v)
        u = j?.results?.nextPage ?? j?.nextPage ?? j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
      }
      let evLogged = 0
      for (const v of dayRows) {
        if (v?.caregiver?.id == null) continue
        const cgName = [String(v?.caregiver?.firstName ?? '').trim(), String(v?.caregiver?.lastName ?? '').trim()]
          .filter(Boolean).join(' ') || ('caregiver ' + v.caregiver.id)
        const vid = String(v?.id ?? '').replace(/[^A-Za-z0-9]/g, '_')
        const start = String(v?.scheduledStartDate ?? v?.startDate ?? '')
        const shiftDate = start.slice(0, 10) || chiYesterday
        const shiftTime = start.slice(11, 16)
        const cin = v?.clockIn?.time, cout = v?.clockOut?.time
        const put = (type: string, extra: Record<string, unknown> = {}) =>
          sb.rpc('upsert_app_data_item', { target_key: 'attendance_events', item: {
            id: `att_evv_${vid}_${type}`, caregiver: cgName, type,
            shift_date: shiftDate, shift_time: shiftTime,
            note: `Auto-detected from yesterday's AxisCare visit.`,
            logged_by: 'attendance-watch', created_at: new Date().toISOString(), action_id: null, ...extra } })
        if (!cin) { await put('evv_missing_in'); evLogged++ }
        if (!cout) { await put('evv_missing_out'); evLogged++ }
        if (cin && start) {
          const lateMin = (new Date(String(cin)).getTime() - new Date(start).getTime()) / 60000
          if (Number.isFinite(lateMin) && lateMin > grace) {
            await put('tardy', { minutes_late: Math.round(lateMin) }); evLogged++
          }
        }
      }
      /* Rolling 30-day threshold alarms → one item per caregiver/type/month. */
      const { data: aeRow } = await sb.from('app_data').select('data').eq('key', 'attendance_events').maybeSingle()
      const events: any[] = Array.isArray(aeRow?.data) ? aeRow!.data : []
      const cutoff = Date.now() - 30 * 864e5
      const counts = new Map<string, number>()
      for (const e of events) {
        const t = new Date(String(e.shift_date || e.created_at || 0) + 'T12:00:00').getTime()
        if (!Number.isFinite(t) || t < cutoff) continue
        const bucket = e.type === 'callin' ? 'callin'
          : e.type === 'tardy' ? 'tardy'
          : (e.type === 'evv_missing_in' || e.type === 'evv_missing_out') ? 'evv' : null
        if (!bucket) continue
        const k = String(e.caregiver || '?') + '|' + bucket
        counts.set(k, (counts.get(k) ?? 0) + 1)
      }
      const TH: Record<string, number> = {
        callin: Number(settings.att_alert_callins) > 0 ? Number(settings.att_alert_callins) : 3,
        tardy: Number(settings.att_alert_tardies) > 0 ? Number(settings.att_alert_tardies) : 3,
        evv: Number(settings.att_alert_evv) > 0 ? Number(settings.att_alert_evv) : 3,
      }
      const LABEL: Record<string, string> = {
        callin: 'call-ins', tardy: 'tardies', evv: 'EVV problems (missing clock-in/out)' }
      const admins = (Array.isArray(settings.coverage_alert_admins) && settings.coverage_alert_admins.length)
        ? settings.coverage_alert_admins : ['samantha@mo-care.com']
      const ym = chiYesterday.slice(0, 7).replace('-', '')
      for (const [k, n] of counts) {
        const [who, bucket] = k.split('|')
        if (n < TH[bucket]) continue
        await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
          id: `ops_att_${bucket}_${who.toLowerCase().replace(/[^a-z0-9]/g, '')}_${ym}`,
          kind: 'staffing_issue',
          title: `Attendance pattern — ${who}: ${n} ${LABEL[bucket]} in 30 days`,
          about: who,
          detail: `${who} has ${n} ${LABEL[bucket]} in the last 30 days (threshold ${TH[bucket]}). Review on Performance > Attendance — the write-up ladder there has the details and next step.`,
          domain: 'scheduling_coverage', status: 'open', urgency: 'high',
          owner: String(admins[0]), owner_name: String(admins[0]).split('@')[0],
          created_at: new Date().toISOString(),
          due: new Date(Date.now() + 2 * 864e5).toISOString(),
          created_by: 'attendance-watch', opened_by: 'attendance-threshold',
        } })
      }
      state.last_date = chiYesterday
      await sb.rpc('upsert_app_data_item', { target_key: 'attendance_watch_state', item: state })
      ;(globalThis as any).__attSwept = { day: chiYesterday, events_logged: evLogged }
    }
  } catch (err) { (globalThis as any).__attSwept = { error: String(err) } }

  const summary = {
    mode: live ? 'LIVE' : 'DRY RUN',
    window: `${startDate} → ${endDate}`,
    fetch_error: fetchError,
    visits_seen: visits.length,
    unassigned_upcoming: unassigned,
    reason_matched: reasonMatched,
    already_handled: alreadyHandled,
    started_in_past: inPast,
    cases_created: created,
    would_open: wouldOpen,
    reason_filter: configuredReasons.length
      ? { mode: 'exact names from ops_settings.coverage_watch_reasons', names: configuredReasons }
      : { mode: 'default pattern', pattern: String(DEFAULT_REASON_RX) },
    /* Every reason name seen on unassigned upcoming visits, so the exact
       trigger names can be chosen from reality instead of guessed. */
    reason_names_seen_on_unassigned: Object.fromEntries(reasonNamesSeen),
    attendance_sweep: (globalThis as any).__attSwept ?? 'already done for yesterday',
  }

  try {
    await sb.rpc('upsert_app_data_item', { target_key: 'automation_log', item: {
      id: 'auto_srv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      at: nowIso, automation: 'coverage-watch', ran_by: 'server',
      ok: !fetchError, dry: !live, duration_ms: Date.now() - t0,
      rows_seen: visits.length, candidates: wouldOpen.length, created,
    } })
  } catch { /* logging must never block the watch */ }

  return json(summary)
})
