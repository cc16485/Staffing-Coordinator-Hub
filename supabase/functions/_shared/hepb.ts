// =============================================================================
// hepb.ts · HEPATITIS B VACCINATION (OSHA 29 CFR 1910.1030; the owner's ruling 2026-10-13; research in
// launch/review/hepb-osha-research.md)
// =============================================================================
// HER RULING BUILT IN: decide which positions have reasonably anticipated occupational exposure (by job classification,
// without regard to gloves, 1910.1030(c)(2)); offer the vaccine at no cost after the bloodborne pathogens training and within
// 10 working days of initial assignment ((f)(1), (f)(2)(i)); the vaccine is never mandatory: the employee may decline by
// signing the Appendix A statement word for word ((f)(2)(iv)) and may change their mind later and get it at no cost
// ((f)(2)(iii)). Exceptions: the series already completed, antibody testing shows immunity, or medically contraindicated
// ((f)(2)(i)). These are confidential medical records ((h)(1)(iii)): server only, documents opened only by owners, every
// open logged; everyone else sees only the status words. Kept for the duration of employment plus 30 years ((h)(1)(iv)):
// nothing here is ever deleted.
//   Pure: the exposure table and its Admin overrides, the Appendix A statement and its fingerprint, the status words,
//   the deadline, the message words, the declination PDF.
//   Database: addEvent, ownerEmails, raiseCard / closeCard, journeyMirror. Nothing here sends a text or an email; the hepb
//   function does.
// deno-lint-ignore-file no-explicit-any
import { centralYmd, nextBusinessDay, isYmd as isYmdStrict } from './business-days.ts'
import { BrandPdf, COMPANY_RIGHT, FOOTER, MUTED, NAVY, RULE } from './brand-pdf.ts'

export const BUCKET = 'hepb-docs'                    // PRIVATE: signed declinations and proofs; medical records, kept 30 years after employment
export const JOURNEY_KEY = 'cg.health.hepb'
export const LINK_DAYS = 21
export const OFFER_WORKING_DAYS = 10                 // 1910.1030(f)(2)(i)
const S = (v: unknown, n = 160) => String(v ?? '').trim().slice(0, n)
export const isYmd = (v: unknown): v is string => isYmdStrict(v)
/* a date stays a date; an instant (Approve to Work) is read on the Chicago calendar */
const ymd = (v: unknown) => { if (v == null || v === '') return null; const s = String(v); if (isYmd(s)) return s; const t = Date.parse(s); return s.length > 10 && Number.isFinite(t) ? centralYmd(t) : isYmd(s.slice(0, 10)) ? s.slice(0, 10) : null }
export const todayCentral = (now: Date | string | number = new Date()) => centralYmd(now)
export const longDate = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })

/* ───── 1. the exposure determination (1910.1030(c)(2)): by job classification, without regard to personal protective
   equipment. The default is the research table (launch/review/hepb-osha-research.md); the Admin page may override any
   position in ops_settings.hepb_exposure = { "<position>": { exposed: true|false, tasks?: [..], note?: ".." } }.
   A position nobody listed counts as "Caregiver" (the fallback), so an unknown title is never left out. ───── */
