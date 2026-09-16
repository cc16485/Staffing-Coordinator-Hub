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

  /* ── WHO HELD THIS VISIT? (her check, 2026-09-13: "did it show that Abigail
     called out") AxisCare erases the caregiver the moment a visit is
     unassigned, so by the time the watcher sees a call-off the API can no
     longer say WHO called off. But the watcher sees every upcoming visit
     every few minutes, so it keeps a short memory (app_data 'visit_memory',
     server-only) of who last held each visit. When a visit turns up
     unassigned, the case names that remembered person as calling_off, and
     the family text can say "Abigail is unable to make it" instead of
     "The caregiver scheduled". Entries older than 10 days get pruned a few
     at a time so the key never grows without bound. */
  const { data: vmRow } = await sb.from('app_data').select('data').eq('key', 'visit_memory').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const vmItems: any[] = Array.isArray(vmRow?.data) ? vmRow!.data : []
  // deno-lint-ignore no-explicit-any
  const heldBy = new Map<string, any>(vmItems.map((m: any) => [String(m?.visit_id ?? ''), m]))
  try {
    for (const v of visits) {
      if (v?.caregiver?.id == null) continue
      const vid = String(v?.id ?? ''); if (!vid) continue
      const nm = [String(v.caregiver.firstName ?? '').trim(), String(v.caregiver.lastName ?? '').trim()]
        .filter(Boolean).join(' ')
      if (!nm) continue
      const prev = heldBy.get(vid)
      if (prev && prev.caregiver === nm) continue
      const item = { id: 'vm_' + vid.replace(/[^A-Za-z0-9]/g, '_'), visit_id: vid,
        caregiver: nm, seen_at: nowIso }
      heldBy.set(vid, item)
      await sb.rpc('upsert_app_data_item', { target_key: 'visit_memory', item })
    }
    const cutoffVm = Date.now() - 10 * 864e5
    let prunedVm = 0
    for (const m of vmItems) {
      if (prunedVm >= 25) break
      if (m?.id && new Date(String(m?.seen_at || 0)).getTime() < cutoffVm) {
        await sb.rpc('delete_app_data_item', { target_key: 'visit_memory', item_id: m.id })
        prunedVm++
      }
    }
  } catch { /* memory is best-effort; never block the watch */ }

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
      calling_off: String(heldBy.get(visitId)?.caregiver ?? ''),
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

  /* ── COVERED OUTSIDE THE BOARD (her observation, 2026-09-13: "it could be
     that we cover it outside the calloff board"). If an OPEN case's visit
     shows a caregiver again in AxisCare, somebody assigned it directly there.
     Close the case with that caregiver as covered_by — coverage-run's next
     closure pass then sends the courtesy texts and the family circle text
     exactly as if Confirm had been tapped on the board. Scope guard: only
     cases that are already open (a real call-off) — a plain schedule
     reassignment with no case never texts anybody. */
  let coveredOutside = 0
  try {
    const byVisitId = new Map(visits.map(v => [String(v?.id ?? ''), v]))
    for (const cc of cases) {
      if (cc?.status !== 'open' || !cc?.axiscare_visit_id) continue
      const v = byVisitId.get(String(cc.axiscare_visit_id))
      if (!v || v?.caregiver?.id == null) continue
      const cgName = [String(v.caregiver.firstName ?? '').trim(), String(v.caregiver.lastName ?? '').trim()]
        .filter(Boolean).join(' ') || ('caregiver ' + v.caregiver.id)
      /* The visit may have been RESCHEDULED when it was re-covered (Abigail's
         8-12 became Autumn's 11:30-3:30). The case, and the family text's
         {when}, must carry the times that are true NOW, not the snapshot
         from the moment of the call-off. */
      const liveStart = String(v?.scheduledStartDate ?? v?.startDate ?? '')
      const liveEnd = String(v?.scheduledEndDate ?? v?.endDate ?? '')
      if (liveStart) cc.shift_date = liveStart.slice(0, 10)
      const liveTime = [liveStart, liveEnd].map((x: string) => x ? x.slice(11, 16) : '')
        .filter(Boolean).join('-')
      if (liveTime && liveTime !== cc.shift_time) {
        cc.note = [String(cc.note || '').trim(),
          `Visit time is now ${liveTime} (was ${cc.shift_time || 'unrecorded'}).`]
          .filter(Boolean).join('\n')
        cc.shift_time = liveTime
      }
      if (!cc.calling_off) {
        const remembered = heldBy.get(String(cc.axiscare_visit_id))?.caregiver
        if (remembered && remembered !== cgName) cc.calling_off = remembered
      }
      cc.status = 'resolved'
      cc.resolved_at = nowIso
      cc.resolved_how = 'covered'
      cc.covered_by = cgName
      cc.note = [String(cc.note || '').trim(),
        `Covered in AxisCare directly (assigned to ${cgName}) — closed by the watcher.`]
        .filter(Boolean).join('\n')
      const { error } = await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: cc })
      if (!error) coveredOutside++
    }
  } catch { /* never let this block the watch */ }

  /* ── SHIFT PATTERN: is the OPENING ongoing, or one-time? ────────────────
     (Her ask 2026-09-16, CORRECTED same day: "it's not OPEN ongoing — Emma
     normally works the shift, only needs off this Friday." A repeating
     SCHEDULE does not make the OPENING ongoing.) A visit id is a composite
     key, s=<scheduleId>:d=<date>; the schedule's other dates in the next
     28 days are this shift's siblings, and what matters is whether THEY
     have a caregiver:
       every sibling open        → open_ongoing   (nobody holds the slot —
                                                   it could become yours)
       every sibling covered     → one_time_cover (someone holds the slot,
                                                   just this date needs help)
       no siblings at all        → one_time
       some open, some covered   → mixed          (texts stay silent)
     The label states what the calendar actually shows — it never guesses
     at AxisCare's recurrence vocabulary. The raw schedule row rides along
     for display. v:2 marks this logic, so cases stamped by the withdrawn
     schedule-repeats-means-ongoing version are re-stamped. Stamped once;
     a failed fetch stamps nothing and retries next tick; a tick with
     nothing to stamp fetches nothing. */
  let patternStamped = 0
  try {
    const patternRx = /^s=(\d+):d=\d{4}-\d\d-\d\d$/
    // deno-lint-ignore no-explicit-any
    const needy = cases.filter(cc => cc?.status === 'open'
      && (!cc?.shift_pattern || (cc.shift_pattern as any).v !== 2)
      && patternRx.test(String(cc?.axiscare_visit_id ?? '')))
    if (needy.length && live) {   // a dry run marks nothing, this stamp included
      // deno-lint-ignore no-explicit-any
      const rowsIn = (j: any, key: string): any[] => {
        if (Array.isArray(j)) return j
        const r = j?.results ?? j
        if (Array.isArray(r?.[key])) return r[key]
        for (const v of Object.values(r ?? {})) if (Array.isArray(v)) return v
        return []
      }
      const chiToday = new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
      const farDate = new Date(Date.now() + 28 * 864e5).toISOString().slice(0, 10)
      const sibsBySchedule = new Map<string, Map<string, { open: boolean; caregiver: string }>>()
      let vUrl: string | null = `https://${site}.axiscare.com/api/visits?startDate=${chiToday}&endDate=${farDate}`
      for (let page = 0; vUrl && page < 12; page++) {
        const r: Response = await fetch(vUrl, { headers: {
          Authorization: `Bearer ${token}`, Accept: 'application/json',
          'X-AxisCare-Api-Version': AC_VERSION } })
        if (!r.ok) throw new Error(`visits window ${r.status}`)
        // deno-lint-ignore no-explicit-any
        const j: any = await r.json().catch(() => ({}))
        for (const v of rowsIn(j, 'visits')) {
          if (v?.removed) continue
          const m = patternRx.exec(String(v?.id ?? '')); if (!m) continue
          const d = String(v.id).slice(String(v.id).indexOf(':d=') + 3)
          if (!sibsBySchedule.has(m[1])) sibsBySchedule.set(m[1], new Map())
          sibsBySchedule.get(m[1])!.set(d, {
            open: v?.caregiver?.id == null,
            caregiver: [String(v?.caregiver?.firstName ?? '').trim(),
                        String(v?.caregiver?.lastName ?? '').trim()].filter(Boolean).join(' '),
          })
        }
        vUrl = j?.results?.nextPage ?? j?.nextPage ?? j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
      }
      /* The schedule rows themselves, for the raw recurrence detail. A
         failure here loses only the detail, never the calendar-based label. */
      // deno-lint-ignore no-explicit-any
      const schedRows = new Map<string, any>()
      try {
        let sUrl: string | null = `https://${site}.axiscare.com/api/schedules?startDate=${chiToday}&endDate=${farDate}`
        for (let page = 0; sUrl && page < 12; page++) {
          const r: Response = await fetch(sUrl, { headers: {
            Authorization: `Bearer ${token}`, Accept: 'application/json',
            'X-AxisCare-Api-Version': AC_VERSION } })
          if (!r.ok) break
          // deno-lint-ignore no-explicit-any
          const j: any = await r.json().catch(() => ({}))
          for (const s of rowsIn(j, 'schedules')) {
            const sid = String(s?.scheduleId ?? s?.id ?? '')
            if (sid && !schedRows.has(sid)) schedRows.set(sid, s)
          }
          sUrl = j?.results?.nextPage ?? j?.nextPage ?? j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
        }
      } catch { /* detail only */ }
      for (const cc of needy) {
        const sid = patternRx.exec(String(cc.axiscare_visit_id))![1]
        const own = String(cc.shift_date || '')
        const sibs = [...(sibsBySchedule.get(sid) ?? new Map()).entries()]
          .filter(([d]) => d !== own && d >= chiToday)
          .sort((a, b) => a[0] < b[0] ? -1 : 1)
        const openDates = sibs.filter(([, x]) => x.open).map(([d]) => d)
        const covered = sibs.filter(([, x]) => !x.open)
        /* Who holds the slot: the caregiver on most of the covered siblings. */
        const tally = new Map<string, number>()
        for (const [, x] of covered) if (x.caregiver)
          tally.set(x.caregiver, (tally.get(x.caregiver) ?? 0) + 1)
        const regular = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
        const s = schedRows.get(sid)
        const weekday = /^\d{4}-\d\d-\d\d$/.test(own)
          ? new Date(own + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' }) : ''
        cc.shift_pattern = {
          v: 2,
          kind: sibs.length === 0 ? 'one_time'
            : openDates.length === 0 ? 'one_time_cover'
            : covered.length === 0 ? 'open_ongoing' : 'mixed',
          weekday, open_dates: openDates.slice(0, 8),
          covered_dates: covered.length, sibling_dates: sibs.length,
          regular_caregiver: regular,
          window_days: 28, schedule_id: sid, checked_at: nowIso,
          schedule: s ? { frequency: s.frequency ?? null, day: s.day ?? null,
            start_date: s.startDate ?? null, end_date: s.endDate ?? null,
            type: s.type ?? null } : null,
        }
        const { error } = await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: cc })
        if (!error) patternStamped++
      }
    }
  } catch { /* pattern is a label, never a blocker — retry next tick */ }

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

  /* ── FLAGGED VISIT NOTES → COORDINATOR REVIEW (her call, 2026-09-13: no
     auto-texting families about clinical notes; a person reads first). Every
     medium/high-rated care note on yesterday's or today's visits becomes ONE
     ops item for review. Runs at most once an hour; deterministic ids mean
     reruns never duplicate. The exact shape AxisCare uses for note ratings
     is not in the capability map, so this PROBES: embedded fields first,
     then per-visit endpoints on a small sample — and reports which shape it
     found (or that it found none) so reality, not guesswork, tunes it. */
  try {
    const hourStamp = new Date().toISOString().slice(0, 13)
    const { data: nsRow } = await sb.from('app_data').select('data').eq('key', 'notes_watch_state').maybeSingle()
    const nsArr: any[] = Array.isArray(nsRow?.data) ? nsRow!.data : []
    const ns = nsArr.find((x: any) => x?.id === 'state') ?? { id: 'state', last_hour: '' }
    const forceNotes = new URL(req.url).searchParams.get('notes') === '1'
    if (ns.last_hour !== hourStamp || forceNotes) {
      const { token: tk, site: st } = axisCreds()
      const chiToday = new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
      const chiYest = new Date(Date.now() - 864e5)
        .toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
      const rows: any[] = []
      let u2: string | null = `https://${st}.axiscare.com/api/visits?startDate=${chiYest}&endDate=${chiToday}`
      for (let page = 0; u2 && page < 12; page++) {
        const r: Response = await fetch(u2, { headers: {
          Authorization: `Bearer ${tk}`, Accept: 'application/json',
          'X-AxisCare-Api-Version': AC_VERSION } })
        if (!r.ok) { u2 = null; break }
        const j: any = await r.json().catch(() => ({}))
        for (const v of (Array.isArray(j?.results?.visits) ? j.results.visits
          : Object.values(j?.results?.visits ?? {}))) if (!(v as any)?.removed) rows.push(v)
        u2 = j?.results?.nextPage ?? j?.nextPage ?? j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
      }
      const listOf = (x: any): any[] => Array.isArray(x) ? x
        : (x && typeof x === 'object' ? Object.values(x) : [])
      const notesOn = (v: any): { notes: any[]; shape: string } => {
        for (const k of ['careNotes', 'visitNotes', 'notes']) {
          const n = listOf(v?.[k]).filter(x => x && typeof x === 'object')
          if (n.length) return { notes: n, shape: 'visit.' + k }
        }
        return { notes: [], shape: '' }
      }
      const ratingOf = (n: any): string => {
        for (const k of ['rating', 'importance', 'priority', 'severity']) {
          const v = n?.[k]
          const s = typeof v === 'object' ? String(v?.name ?? v?.label ?? '') : String(v ?? '')
          if (s.trim()) return s.trim()
        }
        return ''
      }
      const textOf = (n: any): string =>
        String(n?.note ?? n?.text ?? n?.body ?? n?.comment ?? n?.description ?? '').trim()

      let shape = '', notesSeen = 0, flagged = 0, made = 0
      let embeddedAny = false
      const perVisit = new Map<string, any[]>()
      for (const v of rows) {
        const got = notesOn(v)
        if (got.notes.length) { embeddedAny = true; shape = shape || got.shape
          perVisit.set(String(v?.id ?? ''), got.notes) }
      }
      if (!embeddedAny) {
        /* probe the per-visit endpoints on a small sample, then fetch for all
           only if a sample hit proves the endpoint exists */
        let endpoint = ''
        for (const v of rows.slice(0, 5)) {
          for (const ep of ['careNotes', 'notes']) {
            try {
              const r = await fetch(`https://${st}.axiscare.com/api/visits/${v?.id}/${ep}`, { headers: {
                Authorization: `Bearer ${tk}`, Accept: 'application/json',
                'X-AxisCare-Api-Version': AC_VERSION } })
              if (!r.ok) continue
              const j: any = await r.json().catch(() => ({}))
              const n = listOf(j?.results?.[ep] ?? j?.[ep] ?? j?.results ?? j)
                .filter(x => x && typeof x === 'object' && (textOf(x) || ratingOf(x)))
              if (n.length) { endpoint = ep; break }
            } catch { /* keep probing */ }
          }
          if (endpoint) break
        }
        if (endpoint) {
          shape = 'endpoint:/api/visits/{id}/' + endpoint
          for (const v of rows.slice(0, 60)) {
            try {
              const r = await fetch(`https://${st}.axiscare.com/api/visits/${v?.id}/${endpoint}`, { headers: {
                Authorization: `Bearer ${tk}`, Accept: 'application/json',
                'X-AxisCare-Api-Version': AC_VERSION } })
              if (!r.ok) continue
              const j: any = await r.json().catch(() => ({}))
              const n = listOf(j?.results?.[endpoint] ?? j?.[endpoint] ?? j?.results ?? j)
                .filter(x => x && typeof x === 'object')
              if (n.length) perVisit.set(String(v?.id ?? ''), n)
            } catch { /* one visit failing must not stop the sweep */ }
          }
        }
      }
      for (const [vid, notes] of perVisit) {
        const v = rows.find(x => String(x?.id ?? '') === vid)
        const clientFirst = String(v?.client?.firstName ?? '').trim() || 'a client'
        const cgName = [String(v?.caregiver?.firstName ?? '').trim(), String(v?.caregiver?.lastName ?? '').trim()]
          .filter(Boolean).join(' ')
        for (let i = 0; i < notes.length; i++) {
          notesSeen++
          const rating = ratingOf(notes[i])
          if (!/med|high/i.test(rating)) continue
          flagged++
          const hi = /high/i.test(rating)
          const nid = String(notes[i]?.id ?? i)
          const txt = textOf(notes[i]).slice(0, 600)
          const { error } = await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
            id: `ops_note_${vid.replace(/[^A-Za-z0-9]/g, '_')}_${nid.replace(/[^A-Za-z0-9]/g, '_')}`,
            kind: 'review',
            title: `Flagged visit note (${rating}): ${clientFirst}`,
            about: clientFirst,
            detail: `${cgName || 'The caregiver'} left a ${rating}-rated note on ${clientFirst}'s `
              + `${String(v?.scheduledStartDate ?? v?.startDate ?? '').slice(0, 10)} visit:\n\n"${txt}"\n\n`
              + `Read it, then decide whether the family should hear from us by phone. `
              + `Their circle is on the client's profile (Client Care > Active Clients > tap the name). `
              + `This alert never texts the family by itself.`,
            domain: 'client_care', status: 'open', urgency: hi ? 'high' : 'normal',
            owner: '', owner_name: '',
            due: new Date(Date.now() + (hi ? 4 : 24) * 3600 * 1000).toISOString(),
            created_at: new Date().toISOString(),
            created_by: 'notes-watch', opened_by: 'flagged-visit-note',
          } })
          if (!error) made++
        }
      }
      ns.last_hour = hourStamp
      await sb.rpc('upsert_app_data_item', { target_key: 'notes_watch_state', item: ns })
      ;(globalThis as any).__noteSwept = { window: `${chiYest} → ${chiToday}`,
        visits_checked: rows.length, notes_seen: notesSeen, flagged, items_created: made,
        shape: shape || 'NONE FOUND — no note fields on visits and no per-visit note endpoint answered; tell Claude what the capability map should say' }
    }
  } catch (err) { (globalThis as any).__noteSwept = { error: String(err) } }

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
    covered_outside_the_board: coveredOutside,
    pattern_stamped: patternStamped,
    would_open: wouldOpen,
    reason_filter: configuredReasons.length
      ? { mode: 'exact names from ops_settings.coverage_watch_reasons', names: configuredReasons }
      : { mode: 'default pattern', pattern: String(DEFAULT_REASON_RX) },
    /* Every reason name seen on unassigned upcoming visits, so the exact
       trigger names can be chosen from reality instead of guessed. */
    reason_names_seen_on_unassigned: Object.fromEntries(reasonNamesSeen),
    attendance_sweep: (globalThis as any).__attSwept ?? 'already done for yesterday',
    notes_sweep: (globalThis as any).__noteSwept ?? 'already done this hour',
  }

  /* Heartbeat every run (the watchdog's signal that the watcher is alive);
     the richer automation_log row only when this tick actually did
     something or failed — at a minutes-cadence an every-tick log row would
     grow the shared app_data array without bound. */
  try {
    await sb.rpc('upsert_app_data_item', { target_key: 'automation_heartbeats', item: {
      id: 'hb_coverage-watch', automation: 'coverage-watch', at: nowIso, ok: !fetchError,
      note: fetchError ? String(fetchError).slice(0, 120)
        : `visits:${visits.length} candidates:${wouldOpen.length} created:${created} covered_outside:${coveredOutside}`
          + (patternStamped ? ` pattern:${patternStamped}` : ''),
    } })
    // deno-lint-ignore no-explicit-any
    const att: any = (globalThis as any).__attSwept, notes: any = (globalThis as any).__noteSwept
    const acted = created > 0 || coveredOutside > 0 || !!fetchError
      || (att && typeof att === 'object' && (att.events_logged > 0 || att.error))
      || (notes && typeof notes === 'object' && (notes.items_created > 0 || notes.error))
    if (acted) {
      await sb.rpc('upsert_app_data_item', { target_key: 'automation_log', item: {
        id: 'auto_srv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        at: nowIso, automation: 'coverage-watch', ran_by: 'server',
        ok: !fetchError, dry: !live, duration_ms: Date.now() - t0,
        rows_seen: visits.length, candidates: wouldOpen.length, created,
      } })
    }
  } catch { /* logging must never block the watch */ }

  return json(summary)
})
