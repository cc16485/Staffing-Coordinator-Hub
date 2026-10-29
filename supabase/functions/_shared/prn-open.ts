// =============================================================================
// PRN STEP 5b · OPEN SHIFTS ON THE PRN TEAM PAGE, WITH "I'M INTERESTED" (Samantha 2026-10-28 decision 5; her picks 2026-10-29:
// "I'm Interested = same as a Yes on the shift page"; "Yes, build part 5b with its switch off")
// =============================================================================
//   Which shifts   open one-time shifts and call-offs in the next PRN_OPEN_DAYS days that haven't started and that we
//                  haven't asked them about yet (those are in Offered to You). Never a regular weekly opening.
//   Who sees one   exactly the office's ask list for that shift (coverage-run askListFor: the same safety checks, Do Not
//                  Return, care level, skills, clearance, already working then, a break). They see it when they are on the
//                  Ready to ask list, or when the only thing in the way is their own days and times (her default: their own
//                  availability never hides a shift from them). Anything a coordinator must review (a care-level
//                  exception, overtime, short notice they said no to) is never shown. AxisCare unreadable = no open shifts.
//   What it shows  the day, the hours and the town. A client's first name only when they have cared for that client before
//                  (Familiar clients first). Never a last name, an address or care details before the office assigns.
//   I'm Interested is a Yes on the shift: it goes on the case like a Yes from the shift page ("Interested, from their PRN
//                  Team page" on the ask list), the office gets the same card and first-yes text, and nothing is assigned
//                  until a coordinator confirms it in AxisCare. Checked again at the tap (the shift, AxisCare, the ask list).
// Switch ops_settings.prn_open_shifts_live (off), and it also needs the page open (prn_page_live).
// Only decisions here (no reads or writes).
// =============================================================================
// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n)
const nk = (n: unknown) => S(n, 80).toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()

export const PRN_OPEN_DAYS = 14, PRN_OPEN_MAX = 8
/** What a PRN member's own days and times may hold back on their own page (her default: their availability never hides a shift). */
export const OWN_TIMES_CODES = ['outside']
export const INTERESTED_WORDS = "I'm interested (from my PRN Team page)"

/** The open shifts and the I'm Interested button may show: its own switch and the page open. */
export const openLive = (st: Any) => st?.prn_page_live === true && st?.prn_open_shifts_live === true

const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 86_400_000).toISOString().slice(0, 10)
/** A regular weekly opening (coverage-run isOngoingCase): never on the page. */
export const isOngoing = (c: Any) => S(c?.kind) === 'interest' || c?.shift_pattern?.kind === 'open_ongoing' || S(c?.reason) === 'open'

/** The shifts worth checking for one member: open, one-time, a day and hours, today to PRN_OPEN_DAYS out, not started
    (nowNaive "YYYY-MM-DDTHH:MM" Chicago), not asked of them already. Soonest first, at most PRN_OPEN_MAX. */
export function openCandidates(cases: Any[], ax: string | null, today: string, nowNaive: string): Any[] {
  if (!ax) return []
  const last = addDays(today, PRN_OPEN_DAYS)
  return (cases || []).filter((c) => {
    if (!c || S(c.status, 20) !== 'open' || isOngoing(c) || c.no_client === true || !S(c.client, 80)) return false
    const d = S(c.shift_date, 10), t = S(c.shift_time, 20)
    if (!/^\d{4}-\d\d-\d\d$/.test(d) || !/^\d\d:\d\d-\d\d:\d\d$/.test(t) || d < today || d > last) return false
    if (`${d}T${t.slice(0, 5)}` <= S(nowNaive, 16)) return false
    return !(Array.isArray(c.asked) ? c.asked : []).some((a: Any) => S(a?.axiscare_id, 20) === ax)
  }).sort((a, b) => `${a.shift_date}${a.shift_time}`.localeCompare(`${b.shift_date}${b.shift_time}`)).slice(0, PRN_OPEN_MAX)
}

/** Is this member on the shift's ask list in a way the page may show? groups: threeGroups' output. Familiar = they have cared
    for this client (the list's own "Familiar" label). null = not shown. */
export function eligibleOn(groups: Any, ax: string): { familiar: boolean; outside: boolean } | null {
  const mine = (g: string) => (Array.isArray(groups?.[g]) ? groups[g] : []).find((r: Any) => S(r?.axiscare_id, 20) === ax)
  const r = mine('ready')
  if (r) return { familiar: r.label === 'Familiar', outside: false }
  const v = mine('review')
  if (v && v.kind === 'call' && OWN_TIMES_CODES.includes(S(v.code, 20))) return { familiar: false, outside: true }
  return null
}

/** One open shift as the page shows it. familiar comes from eligibleOn; town from the case or the list's own lookup. */
export function openView(c: Any, e: { familiar: boolean; outside: boolean }, town: string | null): Any {
  const t = S(c.shift_time, 20), [f, to] = t.split('-'), hm = (x: string) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3, 5))
  let mins = hm(to) - hm(f); if (mins <= 0) mins += 1440
  return { case_id: S(c.id, 100), shift_date: S(c.shift_date, 10), shift_time: t, hours: Math.round(mins / 6) / 10, town: S(town, 60) || null,
    familiar: e.familiar, client_first: e.familiar ? (S(c.client, 80).split(/\s+/)[0] || null) : null, outside_my_times: e.outside, shift_key: `${S(c.shift_date, 10)}|${t}` }
}

/** The ask an I'm Interested puts on the case: a Yes, answered on their PRN Team page. Recorded under the case's lock
    (coverage_case_add_ask), so it is only added when they aren't on the case yet. Nothing is texted to them. */
export function interestAsk(x: { id: string; name: string; phone: string | null; ax: string; contactId: string | null; key: string; now: string }): Any {
  return { id: x.id, name: S(x.name, 80), phone: x.phone || null, channel: 'prn_page', at: x.now, state: 'yes', replied_at: x.now, answered_at: x.now,
    reply: INTERESTED_WORDS, answer_channel: 'prn_page', answer_kind: 'interested', read_by: 'PRN Team page', from_prn_page: true, prn: true,
    auto: false, picked_by_coordinator: false, tier: 1.5, ghl_contact_id: x.contactId || null, axiscare_id: x.ax, offered_for: x.key, answered_for: x.key }
}

/** The office card's line and the first-yes office text for an I'm Interested. */
export function interestCardLine(name: string, clientFirst: string, date: string, time: string): string {
  return `${S(name, 80)} is interested (from their PRN Team page) in ${clientFirst || 'the shift'} ${date} ${time}.`
}
export function interestOfficeText(first: string, clientFirst: string, date: string, time: string): string {
  return `${S(first, 40) || 'A PRN member'} is interested in the ${clientFirst || 'open'} shift (${date} ${time}) from their PRN Team page. Nothing is assigned yet. Pick on the board: {link}`
}
/** Same person on a list row (AxisCare id, or the name). */
export const samePerson = (r: Any, ax: string, name: string) => (ax && S(r?.axiscare_id, 20) === ax) || (!!name && nk(r?.name) === nk(name))