export type ExposureRow = { position: string; exposed: boolean; scope: 'all' | 'some' | 'none'; tasks: string[]; why: string }
export const FALLBACK_POSITION = 'Caregiver'
const PERSONAL_CARE_TASKS = ['Shaving clients (razor nicks)', 'Nail care for clients', 'Toileting and incontinence care when blood may be present', 'Bathing and skin care over broken skin, sores or wounds', 'Handling laundry, linens or trash soiled with blood', 'First aid for a client\'s cut or fall']
export const DEFAULT_EXPOSURE: ExposureRow[] = [
  { position: 'Caregiver', exposed: true, scope: 'all', tasks: PERSONAL_CARE_TASKS, why: 'Hands-on personal care (bathing, toileting, incontinence care, shaving, nail care) can bring contact with blood or with body fluids visibly contaminated with blood. Decided without regard to gloves (1910.1030(c)(2)(iii)).' },
  { position: 'CNA', exposed: true, scope: 'all', tasks: PERSONAL_CARE_TASKS, why: 'The same hands-on personal care as a Caregiver, with more complex clients.' },
  { position: 'PRN CNA Team', exposed: true, scope: 'all', tasks: PERSONAL_CARE_TASKS, why: 'PRN CNAs cover hands-on personal care shifts.' },
  /* 1037: the PRN Caregiver Team, by the role's label */
  { position: 'PRN Caregiver Team', exposed: true, scope: 'all', tasks: PERSONAL_CARE_TASKS, why: 'PRN Caregivers cover hands-on personal care shifts.' },
  { position: 'LPN', exposed: true, scope: 'all', tasks: PERSONAL_CARE_TASKS, why: 'Licensed nursing staff give hands-on care.' },
  { position: 'RN', exposed: true, scope: 'all', tasks: PERSONAL_CARE_TASKS, why: 'Licensed nursing staff give hands-on care.' },
  { position: 'Companion / Homemaker', exposed: false, scope: 'none', tasks: [], why: 'Companionship, housekeeping, meals and errands only, with no hands-on personal care. If personal care, or cleaning up blood, can be assigned, set this position to exposed.' },
  { position: 'Care Coordinator', exposed: true, scope: 'some', tasks: ['Covering a caregiver shift with hands-on personal care', 'Hands-on help or first aid during a home visit'], why: 'Assessment visits alone involve no reasonably anticipated contact with blood, but in a small office Care Coordinators can cover caregiver shifts. Only those who may do hands-on care need the offer.' },
  { position: 'Office', exposed: false, scope: 'none', tasks: [], why: 'Office work only, no client care. Someone who also covers caregiver shifts is classed by that work.' },
]
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const ALIASES: Record<string, string> = { 'cna current license': 'cna', 'companion': 'companion homemaker', 'homemaker': 'companion homemaker', 'companion homemaker only': 'companion homemaker', 'care coordinator home visits': 'care coordinator', 'office staff': 'office', 'personal care aide': 'caregiver' }
/** The table in force: the defaults with the Admin overrides on top (a malformed override is ignored, never guessed). */
export function exposureTable(st: any): (ExposureRow & { source: 'default' | 'admin' })[] {
  const out = DEFAULT_EXPOSURE.map((r) => ({ ...r, tasks: [...r.tasks], source: 'default' as 'default' | 'admin' }))
  const o = st?.hepb_exposure
  if (!o || typeof o !== 'object' || Array.isArray(o)) return out
  for (const [pos, v] of Object.entries(o)) {
    if (!v || typeof v !== 'object' || typeof (v as any).exposed !== 'boolean' || !S(pos, 80)) continue
    const x = v as any, n = norm(ALIASES[norm(pos)] ?? pos)
    const tasks = Array.isArray(x.tasks) ? x.tasks.map((t: unknown) => S(t, 200)).filter(Boolean).slice(0, 20) : null
    const i = out.findIndex((r) => norm(r.position) === n)
    const base = i >= 0 ? out[i] : { position: S(pos, 80), exposed: x.exposed, scope: 'some' as const, tasks: [], why: '', source: 'admin' as const }
    const row = { ...base, exposed: x.exposed, scope: (x.exposed ? (base.scope === 'none' ? 'some' : base.scope) : 'none') as ExposureRow['scope'], tasks: tasks ?? base.tasks, why: S(x.note, 400) || base.why, source: 'admin' as const }
    if (i >= 0) out[i] = row; else out.push(row)
  }
  return out
}
/** The determination for one position title; an unknown or empty title is decided as the fallback (Caregiver). */
export function exposureFor(position: unknown, st: any): ExposureRow & { source: 'default' | 'admin'; matched: string; fallback: boolean } {
  const t = exposureTable(st), raw = norm(position), n = ALIASES[raw] ?? raw
  const hit = n ? t.find((r) => norm(r.position) === n) : undefined
  const row = hit || t.find((r) => r.position === FALLBACK_POSITION)!
  return { ...row, matched: row.position, fallback: !hit }
}

