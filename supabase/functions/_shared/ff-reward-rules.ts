// =============================================================================
// ff-reward-rules · THE FRIENDS & FAMILY $100 (Friends & Family Referral Program, step 5, 2026-10-27).
// Samantha 2026-10-27: "could it be a $100 credit on their invoice for a client who refers - make it all active and live", then her
// answers: live without waiting for the attorney; earned at 20 completed hours AND payment checked (two separate checks); caregivers
// $100 through Viventium, same timing; "Yes, start step 5: the $100 credit and bonus tracking, live as I decided."
// Pure: no clock, no database, no network. ff-invite-check reads AxisCare and the Hub and asks this file.
//
// THE RULES
//   · a line starts when an inquiry that came through a Friends & Family person's link (referral_org_id = a program_track
//     'friends' record) has its first completed visit (lead.first_shift_at)
//   · 20 completed hours from AxisCare clock-in to clock-out, from the first visit on (no deadline)
//   · payment for those hours received: an owner ticks it (AxisCare has no invoices the Hub can read)
//   · both met, nothing to review = READY. Anything below = UNDER REVIEW, with the reason in words:
//       - the new client's payer isn't private pay (long-term care insurance: her rule, reviewed separately)
//       - served by Caring Companions before (a completed visit before this first visit, or the inquiry was flagged as
//         possibly a family we know)
//       - a caregiver referring someone with their own last name (maybe their own relative: her rule)
//       - a family member referring their own client (self-referral)
//       - another line already exists for the same client (one reward per new client)
//   · nothing is approved, applied or paid by itself. Any owner approves a READY line; approving an UNDER REVIEW line or
//     marking Not earned needs a written reason. Then a family line is marked Credit applied (the date it went on the
//     invoice in AxisCare) and a caregiver line Paid (the Viventium payroll date). Every change keeps who, when and why.
// No em dashes in any words a person reads.
// =============================================================================
// deno-lint-ignore-file no-explicit-any
export const AMOUNT = 100
export const MIN_HOURS = 20
export const STATUS_WORDS: Record<string, string> = { on_the_way: 'On the way', ready: 'Ready for approval', under_review: 'Under review',
  approved: 'Approved', not_earned: 'Not earned', applied: 'Credit applied', paid: 'Paid' }
export const DECIDED = ['approved', 'not_earned', 'applied', 'paid']
const S = (v: unknown) => String(v ?? '').trim()
const lc = (v: unknown) => S(v).toLowerCase()
const lastName = (n: unknown) => lc(n).replace(/[^a-z\s-]/g, '').split(/\s+/).filter(Boolean).pop() || ''
const ymd = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(S(v)) ? S(v) : ''
export const dayOf = (v: unknown): string => {
  const s = S(v); if (!s) return ''
  if (ymd(s)) return s
  const t = Date.parse(s); return Number.isNaN(t) ? '' : new Date(t).toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
}
const clockAt = (c: any) => { const t = Date.parse(S(c?.time ?? c)); return Number.isNaN(t) ? null : t }
/** completed visits (in and out, not removed) whose clock-in day is on or after `from` (and before `before`, when given) */
export function completedFrom(visits: any[], from: string, before = ''): any[] {
  return (visits || []).filter((v) => { if (!v || v.removed) return false; const a = clockAt(v.clockIn), b = clockAt(v.clockOut); if (a == null || b == null || b <= a) return false
    const d = dayOf(new Date(a).toISOString()); return d >= from && (!before || d < before) })
}
/** hours, clock-in to clock-out, each visit capped at 24, to the nearest quarter hour */
export function hoursFrom(visits: any[], from: string): number {
  const ms = completedFrom(visits, from).reduce((t, v) => t + Math.min(24 * 36e5, (clockAt(v.clockOut) as number) - (clockAt(v.clockIn) as number)), 0)
  return Math.round(ms / 36e5 * 4) / 4
}
const fmtH = (h: number) => (Math.round(h * 4) / 4).toString()

/** the friends records and the inquiries that came through them, with a first visit: {lead, org} pairs */
export function referred(leads: any[], orgs: any[]): Array<{ lead: any; org: any }> {
  const byId = new Map((orgs || []).filter((o) => o && o.program_track === 'friends').map((o) => [S(o.id), o]))
  return (leads || []).filter((l) => l && l.id && byId.has(S(l.referral_org_id)) && !l.archived && !(l.spam && l.spam.at) && dayOf(l.first_shift_at))
    .map((lead) => ({ lead, org: byId.get(S(lead.referral_org_id)) }))
}
export const clientName = (l: any) => [l?.client_first_name, l?.client_last_name].filter(Boolean).join(' ').trim() || [l?.first_name, l?.last_name].filter(Boolean).join(' ').trim() || 'A new client'

/** a new line for a referred inquiry */
export function newLine(lead: any, org: any, axId: string, at: string): any {
  return { lead_id: S(lead.id), org_id: S(org.id), referrer: S(org.name), referrer_kind: org.ff_kind === 'caregiver' ? 'caregiver' : 'family',
    referrer_client: S(org.ff_client) || null, referrer_client_ax: S(org.ff_client_ax) || null, client_name: clientName(lead), client_ax: axId || null,
    first_visit: dayOf(lead.first_shift_at), amount: AMOUNT, status: 'on_the_way', hours: null, reasons: [], payment_checked_at: null, payment_checked_by: null,
    created_at: at, history: [{ at, by: 'automatic', action: 'created', from: null, to: 'on_the_way', why: `first visit ${dayOf(lead.first_shift_at)}` }] }
}

