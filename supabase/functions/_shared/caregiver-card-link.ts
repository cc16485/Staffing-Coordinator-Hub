// =============================================================================
// caregiver-card-link: which caregiver PROFILE card a family message links to (part 2, slice 2b, 2026-10-01)
// =============================================================================
// Samantha: ONE profile (caregiver_profiles, shown at cc.mo-care.com/caregiver.html?id=<id>) serves both
// "introduce your caregiver" and "caregiver change". The older short intros (caregiver_intros, meet.html) were moved
// into caregiver_profiles by caregiver_profile_2b.sql, so nothing links to meet.html any more.
//
// The rules for finding the covering caregiver's card (a wrong card is worse than no card):
//   1. Only a PUBLISHED profile that is not withdrawn is ever linked.
//   2. Their AxisCare caregiver id first: the visit's assignment, else the one asked caregiver whose name is the
//      case's covered_by (two asked people with that name and different ids: no id). Exactly one published profile
//      with that id wins; two published profiles with the same id is a muddle a person must fix, so no link.
//   3. No profile by id: an exact full-name match (first + last, or preferred + last) against published profiles,
//      ONLY when exactly one profile matches, and never one tied to a DIFFERENT AxisCare id than the one we know.
//   4. Otherwise no link. The text still goes, exactly as it did before this slice.
// Pure functions are exported for the tests; findCardForCase is the only one that reads the database.
// =============================================================================

export const CARD_BASE = 'https://cc.mo-care.com/caregiver.html?id='
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const cardLink = (id: string) => CARD_BASE + encodeURIComponent(String(id))

/* "Sarah T." : the name a family sees. Never more of the last name than its first letter. */
// deno-lint-ignore no-explicit-any
export function cardName(p: any): string {
  const first = String(p?.preferred_name || p?.first_name || '').trim()
  const li = String(p?.last_name || '').trim().replace(/^[^A-Za-z]+/, '').charAt(0).toUpperCase()
  return first ? (li ? `${first} ${li}.` : first) : ''
}
// deno-lint-ignore no-explicit-any
export const cardFirst = (p: any) => String(p?.preferred_name || p?.first_name || '').trim().split(/\s+/)[0] || ''

export const nameKey = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z' -]/g, '').replace(/\s+/g, ' ').trim()
const idKey = (v: unknown) => String(v ?? '').trim()

// deno-lint-ignore no-explicit-any
export const isLinkable = (p: any) => !!p && p.published === true && p.status !== 'withdrawn' && UUID.test(String(p.id || ''))

/* The covering caregiver's AxisCare id from the coverage case, or '' when it is not certain. */
// deno-lint-ignore no-explicit-any
export function coveringAxiscareId(c: any): string {
  const asg = c?.axiscare_assignment
  if (asg && asg.status === 'assigned' && /^\d+$/.test(idKey(asg.caregiver_id))) return idKey(asg.caregiver_id)
  const who = nameKey(c?.covered_by)
  if (!who) return ''
  // deno-lint-ignore no-explicit-any
  const ids = [...new Set((Array.isArray(c?.asked) ? c.asked : []).filter((a: any) => a && nameKey(a.name) === who)
    // deno-lint-ignore no-explicit-any
    .map((a: any) => idKey(a.axiscare_id)).filter(Boolean))]
  return ids.length === 1 ? String(ids[0]) : ''
}

export type CardPick = { profile: Record<string, unknown> | null; how: 'axiscare_id' | 'name' | 'none'; why: string }

/* The choice itself, on a list of profiles already read. */
// deno-lint-ignore no-explicit-any
export function pickProfile(profiles: any[], who: { axiscareId?: string; name?: string }): CardPick {
  const live = (profiles ?? []).filter(isLinkable)
  const ax = idKey(who.axiscareId)
  if (ax) {
    const byId = live.filter((p) => idKey(p.axiscare_id) === ax)
    if (byId.length === 1) return { profile: byId[0], how: 'axiscare_id', why: 'their AxisCare id' }
    if (byId.length > 1) return { profile: null, how: 'none', why: 'two published profiles share their AxisCare id' }
  }
  const want = nameKey(who.name)
  if (!want || !want.includes(' ')) return { profile: null, how: 'none', why: want ? 'only a first name to go on' : 'no name' }
  const hits = live.filter((p) => {
    const last = nameKey(p.last_name)
    if (!last) return false
    const full = [nameKey(p.first_name) + ' ' + last, p.preferred_name ? nameKey(p.preferred_name) + ' ' + last : '']
    return full.includes(want)
  }).filter((p) => !ax || !idKey(p.axiscare_id) || idKey(p.axiscare_id) === ax)   // never someone else's profile
  if (hits.length === 1) return { profile: hits[0], how: 'name', why: 'their full name' }
  return { profile: null, how: 'none', why: hits.length ? 'more than one published profile has that name' : 'no published profile' }
}

/* ' Meet Sarah here: <link>' for the {meet} token, or '' (the text still goes, with no link). */
// deno-lint-ignore no-explicit-any
export function meetLine(p: any): string {
  if (!isLinkable(p)) return ''
  return ` Meet ${cardFirst(p) || 'them'} here: ${cardLink(String(p.id))}`
}

/* Server side: read the published profiles and pick the covering caregiver's card. Never throws. */
// deno-lint-ignore no-explicit-any
export async function findCardForCase(sb: any, c: any): Promise<CardPick> {
  try {
    const { data, error } = await sb.from('caregiver_profiles')
      .select('id, first_name, last_name, preferred_name, axiscare_id, published, status').eq('published', true)
    if (error) return { profile: null, how: 'none', why: 'could not read profiles' }
    return pickProfile(data ?? [], { axiscareId: coveringAxiscareId(c), name: String(c?.covered_by ?? '') })
  } catch {
    return { profile: null, how: 'none', why: 'could not read profiles' }
  }
}