/* ───── 2. Appendix A to 1910.1030, word for word (public regulation text; (f)(2)(iv) requires this statement) ───── */
/* the statement itself lives in hepb-appendix-a.ts (one copy, also read by the Step 1 form) */
import { APPENDIX_A } from './hepb-appendix-a.ts'
export { APPENDIX_A }
export const DECLINATION = {
  key: 'hepb_declination', title: 'Hepatitis B Vaccine Declination (Mandatory)', version: 1,
  /* the page's words around the statement; the statement itself is APPENDIX_A, never edited */
  intro: [
    'Federal workplace safety rules (OSHA 29 CFR 1910.1030) say that if you choose not to get the hepatitis B vaccine, you sign this exact statement. The words come from the regulation and cannot be changed.',
    'Signing is your choice. You can change your mind at any time while you work here and get the vaccine at no cost to you.',
  ],
  statement: APPENDIX_A,
}
export function declinationText(): string { return [`title|${DECLINATION.title}`, `version|${DECLINATION.version}`, ...DECLINATION.intro.map((p) => `p|${p}`), `statement|${DECLINATION.statement}`].join('\n') }
export async function declinationFingerprint(): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(declinationText()))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/* ───── 3. the record's status, and the words everyone else may see (offered / accepted / declined / complete) ───── */
export const STATUSES = ['not_required', 'pending', 'vaccine', 'complete', 'prior_series', 'immune', 'contraindicated', 'declined'] as const
export type Status = typeof STATUSES[number]
export const CHOICES = ['vaccine', 'prior_series', 'immune', 'contraindicated'] as const
export const CAREGIVER_DOC_KINDS = ['series_proof', 'titer_proof']                 // what a caregiver may upload (never a medical note)
export const DOC_KINDS = ['series_proof', 'titer_proof', 'dose_record', 'provider_note', 'other'] as const
export const DOC_LABEL: Record<string, string> = { series_proof: 'Proof of a completed vaccine series', titer_proof: 'Antibody test result', dose_record: 'Dose record', provider_note: 'Healthcare provider note', other: 'Other document', declination: 'Signed declination' }
export const MIME: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/webp': 'webp', 'application/pdf': 'pdf' }
export const NOT_SET_UP = 'Not set up yet'
/** What the owners see. */
export const OWNER_LABEL: Record<Status, string> = { not_required: 'Not required for this position', pending: 'Waiting for their answer', vaccine: 'Accepted: getting the vaccine', complete: 'Complete: vaccine series done',
  prior_series: 'Already completed the series', immune: 'Immune by antibody test', contraindicated: 'Medical exemption', declined: 'Declined (Appendix A signed)' }
/** What everyone else sees: never which exception, never a dose, never a document. */
export function publicStatus(row: any): string {
  if (!row) return NOT_SET_UP
  switch (row.status as Status) {
    case 'not_required': return 'Not required for this position'
    case 'pending': return row.offered_at ? 'Offered' : 'Not offered yet'
    case 'vaccine': return 'Accepted'
    case 'declined': return 'Declined'
    case 'complete': return 'Complete'
    case 'prior_series': case 'immune': case 'contraindicated': return row.verified_at ? 'Complete' : 'Answered, the office is checking'
    default: return NOT_SET_UP
  }
}
/** The obligation is met (the readiness row completes): a signed declination, the series done, or a checked exception. */
export const obligationMet = (row: any) => !!row && (row.status === 'declined' || row.status === 'complete' || (['prior_series', 'immune', 'contraindicated'].includes(row.status) && !!row.verified_at))
/** May the caregiver change their answer on the link? Before anything was checked or recorded, yes; after a declination,
 *  always to the vaccine ((f)(2)(iii)); once an owner checked or recorded it, they call the office. */
