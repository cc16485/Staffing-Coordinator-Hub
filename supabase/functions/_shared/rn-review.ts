// =============================================================================
// rn-review.ts · RN REVIEW (LPN nurse visit plan, steps 5 to 7; Samantha approved "approve nursing plan" 2026-10-14;
// build spec launch/review/lpn/build-spec.md). The pure half of the rn-review function: the GHE form laid out as the state
// form reads (MO 580-2985, the same words as the Hub's GHE form), who an RN reviews for, the upload clock, the nurse service
// list fallback, the practice rules, the RN's signature image and the signed review PDF. No database, no network.
//   Natasha Early (RN, W-2 employee) signs ONLY what the rules require: every GHE an LPN completes (HCBS 8.00 Appendix 4).
// deno-lint-ignore-file no-explicit-any
import { BrandPdf, COMPANY_RIGHT, FOOTER, NAVY, MUTED, GOLD_TEXT, TEXT } from './brand-pdf.ts'
import { DEFAULT_NURSE_SERVICES, nurseServices, hits } from './nurse-services.ts'   // the ONE nurse service list (Desktop 707)
type Any = any

/* ── the Level of Care sections, word for word as the Hub's GHE form (index.html GHE_SECTIONS; the test compares them) ── */
export const SCORED: Array<{ k: string; t: string; intro?: string; fields?: string[][]; rows: Array<[number, string]> }> = [
  {"k": "behavioral", "t": "BEHAVIORAL", "intro": "Determine if applicant receives monitoring for mental condition, exhibits mood/behavior symptoms, or exhibits psychiatric conditions.", "rows": [[0, "Stable mental condition AND no mood or behavior symptoms observed AND no reported psychiatric conditions"], [3, "Stable mental condition monitored by physician OR behavior symptoms exhibited in past but not currently present OR psychiatric conditions exhibited in past, but not recently present"], [6, "Unstable mental condition monitored by physician OR behavior symptoms are currently exhibited or psychiatric conditions are recently exhibited"], [9, "Unstable mental condition monitored by physician AND behavior symptoms are currently exhibited OR psychiatric conditions are currently exhibited"]]},
  {"k": "cognition", "t": "COGNITION", "intro": "Determine if applicant has issues with cognitive skills for daily decision making, memory, disorganized thinking, or ability to understand/be understood.", "rows": [[0, "No issues with cognition AND no issues with memory, mental function, or ability to be understood/understand others"], [3, "Displays difficulty making decisions in new situations OR occasionally requires supervision AND has issues with memory, mental function, or ability to be understood/understand others"], [6, "Displays consistent unsafe/poor decision making requiring reminders, cues or supervision at all times AND has issues with memory, mental function, or ability to be understood/understand others"], [9, "Rarely or never has capability to make decisions OR displays consistent unsafe/poor decision making requiring total supervision AND rarely or never understood/able to understand others"], [18, "TRIGGER: No discernible consciousness, coma"]]},
  {"k": "mobility", "t": "MOBILITY", "intro": "Determine primary mode of locomotion and amount of assistance needed with locomotion and bed mobility.", "rows": [[0, "No assistance needed OR only set up or supervision needed"], [3, "Limited or moderate assistance needed, i.e. applicant performs more than 50% of tasks independently"], [6, "Maximum assistance needed, i.e. needs two (2) or more individuals or more than 50% weight-bearing assistance OR total dependent for bed mobility"], [18, "TRIGGER: Applicant is bedbound OR totally dependent on others for locomotion"]]},
  {"k": "eating", "t": "EATING", "fields": [["ghe_diet", "Diet Ordered by Physician"]], "rows": [[0, "No assistance needed AND no physician ordered diet"], [3, "Physician ordered therapeutic diet OR set up, supervision, or limited assistance needed with eating"], [6, "Moderate assistance needed with eating, i.e. applicant performs more than 50% of the task independently"], [9, "Maximum assistance needed with eating, i.e. applicant requires an individual to perform more than 50% for assistance"], [18, "TRIGGER: Totally dependent on others"]]},
  {"k": "toileting", "t": "TOILETING", "intro": "Includes actual use of toilet room (or commode, bedpan, or urinal), transferring on/off toilet, cleansing self, adjusting clothes, managing catheters/ostomies, and managing incontinence episodes.", "rows": [[0, "No assistance needed OR only set up or supervision needed"], [3, "Limited or moderate assistance needed, i.e. applicant performs more than 50% of tasks independently"], [6, "Maximum assistance needed, i.e. needs two (2) or more individuals, or more than 50% of weight-bearing assistance"], [9, "Total dependence on others"]]},
  {"k": "bathing", "t": "BATHING", "rows": [[0, "No assistance needed OR only set up or supervision needed"], [3, "Limited or moderate assistance needed, i.e. applicant performs more than 50% of tasks independently"], [6, "Maximum assistance, i.e. requires two (2) or more individuals, more than 50% of weight-bearing assistance OR total dependence on others"]]},
  {"k": "dressing", "t": "DRESSING AND GROOMING", "rows": [[0, "No assistance needed OR only set up or supervision needed"], [3, "Limited or moderate assistance needed, i.e. applicant performs more than 50% of tasks independently"], [6, "Maximum assistance, i.e. requires two (2) or more individuals, more than 50% of weight-bearing assistance OR total dependence on others"]]},
  {"k": "rehab", "t": "REHABILITATIVE SERVICES", "fields": [["ghe_rehab_type", "Type of Physician-Ordered Rehabilitative Services and Frequency"]], "rows": [[0, "None of the above therapies ordered"], [3, "Any of the above therapies ordered 1 time per week"], [6, "Any of the above therapies ordered 2-3 times per week"], [9, "Any of the above therapies ordered 4 or more times per week"]]},
  {"k": "treatments", "t": "TREATMENTS", "intro": "Catheter/Ostomy care, alternate modes of nutrition (tube feeding, TPN), suctioning, ventilator/respirator, wound care (skin must be broken).", "fields": [["ghe_treat_type", "Type of Treatment/Comment"]], "rows": [[0, "None of the above treatments were ordered by the physician"], [6, "One or more of the above treatments was ordered by the physician requiring daily attention"]]},
  {"k": "mealprep", "t": "MEAL PREPARATION", "rows": [[0, "No assistance needed OR only set up or supervision needed"], [3, "Limited or moderate assistance needed, i.e. applicant performs more than 50% of tasks"], [6, "Maximum assistance, i.e. an individual performs more than 50% of tasks for the applicant OR total dependence on others"]]},
  {"k": "medmgmt", "t": "MEDICATION MANAGEMENT", "rows": [[0, "No assistance needed"], [3, "Set up help needed OR supervision needed OR limited or moderate assistance needed, i.e. applicant performs more than 50% of tasks"], [6, "Maximum assistance needed, i.e. an individual performs more than 50% of tasks for the applicant OR total dependence on others"]]},
  {"k": "safety", "t": "SAFETY", "intro": "Vision impairment, falling, problems with balance. Also considers institutionalization in last 5 years and age ≥75.", "fields": [["ghe_last_fall", "Date of Last Fall"], ["ghe_inst_type", "Type of Institutionalization"], ["ghe_inst_date", "Timeframe/Date Admitted"]], "rows": [[0, "No difficulty or some difficulty with vision AND no falls in last 90 days AND no recent problems with balance"], [3, "Severe difficulty with vision OR has fallen in last 90 days OR has current problems with balance OR preliminary score of 0 AND Age OR Institutionalization"], [6, "No vision OR has fallen in last 90 days AND has current problems with balance OR Preliminary score of 0 AND Age AND Institutionalization OR Preliminary score of 3 AND Age AND Institutionalization"], [9, "Preliminary score of 6 AND Institutionalization"], [18, "TRIGGER: Preliminary score of 6 AND Age OR Preliminary Score of 3 AND Age AND Institutionalization"]]},]

