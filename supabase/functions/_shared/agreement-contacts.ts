// =============================================================================
// agreement-contacts · Client Care Agreement, Stage 2 (Samantha 2026-10-16: "yes start stage 2").
// After the agreement is countersigned, an office person reviews the signed Contacts & Permissions (Exhibit I) and
// approves them. Approved contacts go to:
//   * AxisCare responsible parties 1-3: name, relationship, address, phones, email, and the HIPAA and Medical Decisions
//     answers FROM THE SIGNED AGREEMENT (her design answer: "Yes, after office review"). A contact AxisCare already lists
//     under the same name is updated in its own slot; a new contact takes the next free slot; nobody else's slot is ever
//     touched. When all three slots are taken, the contact goes to the Hub only and the review says so.
//   * the Hub Family Circle: the person, the two answers as AxisCare holds them after the read-back, and texting exactly
//     as ticked: "Running late" -> wants_late, "Caregiver change" -> wants_changes, either one -> sms_consent
//     (her answer "Separately"). A STOP reply (stopped_at) is never touched.
//   * a checklist for what AxisCare's API cannot set (her answer "Checklist"): the AxisCare family sign-in for care
//     notes / invoices, and the emails each person chose. The office does these by hand and ticks them off.
// Pure functions here (tested offline); the client-agreement function does the reads and writes.
// =============================================================================
import { findPerson } from './person-match.ts'
// deno-lint-ignore no-explicit-any
type Any = any
const t = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim())
export const nameKey = (v: unknown) => t(v).toLowerCase().replace(/[^a-z]/g, '')

const STATES: Record<string, string> = { alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE',
  districtofcolumbia: 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  newhampshire: 'NH', newjersey: 'NJ', newmexico: 'NM', newyork: 'NY', northcarolina: 'NC', northdakota: 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA',
  rhodeisland: 'RI', southcarolina: 'SC', southdakota: 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA', westvirginia: 'WV',
  wisconsin: 'WI', wyoming: 'WY' }
const CODES = new Set(Object.values(STATES))
/** "Missouri", "mo", "MO." -> "MO"; anything else -> null (AxisCare only takes USPS codes). */
export function stateCode(v: unknown): string | null {
  const s = t(v); if (!s) return null
  const up = s.replace(/[^a-z]/gi, '').toUpperCase()
  if (up.length === 2 && CODES.has(up)) return up
  return STATES[nameKey(s)] ?? null
}

export type Contact = {
  n: number; name: string; relationship: string; cell: string; home: string; email: string
  address: { line1: string; city: string; state: string; zip: string }
  hipaa: boolean | null; medical: boolean | null; poa: string[]
  texts: { late: boolean; change: boolean }; axis: { care_notes: boolean; invoices: boolean }
  emails: { weekly_calendar: boolean; care_plans: boolean; office_messages: boolean; invoices: boolean }
}
const yn = (a: Any, y: string, n: string) => a[y] === true ? true : a[n] === true ? false : null

/** The contacts as signed on Exhibit I (c1..c4 with a name), in order. */
export function contactsFrom(answers: Any): Contact[] {
  const a = answers ?? {}, out: Contact[] = []
  for (const n of [1, 2, 3, 4]) {
    const p = `c${n}.`, name = t(a[p + 'name'])
    if (!name) continue
    out.push({ n, name, relationship: t(a[p + 'relationship']), cell: t(a[p + 'cell_phone']), home: t(a[p + 'home_phone']), email: t(a[p + 'email']),
      address: { line1: t(a[p + 'address']), city: t(a[p + 'city']), state: t(a[p + 'state']), zip: t(a[p + 'zip']) },
      hipaa: yn(a, p + 'hipaa_yes', p + 'hipaa_no'), medical: yn(a, p + 'medical_yes', p + 'medical_no'),
      poa: ['health', 'financial', 'none'].filter((k) => a[p + 'poa_' + k] === true),
      texts: { late: a[p + 'text_running_late'] === true, change: a[p + 'text_caregiver_change'] === true },
      axis: { care_notes: a[p + 'axis_care_notes'] === true, invoices: a[p + 'axis_invoices'] === true },
      emails: { weekly_calendar: a[p + 'email_weekly_calendar'] === true, care_plans: a[p + 'email_care_plans'] === true,
        office_messages: a[p + 'email_office_messages'] === true, invoices: a[p + 'email_invoices'] === true } })
  }
  return out
}

