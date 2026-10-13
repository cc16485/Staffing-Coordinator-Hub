// =============================================================================
// driver.ts · DRIVER COMPLIANCE (Samantha's 7-point ask, 2026-10-13; spec launch/review/driver-compliance-spec.md)
// =============================================================================
// HER RULES BUILT IN: uploading never authorizes driving; only the office verifies (license, insurance, coverage for
// transporting clients during paid caregiving, an acceptable driving record) and only a person on the Admin page's Approve
// drivers list (or an owner) approves; Non-Driver, Pending Verification and Suspended are never eligible for transport
// shifts; on expiry an Approved Driver is suspended until new documents are received AND verified; every change has its
// history line. No em dashes in any words a person reads.
//   Pure: STATUS_LABEL, deriveStatus, missingItems, approveBlockers, renewals, reminderDue, rosterFields, the message words.
//   Database: driverFromStep1 (the Step 1 hook; step1-sign calls it), mirror (the roster door + the readiness card row),
//   addEvent, personOf, raiseCard / closeCard. Nothing here sends a text or an email; the driver-compliance function does.
// deno-lint-ignore-file no-explicit-any
import { centralYmd, addDaysYmd } from './business-days.ts'
import { saveOwnedFields } from './sweep-patch.ts'

export const BUCKET = 'driver-docs'                 // PRIVATE: license photos, insurance proof, driving records
export const PDF_BUCKET = 'onboarding-documents'    // the signed agreements, beside the signed Step 1 forms (700 keeps them)
export const JOURNEY_KEY = 'cg.credential.driver'
export const STATUSES = ['non_driver', 'pending', 'approved', 'suspended'] as const
export type Status = typeof STATUSES[number]
export const STATUS_LABEL: Record<Status, string> = { non_driver: 'Non-Driver', pending: 'Pending Verification', approved: 'Approved Driver', suspended: 'Suspended' }
export const NOT_SET_UP = 'Not set up yet'
export const DOC_KINDS = ['license_front', 'license_back', 'insurance', 'mvr', 'other'] as const
export const CAREGIVER_KINDS = ['license_front', 'license_back', 'insurance']
export const DOC_LABEL: Record<string, string> = { license_front: 'License (front)', license_back: 'License (back)', insurance: 'Proof of auto insurance', mvr: 'Driving record (MVR)', other: 'Other document' }
export const MIME: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/webp': 'webp', 'application/pdf': 'pdf' }
export const MVR_RESULTS = ['acceptable', 'not_acceptable']
export const WHAT_LABEL: Record<string, string> = { license: "driver's license", insurance: 'auto insurance' }
export const STAGES: { k: 'd30' | 'd14' | 'd7'; days: number }[] = [{ k: 'd7', days: 7 }, { k: 'd14', days: 14 }, { k: 'd30', days: 30 }]
export const ROSTER_FIELDS = ['dl_status', 'cleared_to_drive', 'dl_expires', 'auto_ins_expires', 'dl_approved_by', 'dl_approved_at']

const S = (v: unknown, n = 160) => String(v ?? '').trim().slice(0, n)
export const isYmd = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v + 'T12:00:00Z'))
const ymd = (v: unknown) => (v == null ? null : isYmd(String(v).slice(0, 10)) ? String(v).slice(0, 10) : null)
export const todayCentral = (now: Date | string | number = new Date()) => centralYmd(now)
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 86400000)
export const statusLabel = (s: unknown) => STATUS_LABEL[s as Status] || NOT_SET_UP
/** "January 31, 2027" */
export const longDate = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })

/** The documents still counting: not superseded, newest first. */
export function currentDocs(docs: any[], kind: string): any[] {
  return (docs || []).filter((d) => d && d.kind === kind && !d.superseded_at).sort((a, b) => String(b.uploaded_at).localeCompare(String(a.uploaded_at)))
}
const hasDoc = (docs: any[], kind: string) => currentDocs(docs, kind).length > 0
const future = (d: unknown, today: string) => { const x = ymd(d); return !!x && x > today }

