// =============================================================================
// onboarding-leave.ts · taking someone out of onboarding, and bringing them back (Samantha 2026-10-21: "We need a clear way
// to take someone out of onboarding if they ghost, or let us know that they took another position, etc.")
// =============================================================================
// Her four reasons. A background finding is NOT one of them: it still goes through the background review (bg-review). The
// goodbye message, the 10 days of silence flag and the PRN offer live in the Hub; the server only stops things:
//   leave       the record is marked not hired (with the reason), the readiness card is closed, its open Needs Attention
//               cards close, unanswered reference requests close, and every sweep, reminder and message skips them.
//               Already on the caregiver roster: the roster record too, and ONE card to set them inactive in AxisCare by
//               hand (the server never changes AxisCare here).
//   come_back   undoes exactly what leave did: not hired cleared, the card reopened, and only the reference requests that
//               leave closed are reopened. Owners and the Approve to Work list.
// Pure: the reasons, the fields, which cards close. No em dashes.
// deno-lint-ignore-file no-explicit-any
export const LEAVE_REASONS: Record<string, string> = {
  ghosted: 'Stopped answering',
  other_job: 'Took another job',
  changed_mind: 'Changed their mind',
  our_decision: 'We decided not to hire',
}
export const LEFT_TAG = 'left onboarding: '
const S = (v: unknown, n = 300) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n)
export const centralDay = (iso: string) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
/** The fields leave writes on the candidate (and the roster record, with onboarding_left). */
export function leaveFields(reason: string, note: unknown, by: string, now: string, roster = false): Record<string, unknown> {
  return { not_hired: true, not_hired_reason: reason, not_hired_notes: S(note, 600) || LEAVE_REASONS[reason], not_hired_date: centralDay(now),
    left_at: now, left_by: S(by, 160), ...(roster ? { onboarding_left: true } : {}) }
}
/** The fields come_back writes: not hired cleared, the leave kept as history on came_back. */
export function comeBackFields(rec: any, note: unknown, by: string, now: string, roster = false): Record<string, unknown> {
  return { not_hired: false, not_hired_reason: null, not_hired_notes: null, not_hired_date: null, left_at: null, left_by: null,
    came_back: { at: now, by: S(by, 160), note: S(note, 600) || null, had_left: { reason: rec?.not_hired_reason ?? null, at: rec?.left_at ?? null, by: rec?.left_by ?? null } },
    ...(roster ? { onboarding_left: false } : {}) }
}
/** The open Needs Attention cards that belong to this person's onboarding. */
export function cardsFor(items: any[], who: { offer_id?: unknown; candidate_id?: unknown; journey_id?: unknown }): any[] {
  const oid = S(who.offer_id, 80), cid = S(who.candidate_id, 40), jid = S(who.journey_id, 80)
  const open = (x: any) => x && x.status !== 'done' && x.status !== 'resolved'
  return (Array.isArray(items) ? items : []).filter((x) => open(x) && x.kind !== 'axiscare_inactive_after_leave' && (
    (oid && S(x.offer_id, 80) === oid) || (cid && S(x.candidate_id, 40) === cid) || (jid && String(x.id || '').includes(jid))))
}
