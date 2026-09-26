// =============================================================================
// journey-connect — confirm which AxisCare client a lead is (Step 2)
// =============================================================================
// Two actions, both for signed-in staff (the gateway verifies the token;
// this handler requires role 'authenticated', never anon):
//   preview  what AxisCare says about that client id, and what our records say
//            (already linked to a person? an active Journey? an admission case?),
//            so the hub can show the lead and the AxisCare client side by side
//            BEFORE anything is saved. Read only.
//   connect  the person's deliberate confirmation. Needs a Journey seat. Writes
//            only through lead_journey_connect(), which records who, which seat
//            and how, in one transaction, or saves nothing and says why.
// A name match made by software is never a confirmation; there is no action for it.
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
// an escalated admission case is Owner / Decision's call; otherwise Client Intake is the routine seat
export function chooseSeat(seats: string[], escalated: boolean): string | null {
  if (escalated) return seats.includes('owner_decision') ? 'owner_decision' : (seats.includes('client_intake') ? 'client_intake' : null)
  if (seats.includes('client_intake')) return 'client_intake'
  if (seats.includes('owner_decision')) return 'owner_decision'
  return null
}
export function cleanId(v: unknown): string | null {
  const s = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : ''
  return /^[0-9]{1,12}$/.test(s) ? s : null
}
export function cleanLead(v: unknown): string | null {
  const s = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : ''
  return s && s.length <= 80 ? s : null
}
// deno-lint-ignore no-explicit-any
export function axisSummary(c: any): { name: string; phones: string[]; city: string; status: string } | null {
  if (!c) return null
  const name = [c.firstName, c.lastName].map((x: unknown) => String(x ?? '').trim()).filter(Boolean).join(' ')
  const phones = [c.mobilePhone, c.homePhone, c.otherPhone].map((x: unknown) => String(x ?? '').trim()).filter(Boolean)
  const addr = c.residentialAddress ?? c.address ?? {}
  const city = String(addr?.city ?? '').trim()
  const status = String(c.status?.label ?? c.status ?? '').trim()
  return { name, phones, city, status }
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
  const leadId = cleanLead(b.lead_id), ax = cleanId(b.axiscare_client_id)
  if (!leadId || !ax) return json({ error: 'lead_id and a numeric axiscare_client_id are required' }, 400)

  const { data: kase } = await sb.from('client_admission_case')
    .select('case_id, needs_owner_decision, escalation_reason, axiscare_name').eq('axiscare_client_id', ax).eq('status', 'open').maybeSingle()

  if (b.action === 'preview') {
    const { token, site } = axisCreds()
    let axis = null, axisError: string | null = null
    if (token && /^\d+$/.test(site)) {
      try {
        const r = await fetch(`https://${site}.axiscare.com/api/clients?clientIds=${ax}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': '2023-10-01' } })
        if (r.ok) {
          const body = await r.json().catch(() => ({}))
          // deno-lint-ignore no-explicit-any
          axis = axisSummary(((body as any)?.results?.clients ?? []).find((c: any) => String(c?.id) === ax))
          if (!axis) axisError = 'AxisCare has no client with that id'
        } else axisError = 'AxisCare answered ' + r.status
      } catch (e) { axisError = 'AxisCare could not be reached: ' + String((e as Error).message ?? e) }
    } else axisError = 'AxisCare credentials not set'

    const { data: link } = await sb.from('person_source_id').select('person_id')
      .eq('system', 'axiscare').eq('entity_type', 'client').eq('source_id', ax).maybeSingle()
    let person = null, activeJourney = false
    if (link?.person_id) {
      const { data: p } = await sb.from('person_identity').select('display_name').eq('id', link.person_id).maybeSingle()
      const { data: eps } = await sb.from('journey_episode').select('episode_id, state').eq('person_id', link.person_id)
      activeJourney = (eps ?? []).some((e) => ['provisional', 'open', 'converted', 'established'].includes(String(e.state)))
      person = { name: p?.display_name ?? null, active_journey: activeJourney }
    }
    const { data: src } = await sb.from('episode_source').select('episode_id')
      .eq('system', 'lead').eq('role', 'origin').eq('source_ref', leadId).maybeSingle()
    let journey = null
    if (src?.episode_id) {
      const { data: ep } = await sb.from('journey_episode').select('state, person_id').eq('episode_id', src.episode_id).maybeSingle()
      journey = { state: ep?.state ?? null, connected: !!ep?.person_id }
    }
    return json({ axiscare: axis, axiscare_error: axisError, admission_case: kase ? { escalated: !!kase.needs_owner_decision, name: kase.axiscare_name } : null,
                  person, journey })
  }

  if (b.action === 'connect') {
    const how = typeof b.how === 'string' ? b.how : ''
    if (!['typed', 'convert', 'confirmed_match'].includes(how)) return json({ error: 'how must be typed, convert or confirmed_match' }, 400)
    const { data: seatRows, error: seatErr } = await sb.from('journey_seat_member').select('seat').eq('email', email)
    if (seatErr) return json({ error: 'could not read seat membership' }, 500)
    const seat = chooseSeat((seatRows ?? []).map((r) => String(r.seat)), !!kase?.needs_owner_decision)
    if (!seat) return json({ outcome: 'no_seat', detail: 'your account does not hold a Journey seat; ask the owner to add you' }, 403)
    const name = typeof b.axiscare_name === 'string' ? b.axiscare_name.trim().slice(0, 200) : null
    const { data, error } = await sb.rpc('lead_journey_connect', {
      p_lead_id: leadId, p_axiscare_client_id: ax, p_axiscare_name: name || null, p_how: how,
      p_acting_staff: email, p_acting_seat: seat,
    })
    if (error) return json({ error: 'not connected: ' + error.message }, 500)
    return json(data)
  }
  return json({ error: "action must be 'preview' or 'connect'" }, 400)
})