/** The status as the office and scheduling read it. Cleared to drive ONLY when approved and both expiries are in the future. */
export function deriveStatus(row: any, today: string = todayCentral()): { status: Status | null; label: string; cleared_to_drive: boolean; expired: string[] } {
  if (!row) return { status: null, label: NOT_SET_UP, cleared_to_drive: false, expired: [] }
  const expired = (['license', 'insurance'] as const).filter((w) => { const x = ymd(row[w + '_expires']); return !!x && x < today })
  const cleared = row.status === 'approved' && future(row.license_expires, today) && future(row.insurance_expires, today)
  return { status: row.status, label: statusLabel(row.status), cleared_to_drive: cleared, expired: [...expired] }
}

/** What is still needed from the caregiver (documents, dates, the agreement). Nothing for a Non-Driver. */
export function missingItems(row: any, docs: any[] = []): string[] {
  if (!row || row.status === 'non_driver') return []
  const out: string[] = []
  if (row.agreement_form !== 'vehicle' || !row.agreement_signed_at) out.push('the Driver/Vehicle Insurance and Transportation Standards Agreement, signed')
  if (!hasDoc(docs, 'license_front')) out.push('a photo of the front of the driver\'s license')
  if (!hasDoc(docs, 'license_back')) out.push('a photo of the back of the driver\'s license')
  if (!hasDoc(docs, 'insurance')) out.push('proof of current auto insurance (the card or the declarations page)')
  if (!ymd(row.license_expires) && !currentDocs(docs, 'license_front').some((d) => ymd(d.expires))) out.push('the license expiration date')
  if (!ymd(row.insurance_expires) && !currentDocs(docs, 'insurance').some((d) => ymd(d.expires))) out.push('the insurance expiration date')
  if (!S(row.insurer)) out.push('the insurance company')
  return out
}

/** Why the office cannot approve yet (empty = may approve). Her five checks plus the signed agreement. */
export function approveBlockers(row: any, docs: any[] = [], today: string = todayCentral()): string[] {
  if (!row) return ['Driver compliance is not set up for this person']
  const out: string[] = []
  if (row.status === 'approved') out.push('Already an Approved Driver')
  if (row.agreement_form !== 'vehicle' || !row.agreement_signed_at) out.push('The Driver/Vehicle agreement is not signed' + (row.agreement_form === 'non_driver' ? ' (they signed the Non-Driver Agreement)' : ''))
  if (!hasDoc(docs, 'license_front') || !hasDoc(docs, 'license_back')) out.push('A current photo of the license front and back is not on file')
  if (!row.license_verified_at) out.push('The license is not verified')
  else if (!future(row.license_expires, today)) out.push('The license is expired or has no expiration date')
  if (!hasDoc(docs, 'insurance')) out.push('Proof of current auto insurance is not on file')
  if (!row.insurance_verified_at) out.push('The insurance is not verified')
  else if (!future(row.insurance_expires, today)) out.push('The insurance is expired or has no expiration date')
  if (!row.coverage_verified_at) out.push('Coverage for transporting clients during paid caregiving is not verified')
  if (!row.mvr_verified_at) out.push('The driving record (MVR) is not verified')
  else if (row.mvr_result !== 'acceptable') out.push('The driving record result is not acceptable')
  return out
}

/** The upcoming expiries, soonest first. */
export function renewals(row: any, today: string = todayCentral()): { what: string; label: string; expires: string; days_left: number }[] {
  if (!row || row.status === 'non_driver') return []
  const out = [] as { what: string; label: string; expires: string; days_left: number }[]
  for (const w of ['license', 'insurance']) { const x = ymd(row[w + '_expires']); if (x) out.push({ what: w, label: WHAT_LABEL[w], expires: x, days_left: daysBetween(today, x) }) }
  return out.sort((a, b) => a.days_left - b.days_left)
}

export type Due = { what: 'license' | 'insurance'; expires: string; stage: 'd30' | 'd14' | 'd7' | 'expired'; key: string; days_left: number }
/** Which reminder (or the expiry) is due today for this row: at most one per expiry, the latest stage reached; a stage already
 *  stamped in row.reminders is never due again. A caregiver who uploaded a newer document of that kind since the 30-day mark
 *  ("updated") gets no further reminder; the expiry itself still suspends until the office verifies the new one. */
