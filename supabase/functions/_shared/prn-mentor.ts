// =============================================================================
// PRN STEP 8a · GAP MENTORS (Samantha 2026-10-17 direction, 2026-10-28 decisions 14 to 17; 2026-10-29 "Yes, build step 8 (Gap
// Mentors) with its switches off"; plan section 4b)
// =============================================================================
// RENAMED 2026-10-29 (her call): what members and the office read is "Field Support Visits" ("approved for Field Support
// Visits" for the person), not "Gap Mentor". "mentor" in code, records and switches (prn_mentor_live) means the same thing.
//   Who        PRN CNA Team members the office names Gap Mentors, for the skills it has verified (references, a past employer,
//              a registry-checked CNA: her evidence rule, never online training alone). An honor and always optional.
//   Asking     a coordinator taps "Ask a Gap Mentor" on a client's Care tab: a refresher with a caregiver in the home, a care
//              update visit for a client who is declining, or a concern-only supervisory visit (decision 17). The family's OK
//              is recorded first for the two that put an extra person in the home. It shows in Offered to You on the page of
//              each Gap Mentor it could go to: has the skill, not on a break that day, not on that client's Do Not Return list,
//              and AxisCare shows nothing else for them at that time (AxisCare unreadable = not shown). Clients they know first.
//   Assigning  a mentor taps "I can do it" or "Not this time" (never counted). The coordinator picks one, puts the visit in
//              AxisCare (a non-billable visit type, decision 15: company-paid, never billed to the family), and records it here.
//   The note   after the visit the mentor fills a short note on their page. A refresher goes on the caregiver's record as
//              "Refresher with Grace (CNA), Nov 3: Hoyer lift", kept apart from online courses. A care update ("What's changed")
//              and a supervisory note go to the client's Care plan reviews for the Care Coordinator, who decides any change; the
//              mentor never changes the plan, diagnoses or gives medical advice. GUIDE clients: the coordinator shares it with
//              the GUIDE care navigator through Continuum (decision 16). VA clients: check the VA authorization before
//              changing services.
// Switch ops_settings.prn_mentor_live (off), and the PRN Team page must be open.
// Only decisions here (no reads or writes).
// =============================================================================
import { visitWindow, wallMin } from './overlap.ts'
// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n)
const nk = (n: unknown) => S(n, 80).toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()

export const SKILLS: Record<string, string> = { hoyer: 'Hoyer lift transfers', transfers: 'Transfers and gait belt', bathing: 'Safe bathing and showering', dementia: 'Dementia care', falls: 'Fall prevention at home' }
export const KINDS: Record<string, { label: string; family_ok: boolean; needs_caregiver: boolean; needs_skill: boolean }> = {
  refresher: { label: 'Refresher with a caregiver in the home', family_ok: true, needs_caregiver: true, needs_skill: true },
  care_update: { label: 'Care update visit', family_ok: true, needs_caregiver: false, needs_skill: false },
  supervisory: { label: 'Concern-only supervisory visit', family_ok: false, needs_caregiver: false, needs_skill: false },
}
export const mentorLive = (st: Any) => st?.prn_mentor_live === true && st?.prn_page_live === true
export const MENTOR_RULES = 'You observe, practice and listen. You never change the care plan, diagnose or give medical advice: anything medical goes to the family, their doctor or home health. In an emergency call 911, then the office.'

/** The office naming someone a Gap Mentor: PRN CNA Team only, at least one skill, and the evidence it checked. */
export function readMentor(b: Any, team: string): { ok: true; rec: Any } | { ok: false; error: string } {
  if (b?.on === false) return { ok: true, rec: { on: false } }
  if (team !== 'cna') return { ok: false, error: 'Field Support Visits are for PRN CNA Team members.' }
  const skills = (Array.isArray(b?.skills) ? b.skills : []).map((x: unknown) => S(x, 20)).filter((x: string) => SKILLS[x])
  const evidence = S(b?.evidence, 400)
  if (!skills.length) return { ok: false, error: 'Which skills did you verify?' }
  if (evidence.length < 5) return { ok: false, error: 'Say how you verified it: references, a past employer, the CNA registry. Online training alone is not enough.' }
  if (/—/.test(evidence)) return { ok: false, error: 'Please use a comma or a period instead of an em dash.' }
  return { ok: true, rec: { on: true, skills: [...new Set(skills)], evidence } }
}

