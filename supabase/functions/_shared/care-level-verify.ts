// =============================================================================
// care-level-verify.ts · Level of Care verification (Samantha's APPROVED design of 2026-10-08, design doc ed1f68c2, tab
// "Level of Care Verification"; decision 4 of the onboarding design, 2026-10-21: the approvers are the Approve to Work list,
// Samantha and Zachary).
// =============================================================================
// Every new caregiver is Level 1 until a person on the Approve to Work list approves a higher level ON verified evidence.
//   claimed   their own words (Step 1) and the interviewer's suggestion (the offer's level_suggested), labelled as such
//   verified  worked out here from the evidence, never typed: Level 2 = one Level 2 piece naming Level 2 duties with dates,
//             or an active CNA, HHA, LPN or RN; Level 3 = Level 2 verified plus one Level 3 piece naming Level 3 duties with
//             dates. One credible piece is enough. A credential never verifies Level 3 on its own.
//   approved  Level 1 by default; above it only by an approver, never above verified, no override.
// What never verifies: years on the application, the interview rating, a finished course, a personal reference, a paper
// with no date, no source or no duties. Pure, so the tests run exactly what the server decides. No SSN anywhere.
// deno-lint-ignore-file no-explicit-any
type Any = any
const S = (v: unknown, n = 200) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n)

/** The duty lists, from her Caregiver Experience and Client Matching Profile form (the design's level table). */
export const DUTIES: Record<2 | 3, { key: string; label: string }[]> = {
  2: [['bathing', 'Bathing'], ['showering', 'Showering'], ['dressing', 'Dressing'], ['grooming', 'Grooming'], ['toileting', 'Toileting'],
    ['continence_care', 'Continence care'], ['mobility_assistance', 'Mobility assistance'], ['transfers_gait_belt', 'Transfers with gait belt'],
    ['walking_assistance', 'Walking assistance'], ['wheelchair_assistance', 'Wheelchair assistance']].map(([key, label]) => ({ key, label })),
  3: [['hoyer_lift', 'Hoyer lift'], ['bedbound_clients', 'Bedbound clients'], ['frequent_repositioning', 'Frequent repositioning'],
    ['hospice_support', 'Hospice support (non-medical)'], ['two_person_transfers', 'Two-person transfers'], ['high_fall_risk', 'High fall-risk clients'],
    ['parkinsons', "Parkinson's disease"], ['stroke_recovery', 'Stroke recovery'], ['complex_mobility', 'Complex mobility assistance']].map(([key, label]) => ({ key, label })),
}
/** The reference form's task keys (Step 1 SKILLS, asked task by task by reference-tasks) to the level duties they confirm.
 *  Only these count; feeding, catheter, ostomy and dementia care are not level duties (the Level 3 list is non-medical). */
export const TASK_DUTIES: Record<string, { level: 2 | 3; duties: string[] }> = {
  bathing: { level: 2, duties: ['bathing', 'showering'] },
  dressing_grooming: { level: 2, duties: ['dressing', 'grooming'] },
  toileting: { level: 2, duties: ['toileting', 'continence_care'] },
  walking_wheelchair: { level: 2, duties: ['walking_assistance', 'wheelchair_assistance'] },
  transfers_gait_belt: { level: 2, duties: ['transfers_gait_belt'] },
  bedbound_care: { level: 3, duties: ['bedbound_clients', 'frequent_repositioning'] },
  hospice_support: { level: 3, duties: ['hospice_support'] },
  hoyer_lift: { level: 3, duties: ['hoyer_lift'] },
}
export const KINDS = ['reference', 'employment', 'credential', 'document'] as const
export const CREDENTIALS = ['CNA', 'HHA', 'LPN', 'RN'] as const
const dutyKey = (lvl: 2 | 3, v: unknown): string | null => {
  const t = S(v, 80).toLowerCase(); const d = DUTIES[lvl].find((x) => x.key === t || x.label.toLowerCase() === t); return d ? d.key : null
}
const ymd = (v: unknown) => { const t = S(v, 20); return /^\d{4}-\d{2}(-\d{2})?$/.test(t) ? t : '' }