/* ── the rest of the state form, in its order (index.html #gheView; the test checks every field, box and choice is here) ── */
type Sec = { h: string; fields?: string[][]; checks?: { grid: string; opts: string[][] }; radios?: Array<[string, string, string[][]]>; scored?: true; after?: string[][] }
const YN = [['yes', 'Yes'], ['no', 'No']]
export const LAYOUT: Sec[] = [
  { h: 'A: PARTICIPANT INFORMATION', fields: [['ghe_client', 'Participant Name'], ['ghe_dcn', 'DCN (Medicaid number)'], ['ghe_dob', 'Date of Birth'], ['ghe_phone', 'Phone'], ['ghe_address', 'Address'], ['ghe_county', 'County'], ['ghe_visit_date', 'Date of Visit']] },
  { h: 'B: PROVIDER NURSE INFORMATION', fields: [['ghe_nurse', 'Name of Provider Nurse (Last, First, MI)'], ['ghe_provider', 'Name of Provider'], ['ghe_provider_phone', 'Provider Phone Number']] },
  { h: 'C: REASON FOR NURSE VISIT', checks: { grid: 'ghe_reason_grid', opts: [['ghe', 'General Health Evaluation (Semi-Annual Nurse Visits)'], ['train_apc', 'Train Advanced Personal Care'], ['eval_apc', 'Evaluate/Review Advanced Personal Care'], ['six_apc', 'Six (6) Month Review Advanced Personal Care'], ['sig_change', 'Significant Change'], ['dsds', 'Request from DSDS'], ['other', 'Other']] },
    fields: [['ghe_sig_change_exp', 'Significant Change, explained'], ['ghe_dsds_exp', 'Request from DSDS, explained'], ['ghe_other_exp', 'Other, explained']] },
  { h: 'D: HEALTH CARE INFORMATION', fields: [['ghe_prov1', 'Primary Health Care Provider 1'], ['ghe_prov1_role', 'Provider 1 role'], ['ghe_prov1_phone', 'Provider 1 phone'], ['ghe_prov2', 'Primary Health Care Provider 2'], ['ghe_prov2_role', 'Provider 2 role'], ['ghe_prov2_phone', 'Provider 2 phone'],
    ['ghe_prov3', 'Primary Health Care Provider 3'], ['ghe_prov3_role', 'Provider 3 role'], ['ghe_prov3_phone', 'Provider 3 phone'], ['ghe_diagnoses', 'Current Diagnoses/Concerns'], ['ghe_hospitalizations', 'Recent Hospitalizations, Surgeries, or Procedures'], ['ghe_health_info', 'Any Additional Health Information']] },
  { h: 'E: ALLERGIES AND VITAL SIGNS', fields: [['ghe_allergies', 'Allergies'], ['ghe_temp', 'Temperature'], ['ghe_hr', 'Heart Rate'], ['ghe_resp', 'Respirations'], ['ghe_bp', 'Blood Pressure'], ['ghe_glucose', 'Blood Glucose'], ['ghe_a1c', 'A1C']] },
  { h: 'F: CARDIOPULMONARY ASSESSMENT', checks: { grid: 'ghe_cardio_grid', opts: [['cabg', 'Coronary Artery Bypass'], ['pitting_edema', 'Pitting Edema'], ['pedal_pulse', 'Pedal Pulse'], ['central_line', 'Central Line'], ['hypertension', 'Hypertension'], ['chest_pains', 'Chest Pains'], ['pacemaker', 'Pacemaker'], ['compression_hose', 'Compression Hose']] },
    fields: [['ghe_hose_class', 'Compression Hose Class']] },
  { h: 'G: INTEGUMENTARY ASSESSMENT', radios: [['ghe_integ', 'Skin', [['none', 'No Concerns'], ['concerns', 'Concerns (indicate any skin tears, abrasions, wounds, decubitus ulcers, etc.)']]]], fields: [['ghe_integ_notes', 'Skin concerns and location']] },
  { h: 'H: LEVEL OF CARE DETERMINATION', scored: true, after: [['ghe_needs_assist', 'Needs assistance with the following (what help is needed and who is currently helping)']] },
  { h: 'I: CURRENT AUTHORIZATION REVIEW', radios: [['ghe_yn_discussed', 'Was the Care Plan Discussed with the Participant?', YN], ['ghe_yn_adequate', 'Authorized Services Adequately Meet the Needs of the Participant?', YN],
    ['ghe_yn_aide', 'Does the Aide Have the Ability to Perform Tasks as Assigned?', YN], ['ghe_yn_plan_change', 'Does the participant need a care plan change?', YN], ['ghe_yn_informal', 'Recent change in informal help?', YN],
    ['ghe_risk', 'Safety/Emergency Plan risk', [['1', '1 High'], ['2', '2 Medium'], ['3', '3 Low']]]],
    fields: [['ghe_adequate_exp', 'Services adequate, explained'], ['ghe_plan_change_exp', 'Care plan change, explained'], ['ghe_informal_exp', 'Informal help change, explained'], ['ghe_backup', 'Emergency Back-up Plan'], ['ghe_directions', 'Directions to locate, safety concerns in the home, or additional comments']] },
  { h: 'J: VETERAN HISTORY', radios: [['ghe_yn_vet', 'Ever served on active duty in the Armed Forces of the United States and separated under conditions other than dishonorable?', YN], ['ghe_yn_vet_info', 'If yes, would they like information about the agency\'s veteran services?', YN]] },
]
export const SIG_DATES = [['ghe_sig_nurse_date', 'Nurse'], ['ghe_sig_part_date', 'Participant'], ['ghe_sig_sup_date', 'Supervisory Nurse']]

