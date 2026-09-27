// =============================================================================
// client-lookup matching (One client profile, step 5b B + D, 2026-09-27)
// =============================================================================
// "Is this family already known?" Pure functions, so the rules are tested apart from AxisCare.
// Software suggests; a person decides. Nothing here merges, links or writes.
//
//   phone        the caller's or client's number is the client's own AxisCare number
//   family_phone the number belongs to someone in that client's Family Circle
//   name_dob     same first name, last name and birth date
//   dob_last     same last name and birth date, different first name (Bill / William)
//   name_only    same first and last name, a birth date missing on one side: a HINT only
// Same name with two different birth dates is two different people, and is not shown.
// =============================================================================
export type Why = 'phone' | 'family_phone' | 'name_dob' | 'dob_last' | 'name_only'
export const STRENGTH: Record<Why, number> = { phone: 3, family_phone: 3, name_dob: 3, dob_last: 2, name_only: 1 }
export type Match = { axiscare_client_id: string | null; name: string; active: boolean | null; status: string;
  why: Why[]; family?: string[]; strength: number }

export const last10 = (raw: unknown): string => {
  const d = String(raw ?? '').replace(/\D/g, '')
  return d.length >= 10 ? d.slice(-10) : ''
}
export const nameKey = (raw: unknown): string => String(raw ?? '').trim().toLowerCase().replace(/[^a-z]/g, '')
export const dateKey = (raw: unknown): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw ?? '').trim())
  return m ? `${m[1]}-${m[2]}-${m[3]}` : ''
}

export type Query = { phones: string[]; first: string; last: string; dob: string }
export function cleanQuery(b: Record<string, unknown>): Query {
  const phones = (Array.isArray(b.phones) ? b.phones : []).map(last10).filter(Boolean)
  return { phones: [...new Set(phones)].slice(0, 4), first: nameKey(b.first), last: nameKey(b.last), dob: dateKey(b.dob) }
}

// deno-lint-ignore no-explicit-any
export function matchClient(q: Query, c: any): Why[] {
  const why: Why[] = []
  const own = [c?.homePhone, c?.mobilePhone, c?.otherPhone].map(last10).filter(Boolean)
  if (q.phones.some((p) => own.includes(p))) why.push('phone')
  const f = nameKey(c?.firstName), l = nameKey(c?.lastName), g = nameKey(c?.goesBy), d = dateKey(c?.dateOfBirth)
  const sameLast = !!q.last && q.last === l
  const sameFirst = !!q.first && (q.first === f || (!!g && q.first === g))
  if (sameLast && sameFirst) {
    if (q.dob && d) { if (q.dob === d) why.push('name_dob') }   // two different birth dates: two people
    else why.push('name_only')
  } else if (sameLast && q.dob && d && q.dob === d) why.push('dob_last')
  return why
}

export function rank(list: Match[], max = 10): Match[] {
  return list.sort((a, b) => b.strength - a.strength || Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)).slice(0, max)
}
