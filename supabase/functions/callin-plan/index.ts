// =============================================================================
// callin-plan — record a client's "When a caregiver calls in" plan (2026-09-27)
// =============================================================================
// Any signed-in staff member (her rule). Who entered it comes from their sign-in, never
// from the form; their display name from coordinator_staff. Everything else is checked by
// the database door client_callin_add, and every entry is kept (the table is append-only).
// Reading needs no function: signed-in staff read client_callin_current / _entries directly.
//
//   POST {action:'add', request_id, axiscare_client_id, client_name, coverage_need,
//         only_ask:[{axiscare_id,name}], backup_name, backup_phone, backup_relationship,
//         note, source_who, source_how}
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
const FIELDS = ['request_id', 'axiscare_client_id', 'client_name', 'coverage_need', 'only_ask', 'backup_name',
  'backup_phone', 'backup_relationship', 'note', 'source_who', 'source_how']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const { role, email } = jwtClaims(req.headers.get('Authorization'))
  if (role !== 'authenticated' || !email) return json({ error: 'sign in to the hub first' }, 401)
  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  if (b.action !== 'add') return json({ error: "action must be 'add'" }, 400)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  let staffName = ''
  try {
    const { data } = await sb.from('app_data').select('data').eq('key', 'coordinator_staff').maybeSingle()
    // deno-lint-ignore no-explicit-any
    const hit = (Array.isArray(data?.data) ? data!.data : []).find((s: any) => String(s?.email ?? '').trim().toLowerCase() === email)
    staffName = String(hit?.name ?? '').trim()
  } catch { /* the email alone still says who */ }
  const entry: Record<string, unknown> = {}
  for (const k of FIELDS) if (b[k] !== undefined) entry[k] = b[k]
  const { data, error } = await sb.rpc('client_callin_add', { p: entry, p_staff: email, p_staff_name: staffName || email.split('@')[0] })
  return error ? json({ error: 'not recorded: ' + error.message }, 500) : json(data)
})
