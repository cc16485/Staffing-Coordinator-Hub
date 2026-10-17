// =============================================================================
// family-app — the rules behind the Caring Companions family booking app (Step 1a, plan approved 2026-10-15:
// https://claude.ai/artifact/3KusgKS5dCzkW7hmBqwPrJ). Shared by family-gateway (families) and family-app-office (office).
//
// One door, one client: a family login (from the separate cc-family-app project) only ever reaches the AxisCare
// clients whose Family Circle lists that login as active. AxisCare stays the record for clients and visits; the Hub
// keeps only the booking request (family_bookings), which points at the AxisCare visit it became.
// Never charges anything (billing stays on the weekly AxisCare invoice). Never texts or emails a family.
// Pure logic + small injected dependencies so it runs under Node tests.
// =============================================================================

import { brand, brandFor, brandView } from './brands.ts'

export const TZ = 'America/Chicago'   // Missouri and Oklahoma are both Central

/** Companion tasks families may pick. Extras show only where the settings allow them (decisions 1 and 2). */
export const BASE_TASKS = ['Companionship', 'Meal preparation', 'Errands and shopping', 'Seated exercise', 'An outing together']
export const EXTRA_TASKS = ['Light housekeeping', 'Rides to appointments', 'Medication reminders']
// deno-lint-ignore no-explicit-any
export function tasksFor(state: string | null, settings: any): string[] {
  const extra = settings?.[`family_app_extra_tasks_${state}`]
  const allowed = Array.isArray(extra) ? extra.filter((t: unknown) => EXTRA_TASKS.includes(String(t))) : (state === 'MO' ? EXTRA_TASKS : [])
  return [...BASE_TASKS, ...allowed]
}

// deno-lint-ignore no-explicit-any
export function stateOf(client: any): string | null {
  const s = String(client?.residentialAddress?.state ?? client?.mailingAddress?.state ?? '').trim().toUpperCase()
  return s === 'MO' || s === 'OK' ? s : null
}

/** Wall-clock date and minutes-since-midnight in Central time. */
export function central(now: Date): { date: string; minutes: number; dow: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' })
    .formatToParts(now).map((x) => [x.type, x.value]))
  const date = `${p.year}-${p.month}-${p.day}`
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday)
  return { date, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute), dow }
}
export const toMin = (hhmm: string) => { const m = /^(\d{2}):(\d{2})$/.exec(hhmm); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN }
export const fromMin = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000)
const dowOf = (date: string) => new Date(date + 'T12:00:00Z').getUTCDay()

/** HH:MM in the client's zone. AxisCare returns UTC ("…T16:00:00Z") plus a `timezone`. */
export function localHM(v: unknown, tz?: unknown): string {
  const s = String(v ?? '')
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s)
    if (!isNaN(d.getTime())) {
      try { return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: String(tz || TZ) }).format(d) } catch { /* fall through */ }
    }
  }
  const m = s.match(/(\d{2}):(\d{2})/); return m ? `${m[1]}:${m[2]}` : ''
}
export function localDate(v: unknown, tz?: unknown): string {
  const s = String(v ?? '')
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s)
    if (!isNaN(d.getTime())) { try { return new Intl.DateTimeFormat('en-CA', { timeZone: String(tz || TZ) }).format(d) } catch { /* fall through */ } }
  }
  return s.slice(0, 10)
}

/** Her go-live rule (2026-10-16): the app does not go live without the month-end App fee check. Live booking needs BOTH
 *  family_app_live and family_fee_check_ready (set by the step that installs the check); otherwise it stays practice. */
// Her live test (2026-10-16, "live test on Test Client 5 only"): clients listed in ops_settings family_app_live_clients are
// live on their own while the app switch is off. The fee check rule still applies to them. Without a client (caregiver
// offers), only the app switch counts.
// deno-lint-ignore no-explicit-any
export const appLive = (st: any, clientId?: string) => st?.family_fee_check_ready === true &&
  (st?.family_app_live === true || (clientId != null && Array.isArray(st?.family_app_live_clients) && st.family_app_live_clients.map(String).includes(String(clientId))))
export const MIN_HOURS = 2, NOTICE_MIN = 120, MAX_DAYS_AHEAD = 60, AUTO_NOTICE_HOURS = 24, FREE_CANCEL_HOURS = 24, MAX_PICKS = 5
export const WHO = ['preferred', 'any']
const OLD_WHO: Record<string, string> = { regular: 'preferred', favorites: 'any', any: 'any' }   // the Step 1b app's answers

/** Booking hours per state (her rules 2026-10-16): Missouri any day 7 AM to 6 PM, Oklahoma Monday to Friday 8 AM to 6 PM.
 *  Hub settings family_app_days_<STATE> (0 = Sunday ... 6 = Saturday), family_app_open_<STATE>, family_app_close_<STATE>. */
const HOURS_DEFAULT: Record<string, { days: number[]; open: string; close: string }> = {
  MO: { days: [0, 1, 2, 3, 4, 5, 6], open: '07:00', close: '18:00' },
  OK: { days: [1, 2, 3, 4, 5], open: '08:00', close: '18:00' },
}
export type Hours = { days: number[]; open: string; close: string; min_hours: number; notice_hours: number; max_days: number }
// deno-lint-ignore no-explicit-any
export function hoursFor(state: string | null, st: any): Hours {
  const d = HOURS_DEFAULT[String(state)] ?? HOURS_DEFAULT.OK
  const set = st?.[`family_app_days_${state}`]
  const days = Array.isArray(set) ? [...new Set(set.map(Number).filter((n: number) => Number.isInteger(n) && n >= 0 && n <= 6))].sort() as number[] : d.days
  const hm = (v: unknown, dflt: string) => { const s = String(v ?? ''); return /^\d{2}:(00|30)$/.test(s) && toMin(s) <= 1440 ? s : dflt }
  let open = hm(st?.[`family_app_open_${state}`], d.open), close = hm(st?.[`family_app_close_${state}`], d.close)
  if (toMin(close) - toMin(open) < MIN_HOURS * 60) { open = d.open; close = d.close }
  return { days, open, close, min_hours: MIN_HOURS, notice_hours: NOTICE_MIN / 60, max_days: MAX_DAYS_AHEAD }
}
const DAY_WORDS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export function clock12(hhmm: string) { const m = toMin(hhmm); const h = Math.floor(m / 60), mm = m % 60; return `${(h + 11) % 12 + 1}${mm ? ':' + String(mm).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}` }
function daysWords(days: number[]) {
  if (days.length === 7) return 'any day'
  if (days.join() === '1,2,3,4,5') return 'Monday to Friday'
  return days.map((n) => DAY_WORDS[n]).join(', ')
}

