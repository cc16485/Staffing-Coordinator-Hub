// =============================================================================
// incident.ts · the rules and words for an incident report (Samantha 2026-10-27, Stage 1: "build the incident report as
// planned with your three picks", first real one Ashley Lloyd for Carol Fite's fall)
// =============================================================================
// Pure except the PDF bytes (no network, no clock unless given). The caregiver who was there fills in what happened on a
// private link the office texts (a person presses Send; the Hub never texts by itself when a flag fires), then signs with
// a finger and their typed name. One reminder text after 24 hours if it is still not filled in; then the office card turns
// red and nobody is texted again. Families are never contacted by any of this. Stage 1 is the client incident report;
// the employee work injury report (Stage 3) uses the same record with kind 'employee_injury'.
// =============================================================================
import { BrandPdf, COMPANY_RIGHT, FOOTER, NAVY, MUTED, RULE } from './brand-pdf.ts'
export { sha256, newToken, tokenOk, nameMatches, firstName, shortName, chicagoYmd } from './hr-ack.ts'
import { firstName, shortName } from './hr-ack.ts'
// deno-lint-ignore no-explicit-any
type Any = any

export const BUCKET = 'incident-docs'
export const LINK_DAYS = 7
export const REMIND_AFTER_H = 24
export const REMIND_HOURS = [8, 20] as const          // reminders only from 8am to before 8pm Central
export const PAGE = 'https://cc.mo-care.com/incident.html'
export const OFFICE_PHONE = '(417) 234-8494'
export const MAX_TEXT = 640
export const TRUE_WORDS = 'What I wrote here is true and complete to the best of my knowledge. My typed name and my signature are my electronic signature.'
export const KINDS = { client: 'Client incident report', employee_injury: 'Employee work injury report' } as const
export type Kind = keyof typeof KINDS

/** The questions, in order. The page draws them from this list and the server checks the answers against it. `{first}` is
 *  the client's first name. `when` makes a question show (and be required) only for some answers to an earlier one. */
export type Question = { k: string; type: 'text' | 'long' | 'choice' | 'multi'; label: string; hint?: string; opts?: string[]; optional?: boolean; min?: number;
  when?: { k: string; in: string[] } }
export const TOLD = ['I called the office', 'I texted the office', 'I only wrote it in my shift note', 'I have not told the office until now']
export const QUESTIONS: Question[] = [
  { k: 'time', type: 'text', label: 'About what time did it happen?', hint: 'For example: 2:15 pm' },
  { k: 'where', type: 'choice', label: 'Where did it happen?', opts: ['Bathroom', 'Bedroom', 'Kitchen', 'Living room', 'Stairs or steps', 'Outside', 'In a car', 'Somewhere else'] },
  { k: 'what', type: 'long', label: 'What happened? Tell it in your own words, step by step.', min: 20 },
  { k: 'hurt', type: 'choice', label: 'Was {first} hurt?', opts: ['Yes', 'No', 'Not sure'] },
  { k: 'hurt_how', type: 'long', label: 'What did you see or what did {first} say? (a bruise, a cut, pain, where on the body)', min: 5, when: { k: 'hurt', in: ['Yes', 'Not sure'] } },
  { k: 'did', type: 'long', label: 'What did you do right then?', min: 10 },
  { k: 'help', type: 'multi', label: 'Who was called for help? (pick all that apply)', opts: ['911', 'Family', 'A nurse or doctor', 'No one'] },
  { k: 'saw', type: 'text', label: 'Did anyone else see it happen? Their name, or "no one".' },
  { k: 'told', type: 'choice', label: 'How did you let the office know?', opts: TOLD },
  { k: 'told_when', type: 'text', label: 'When did you call or text the office, and who did you talk to?', hint: 'For example: 2:30 pm, Krystal', when: { k: 'told', in: TOLD.slice(0, 2) } },
  { k: 'more', type: 'long', label: 'Anything else the office should know?', optional: true },
]
export const labelFor = (q: Question, client: unknown) => q.label.replace(/\{first\}/g, firstName(client) || 'the client')
const shows = (q: Question, a: Record<string, unknown>) => !q.when || q.when.in.includes(String(a[q.when.k] ?? ''))