/** A coordinator's ask, checked. */
export function readAsk(b: Any, today: string): { ok: true; ask: Any } | { ok: false; error: string } {
  const kind = S(b?.kind, 20), k = KINDS[kind]
  if (!k) return { ok: false, error: 'Which kind of visit?' }
  const client_ax = S(b?.client_ax, 20).replace(/\D/g, ''), client_name = S(b?.client_name, 80)
  if (!client_ax || !client_name) return { ok: false, error: 'Which client? (They need to be an AxisCare client.)' }
  const date = S(b?.visit_date, 10), time = S(b?.visit_time, 11)
  if (!/^\d{4}-\d\d-\d\d$/.test(date) || date < today) return { ok: false, error: 'Pick a visit date from today on.' }
  if (!/^\d\d:\d\d-\d\d:\d\d$/.test(time) || time.slice(6) <= time.slice(0, 5)) return { ok: false, error: 'Pick a start and an end time.' }
  const skill = S(b?.skill, 20)
  if (k.needs_skill && !SKILLS[skill]) return { ok: false, error: 'Which skill is the refresher for?' }
  if (skill && !SKILLS[skill]) return { ok: false, error: 'Which skill?' }
  const cg_ax = S(b?.caregiver_ax, 20).replace(/\D/g, ''), cg_name = S(b?.caregiver_name, 80)
  if (k.needs_caregiver && !(cg_ax && cg_name)) return { ok: false, error: 'Which caregiver is the refresher with?' }
  if (k.family_ok && b?.family_ok !== true) return { ok: false, error: "The family's OK comes first: it's an extra person in their home." }
  const note = S(b?.note, 500)
  if (/—/.test(note)) return { ok: false, error: 'Please use a comma or a period instead of an em dash.' }
  return { ok: true, ask: { kind, client_ax, client_name, visit_date: date, visit_time: time, skill: skill || null, caregiver_ax: k.needs_caregiver ? cg_ax : null,
    caregiver_name: k.needs_caregiver ? cg_name : null, note: note || null, family_ok: k.family_ok ? true : null, guide: b?.guide === true, va: b?.va === true } }
}

const hm = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
/** Does one of their AxisCare visits that day overlap the mentor visit? rows: visitsOf rows for that date. */
export function clashes(rows: Any[], date: string, time: string): boolean {
  const f = hm(time.slice(0, 5)), t = hm(time.slice(6, 11))
  return rows.some((v) => {
    const s0 = S(v?.scheduledStartDate ?? v?.startDate, 30), e0 = S(v?.scheduledEndDate ?? v?.endDate, 30)
    if (s0.slice(0, 10) !== date || !/T\d\d:\d\d/.test(s0)) return false
    const vs = hm(s0.slice(11, 16)); let ve = /T\d\d:\d\d/.test(e0) ? hm(e0.slice(11, 16)) : vs + 60
    if (e0.slice(0, 10) > date) ve = 24 * 60
    return vs < t && f < ve
  })
}

/** May this visit be offered to this mentor? mentor: { name, team, prn }; visit: a prn_mentor_visits row; dnr: dnr_log;
    rows: their AxisCare visits that day (null = AxisCare unreadable: not offered). */
export function mayOffer(x: { mentor: Any; visit: Any; dnr: Any[]; rows: Any[] | null }): { ok: boolean; why: string | null } {
  const g = x.mentor?.prn?.gap_mentor, v = x.visit
  if (x.mentor?.team !== 'cna' || g?.on !== true) return { ok: false, why: 'not approved for Field Support Visits' }
  if (v?.skill && !(g.skills || []).includes(v.skill)) return { ok: false, why: 'not verified for ' + (SKILLS[v.skill] || v.skill) }
  const bu = S(x.mentor?.prn?.break_until, 10)
  if (/^\d{4}-\d\d-\d\d$/.test(bu) && bu >= S(v?.visit_date, 10)) return { ok: false, why: 'on a break then' }
  if ((x.dnr || []).some((e) => nk(e?.client) === nk(v?.client_name) && nk(e?.caregiver) === nk(x.mentor?.name))) return { ok: false, why: 'Do Not Return for this client' }
  if (v?.caregiver_ax && S(x.mentor?.axiscare_id, 20) === S(v.caregiver_ax, 20)) return { ok: false, why: 'the refresher is with them' }
  if (x.rows === null) return { ok: false, why: "AxisCare couldn't be read" }
  if (clashes(x.rows, S(v?.visit_date, 10), S(v?.visit_time, 11))) return { ok: false, why: 'working then' }
  return { ok: true, why: null }
}

