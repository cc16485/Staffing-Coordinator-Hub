// =============================================================================
// PRN STEP 2 · THE "THIS WEEK" LIST (Samantha 2026-10-28; the office-side sample she approved the same day: "PRN members
// should feel like valued members every day, not only when we need someone").
// =============================================================================
// A short list for the person who owns it (Krystal now, the Staffing Coordinator later: ops_settings.prn_week_owner),
// capped so it never becomes another pile of cards. Each line is one tap, and nothing goes out on its own:
//   thanks      a PRN member covered a shift in the last 3 weeks and nobody has thanked them for it yet: a drafted text
//               the office edits and sends under their own name, from the office number
//   milestone   10 PRN shifts, or a year on the team: a handwritten card (her call: cards only, no pins or gift cards)
//   hours       they told us they'd like more hours and haven't had a PRN shift in 2 weeks: worth offering one
//   checkin     on the team 30+ days and nobody has been in touch personally in 30 days (a thank-you, a card, a call or
//               kind words count; asking them to cover a shift does not): worth a call. Never shown as a mark against them.
// "Not this one" takes a line off for good (thanks, milestone) or for this week (hours, check-in).
// Later steps add their own lines here: looking for hours and interest to review (the PRN Team page, step 5), and a client
// with no PRN backup who knows them (familiar clients, step 3).
// Only decisions here (no reads or writes), so every rule is tested.
// =============================================================================
// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n)
const DAY = 86_400_000
export const CAP = 8
export const THANKS_DAYS = 21, HOURS_IDLE_DAYS = 14, QUIET_DAYS = 30, MILESTONE_SHIFTS = 10

export type Member = { applicant_id: string; name: string; first: string; team: 'cna' | 'caregiver'; since: string; axiscare_id: string | null }
export type Item = { id: string; kind: 'thanks' | 'milestone' | 'hours' | 'checkin'; applicant_id: string; name: string; team: string; ref: string;
  title: string; detail: string; draft?: string; case_id?: string; shift_date?: string | null; client?: string }

