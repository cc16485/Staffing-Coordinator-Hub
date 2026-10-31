// =============================================================================
// nurse-hire.ts · LPN HIRING (Samantha approved the LPN nurse visit plan, 2026-10-14; Natasha Early is our W-2 RN)
// =============================================================================
// What an LPN or RN hire needs on top of the caregiver process (which does not change):
//   the four readiness rows (applies { licensed_nurse: true }, so a caregiver never sees them):
//     cg.credential.nurse_license   the office's Nursys QuickConfirm check: who, date, result, screenshot, expiration
//     cg.nurse.orientation          the 7-topic nurse orientation (Personal Care Provider Manual 2.6): date, who gave it, each topic
//     cg.nurse.section2_ack         the signed statement that she read Section 2 of the manual (manual 2.3): the signed copy, uploaded
//     cg.step2.position_description the Viventium Step 2 LPN packet (job description, RN supervision acknowledgment, documentation
//                                   expectations), ONE tick on Step 2 Verify
//   the pure checks for what the office records (licenseVerdict, orientationVerdict, section2Verdict)
//   the nurse list record made at Approve to Work (nurseStaffRecord) and the AxisCare nurse class (setCaregiverNurseClass)
//   the training waiver: a licensed nurse's other aide hours are waived (19 CSR 15-7.021(22)(A)4) EXCEPT the 2-hour agency
//     orientation and the dementia training; the one course waived is the On-the-Job Skills Training (WAIVED_COURSES)
// Nothing here sends a message. The Approve to Work steps run only with the Admin switch nurse_hire_live on; off = practice.
// deno-lint-ignore-file no-explicit-any
import { ax, errText, recordAxisChange } from './axiscare-caregiver.ts'
import { caregiverOf, classesSeen, CLASSES_STOP } from './axis-caregiver-read.ts'
import { validKey } from './positions.ts'
import { BrandPdf, COMPANY_RIGHT, FOOTER, MUTED } from './brand-pdf.ts'
export const NURSE_SWITCH = 'nurse_hire_live'
export const NURSE_ROWS = ['cg.credential.nurse_license', 'cg.nurse.orientation', 'cg.nurse.section2_ack', 'cg.step2.position_description'] as const
/** the rows the office records through the nurse forms (never the generic Record prompt) */
export const NURSE_RECORDED = ['cg.credential.nurse_license', 'cg.nurse.orientation', 'cg.nurse.section2_ack'] as const
export const SUPERVISING_RN_NAME = 'Natasha Early'
export const LICENSE_SOURCE = 'Nursys QuickConfirm (nursys.com), the Missouri State Board of Nursing\'s primary source equivalent'
/** MO HealthNet Personal Care Provider Manual 2.6, quoted (published 08/10/2026): the nurse's general orientation */
export const ORIENTATION_TOPICS: { id: string; text: string }[] = [
  { id: 'ethics', text: 'Code of ethics' },
  { id: 'rights', text: "Participant's bill of rights; refer to Section 2.14 of this manual for more information" },
  { id: 'activities', text: 'Activities which shall or shall not be performed' },
  { id: 'infection', text: 'Infection control and universal precaution procedures as defined by the CDC' },
  { id: 'records', text: 'Record keeping requirements and reporting forms required by the personal care provider or state agency, or its designee who authorized the service' },
  { id: 'osha', text: 'OSHA standards regarding precautions to be taken to avoid risks associated with bloodborne pathogens' },
  { id: 'communicating', text: 'Communicating with the appropriate state agency or its designee and taking appropriate action on clinical changes in the participant\'s condition' },
]
export const ORIENTATION_VERSION = 1
/** The Section 2 acknowledgment statement (manual 2.3: "documentation in their personnel files that they have been given and
    have read this section"). Version 1, PROPOSED; the words are in launch/review/lpn/lpn-documents.md for her approval. */
