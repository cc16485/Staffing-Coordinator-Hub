/* =============================================================================
   OFFICE QUIET HOURS (Samantha, 2026-10-03, after the missed clock-in loop texted
   coordinators at 3am): "NO TEXTS that are informational about evv to the office
   number or admin at this hour".

   THE ONE PLACE the office's quiet hours live. Every automated text to the office
   number, an admin or a coordinator checks here first. Between 8pm and 7am Central:
     - nothing texts the office, an admin or a coordinator;
     - the Needs Attention item is still opened or kept up to date (that is where
       an overnight problem waits for the morning);
     - an email that a path already sends still goes (an email wakes nobody);
     - nothing is queued: a repeating alert simply skips its rounds and, at 7am,
       carries on with ONE text if the problem is still open, never a backlog.

   Caregiver-facing texts (a caregiver's own clock-in text, shift texts, callout
   asks) are NOT governed by this file.

   Hours: [start, end) on the Chicago clock. Default 20 (8pm, inclusive) to 7
   (7am, exclusive):
     19:59  texts allowed     the last minute of the day
     20:00  QUIET             eight o'clock is the start of quiet hours
     06:59  QUIET
     07:00  texts allowed     seven o'clock is the first allowed minute
   Overridable in ops_settings as office_quiet_start / office_quiet_end (whole
   hours 0-23). The same hour for both turns quiet hours off (only she would set
   that). Anything else invalid falls back to the defaults, never to "no quiet".

   The one exception in code today: a coverage call-in for a client whose call-in
   plan says "must be covered, no matter what" (her approval, CALLIN-PLAN.md:
   "the admin text goes at any hour"). Callers pass emergency: true for that alone.
   ============================================================================= */
// deno-lint-ignore-file no-explicit-any

export const OFFICE_TZ = 'America/Chicago'
export const OFFICE_QUIET_START = 20   // 8pm inclusive
export const OFFICE_QUIET_END = 7      // 7am exclusive

export type QuietWindow = { start: number; end: number }

const validHour = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : null
}

/** The window in force: ops_settings.office_quiet_start / office_quiet_end when both are valid, else 8pm to 7am. */
export function quietWindow(settings?: any): QuietWindow {
  const s = validHour(settings?.office_quiet_start), e = validHour(settings?.office_quiet_end)
  if (s === null || e === null) return { start: OFFICE_QUIET_START, end: OFFICE_QUIET_END }
  return { start: s, end: e }
}

/** Hour 0-23 on the Chicago clock (h23, so midnight is 0, never 24). */
export function chicagoHour(now: Date = new Date()): number {
  return Number(now.toLocaleString('en-US', { timeZone: OFFICE_TZ, hour: '2-digit', hourCycle: 'h23' })) % 24
}

const inWindow = (h: number, w: QuietWindow): boolean =>
  w.start === w.end ? false
  : w.start > w.end ? (h >= w.start || h < w.end)      // spans midnight (the normal case: 20 to 7)
  : (h >= w.start && h < w.end)

/** Is it the office's quiet hours right now? */
export function officeQuiet(now: Date = new Date(), settings?: any): boolean {
  return inWindow(chicagoHour(now), quietWindow(settings))
}

/** Did any part of [fromMs, toMs] fall in quiet hours? (Checked every 5 minutes; for "this became due overnight".) */
export function officeQuietBetween(fromMs: number, toMs: number, settings?: any): boolean {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return false
  const w = quietWindow(settings)
  if (w.start === w.end) return false
  const a = Math.min(fromMs, toMs), b = Math.max(fromMs, toMs)
  for (let t = a; t < b; t += 5 * 60_000) if (inWindow(chicagoHour(new Date(t)), w)) return true
  return inWindow(chicagoHour(new Date(b)), w)
}

const hourWord = (h: number) => `${h % 12 || 12}${h >= 12 ? 'pm' : 'am'}`
/** "8pm to 7am" (for wording on cards, settings and run summaries). */
export function quietWords(settings?: any): string {
  const w = quietWindow(settings)
  return w.start === w.end ? 'off' : `${hourWord(w.start)} to ${hourWord(w.end)}`
}

/** For a function that has the database but not the settings: reads ops_settings (defaults if it can't). */
export async function officeQuietNow(sb: any, now: Date = new Date()): Promise<boolean> {
  let settings: any = null
  try {
    const { data } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
    settings = data?.data ?? null
  } catch { /* the defaults */ }
  return officeQuiet(now, settings)
}

/** A run summary line: { quiet, hours } so a log says why nothing went. */
export const quietInfo = (now: Date = new Date(), settings?: any) =>
  ({ quiet: officeQuiet(now, settings), hours: quietWords(settings), tz: OFFICE_TZ })