export function reminderDue(today: string, row: any, docs: any[] = []): Due[] {
  if (!row || !['approved', 'pending'].includes(row.status)) return []
  const stamps = row.reminders && typeof row.reminders === 'object' ? row.reminders : {}
  const out: Due[] = []
  for (const what of ['license', 'insurance'] as const) {
    const exp = ymd(row[what + '_expires']); if (!exp) continue
    const left = daysBetween(today, exp)
    let stage: Due['stage'] | null = null
    if (left < 0) stage = 'expired'
    else for (const s of STAGES) if (left <= s.days) { stage = s.k; break }
    if (!stage) continue
    const key = `${what}:${exp}:${stage}`
    if (stamps[key]) continue
    if (stage !== 'expired') {
      const from = addDaysYmd(exp, -30)
      const kinds = what === 'license' ? ['license_front', 'license_back'] : ['insurance']
      const updated = kinds.some((k) => currentDocs(docs, k).some((d) => String(d.uploaded_at || '').slice(0, 10) >= from && (!ymd(d.expires) || ymd(d.expires)! > exp)))
      if (updated) continue
    }
    out.push({ what, expires: exp, stage, key, days_left: left })
  }
  return out
}

/** The roster's driving fields for this row. Dates only when the row has them (an office-typed date is never blanked);
 *  the approval only once there is one. */
export function rosterFields(row: any, today: string = todayCentral()): Record<string, unknown> {
  const d = deriveStatus(row, today)
  const f: Record<string, unknown> = { dl_status: d.label, cleared_to_drive: d.cleared_to_drive }
  const le = ymd(row.license_expires), ie = ymd(row.insurance_expires)
  if (le) f.dl_expires = le
  if (ie) f.auto_ins_expires = ie
  if (row.approved_at) { f.dl_approved_by = S(row.approved_by, 120) || null; f.dl_approved_at = String(row.approved_at) }
  return f
}

/* ───── the words (her voice: warm, short, no em dashes; every text ends with the STOP line in the sender) ───── */
export function reminderMessage(first: string, due: { what: string; expires: string; stage: string }, link: string): { text: string; subject: string; html: string } {
  const thing = WHAT_LABEL[due.what] || 'document', when = longDate(due.expires), hi = `Hi ${first || 'there'}`
  const lead = due.stage === 'd30' ? `${hi}, this is Caring Companions. Your ${thing} on file expires ${when}.`
    : due.stage === 'd14' ? `${hi}, a reminder from Caring Companions: your ${thing} on file expires ${when} and we have not received the renewed one yet.`
    : `${hi}, Caring Companions here. Your ${thing} on file expires in ${Math.max(0, daysBetween(todayCentral(), due.expires))} days, on ${when}.`
  const ask = `Please upload your renewed ${thing} here so you can keep transporting clients: ${link}`
  const after = 'If it is not renewed and verified by then, driving clients pauses until it is. Questions: (417) 234-8494.'
  const subject = due.stage === 'd7' ? `Your ${thing} expires ${when}: please upload the renewal` : `Your ${thing} on file expires ${when}`
  const html = `<p>${lead}</p><p>Please upload your renewed ${thing} using your private link so you can keep transporting clients:</p><p><a href="${link}">Upload my renewed ${thing}</a></p><p>${after}</p><p>Thank you,<br>Caring Companions<br>(417) 234-8494</p>`
  return { text: `${lead} ${ask}\n${after}`, subject, html }
}
export const LINK_WHY: Record<string, string> = {
  change: 'to update your driving status or sign your driver agreement',
  renewal: 'to upload your renewed license or insurance',
  documents: 'to add your license photos and proof of insurance',
}
export function linkMessage(first: string, why: string, link: string): { text: string; subject: string; html: string } {
  const what = LINK_WHY[why] || LINK_WHY.documents
  const text = `Hi ${first || 'there'}, this is Caring Companions. Here is your private link ${what}: ${link}\nIt works for 21 days. Questions: (417) 234-8494.`
  return { text, subject: 'Your Caring Companions driver documents link', html: `<p>Hi ${first || 'there'},</p><p>Here is your private link ${what}:</p><p><a href="${link}">Open my driver documents</a></p><p>It works for 21 days. Questions: (417) 234-8494.</p><p>Caring Companions</p>` }
}

