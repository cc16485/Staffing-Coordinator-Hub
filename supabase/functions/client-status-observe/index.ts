// =============================================================================
// client-status-observe — the Defect-4 evidence collector (LOG-ONLY)
// =============================================================================
// AxisCare only publishes client.created / client.updated, so hold, restart,
// discharge and readmission can never arrive as events. Before ANY lifecycle
// behavior may key on status changes, she requires the real transition
// vocabulary, observed, not guessed.
//
// This function is side-effect-free BY CONSTRUCTION, not by flag:
//   - its only outbound call is a GET of the AxisCare client census
//   - its only writes are to one app_data key: client_status_log
//   - it contains no SOC code, no launch code, no client_queue access,
//     no task creation, no messaging client, and no AxisCare writes,
//     because none of that code exists in this file
//   - it records transitions; it never classifies one as hold / discharge /
//     readmission / restart. Interpretation is a later, human-reviewed step.
//
// Each run: read census -> compare each client's status label to the last
// observed -> append a transition record for every change -> update the
// last-seen map. First run baselines silently (every client is "new to the
// log", which is not a transition).
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const sb = createClient(SUPABASE_URL, SERVICE_KEY)

const S = (v: unknown) => String(v ?? '').trim()

function axisCreds() {
  const order = ['AXISCARE_API_KEY', 'AXISCARE_TOKEN', 'AXISCARE_VISITS_TOKEN']
  let token = ''
  for (const n of order) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 })
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })

  const { token, site } = axisCreds()
  if (!token || !site) return json({ error: 'AxisCare credentials not set' }, 502)

  const runId = 'obs_' + new Date().toISOString().replace(/[:.]/g, '') + '_' + Math.random().toString(36).slice(2, 6)
  const observedAt = new Date().toISOString()

  // ── read the census (paged, statuses included) ────────────────────────────
  // deno-lint-ignore no-explicit-any
  const clients: any[] = []
  let url: string | null = `https://${site}.axiscare.com/api/clients`
  let pages = 0
  while (url && pages < 12) {
    pages++
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json',
      'X-AxisCare-Api-Version': Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01' } })
    if (!r.ok) return json({ error: `census read failed: HTTP ${r.status}`, run_id: runId }, 502)
    const j = await r.json().catch(() => ({}))
    // deno-lint-ignore no-explicit-any
    const rows = (j as any)?.results?.clients ?? (j as any)?.results ?? []
    for (const c of (Array.isArray(rows) ? rows : [])) if (c?.id != null) clients.push(c)
    // deno-lint-ignore no-explicit-any
    url = (j as any)?.results?.nextPage ?? (j as any)?.nextPage ?? null
  }
  if (!clients.length) return json({ error: 'census returned no clients — nothing recorded', run_id: runId }, 502)

  // ── last-seen map lives as one item in the log key ────────────────────────
  const { data: row } = await sb.from('app_data').select('data').eq('key', 'client_status_log').maybeSingle()
  const list: Record<string, unknown>[] = Array.isArray(row?.data) ? row!.data : []
  const latest = (list.find(x => x.id === 'latest') ?? { id: 'latest', map: {} }) as { id: string; map: Record<string, string> }
  const firstRun = !list.some(x => x.id === 'latest')

  let transitions = 0, baselined = 0
  for (const c of clients) {
    const id = String(c.id)
    const label = S(c?.status?.label) || (c?.status?.active === true ? 'Active' : 'Unknown')
    const prev = latest.map[id]
    if (prev === undefined) {
      baselined++                      // new to the log — a baseline, not a transition
    } else if (prev !== label) {
      transitions++
      const rec = {
        id: `tr_${id}_${observedAt.replace(/[:.]/g, '')}`,
        axiscare_client_id: id,
        old_status_label: prev,
        new_status_label: label,
        raw_status: c?.status ?? null,        // the untouched value, for later analysis
        observed_at: observedAt,
        run_id: runId,
        source: 'poll',
      }
      const { error } = await sb.rpc('upsert_app_data_item', { target_key: 'client_status_log', item: rec })
      if (error) console.error('transition write failed:', error.message, rec.id)
    }
    latest.map[id] = label
  }

  const { error: mapErr } = await sb.rpc('upsert_app_data_item', { target_key: 'client_status_log', item: latest })
  if (mapErr) return json({ error: 'last-seen map write failed: ' + mapErr.message, run_id: runId }, 500)

  console.log(`observe ${runId}: ${clients.length} clients, ${transitions} transitions, ${baselined} baselined${firstRun ? ' (first run)' : ''}`)
  return json({ ok: true, run_id: runId, clients: clients.length,
    transitions_recorded: transitions, baselined, first_run: firstRun })
})