export const SECTION2_VERSION = 1
export function section2Statement(name: string, licenseWords: string): { k: 'h' | 'p' | 'li' | 'small' | 'q'; t: string }[] {
  return [
    { k: 'h', t: 'Acknowledgment: Section 2 of the Missouri Personal Care Provider Manual' },
    { k: 'p', t: `Employee: ${name || '______________________________'}` },
    { k: 'p', t: `License: ${licenseWords || '______________________________'}` },
    { k: 'p', t: 'I acknowledge that Caring Companions In-Home Senior Care gave me Section 2 of the MO HealthNet Personal Care Provider Manual, and that I have read it.' },
    { k: 'p', t: 'I understand that Section 2 sets out the program rules that apply to my work as a nurse with Caring Companions, including participant rights, the services that may and may not be provided, documentation and record keeping, and reporting.' },
    { k: 'p', t: 'I will ask my supervising registered nurse or the office about any part of it I have questions about, and I will follow it in my work.' },
    { k: 'p', t: 'Employee signature: ______________________________     Date: ______________' },
    { k: 'small', t: 'Kept in the employee\'s personnel file (MO HealthNet Personal Care Provider Manual, section 2.3). Statement version ' + SECTION2_VERSION + '.' },
  ]
}
/** The nurse orientation checklist (the 7 topics, quoted), to print, give and sign; the office records it on the readiness card. */
export function orientationChecklist(name: string): { k: 'h' | 'p' | 'li' | 'small' | 'q'; t: string }[] {
  return [
    { k: 'h', t: 'Nurse orientation checklist' },
    { k: 'p', t: `Nurse: ${name || '______________________________'}` },
    { k: 'p', t: 'MO HealthNet Personal Care Provider Manual 2.6: "The provider shall provide a general orientation for the nurse prior to the delivery of services which shall include instruction on the following:"' },
    ...ORIENTATION_TOPICS.map((t, i) => ({ k: 'li' as const, t: `${i + 1}. ${t.text}     Covered: ____` })),
    { k: 'p', t: 'Date of orientation: ______________     Given by: ______________________________' },
    { k: 'p', t: 'Nurse signature: ______________________________     Trainer signature: ______________________________' },
    { k: 'small', t: 'Completed before the first nurse visit and kept in the personnel file. Checklist version ' + ORIENTATION_VERSION + '.' },
  ]
}
const S = (v: unknown, n = 160) => String(v ?? '').trim().slice(0, n)
const ymd = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(S(v, 10)) ? S(v, 10) : null
export type Verdict = { ok: boolean; state?: 'complete' | 'blocked'; reason?: string; error?: string; evidence?: Record<string, unknown> }
/** A document path the office uploaded for this offer (the nurse folder of the private onboarding store) */
export const nurseDocOk = (offerId: string, kind: string, path: unknown): boolean => new RegExp('^nurse/' + offerId.replace(/[^0-9a-f-]/gi, '') + '/' + kind + '-\\d{10,16}\\.(jpg|jpeg|png|heic|heif|webp|pdf)$').test(S(path, 200))
export const NURSE_DOC_KINDS = ['nursys', 'section2', 'orientation'] as const
/** The Nursys QuickConfirm check. Complete only when the result is active with no discipline shown, the license is current, and
    its type matches the position; anything else is recorded and BLOCKS the card with the reason (never waved through). */
