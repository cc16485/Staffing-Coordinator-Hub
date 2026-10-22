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
import { opEvent } from '../_shared/events.ts'
import { jobCaller } from '../_shared/job-auth.ts'
import { archivedSchedules, caseHistory, changedSince, decideHeld, heldItem, visitMs } from '../_shared/held-shift.ts'
import { outsideVerdict } from '../_shared/covered-outside.ts'
import { attendanceCard, caseEnded, caseWhen, shiftAhead, chiNowNaive, evvDayStats, evvWeek, familyCallNeeded, itemsToCloseForCases,
  markNoClosureTexts, pastCaseVerdict, weekOf } from '../_shared/loops.ts'
import { loadQuiet, isQuiet, isNotClient } from '../_shared/client-quiet.ts'
import { confirmTimesItem, hasCard, outAfterMin } from '../_shared/confirm-times.ts'
import { fallbackList } from '../_shared/notice-to.ts'
import { quietOn, mondayOf, weekCard, weekCardId, suggestedBefore, recheckCases } from '../_shared/quiet-cards.ts'
import { openShiftSkip, openShiftItem, openShiftCloseWhy, openShiftId, scheduleOf, OPEN_SHIFT_KIND, OPEN_SHIFT_PER_RUN, type OpenVisit } from '../_shared/open-shift.ts'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 2), { status: s, headers: { 'Content-Type': 'application/json' } })

const AC_VERSION = Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01'
/* Which modification reasons mean "this shift lost its caregiver"?
   Call in / call off, and — since 2026-09-16, when Wanda Keltner's call-in
   was recorded as "Staffing Change - Caregiver Change" and sat invisible —
   caregiver change too: an UNASSIGNED upcoming visit with that reason is a
   shift nobody is coming to, whatever the dropdown called it. Client
   cancellations never match: a cancelled visit needs no fill. The
   ops_settings.coverage_watch_reasons list still overrides this pattern
   with an exact set when Samantha wants one. */