export type BookingIn = { kind?: unknown; date?: unknown; start?: unknown; end?: unknown; hours?: unknown; window_start?: unknown; window_end?: unknown; tasks?: unknown; who?: unknown; note?: unknown; caregiver_axiscare_id?: unknown; preferred?: unknown }
export type BookingOk = { ok: true; kind: 'set' | 'flex'; date: string; start: string | null; end: string | null; window_start: string; window_end: string; hours: number; tasks: string[]; who: string; note: string; preferred: string[] }
/** The approved rules (2026-10-16): the state's days and hours, 2 hours or more (half hours ok), at least 2 hours' notice,
 *  up to 60 days ahead. A set time is from/to; a flexible visit is a window plus how long, and the caregiver who takes it
 *  picks the start inside the window. `preferred`: the caregivers the family would like asked first (checked against her
 *  own caregivers by the caller). */
export function validateBooking(b: BookingIn, now: Date, allowedTasks: string[], hrs: Hours = hoursFor('OK', {})): BookingOk | { ok: false; error: string } {
  const date = String(b.date ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date + 'T12:00:00Z'))) return { ok: false, error: 'Please pick a day.' }
  if (!hrs.days.includes(dowOf(date))) return { ok: false, error: `Visits are ${daysWords(hrs.days)}.` }
  const kind = String(b.kind ?? 'set') === 'flex' ? 'flex' : 'set'
  const open = toMin(hrs.open), close = toMin(hrs.close)
  const between = `Visits run between ${clock12(hrs.open)} and ${clock12(hrs.close)}.`
  let ws: number, we: number, hours: number
  if (kind === 'set') {
    ws = toMin(String(b.start ?? ''))
    if (isNaN(ws) || ws % 30 !== 0) return { ok: false, error: 'Please pick a start time.' }
    if (b.end != null && b.end !== '') {
      we = toMin(String(b.end))
      if (isNaN(we) || we % 30 !== 0) return { ok: false, error: 'Please pick an end time.' }
      hours = (we - ws) / 60
    } else { hours = Number(b.hours); we = ws + hours * 60 }
    if (!(hours >= MIN_HOURS) || (hours * 2) % 1 !== 0) return { ok: false, error: 'Visits are at least 2 hours.' }
  } else {
    ws = toMin(String(b.window_start ?? '')); we = toMin(String(b.window_end ?? '')); hours = Number(b.hours)
    if (isNaN(ws) || isNaN(we) || ws % 30 !== 0 || we % 30 !== 0) return { ok: false, error: 'Please pick the times you are flexible between.' }
    if (!(hours >= MIN_HOURS) || (hours * 2) % 1 !== 0) return { ok: false, error: 'Visits are at least 2 hours.' }
    if (we - ws < hours * 60) return { ok: false, error: `The times you picked are shorter than ${hours % 1 ? hours.toFixed(1) : hours} hours. Please widen them or shorten the visit.` }
  }
  if (ws < open || we > close) return { ok: false, error: between }
  const c = central(now), ahead = dayDiff(c.date, date)
  if (ahead < 0 || (ahead === 0 && ws - c.minutes < NOTICE_MIN)) return { ok: false, error: 'Please book at least 2 hours ahead. For sooner help, call the office.' }
  if (ahead > MAX_DAYS_AHEAD) return { ok: false, error: 'You can book up to 60 days ahead.' }
  const tasks = Array.isArray(b.tasks) ? [...new Set(b.tasks.map(String))] : []
  if (!tasks.length) return { ok: false, error: 'Please pick what would help.' }
  const bad = tasks.find((t) => !allowedTasks.includes(t))
  if (bad) return { ok: false, error: `"${bad}" isn't something we can book in the app. Please call the office.` }
  const ids = (Array.isArray(b.preferred) ? b.preferred : b.caregiver_axiscare_id != null ? [b.caregiver_axiscare_id] : []).map(String).filter((x) => /^\d+$/.test(x))
  const preferred = [...new Set(ids)]
  if (preferred.length > MAX_PICKS) return { ok: false, error: `Please pick up to ${MAX_PICKS} caregivers.` }
  const rawWho = String(b.who ?? '')
  let who = WHO.includes(rawWho) ? rawWho : (OLD_WHO[rawWho] ?? (preferred.length ? 'preferred' : 'any'))
  if (who === 'preferred' && !preferred.length && rawWho === 'preferred') return { ok: false, error: 'Please pick who you would like, or choose Whoever is available.' }
  if (!preferred.length) who = 'any'
  const note = String(b.note ?? '').trim().slice(0, 1000)
  return { ok: true, kind, date, start: kind === 'set' ? fromMin(ws) : null, end: kind === 'set' ? fromMin(we) : null, window_start: fromMin(ws), window_end: fromMin(we),
           hours, tasks, who, note, preferred: who === 'preferred' ? preferred : [] }
}

/** The start the clock counts from: the set start, or the start of a flexible window. */
// deno-lint-ignore no-explicit-any
export const startOf = (b: any) => String(b.start_time || b.window_start || '')
/** The half-hour starts a caregiver may pick for a flexible visit (the window, less the length). */
export function startChoices(windowStart: string, windowEnd: string, hours: number): string[] {
  const out: string[] = []
  for (let m = toMin(windowStart); m + hours * 60 <= toMin(windowEnd); m += 30) out.push(fromMin(m))
  return out
}

/** Hours from now (Central wall clock) until a visit's start. */
export function hoursUntil(date: string, start: string, now: Date): number {
  const c = central(now)
  return (dayDiff(c.date, date) * 1440 + toMin(start) - c.minutes) / 60
}

