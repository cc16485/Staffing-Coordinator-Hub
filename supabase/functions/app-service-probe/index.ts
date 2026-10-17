// =============================================================================
// app-service-probe: ONE-TIME. Samantha 2026-10-16 saved the AxisCare service "PP - App" (Private Pay - Family App Visit) for
// visits booked in the family app. Deployed by Desktop 846, called once, deleted by the same step. Owner's installer only
// (role service_role). On Test Client 5 (#290) ONLY, refusing any client whose name doesn't say "test": creates ONE
// unassigned visit 30 days out with the service and the "Booked by family in app" reason (exactly what the family app
// sends), reads it back, then removes it. Never a family booking, so no caregiver is offered or texted; no Hub record.
// =============================================================================
import { reasonId, visitIdOf, visitOf, type Ax } from '../_shared/family-app.ts'
const TEST_CLIENT = 290
function axisCreds() {
  let token = ''
  for (const n of ['AXISCARE_API_KEY', 'AXISCARE_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site: /^\d+$/.test(site) ? site : '' }
}
const ax: Ax = async (method, path, body) => {
  const { token, site } = axisCreds()
  if (!token || !site) return { status: 0, json: { errors: ['AxisCare credentials not set'] } }
  try {
    const r = await fetch(`https://${site}.axiscare.com${path}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json',
      'X-AxisCare-Api-Version': '2023-10-01' }, body: body === undefined ? undefined : JSON.stringify(body) })
    const t = await r.text(); let json: unknown = {}; try { json = t ? JSON.parse(t) : {} } catch { json = { raw: t.slice(0, 200) } }
    return { status: r.status, json }
  } catch (e) { return { status: 0, json: { errors: [String(e)] } } }
}
export function roleOf(authHeader: string | null): string | null {
  const t = String(authHeader ?? '').replace(/^Bearer\s+/i, ''), parts = t.split('.')
  if (parts.length !== 3) return null
  try { const p = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))); return typeof p.role === 'string' ? p.role : null } catch { return null }
}
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } })
Deno.serve(async (req) => {
  if (roleOf(req.headers.get('Authorization')) !== 'service_role') return json({ error: 'owner script only' }, 403)
  const body = await req.json().catch(() => ({}))
  const service = String(body?.service ?? '').trim(), reasonName = String(body?.reason ?? '').trim()
  if (!service) return json({ error: 'no service given' }, 400)
  const c = await ax('GET', `/api/clients/${TEST_CLIENT}`)
  const cl = c.json?.results?.client ?? c.json?.results ?? {}
  if (!/test/i.test(`${cl?.firstName ?? ''} ${cl?.lastName ?? ''}`)) return json({ error: `client ${TEST_CLIENT} isn't a test client` }, 409)
  const date = new Date(Date.now() + 30 * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
  const rid = await reasonId(ax, reasonName)
  const post: Record<string, unknown> = { clientId: TEST_CLIENT, visitDate: date, startTime: '10:00', endTime: '12:00', caregiverId: null, serviceCode: service }
  if (rid != null) post.modificationReason = rid
  const made = await ax('POST', '/api/visits', post)
  const out: Record<string, unknown> = { date, reason_found: rid != null, create_status: made.status, create_error: made.status >= 300 ? made.json : null }
  const vid = made.status < 300 ? visitIdOf(made.json) : null
  out.visit_id = vid
  if (vid) {
    const back = await ax('GET', `/api/visits/${encodeURIComponent(String(vid))}`)
    const v = visitOf(back.json)
    out.read_status = back.status
    out.service_code = v?.service?.code ?? null
    out.service_description = v?.service?.description ?? null
    out.reason = v?.modificationReason?.name ?? null
    out.billable_rate_mode = v?.billableRateMode ?? null
    out.charge_rate = v?.chargeRate ?? null
    out.caregiver = v?.caregiver?.id ?? null
    const delReason = await reasonId(ax, 'Administrative Correction - Office Error') ?? await reasonId(ax, 'Schedule Change - Client Cancellation')
    const del = await ax('DELETE', `/api/visits/${encodeURIComponent(String(vid))}` + (delReason != null ? `?modificationReason=${delReason}` : ''))
    out.delete_status = del.status
    const gone = await ax('GET', `/api/visits/${encodeURIComponent(String(vid))}`)
    out.removed = gone.status === 404 || visitOf(gone.json)?.removed === true
  }
  return json(out)
})
