// =============================================================================
// ok-from-probe · the 808 proof text (plan approved 2026-10-16, decision 5: "one Desktop step sends a single text from
// (405) 500-1758 to your own cell, after you type yes").
//
// ONE-TIME TEST. Deployed by Desktop 808b, called once, then deleted again by the same step.
//   * Only the owner's installer can call it (the project's own server key).
//   * Sends ONE text to the one number in the request (Samantha typed it), from ops_settings.ok_from_number, through the
//     same checked send the Hub uses. Nothing else is sent; nothing in the Hub is written.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ghlStaffContact } from '../_shared/staff-contact.ts'
import { ghlSendChecked } from '../_shared/send-problems.ts'
import { fromFor, readOps, e164, smsBody } from '../_shared/office-from.ts'

export function roleOf(authHeader: string | null): string | null {
  const m = /^Bearer\s+(.+)$/.exec(authHeader ?? '')
  const parts = m ? m[1].split('.') : []
  if (parts.length !== 3) return null
  try { const p = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))); return typeof p.role === 'string' ? p.role : null } catch { return null }
}
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } })
export const PROBE_TEXT = (phone: string) =>
  `Caring Companions test: this text should come from ${phone}, the Oklahoma number. If it does, Oklahoma applicant texts are ready. No reply needed.`

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  if (roleOf(req.headers.get('Authorization')) !== 'service_role') return json({ error: 'owner script only' }, 403)
  // deno-lint-ignore no-explicit-any
  const b: any = await req.json().catch(() => ({}))
  const to = e164(b.to)
  if (!to) return json({ error: 'which cell number?' }, 400)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const ghl = { token: Deno.env.get('GHL_TOKEN') ?? Deno.env.get('GHL_API_KEY') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
  if (!ghl.token || !ghl.locationId) return json({ error: 'texting is not set up on the server' }, 500)
  const from = fromFor('OK', await readOps(db))
  if (from.refuse) return json({ error: from.refuse }, 409)
  const contactId = await ghlStaffContact(ghl, { channel: 'sms', phone: to, firstName: 'Samantha' })
  if (!contactId) return json({ error: 'GoHighLevel did not return a contact for that number' }, 502)
  const H = { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' }
  const sent = await ghlSendChecked(db, H, 'ok-from-probe', { channel: 'sms', contactId: String(contactId), address: to, who: 'Samantha (808 proof)' },
    smsBody(from, { message: PROBE_TEXT(from.phone) }))
  return json({ ok: sent, from: from.fromNumber, sent })
})
