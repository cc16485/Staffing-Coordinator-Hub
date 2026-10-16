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

export const OPEN_AT = 8 * 60, CLOSE_AT = 18 * 60, MIN_HOURS = 2, NOTICE_MIN = 120, MAX_DAYS_AHEAD = 60, AUTO_NOTICE_HOURS = 24, FREE_CANCEL_HOURS = 24
export const WHO = ['regular', 'favorites', 'any']

export type BookingIn = { date?: unknown; start?: unknown; hours?: unknown; tasks?: unknown; who?: unknown; note?: unknown; caregiver_axiscare_id?: unknown }
export type BookingOk = { ok: true; date: string; start: string; end: string; hours: number; tasks: string[]; who: string; note: string; caregiver_axiscare_id: string | null }
/** The approved rules: weekdays 8 AM to 6 PM, 2 hours or more (half hours ok), at least 2 hours' notice, up to 60 days ahead. */
export function validateBooking(b: BookingIn, now: Date, allowedTasks: string[]): BookingOk | { ok: false; error: string } {
  const date = String(b.date ?? ''), start = String(b.start ?? ''), hours = Number(b.hours)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date + 'T12:00:00Z'))) return { ok: false, error: 'Please pick a day.' }
  const d = dowOf(date)
  if (d === 0 || d === 6) return { ok: false, error: 'Visits are Monday to Friday.' }
  const s = toMin(start)
  if (isNaN(s) || s % 30 !== 0) return { ok: false, error: 'Please pick a start time.' }
  if (!(hours >= MIN_HOURS) || (hours * 2) % 1 !== 0) return { ok: false, error: 'Visits are at least 2 hours.' }
  const e = s + hours * 60
  if (s < OPEN_AT || e > CLOSE_AT) return { ok: false, error: 'Visits run between 8 AM and 6 PM.' }
  const c = central(now), ahead = dayDiff(c.date, date)
  if (ahead < 0 || (ahead === 0 && s - c.minutes < NOTICE_MIN)) return { ok: false, error: 'Please book at least 2 hours ahead. For sooner help, call the office.' }
  if (ahead > MAX_DAYS_AHEAD) return { ok: false, error: 'You can book up to 60 days ahead.' }
  const tasks = Array.isArray(b.tasks) ? [...new Set(b.tasks.map(String))] : []
  if (!tasks.length) return { ok: false, error: 'Please pick what would help.' }
  const bad = tasks.find((t) => !allowedTasks.includes(t))
  if (bad) return { ok: false, error: `"${bad}" isn't something we can book in the app. Please call the office.` }
  const who = WHO.includes(String(b.who)) ? String(b.who) : 'regular'
  const note = String(b.note ?? '').trim().slice(0, 1000)
  const cg = b.caregiver_axiscare_id != null && /^\d+$/.test(String(b.caregiver_axiscare_id)) ? String(b.caregiver_axiscare_id) : null
  return { ok: true, date, start: fromMin(s), end: fromMin(e), hours, tasks, who, note, caregiver_axiscare_id: cg }
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
 *  clients, her rule 2026-10-15); Hub settings family_app_short_extra_<STATE> / family_app_short_under_hours. An estimate only:
 *  the invoice is AxisCare's, from the caregiver's actual clock-in and clock-out. */
export async function estimateRate(ax: Ax, clientId: string, state: string | null, st: any, today: string) {   // deno-lint-ignore no-explicit-any
  let rate: number | null = null
  try {
    const past = await clientVisits(ax, clientId, addDays(today, -120), today)
    const priced = past.filter((v) => Number(v?.chargeRate) > 0 && String(v?.billableRateMode ?? '').toLowerCase() !== 'custom')
      .sort((a, b) => String(b?.scheduledStartDate ?? b?.startDate ?? '').localeCompare(String(a?.scheduledStartDate ?? a?.startDate ?? '')))
    if (priced.length) rate = Number(priced[0].chargeRate)
  } catch { /* no estimate is better than a wrong one */ }
  if (rate == null && Number(st?.[`family_app_rate_${state}`]) > 0) rate = Number(st[`family_app_rate_${state}`])
  const extraSet = st?.[`family_app_short_extra_${state}`]
  const short_extra = extraSet != null ? Math.max(0, Number(extraSet) || 0) : (state === 'MO' ? 5 : 0)
  const short_under_hours = Number(st?.family_app_short_under_hours) > 0 ? Number(st.family_app_short_under_hours) : 4
  return { rate, short_extra, short_under_hours }
}

