// Supabase Edge Function: outreach-check (shared hub project) · 2026-09-27
// -----------------------------------------------------------------------------
// The Hub's "who is sending, and may this person be messaged?" door for senders that live in OTHER projects (the
// Training Platform's lead texts/emails, GoHighLevel replies and job offers). Those used to trust one shared staff key;
// now the caller's own Hub sign-in is forwarded here and checked like every Hub action, and each message goes through
// the same universal opt-out check the Hub's own senders use (GHL Do Not Disturb, the Hub's opt-out record, inquiry
// do-not-contact, Family Circle stops).
//
//   POST  Authorization: Bearer <the staff member's Hub session>
//     { auth_check: true }                                   -> { ok, authorized, email, name, roles }
//     { sender, channel: 'sms'|'email', phone? | email?, first_name?, last_name? }  -> { allowed, contact_id? }
//     { sender, channel, contact_id }                       -> { allowed, contact_id? }   (a GHL contact saved earlier)
// A refusal is logged in the Hub's refusal log with the sender and the verified staff member. Nothing is sent here.
//
// SERVER DOOR (2026-09-27, for senders with no staff behind them: a caregiver's own link, a scheduled job, a
// HomeTogether Hire customer): header x-outreach-secret = OUTREACH_SECRET (the same server-only value in the Hub,
// Training and HomeTogether Hire projects, never in code or pages), body { sender, channel, phone? | email?,
// via_ghl?: false } -> { allowed }. via_ghl:false (email sent by Resend) checks every authority except GoHighLevel.
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { ghlContactIfAllowed, ghlStoredContactIfAllowed, mayContact } from '../_shared/optout.ts'
import { serverSecretOk } from '../_shared/staff-auth.ts'


const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  if (req.headers.get('x-outreach-secret') !== null) {
    if (!serverSecretOk(req, 'OUTREACH_SECRET', 'x-outreach-secret')) return json({ error: 'unauthorized' }, 401)
    // deno-lint-ignore no-explicit-any
    const s: Record<string, any> = await req.json().catch(() => ({}))
    const ch = s.channel === 'email' ? 'email' : s.channel === 'sms' ? 'sms' : null
    if (!ch) return json({ error: 'channel must be sms or email' }, 400)
    const sender = String(s.sender || 'other-project').slice(0, 80)
    if (s.via_ghl === false) return json({ allowed: await mayContact(db, sender, { channel: ch, phone: s.phone, email: s.email, viaGhl: false }) })
    const ghl = { token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
    const id = await ghlContactIfAllowed(db, ghl, sender, { channel: ch, phone: s.phone, email: s.email, firstName: s.first_name })
    return json({ allowed: !!id })
  }
  const who = await requireStaff(db, req, OFFICE_ROLES)
  if (!who.ok) return json({ error: who.error }, who.status)
  // deno-lint-ignore no-explicit-any
  const b: Record<string, any> = await req.json().catch(() => ({}))
  if (b.auth_check === true) return json({ ok: true, authorized: true, email: who.email, name: who.name, roles: who.roles })

  const channel = b.channel === 'email' ? 'email' : b.channel === 'sms' ? 'sms' : null
  if (!channel) return json({ error: 'channel must be sms or email' }, 400)
  const sender = `${String(b.sender || 'other-project').slice(0, 60)} (by ${who.email})`
  const ghl = { token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
  if (!ghl.token || !ghl.locationId) return json({ allowed: false, error: 'GHL not configured' }, 500)
  const id = b.contact_id
    ? await ghlStoredContactIfAllowed(db, ghl, sender, { channel, contactId: b.contact_id })
    : await ghlContactIfAllowed(db, ghl, sender, { channel, phone: b.phone, email: b.email, firstName: b.first_name, lastName: b.last_name })
  return json(id ? { allowed: true, contact_id: id } : { allowed: false })
})
