// =============================================================================
// journey-link-plan — a signed-in staff member links a Team Builder plan to its Journey
// =============================================================================
// The hub cannot write Journey data directly (browser = read-only). This is the
// gated path:
//   * The platform gateway verifies the caller's token (verify_jwt on); this
//     handler requires role 'authenticated' (a signed-in person), never anon.
//   * The person's email on that token must hold a Journey seat in
//     journey_seat_member (routing configuration kept by the owner).
//   * A first link uses Client Intake; changing a plan's Journey needs the
//     Owner / Decision seat. The Door records the person's email as the actor.
//   * Writes only through team_build_link_set(); returns its outcome unchanged.
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

// first link: Client Intake (or Owner / Decision if that is all they hold);
// re-link: Owner / Decision only
export function chooseSeat(seats: string[], hasCurrentLink: boolean): string | null {
  if (hasCurrentLink) return seats.includes('owner_decision') ? 'owner_decision' : (seats.includes('client_intake') ? 'client_intake' : null)
  if (seats.includes('client_intake')) return 'client_intake'
  if (seats.includes('owner_decision')) return 'owner_decision'
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const { role, email } = jwtClaims(req.headers.get('Authorization'))
  if (role !== 'authenticated' || !email) return json({ error: 'sign in to the hub first' }, 401)

  const body = await req.json().catch(() => ({})) as { plan_id?: string; episode_id?: string }
  const planId = String(body.plan_id ?? '').trim()
  const episodeId = String(body.episode_id ?? '').trim()
  if (!planId || !/^[0-9a-f-]{36}$/i.test(episodeId)) return json({ error: 'plan_id and episode_id are required' }, 400)

  const { data: seatRows, error: seatErr } = await sb.from('journey_seat_member').select('seat').eq('email', email)
  if (seatErr) return json({ error: 'could not read seat membership' }, 500)
  const seats = (seatRows ?? []).map((r) => String(r.seat))
  if (!seats.length) return json({ outcome: 'no_seat', detail: 'your account does not hold a Journey seat; ask the owner to add you' }, 403)

  const { data: cur } = await sb.from('team_build_link_current').select('episode_id').eq('plan_id', planId).maybeSingle()
  const seat = chooseSeat(seats, !!cur && cur.episode_id !== episodeId)
  if (!seat) return json({ outcome: 'no_seat' }, 403)

  const { data, error } = await sb.rpc('team_build_link_set', {
    p_plan_id: planId, p_episode_id: episodeId, p_acting_staff: email, p_acting_seat: seat,
  })
  if (error) return json({ error: 'link failed: ' + error.message }, 500)
  return json(data)
})