/** What a family sees about a caregiver: first name and last initial, photo, video, their own words. */
// deno-lint-ignore no-explicit-any
export function cardOf(p: any, supabaseUrl: string) {
  const pub = (path: unknown) => path ? `${supabaseUrl}/storage/v1/object/public/caregiver-profiles/${String(path).replace(/^\/+/, '')}` : null
  const first = String(p?.preferred_name || p?.first_name || '').trim()
  const li = String(p?.last_name || '').trim().slice(0, 1)
  const photo = p?.photo_hidden ? null : (pub(p?.photo_path) ?? (/^https:\/\//.test(String(p?.photo_url ?? '')) ? String(p.photo_url) : null))
  return { axiscare_id: String(p?.axiscare_id ?? ''), name: first + (li ? ` ${li}.` : ''), first_name: first, photo, video: p?.video_hidden ? null : pub(p?.video_path),
           about: p?.about ?? null, experience: p?.experience ?? null, why: p?.why_this_work ?? null, years: p?.years_experience ?? null }
}
// deno-lint-ignore no-explicit-any
export const shareable = (p: any) => p && p.published === true && p.consent === true && p.status !== 'withdrawn'

// ── AxisCare helpers ─────────────────────────────────────────────────────────────────────────────────────────────────
export type Ax = (method: string, path: string, body?: unknown) => Promise<{ status: number; json: any }>   // deno-lint-ignore no-explicit-any
export const ok2 = (s: number) => s >= 200 && s < 300
// deno-lint-ignore no-explicit-any
export const axErr = (j: any) => { const e = j?.errors; return Array.isArray(e) ? e.join('; ') : e && typeof e === 'object' ? JSON.stringify(e) : String(j?.message ?? '') }
// deno-lint-ignore no-explicit-any
export const visitsIn = (r: { status: number; json: any }): any[] => r.status === 200 ? (r.json?.results?.visits ?? []) : []
// deno-lint-ignore no-explicit-any
export const visitIdOf = (j: any) => j?.visit?.id ?? j?.results?.visit?.id ?? j?.results?.id ?? j?.id ?? null
// deno-lint-ignore no-explicit-any
export const visitOf = (j: any) => j?.results?.visit ?? j?.visit ?? j?.results ?? j
const addDays = (date: string, n: number) => { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

/** All visits for one client in a date range, every page. AxisCare answers 404 "No visits found" for none. */
export async function clientVisits(ax: Ax, clientId: string, from: string, to: string) {
  // deno-lint-ignore no-explicit-any
  const out: any[] = []; let url: string | null = `/api/visits?clientIds=${encodeURIComponent(clientId)}&startDate=${from}&endDate=${to}`
  for (let i = 0; url && i < 10; i++) {
    const r = await ax('GET', url)
    if (r.status !== 200 && r.status !== 404) throw new Error(`AxisCare visits ${r.status} ${axErr(r.json)}`)
    out.push(...visitsIn(r))
    const next = r.json?.results?.nextPage
    url = typeof next === 'string' && next ? next.replace(/^https?:\/\/[^/]+/, '') : null
  }
  return out.filter((v) => !v?.removed)
}
// deno-lint-ignore no-explicit-any
export function visitView(v: any) {
  const tz = v?.timezone
  const cg = v?.caregiver ? { axiscare_id: String(v.caregiver.id ?? ''), first_name: String(v.caregiver.firstName ?? '').trim() } : null
  return { id: String(v?.id ?? ''), date: localDate(v?.scheduledStartDate ?? v?.startDate, tz), start: localHM(v?.scheduledStartDate ?? v?.startDate, tz),
           end: localHM(v?.scheduledEndDate ?? v?.endDate, tz), caregiver: cg,
           arrived: v?.clockIn?.time ? localHM(v.clockIn.time, tz) : null, left: v?.clockOut?.time ? localHM(v.clockOut.time, tz) : null }
}

/** A modification reason id by its AxisCare name (Hub settings hold names; ids are looked up live). */
export async function reasonId(ax: Ax, name: unknown): Promise<number | null> {
  const want = String(name ?? '').trim().toLowerCase(); if (!want) return null
  const r = await ax('GET', '/api/visits/modification-reasons')
  // deno-lint-ignore no-explicit-any
  const list: any[] = r.json?.results?.modificationReasons ?? []
  const hit = list.find((x) => x?.disabled !== true && String(x?.name ?? '').trim().toLowerCase() === want)
  return hit?.id != null ? Number(hit.id) : null
}

/** The family's estimate: THIS client's own hourly rate from their recent AxisCare visits (rates vary by client), else the
 *  state's rate from the Hub settings, else none. Missouri adds $5 an hour to visits under 4 hours (mileage between
 *  clients, her rule 2026-10-15) on usual schedules, but NOT in the app (her rule 2026-10-16, live on mo-care.com/app: "no weekly
 *  minimum and no extra charge for short visits"), so the default is none; Hub settings family_app_short_extra_<STATE> /
 *  family_app_short_under_hours can still set one. An estimate only:
 *  the invoice is AxisCare's, from the caregiver's actual clock-in and clock-out. */
export async function estimateRate(ax: Ax, clientId: string, state: string | null, st: any, today: string) {   // deno-lint-ignore no-explicit-any
  let rate: number | null = null
  try {
    const past = await clientVisits(ax, clientId, addDays(today, -120), today)
    // Only HOURLY visits (pilot check 2026-10-16: a client billed per visit showed families "$450/hr").
    const priced = past.filter((v) => Number(v?.chargeRate) > 0 && String(v?.billableRateMode ?? '').trim().toLowerCase() === 'hourly')
      .sort((a, b) => String(b?.scheduledStartDate ?? b?.startDate ?? '').localeCompare(String(a?.scheduledStartDate ?? a?.startDate ?? '')))
    if (priced.length) rate = Number(priced[0].chargeRate)
  } catch { /* no estimate is better than a wrong one */ }
  if (rate == null && Number(st?.[`family_app_rate_${state}`]) > 0) rate = Number(st[`family_app_rate_${state}`])
  const extraSet = st?.[`family_app_short_extra_${state}`]
  const short_extra = extraSet != null ? Math.max(0, Number(extraSet) || 0) : 0
  const short_under_hours = Number(st?.family_app_short_under_hours) > 0 ? Number(st.family_app_short_under_hours) : 4
  return { rate, short_extra, short_under_hours }
}

/** Put a booking on the AxisCare schedule, then read it back. Never trust a 200. With no caregiver for a set-time visit
 *  (offers go out after); a flexible visit only goes on once a caregiver has taken it and picked the start (`at`). */
// deno-lint-ignore no-explicit-any
export async function putOnSchedule(ax: Ax, b: any, st: any, at?: { start: string; end: string; caregiverId: string }): Promise<{ ok: true; vid: string } | { ok: false; why: string }> {
  const service = st?.[`family_app_service_${b.state}`]
  if (!service) return { ok: false, why: `no app service is set for ${b.state} in the Hub settings` }
  const start = at?.start ?? b.start_time, end = at?.end ?? b.end_time
  if (!start || !end) return { ok: false, why: 'a flexible visit has no start time until a caregiver picks one' }
  const post: Record<string, unknown> = { clientId: Number(b.axiscare_client_id), visitDate: b.visit_date, startTime: start, endTime: end, caregiverId: at ? Number(at.caregiverId) : null, serviceCode: service }
  const rid = await reasonId(ax, st?.family_app_create_reason)
  if (rid != null) post.modificationReason = rid
  const made = await ax('POST', '/api/visits', post)
  if (!ok2(made.status)) return { ok: false, why: `AxisCare refused the visit (${made.status} ${axErr(made.json)})` }
  let vid = visitIdOf(made.json)
  if (!vid) vid = (await clientVisits(ax, String(b.axiscare_client_id), b.visit_date, b.visit_date)).map(visitView).find((x) => x.start === start && (at ? x.caregiver?.axiscare_id === at.caregiverId : !x.caregiver))?.id ?? null
  const back = vid ? await ax('GET', `/api/visits/${encodeURIComponent(String(vid))}`) : { status: 0, json: null }
  const bv = back.status === 200 ? visitView(visitOf(back.json)) : null
  if (!bv || bv.date !== b.visit_date || bv.start !== start || bv.end !== end || (at && bv.caregiver?.axiscare_id !== at.caregiverId)) return { ok: false, why: `AxisCare took the visit but it didn't read back as booked${vid ? ` (visit ${vid})` : ''}; please check the schedule` }
  return { ok: true, vid: String(vid) }
}

/** A caregiver's own visits that day (Central), to keep an offer from double-booking them. */
export async function caregiverDay(ax: Ax, caregiverId: string, date: string): Promise<{ start: string; end: string }[]> {
  const r = await ax('GET', `/api/visits?caregiverIds=${encodeURIComponent(caregiverId)}&startDate=${date}&endDate=${date}`)
  if (r.status !== 200 && r.status !== 404) throw new Error(`AxisCare visits ${r.status} ${axErr(r.json)}`)
  return visitsIn(r).filter((v) => !v?.removed).map(visitView).filter((v) => v.date === date && v.start && v.end).map((v) => ({ start: v.start, end: v.end }))
}
export const overlaps = (s: string, e: string, busy: { start: string; end: string }[]) => busy.some((x) => toMin(s) < toMin(x.end) && toMin(x.start) < toMin(e))

/** Put a caregiver on a family booking, the one way both the office and a caregiver's yes do it, always read back.
 *  Set time: onto the AxisCare visit already there. Flexible: the AxisCare visit is made now, at the start they picked.
 *  Returns what to save on the booking, or why it didn't work (nothing is half-saved by this function). */
// deno-lint-ignore no-explicit-any
export async function placeCaregiver(ax: Ax, b: any, cg: string, pickedStart: string | null, st: any): Promise<{ ok: true; name: string; vals: Record<string, unknown> } | { ok: false; status: number; why: string }> {
  if (!/^\d+$/.test(cg)) return { ok: false, status: 400, why: 'Pick a caregiver.' }
  const cr = await ax('GET', `/api/caregivers/${cg}`)
  const c = cr.json?.results?.caregiver ?? cr.json?.results
  if (cr.status !== 200 || !c) return { ok: false, status: 502, why: `AxisCare didn't find that caregiver (${cr.status}).` }
  const activeNow = typeof c.status === 'object' ? c.status?.active !== false : !/inactive|terminated/i.test(String(c.status ?? ''))
  if (!activeNow) return { ok: false, status: 409, why: `${c.firstName ?? 'That caregiver'} isn't active in AxisCare.` }
  const name = [c.goesBy || c.firstName, c.lastName ? String(c.lastName)[0] + '.' : ''].filter(Boolean).join(' ')
  if (b.kind === 'flex') {
    if (b.axiscare_visit_id) return { ok: false, status: 409, why: 'This visit already has its time set. Change it in AxisCare.' }
    const choices = startChoices(b.window_start, b.window_end, Number(b.hours))
    if (!pickedStart || !choices.includes(pickedStart)) return { ok: false, status: 400, why: 'Pick a start time inside the family\'s window.' }
    const end = fromMin(toMin(pickedStart) + Number(b.hours) * 60)
    const put = await putOnSchedule(ax, b, st, { start: pickedStart, end, caregiverId: cg })
    if (!put.ok) return { ok: false, status: 502, why: put.why }
    return { ok: true, name, vals: { axiscare_visit_id: put.vid, start_time: pickedStart, end_time: end, caregiver_axiscare_id: cg, caregiver_name: name } }
  }
  if (!b.axiscare_visit_id) return { ok: false, status: 409, why: 'Put this booking on the schedule first.' }
  const patch: Record<string, unknown> = { caregiverId: Number(cg) }
  const rid = await reasonId(ax, st?.family_app_place_reason)
  if (rid != null) patch.modificationReason = rid
  const up = await ax('PATCH', `/api/visits/${encodeURIComponent(b.axiscare_visit_id)}`, patch)
  if (!ok2(up.status)) return { ok: false, status: 502, why: `AxisCare refused (${up.status} ${axErr(up.json)}). Nothing changed.` }
  const back = await ax('GET', `/api/visits/${encodeURIComponent(b.axiscare_visit_id)}`)
  if (String(visitOf(back.json)?.caregiver?.id ?? '') !== cg) return { ok: false, status: 502, why: 'AxisCare said yes but the visit doesn\'t show that caregiver. Please check the schedule.' }
  return { ok: true, name, vals: { caregiver_axiscare_id: cg, caregiver_name: name } }
}

// ── The family door ──────────────────────────────────────────────────────────────────────────────────────────────────
export type Who = { contact_id: number; name: string; circle_id: string; axiscare_client_id: string; client_name: string; can_book: boolean }
export type Deps = {
  ax: Ax
  now: () => Date
  supabaseUrl: string
  // deno-lint-ignore no-explicit-any
  settings: () => Promise<any>
  whoIs: (appUserId: string) => Promise<Who[]>
  // deno-lint-ignore no-explicit-any
  profiles: (axiscareIds: string[]) => Promise<any[]>
  // deno-lint-ignore no-explicit-any
  bookings: (axiscareClientId: string) => Promise<any[]>
  // deno-lint-ignore no-explicit-any
  insertBooking: (row: any) => Promise<{ id: string } | null>
  // deno-lint-ignore no-explicit-any
  updateBooking: (id: string, vals: any) => Promise<boolean>
  // deno-lint-ignore no-explicit-any
  officeItem: (item: any) => Promise<boolean>
  // deno-lint-ignore no-explicit-any
  event: (row: any) => Promise<void>
  /** Text a caregiver (audience 'caregiver', through the outbound gate). Optional: without it the office card asks a person to. */
  textCaregiver?: (axiscareId: string, message: string) => Promise<{ ok: boolean; why?: string }>
  /** Let me choose, from the offer engine (family-offer.ts, wired by the gateway). Optional: without it the choice isn't offered. */
  choose?: {
    // deno-lint-ignore no-explicit-any
    counts: (bookingIds: string[]) => Promise<Record<string, number>>
    // deno-lint-ignore no-explicit-any
    list: (b: any) => Promise<any[]>
    // deno-lint-ignore no-explicit-any
    place: (b: any, offerId: string | null, by: 'family' | 'switch') => Promise<{ ok: boolean; placed?: boolean; name?: string; message: string; unavailable?: string[] }>
    // deno-lint-ignore no-explicit-any
    cancelled: (b: any, late: boolean) => Promise<void>
  }
  /** Close an open office card (the "Place a caregiver" card of a visit the family cancelled). Optional. */
  closeItem?: (id: string, by: string, text: string) => Promise<void>
}
type Out = { status: number; body: Record<string, unknown> }
const say = (status: number, body: Record<string, unknown>): Out => ({ status, body })

export function officeCard(kind: string, b: any, title: string, detail: string, nowIso: string) {   // deno-lint-ignore no-explicit-any
  return { id: `fam_${kind}_${b.id}`, kind: 'family_booking', domain: 'scheduling_coverage', status: 'open', urgency: kind === 'cancel' ? 'soon' : 'today',
    title, about: b.client_name, who: b.requested_by_name, detail, next_action: kind === 'cancel' ? 'Do what the card says (late charge, caregiver, schedule).' : 'Place a caregiver on this visit (Scheduling, Family bookings).',
    created_at: nowIso, first_at: nowIso, last_at: nowIso, last_activity_at: nowIso, created_by: 'family app', opened_by: 'family app',
    source: { kind: 'family_booking', booking_id: b.id, axiscare_visit_id: b.axiscare_visit_id ?? null }, history: [{ at: nowIso, by: 'family app', text: detail }] }
}
/** "Let me choose" (her yes 2026-10-16, with the 5 recommended answers): the family books, caregivers say they're interested
 *  (nobody is placed), and the family picks from their profiles. Off until family_choose_live (and caregiver offers are on).
 *  Shown only when the visit is at least minLead hours away; at deadline hours before the visit, if the family hasn't picked,
 *  the first interested caregiver who is still free gets it. At most `max` interested before asking stops. */
// deno-lint-ignore no-explicit-any
export function chooseSettings(st: any) {
  const num = (v: unknown, d: number) => Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d
  const deadline = num(st?.family_choose_deadline_hours, 24)
  return { live: st?.family_choose_live === true && st?.family_offer_live === true, max: Math.min(10, num(st?.family_choose_max_interested, 3)),
    deadline, minLead: Math.max(deadline + 2, num(st?.family_choose_min_lead_hours, 30)), familyText: st?.family_choose_family_text !== false }
}
/** May this visit use Let me choose? */
// deno-lint-ignore no-explicit-any
export function chooseAllowed(st: any, date: string, start: string, now: Date): { ok: true } | { ok: false; why: string } {
  const c = chooseSettings(st)
  if (!c.live) return { ok: false, why: '"Let me choose" isn\'t turned on yet. Pick "Find someone for me."' }
  if (hoursUntil(date, start, now) < c.minLead) return { ok: false, why: `"Let me choose" needs the visit at least ${c.minLead} hours away, so there's time to choose. Pick "Find someone for me."` }
  return { ok: true }
}
/** The family's deadline to choose (ISO): `deadline` hours before the visit starts (Central wall clock). */
export function chooseBy(date: string, start: string, now: Date, deadlineHours: number) {
  return new Date(now.getTime() + (hoursUntil(date, start, now) - deadlineHours) * 3600000).toISOString()
}

/** Her cancel rules (2026-10-16): families cancel app-booked visits any time in the app. Less than 24 hours before the start,
 *  the family is charged 2 hours and the caregiver is paid 2 hours (Hub setting family_app_late_cancel_hours). */
// deno-lint-ignore no-explicit-any
export const lateCancelHours = (st: any) => { const n = Number(st?.family_app_late_cancel_hours); return n > 0 && n <= 12 ? n : 2 }
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], SHORT_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const niceDay = (date: string) => { const d = new Date(date + 'T12:00:00Z'); return `${SHORT_DAYS[d.getUTCDay()]} ${SHORT_MON[d.getUTCMonth()]} ${d.getUTCDate()}` }
/** "Tue Oct 20, 10 AM to 12 PM" (a flexible visit with no time yet: "Tue Oct 20, 3 hours between 9 AM and 5 PM"). */
// deno-lint-ignore no-explicit-any
export const visitWords = (b: any) => b.start_time ? `${niceDay(b.visit_date)}, ${clock12(b.start_time)} to ${clock12(b.end_time)}`
  : `${niceDay(b.visit_date)}, ${Number(b.hours)} hours between ${clock12(b.window_start)} and ${clock12(b.window_end)}`
/** "Mon Oct 19, 2026 at 9:42 PM Central". */
export function stampWords(now: Date) {
  const c = central(now), d = new Date(c.date + 'T12:00:00Z')
  return `${niceDay(c.date)}, ${d.getUTCFullYear()} at ${clock12(fromMin(c.minutes))} Central`
}
/** The note that goes on the AxisCare client (and caregiver) when a family cancels. */
// deno-lint-ignore no-explicit-any
export function cancelNote(b: any, by: string, now: Date, late: boolean, lateHours: number, caregiver: string | null) {
  return `Visit cancelled by the family in the family app. Visit: ${visitWords(b)}. Cancelled by ${by} on ${stampWords(now)}.` +
    (caregiver ? ` ${caregiver} was scheduled and has been taken off the visit.` : ' No caregiver was placed yet.') +
    (late ? ` Late cancel (less than 24 hours before): charge the family ${lateHours} hours${caregiver ? ` and pay ${caregiver} ${lateHours} hours` : ''}.` : ' Cancelled 24 hours or more ahead: no charge.')
}
/** The text the caregiver gets. */
// deno-lint-ignore no-explicit-any
export function cancelText(b: any, caregiverFirst: string, clientName: string, late: boolean, lateHours: number, st?: any) {
  const sign = brand(brandFor(b?.state), st)?.short
  return `Hi ${caregiverFirst || 'there'}, the family cancelled ${clientName}'s visit on ${visitWords(b)}. It's off your schedule, so please don't go.` +
    (late ? ` Because it was cancelled less than 24 hours ahead, you'll still be paid for ${lateHours} hours.` : '') + (sign ? ` ${sign}` : '')
}

// deno-lint-ignore no-explicit-any
export const when = (b: any) => b.start_time ? `${b.visit_date} ${b.start_time} to ${b.end_time}` : `${b.visit_date}, flexible: ${Number(b.hours)} hours anytime ${b.window_start} to ${b.window_end}`
/** What a family's app shows for one of their bookings. */
// deno-lint-ignore no-explicit-any
export const bookingView = (b: any) => ({ id: b.id, date: b.visit_date, kind: b.kind === 'flex' ? 'flex' : 'set', start: b.start_time ?? null, end: b.end_time ?? null,
  window_start: b.window_start ?? b.start_time, window_end: b.window_end ?? b.end_time, hours: Number(b.hours), tasks: b.tasks, status: b.status, caregiver: b.caregiver_name ?? null,
  method: b.method === 'choose' ? 'choose' : 'auto', choose_by: b.method === 'choose' ? (b.choose_by ?? null) : null, interested: Number(b.interested_count ?? 0) })
const OPEN = ['received', 'practice', 'waiting_for_caregiver', 'needs_office']

/** Her rule 2026-10-16: the app is for ACTIVE clients only. A client AxisCare no longer lists as active closes the app for their
 *  family, whoever let them in. Test clients the office lists in ops_settings family_app_test_clients count as active. */
// deno-lint-ignore no-explicit-any
export const testClients = (st: any): string[] => Array.isArray(st?.family_app_test_clients) ? st.family_app_test_clients.map(String) : []
// deno-lint-ignore no-explicit-any
export const careActive = (client: any, axId: string, st: any) => client?.status?.active === true || testClients(st).includes(String(axId))

// deno-lint-ignore no-explicit-any
export async function familyAction(deps: Deps, user: { id: string; email?: string | null }, body: any): Promise<Out> {
  const who = (await deps.whoIs(user.id)).filter((w) => w.axiscare_client_id)
  if (!who.length) return say(403, { error: "This login isn't connected to anyone's care yet. Please call the office." })
  const action = String(body?.action ?? '')
  if (action === 'me') return say(200, { name: who[0].name, clients: who.map((w) => ({ id: w.axiscare_client_id, name: w.client_name, can_book: w.can_book })) })

  const w = body?.client ? who.find((x) => x.axiscare_client_id === String(body.client)) : who.length === 1 ? who[0] : null
  if (!w) return say(403, { error: 'Please pick whose care to look at.' })
  const st = await deps.settings()
  const now = deps.now(), today = central(now).date
  const cr = await deps.ax('GET', `/api/clients/${encodeURIComponent(w.axiscare_client_id)}`)
  if (cr.status !== 200) return say(502, { error: "We couldn't reach the schedule just now. Please try again in a minute." })
  const client = cr.json?.results?.client ?? cr.json?.results
  const state = stateOf(client)
  // The client's brand (her two-brand plan 2026-10-16): Missouri or Oklahoma from the AxisCare address, never guessed.
  const bnd = brand(brandFor(state), st)
  if (!careActive(client, w.axiscare_client_id, st)) return say(403, { error: `${String(client?.goesBy || client?.firstName || w.client_name || 'This client').trim()}'s care with us has ended, so the app is closed. Please call the office${bnd ? ` at ${bnd.phone}` : ''} with any questions.` })
  const clientName = String(client?.goesBy || client?.firstName || w.client_name || '').trim()
  const phone = (state ? st?.[`family_app_office_phone_${state}`] : null) ?? bnd?.phone ?? null

  if (action === 'home') {
    const visits = (await clientVisits(deps.ax, w.axiscare_client_id, today, addDays(today, 21))).map(visitView).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
    const mine = (await deps.bookings(w.axiscare_client_id)).filter((b) => b.visit_date >= today && OPEN.includes(b.status))
    const est = await estimateRate(deps.ax, w.axiscare_client_id, state, st, today)
    return say(200, { client: { id: w.axiscare_client_id, name: clientName, state }, brand: bnd ? { ...brandView(bnd), phone: phone ?? bnd.phone } : null, can_book: w.can_book, office_phone: phone, rate: est.rate, short_extra: est.short_extra, short_under_hours: est.short_under_hours, visits,
      waiting: mine.map(bookingView), tasks: tasksFor(state, st), hours: hoursFor(state, st) })
  }

  const herCaregivers = async () => {
    const past = await clientVisits(deps.ax, w.axiscare_client_id, addDays(today, -120), addDays(today, 21))
    const count = new Map<string, number>()
    for (const v of past) { const id = v?.caregiver?.id; if (id != null) count.set(String(id), (count.get(String(id)) ?? 0) + 1) }
    const cards = (await deps.profiles([...count.keys()])).filter(shareable).map((p) => ({ ...cardOf(p, deps.supabaseUrl), visits_together: count.get(String(p.axiscare_id)) ?? 0 }))
    const seen = new Set<string>(); return cards.sort((a, b) => b.visits_together - a.visits_together).filter((c) => !seen.has(c.axiscare_id) && seen.add(c.axiscare_id))
  }
  if (action === 'caregivers') return say(200, { caregivers: await herCaregivers() })

  if (action === 'bookings') {
    const list = (await deps.bookings(w.axiscare_client_id)).filter((b) => b.visit_date >= addDays(today, -30))
    const choosing = list.filter((b) => b.method === 'choose' && b.status === 'waiting_for_caregiver' && !b.caregiver_axiscare_id)
    const counts = choosing.length && deps.choose ? await deps.choose.counts(choosing.map((b) => String(b.id))) : {}
    return say(200, { bookings: list.map((b) => bookingView({ ...b, interested_count: counts[String(b.id)] ?? 0 })), choose: { live: chooseSettings(st).live && !!deps.choose, min_lead_hours: chooseSettings(st).minLead } })
  }

  // ── Let me choose: who's interested, pick one, or let us pick ──
  if (action === 'interested' || action === 'choose' || action === 'auto') {
    const b = (await deps.bookings(w.axiscare_client_id)).find((x) => x.id === String(body?.booking_id ?? ''))
    if (!b || b.status === 'cancelled') return say(404, { error: "We couldn't find that visit." })
    if (b.caregiver_axiscare_id || b.status !== 'waiting_for_caregiver') return say(409, { error: b.caregiver_name ? `${String(b.caregiver_name).split(' ')[0]} is already confirmed for this visit.` : 'This visit already has a caregiver.' })
    if (b.method !== 'choose') return say(409, { error: "We're already finding someone for this visit." })
    if (!deps.choose) return say(503, { error: "Choosing isn't available just now. Please call the office." })
    if (action === 'interested') return say(200, { booking: bookingView(b), caregivers: await deps.choose.list(b) })
    if (!w.can_book) return say(403, { error: 'Please call the office to change visits.' })
    const r = await deps.choose.place(b, action === 'choose' ? String(body?.offer_id ?? '') : null, action === 'choose' ? 'family' : 'switch')
    await deps.event({ actor_kind: 'person', actor_email: user.email ?? undefined, actor_name: w.name, via: 'link', verb: action === 'choose' ? 'family_chose' : 'family_let_us_pick', area: 'family_app',
      summary: `${w.name} ${action === 'choose' ? 'chose' : 'asked us to pick'} for ${b.client_name} ${when(b)}: ${r.placed ? `${r.name} placed` : r.message}`, data: { booking_id: b.id, placed: !!r.placed } })
    return say(r.ok ? 200 : 409, r.ok ? { ok: true, placed: !!r.placed, message: r.message } : { error: r.message, unavailable: r.unavailable ?? [] })
  }

  if (action === 'book') {
    if (!w.can_book) return say(403, { error: 'Booking is turned off for your login. Please call the office.' })
    if (!state) return say(409, { error: "We can't book online for this address yet. Please call the office." })
    const v = validateBooking(body, now, tasksFor(state, st), hoursFor(state, st))
    if (!v.ok) return say(400, { error: v.error })
    const method = String(body?.method ?? 'auto') === 'choose' ? 'choose' : 'auto'
    if (method === 'choose') { const ca = chooseAllowed(st, v.date, v.start ?? v.window_start, now); if (!ca.ok || !deps.choose) return say(400, { error: ca.ok ? '"Let me choose" isn\'t available just now. Pick "Find someone for me."' : ca.why }) }
    if (v.preferred.length) {
      const hers = new Set((await herCaregivers()).map((c) => c.axiscare_id))
      if (v.preferred.some((id) => !hers.has(id))) return say(400, { error: `Please pick from ${clientName}'s caregivers, or choose Whoever is available.` })
    }
    const vEnd = v.end ?? v.window_end, vStart = v.start ?? v.window_start
    const dup = (await deps.bookings(w.axiscare_client_id)).find((b) => b.visit_date === v.date && b.status !== 'cancelled' &&
      toMin(vStart) < toMin(b.end_time ?? b.window_end) && toMin(b.start_time ?? b.window_start) < toMin(vEnd))
    if (dup) return say(409, { error: 'You already have a visit booked for that time.', booking_id: dup.id })
    const row = { axiscare_client_id: w.axiscare_client_id, client_name: clientName, state, contact_id: w.contact_id, app_user_id: user.id, requested_by_name: w.name,
      kind: v.kind, visit_date: v.date, start_time: v.start, end_time: v.end, window_start: v.window_start, window_end: v.window_end, hours: v.hours, tasks: v.tasks, who: v.who, note: v.note || null,
      preferred_caregiver_ids: v.preferred, requested_caregiver_axiscare_id: v.preferred[0] ?? null, status: 'received',
      ...(method === 'choose' ? { method, choose_by: chooseBy(v.date, v.start ?? v.window_start, now, chooseSettings(st).deadline) } : {}) }
    const ins = await deps.insertBooking(row)
    if (!ins) return say(500, { error: "We couldn't save that booking. Nothing was booked. Please try again or call the office." })
    const b = { ...row, id: ins.id }
    const nowIso = now.toISOString()
    await deps.event({ actor_kind: 'person', actor_email: user.email ?? undefined, actor_name: w.name, via: 'link', verb: 'family_booked', area: 'family_app', summary: `${w.name} booked ${clientName} ${when(b)}`, data: { booking_id: b.id, kind: v.kind, live: appLive(st, w.axiscare_client_id) } })
    if (!appLive(st, w.axiscare_client_id)) {
      await deps.updateBooking(b.id, { status: 'practice' })
      return say(200, { ok: true, booking_id: b.id, status: 'practice', message: "Got it. (Practice mode: the office hasn't turned on live booking yet, so nothing was added to the schedule.)" })
    }
    const seeIt = method === 'choose' ? "Got it. We're asking caregivers now. You'll see who's interested here in the app, and you choose. If you haven't picked by the day before, we'll pick for you." : v.kind === 'flex' ? "You're booked. You'll see who's coming, and the exact time, here in the app once a caregiver confirms." : "You're booked. You'll see who's coming here in the app once a caregiver confirms."
    const offers = st?.family_offer_live === true
    const picks = v.preferred.length ? ` Asked for: ${v.preferred.length} of ${clientName}'s caregivers first.` : ''
    const needsOffice = async (why: string) => {
      await deps.updateBooking(b.id, { status: 'needs_office', error: why })
      await deps.officeItem(officeCard('book', b, `Family booked a visit: ${clientName}`, `${w.name} booked ${when(b)} in the app (${v.tasks.join(', ')}). It is NOT on the AxisCare schedule yet: ${why}`, nowIso))
      return say(200, { ok: true, booking_id: b.id, status: 'needs_office', message: "Got it. Our office will add it to the schedule and let you know who's coming." })
    }
    if (v.kind === 'flex') {
      // Stays in the Hub until a caregiver takes it and picks the start; only then does it go on AxisCare (it needs a fixed time).
      await deps.updateBooking(b.id, { status: 'waiting_for_caregiver' })
      if (!offers) await deps.officeItem(officeCard('book', b, `Pick a caregiver and a time: ${clientName}, ${b.visit_date}`, `${w.name} booked ${when(b)} in the app (${v.tasks.join(', ')}). Flexible: it goes on AxisCare when a caregiver is placed at a start inside the window.${picks}${v.note ? ` Note: ${v.note}` : ''}`, nowIso))
      return say(200, { ok: true, booking_id: b.id, status: 'waiting_for_caregiver', message: seeIt })
    }
    const put = await putOnSchedule(deps.ax, b, st)
    if (!put.ok) return needsOffice(put.why)
    const vid = put.vid
    await deps.updateBooking(b.id, { status: 'waiting_for_caregiver', axiscare_visit_id: String(vid) })
    if (!offers) await deps.officeItem(officeCard('book', { ...b, axiscare_visit_id: String(vid) }, `Place a caregiver: ${clientName}, ${when(b)}`, `${w.name} booked ${when(b)} in the app (${v.tasks.join(', ')}). It is on the AxisCare schedule with no caregiver yet.${picks}${v.note ? ` Note: ${v.note}` : ''}`, nowIso))
    return say(200, { ok: true, booking_id: b.id, status: 'waiting_for_caregiver', message: seeIt })
  }

  if (action === 'cancel') {
    if (!w.can_book) return say(403, { error: 'Please call the office to change visits.' })
    const b = (await deps.bookings(w.axiscare_client_id)).find((x) => x.id === String(body?.booking_id ?? ''))
    if (!b || b.status === 'cancelled') return say(404, { error: "We couldn't find that visit." })
    const left = hoursUntil(b.visit_date, startOf(b), now)
    if (left <= 0) return say(409, { error: `This visit has already started. Please call the office${phone ? ` at ${phone}` : ''}.` })
    const late = left < FREE_CANCEL_HOURS, lateHours = lateCancelHours(st)
    // Inside 24 hours the family has to say yes to the charge first (the app asks, then sends late_ok).
    if (late && body?.late_ok !== true) return say(409, { late: true, late_hours: lateHours,
      error: `This visit is less than 24 hours away, so ${lateHours} hours will still be charged. Cancel anyway?` })
    const nowIso = now.toISOString()
    const live = appLive(st, w.axiscare_client_id)
    const cgId = b.caregiver_axiscare_id ? String(b.caregiver_axiscare_id) : null
    const cgFirst = String(b.caregiver_name ?? '').trim().split(/\s+/)[0] || ''
    const cgName = cgId ? (String(b.caregiver_name ?? '').trim() || 'The caregiver') : null
    const problems: string[] = []
    let removed = !b.axiscare_visit_id, texted = false
    if (live && b.axiscare_visit_id) {
      const rid = await reasonId(deps.ax, st?.family_app_cancel_reason ?? 'Schedule Change - Client Cancellation')
      const del = await deps.ax('DELETE', `/api/visits/${encodeURIComponent(b.axiscare_visit_id)}` + (rid != null ? `?modificationReason=${rid}` : ''))
      removed = ok2(del.status)
      if (!removed) problems.push(`AxisCare refused to remove it (${del.status} ${axErr(del.json)}). Please remove it from the schedule${cgName ? ` and take ${cgName} off it` : ''}.`)
    }
    if (live) {
      const note = cancelNote(b, w.name, now, late, lateHours, cgName)
      const cn = await deps.ax('POST', `/api/notes/client/${encodeURIComponent(w.axiscare_client_id)}`, { note, important: late })
      if (!ok2(cn.status)) problems.push(`The note didn't save on ${clientName}'s AxisCare record (${cn.status}). Please add it: "${note}"`)
      if (cgId) {
        const gn = await deps.ax('POST', `/api/notes/caregiver/${encodeURIComponent(cgId)}`, { note, important: late })
        if (!ok2(gn.status)) problems.push(`The note didn't save on ${cgName}'s AxisCare record (${gn.status}).`)
        if (deps.textCaregiver) {
          const t = await deps.textCaregiver(cgId, cancelText(b, cgFirst, clientName, late, lateHours, st))
          texted = t.ok
          if (!t.ok) problems.push(`The text to ${cgName} didn't go (${t.why ?? 'unknown'}). Please call them: the visit is cancelled.`)
        } else problems.push(`Please let ${cgName} know the visit is cancelled.`)
      }
      if (late) problems.push(`Late cancel: add ${lateHours} hours for ${clientName} to this week's invoice${cgName ? ` and pay ${cgName} ${lateHours} hours` : ''}. AxisCare won't do this by itself because nobody clocks in.`)
    }
    if (problems.length) await deps.officeItem(officeCard('cancel', b, `${late ? 'Late cancel' : 'Family cancelled'}: ${clientName}, ${visitWords(b)}`,
      `${w.name} cancelled ${visitWords(b)} in the app on ${stampWords(now)}. ${problems.join(' ')}`, nowIso))
    if (deps.choose && b.method === 'choose') await deps.choose.cancelled(b, late)
    if (deps.closeItem) await deps.closeItem(`fam_book_${b.id}`, 'family app', `${w.name} cancelled this visit in the app on ${stampWords(now)}.`)
    await deps.updateBooking(b.id, { status: 'cancelled', cancelled_at: nowIso, cancelled_by: w.name, ...(removed ? {} : { error: 'AxisCare remove refused' }) })
    await deps.event({ actor_kind: 'person', actor_email: user.email ?? undefined, actor_name: w.name, via: 'link', verb: 'family_cancelled', area: 'family_app',
      summary: `${w.name} cancelled ${b.client_name} ${when(b)}${late ? ` (late: ${lateHours} hours charged)` : ''}`, data: { booking_id: b.id, late, late_hours: late ? lateHours : 0, caregiver_texted: texted, live } })
    if (!live) return say(200, { ok: true, late, message: `Cancelled. (Practice mode: nothing was on the schedule${late ? ', and nothing is charged' : ''}.)` })
    const tail = !removed ? ' Our office will finish taking it off the schedule.' : ''
    return say(200, { ok: true, late, message: late ? `Cancelled. Because it was less than 24 hours away, ${lateHours} hours will be on your weekly invoice.${tail}` : `Cancelled. Nothing is charged for it.${tail}` })
  }
  return say(400, { error: 'unknown action' })
}
