// =============================================================================
// call-place — office staff say who an unmatched call was with (K3, approved 2026-09-28)
// =============================================================================
// The call record never guesses: a call on a number nobody (or more than one person) has stays unmatched. Here a
// signed-in office staff member (requireStaff) places it: on an inquiry, on a client, or "not one of ours". Who placed
// it is their sign-in's email, never anything in the request. Writes only through call_record_place() (service_role),
// which checks the inquiry or client exists and that each call line is unmatched and not already placed.
//   { call_ids: number[], decision: 'lead' | 'client' | 'not_ours', lead_id?, person_id?, axiscare_client_id?, note? }
// Nothing here contacts anyone or writes to AxisCare.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const staff = await requireStaff(sb, req, OFFICE_ROLES)
  if (!staff.ok) return json({ error: staff.error }, staff.status)
  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  const ids = Array.isArray(b.call_ids) ? b.call_ids.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0) : []
  if (!ids.length || ids.length > 20) return json({ error: 'call_ids must list 1 to 20 call lines' }, 400)
  const decision = String(b.decision || '')
  if (!['lead', 'client', 'not_ours'].includes(decision)) return json({ error: "decision must be 'lead', 'client' or 'not_ours'" }, 400)
  const person = typeof b.person_id === 'string' && UUID.test(b.person_id) ? b.person_id : null
  const { data, error } = await sb.rpc('call_record_place', {
    p_ids: ids, p_decision: decision,
    p_lead: decision === 'lead' ? String(b.lead_id || '').slice(0, 100) : null,
    p_person: decision === 'client' ? person : null,
    p_axiscare_client: decision === 'client' ? String(b.axiscare_client_id || '') : null,
    p_by: staff.email, p_note: typeof b.note === 'string' ? b.note.slice(0, 300) : null,
  })
  if (error) return json({ error: 'Could not place the call: ' + error.message }, 500)
  return json(data, data?.outcome === 'placed' ? 200 : 400)
})
