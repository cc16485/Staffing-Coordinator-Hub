// =============================================================================
// THE SHIFT PAGE LINK IN CARA'S TEXTS (Samantha, 2026-10-24; proposal https://claude.ai/artifact/12Qp6teWJjSgFgurV46a5H,
// her five choices and two improvements). Each caregiver's shift text carries their OWN link to the shift page; replying
// YES or NO by text keeps working exactly as before.
//  - Who gets a link: everyone once ops_settings.shift_link_texts_live is on; before that, only the PILOT caregivers the
//    owners picked (ops_settings.shift_link_pilot: [{ axiscare_id, name }]). Their link opens even while the shift page is
//    switched off for everyone else (the ask is stamped pilot_link).
//  - With a link: the town only (no street), no care line (the page shows only what's approved), and the wording says
//    whether part of the shift is welcome: "all or part of it" when the office allowed a flexible start or a hand-off,
//    "It needs one caregiver for the whole shift." when not.
//  - Interest checks for a potential new client: never a link (no shift yet).
//  - A case's own edited wording wins as before. A link goes into it only where someone typed {link}.
// Pure functions; coverage-run composes and sends.
// =============================================================================
// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown) => String(v ?? '').trim()

/** Is this caregiver on the owners' pilot list? */
export function inPilot(st: Any, axId: unknown, name?: unknown): boolean {
  const list = Array.isArray(st?.shift_link_pilot) ? st.shift_link_pilot : []
  const id = S(axId), nm = S(name).toLowerCase()
  return list.some((p: Any) => (id && S(p?.axiscare_id) === id) || (!id && nm && S(p?.name).toLowerCase() === nm))
}
/** Does this person's text get a link? live = everyone; otherwise the pilot only. Interest checks never. */
export function linkFor(st: Any, kase: Any, axId: unknown, name?: unknown): 'live' | 'pilot' | null {
  if (S(kase?.kind) === 'interest') return null
  if (st?.shift_link_texts_live === true) return 'live'
  return inPilot(st, axId, name) ? 'pilot' : null
}
/** Part of the shift is welcome when the office allowed a flexible start or a hand-off. */
export const partWelcome = (kase: Any) => kase?.time_flex === 'flexible_start' || kase?.handoff_ok === true

/** "This could become a regular Saturday shift." / "One time only." (the case's shift_pattern stamp, as the Hub says it) */
export function patLineOf(kase: Any): string {
  const pp = kase?.shift_pattern && typeof kase.shift_pattern === 'object' && kase.shift_pattern.v === 2 ? kase.shift_pattern : null
  if (pp?.kind === 'open_ongoing') return `This could become a regular ${pp.weekday ? pp.weekday + ' ' : ''}shift. `
  if (pp?.kind === 'one_time' || pp?.kind === 'one_time_cover') return 'One time only. '
  return ''
}

const ALL = 'View details and let us know if you can work all or part of it: {link} You can also reply YES or NO.'
const WHOLE = 'It needs one caregiver for the whole shift. View details and answer here: {link} You can also reply YES or NO.'
/** THE TEMPLATES WITH A LINK (her wording, 2026-10-24). kind: other (they haven't worked with the client), sameday,
    tier1 (they work with the client), prn. */
export function linkTemplate(kind: 'other' | 'sameday' | 'tier1' | 'prn', part: boolean): string {
  const tail = part ? ALL : WHOLE
  if (kind === 'tier1') return 'Hi {first_name}, can you cover {client} {when}? {pattern}' + (part ? 'All or part of it is welcome. ' : 'It needs one caregiver for the whole shift. ') + 'Details: {link} It\'s Caring Companions. You can also reply YES or NO.'
  if (kind === 'sameday') return 'Hi {first_name}! Caring Companions needs a last-minute fill-in in {town} for {client}: {when}. ' + tail
  if (kind === 'prn') return 'Hi {first_name}! Caring Companions PRN opportunity in {town} for {client}: {when}. {pattern}' + tail + ' No pressure either way.'
  return 'Hi {first_name}! Caring Companions has an open shift in {town} for {client} on {when}. {pattern}' + tail
}

/** Fill a template that may carry {link}: the town only, never a street; no care line. */
export function fillLinked(tmpl: string, v: { first: string; client: string; when: string; town: string; pattern: string; link: string }): string {
  return tmpl
    .replaceAll(' in {town}', v.town ? ` in ${v.town}` : '')
    .replaceAll('{town}', v.town || 'our area')
    .replaceAll('{first_name}', v.first || 'there')
    .replaceAll('{client}', v.client)
    .replaceAll('{when}', v.when)
    .replaceAll('{pattern}', v.pattern)
    .replaceAll('{link}', v.link)
    .replaceAll(' at {address}', v.town ? ` in ${v.town}` : '')
    .replaceAll('{address}', v.town || 'our area')
    .replaceAll('{where}', v.town ? ` in ${v.town}` : '')
    .replaceAll('{care}', '')
    .replace(/\s{2,}/g, ' ').trim()
}