export function licenseVerdict(b: any, ctx: { offerId: string; positionKey: unknown; today: string; last4?: string | null; by: { email?: string; name?: string } }): Verdict {
  const type = S(b?.license_type, 4).toUpperCase(), result = S(b?.result, 20), checked = ymd(b?.checked_on), expires = ymd(b?.expires)
  const state = /^[A-Za-z]{2}$/.test(S(b?.state, 10)) ? S(b?.state, 2).toUpperCase() : '', multistate = b?.multistate === true ? true : b?.multistate === false ? false : null
  const discipline = b?.discipline === true ? true : b?.discipline === false ? false : null
  if (!['LPN', 'RN'].includes(type)) return { ok: false, error: 'Pick the license type shown on Nursys: LPN or RN.' }
  if (!['active', 'not_active', 'not_found'].includes(result)) return { ok: false, error: 'Pick the result Nursys QuickConfirm showed.' }
  if (!checked || checked > ctx.today) return { ok: false, error: 'The date you checked Nursys is needed (today or earlier).' }
  if (result === 'active' && !expires) return { ok: false, error: 'The expiration date on the Nursys report is needed.' }
  if (!/^[A-Z]{2}$/.test(state)) return { ok: false, error: 'The state that issued the license is needed.' }
  if (multistate === null || discipline === null) return { ok: false, error: 'Answer both: multistate or single state, and whether Nursys shows any discipline.' }
  if (!nurseDocOk(ctx.offerId, 'nursys', b?.document)) return { ok: false, error: 'Upload the Nursys QuickConfirm screenshot or PDF first.' }
  const want = validKey(ctx.positionKey) === 'rn' ? 'RN' : validKey(ctx.positionKey) === 'lpn' ? 'LPN' : ''
  const evidence = { result: result === 'active' ? 'Active' : result === 'not_active' ? 'Not active' : 'Not found', document: S(b.document, 200), expires, checked_on: checked, source: LICENSE_SOURCE,
    license_type: type, state, multistate, discipline_shown: discipline, license_last4: ctx.last4 || null, by: ctx.by.email || null, by_name: ctx.by.name || null }
  let reason = ''
  if (result !== 'active') reason = 'Nursys QuickConfirm did not show an active license (' + evidence.result + ')'
  else if (discipline) reason = 'Nursys QuickConfirm shows discipline: an owner reviews before anything else moves'
  else if (expires! < ctx.today) reason = 'The license expired on ' + expires
  else if (want && type !== want) reason = `The license is an ${type} license but the offer is for an ${want}`
  return { ok: true, state: reason ? 'blocked' : 'complete', reason: reason || undefined, evidence }
}
/** The 7-topic nurse orientation: the date, who gave it, and every topic ticked (a missing topic is refused, nothing saved). */
export function orientationVerdict(b: any, ctx: { offerId: string; today: string; by: { email?: string; name?: string } }): Verdict {
  const date = ymd(b?.date), givenBy = S(b?.given_by, 80)
  const ticked = Array.isArray(b?.topics) ? (b.topics as unknown[]).map((x) => S(x, 20)) : []
  if (!date || date > ctx.today) return { ok: false, error: 'The orientation date is needed (today or earlier).' }
  if (givenBy.length < 3) return { ok: false, error: 'Who gave the orientation?' }
  const left = ORIENTATION_TOPICS.filter((t) => !ticked.includes(t.id))
  if (left.length) return { ok: false, error: 'Every topic must be covered before the first visit. Not ticked: ' + left.map((t) => t.text).join('; ') + '.' }
  if (b?.document != null && b.document !== '' && !nurseDocOk(ctx.offerId, 'orientation', b.document)) return { ok: false, error: 'That signed checklist is not one uploaded for this person.' }
  return { ok: true, state: 'complete', evidence: { result: 'All 7 topics covered', date, given_by: givenBy, topics: ORIENTATION_TOPICS.map((t) => ({ id: t.id, text: t.text, covered: true })), checklist_version: ORIENTATION_VERSION, document: S(b?.document, 200) || null, rule: 'MO HealthNet Personal Care Provider Manual 2.6', by: ctx.by.email || null, by_name: ctx.by.name || null } }
}
/** The Section 2 acknowledgment: the date she signed it and the signed copy uploaded. */
export function section2Verdict(b: any, ctx: { offerId: string; today: string; by: { email?: string; name?: string } }): Verdict {
  const signed = ymd(b?.signed_on)
  if (!signed || signed > ctx.today) return { ok: false, error: 'The date she signed the statement is needed (today or earlier).' }
  if (!nurseDocOk(ctx.offerId, 'section2', b?.document)) return { ok: false, error: 'Upload her signed statement first.' }
  return { ok: true, state: 'complete', evidence: { result: 'Signed', document: S(b.document, 200), signed_on: signed, statement_version: SECTION2_VERSION, rule: 'MO HealthNet Personal Care Provider Manual 2.3', by: ctx.by.email || null, by_name: ctx.by.name || null } }
}
export { packetLine } from './positions.ts'

/** The supervising RN for an LPN: Natasha Early on the nurse list (by name, an RN); else the RN marked supervising. */
export function supervisingRn(staff: any[]): any | null {
  const rn = (n: any) => String(n?.cred || '').toUpperCase() === 'RN'
  return (staff || []).find((n) => rn(n) && /\bnatasha\b.*\bearly\b/i.test(String(n?.name || ''))) || (staff || []).find((n) => rn(n) && n?.supervising_rn === true) || null
}
/** The nurse list record for this hire (Approve to Work). Matches an existing record by offer, then by name, and keeps what the
    office set (id, email, GoHighLevel id, the supervising mark); never the full license number (last four only). */
