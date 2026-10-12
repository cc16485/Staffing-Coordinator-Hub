// =============================================================================
// new-hire.ts · a new hire who still needs hours (Samantha 2026-10-12: "a good place to put so clearly new hires until
// they are scheduled ... show what their availability is and make them a priority to get them hours scheduled", and B:
// "tag them and put them first among people who fit equally well").
//   A new hire = hired in AxisCare (hireDate) in the last 60 days, and not in the future.
//   Needs hours = nothing scheduled in the next 14 days, or (when they set a weekly target on their availability form)
//   fewer scheduled hours a week than that target.
// Used by coverage-shifts (the Team Builder pool and the Hours & matching card) and coverage-run (Cara's ask lists).
// It never makes anyone eligible or ineligible: it only tags and, among people who fit equally well, puts them first.
// =============================================================================
export const NEW_HIRE_DAYS = 60
const ymd = (s: unknown) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? '')); return m ? `${m[1]}-${m[2]}-${m[3]}` : '' }
const dayNum = (d: string) => Math.floor(Date.parse(d + 'T12:00:00Z') / 86400000)

export type NewHireNeed = { hired: string; days: number; scheduled_14d: number; target_week: number | null }
export function newHireNeed(hireDate: unknown, today: string, scheduledHours14: number, targetWeek: unknown): NewHireNeed | null {
  const h = ymd(hireDate), t = ymd(today); if (!h || !t) return null
  const days = dayNum(t) - dayNum(h)
  if (days < 0 || days > NEW_HIRE_DAYS) return null
  const sched = Math.max(0, Number(scheduledHours14) || 0)
  const target = Number(targetWeek); const hasTarget = Number.isFinite(target) && target > 0
  const short = sched === 0 || (hasTarget && sched / 2 < target)
  return short ? { hired: h, days, scheduled_14d: Math.round(sched * 10) / 10, target_week: hasTarget ? target : null } : null
}
