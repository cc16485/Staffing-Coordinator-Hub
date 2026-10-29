// PRN STEP 5a (Samantha 2026-10-29: "Yes, texts respect it"; her decision 11, 2026-10-28: a break-until date is one of the three
// ways a caregiver is explicitly unavailable). A PRN member can set "I'm taking a break until ___" on their PRN Team page
// (job_applicants.prn.break_until, a Central date). Until that date has passed, no shift text asks them: the automatic rounds
// (coverage-run prnFit) and Cara's waves (cara-waves prnRule) both leave them out with this reason. It ends by itself.
const S = (v: unknown, n = 40) => String(v ?? '').trim().slice(0, n)
const word = (ymd: string) => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
/** The reason a PRN member is on a break for a shift on `shiftDate` (or for today, with no date), or null. */
export function onBreak(breakUntil: unknown, shiftDate: unknown, today?: string): string | null {
  const until = S(breakUntil, 10)
  if (!/^\d{4}-\d\d-\d\d$/.test(until)) return null
  const d = /^\d{4}-\d\d-\d\d$/.test(S(shiftDate, 10)) ? S(shiftDate, 10) : (today || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }))
  return d <= until ? `PRN Team: on a break until ${word(until)} (they told us on their PRN Team page)` : null
}
