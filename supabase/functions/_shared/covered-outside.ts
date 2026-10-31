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

/* ── A deleted call-off visit that was REPLACED (Newton-Donati, 2026-10-31) ──
   The office took Sheryelle off three overnights, then deleted each visit and in the same minute made a NEW visit for the
   same client and the same hours with Rhonda (or Kyra) on it. The case only watched the deleted visit, so it stayed open
   and texted "CRITICAL open shift" three hours before a shift that was covered. A deleted visit is covered when that
   client's other visits, with somebody on them who is not the caregiver who called off, cover its whole time (several
   visits may share it, 15 minutes either way). Anything less leaves the case for a person, as before. */
export const REPLACE_SLACK_MS = 15 * 60e3

// deno-lint-ignore no-explicit-any
type Any = any
export function replacementCover(cc: Any, gone: Any, visits: Any[], o: { ms: (stamp: unknown, tz?: string) => number; usable: (v: Any) => boolean }):
  { visits: Any[]; names: string[]; start: string; end: string } | null {
  const clientId = String(cc?.client_axiscare_id ?? gone?.client?.id ?? '').trim()
  if (!clientId) return null
  const stamp = (v: Any, k: 'start' | 'end') => String(k === 'start' ? (v?.scheduledStartDate ?? v?.startDate ?? '') : (v?.scheduledEndDate ?? v?.endDate ?? ''))
  const gs = o.ms(stamp(gone, 'start'), gone?.timezone), ge = o.ms(stamp(gone, 'end'), gone?.timezone)
  if (!Number.isFinite(gs) || !Number.isFinite(ge) || ge <= gs) return null
  const nameOf = (v: Any) => [String(v?.caregiver?.firstName ?? '').trim(), String(v?.caregiver?.lastName ?? '').trim()].filter(Boolean).join(' ') || ('caregiver ' + v?.caregiver?.id)
  const cands = (visits || []).map((v) => ({ v, s: o.ms(stamp(v, 'start'), v?.timezone), e: o.ms(stamp(v, 'end'), v?.timezone) }))
    .filter(({ v, s, e }) => String(v?.id ?? '') !== String(gone?.id ?? '') && String(v?.client?.id ?? '') === clientId
      && v?.caregiver?.id != null && !v?.removed && o.usable(v) && s < ge && e > gs
      && outsideVerdict(cc, { id: v.caregiver.id, name: nameOf(v) }) === 'covered')
    .sort((a, b) => a.s - b.s)
  let reach = gs
  const used: Any[] = []
  for (const c of cands) {
    if (c.s > reach + REPLACE_SLACK_MS) break                 // a gap nobody is on
    if (c.e > reach) { used.push(c.v); reach = c.e }
    if (reach >= ge - REPLACE_SLACK_MS) break
  }
  if (!used.length || reach < ge - REPLACE_SLACK_MS) return null
  return { visits: used, names: [...new Set(used.map(nameOf))], start: stamp(used[0], 'start'), end: stamp(used[used.length - 1], 'end') }
}