export function mayChoose(row: any, choice: string): { ok: boolean; why?: string } {
  if (!row || row.status === 'not_required') return { ok: false, why: 'The hepatitis B vaccine offer does not apply to your position. Questions: (417) 234-8494.' }
  if (row.status === 'complete') return { ok: false, why: 'Your vaccine series is recorded as complete. Questions: (417) 234-8494.' }
  if (row.status === 'declined') return choice === 'vaccine' ? { ok: true } : { ok: false, why: 'You can choose the vaccine here at any time. For anything else, please call the office: (417) 234-8494.' }
  if (row.verified_at || (Array.isArray(row.doses) && row.doses.length)) return { ok: false, why: 'The office has already recorded your answer. To change it, please call (417) 234-8494.' }
  if (row.status === choice) return { ok: false, why: 'That is already your answer.', }
  return { ok: true }
}

/** Initial assignment: the AxisCare first client visit (first_contact), else the Approve to Work date, else the office's own date. */
export function assignmentFrom(roster: any): { date: string | null; source: string | null } {
  const fc = ymd(roster?.first_contact); if (fc) return { date: fc, source: 'first_contact' }
  const aw = ymd(roster?.approved_to_work_at); if (aw) return { date: aw, source: 'approved_to_work' }
  return { date: null, source: null }
}
/** The offer deadline: 10 working days after initial assignment (Monday to Friday, not a company holiday). */
export const dueFrom = (assignment: string | null, holidays: unknown) => assignment && isYmd(assignment) ? nextBusinessDay(assignment, holidays, OFFER_WORKING_DAYS) : null

/* ───── the words (her voice: warm, short, no em dashes, never pay; every text ends with the STOP line in the sender) ───── */
export function offerMessage(first: string, link: string): { text: string; subject: string; html: string } {
  const hi = `Hi ${first || 'there'}`
  const text = `${hi}, this is Caring Companions. Because your work may bring contact with blood, we offer you the hepatitis B vaccine at no cost to you. It is your choice. Please tell us your answer on your private link: ${link}\nIt works for 21 days. Questions: (417) 234-8494.`
  const html = `<p>${hi},</p><p>Because your work may bring contact with blood, Caring Companions offers you the hepatitis B vaccine at no cost to you. It is your choice.</p><p>Please tell us your answer on your private link:</p><p><a href="${link}">Answer the hepatitis B vaccine offer</a></p><p>It works for 21 days. Questions: (417) 234-8494.</p><p>Thank you,<br>Caring Companions</p>`
  return { text, subject: 'Your hepatitis B vaccine offer from Caring Companions', html }
}

/* ───── the signed declination as a PDF in the company letterhead, with the same audit lines as the Step 1 signatures ───── */
export type DeclSig = { typedName: string; signedAtCentral: string; signedAtUtc: string; ip: string; agent: string; fingerprint: string; recordId: string }
/** where: the words for where it was signed (the private hepatitis B page, or the Step 1 page) */
export function declinationPdf(who: { first: string; last: string; position: string }, sig: DeclSig, where = "the employee's private hepatitis B page"): Uint8Array {
  const pdf = new BrandPdf(`${DECLINATION.title} - ${who.first} ${who.last}`); pdf.footer(FOOTER)
  pdf.headerFn = (p, f) => p.letterhead(COMPANY_RIGHT, f); pdf.letterhead(COMPANY_RIGHT, true)
  pdf.para(DECLINATION.title, { font: 'B', size: 18, color: NAVY, lh: 23, after: 2 })
  pdf.para(`OSHA 29 CFR 1910.1030, Appendix A · version ${DECLINATION.version} · ${who.position || FALLBACK_POSITION} · confidential employee medical record`, { size: 8.5, color: MUTED, after: 4 })
  pdf.labelled('Employee:', `${who.first} ${who.last}`.trim(), { after: 8 })
  pdf.hr(RULE, 8); pdf.heading('Declination statement')
  pdf.para(DECLINATION.statement, { after: 10 })
  pdf.ensure(290)
  pdf.signatureArea(sig.typedName, sig.signedAtCentral, [
    `Signed electronically with consent given on ${where}. ${sig.signedAtUtc} UTC. Device address ${sig.ip || 'not recorded'}. Browser ${sig.agent || 'not recorded'}.`,
    `${DECLINATION.title}, version ${DECLINATION.version}. Wording fingerprint ${sig.fingerprint}.`, `Hepatitis B record ${sig.recordId}.`])
  return pdf.build()
}

