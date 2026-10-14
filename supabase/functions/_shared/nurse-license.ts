// =============================================================================
// nurse-license.ts · NURSE LICENSE REMINDERS (LPN nurse visit plan, Samantha approved 2026-10-14; Desktop 707)
// =============================================================================
// Pure. From the Hub's nurse list (app_data nurse_staff: name, cred RN/LPN, license, expires, email): 30, 14 and 7 days
// before a Missouri nursing license on file expires, the nurse gets one text and one email and the office gets a card; on
// expiry the office gets a card. The same shape as the driver renewal reminders (driver.ts reminderDue): at most one stage
// per expiry (the latest reached), and a stage once stamped is never due again. The stamps live in their own app_data key
// (nurse_license_reminders), never on the nurse list, so a Hub save of the list can never wipe one and resend a reminder.
// On expiry nurse-rules.js readiness already marks the nurse not ready (no client can be given to them), so this only
// tells the office. Words: her voice, short, warm, no em dashes; the sender adds the STOP line to the text.
// deno-lint-ignore-file no-explicit-any
import { daysBetween, longDate } from './nurse-bill.ts'

export const STAGES: { k: 'd30' | 'd14' | 'd7'; days: number }[] = [{ k: 'd7', days: 7 }, { k: 'd14', days: 14 }, { k: 'd30', days: 30 }]
export type LicenseDue = { stage: 'd30' | 'd14' | 'd7' | 'expired'; expires: string; key: string; days_left: number }
const S = (v: unknown, n = 160) => String(v ?? '').trim().slice(0, n)
const ymd = (v: unknown) => { const x = S(v, 10); return /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : '' }

/** the stable key of a nurse on the list: their email, else their name */
export const nurseKey = (n: any) => (S(n?.email).toLowerCase() || S(n?.name, 80).toLowerCase()).replace(/[^a-z0-9@._-]+/g, '_')

/** which stage is due today for this nurse (or null): stamps is that nurse's map of `${expires}:${stage}` */
export function licenseDue(today: string, n: any, stamps: Record<string, unknown> = {}): LicenseDue | null {
  if (!n || n.active === false) return null
  const exp = ymd(n.expires); if (!exp) return null
  const left = daysBetween(today, exp)
  let stage: LicenseDue['stage'] | null = null
  if (left < 0) stage = 'expired'
  else for (const s of STAGES) if (left <= s.days) { stage = s.k; break }
  if (!stage) return null
  const key = `${exp}:${stage}`
  if (stamps[key]) return null
  return { stage, expires: exp, key, days_left: left }
}

const credWord = (n: any) => { const c = S(n?.cred, 4).toUpperCase(); return c === 'RN' || c === 'LPN' ? c + ' license' : 'nursing license' }
export const OFFICE_PHONE = '(417) 234-8494'

/** the nurse's text and email for a stage */
export function licenseMessage(first: string, n: any, due: { stage: string; expires: string; days_left: number }): { text: string; subject: string; html: string } {
  const lic = credWord(n), when = longDate(due.expires), hi = `Hi ${first || 'there'}`
  const lead = due.stage === 'd30' ? `${hi}, this is Caring Companions. Your Missouri ${lic} on file expires ${when}.`
    : due.stage === 'd14' ? `${hi}, a reminder from Caring Companions: your Missouri ${lic} on file expires ${when} and we do not have your renewal yet.`
    : `${hi}, Caring Companions here. Your Missouri ${lic} on file expires in ${due.days_left} day${due.days_left === 1 ? '' : 's'}, on ${when}.`
  const ask = 'When you renew, please let the office know your new expiration date so you can keep making nurse visits.'
  const after = due.stage === 'd7' ? `If it is not renewed by then, your nurse visits pause until it is. Questions: ${OFFICE_PHONE}.` : `Questions: ${OFFICE_PHONE}.`
  const subject = due.stage === 'd7' ? `Your ${lic} expires ${when}: please renew` : `Your ${lic} on file expires ${when}`
  const html = `<p>${lead}</p><p>${ask}</p><p>${after}</p><p>Thank you,<br>Caring Companions<br>${OFFICE_PHONE}</p>`
  return { text: `${lead} ${ask} ${after}`, subject, html }
}

/** the office's card for a stage (or the expiry) */
export function licenseCard(name: string, n: any, due: { stage: string; expires: string; days_left: number }, reached: string): { title: string; detail: string; urgency: 'urgent' | 'today' | 'normal' } {
  const lic = credWord(n), when = longDate(due.expires)
  if (due.stage === 'expired') return { urgency: 'urgent', title: `${name}'s ${lic} expired`,
    detail: `${name}'s Missouri ${lic} on file expired ${when}. The Hub's nurse rules already mark them not ready, so no client can be given to them. Take them off any nurse visit in AxisCare until the renewal is checked on Nursys QuickConfirm, then update the expiry on Nurse Scheduling and in AxisCare's Compliance tab.` }
  return { urgency: due.stage === 'd7' ? 'today' : 'normal', title: `${name}'s ${lic} expires in ${due.days_left} day${due.days_left === 1 ? '' : 's'}`,
    detail: `${name}'s Missouri ${lic} on file expires ${when}. ${reached} When they renew, check it on Nursys QuickConfirm and update the expiry on Nurse Scheduling and in AxisCare's Compliance tab.` }
}
