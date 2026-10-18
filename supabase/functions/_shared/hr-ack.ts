// =============================================================================
// hr-ack.ts · the rules and words for a write-up acknowledgment (HR Agent build step 8, Samantha 2026-10-18)
// =============================================================================
// Pure except the PDF bytes (no network, no clock unless given). Her decisions: the caregiver signs that they RECEIVED
// the notice, not that they agree, with a typed full name and a tick, on a private link Zach texts (he sees the words
// and presses Send) or in person on an office or Zach's phone. A refusal is recorded by Zach with the date, how it was
// delivered and a witness (no witness only with a reason). A link not signed in 5 business days is shown to Zach to
// record as "Did not sign". AxisCare gets a short note with no details; the PDF is uploaded there by Zach.
// =============================================================================
import { BrandPdf, COMPANY_RIGHT, FOOTER, NAVY, MUTED, RULE } from './brand-pdf.ts'
// deno-lint-ignore no-explicit-any
type Any = any

export const BUCKET = 'hr-docs'
export const LINK_DAYS = 7
export const UNSIGNED_BUSINESS_DAYS = 5
export const PAGE = 'https://cc.mo-care.com/notice.html'
export const OFFICE_PHONE = '(417) 234-8494'
export const RECEIPT_WORDS = 'I received this notice and had the chance to read it. Signing only shows that I received it. It does not mean I agree with it.'
export const HOW = { phone: 'by phone', video: 'by video call', in_person: 'in person', text_link: 'by text link (not signed)' } as const
export const MAX_TEXT = 640

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
export async function sha256(s: string): Promise<string> { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))) }
/** A private link code: 32 random bytes, URL safe. Only its hash is kept. */
export function newToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export const linkFor = (token: string) => `${PAGE}?t=${encodeURIComponent(token)}`
export const tokenOk = (t: unknown) => typeof t === 'string' && /^[A-Za-z0-9_-]{40,60}$/.test(t)

const words = (s: unknown) => String(s ?? '').trim().split(/\s+/).filter(Boolean)
export const firstName = (s: unknown) => words(s)[0] || ''
/** "Jordan M." for anything the office can see (her rule for office-visible cards). */
export const shortName = (s: unknown) => { const w = words(s); return w.length > 1 ? `${w[0]} ${w[w.length - 1][0]}.` : (w[0] || 'A caregiver') }
const nameKey = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '')
/** The typed name must be a full name (two words) and share the first or last name with the caregiver on the notice. */
export function nameMatches(typed: unknown, caregiver: unknown): boolean {
  const t = words(typed), c = words(caregiver)
  if (t.length < 2 || !c.length) return false
  return nameKey(t[0]) === nameKey(c[0]) || nameKey(t[t.length - 1]) === nameKey(c[c.length - 1])
}

/** The text Zach sees and can change before pressing Send. No reason or level in a text. */
export function draftText(caregiver: unknown, link: string): string {
  const f = firstName(caregiver) || 'there'
  return `Hi ${f}, this is Caring Companions. Zach has a notice for you to read and sign. Signing only says you received it, not that you agree. It is private to you: ${link} Questions? Call the office at ${OFFICE_PHONE}.`
}

const longDay = (d: Date) => d.toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'long', day: 'numeric', year: 'numeric' })
const ymdLong = (ymd: string) => new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })
export const chicagoYmd = (d: Date = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })

/** The AxisCare note: what happened and where the copy is. Never the reason or the notice text. */
export function axNoteText(level: string, outcome: 'signed' | 'refused' | 'did_not_sign', when: string): string {
  const what = outcome === 'signed' ? `received and signed electronically on ${when}` : outcome === 'refused' ? `delivered on ${when}; the caregiver declined to sign (witnessed)` : `sent; not signed by ${when}`
  return `Corrective action notice${level ? ' (' + level + ')' : ''}: ${what}. The notice and its record are kept in the Caring Companions Hub (HR, Formal cases); the PDF is uploaded to this caregiver's documents.`
}

/** Monday to Friday days from `from` to `to` (both Chicago dates), not counting `from`. */
export function businessDaysBetween(fromIso: string, to: Date = new Date()): number {
  const a = new Date(chicagoYmd(new Date(fromIso)) + 'T12:00:00Z'), b = new Date(chicagoYmd(to) + 'T12:00:00Z')
  let n = 0
  for (const d = new Date(a); d < b;) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) n++ }
  return n
}
export const unsignedTooLong = (ack: Any, now: Date = new Date()) =>
  ack?.status === 'waiting' && ack?.via === 'link' && !!ack?.sent_at && businessDaysBetween(ack.sent_at, now) >= UNSIGNED_BUSINESS_DAYS

