// =============================================================================
// PRN STEP 6 · THE MONTHLY PRN TEAM UPDATE (Samantha 2026-10-28 decision 7: "a short text from the office number with a link;
// the full update sits at the top of their PRN Team page for the month"; 2026-10-29 "continue")
// =============================================================================
//   The Hub drafts it from real facts about last month (the team's covered shifts and the families they helped, from
//   prn_shift_log; new members welcomed), you or Krystal write the personal paragraph (it can't go without one), and may add
//   one kind word from a family and one optional course or tip. One tap texts every PRN member a short line with their own
//   page link; the full update shows at the top of their page for the month.
//   No rankings and no names next to numbers: every number is about the whole team (plan section 3). A kind word never names
//   a caregiver unless they agreed (the office writes it; the Hub never fills a name in).
// Switch ops_settings.prn_monthly_live (off), and the page must be open (prn_page_live): a link never goes to a closed page.
// Only decisions here (no reads or writes).
// =============================================================================
// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n)

export const MONTHLY_TEXT_DEFAULT = "Hi {first_name}, the Caring Companions PRN Team update for {month} is on your PRN Team page: {link} Thank you for standing in the gap with us."
export const STEADY_LINE = 'Want steady hours? Text us and we will talk about what is open.'
export const PARAGRAPH_MAX = 700, KIND_MAX = 300, TIP_MAX = 300
/** How long the update shows at the top of their page after it was sent. */
export const SHOW_DAYS = 40

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const isMonth = (ym: unknown) => /^\d{4}-(0[1-9]|1[0-2])$/.test(S(ym, 7))
export const monthWord = (ym: string) => isMonth(ym) ? MONTHS[Number(ym.slice(5, 7)) - 1] : ''
/** The month the update is about: last calendar month (an update sent in November is about October). */
export function lastMonth(today: string): string {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7))
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}
const and = (xs: string[]) => xs.length <= 1 ? (xs[0] || '') : xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`

/** The facts for one month, about the team only. shifts: prn_shift_log rows; cases: coverage_cases (for which family a shift
    was for); members: { first, since } of everyone on a PRN Team now. */
export function monthFacts(x: { month: string; shifts: Any[]; cases: Any[]; members: Any[] }): { covered: number; families: number; welcomed: string[]; lines: string[] } {
  const inMonth = (d: unknown) => S(d, 7) === x.month
  const back = new Set(x.shifts.filter((s) => s?.kind === 'backed_out').map((s) => `${s.case_id}|${s.axiscare_caregiver_id}`))
  const kept = x.shifts.filter((s) => s?.kind === 'confirmed' && inMonth(s.shift_date) && !back.has(`${s.case_id}|${s.axiscare_caregiver_id}`))
  const caseOf = new Map((x.cases || []).filter((c) => c?.id).map((c) => [String(c.id), c]))
  const fam = new Set(kept.map((s) => { const c = caseOf.get(String(s.case_id)); return S(c?.client_axiscare_id, 20) || S(c?.client, 80).toLowerCase() || 'case:' + s.case_id }))
  const welcomed = x.members.filter((m) => inMonth(m?.since)).map((m) => S(m.first, 40)).filter(Boolean).sort()
  const mw = monthWord(x.month), lines: string[] = []
  if (kept.length) lines.push(`In ${mw} our PRN Teams stepped in for ${kept.length} shift${kept.length === 1 ? '' : 's'}, for ${fam.size} ${fam.size === 1 ? 'family' : 'different families'}. Thank you for standing in the gap.`)
  else lines.push(`In ${mw} our PRN Teams were ready whenever a family needed us. Thank you for being there.`)
  if (welcomed.length) lines.push(`Welcome to our newest ${welcomed.length === 1 ? 'member' : 'members'}, ${and(welcomed)}!`)
  return { covered: kept.length, families: fam.size, welcomed, lines }
}

/** What the office wrote, checked: the personal paragraph is required; no em dash; lengths kept short. */
export function readDraft(b: Any): { ok: true; paragraph: string; kind_word: string | null; tip: string | null } | { ok: false; error: string } {
  const clean = (v: unknown, n: number) => S(v, n + 1).replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ')
  const paragraph = clean(b?.paragraph, PARAGRAPH_MAX), kind = clean(b?.kind_word, KIND_MAX), tip = clean(b?.tip, TIP_MAX)
  if ([paragraph, kind, tip].some((t) => /—/.test(t))) return { ok: false, error: 'Please use a comma or a period instead of an em dash.' }
  if (paragraph.length > PARAGRAPH_MAX) return { ok: false, error: `Keep your paragraph under ${PARAGRAPH_MAX} characters.` }
  if (kind.length > KIND_MAX || tip.length > TIP_MAX) return { ok: false, error: `Keep the kind word and the tip under ${KIND_MAX} characters each.` }
  return { ok: true, paragraph, kind_word: kind || null, tip: tip || null }
}

/** The update as their page shows it. row: a prn_monthly row (sent). */
export function pageUpdate(row: Any, today: string): Any | null {
  if (!row || !row.sent_at || !isMonth(row.month)) return null
  const sentDay = new Date(S(row.sent_at, 40)).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
  if ((Date.parse(today + 'T12:00:00Z') - Date.parse(sentDay + 'T12:00:00Z')) / 86_400_000 > SHOW_DAYS) return null
  const d = row.body || {}
  return { month: row.month, title: `Your PRN Team update for ${monthWord(row.month)}`, facts: Array.isArray(d.facts) ? d.facts.map((f: unknown) => S(f, 300)) : [],
    paragraph: S(d.paragraph, PARAGRAPH_MAX), from: S(row.sent_by, 80).split(/\s+/)[0] || null, kind_word: S(d.kind_word, KIND_MAX) || null, tip: S(d.tip, TIP_MAX) || null, steady: STEADY_LINE }
}

/** The text each member gets. */
export function monthlyText(tmpl: string | null | undefined, first: string, month: string, link: string): string {
  return (S(tmpl, 700) || MONTHLY_TEXT_DEFAULT).replaceAll('{first_name}', S(first, 40) || 'there').replaceAll('{month}', monthWord(month)).replaceAll('{link}', link).replace(/\s{2,}/g, ' ').trim()
}
export const monthlyRef = (month: string) => 'monthly:' + month
export const monthlyLive = (st: Any) => st?.prn_monthly_live === true && st?.prn_page_live === true
/** Caregivers are never texted 9pm to 8am (the office's night rule). nowHour: 0 to 23 Central. */
export const sendHour = (nowHour: number) => nowHour >= 8 && nowHour < 21
