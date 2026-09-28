// =============================================================================
// client-fact — active office staff record a fact about a person (Gate 2a)
// =============================================================================
// The ONLY way into the fact record. The browser cannot write facts; this is the
// gated path:
//   * The platform gateway verifies the caller's token (verify_jwt on).
//   * requireStaff: an active Caring Companions staff member with an office role
//     (owner, care coordinator, staffing coordinator) and Care Coordinator Hub access.
//   * Writes only through client_fact_record(), which checks the kind, layer, value,
//     how sure, who said it, which fact it replaces (a stale save is refused), and
//     "after care began, the intake record can only be corrected". Its answer is
//     returned unchanged. The staff member's email is recorded; it is never taken
//     from the request body.
//   * Nothing here contacts anyone.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function textOrNull(v: unknown, max = 2000): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
}
export function uuidOrNull(v: unknown): string | null | undefined {
  if (v === null || v === undefined || v === '') return null
  return typeof v === 'string' && UUID.test(v) ? v : undefined          // undefined = invalid
}
export function instantOrNull(v: unknown): string | null | undefined {
  if (v === null || v === undefined || v === '') return null
  return typeof v === 'string' && !isNaN(Date.parse(v)) ? new Date(v).toISOString() : undefined
}

/** The request body as the door's arguments; the recorder always comes from the sign-in. */
export function doorArgs(b: Record<string, unknown>, staffEmail: string): { args?: Record<string, unknown>; error?: string } {
  const ep = uuidOrNull(b.episode_id), sup = uuidOrNull(b.supersedes_fact_id), at = instantOrNull(b.said_at)
  if (!ep) return { error: 'episode_id is required' }
  if (sup === undefined) return { error: 'supersedes_fact_id must be a fact id' }
  if (at === undefined) return { error: 'said_at must be a date and time' }
  const value = b.value === undefined ? null : b.value
  return { args: {
    p_episode_id: ep, p_kind: textOrNull(b.kind, 80), p_layer: textOrNull(b.layer, 20), p_value: value,
    p_certainty: textOrNull(b.certainty, 20), p_change_kind: textOrNull(b.change_kind, 20), p_supersedes_fact_id: sup,
    p_reason: textOrNull(b.reason), p_said_by: textOrNull(b.said_by, 200), p_said_by_relationship: textOrNull(b.said_by_relationship, 100),
    p_said_how: textOrNull(b.said_how, 40), p_said_at: at, p_words: textOrNull(b.words), p_source_ref: textOrNull(b.source_ref, 200),
    p_recorded_by: staffEmail,
  } }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const staff = await requireStaff(sb, req, OFFICE_ROLES)
  if (!staff.ok) return json({ error: staff.error }, staff.status)
  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  if (b.action !== 'record') return json({ error: "action must be 'record'" }, 400)
  const { args, error: bad } = doorArgs(b, staff.email)
  if (bad || !args) return json({ error: bad }, 400)
  const { data, error } = await sb.rpc('client_fact_record', args)
  if (error) return json({ error: 'not recorded: ' + error.message }, 500)
  return json(data)
})
