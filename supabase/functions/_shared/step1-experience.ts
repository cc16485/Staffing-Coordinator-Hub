// =============================================================================
// step1-experience.ts · THE SKILLS PICTURE from Step 1 and the references (Samantha 2026-10-11: "Everything collected here
// must feed into the caregiver's matching profile, including their actual experience, independently confirmed tasks, current
// comfort level, restrictions, and relevant strengths. I don't want these answers stored in a document that our Care
// Coordinators have to search for later.")
// =============================================================================
// Nothing is copied and nothing is decided here: the structured Step 1 answers (jobs, family care, their comfort answers) and
// the structured reference answers (task by task) are read into one picture, task by task, for the profile. Her rules:
//   • their own word is "self-reported" until someone independently confirms it; it is kept on the record, but (her rule,
//     2026-10-11) "if we can't verify it, it doesn't count": only a task a reference saw counts toward a level
//   • a reference who saw it themselves confirms it; "I believe so" is support, not confirmation; "I don't know" changes nothing
//   • a reference who does not answer never means the caregiver lacks the skill
//   • the "comfortable having them care for someone you care about" answer is general feedback, never a skill sign-off
//   • nothing here sets a level, a qualification, a match or a pay rate (the matching step comes later, on her approval)
import { SKILLS, SKILL_GROUPS } from './step1-documents.ts'
// deno-lint-ignore-file no-explicit-any
type Any = any
const S = (v: unknown, n = 160) => String(v ?? '').trim().slice(0, n)
export const TASK_ANSWERS: Record<string, string> = { saw: 'Yes, I saw it myself', believe: 'I believe so, but did not see it myself', no: 'No, not that I saw', unknown: "I don't know" }
export const COMFORT_ANSWERS: Record<string, string> = { yes: 'Yes', reservations: 'Yes, with some reservations', no: 'No' }

/** The same person, however they typed the name. */
export const sameName = (a: unknown, b: unknown) => { const n = (x: unknown) => S(x).toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim(); return !!n(a) && n(a) === n(b) }

export type Entry = { kind: 'job' | 'family'; n: number; where: string; when: string; paid: string[]; tasks: string[]; lifts: string[]; refresher: string[]; confirmer: string; confirmer_how: string; phone: string; email: string; may_contact: string | null }
/** Every job and family-care entry, in their order, with the person who can confirm it. */
export function entriesOf(a: Record<string, unknown>): Entry[] {
  const arr = (v: unknown) => (Array.isArray(v) ? v : []) as Any[]
  const list = (v: unknown) => arr(v).map((x) => S(x, 80)).filter(Boolean)
  const jobs = arr(a?.jobs).map((r: Any, i: number): Entry => ({ kind: 'job', n: i + 1, where: [S(r?.company, 80), S(r?.role, 80)].filter(Boolean).join(', ') || 'Job ' + (i + 1), when: [S(r?.from, 40), S(r?.to, 40)].filter(Boolean).join(' to '),
    paid: [], tasks: r?.did_care === 'no' ? [] : list(r?.tasks).filter((k) => k in SKILLS), lifts: list(r?.lifts), refresher: list(r?.refresher), confirmer: S(r?.supervisor, 80), confirmer_how: 'their supervisor or co-worker at ' + (S(r?.company, 80) || 'this job'),
    phone: S(r?.phone, 30), email: S(r?.email, 160), may_contact: r?.may_contact ?? null }))
  const fam = arr(a?.family_care).map((r: Any, i: number): Entry => ({ kind: 'family', n: i + 1, where: (S(r?.who, 40) || 'Family or private-client care') + (S(r?.relationship, 80) ? ' (' + S(r?.relationship, 80) + ')' : ''), when: [S(r?.from, 40), S(r?.to, 40)].filter(Boolean).join(' to '),
    paid: list(r?.paid), tasks: list(r?.tasks).filter((k) => k in SKILLS), lifts: list(r?.lifts), refresher: list(r?.refresher), confirmer: S(r?.confirmer, 80), confirmer_how: S(r?.confirmer_how, 120),
    phone: S(r?.phone, 30), email: S(r?.email, 160), may_contact: r?.may_contact ?? null }))
  return [...jobs, ...fam]
}
/** The entries a reference can speak to: the ones that name them as the person who saw the work. */
export const entriesFor = (a: Record<string, unknown>, refName: unknown) => entriesOf(a).filter((e) => e.tasks.length && sameName(e.confirmer, refName))

export type SkillLine = { key: string; label: string; group: string; places: string[]; lifts: string[]; refresher: boolean
  standing: 'confirmed' | 'supported' | 'questioned' | 'self_reported'; words: string; confirmations: { by: string; answer: string; said: string; at: string | null }[] }