/** Only the known answers, trimmed and capped; a hidden follow-up question is dropped. */
export function cleanAnswers(raw: Any): Record<string, string | string[]> {
  const a: Record<string, string | string[]> = {}
  for (const q of QUESTIONS) {
    const v = raw?.[q.k]
    if (q.type === 'multi') { const arr = (Array.isArray(v) ? v : []).map(String).filter((x) => q.opts!.includes(x)); if (arr.length) a[q.k] = [...new Set(arr)] }
    else if (q.type === 'choice') { if (q.opts!.includes(String(v ?? ''))) a[q.k] = String(v) }
    else { const s = String(v ?? '').replace(/\r\n/g, '\n').replace(/—/g, ',').trim().slice(0, q.type === 'long' ? 3000 : 200); if (s) a[q.k] = s }
  }
  for (const q of QUESTIONS) if (!shows(q, a)) delete a[q.k]
  if (Array.isArray(a.help) && a.help.includes('No one') && a.help.length > 1) a.help = a.help.filter((x) => x !== 'No one')
  return a
}
/** The first question still missing, in the caregiver's words. '' when everything needed is there. */
export function answersMissing(a: Record<string, unknown>, client: unknown): string {
  for (const q of QUESTIONS) {
    if (q.optional || !shows(q, a)) continue
    const v = a[q.k]
    if (q.type === 'multi' ? !(Array.isArray(v) && v.length) : !String(v ?? '').trim()) return 'Please answer: ' + labelFor(q, client)
    if (q.min && String(v).trim().length < q.min) return 'Please say a little more: ' + labelFor(q, client)
  }
  return ''
}
/** The office heard about it from the note, not a call or a text (Stage 4 suggests coaching from this; recorded now). */
export const toldLate = (a: Record<string, unknown>) => a?.told === TOLD[2] || a?.told === TOLD[3]

/** A finger signature: strokes of [x, y] points, each 0 to 1 inside the signing box. Enough ink to be a signature, not
 *  so much that it is something else. Returns the cleaned strokes, or null. */
export function cleanStrokes(raw: unknown): number[][][] | null {
  if (!Array.isArray(raw) || !raw.length || raw.length > 60) return null
  let total = 0
  const out: number[][][] = []
  for (const s of raw) {
    if (!Array.isArray(s)) return null
    const pts: number[][] = []
    for (const p of s) {
      if (!Array.isArray(p) || p.length < 2) return null
      const x = Number(p[0]), y = Number(p[1])
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < -0.01 || x > 1.01 || y < -0.01 || y > 1.01) return null
      pts.push([Math.round(Math.min(1, Math.max(0, x)) * 1000) / 1000, Math.round(Math.min(1, Math.max(0, y)) * 1000) / 1000])
    }
    total += pts.length
    if (pts.length) out.push(pts)
  }
  if (total < 8 || total > 4000) return null
  const xs = out.flat().map((p) => p[0]), ys = out.flat().map((p) => p[1])
  if (Math.max(...xs) - Math.min(...xs) < 0.08 && Math.max(...ys) - Math.min(...ys) < 0.08) return null   // a dot, not a signature
  return out
}

export const linkFor = (token: string) => `${PAGE}?t=${encodeURIComponent(token)}`
const dayWords = (ymd: string) => /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }) : 'that day'
const shortDay = (ymd: string) => /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? new Date(ymd + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }) : ''

/** The text a person checks and sends. The client's first name only, no details of what happened. */
export function draftText(r: Any, link: string): string {
  const f = firstName(r.caregiver) || 'there', c = firstName(r.client_name) || 'your client'
  return `Hi ${f}, this is Caring Companions. We need your incident report for what happened with ${c} on ${dayWords(r.happened_on)}. It takes about 5 minutes: ${link} When something like this happens, please call the office right away too: ${OFFICE_PHONE}.`
}
/** The one reminder (a new private link; the first one stops working). */
export function reminderText(r: Any, link: string): string {
  const f = firstName(r.caregiver) || 'there', c = firstName(r.client_name) || 'your client'
  return `Hi ${f}, a reminder from Caring Companions: we still need your incident report for ${c} on ${dayWords(r.happened_on)}. Here is your link: ${link} Questions? Call the office at ${OFFICE_PHONE}.`
}
/** "Carol F., Oct 26" for anything the office can see at a glance. */
export const caseName = (r: Any) => [shortName(r.client_name), shortDay(r.happened_on)].filter(Boolean).join(', ')