export function nurseStaffRecord(staff: any[], p: { offerId: string; name: string; email: string; positionKey: unknown; licenseEvidence: any; at: string; by: string }): { record: any; existing: boolean; supervisor: any | null; problems: string[] } {
  const key = validKey(p.positionKey), cred = key === 'rn' ? 'RN' : 'LPN', ev = p.licenseEvidence || {}, problems: string[] = []
  const prev = (staff || []).find((n) => String(n?.offer_id || '') === p.offerId) || (staff || []).find((n) => String(n?.name || '').trim().toLowerCase() === p.name.trim().toLowerCase()) || null
  const sup = cred === 'LPN' ? supervisingRn(staff) : null
  if (cred === 'LPN' && !sup) problems.push(`${SUPERVISING_RN_NAME} is not on the nurse list as an RN: add her on the Nurse Scheduling tab, then press Run nurse setup again`)
  if (!ev.expires) problems.push('the verified license row has no expiration date')
  const last4 = S(ev.license_last4, 4)
  const record = { ...(prev || { id: 'nh_' + p.offerId.slice(0, 8) + '_' + Date.parse(p.at).toString(36), created_at: p.at, created_by: 'approve-to-work', email: '', ghl_user_id: '', supervising_rn: false }),
    name: prev?.name || p.name, cred, license: last4 ? 'on file, ending ' + last4 : 'verified on Nursys (number on file)', license_last4: last4 || null, expires: ev.expires || prev?.expires || '',
    email: prev?.email || S(p.email, 160).toLowerCase(), employee: true, supervisor: sup ? sup.name : null, supervisor_id: sup ? (sup.id ?? null) : null, offer_id: p.offerId,
    license_verified: { at: ev.checked_on || null, by: ev.by_name || ev.by || null, source: 'Nursys QuickConfirm', document: ev.document || null, state: ev.state || null, multistate: ev.multistate ?? null },
    updated_at: p.at, updated_by: p.by }
  return { record, existing: !!prev, supervisor: sup, problems }
}
const rowsOf = (v: any): any[] => Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : [])
const slim = (c: { label?: unknown; code?: unknown }) => ({ ...(c?.code ? { code: String(c.code) } : {}), ...(c?.label ? { label: String(c.label) } : {}) })
/** a class that reads as the nurse's license: "LPN" / "Licensed Practical Nurse" or "RN" / "Registered Nurse" (never "CNA") */
export function nurseClassMatch(label: unknown, cred: 'LPN' | 'RN'): boolean {
  const t = String(label ?? '')
  return cred === 'LPN' ? /(^|[^a-z])l\.?p\.?n\.?([^a-z]|$)|licensed\s+practical/i.test(t) : /(^|[^a-z])r\.?n\.?([^a-z]|$)|registered\s+nurse/i.test(t) && !/c\.?n\.?a|nurse\s*(aide|assistant)/i.test(t)
}
export type ClassOutcome = { outcome: 'confirmed' | 'unchanged' | 'practice' | 'refused' | 'sent' | 'no_credentials'; detail?: string; recorded: boolean; classes?: string[] }
/** The AxisCare caregiver's LPN or RN class, added (every other class kept) through the caregiver's own record, read back.
    Refused (a card) when AxisCare has no class that reads as that license, or more than one. Practice with the switch off. */
