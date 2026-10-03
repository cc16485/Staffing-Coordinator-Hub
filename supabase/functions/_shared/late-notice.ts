// Running late (L1, 2026-09-29) · what the missed clock-in watcher needs to know about a late notice.
// A caregiver who told us they're running late gets no "we don't see a clock-in" text, and the missed clock-in admin
// texts wait until 5 minutes after the time they gave (or 15 minutes past the start when they gave none). "Can't make
// it" holds the missed clock-in entirely: the running-late alert already rings the admins, with a coverage button.
// Only a LIVE notice holds (open or seen); practice notices change nothing.
//
// 432 (Samantha, 2026-10-03: "i thought it might have read my transcript from my call to mary to see that she said
// she is running late and will be to Aprils in 8 minutes", then "yes build it"): a CALL with the caregiver (in or out,
// on the office line) is read by the same reader as her texts. While the running-late notices are still in practice
// (late_watch_live off), a notice that came from a call is live by itself (ops_settings.late_call_live, ON unless she
// turns it off) and does exactly one thing on its own: when the call said "running late" AND gave a time, the missed
// clock-in admin texts pause until 5 minutes after that time (then they carry on, counting toward the cap). Without a
// time, or "can't make it", the missed clock-in texts carry on as before (never guess; someone has to cover the shift).
// Nothing is texted to anyone because of a call; the family only ever hears from a person's tap ("Send to the family").
export const HOLD_AFTER_ETA_MIN = 5, HOLD_NO_TIME_MIN = 15
/* 432: a call's pause never runs past 2 hours after the shift's start (a misheard time can't silence an alert for long) */
export const HOLD_CALL_MAX_MIN = 120
export type NoticeLite = { visit_id: string; kind: string; eta: string | null; status: string; said_at?: string | null
  call_at?: string | null; call_by?: string | null; call_by_email?: string | null; call_quote?: string | null; caregiver_name?: string | null
  client_first?: string | null; shift_start?: string | null; call_message_id?: string | null }
/* callOnly: the running-late notices are in practice (late_watch_live off), so only a call's notice may hold, and
   only "late" with a time. callHold: ops_settings.late_call_live is not false. Without opts: the L1 rule as it was. */
export type HoldOpts = { callOnly: boolean; callHold: boolean }
export const holdOptsOf = (st: { late_watch_live?: unknown; late_call_live?: unknown } | null | undefined): HoldOpts =>
  ({ callOnly: st?.late_watch_live !== true, callHold: st?.late_call_live !== false })
export const callLive = (st: { late_call_live?: unknown } | null | undefined) => st?.late_call_live !== false
/** Until when the missed clock-in waits for this notice (ms), or null when it doesn't. */
export function holdUntil(n: NoticeLite | null | undefined, shiftStartMs: number, opts?: HoldOpts): number | null {
  if (!n || (n.status !== 'open' && n.status !== 'seen')) return null
  if (opts?.callOnly && (!n.call_at || !opts.callHold || n.kind !== 'late' || !n.eta)) return null
  if (n.kind !== 'late') return null
  const eta = n.eta ? Date.parse(n.eta) : NaN
  const until = (Number.isFinite(eta) ? eta : shiftStartMs + HOLD_NO_TIME_MIN * 60e3) + HOLD_AFTER_ETA_MIN * 60e3
  return opts?.callOnly && Number.isFinite(shiftStartMs) ? Math.min(until, shiftStartMs + HOLD_CALL_MAX_MIN * 60e3) : until
}
export function lateHold(n: NoticeLite | null | undefined, shiftStartMs: number, now = Date.now(), opts?: HoldOpts): 'none' | 'skip' | 'hold' {
  if (!n || (n.status !== 'open' && n.status !== 'seen')) return 'none'
  if (opts?.callOnly && (!n.call_at || !opts.callHold || n.kind !== 'late' || !n.eta)) return 'none'
  if (n.kind === 'cant_make_it') return 'skip'
  const until = holdUntil(n, shiftStartMs, opts)
  return until != null && now < until ? 'hold' : 'none'
}
/* Today's live notices by visit, for the missed clock-in watcher. A missing table (before Desktop 363) is no notices. */
// deno-lint-ignore no-explicit-any
export async function liveNotices(sb: any, day: string): Promise<Map<string, NoticeLite>> {
  const out = new Map<string, NoticeLite>()
  try {
    let r = await sb.from('late_notices').select('visit_id, kind, eta, status, said_at, call_at, call_by, call_by_email, call_quote, call_message_id, caregiver_name, client_first, shift_start').eq('shift_date', day).in('status', ['open', 'seen'])
    /* before 432's columns exist, the L1 columns */
    if (r?.error) r = await sb.from('late_notices').select('visit_id, kind, eta, status, said_at').eq('shift_date', day).in('status', ['open', 'seen'])
    if (r?.error) return out
    for (const x of r?.data ?? []) out.set(String(x.visit_id), x)
  } catch { /* no table yet */ }
  return out
}

