// =============================================================================
// PRN STEP 4 · TEAM WELCOME (Samantha 2026-10-29; plan section 3 "Team welcome (first week)")
// =============================================================================
//   welcome text   one text, automatically, once a PRN member is linked in AxisCare (pay_tracks.linked_at: they really are a
//                  caregiver now; pay_tracks.since is the day the offer was sent, before they've even signed). Her approved
//                  wording, editable in Settings (ops_settings.prn_welcome_msg). Sent by prn-welcome on weekdays 10am to
//                  5pm Central from the office number, switch ops_settings.prn_welcome_live. Only people linked in the last
//                  WELCOME_DAYS days, so turning the switch on never welcomes someone who joined months ago.
//   welcome call   a line on the This week list for the first CALL_DAYS days after they're linked: "Welcome call with
//                  Grace". The coordinator calls (five minutes) and records what they said: towns and times, short notice,
//                  more hours someday, the kind of clients they enjoy, on call (PRN CNA Team only), and office work someday.
// Named prn_welcome everywhere: "welcome call" elsewhere in the Hub is the onboarding Orientation Video Call.
// Only decisions here (no reads or writes), so every rule is tested.
// =============================================================================
// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n)
const DAY = 86_400_000
export const WELCOME_DAYS = 7, CALL_DAYS = 14
export const TEAM: Record<string, string> = { cna: 'PRN CNA Team', caregiver: 'PRN Caregiver Team' }

export const WELCOME_DEFAULT = "Hi {first_name}, welcome to Caring Companions' {team}! Our PRN Teams are our care continuity team: when a client needs coverage, you're among the first people we call. Saying no is always OK, and once you say yes, families count on you. We'll call you this week to say hello. We're so glad you're here!"
export function welcomeText(tmpl: string | null | undefined, first: string, team: string): string {
  return (S(tmpl, 700) || WELCOME_DEFAULT).replaceAll('{first_name}', S(first, 40) || 'there').replaceAll('{team}', TEAM[team] || TEAM.cna)
    .replace(/\s{2,}/g, ' ').trim()
}

const linkedDay = (t: Any) => /^\d{4}-\d\d-\d\d/.test(S(t?.linked_at, 10)) ? new Date(S(t.linked_at, 40)).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }) : ''
const daysSince = (ymd: string, today: string) => Math.round((Date.parse(today + 'T12:00:00Z') - Date.parse(ymd + 'T12:00:00Z')) / DAY)

/** Who gets the welcome text this run. tracks: pay_tracks rows (track prn_team); touches: prn_touches rows. */
export function dueWelcomes(tracks: Any[], touches: Any[], today: string): Any[] {
  const sent = new Set(touches.filter((t) => t?.kind === 'welcome_sent' && t?.ref === 'welcome').map((t) => t.applicant_id))
  return tracks.filter((t) => {
    if (t?.track !== 'prn_team' || !t?.axiscare_caregiver_id || sent.has(t.applicant_id)) return false
    const d = linkedDay(t); if (!d) return false
    const n = daysSince(d, today)
    return n >= 0 && n <= WELCOME_DAYS
  })
}

/** The welcome-call lines for This week. members: { applicant_id, name, first, team ('cna'|'caregiver'), linked_at }. */
export function welcomeLines(x: { members: Any[]; touches: Any[]; today: string }): Any[] {
  const out: Any[] = []
  for (const m of x.members) {
    const d = linkedDay(m); if (!d) continue
    const n = daysSince(d, x.today); if (n < 0 || n > CALL_DAYS) continue
    if (x.touches.some((t) => t?.applicant_id === m.applicant_id && t?.ref === 'welcome' && (t.kind === 'welcome_call' || t.kind === 'not_this_one'))) continue
    const sent = x.touches.find((t) => t?.applicant_id === m.applicant_id && t?.kind === 'welcome_sent' && t?.ref === 'welcome')
    out.push({ id: `welcome:${m.applicant_id}`, kind: 'welcome', applicant_id: m.applicant_id, name: m.name, team: TEAM[m.team] || TEAM.cna, ref: 'welcome',
      team_key: m.team === 'caregiver' ? 'caregiver' : 'cna', shift_date: d,
      title: `Welcome call with ${m.first || m.name}`,
      detail: `New on the ${TEAM[m.team] || TEAM.cna} (linked in AxisCare ${n === 0 ? 'today' : n === 1 ? 'yesterday' : n + ' days ago'}). `
        + (sent ? 'The welcome text went out. ' : '') + 'Five minutes to say hello and learn what suits them.' })
  }
  return out
}

/* ── the welcome call's answers ── */
export const SHORT = ['yes', 'no', 'not_asked'], MORE = ['yes', 'no', 'maybe']
export const ONCALL = ['every_weekend', 'every_other_weekend', 'one_weekend_month', 'weekday', 'not_now', '']
/** Checks and tidies what the coordinator typed. Returns { ok, answers } or { ok:false, error }. */
export function readCall(b: Any, team: string): { ok: true; answers: Any } | { ok: false; error: string } {
  const a = {
    towns_times: S(b?.towns_times, 300), short_notice: S(b?.short_notice, 10), more_hours: S(b?.more_hours, 10),
    enjoys: S(b?.enjoys, 300), oncall: S(b?.oncall, 30), office_interest: b?.office_interest === true, note: S(b?.note, 300),
  }
  if (!a.towns_times) return { ok: false, error: 'Which towns and times suit them?' }
  if (!SHORT.includes(a.short_notice)) return { ok: false, error: 'Is short notice ever OK?' }
  if (!MORE.includes(a.more_hours)) return { ok: false, error: 'Would they like more hours someday?' }
  if (!ONCALL.includes(a.oncall)) return { ok: false, error: 'What did they say about on call?' }
  if (team !== 'cna') a.oncall = ''   // on call is for the PRN CNA Team only (her decision 20)
  if ([a.towns_times, a.enjoys, a.note].some((t) => /—/.test(t))) return { ok: false, error: 'Please use a comma or a period instead of an em dash.' }
  return { ok: true, answers: a }
}
const WORD: Record<string, string> = { yes: 'yes', no: 'no', not_asked: 'not asked', maybe: 'maybe' }
const ONCALL_WORD: Record<string, string> = { every_weekend: 'every weekend', every_other_weekend: 'every other weekend', one_weekend_month: 'one weekend a month', weekday: 'a weekday', not_now: 'not right now' }
/** One short line kept on the welcome_call record. */
export function callSummary(a: Any): string {
  return [`Towns and times: ${a.towns_times}`, `Short notice OK: ${WORD[a.short_notice]}`, `More hours someday: ${WORD[a.more_hours]}`,
    a.enjoys ? `Enjoys: ${a.enjoys}` : '', a.oncall ? `On call: ${ONCALL_WORD[a.oncall]}` : '', a.office_interest ? 'Interested in office work someday' : '',
    a.note ? `Note: ${a.note}` : ''].filter(Boolean).join('. ').slice(0, 600)
}
