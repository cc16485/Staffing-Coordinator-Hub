// =============================================================================
// ghl-call-link · 431 "Call from office line" (Samantha 2026-10-03: "I want it to be like that across the hub for
// everything that is a click to call, it should call from leadconnector app, or just have it say call from office line")
// =============================================================================
// GHL has no API to start a call. So when office staff tap a call button in the Hub, the page asks this function for
// the person's EXISTING GoHighLevel contact and opens it in LeadConnector, where they tap Call on the business number.
//
// WHO: a signed-in Caring Companions office staff member (requireStaff). Anything else is refused before GHL is asked.
// IN   POST { phone, email?, axiscare_client_id? }
// OUT  { found: true, contact_id, app_url, web_url }  or  { found: false, why: no_number | not_found | several | error | not_set_up }
// READ ONLY: GET searches only (_shared/ghl-contact-link.ts). It never creates, updates or tags a contact and never
// sends anything. Exactly one matching contact, or none: software never picks between people on a shared line.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { ghlFindContact } from '../_shared/ghl-contact-link.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
               'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const staff = await requireStaff(sb, req, OFFICE_ROLES)
  if (!staff.ok) return json({ error: staff.error }, staff.status)
  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  const str = (v: unknown, n: number) => typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, n) : ''
  const ghl = { token: Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || '', locationId: Deno.env.get('GHL_LOCATION_ID') || '' }
  const f = await ghlFindContact(sb, ghl, { phone: str(b.phone, 40), email: str(b.email, 200), axiscareClientId: str(b.axiscare_client_id, 40) })
  return json(f)
})