/** Put a booking on the AxisCare schedule with no caregiver, then read it back. Never trust a 200. */
// deno-lint-ignore no-explicit-any
export async function putOnSchedule(ax: Ax, b: any, st: any): Promise<{ ok: true; vid: string } | { ok: false; why: string }> {
  const service = st?.[`family_app_service_${b.state}`]
  if (!service) return { ok: false, why: `no app service is set for ${b.state} in the Hub settings` }
  const post: Record<string, unknown> = { clientId: Number(b.axiscare_client_id), visitDate: b.visit_date, startTime: b.start_time, endTime: b.end_time, caregiverId: null, serviceCode: service }
  const rid = await reasonId(ax, st?.family_app_create_reason)
  if (rid != null) post.modificationReason = rid
  const made = await ax('POST', '/api/visits', post)
  if (!ok2(made.status)) return { ok: false, why: `AxisCare refused the visit (${made.status} ${axErr(made.json)})` }
  let vid = visitIdOf(made.json)
  if (!vid) vid = (await clientVisits(ax, String(b.axiscare_client_id), b.visit_date, b.visit_date)).map(visitView).find((x) => x.start === b.start_time && !x.caregiver)?.id ?? null
  const back = vid ? await ax('GET', `/api/visits/${encodeURIComponent(String(vid))}`) : { status: 0, json: null }
  const bv = back.status === 200 ? visitView(visitOf(back.json)) : null
  if (!bv || bv.date !== b.visit_date || bv.start !== b.start_time || bv.end !== b.end_time) return { ok: false, why: `AxisCare took the visit but it didn't read back as booked${vid ? ` (visit ${vid})` : ''}; please check the schedule` }
  return { ok: true, vid: String(vid) }
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
}
type Out = { status: number; body: Record<string, unknown> }
const say = (status: number, body: Record<string, unknown>): Out => ({ status, body })

