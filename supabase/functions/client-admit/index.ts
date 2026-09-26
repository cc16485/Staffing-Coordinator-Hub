// =============================================================================
// client-admit — "Who is this?" for a new AxisCare client with NO inquiry (Step 3)
// =============================================================================
// Used from the New Clients card by a signed-in Journey seat holder:
//   prepare  looks the client up in AxisCare (read only) and makes sure there is an
//            admission case for it (client_admission_open is idempotent; phone matches
//            become SUGGESTIONS, never a decision). Returns the case, its suggestions
//            and the unconnected inquiries it might have come from.
//   admit    the person's decision: an existing person or a new one, plus why there
//            was no inquiry. One transaction through client_admission_admit(): the
//            person's active Journey is kept, or an honest new one is opened.
//   dismiss  not a real new client (a test record, a duplicate); needs a reason.
// A client who came from an inquiry is NOT admitted here: the hub sends the
// coordinator to connect that inquiry (journey-connect), which closes this case.
// The gateway verifies the token (verify_jwt on); this handler requires role
// 'authenticated' and a Journey seat. Nothing here contacts anyone.
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
// an escalated case is Owner / Decision's call; otherwise Client Intake is the routine seat
export function chooseSeat(seats: string[], escalated: boolean): string | null {
  if (escalated) return seats.includes('owner_decision') ? 'owner_decision' : (seats.includes('client_intake') ? 'client_intake' : null)
  if (seats.includes('client_intake')) return 'client_intake'
  if (seats.includes('owner_decision')) return 'owner_decision'
  return null
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function uuidOrNull(v: unknown): string | null | undefined {
  if (v === null || v === undefined || v === '') return null
  return typeof v === 'string' && UUID.test(v) ? v : undefined      // undefined = invalid
}
export function textOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 500) : null
}
export function cleanId(v: unknown): string | null {
  const s = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : ''
  return /^[0-9]{1,12}$/.test(s) ? s : null
}
function axisCreds() {
  let token = ''
  for (const n of ['AXISCARE_API_KEY', 'AXISCARE_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const { role, email } = jwtClaims(req.headers.get('Authorization'))
  if (role !== 'authenticated' || !email) return json({ error: 'sign in to the hub first' }, 401)
  const b = await req.json().catch(() => ({})) as Record<string, unknown>

  const { data: seatRows, error: seatErr } = await sb.from('journey_seat_member').select('seat').eq('email', email)
  if (seatErr) return json({ error: 'could not read seat membership' }, 500)
  const seats = (seatRows ?? []).map((r) => String(r.seat))
  if (!seats.length) return json({ outcome: 'no_seat', detail: 'your account does not hold a Journey seat; ask the owner to add you' }, 403)

  if (b.action === 'prepare') {
    const ax = cleanId(b.axiscare_client_id)
    if (!ax) return json({ error: 'a numeric axiscare_client_id is required' }, 400)
    let name: string | null = null, phones: string[] = [], axisError: string | null = null
    const { token, site } = axisCreds()
    if (token && /^\d+$/.test(site)) {
      try {
        const r = await fetch(`https://${site}.axiscare.com/api/clients?clientIds=${ax}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': '2023-10-01' } })
        if (r.ok) {
          const body = await r.json().catch(() => ({}))
          // deno-lint-ignore no-explicit-any
          const c = ((body as any)?.results?.clients ?? []).find((x: any) => String(x?.id) === ax)
          if (c) {
            name = [c.firstName, c.lastName].map((x: unknown) => String(x ?? '').trim()).filter(Boolean).join(' ') || null
            phones = [c.mobilePhone, c.homePhone, c.otherPhone].map((x: unknown) => String(x ?? '').trim()).filter(Boolean)
          } else axisError = 'AxisCare has no client with that id'
        } else axisError = 'AxisCare answered ' + r.status
      } catch (e) { axisError = 'AxisCare could not be reached: ' + String((e as Error).message ?? e) }
    } else axisError = 'AxisCare credentials not set'
    if (!name) name = textOrNull(b.client_name)
    const { data: opened, error: openErr } = await sb.rpc('client_admission_open', {
      p_axiscare_client_id: ax, p_observed_label: 'New Clients', p_observed_at: new Date().toISOString(),
      p_axiscare_name: name, p_axiscare_phones: phones, p_opened_by: 'new-clients:' + email,
    })
    if (openErr) return json({ error: 'could not open the admission case: ' + openErr.message }, 500)
    if (opened?.outcome === 'already_linked') return json({ outcome: 'already_linked', axiscare_error: axisError })
    const { data: kase } = await sb.from('client_admission_case')
      .select('case_id, axiscare_name, suggestions, needs_owner_decision, escalation_reason').eq('axiscare_client_id', ax).eq('status', 'open').maybeSingle()
    if (!kase) return json({ outcome: 'no_open_case', axiscare_error: axisError })
    const { data: opts } = await sb.from('client_admission_lead_options')
      .select('episode_id, lead_id, label, detail, match').eq('case_id', kase.case_id)
    return json({ outcome: 'ready', case: kase, phones, axiscare_error: axisError, lead_options: opts ?? [] })
  }

  const caseId = uuidOrNull(b.case_id)
  if (!caseId) return json({ error: 'case_id is required' }, 400)
  const { data: kase } = await sb.from('client_admission_case').select('needs_owner_decision').eq('case_id', caseId).maybeSingle()
  if (!kase) return json({ outcome: 'not_found' }, 404)
  const seat = chooseSeat(seats, !!kase.needs_owner_decision)
  if (!seat) return json({ outcome: 'no_seat' }, 403)

  if (b.action === 'admit') {
    const person = uuidOrNull(b.person_id)
    if (person === undefined) return json({ error: 'person_id must be an id' }, 400)
    const { data, error } = await sb.rpc('client_admission_admit', {
      p_case_id: caseId, p_decision: textOrNull(b.decision), p_person_id: person, p_display_name: textOrNull(b.display_name),
      p_no_lead_reason: textOrNull(b.no_lead_reason), p_acting_staff: email, p_acting_seat: seat, p_note: textOrNull(b.note),
    })
    if (error) return json({ error: 'not admitted: ' + error.message }, 500)
    return json(data)
  }
  if (b.action === 'dismiss') {
    const { data, error } = await sb.rpc('client_admission_dismiss', {
      p_case_id: caseId, p_reason: textOrNull(b.reason), p_acting_staff: email, p_acting_seat: seat,
    })
    if (error) return json({ error: 'not dismissed: ' + error.message }, 500)
    return json(data)
  }
  return json({ error: "action must be 'prepare', 'admit' or 'dismiss'" }, 400)
})