/** The visit as a Gap Mentor's page shows it: the client's first name and town, the day and time, what it is for. */
export function offerView(v: Any, answer: string | null, familiar: boolean): Any {
  return { id: Number(v.id), kind: v.kind, kind_label: KINDS[v.kind]?.label || 'Field Support Visit', client_first: S(v.client_name, 80).split(/\s+/)[0] || 'A client',
    visit_date: S(v.visit_date, 10), visit_time: S(v.visit_time, 11), skill: v.skill ? SKILLS[v.skill] || null : null,
    caregiver_first: v.caregiver_name ? S(v.caregiver_name, 80).split(/\s+/)[0] : null, note: S(v.note, 500) || null, answer, familiar, rules: MENTOR_RULES }
}

/* ── the note after the visit ── */
export const UPDATE_FIELDS: [string, string][] = [['mobility', 'Mobility and transfers'], ['eating', 'Eating and drinking'], ['skin', 'Skin'], ['memory', 'Memory and mood'],
  ['safety', 'Safety at home'], ['equipment', 'Equipment that might help'], ['caregiver_hard', 'What the caregiver is finding hard']]
export const REFRESHER_FIELDS: [string, string][] = [['practiced', 'What you practiced'], ['comfort', 'Is the caregiver comfortable now?'], ['repeat', 'Anything to repeat next time']]
export const SUPERVISORY_FIELDS: [string, string][] = [['observed', 'What you saw'], ['concern', 'About the concern'], ['follow_up', 'What the office should follow up']]
export const fieldsFor = (kind: string) => kind === 'refresher' ? REFRESHER_FIELDS : kind === 'care_update' ? UPDATE_FIELDS : SUPERVISORY_FIELDS
/** Their note, checked: each field up to 400 characters, at least two filled in, no em dash; comfort is yes / somewhat / no. */
export function readReport(kind: string, b: Any): { ok: true; report: Record<string, string> } | { ok: false; error: string } {
  const out: Record<string, string> = {}
  for (const [k] of fieldsFor(kind)) { const v = S(b?.[k], 401).replace(/\s+/g, ' '); if (v) out[k] = v }
  if (Object.values(out).some((v) => v.length > 400)) return { ok: false, error: 'Please keep each answer under 400 characters.' }
  if (Object.values(out).some((v) => /—/.test(v))) return { ok: false, error: 'Please use a comma or a period instead of an em dash.' }
  if (kind === 'refresher' && out.comfort && !['yes', 'somewhat', 'no'].includes(out.comfort)) return { ok: false, error: 'Is the caregiver comfortable now?' }
  if (Object.keys(out).length < 2) return { ok: false, error: 'Please fill in at least two parts.' }
  return { ok: true, report: out }
}
const words = (d: string) => /^\d{4}-\d\d-\d\d$/.test(d) ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : d
/** What lands in care_plan_reviews (the Hub's own record): a refresher for the caregiver's record, or a report for the client's
    Care plan reviews. Never a review itself (kind 'mentor_refresher' / 'mentor_report'), so it never resets the 90-day clock. */
