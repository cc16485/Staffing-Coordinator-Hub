// =============================================================================
// team-rules.ts · TEAM NUMBERS AND MANAGEMENT REVIEWS (Care Coordinator Leads and Bonus, Stage 5; policy approved by
// Samantha 2026-10-18). Pure: no clock, no database, no network. cc-team reads the Hub and asks this file.
//
//   MY MONTH (each Care Coordinator, only their own) and the SIDE BY SIDE (Samantha and Zachary only), this month so far:
//     leads assigned        leads that became theirs this month (by turn, asked for, returning; before turns: new leads
//                           whose owner they were)
//     assessments           home assessments this month on their own leads (owned), and on a teammate's lead that they
//                           went to (helped)
//     new clients started   first visits this month on leads they originally owned
//     retained at 30 days   clients whose day 30 fell this month and who were still with us on it
//     overdue now           their follow-ups past due right now (a first call, a promised call back, a follow-up or
//                           check-back date, a second try) plus their relationship calls past due
//     bonuses earned        approved or paid this month (count and dollars)
//   The numbers start a conversation; they never decide it.
//   Time off never counts (audit step 2, ops_settings.fair_counts_live): what goes overdue while someone is out on the
//   Team page is shown apart ("while out") and never counts toward a review.
//
//   MANAGEMENT REVIEW: two different follow-ups that went overdue within 30 days open ONE review for the HR lead
//   (Zachary). He records the cause (workload, training or accountability) and chooses No action or Coaching. Coaching
//   gets an owner, a deadline and a done check. A review is never discipline. Samantha sees a review only once it is
//   unresolved: open 7 days with no decision, or coaching past its deadline and not done.
// No em dashes in any words a person reads.
// =============================================================================
// deno-lint-ignore-file no-explicit-any
import { centralYmd, addDaysYmd, isYmd } from './business-days.ts'

export const DEFAULTS = { hr_lead: 'zach@mo-care.com', decider: 'samantha@mo-care.com', misses: 2, window_days: 30, unresolved_days: 7 }
export const CAUSES: Record<string, string> = { workload: 'Workload', training: 'Training', accountability: 'Accountability' }
/* why a follow-up went overdue (audit step 3, Samantha 2026-10-18, ops_settings.overdue_causes_live). Only "employee"
   counts toward a review. Not marked = employee. Approved leave is set by itself while someone is out (step 2). */
export const OVERDUE_CAUSES: Record<string, string> = { employee: 'Mine (it counts)', staffing: 'Staffing shortage', client: 'Client or family decision', leave: 'Approved leave', technical: 'Phone or Hub problem' }
export const causeOf = (x: any) => (x && x.excused ? 'leave' : (x && OVERDUE_CAUSES[x.cause] ? x.cause : 'employee'))
/** does this logged miss count toward a review? never when excused; with causes on, only when the cause is employee */
export const counts = (x: any, causesOn: boolean) => !!x && !x.excused && (!causesOn || causeOf(x) === 'employee')
const lc = (v: unknown) => String(v ?? '').trim().toLowerCase()
const first = (v: unknown) => String(v ?? '').trim().split(/\s+/)[0] || ''
const same = (a: unknown, b: unknown) => !!first(a) && lc(first(a)) === lc(first(b))
const dayOf = (v: unknown) => { const s = String(v ?? ''); if (!s) return ''; return isYmd(s.slice(0, 10)) && s.length === 10 ? s : centralYmd(s) }

