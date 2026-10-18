// =============================================================================
// client-agreement.ts · the rules for a Client Care Agreement signed on a tablet (Stage 1, Samantha 2026-10-16).
// Her decisions that day: finger-drawn signature PLUS typed name; six initials on paper and tablet alike; the signed form
// may later set AxisCare HIPAA / Medical Decisions only after office review (Stage 2, not here).
// Answers are a flat object keyed by the printed agreement's field keys (client-agreement-map.ts), so what the family
// fills in is exactly what gets written onto the real agreement pages. Nothing here talks to AxisCare.
// =============================================================================
import { FIELDS, VERSION, DOC, PDF_SHA256, type Field } from './client-agreement-map.ts'

export { FIELDS, VERSION, DOC, PDF_SHA256 }
export const BUCKET = 'client-agreements'
export const ESIGN_WORDS = 'I agree to sign this Client Care Agreement electronically, and I understand that my finger signature and typed name have the same effect as my handwritten signature. I can ask the office for a paper copy at any time.'

/** The six initials (her ruling 2026-10-16): what each one covers, in reading order. */
export const INITIALS: Record<string, string> = {
  '1': 'Rates, billing, cancellations and the app',
  '2': 'Services, safety, home access and the emergency plan (Exhibits B and D)',
  '3': 'Transportation and use of my car',
  '4': 'Privacy and communication choices (photos, permission to communicate, HIPAA)',
  '5': 'I received the Client Handbook (Exhibits C and E) and agree to the Infectious Disease Waiver (Exhibit F)',
  '6': 'Non-solicitation and the $5,000 direct hire fee',
}

/** Fields the office sets before handing over the tablet; the family cannot change them. */
export const OFFICE_KEYS = new Set(['level.wellness_care', 'level.personal_care', 'level.advanced_care', 'level.hourly_rate',
  'rates.wellness_care', 'rates.personal_care', 'rates.advanced_care'])
/** Written by the server at signing, never by anyone's answers. */
const SERVER_ONLY = (k: string) => k.startsWith('ini.') || k.startsWith('sig.') || k.startsWith('ci.sig.') || k.startsWith('date.') || k === 'poa.initials' || k === 'ci.client_s_name'

/** Groups where exactly one box may be ticked (Yes/No, Accept/Decline, a level). */
export const ONE_OF: string[][] = [
  ['level.wellness_care', 'level.personal_care', 'level.advanced_care'],
  ['car.accept', 'car.decline'], ['comm.accept', 'comm.decline'],
  ...[1, 2, 3, 4].flatMap((n) => [[`c${n}.hipaa_yes`, `c${n}.hipaa_no`], [`c${n}.medical_yes`, `c${n}.medical_no`], [`c${n}.book_yes`, `c${n}.book_no`]]),
]

export type Answers = Record<string, string | boolean>
export type Problem = { field: string; error: string }
const MAX_TEXT = 200

/** Keep only known keys of the right kind; office keys only from the office, family keys only from the family. */
export function cleanAnswers(raw: unknown, who: 'office' | 'family'): { answers: Answers; problems: Problem[] } {
  const answers: Answers = {}, problems: Problem[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { answers, problems: [{ field: '', error: 'Answers are missing.' }] }
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const f: Field | undefined = FIELDS[k]
    if (!f || SERVER_ONLY(k)) { problems.push({ field: k, error: 'Not a field on this agreement.' }); continue }
    if ((who === 'office') !== OFFICE_KEYS.has(k)) { problems.push({ field: k, error: who === 'office' ? 'The family fills this in.' : 'The office sets this.' }); continue }
    if (f.type === 'check') {
      if (v === true) answers[k] = true
      else if (v !== false && v != null) problems.push({ field: k, error: 'Must be ticked or not.' })
    } else if (f.type === 'text') {
      const s = String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
      if (s.length > MAX_TEXT) problems.push({ field: k, error: `Keep it under ${MAX_TEXT} characters.` })
      else if (s) answers[k] = s
    }
  }
  return { answers, problems }
}

const has = (a: Answers, k: string) => a[k] === true || (typeof a[k] === 'string' && (a[k] as string).trim() !== '')

