// =============================================================================
// axiscare-field-probe — READ-ONLY: does the API return AxisCare custom fields?
// =============================================================================
// Her GO (2026-09-20): raw evidence for one caregiver (default 225, Makala
// Adkins — the known example with the EVV provider-assigned caregiver ID
// filled in AxisCare's Custom Fields screen). SEND-INCAPABLE and WRITE-
// INCAPABLE by construction: every AxisCare request is a GET with no body;
// there is no messaging code and no database write of any kind. The 178
// desktop attempt proved the management API returns secret DIGESTS, not
// plaintext, so this probe must live where Deno.env holds the real values.
//
// Every row list goes through rowsOf() (the 172 lesson: AxisCare arrays can
// arrive as index-keyed objects), and raw payloads are returned verbatim —
// except SSN-looking keys, masked before anything leaves this function.
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

function callerRole(req: Request): string {
  try {
    const tok = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    return String(JSON.parse(atob(tok.split('.')[1] ?? ''))?.role ?? '')
  } catch { return '' }
}

/* SSNs must never leave this function, even in a raw dump. */
// deno-lint-ignore no-explicit-any
function maskSsn(x: any): any {
  if (Array.isArray(x)) return x.map(maskSsn)
  if (x && typeof x === 'object') {
    // deno-lint-ignore no-explicit-any
    const out: any = {}
    for (const [k, v] of Object.entries(x))
      out[k] = (/ssn/i.test(k) && v != null && v !== '') ? '███ (masked)' : maskSsn(v)
    return out
  }
  return x
}

Deno.serve(async (req) => {
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
  if (callerRole(req) !== 'service_role') return json({ error: 'service role required' }, 403)

  const { token, site } = axisCreds()
  if (!token || !/^\d+$/.test(site)) return json({ error: 'AxisCare credentials not set' }, 502)

  // deno-lint-ignore no-explicit-any
  let body: any = {}
  try { body = await req.json() } catch { /* empty body is fine */ }
  const cgId = /^\d+$/.test(String(body?.caregiver_id ?? '')) ? String(body.caregiver_id) : '225'

  const get = async (path: string) => {
    const r = await fetch(`https://${site}.axiscare.com${path}`, { headers: {
      Authorization: `Bearer ${token}`, Accept: 'application/json',
      'X-AxisCare-Api-Version': Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01' } })
    const text = await r.text()
    // deno-lint-ignore no-explicit-any
    let j: any
    try { j = JSON.parse(text) } catch { j = { _non_json_body: text.slice(0, 600) } }
    return { status: r.status, body: maskSsn(j) }
  }

  const single = await get(`/api/caregivers/${cgId}`)

  /* The list/census shape: try a filtered read, then page for the row. */
  // deno-lint-ignore no-explicit-any
  const findRow = (payload: any): any => {
    const res = payload?.results ?? payload ?? {}
    for (const g of rowsOf(res?.caregivers ?? payload?.caregivers))
      if (String(g?.id) === cgId) return g
    return null
  }
  // deno-lint-ignore no-explicit-any
  let listRow: any = null
  let listNote = ''
  const filtered = await get(`/api/caregivers?ids=${cgId}`)
  if (filtered.status === 200) listRow = findRow(filtered.body)
  let pages = 0
  if (!listRow) {
    let url: string | null = `/api/caregivers`
    while (url && pages < 20 && !listRow) {
      pages++
      const p = await get(url)
      if (p.status !== 200) { listNote = `page ${pages} answered HTTP ${p.status}`; break }
      listRow = findRow(p.body)
      const nxt = p.body?.results?.nextPage ?? p.body?.nextPage
        ?? p.body?.results?.nextPageUrl ?? p.body?.nextPageUrl ?? null
      const i = nxt ? String(nxt).indexOf('/api/') : -1
      url = i >= 0 ? String(nxt).slice(i) : null
    }
  }

  const exploratory: Record<string, unknown> = {}
  for (const path of [`/api/caregivers/${cgId}/customFields`, '/api/customFields', '/api/localFields'])
    exploratory[path] = await get(path)

  return json({
    caregiver_id: cgId,
    single,                                  // raw individual GET (SSN masked)
    filtered_ids_call: { status: filtered.status, row_found: !!(filtered.status === 200 && findRow(filtered.body)) },
    list_row: listRow,                       // raw census row (SSN masked)
    list_pages_searched: pages, list_note: listNote,
    exploratory,
  })
})
