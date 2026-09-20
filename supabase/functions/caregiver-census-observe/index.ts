// =============================================================================
// caregiver-census-observe — the census-diff net. LOG ONLY.
// =============================================================================
// Her B1.3 order (2026-09-20): using the same proven, SEND-INCAPABLE census
// read as caregiver-census-report, notice
//     "AxisCare caregiver ID present now but absent from every previous
//      observed census"
// and log that observation. It must never confuse a REACTIVATION
// (inactive → active on an id we have seen before) with a genuinely newly
// observed id — the state map stores first_seen id/time/status so the two
// are distinguishable forever. Eventually these observations reconcile
// against the webhook receiver's log to prove whether webhook delivery is
// complete.
//
// LOG ONLY: no Hire Connect item, no writes to recruiting records, no
// messaging, no tasks. Its only writes are its own state + observation items
// in app_data `caregiver_census_state` (fail-closed key map row added by the
// deploy script). All AxisCare calls are GETs.
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

import { createClient } from 'npm:@supabase/supabase-js@2'

Deno.serve(async (req) => {
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
  if (callerRole(req) !== 'service_role') return json({ error: 'service role required' }, 403)

  const { token, site } = axisCreds()
  if (!token || !/^\d+$/.test(site)) return json({ error: 'AxisCare credentials not set' }, 502)
  const runAt = new Date().toISOString()

  // full census, GETs only, rowsOf everywhere (the 172 lesson)
  const seen = new Map<string, { active: boolean; label: string }>()
  let url: string | null = `https://${site}.axiscare.com/api/caregivers`
  let pages = 0
  while (url && pages < 20) {
    pages++
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json',
      'X-AxisCare-Api-Version': Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01' } })
    if (!r.ok) return json({ error: `AxisCare responded ${r.status} on page ${pages}` }, 502)
    // deno-lint-ignore no-explicit-any
    const j: any = await r.json().catch(() => ({}))
    for (const g of rowsOf(j?.results?.caregivers ?? j?.caregivers)) {
      if (g?.id == null) continue
      seen.set(String(g.id), { active: g?.status?.active === true, label: String(g?.status?.label ?? '') })
    }
    url = j?.results?.nextPage ?? j?.nextPage ?? j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
  }
  if (url) return json({ error: 'census truncated at 20 pages — refusing to diff a partial census' }, 502)
  if (seen.size === 0) return json({ error: 'empty census — refusing to diff' }, 502)

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: row } = await sb.from('app_data').select('data').eq('key', 'caregiver_census_state').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const items: any[] = Array.isArray(row?.data) ? row!.data : []
  // deno-lint-ignore no-explicit-any
  const state: any = items.find((x: any) => x?.id === 'state') ?? null

  const put = (item: Record<string, unknown>) =>
    sb.rpc('upsert_app_data_item', { target_key: 'caregiver_census_state', item })

  if (!state) {
    /* FIRST RUN = BASELINE. Every id is recorded as first_seen NOW with its
       current status; nothing is "newly observed" on a baseline — that would
       be 598 false events. */
    const map: Record<string, unknown> = {}
    for (const [id, s] of seen) map[id] = { first_seen: runAt, first_seen_active: s.active, last_active: s.active, last_label: s.label, last_seen: runAt }
    await put({ id: 'state', map, baseline_at: runAt, last_run: runAt, last_total: seen.size })
    await put({ id: 'obs_baseline_' + Date.now(), kind: 'baseline', observed_at: runAt,
      total: seen.size, active: [...seen.values()].filter(s => s.active).length })
    return json({ ok: true, mode: 'baseline', total: seen.size })
  }

  const map = state.map ?? {}
  const newlyObserved: string[] = []
  const reactivated: string[] = []
  for (const [id, s] of seen) {
    const prior = map[id]
    if (!prior) {
      newlyObserved.push(id)
      map[id] = { first_seen: runAt, first_seen_active: s.active, last_active: s.active, last_label: s.label, last_seen: runAt }
      await put({ id: 'obs_' + Date.now() + '_' + id, kind: 'newly_observed_id', axiscare_id: id,
        observed_at: runAt, status_at_first_sight: s.active ? 'active' : (s.label || 'inactive') })
    } else {
      if (prior.last_active === false && s.active === true) {
        reactivated.push(id)
        await put({ id: 'obs_' + Date.now() + '_re_' + id, kind: 'reactivated', axiscare_id: id,
          observed_at: runAt, first_seen: prior.first_seen,
          note: 'previously observed id returned to active — NOT a new caregiver' })
      }
      prior.last_active = s.active; prior.last_label = s.label; prior.last_seen = runAt
    }
  }
  state.map = map; state.last_run = runAt; state.last_total = seen.size
  await put(state)
  return json({ ok: true, mode: 'diff', total: seen.size, newly_observed: newlyObserved, reactivated })
})