/** A refusal or "did not sign" record: what Zach must fill in. '' when it is complete. */
export function refusalMissing(r: Any): string {
  if (!['refused', 'did_not_sign'].includes(r?.outcome)) return 'Pick Refused to sign or Did not sign.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r?.date || ''))) return 'Enter the date.'
  if (!Object.keys(HOW).includes(String(r?.how || ''))) return 'Say how the notice was delivered.'
  const w = String(r?.witness || '').trim(), why = String(r?.witness_reason || '').trim()
  if (!w && why.length < 5) return 'Name the witness, or say why there was none.'
  return ''
}

/** The notice as the caregiver reads it: the drawn lines and the blank signature lines at the end are left out (the
 *  acknowledgment below it replaces them). */
export function readableNotice(text: unknown): string {
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n')
  const cut = lines.findIndex((l) => /^\s*(employee signature|employee:\s*_{3,}|signature\b|acknowledge?ment:)/i.test(l))
  const kept = (cut > 0 ? lines.slice(0, cut) : lines).filter((l) => !/^[\s═─_=-]{6,}$/.test(l))
  while (kept.length && /^\s*(employee comments:?)?\s*$/i.test(kept[kept.length - 1])) kept.pop()
  return kept.join('\n').replace(/\u2014/g, ',').trim()
}

export type SignedBy = { typedName: string; at: Date; ip: string; agent: string; via: 'link' | 'in_person' }
export type Refusal = { outcome: 'refused' | 'did_not_sign'; date: string; how: keyof typeof HOW; witness: string; witness_reason: string; note: string; by: string; at: Date }
/** The PDF kept in hr-docs: the notice, the receipt statement, and either the electronic signature with its audit
 *  lines, or the refusal record with the witness. */
export function ackPdf(ack: Any, out: { signed?: SignedBy; refusal?: Refusal }): Uint8Array {
  const pdf = new BrandPdf(`Corrective Action Notice - ${ack.caregiver}`); pdf.footer(FOOTER)
  pdf.headerFn = (p, f) => p.letterhead(COMPANY_RIGHT, f); pdf.letterhead(COMPANY_RIGHT, true)
  pdf.para('Corrective Action Notice', { font: 'B', size: 18, color: NAVY, lh: 23, after: 2 })
  pdf.para(`${ack.level || 'Corrective action'} · confidential HR record · ${ack.practice ? 'PRACTICE (not a real notice)' : 'record ' + ack.id}`, { size: 8.5, color: MUTED, after: 6 })
  pdf.hr(RULE, 6)
  for (const p of readableNotice(ack.notice).split(/\n{2,}/)) pdf.para(p, { size: 10, after: 6 })
  pdf.hr(RULE, 8)
  pdf.heading('Acknowledgment of receipt')
  pdf.para(RECEIPT_WORDS, { after: 8 })
  if (out.signed) {
    const s = out.signed
    pdf.signatureArea(s.typedName, `${longDay(s.at)}, ${s.at.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })} Central`, [
      `Signed electronically with consent ${s.via === 'in_person' ? 'in person on a Caring Companions device' : "on the employee's private link"}. ${s.at.toISOString()} UTC. Device address ${s.ip || 'not recorded'}. Browser ${s.agent || 'not recorded'}.`,
      `Notice fingerprint ${ack.notice_hash}.`])
  } else if (out.refusal) {
    const r = out.refusal
    pdf.heading(r.outcome === 'refused' ? 'The employee declined to sign' : 'The employee did not sign')
    pdf.labelled('Date:', ymdLong(r.date), { after: 2 })
    pdf.labelled('Delivered:', HOW[r.how], { after: 2 })
    pdf.labelled('Witness:', r.witness ? r.witness : `None. ${r.witness_reason}`, { after: 2 })
    if (r.note) pdf.labelled('Note:', r.note, { after: 2 })
    pdf.labelled('Recorded by:', `${r.by}, ${longDay(r.at)}`, { after: 8 })
    pdf.para('A refusal to sign does not change the notice. It was delivered and is part of the employee\'s record.', { size: 9, color: MUTED, after: 4 })
    pdf.para(`Notice fingerprint ${ack.notice_hash}.`, { size: 7.5, color: MUTED })
  }
  return pdf.build()
}
