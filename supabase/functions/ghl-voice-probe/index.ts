// =============================================================================
// ghl-voice-probe: can GoHighLevel's Voice AI call caregivers from the office number? READ ONLY (Samantha, 2026-10-24:
// "Check whether GoHighLevel Voice AI can call from our office number, read only. No test call yet.")
// =============================================================================
// Owner script only (the service key); never for browsers. Three GET requests to GoHighLevel with the Hub's own token,
// nothing else: the location (its business phone and time zone), the phone numbers on the location (is the office number
// one of them, and can it make voice calls), and the Voice AI agents. It places no call, sends no text, and creates or
// changes nothing in GoHighLevel, the Hub or AxisCare. A refused request is reported with its status, which tells us which
// permission the token is missing. Desktop 1114 puts it in place, runs it once and removes it.
// =============================================================================
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b, null, 2), { status: s, headers: { 'Content-Type': 'application/json' } })
export function roleOf(auth: string | null): string {
  try { const t = String(auth || '').replace(/^Bearer\s+/i, ''); return String(JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))?.role || '') } catch { return '' }
}
const BASE = 'https://services.leadconnectorhq.com'
export const OFFICE = '4172348494'
const d10 = (p: unknown) => String(p ?? '').replace(/\D/g, '').slice(-10)
// deno-lint-ignore no-explicit-any
type Any = any

/** One GET, never more. Status, the JSON (or the first 300 characters of an error). */
async function get(path: string, version: string, token: string): Promise<{ status: number | null; json: Any; error: string | null }> {
  try {
    const r = await fetch(BASE + path, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Version: version, Accept: 'application/json' } })
    const t = await r.text()
    let j: Any = null; try { j = JSON.parse(t) } catch { /* not JSON */ }
    return { status: r.status, json: r.ok ? j : null, error: r.ok ? null : String((j && (j.message || j.error)) || t).slice(0, 300) }
  } catch (e) { return { status: null, json: null, error: String((e as Error)?.message || e).slice(0, 300) } }
}
const listOf = (j: Any, ...keys: string[]): Any[] => {
  if (Array.isArray(j)) return j
  for (const k of keys) { const v = k.split('.').reduce((o: Any, p) => (o == null ? o : o[p]), j); if (Array.isArray(v)) return v }
  return []
}
/** The fields of a number that matter here (whatever the response calls them), plus every key name to learn its shape. */
export function numberLine(n: Any, office: string): Any {
  const phone = String(n?.phoneNumber ?? n?.number ?? n?.phone ?? '')
  return { phone, is_office: d10(phone) === office, name: n?.friendlyName ?? n?.name ?? null,
    capabilities: n?.capabilities ?? null, type: n?.type ?? n?.numberType ?? n?.provider ?? null,
    default: n?.isDefaultNumber ?? n?.isDefault ?? null, status: n?.status ?? null, keys: Object.keys(n || {}).slice(0, 40) }
}
export function agentLine(a: Any, office: string): Any {
  const nums = [a?.inboundNumber, a?.phoneNumber, ...(Array.isArray(a?.phoneNumbers) ? a.phoneNumbers : [])].filter(Boolean).map(String)
  return { id: a?.id ?? a?._id ?? null, name: a?.agentName ?? a?.name ?? null, numbers: nums, on_office_number: nums.some((x) => d10(x) === office),
    voice: a?.voiceId ?? a?.voice ?? null, language: a?.language ?? null, keys: Object.keys(a || {}).slice(0, 40) }
}

Deno.serve(async (req) => {
  if (roleOf(req.headers.get('authorization')) !== 'service_role') return json({ error: 'owner script only' }, 403)
  const token = Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || '', loc = Deno.env.get('GHL_LOCATION_ID') || ''
  if (!token || !loc) return json({ error: 'GoHighLevel token or location not set on this project' }, 500)
  const office = d10(((await req.json().catch(() => ({}))) as Any)?.office) || OFFICE

  const L = await get(`/locations/${encodeURIComponent(loc)}`, '2021-07-28', token)
  const lj = L.json?.location ?? L.json ?? null
  const location = { status: L.status, error: L.error, name: lj?.name ?? null, business_phone: lj?.phone ?? lj?.business?.phone ?? null,
    business_phone_is_office: d10(lj?.phone ?? lj?.business?.phone) === office, timezone: lj?.timezone ?? null }

  const N = await get(`/phone-system/numbers/location/${encodeURIComponent(loc)}?pageSize=100&page=0`, '2021-07-28', token)
  const nums = listOf(N.json, 'numbers', 'phoneNumbers', 'data', 'data.numbers', 'items').map((n) => numberLine(n, office))
  const numbers = { status: N.status, error: N.error, count: nums.length, list: nums, office_found: nums.some((n) => n.is_office),
    raw_keys: N.json && typeof N.json === 'object' ? Object.keys(N.json).slice(0, 20) : null }

  /* the Voice AI API's version header differs between guides: the first one that answers is used */
  let A = await get(`/voice-ai/agents?locationId=${encodeURIComponent(loc)}&page=1&pageSize=50`, '2021-04-15', token)
  if (A.status !== 200) { const A2 = await get(`/voice-ai/agents?locationId=${encodeURIComponent(loc)}&page=1&pageSize=50`, '2021-07-28', token); if (A2.status === 200) A = A2 }
  const ags = listOf(A.json, 'agents', 'data', 'data.agents', 'items').map((a) => agentLine(a, office))
  const agents = { status: A.status, error: A.error, count: ags.length, list: ags, raw_keys: A.json && typeof A.json === 'object' ? Object.keys(A.json).slice(0, 20) : null }

  return json({ read_only: true, office, location, numbers, agents })
})
