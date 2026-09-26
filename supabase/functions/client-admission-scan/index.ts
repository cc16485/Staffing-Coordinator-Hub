// =============================================================================
// client-admission-scan — open human-confirmation admission cases
// =============================================================================
// For every AxisCare client the status watcher last saw as Active that has NO
// Hub person, open an admission case (name + phones from AxisCare, phone-match
// suggestions from the identity layer) so Client Intake can confirm who it is.
//
//   * Reads: app_data client_status_log (the watcher's census), person_source_id,
//     and AxisCare GET /api/clients?clientIds=… (read only).
//   * Writes: ONLY through client_admission_open(), which is idempotent and never
//     creates, links or merges a person. Identity is resolved by a human later.
//   * Caller must be service_role. The platform gateway verifies the token's
//     signature (verify_jwt is on); this handler then requires role ===
//     'service_role', the same check identity-resolve uses. anon and
//     authenticated (browser) tokens are refused.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const sb = createClient(SUPABASE_URL, SERVICE_KEY)

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

// same helper as identity-resolve: the gateway has already verified the signature
function jwtRole(authHeader: string | null): string | null {
  const m = /^Bearer\s+(.+)$/.exec(authHeader ?? '')
  if (!m) return null
  const parts = m[1].split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof payload.role === 'string' ? payload.role : null
  } catch { return null }
}

function axisCreds() {
  let token = ''
  for (const n of ['AXISCARE_API_KEY', 'AXISCARE_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (jwtRole(req.headers.get('Authorization')) !== 'service_role') {
    return json({ error: 'service_role required; this endpoint is never for browsers' }, 403)
  }
  const { token, site } = axisCreds()
  if (!token || !/^\d+$/.test(site)) return json({ error: 'AxisCare credentials not set' }, 502)

  // the watcher's last observed census
  const { data: row, error: rowErr } = await sb.from('app_data').select('data, updated_at')
    .eq('key', 'client_status_log').maybeSingle()
  if (rowErr) return json({ error: 'census read failed: ' + rowErr.message }, 500)
  // deno-lint-ignore no-explicit-any
  const list: any[] = Array.isArray(row?.data) ? row!.data : []
  const map: Record<string, string> = (list.find((x) => x?.id === 'latest')?.map) ?? {}
  const observedAt = (row as { updated_at?: string } | null)?.updated_at ?? new Date().toISOString()
  const active = Object.keys(map).filter((k) => map[k] === 'Active')
  if (!active.length) return json({ ok: true, active: 0, unlinked: 0, results: [] })

  const { data: links, error: linkErr } = await sb.from('person_source_id').select('source_id')
    .eq('system', 'axiscare').eq('entity_type', 'client').in('source_id', active)
  if (linkErr) return json({ error: 'identity read failed: ' + linkErr.message }, 500)
  const linked = new Set((links ?? []).map((l) => String(l.source_id)))
  const unlinked = active.filter((id) => !linked.has(id)).slice(0, 50)
  if (!unlinked.length) return json({ ok: true, active: active.length, unlinked: 0, results: [] })

  // AxisCare details for the unlinked ids (read only)
  const r = await fetch(`https://${site}.axiscare.com/api/clients?clientIds=${unlinked.join(',')}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': '2023-10-01' },
  })
  if (!r.ok) return json({ error: `AxisCare read failed: HTTP ${r.status}`, unlinked: unlinked.length }, 502)
  const body = await r.json().catch(() => ({}))
  // deno-lint-ignore no-explicit-any
  const rows: any[] = (body as any)?.results?.clients ?? []
  // deno-lint-ignore no-explicit-any
  const byId = new Map<string, any>(rows.map((c) => [String(c?.id), c]))

  const results: Array<{ axiscare_client_id: string; outcome: string; case_id?: string; suggestions?: number }> = []
  for (const id of unlinked) {
    const c = byId.get(id)
    const name = c ? [c.firstName, c.lastName].map((x: unknown) => String(x ?? '').trim()).filter(Boolean).join(' ') : ''
    const phones = c ? [c.mobilePhone, c.homePhone, c.otherPhone].map((x: unknown) => String(x ?? '').trim()).filter(Boolean) : []
    const { data, error } = await sb.rpc('client_admission_open', {
      p_axiscare_client_id: id, p_observed_label: 'Active', p_observed_at: observedAt,
      p_axiscare_name: name || null, p_axiscare_phones: phones, p_opened_by: 'client-admission-scan',
    })
    if (error) { results.push({ axiscare_client_id: id, outcome: 'error: ' + error.message }); continue }
    results.push({ axiscare_client_id: id, outcome: data?.outcome, case_id: data?.case_id, suggestions: data?.suggestions })
  }
  console.log(`admission-scan: ${active.length} active, ${unlinked.length} unlinked, ` +
              results.map((x) => x.outcome).join(','))
  return json({ ok: true, active: active.length, unlinked: unlinked.length, observed_at: observedAt, results })
})
