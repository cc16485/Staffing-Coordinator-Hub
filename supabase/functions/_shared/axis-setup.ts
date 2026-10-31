// =============================================================================
// axis-setup.ts · IN TRAINING PLAN v2, PART B (Samantha approved 2026-10-22): "Send orientation information".
// After Step 2 is checked, the Staffing Coordinator adds the new hire to AxisCare as In Training (by hand: the API cannot
// convert an applicant) and presses one button. Before anything is sent, the Hub finds them in AxisCare and checks the two
// things the AxisCare app sign-up needs to match: the zip code and the birth date (her 2026-10-22 point: "the caregiver
// address with zip code and birth date not being in axiscare so it wont let them sign up unless that matches").
// AxisCare is only read here. The pure parts are exported for the tests. No em dashes in anything a person reads.
// =============================================================================
// deno-lint-ignore-file no-explicit-any
import { ax, errText } from './axiscare-caregiver.ts'
import { caregiverOf } from './axis-caregiver-read.ts'

const S = (v: unknown, n = 160) => String(v ?? '').trim().slice(0, n)
export const normPhone = (p: unknown) => { const d = String(p ?? '').replace(/\D/g, ''); return d.length === 11 && d[0] === '1' ? d.slice(1) : d.length === 10 ? d : '' }
export const normEmail = (e: unknown) => S(e, 200).toLowerCase()
export const isInTrainingLabel = (l: unknown) => /^in\s*training$/i.test(S(l, 40))
const rowsOf = (x: any): any[] => Array.isArray(x) ? x : (x && typeof x === 'object' ? Object.values(x) : [])
/** AxisCare dates come as YYYY-MM-DD or with a time; anything else is not a date */
export const ymd = (v: unknown) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(S(v, 40)); return m ? `${m[1]}-${m[2]}-${m[3]}` : '' }
export const zip5 = (v: unknown) => { const m = /^(\d{5})/.exec(S(v, 20).replace(/\s/g, '')); return m ? m[1] : '' }
/** a caregiver's address in AxisCare: caregivers carry mailingAddress (residentialAddress is the clients' key) */
export const axisAddress = (g: any) => { const a = g?.mailingAddress || g?.residentialAddress || {}; return { street: S(a.streetAddress1 ?? a.street1 ?? a.address1, 120), city: S(a.city, 60), zip: zip5(a.postalCode ?? a.zip ?? a.zipCode) } }
export const axisDob = (g: any) => ymd(g?.dateOfBirth ?? g?.birthDate ?? g?.dob)

export type Found = { match: any | null; short: string; why: string }
/** exactly one AxisCare caregiver by phone or email (never by name), and they must be In Training */
export function findPerson(all: any[], phones: unknown[], emails: unknown[]): Found {
  const P = new Set(phones.map(normPhone).filter(Boolean)), E = new Set(emails.map(normEmail).filter(Boolean))
  if (!P.size && !E.size) return { match: null, short: 'no phone or email', why: 'There is no phone number or email on file to find them in AxisCare by.' }
  const hits = all.filter((g) => g && g.id != null && (['mobilePhone', 'homePhone', 'otherPhone'].some((k) => { const n = normPhone(g[k]); return !!n && P.has(n) }) || (() => { const n = normEmail(g.personalEmail ?? g.email); return !!n && E.has(n) })()))
  const live = hits.filter((g) => g?.status?.active === true)
  const tr = live.filter((g) => isInTrainingLabel(g?.status?.label))
  if (tr.length === 1) return { match: tr[0], short: '', why: '' }
  if (tr.length > 1) return { match: null, short: `${tr.length} In Training matches`, why: `${tr.length} In Training caregivers in AxisCare have this phone number or email, so it is not clear which one is them. Fix the duplicate in AxisCare.` }
  if (live.length) return { match: null, short: 'not In Training', why: `AxisCare has them as ${S(live[0]?.status?.label, 40) || 'active'}, not In Training. Set their status to In Training in AxisCare.` }
  if (hits.length) return { match: null, short: 'not active', why: `AxisCare has them as ${S(hits[0]?.status?.label, 40) || 'inactive'}. Set their status to In Training in AxisCare.` }
  return { match: null, short: 'not in AxisCare yet', why: 'Nobody in AxisCare\'s caregiver list has their phone number or email yet. Add them in AxisCare as In Training, with the same mobile phone or email as their application.' }
}

/** what stops the AxisCare app sign-up: the zip and the birth date must be on the AxisCare record and match Step 1 */
export function matchProblems(axis: { zip: string; dob: string }, step1: { zip: string; dob: string | null }): string[] {
  const out: string[] = []
  if (!axis.zip) out.push('AxisCare has no zip code on their address. Add their address with the zip code in AxisCare.')
  else if (step1.zip && axis.zip !== step1.zip) out.push(`The zip code in AxisCare (${axis.zip}) does not match their Step 1 (${step1.zip}). Fix it in AxisCare.`)
  if (!axis.dob) out.push('AxisCare has no birth date for them. Add their birth date in AxisCare.')
  else if (step1.dob && axis.dob !== step1.dob) out.push('The birth date in AxisCare does not match their Step 1. Check it against their Step 1 and fix it in AxisCare.')
  return out
}

/** read only: the whole AxisCare caregiver list, then the one record in full */
export async function axisCaregivers(send: typeof fetch = fetch): Promise<{ ok: true; all: any[] } | { ok: false; why: string }> {
  const all: any[] = []; let path: string | null = '/api/caregivers'
  for (let page = 0; path && page < 20; page++) {
    const r = await ax('GET', path, undefined, send)
    if (r.status < 200 || r.status >= 300) return { ok: false, why: 'AxisCare could not be read: ' + errText(r) }
    all.push(...rowsOf(r.json?.results?.caregivers ?? r.json?.caregivers))
    const next = r.json?.results?.nextPage ?? r.json?.nextPage ?? null
    path = next ? String(next).replace(/^https?:\/\/[^/]+/, '') : null
  }
  return { ok: true, all }
}
export async function axisCaregiver(id: string, send: typeof fetch = fetch): Promise<any | null> {
  if (!/^\d{1,12}$/.test(id)) return null
  const r = await ax('GET', `/api/caregivers/${id}`, undefined, send)
  if (r.status < 200 || r.status >= 300) return null
  return caregiverOf(r.json)   // 2026-10-31: AxisCare answers results.data
}