/** why a line needs an owner's look (empty = nothing to review) */
export function reviewReasons(line: any, f: { lead: any; org: any; prior: boolean | null; otherLineForClient: boolean }): string[] {
  const why: string[] = []
  const pay = lc(f.lead?.funding_source)
  if (pay === 'ltc') why.push('the new client pays with long-term care insurance (reviewed separately)')
  else if (!pay) why.push("the new client's payer isn't set on the inquiry")
  else if (pay !== 'private') why.push(`the new client isn't private pay (${S(f.lead.funding_source)})`)
  if (f.prior === null) why.push("their earlier care couldn't be checked in AxisCare")
  else if (f.prior) why.push('Caring Companions served this client before this start')
  if (f.lead?.possibly_returning) why.push('the inquiry was flagged as possibly a family we already know')
  if (line.referrer_kind === 'caregiver') {
    const ln = lastName(line.referrer)
    const theirs = [clientName(f.lead), [f.lead?.first_name, f.lead?.last_name].filter(Boolean).join(' ')].map(lastName)
    if (ln && theirs.includes(ln)) why.push(`the caregiver shares a last name with the client or the caller (maybe their own relative)`)
  }
  if (line.referrer_kind === 'family' && line.referrer_client_ax && line.client_ax && S(line.referrer_client_ax) === S(line.client_ax)) why.push('a family member referred their own client')
  if (f.otherLineForClient) why.push('another referral reward already exists for this client')
  return why
}

/** where a line stands now from the facts; a decided line only gets its hours refreshed */
export function evaluate(line: any, f: { today: string; hours: number | null; reasons: string[] }): any {
  const out = { ...line }
  if (f.hours != null) { out.hours = f.hours; out.hours_read_on = f.today; if (f.hours >= MIN_HOURS && !out.hours_met_on) out.hours_met_on = f.today }
  if (DECIDED.includes(line.status)) return out
  const hoursOk = out.hours != null && out.hours >= MIN_HOURS, paid = !!out.payment_checked_at
  out.reasons = [...f.reasons]
  if (!hoursOk || !paid) { out.status = 'on_the_way'; return out }   // review reasons show early, the decision waits for both checks
  out.status = f.reasons.length ? 'under_review' : 'ready'
  return out
}
export function progressWords(line: any): string {
  const h = line.hours == null ? 'hours not read yet' : `${fmtH(Math.min(line.hours, MIN_HOURS))} of ${MIN_HOURS} hours${line.hours > MIN_HOURS ? ` (${fmtH(line.hours)} so far)` : ''}`
  const p = line.payment_checked_at ? 'payment received' : 'payment not checked yet'
  if (line.status === 'on_the_way') return `${h} · ${p}`
  if (line.status === 'under_review') return 'Under review: ' + (line.reasons || []).join('; ')
  if (line.status === 'not_earned') return 'Not earned: ' + S(line.decision_why)
  if (line.status === 'applied') return `Credit applied ${S(line.done_on)}`
  if (line.status === 'paid') return `Paid on the ${S(line.done_on)} payroll`
  return STATUS_WORDS[line.status] || line.status
}

/** what an owner may do. o: {why, on, date}. Returns {line} (history added) or {error}. */
export function act(line: any, action: string, actor: { email: string; name: string }, o: any, nowIso: string): any {
  const why = S(o?.why).slice(0, 400), who = S(actor?.name) || S(actor?.email)
  const go = (to: string, extra: any = {}) => ({ line: { ...line, ...extra, status: to,
    history: [...(Array.isArray(line.history) ? line.history : []), { at: nowIso, by: who, action, from: line.status, to, why }].slice(-40) } })
  if (action === 'payment') {
    if (['not_earned', 'applied', 'paid'].includes(line.status)) return { error: 'This one is already settled.' }
    const on = o?.on === true
    const next = { ...line, payment_checked_at: on ? nowIso : null, payment_checked_by: on ? who : null,
      history: [...(Array.isArray(line.history) ? line.history : []), { at: nowIso, by: who, action: on ? 'payment received' : 'payment unchecked', from: line.status, to: line.status, why }].slice(-40) }
    return { line: next }
  }
  if (action === 'approve') {
    if (line.status === 'ready') return go('approved', { decided_by: who, decided_at: nowIso, decision_why: why })
    if (line.status === 'under_review') return why ? go('approved', { decided_by: who, decided_at: nowIso, decision_why: why }) : { error: 'Say why you are approving it despite the review.' }
    return { error: line.status === 'on_the_way' ? 'It needs 20 completed hours and payment received first.' : 'This one is already decided.' }
  }
  if (action === 'not_earned') {
    if (['applied', 'paid', 'not_earned'].includes(line.status)) return { error: 'This one is already settled.' }
    return why ? go('not_earned', { decided_by: who, decided_at: nowIso, decision_why: why }) : { error: 'Say why it is not earned.' }
  }
  if (action === 'done') {
    if (line.status !== 'approved') return { error: 'Approve it first.' }
    const d = ymd(o?.date)
    if (!d) return { error: line.referrer_kind === 'caregiver' ? 'Which payroll date?' : 'What date did the credit go on the invoice?' }
    return go(line.referrer_kind === 'caregiver' ? 'paid' : 'applied', { done_on: d, done_by: who })
  }
  if (action === 'reopen') {
    if (!['approved', 'not_earned'].includes(line.status) || !why) return { error: line.status === 'applied' || line.status === 'paid' ? 'A credit or payment already went out.' : 'Say why you are reopening it.' }
    return go('on_the_way', { decided_by: null, decided_at: null, decision_why: null })
  }
  return { error: 'Unknown action.' }
}
