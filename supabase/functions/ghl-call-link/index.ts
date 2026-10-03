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
// 433 (2026-10-03, her option 1) · "Call rings your phone first":
//   POST { action: 'bridge', phone, email?, axiscare_client_id? }  (a signed-in office staff member's TAP only)
//     the contact is assigned to the person who tapped and tagged hub-call-bridge; her GoHighLevel workflow "Hub call
//     bridge" rings that person's phone and connects them from the business number (_shared/ghl-call-bridge.ts).
//     OUT { ok: true, ringing: 'you', contact_id, name, app_url, web_url }  or  { ok: false, why, message?, wait_sec? }
//   POST { action: 'setup' }  Settings, Calls: is the workflow published, can GoHighLevel list its users, who is linked.
//     GET only. A signed-in office staff member sees names; the server key (the installer's proof) sees counts only.
//   The server key can NEVER bridge: a call only ever starts from a person's tap.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { ownerCaller } from '../_shared/job-auth.ts'
import { ghlFindContact } from '../_shared/ghl-contact-link.ts'
import { ghlCallBridge, bridgeSetup } from '../_shared/ghl-call-bridge.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
               'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const b = await req.clone().json().catch(() => ({})) as Record<string, unknown>
  const action = String(b.action || 'find')
  const ghl = { token: Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || '', locationId: Deno.env.get('GHL_LOCATION_ID') || '' }
  const settingsNow = async () => (await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()).data?.data ?? {}
  // deno-lint-ignore no-explicit-any
  const staffList = async (): Promise<{ email: string; name: string }[]> => { const { data } = await sb.from('app_data').select('data').eq('key', 'coordinator_staff').maybeSingle()
    // deno-lint-ignore no-explicit-any
    return (Array.isArray(data?.data) ? data!.data : []).map((s: any) => ({ email: String(s?.email || ''), name: String(s?.name || '') })).filter((s: { email: string }) => s.email) }

  /* the installer's proof: the server key may ask 'setup' (GET only, counts only), nothing else. Recognised the way the
     scheduled jobs recognise it (job-auth's ownerCaller): the key the Management API hands out is written differently
     from this function's own copy, so a letter-for-letter compare refused it (433's proof, 2026-10-03; same as #117).
     A staff sign-in is never taken for it (the probe table is the server's only). */
  if (await ownerCaller(req)) {
    if (action !== 'setup') return json({ error: 'A call only starts from a person tapping Call in the Hub.' }, 403)
    const s = await bridgeSetup(sb, ghl, await settingsNow(), await staffList())
    // deno-lint-ignore no-explicit-any
    const { staff: _names, ...counts } = s as any
    return json(counts)
  }

  const staff = await requireStaff(sb, req, OFFICE_ROLES)
  if (!staff.ok) return json({ error: staff.error }, staff.status)
  const str = (v: unknown, n: number) => typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, n) : ''
  const who = { phone: str(b.phone, 40), email: str(b.email, 200), axiscareClientId: str(b.axiscare_client_id, 40) }
  if (action === 'setup') return json({ ...(await bridgeSetup(sb, ghl, await settingsNow(), await staffList())), me: staff.email })
  if (action === 'bridge')
    return json(await ghlCallBridge(sb, ghl, await settingsNow(), { email: staff.email, name: staff.name || staff.email, via: 'hub' }, { ...who, label: str(b.label, 60) }))
  if (action !== 'find') return json({ error: 'unknown action' }, 400)
  const f = await ghlFindContact(sb, ghl, who)
  return json(f)
})