export function settingsOf(st: any) {
  const s = st || {}, t = s.team || {}
  const people = (Array.isArray(s.lead_rotation?.people) ? s.lead_rotation.people : []).map((p: any) => first(p?.name)).filter(Boolean)
  return { live: s.team_live === true, causes_live: s.overdue_causes_live === true, hr_lead: lc(t.hr_lead) || DEFAULTS.hr_lead, decider: lc(s.bonus?.decider) || DEFAULTS.decider, people }
}
export function monthOf(today: string) { return { from: today.slice(0, 8) + '01', to: today, label: new Date(today + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' }) } }
const inR = (d: string, r: { from: string; to: string }) => !!d && d >= r.from && d <= r.to
const ownerOf = (l: any) => first(l?.original_owner?.name) || first(l?.assigned_coordinator)

/** what is overdue right now for each lead owner: [{person, key, kind, lead_id, client, since}] (LR = LeadRules) */
export function overdueNow(leads: any[], cards: any[], LR: any, settings: any, nowIso: string, people: string[], emailOf: (n: string) => string): any[] {
  const out: any[] = [], hours = LR.responseHours(settings || {})
  for (const l of leads || []) {
    if (!l || l.archived || (l.spam && l.spam.at) || l.said_yes_at || ['Lost', 'Converted', 'Saved'].includes(String(l.status || ''))) continue
    const who = first(l.assigned_coordinator); if (!people.some((p) => same(p, who))) continue
    const client = [l.client_first_name, l.client_last_name].filter(Boolean).join(' ').trim() || [l.first_name, l.last_name].filter(Boolean).join(' ').trim() || 'a family'
    const fa = LR.firstAttemptState(l, hours, nowIso)
    if (fa && fa.running && !fa.attempted && fa.open_minutes >= 60) {   /* an hour of grace, like every follow-up below (the 5-minute clock has its own texts) */ out.push({ person: who, kind: 'first_call', lead_id: String(l.id), client, since: dayOf(nowIso), key: 'first_call:' + l.id }); continue }
    const nx = LR.leadNext(l, nowIso)
    if (nx && nx.due && nx.late_minutes > 60) { out.push({ person: who, kind: nx.kind, lead_id: String(l.id), client, since: nx.day, key: nx.kind + ':' + l.id + ':' + nx.day }); continue }
    const st = LR.secondTry ? LR.secondTry(l, { now: nowIso, today: dayOf(nowIso) }) : null
    if (st && st.late) out.push({ person: who, kind: 'second_try', lead_id: String(l.id), client, since: st.day, key: 'second_try:' + l.id + ':' + st.day })
  }
  for (const c of cards || []) {
    if (!c || c.status !== 'open' || c.kind !== 'relationship_call' || !c.due || Date.parse(c.due) >= Date.parse(nowIso)) continue
    const who = people.find((p) => lc(emailOf(p)) === lc(c.owner)); if (!who) continue
    out.push({ person: who, kind: 'relationship_call', lead_id: String(c.source_id || ''), client: String(c.about || ''), since: dayOf(c.due), key: 'rel:' + c.id })
  }
  return out
}
/** one person's month (see the header) */
export function monthFor(person: string, d: { leads: any[]; assessments: any[]; bonuses: any[]; journeys: any[]; overdue: any[] }, today: string): any {
  const m = monthOf(today), mine = (l: any) => same(ownerOf(l), person)
  const leads = (d.leads || []).filter((l) => l && !(l.spam && l.spam.at))
  const assignedL = leads.filter((l) => l.owner_turn && l.owner_turn.to ? same(l.owner_turn.to, person) && inR(dayOf(l.owner_turn.at), m) : mine(l) && inR(dayOf(l.created_at), m)), assigned = assignedL.length
  const returning = assignedL.filter((l) => l.owner_turn && l.owner_turn.how === 'returning').length   /* audit step 6: returning clients on their own line */
  const byId = new Map(leads.map((l) => [String(l.id), l]))
  let owned = 0, helped = 0
  for (const a of d.assessments || []) {
    const v = String(a?.visit_date || ''); if (!inR(v, m) || !/Scheduled|Completed/.test(String(a?.status || ''))) continue
    const l = byId.get(String(a.lead_id || '')); const mineL = l ? mine(l) : false
    if (mineL) owned++; else if (same(a.coordinator, person)) helped++
  }
  const starts = leads.filter((l) => l.first_shift_at && mine(l) && inR(dayOf(l.first_shift_at), m)).length
  const jOf = new Map((d.journeys || []).map((j: any) => [String(j.lead_id), j]))
  const retained = leads.filter((l) => { if (!l.first_shift_at || !mine(l)) return false; const d30 = addDaysYmd(dayOf(l.first_shift_at), 29); if (!inR(d30, m)) return false
    const j: any = jOf.get(String(l.id)); const ended = j && j.status === 'closed' && /^care ended/i.test(String(j.closed_reason || '')) ? dayOf(j.updated_at) : (String(l.status) === 'Lost' ? dayOf(l.lost_at) : '')
    return !(ended && ended <= d30) }).length
  const won = (d.bonuses || []).filter((b) => same(b.recipient, person) && ['approved', 'paid'].includes(b.status) && inR(dayOf(b.decided_at), m))
  return { person, month: m.label, from: m.from, to: m.to, leads_assigned: assigned, leads_returning: returning, assessments_owned: owned, assessments_helped: helped, starts, retained_30: retained,
    overdue_now: (d.overdue || []).filter((o) => same(o.person, person) && !o.excused).length, overdue_while_out: (d.overdue || []).filter((o) => same(o.person, person) && o.excused).length, bonuses: won.length, bonus_dollars: won.reduce((t, b) => t + (Number(b.amount) || 0), 0) }
}
/** time off never counts (audit step 2, ops_settings.fair_counts_live): mark each overdue item whose owner is out today as
 *  excused. An item first seen while they were out stays excused in the log, so it never counts after they come back. */
export function excuse(overdue: any[], isOut: (name: string) => boolean): any[] { return (overdue || []).map((o) => (isOut(o.person) ? { ...o, excused: 'out' } : o)) }
/** the daily log: add today's overdue keys (one entry per key, the first day it was seen) */
export function logOverdue(log: any[], overdue: any[], today: string): any[] {
  const have = new Set((log || []).map((x) => x.key))
  const add = overdue.filter((o) => !have.has(o.key)).map((o) => ({ id: 'od_' + o.key.replace(/[^a-zA-Z0-9_:-]/g, '_'), key: o.key, person: o.person, kind: o.kind, lead_id: o.lead_id, client: o.client, day: today, ...(o.excused ? { excused: o.excused } : {}) }))
  return [...(log || []).filter((x) => x.day >= addDaysYmd(today, -90)), ...add]
}
/** reviews to open now: a person with 2 different follow-ups overdue within 30 days, counted after their last review */
export function reviewsToOpen(log: any[], reviews: any[], people: string[], today: string, misses = DEFAULTS.misses, causesOn = false): any[] {
  const out: any[] = []
  for (const p of people) {
    const mineR = (reviews || []).filter((r) => same(r.person, p))
    if (mineR.some((r) => ['open', 'coaching'].includes(r.status))) continue
    const since = mineR.map((r) => r.opened_on).sort().pop() || ''
    const items = (log || []).filter((x) => same(x.person, p) && counts(x, causesOn) && (!causesOn || x.day < today) && x.day >= addDaysYmd(today, -(DEFAULTS.window_days - 1)) && x.day > since)   /* with causes on, a miss counts from the next day's check, so the owner has a day to mark why */   /* excused (time off), and with causes on anything not the employee's, never counts */
    if (items.length >= misses) out.push({ id: 'rev_' + lc(p) + '_' + today, person: p, opened_on: today, status: 'open', items: items.map((x) => ({ key: x.key, kind: x.kind, client: x.client, day: x.day })), history: [] })
  }
  return out
}
/** unresolved: open 7 days with no decision, or coaching past its deadline and not done */
export function unresolved(r: any, today: string): boolean {
  if (r.status === 'open') return r.opened_on <= addDaysYmd(today, -DEFAULTS.unresolved_days)
  if (r.status === 'coaching') return !!r.coaching?.deadline && r.coaching.deadline < today
  return false
}
/** a decision or a done check. actor {email, name}. Returns {review} or {error}. */
export function act(r: any, action: string, actor: any, o: any, set: ReturnType<typeof settingsOf>, nowIso: string, today: string): any {
  const me = lc(actor?.email), hr = me && (me === set.hr_lead || me === set.decider)
  const go = (to: string, extra: any = {}, why = '') => ({ review: { ...r, ...extra, status: to,
    history: [...(Array.isArray(r.history) ? r.history : []), { at: nowIso, by: me, by_name: String(actor?.name || ''), action, from: r.status, to, why }].slice(-30) } })
  if (action === 'decide') {
    if (!hr) return { error: 'Only the HR lead (Zachary) or Samantha decides a review.' }
    if (r.status !== 'open') return { error: 'This review is already decided.' }
    if (!CAUSES[o?.cause]) return { error: 'Pick the cause: workload, training or accountability.' }
    const note = String(o?.note || '').trim().slice(0, 400)
    if (o?.choice === 'no_action') return go('no_action', { cause: o.cause, decided_by: me, decided_at: nowIso, note }, CAUSES[o.cause] + (note ? ': ' + note : ''))
    if (o?.choice !== 'coaching') return { error: 'Choose No action or Coaching.' }
    const owner = lc(o?.coaching_owner), deadline = String(o?.deadline || ''), plan = String(o?.plan || '').trim().slice(0, 400)
    if (!owner) return { error: 'Coaching needs an owner (who does it).' }
    if (!isYmd(deadline) || deadline < today) return { error: 'Coaching needs a deadline, today or later.' }
    if (!plan) return { error: 'Write what the coaching covers.' }
    return go('coaching', { cause: o.cause, decided_by: me, decided_at: nowIso, note, coaching: { owner, deadline, plan } }, CAUSES[o.cause] + ': coaching by ' + deadline)
  }
  if (action === 'coaching_done') {
    if (r.status !== 'coaching') return { error: 'There is no coaching open on this review.' }
    if (!(hr || me === lc(r.coaching?.owner))) return { error: 'Only the coaching owner, the HR lead or Samantha can check coaching off.' }
    const note = String(o?.note || '').trim().slice(0, 400)
    if (!note) return { error: 'Write a short note: what was covered?' }
    return go('done', { coaching: { ...r.coaching, done_at: nowIso, done_by: me, done_note: note } }, note)
  }
  return { error: 'Unknown action.' }
}
/** which reviews a person sees: the HR lead all; Samantha the unresolved ones; a coaching owner their own coaching; nobody else */
export function visibleReviews(reviews: any[], me: string, set: ReturnType<typeof settingsOf>, today: string): any[] {
  const e = lc(me)
  return (reviews || []).filter((r) => e === set.hr_lead || (e === set.decider && unresolved(r, today)) || (r.status === 'coaching' && lc(r.coaching?.owner) === e))
}

/** the cause on one logged miss (decision 5: the owner picks it; once it is part of an open review, only the HR lead or
 *  Samantha can change it). Any cause but "employee" needs a short note. Returns {entry} (a new object) or {error}. */
export function setCause(entry: any, cause: string, note: string, actor: { email: string; first: string }, reviews: any[], set: ReturnType<typeof settingsOf>, nowIso: string): any {
  if (!entry) return { error: 'That item is not on file.' }
  if (!OVERDUE_CAUSES[cause]) return { error: 'Pick a cause.' }
  if (entry.excused) return { error: 'This went overdue while they were out, so it is already approved leave and never counts.' }
  const n = String(note || '').trim().slice(0, 300)
  if (cause !== 'employee' && !n) return { error: 'Add a short note: what happened?' }
  const me = lc(actor.email), hr = me === set.hr_lead || me === set.decider, owner = same(actor.first, entry.person)
  const inReview = (reviews || []).some((r) => ['open', 'coaching'].includes(r.status) && (r.items || []).some((i: any) => i.key === entry.key))
  if (inReview && !hr) return { error: 'This is part of a review now, so Zachary decides its cause. Tell him what happened.' }
  if (!hr && !owner) return { error: 'Only the person it belongs to, Zachary or Samantha can mark this.' }
  return { entry: { ...entry, cause, cause_note: n, cause_by: me, cause_at: nowIso,
    cause_history: [...(Array.isArray(entry.cause_history) ? entry.cause_history : []), { at: nowIso, by: me, from: causeOf(entry), to: cause, note: n }].slice(-10) } }
}
