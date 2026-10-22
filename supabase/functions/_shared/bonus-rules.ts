// =============================================================================
// bonus-rules.ts · THE CARE COORDINATOR NEW-CLIENT BONUS (Care Coordinator Leads and Bonus, Stage 4; policy approved by
// Samantha 2026-10-18). Pure: no clock, no database, no network. cc-bonus reads AxisCare and the Hub and asks this file.
//
// THE RULES (the approved policy, word for word where it matters):
//   · $100 per qualifying new private-pay client, to the ORIGINAL lead owner (lead.original_owner, kept by lead turns;
//     a lead from before turns: its owner at the first visit), even if a teammate did the assessment or helped.
//   · the first visit (lead.first_shift_at, the first AxisCare visit clocked in and out) on or after the program start
//     (2026-11-01).
//   · 20 completed, billable hours by the END of day 30 (day 1 = the first visit's day), counted from AxisCare visits
//     clocked in and out, clock-in to clock-out. AxisCare stays the record; this only reads it.
//   · still active on day 30 (care did not end on or before day 30).
//   · a returning client counts as new only after 90 or more days away (a completed visit in the 90 days before the
//     first visit means not new, so it goes to review).
//   · after day 30 the line is READY (every rule met) or UNDER REVIEW with the reason in words ("18 of 20 hours by day
//     30", "care ended Nov 20", "had care within 90 days before"). Nothing is ever marked Not earned by itself.
//   · Samantha approves. When she is away before payroll, Zachary (any owner) may approve a READY line. Only Samantha
//     (the decider) makes an exception (approves an UNDER REVIEW line) or marks Not earned, each with a written reason.
//   · Paid records the payroll date. The payroll person (Krystal) or an owner marks it, and only after Samantha has
//     confirmed with Viventium how bonuses count toward overtime (a one-time check).
//   · every change keeps who, when and why.
// No em dashes in any words a person reads.
// =============================================================================
// deno-lint-ignore-file no-explicit-any
import { centralYmd, addDaysYmd, isYmd } from './business-days.ts'

/* v2 (Samantha 2026-10-22): "$75 for every new client no matter the hours", to the Care Coordinator who did the home
   visit, earned at day 30 when the client is still with us and has had at least 3 completed visits; team goal 8 new
   clients in a month = team lunch. Counts are shared with the team; each person's dollars stay private to her and the
   owners. The $25 app-client bonus waits for app visits to be recorded somewhere this can read. */
export const V2 = { amount: 75, min_visits: 3, goal_count: 8, goal_prize: 'team lunch', payers: ['private', 'ltc', 'va', 'guide'] }
export const DEFAULTS = { start: '2026-11-01', amount: 100, min_hours: 20, days: 30, returning_gap: 90, decider: 'samantha@mo-care.com' }
export const STATUS_WORDS: Record<string, string> = {
  on_the_way: 'On the way', ready: 'Ready for approval', under_review: 'Under review', not_earned: 'Not earned', approved: 'Approved', paid: 'Paid' }
const DECIDED = ['not_earned', 'approved', 'paid']
const lc = (v: unknown) => String(v ?? '').trim().toLowerCase()
const first = (v: unknown) => String(v ?? '').trim().split(/\s+/)[0] || ''
const num = (v: unknown, d: number, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : d }

