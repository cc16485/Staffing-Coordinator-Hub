// Supabase Edge Function: timekeeper-watch  (shared hub project)
// -----------------------------------------------------------------------------
// Cara's Timekeeper (Samantha, 2026-09-15, benchmarked on phoebe.work): "text
// the caregiver if they haven't clocked in and it's 3 minutes past their
// clock-in time, then if we don't hear back call them, then alert the office."
//
// The ladder, per assigned visit whose start has passed with no clock-in:
//   T+grace (default 3 min)          Cara texts the caregiver: clock in now,
//                                    or reply/call if something's wrong.
//   T+grace+office_after (default 7) still no clock-in: URGENT ops item to the
//                                    Operations Inbox + SMS to the office
//                                    alert phones, with the caregiver's number
//                                    ready to tap. A person makes the call —
//                                    an unreachable caregiver at a client's
//                                    door is exactly the human moment.
//                                    (timekeeper_call_live is RESERVED for a
//                                    later Cara voice call between these two
//                                    steps; not implemented on purpose.)
//   clock-in appears at any step     the ladder resolves itself silently and
//                                    closes its ops item. Nobody gets chased
//                                    for a shift they are already working.
//   caregiver removed / visit gone   resolved as visit_changed, no text ever.
//
// CLOCK-OUT side (phoebe.work parity, "matching their updates" 2026-09-15):
// a visit whose end passed by timekeeper_clockout_grace_min (default 10) with
// a clock-IN but no clock-OUT gets ONE reminder text. No office ladder — the
// client was served; only payroll and EVV are at stake. 2026-10-17: still no
// clock-out confirm_times_out_after_min (30) after the end = ONE office card,
// "Call <client> to confirm <caregiver>'s departure time" (PASS 3b).
//
// SKIP LIST (their Feb 27 update): ops_settings.cara_skip is an array of
// { caregiver, client, scope } entries, names matched case-insensitively
// (caregiver = full name, client = first name; leave one blank to match all).
// scope: 'clock' (this function), 'confirm' (shift-confirm), or 'all'
// (default). For the caregiver who always forgets and the office knows why,
// or the client whose visits are recorded another way.
//
// The GROUND TRUTH for escalation is the clock-in appearing in AxisCare, not
// the reply: "I'm here" without a clock-in still leaves EVV dirty, so the
// ladder keeps watching until the schedule itself says the shift is covered.
// Replies land in the GHL inbox (contacts are tagged `timekeeper-asked` so a
// reply workflow can route them onto the hub later, same as coverage-asked).
//
// WHY THE DRY RUN MATTERS DOUBLY HERE: First-Visit Confirmation is parked on
// "clockIn proven to populate". This function's dry run IS that proof: it
// reports, for visits started >15 minutes ago today, how many carry
// clockIn.time and how many do not. If clock-ins post to the API slowly, the
// grace minutes must grow before texting goes live, or Cara nags people who
// are already working — the fastest way to burn caregiver goodwill.
//
// NAIVE-TIMESTAMP TRAP: AxisCare visit times come back as zone-naive local
// strings ("2026-09-15T10:00:00"). Date.parse reads those in the SERVER's
// zone (UTC on Supabase), so comparing against Date.now() skews by 5-6 hours
// — survivable for coverage-watch's day-level checks, fatal for a 3-minute
// trigger. Minutes-late is therefore computed naive-to-naive: both the visit
// start and "now" are parsed in the same frame, so the skew cancels. A
// timestamp that DOES carry a zone is compared against real now instead.
//
// ⚠ STAGED SWITCHES, same discipline as coverage (ops_settings):
//   timekeeper_watch_live === true   open ladders, escalate to the office
//   timekeeper_text_live  === true   additionally text caregivers (needs
//                                    watch_live too; refused otherwise)
//   neither set / ?dry=1             DRY RUN: report what would happen,
//                                    write nothing, text nobody
// Other settings: timekeeper_grace_min (3), timekeeper_office_after_min (7),
// timekeeper_clockout_grace_min (10), timekeeper_msg / timekeeper_msg_out
// (templates: {first_name} {client} {time}), timekeeper_alert_phones (array
// of office phones for the escalation SMS), cara_skip (see above),
// coverage_alert_admins (reused for the ops item owner).
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/* "17:00" → "5pm", minutes kept only when they matter — the same 12-hour
   rule every other Cara text follows. Non-HH:MM passes through untouched. */
const clock12 = (t: string): string => {
  const m = String(t || '').trim().match(/^(\d{1,2}):(\d\d)$/)
  if (!m) return String(t || '').trim()
  const h24 = Number(m[1]); const h = h24 % 12 || 12
  return `${h}${m[2] === '00' ? '' : ':' + m[2]}${h24 >= 12 ? 'pm' : 'am'}`
}
import { normalisePhone, contactForOutbound } from '../_shared/outreach.ts'
import { jobCaller } from '../_shared/job-auth.ts'
import { shadowRoute } from '../_shared/routing.ts'
import { opEvent } from '../_shared/events.ts'
import { adminRecipients, textAdmin } from '../_shared/clockin-admins.ts'
import { fallbackList } from '../_shared/notice-to.ts'
import { makeLink, adminKey, linkExpiry } from '../_shared/clockin-links.ts'
import { lateHold, liveNotices, holdOptsOf, holdUntil, callLine } from '../_shared/late-notice.ts'
import { visitMs } from '../_shared/held-shift.ts'
import { ghlSendChecked } from '../_shared/send-problems.ts'
import { tkShiftEnded } from '../_shared/loops.ts'
import { ladder, onDuty } from '../_shared/duty.ts'
import { officeQuiet, quietWords, afterHoursAllowed } from '../_shared/quiet-hours.ts'
import { confirmTimesItem, cftId, hasCard, outAfterMin } from '../_shared/confirm-times.ts'
import { loadQuiet, isQuiet } from '../_shared/client-quiet.ts'
import { isPlaceholder } from '../_shared/visit-reasons.ts'
import { SECOND_TEXT, fillText, secondTextDue, atRisk, live as p3live, fixedInAxis, noteDraft } from '../_shared/clockin-v2.ts'   // Cara Phase 3
import { readPlan, isMustCover, type PlanRead } from '../_shared/callin-plan.ts'
import { ghlStoredContactIfAllowed } from '../_shared/optout.ts'
import { axisReader } from '../_shared/axis-reader.ts'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
/* A (2026-10-29): every AxisCare read goes through the shared reader (live: copies at most 60 s old) */
const axFetch = axisReader(sb, { job: 'timekeeper-watch', tier: 'live' })
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 2), { status: s, headers: { 'Content-Type': 'application/json' } })

const AC_VERSION = Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01'
const STALE_MIN = 150   // never open a ladder for a start older than this — a
                        // watcher that was off all morning must not text at
                        // noon about a 7am shift; the nightly attendance sweep
                        // owns history.

function axisCreds() {
  const order = ['AXISCARE_VISITS_TOKEN', 'AXISCARE_API_KEY', 'AXISCARE_TOKEN']
  let token = ''
  for (const n of order) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site: /^\d+$/.test(site) ? site : '' }
}

/* Chicago wall clock as a naive ISO-ish string, comparable with AxisCare's
   naive visit timestamps in the same frame. */
const chiWallIso = () =>
  new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).replace(' ', 'T')
const chiToday = () => chiWallIso().slice(0, 10)

const hasZone = (s: string) => /Z$|[+-]\d{2}:?\d{2}$/.test(s)
/** Minutes since `stamp`, zone-skew-safe (see header). NaN when unparseable. */
function minutesSince(stamp: string): number {
  const t = Date.parse(stamp)
  if (!Number.isFinite(t)) return NaN
  const now = hasZone(stamp) ? Date.now() : Date.parse(chiWallIso())
  return (now - t) / 60000
}

const nameKeyOf = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')

/* The skip list. An entry with neither name is ignored rather than allowed to
   match everyone — a half-typed row must never silence the whole watcher. */
// deno-lint-ignore no-explicit-any
function skipMatch(skips: any[], scope: string, caregiverName: string, clientFirst: string): boolean {
  const cgk = nameKeyOf(caregiverName), clk = nameKeyOf(clientFirst)
  for (const s of skips) {
    const sc = String(s?.scope ?? 'all').toLowerCase()
    if (sc !== 'all' && sc !== scope) continue
    const wantCg = nameKeyOf(String(s?.caregiver ?? ''))
    const wantCl = nameKeyOf(String(s?.client ?? ''))
    if (!wantCg && !wantCl) continue
    if (wantCg && wantCg !== cgk) continue
    if (wantCl && wantCl !== clk) continue
    return true
  }
  return false
}
// deno-lint-ignore no-explicit-any
const rowsOf = (v: any): any[] => Array.isArray(v) ? v
  : (v && typeof v === 'object') ? Object.values(v) : []

