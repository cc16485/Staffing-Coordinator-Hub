// =============================================================================
// axiscare-cancel-probe: how AxisCare holds a cancelled visit (Samantha, 2026-10-24, before the Hub's "Cancel visit":
// "Please proceed with the read-only investigation ... Do not activate live cancellation automation or change real
// billing records until we've verified the results.")
// =============================================================================
// Owner script only (the service key); never for browsers. READ ONLY: every AxisCare call is a GET with no body. It writes
// nothing anywhere and contacts nobody. No client or caregiver names leave it, except the Test Client and the "Canceled
// Shift" placeholder (not people). It answers:
//   1. AxisCare's change reasons today (id, name, switched off or not).
//   2. A visit deleted through the API (the Booking App's Oct 16 cancel): is it still there, marked removed, by id and
//      in the visit list?
//   3. Every visit from 60 days back to 14 days ahead: how many per reason; how many come back marked removed; every field
//      name a visit carries and on how many (does "doNotBill" or "doNotPay" ever appear?); the placeholder's visits (how
//      many, verified or not, with a rate or not, clocked in or not, which reasons) and empty visits by reason.
//   4. The Test Client (AxisCare 290): its status, its visits in the window, and the placeholder caregiver's id.
// POST { deleted_visit_ids?: string[], test_client?: string, days_back?: number, days_ahead?: number }
// =============================================================================
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b, null, 2), { status: s, headers: { 'Content-Type': 'application/json' } })
const SITE = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
const VER = Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01'
const UA = 'CaringCompanions-Hub/1.0 (+https://mo-care.com)'
// deno-lint-ignore no-explicit-any
type Any = any
const rowsOf = (v: Any): Any[] => Array.isArray(v) ? v : (v && typeof v === 'object') ? Object.values(v) : []
const chiDay = (n: number) => new Date(Date.now() + n * 864e5).toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
export function roleOf(auth: string | null): string {
  try { const t = String(auth || '').replace(/^Bearer\s+/i, ''); return String(JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))?.role || '') } catch { return '' }
}
export const isPlaceholder = (cg: Any) => /^cancel+ed( shifts?)?$/i.test([cg?.firstName, cg?.lastName].map((x) => String(x ?? '').trim()).filter(Boolean).join(' ').replace(/\s+/g, ' '))
const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] || 0) + 1 }

/** The summary of a list of visits (no names). Exported for the test. */
export function summarize(visits: Any[], testClient: string) {
  const out: Any = { visits: visits.length, removed: 0, by_reason: {} as Record<string, number>, removed_by_reason: {} as Record<string, number>,
    fields: {} as Record<string, number>, billing_fields_seen: [] as string[],
    placeholder: { visits: 0, verified: 0, with_rate: 0, clocked_in: 0, by_reason: {} as Record<string, number>, removed: 0, sample_ids: [] as string[], field_names: [] as string[] },
    empty: { visits: 0, by_reason: {} as Record<string, number> }, test_client: { visits: 0, removed: 0, ids: [] as string[] } }
  const phFields = new Set<string>()
  for (const v of visits) {
    for (const k of Object.keys(v || {})) bump(out.fields, k)
    const reason = String(v?.modificationReason?.name ?? '').trim() || '(no reason)'
    if (v?.removed === true) { out.removed++; bump(out.removed_by_reason, reason) } else bump(out.by_reason, reason)
    if (isPlaceholder(v?.caregiver)) {
      const p = out.placeholder; p.visits++; bump(p.by_reason, reason)
      if (v?.removed === true) p.removed++
      if (v?.verified === true) p.verified++
      if (Number(v?.chargeRate) > 0) p.with_rate++
      if (v?.clockIn?.time) p.clocked_in++
      if (p.sample_ids.length < 5) p.sample_ids.push(String(v?.id ?? ''))
      for (const k of Object.keys(v || {})) phFields.add(k)
    } else if (v?.caregiver?.id == null && v?.removed !== true) { out.empty.visits++; bump(out.empty.by_reason, reason) }
    if (String(v?.client?.id ?? '') === testClient) { out.test_client.visits++; if (v?.removed === true) out.test_client.removed++; if (out.test_client.ids.length < 10) out.test_client.ids.push(String(v?.id ?? '')) }
  }
  out.billing_fields_seen = Object.keys(out.fields).filter((k) => /bill|pay|invoice|charge|rate/i.test(k)).sort()
  out.placeholder.field_names = [...phFields].sort()
  return out
}