/** The office card's words for where a report stands. */
export function cardState(r: Any, now: Date = new Date()): { next: string; urgency: 'today' | 'urgent' | 'normal'; open: boolean } {
  const cg = firstName(r.caregiver) || 'the caregiver'
  if (r.status === 'cancelled') return { next: 'The report link was cancelled.', urgency: 'normal', open: false }
  if (r.status === 'submitted') return { next: `${cg} filled in and signed the report. Read it (Open the report), then close this card with what was done.`, urgency: 'today', open: true }
  if (!r.sent_at) return { next: `Text ${cg} the report link (Open the report).`, urgency: 'today', open: true }
  if (overdue(r, now)) return { next: `${cg} hasn't filled in the report ${r.reminded_at ? 'after the reminder' : 'after 24 hours'}. Call ${cg}.`, urgency: 'urgent', open: true }
  return { next: `Waiting for ${cg} to fill in the report (texted ${new Date(r.sent_at).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}).`, urgency: 'today', open: true }
}
export const hoursSince = (iso: unknown, now: Date = new Date()) => (now.getTime() - (Date.parse(String(iso ?? '')) || now.getTime())) / 36e5
export const overdue = (r: Any, now: Date = new Date()) => r?.status === 'waiting' && !!r?.sent_at && hoursSince(r.sent_at, now) >= REMIND_AFTER_H
/** The reminder is owed: texted (for real), not filled in after 24 hours, never reminded, the link not expired. */
export const reminderDue = (r: Any, now: Date = new Date()) => overdue(r, now) && !r.practice && !r.reminded_at && !r.cancelled_at
export function inReminderHours(now: Date = new Date()): boolean {
  const h = Number(now.toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false })) % 24
  return h >= REMIND_HOURS[0] && h < REMIND_HOURS[1]
}

/** The words from the shift note the office saw, kept on the report (only the quoted note, not the AI's reasons). */
export function noteWords(detail: unknown): string {
  const m = /"([\s\S]*?)"(?:\n|$)/.exec(String(detail ?? ''))
  return (m ? m[1] : '').replace(/—/g, ',').trim().slice(0, 1500)
}

/* ── Stage 2 (2026-10-27): the office's review of a signed report. Every question answered before it closes. ──
   Missouri's Adult Abuse and Neglect Hotline for suspected abuse, neglect or exploitation (caregivers and agencies are
   mandated reporters): 1-800-392-0210, open every day. */
export const HOTLINE = '1-800-392-0210'
export const MEDICAL = { none: 'No care needed', doctor: 'Saw or called their doctor', urgent: 'Urgent care or the ER', '911': '911 was called', declined: 'Care was offered and declined' } as const
export type Review = { family: { told: 'yes' | 'not_needed'; who?: string; when?: string; why?: string }; medical: { what: keyof typeof MEDICAL; note?: string };
  careplan: { change: boolean; note?: string }; ane: { suspect: boolean; hotline_at?: string; reference?: string }; note?: string }
const str = (v: unknown, n = 300) => String(v ?? '').replace(/\u2014/g, ',').trim().slice(0, n)
/** Only the known fields, trimmed. */
export function cleanReview(raw: Any): Review {
  const f = raw?.family || {}, m = raw?.medical || {}, c = raw?.careplan || {}, a = raw?.ane || {}
  return { family: f.told === 'yes' ? { told: 'yes', who: str(f.who, 120), when: str(f.when, 80) } : f.told === 'not_needed' ? { told: 'not_needed', why: str(f.why) } : { told: '' as 'yes' },
    medical: { what: (Object.keys(MEDICAL).includes(String(m.what)) ? String(m.what) : '') as keyof typeof MEDICAL, note: str(m.note) },
    careplan: { change: c.change === true, note: str(c.note) },
    ane: a.suspect === true ? { suspect: true, hotline_at: str(a.hotline_at, 80), reference: str(a.reference, 80) } : { suspect: a.suspect === false ? false : (null as unknown as boolean) },
    note: str(raw?.note, 1500) }
}
/** The first thing still missing, in the office's words. '' when the review can close. */
export function reviewMissing(r: Review): string {
  if (r.family.told === 'yes' && (!r.family.who || !r.family.when)) return 'Say who in the family was told, and when.'
  if (r.family.told === 'not_needed' && (r.family.why || '').length < 5) return 'Say why the family did not need to be told.'
  if (r.family.told !== 'yes' && r.family.told !== 'not_needed') return 'Was the family told? (A person calls them; the Hub never does.)'
  if (!r.medical.what) return 'Did the client need medical care?'
  if (r.medical.what !== 'none' && (r.medical.note || '').length < 3) return 'Say a little about the medical care (who, where, what they said).'
  if (r.careplan.change && (r.careplan.note || '').length < 5) return 'Say what in the care plan needs to change.'
  if (r.ane.suspect !== true && r.ane.suspect !== false) return 'Could this be abuse, neglect or exploitation? Answer yes or no.'
  if (r.ane.suspect && (!r.ane.hotline_at || !r.ane.reference)) return `Call the hotline (${HOTLINE}) and write down when you called and the report number they gave you.`
  return ''
}
/** One line for the card and the history: what the office did. */
export function reviewSummary(r: Review): string {
  return [r.family.told === 'yes' ? `Family told (${r.family.who}, ${r.family.when})` : 'Family not told: ' + r.family.why,
    MEDICAL[r.medical.what], r.careplan.change ? 'care plan to change' : 'no care plan change',
    r.ane.suspect ? `hotline called ${r.ane.hotline_at}, report ${r.ane.reference}` : 'not abuse or neglect'].join(' · ')
}

