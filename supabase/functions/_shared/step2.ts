// =============================================================================
// step2.ts · SLICE 4 (Samantha "go", 2026-10-10): Viventium Step 2 without an integration. The approved words (Final
// workflow tab, section 8, moments 6, 7, 8 and the office "still open" message), the checklist-to-card mapping, and the
// pure rules the step2-handoff function and its tests share. No em dashes. The caller never supplies message text.
// deno-lint-ignore-file no-explicit-any
import { withStop } from './text-consent.ts'
export const OFFICE = '(417) 234-8494'
export const STEP2_FIELDS = ['step2_sent_at', 'step2_sent_by', 'step2_sent_note', 'step2_resent_at', 'step2_resent_by', 'step2_msg', 'step2_done_at', 'step2_done_by', 'step2_done_how', 'step2_receipt',
  'step2_verified_at', 'step2_verified_by', 'step2_checklist', 'step2_i9_s2_by', 'step2_i9_s2_at', 'step2_note', 'step2_still_open_at', 'step2_still_open_by', 'step2_still_open_task', 'step2_reminders', 'step2_history', 'step2_invite']
const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/* Moment 6: after Record Viventium Step 2 Sent (automatic after the office confirmation) */
export function sentMessages(first: string, doneLink: string) {
  const text = withStop(`Hi ${first}, great news from Caring Companions: your background check and references are complete! Step 2 is your payroll and tax paperwork in Viventium, our secure payroll system. Watch your email for a message from Viventium today and finish each task there. Need help? Our short video shows every step: mo-care.com/viventium-setup When every task is done, tell us here: ${doneLink} or reply DONE to this text. Then we book your Orientation Video Call.`)
  const subject = 'Step 2: your paperwork in Viventium'
  const html = `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#16283a;max-width:600px">
<p>Hi ${esc(first)}, great news from Caring Companions: your background check and references are complete!</p>
<p>Step 2 is your payroll and tax paperwork in Viventium, our secure payroll system. Watch your email for a message from Viventium today and finish each task there.</p>
<p>Need help? Our short video shows every step: <a href="https://mo-care.com/viventium-setup" style="color:#14606F;font-weight:700">mo-care.com/viventium-setup</a></p>
<p>When every task is done, tell us here:</p>
<p><a href="${esc(doneLink)}" style="display:inline-block;background:#F0A63A;color:#122F52;font-weight:800;padding:12px 20px;border-radius:10px;text-decoration:none">I finished Step 2</a></p>
<p>Then we book your Orientation Video Call. Questions? Call or text the office at ${OFFICE}.</p>
<p>Caring Companions</p></div>`
  return { text, subject, html }
}
/* Moment 7: day 3 and day 6 after Sent, no DONE */
export function reminderMessages(first: string, doneLink: string) {
  const text = withStop(`Hi ${first}, a reminder from Caring Companions: your Step 2 tasks are waiting in Viventium (check your email for their message). Need help? Our short video shows every step: mo-care.com/viventium-setup When they are all done, tap here or reply DONE: ${doneLink} Stuck? Call or text ${OFFICE}.`)
  const subject = 'A reminder: your Step 2 tasks in Viventium'
  const html = `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#16283a;max-width:600px">
<p>Hi ${esc(first)}, a reminder from Caring Companions: your Step 2 tasks are waiting in Viventium (check your email for their message).</p>
<p>Need help? Our short video shows every step: <a href="https://mo-care.com/viventium-setup" style="color:#14606F;font-weight:700">mo-care.com/viventium-setup</a></p>
<p>When they are all done, tap here or reply DONE to our text:</p>
<p><a href="${esc(doneLink)}" style="display:inline-block;background:#F0A63A;color:#122F52;font-weight:800;padding:12px 20px;border-radius:10px;text-decoration:none">I finished Step 2</a></p>
<p>Stuck? Call or text ${OFFICE}.</p><p>Caring Companions</p></div>`
  return { text, subject, html }
}
/* Moment 8: the receipt for DONE (text only; it never says verified) */
export const receiptText = (first: string) => withStop(`Thank you, ${first}! We will check your Viventium tasks and text you the link to book your Orientation Video Call, usually within one business day.`)
/* Office-sent, with a preview, when verification finds a task open */
export const stillOpenText = (first: string, task: string, doneLink: string) => withStop(`Hi ${first}, thank you for letting us know. Viventium still shows a task open on your Step 2: ${task}. Could you log back in and finish it, then tap DONE again here: ${doneLink} Call or text ${OFFICE} if you are stuck.`)