/* ───── the database ───── */
export type Who = { name?: string; email?: string; person_id?: string }
export async function addEvent(db: any, dcId: string, kind: string, who: Who, detail: Record<string, unknown> = {}): Promise<boolean> {
  try {
    const { error } = await db.from('driver_compliance_event').insert({ dc_id: dcId, kind, by_name: S(who.name, 120) || null, by_email: S(who.email, 160).toLowerCase() || null, by_person: S(who.person_id, 80) || null, detail })
    return !error
  } catch { return false }
}
async function list(db: any, key: string): Promise<any[]> { const { data } = await db.from('app_data').select('data').eq('key', key).maybeSingle(); return Array.isArray(data?.data) ? data.data : [] }
/** The roster record for a row: by caregiver number, then the offer, then the AxisCare number. */
export async function rosterOf(db: any, row: any): Promise<any | null> {
  const all = await list(db, 'caregivers')
  const one = (f: (x: any) => boolean) => { const m = all.filter((x) => x && f(x)); return m.length === 1 ? m[0] : null }
  if (row.caregiver_id) { const r = one((x) => String(x.id) === String(row.caregiver_id)); if (r) return r }
  if (row.offer_id) { const r = one((x) => x.offer_id != null && String(x.offer_id) === String(row.offer_id)); if (r) return r }
  if (row.axiscare_id) { const r = one((x) => x.axiscare_id != null && String(x.axiscare_id) === String(row.axiscare_id)); if (r) return r }
  return null
}
/** Who this row is about (name, phone, email), from the roster, else Background & References by the offer. Never stored twice. */
export async function personOf(db: any, row: any): Promise<{ first: string; last: string; phone: string; email: string; roster: any | null; coordinator: string; current: boolean }> {
  const r = await rosterOf(db, row)
  let p = r
  if (!p && row.offer_id) p = (await list(db, 'candidates')).find((x) => x && x.offer_id != null && String(x.offer_id) === String(row.offer_id)) || null
  /* current: an active roster caregiver, or a new hire still in Background & References (not marked not hired) */
  const current = r ? r.active !== false : !!p && !(p.not_hired === true || p.not_hired === 'true')
  const [f0, ...l0] = S(row.name, 120).split(/\s+/)
  const co = [r?.coordinator_email, r?.assigned_cc, r?.cc_email].map((x) => S(x, 160).toLowerCase()).find((x) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x)) || ''
  return { first: S(p?.first, 60) || f0 || '', last: S(p?.last, 60) || l0.join(' '), phone: S(p?.phone, 30), email: S(p?.email, 160).toLowerCase(), roster: r, coordinator: co, current }
}
export async function domainOwner(db: any, code = 'caregivers'): Promise<{ email: string; name: string }> {
  try {
    const { data: d } = await db.from('domains').select('owner_person').eq('entity', 'cc_ihs').eq('code', code).maybeSingle()
    if (!d?.owner_person) return { email: '', name: '' }
    const { data: p } = await db.from('persons').select('full_name, primary_email').eq('person_id', d.owner_person).maybeSingle()
    return { email: S(p?.primary_email, 160).toLowerCase(), name: S(p?.full_name, 80) }
  } catch { return { email: '', name: '' } }
}
/** One Needs Attention card per id; a card a person closed stays closed. Never throws. */
export async function raiseCard(db: any, c: { id: string; kind: string; title: string; detail: string; who: string; urgency: 'urgent' | 'today' | 'normal'; owner?: string; owner_name?: string; dc_id?: string; offer_id?: string | null }): Promise<'raised' | 'open' | 'closed' | 'failed'> {
  try {
    const now = new Date().toISOString()
    const items = await list(db, 'ops_items'); const prev = items.find((x) => x && x.id === c.id)
    const isOpen = (x: any) => x && x.status !== 'done' && x.status !== 'resolved'
    if (prev && !isOpen(prev)) return 'closed'
    if (prev) return 'open'
    const { error } = await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { id: c.id, kind: c.kind, domain: 'caregivers', status: 'open', urgency: c.urgency, title: c.title, detail: c.detail, who: c.who,
      dc_id: c.dc_id || null, offer_id: c.offer_id || null, owner: c.owner || '', owner_name: c.owner_name || '', created_at: now, first_at: now, last_at: now,
      due: new Date(Date.now() + 24 * 3_600_000).toISOString(), closed_at: null, closed_by: null, close_note: null, resolved_at: null, created_by: 'driver-compliance', opened_by: 'driver-compliance' } })
    return error ? 'failed' : 'raised'
  } catch { return 'failed' }
}
export async function closeCard(db: any, id: string, note: string): Promise<void> {
  try {
    const prev = (await list(db, 'ops_items')).find((x) => x && x.id === id)
    if (!prev || prev.status === 'done' || prev.status === 'resolved') return
    const now = new Date().toISOString()
    await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { ...prev, status: 'done', closed_at: now, closed_by: 'driver-compliance', close_reason: note, last_activity_at: now } })
  } catch { /* the card stays open; a person closes it */ }
}