/* ───── the database ───── */
export type Who = { name?: string; email?: string; person_id?: string }
export async function addEvent(db: any, id: string, kind: string, who: Who, detail: Record<string, unknown> = {}): Promise<boolean> {
  try {
    const { error } = await db.from('hepb_event').insert({ hepb_id: id, kind, by_name: S(who.name, 120) || null, by_email: S(who.email, 160).toLowerCase() || null, by_person: S(who.person_id, 80) || null, detail })
    return !error
  } catch { return false }
}
/** The owners' emails (staff_roles owner_admin, active persons). The verification cards go to the first. */
export async function ownerEmails(db: any): Promise<string[]> {
  try {
    const { data: r } = await db.from('staff_roles').select('person_id').eq('entity', 'cc_ihs').eq('role', 'owner_admin')
    const ids = (r ?? []).map((x: any) => String(x.person_id)); if (!ids.length) return []
    const { data: p } = await db.from('persons').select('person_id, primary_email, active').in('person_id', ids)
    return (p ?? []).filter((x: any) => x.active !== false).map((x: any) => S(x.primary_email, 160).toLowerCase()).filter(Boolean).sort()
  } catch { return [] }
}
async function list(db: any, key: string): Promise<any[]> { const { data } = await db.from('app_data').select('data').eq('key', key).maybeSingle(); return Array.isArray(data?.data) ? data.data : [] }
/** One Needs Attention card per id; a card a person closed stays closed. The words never hold a medical detail (which
 *  exception, a dose, a document): only the public status words. Never throws. */
export async function raiseCard(db: any, c: { id: string; kind: string; title: string; detail: string; who: string; urgency: 'urgent' | 'today' | 'normal'; owner?: string; owner_name?: string; hepb_id?: string; offer_id?: string | null }): Promise<'raised' | 'open' | 'closed' | 'failed'> {
  try {
    const now = new Date().toISOString()
    const prev = (await list(db, 'ops_items')).find((x) => x && x.id === c.id)
    if (prev && prev.status !== 'done' && prev.status !== 'resolved') return 'open'
    if (prev) return 'closed'
    const { error } = await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { id: c.id, kind: c.kind, domain: 'caregivers', status: 'open', urgency: c.urgency, title: c.title, detail: c.detail, who: c.who,
      hepb_id: c.hepb_id || null, offer_id: c.offer_id || null, owner: c.owner || '', owner_name: c.owner_name || '', created_at: now, first_at: now, last_at: now,
      due: new Date(Date.now() + 24 * 3_600_000).toISOString(), closed_at: null, closed_by: null, close_note: null, resolved_at: null, created_by: 'hepb', opened_by: 'hepb' } })
    return error ? 'failed' : 'raised'
  } catch { return 'failed' }
}
export async function closeCard(db: any, id: string, note: string): Promise<void> {
  try {
    const prev = (await list(db, 'ops_items')).find((x) => x && x.id === id)
    if (!prev || prev.status === 'done' || prev.status === 'resolved') return
    const now = new Date().toISOString()
    await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { ...prev, status: 'done', closed_at: now, closed_by: 'hepb', close_reason: note, last_activity_at: now } })
  } catch { /* the card stays open; a person closes it */ }
}

/** The readiness row cg.health.hepb, written the way driver.ts writes cg.credential.driver: complete when the obligation is
 *  met, not_needed when the position has no exposure, open otherwise. Its evidence holds only the public status words and
 *  the deadline (the readiness card is seen by the whole office). Only for an open or active caregiver journey. */