const S = (v: unknown, n = 4000) => String(v ?? '').trim().slice(0, n)
const CHECK = /^#(\S+) input\[value="([^"]+)"\]$/
/** the form as the state form reads: each section with its answered lines; nothing invented, blanks shown as blank */
export function readable(g: Any) {
  const f = (g && g.f && typeof g.f === 'object') ? g.f : {}, radios = (g && g.radios && typeof g.radios === 'object') ? g.radios : {}
  const checked = new Set<string>((Array.isArray(g?.checks) ? g.checks : []).map((c: unknown) => { const m = CHECK.exec(String(c)); return m ? m[1] + '|' + m[2] : '' }).filter(Boolean))
  const sections = LAYOUT.map((sec) => {
    const rows: Array<{ label: string; value: string }> = []
    if (sec.checks) rows.push({ label: 'Marked', value: sec.checks.opts.filter(([v]) => checked.has(sec.checks!.grid + '|' + v)).map(([, l]) => l).join('; ') })
    for (const [name, q, opts] of sec.radios || []) { const v = S(radios[name], 20); rows.push({ label: q, value: (opts.find((o) => o[0] === v) || [])[1] || '' }) }
    for (const [id, label] of sec.fields || []) rows.push({ label, value: S(f[id]) })
    const scored = sec.scored ? SCORED.map((s) => {
      const v = radios['ghe_s_' + s.k], row = s.rows.find((r) => String(r[0]) === String(v))
      return { title: s.t, points: row ? row[0] : null, answer: row ? row[1] : '', comment: S(f['ghe_c_' + s.k]), fields: (s.fields || []).map(([id, label]) => ({ label, value: S(f[id]) })) }
    }) : undefined
    for (const [id, label] of sec.after || []) rows.push({ label, value: S(f[id]) })
    return { h: sec.h, rows, ...(scored ? { scored } : {}) }
  })
  const total = SCORED.reduce((t, s) => t + (Number(radios['ghe_s_' + s.k]) || 0), 0)
  return { sections, total, stored_total: g?.total ?? null, sig_dates: SIG_DATES.map(([id, who]) => ({ who, date: S(f[id], 10) })) }
}

