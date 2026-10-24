// A shift taken off a caregiver in AxisCare is NOT a call-in (Samantha, 2026-10-22: "it could be that the client
// canceled the shift, or that we approved the caregiver asking off ... i dont want that to mark against the caregiver").
// coverage-watch opens a case when it sees an unassigned shift, and remembers who was on it, but AxisCare never says WHY
// they came off. So those cases name the person as "taken off the shift", never "called off", and never land on their
// attendance record. A real call-in (a phone call, a clock-in reply, the office's call-off form) is unchanged.
// not_a_callin: a person marked the case as not a call-in (her clean-up of Kyra Linde's April Davidson shift, Desktop 1045).
// 2026-10-24 (reasons by id, visit-reasons.ts): when the office picked "Caregiver Call Off" in AxisCare, the reason says
// why, so that case IS a call-off (on attendance, Undo by changing the reason). A no-show is never logged automatically
// (it starts a termination review): a person confirms it. Only cases opened while visit_reasons_live is on carry this.
// deno-lint-ignore no-explicit-any
export function takenOffNotCalledIn(c: any): boolean {
  if (c?.not_a_callin === true) return true
  if (c?.reason_by_id === true && c?.reason_meaning === 'call_off') return false
  return c?.opened_by === 'axiscare-watch' || c?.opened_by === 'axiscare-reason'
}

/** How a message names the person who was on the shift. */
// deno-lint-ignore no-explicit-any
export function offWords(c: any): string {
  if (c?.not_a_callin !== true && c?.reason_by_id === true && c?.reason_meaning === 'no_show') return 'didn\'t show up (AxisCare reason: No Show)'
  return takenOffNotCalledIn(c) ? 'was taken off the shift in AxisCare' : 'called off'
}
