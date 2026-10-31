// =============================================================================
// axis-caregiver-read.ts · THE ONE WAY TO READ ONE CAREGIVER FROM AXISCARE (2026-10-31, Samantha: "fix the AxisCare caregiver
// read everywhere as proposed, with the safety stop on class changes")
// =============================================================================
// GET /api/caregivers/{id} answers { results: { data: { id, firstName, status, classes, ... } } } (the 2026-09-20 field probe,
// Desktop/axiscare-field-probe-report.txt). The code read results.caregiver / caregiver / the body itself, so every caregiver came
// back as nothing (the My on-call page said "We couldn't check your record", Approved to Work couldn't read back), or as the
// wrapper { data } (PRN Team linking never matched; adding the PRN class would have saved only that class). results.data first;
// the older shapes stay as a fallback. Only a record with an id counts: anything else is null ("couldn't read").
// =============================================================================
// deno-lint-ignore no-explicit-any
type Any = any
export function caregiverOf(json: Any): Any | null {
  const r = json?.results
  for (const c of [r?.data, r?.caregiver, json?.caregiver, json]) if (c && typeof c === 'object' && !Array.isArray(c) && c.id != null) return c
  return null
}
/** The safety stop: never save a caregiver's classes from a read that doesn't carry their class list. Saving classes replaces
    the whole list, so a read without one would erase their Level and every other class. An empty list is fine: a brand-new hire
    can have no classes yet (Approved to Work adds their Level). */
export const classesSeen = (c: Any): boolean => c != null && c.classes != null && typeof c.classes === 'object'
export const CLASSES_STOP = "AxisCare's answer didn't include their classes, so nothing was changed (saving now could erase their Level and other classes). Try again in a few minutes; if it keeps happening, tell Claude."