/** The new-path readiness card row cg.credential.driver, written the way caregiver-journey's own record / not_needed / undo
 *  write it (the step row with its version counted up, and an event line): complete on approve (completed_by), not_needed on
 *  Non-Driver ("Non-Driver Agreement signed"), back to open on anything else. Only for an open or active caregiver journey. */
async function journeyMirror(db: any, row: any, who: Who, now: string): Promise<string> {
  if (!row.offer_id) return 'no_offer'
  const { data: j, error } = await db.from('client_journey').select('journey_id, status, subject').eq('subject', 'caregiver').eq('offer_id', String(row.offer_id)).maybeSingle()
  if (error) return 'error'
  if (!j || !['open', 'active'].includes(j.status)) return 'no_journey'
  const { data: cur } = await db.from('client_journey_step').select('*').eq('journey_id', j.journey_id).eq('step_key', JOURNEY_KEY).maybeSingle()
  const target = row.status === 'approved' ? 'complete' : row.status === 'non_driver' ? 'not_needed' : 'open'
  if ((cur?.state || 'open') === target) return 'unchanged'
  const byEmail = S(who.email, 160).toLowerCase() || 'driver-compliance', byName = S(who.name, 120) || 'Driver compliance'
  const ev = { ...(cur?.evidence || {}) }
  let patch: Record<string, unknown>, kind: string, reason: string | null = null
  if (target === 'complete') {
    ev.driver_compliance = { dc_id: row.id, approved_by: row.approved_by, approved_at: row.approved_at, license_expires: row.license_expires, insurance_expires: row.insurance_expires, mvr_result: row.mvr_result, coverage: !!row.coverage_verified_at }
    patch = { state: 'complete', evidence: ev, completed_by: byEmail, completed_by_name: byName, completed_at: row.approved_at || now, blocked_reason: null, exception: null }; kind = 'evidence_added'
  } else if (target === 'not_needed') {
    reason = 'Non-Driver Agreement signed'
    patch = { state: 'not_needed', completed_by: byEmail, completed_by_name: byName, completed_at: now, exception: { kind: 'not_needed', reason, by: byEmail, at: now, via: 'driver compliance' } }; kind = 'not_needed'
  } else {
    reason = S(row.status_reason, 200) || STATUS_LABEL[row.status as Status]
    ev.reopened = { at: now, by: byEmail, why: reason, status: row.status }
    patch = { state: 'open', completed_by: null, completed_by_name: null, completed_at: null, exception: null, evidence: ev }; kind = 'unconfirmed'
  }
  const { error: e2 } = await db.from('client_journey_step').upsert({ journey_id: j.journey_id, step_key: JOURNEY_KEY, ...patch, version: (cur?.version ?? 0) + 1, updated_at: now }, { onConflict: 'journey_id,step_key' })
  if (e2) return 'error'
  await db.from('client_journey_event').insert({ journey_id: j.journey_id, step_key: JOURNEY_KEY, actor_email: byEmail, actor_name: byName, kind, detail: { via: 'driver compliance', status: row.status }, reason })
  return target
}

/** Every status change (and once for everyone at install): the roster's six driving fields through driver_roster_patch, and
 *  the readiness card row. A Step 1 record is linked to its roster caregiver the first time one is found. Never throws. */