export async function setCaregiverNurseClass(db: any, id: string, cred: 'LPN' | 'RN', by: string, via: string, live: boolean, send: typeof fetch = fetch): Promise<ClassOutcome> {
  const cg = String(id)
  if (!/^\d{1,12}$/.test(cg)) return { outcome: 'refused', detail: 'no AxisCare caregiver number on their roster record yet', recorded: false }
  const g = await ax('GET', `/api/caregivers/${cg}`, undefined, send); const c = caregiverOf(g?.json)   // 2026-10-31: AxisCare answers results.data
  if (!(g.status >= 200 && g.status < 300) || !c) return { outcome: 'refused', detail: 'could not read the caregiver in AxisCare: ' + errText(g), recorded: false }
  if (!classesSeen(c)) return { outcome: 'refused', detail: CLASSES_STOP, recorded: false }   // the safety stop
  const have = rowsOf(c.classes)
  if (have.some((x: any) => nurseClassMatch(x?.label ?? x?.code, cred))) return { outcome: 'unchanged', recorded: false, classes: have.map((x: any) => String(x?.label ?? x?.code ?? '')) }
  const v = await ax('GET', '/api/classes/caregiver', undefined, send)
  if (!(v.status >= 200 && v.status < 300)) return { outcome: 'refused', detail: "could not read AxisCare's caregiver class list: " + errText(v), recorded: false }
  const want = rowsOf(v.json?.results?.classes ?? v.json?.results ?? v.json?.classes).filter((x: any) => nurseClassMatch(x?.label ?? x?.code, cred))
  if (want.length !== 1) return { outcome: 'refused', detail: want.length ? `AxisCare has ${want.length} classes that read as ${cred}` : `AxisCare has no ${cred} class yet`, recorded: false }
  const summary = `Approve to Work: add the ${String(want[0].label ?? want[0].code)} class`
  if (!live) { const recorded = await recordAxisChange(db, { kind: 'caregiver_class', caregiver: cg, outcome: 'practice', summary: summary + ' (practice, switch off)', by, via }); return { outcome: 'practice', recorded } }
  const next = [...have.map(slim), slim(want[0])]
  const p = await ax('PATCH', `/api/caregivers/${cg}`, { classes: next }, send)
  if (!(p.status >= 200 && p.status < 300)) { const recorded = await recordAxisChange(db, { kind: 'caregiver_class', caregiver: cg, outcome: 'refused', summary, detail: errText(p), by, via }); return { outcome: 'refused', detail: errText(p), recorded } }
  const g2 = await ax('GET', `/api/caregivers/${cg}`, undefined, send); const c2 = caregiverOf(g2?.json); const after = rowsOf(c2?.classes)
  const good = after.some((x: any) => nurseClassMatch(x?.label ?? x?.code, cred)) && have.every((x: any) => after.some((y: any) => String(y?.label ?? y?.code) === String(x?.label ?? x?.code)))
  const recorded = await recordAxisChange(db, { kind: 'caregiver_class', caregiver: cg, outcome: good ? 'sent_confirmed' : 'sent', summary, detail: good ? 'read back: ' + after.map((x: any) => String(x?.label ?? x?.code)).join(', ') : 'the read-back did not show it exactly', by, via })
  return good ? { outcome: 'confirmed', recorded, classes: after.map((x: any) => String(x?.label ?? x?.code ?? '')) } : { outcome: 'sent', detail: 'AxisCare accepted the change but the read-back did not show it exactly', recorded }
}
/** 19 CSR 15-7.021(22)(A)4: for a CNA, LPN or RN "all hours may be waived except the statutorily required dementia training and
    two (2) hours provider agency orientation", with the license number current and in good standing when waived. The Training
    Platform's courses: agency-orientation (2h, KEPT), dementia-care (4h, KEPT), on-the-job-training (6h, WAIVED). The annual
    in-service (19 CSR 15-7.021(22)(B), written for personal care aides) is NOT waived here: whether it applies to visit-only
    nurses is unconfirmed (research Part B5.3), so it stays as it is for now. */
export const WAIVED_COURSES = ['on-the-job-training'] as const
export const KEPT_COURSES = ['agency-orientation', 'dementia-care'] as const
export const waiverReason = (cred: string, last4: string, checkedOn: string, by: string) =>
  `Licensed ${cred === 'RN' ? 'registered nurse' : 'practical nurse'}, license ending ${last4 || '(on file)'}, verified current and in good standing on Nursys QuickConfirm ${checkedOn || ''} by ${by || 'the office'}. 19 CSR 15-7.021(22)(A)4: all aide training hours are waived for a licensed nurse except the dementia training and the 2-hour agency orientation, which are kept.`.replace(/\s+/g, ' ').trim()
/** A nurse document to print and sign (the Section 2 statement, the orientation checklist), in the company letterhead. */
export function nurseDocPdf(title: string, blocks: { k: string; t: string }[]): Uint8Array {
  const pdf = new BrandPdf(title); pdf.footer(FOOTER)
  pdf.headerFn = (p: any, f: boolean) => p.letterhead(COMPANY_RIGHT, f); pdf.letterhead(COMPANY_RIGHT, true)
  for (const b of blocks) {
    if (b.k === 'h') { pdf.heading(b.t); continue }
    if (b.k === 'li') { pdf.bullet(b.t); continue }
    if (b.k === 'small') { pdf.para(b.t, { size: 8.5, color: MUTED, after: 6 }); continue }
    pdf.para(b.t, { after: 10 })
  }
  return pdf.build()
}