/** the program's settings (ops_settings), cleaned: who takes part comes from the lead turns list */
export function settingsOf(st: any) {
  const s = st || {}, b = s.bonus || {}
  const people = (Array.isArray(s.lead_rotation?.people) ? s.lead_rotation.people : []).map((p: any) => first(p?.name)).filter(Boolean)
  return { live: s.bonus_live === true, start: isYmd(b.start) ? b.start : DEFAULTS.start, amount: num(b.amount, DEFAULTS.amount, 1, 10000),
    min_hours: num(b.min_hours, DEFAULTS.min_hours, 1, 400), days: DEFAULTS.days, returning_gap: DEFAULTS.returning_gap,
    decider: lc(b.decider) || DEFAULTS.decider, payroll: lc(b.payroll), ot_checked: b.ot_checked && b.ot_checked.at ? b.ot_checked : null, people,
    /* v2 (Samantha 2026-10-22), only while ops_settings.bonus_v2_live: $75 to whoever did the home visit, 3 visits by day 30 */
    v2: s.bonus_v2_live === true, amount_v2: num(b.amount_v2, V2.amount, 1, 10000), min_visits: num(b.min_visits, V2.min_visits, 1, 60),
    goal: { count: num(b.team_goal?.count, V2.goal_count, 1, 200), prize: String(b.team_goal?.prize || V2.goal_prize).trim().slice(0, 80) } }
}
/** who earns it: the original lead owner (first name) */
export function recipientOf(l: any): string { return first(l?.original_owner?.name) || first(l?.assigned_coordinator) }
/** a lead that starts a bonus line: {lead_id, recipient, first_visit, day30} or {skip: why} */
/** v2: who did the home visit: the Care Coordinator on the lead's completed home visit (care_assessments), the earliest one */
export function homeVisitBy(l: any, assessments: any[]): string {
  const done = (assessments || []).filter((a: any) => a && String(a.lead_id || '') === String(l?.id || '') && a.coordinator && a.status !== 'Scheduled' && a.status !== 'Cancelled')
    .sort((x: any, y: any) => String(x.visit_date || '').localeCompare(String(y.visit_date || '')))
  return first(done[0]?.coordinator)
}
export function candidate(l: any, set: ReturnType<typeof settingsOf>, assessments: any[] = []): any {
  if (!l || !l.id || !l.first_shift_at) return { skip: 'no first visit yet' }
  if (l.spam?.at || l.archived) return { skip: 'archived or spam' }
  if (set.v2) {
    if (!V2.payers.includes(String(l.funding_source || ''))) return { skip: 'not a Caring Companions payer (Medicaid or CDS)' }
    const fv = centralYmd(l.first_shift_at)
    if (fv < set.start) return { skip: 'first visit before the program started' }
    const hv = homeVisitBy(l, assessments), who = hv || recipientOf(l)
    if (!who) return { skip: 'no home visit or lead owner on file' }
    if (!set.people.some((p: string) => lc(p) === lc(who))) return { skip: who + ' is not on the Care Coordinator list' }
    return { lead_id: String(l.id), recipient: who, by: hv ? 'home_visit' : 'lead_owner', first_visit: fv, day30: addDaysYmd(fv, set.days - 1) }
  }
  if (String(l.funding_source || '') !== 'private') return { skip: 'not private pay' }
  const fv = centralYmd(l.first_shift_at)
  if (fv < set.start) return { skip: 'first visit before the program started' }
  const who = recipientOf(l)
  if (!who) return { skip: 'no lead owner' }
  if (!set.people.some((p: string) => lc(p) === lc(who))) return { skip: who + ' is not on the Care Coordinator list' }
  return { lead_id: String(l.id), recipient: who, first_visit: fv, day30: addDaysYmd(fv, set.days - 1) }
}
const clockAt = (c: any) => { const s = typeof c === 'string' ? c : (c && (c.time || c.date || c.at)) || ''; const t = Date.parse(s); return Number.isFinite(t) ? t : null }
/** completed visits (clocked in and out, not removed) whose clock-in falls on a Central day within [from, to] */
export function completedIn(visits: any[], from: string, to: string): any[] {
  return (visits || []).filter((v) => { if (!v || v.removed) return false; const a = clockAt(v.clockIn), b = clockAt(v.clockOut); if (a == null || b == null || b <= a) return false
    const d = centralYmd(a); return d >= from && d <= to })
}
/** hours from clock-in to clock-out, each visit capped at 24, to the nearest quarter hour */
export function hoursOf(visits: any[], from: string, to: string): number {
  const ms = completedIn(visits, from, to).reduce((t, v) => t + Math.min(24 * 36e5, (clockAt(v.clockOut) as number) - (clockAt(v.clockIn) as number)), 0)
  return Math.round(ms / 36e5 * 4) / 4
}
/** where the line stands now, from the facts (never touches a decided line) */
export function evaluate(line: any, f: { today: string; hours: number | null; prior_care: boolean; care_ended_on?: string | null; visits?: number | null }, set: ReturnType<typeof settingsOf>): any {
  const out = { ...line }
  if (f.hours != null) out.hours = f.hours
  if (f.visits != null) out.visits = f.visits
  out.hours_read_on = f.hours != null ? f.today : out.hours_read_on || null
  out.day = Math.min(set.days, Math.max(1, Math.round((Date.parse(f.today + 'T12:00:00Z') - Date.parse(line.first_visit + 'T12:00:00Z')) / 864e5) + 1))
  if (DECIDED.includes(line.status)) return out
  if (f.today <= line.day30) { out.status = 'on_the_way'; out.reasons = []; return out }
  const why: string[] = []
  if (f.prior_care) why.push('had care within ' + set.returning_gap + ' days before this start')
  if (f.care_ended_on && f.care_ended_on <= line.day30) why.push('care ended ' + f.care_ended_on)
  if (line.rules === 'v2') {
    if (out.visits == null) why.push('visits could not be read from AxisCare')
    else if (out.visits < set.min_visits) why.push(out.visits + ' of ' + set.min_visits + ' visits by day ' + set.days)
  } else if (out.hours == null) why.push('hours could not be read from AxisCare')
  else if (out.hours < set.min_hours) why.push(fmtH(out.hours) + ' of ' + set.min_hours + ' hours by day ' + set.days)
  out.status = why.length ? 'under_review' : 'ready'; out.reasons = why
  return out
}
const fmtH = (h: number) => (Math.round(h * 4) / 4).toString()
/** the words a Care Coordinator sees on their own line */
export function progressWords(line: any, set: ReturnType<typeof settingsOf>): string {
  const h = line.rules === 'v2' ? (line.visits == null ? 'visits not read yet' : Math.min(line.visits, set.min_visits) + ' of ' + set.min_visits + ' visits' + (line.visits > set.min_visits ? ' (' + line.visits + ' so far)' : ''))
    : line.hours == null ? 'hours not read yet' : fmtH(line.hours) + ' of ' + set.min_hours + ' hours'
  if (line.status === 'on_the_way') return 'Day ' + (line.day || 1) + ' of ' + set.days + ' · ' + h
  if (line.status === 'under_review') return 'Under review: ' + (line.reasons || []).join('; ')
  if (line.status === 'not_earned') return 'Not earned: ' + (line.decision_why || '')
  if (line.status === 'paid') return 'Paid' + (line.paid_on ? ' on the ' + line.paid_on + ' payroll' : '')
  return STATUS_WORDS[line.status] || line.status
}
/** what a person may do, and the change it makes. actor: {email, name, owner:boolean}. o: {why, paid_on}.
 *  Returns {line} (a new object, history added) or {error}. */