/** What must be true before the client may sign (office part + family part together). */
export function readyToSign(a: Answers, signer: { name?: string; role?: string }): Problem[] {
  const p: Problem[] = []
  const need = (k: string, error: string) => { if (!has(a, k)) p.push({ field: k, error }) }
  for (const g of ONE_OF) if (g.filter((k) => a[k] === true).length > 1) p.push({ field: g[0], error: 'Pick only one.' })
  if (!['level.wellness_care', 'level.personal_care', 'level.advanced_care'].some((k) => a[k] === true)) p.push({ field: 'level.wellness_care', error: 'The office picks the level of care first.' })
  need('level.hourly_rate', 'The office enters the hourly rate first.')
  if (has(a, 'level.hourly_rate') && !/^\d{1,3}(\.\d{2})?$/.test(String(a['level.hourly_rate']))) p.push({ field: 'level.hourly_rate', error: 'Rate looks like 30 or 32.50.' })
  need('client.client_s_name', "Client's name"); need('client.address', 'Address'); need('client.city', 'City'); need('client.zip', 'Zip'); need('client.phone_number', 'Phone number')
  need('c1.name', 'Primary contact name'); need('c1.relationship', 'Primary contact relationship')
  if (!has(a, 'c1.cell_phone') && !has(a, 'c1.home_phone')) p.push({ field: 'c1.cell_phone', error: 'A phone number for the primary contact' })
  for (const n of [1, 2, 3, 4]) {
    if (!has(a, `c${n}.name`)) continue
    if (!has(a, `c${n}.hipaa_yes`) && !has(a, `c${n}.hipaa_no`)) p.push({ field: `c${n}.hipaa_yes`, error: `Contact ${n}: may we share health information? Yes or No` })
    if (!has(a, `c${n}.medical_yes`) && !has(a, `c${n}.medical_no`)) p.push({ field: `c${n}.medical_yes`, error: `Contact ${n}: makes medical decisions? Yes or No` })
    // 2026-10-18b: asked at the care assessment for every contact (only the current master has these boxes; older drafts can't be signed)
    if (FIELDS[`c${n}.book_yes`] && !has(a, `c${n}.book_yes`) && !has(a, `c${n}.book_no`)) p.push({ field: `c${n}.book_yes`, error: `Contact ${n}: can book in the Booking App? Yes or No` })
  }
  need('backup.full_name', 'Backup caregiver name (required)'); need('backup.primary_phone', 'Backup caregiver phone')
  if (!Object.keys(a).some((k) => k.startsWith('access.') && FIELDS[k].type === 'check' && a[k] === true)) p.push({ field: 'access.1_client_responsible_party', error: 'How caregivers get into the home' })
  if (!has(a, 'car.accept') && !has(a, 'car.decline')) p.push({ field: 'car.accept', error: 'Use of my car: Accept or Decline' })
  if (!has(a, 'comm.accept') && !has(a, 'comm.decline')) p.push({ field: 'comm.accept', error: 'Permission to communicate: Accept or Decline' })
  const photos = ['photos.share_with_my_family', 'photos.marketing', 'photos.no_photos'].filter((k) => a[k] === true)
  if (!photos.length) p.push({ field: 'photos.no_photos', error: 'Photos: pick at least one choice' })
  if (a['photos.no_photos'] === true && photos.length > 1) p.push({ field: 'photos.no_photos', error: '"No photos" cannot be picked with the others.' })
  const nm = String(signer?.name || '').trim()
  if (nm.length < 3 || nm.length > 80 || !/\s/.test(nm)) p.push({ field: 'signer.name', error: 'The signer types their full name.' })
  if (!['client', 'representative'].includes(String(signer?.role))) p.push({ field: 'signer.role', error: 'Is the client signing, or someone on their behalf?' })
  if (signer?.role === 'representative' && !has(a, 'poa.name')) p.push({ field: 'poa.name', error: 'A representative fills in the POA section.' })
  return p
}

/** "Mary Ann Smith" -> "MS"; what goes in each initials box. */
export function initialsOf(name: string): string {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean)
  return w.length ? (w[0][0] + (w.length > 1 ? w[w.length - 1][0] : '')).toUpperCase() : ''
}

/** A finger signature: a PNG data URL, not empty, not huge (the same limits as the EVV signature page). */
export function signatureOk(s: unknown): boolean {
  return typeof s === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s) && s.length > 1500 && s.length <= 1_500_000
}

/** Every initials group tapped, each with an ISO time. */
export function initialsComplete(taps: unknown, representative: boolean): Problem[] {
  const t = (taps && typeof taps === 'object') ? taps as Record<string, unknown> : {}
  const p: Problem[] = []
  for (const n of Object.keys(INITIALS)) if (!Number.isFinite(Date.parse(String(t[n] || '')))) p.push({ field: 'ini.' + n, error: `Initials ${n} of 6: ${INITIALS[n]}` })
  if (representative && !Number.isFinite(Date.parse(String(t['poa'] || '')))) p.push({ field: 'poa.initials', error: 'Initials: legal authority to sign for the client' })
  return p
}

/** Central-time date pieces for the "made this __ day of __, 20__" line and the signature dates. */
export function centralDate(iso: string): { day: string; month: string; year2: string; mdY: string; long: string } {
  const d = new Date(iso)
  const part = (o: Intl.DateTimeFormatOptions) => d.toLocaleString('en-US', { timeZone: 'America/Chicago', ...o })
  return { day: part({ day: 'numeric' }), month: part({ month: 'long' }), year2: part({ year: '2-digit' }), mdY: part({ month: 'numeric', day: 'numeric', year: 'numeric' }),
    long: part({ month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' Central' }
}

/** Everything that gets written onto the pages: text values, ticked boxes, initials and signature placements. */
export function stampPlan(a: Answers, opts: { initials: string; signedAt: string; signerName: string; representative: boolean; officeName?: string; officeAt?: string }) {
  const text: Record<string, string> = {}, checks: string[] = [], initials: string[] = [], sigs: Record<string, 'client' | 'office'> = {}
  for (const [k, v] of Object.entries(a)) {
    const f = FIELDS[k]; if (!f) continue
    if (f.type === 'check' && v === true) checks.push(k)
    if (f.type === 'text' && typeof v === 'string') text[k] = k === 'level.hourly_rate' ? v.replace(/^\$/, '') : v
  }
  const d = centralDate(opts.signedAt)
  text['date.day'] = d.day; text['date.month'] = d.month; text['date.year'] = d.year2
  text['ci.client_s_name'] = String(a['client.client_s_name'] || '')
  text['sig.client.printed_name'] = opts.signerName; text['sig.client.date'] = d.mdY
  text['ci.sig.printed_name'] = opts.signerName; text['ci.sig.date'] = d.mdY
  sigs['sig.client.signature'] = 'client'; sigs['ci.sig.signature'] = 'client'
  for (const n of Object.keys(INITIALS)) initials.push('ini.' + n)
  if (opts.representative) initials.push('poa.initials')
  if (opts.officeName && opts.officeAt) {
    text['sig.admin.printed_name'] = opts.officeName; text['sig.admin.date'] = centralDate(opts.officeAt).mdY; sigs['sig.admin.signature'] = 'office'
  }
  return { text, checks, initials, initialsText: opts.initials, sigs }
}
