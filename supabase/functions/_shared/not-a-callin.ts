// A shift taken off a caregiver in AxisCare is NOT a call-in (Samantha, 2026-10-22: "it could be that the client
// canceled the shift, or that we approved the caregiver asking off ... i dont want that to mark against the caregiver").
// coverage-watch opens a case when it sees an unassigned shift, and remembers who was on it, but AxisCare never says WHY
// they came off. So those cases name the person as "taken off the shift", never "called off", and never land on their
// attendance record. A real call-in (a phone call, a clock-in reply, the office's call-off form) is unchanged.
// not_a_callin: a person marked the case as not a call-in (her clean-up of Kyra Linde's April Davidson shift, Desktop 1045).
// deno-lint-ignore no-explicit-any
export function takenOffNotCalledIn(c: any): boolean {
  return c?.opened_by === 'axiscare-watch' || c?.not_a_callin === true
}

/** How a message names the person who was on the shift. */
// deno-lint-ignore no-explicit-any
export function offWords(c: any): string {
  return takenOffNotCalledIn(c) ? 'was taken off the shift in AxisCare' : 'called off'
}