/** Monday of the week (Central date string in, 'YYYY-MM-DD' out): the "this week" a weekly line belongs to. */
export function weekOf(today: string): string {
  const d = new Date(today + 'T12:00:00Z'); const back = (d.getUTCDay() + 6) % 7
  return new Date(d.getTime() - back * DAY).toISOString().slice(0, 10)
}
const days = (from: string | null | undefined, today: string) => {
  const a = Date.parse(S(from, 10) + 'T12:00:00Z'), b = Date.parse(today + 'T12:00:00Z')
  return Number.isFinite(a) ? Math.round((b - a) / DAY) : Infinity
}
const dayWord = (ymd: string | null | undefined, today: string) => {
  if (!/^\d{4}-\d\d-\d\d$/.test(S(ymd, 10))) return 'recently'
  const n = days(ymd, today), d = new Date(S(ymd, 10) + 'T12:00:00Z')
  if (n >= 0 && n < 7) return 'on ' + d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
  return 'on ' + d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
const TEAM: Record<string, string> = { cna: 'PRN CNA Team', caregiver: 'PRN Caregiver Team' }

/** The drafted thank-you (approved wording lives in ops_settings.prn_thanks_msg when she edits it). */
export const THANKS_DEFAULT = 'Hi {first_name}, thank you for stepping in for {client} {when}. You made a real difference for {client} and their family. {sender}'
export function draftThanks(tmpl: string | null | undefined, m: Member, client: string, when: string, sender: string): string {
  return (S(tmpl, 700) || THANKS_DEFAULT).replaceAll('{first_name}', m.first || 'there').replaceAll('{client}', client || 'our client')
    .replaceAll('{when}', when).replaceAll('{sender}', S(sender, 60).split(/\s+/)[0] || 'Caring Companions').replace(/\s{2,}/g, ' ').trim()
}

/** shifts: prn_shift_log rows; touches: prn_touches rows; kindTo: AxisCare id -> latest kind-words text date;
    wantsMore: AxisCare id -> hours a week they'd like; cases: coverage case id -> { client, shift_date }. */
export function computeWeek(x: { members: Member[]; shifts: Any[]; touches: Any[]; kindTo: Record<string, string>; wantsMore: Record<string, number>;
  cases: Record<string, { client: string; shift_date: string | null }>; today: string; sender: string; thanksTmpl?: string | null }): { items: Item[]; more: number } {
  const wk = weekOf(x.today), out: Item[] = []
  const touched = (aid: string, kinds: string[], ref: string) => x.touches.some((t) => t.applicant_id === aid && kinds.includes(t.kind) && t.ref === ref)
  for (const m of x.members) {
    const mine = x.shifts.filter((s) => s.applicant_id === m.applicant_id || (m.axiscare_id && String(s.axiscare_caregiver_id) === m.axiscare_id))
    const took = mine.filter((s) => s.kind === 'confirmed'), out_ = mine.filter((s) => s.kind === 'backed_out')
    const covered = took.filter((s) => !out_.some((o) => o.case_id === s.case_id))
    /* thanks: each covered shift in the last 3 weeks, once */
    for (const s of covered) {
      const sd = S(s.shift_date, 10) || S(s.recorded_at, 10)
      if (days(sd, x.today) > THANKS_DAYS || days(sd, x.today) < 0) continue
      if (touched(m.applicant_id, ['thanks_sent', 'not_this_one'], 'shift:' + s.case_id)) continue
      const c = x.cases[s.case_id] || { client: '', shift_date: sd }, when = dayWord(c.shift_date || sd, x.today)
      out.push({ id: `thanks:${m.applicant_id}:${s.case_id}`, kind: 'thanks', applicant_id: m.applicant_id, name: m.name, team: TEAM[m.team], ref: 'shift:' + s.case_id,
        case_id: s.case_id, shift_date: c.shift_date || sd || null, client: c.client || '',
        title: `Thank ${m.first || m.name}`, detail: `${m.name} covered ${c.client || 'a shift'} ${when}.`, draft: draftThanks(x.thanksTmpl, m, c.client, when, x.sender) })
    }
    /* milestones: 10 PRN shifts; a year on the team */
    const n = covered.length
    if (n >= MILESTONE_SHIFTS && !touched(m.applicant_id, ['card_mailed', 'not_this_one'], 'shifts:' + MILESTONE_SHIFTS))
      out.push({ id: `milestone:${m.applicant_id}:shifts`, kind: 'milestone', applicant_id: m.applicant_id, name: m.name, team: TEAM[m.team], ref: 'shifts:' + MILESTONE_SHIFTS,
        title: `${m.first || m.name} reached ${MILESTONE_SHIFTS} PRN shifts`, detail: 'A handwritten card goes in the mail.' })
    const yrs = Math.floor(days(m.since, x.today) / 365)
    if (yrs >= 1 && !touched(m.applicant_id, ['card_mailed', 'not_this_one'], 'year:' + yrs))
      out.push({ id: `milestone:${m.applicant_id}:year${yrs}`, kind: 'milestone', applicant_id: m.applicant_id, name: m.name, team: TEAM[m.team], ref: 'year:' + yrs,
        title: `${m.first || m.name}: ${yrs === 1 ? 'one year' : yrs + ' years'} on the ${TEAM[m.team]}`, detail: 'A handwritten card goes in the mail.' })
    /* would like more hours, no PRN shift in 2 weeks */
    const lastShift = covered.map((s) => S(s.shift_date, 10) || S(s.recorded_at, 10)).sort().pop() || null
    const want = m.axiscare_id ? x.wantsMore[m.axiscare_id] : undefined
    if (want && want > 0 && days(lastShift, x.today) > HOURS_IDLE_DAYS && !touched(m.applicant_id, ['called', 'not_this_one'], 'hours:' + wk))
      out.push({ id: `hours:${m.applicant_id}:${wk}`, kind: 'hours', applicant_id: m.applicant_id, name: m.name, team: TEAM[m.team], ref: 'hours:' + wk,
        title: `${m.first || m.name} would like more hours`, detail: `About ${want} a week` + (lastShift ? `; last PRN shift ${dayWord(lastShift, x.today).replace(/^on /, '')}.` : '; no PRN shift yet.') })
    /* quiet: nobody in touch personally in 30 days */
    if (days(m.since, x.today) >= QUIET_DAYS) {
      const personal = x.touches.filter((t) => t.applicant_id === m.applicant_id && t.kind !== 'not_this_one').map((t) => S(t.at, 10))
      if (m.axiscare_id && x.kindTo[m.axiscare_id]) personal.push(S(x.kindTo[m.axiscare_id], 10))
      const last = personal.sort().pop() || null
      if (days(last, x.today) > QUIET_DAYS && !touched(m.applicant_id, ['called', 'not_this_one'], 'checkin:' + wk))
        out.push({ id: `checkin:${m.applicant_id}:${wk}`, kind: 'checkin', applicant_id: m.applicant_id, name: m.name, team: TEAM[m.team], ref: 'checkin:' + wk,
          title: `Check in with ${m.first || m.name}`, detail: (last ? `Last personal contact ${dayWord(last, x.today).replace(/^on /, '')}` : 'No personal contact recorded yet') + '. Worth a call.' })
    }
  }
  const order: Record<string, number> = { thanks: 0, milestone: 1, hours: 2, checkin: 3 }
  out.sort((a, b) => (order[a.kind] - order[b.kind]) || S(b.shift_date).localeCompare(S(a.shift_date)) || a.name.localeCompare(b.name))
  return { items: out.slice(0, CAP), more: Math.max(0, out.length - CAP) }
}

/* ── ON CALL (PRN CNA Team only, her decision 20; a weekend is Saturday 7am to Sunday 11pm, decision 19) ── */
export const PATTERNS: Record<string, string> = { every_weekend: 'Every weekend', every_other_weekend: 'Every other weekend', one_weekend_month: 'One weekend a month', weekday: 'A weekday', not_now: 'Not right now' }
/** The next n weekends (Saturday dates) from today, each with who is confirmed, and the gaps. */
export function onCallWeekends(oncall: Any[], members: Member[], today: string, n = 8): { weekends: Any[]; offers: Any[] } {
  const d = new Date(today + 'T12:00:00Z'); const toSat = (6 - d.getUTCDay() + 7) % 7
  const first = new Date(d.getTime() + toSat * DAY)
  const live = oncall.filter((r) => !r.cancelled_at)
  const nameOf = (aid: string) => (members.find((m) => m.applicant_id === aid) || { name: 'Someone no longer on the team' }).name
  const weekends = Array.from({ length: n }, (_, i) => {
    const sat = new Date(first.getTime() + i * 7 * DAY).toISOString().slice(0, 10), sun = new Date(first.getTime() + (i * 7 + 1) * DAY).toISOString().slice(0, 10)
    const who = live.filter((r) => r.kind === 'confirmed' && S(r.start_date, 10) <= sun && S(r.end_date, 10) >= sat)
      .map((r) => ({ id: r.id, applicant_id: r.applicant_id, name: nameOf(r.applicant_id) }))
    return { saturday: sat, sunday: sun, confirmed: who, gap: !who.length }
  })
  const latest = new Map<string, Any>()
  for (const r of live.filter((r) => r.kind === 'offer').sort((a, b) => S(a.at).localeCompare(S(b.at)))) latest.set(r.applicant_id, r)
  const offers = [...latest.values()].filter((r) => members.some((m) => m.applicant_id === r.applicant_id && m.team === 'cna'))
    .map((r) => ({ applicant_id: r.applicant_id, name: nameOf(r.applicant_id), pattern: r.pattern, pattern_word: PATTERNS[r.pattern] || r.pattern, note: r.note || null, at: r.at }))
  return { weekends, offers }
}