export async function journeyMirror(db: any, row: any, who: Who = {}): Promise<string> {
  try {
    if (!row?.offer_id) return 'no_offer'
    const { data: j, error } = await db.from('client_journey').select('journey_id, status').eq('subject', 'caregiver').eq('offer_id', String(row.offer_id)).maybeSingle()
    if (error) return 'error'
    if (!j || !['open', 'active'].includes(j.status)) return 'no_journey'
    const { data: cur } = await db.from('client_journey_step').select('*').eq('journey_id', j.journey_id).eq('step_key', JOURNEY_KEY).maybeSingle()
    const target = row.status === 'not_required' ? 'not_needed' : obligationMet(row) ? 'complete' : 'open'
    const evidence = { hepb_id: row.id, status: publicStatus(row), due: row.due_date || null }
    if ((cur?.state || 'open') === target && JSON.stringify(cur?.evidence || {}) === JSON.stringify(evidence)) return 'unchanged'
    const now = new Date().toISOString(), byEmail = S(who.email, 160).toLowerCase() || 'hepb', byName = S(who.name, 120) || 'Hepatitis B'
    let patch: Record<string, unknown>, kind = 'evidence_added', reason: string | null = null
    if (target === 'complete') patch = { state: 'complete', evidence, completed_by: byEmail, completed_by_name: byName, completed_at: now, exception: null }
    else if (target === 'not_needed') { reason = 'Position has no reasonably anticipated exposure to blood'; kind = 'not_needed'; patch = { state: 'not_needed', evidence, completed_by: byEmail, completed_by_name: byName, completed_at: now, exception: { kind: 'not_needed', reason, by: byEmail, at: now, via: 'hepatitis B' } } }
    else { if ((cur?.state || 'open') !== 'open') kind = 'unconfirmed'; patch = { state: 'open', evidence, completed_by: null, completed_by_name: null, completed_at: null, exception: null } }
    const { error: e2 } = await db.from('client_journey_step').upsert({ journey_id: j.journey_id, step_key: JOURNEY_KEY, ...patch, version: (cur?.version ?? 0) + 1, updated_at: now }, { onConflict: 'journey_id,step_key' })
    if (e2) return 'error'
    await db.from('client_journey_event').insert({ journey_id: j.journey_id, step_key: JOURNEY_KEY, actor_email: byEmail, actor_name: byName, kind, detail: { via: 'hepatitis B', status: publicStatus(row) }, reason })
    return target
  } catch { return 'error' }
}


/* ───── 2026-10-13 HEPATITIS B IN STEP 1 (her ruling: the form is in Step 1, offered to everyone; BBP training stays in the
   on-the-job courses). The Step 1 page's server (step1-sign) calls stepOneRecord at the moment the applicant signs the
   form, BEFORE the Step 1 signature is written, so the choice (never kept in the Step 1 answers) is safe in the confidential
   record first. Keyed on the offer: a retry after a failure part way through finds the same record and is safe; a record
   the office or the link already answered is never overwritten. Offering in Step 1 IS the offer ((f)(2)(i): the form shows
   the (g)(2)(vii)(I) information first), so the record is stamped offered, and the 30-minute pass never sends a second
   offer (it sends only for status 'pending' and never makes a second record for the same offer). Practice and preview
   never come here (step1-sign checks). Nothing here sends a text or an email. ───── */
