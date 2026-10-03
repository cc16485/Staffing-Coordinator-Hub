// C1 (2026-09-29) · who gets the missed clock-in texts, and how one is sent.
// "All admin" = the same list that gets call-in alerts (ops_settings.coverage_alert_admins, emails; default Samantha
// and Krystal, as coverage-run). Their phones and names come from app_data.coordinator_staff, as the call-in alert.
// Sent through the same staff door as every office alert (contactForOutbound, audience staff, urgent_internal: a
// shift happening right now, any hour).
// deno-lint-ignore-file no-explicit-any
import { normalisePhone, contactForOutbound } from './outreach.ts'
import { ghlSendChecked, reportSendProblem } from './send-problems.ts'

export const ADMIN_DEFAULT = ['samantha@mo-care.com', 'krystal@mo-care.com']
export type Admin = { email: string; name: string; first: string; phone: string | null }

export async function adminRecipients(sb: any, settings: any): Promise<Admin[]> {
  const emails: string[] = (Array.isArray(settings?.coverage_alert_admins) && settings.coverage_alert_admins.length
    ? settings.coverage_alert_admins : ADMIN_DEFAULT).map((e: unknown) => String(e).trim().toLowerCase()).filter(Boolean)
  const { data } = await sb.from('app_data').select('data').eq('key', 'coordinator_staff').maybeSingle()
  const staff: any[] = Array.isArray(data?.data) ? data.data : []
  return [...new Set(emails)].map((email) => {
    const p = staff.find((s: any) => String(s?.email || '').trim().toLowerCase() === email)
    const name = String(p?.name || email.split('@')[0])
    return { email, name, first: name.split(/\s+/)[0], phone: normalisePhone(p?.phone) || null }
  })
}

export async function textAdmin(sb: any, ghl: { token: string; locationId: string }, a: Admin, message: string,
                                 send: typeof fetch = fetch, opts: { emergency?: boolean } = {}): Promise<boolean> {
  /* NO SILENT FAILURES (2026-10-01): an admin text that cannot go (no phone on file, GoHighLevel not set up, or
     GoHighLevel refused it) raises a card on Needs Attention as well as returning false */
  if (!a.phone || !ghl.token || !ghl.locationId) {
    await reportSendProblem(sb, { sender: 'staff-alert', channel: 'sms', address: a.phone ?? '', who: a.name,
      reasons: [!a.phone ? 'no usable phone number for this admin in Coordinator staff' : 'GoHighLevel is not set up (no token or location)'], failed: !!a.phone })
    return false
  }
  try {
    const contact = await contactForOutbound(sb, ghl, { phone: a.phone, email: a.email, firstName: a.first },
      'urgent_internal', { selfSupplied: true, audience: 'staff',
      /* AFTER HOURS (Desktop 426): the missed clock-in texts her switch allows at night (quiet-hours.ts) */
      ...(opts.emergency ? { emergency: true } : {}) })
    if (!contact) return false
    return await ghlSendChecked(sb, { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
      'staff-alert', { channel: 'sms', contactId: contact.contactId, address: a.phone, who: a.name }, { message }, send)
  } catch (e) {
    await reportSendProblem(sb, { sender: 'staff-alert', channel: 'sms', address: a.phone, who: a.name,
      reasons: ['could not send: ' + String((e as Error)?.message ?? e).slice(0, 80)], failed: true })
    return false
  }
}

/** "9am", "9:30am" (her 12-hour rule, same as every Cara text). */
export const clock12 = (t: string): string => {
  const m = String(t || '').trim().match(/^(\d{1,2}):(\d\d)/)
  if (!m) return String(t || '').trim()
  const h24 = Number(m[1]); const h = h24 % 12 || 12
  return `${h}${m[2] === '00' ? '' : ':' + m[2]}${h24 >= 12 ? 'pm' : 'am'}`
}
