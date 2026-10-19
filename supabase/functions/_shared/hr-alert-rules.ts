// =============================================================================
// hr-alert-rules.ts · what counts as "an HR item for Zach", and the words of his alert (HR Agent build step 7)
// =============================================================================
// Pure: no network. Samantha 2026-10-18 ("step 7"): Zach hears by text and email that he has an HR item to review.
// The alert is generic on purpose: no caregiver name, no reason, no count, nothing about the case. It only says there
// is something to review and links to the Hub, where he must sign in to see it (the cases are owner-only since 946/957).
// An item is waiting for Zach when it is one of these (each key changes when the item is asked again, so a second
// help request on the same coaching record is a new item):
//   · an open agent case that is a recurring concern or serious (hr_cases)
//   · a write-up sent for his approval (discipline_actions status pending_approval)
//   · a coaching talk where the coordinator asked for help and nobody has answered yet
//   · a coaching talk the coordinator handed back to him
//   · a coaching talk past its due day and still not held
//   · a write-up step that is due or overdue under the Corrective Action SOP (step 9: its open reminder card; a new step,
//     or a reminder that turns from due to overdue, counts as new)
// =============================================================================
// deno-lint-ignore no-explicit-any
type Any = any

export const HUB_LINK = 'https://cc.mo-care.com/#hr'
export const TEXT = `Caring Companions: You have an HR item to review. Sign in to the Hub to see it: ${HUB_LINK}`
export const TEST_TEXT = `Caring Companions: This is a test of your HR alerts. When an HR item needs you, a text like this comes with a link to the Hub: ${HUB_LINK}`
export const SUBJECT = 'You have an HR item to review'
export const TEST_SUBJECT = 'Test: your HR alerts from Caring Companions'

export function emailHtml(test = false): string {
  const line = test
    ? 'This is a test of your HR alerts. When an HR item needs you, an email like this one comes with a link to the Hub.'
    : 'You have an HR item to review.'
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#0E3860;max-width:520px">
<p>Hi Zach,</p>
<p>${line}</p>
<p><a href="${HUB_LINK}" style="display:inline-block;background:#54BDB8;color:#ffffff;text-decoration:none;font-weight:bold;padding:10px 18px;border-radius:8px">Open the HR page</a></p>
<p style="color:#6B7280;font-size:13px">You will be asked to sign in. For privacy, this email never includes names or details.</p>
<p style="color:#6B7280;font-size:13px">Caring Companions In-Home Senior Care</p>
</div>`
}

const s = (x: unknown) => String(x ?? '').trim()

/** The keys of everything waiting for Zach right now. `today` is the Chicago date, YYYY-MM-DD. */
export function waitingItems(p: { cases: Any[]; writeups: Any[]; coaching: Any[]; today: string; cards?: Any[] }): string[] {
  const out: string[] = []
  for (const c of p.cases || []) if (c && c.status === 'open' && (c.kind === 'recurring' || c.kind === 'serious')) out.push('case:' + s(c.id))
  for (const w of p.writeups || []) if (w && w.status === 'pending_approval') out.push('approve:' + s(w.id) + ':' + s(w.sent_for_approval_at || w.updated_at))
  for (const c of p.coaching || []) {
    if (!c || c.status !== 'open') continue
    if (c.help_at && !c.help_reply_at) out.push('help:' + s(c.id) + ':' + s(c.help_at))
    if (c.handoff_at) out.push('handoff:' + s(c.id) + ':' + s(c.handoff_at))
    if (c.due_on && s(c.due_on) < p.today) out.push('late:' + s(c.id) + ':' + s(c.due_on))
  }
  for (const k of p.cards || []) if (k && k.status === 'open' && String(k.id || '').startsWith('ops_wu_step_')) out.push('step:' + s(k.id).slice(12) + ':' + s(k.title) + ':' + s(k.urgency))
  return [...new Set(out)].sort()
}

/** The waiting items Zach has not been told about yet. */
export const newItems = (keys: string[], seen: unknown): string[] => {
  const had = new Set(Array.isArray(seen) ? seen.map(String) : [])
  return keys.filter((k) => !had.has(k))
}

const chicago = (now: Date) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now).map((x) => [x.type, x.value]))
  return { day: parts.weekday, hour: Number(parts.hour) % 24, date: `${parts.year}-${parts.month}-${parts.day}` }
}
export const chicagoDate = (now: Date = new Date()) => chicago(now).date

/** When an alert may go: Monday to Friday, 8am to 6pm Central (her rule: no night office texts). Weekends only when
 *  ops_settings.hr_alert_weekends is exactly true. Anything found outside the window goes out at the next 8am. */
export function sendWindow(now: Date, ops: Any = {}): boolean {
  const c = chicago(now)
  const weekend = c.day === 'Sat' || c.day === 'Sun'
  if (weekend && ops?.hr_alert_weekends !== true) return false
  return c.hour >= 8 && c.hour < 18
}

/** Who gets the alert: the to_phone and to_emails on the server-only row hr_alert_state 'zach' (Desktop 965 sets them;
 *  kept out of this public repo and out of ops_settings, which the office can read). */
export function recipients(row: Any = {}): { phone: string; emails: string[] } {
  const digits = s(row?.to_phone).replace(/\D/g, '')
  const phone = digits.length === 10 ? '+1' + digits : digits.length === 11 && digits[0] === '1' ? '+' + digits : ''
  const emails = [...new Set((Array.isArray(row?.to_emails) ? row.to_emails : []).map((e: unknown) => s(e).toLowerCase()).filter((e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))] as string[]
  return { phone, emails }
}
