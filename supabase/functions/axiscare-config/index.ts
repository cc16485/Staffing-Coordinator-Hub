// =============================================================================
// axiscare-config — what AxisCare configuration does THIS project hold?
// =============================================================================
// READ ONLY. Deployed to BOTH projects so their configuration can be compared.
//
// It never returns a secret. The token is reported as a fingerprint: its length
// and last four characters. That is enough to tell two tokens apart and useless
// to anybody who intercepts it.
//
// WHY THIS EXISTS
//   The hub reads AXISCARE_SITE. The sync that worked at 09:05 reads
//   AXISCARE_SITE_NUMBER, in a different project. Those are different secrets
//   and nothing has ever compared them. If they differ, every probe tonight hit
//   a subdomain that does not exist — which would explain the CloudFront 403
//   AND the WordPress 404 exactly, with nothing broken at AxisCare.
// =============================================================================

const fingerprint = (v: string | undefined) =>
  !v ? '(not set)' : `len ${v.length}, ends ${v.slice(-4)}`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 })

  const site = Deno.env.get('AXISCARE_SITE')
  const siteNumber = Deno.env.get('AXISCARE_SITE_NUMBER')
  const token = Deno.env.get('AXISCARE_API_KEY') || Deno.env.get('AXISCARE_TOKEN')
  const visitsToken = Deno.env.get('AXISCARE_VISITS_TOKEN')
  const version = Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01'
  const effectiveSite = site || siteNumber

  /* One live call, so "last known success" is measured rather than remembered.
     Uses the documented header set exactly. */
  let probe: Record<string, unknown> = { skipped: 'no site or token configured' }
  if (effectiveSite && token) {
    const url = `https://${effectiveSite}.axiscare.com/api/caregivers?limit=1`
    try {
      const r = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-AxisCare-Api-Version': version,
          'Accept': 'application/json',
          'User-Agent': 'CaringCompanions-Hub/1.0 (+https://mo-care.com)',
        },
      })
      const body = await r.text()
      const ct = r.headers.get('content-type') || ''
      probe = {
        status: r.status,
        content_type: ct,
        server: r.headers.get('server'),
        /* JSON means we reached the API. HTML means we did not. */
        reached_the_api: ct.includes('json'),
        body_starts: ct.includes('json')
          ? body.slice(0, 160)
          : body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120),
      }
    } catch (e) {
      probe = { error: e instanceof Error ? e.message : String(e) }
    }
  }

  return new Response(JSON.stringify({
    project: Deno.env.get('SUPABASE_URL')?.replace('https://', '').split('.')[0],
    AXISCARE_SITE: site ?? '(not set)',
    AXISCARE_SITE_NUMBER: siteNumber ?? '(not set)',
    effective_site: effectiveSite ?? '(none)',
    base_url: effectiveSite ? `https://${effectiveSite}.axiscare.com` : '(none)',
    api_version_header: version,
    token_var: Deno.env.get('AXISCARE_API_KEY') ? 'AXISCARE_API_KEY'
             : Deno.env.get('AXISCARE_TOKEN') ? 'AXISCARE_TOKEN' : '(none)',
    token_fingerprint: fingerprint(token),
    visits_token_fingerprint: fingerprint(visitsToken),
    live_probe: probe,
    note: 'No secret value is returned. The fingerprint is length plus last four.',
  }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
