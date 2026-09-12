// Supabase Edge Function: coverage-assign  (shared hub project)
// -----------------------------------------------------------------------------
// When the office clicks "Confirmed — mark covered" on a coverage case, the
// hub calls this to WRITE THE ASSIGNMENT INTO AXISCARE: the confirmed
// caregiver goes onto the visit, so nobody has to re-key it.
//
// The click IS the authorization — a person decided; this executes it.
// Three rules, all from AXISCARE-CAPABILITY.md:
//   1. `caregiverId` is writable via PATCH /api/visits/{visitId}.
//   2. NEVER trust a bare 200: the visit is read back and the caregiver on it
//      must equal the one we set, or the result is "failed", whatever the
//      status code said.
//   3. If the visit cannot be identified with CERTAINTY — a phone-opened case
//      with no visit id, and the client's day holds zero or several
//      unassigned visits — the answer is "assign by hand in AxisCare",
//      never a guess. A wrong write here puts a caregiver on the wrong shift.
//
// Auth: JWT-verified (deploy WITHOUT --no-verify-jwt). The hub calls it with
// the signed-in coordinator's session token, same as ai-draft-followup.
// The result is stamped onto the case (c.axiscare_assignment) so the board
// shows "on the schedule ✓" or "assign by hand: why" — silence is not a state.
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  } })

const AC_VERSION = Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01'
function axisCreds() {
  const order = ['AXISCARE_VISITS_TOKEN', 'AXISCARE_API_KEY', 'AXISCARE_TOKEN']
  let token = ''
  for (const n of order) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site: /^\d+$/.test(site) ? site : '' }
}
// deno-lint-ignore no-explicit-any
async function ac(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; j: any }> {
  const { token, site } = axisCreds()
  if (!token || !site) return { ok: false, status: 0, j: { errors: ['AxisCare credentials not set'] } }
  const r = await fetch(`https://${site}.axiscare.com${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json',
               'X-AxisCare-Api-Version': AC_VERSION,
               ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const j = await r.json().catch(() => ({}))
  return { ok: r.ok && j?.success !== false, status: r.status, j }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS' } })

  // deno-lint-ignore no-explicit-any
  const b: any = await req.json().catch(() => ({}))
  const caseId = String(b.case_id || '')
  if (!caseId) return json({ error: 'case_id required' }, 400)

  const { data: row } = await sb.from('app_data').select('data').eq('key', 'coverage_cases').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const cases: any[] = Array.isArray(row?.data) ? row!.data : []
  const c = cases.find(x => x.id === caseId)
  if (!c) return json({ error: 'no such case' }, 404)
  if (!c.covered_by) return json({ error: 'the case has no confirmed caregiver yet' }, 400)

  const finish = async (status: string, detail: string, extra: Record<string, unknown> = {}) => {
    c.axiscare_assignment = { status, detail, at: new Date().toISOString(), by: 'coverage-assign', ...extra }
    await sb.rpc('upsert_app_data_item', { target_key: 'coverage_cases', item: c })
    try {
      await sb.rpc('upsert_app_data_item', { target_key: 'automation_log', item: {
        id: 'auto_srv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        at: new Date().toISOString(), automation: 'coverage-assign', ran_by: 'server',
        ok: status === 'assigned', dry: false, case_id: caseId, outcome: status, detail } })
    } catch { /* logging never blocks */ }
    return json({ status, detail, ...extra })
  }

  // WHO: the winner's AxisCare caregiver id — from the ask record first,
  // else an exact-name roster match (refused if ambiguous).
  const askedList = (Array.isArray(c.asked) ? c.asked : [])
  const winner = askedList.find((a: any) =>
    String(a.name).toLowerCase() === String(c.covered_by).toLowerCase())
  let cgId = winner?.axiscare_id ? String(winner.axiscare_id) : ''
  if (!cgId) {
    const { data: cgRow } = await sb.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
    // deno-lint-ignore no-explicit-any
    const roster: any[] = Array.isArray(cgRow?.data) ? cgRow!.data : []
    const nameKey = String(c.covered_by).toLowerCase().replace(/\s+/g, ' ').trim()
    const hits = roster.filter(g =>
      `${String(g.first || '').trim()} ${String(g.last || '').trim()}`.toLowerCase() === nameKey && g.axiscare_id)
    if (hits.length === 1) cgId = String(hits[0].axiscare_id)
    else return finish('by_hand',
      hits.length === 0
        ? `no AxisCare id found for "${c.covered_by}" — assign the visit by hand in AxisCare`
        : `"${c.covered_by}" matches ${hits.length} roster rows — assign by hand in AxisCare`)
  }
  if (!/^\d+$/.test(cgId)) return finish('by_hand', `caregiver id "${cgId}" is not numeric — assign by hand in AxisCare`)

  // WHICH VISIT: certain, or by hand.
  let visitId = String(c.axiscare_visit_id || '')
  if (!visitId) {
    if (!c.client_axiscare_id || !c.shift_date)
      return finish('by_hand', 'this case came from a phone call and does not name an exact AxisCare visit — assign it by hand in AxisCare')
    const list = await ac('GET',
      `/api/visits?clientIds=${encodeURIComponent(String(c.client_axiscare_id))}&startDate=${c.shift_date}&endDate=${c.shift_date}`)
    if (!list.ok) return finish('by_hand', `could not read the client's visits (AxisCare ${list.status}) — assign by hand`)
    // deno-lint-ignore no-explicit-any
    const un: any[] = (list.j?.results?.visits ?? []).filter((v: any) => !v?.removed && v?.caregiver?.id == null)
    if (un.length === 1) visitId = String(un[0].id)
    else return finish('by_hand',
      un.length === 0
        ? 'no unassigned visit found for that client on that date — it may already be assigned; check AxisCare'
        : `${un.length} unassigned visits for that client that day — pick the right one by hand in AxisCare`)
  }

  // THE WRITE — then the read-back that decides what we call it.
  const patch = await ac('PATCH', `/api/visits/${encodeURIComponent(visitId)}`, { caregiverId: Number(cgId) })
  if (!patch.ok)
    return finish('failed', `AxisCare refused the assignment (${patch.status}): ${(patch.j?.errors || []).join('; ') || 'no detail'} — assign by hand`, { visit_id: visitId, caregiver_id: cgId })
  const check = await ac('GET', `/api/visits/${encodeURIComponent(visitId)}`)
  const onVisit = String(check.j?.results?.visit?.caregiver?.id ?? check.j?.results?.caregiver?.id ?? '')
  if (!check.ok || onVisit !== cgId)
    return finish('failed',
      `AxisCare said OK but the read-back shows caregiver "${onVisit || 'none'}" on the visit — treat as NOT assigned, do it by hand`,
      { visit_id: visitId, caregiver_id: cgId })

  return finish('assigned',
    `${c.covered_by} is on the AxisCare schedule (visit ${visitId}, verified by read-back)`,
    { visit_id: visitId, caregiver_id: cgId, verified: true })
})
