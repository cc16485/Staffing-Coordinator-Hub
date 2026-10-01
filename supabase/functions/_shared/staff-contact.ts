/**
 * ONE CONTACT FOR OFFICE STAFF TOO (2026-10-01, Samantha: "change the office alerts to the one contact rule").
 * Office alerts used to look a staff member up with their phone AND email in one GoHighLevel upsert. When the phone
 * and the email sat on two different contacts, GHL matched the phone contact, which had no email, and the alert email
 * failed ("Contact has no email"). This finds the contact for ONE channel the same way customer messages do
 * (optout.ts joinExisting): the contact that already has this address; else the person's other-address contact
 * when its field for this channel is empty and the first name doesn't contradict (the address is added to it);
 * else a contact found/created by this address alone. Staff alerts skip the opt-out check, as before.
 * Returns the contact id, or '' (never throws).
 */
import { joinExisting, normPhone, normEmail } from './optout.ts'
type Channel = 'sms' | 'email'
const GHL = 'https://services.leadconnectorhq.com'

export async function ghlStaffContact(
  ghl: { token: string; locationId: string },
  who: { channel: Channel; phone?: unknown; email?: unknown; firstName?: unknown; lastName?: unknown },
  send: typeof fetch = fetch,
): Promise<string> {
  try {
    const phone = who.channel === 'sms' ? normPhone(who.phone) : null
    const email = who.channel === 'email' ? normEmail(who.email) : null
    if (!phone && !email) return ''
    const h = { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' }
    try {   // the contact that already has this exact address wins
      const q = phone ? `number=${encodeURIComponent(phone)}` : `email=${encodeURIComponent(email!)}`
      const r0 = await send(`${GHL}/contacts/search/duplicate?locationId=${encodeURIComponent(ghl.locationId)}&${q}`, { method: 'GET', headers: h })
      const own = r0.ok ? (await r0.json().catch(() => ({})))?.contact?.id : ''
      if (own) return String(own)
    } catch { /* fall through */ }
    try {
      const joined = await joinExisting(send, h, ghl.locationId, who, phone, email)
      if (joined) return joined
    } catch { /* the one-channel path below */ }
    const r = await send(`${GHL}/contacts/upsert`, { method: 'POST', headers: h, body: JSON.stringify({ locationId: ghl.locationId,
      ...(phone ? { phone } : { email }), ...(who.firstName ? { firstName: String(who.firstName) } : {}), ...(who.lastName ? { lastName: String(who.lastName) } : {}) }) })
    const j = await r.json().catch(() => ({}))
    return String(j?.contact?.id ?? j?.id ?? '')
  } catch { return '' }
}