export function act(line: any, action: string, actor: any, o: any, set: ReturnType<typeof settingsOf>, nowIso: string): any {
  const me = lc(actor?.email), owner = !!actor?.owner, decider = me && me === set.decider, payroll = me && me === set.payroll
  const why = String(o?.why || '').trim().slice(0, 400)
  const go = (to: string, extra: any = {}) => ({ line: { ...line, ...extra, status: to,
    history: [...(Array.isArray(line.history) ? line.history : []), { at: nowIso, by: me, by_name: String(actor?.name || ''), action, from: line.status, to, why }].slice(-40) } })
  if (action === 'approve') {
    if (line.status === 'ready') return owner ? go('approved', { decided_by: me, decided_at: nowIso, decision_why: why }) : { error: 'Only Samantha or Zachary can approve a bonus.' }
    if (line.status === 'under_review') {
      if (!decider) return { error: 'Only Samantha can approve a bonus that is under review (an exception).' }
      if (!why) return { error: 'Write the reason for the exception.' }
      return go('approved', { decided_by: me, decided_at: nowIso, decision_why: why, exception: true })
    }
    return { error: 'This bonus is ' + (STATUS_WORDS[line.status] || line.status).toLowerCase() + ', so it can’t be approved now.' }
  }
  if (action === 'not_earned') {
    if (!decider) return { error: 'Only Samantha can mark a bonus not earned.' }
    if (!['ready', 'under_review'].includes(line.status)) return { error: 'Only a bonus past day ' + set.days + ' can be marked not earned.' }
    if (!why) return { error: 'Write the reason it is not earned.' }
    return go('not_earned', { decided_by: me, decided_at: nowIso, decision_why: why })
  }
  if (action === 'paid') {
    if (!(payroll || owner)) return { error: 'Only the payroll person, Samantha or Zachary can mark a bonus paid.' }
    if (line.status !== 'approved') return { error: 'Only an approved bonus can be marked paid.' }
    if (!set.ot_checked) return { error: 'Before the first payout, Samantha confirms with Viventium how bonuses count toward overtime.' }
    if (!isYmd(o?.paid_on)) return { error: 'Pick the payroll date it was paid on.' }
    return go('paid', { paid_on: o.paid_on, paid_by: me, paid_at: nowIso })
  }
  if (action === 'reopen') {
    if (!decider) return { error: 'Only Samantha can reopen a decision.' }
    if (!['approved', 'not_earned'].includes(line.status)) return { error: 'Only an approved or not-earned bonus can be reopened.' }
    if (!why) return { error: 'Write why it is being reopened.' }
    return go('under_review', { decided_by: null, decided_at: null, decision_why: null, exception: false, reasons: ['reopened: ' + why] })
  }
  return { error: 'Unknown action.' }
}
/** which lines a person sees: owners all; the payroll person their own plus every approved or paid line; anyone else their own */
export function visible(lines: any[], me: { email: string; first: string; owner: boolean }, set: ReturnType<typeof settingsOf>): any[] {
  const e = lc(me.email), f = lc(me.first)
  return (lines || []).filter((l) => me.owner || lc(l.recipient_email) === e || (!!f && lc(l.recipient) === f) || (e && e === set.payroll && ['approved', 'paid'].includes(l.status)))
}