export async function mirror(db: any, row: any, opts: { who?: Who; today?: string } = {}): Promise<{ roster: string; journey: string }> {
  const today = opts.today || todayCentral(), now = new Date().toISOString(), out = { roster: 'not_on_roster', journey: 'skipped' }
  try {
    const rec = await rosterOf(db, row)
    if (rec) {
      if (!row.caregiver_id && rec.id != null) { const { error } = await db.from('driver_compliance').update({ caregiver_id: String(rec.id) }).eq('id', row.id).is('caregiver_id', null); if (!error) row.caregiver_id = String(rec.id) }
      const fields = rosterFields(row, today)
      out.roster = await saveOwnedFields(db, 'driver_roster_patch', ROSTER_FIELDS, { ...rec, ...fields }, (fresh: any) => Object.assign(fresh, fields))
    }
  } catch { out.roster = 'error' }
  try { out.journey = await journeyMirror(db, row, opts.who || {}, now) } catch { out.journey = 'error' }
  if (out.roster === 'error' || out.roster === 'skipped' || out.journey === 'error') {
    await raiseCard(db, { id: 'dc_mirror_' + row.id, kind: 'driver_mirror_failed', urgency: 'today', who: S(row.name, 120), dc_id: row.id, offer_id: row.offer_id,
      title: 'Driver status did not reach their caregiver record: ' + (S(row.name, 120) || 'a caregiver'),
      detail: `Their driver compliance status is ${statusLabel(row.status)}, but the Hub could not copy it to ${out.roster === 'error' || out.roster === 'skipped' ? 'their roster record (someone may have been editing it)' : 'their readiness card'}. Scheduling may show an old driving status. Open their Driver Compliance and press Save again, or tell Claude.` })
  }
  return out
}

/* ───── the Step 1 hook (step1-sign calls this when the vehicle or the non-driver form is signed) ─────
   answers: transport_willing 'yes' | 'no'; license_front, license_back, insurance_doc as { path, content_type } already in
   driver-docs under offer/<offer id>/; license_expires, insurance_expires (YYYY-MM-DD), insurer, license_state.
   signatures: { vehicle?: { at, typed_name, version, fingerprint }, non_driver?: {...} }; pdfs: { vehicle?: path, non_driver?: path }.
   Idempotent: a second call with the same things writes nothing new. Never throws; returns what it did. */
