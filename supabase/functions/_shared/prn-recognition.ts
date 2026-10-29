// =============================================================================
// PRN STEP 7 · RECOGNITION EXTRAS AND GROWTH (Samantha 2026-10-29: "Yes, build step 7 with its switches off"; plan sections 3
// and 6, decisions 3, 18 to 20)
// =============================================================================
//   Twice a year      "What would make PRN better?" Two questions on their PRN Team page in May and November (the first 30
//                     days), with one invite text each round (sent by prn-welcome's weekday run, at most 20 a day, once per
//                     member per round). Answers go on This week for the office to read. Switch ops_settings.prn_feedback_live,
//                     and the page must be open.
//   On call           the PRN CNA Team can say on their page whether they'd like to be on call, and how often (her decision
//                     20: CNA Team only to start). An offer never puts anyone on call; the office confirms each date, and the
//                     confirmed dates show on their page. Two shifts (her call 2026-10-29): daytime 7am to 5pm, overnight 5pm to
//                     7am, both = a whole day; $25 a shift, $50 a whole day, never shown on their page.
//   Milestones        their own contributions only, never compared: first PRN shift, 5, 10, 25, 50; a year on the team; and
//                     "kept every shift you said yes to" this season. Shown on their page; the handwritten cards at 10 shifts
//                     and a year stay on This week (step 2).
// Only decisions here (no reads or writes).
// =============================================================================
// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n)
const DAY = 86_400_000

/* ── twice a year ── */
export const FEEDBACK_MONTHS = ['05', '11'], FEEDBACK_OPEN_DAYS = 30, FEEDBACK_CAP = 20, ANSWER_MAX = 280
export const FEEDBACK_QUESTIONS = ['What would make being on the PRN Team better for you?', 'Is there anything we could do to make picking up shifts easier?']
export const FEEDBACK_TEXT_DEFAULT = "Hi {first_name}, it's Caring Companions. We'd love to hear from you: two quick questions about the PRN Team are on your page: {link} Thank you for standing in the gap with us."
export const feedbackLive = (st: Any) => st?.prn_feedback_live === true && st?.prn_page_live === true
/** The round open today, if any: May or November, its first 30 days. id 'YYYY-MM'. */
export function feedbackRound(today: string): { id: string; until: string } | null {
  const m = today.slice(5, 7)
  if (!FEEDBACK_MONTHS.includes(m)) return null
  const start = today.slice(0, 7) + '-01', until = new Date(Date.parse(start + 'T12:00:00Z') + (FEEDBACK_OPEN_DAYS - 1) * DAY).toISOString().slice(0, 10)
  return today <= until ? { id: today.slice(0, 7), until } : null
}
export const feedbackRef = (round: string) => 'feedback:' + round
/** Who gets this round's invite: on a PRN Team, linked in AxisCare (on the schedule, so the page is theirs to use), not invited
    this round yet. Longest on the team first, at most FEEDBACK_CAP a run. */
export function dueFeedback(tracks: Any[], touches: Any[], round: string): Any[] {
  const done = new Set(touches.filter((t) => t?.kind === 'feedback_invite_sent' && t?.ref === feedbackRef(round)).map((t) => t.applicant_id))
  return tracks.filter((t) => t?.track === 'prn_team' && t?.axiscare_caregiver_id && !done.has(t.applicant_id))
    .sort((a, b) => S(a.linked_at, 40).localeCompare(S(b.linked_at, 40))).slice(0, FEEDBACK_CAP)
}
export function feedbackText(tmpl: string | null | undefined, first: string, link: string): string {
  return (S(tmpl, 700) || FEEDBACK_TEXT_DEFAULT).replaceAll('{first_name}', S(first, 40) || 'there').replaceAll('{link}', link).replace(/\s{2,}/g, ' ').trim()
}
/** Their answers, checked: at least one, each up to ANSWER_MAX, no em dash. Kept as one note "1: ...\n2: ...". */
export function readFeedback(b: Any): { ok: true; note: string } | { ok: false; error: string } {
  const a = [b?.a1, b?.a2].map((v) => S(v, ANSWER_MAX + 1).replace(/\s+/g, ' '))
  if (!a.some((x) => x.length >= 2)) return { ok: false, error: 'Please answer at least one question.' }
  if (a.some((x) => x.length > ANSWER_MAX)) return { ok: false, error: `Please keep each answer under ${ANSWER_MAX} characters.` }
  return { ok: true, note: a.map((x, i) => `${i + 1}: ${x || '(left blank)'}`).join('\n') }
}