/** The office may fix typos in the contact details before approving. The signed choices (HIPAA, Medical Decisions,
 *  POA, texts, AxisCare access, emails) are the family's and are never edited here. */
export const EDITABLE = ['name', 'relationship', 'cell', 'home', 'email', 'line1', 'city', 'state', 'zip'] as const
export function withEdits(c: Contact, edits: Any): { contact: Contact; changed: string[]; problems: string[] } {
  const out: Contact = JSON.parse(JSON.stringify(c)), changed: string[] = [], problems: string[] = []
  if (!edits || typeof edits !== 'object') return { contact: out, changed, problems }
  for (const k of EDITABLE) {
    if (!(k in edits)) continue
    const v = t(edits[k]).slice(0, 120)
    const cur = k === 'line1' || k === 'city' || k === 'state' || k === 'zip' ? out.address[k] : (out as Any)[k]
    if (v === cur) continue
    if (k === 'name' && v.length < 2) { problems.push('A name is needed.'); continue }
    if (k === 'email' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { problems.push('That email does not look right: ' + v); continue }
    if ((k === 'cell' || k === 'home') && v && v.replace(/\D/g, '').length < 10) { problems.push('That phone number looks too short: ' + v); continue }
    if (k === 'line1' || k === 'city' || k === 'state' || k === 'zip') out.address[k] = v; else (out as Any)[k] = v
    changed.push(k)
  }
  return { contact: out, changed, problems }
}

export type Slot = { list_number: number; name: string; email?: string | null }
export type Plan = { axiscare: { action: 'update' | 'add' | 'hub_only'; slot: number | null; why?: string }; hub: { action: 'update' | 'add'; member_id: string | null } }
/** Where each contact goes. AxisCare: same name -> that slot; else the next free slot of 1-3 not already taken by an
 *  earlier contact; else Hub only. Hub: the member this agreement added before, else the same name, else a new member. */
export function planContacts(contacts: Contact[], slots: Slot[], members: Any[], agreementId: string): Record<number, Plan> {
  const taken = new Set(slots.map((s) => Number(s.list_number)))
  const used = new Set<number>(), plans: Record<number, Plan> = {}
  for (const c of contacts) {
    // 2026-10-17: the same person by email first, then name (person-match.ts)
    const same = findPerson(slots.filter((s) => !used.has(Number(s.list_number))), { name: c.name, email: c.email })
    let ax: Plan['axiscare']
    if (same) { ax = { action: 'update', slot: Number(same.list_number) }; used.add(Number(same.list_number)) }
    else {
      const free = [1, 2, 3].find((n) => !taken.has(n) && !used.has(n))
      if (free) { ax = { action: 'add', slot: free }; used.add(free) }
      else ax = { action: 'hub_only', slot: null, why: "AxisCare's three responsible party slots are taken by other people" }
    }
    const mine = (members ?? []).find((m) => String(m.from_agreement ?? '') === agreementId && Number(m.from_agreement_n) === c.n)
      ?? findPerson(members ?? [], { name: c.name, email: c.email })
    plans[c.n] = { axiscare: ax, hub: mine ? { action: 'update', member_id: String(mine.id) } : { action: 'add', member_id: null } }
  }
  return plans
}

const bool = (v: unknown): boolean | null => (v === true || v === 1 || v === '1') ? true : (v === false || v === 0 || v === '0') ? false : null
/** The full PUT body for a responsible-party slot: the signed contact laid over whatever AxisCare holds (date of birth
 *  and line2 are kept; an empty field on the agreement keeps AxisCare's value). */
export function rpBody(c: Contact, current: Any) {
  const cur = current ?? {}, ca = cur.address ?? {}
  const st = stateCode(c.address.state)
  const address = { line1: c.address.line1 || t(ca.line1) || null, line2: t(ca.line2) || null, city: c.address.city || t(ca.city) || null,
    state: st ?? (t(ca.state) || null), zip: c.address.zip || t(ca.zip) || null }
  const phones: { listNumber: string; type: string; number: string }[] = []
  if (c.cell) phones.push({ listNumber: String(phones.length + 1), type: 'Mobile', number: c.cell })
  if (c.home) phones.push({ listNumber: String(phones.length + 1), type: 'Home', number: c.home })
  const keepPhones = (Array.isArray(cur.phones) ? cur.phones : []).filter((p: Any) => t(p?.number)).slice(0, 2)
    .map((p: Any, i: number) => ({ listNumber: String(i + 1), type: p?.type ?? 'Other', number: t(p.number) }))
  return { name: c.name, relationship: c.relationship || t(cur.relationship) || null, address,
    phones: phones.length ? phones : keepPhones, email: c.email || t(cur.email) || null,
    ...(cur.dateOfBirth ? { dateOfBirth: cur.dateOfBirth } : {}),
    hipaaDisclosureAuthorization: c.hipaa ?? bool(cur.hipaaDisclosureAuthorization),
    canMakeMedicalDecisions: c.medical ?? bool(cur.canMakeMedicalDecisions) }
}
/** A state the agreement gave that AxisCare cannot take (not a USPS code). */
export const badState = (c: Contact) => !!c.address.state && !stateCode(c.address.state)

/** The Hub Family Circle row for a contact. `ax` is AxisCare's slot after the read-back (null for Hub only). */
export function memberRow(c: Contact, ax: { list_number: number; name: string; relationship: string | null; phone: string | null; email: string | null;
  hipaa_authorized: boolean | null; can_make_medical_decisions: boolean | null } | null, opts: { agreementId: string; by: string; at: string }) {
  const texts = c.texts.late || c.texts.change
  return {
    name: ax?.name || c.name, relationship: (ax ? ax.relationship : null) ?? (c.relationship || null),
    phone: (ax ? ax.phone : null) ?? (c.cell || c.home || null), email: (ax ? ax.email : null) ?? (c.email || null),
    hipaa_authorized: ax ? ax.hipaa_authorized : c.hipaa, can_make_medical_decisions: ax ? ax.can_make_medical_decisions : c.medical,
    sms_consent: texts, wants_changes: c.texts.change, wants_late: c.texts.late,
    ...(ax ? { source: 'axiscare', axiscare_list_number: ax.list_number, axiscare_removed_at: null, axiscare_sent_by: opts.by, axiscare_sent_at: opts.at } : {}),
    from_agreement: opts.agreementId, from_agreement_n: c.n,
  }
}

/** What AxisCare's API cannot set, for the office to do by hand and tick off. */
export function todoFor(c: Contact): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = []
  const see = [c.axis.care_notes && 'care notes', c.axis.invoices && 'invoices'].filter(Boolean)
  if (see.length) out.push({ key: `c${c.n}.signin`, text: `Set up ${c.name}'s AxisCare family sign-in to see ${see.join(' and ')}${c.email ? ' (' + c.email + ')' : ' (no email on the agreement: ask for one)'}` })
  const em = [c.emails.weekly_calendar && 'weekly calendar', c.emails.care_plans && 'care plans', c.emails.office_messages && 'office messages', c.emails.invoices && 'invoices'].filter(Boolean)
  if (em.length) out.push({ key: `c${c.n}.emails`, text: `In AxisCare, turn on emails to ${c.name}: ${em.join(', ')}` })
  if ((c.texts.late || c.texts.change) && !(c.cell || c.home)) out.push({ key: `c${c.n}.phone`, text: `${c.name} asked for texts but gave no phone number: ask for a cell number` })
  return out
}
