// =============================================================================
// OPEN SHIFTS WITH NO COVERAGE CASE (2026-10-18, the Today page map, Samantha's yes)
// =============================================================================
// The Dashboard's "Today in AxisCare" and the Staffing view listed visits with no caregiver, but only on that screen:
// a shift the watcher does not open a case for (no modification reason, a reason that is not a call-off, a one-off
// date the ongoing sweep skips) was on nobody's list. Now each one inside the next 36 hours becomes ONE card in My Work
// for the scheduling owner: "Open shift, nobody assigned". It closes itself when AxisCare shows a caregiver, a coverage
// case opens for it, the visit goes away, or it starts. Paused and ended clients are already skipped by the watcher.
// AxisCare's null caregiver can also mean a caregiver who is no longer active; the card says so.
// PRACTICE unless ops_settings.open_shift_cards_live === true: the watcher's answer lists what it would make.
// Nothing is ever sent to anyone.
// =============================================================================
export const OPEN_SHIFT_HOURS = 36, OPEN_SHIFT_PER_RUN = 15
export const OPEN_SHIFT_KIND = 'open_shift'
export const openShiftId = (visitId: string) => 'ops_open_' + String(visitId).replace(/[^A-Za-z0-9]/g, '_').slice(-60)
/** The schedule a visit id belongs to ("s=<schedule>:d=<date>"), or ''. */
export const scheduleOf = (visitId: string) => (String(visitId).match(/^s=([^:]+):/) || [])[1] || ''

export type OpenVisit = { visitId: string; client: string; clientId: string | null; startMs: number; endMs: number; start: string; end: string; reason: string }
/** Should this unassigned visit have a card? '' = yes, else why not. */
export function openShiftSkip(v: OpenVisit, ctx: { now: number; openCaseVisits: Set<string>; openCaseSchedules: Set<string> }): string {
  if (!(v.startMs > ctx.now)) return 'already started'
  if (v.startMs - ctx.now > OPEN_SHIFT_HOURS * 3600e3) return 'more than 36 hours away'
  if (ctx.openCaseVisits.has(v.visitId)) return 'has an open coverage case'
  const s = scheduleOf(v.visitId)
  if (s && ctx.openCaseSchedules.has(s)) return 'its schedule has an open ongoing-shifts case'
  return ''
}
const chi = (ms: number) => new Date(ms).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
/** The My Work card for one open shift. */
export function openShiftItem(v: OpenVisit, owner: string, nowIso: string): Record<string, unknown> {
  const hours = (v.startMs - Date.parse(nowIso)) / 3600e3
  const urgency = hours <= 12 ? 'urgent' : hours <= 24 ? 'high' : 'normal'
  return {
    id: openShiftId(v.visitId), kind: OPEN_SHIFT_KIND, domain: 'scheduling_coverage', status: 'open', urgency,
    title: `Open shift, nobody assigned: ${v.client || 'a client'}, ${chi(v.startMs)}`,
    about: v.client || '', axiscare_visit_id: v.visitId, client_axiscare_id: v.clientId,
    detail: `AxisCare shows no caregiver on this visit (${v.start.slice(11, 16)} to ${v.end.slice(11, 16)}), and there is no coverage case for it`
      + (v.reason ? ` (the visit's reason is "${v.reason}", which is not a call-off)` : ' (no reason was recorded on the visit)')
      + '. A visit held by a caregiver who is no longer active looks the same in AxisCare. Nobody has been texted.',
    next_action: 'Assign a caregiver in AxisCare, or open a coverage case from Cara so the team is asked. This card closes itself when either happens.',
    owner, owner_name: '', due: new Date(Math.max(Date.parse(nowIso) + 3600e3, v.startMs - 2 * 3600e3)).toISOString(),
    created_at: nowIso, first_at: nowIso, last_activity_at: nowIso, created_by: 'coverage-watch', opened_by: 'system',
    source: { type: 'open_shift', visit: v.visitId },
    history: [{ at: nowIso, by: 'Hub', text: 'AxisCare shows no caregiver and no coverage case was open.' }],
  }
}
/** Why an open card should close now, or '' to leave it. */
export function openShiftCloseWhy(card: { axiscare_visit_id?: string }, ctx: { now: number; unassigned: Map<string, OpenVisit>; assigned: Set<string>; openCaseVisits: Set<string>; openCaseSchedules: Set<string>; fetched: boolean; startMsOf: Map<string, number> }): string {
  const vid = String(card.axiscare_visit_id || '')
  if (!vid || !ctx.fetched) return ''                                  // never close on a failed read
  if (ctx.assigned.has(vid)) return 'AxisCare now shows a caregiver on it'
  if (ctx.openCaseVisits.has(vid) || (scheduleOf(vid) && ctx.openCaseSchedules.has(scheduleOf(vid)))) return 'a coverage case is open for it now'
  const st = ctx.startMsOf.get(vid)
  if (st !== undefined && st <= ctx.now) return 'the visit has started'
  if (!ctx.unassigned.has(vid) && st === undefined) return 'the visit is no longer on the AxisCare schedule'
  return ''
}
