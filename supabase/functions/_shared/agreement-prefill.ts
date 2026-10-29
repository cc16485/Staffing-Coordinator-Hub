// =============================================================================
// agreement-prefill · fill the Client Care Agreement's typing boxes before anyone touches the tablet (Samantha 2026-10-29:
// "we are going to hand them a tablet to type on which may be difficult so the more they only have to tap the better").
// What the Hub already knows goes into the blanks: the client from AxisCare (else the lead), the contacts from AxisCare
// responsible parties, the Family Circle, the lead's caller and the people at the home visit, and the level and rate from
// the home visit. Only facts are filled in. Every Yes / No, Accept / Decline and permission box stays the family's tap,
// and a box someone already typed in is never changed (fillBlanks). The tablet shows filled boxes in blue to check.
// Pure functions here (Node tests); the client-agreement function does the reads.
// =============================================================================
import { findPerson } from './person-match.ts'
// deno-lint-ignore no-explicit-any
type Any = any
export type Source = 'AxisCare' | 'Family Circle' | 'Lead' | 'Home visit'
export type Prefill = { answers: Record<string, string>; from: Record<string, Source>; notes: string[] }
const t = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim())
const cut = (v: unknown) => t(v).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200)
const isSelf = (rel: unknown) => /^(self|client)$/i.test(t(rel))