/* 432 · the line every page and text uses for a call: "Mary said on your 4:31pm call: running late, about 8 minutes
   (around 4:39pm)." "your" when the person reading was on the call, else "Krystal's", else "the". No pronouns. */
export function callLine(n: NoticeLite | null | undefined, viewerEmail?: string | null): string {
  if (!n || !n.call_at) return ''
  const at = Date.parse(n.call_at); if (!Number.isFinite(at)) return ''
  const cg = String(n.caregiver_name ?? '').trim().split(/\s+/)[0] || 'The caregiver'
  const me = String(viewerEmail ?? '').trim().toLowerCase(), by = String(n.call_by_email ?? '').trim().toLowerCase()
  const whose = me && by && me === by ? 'your' : n.call_by ? `${String(n.call_by).trim().split(/\s+/)[0]}'s` : 'the'
  const head = `${cg} said on ${whose} ${clockAt(at)} call:`
  if (n.kind === 'cant_make_it') {
    const st = n.shift_start ? Date.parse(n.shift_start) : NaN
    return `${head} can't make it to ${n.client_first ? `${n.client_first}'s` : 'the'}${Number.isFinite(st) ? ` ${clockAt(st)}` : ''} shift.`
  }
  const eta = n.eta ? Date.parse(n.eta) : NaN
  if (!Number.isFinite(eta)) return `${head} running late (no arrival time given).`
  const mins = Math.round((eta - at) / 60e3)
  return mins >= 1 ? `${head} running late, about ${mins} minute${mins === 1 ? '' : 's'} (around ${clockAt(eta)}).` : `${head} running late, arriving around ${clockAt(eta)}.`
}

/* The wording (her approved texts; editable in Settings, Running late). No sign-off (her call, 2026-09-29), and the
   caregiver texts never say we'll "tell the office": they're already texting the office. */
export const DEFAULT_THANKS = `Thanks for letting us know, {first_name}. We'll plan on you getting to {client}'s around {eta}. Drive safe.`
export const DEFAULT_ASK = `Thanks for letting us know, {first_name}. About what time do you think you'll get to {client}'s?`
export const DEFAULT_FAMILY = `A quick update from Caring Companions. {caregiver} is running a little late for {client}'s {time} visit today and expects to arrive around {eta}. We're sorry for the wait. Questions? Call us at (417) 234-8494.`
export const DEFAULT_FAMILY_UPDATE = `An update from Caring Companions: {caregiver} now expects to get to {client}'s around {eta}.`
export const DEFAULT_ARRIVED = `An update from Caring Companions: {caregiver} has arrived at {client}'s. Thank you for your patience.`
export const FAMILY_MIN_DEFAULT = 10
export const fill = (t: string, x: Record<string, string>) =>
  Object.entries(x).reduce((s, [k, v]) => s.replaceAll('{' + k + '}', v), String(t)).replace(/[ \t]{2,}/g, ' ').trim()
/* "9am", "9:20am" in Central (her 12-hour rule). */
export function clockAt(ms: number): string {
  const p = new Date(ms).toLocaleString('en-GB', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false })
  const [h24, m] = p.split(':').map(Number)
  return `${h24 % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}${h24 >= 12 ? 'pm' : 'am'}`
}
/* When the family may hear (decision 4): a time was given, it's FAMILY_MIN or more past the start, and the Hub is sure
   which visit it is. The hours (6am to 9pm) are enforced by the texting door itself (timely_external). */
export function familyEligible(n: { kind: string; eta: string | null; shift_start: string; sure: boolean }, minMin = FAMILY_MIN_DEFAULT): { ok: boolean; why: string } {
  if (n.kind !== 'late') return { ok: false, why: "they can't make it: the family isn't texted from here" }
  if (!n.eta) return { ok: false, why: 'no arrival time yet' }
  if (!n.sure) return { ok: false, why: "the Hub couldn't tell which visit, or the message was unclear" }
  const late = (Date.parse(n.eta) - Date.parse(n.shift_start)) / 60e3
  if (late < minMin) return { ok: false, why: `under ${minMin} minutes late: the family isn't told` }
  return { ok: true, why: '' }
}