/* ── the upload clock: the same rule as the Hub's ghe-forms-rules.js uploadDue (the test runs both): the earlier of 10 working
   days after the visit or the 15th of the next month ── */
const ymd = (d: unknown) => String(d || '').slice(0, 10)
const isDate = (d: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(ymd(d))
const addDays = (d: string, n: number) => { const x = new Date(ymd(d) + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
export function workingDaysAfter(d: string, n: number) { let x = ymd(d); while (n > 0) { x = addDays(x, 1); const w = new Date(x + 'T12:00:00Z').getUTCDay(); if (w !== 0 && w !== 6) n-- } return x }
export function uploadDue(visit: unknown): string {
  if (!isDate(visit)) return ''
  const v = ymd(visit), a = workingDaysAfter(v, 10)
  let y = +v.slice(0, 4), m = +v.slice(5, 7) + 1; if (m > 12) { m = 1; y++ }
  const b = y + '-' + String(m).padStart(2, '0') + '-15'
  return a < b ? a : b
}

/* ── the nurse services: ops_settings.nurse_services (an Admin setting) or the ONE built-in list, DEFAULT_NURSE_SERVICES in
   _shared/nurse-services.ts (the visit check's list, Desktop 707). Both builds read the setting the same way (nurseServices:
   a service needs a key, a name and at least one match; an inactive one is left out). Here only the key, the name, the
   AxisCare service names or codes to match, and whether it is the catch-all are needed. ── */
export const NURSE_SERVICES_FALLBACK = DEFAULT_NURSE_SERVICES.map((s) => ({ key: s.key, name: s.name, axis: [...s.axis], generic: s.generic }))
export const OTHER_SERVICE = { key: 'other', name: 'Something else', axis: [] as string[], generic: false }
export function servicesOf(st: Any): Array<{ key: string; name: string; axis: string[]; generic: boolean }> {
  return nurseServices(st).list.map((s) => ({ key: s.key, name: s.name, axis: [...s.axis], generic: s.generic }))
}
/** the services an AxisCare visit matches (its service code, procedure code, description or name, against each service's list),
 *  as a whole word, the same match as the visit check (nurse-services.ts hits). The named services win; the catch-all
 *  (any T1001 "Nurse Visit" not named more exactly) is given only when no named service matched. */
export function visitServices(v: Any, services: Array<{ key: string; axis: string[]; generic?: boolean }>): string[] {
  const s = (v && v.service) || {}
  const words = [s.code, s.procedureCode, s.description, s.name, v?.serviceCode, v?.serviceName, v?.serviceDescription].map((x) => S(x, 300)).filter(Boolean)
  if (!words.length) return []
  const ok = (sv: { axis: string[] }) => sv.axis.some((a) => words.some((w) => hits(w, a)))
  const named = services.filter((sv) => !sv.generic && ok(sv)).map((sv) => sv.key)
  return named.length ? named : services.filter((sv) => sv.generic && ok(sv)).map((sv) => sv.key)
}

/* ── nurses: the same reading as the Hub's nurse-rules.js (cred RN or LPN, our employee, license number and a current expiry) ── */
export const norm = (s: unknown) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
export const credOf = (n: Any) => { const c = String((n && n.cred) || '').trim().toUpperCase(); return c === 'RN' || c === 'LPN' ? c : '' }
export function rnReady(n: Any, today: string): boolean {
  return !!n && credOf(n) === 'RN' && n.employee === true && !!S(n.name) && !!S(n.license) && isDate(n.expires) && ymd(n.expires) >= ymd(today)
}
/** nurse-rules.js supervisor(): the one marked supervising who is an RN, our employee, licensed and current */
export function supervisorOf(staff: Any[], today: string): Any | null {
  return (staff || []).find((n) => n && n.supervising_rn && credOf(n) === 'RN' && n.employee === true && n.license && n.expires && ymd(n.expires) >= ymd(today)) || null
}
export const nurseByName = (staff: Any[], name: unknown) => (staff || []).find((n) => n && norm(n.name) === norm(name)) || null
export const nurseByEmail = (staff: Any[], email: unknown) => { const e = norm(email); return e ? (staff || []).filter((n) => n && norm(n.email) === e) : [] }
/** is this form an RN's work (an LPN's GHE, or a nurse the list does not know: ghe-forms-rules.js asks an RN to sign those too) */
export const needsRn = (g: Any, staff: Any[]) => credOf(nurseByName(staff, g?.nurse)) !== 'RN'
/** is this RN the one who reviews it: named as the reviewing RN, or none named and she is the supervising RN */
export function mineToReview(g: Any, me: Any, staff: Any[], today: string): boolean {
  if (!g || !me) return false
  if (S(g.rn_reviewer)) return norm(g.rn_reviewer) === norm(me.name)
  const sup = supervisorOf(staff, today)
  return !!sup && norm(sup.name) === norm(me.name)
}
/** the RN a new LPN flag goes to: the supervising RN (one named on the nurse list) */
export const flagRnName = (staff: Any[], today: string) => S(supervisorOf(staff, today)?.name, 120)

/* ── practice: a made-up client or nurse never counts as real work (the Admin page's test people may still rehearse) ── */
const PRACTICE_NAME = /\(TRAINING\)|\bpractice\b/i
export const practiceName = (s: unknown) => PRACTICE_NAME.test(String(s || ''))
export function practiceNurse(n: Any, practicePerson: (p: unknown, e: unknown) => boolean): boolean {
  return !!n && (practiceName(n.name) || practicePerson(n.phone, n.email))
}
export const practiceClient = (c: Any) => !!c && (c.practice === true || practiceName(c.name))

/* ── the RN's signature: her typed name, as an image the Hub's GHE form shows in the Supervisory Nurse box ── */
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export function sigImage(typedName: string, line: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="90" viewBox="0 0 420 90"><text x="10" y="50" font-family="'Brush Script MT','Segoe Script','Snell Roundhand',cursive" font-style="italic" font-size="34" fill="#16283a">${xml(typedName)}</text><text x="10" y="80" font-family="Arial,Helvetica,sans-serif" font-size="11" fill="#6b7280">${xml(line)}</text></svg>`
  return 'data:image/svg+xml;base64,' + btoa(Array.from(new TextEncoder().encode(svg), (b) => String.fromCharCode(b)).join(''))
}
/** the words she agrees to before signing (the step1-sign e-sign consent, for this form) */
export const ESIGN_WORDS = 'I agree to sign this General Health Evaluation electronically as the supervising RN who reviewed it, and I understand my typed name has the same effect as my handwritten signature.'
/* ── DECISION 1 on the nurse wording page (2026-10-14), NOT IN FORCE: a GHE can reach "Ready for Fusion" without the participant's
   signature today, but HCBS 8.00 Appendix 4 has BOTH the participant and the nurse sign before the form goes to Fusion. When
   Samantha approves the fix this is set to true here AND in the Hub's ghe-forms-rules.js (PARTICIPANT_SIGNS_BEFORE_FUSION),
   then Natasha's signature waits for the participant's (the form already went to her with it, once the Hub rule is on). ── */
export const PARTICIPANT_SIGNS_BEFORE_FUSION = false
/** the reason Natasha may not sign yet because the participant has not signed, or null (always null while the rule is off) */
export function participantBlocker(g: Any, on: boolean = PARTICIPANT_SIGNS_BEFORE_FUSION): string | null {
  if (!on || S(g?.sig_part, 40)) return null
  return 'The participant (or their representative) has not signed the form yet. Both the participant and the nurse sign before it goes to Fusion (HCBS 8.00 Appendix 4).'
}
export const SIGN_VERSION = 1
/** a full name typed: first and last, and it holds the names on her nurse record */
export function typedOk(typed: string, name: string): boolean {
  if (!/^\S+(\s+\S+)+$/.test(typed) || typed.length < 4) return false
  const want = norm(name).replace(/[^a-z ]/g, '').split(' ').filter((w) => w.length > 1)
  const got = norm(typed).replace(/[^a-z ]/g, ' ')
  return want.length > 0 && want.every((w) => new RegExp('\\b' + w + '\\b').test(got))
}
/** what was signed: the answers, the score, the client, the visit, the nurse and the nurse's signature, fingerprinted. The
 *  participant may sign before or after the RN (HCBS 8.00 Appendix 4 sets no order), so their signature and its date are left out. */
export async function formFingerprint(g: Any): Promise<string> {
  const f = { ...(g?.f ?? {}) }; delete f.ghe_sig_part_date; delete f.ghe_sig_sup_date
  const pick = { client: g?.client ?? '', client_id: g?.client_id ?? '', visit_date: g?.visit_date ?? '', nurse: g?.nurse ?? '', total: g?.total ?? null, f, checks: g?.checks ?? [], radios: g?.radios ?? {}, sig_nurse: g?.sig_nurse ?? '' }
  const canon = (v: Any): Any => Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v
  const b = new TextEncoder().encode(JSON.stringify(canon(pick)))
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/* ── the signed review PDF: the form as read, then her signature and its audit lines (kept in the private bucket nurse-docs) ── */
const pdfText = (s: string) => String(s || '').replace(/≥/g, '>=').replace(/≤/g, '<=')
export type RnSig = { typedName: string; signedAtCentral: string; signedAtUtc: string; ip: string; agent: string; fingerprint: string; gheId: string; rnEmail: string; lpn: string; version: number; practice: boolean }
export function gheReviewPdf(g: Any, sig: RnSig): Uint8Array {
  const r = readable(g)
  const pdf = new BrandPdf(`General Health Evaluation, RN review - ${S(g.client, 80)} ${S(g.visit_date, 10)}`); pdf.footer(FOOTER)
  pdf.headerFn = (p, first) => p.letterhead(COMPANY_RIGHT, first); pdf.letterhead(COMPANY_RIGHT, true)
  pdf.para((sig.practice ? 'PRACTICE: ' : '') + 'General Health Evaluation (MO 580-2985), RN review', { font: 'B', size: 16, color: NAVY, lh: 22, after: 2 })
  pdf.para(`Completed by ${S(g.nurse, 80) || 'the LPN'} on ${S(g.visit_date, 10)}. Reviewed and signed by the supervising RN. Total score ${r.total}.`, { size: 9.5, color: MUTED, after: 8 })
  for (const sec of r.sections) {
    pdf.heading(sec.h)
    for (const row of sec.rows) if (row.value) pdf.labelled(pdfText(row.label) + ':', pdfText(row.value).slice(0, 110), { size: 9.5 })
    for (const sc of (sec as Any).scored || []) {
      pdf.para(`${sc.title}: ${sc.points == null ? 'not scored' : sc.points + ' points'}`, { font: 'S', size: 9.5, color: NAVY, after: 0, keep: true })
      if (sc.answer) pdf.para(pdfText(sc.answer), { size: 9, after: 0, indent: 10 })
      for (const fl of sc.fields) if (fl.value) pdf.para(pdfText(`${fl.label}: ${fl.value}`), { size: 9, after: 0, indent: 10 })
      if (sc.comment) pdf.para(pdfText('Comment: ' + sc.comment), { size: 9, after: 0, indent: 10 })
      pdf.y -= 3
    }
    if ((sec as Any).scored) pdf.para('TOTAL SCORE ' + r.total, { font: 'B', size: 10.5, color: NAVY, after: 4 })
    // long free-text answers wrap in full below the short lines
    for (const row of sec.rows) if (row.value && row.value.length > 110) pdf.para(pdfText(row.label + ': ' + row.value), { size: 9, color: TEXT, after: 2 })
  }
  pdf.heading('SIGNATURES')
  pdf.para(`Nurse signature: on file in the Hub (drawn), dated ${r.sig_dates[0].date || 'not dated'}. Participant signature: ${g.sig_part ? 'on file in the Hub (drawn), dated ' + (r.sig_dates[1].date || 'not dated') : 'not signed yet when the RN signed (the participant signs the form too; HCBS 8.00 Appendix 4)'}.`, { size: 9.5, after: 6 })
  pdf.para('Supervisory Nurse signature (the reviewing RN):', { font: 'S', size: 9.5, color: GOLD_TEXT, after: 0 })
  pdf.signatureArea(sig.typedName, sig.signedAtCentral, [`Signed electronically with consent ("${ESIGN_WORDS}"). ${sig.signedAtUtc} UTC. Device address ${sig.ip || 'not recorded'}. Browser ${sig.agent || 'not recorded'}. Signed in as ${sig.rnEmail}.`,
    `GHE form ${sig.gheId}, completed by ${sig.lpn}. The answers and signatures signed have fingerprint ${sig.fingerprint}. RN review signature version ${sig.version}.`])
  return pdf.build()
}
