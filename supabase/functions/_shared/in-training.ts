// =============================================================================
// in-training.ts · IN TRAINING IS ONBOARDING (Samantha, 2026-10-22: "Go with the In Training way: AxisCare In Training at
// Step 2 checked, Hub treats In Training as onboarding (not a caregiver, no shifts), Active after orientation").
// AxisCare marks "In Training" as active (status.active === true), so every check that only asked "active in AxisCare?"
// treated a new hire as a working caregiver (Taylor Young, 2026-10-22). The one rule: a WORKING caregiver is active in
// AxisCare AND not In Training. Used by the fills and open hours (coverage-run), the Team Builder pool and the intake
// matcher (coverage-shifts), shift texts (shift-ask-gate), family offers, schedule push, the 30-day availability text and
// the nightly match report.
// PRACTICE until ops_settings.in_training_lock_live === true: everything behaves as before (the Desktop step lists who is
// In Training in AxisCare, so the office can see who the switch would hold back). Pure apart from inTrainingLive().
// No em dashes in anything a person reads.
// deno-lint-ignore-file no-explicit-any
export const IN_TRAINING_WHY = 'In Training in AxisCare (onboarding until their orientation is done)'
export const IN_TRAINING_SWITCH = 'in_training_lock_live'

/** true when AxisCare's status label is "In Training" (any case, any spacing). */
export const isInTraining = (label: unknown) => /^in\s*training$/i.test(String(label ?? '').trim())

/** The one rule. live = the switch; off = the old rule (active in AxisCare). */
export const isWorking = (active: unknown, label: unknown, live: boolean) => active === true && !(live && isInTraining(label))

/** An AxisCare caregiver row (status.active + status.label): working, with the switch. */
export const rowWorking = (g: any, live: boolean) => isWorking(g?.status?.active, g?.status?.label, live)

/** The switch from ops_settings (a settings object already read, or the database). Unreadable = off (today's behavior). */
export async function inTrainingLive(src: any): Promise<boolean> {
  if (src && typeof src === 'object' && !('from' in src)) return src[IN_TRAINING_SWITCH] === true
  try {
    const { data } = await src.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
    return (data?.data ?? {})[IN_TRAINING_SWITCH] === true
  } catch { return false }
}