/** The picture, task by task, plus their comfort answers, restrictions and strengths. */
export function experienceSummary(a: Record<string, unknown> | null | undefined, refs: Any[] = []): Any {
  a = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>
  const entries = entriesOf(a), groupOf: Record<string, string> = {}
  for (const g of SKILL_GROUPS) for (const [k] of g.skills) groupOf[k] = g.h
  const lines: Record<string, SkillLine> = {}
  for (const e of entries) for (const k of e.tasks) {
    const l = lines[k] ||= { key: k, label: SKILLS[k], group: groupOf[k], places: [], lifts: [], refresher: false, standing: 'self_reported', words: '', confirmations: [] }
    l.places.push(e.where + (e.when ? ', ' + e.when : '') + (e.kind === 'family' ? ' (family or private-client care)' : ''))
    if (k === 'hoyer_lift') for (const t of e.lifts) if (!l.lifts.includes(t)) l.lifts.push(t)
    if (e.refresher.includes(k)) l.refresher = true
  }
  /* the references' answers, task by task (only what they were asked about) */
  const asked: Any[] = []
  for (const r of refs || []) {
    const tc = r?.task_confirm && typeof r.task_confirm === 'object' ? r.task_confirm as Record<string, string> : null
    asked.push({ slot: r?.slot ?? null, name: S(r?.ref_name, 80), type: r?.ref_type ?? null, answered: !!r?.responded_at, at: r?.responded_at ?? null, tasks: tc ? Object.keys(tc).length : 0,
      comfortable: r?.task_confirm ? (COMFORT_ANSWERS[S(r?.trust_family, 20)] || null) : null, comfortable_why: S(r?.comfort_why, 500) || null })
    if (!tc) continue
    for (const [k, ans] of Object.entries(tc)) { const l = lines[k]; if (!l || !TASK_ANSWERS[ans]) continue; l.confirmations.push({ by: S(r?.ref_name, 80) || 'a reference', answer: ans, said: TASK_ANSWERS[ans], at: r?.tasks_answered_at ?? r?.responded_at ?? null }) }
  }
  for (const l of Object.values(lines)) {
    const has = (x: string) => l.confirmations.some((c) => c.answer === x)
    l.standing = has('saw') ? 'confirmed' : has('believe') ? 'supported' : has('no') ? 'questioned' : 'self_reported'
    l.words = l.standing === 'confirmed' ? 'Confirmed by a reference who saw it' : l.standing === 'supported' ? 'Not verified: a reference believes so but did not see it (does not count yet)' : l.standing === 'questioned' ? 'Not verified: a reference did not see it (talk it through)' : 'Self-reported, not verified (kept on the record; does not count yet)'
  }
  const skills = Object.values(lines).sort((x, y) => Object.keys(SKILLS).indexOf(x.key) - Object.keys(SKILLS).indexOf(y.key))
  /* restrictions: what they said not at this time, what they would rather not do, what they want a refresher on first */
  const restrictions: string[] = []
  const notNow = (m: unknown) => Object.entries((m && typeof m === 'object' && !Array.isArray(m) ? m : {}) as Record<string, string>).filter(([, v]) => v === 'Not at this time').map(([k]) => k)
  const nn = [...notNow(a.matching_facts), ...notNow(a.specialties)]; if (nn.length) restrictions.push('Not at this time: ' + nn.join(', '))
  if (S(a.exclusions)) restrictions.push('Would rather not accept: ' + S(a.exclusions, 300))
  const rf = skills.filter((l) => l.refresher).map((l) => l.label); if (rf.length) restrictions.push('Wants training or a refresher before doing again: ' + rf.join(', '))
  /* strengths: confirmed tasks, tasks done in more than one place, their experience, languages, the client groups they said yes to */
  const strengths: string[] = []
  const conf = skills.filter((l) => l.standing === 'confirmed').map((l) => l.label); if (conf.length) strengths.push('Confirmed by a reference: ' + conf.join(', '))
  const many = skills.filter((l) => l.places.length > 1).map((l) => l.label); if (many.length) strengths.push('Done in more than one place: ' + many.join(', '))
  if (S(a.experience)) strengths.push('Experience: ' + S(a.experience, 60))
  const langs = [...(Array.isArray(a.languages) ? a.languages as string[] : []).filter((x) => x !== 'Another language'), ...(S(a.languages_other) ? [S(a.languages_other, 60)] : [])]; if (langs.length) strengths.push('Languages: ' + langs.join(', '))
  const yesTo = Object.entries((a.specialties && typeof a.specialties === 'object' ? a.specialties : {}) as Record<string, string>).filter(([, v]) => v === 'Yes').map(([k]) => k); if (yesTo.length) strengths.push('Comfortable with: ' + yesTo.join(', '))
  const backups = (Array.isArray(a.backup_refs) ? a.backup_refs : []).map((r: Any) => ({ type: S(r?.type, 20), name: S(r?.name, 80), relationship: S(r?.relationship, 120), phone: S(r?.phone, 30), email: S(r?.email, 160), may_contact: r?.may_contact ?? null })).filter((r: Any) => r.name)
  const has = entries.length > 0 || skills.length > 0
  return { has, entries, skills, restrictions, strengths, references: asked, backups,
    counts: { confirmed: conf.length, supported: skills.filter((l) => l.standing === 'supported').length, self_reported: skills.filter((l) => l.standing === 'self_reported').length, questioned: skills.filter((l) => l.standing === 'questioned').length },
    note: 'Their own words and their references\' answers. If we can\'t verify it, it doesn\'t count: only tasks a reference saw count toward a level, and nothing here sets a level, a qualification or a match.' }
}
