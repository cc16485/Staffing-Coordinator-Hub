// =============================================================================
// answer-by — when a family app request is asked and when the family hears back. Samantha approved 2026-10-17 (decisions 1,
// 2 and 7: https://claude.ai/artifact/AS6GbybmUqC47WKPto44p8):
//   * Caregivers are texted 8 AM to 9 PM, every day; never at night for an optional visit.
//   * Up to 7 days ahead: everyone is asked from the start; the family hears by 6 PM the day before.
//   * More than 7 days ahead (two stages): the family's chosen caregivers now; the wider team from 8 AM, 7 days before;
//     the family hears by 6 PM, 2 days before.
//   * Short notice (6 PM the day before leaves under 4 texting hours): until 2 hours before the visit, never after 7:30 PM
//     (a close before 8 AM moves to 7:30 PM the evening before).
//   * Under 2 texting hours before the close: the time can't be requested (the app greys it out and shows the earliest).
// Pure (Central wall clock) so it runs the same in the family door, the offer run and Node tests.
// Hub settings may adjust the numbers: family_ask_* keys (see askRules).
// =============================================================================
export const TZ = 'America/Chicago'
// deno-lint-ignore no-explicit-any
type Any = any
const num = (v: unknown, d: number) => Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d
export function askRules(st: Any = {}) {
  return {
    textFrom: num(st?.family_ask_text_from, 8), textUntil: num(st?.family_ask_text_until, 21),   // caregiver texts [from, until)
    closeHour: num(st?.family_ask_close_hour, 18),            // 6 PM the day before
    twoStageDays: num(st?.family_ask_two_stage_days, 7),       // more than this many days ahead = two stages
    twoStageCloseDays: num(st?.family_ask_two_stage_close_days, 2),
    shortNeedHours: num(st?.family_ask_short_need_hours, 4),   // texting hours needed before "6 PM the day before" counts
    minTextHours: num(st?.family_ask_min_text_hours, 2),       // fewer = can't be requested
    shortBeforeHours: num(st?.family_ask_short_before_hours, 2),
    lastOutcome: String(st?.family_ask_last_outcome ?? '19:30'), // nothing ends (and no "not filled" goes) later than this
    earlyEndHours: num(st?.family_ask_early_end_hours, 24),    // nobody left to ask + this long = tell the family now
  }
}
const hm = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0) }
/** Central wall clock parts of an instant. */
export function wall(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(d).map((x) => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, min: (Number(p.hour) % 24) * 60 + Number(p.minute) }
}
/** The instant of a Central wall-clock date and minute (daylight saving handled). */
export function at(date: string, min: number): Date {
  const want = Date.parse(`${date}T00:00:00Z`) + min * 60000
  let t = want + 5 * 3600000
  for (let i = 0; i < 3; i++) {
    const w = wall(new Date(t)), diff = (Date.parse(`${w.date}T00:00:00Z`) + w.min * 60000) - want
    if (!diff) break
    t -= diff
  }
  return new Date(t)
}
export const addDays = (date: string, n: number) => { const x = new Date(date + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
/** Hours of caregiver texting time between two instants. */
export function textHours(a: Date, b: Date, r = askRules()): number {
  if (b <= a) return 0
  let h = 0, day = wall(a).date
  const last = wall(b).date
  for (let i = 0; i < 400 && day <= last; i++, day = addDays(day, 1)) {
    const s = Math.max(a.getTime(), at(day, r.textFrom * 60).getTime()), e = Math.min(b.getTime(), at(day, r.textUntil * 60).getTime())
    if (e > s) h += (e - s) / 3600000
  }
  return h
}
/** When caregivers may first be texted: now inside texting hours, else the next morning. */
export function askStart(now: Date, r = askRules()): Date {
  const w = wall(now)
  if (w.min >= r.textFrom * 60 && w.min < r.textUntil * 60) return now
  return at(w.min < r.textFrom * 60 ? w.date : addDays(w.date, 1), r.textFrom * 60)
}
export type AskPlan = { ok: true; asking_from: string; team_from: string; answer_by: string; two_stage: boolean; rule: string } | { ok: false; why: 'too_soon' }
/** The plan for a request for `date` at `start` (HH:MM; a flexible visit's window start). */
export function planRequest(now: Date, date: string, start: string, st: Any = {}): AskPlan {
  const r = askRules(st), visit = at(date, hm(start)), a = askStart(now, r)
  if (visit.getTime() - now.getTime() > r.twoStageDays * 86400000) {
    const team = at(addDays(date, -r.twoStageDays), r.textFrom * 60)
    return { ok: true, asking_from: a.toISOString(), team_from: (team > a ? team : a).toISOString(), answer_by: at(addDays(date, -r.twoStageCloseDays), r.closeHour * 60).toISOString(), two_stage: true, rule: 'two stages' }
  }
  const eve = at(addDays(date, -1), r.closeHour * 60)
  if (eve > a && textHours(a, eve, r) >= r.shortNeedHours) return { ok: true, asking_from: a.toISOString(), team_from: a.toISOString(), answer_by: eve.toISOString(), two_stage: false, rule: 'the day before' }
  let close = new Date(visit.getTime() - r.shortBeforeHours * 3600000)
  const cw = wall(close), last = hm(r.lastOutcome)
  if (cw.min < r.textFrom * 60) close = at(addDays(cw.date, -1), last)
  else if (cw.min > last) close = at(cw.date, last)
  if (close <= a || textHours(a, close, r) < r.minTextHours) return { ok: false, why: 'too_soon' }
  return { ok: true, asking_from: a.toISOString(), team_from: a.toISOString(), answer_by: close.toISOString(), two_stage: false, rule: 'short notice' }
}
/** The earliest half-hour start between open and close (HH:MM) on `date` that can still be requested, or null. */
export function earliestStart(now: Date, date: string, open: string, close: string, hours: number, st: Any = {}): string | null {
  for (let m = hm(open); m + hours * 60 <= hm(close); m += 30) {
    const s = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    if (planRequest(now, date, s, st).ok) return s
  }
  return null
}
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "Mon, Oct 19, 6 PM" / "Tue, Oct 20, 7:30 PM" for an instant (Central). */
export function words(iso: string): string {
  const w = wall(new Date(iso)), d = new Date(w.date + 'T12:00:00Z'), h = Math.floor(w.min / 60), m = w.min % 60
  return `${DAY[d.getUTCDay()]}, ${MON[d.getUTCMonth()]} ${d.getUTCDate()}, ${(h + 11) % 12 + 1}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`
}
/** Inside a [from, until) hour window on the Central clock; until may be fractional (19.5 = 7:30 PM). */
export function inHours(now: Date, from: number, until: number) { const m = wall(now).min; return m >= from * 60 && m < until * 60 }