/* ---------------------------------------------------------------------------------------------------------------------
   BONUSES WHEN A CARE COORDINATOR LEAVES (audit step 5, Samantha 2026-10-18). Whether a bonus is still paid when someone
   leaves, and whether an earned one belongs in final pay, is Samantha's open decision 3 (with the attorney and Viventium).
   So this only LISTS what is on file for the person leaving: nothing is paid, cancelled or changed because someone leaves.
   Owners only (a termination is owner-only, and pay is private). ------------------------------------------------------ */
export const SEPARATION_NOTE = 'Nothing here is paid or cancelled because someone leaves. Samantha decides each one with the attorney and Viventium (Missouri final-pay rules may apply to an earned bonus).'
const nm = (v: unknown) => lc(v).replace(/\s+/g, ' ')
/** the latest offboarding whose employee name is this office person's full name (exactly, ignoring case and spaces) */
export function leaverOf(offs: any[], fullName: string): any {
  const n = nm(fullName); if (!n) return null
  return (offs || []).filter((o: any) => o && nm(o.name) === n).sort((a: any, b: any) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0] || null
}
/** the person's bonuses, grouped: approved but not paid, still running (on the way, ready, under review), already paid */
export function separationOf(lines: any[], email: string, set: ReturnType<typeof settingsOf>): any {
  const mine = (lines || []).filter((l: any) => lc(l?.recipient_email) === lc(email) && l.status !== 'not_earned')
  const pick = (want: string[]) => { const ls = mine.filter((l: any) => want.includes(l.status)).map((l: any) => ({ id: l.id, client: l.client, first_visit: l.first_visit, day30: l.day30,
    amount: Number(l.amount || 0), status: l.status, status_words: STATUS_WORDS[l.status] || l.status, words: progressWords(l, set), paid_on: l.paid_on || null }))
    return { lines: ls, total: ls.reduce((t: number, l: any) => t + l.amount, 0) } }
  return { approved: pick(['approved']), running: pick(['on_the_way', 'ready', 'under_review']), paid: pick(['paid']), note: SEPARATION_NOTE }
}

/* ---------------------------------------------------------------------------------------------------------------------
   THE SCOREBOARD (v2, Samantha 2026-10-22): new clients this month for each Care Coordinator and the team goal, shared with
   the team; DOLLARS only for the person herself and the owners ("share the client counts and the team goal, but keep each
   person's dollars private to her and owners"). Pending from the first completed shift, earned at day 30 (Ready or
   Approved), paid on payroll day. -------------------------------------------------------------------------------------- */
