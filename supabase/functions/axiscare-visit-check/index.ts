// =============================================================================
// axiscare-visit-check: what AxisCare lets the Hub change on a visit (2026-10-06, before "click and change shifts" on
// the Live Schedule calendar, Samantha: "even better if we can actually click and change shifts there").
// =============================================================================
// Owner script only (the service key or the job secret); never for browsers. It CHANGES NOTHING:
//   1. GET /api/visits/modification-reasons: the agency's change reasons (name, id, disabled).
//   2. One upcoming visit (tomorrow, Chicago): GET it, and report its field NAMES only (no client or caregiver names).
//   3. For each AxisCare key this project holds: PATCH that visit with an EMPTY body. AxisCare's documented answer to
//      an empty body is 400 "At least one field must be provided for the update" (or "A modification reason is
//      required" when reasons are required), and nothing is changed; a 401/403 means that key can't edit visits.
//      The visit is read again afterwards to prove it is unchanged.
// =============================================================================
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b, null, 2), { status: s, headers: { 'Content-Type': 'application/json' } })
const SITE = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
const VER = Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01'
const UA = 'CaringCompanions-Hub/1.0 (+https://mo-care.com)'
// deno-lint-ignore no-explicit-any
type Any = any
const rowsOf = (v: Any): Any[] => Array.isArray(v) ? v : (v && typeof v === 'object') ? Object.values(v) : []
const chiDay = (n: number) => { const d = new Date(Date.now() + n * 864e5); return d.toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10) }
export function roleOf(auth: string | null): string {
  try { const t = String(auth || '').replace(/^Bearer\s+/i, ''); return String(JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))?.role || '') } catch { return '' }
}
const sameState = (a: Any, b: Any) => JSON.stringify([a?.caregiver?.id ?? null, a?.scheduledStartDate, a?.scheduledEndDate, a?.startDate, a?.endDate])
  === JSON.stringify([b?.caregiver?.id ?? null, b?.scheduledStartDate, b?.scheduledEndDate, b?.startDate, b?.endDate])

Deno.serve(async (req) => {
  if (roleOf(req.headers.get('authorization')) !== 'service_role') return json({ error: 'owner script only' }, 403)
  const keys: [string, string][] = (['AXISCARE_VISITS_TOKEN', 'AXISCARE_API_KEY', 'AXISCARE_TOKEN'] as const)
    .map((n) => [n, Deno.env.get(n) || ''] as [string, string]).filter(([, v]) => !!v)
  const seen = new Set<string>(); const uniq = keys.filter(([, v]) => !seen.has(v) && !!seen.add(v))
  if (!uniq.length || !/^\d+$/.test(SITE)) return json({ error: 'AxisCare is not set up on this project' }, 502)
  const host = `https://${SITE}.axiscare.com`
  const h = (tok: string) => ({ Authorization: `Bearer ${tok}`, 'X-AxisCare-Api-Version': VER, Accept: 'application/json', 'User-Agent': UA })
  const tok0 = uniq[0][1], out: Any = { changed_nothing: true, keys: uniq.map(([n]) => n) }

  // 1. the change reasons
  try {
    const r = await fetch(`${host}/api/visits/modification-reasons`, { headers: h(tok0) })
    const j: Any = await r.json().catch(() => ({}))
    out.reasons = { status: r.status, list: rowsOf(j?.results?.modificationReasons ?? j?.modificationReasons ?? j?.results)
      .map((x: Any) => ({ id: x?.id ?? null, name: String(x?.name ?? x?.reason ?? x?.description ?? ''), disabled: x?.disabled === true })), errors: j?.errors ?? null }
  } catch (e) { out.reasons = { error: String(e) } }

  // 2. one upcoming visit (tomorrow), assigned if possible
  let visit: Any = null
  try {
    const d = chiDay(1), r = await fetch(`${host}/api/visits?startDate=${d}&endDate=${d}`, { headers: h(tok0) })
    const j: Any = await r.json().catch(() => ({}))
    const vs = rowsOf(j?.results?.visits ?? j?.visits).filter((v: Any) => v && !v.removed && v.id != null && !v.verified)
    visit = vs.find((v: Any) => v?.caregiver?.id != null) ?? vs[0] ?? null
    out.sample = visit ? { id_shape: String(visit.id).replace(/\d+/g, 'N'), field_names: Object.keys(visit).sort(),
      has_caregiver: visit?.caregiver?.id != null, modification_reason_on_visit: visit?.modificationReason ?? null } : { none_tomorrow: true, status: r.status }
  } catch (e) { out.sample = { error: String(e) } }

  // 3. may each key edit visits? An empty PATCH (changes nothing), then read it back
  out.edit = []
  if (visit) {
    const path = `${host}/api/visits/${encodeURIComponent(String(visit.id))}`
    for (const [name, tok] of uniq) {
      try {
        const r = await fetch(path, { method: 'PATCH', headers: { ...h(tok), 'Content-Type': 'application/json' }, body: '{}' })
        const t = await r.text()
        let errs: Any = null; try { errs = JSON.parse(t)?.errors ?? null } catch { errs = t.slice(0, 160) }
        out.edit.push({ key: name, status: r.status, errors: errs,
          meaning: r.status === 400 && /at least one field/i.test(JSON.stringify(errs)) ? 'this key can edit visits (AxisCare checked the request and found nothing to change)'
            : r.status === 400 && /modification reason is required/i.test(JSON.stringify(errs)) ? 'this key can edit visits, and every change needs a reason'
            : r.status === 401 || r.status === 403 ? 'this key cannot edit visits'
            : r.status === 200 ? 'AxisCare accepted an empty change (nothing to change)' : 'unclear: see the status and errors' })
      } catch (e) { out.edit.push({ key: name, error: String(e) }) }
    }
    try {
      const r = await fetch(path, { headers: h(tok0) }); const j: Any = await r.json().catch(() => ({}))
      const after = j?.results?.visit ?? j?.visit ?? null
      out.unchanged = after ? sameState(visit, after) : null
    } catch { out.unchanged = null }
  }
  return json(out)
})