Deno.serve(async (req) => {
  if (roleOf(req.headers.get('authorization')) !== 'service_role') return json({ error: 'owner script only' }, 403)
  const tok = Deno.env.get('AXISCARE_API_KEY') || Deno.env.get('AXISCARE_TOKEN') || Deno.env.get('AXISCARE_VISITS_TOKEN') || ''
  if (!tok || !/^\d+$/.test(SITE)) return json({ error: 'AxisCare is not set up on this project' }, 502)
  const b: Any = await req.json().catch(() => ({}))
  const host = `https://${SITE}.axiscare.com`
  const get = async (path: string): Promise<{ status: number; j: Any }> => {
    const r = await fetch(path.startsWith('http') ? path : host + path, { headers: { Authorization: `Bearer ${tok}`, 'X-AxisCare-Api-Version': VER, Accept: 'application/json', 'User-Agent': UA } })
    return { status: r.status, j: await r.json().catch(() => ({})) }
  }
  const out: Any = { read_only: true }
  const testClient = /^\d+$/.test(String(b.test_client ?? '')) ? String(b.test_client) : '290'

  // 1. the change reasons
  try {
    const r = await get('/api/visits/modification-reasons')
    out.reasons = { status: r.status, list: rowsOf(r.j?.results?.modificationReasons ?? r.j?.modificationReasons).map((x: Any) => ({ id: x?.id ?? null, name: String(x?.name ?? ''), disabled: x?.disabled === true })) }
  } catch (e) { out.reasons = { error: String(e).slice(0, 160) } }

  // 2. visits deleted through the API: by id, and in the list for their day
  out.deleted = []
  for (const id of (Array.isArray(b.deleted_visit_ids) ? b.deleted_visit_ids : []).slice(0, 5).map(String)) {
    const row: Any = { id }
    try {
      const one = await get(`/api/visits/${encodeURIComponent(id)}`)
      const v = one.j?.results?.visit ?? one.j?.visit ?? null
      row.by_id = { status: one.status, found: !!v, removed: v ? v.removed ?? null : null, reason: v?.modificationReason?.name ?? null, field_names: v ? Object.keys(v).sort() : [], errors: one.j?.errors ?? null }
      const day = (/d=(\d{4}-\d\d-\d\d)/.exec(id) || [])[1]
      if (day) {
        const l = await get(`/api/visits?visitIds=${encodeURIComponent(id)}&startDate=${day}&endDate=${day}`)
        const hit = rowsOf(l.j?.results?.visits ?? l.j?.visits).find((x: Any) => String(x?.id) === id)
        row.in_list = { status: l.status, found: !!hit, removed: hit ? hit.removed ?? null : null }
      }
    } catch (e) { row.error = String(e).slice(0, 160) }
    out.deleted.push(row)
  }

  // 3. the window, paged
  const back = Math.min(90, Math.max(1, Number(b.days_back) || 60)), ahead = Math.min(30, Math.max(0, Number(b.days_ahead) || 14))
  const all: Any[] = []; let pages = 0, url: string | null = `/api/visits?startDate=${chiDay(-back)}&endDate=${chiDay(ahead)}`, stop: string | null = null
  try {
    while (url && pages < 60) {
      const r = await get(url); pages++
      if (r.status === 429) { stop = 'AxisCare asked us to slow down (429); stopped reading'; break }
      if (r.status !== 200) { stop = `AxisCare answered ${r.status}`; break }
      all.push(...rowsOf(r.j?.results?.visits ?? r.j?.visits))
      const nx = r.j?.results?.nextPage ?? r.j?.nextPage ?? null; url = nx ? String(nx) : null
      await new Promise((res) => setTimeout(res, 250))
    }
  } catch (e) { stop = String(e).slice(0, 160) }
  out.window = { from: chiDay(-back), to: chiDay(ahead), pages, complete: !url && !stop, stopped: stop, ...summarize(all, testClient) }

  // 4. the Test Client and the placeholder caregiver
  try {
    const c = await get(`/api/clients?clientIds=${testClient}`)
    const cl = rowsOf(c.j?.results?.clients ?? c.j?.clients)[0] ?? null
    out.test_client = cl ? { id: testClient, name: [cl.firstName, cl.lastName].filter(Boolean).join(' '), status: cl?.status?.label ?? cl?.status ?? null, active: cl?.status?.active ?? null } : { id: testClient, found: false, status: c.status }
  } catch (e) { out.test_client = { error: String(e).slice(0, 160) } }
  try {
    let ph: Any = null, u: string | null = '/api/caregivers?limit=500'
    for (let p = 0; u && p < 5 && !ph; p++) {
      const r = await get(u); ph = rowsOf(r.j?.results?.caregivers ?? r.j?.caregivers).find((g: Any) => isPlaceholder(g)) ?? null
      const nx = r.j?.results?.nextPage ?? r.j?.nextPage ?? null; u = nx ? String(nx) : null
    }
    out.placeholder_caregiver = ph ? { id: ph.id ?? null, status: ph?.status?.label ?? ph?.status ?? null, field_names: Object.keys(ph).sort() } : { found: false }
  } catch (e) { out.placeholder_caregiver = { error: String(e).slice(0, 160) } }
  return json(out)
})