export function stageOf(line: any): 'pending' | 'earned' | 'paid' | 'none' {
  if (line?.status === 'paid') return 'paid'
  if (line?.status === 'ready' || line?.status === 'approved') return 'earned'
  if (line?.status === 'on_the_way' || line?.status === 'under_review') return 'pending'
  return 'none'
}
const monthOf = (ymd: string) => String(ymd || '').slice(0, 7)
/** what one viewer sees. me: {email, first, owner}; month 'YYYY-MM'; today 'YYYY-MM-DD' */
export function scoreboard(lines: any[], me: { email: string; first: string; owner: boolean }, set: ReturnType<typeof settingsOf>, month: string, today: string): any {
  const live = (lines || []).filter((l: any) => l && l.status !== 'not_earned')
  const mine = (l: any) => me.owner || lc(l.recipient_email) === lc(me.email) || (!!me.first && lc(l.recipient) === lc(me.first))
  const names = [...new Set([...set.people, ...live.map((l: any) => l.recipient)].map((n: string) => first(n)).filter(Boolean))]
  const people = names.map((name: string) => {
    const ls = live.filter((l: any) => lc(l.recipient) === lc(name)), money = ls.length ? ls.every(mine) : (me.owner || lc(me.first) === lc(name))
    const sum = (st: string) => ls.filter((l: any) => stageOf(l) === st)
    const tot = (st: string) => sum(st).reduce((t: number, l: any) => t + Number(l.amount || 0), 0)
    return { name, you: lc(name) === lc(me.first), money, count: ls.filter((l: any) => monthOf(l.first_visit) === month).length,
      pending: money ? tot('pending') : sum('pending').length, earned: money ? tot('earned') : sum('earned').length, paid: money ? tot('paid') : sum('paid').length,
      clients: ls.filter((l: any) => stageOf(l) !== 'paid' || monthOf(l.paid_on || '') === month).sort((a: any, b: any) => String(b.first_visit).localeCompare(String(a.first_visit))).slice(0, 8)
        .map((l: any) => ({ client: l.client, first_visit: l.first_visit, stage: stageOf(l), day: l.day || null, visits: l.visits ?? null, day30: l.day30,
          words: money ? progressWords(l, set) : sharedWords(l, set), amount: money ? Number(l.amount || 0) : undefined, under_review: money ? l.status === 'under_review' : undefined })) }
  })
  const got = live.filter((l: any) => monthOf(l.first_visit) === month).length
  /* the moments: a line that became earned in the last 3 days. The earner (and owners) see the dollars; the team does not. */
  const since = addDaysYmd(today, -3)
  const moments = live.filter((l: any) => stageOf(l) === 'earned' && String(l.earned_on || '') >= since).map((l: any) => ({ id: l.id, name: first(l.recipient), client: l.client,
    you: lc(l.recipient_email) === lc(me.email) || lc(l.recipient) === lc(me.first), amount: mine(l) ? Number(l.amount || 0) : undefined, earned_on: l.earned_on }))
  return { month, goal: { count: set.goal.count, prize: set.goal.prize, got, left: Math.max(0, set.goal.count - got), reached: got >= set.goal.count }, people, moments }
}
/** the words a teammate sees: where it is, never the dollars */
export function sharedWords(line: any, set: ReturnType<typeof settingsOf>): string {
  const st = stageOf(line)
  if (st === 'paid' || st === 'earned') return 'Made it to day ' + set.days
  return 'Day ' + (line.day || 1) + ' of ' + set.days + (line.rules === 'v2' && line.visits != null ? ' · ' + Math.min(line.visits, set.min_visits) + ' of ' + set.min_visits + ' visits' : '')
}
/** the one line for the 8 am morning email (it goes to the office, so no dollars) */
export function morningLine(board: any): string {
  const near = board.people.flatMap((p: any) => p.clients.filter((c: any) => c.stage === 'pending' && c.day && c.day >= 25).map((c: any) => p.name + '\u2019s ' + c.client + ' reaches day 30 on ' + c.day30))
  const just = board.moments.map((m: any) => m.name + '\u2019s ' + m.client + ' made it to day 30')
  const goal = board.goal.reached ? `Team goal reached: ${board.goal.got} new clients this month. ${board.goal.prize} is on!` : `Team goal: ${board.goal.got} of ${board.goal.count} new clients this month. ${board.goal.left} more to ${board.goal.prize}.`
  return [...just, ...near.slice(0, 3), goal].join(' · ')
}