const DEFAULT_REASON_RX = /call[\s-]?(in|off)|caregiver[\s-]?change/i
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
  /* J2 (2026-09-29): only its every-5-minutes schedule or the owner's server key. Everyone else, the public key included, is refused
     before anything is read or written. */
  const caller = await jobCaller(req)
  if (!caller) return json({ error: 'not allowed' }, 401)
  if (new URL(req.url).searchParams.get('auth_check') === '1') return json({ ok: true, caller })
  /* J1: read only after the caller is known (2026-10-12; it used to run first, so a refused call still read the list) */
  await loadQuiet(sb)   // Pause care / End care: paused and ended clients' visits are skipped
  const t0 = Date.now()

  const { data: setRow } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const settings: any = setRow?.data ?? {}
  const forceDry = new URL(req.url).searchParams.get('dry') === '1'
  const live = settings.coverage_watch_live === true && !forceDry
  /* Change 7b, off until she switches it on (ops_settings.coverage_watch_7b_live):
     1. a held shift that changed in AxisCare since its case closed reopens, and a person
        is asked about the ones that can't be settled;
     2. a visit time with no offset is read as the visit's own wall clock, not UTC, when
        deciding "already started". While off, both are only REPORTED (held_checks,
        time_check), so the preview shows exactly what switching on would change. */
  const reopenLive = settings.coverage_watch_7b_live === true
  /* Today cockpit Phase 2 (2026-10-05): the Hub closes its own loops. Off until ops_settings.loops_close_live; while
     off, the summary's "loops" section says exactly what WOULD close, open or be asked, and nothing is written. */
  const loopsLive = settings.loops_close_live === true && !forceDry
  const loopsSince = String(settings.loops_close_since || '')
  /* Fewer cards (2026-10-22, her: "stop EVV and Make it official cards", "coverage checks close themselves from AxisCare",
     "a weekly Make it official list"), off until ops_settings.quieter_cards_live (_shared/quiet-cards.ts). Off: exactly as before. */
  const quiet = quietOn(settings)
  // deno-lint-ignore no-explicit-any
  const quietPlan: any = { on: quiet, official_week: null, official_new: 0, evv_review: quiet ? 'not made (EVV is retired)' : 'made on Mondays as before', rechecked: [] }
  const timeDiffers = new Map<string, Record<string, unknown>>()
  let sampleStart = ''
  // deno-lint-ignore no-explicit-any
  const startedNow = (v: any, stamp: string): boolean => {
    if (!stamp) return false
    if (!sampleStart) sampleStart = stamp
    const fixed = visitMs(stamp, v?.timezone) < Date.now()
    const old = new Date(stamp).getTime() < Date.now()
    if (fixed !== old) timeDiffers.set(String(v?.id ?? ''), { visit: String(v?.id ?? ''), when: stamp,
      client: [String(v?.client?.firstName ?? '').trim(), String(v?.client?.lastName ?? '').trim()].filter(Boolean).join(' '),
      old_reading: old ? 'already started' : 'upcoming', correct_reading: fixed ? 'already started' : 'upcoming' })
    return reopenLive ? fixed : old
  }
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
        if (v?.removed || isQuiet(v)) continue
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
  /* Archived cases are history too (her testing clean-up, 2026-10-12): they block a fresh case the same way a
     closed one does, but they are never worked as open. */
  const { data: archRow } = await sb.from('app_data').select('data').eq('key', 'coverage_cases_archive').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const history: any[] = caseHistory(cases, Array.isArray(archRow?.data) ? archRow!.data : [])
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
  for (const cc of history) {
    const v = String(cc?.axiscare_visit_id ?? ''); if (!v) continue
    genByVisit.set(v, (genByVisit.get(v) ?? 0) + 1)
  }
  /* THE CLOSE-REOPEN FIGHT ENDS HERE (her 2026-09-16 live lesson, fixed
     2026-09-19): a HUMAN closing a watch case holds. No fresh generation
     for that visit unless the visit itself has CHANGED in AxisCare since
     the close. Change 7b (2026-09-27): AxisCare visits carry NO modified
     date (Desktop 253), so "changed since the close" is now asked of AxisCare
     itself (updatedSinceDate), and the shifts it can't settle go to a person
     (_shared/held-shift.ts). */
  // deno-lint-ignore no-explicit-any
  const lastClosedCase = new Map<string, any>()
  for (const cc of history) {
    const v = String(cc?.axiscare_visit_id ?? ''); if (!v) continue
    if (cc?.status === 'open' || !cc?.resolved_at) continue
    const prev = lastClosedCase.get(v)
    if (!prev || String(cc.resolved_at) > String(prev.resolved_at)) lastClosedCase.set(v, cc)
  }
  const heldChecks: Record<string, unknown>[] = []
  let reopened = 0, heldAsked = 0
  let opsIds: Set<string> | null = null
  const opsHas = async (id: string): Promise<boolean> => {
    if (!opsIds) {
      const { data, error } = await sb.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
      if (error) return true   // can't see the list: raise nothing now, the next run tries again
      opsIds = new Set((Array.isArray(data?.data) ? data!.data : []).map((i: { id?: unknown }) => String(i?.id ?? '')))
    }
    return opsIds.has(id)
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
  /* Every unassigned upcoming visit, with WHY the watcher did or didn't
     act — so "why didn't it catch X?" is answered by reading the response
     instead of an investigation (the Wanda Keltner question). */
  const unassignedDetail: Record<string, unknown>[] = []
  let unassigned = 0, reasonMatched = 0, alreadyHandled = 0, inPast = 0, created = 0

  for (const v of visits) {
    if (v?.caregiver?.id != null) continue
    unassigned++
    const reason = String(v?.modificationReason?.name ?? '').trim()
    if (reason) reasonNamesSeen.set(reason, (reasonNamesSeen.get(reason) ?? 0) + 1)
    {
      const dStart = String(v?.scheduledStartDate ?? v?.startDate ?? '')
      unassignedDetail.push({
        client: [String(v?.client?.firstName ?? '').trim(), String(v?.client?.lastName ?? '').trim()]
          .filter(Boolean).join(' ') || '(no client name)',
        when: dStart, visit: String(v?.id ?? ''),
        reason: reason || '(no modification reason)',
        verdict: !reason ? 'ignored, no reason recorded'
          : !reasonMatches(reason) ? 'ignored, reason does not match the filter'
          : startedNow(v, dStart) ? 'ignored, already started'
          : openByVisit.has(String(v?.id ?? '')) ? 'already has an open case'
          : 'opens a case',
      })
    }
    if (!reason || !reasonMatches(reason)) continue
    reasonMatched++
    const start = String(v?.scheduledStartDate ?? v?.startDate ?? '')
    if (startedNow(v, start)) { inPast++; continue }
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

    /* A shift whose last case is closed (Change 7b): ask AxisCare whether it changed since. */
    const closedCase = lastClosedCase.get(visitId)
    let reopenNote = ''
    if (closedCase) {
      const chk = await changedSince(fetch, site, token, AC_VERSION, visitId, String(closedCase.resolved_at))
      const decision = decideHeld(chk.changed, closedCase)
      const act = live && reopenLive
      const row: Record<string, unknown> = { client: clientName, visit: visitId, when: start, closed_case: closedCase.id ?? null,
        closed_how: closedCase.resolved_how ?? null, covered_by: closedCase.covered_by ?? null, decision, detail: chk.detail, acted: false }
      heldChecks.push(row)
      const det = unassignedDetail.find((d) => d.visit === visitId)
      if (decision === 'reopen' && act) {
        row.acted = true; reopened++
        reopenNote = `Opened again: the shift changed in AxisCare after the last case closed (${String(closedCase.resolved_at)}), and it has no caregiver, reason "${reason}".`
        if (det) det.verdict = 'opens a case again (changed in AxisCare since the last case closed)'
      } else {
        alreadyHandled++
        if (det) det.verdict = decision === 'reopen' ? 'held: changed since the last case closed (reopening is switched off)'
          : decision === 'hold' ? "held: a person closed the last case and the shift hasn't changed since"
          : decision === 'ask_covered' ? `held: marked covered but AxisCare shows no caregiver (${act ? 'a person was asked' : 'would ask a person'})`
          : `held: couldn't ask AxisCare whether it changed (${act ? 'a person was asked' : 'would ask a person'})`
        if (act) {
          const admins = (Array.isArray(settings.coverage_alert_admins) && settings.coverage_alert_admins.length)
            ? settings.coverage_alert_admins : await fallbackList(sb, 'scheduling_coverage')   // SOP ruling 8 (2026-10-17)
          const item = heldItem(decision, { visitId, client: clientName, startMs: visitMs(start, v?.timezone), reason,
            lastCase: closedCase, detail: chk.detail, owner: String(admins[0]), nowIso })
          if (item && !(await opsHas(item.id))) {
            const { error } = await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item })
            if (!error) { row.acted = true; heldAsked++; opsIds?.add(item.id)
              await opEvent(sb, { job: 'coverage-watch', verb: 'coverage_held_check', item_id: item.id, area: 'coverage', summary: item.title }) }
          }
        }
        continue
      }
    }
    wouldOpen.push(entry)

    if (live) {
      const c = {
        id: 'cw_' + visitId.replace(/[^A-Za-z0-9]/g, '_') + '_g' + ((genByVisit.get(visitId) ?? 0) + 1),
        ...entry,
        reason: 'call_off',
        note: reopenNote || `Opened automatically: shift unassigned in AxisCare with reason "${reason}".`,
        ...(reopenNote ? { reopened_after: closedCase?.id ?? null } : {}),
        status: 'open', asked: [],
        opened_at: nowIso, opened_by: 'axiscare-watch', seen_unassigned_at: nowIso,
        caller_phone: '', caller_contact_id: '',
        resolved_at: null, resolved_how: null, covered_by: null,
      }
      const { error } = await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: c })
      if (!error) {
        created++; openByVisit.add(visitId)
        await opEvent(sb, { job: 'coverage-watch', verb: 'coverage_opened', item_id: c.id, area: 'coverage',
          summary: `Cara opened a case for a shift with no caregiver${reopenNote ? ' again' : ''}: ${clientName || 'a client'} ${entry.shift_date} ${entry.shift_time}`
            + (entry.calling_off ? `, ${entry.calling_off} was taken off it in AxisCare (not counted as a call-in)` : '') })
      }
    }
  }

  /* ── THE ONGOING SWEEP (her ask, 2026-09-18: "could the ongoing shifts to
     fill be automated based off the axiscare schedule"). Once an hour (first
     tick of the hour, or ?sweep=1), look 14 days ahead for SCHEDULES — not
     single visits — where two or more future dates have no caregiver. That
     is a standing opening, whatever modification reason it carries (none
     needed: a slot that was never assigned has no reason at all, and a slot
     held by an INACTIVE caregiver also reads null — either way nobody is
     coming, which is exactly what the board should show). One case per
     schedule EVER, deterministic id cwo_s<scheduleId>: if the office closed
     it, the robot never reopens it (the close-reopen lesson). Cases open
     silently — no admin alert; they are standing work, not a 2am emergency —
     and land in the board's "Ongoing shifts to fill" section. Manual mode
     means nothing texts anybody until a coordinator builds the list. */
  const SWEEP_DAYS = 14
  const chiMinute = Number(new Date().toLocaleString('en-US',
    { timeZone: 'America/Chicago', minute: '2-digit' }))
  const sweepDue = new URL(req.url).searchParams.get('sweep') === '1' || chiMinute < 5
  const wouldOpenOngoing: Record<string, unknown>[] = []
  let ongoingCreated = 0, ongoingSchedules = 0
  if (sweepDue) {
    // deno-lint-ignore no-explicit-any
    const sweepVisits: any[] = []
    let sUrl: string | null = `https://${site}.axiscare.com/api/visits?startDate=${startDate}`
      + `&endDate=${new Date(Date.now() + SWEEP_DAYS * 86400000).toISOString().slice(0, 10)}`
    try {
      for (let page = 0; sUrl && page < 12; page++) {
        const r: Response = await fetch(sUrl, { headers: {
          Authorization: `Bearer ${token}`, Accept: 'application/json',
          'X-AxisCare-Api-Version': AC_VERSION } })
        if (!r.ok) break
        // deno-lint-ignore no-explicit-any
        const j: any = await r.json().catch(() => ({}))
        const rows = Array.isArray(j?.results?.visits ?? j?.visits)
          ? (j?.results?.visits ?? j?.visits) : Object.values(j?.results?.visits ?? j?.visits ?? {})
        for (const v of rows) if (!v?.removed && !isQuiet(v)) sweepVisits.push(v)
        sUrl = j?.results?.nextPage ?? j?.nextPage ?? j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
      }
      /* Group unassigned FUTURE visits by their schedule (visit ids are
         composite "s=<scheduleId>:d=<date>" — AXISCARE-CAPABILITY.md). */
      // deno-lint-ignore no-explicit-any
      const bySched = new Map<string, any[]>()
      for (const v of sweepVisits) {
        if (v?.caregiver?.id != null) continue
        const vid = String(v?.id ?? '')
        const m = vid.match(/^s=([^:]+):/)
        if (!m) continue
        const start = String(v?.scheduledStartDate ?? v?.startDate ?? '')
        if (!start || new Date(start).getTime() < Date.now()) continue
        const arr = bySched.get(m[1]) ?? []
        arr.push(v); bySched.set(m[1], arr)
      }
      const haveSweepCase = new Set(history.map((cc: { id?: unknown }) => String(cc?.id ?? '')))
      // deno-lint-ignore no-explicit-any
      const openSchedIds = new Set(cases.filter((cc: any) => cc?.status === 'open')
        // deno-lint-ignore no-explicit-any
        .map((cc: any) => String(cc?.axiscare_visit_id ?? '').match(/^s=([^:]+):/)?.[1])
        .filter(Boolean))
      const archivedSchedIds = archivedSchedules(history, SWEEP_DAYS, Date.now())
      for (const [schedId, arr] of bySched) {
        if (arr.length < 2) continue         // one lone open date is a one-off, not an opening
        ongoingSchedules++
        if (haveSweepCase.has(`cwo_s${schedId}`)) continue   // handled once, never reopened
        if (openSchedIds.has(schedId)) continue              // a live case already covers this slot
        if (archivedSchedIds.has(schedId)) continue          // its call-offs were archived inside the sweep window
        // deno-lint-ignore no-explicit-any
        arr.sort((a: any, b: any) => String(a?.scheduledStartDate ?? a?.startDate ?? '')
          .localeCompare(String(b?.scheduledStartDate ?? b?.startDate ?? '')))
        const first = arr[0]
        const fStart = String(first?.scheduledStartDate ?? first?.startDate ?? '')
        const fEnd = String(first?.scheduledEndDate ?? first?.endDate ?? '')
        const dates = arr.map((v: { scheduledStartDate?: unknown; startDate?: unknown }) =>
          String(v?.scheduledStartDate ?? v?.startDate ?? '').slice(0, 10))
        const weekdays = [...new Set(dates.map(d =>
          new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' })))].join('/')
        const clientName = [String(first?.client?.firstName ?? '').trim(), String(first?.client?.lastName ?? '').trim()]
          .filter(Boolean).join(' ') || '(client name missing on the visit)'
        const entry = {
          schedule_id: schedId, client: clientName,
          first_open_date: dates[0], open_dates: dates.length, weekdays,
        }
        wouldOpenOngoing.push(entry)
        if (live) {
          const c = {
            id: `cwo_s${schedId}`,
            client: clientName,
            client_axiscare_id: first?.client?.id != null ? String(first.client.id) : null,
            axiscare_visit_id: String(first?.id ?? ''),
            shift_date: fStart.slice(0, 10),
            shift_time: [fStart, fEnd].map(s => s ? s.slice(11, 16) : '').filter(Boolean).join('-'),
            reason: 'open', calling_off: '',
            note: `Found by the ongoing sweep: ${dates.length} upcoming ${weekdays} date${dates.length === 1 ? '' : 's'} on this schedule have no caregiver (through ${dates[dates.length - 1]}).`,
            status: 'open', asked: [],
            opened_at: nowIso, opened_by: 'ongoing-sweep',
            caller_phone: '', caller_contact_id: '',
            admin_alerted: nowIso,   // standing work, not an alarm — no call-in alert
            shift_pattern: { v: 2, kind: 'open_ongoing', weekday: weekdays,
              future_dates: dates.slice(0, 8), more_dates: Math.max(0, dates.length - 8),
              window_days: SWEEP_DAYS, schedule_id: schedId, schedule: null, checked_at: nowIso },
            resolved_at: null, resolved_how: null, covered_by: null,
          }
          const { error } = await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: c })
          if (!error) {
            ongoingCreated++; haveSweepCase.add(c.id)
            await opEvent(sb, { job: 'coverage-watch', verb: 'coverage_opened', item_id: c.id, area: 'coverage',
              summary: `Cara opened an ongoing-shifts case: ${clientName || 'a client'}, ${dates.length} open ${weekdays} date${dates.length === 1 ? '' : 's'}` })
          }
        }
      }
      /* ── PATTERN INTELLIGENCE (her pick #4, 2026-09-19): a slot that keeps
         getting rescued ad-hoc by the SAME caregiver is a regular assignment
         waiting to be made official. Look 21 days back: if a schedule with
         open future dates had its last 3+ worked occurrences all covered by
         one caregiver, suggest making them the regular — once per schedule
         ever (a closed suggestion never reopens). */
      try {
        if (bySched.size) {
          const { data: itemRow } = await sb.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
          const haveItem = new Set((Array.isArray(itemRow?.data) ? itemRow!.data : [])
            .map((i: { id?: unknown }) => String(i?.id ?? '')))
          /* quiet: one list for the week; a schedule already on an old card or an earlier list is never suggested again */
          const already = quiet ? suggestedBefore(Array.isArray(itemRow?.data) ? itemRow!.data : []) : new Set<string>()
          // deno-lint-ignore no-explicit-any
          const weekly: any[] = []
          // deno-lint-ignore no-explicit-any
          const backVisits: any[] = []
          let bu: string | null = `https://${site}.axiscare.com/api/visits?startDate=${new Date(Date.now() - 21 * 86400000).toISOString().slice(0, 10)}&endDate=${new Date(Date.now() - 86400000).toISOString().slice(0, 10)}`
          for (let page = 0; bu && page < 12; page++) {
            const r: Response = await fetch(bu, { headers: {
              Authorization: `Bearer ${token}`, Accept: 'application/json',
              'X-AxisCare-Api-Version': AC_VERSION } })
            if (!r.ok) break
            // deno-lint-ignore no-explicit-any
            const j: any = await r.json().catch(() => ({}))
            const rows2 = Array.isArray(j?.results?.visits ?? j?.visits)
              ? (j?.results?.visits ?? j?.visits) : Object.values(j?.results?.visits ?? j?.visits ?? {})
            for (const v of rows2) if (!v?.removed) backVisits.push(v)
            bu = j?.results?.nextPage ?? j?.nextPage ?? j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
          }
          // deno-lint-ignore no-explicit-any
          const pastBySched = new Map<string, any[]>()
          for (const v of backVisits) {
            const m = String(v?.id ?? '').match(/^s=([^:]+):/)
            if (!m || !bySched.has(m[1])) continue
            if (v?.caregiver?.id == null) continue
            const arr = pastBySched.get(m[1]) ?? []
            arr.push(v); pastBySched.set(m[1], arr)
          }
          for (const [schedId, arr] of pastBySched) {
            const itemId = `ops_regular_s${schedId}`
            if (haveItem.has(itemId) || already.has(String(schedId))) continue
            // deno-lint-ignore no-explicit-any
            arr.sort((a: any, b: any) => String(a?.scheduledStartDate ?? a?.startDate ?? '')
              .localeCompare(String(b?.scheduledStartDate ?? b?.startDate ?? '')))
            const last3 = arr.slice(-3)
            if (last3.length < 3) continue
            const ids = [...new Set(last3.map((v) => String(v.caregiver.id)))]
            if (ids.length !== 1) continue
            const w = last3[last3.length - 1]
            const cgName = [String(w.caregiver.firstName ?? '').trim(), String(w.caregiver.lastName ?? '').trim()]
              .filter(Boolean).join(' ')
            const clName = [String(w?.client?.firstName ?? '').trim(), String(w?.client?.lastName ?? '').trim()]
              .filter(Boolean).join(' ') || 'the client'
            const wd = new Date(String(w?.scheduledStartDate ?? w?.startDate ?? '').slice(0, 10) + 'T12:00:00')
              .toLocaleDateString('en-US', { weekday: 'long' })
            if (quiet) { weekly.push({ sched: String(schedId), caregiver: cgName, client: clName, weekday: wd }); continue }
            if (live) {
              await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
                id: itemId, kind: 'staffing',
                title: `Make it official? ${cgName} has covered ${clName}'s ${wd} slot 3 times running`,
                about: clName,
                detail: `The ${wd} schedule still shows open future dates, but ${cgName} has worked its last three occurrences. If it's working for everyone, assign them as the regular in AxisCare and this stops being a weekly scramble.`,
                domain: 'scheduling_coverage', status: 'open', urgency: 'normal',
                created_at: nowIso, created_by: 'ongoing-sweep', owner: '', owner_name: '',
              } })
            }
          }
          if (quiet && weekly.length) {
            const monday = mondayOf(new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10))
            // deno-lint-ignore no-explicit-any
            const prev = (Array.isArray(itemRow?.data) ? itemRow!.data : []).find((i: any) => String(i?.id) === weekCardId(monday)) || null
            const card = weekCard(prev, weekly, monday, nowIso)
            quietPlan.official_week = weekCardId(monday); quietPlan.official_new = weekly.length
            if (card && live) await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: card })
          }
        }
      } catch { /* a missed suggestion costs nothing */ }
    } catch { /* the sweep must never break call-off detection */ }
  }

  /* ── OPEN SHIFTS WITH NO COVERAGE CASE (2026-10-18, the Today page map; see _shared/open-shift.ts) ── */
  const openShift: Record<string, unknown> = { live: settings.open_shift_cards_live === true && !forceDry, would: [] as Record<string, unknown>[], made: 0, closed: 0, skipped: {} as Record<string, number> }
  try {
    const now = Date.now()
    const { data: c2 } = await sb.from('app_data').select('data').eq('key', 'coverage_cases').maybeSingle()
    // deno-lint-ignore no-explicit-any
    const openCases = (Array.isArray(c2?.data) ? c2!.data : []).filter((c: any) => c?.status === 'open')
    // deno-lint-ignore no-explicit-any
    const openCaseVisits = new Set<string>(openCases.map((c: any) => String(c?.axiscare_visit_id ?? '')).filter(Boolean))
    // deno-lint-ignore no-explicit-any
    const openCaseSchedules = new Set<string>(openCases.filter((c: any) => /^cwo_s/.test(String(c?.id ?? ''))).map((c: any) => String(c.id).replace(/^cwo_s/, '')).filter(Boolean))
    for (const v of openCaseVisits) { const sc = scheduleOf(v); if (sc && openCases.some((c: { id?: unknown; axiscare_visit_id?: unknown }) => String(c.axiscare_visit_id) === v && /^cwo_/.test(String(c.id)))) openCaseSchedules.add(sc) }
    const unassignedMap = new Map<string, OpenVisit>(), assigned = new Set<string>(), startMsOf = new Map<string, number>()
    for (const v of visits) {
      const vid = String(v?.id ?? ''); if (!vid) continue
      const st = String(v?.scheduledStartDate ?? v?.startDate ?? ''), en = String(v?.scheduledEndDate ?? v?.endDate ?? '')
      const sms = visitMs(st, v?.timezone); startMsOf.set(vid, sms)
      if (v?.caregiver?.id != null) { assigned.add(vid); continue }
      unassignedMap.set(vid, { visitId: vid, start: st, end: en, startMs: sms, endMs: visitMs(en, v?.timezone), reason: String(v?.modificationReason?.name ?? '').trim(),
        client: [String(v?.client?.firstName ?? '').trim(), String(v?.client?.lastName ?? '').trim()].filter(Boolean).join(' '), clientId: v?.client?.id != null ? String(v.client.id) : null })
    }
    const { data: o2, error: oErr } = await sb.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
    if (oErr) throw new Error('the card list could not be read')
    // deno-lint-ignore no-explicit-any
    const ops: any[] = Array.isArray(o2?.data) ? o2!.data : []
    const have = new Map<string, Record<string, unknown>>(ops.filter((i: { id?: unknown }) => i && i.id).map((i: Record<string, unknown>) => [String(i.id), i]))
    const owner = (await fallbackList(sb, 'scheduling_coverage'))[0] || 'samantha@mo-care.com'
    const ctx = { now, openCaseVisits, openCaseSchedules }
    let writes = 0
    for (const v of [...unassignedMap.values()].sort((a, b) => a.startMs - b.startMs)) {
      const why = openShiftSkip(v, ctx)
      if (why) { (openShift.skipped as Record<string, number>)[why] = ((openShift.skipped as Record<string, number>)[why] || 0) + 1; continue }
      if (have.has(openShiftId(v.visitId))) continue                  // made once per visit; a card a person closed stays closed
      ;(openShift.would as Record<string, unknown>[]).push({ visit: v.visitId, client: v.client, when: v.start, reason: v.reason || '(none)' })
      if (!openShift.live || writes >= OPEN_SHIFT_PER_RUN) continue
      const item = openShiftItem(v, owner, nowIso)
      const { error } = await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item })
      if (!error) { writes++; openShift.made = (openShift.made as number) + 1; have.set(String(item.id), item)
        await opEvent(sb, { job: 'coverage-watch', verb: 'open_shift_card', item_id: String(item.id), area: 'coverage', summary: String(item.title) }) }
    }
    /* close the ones that are settled (live only; never on a failed AxisCare read) */
    for (const c of ops.filter((i: { kind?: unknown; status?: unknown; created_by?: unknown }) => i?.kind === OPEN_SHIFT_KIND && i?.status === 'open' && i?.created_by === 'coverage-watch')) {
      const why = openShiftCloseWhy(c, { ...ctx, unassigned: unassignedMap, assigned, startMsOf, fetched: !fetchError })
      if (!why || !openShift.live) continue
      const item = { ...c, status: 'done', closed_at: nowIso, closed_by: 'system', auto_closed_reason: why, last_activity_at: nowIso,
        history: [...(Array.isArray(c.history) ? c.history : []), { at: nowIso, by: 'Hub', text: 'Closed: ' + why }] }
      const { error } = await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item })
      if (!error) openShift.closed = (openShift.closed as number) + 1
    }
  } catch (e) { openShift.error = String((e as Error)?.message || e).slice(0, 200) }

  /* ── COVERED OUTSIDE THE BOARD (her observation, 2026-09-13: "it could be
     that we cover it outside the calloff board"). If an OPEN case's visit
     shows a caregiver again in AxisCare, somebody assigned it directly there.
     Close the case with that caregiver as covered_by — coverage-run's next
     closure pass then sends the courtesy texts and the family circle text
     exactly as if Confirm had been tapped on the board. Scope guard: only
     cases that are already open (a real call-off) — a plain schedule
     reassignment with no case never texts anybody.
     2026-09-27 (Elizabeth Kurtz): a caregiver on the shift is a cover ONLY when
     it is somebody other than the caregiver who called off (_shared/covered-
     outside.ts). The caller still on the schedule, or a caregiver Cara can't
     tell apart from the caller, leaves the case open with a note for a person.
     And a dry run closes nothing. */
  let coveredOutside = 0
  const outsideLeftOpen: Record<string, unknown>[] = []
  try {
    const byVisitId = new Map(visits.map(v => [String(v?.id ?? ''), v]))
    for (const cc of cases) {
      if (cc?.status !== 'open' || !cc?.axiscare_visit_id) continue
      const v = byVisitId.get(String(cc.axiscare_visit_id))
      if (!v) continue
      if (v?.caregiver?.id == null) {
        /* seen empty since the case opened: a later caregiver is a real cover */
        if (live && !cc.seen_unassigned_at) {
          cc.seen_unassigned_at = nowIso
          await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: cc })
        }
        continue
      }
      const cgName = [String(v.caregiver.firstName ?? '').trim(), String(v.caregiver.lastName ?? '').trim()]
        .filter(Boolean).join(' ') || ('caregiver ' + v.caregiver.id)
      const verdict = outsideVerdict(cc, { id: v.caregiver.id, name: cgName })
      if (verdict !== 'covered' || !live) {
        outsideLeftOpen.push({ case: cc.id, caregiver_on_shift: cgName, calling_off: cc.calling_off || null, verdict, dry: !live })
        const key = verdict + ':' + cgName
        if (live && verdict !== 'covered' && cc.outside_hold !== key) {
          cc.outside_hold = key
          cc.note = [String(cc.note || '').trim(), verdict === 'caller_still_on'
            ? `AxisCare still shows ${cgName} on this shift, the caregiver who called off, so Cara is leaving the case open. Take ${cgName.split(' ')[0]} off the shift in AxisCare, then assign whoever covers.`
            : `AxisCare shows ${cgName} on this shift, and Cara can't tell whether they are covering or are the caregiver who called off, so the case stays open. Confirm the fill on the board.`]
            .filter(Boolean).join('\n')
          await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: cc })
        }
        continue
      }
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
        `Covered in AxisCare directly (assigned to ${cgName}), closed by the watcher.`]
        .filter(Boolean).join('\n')
      const { error } = await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: cc })
      if (!error) coveredOutside++
    }
  } catch { /* never let this block the watch */ }

  /* ── PHASE 2 · LOOPS THE HUB CLOSES BY ITSELF (2026-10-05) ───────────────
     1. A case whose shift is over: AxisCare shows who clocked in → closed (covered / covered other way), with NO
        closure texts; AxisCare can't say → the case leaves the board as 'needs_outcome' and ONE card asks a person
        "Was it covered?". Before this, past cases stayed open for ever (the covered-outside check only sees today
        and the next 72 hours).
     2. Cards tied to a case (coverage_case_id) close when the case is no longer open.
     3. A case closed as uncovered gets one "call the family" card for a person (never a text).
     Nothing here sends a message. */
  // deno-lint-ignore no-explicit-any
  const loops: any = { live: loopsLive, cases_closed: [], asked: [], items_closed: 0, family_calls: [], errors: [] }
  let opsItems: any[] = []
  const domainOwnerCache: Record<string, string> = {}
  const domainOwner = async (code: string): Promise<string> => {
    if (code in domainOwnerCache) return domainOwnerCache[code]
    let e = ''
    try {
      const { data: dom } = await sb.from('domains').select('owner_person').eq('code', code).eq('entity', 'cc_ihs').maybeSingle()
      if (dom?.owner_person) {
        const { data: pp } = await sb.from('persons').select('primary_email').eq('person_id', dom.owner_person).maybeSingle()
        e = String(pp?.primary_email ?? '').toLowerCase()
      }
    } catch { e = '' }
    return (domainOwnerCache[code] = e)
  }
  try {
    const { data: oiRow } = await sb.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
    opsItems = Array.isArray(oiRow?.data) ? oiRow!.data : []
    const itemIds = new Set(opsItems.map((i: any) => String(i?.id)))
    const chiNow = chiNowNaive()
    const ended = cases.filter((cc: any) => cc?.status === 'open' && String(cc?.kind) !== 'interest' && caseEnded(cc, chiNow))
    /* AxisCare, for the dates of finished shifts in the last 14 days (older ones go straight to a person) */
    const oldest = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10)
    /* quiet: "Was it covered?" cases are looked at again until AxisCare can say (same 14 days) */
    const again = quiet ? recheckCases(cases, opsItems, oldest) : []
    const dates = [...new Set([...ended, ...again].map((cc: any) => String(cc.shift_date)).filter((d: string) => d >= oldest))].sort()
    const pastById = new Map<string, any>()
    let pastFetched = false
    if (dates.length) {
      const { token: tk, site: st } = axisCreds()
      let u: string | null = `https://${st}.axiscare.com/api/visits?startDate=${dates[0]}&endDate=${dates[dates.length - 1]}`
      try {
        for (let page = 0; u && page < 20; page++) {
          const r: Response = await fetch(u, { headers: { Authorization: `Bearer ${tk}`, Accept: 'application/json', 'X-AxisCare-Api-Version': AC_VERSION } })
          if (!r.ok) { loops.errors.push(`AxisCare ${r.status} reading past shifts`); u = null; break }
          const j: any = await r.json().catch(() => ({}))
          for (const v of (Array.isArray(j?.results?.visits) ? j.results.visits : Object.values(j?.results?.visits ?? {})))
            if (!(v as any)?.removed) pastById.set(String((v as any)?.id ?? ''), v)
          u = j?.results?.nextPage ?? j?.nextPage ?? j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
        }
        pastFetched = !loops.errors.length
      } catch (e) { loops.errors.push('AxisCare unreachable reading past shifts: ' + String(e).slice(0, 80)) }
    }
    for (const cc of ended) {
      const inRange = pastFetched && String(cc.shift_date) >= oldest
      const verdict = inRange && cc.axiscare_visit_id ? pastCaseVerdict(cc, pastById.get(String(cc.axiscare_visit_id)), outsideVerdict)
        : { how: null, why: inRange ? 'the case has no AxisCare visit' : (String(cc.shift_date) < oldest ? 'the shift is more than 14 days old' : 'AxisCare could not be read') }
      if (verdict.how) {
        loops.cases_closed.push({ case: cc.id, client: cc.client || null, how: verdict.how, why: verdict.why })
        if (!loopsLive) continue
        cc.status = 'resolved'; cc.resolved_at = nowIso; cc.resolved_how = verdict.how; cc.covered_by = verdict.covered_by
        cc.resolved_by = 'cara'; cc.closed_after_shift = true
        markNoClosureTexts(cc, nowIso, 'Closed by Cara after the shift was over, from AxisCare; no texts sent.')
        cc.note = [String(cc.note || '').trim(), `After the shift: ${verdict.why}, so Cara closed the case (${verdict.how.replace(/_/g, ' ')}). No texts were sent.`].filter(Boolean).join('\n')
        await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: cc })
      } else {
        const qid = `ops_covq_${cc.id}`
        loops.asked.push({ case: cc.id, client: cc.client || null, why: verdict.why, card: itemIds.has(qid) ? 'exists' : 'new' })
        if (!loopsLive) continue
        cc.status = 'needs_outcome'; cc.outcome_asked_at = nowIso; cc.closed_after_shift = true
        markNoClosureTexts(cc, nowIso, 'The shift was over before the case closed; no texts sent.')
        cc.note = [String(cc.note || '').trim(), `After the shift: ${verdict.why}. A person is asked whether it was covered.`].filter(Boolean).join('\n')
        await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: cc })
        if (!itemIds.has(qid)) {
          const owner = String(cc.owner || '').toLowerCase() || await domainOwner('scheduling_coverage')
          await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
            id: qid, kind: 'coverage_outcome', case_id: cc.id, status: 'open', domain: 'scheduling_coverage',
            title: `Was ${cc.client || 'the client'}'s shift covered? (${caseWhen(cc)})`, about: cc.client || '',
            detail: `The shift is over and ${verdict.why}. Tell the Hub what happened so the record and the reports are right. `
              + `If nobody covered it, the Hub asks a person to call the family; it never contacts them by itself.`,
            owner, owner_name: '', urgency: 'today', due: new Date(Date.now() + 4 * 3600000).toISOString(),
            created_at: nowIso, created_by: 'coverage-watch', opened_by: 'loops' } })
          itemIds.add(qid)
        }
      }
    }
    /* 1b. quiet: a "Was it covered?" case AxisCare can now answer closes from AxisCare, and its card with it */
    for (const cc of again) {
      if (!pastFetched) break
      const verdict = pastCaseVerdict(cc, pastById.get(String(cc.axiscare_visit_id)), outsideVerdict)
      if (!verdict.how) continue
      const qid = `ops_covq_${cc.id}`
      quietPlan.rechecked.push({ case: cc.id, client: cc.client || null, how: verdict.how, why: verdict.why })
      if (!loopsLive) continue
      cc.status = 'resolved'; cc.resolved_at = nowIso; cc.resolved_how = verdict.how; cc.covered_by = verdict.covered_by
      cc.resolved_by = 'cara'; cc.closed_after_shift = true
      cc.note = [String(cc.note || '').trim(), `Later, AxisCare showed it: ${verdict.why}, so Cara closed the case (${verdict.how.replace(/_/g, ' ')}). No texts were sent.`].filter(Boolean).join('\n')
      await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: cc })
      const card = opsItems.find((i: any) => String(i?.id) === qid)
      if (card && card.status === 'open') {
        await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { ...card, status: 'resolved', resolved_at: nowIso, resolved_how: 'axiscare_later',
          close_note: `AxisCare now shows it: ${verdict.why}. Closed by itself; nothing was sent.` } })
        card.status = 'resolved'
      }
    }
    /* 2. cards that belong to a closed case */
    const caseById = new Map(cases.map((cc: any) => [String(cc?.id), cc]))
    for (const it of itemsToCloseForCases(opsItems, caseById)) {
      const cc = caseById.get(String(it.coverage_case_id))
      loops.items_closed++
      if (!loopsLive) continue
      await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { ...it, status: 'resolved', resolved_at: nowIso,
        resolved_how: 'case_closed', close_note: `The coverage case closed (${String(cc?.resolved_how || cc?.status || '').replace(/_/g, ' ')}), so this closed with it.` } })
    }
    /* 3. uncovered: a person calls the family */
    for (const cc of cases) {
      if (!familyCallNeeded(cc, loopsSince, Date.now())) continue
      const fid = `ops_famcall_${cc.id}`
      loops.family_calls.push({ case: cc.id, client: cc.client || null, card: itemIds.has(fid) ? 'exists' : 'new' })
      if (!loopsLive || itemIds.has(fid)) continue
      const owner = String(cc.owner || '').toLowerCase() || await domainOwner('scheduling_coverage')
      /* 468: a shift closed as not covered before it happens "won't be covered"; one already past "wasn't covered" */
      const ahead = shiftAhead(cc, Date.now())
      await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
        id: fid, kind: 'family_call', case_id: cc.id, status: 'open', domain: 'scheduling_coverage',
        title: `Call ${cc.client || 'the client'}'s family: the ${caseWhen(cc)} shift ${ahead ? "won't be" : "wasn't"} covered`, about: cc.client || '',
        detail: (ahead ? 'Nobody is covering this shift.' : 'Nobody covered this shift.') + ' A person calls the family; the Hub never contacts them by itself. Record the call on this card.',
        owner, owner_name: '', urgency: 'urgent', due: new Date(Date.now() + 3600000).toISOString(),
        created_at: nowIso, created_by: 'coverage-watch', opened_by: 'loops' } })
      cc.family_call_item = fid
      await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: cc })
      itemIds.add(fid)
    }
  } catch (e) { loops.errors.push(String(e).slice(0, 160)) }

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
          : Object.values(j?.results?.visits ?? {}))) if (!(v as any)?.removed && !isNotClient(v)) dayRows.push(v)   /* 2026-10-22: never the Practice client or Office Staff (not-client list) */
        u = j?.results?.nextPage ?? j?.nextPage ?? j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
      }
      let evLogged = 0
      /* Phase 2: the day's EVV totals per caregiver (visits worked, visits with both clock-in and clock-out). The
         weekly Caregiver EVV Review is computed from these. Recorded every night, live or not: it is a count. */
      await sb.rpc('upsert_app_data_item', { target_key: 'evv_daily_stats', item: {
        id: `evvd_${chiYesterday}`, date: chiYesterday, by: evvDayStats(dayRows), at: new Date().toISOString() } })
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
            id: `att_evv_${vid}_${type}`, caregiver: cgName, axiscare_caregiver_id: String(v.caregiver.id), type,
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
      /* ── THE OVERNIGHT CHECK FOR MISSING TIMES (2026-10-17, Samantha: the office calls the client to confirm the
         times; the EVV correction form is retired). Every visit from YESTERDAY (only: CFT_MAX_DAYS_BACK, never older
         history) still missing its clock-in or clock-out, whose scheduled end is confirm_times_out_after_min (30)
         past, gets ONE "Call <client> to confirm <caregiver>'s times" card, unless it already has one (open or done,
         or an old EVV fix card) or a coverage case covers the visit. Same switch as the live cards (loops_close_live);
         off = counted only. Office work only: nobody outside the office is contacted. */
      const CFT_MAX_DAYS_BACK = 1
      const cft: Record<string, unknown> = { live: loopsLive, seen: 0, created: 0, already_had_a_card: 0, coverage_case: 0, not_ended: 0, paused_client: 0, would_create: 0, max_days_back: CFT_MAX_DAYS_BACK }
      try {
        const { data: oiC } = await sb.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
        const opsC = new Map<string, any>((Array.isArray(oiC?.data) ? oiC!.data : []).map((i: any) => [String(i?.id), i]))
        const caseVisits = new Set(cases.map((c: any) => String(c?.axiscare_visit_id ?? '')).filter(Boolean))
        const nowNaive = chiNowNaive()
        const after = outAfterMin(settings)
        const ownerC = String((Array.isArray(settings.coverage_alert_admins) && settings.coverage_alert_admins[0]) || (await fallbackList(sb, 'scheduling_coverage'))[0])   // SOP ruling 8
        for (const v of dayRows) {
          if (v?.caregiver?.id == null) continue
          const cin = v?.clockIn?.time, cout = v?.clockOut?.time
          if (cin && cout) continue
          cft.seen = Number(cft.seen) + 1
          const vid = String(v?.id ?? ''); if (!vid) continue
          const start = String(v?.scheduledStartDate ?? v?.startDate ?? ''), end = String(v?.scheduledEndDate ?? v?.endDate ?? '')
          if (start.slice(0, 10) !== chiYesterday) continue                      // yesterday only
          if (isQuiet(v)) { cft.paused_client = Number(cft.paused_client) + 1; continue }
          const endMs = Date.parse(end.slice(0, 16) + ':00Z'), nowMs = Date.parse(nowNaive.slice(0, 16) + ':00Z')
          if (!Number.isFinite(endMs) || nowMs - endMs < after * 60000) { cft.not_ended = Number(cft.not_ended) + 1; continue }   // an overnight shift still going
          if (hasCard(opsC, vid)) { cft.already_had_a_card = Number(cft.already_had_a_card) + 1; continue }
          if (caseVisits.has(vid)) { cft.coverage_case = Number(cft.coverage_case) + 1; continue }
          const cgName = [String(v?.caregiver?.firstName ?? '').trim(), String(v?.caregiver?.lastName ?? '').trim()].filter(Boolean).join(' ') || ('caregiver ' + v.caregiver.id)
          const hm = (c: any) => { const t = String(c?.time ?? ''); if (!t) return null
            if (!/Z$|[+-]\d{2}:?\d{2}$/.test(t)) return t.slice(11, 16) || null
            const d = new Date(t); return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(d) : null }
          const item = confirmTimesItem({ visit_id: vid, caregiver: cgName, caregiver_axiscare_id: String(v.caregiver.id),
            client_first: String(v?.client?.firstName ?? '').trim() || 'the client', client_name: [v?.client?.firstName, v?.client?.lastName].filter(Boolean).join(' ') || null,
            client_axiscare_id: v?.client?.id != null ? String(v.client.id) : null, shift_date: chiYesterday,
            start: start.slice(11, 16), end: end.slice(11, 16), clock_in: hm(v?.clockIn), clock_out: hm(v?.clockOut),
            missing: !cin && !cout ? 'both' : !cin ? 'in' : 'out' },
            { owner: ownerC, now: new Date().toISOString(), source: 'coverage-watch (overnight check)' })
          if (!loopsLive) { cft.would_create = Number(cft.would_create) + 1; continue }
          const { error } = await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item })
          if (!error) { opsC.set(item.id, item); cft.created = Number(cft.created) + 1 }
          else cft.error = String(error.message ?? error).slice(0, 160)
        }
      } catch (e) { cft.error = String(e).slice(0, 160) }
      ;(globalThis as any).__cftOvernight = cft
      /* Rolling 30-day threshold alarms → one item per caregiver/type/month. */
      const { data: aeRow } = await sb.from('app_data').select('data').eq('key', 'attendance_events').maybeSingle()
      const events: any[] = Array.isArray(aeRow?.data) ? aeRow!.data : []
      const cutoff = Date.now() - 30 * 864e5
      /* Grouped per person (step 4, 2026-10-14): an event with the AxisCare caregiver id groups by
         that id; an event with no id groups by its typed name, as before. A name-only group joins an
         id group only when exactly one id group carries that same name, so the transition (old
         events without ids, new ones with) still adds up, and a record with an id never counts
         toward a different person who shares the name. */
      const cgIdOf = (e: any) => String(e?.axiscare_caregiver_id ?? '').trim()
      const normNm = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
      /* Each id's name is the one most of its events carry, so one mistyped name on an id record
         never pulls another person's name-only records in. */
      const namesById = new Map<string, Map<string, number>>()
      for (const e of events) {
        const id = cgIdOf(e); if (!id) continue
        const nm = String(e?.caregiver || '').trim(); if (!nm) continue
        const m = namesById.get(id) ?? new Map<string, number>(); m.set(nm, (m.get(nm) ?? 0) + 1); namesById.set(id, m)
      }
      const nameById = new Map<string, string>()
      const idsByName = new Map<string, Set<string>>()
      for (const [id, m] of namesById) {
        const nm = [...m.entries()].sort((a, b) => b[1] - a[1])[0][0]
        nameById.set(id, nm)
        const s = idsByName.get(normNm(nm)) ?? new Set<string>(); s.add(id); idsByName.set(normNm(nm), s)
      }
      const groupOf = (e: any) => {
        const id = cgIdOf(e); if (id) return 'ax:' + id
        const one = idsByName.get(normNm(String(e?.caregiver || '')))
        return one && one.size === 1 && normNm(String(e?.caregiver || '')) ? 'ax:' + [...one][0] : 'nm:' + String(e?.caregiver || '?')
      }
      const counts = new Map<string, number>()
      for (const e of events) {
        const t = new Date(String(e.shift_date || e.created_at || 0) + 'T12:00:00').getTime()
        if (!Number.isFinite(t) || t < cutoff) continue
        const bucket = e.type === 'callin' ? 'callin'
          : e.type === 'tardy' ? 'tardy'
          : (e.type === 'evv_missing_in' || e.type === 'evv_missing_out') ? 'evv' : null
        if (!bucket) continue
        const k = groupOf(e) + '|' + bucket
        counts.set(k, (counts.get(k) ?? 0) + 1)
      }
      /* The card shows the person's name and keeps the name-based card id it always had, so a card
         already open is found again. Only when two different ids share a name does the id get added. */
      const whoOf = (g: string) => g.startsWith('ax:') ? (nameById.get(g.slice(3)) || ('caregiver ' + g.slice(3))) : g.slice(3)
      const slugClash = (g: string) => g.startsWith('ax:') && (idsByName.get(normNm(whoOf(g)))?.size ?? 0) > 1
      const TH: Record<string, number> = {
        callin: Number(settings.att_alert_callins) > 0 ? Number(settings.att_alert_callins) : 3,
        tardy: Number(settings.att_alert_tardies) > 0 ? Number(settings.att_alert_tardies) : 3,
        evv: Number(settings.att_alert_evv) > 0 ? Number(settings.att_alert_evv) : 3,
      }
      const LABEL: Record<string, string> = {
        callin: 'call-ins', tardy: 'tardies', evv: 'EVV problems (missing clock-in/out)' }
      const admins = (Array.isArray(settings.coverage_alert_admins) && settings.coverage_alert_admins.length)
        ? settings.coverage_alert_admins : await fallbackList(sb, 'scheduling_coverage')   // SOP ruling 8 (2026-10-17)
      const ym = chiYesterday.slice(0, 7).replace('-', '')
      /* Phase 2 (live): no nightly EVV cards (they become the weekly review below), and a call-in / tardy card keeps
         a person's handling: an open card keeps its owner and history; a closed one reopens only if the count rose. */
      const { data: oiNow } = await sb.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
      const itemsNow: any[] = Array.isArray(oiNow?.data) ? oiNow!.data : []
      const byIdNow = new Map(itemsNow.map((i: any) => [String(i?.id), i]))
      const attPlan: Record<string, unknown> = { evv_cards_closed: 0, kept_closed: 0 }
      if (loopsLive) {
        for (const it of itemsNow) {
          if (!it || it.status !== 'open' || !/^ops_att_evv_/.test(String(it.id))) continue
          await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { ...it, status: 'resolved', resolved_at: new Date().toISOString(),
            resolved_how: 'replaced_by_weekly_review', close_note: 'Replaced by the weekly Caregiver EVV Review.' } })
          ;(attPlan.evv_cards_closed as number)++
        }
      } else attPlan.evv_cards_would_close = itemsNow.filter((i: any) => i?.status === 'open' && /^ops_att_evv_/.test(String(i?.id))).length
      for (const [k, n] of counts) {
        const cut = k.lastIndexOf('|')
        const grp = k.slice(0, cut), bucket = k.slice(cut + 1)
        const who = whoOf(grp)
        if (n < TH[bucket]) continue
        if (loopsLive && bucket === 'evv') continue
        const attId = `ops_att_${bucket}_${who.toLowerCase().replace(/[^a-z0-9]/g, '')}${slugClash(grp) ? '_' + grp.slice(3).replace(/[^A-Za-z0-9]/g, '') : ''}_${ym}`
        const attFresh = {
          id: attId,
          kind: 'staffing_issue',
          title: `Attendance pattern: ${who}: ${n} ${LABEL[bucket]} in 30 days`,
          about: who,
          detail: `${who} has ${n} ${LABEL[bucket]} in the last 30 days (threshold ${TH[bucket]}). Review on Performance > Attendance. The write-up ladder there has the details and next step.`,
          domain: 'scheduling_coverage', status: 'open', urgency: 'high',
          owner: String(admins[0]), owner_name: String(admins[0]).split('@')[0],
          created_at: new Date().toISOString(),
          due: new Date(Date.now() + 2 * 864e5).toISOString(),
          created_by: 'attendance-watch', opened_by: 'attendance-threshold',
        }
        const attItem = loopsLive ? attendanceCard(byIdNow.get(attId), attFresh, n) : attFresh
        if (!attItem) { (attPlan.kept_closed as number)++; continue }
        await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: attItem })
      }
      ;(globalThis as any).__attPlan = attPlan
      state.last_date = chiYesterday
      await sb.rpc('upsert_app_data_item', { target_key: 'attendance_watch_state', item: state })
      ;(globalThis as any).__attSwept = { day: chiYesterday, events_logged: evLogged }
    }
  } catch (err) { (globalThis as any).__attSwept = { error: String(err) } }

  /* ── PHASE 2 · THE WEEKLY CAREGIVER EVV REVIEW (her decision, 2026-10-05) ──
     One card a week instead of nightly EVV cards: caregivers whose visits last week (Mon-Sun) had a complete EVV
     (clock-in AND clock-out) less than the expectation (ops_settings.evv_expectation_pct, 90 unless set), owned by
     whoever owns caregiver performance (domains), so the role decides, not a name. Made on the first run after Sunday
     ends; ?evv_review=1 shows it on demand (written only when live). No card when nobody is under. */
  try {
    const chiToday = new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
    const isMonday = new Date(chiToday + 'T12:00:00Z').getUTCDay() === 1
    const force = new URL(req.url).searchParams.get('evv_review') === '1'
    if ((isMonday || force) && quiet) (globalThis as any).__evvReview = { card: 'not made: EVV is retired (quieter cards on)' }
    else if (isMonday || force) {
      const lastSunday = (() => { const d = new Date(chiToday + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 7) % 7 || 7)); return d.toISOString().slice(0, 10) })()
      const wk = weekOf(lastSunday)
      const rid = `ops_evvrev_${wk.start}`
      const { data: oiR } = await sb.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
      const have = (Array.isArray(oiR?.data) ? oiR!.data : []).some((i: any) => String(i?.id) === rid)
      const { data: stR } = await sb.from('app_data').select('data').eq('key', 'evv_daily_stats').maybeSingle()
      const days = (Array.isArray(stR?.data) ? stR!.data : []).filter((d: any) => wk.dates.includes(String(d?.date)))
      const pct = Number(settings.evv_expectation_pct) > 0 ? Number(settings.evv_expectation_pct) : 90
      const r = evvWeek(days, pct)
      const owner = await domainOwner('caregiver_performance')
      const md = (x: string) => new Date(x + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' })
      const plan: Record<string, unknown> = { week: `${wk.start} → ${wk.end}`, days_with_data: r.days, caregivers_checked: r.checked,
        below: r.below.map((b) => `${b.name}: ${b.complete} of ${b.visits} (${b.pct}%)`), owner: owner || '(caregiver performance has no owner set)',
        card: have ? 'already made' : (r.days && r.below.length ? (loopsLive ? 'made' : 'would make') : 'none needed') }
      if (loopsLive && !have && r.days && r.below.length) {
        await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
          id: rid, kind: 'evv_review', domain: 'caregiver_performance', status: 'open', urgency: 'normal',
          title: `Caregiver EVV Review, week of ${md(wk.start)}: ${r.below.length} below ${pct}%`,
          about: `${r.below.length} caregiver${r.below.length === 1 ? '' : 's'}`,
          detail: `Visits last week (${md(wk.start)} to ${md(wk.end)}) with a complete EVV (clock-in and clock-out), for caregivers under our ${pct}% expectation:\n`
            + r.below.map((b) => `• ${b.name}: ${b.complete} of ${b.visits} visits (${b.pct}%)`).join('\n')
            + (r.days < 7 ? `\n(Based on ${r.days} of 7 days; the daily counts started recently.)` : '')
            + `\n\nReview each on Performance › Attendance and decide the next step. This replaces the nightly EVV cards.`,
          below: r.below, week_start: wk.start, expectation_pct: pct,
          owner, owner_name: '', due: new Date(Date.now() + 2 * 864e5).toISOString(),
          created_at: new Date().toISOString(), created_by: 'coverage-watch', opened_by: 'loops' } })
      }
      ;(globalThis as any).__evvReview = plan
    }
  } catch (err) { (globalThis as any).__evvReview = { error: String(err).slice(0, 160) } }

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
    /* 2026-09-29 (her call): OFF. This guessed at a rated notes field AxisCare doesn't have, so it never matched a
       note. The care-notes function (N2) reads the real careNote every two hours and flags concerns. Only runs again
       if the LEGACY_NOTE_SWEEP secret is set to 'on'. */
    const legacyNotes = Deno.env.get('LEGACY_NOTE_SWEEP') === 'on'
    if (!legacyNotes) (globalThis as any).__noteSwept = 'off (replaced by care-notes, 2026-09-29)'
    if (legacyNotes && (ns.last_hour !== hourStamp || forceNotes)) {
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
        shape: shape || 'NONE FOUND: no note fields on visits and no per-visit note endpoint answered; tell Claude what the capability map should say' }
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
    covered_outside_left_open: outsideLeftOpen,
    would_open: wouldOpen,
    ongoing_sweep: sweepDue
      ? { ran: true, schedules_with_open_dates: ongoingSchedules,
          cases_created: ongoingCreated, would_open: wouldOpenOngoing }
      : { ran: false, note: 'runs on the first tick of each Chicago hour, or with ?sweep=1' },
    reason_filter: configuredReasons.length
      ? { mode: 'exact names from ops_settings.coverage_watch_reasons', names: configuredReasons }
      : { mode: 'default pattern', pattern: String(DEFAULT_REASON_RX) },
    /* Every reason name seen on unassigned upcoming visits, so the exact
       trigger names can be chosen from reality instead of guessed. */
    reason_names_seen_on_unassigned: Object.fromEntries(reasonNamesSeen),
    unassigned_detail: unassignedDetail,
    time_check: { fix_live: reopenLive, sample_start: sampleStart || null,
      has_offset: sampleStart ? /Z$|[+-]\d{2}:?\d{2}$/.test(sampleStart) : null, differs: [...timeDiffers.values()] },
    held_checks: { reopen_live: reopenLive, checked: heldChecks.length, reopened, people_asked: heldAsked, shifts: heldChecks },
    attendance_sweep: (globalThis as any).__attSwept ?? 'already done for yesterday',
    attendance_cards: (globalThis as any).__attPlan ?? null,
    confirm_times_overnight: (globalThis as any).__cftOvernight ?? 'with the attendance sweep, once a night',
    evv_review: (globalThis as any).__evvReview ?? (quiet ? 'not made: EVV is retired (quieter cards on)' : 'made on Mondays (or ?evv_review=1)'),
    quieter_cards: quietPlan,
    loops,
    open_shift_cards: openShift,
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
    const acted = created > 0 || coveredOutside > 0 || heldAsked > 0 || !!fetchError
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
