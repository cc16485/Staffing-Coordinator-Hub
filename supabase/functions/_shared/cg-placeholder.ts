// AxisCare placeholder caregivers: not people (Samantha 2026-10-18: "leave the Canceled Shift placeholder out of the
// no-number list, caregiver offers and the readiness checks"). AxisCare has an active caregiver named "Canceled Shift" that
// cancelled visits are put on. It has no phone because it is nobody, so it is never on the no-number list, never offered a
// visit and never counted as one of a client's recent caregivers. One copy, used by caregiver-connect, family-offer and
// pilot-readiness.
export const PLACEHOLDER_NAMES = /^cancel+ed( shifts?)?$/i   // "Canceled" alone too: a visit may carry only the first name
/** true for "Canceled Shift" (or "Cancelled Shift"), from a first and last name or one full name. */
export function isPlaceholderCaregiver(first: unknown, last: unknown = ''): boolean {
  const n = [first, last].map((x) => String(x ?? '').trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ')
  return PLACEHOLDER_NAMES.test(n)
}
