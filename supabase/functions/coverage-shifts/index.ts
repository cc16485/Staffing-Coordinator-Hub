// Supabase Edge Function: coverage-shifts  (shared hub project)
// -----------------------------------------------------------------------------
// "Click the caregiver from a drop-down and choose which of their shifts they
// are calling in for" (Samantha, 2026-09-12). This serves that picker: the
// hub asks for a caregiver's REAL upcoming visits, live from AxisCare, so a
// call-off case is anchored to the exact visit from the moment it opens —
// client, id, date, times — instead of free text someone heard on the phone.
//
// Read-only. JWT-verified (deploy WITHOUT --no-verify-jwt); the hub calls it
// with the signed-in coordinator's session token.
// -----------------------------------------------------------------------------
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  } })

const AC_VERSION = Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01'
/* AxisCare sometimes returns entity lists keyed by id rather than as arrays
   (axiscare-probe's listOf() defends against exactly this; the caregivers
   census threw "object is not iterable" in production). Normalise. */
// deno-lint-ignore no-explicit-any
const rowsOf = (v: any): any[] => Array.isArray(v) ? v
  : (v && typeof v === 'object') ? Object.values(v) : []
function axisCreds() {
  const order = ['AXISCARE_VISITS_TOKEN', 'AXISCARE_API_KEY', 'AXISCARE_TOKEN']
  let token = ''
  for (const n of order) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site: /^\d+$/.test(site) ? site : '' }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS' } })

  // deno-lint-ignore no-explicit-any
  const b: any = await req.json().catch(() => ({}))

  /* Mode 2: the ACTIVE caregiver census, live from AxisCare, for the
     "Who's calling off?" dropdown. The hub roster's active flag drifts from
     AxisCare's, and Samantha only wants people who are actually active.
     Filtered on the per-row status.active boolean — never a query param the
     endpoint might silently ignore (the clients backfill taught that). */
  if (b.list_caregivers === true) {
    const { token, site } = axisCreds()
    if (!token || !site) return json({ error: 'AxisCare credentials not set on this project' }, 502)
    // deno-lint-ignore no-explicit-any
    const out: any[] = []
    let total = 0
    try {
      let url: string | null = `https://${site}.axiscare.com/api/caregivers`
      for (let page = 0; url && page < 12; page++) {
        const r: Response = await fetch(url, { headers: {
          Authorization: `Bearer ${token}`, Accept: 'application/json',
          'X-AxisCare-Api-Version': AC_VERSION } })
        if (!r.ok) return json({ error: `AxisCare responded ${r.status}` }, 502)
        // deno-lint-ignore no-explicit-any
        const j: any = await r.json().catch(() => ({}))
        for (const g of rowsOf(j?.results?.caregivers ?? j?.caregivers)) {
          total++
          if (g?.status?.active !== true) continue
          const name = [String(g?.firstName ?? '').trim(), String(g?.lastName ?? '').trim()]
            .filter(Boolean).join(' ')
          if (g?.id != null && name) out.push({ id: String(g.id), name })
        }
        url = j?.results?.nextPage ?? j?.nextPage ?? null
      }
    } catch (err) { return json({ error: String(err) }, 502) }
    out.sort((a, b2) => a.name.localeCompare(b2.name))
    return json({ caregivers_total: total, active: out.length, caregivers: out })
  }

  const cgId = String(b.caregiver_axiscare_id || '').trim()
  if (!/^\d+$/.test(cgId)) return json({ error: 'caregiver_axiscare_id (numeric) required' }, 400)
  const days = Number(b.days) > 0 && Number(b.days) <= 30 ? Number(b.days) : 14

  const { token, site } = axisCreds()
  if (!token || !site) return json({ error: 'AxisCare credentials not set on this project' }, 502)

  const startDate = new Date().toISOString().slice(0, 10)
  const endDate = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
  // deno-lint-ignore no-explicit-any
  const out: any[] = []
  try {
    let url: string | null =
      `https://${site}.axiscare.com/api/visits?caregiverIds=${encodeURIComponent(cgId)}&startDate=${startDate}&endDate=${endDate}`
    for (let page = 0; url && page < 6; page++) {
      const r: Response = await fetch(url, { headers: {
        Authorization: `Bearer ${token}`, Accept: 'application/json',
        'X-AxisCare-Api-Version': AC_VERSION } })
      if (!r.ok) return json({ error: `AxisCare responded ${r.status}` }, 502)
      // deno-lint-ignore no-explicit-any
      const j: any = await r.json().catch(() => ({}))
      for (const v of rowsOf(j?.results?.visits ?? j?.visits)) {
        if (v?.removed) continue
        const start = String(v?.scheduledStartDate ?? v?.startDate ?? '')
        const end = String(v?.scheduledEndDate ?? v?.endDate ?? '')
        out.push({
          visit_id: String(v?.id ?? ''),
          client_axiscare_id: v?.client?.id != null ? String(v.client.id) : null,
          client: [String(v?.client?.firstName ?? '').trim(), String(v?.client?.lastName ?? '').trim()]
            .filter(Boolean).join(' ') || '(no client name on the visit)',
          date: start.slice(0, 10),
          time: [start.slice(11, 16), end.slice(11, 16)].filter(Boolean).join('-'),
        })
      }
      url = j?.results?.nextPage ?? j?.nextPage ?? null
    }
  } catch (err) { return json({ error: String(err) }, 502) }

  out.sort((a, b2) => (a.date + a.time).localeCompare(b2.date + b2.time))
  return json({ caregiver_axiscare_id: cgId, window: `${startDate} → ${endDate}`, shifts: out })
})
