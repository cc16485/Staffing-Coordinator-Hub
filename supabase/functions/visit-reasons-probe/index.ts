// =============================================================================
// visit-reasons-probe: ONE-TIME, READ ONLY. Samantha 2026-10-16: app visits get the AxisCare change reason
// "Booked by family in app". Deployed by Desktop 843, called once, deleted by the same step. Only the owner's installer
// can call it (role service_role). Lists AxisCare's visit modification reasons (name, id, on/off) so the step can check
// hers is there and switched on before the app uses it. Writes nothing.
// =============================================================================
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
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } })
Deno.serve(async (req) => {
  if (roleOf(req.headers.get('Authorization')) !== 'service_role') return json({ error: 'owner script only' }, 403)
  const { token, site } = axisCreds()
  if (!token || !site) return json({ error: 'AxisCare credentials not set' }, 500)
  const r = await fetch(`https://${site}.axiscare.com/api/visits/modification-reasons`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': '2023-10-01' } })
  const j = await r.json().catch(() => ({}))
  // deno-lint-ignore no-explicit-any
  const list: any[] = j?.results?.modificationReasons ?? []
  return json({ status: r.status, reasons: list.map((x) => ({ id: x?.id ?? null, name: String(x?.name ?? ''), disabled: x?.disabled === true })) })
})