export type StepOneIn = { offerId: string; name: string; position: string; choice: string; at: string; typedName: string; ip: string; agent: string; formVersion: number; formFingerprint: string }
const STEP1_CHOICES = ['vaccine', 'declined', 'prior_series', 'immune', 'contraindicated']
export async function stepOneRecord(db: any, st: any, x: StepOneIn): Promise<{ ok: boolean; row?: any; created?: boolean; kept?: boolean; error?: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(S(x.offerId, 64)) || !STEP1_CHOICES.includes(x.choice)) return { ok: false, error: 'not a Step 1 hepatitis B answer' }
  const by: Who = { name: S(x.name, 100) + ' (Step 1)' }
  try {
    const ex = exposureFor(x.position, st)
    /* offered to everyone (a superset of the exposure determination): the record counts as covered; the position's own
       determination is kept beside it for the Exposure Control Plan */
    const basis = { position: ex.matched, scope: ex.scope, source: ex.source, fallback: ex.fallback, determination: ex.exposed, offered_to_all: true, via: 'step1' }
    const choiceFields: Record<string, unknown> = { status: x.choice, status_at: x.at, choice_at: x.at, choice_by: by.name, step1_at: x.at, offered_at: x.at, offered_via: 'Step 1 form (vaccine information shown first)', verified_at: null, verified_by: null }
    let { data: row } = await db.from('hepb_record').select('*').eq('offer_id', x.offerId).maybeSingle()
    let created = false
    const wasOffered = !!row?.offered_at
    if (!row) {
      const ins = { offer_id: x.offerId, name: S(x.name, 120) || null, position: S(x.position, 80) || FALLBACK_POSITION, position_source: x.position ? 'offer' : 'fallback', exposed: true, exposure_basis: basis, ...choiceFields }
      const { data: made, error } = await db.from('hepb_record').insert(ins).select('*').maybeSingle()
      if (error || !made) { const again = await db.from('hepb_record').select('*').eq('offer_id', x.offerId).maybeSingle(); row = again.data; if (!row) return { ok: false, error: 'could not save the hepatitis B record' + (error ? ': ' + S(error.message, 120) : '') } }
      else { row = made; created = true; await addEvent(db, row.id, 'created', by, { via: 'step1', position: row.position, basis }) }
    }
    if (!created) {
      /* answered already outside Step 1 (the link or an owner): keep it; Step 1 still records its signature */
      if (!row.step1_at && row.status !== 'pending' && row.status !== 'not_required') { await addEvent(db, row.id, 'note', by, { via: 'step1', kept: row.status, why: 'their answer was already recorded; Step 1 did not change it' }); return { ok: true, row, kept: true } }
      const upd: Record<string, unknown> = { ...choiceFields, exposed: true, exposure_basis: { ...(row.exposure_basis || {}), ...basis } }
      if (row.offered_at) { delete upd.offered_at; delete upd.offered_via }
      const { data: after, error } = await db.from('hepb_record').update(upd).eq('id', row.id).select('*').maybeSingle()
      if (error || !after) return { ok: false, error: 'could not save the hepatitis B record' + (error ? ': ' + S(error.message, 120) : '') }
      row = after
    }
    if (created || !wasOffered) await addEvent(db, row.id, 'offered', by, { via: 'step1', information: '1910.1030(g)(2)(vii)(I) shown on the form before the choice', form_version: x.formVersion, form_fingerprint: x.formFingerprint })
    if (x.choice !== 'declined') await addEvent(db, row.id, 'chose', by, { choice: x.choice, via: 'step1', form_version: x.formVersion })
    return { ok: true, row, created }
  } catch (e) { return { ok: false, error: S((e as Error)?.message ?? e, 160) } }
}
/** the signed declination half (the Appendix A statement): written once; the trigger refuses any change afterward */
export async function stepOneDeclination(db: any, row: any, d: { typedName: string; at: string; ip: string; agent: string; fingerprint: string; pdf: string | null }): Promise<any> {
  if (row.declined_at) return row
  const { data } = await db.from('hepb_record').update({ declined_at: d.at, declination_version: DECLINATION.version, declination_fingerprint: d.fingerprint, declination_typed_name: S(d.typedName, 80), declination_pdf: d.pdf }).eq('id', row.id).is('declined_at', null).select('*').maybeSingle()
  await addEvent(db, row.id, 'declined', { name: S(d.typedName, 80) + ' (Step 1)' }, { via: 'step1', typed_name: S(d.typedName, 80), version: DECLINATION.version, fingerprint: d.fingerprint, ip: d.ip, agent: d.agent, consent: true, pdf: d.pdf })
  return data || row
}