const longDay = (d: Date) => d.toLocaleDateString('en-US', { timeZone: 'America/Chicago', month: 'long', day: 'numeric', year: 'numeric' })
const longTime = (d: Date) => d.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit' })
export type Signed = { typedName: string; strokes: number[][][]; at: Date; ip: string; agent: string }
/** The PDF kept in incident-docs: who, when, the caregiver's answers, the note words, the true-and-complete statement and
 *  the finger signature with its audit lines. */
export function reportPdf(r: Any, answers: Record<string, unknown>, s: Signed): Uint8Array {
  const title = KINDS[(r.kind as Kind) || 'client'] || KINDS.client
  const pdf = new BrandPdf(`${title} - ${r.client_name || ''} - ${r.happened_on || ''}`); pdf.footer(FOOTER)
  pdf.headerFn = (p, f) => p.letterhead(COMPANY_RIGHT, f); pdf.letterhead(COMPANY_RIGHT, true)
  pdf.para(title, { font: 'B', size: 18, color: NAVY, lh: 23, after: 2 })
  pdf.para(`Confidential: contains health information · ${r.practice ? 'PRACTICE (not a real report)' : 'record ' + r.id}`, { size: 8.5, color: MUTED, after: 6 })
  pdf.hr(RULE, 6)
  pdf.labelled('Client:', String(r.client_name || ''), { after: 2 })
  pdf.labelled('Caregiver:', String(r.caregiver || ''), { after: 2 })
  pdf.labelled('Date it happened:', /^\d{4}-\d{2}-\d{2}$/.test(String(r.happened_on)) ? new Date(r.happened_on + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '', { after: 2 })
  pdf.labelled('Report started by:', `${r.started_by_name || r.started_by || ''}, ${longDay(new Date(r.started_at || s.at))}`, { after: 8 })
  if (r.note_words) { pdf.heading('From the shift note'); pdf.para('"' + r.note_words + '"', { size: 10, color: MUTED, after: 8 }) }
  pdf.heading('In the caregiver\'s words')
  for (const q of QUESTIONS) {
    const v = answers[q.k]
    if (v === undefined || (Array.isArray(v) && !v.length) || v === '') continue
    pdf.para(labelFor(q, r.client_name), { font: 'S', size: 9.5, color: NAVY, after: 1 })
    pdf.para(Array.isArray(v) ? v.join(', ') : String(v), { size: 10.5, after: 7 })
  }
  pdf.hr(RULE, 8)
  pdf.heading('Signature')
  pdf.para(TRUE_WORDS, { after: 6 })
  pdf.drawing(s.strokes, 220, 70)
  pdf.signatureArea(s.typedName, `${longDay(s.at)}, ${longTime(s.at)} Central`, [
    `Signed electronically with a finger signature and a typed name on the caregiver's private link. ${s.at.toISOString()} UTC. Device address ${s.ip || 'not recorded'}. Browser ${s.agent || 'not recorded'}.`,
    `Answers fingerprint ${r.answers_hash || ''}.`])
  return pdf.build()
}