/** Check one piece of evidence; the cleaned row, or why not. */
export function validateEvidence(b: Any): { ok: true; row: Any } | { ok: false; why: string } {
  const level = Number(b?.level)
  if (level !== 2 && level !== 3) return { ok: false, why: 'Which level does this prove: 2 or 3?' }
  const kind = S(b?.kind, 20)
  if (!(KINDS as readonly string[]).includes(kind)) return { ok: false, why: 'What kind of proof is it: a reference, an employment call, a credential, or a document?' }
  const base = { level, kind, source: S(b?.source, 160), who: S(b?.who, 120), proof: S(b?.proof, 400) || null, note: S(b?.note, 1000) || null }
  if (kind === 'credential') {
    if (level !== 2) return { ok: false, why: 'A credential proves Level 2 only. Level 3 needs someone who saw them do the Level 3 care, with dates.' }
    const type = S(b?.credential?.type ?? b?.type, 10).toUpperCase()
    if (!(CREDENTIALS as readonly string[]).includes(type)) return { ok: false, why: 'Which credential: CNA, HHA, LPN or RN?' }
    const number = S(b?.credential?.number ?? b?.number, 40), status = S(b?.credential?.status ?? b?.status, 30).toLowerCase(), looked = ymd(b?.credential?.looked_up ?? b?.looked_up)
    if (!number) return { ok: false, why: 'Add the credential number from the state lookup.' }
    if (status !== 'active') return { ok: false, why: 'Only an active credential counts. Record what the state lookup said.' }
    if (!looked) return { ok: false, why: 'Add the date you looked it up.' }
    return { ok: true, row: { ...base, duties: [], date_from: null, date_to: null, credential: { type, number, status: 'active', looked_up: looked } } }
  }
  const duties = [...new Set((Array.isArray(b?.duties) ? b.duties : []).map((d: unknown) => dutyKey(level as 2 | 3, d)).filter(Boolean))] as string[]
  const from = ymd(b?.from), to = ymd(b?.to) || (S(b?.to, 20).toLowerCase() === 'now' ? 'now' : '')
  if (!duties.length) return { ok: false, why: `Tick at least one Level ${level} duty they confirmed. A job title or a place on its own is not enough.` }
  if (!from || !to) return { ok: false, why: 'Add the dates they did this work (from and to).' }
  if (!base.source) return { ok: false, why: kind === 'document' ? 'Who issued the document?' : 'Which employer or place was it?' }
  if (kind !== 'document' && !base.who) return { ok: false, why: 'Who confirmed it (their name)?' }
  return { ok: true, row: { ...base, duties, date_from: from, date_to: to, credential: null } }
}
/** The verified level from the evidence on file. */
export function verifiedLevel(ev: Any[]): 1 | 2 | 3 {
  const rows = Array.isArray(ev) ? ev : []
  const l2 = rows.some((e) => (e.level === 2 && (e.kind === 'credential' ? e.credential?.status === 'active' : (e.duties || []).some((d: string) => DUTIES[2].some((x) => x.key === d)) && e.date_from && e.date_to)))
  if (!l2) return 1
  const l3 = rows.some((e) => e.level === 3 && e.kind !== 'credential' && (e.duties || []).some((d: string) => DUTIES[3].some((x) => x.key === d)) && e.date_from && e.date_to)
  return l3 ? 3 : 2
}
/** What they and the interviewer said, labelled as such (never written to AxisCare). */
export function claimedFrom(answers: Any, offer: Any): { level: 1 | 2 | 3 | null; said: Any; interviewer_level: number | null } {
  const a = answers && typeof answers === 'object' ? answers : {}
  const prefs = Array.isArray(a.preferred_levels) ? a.preferred_levels.map((x: unknown) => S(x, 60)) : a.preferred_levels ? [S(a.preferred_levels, 60)] : []
  const sp = a.specialties && typeof a.specialties === 'object' ? (Array.isArray(a.specialties) ? a.specialties : Object.keys(a.specialties).filter((k) => a.specialties[k] && a.specialties[k] !== 'no')) : []
  const fromPrefs = prefs.map((x: string) => Number((x.match(/[123]/) || [])[0])).filter((n: number) => n >= 1 && n <= 3)
  const any = a.level2 != null || prefs.length || sp.length
  const level = (fromPrefs.length ? Math.max(...fromPrefs) : a.level2 === 'Yes' ? 2 : any ? 1 : null) as 1 | 2 | 3 | null
  const jobs = (Array.isArray(a.jobs) ? a.jobs : []).slice(0, 8).map((j: Any) => ({ where: [S(j?.company, 80), S(j?.role, 80)].filter(Boolean).join(', '), from: S(j?.from, 20), to: S(j?.to, 20), tasks: (Array.isArray(j?.tasks) ? j.tasks : []).map((t: unknown) => S(t, 40)) }))
  const il = Number(offer?.level_suggested); const interviewer = il >= 1 && il <= 3 ? il : null
  return { level, said: { level2: a.level2 ?? null, preferred_levels: prefs, experience: jobs, specialties: sp.map((x: unknown) => S(x, 80)) }, interviewer_level: interviewer }
}
/** A reference's "I saw it myself" answers as Level evidence (believe, no and unknown never count): one row per level. */
export function evidenceFromReference(rq: Any): Any[] {
  const tc = rq?.task_confirm && typeof rq.task_confirm === 'object' ? rq.task_confirm : {}
  const by: Record<number, Set<string>> = { 2: new Set(), 3: new Set() }
  for (const [k, v] of Object.entries(tc)) { if (v !== 'saw' || !TASK_DUTIES[k]) continue; for (const d of TASK_DUTIES[k].duties) by[TASK_DUTIES[k].level].add(d) }
  const from = ymd(rq?.emp_from), to = ymd(rq?.emp_to) || (S(rq?.emp_to, 20).toLowerCase() === 'now' ? 'now' : '')
  return ([2, 3] as const).filter((l) => by[l].size).map((l) => ({ level: l, kind: 'reference', source: S(rq?.ref_company || rq?.employer_confirmed, 160), who: S(rq?.responder_name || rq?.ref_name, 120),
    duties: [...by[l]], date_from: from || null, date_to: to || null, proof: null, note: 'From their reference form answers: "Yes, I saw it myself".', credential: null, ref_request_id: String(rq?.id ?? '') }))
}
