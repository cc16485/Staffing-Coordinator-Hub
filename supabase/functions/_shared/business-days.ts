// =============================================================================
// business-days.ts · the onboarding business-day clock (Slice 0, approved by Samantha 2026-10-08)
// =============================================================================
// Onboarding deadlines are "5pm Central on the next business day". A business day is Monday to Friday that is not on
// the company holidays list (Owners Hub Admin page, ops_settings.company_holidays, dates as YYYY-MM-DD). Everything
// here is pure: no clock, no database, no network; the caller passes the instant and the holiday list. 5pm Central is
// found by asking the Chicago calendar for each candidate instant, never by a fixed offset, so daylight saving is right
// on both sides of the change. Nothing in this file sends, schedules or changes anything.
export const TZ = 'America/Chicago'
export type Holiday = { date: string; name?: string }
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/

export function isYmd(s: unknown): s is string {
  if (typeof s !== 'string' || !YMD.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d, 12))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}
const pad = (n: number) => String(n).padStart(2, '0')
const ymdOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

type Parts = { y: number; m: number; d: number; h: number; mi: number }
const FMT = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
/** The Chicago wall-clock parts of an instant. */
export function centralParts(at: Date | string | number): Parts {
  const t = at instanceof Date ? at : new Date(at)
  const o: Record<string, string> = {}
  for (const p of FMT.formatToParts(t)) if (p.type !== 'literal') o[p.type] = p.value
  return { y: Number(o.year), m: Number(o.month), d: Number(o.day), h: Number(o.hour) % 24, mi: Number(o.minute) }
}
/** The Chicago calendar date (YYYY-MM-DD) of an instant. */
export function centralYmd(at: Date | string | number): string { const p = centralParts(at); return ymdOf(p.y, p.m, p.d) }

export function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n, 12))
  return ymdOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}
export function weekdayOf(ymd: string): number { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() }
export function isWeekend(ymd: string): boolean { const w = weekdayOf(ymd); return w === 0 || w === 6 }

/** The holiday list as the Admin page saves it (objects with a date) or plain date strings; anything else is ignored. */
export function holidayDates(list: unknown): Set<string> {
  const out = new Set<string>()
  if (!Array.isArray(list)) return out
  for (const h of list) {
    const d = typeof h === 'string' ? h : (h && typeof h === 'object') ? (h as Holiday).date : ''
    if (isYmd(d)) out.add(d)
  }
  return out
}
export function isBusinessDay(ymd: string, holidays: unknown): boolean {
  return isYmd(ymd) && !isWeekend(ymd) && !holidayDates(holidays).has(ymd)
}
/** The n-th business day strictly after ymd. */
export function nextBusinessDay(ymd: string, holidays: unknown, n = 1): string {
  const hs = holidayDates(holidays)
  let d = ymd, left = Math.max(1, Math.floor(n))
  for (let guard = 0; guard < 400 && left > 0; guard++) { d = addDaysYmd(d, 1); if (!isWeekend(d) && !hs.has(d)) left-- }
  return d
}
/** Business days strictly after `fromYmd` up to and including `toYmd` (0 when toYmd is not after fromYmd). */
export function businessDaysBetween(fromYmd: string, toYmd: string, holidays: unknown): number {
  if (!isYmd(fromYmd) || !isYmd(toYmd) || toYmd <= fromYmd) return 0
  const hs = holidayDates(holidays)
  let n = 0, d = fromYmd
  for (let guard = 0; guard < 4000 && d < toYmd; guard++) { d = addDaysYmd(d, 1); if (!isWeekend(d) && !hs.has(d)) n++ }
  return n
}
/** The instant of a Chicago wall-clock time on a date (daylight saving checked against the calendar, not assumed). */
export function centralInstant(ymd: string, hour: number, minute = 0): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  for (const off of [5, 6]) {
    const t = new Date(Date.UTC(y, m - 1, d, hour + off, minute))
    const p = centralParts(t)
    if (p.y === y && p.m === m && p.d === d && p.h === hour && p.mi === minute) return t
  }
  return new Date(Date.UTC(y, m - 1, d, hour + 6, minute))
}
/** "Due by 5pm Central on the next business day" after the Chicago date of `from`. ISO instant. */
export function dueNextBusinessDay(from: Date | string | number, holidays: unknown, hour = 17, days = 1): string {
  const due = nextBusinessDay(centralYmd(from), holidays, days)
  return centralInstant(due, hour).toISOString()
}
/** How long something has waited, in whole business days up to `now` (Chicago dates). */
export function businessDaysWaiting(since: Date | string | number, now: Date | string | number, holidays: unknown): number {
  return businessDaysBetween(centralYmd(since), centralYmd(now), holidays)
}

/* The eleven United States federal holidays, with the federal observance rule (a Saturday holiday is observed on the
   Friday before, a Sunday holiday on the Monday after). The office removes the ones it does not observe. */
function nthWeekday(y: number, m: number, weekday: number, n: number): string {
  const first = weekdayOf(ymdOf(y, m, 1))
  const d = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7
  return ymdOf(y, m, d)
}
function lastWeekday(y: number, m: number, weekday: number): string {
  const lastDay = new Date(Date.UTC(y, m, 0, 12)).getUTCDate()
  const w = weekdayOf(ymdOf(y, m, lastDay))
  return ymdOf(y, m, lastDay - ((w - weekday + 7) % 7))
}
function observed(ymd: string): string { const w = weekdayOf(ymd); return w === 6 ? addDaysYmd(ymd, -1) : w === 0 ? addDaysYmd(ymd, 1) : ymd }
export function federalHolidays(year: number): Holiday[] {
  const y = Math.floor(year)
  return [
    { date: observed(ymdOf(y, 1, 1)), name: "New Year's Day" },
    { date: nthWeekday(y, 1, 1, 3), name: 'Martin Luther King Jr. Day' },
    { date: nthWeekday(y, 2, 1, 3), name: "Presidents' Day" },
    { date: lastWeekday(y, 5, 1), name: 'Memorial Day' },
    { date: observed(ymdOf(y, 6, 19)), name: 'Juneteenth' },
    { date: observed(ymdOf(y, 7, 4)), name: 'Independence Day' },
    { date: nthWeekday(y, 9, 1, 1), name: 'Labor Day' },
    { date: nthWeekday(y, 10, 1, 2), name: 'Columbus Day' },
    { date: observed(ymdOf(y, 11, 11)), name: 'Veterans Day' },
    { date: nthWeekday(y, 11, 4, 4), name: 'Thanksgiving Day' },
    { date: observed(ymdOf(y, 12, 25)), name: 'Christmas Day' },
  ]
}
