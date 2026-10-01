// Running late (L1, 2026-09-29) · what the missed clock-in watcher needs to know about a late notice.
// A caregiver who told us they're running late gets no "we don't see a clock-in" text, and the missed clock-in admin
// texts wait until 5 minutes after the time they gave (or 15 minutes past the start when they gave none). "Can't make
// it" holds the missed clock-in entirely: the running-late alert already rings the admins, with a coverage button.
// Only a LIVE notice holds (open or seen); practice notices change nothing.
export const HOLD_AFTER_ETA_MIN = 5, HOLD_NO_TIME_MIN = 15
export type NoticeLite = { visit_id: string; kind: string; eta: string | null; status: string; said_at?: string | null }
export function lateHold(n: NoticeLite | null | undefined, shiftStartMs: number, now = Date.now()): 'none' | 'skip' | 'hold' {
  if (!n || (n.status !== 'open' && n.status !== 'seen')) return 'none'
  if (n.kind === 'cant_make_it') return 'skip'
  if (n.kind !== 'late') return 'none'
  const eta = n.eta ? Date.parse(n.eta) : NaN
  const until = (Number.isFinite(eta) ? eta : shiftStartMs + HOLD_NO_TIME_MIN * 60e3) + HOLD_AFTER_ETA_MIN * 60e3
  return now < until ? 'hold' : 'none'
}
/* Today's live notices by visit, for the missed clock-in watcher. A missing table (before Desktop 363) is no notices. */
// deno-lint-ignore no-explicit-any
export async function liveNotices(sb: any, day: string): Promise<Map<string, NoticeLite>> {
  const out = new Map<string, NoticeLite>()
  try {
    const { data, error } = await sb.from('late_notices').select('visit_id, kind, eta, status, said_at').eq('shift_date', day).in('status', ['open', 'seen'])
    if (error) return out
    for (const r of data ?? []) out.set(String(r.visit_id), r)
  } catch { /* no table yet */ }
  return out
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