/** A text reply that reports Step 2 done: DONE, done, Done, finished (a word on its own, at the start). */
export const isDoneReply = (t: unknown) => /^\s*(done|finished|i\s*finished|i'm\s*done|all\s*done)\b/i.test(String(t ?? ''))

/** The Admin checklist item that confirms which readiness-card row (by its wording). I-9 Section 2 is its own line, never here. */
export function rowFor(itemText: unknown): string | null {
  const t = String(itemText ?? '').toLowerCase()
  if (!t) return null
  if (/section\s*2/.test(t)) return null
  if (/i-?9/.test(t)) return 'cg.step2.i9_s1'
  if (/missouri|\bmo\b|state w/.test(t) && /w-?4|withholding/.test(t)) return 'cg.step2.mo_w4'
  if (/w-?4|federal withholding/.test(t)) return 'cg.step2.w4'
  if (/direct deposit|bank/.test(t)) return 'cg.step2.direct_deposit'
  if (/handbook/.test(t)) return 'cg.step2.handbook'
  if (/participant rights|client rights|rights/.test(t)) return 'cg.step2.participant_rights'
  if (/ethics/.test(t)) return 'cg.step2.code_of_ethics'
  if (/confidential|hipaa|privacy/.test(t)) return 'cg.step2.confidentiality'
  if (/social security|ss card|ssn card/.test(t)) return 'cg.step2.ss_card_upload'
  if (/license|driver|photo id|\bid\b|identification/.test(t)) return 'cg.step2.license_upload'
  return null
}
export type Step2State = 'not_sent' | 'sent' | 'reported' | 'verified'
export function stateOf(c: any): Step2State {
  if (c?.step2_verified_at) return 'verified'
  if (c?.step2_done_at) return 'reported'
  if (c?.step2_sent_at) return 'sent'
  return 'not_sent'
}
/** Which reminder day is due today (days after Sent, Chicago dates), not yet recorded: 0 = none.
 *  GO-LIVE (2026-10-13, hold rather than drop): the LATEST due day wins, so a reminder held over a Sunday or a night never
 *  sends two in a row; the caller records the earlier unrecorded day as passed over. */
export function reminderDue(c: any, days: number[], todayYmd: string, ymdOf: (iso: string) => string): number {
  if (!c?.step2_sent_at || c.step2_done_at || c.step2_verified_at) return 0
  const sent = ymdOf(String(c.step2_sent_at))
  const elapsed = Math.floor((Date.parse(todayYmd + 'T00:00:00Z') - Date.parse(sent + 'T00:00:00Z')) / 86400000)
  const have = (c.step2_reminders && typeof c.step2_reminders === 'object') ? c.step2_reminders : {}
  const due = days.filter((d) => elapsed >= d)
  const last = due.length ? due[due.length - 1] : 0
  return last && !have['d' + last] ? last : 0
}
/** Monday to Saturday, 9am up to 6pm Central: the reminder window (her ruling of October 8, the same as the Training
 *  Platform's job-offer reminders). Outside it a due reminder is HELD for the next pass inside it, never dropped. */
export function inReminderWindow(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(now)
  const wd = parts.find((p) => p.type === 'weekday')?.value || '', h = Number(parts.find((p) => p.type === 'hour')?.value)
  return wd !== 'Sun' && h >= 9 && h < 18
}
/** A send that reached nobody: is that final (they said no to texts, opted out, nothing on file) or worth another try
 *  (texting not set up, GoHighLevel did not accept it, the application could not be checked)? */
export function refusedForGood(notSent: string[]): boolean {
  if (!notSent.length) return false
  return notSent.every((w) => /did not agree to texts|opted out|no usable phone|no phone number or email/.test(String(w)))
}
export const REMINDER_TRIES = 3