export function officeCard(kind: string, b: any, title: string, detail: string, nowIso: string) {   // deno-lint-ignore no-explicit-any
  return { id: `fam_${kind}_${b.id}`, kind: 'family_booking', domain: 'scheduling_coverage', status: 'open', urgency: kind === 'cancel' ? 'soon' : 'today',
    title, about: b.client_name, who: b.requested_by_name, detail, next_action: kind === 'cancel' ? 'Let the caregiver know the visit is cancelled.' : 'Place a caregiver on this visit (Scheduling, Family bookings).',
    created_at: nowIso, first_at: nowIso, last_at: nowIso, last_activity_at: nowIso, created_by: 'family app', opened_by: 'family app',
    source: { kind: 'family_booking', booking_id: b.id, axiscare_visit_id: b.axiscare_visit_id ?? null }, history: [{ at: nowIso, by: 'family app', text: detail }] }
}
const when = (b: any) => `${b.visit_date} ${b.start_time} to ${b.end_time}`   // deno-lint-ignore no-explicit-any

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
  const clientName = String(client?.goesBy || client?.firstName || w.client_name || '').trim()
  const phone = st?.[`family_app_office_phone_${state}`] ?? (state === 'MO' ? '(417) 234-8494' : null)

  if (action === 'home') {
    const visits = (await clientVisits(deps.ax, w.axiscare_client_id, today, addDays(today, 21))).map(visitView).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
    const mine = (await deps.bookings(w.axiscare_client_id)).filter((b) => b.visit_date >= today && ['received', 'practice', 'waiting_for_caregiver', 'needs_office'].includes(b.status))
    const est = await estimateRate(deps.ax, w.axiscare_client_id, state, st, today)
    return say(200, { client: { id: w.axiscare_client_id, name: clientName, state }, can_book: w.can_book, office_phone: phone, rate: est.rate, short_extra: est.short_extra, short_under_hours: est.short_under_hours, visits,
      waiting: mine.map((b) => ({ id: b.id, date: b.visit_date, start: b.start_time, end: b.end_time, status: b.status })), tasks: tasksFor(state, st) })
  }

  if (action === 'caregivers') {
    const past = await clientVisits(deps.ax, w.axiscare_client_id, addDays(today, -120), addDays(today, 21))
    const count = new Map<string, number>()
    for (const v of past) { const id = v?.caregiver?.id; if (id != null) count.set(String(id), (count.get(String(id)) ?? 0) + 1) }
    const cards = (await deps.profiles([...count.keys()])).filter(shareable).map((p) => ({ ...cardOf(p, deps.supabaseUrl), visits_together: count.get(String(p.axiscare_id)) ?? 0 }))
    const seen = new Set<string>(); const out = cards.sort((a, b) => b.visits_together - a.visits_together).filter((c) => !seen.has(c.axiscare_id) && seen.add(c.axiscare_id))
    return say(200, { caregivers: out })
  }

  if (action === 'bookings') {
    const list = (await deps.bookings(w.axiscare_client_id)).filter((b) => b.visit_date >= addDays(today, -30))
    return say(200, { bookings: list.map((b) => ({ id: b.id, date: b.visit_date, start: b.start_time, end: b.end_time, hours: Number(b.hours), tasks: b.tasks, status: b.status, caregiver: b.caregiver_name ?? null })) })
  }

  if (action === 'book') {
    if (!w.can_book) return say(403, { error: 'Booking is turned off for your login. Please call the office.' })
    if (!state) return say(409, { error: "We can't book online for this address yet. Please call the office." })
    const v = validateBooking(body, now, tasksFor(state, st))
    if (!v.ok) return say(400, { error: v.error })
    const dup = (await deps.bookings(w.axiscare_client_id)).find((b) => b.visit_date === v.date && b.start_time === v.start && b.status !== 'cancelled')
    if (dup) return say(409, { error: 'That visit is already booked.', booking_id: dup.id })
    const row = { axiscare_client_id: w.axiscare_client_id, client_name: clientName, state, contact_id: w.contact_id, app_user_id: user.id, requested_by_name: w.name,
      visit_date: v.date, start_time: v.start, end_time: v.end, hours: v.hours, tasks: v.tasks, who: v.who, note: v.note || null,
      requested_caregiver_axiscare_id: v.caregiver_axiscare_id, status: 'received' }
    const ins = await deps.insertBooking(row)
    if (!ins) return say(500, { error: "We couldn't save that booking. Nothing was booked. Please try again or call the office." })
    const b = { ...row, id: ins.id }
    const nowIso = now.toISOString()
    await deps.event({ actor_kind: 'person', actor_email: user.email ?? undefined, actor_name: w.name, via: 'link', verb: 'family_booked', area: 'family_app', summary: `${w.name} booked ${clientName} ${when(b)}`, data: { booking_id: b.id, live: st?.family_app_live === true } })
    if (st?.family_app_live !== true) {
      await deps.updateBooking(b.id, { status: 'practice' })
      return say(200, { ok: true, booking_id: b.id, status: 'practice', message: "Got it. (Practice mode: the office hasn't turned on live booking yet, so nothing was added to the schedule.)" })
    }
    const needsOffice = async (why: string) => {
      await deps.updateBooking(b.id, { status: 'needs_office', error: why })
      await deps.officeItem(officeCard('book', b, `Family booked a visit: ${clientName}`, `${w.name} booked ${when(b)} in the app (${v.tasks.join(', ')}). It is NOT on the AxisCare schedule yet: ${why}`, nowIso))
      return say(200, { ok: true, booking_id: b.id, status: 'needs_office', message: "Got it. Our office will add it to the schedule and let you know who's coming." })
    }
    const put = await putOnSchedule(deps.ax, b, st)
    if (!put.ok) return needsOffice(put.why)
    const vid = put.vid
    await deps.updateBooking(b.id, { status: 'waiting_for_caregiver', axiscare_visit_id: String(vid) })
    await deps.officeItem(officeCard('book', { ...b, axiscare_visit_id: String(vid) }, `Place a caregiver: ${clientName}, ${when(b)}`, `${w.name} booked ${when(b)} in the app (${v.tasks.join(', ')}). It is on the AxisCare schedule with no caregiver yet.${v.note ? ` Note: ${v.note}` : ''}`, nowIso))
    return say(200, { ok: true, booking_id: b.id, status: 'waiting_for_caregiver', message: "You're booked. We'll let you know who's coming." })
  }

  if (action === 'cancel') {
    if (!w.can_book) return say(403, { error: 'Please call the office to change visits.' })
    const b = (await deps.bookings(w.axiscare_client_id)).find((x) => x.id === String(body?.booking_id ?? ''))
    if (!b || b.status === 'cancelled') return say(404, { error: "We couldn't find that visit." })
    if (hoursUntil(b.visit_date, b.start_time, now) < FREE_CANCEL_HOURS) return say(409, { error: `Within 24 hours of a visit, please call the office to cancel${phone ? ` at ${phone}` : ''}.` })
    const nowIso = now.toISOString()
    if (b.axiscare_visit_id && st?.family_app_live === true) {
      const rid = await reasonId(deps.ax, st?.family_app_cancel_reason ?? 'Schedule Change - Client Cancellation')
      const del = await deps.ax('DELETE', `/api/visits/${encodeURIComponent(b.axiscare_visit_id)}` + (rid != null ? `?modificationReason=${rid}` : ''))
      if (!ok2(del.status)) {
        await deps.officeItem(officeCard('cancel', b, `Family cancelled: ${b.client_name}, ${when(b)}`, `${w.name} cancelled ${when(b)} in the app, but AxisCare refused to remove it (${del.status} ${axErr(del.json)}). Please remove it from the schedule.`, nowIso))
        await deps.updateBooking(b.id, { status: 'cancelled', cancelled_at: nowIso, cancelled_by: w.name, error: `AxisCare remove refused: ${del.status}` })
        return say(200, { ok: true, message: "Cancelled. Our office will finish taking it off the schedule." })
      }
      if (b.caregiver_axiscare_id) await deps.officeItem(officeCard('cancel', b, `Family cancelled: ${b.client_name}, ${when(b)}`, `${w.name} cancelled ${when(b)} in the app. ${b.caregiver_name ?? 'The caregiver'} was booked on it. Please let them know.`, nowIso))
    }
    await deps.updateBooking(b.id, { status: 'cancelled', cancelled_at: nowIso, cancelled_by: w.name })
    await deps.event({ actor_kind: 'person', actor_email: user.email ?? undefined, actor_name: w.name, via: 'link', verb: 'family_cancelled', area: 'family_app', summary: `${w.name} cancelled ${b.client_name} ${when(b)}`, data: { booking_id: b.id } })
    return say(200, { ok: true, message: 'Cancelled. Nothing is charged for it.' })
  }
  return say(400, { error: 'unknown action' })
}
