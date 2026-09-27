// =============================================================================
// client-lookup · "Is this family already known?" (One client profile, 5b B + D, 2026-09-27)
// =============================================================================
// Read only. Signed-in staff. Checks AxisCare live (current AND inactive clients) and the Family
// Circle contacts, so a returning family is recognised without copying AxisCare's clients into the
// hub (AxisCare owns client identity). Returns names, AxisCare numbers, status and WHY it matched;
// never a phone number or a birth date. A person decides; nothing is linked or written here.
//
//   POST {action:'find', phones:[caller, client], first, last, dob}
//   → {ok, matches:[{axiscare_client_id, name, active, status, why[], family[]}], axiscare_ok, axiscare_error?}
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { find } from '../_shared/client-lookup.ts'
export { axClients, find } from '../_shared/client-lookup.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

export function jwtClaims(authHeader: string | null): { role: string | null; email: string | null } {
  const m = /^Bearer\s+(.+)$/.exec(authHeader ?? '')
  if (!m) return { role: null, email: null }
  const parts = m[1].split('.')
  if (parts.length !== 3) return { role: null, email: null }
  try {
    const p = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    return { role: typeof p.role === 'string' ? p.role : null,
             email: typeof p.email === 'string' ? p.email.trim().toLowerCase() : null }
  } catch { return { role: null, email: null } }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const { role, email } = jwtClaims(req.headers.get('Authorization'))
  if (role !== 'authenticated' || !email) return json({ error: 'sign in to the hub first' }, 401)
  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  if (b.action !== 'find') return json({ error: "action must be 'find'" }, 400)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  return json(await find(b, sb))
})