export function landing(v: Any, mentorName: string, report: Record<string, string>, nowIso: string): Any {
  const first = S(mentorName, 80).split(/\s+/)[0] || 'A PRN CNA'
  const base = { id: 'gm' + S(v.id, 20), axiscare_client_id: S(v.client_ax, 20), client_name: S(v.client_name, 80), at: nowIso, by: S(mentorName, 80), mentor_visit_id: Number(v.id), visit_date: S(v.visit_date, 10) }
  if (v.kind === 'refresher') return { ...base, kind: 'mentor_refresher', caregiver_ax: S(v.caregiver_ax, 20), caregiver_name: S(v.caregiver_name, 80), skill: v.skill,
    title: `Refresher with ${first} (CNA), ${words(S(v.visit_date, 10))}: ${SKILLS[v.skill] || v.skill}`, report, hands_on: true }
  return { ...base, kind: 'mentor_report', visit_kind: v.kind, title: `${v.kind === 'care_update' ? "What's changed" : 'Supervisory visit (concern only)'}, from ${first} (Field Support Visit), ${words(S(v.visit_date, 10))}`,
    report, guide: v.guide === true, va: v.va === true,
    reminder: v.guide === true ? 'GUIDE client: share this with their GUIDE care navigator through Continuum. Their care plan changes only together with them.'
      : v.va === true ? 'VA client: check the VA authorization before changing services.' : null }
}

/* ── 2026-10-31 · THE TEXT (Samantha: "manually put in a field Support request that will show up on the PRNs little hub and
   will text them just like an open shift") ──
   A request texts each PRN CNA it could go to (mayOffer, the same check as their page) with their own page link, where they
   answer "I can do it" or "Not this time". Never anyone working a Caring Companions shift right now, never 9pm to 8am (prn-week),
   each person once per visit. Switch ops_settings.prn_mentor_text_live, and Field Support Visits on. */
export const MENTOR_TEXT_DEFAULT = "Hi {first_name}, it's Caring Companions. A Field Support Visit is open: {what}, {when}. Can you do it? Tap to say yes or not this time: {link} No pressure either way."
export const mentorTextLive = (st: Any) => st?.prn_mentor_text_live === true && mentorLive(st)
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'], MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const t12 = (t: string) => { const h = Number(t.slice(0, 2)), m = t.slice(3, 5); return `${h % 12 || 12}${m === '00' ? '' : ':' + m}${h >= 12 ? 'pm' : 'am'}` }
/** "Thu Nov 5, 10am to 11am" */
export function whenWords(date: string, time: string): string {
  if (!/^\d{4}-\d\d-\d\d$/.test(date) || !/^\d\d:\d\d-\d\d:\d\d$/.test(time)) return ''
  const d = new Date(date + 'T12:00:00Z')
  return `${DOW[d.getUTCDay()]} ${MON[d.getUTCMonth()]} ${d.getUTCDate()}, ${t12(time.slice(0, 5))} to ${t12(time.slice(6, 11))}`
}
/** What the visit is, in a few words, first names only: "a Hoyer lift transfers refresher with Amy at Ruth's home". */
export function whatWords(v: Any): string {
  const client = S(v?.client_name, 80).split(/\s+/)[0] || 'a client'
  if (v?.kind === 'refresher') return `a ${(SKILLS[v.skill] || 'skills')} refresher with ${S(v.caregiver_name, 80).split(/\s+/)[0] || 'their caregiver'} at ${client}'s home`
  if (v?.kind === 'care_update') return `a care update visit with ${client}`
  return `a supervisory visit with ${client}`
}
/** The text, from her wording (ops_settings.prn_mentor_text_msg) or the default. */
export function mentorText(tmpl: unknown, first: string, v: Any, link: string): string {
  const t = S(tmpl, 700) || MENTOR_TEXT_DEFAULT
  return t.replace(/\{first_name\}/g, first || 'there').replace(/\{what\}/g, whatWords(v)).replace(/\{when\}/g, whenWords(S(v?.visit_date, 10), S(v?.visit_time, 11))).replace(/\{link\}/g, link)
}
/** Working a Caring Companions shift right now (clocked in, not out)? rows: their AxisCare visits today. nowNaive: Central
    wall time "YYYY-MM-DDTHH:MM". Her rule: nobody working right now is texted, even if the visit doesn't overlap. */
export function workingNow(rows: Any[], nowNaive: string): boolean {
  const now = wallMin(nowNaive); if (now == null) return false
  return (rows || []).some((v) => { const w = visitWindow(v, now); return !!w && (w.clockedIn || (w.start <= now && now < w.end)) })
}