/** "4175550001" or "+1 417-555-0001" -> "(417) 555-0001"; anything else as given. */
export function phoneText(v: unknown): string {
  const s = t(v), d = s.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : s
}
/** "1945-02-03" (or "1945-02-03T00:00:00") -> "02/03/1945"; "2/3/1945" kept. */
export function dobText(v: unknown): string {
  const s = t(v), m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[2]}/${m[3]}/${m[1]}` : (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s) ? s : '')
}
const listOf = (v: Any): Any[] => Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : [])

type Person = { name: string; relationship: string; cell: string; home: string; email: string; line1: string; city: string; state: string; zip: string; primary: boolean; poa: boolean; from: Source }
const blank = (from: Source): Person => ({ name: '', relationship: '', cell: '', home: '', email: '', line1: '', city: '', state: '', zip: '', primary: false, poa: false, from })

/** Everyone the Hub knows around this client, one row per person (the same person by email, then name: person-match.ts),
 *  earlier sources winning each detail: AxisCare, then the Family Circle, the lead, the home visit. */
export function peopleFor(src: { rps?: Any[]; members?: Any[]; lead?: Any; visit?: Any }): Person[] {
  const out: Person[] = []
  const add = (p: Person) => {
    if (!p.name || isSelf(p.relationship)) return
    const same = findPerson(out, { name: p.name, email: p.email })
    if (!same) { out.push(p); return }
    for (const k of ['relationship', 'cell', 'home', 'email', 'line1', 'city', 'state', 'zip'] as const) if (!same[k] && p[k]) same[k] = p[k]
    same.primary = same.primary || p.primary; same.poa = same.poa || p.poa
  }
  for (const r of [...(src.rps ?? [])].sort((a, b) => Number(a?.listNumber) - Number(b?.listNumber))) {
    const ph = listOf(r?.phones).filter((x: Any) => t(x?.number)), a = r?.address ?? {}
    const mob = ph.find((x: Any) => /mobile|cell/i.test(t(x?.type))), home = ph.find((x: Any) => /home/i.test(t(x?.type)))
    add({ ...blank('AxisCare'), name: t(r?.name), relationship: t(r?.relationship), cell: t((mob ?? (home ? null : ph[0]))?.number), home: t(home?.number),
      email: t(r?.email ?? r?.personalEmail), line1: t(a.line1 ?? a.streetAddress1), city: t(a.city), state: t(a.state), zip: t(a.zip ?? a.postalCode) })
  }
  const mem = [...(src.members ?? [])].sort((a, b) => Number(!!b?.is_primary) - Number(!!a?.is_primary))
  for (const m of mem) {
    add({ ...blank('Family Circle'), name: t(m?.name), relationship: t(m?.relationship), cell: t(m?.phone), email: t(m?.email), primary: m?.is_primary === true })
  }
  const l = src.lead
  if (l && !isSelf(l.relationship)) add({ ...blank('Lead'), name: [t(l.first_name), t(l.last_name)].filter(Boolean).join(' '), relationship: t(l.relationship), cell: t(l.phone), email: t(l.email), primary: !mem.some((m) => m?.is_primary === true) })
  const v = src.visit?.visit ?? src.visit
  if (v) {
    const c = v.prefs?.contact
    if (c && t(c.name)) add({ ...blank('Home visit'), name: t(c.name), relationship: t(c.rel), cell: t(c.phone), email: t(c.email) })
    for (const a of listOf(v.attendees)) {
      if (!t(a?.name) || a?.role === 'client') continue
      add({ ...blank('Home visit'), name: t(a.name), relationship: t(a.rel), primary: a.role === 'primary', poa: a.role === 'poa' })
    }
  }
  // the primary contact is Contact 1: the Family Circle's primary, else the lead's caller, else the first one
  const first = out.findIndex((p) => p.primary)
  if (first > 0) out.unshift(out.splice(first, 1)[0])
  return out
}

/** Everything the Hub can fill in, keyed by the printed agreement's field keys (only keys this agreement has). */
export function prefillFrom(src: { client?: Any; rps?: Any[]; members?: Any[]; lead?: Any; visit?: Any; fields: Record<string, Any> }): Prefill {
  const answers: Record<string, string> = {}, from: Record<string, Source> = {}, notes: string[] = []
  const put = (k: string, v: unknown, s: Source) => { const x = cut(v); if (x && src.fields[k]?.type === 'text' && !answers[k]) { answers[k] = x; from[k] = s } }
  const c = src.client, l = src.lead
  if (c) {
    const a = c.residentialAddress ?? c.address ?? {}
    put('client.client_s_name', [t(c.firstName), t(c.lastName)].filter(Boolean).join(' '), 'AxisCare')
    put('client.address', [t(a.streetAddress1 ?? a.street1 ?? a.line1), t(a.streetAddress2 ?? a.line2)].filter(Boolean).join(' '), 'AxisCare')
    put('client.city', a.city, 'AxisCare'); put('client.zip', t(a.postalCode ?? a.zip).slice(0, 5), 'AxisCare')
    put('client.phone_number', phoneText(c.homePhone || c.mobilePhone || c.otherPhone), 'AxisCare')
    put('ci.date_of_birth', dobText(c.dateOfBirth), 'AxisCare')
  }
  if (l) {
    const self = isSelf(l.relationship)
    put('client.client_s_name', [t(l.client_first_name) || (self ? t(l.first_name) : ''), t(l.client_last_name) || (self ? t(l.last_name) : '')].filter(Boolean).join(' '), 'Lead')
    put('client.address', l.client_address, 'Lead'); put('client.city', l.client_city, 'Lead'); put('client.zip', t(l.client_zip).slice(0, 5), 'Lead')
    put('client.phone_number', phoneText(l.client_phone || (self ? l.phone : '')), 'Lead')
    put('ci.date_of_birth', dobText(l.client_dob), 'Lead')
  }
  const people = peopleFor(src)
  people.slice(0, 4).forEach((p, i) => {
    const n = 'c' + (i + 1) + '.'
    put(n + 'name', p.name, p.from); put(n + 'relationship', p.relationship, p.from)
    put(n + 'cell_phone', phoneText(p.cell), p.from); put(n + 'home_phone', phoneText(p.home), p.from); put(n + 'email', p.email, p.from)
    put(n + 'address', p.line1, p.from); put(n + 'city', p.city, p.from); put(n + 'state', p.state, p.from); put(n + 'zip', t(p.zip).slice(0, 5), p.from)
  })
  if (people.length > 4) notes.push(`${people.length} people are on file; the agreement has room for 4, so ${people.slice(4).map((p) => p.name).join(', ')} ${people.length > 5 ? 'were' : 'was'} left off.`)
  const poa = people.find((p) => p.poa)
  if (poa) { put('poa.name', poa.name, 'Home visit'); put('poa.relationship', poa.relationship, 'Home visit'); put('poa.cell_phone', phoneText(poa.cell || poa.home), poa.from); put('poa.email', poa.email, poa.from) }
  return { answers, from, notes }
}

/** The home visit's care level and rate, as the agreement's office answers (the office still confirms them). */
export function officeFromVisit(visit: Any): Record<string, string | boolean> {
  const v = visit?.visit ?? visit, o: Record<string, string | boolean> = {}
  const lv = ({ wellness: 'wellness_care', personal: 'personal_care', advanced: 'advanced_care' } as Record<string, string>)[t(v?.level)]
  if (lv) o['level.' + lv] = true
  const r = t(v?.rate).replace(/^\$/, '')
  if (/^\d{1,3}(\.\d{2})?$/.test(r)) o['level.hourly_rate'] = r
  return o
}

/** The latest home visit for this client: linked by AxisCare number, or through its lead. */
export function latestVisit(all: Any[], ax: string, leadId: string | null): Any | null {
  const mine = listOf(all).filter((a) => a && (t(a.axiscare_client_id) === ax || (leadId && t(a.lead_id) === leadId)))
  mine.sort((a, b) => t(b.updated_at || b.created_at || b.date).localeCompare(t(a.updated_at || a.created_at || a.date)))
  return mine[0] ?? null
}

/** Lay a prefill over answers someone may already have typed: only empty boxes are filled. */
export function fillBlanks(answers: Record<string, unknown>, p: Prefill): Prefill {
  const a: Record<string, string> = {}, f: Record<string, Source> = {}
  for (const [k, v] of Object.entries(p.answers)) if (!t(answers?.[k])) { a[k] = v; f[k] = p.from[k] }
  return { answers: a, from: f, notes: p.notes }
}