/* AxisCare clockIn/clockOut are records {time, method, ...}; reading the record
   as text showed "ect]" instead of a time. HH:MM on the office clock; a bare
   string is still accepted. */
function clockHM(c: unknown): string | null {
  // deno-lint-ignore no-explicit-any
  const t = c && typeof c === 'object' ? String((c as any).time ?? '') : (typeof c === 'string' ? c : '')
  if (!t) return null
  if (!/Z$|[+-]\d{2}:?\d{2}$/.test(t)) return t.slice(11, 16) || null
  const d = new Date(t)
  return Number.isFinite(d.getTime())
    ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(d)
    : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 })
  /* J1 (2026-09-29): only its every-2-minutes schedule or the owner's server key. Everyone else, the public key included, is refused
     before anything is read or sent. */
  const caller = await jobCaller(req)
  if (!caller) return json({ error: 'not allowed' }, 401)
  if (new URL(req.url).searchParams.get('auth_check') === '1') return json({ ok: true, caller })
  /* J1: read only after the caller is known (2026-10-12; it used to run first, so a refused call still read the list) */
  await loadQuiet(sb)   // Pause care / End care: paused and ended clients' visits are skipped
  const t0 = Date.now()
  /* The full would-text lists only for the owner's server key (a practice run from a Desktop script); the schedule
     gets counts. The role is no longer read from the token itself. */
  const role = caller === 'owner' ? 'service_role' : 'schedule'

  const { data: setRow } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const settings: any = setRow?.data ?? {}
  const forceDry = new URL(req.url).searchParams.get('dry') === '1'
  const watchLive = settings.timekeeper_watch_live === true && !forceDry
  /* Today cockpit Phase 2 (2026-10-05): a missed clock-in whose shift has ended becomes ONE office item and the admin
     texts stop. Off until ops_settings.loops_close_live; while off, the summary lists what would change.
     2026-10-17 (Samantha): that item is now "Call <client> to confirm <caregiver>'s times" (_shared/confirm-times.ts),
     not "EVV fix needed": the EVV correction form is retired and the office confirms the times with the client by phone.
     A missed clock-OUT gets the same card confirm_times_out_after_min (30) after the scheduled end (PASS 3b). */
  const loopsLive = settings.loops_close_live === true && !forceDry
  const cftLive = loopsLive && watchLive
  const cftFromIn: Record<string, unknown>[] = [], cftFromOut: Record<string, unknown>[] = []
  let cftAlready = 0
  const cftOutAfter = outAfterMin(settings)
  const textLive = watchLive && settings.timekeeper_text_live === true
  /* C1 (Samantha, 2026-09-29): the caregiver's short text and the admin alerts both at 5 minutes past the start. */
  const graceMin = Number(settings.timekeeper_grace_min) > 0 ? Number(settings.timekeeper_grace_min) : 5
  /* The admin alert repeats every timekeeper_admin_repeat_min (5) until an admin marks it resolved, the caregiver
     clocks in, or a coverage case covers the shift; every 30 minutes once the shift's scheduled end has passed.
     timekeeper_admin_loop_live === true sends the texts; otherwise it is a practice run that records, on each
     missed clock-in, exactly which texts WOULD have gone and when (the Hub shows them), and sends nothing. */
  const repeatMin = Number(settings.timekeeper_admin_repeat_min) > 0 ? Number(settings.timekeeper_admin_repeat_min) : 5
  const loopLive = watchLive && settings.timekeeper_admin_loop_live === true
  /* OFFICE QUIET HOURS (Samantha, 2026-10-03, after this loop texted coordinators at 3am): no admin or office text
     from 8pm to 7am Central (quiet-hours.ts; ops_settings.office_quiet_start/end). Overnight the NO CLOCK-IN item still
     opens in Needs Attention; the loop skips its rounds (nothing is queued) and, from 7am, sends ONE text per admin if
     the alert is still open, then carries on as normal. A practice run follows the same hours. */
  const quietNow = officeQuiet(new Date(), settings)
  const quietTxt = quietWords(settings)
  /* AFTER HOURS (Samantha, 2026-10-03, Desktop 426: "i want the missed clock ins to be live after hours too"): the
     missed clock-in admin loop (first text, repeats, closers) keeps going at night unless she switches
     ops_settings.missed_clockin_after_hours off in the Hub. The 6-texts cap still applies. loopQuiet is the loop's own
     quiet. */
  const tkAfterHours = afterHoursAllowed(settings, 'missed_clockin')
  const loopQuiet = quietNow && !tkAfterHours
  /* SAFETY CAP (2026-10-03): at most timekeeper_admin_max_texts (6) reminder texts per alert to each admin. The last
     one says so; the alert stays open in Needs Attention. The final "clocked in / no more reminders" text is not
     counted, and only goes to an admin who was texted about it. */
  const maxTexts = Number(settings.timekeeper_admin_max_texts) > 0 ? Math.floor(Number(settings.timekeeper_admin_max_texts)) : 6
  const outGraceMin = Number(settings.timekeeper_clockout_grace_min) > 0
    ? Number(settings.timekeeper_clockout_grace_min) : 10
  // deno-lint-ignore no-explicit-any
  const skips: any[] = Array.isArray(settings.cara_skip) ? settings.cara_skip : []
  /* CARA PHASE 3 (2026-10-24, _shared/clockin-v2.ts): each step its own switch, all off. Off: p3.would says what it would do. */
  const noReplyLive = p3live(settings, 'clockin_no_reply_live') && watchLive
  const atRiskLive = p3live(settings, 'clockin_at_risk_live') && watchLive
  const cftAutoLive = p3live(settings, 'cft_autoclose_live') && watchLive
  // deno-lint-ignore no-explicit-any
  const p3: any = { no_reply_live: noReplyLive, at_risk_live: atRiskLive, cft_autoclose_live: cftAutoLive, would: [] as Record<string, unknown>[], did: [] as Record<string, unknown>[] }
  const p3note = (isLive: boolean, row: Record<string, unknown>) => { const arr = isLive ? p3.did : p3.would; if (arr.length < 60) arr.push(row) }
  const planCache = new Map<string, PlanRead>()

  const { token, site } = axisCreds()
  if (!token || !site) return json({ error: 'AxisCare credentials not set on this project' }, 502)
  const ghl = { token: Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || '',
                locationId: Deno.env.get('GHL_LOCATION_ID') || '' }

  // ── Today's visits (one page walk, same shape defenses as coverage-watch). ──
  const day = chiToday()
  // deno-lint-ignore no-explicit-any
  const visits: any[] = []
  let fetchError: string | null = null
  try {
    let url: string | null = `https://${site}.axiscare.com/api/visits?startDate=${day}&endDate=${day}`
    for (let page = 0; url && page < 12; page++) {
      const r: Response = await axFetch(url, { headers: {
        Authorization: `Bearer ${token}`, Accept: 'application/json',
        'X-AxisCare-Api-Version': AC_VERSION } })
      if (!r.ok) { fetchError = `AxisCare responded ${r.status}`; break }
      // deno-lint-ignore no-explicit-any
      const j: any = await r.json().catch(() => ({}))
      /* 2026-10-24: the "Canceled Shift" placeholder is nobody: its visits are cancelled, never a missed clock-in */
      for (const v of rowsOf(j?.results?.visits ?? j?.visits)) if (!v?.removed && !isQuiet(v) && !isPlaceholder(v?.caregiver)) visits.push(v)
      url = j?.results?.nextPage ?? j?.nextPage ?? j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
    }
  } catch (err) { fetchError = String(err) }
  if (fetchError && !visits.length) return json({ error: fetchError }, 502)

  // ── CLOCK-IN POPULATION EVIDENCE (the First-Visit Confirmation blocker). ──
  let startedAWhile = 0, withClockIn = 0
  for (const v of visits) {
    if (v?.caregiver?.id == null) continue
    const start = String(v?.scheduledStartDate ?? v?.startDate ?? '')
    const m = minutesSince(start)
    if (!Number.isFinite(m) || m < 15) continue
    startedAWhile++
    if (v?.clockIn?.time) withClockIn++
  }

  // ── Roster, for the phone the text goes to. Match by axiscare_id, then name. ──
  const { data: cgRow } = await sb.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const roster = (Array.isArray(cgRow?.data) ? cgRow!.data : []) as any[]
  // deno-lint-ignore no-explicit-any
  const byAxis = new Map<string, any>(), byName = new Map<string, any>()
  for (const cg of roster) {
    if (cg?.active === false) continue
    const nm = [String(cg.first ?? '').trim(), String(cg.last ?? '').trim()].filter(Boolean).join(' ')
    if (String(cg.axiscare_id ?? '').trim()) byAxis.set(String(cg.axiscare_id).trim(), cg)
    if (nm) byName.set(nameKeyOf(nm), cg)
  }

  // ── Open ladders. One per visit, ever: deterministic id. ──
  const { data: tkRow } = await sb.from('app_data').select('data').eq('key', 'timekeeper_cases').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const ladders: any[] = Array.isArray(tkRow?.data) ? tkRow!.data : []
  const ladderByVisit = new Map(ladders.map(l => [String(l?.visit_id ?? ''), l]))
  const byVisitId = new Map(visits.map(v => [String(v?.id ?? ''), v]))
  const nowIso = new Date().toISOString()
  /* every card already made, open or done: a visit gets ONE confirm-times card, ever */
  const { data: opsRowC } = await sb.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const opsByIdC = new Map<string, any>((Array.isArray(opsRowC?.data) ? opsRowC!.data : []).map((x: any) => [String(x?.id), x]))
  const admins = (Array.isArray(settings.coverage_alert_admins) && settings.coverage_alert_admins.length)
    ? settings.coverage_alert_admins : await fallbackList(sb, 'scheduling_coverage')   // SOP ruling 8 (2026-10-17)
  const adminList = await adminRecipients(sb, settings)
  /* Today cockpit Phase 3 (2026-10-05): with ops_settings.routing_live, the missed clock-in texts go to whoever holds
     the STAFFING seat now (the duty schedule), then up the team ladder while nobody has taken it (2026-10-17: In charge
     at 10 minutes, Leadership at 20, the leadership backup at 35), daytime only. Nobody on Staffing with a phone on file = everyone on the list, as before
     (never silent). Off = the whole admin list, exactly as before. */
  const routingLive = settings.routing_live === true && !forceDry
  // deno-lint-ignore no-explicit-any
  let recipientsFor = (_l: any) => adminList
  // deno-lint-ignore no-explicit-any
  const routeInfo: Record<string, any> = { live: routingLive }
  if (routingLive) {
    const rd = async (k: string) => { const { data } = await sb.from('app_data').select('data').eq('key', k).maybeSingle(); return Array.isArray(data?.data) ? data!.data : [] }
    const [dw, pos, cs, oi] = await Promise.all([rd('duty_windows'), rd('positions'), rd('coordinator_staff'), rd('ops_items')])
    const seats = onDuty(dw, settings, new Date(), pos, admins[0])   // nobody scheduled: the list above, never a name in code
    const L = ladder(settings)
    // deno-lint-ignore no-explicit-any
    const adminFor = (email: string) => { const p = cs.find((x: any) => String(x?.email || '').trim().toLowerCase() === email)
      const name = String(p?.name || email.split('@')[0]); return { email, name, first: name.split(/\s+/)[0], phone: normalisePhone(p?.phone) || null } }
    // deno-lint-ignore no-explicit-any
    const opsById = new Map(oi.map((x: any) => [String(x?.id), x]))
    const onStaffing = seats.staffing.person ? adminFor(seats.staffing.person) : null
    routeInfo.staffing = onStaffing ? { first: onStaffing.first, has_phone: !!onStaffing.phone, from: seats.staffing.source } : null
    routeInfo.in_charge_first = seats.in_charge.person ? adminFor(seats.in_charge.person).first : null
    routeInfo.escalation_first = seats.escalation.person ? adminFor(seats.escalation.person).first : null
    routeInfo.ladder = L
    // deno-lint-ignore no-explicit-any
    recipientsFor = (l: any) => {
      if (!onStaffing?.phone) return adminList
      const list = [onStaffing]
      const it = opsById.get(`ops_tk_${l.id}`)
      const mins = (Date.now() - Date.parse(String(l.office_alerted_at || nowIso))) / 60000
      /* The team ladder (Samantha approved 2026-10-17): In charge after 10 minutes nobody took it, Leadership after 20,
         the leadership backup (Zach) after 35. Daytime only, as before. Nobody twice, nobody without a phone. */
      if (!it?.claimed_by && !quietNow) {
        const add = (e: string) => { if (!e || list.some((a) => a.email === e)) return; const a = adminFor(e); if (a.phone) list.push(a) }
        if (mins >= L.in_charge) add(seats.in_charge.person)
        if (mins >= L.leadership) add(seats.escalation.person)
        if (mins >= L.backup) add(seats.backup.person)
      }
      return list
    }
  }
  const LINK_SECRET = Deno.env.get('HUB_JOB_SECRET') || ''
  /* An open coverage case for this shift means someone already knows (she called off, or the office opened one):
     no "we don't see a clock-in" text and no admin alarm for it. Matched by the AxisCare visit, or by client + date
     + the caregiver who called off. */
  const { data: ccRow } = await sb.from('app_data').select('data').eq('key', 'coverage_cases').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const openCases = (Array.isArray(ccRow?.data) ? ccRow!.data : []).filter((c: any) => c?.status === 'open' && c?.kind !== 'interest')
  // deno-lint-ignore no-explicit-any
  const coverageFor = (visitId: string, clientAx: string | null, date: string, cgAx: string): any =>
    // deno-lint-ignore no-explicit-any
    openCases.find((c: any) => (visitId && String(c.axiscare_visit_id ?? '') === visitId)
      || (clientAx && String(c.client_axiscare_id ?? '') === clientAx && String(c.shift_date ?? '') === date
          && cgAx && String(c.calling_off_id ?? '') === cgAx)) ?? null
  const fin: Record<string, unknown>[] = []   // final "no more reminders" texts this run (practice or live)
  let quietHeld = 0, capped = 0
  /* One text to every admin (live), or a practice record of it. Returns how many went. Nothing at all in quiet hours
     (not even a practice record: live would not have sent it). A reminder (not final) goes only to an admin under the
     cap; the text that reaches the cap says it is the last. */
  // deno-lint-ignore no-explicit-any
  const toAdmins = async (l: any, stage: string, message: (link: string, last: boolean) => string, onlyNotSnoozed: boolean) => {
    const urgentAlone = atRiskLive && l.must_cover === true   /* Phase 3: a client who can't be left alone: any hour */
    if (loopQuiet && !urgentAlone) { quietHeld++; return 0 }
    l.admin_loop = l.admin_loop || { started_at: nowIso, sends: [], snooze: {} }
    const final = stage.startsWith('final')
    const counts: Record<string, number> | undefined = l.admin_loop.texts_to
    const exp = linkExpiry(String(l.shift_date))
    let n = 0, skipped = 0, capHere = 0
    /* a final "no more reminders" text goes to everyone who was texted about it */
    const recips = final ? [...new Map([...adminList, ...recipientsFor(l)].map((a) => [a.email, a])).values()] : recipientsFor(l)
    for (const a of recips) {
      const ak = await adminKey(a.email)
      if (onlyNotSnoozed && l.admin_loop.snooze?.[ak] && Date.parse(l.admin_loop.snooze[ak]) > Date.now()) { skipped++; continue }
      if (!a.phone) { skipped++; continue }
      const had = Number(counts?.[ak]) || 0
      if (final && counts && !had) { skipped++; continue }          // never texted about it: nothing to stop
      if (!final && had >= maxTexts) { skipped++; capHere++; continue }
      const link = LINK_SECRET ? await makeLink(LINK_SECRET, String(l.id), a.email, exp) : ''
      const msg = message(link, !final && had + 1 >= maxTexts)
      const went = loopLive ? await textAdmin(sb, ghl, a, msg, fetch, { emergency: tkAfterHours || urgentAlone }) : true
      if (went) { n++; if (!final) l.admin_loop.texts_to = { ...(l.admin_loop.texts_to || {}), [ak]: had + 1 } }
    }
    capped += capHere
    /* every admin has had their last text about it: nothing more is recorded (it waits in Needs Attention) */
    if (!final && capHere && capHere === recips.filter((a) => a.phone).length) { l.admin_loop.capped_at = l.admin_loop.capped_at || nowIso; return 0 }
    l.admin_loop.sends = [...(l.admin_loop.sends || []), { at: nowIso, stage, admins: n, skipped, practice: !loopLive }].slice(-60)
    return n
  }
  const lateOf = (l: { shift_date?: string; shift_time?: string }) => Math.round(minutesSince(`${l.shift_date}T${String(l.shift_time).slice(0, 5)}:00`))

  /* C1: the link page (clockin-alert) writes to the same records while this runs. Every save re-reads the record
     first, so an admin's resolution, snooze or EVV send made mid-run is never overwritten by this run's older copy. */
  // deno-lint-ignore no-explicit-any
  const freshLadder = async (id: string): Promise<any> => {
    const { data } = await sb.from('app_data').select('data').eq('key', 'timekeeper_cases').maybeSingle()
    // deno-lint-ignore no-explicit-any
    return (Array.isArray(data?.data) ? data!.data : []).find((x: any) => x?.id === id) ?? null
  }
  const PAGE_FIELDS = ['resolved_at', 'resolved_how', 'resolved_by', 'resolved_by_name', 'resolved_reason', 'resolved_note', 'coverage_case_id']
  // deno-lint-ignore no-explicit-any
  const save = async (l: any) => {
    const f = await freshLadder(String(l.id))
    if (f) {
      if (f.resolved_by) for (const k of PAGE_FIELDS) l[k] = f[k]          // a person's resolution always wins
      if (f.evv_sent_at) { l.evv_sent_at = f.evv_sent_at; l.evv_sent_by = f.evv_sent_by }
      if (f.admin_loop?.snooze) l.admin_loop = { ...(l.admin_loop || {}), snooze: { ...(l.admin_loop?.snooze || {}), ...f.admin_loop.snooze } }
      if (Array.isArray(f.replies) && f.replies.length > (Array.isArray(l.replies) ? l.replies.length : 0)) l.replies = f.replies   // C3: her reply
      /* Phase 3: what clockin-reply read and did (practice or live) is never overwritten by this run's older copy */
      for (const k of ['reply_reads', 'here_claim', 'cant_case']) if (f[k] !== undefined && l[k] === undefined) l[k] = f[k]
      if (Array.isArray(f.reply_reads) && f.reply_reads.length > (Array.isArray(l.reply_reads) ? l.reply_reads.length : 0)) l.reply_reads = f.reply_reads
    }
    return sb.rpc('upsert_app_data_item', { target_key: 'timekeeper_cases', item: l })
  }

  // ── PASS 1: resolve open ladders whose world changed. ──
  let resolved = 0
  for (const l of ladders) {
    if (!l || l.resolved_at) continue
    const v = byVisitId.get(String(l.visit_id))
    let how = ''
    if (l.kind === 'clock_out') {
      /* A clock-out reminder resolves on the clock-OUT appearing. */
      if (!v) how = 'visit_gone'
      else if (v?.clockOut?.time) how = 'clocked_out'
      if (!how) continue
      l.resolved_at = nowIso; l.resolved_how = how
      if (watchLive) await save(l)
      resolved++
      continue
    }
    /* Phase 2: the shift is over and nobody clocked in. The emergency becomes the next real step, a "Call <client> to
       confirm <caregiver>'s times" card for the same owner, and the admin texts stop (no final text: the card says it
       all, and nothing is sent at night). Not dropped: the work moves. */
    /* (only while the same caregiver is still on the visit: a changed visit is resolved as visit_changed below) */
    const sameCg = !v || String(v?.caregiver?.id ?? '') === String(l.caregiver_axiscare_id ?? '')
    if (sameCg && !(v?.clockIn?.time) && tkShiftEnded(l, v, day, Date.now(), (st) => visitMs(st))) {
      const cardId = cftId(String(l.visit_id))
      const exists = hasCard(opsByIdC, String(l.visit_id))
      cftFromIn.push({ alert: l.id, caregiver: l.caregiver, client: l.client_first, shift: `${l.shift_date} ${l.shift_time}`, item: cardId, already: exists, live: cftLive })
      if (cftLive) {
        const f = await freshLadder(String(l.id)); if (f?.resolved_at) continue          // a person resolved it meanwhile
        l.resolved_at = nowIso; l.resolved_how = 'became_confirm_times'; l.confirm_times_item = cardId
        await save(l)
        const owner = String(admins[0] || '')
        await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
          id: `ops_tk_${l.id}`, kind: 'staffing_issue', status: 'resolved', resolved_at: nowIso, resolved_how: 'became_confirm_times',
          title: `Shift over: now a call to ${l.client_first} to confirm the times (${l.client_first} ${clock12(l.shift_time)})`, about: l.caregiver,
          domain: 'scheduling_coverage', urgency: 'high', owner, owner_name: owner.split('@')[0],
          detail: `The shift ended with no clock-in, so this alert became a "Call ${l.client_first} to confirm the times" card and the admin texts stopped.`,
          created_at: l.office_alerted_at, created_by: 'timekeeper-watch', opened_by: 'timekeeper' } })
        if (!exists) {
          const endHm = String(v?.scheduledEndDate ?? v?.endDate ?? '').slice(11, 16)
          const item = confirmTimesItem({ visit_id: String(l.visit_id), caregiver: String(l.caregiver || ''), caregiver_axiscare_id: l.caregiver_axiscare_id ?? null,
            client_first: String(l.client_first || ''), client_name: v ? [v?.client?.firstName, v?.client?.lastName].filter(Boolean).join(' ') : null,
            client_axiscare_id: v?.client?.id != null ? String(v.client.id) : (l.client_axiscare_id ?? null),
            shift_date: String(l.shift_date), start: String(l.shift_time || '').slice(0, 5), end: endHm,
            clock_in: null, clock_out: clockHM(v?.clockOut), missing: v?.clockOut?.time ? 'in' : 'both' },
            { owner, now: nowIso, source: 'timekeeper-watch (missed clock-in)', extra: { from_alert: `ops_tk_${l.id}` } })
          await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item })
          opsByIdC.set(item.id, item)
        } else cftAlready++
        resolved++
      }
      continue
    }
    /* A missed clock-in still ringing the admins from an earlier day: today's visit list can't say anything about
       it, so it keeps going until an admin resolves it (never quietly dropped at midnight). */
    if (!v && l.admin_loop && l.shift_date !== day) continue
    if (l.admin_loop) { const f = await freshLadder(String(l.id)); if (f?.resolved_at) continue }   // resolved on the link page meanwhile
    if (!v) how = 'visit_gone'
    else if (v?.clockIn?.time) how = 'clocked_in'
    else if (v?.caregiver?.id == null || String(v?.caregiver?.id) !== String(l.caregiver_axiscare_id)) how = 'visit_changed'
    if (!how) continue
    l.resolved_at = nowIso
    l.resolved_how = how
    if (how === 'clocked_in') {
      const late = minutesSince(String(v?.scheduledStartDate ?? '')) - minutesSince(String(v.clockIn.time))
      l.minutes_late = Number.isFinite(late) ? Math.max(0, Math.round(late)) : null
    }
    /* C1: the admins were being reminded; one last text says why it stopped. */
    if ((l.admin_loop?.sends || []).some((x: { admins?: number }) => Number(x?.admins) > 0)) {
      const at12 = how === 'clocked_in' ? clock12(clockHM(v?.clockIn) || '') : ''
      const what = how === 'clocked_in'
        ? `${l.caregiver} clocked in at ${at12}${l.minutes_late != null ? ` (${l.minutes_late} min late)` : ''} for ${l.client_first}'s ${clock12(l.shift_time)} shift.`
        : `${l.client_first}'s ${clock12(l.shift_time)} shift changed in AxisCare (${l.caregiver} is no longer on it).`
      if (await toAdmins(l, 'final_' + how, () => `${what} No more reminders.`, false)) fin.push({ alert: l.id, how })
    }
    if (watchLive) {
      await save(l)
      if (l.office_alerted_at) {
        /* Close the alert too — a resolved emergency must not sit urgent. */
        await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
          id: `ops_tk_${l.id}`, kind: 'staffing_issue', status: 'resolved',
          title: `Resolved: ${l.caregiver} ${how === 'clocked_in' ? 'clocked in' : 'no longer on this visit'} (${l.client_first} ${l.shift_time})`,
          about: l.caregiver, domain: 'scheduling_coverage', urgency: 'high',
          owner: String(admins[0]), owner_name: String(admins[0]).split('@')[0],
          detail: how === 'clocked_in'
            ? `${l.caregiver} clocked in${l.minutes_late != null ? ` ${l.minutes_late} minutes late` : ''}. Cara closed this alert; the nightly attendance sweep records the tardy.`
            : `The visit changed in AxisCare (reassigned, unassigned or removed), so this alert no longer applies.`,
          created_at: l.office_alerted_at, resolved_at: nowIso,
          created_by: 'timekeeper-watch', opened_by: 'timekeeper',
        } })
      }
    }
    resolved++
  }

  // ── PASS 2: walk today's assigned, unclocked, recently-started visits. ──
  const wouldText: Record<string, unknown>[] = []
  const wouldAlert: Record<string, unknown>[] = []
  let opened = 0, texted = 0, alerted = 0, skippedNoPhone = 0, refusedGate = 0, skippedByList = 0, skippedCoverage = 0, heldLate = 0
  /* Running late (L1, 2026-09-29): a caregiver who told us they're running late gets no "we don't see a clock-in"
     text, and the admins' missed clock-in alarm waits until 5 minutes after the time they gave (15 past the start if
     they gave none). "Can't make it" never starts one: the running-late alert already has the admins. Live notices
     only; with no running-late record this changes nothing. */
  const lateByVisit = await liveNotices(sb, day)
  /* 432 (her call to Mary, 2026-10-03): while the running-late notices are in practice, only a CALL's notice holds, and
     only "running late" with a time: the missed clock-in admin texts pause until 5 minutes after that time, then carry
     on (counting toward the cap). Can't make it, or no time: they carry on as before. ops_settings.late_call_live off
     stops call holds. */
  const holdOpts = holdOptsOf(settings)

  /* C1 (Samantha, 2026-09-29): short, at 5 minutes. No "if something's come up". (The EVV correction form is retired,
     2026-10-17: a missing time is confirmed with the client by phone.) */
  const msgTmpl = String(settings.timekeeper_msg || '')
    || `Hi {first_name}, this is Caring Companions. We don't see a clock-in yet for your {time} shift with {client}. Please clock in now in the AxisCare app.`

  for (const v of visits) {
    if (v?.caregiver?.id == null || v?.clockIn?.time) continue
    const start = String(v?.scheduledStartDate ?? v?.startDate ?? '')
    const late = minutesSince(start)
    if (!Number.isFinite(late) || late < graceMin || late > STALE_MIN) continue
    const vid = String(v?.id ?? ''); if (!vid) continue

    const cgName = [String(v.caregiver.firstName ?? '').trim(), String(v.caregiver.lastName ?? '').trim()]
      .filter(Boolean).join(' ') || ('caregiver ' + v.caregiver.id)
    const clientFirst = String(v?.client?.firstName ?? '').trim() || 'your client'
    const shiftTime = start.slice(11, 16)
    /* Texts read "5pm", never "17:00" — her standing 12-hour rule (the
       pre-enable to-do recorded 2026-09-16, fixed before first deploy). */
    const shiftTime12 = clock12(shiftTime)
    if (skipMatch(skips, 'clock', cgName, clientFirst)) { skippedByList++; continue }

    let l = ladderByVisit.get(vid)
    if (l?.resolved_at) continue          // once handled, never reopened by a robot
    /* C1: a coverage case already has this shift (she called off): no clock-in text, no admin alarm. */
    if (!l?.texted_at && !l?.admin_loop && coverageFor(vid, v?.client?.id != null ? String(v.client.id) : null, day, String(v.caregiver.id))) {
      skippedCoverage++; continue
    }
    if (!l?.texted_at && !l?.admin_loop && lateHold(lateByVisit.get(vid), visitMs(start), Date.now(), holdOpts) !== 'none') { heldLate++; continue }
    if (!l) {
      l = { id: 'tk_' + vid.replace(/[^A-Za-z0-9]/g, '_'), visit_id: vid,
        caregiver: cgName, caregiver_axiscare_id: String(v.caregiver.id),
        client_first: clientFirst, client_axiscare_id: v?.client?.id != null ? String(v.client.id) : null,
        shift_date: day, shift_time: shiftTime,
        opened_at: nowIso, texted_at: null, ghl_contact_id: null,
        office_alerted_at: null, resolved_at: null, resolved_how: null, notes: [] }
      ladderByVisit.set(vid, l)
      if (watchLive) { await save(l); opened++ }
    }

    // Step 1: the text.
    if (!l.texted_at) {
      const cg = byAxis.get(String(v.caregiver.id)) ?? byName.get(nameKeyOf(cgName))
      const phone = normalisePhone(cg?.phone)
      if (!phone) {
        skippedNoPhone++
        if (!l.no_phone) { l.no_phone = true; l.notes.push('No phone on the roster. Text skipped; office step will fire at its time.') }
        if (watchLive) await save(l)
      } else if (textLive) {
        /* Same classification as the callouts: an employee, about a shift
           happening right now. urgent_internal, 24/7 — a 6am shift needs its
           6:03 nudge. contactForOutbound applies the identity gate. */
        const contact = await contactForOutbound(sb, ghl,
          { phone, firstName: String(cg?.first ?? '') || cgName.split(' ')[0] }, 'urgent_internal', { audience: 'caregiver', channel: 'sms', sender: 'timekeeper-watch' })
        if (!contact) { refusedGate++; l.notes.push('Text refused by the outbound gate (untrusted number, or they opted out of texts).'); await save(l) }
        else {
          const message = msgTmpl.replaceAll('{first_name}', String(cg?.first ?? '') || cgName.split(' ')[0])
            .replaceAll('{client}', clientFirst).replaceAll('{time}', shiftTime12)
          /* NO SILENT FAILURES (2026-10-01): every timekeeper text GoHighLevel refuses raises a card on Needs
             Attention (texted_at still stays empty, so the next run tries again, exactly as before) */
          const ok = await ghlSendChecked(sb, { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
            'timekeeper-watch', { channel: 'sms', contactId: contact.contactId, address: phone, who: cgName }, { message })
          if (ok) {
            l.texted_at = nowIso; l.ghl_contact_id = contact.contactId
            await save(l); texted++
            try {
              await fetch(`https://services.leadconnectorhq.com/contacts/${contact.contactId}/tags`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28',
                           'Content-Type': 'application/json' },
                body: JSON.stringify({ tags: ['timekeeper-asked'] }),
              })
            } catch { /* a missing tag only costs reply routing */ }
          }
        }
      } else {
        wouldText.push({ caregiver: cgName, client: clientFirst, time: shiftTime,
          minutes_late: Math.round(late), phone_last4: phone.slice(-4) })
      }
    }

    // Step 2 (C1): the admins, at the same moment as the caregiver's text. The NO CLOCK-IN item opens in Needs
    // Attention, and the reminder loop below starts: every admin, every few minutes, until it's resolved.
    if (!l.office_alerted_at && late >= graceMin) {
      const cg = byAxis.get(String(v.caregiver.id)) ?? byName.get(nameKeyOf(cgName))
      const cgPhone = normalisePhone(cg?.phone)
      /* PHASE 3: the client's call-in plan says this shift must be covered (they can't safely be left alone): urgent from
         the first alert, and the office texts go at any hour */
      const mustCover = l.client_axiscare_id ? isMustCover((await readPlan(sb, l.client_axiscare_id, planCache)).plan) : false
      if (mustCover) { if (atRiskLive) l.must_cover = true; p3note(atRiskLive, { alert: l.id, client: clientFirst, step: 'urgent from the start: the call-in plan says this client can\'t be left alone' }) }
      if (watchLive) {
        await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
          id: `ops_tk_${l.id}`, kind: 'staffing_issue',
          title: `${l.must_cover ? 'URGENT, can\'t be left alone. ' : ''}NO CLOCK-IN: ${cgName} for ${clientFirst}, ${clock12(shiftTime)} shift`,
          about: cgName,
          detail: `${cgName} has not clocked in for ${clientFirst}'s ${clock12(shiftTime)} visit `
            + `(${Math.round(late)} minutes past start). `
            + (l.texted_at ? `Cara texted ${cgName.split(' ')[0]} at ${String(l.texted_at).slice(11, 16)} UTC. ` : `No text went out to ${cgName.split(' ')[0]} (${l.no_phone ? 'no phone on the roster' : 'texting is not live'}). `)
            + `Call ${cgName}${cgPhone ? `: ${cgPhone}` : ' (number missing from the roster, check AxisCare)'}. `
            + `Every admin is texted a link every ${repeatMin} minutes (at most ${maxTexts} texts each) until someone marks it resolved there; `
            + `it also stops when a clock-in appears or a coverage case covers the shift. `
            + (loopQuiet ? `It is quiet hours (no office texts ${quietTxt}), so nobody was texted; it waits here, and the texts start at the end of quiet hours if it is still open.`
              : tkAfterHours ? `Missed clock-in texts go at any hour, including ${quietTxt}.`
              : `No office texts ${quietTxt}; overnight it waits here.`),
          domain: 'scheduling_coverage', status: 'open', urgency: l.must_cover ? 'urgent' : 'high',
          owner: String(admins[0]), owner_name: String(admins[0]).split('@')[0],
          due: new Date(Date.now() + 3600 * 1000).toISOString(),
          created_at: nowIso, created_by: 'timekeeper-watch', opened_by: 'timekeeper',
        } })
        l.office_alerted_at = nowIso
        l.admin_loop = l.admin_loop || { started_at: nowIso, sends: [], snooze: {} }
        if (loopQuiet) l.admin_loop.opened_in_quiet = true   // the first admin text waits for the end of quiet hours
        await save(l); alerted++
        await opEvent(sb, { job: 'timekeeper-watch', verb: 'item_created', item_id: `ops_tk_${l.id}`, area: 'coverage',
          summary: `Cara raised: NO CLOCK-IN, ${cgName} for ${clientFirst}, ${clock12(shiftTime)} shift (${Math.round(late)} min past start)` })
        await shadowRoute(sb, { area: 'sched_clockins', channel: 'missed clock-in admin SMS',
          production: adminList.map((a) => a.phone).filter(Boolean) as string[], case_id: String(l.id) })
      } else {
        wouldAlert.push({ caregiver: cgName, client: clientFirst, time: shiftTime,
          minutes_late: Math.round(late) })
      }
    }
  }

  // ── PASS 2b (C1): the admin reminder loop. Every open missed clock-in whose alarm has started. ──
  let loopSent = 0, loopDue = 0, loopStoppedCoverage = 0
  if (watchLive) {
    /* ladderByVisit, not ladders: it also holds the alerts opened a moment ago in PASS 2, so the first admin text
       goes in the same run as the caregiver's. */
    for (const l of ladderByVisit.values()) {
      if (!l || l.kind === 'clock_out' || l.resolved_at || !l.admin_loop) continue
      /* resolved or snoozed on the link page since this run started? */
      const f = await freshLadder(String(l.id))
      if (f?.resolved_at) continue
      if (f?.admin_loop?.snooze) l.admin_loop.snooze = { ...(l.admin_loop.snooze || {}), ...f.admin_loop.snooze }
      if (Array.isArray(f?.replies)) l.replies = f.replies
      const v = byVisitId.get(String(l.visit_id))
      /* Someone opened a coverage case for this shift since: it owns it now. */
      if (coverageFor(String(l.visit_id), l.client_axiscare_id ?? null, String(l.shift_date), String(l.caregiver_axiscare_id))) {
        l.resolved_at = nowIso; l.resolved_how = 'coverage_case'
        if ((l.admin_loop.sends || []).some((x: { admins?: number }) => Number(x?.admins) > 0))
          await toAdmins(l, 'final_coverage', () => `Coverage case opened for ${l.client_first}'s ${clock12(l.shift_time)} shift (${l.caregiver}). No more reminders.`, false)
        await save(l); loopStoppedCoverage++
        await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
          id: `ops_tk_${l.id}`, kind: 'staffing_issue', status: 'resolved',
          title: `Resolved: coverage case opened (${l.client_first} ${clock12(l.shift_time)})`, about: l.caregiver,
          domain: 'scheduling_coverage', urgency: 'high', owner: String(admins[0]), owner_name: String(admins[0]).split('@')[0],
          detail: `A coverage case now covers this shift, so the missed clock-in alert stopped.`,
          created_at: l.office_alerted_at, resolved_at: nowIso, created_by: 'timekeeper-watch', opened_by: 'timekeeper' } })
        continue
      }
      /* quiet hours: skip this round entirely (nothing recorded, nothing queued); from 7am one text if still open */
      if (loopQuiet && !(atRiskLive && l.must_cover === true)) { quietHeld++; continue }
      /* 432: they told us on a call (or, with the notices live, a text) they're running late, with a time: this alert's
         admin texts wait until 5 minutes after it (recorded once on the alert, shown on the link page) */
      const lnHold = lateByVisit.get(String(l.visit_id))
      const vStart = v ? visitMs(String(v?.scheduledStartDate ?? v?.startDate ?? '')) : NaN
      if (lateHold(lnHold, vStart, Date.now(), holdOpts) === 'hold') {
        const until = holdUntil(lnHold, vStart, holdOpts)
        const hu = until != null ? new Date(until).toISOString() : null
        if (l.admin_loop.late_hold?.until !== hu) { l.admin_loop.late_hold = { until: hu, since: nowIso, call_at: lnHold?.call_at ?? null }; await save(l) }
        heldLate++; continue
      }
      const late = lateOf(l)
      /* ── PHASE 3 · 15 minutes, no clock-in, no reply, nothing from the running-late watcher: one shorter second text ── */
      const noticeOn = !!lateByVisit.get(String(l.visit_id))
      const noReplyNow = secondTextDue(l, late, noticeOn)
      if (noReplyNow) {
        const cgRec = byAxis.get(String(l.caregiver_axiscare_id)) ?? byName.get(nameKeyOf(String(l.caregiver)))
        const text2 = fillText(String(settings.timekeeper_msg_second || '') || SECOND_TEXT, { first_name: String(cgRec?.first ?? '') || String(l.caregiver).split(' ')[0], time: clock12(l.shift_time), client: String(l.client_first) })
        if (noReplyLive && textLive && l.ghl_contact_id) {
          const cid = await ghlStoredContactIfAllowed(sb, ghl, 'timekeeper-watch', { channel: 'sms', contactId: l.ghl_contact_id })
          if (cid && await ghlSendChecked(sb, { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
            'timekeeper-watch', { channel: 'sms', contactId: cid, address: normalisePhone(cgRec?.phone) ?? '', who: String(l.caregiver) }, { message: text2 })) {
            l.second_texted_at = nowIso; p3note(true, { alert: l.id, step: 'second text', to: String(l.caregiver).split(' ')[0] })
          } else if (!cid) { l.second_texted_at = nowIso; l.notes = [...(l.notes || []), 'Second text not sent: they opted out of texts, or their GoHighLevel contact could not be checked (see Refused texts).'] }
          await save(l)
        } else if (!l.second_would_at) { l.second_would_at = nowIso; p3note(false, { alert: l.id, step: 'second text would go', text: text2 }); await save(l) }
      }
      /* ── PHASE 3 · 30 minutes still unconfirmed: the client is at risk; the card asks: call the client, or open coverage ── */
      if (atRisk(late) && !l.at_risk_at && !l.at_risk_would_at) {
        if (atRiskLive) {
          l.at_risk_at = nowIso
          const { data: oiR } = await sb.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
          // deno-lint-ignore no-explicit-any
          const it = (Array.isArray(oiR?.data) ? oiR!.data : []).find((x: any) => String(x?.id) === `ops_tk_${l.id}`)
          if (it && it.status === 'open') await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { ...it, urgency: 'urgent', at_risk: true,
            title: `At risk: ${l.client_first} may be without care (${String(l.caregiver).split(' ')[0]}, ${clock12(l.shift_time)}): call ${l.client_first} or open coverage`,
            detail: `${late} minutes and no clock-in from ${l.caregiver}${l.here_claim ? ' (they texted that they are there, which is not arrival)' : ''}. `
              + `Call ${l.client_first} or the family to find out whether ${String(l.caregiver).split(' ')[0]} is there. If not, open a coverage case. ` + String(it.detail || ''),
            last_activity_at: nowIso } })
          p3note(true, { alert: l.id, step: 'at risk at 30 minutes', client: l.client_first })
        } else { l.at_risk_would_at = nowIso; p3note(false, { alert: l.id, step: 'at risk at 30 minutes would show', client: l.client_first }) }
        await save(l)
      }
      const endStamp = v ? String(v?.scheduledEndDate ?? v?.endDate ?? '') : ''
      const afterEnd = l.shift_date !== day || (endStamp ? minutesSince(endStamp) > 0 : false)
      /* the first "shift has ended" text comes on the usual beat; after that, every 30 minutes */
      const every = afterEnd && (l.admin_loop.sends || []).at(-1)?.stage === 'after_end' ? 30 : repeatMin
      const last = l.admin_loop.last_sent_at ? Date.parse(l.admin_loop.last_sent_at) : 0
      if (last && Date.now() - last < every * 60000 - 20000) continue
      loopDue++
      const cg = l.caregiver, cl = l.client_first, t12 = clock12(l.shift_time)
      const first = !(l.admin_loop.sends || []).some((x: { stage?: string; admins?: number }) => !String(x?.stage).startsWith('final'))
      /* an alert opened overnight whose shift has already ended starts with the "shift has ended" wording at 7am */
      const stage = first && !afterEnd ? 'first' : afterEnd ? 'after_end' : late >= 30 ? 'thirty' : 'repeat'
      /* C3: her newest reply since the last round goes into this one (clockin-reply attaches it) */
      const lastAt = (l.admin_loop.sends || []).at(-1)?.at || ''
      const rep = (Array.isArray(l.replies) ? l.replies : []).filter((x: { at: string }) => String(x.at) > String(lastAt)).at(-1)
      const ln = lateByVisit.get(String(l.visit_id))
      const toldLate = ln && ln.kind === 'late' ? ` ${String(cg).split(' ')[0]} told us they're running late${ln.eta ? ', about ' + clock12(new Date(ln.eta).toLocaleString('en-GB', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false })) : ''}.` : ''
      /* 432: what a call said goes into the next text once (per call): after a pause it explains why they start again */
      const callNew = !!ln?.call_at && l.admin_loop.call_told !== (ln.call_message_id || ln.call_at)
      const callTxt = callNew ? ' ' + callLine(ln) : ''
      const said = (callNew ? callTxt : stage === 'first' ? toldLate : '') + (rep ? ` ${String(cg).split(' ')[0]} replied: "${String(rep.text).replace(/\s+/g, ' ').slice(0, 120)}${String(rep.text).length > 120 ? '...' : ''}".` : '')
      /* how to stop it is in every text (2026-10-03); the text that reaches the cap says it is the last */
      const stop = (last: boolean) => last
        ? ` This is the last text about it (it stays open in Needs Attention). Tap Resolved when it's handled: `
        : ` Tap Resolved to stop these texts: `
      const msg = (link: string, last: boolean) => (stage === 'first'
        ? `No clock-in: ${cg} for ${cl}'s ${t12} shift (${late} min past start).${said}${stop(last)}${link}`
        : stage === 'after_end'
        ? `${cl}'s ${t12} shift has ended and the missed clock-in for ${cg} is still not resolved.${said}${stop(last)}${link}`
        : stage === 'thirty'
        ? `${late} min and still not resolved: no clock-in from ${cg} for ${cl}'s ${t12} shift. ${cl} may be without care.${said}${stop(last)}${link}`
        : (noReplyLive && l.second_texted_at && !(Array.isArray(l.replies) && l.replies.length) && !noticeOn)
        ? `No clock-in, no reply: ${cg} for ${cl}'s ${t12} shift (${late} min past start).${said}${stop(last)}${link}`
        : `Still no clock-in: ${cg} for ${cl}'s ${t12} shift (${late} min past start).${said}${stop(last)}${link}`).trim()
      const sentBefore = loopSent
      loopSent += await toAdmins(l, stage, msg, true)
      if (callNew && (loopSent > sentBefore || !loopLive)) l.admin_loop.call_told = ln!.call_message_id || ln!.call_at
      l.admin_loop.last_sent_at = nowIso
      await save(l)
    }
  }

  // ── PASS 3: clock-OUT reminders. One text, no ladder, no office step. ──
  const wouldTextOut: Record<string, unknown>[] = []
  let textedOut = 0
  /* Missed shift notes (her ask, 2026-09-29): someone who forgot or can't clock out is asked for their shift note too,
     so every shift has a note the office and the family can read. "it's Caring Companions", not "it's Cara" (she paused
     an "it's Cara" text in Step 0). Her own wording (ops_settings.timekeeper_msg_out) is used as it is when set.
     2026-10-17 (Samantha): the EVV correction form is retired, so the reminder no longer carries a form link; when the
     clock-out still is not there, the office calls the client to confirm the time (PASS 3b). */
  const MSG_OUT_DEFAULT = `Hi {first_name}, it's Caring Companions. Your shift with {client} ended at {time} but there's no clock-out yet. Please clock out in the AxisCare app now. If you didn't put in your shift note, text it to the office now so we can put it in your shift for you.`
  const storedOut = String(settings.timekeeper_msg_out || '')
  /* an older saved wording that still points at the retired form is not sent: the standard wording goes instead */
  const msgOutTmpl = storedOut && !/evv-correction-form/i.test(storedOut) ? storedOut : MSG_OUT_DEFAULT
  for (const v of visits) {
    if (v?.caregiver?.id == null || !v?.clockIn?.time || v?.clockOut?.time) continue
    const end = String(v?.scheduledEndDate ?? v?.endDate ?? '')
    const over = minutesSince(end)
    if (!Number.isFinite(over) || over < outGraceMin || over > STALE_MIN) continue
    const vid = String(v?.id ?? ''); if (!vid) continue
    const existing = ladders.find(x => x?.id === 'tko_' + vid.replace(/[^A-Za-z0-9]/g, '_'))
    if (existing) continue                       // reminded once, ever
    const cgName = [String(v.caregiver.firstName ?? '').trim(), String(v.caregiver.lastName ?? '').trim()]
      .filter(Boolean).join(' ') || ('caregiver ' + v.caregiver.id)
    const clientFirst = String(v?.client?.firstName ?? '').trim() || 'your client'
    if (skipMatch(skips, 'clock', cgName, clientFirst)) { skippedByList++; continue }
    const endTime = end.slice(11, 16)
    const cg = byAxis.get(String(v.caregiver.id)) ?? byName.get(nameKeyOf(cgName))
    const phone = normalisePhone(cg?.phone)
    if (!phone) { skippedNoPhone++; continue }
    if (!textLive) {
      wouldTextOut.push({ caregiver: cgName, client: clientFirst, ended: endTime,
        minutes_over: Math.round(over), phone_last4: phone.slice(-4) })
      continue
    }
    const contact = await contactForOutbound(sb, ghl,
      { phone, firstName: String(cg?.first ?? '') || cgName.split(' ')[0] }, 'urgent_internal', { audience: 'caregiver', channel: 'sms', sender: 'timekeeper-watch' })
    if (!contact) { refusedGate++; continue }
    const message = msgOutTmpl.replaceAll('{first_name}', String(cg?.first ?? '') || cgName.split(' ')[0])
      .replaceAll('{client}', clientFirst).replaceAll('{time}', clock12(endTime))
    try {
      if (await ghlSendChecked(sb, { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
        'timekeeper-watch', { channel: 'sms', contactId: contact.contactId, address: phone, who: cgName }, { message })) {
        await save({ id: 'tko_' + vid.replace(/[^A-Za-z0-9]/g, '_'), kind: 'clock_out',
          visit_id: vid, caregiver: cgName, caregiver_axiscare_id: String(v.caregiver.id),
          client_first: clientFirst, shift_date: day, shift_time: endTime,
          opened_at: nowIso, texted_at: nowIso, ghl_contact_id: contact.contactId,
          resolved_at: null, resolved_how: null })
        textedOut++
      }
    } catch (err) { console.error('timekeeper clockout sms failed', err) }
  }

  /* ── PASS 3b (2026-10-17): A MISSED CLOCK-OUT BECOMES A CALL TO THE CLIENT. Clocked in, no clock-out, and
     confirm_times_out_after_min (30) past the scheduled end: ONE "Call <client> to confirm <caregiver>'s departure
     time" card. Today's visits only (yesterday's are the overnight check's, coverage-watch); a visit with a card already
     (open or done, or an old EVV fix card) is never carded again. Office work only: nobody outside the office is
     contacted. Same switches as the clock-in card (loops_close_live + timekeeper_watch_live); off = listed only. */
  for (const v of visits) {
    if (v?.caregiver?.id == null || !v?.clockIn?.time || v?.clockOut?.time) continue
    const end = String(v?.scheduledEndDate ?? v?.endDate ?? '')
    const over = minutesSince(end)
    if (!Number.isFinite(over) || over < cftOutAfter) continue
    const vid = String(v?.id ?? ''); if (!vid) continue
    if (hasCard(opsByIdC, vid)) { cftAlready++; continue }
    const cgName = [String(v.caregiver.firstName ?? '').trim(), String(v.caregiver.lastName ?? '').trim()]
      .filter(Boolean).join(' ') || ('caregiver ' + v.caregiver.id)
    const clientFirst = String(v?.client?.firstName ?? '').trim() || 'the client'
    const item = confirmTimesItem({ visit_id: vid, caregiver: cgName, caregiver_axiscare_id: String(v.caregiver.id),
      client_first: clientFirst, client_name: [v?.client?.firstName, v?.client?.lastName].filter(Boolean).join(' ') || null,
      client_axiscare_id: v?.client?.id != null ? String(v.client.id) : null, shift_date: day,
      start: String(v?.scheduledStartDate ?? v?.startDate ?? '').slice(11, 16), end: end.slice(11, 16),
      clock_in: clockHM(v?.clockIn), clock_out: null, missing: 'out' },
      { owner: String(admins[0] || ''), now: nowIso, source: 'timekeeper-watch (missed clock-out)' })
    cftFromOut.push({ caregiver: cgName, client: clientFirst, ended: end.slice(11, 16), minutes_over: Math.round(over), item: item.id, live: cftLive })
    if (!cftLive) continue
    await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item })
    opsByIdC.set(item.id, item)
  }

  /* ── RETIRED 2026-10-17 (Samantha): the next-visit "have <client> sign the EVV correction form" text (429, PASS 4)
     and the Saturday EVV deadline reminder to the office. The EVV correction form is no longer used: a missing time is
     confirmed by phone with the client (the cards above). Nothing here texts anybody any more. */
  const nextVisit = { retired: '2026-10-17: the EVV correction form is retired; the office confirms the times with the client by phone' }
  const evvChase = { retired: '2026-10-17: no Saturday EVV reminder; there are no forms to process' }
  const wouldTextNext: unknown[] = []

  /* ── PHASE 3 · AFTER A FIX (cft_autoclose_live, off): an open "Call <client> to confirm the times" card from the last 14
     days closes itself once AxisCare shows what it was missing (read only, one visit read per card, at most 20 a run).
     The card keeps what was missing and who it was about; what AxisCare shows now is added beside it, so the history
     is never overwritten. Open cards also carry a ready note for the AxisCare correction. ── */
  try {
    const oldest = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10)
    // deno-lint-ignore no-explicit-any
    /* every 10 minutes is plenty (the watcher runs every 2): fewer AxisCare reads.
       HOURLY READS (2026-10-31, Samantha: "the timekeeper re-checks the confirm-times cards every hour"): a card for a
       past day costs one AxisCare read, so those are re-read once an hour (the run in the first 2 minutes of the hour).
       A card for today is checked every 10 minutes still, from today's visits already read, at no extra read. */
    const cftHourly = new Date().getMinutes() < 2
    const cards = new Date().getMinutes() % 10 >= 2 ? [] : [...opsByIdC.values()].filter((x: any) => x?.kind === 'confirm_times' && x?.status === 'open' && String(x?.shift_date || '') >= oldest && x?.visit_id).slice(0, 20)
    for (const c of cards) {
      const draft = noteDraft(c)
      if (cftAutoLive && c.note_draft !== draft) { c.note_draft = draft; await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: c }) }
      let v = byVisitId.get(String(c.visit_id))
      if (!v || String(c.shift_date) !== day) {
        if (!cftHourly) continue
        try {
          const r = await axFetch(`https://${site}.axiscare.com/api/visits/${encodeURIComponent(String(c.visit_id))}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': AC_VERSION } })
          // deno-lint-ignore no-explicit-any
          const j: any = r.ok ? await r.json().catch(() => null) : null
          v = j?.results?.visit ?? j?.visit ?? null
        } catch { v = null }
      }
      if (!fixedInAxis(c, v)) continue
      const now = { clock_in: clockHM(v?.clockIn), clock_out: clockHM(v?.clockOut) }
      const why = `AxisCare now shows ${[now.clock_in ? 'a clock-in at ' + clock12(now.clock_in) : '', now.clock_out ? 'a clock-out at ' + clock12(now.clock_out) : ''].filter(Boolean).join(' and ')}, so Cara closed this card. What was missing is kept above.`
      if (!cftAutoLive) { p3note(false, { card: c.id, step: 'would close: AxisCare shows the times now', ...now }); continue }
      const item = { ...c, status: 'done', closed_at: nowIso, closed_by: 'Cara', auto_closed_reason: why, axiscare_times_now: { ...now, seen_at: nowIso },
        history: [...(Array.isArray(c.history) ? c.history : []), { at: nowIso, by: 'Cara', text: why }] }
      await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item })
      p3note(true, { card: c.id, step: 'closed: AxisCare shows the times now', ...now })
      await opEvent(sb, { job: 'timekeeper-watch', verb: 'item_resolved', item_id: String(c.id), area: 'coverage', summary: `Cara closed "${String(c.title).slice(0, 120)}": ${why}` })
    }
  } catch (e) { p3.error = String((e as Error)?.message || e).slice(0, 160) }

  const summary = {
    phase3: p3,
    routing: routeInfo,
    confirm_times: { live: cftLive, out_after_min: cftOutAfter, from_missed_clockin: cftFromIn, from_missed_clockout: cftFromOut, already_had_a_card: cftAlready },
    mode: !watchLive ? 'DRY RUN' : textLive ? 'LIVE (watch + text)' : 'LIVE (watch only, texting off)',
    day, fetch_error: fetchError,
    visits_seen: visits.length,
    /* The clockIn proof First-Visit Confirmation has been waiting for. */
    clockin_evidence: {
      assigned_visits_started_over_15_min_ago: startedAWhile,
      of_those_with_a_clockin: withClockIn,
      read: startedAWhile === 0 ? 'no started visits yet today; run again mid-morning'
        : withClockIn === 0 ? 'ZERO clock-ins visible in the API. Do NOT go live until this is understood'
        : `${withClockIn}/${startedAWhile} populate. If this is well under 100%, raise timekeeper_grace_min before texting goes live`,
    },
    evv_chase: evvChase,
    evv_next_visit: nextVisit,
    would_text_next_visit: role === 'authenticated' || role === 'service_role' ? wouldTextNext : wouldTextNext.length,
    ladders_resolved: resolved, ladders_opened: opened,
    texts_sent: texted, clockout_texts_sent: textedOut, office_alerts: alerted,
    skipped_no_phone: skippedNoPhone, refused_by_outbound_gate: refusedGate,
    skipped_by_skip_list: skippedByList, skipped_coverage_case: skippedCoverage, held_running_late: heldLate,
    admin_loop: { live: loopLive, due: loopDue, texts: loopSent, stopped_for_coverage: loopStoppedCoverage, final_texts: fin.length,
                  quiet_hours: { now: quietNow, hours: quietTxt, missed_clockin_after_hours: tkAfterHours, loop_quiet: loopQuiet }, held_for_quiet_hours: quietHeld, max_texts_each: maxTexts, capped,
                  admins: adminList.length, admins_without_phone: adminList.filter((a) => !a.phone).length,
                  links: LINK_SECRET.length >= 32 },
    would_text: role === 'authenticated' || role === 'service_role' ? wouldText : wouldText.length,
    would_text_clockout: role === 'authenticated' || role === 'service_role' ? wouldTextOut : wouldTextOut.length,
    would_alert_office: role === 'authenticated' || role === 'service_role' ? wouldAlert : wouldAlert.length,
    settings_in_effect: { grace_min: graceMin, admin_repeat_min: repeatMin,
      clockout_grace_min: outGraceMin, skip_list_entries: skips.length, admin_max_texts: maxTexts, office_quiet_hours: quietTxt,
      switches: { timekeeper_watch_live: settings.timekeeper_watch_live === true,
                  timekeeper_text_live: settings.timekeeper_text_live === true,
                  timekeeper_admin_loop_live: settings.timekeeper_admin_loop_live === true,
                  loops_close_live: settings.loops_close_live === true,
                  missed_clockin_after_hours: tkAfterHours } },
  }

  /* Log when something happened, plus once an hour so the watchdog can tell
     "quiet" from "dead" — 720 identical rows a day would drown the log. */
  const acted = resolved + opened + texted + textedOut + alerted + loopSent + fin.length + (cftLive ? cftFromOut.length : 0)
  const topOfHour = new Date().getMinutes() < 5
  if (acted || wouldText.length || wouldTextOut.length || wouldAlert.length || topOfHour) {
    try {
      await sb.rpc('upsert_app_data_item', { target_key: 'automation_log', item: {
        id: 'auto_srv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        at: nowIso, automation: 'timekeeper-watch', ran_by: 'server',
        ok: !fetchError, dry: !watchLive, duration_ms: Date.now() - t0,
        rows_seen: visits.length,
        candidates: wouldText.length + wouldTextOut.length + wouldAlert.length + opened,
        created: texted + textedOut + alerted,
      } })
    } catch { /* logging must never block the watch */ }
  }

  return json(summary)
})
