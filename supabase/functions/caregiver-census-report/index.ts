// =============================================================================
// caregiver-census-report — the FULL AxisCare caregiver census, read-only
// =============================================================================
// Purpose-built for the identity-reconciliation report (her order,
// 2026-09-20): every caregiver, active AND inactive, with the identity and
// status facts needed to match them against the hub roster. SEND-INCAPABLE
// by construction: no messaging code, no writes of any kind, anywhere —
// its only calls are AxisCare GETs, and it returns JSON to the caller.
//
// Every row list is wrapped in rowsOf(): AxisCare arrays sometimes arrive
// as index-keyed objects (the 172-proof lesson, paid for twice).
// =============================================================================

function axisCreds() {
  const order = ['AXISCARE_API_KEY', 'AXISCARE_TOKEN', 'AXISCARE_VISITS_TOKEN']
  let token = ''
  for (const n of order) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site }
}
// deno-lint-ignore no-explicit-any
const rowsOf = (x: any): any[] => Array.isArray(x) ? x : (x && typeof x === 'object' ? Object.values(x) : [])
const S = (v: unknown) => String(v ?? '').trim()

function callerRole(req: Request): string {
  try {
    const tok = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    return String(JSON.parse(atob(tok.split('.')[1] ?? ''))?.role ?? '')
  } catch { return '' }
}

/* The hub's Caregivers page calls this from the BROWSER, so CORS headers are
   required on every response including the preflight (the first deploy only
   answered server-side scripts and the page got "Failed to fetch"). */
const cors = { 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

  const role = callerRole(req)
  if (role !== 'authenticated' && role !== 'service_role')
    return json({ error: 'a signed-in session is required' }, 403)

  const { token, site } = axisCreds()
  if (!token || !site) return json({ error: 'AxisCare credentials not set' }, 502)

  // deno-lint-ignore no-explicit-any
  const out: any[] = []
  let url: string | null = `https://${site}.axiscare.com/api/caregivers`
  let pages = 0, truncated = false
  while (url && pages < 20) {
    pages++
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json',
      'X-AxisCare-Api-Version': Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01' } })
    if (!r.ok) return json({ error: `AxisCare responded ${r.status} on page ${pages}` }, 502)
    // deno-lint-ignore no-explicit-any
    const j: any = await r.json().catch(() => ({}))
    for (const g of rowsOf(j?.results?.caregivers ?? j?.caregivers)) {
      if (g?.id == null) continue
      out.push({
        id: String(g.id),
        first: S(g.firstName), last: S(g.lastName), goes_by: S(g.goesBy),
        active: g?.status?.active === true,
        status_label: S(g?.status?.label),
        hire_date: S(g.hireDate) || S(g.startDate),
        mobile: S(g.mobilePhone), email: S(g.personalEmail),
        city: S(g?.mailingAddress?.city), zip: S(g?.mailingAddress?.postalCode),
        // deno-lint-ignore no-explicit-any
        classes: rowsOf(g?.classes).map((k: any) => S(k?.label ?? k?.code)).filter(Boolean),
      })
    }
    url = j?.results?.nextPage ?? j?.nextPage ?? j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
  }
  if (url) truncated = true
  return json({ total: out.length, truncated, caregivers: out })
})
