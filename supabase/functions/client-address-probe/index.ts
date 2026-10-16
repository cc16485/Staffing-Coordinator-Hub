// =============================================================================
// client-address-probe: ONE-TIME, READ ONLY. Samantha 2026-10-16: 840 couldn't read Test Client 5's state.
// Deployed by Desktop 842, called once, deleted by the same step. Only the owner's installer can call it (role service_role,
// with the gateway checking the key). Reads ONLY AxisCare client #290 (Test Client 5, refused if the name doesn't say "test")
// and returns the address parts AxisCare sends back, so we can see the real field names and values. Writes nothing.
// =============================================================================
const TEST_CLIENT = 290
function axisCreds() {
  let token = ''
  for (const n of ['AXISCARE_API_KEY', 'AXISCARE_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site: /^\d+$/.test(site) ? site : '' }
}
export function roleOf(authHeader: string | null): string | null {
  const t = String(authHeader ?? '').replace(/^Bearer\s+/i, ''), parts = t.split('.')
  if (parts.length !== 3) return null
  try { const p = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))); return typeof p.role === 'string' ? p.role : null } catch { return null }
}
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o, null, 2), { status: s, headers: { 'Content-Type': 'application/json' } })
// deno-lint-ignore no-explicit-any
const shape = (o: any) => o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v && typeof v === 'object' ? shape(v) : v])) : o
Deno.serve(async (req) => {
  if (roleOf(req.headers.get('Authorization')) !== 'service_role') return json({ error: 'owner script only' }, 403)
  const { token, site } = axisCreds()
  if (!token || !site) return json({ error: 'AxisCare credentials not set' }, 500)
  const r = await fetch(`https://${site}.axiscare.com/api/clients/${TEST_CLIENT}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': '2023-10-01' } })
  const j = await r.json().catch(() => ({}))
  const c = j?.results?.client ?? j?.results ?? {}
  const name = `${c?.firstName ?? ''} ${c?.lastName ?? ''}`.trim()
  if (!/test/i.test(name)) return json({ error: `client ${TEST_CLIENT} isn't a test client`, status: r.status }, 409)
  const addrKeys = Object.keys(c).filter((k) => /address|state|region|city|zip|postal/i.test(k))
  return json({ status: r.status, name, client_status: c?.status ?? null, address_fields: Object.fromEntries(addrKeys.map((k) => [k, shape(c[k])])) })
})