const STEP1_DOCS: [string, string][] = [['license_front', 'license_front'], ['license_back', 'license_back'], ['insurance_doc', 'insurance']]
export async function driverFromStep1(db: any, offerId: string, who: { first?: string; last?: string; phone?: string; email?: string }, answers: Record<string, any>, signatures: Record<string, any> = {}, pdfs: Record<string, any> = {}, at: string = new Date().toISOString()): Promise<Record<string, unknown>> {
  const oid = S(offerId, 64)
  if (!/^[0-9a-f-]{36}$/i.test(oid)) return { ok: false, error: 'not an offer id' }
  const willing = answers?.transport_willing === 'yes' || answers?.transport_willing === true ? 'yes' : answers?.transport_willing === 'no' || answers?.transport_willing === false ? 'no' : null
  if (!willing) return { ok: true, skipped: 'no transport answer yet' }
  const by: Who = { name: 'Step 1 (' + (`${S(who?.first, 60)} ${S(who?.last, 60)}`.trim() || 'the applicant') + ')' }
  const name = `${S(who?.first, 60)} ${S(who?.last, 60)}`.trim() || null
  try {
    let { data: row } = await db.from('driver_compliance').select('*').eq('offer_id', oid).maybeSingle()
    let created = false, statusChanged = false
    if (!row) {
      const ins = { offer_id: oid, name, status: willing === 'yes' ? 'pending' : 'non_driver', status_reason: willing === 'yes' ? 'Step 1: asked to transport clients' : 'Step 1: will not transport clients', status_at: at }
      const { data: made, error } = await db.from('driver_compliance').insert(ins).select('*').maybeSingle()
      if (error || !made) { const again = await db.from('driver_compliance').select('*').eq('offer_id', oid).maybeSingle(); row = again.data; if (!row) return { ok: false, error: 'could not create the driver record' } }
      else { row = made; created = true; statusChanged = true; await addEvent(db, row.id, 'created', by, { from: 'step1', transport_willing: willing, status: row.status }) }
    }
    const upd: Record<string, unknown> = {}
    /* the signed agreement */
    const form = willing === 'yes' ? 'vehicle' : 'non_driver', sig = signatures?.[form]
    if (sig && sig.at && !(row.agreement_form === form && row.agreement_signed_at && Date.parse(row.agreement_signed_at) === Date.parse(sig.at))) {
      Object.assign(upd, { agreement_form: form, agreement_signed_at: sig.at, agreement_version: Number(sig.version) || null, agreement_pdf: S(pdfs?.[form], 500) || null })
      await addEvent(db, row.id, 'agreement_signed', by, { form, version: Number(sig.version) || null, typed_name: S(sig.typed_name, 120), fingerprint: S(sig.fingerprint, 64) || null, pdf: S(pdfs?.[form], 500) || null, from: 'step1' })
    }
    /* the documents already uploaded in Step 1: only under offer/<this offer>/ */
    const refused: string[] = []
    if (willing === 'yes') {
      const { data: have } = await db.from('driver_document').select('*').eq('dc_id', row.id)
      const docs: any[] = have ?? []
      for (const [k, kind] of STEP1_DOCS) {
        const v = answers?.[k]; if (!v || typeof v !== 'object') continue
        const p = S(v.path, 500), ct = S(v.content_type, 60).toLowerCase()
        if (!p.startsWith(`offer/${oid}/`) || p.includes('..') || !/^[A-Za-z0-9/._-]+$/.test(p) || !MIME[ct]) { refused.push(k); continue }
        if (docs.some((d) => d.path === p)) continue
        const exp = kind === 'insurance' ? ymd(answers.insurance_expires) : kind === 'license_front' ? ymd(answers.license_expires) : null
        const { data: nd, error } = await db.from('driver_document').insert({ dc_id: row.id, kind, path: p, content_type: ct, uploaded_by: 'caregiver', uploaded_at: at, expires: exp }).select('*').maybeSingle()
        if (error || !nd) { refused.push(k); continue }
        for (const old of currentDocs(docs, kind)) await db.from('driver_document').update({ superseded_at: at }).eq('id', old.id).is('superseded_at', null)
        docs.push(nd)
        await addEvent(db, row.id, 'doc_uploaded', by, { kind, doc_id: nd.id, content_type: ct, expires: exp, from: 'step1' })
      }
      if (refused.length) await addEvent(db, row.id, 'note', by, { refused_documents: refused, why: 'not a Step 1 upload for this offer, or not an image or PDF' })
      /* the dates and the insurer (the office verifies them; an approved record keeps its verified dates) */
      if (row.status !== 'approved') {
        const le = ymd(answers?.license_expires), ie = ymd(answers?.insurance_expires), ins = S(answers?.insurer, 120), ls = S(answers?.license_state, 2).toUpperCase()
        if (le && le !== ymd(row.license_expires)) upd.license_expires = le
        if (ie && ie !== ymd(row.insurance_expires)) upd.insurance_expires = ie
        if (ins && ins !== row.insurer) upd.insurer = ins
        if (/^[A-Z]{2}$/.test(ls) && ls !== row.license_state) upd.license_state = ls
      }
      if (row.status === 'non_driver') { Object.assign(upd, { status: 'pending', status_reason: 'Step 1: asked to transport clients', status_at: at }); statusChanged = true; await addEvent(db, row.id, 'driver_requested', by, { from: 'step1' }) }
    } else if (row.status !== 'non_driver') {
      Object.assign(upd, { status: 'non_driver', status_reason: 'Step 1: will not transport clients', status_at: at }); statusChanged = true
      await addEvent(db, row.id, 'non_driver', by, { from: 'step1', reason: 'Non-Driver Agreement' + (sig ? ' signed' : '') + ' in Step 1' })
    }
    if (!row.name && name) upd.name = name
    if (Object.keys(upd).length) { const { data: after, error } = await db.from('driver_compliance').update(upd).eq('id', row.id).select('*').maybeSingle(); if (error) return { ok: false, dc_id: row.id, error: 'could not save the driver record: ' + S(error.message, 120) }; row = after || { ...row, ...upd } }
    const m = statusChanged ? await mirror(db, row, { who: by }) : null
    return { ok: true, dc_id: row.id, status: row.status, created, changed: Object.keys(upd), refused, mirror: m }
  } catch (e) { return { ok: false, error: S((e as Error)?.message ?? e, 160) } }
}
