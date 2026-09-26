// =============================================================================
// start-contract — a signed-in seat holder records a Start Contract or a family update
// =============================================================================
// The hub cannot write Journey data directly (browser = read-only). This is the
// gated path:
//   * The platform gateway verifies the caller's token (verify_jwt on); this
//     handler requires role 'authenticated' (a signed-in person), never anon.
//   * The person's email on that token must hold a Journey seat in
//     journey_seat_member (routing configuration kept by the owner).
//   * Writes only through start_contract_record() / start_contract_update_record(),
//     which record the person's email and seat, and return their outcome unchanged.
//   * Nothing here contacts a family. Recording that we told them something is not
//     telling them.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const sb = createClient(SUPABASE_URL, SERVICE_KEY)

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

// the gateway has already verified the signature; read the claims
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

// Client Intake is the routine seat for promises; Owner / Decision may also record
export function chooseSeat(seats: string[]): string | null {
  if (seats.includes('client_intake')) return 'client_intake'
  if (seats.includes('owner_decision')) return 'owner_decision'
  return null
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
export function dateOrNull(v: unknown): string | null | undefined {
  if (v === null || v === undefined || v === '') return null
  return typeof v === 'string' && DATE.test(v) ? v : undefined     // undefined = invalid
}
export function textOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 2000) : null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const { role, email } = jwtClaims(req.headers.get('Authorization'))
  if (role !== 'authenticated' || !email) return json({ error: 'sign in to the hub first' }, 401)

  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  const episodeId = String(b.episode_id ?? '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(episodeId)) return json({ error: 'episode_id is required' }, 400)

  const { data: seatRows, error: seatErr } = await sb.from('journey_seat_member').select('seat').eq('email', email)
  if (seatErr) return json({ error: 'could not read seat membership' }, 500)
  const seat = chooseSeat((seatRows ?? []).map((r) => String(r.seat)))
  if (!seat) return json({ outcome: 'no_seat', detail: 'your account does not hold a Journey seat; ask the owner to add you' }, 403)

  if (b.action === 'contract') {
    const target = dateOrNull(b.target_date), on = dateOrNull(b.promised_on), next = dateOrNull(b.next_update_owed_on)
    if (target === undefined || on === undefined || next === undefined) return json({ error: 'dates must be YYYY-MM-DD' }, 400)
    const { data, error } = await sb.rpc('start_contract_record', {
      p_episode_id: episodeId, p_confidence: textOrNull(b.confidence), p_target_date: target,
      p_promised_wording: textOrNull(b.promised_wording), p_promised_to: textOrNull(b.promised_to),
      p_promised_via: textOrNull(b.promised_via), p_promised_on: on, p_commitment_owner: textOrNull(b.commitment_owner),
      p_next_update_owed_on: next, p_change_reason: textOrNull(b.change_reason),
      p_acting_staff: email, p_acting_seat: seat,
    })
    if (error) return json({ error: 'not recorded: ' + error.message }, 500)
    return json(data)
  }
  if (b.action === 'update') {
    const next = dateOrNull(b.next_update_owed_on)
    const givenAt = typeof b.given_at === 'string' && !isNaN(Date.parse(b.given_at)) ? new Date(b.given_at).toISOString() : null
    if (next === undefined) return json({ error: 'dates must be YYYY-MM-DD' }, 400)
    const { data, error } = await sb.rpc('start_contract_update_record', {
      p_episode_id: episodeId, p_given_at: givenAt, p_given_to: textOrNull(b.given_to), p_given_via: textOrNull(b.given_via),
      p_summary: textOrNull(b.summary), p_next_update_owed_on: next, p_none_owed_reason: textOrNull(b.none_owed_reason),
      p_acting_staff: email, p_acting_seat: seat,
    })
    if (error) return json({ error: 'not recorded: ' + error.message }, 500)
    return json(data)
  }
  return json({ error: "action must be 'contract' or 'update'" }, 400)
})
