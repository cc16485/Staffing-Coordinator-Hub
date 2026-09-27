// =============================================================================
// covered-outside — is the caregiver now on a call-off shift really covering it? (2026-09-27)
// =============================================================================
// Elizabeth Kurtz, 2026-09-27: the office opened a call-off case for Ashley before taking
// Ashley off the AxisCare schedule. The watcher saw a caregiver on the shift, took it as
// "covered in AxisCare directly", closed the case as covered BY ASHLEY, and her family was
// texted that Ashley called off and Ashley was coming instead. A caregiver on the shift is
// only a cover when it is somebody OTHER than the caregiver who called off:
//
//   covered          someone else is on it (ids differ; or the names clearly differ; or,
//                    with nobody recorded as calling off, the shift was seen empty first)
//   caller_still_on  it is the caregiver who called off (same AxisCare id, or same full name)
//   unsure           can't tell (e.g. only a first name was recorded and it matches)
// Only "covered" closes a case. The other two leave it open for a person.
// =============================================================================

export type OutsideVerdict = 'covered' | 'caller_still_on' | 'unsure'
export const nameKey = (x: unknown) => String(x ?? '').toLowerCase().replace(/[^a-z]/g, '')

// deno-lint-ignore no-explicit-any
export function outsideVerdict(cc: any, cg: { id: unknown; name: string }): OutsideVerdict {
  const offId = String(cc?.calling_off_id ?? '').trim()
  const cgId = cg?.id == null ? '' : String(cg.id).trim()
  if (offId && cgId) return offId === cgId ? 'caller_still_on' : 'covered'
  const off = String(cc?.calling_off ?? '').trim()
  const on = String(cg?.name ?? '').trim()
  if (off) {
    if (nameKey(off) === nameKey(on)) return 'caller_still_on'
    const offW = off.split(/\s+/), onW = on.split(/\s+/)
    if (offW.length === 1 || onW.length === 1) return nameKey(offW[0]) === nameKey(onW[0]) ? 'unsure' : 'covered'
    return 'covered'
  }
  /* nobody recorded as calling off: only a shift seen EMPTY since the case opened can be a cover */
  return (cc?.seen_unassigned_at || cc?.opened_by === 'axiscare-watch') ? 'covered' : 'unsure'
}

/* The family text must never say a caregiver is replacing themselves. */
// deno-lint-ignore no-explicit-any
export const coversThemselves = (c: any) => !!String(c?.calling_off ?? '').trim() && nameKey(c?.calling_off) === nameKey(c?.covered_by)