/* ── on call (PRN CNA Team) ── */
/* her shifts (2026-10-29): daytime 7am to 5pm, overnight 5pm to 7am, both = a whole day. Pay is never shown on their page. */
export const ONCALL_WORDS = 'On call comes in two shifts: daytime, 7am to 5pm, and overnight, 5pm to 7am the next morning. Take one, or both for a whole day. On call means you reply within 15 minutes and can start a shift within 1 hour. The office confirms each date and shift with you first.'
/** Their latest on-call offer and their confirmed dates from today on. rows: prn_oncall rows for one member. */
export function onCallFor(rows: Any[], today: string, patterns: Record<string, string>): { pattern: string | null; pattern_word: string | null; offered_at: string | null; confirmed: Any[] } {
  const offer = rows.filter((r) => r?.kind === 'offer').sort((a, b) => S(a.at, 40).localeCompare(S(b.at, 40))).pop()
  const confirmed = rows.filter((r) => r?.kind === 'confirmed' && !r.cancelled_at && S(r.end_date, 10) >= today)
    .sort((a, b) => S(a.start_date, 10).localeCompare(S(b.start_date, 10))).map((r) => ({ start_date: S(r.start_date, 10), end_date: S(r.end_date, 10),
      shift: ['day', 'overnight', 'whole'].includes(S(r.shift, 10)) ? S(r.shift, 10) : null }))
  return { pattern: offer ? S(offer.pattern, 30) : null, pattern_word: offer ? (patterns[S(offer.pattern, 30)] || null) : null, offered_at: offer ? S(offer.at, 40) : null, confirmed }
}

/* ── milestones on their page ── */
export const SHIFT_MILESTONES = [50, 25, 10, 5, 1]
const shiftWords = (n: number) => n === 1 ? "You stepped in for your first PRN shift. Thank you for standing in the gap." : `You've stepped in for ${n} PRN shifts. Thank you for standing in the gap.`
/** covered: their PRN shifts kept (not backed out); shifts: their prn_shift_log rows (for this season); since: on the team since. */
export function milestonesFor(x: { covered: number; shifts: Any[]; since: string; today: string }): Any[] {
  const out: Any[] = []
  const top = SHIFT_MILESTONES.find((n) => x.covered >= n)
  if (top) out.push({ kind: 'milestone', at: '', text: shiftWords(top) })
  const yrs = /^\d{4}-\d\d-\d\d$/.test(x.since) ? Math.floor((Date.parse(x.today + 'T12:00:00Z') - Date.parse(x.since + 'T12:00:00Z')) / (365 * DAY)) : 0
  if (yrs >= 1) out.push({ kind: 'milestone', at: '', text: `${yrs === 1 ? 'One year' : yrs + ' years'} on the team. Thank you for being with us.` })
  /* dependability (plan section 6): rewards keeping commitments, never saying yes more often; nobody is marked down for a no */
  const since90 = new Date(Date.parse(x.today + 'T12:00:00Z') - 90 * DAY).toISOString().slice(0, 10)
  const season = x.shifts.filter((s) => S(s?.shift_date, 10) >= since90)
  if (season.filter((s) => s.kind === 'confirmed').length >= 3 && !season.some((s) => s.kind === 'backed_out'))
    out.push({ kind: 'milestone', at: '', text: 'You kept every shift you said yes to this season. Families count on that, and so do we.' })
  return out
}
