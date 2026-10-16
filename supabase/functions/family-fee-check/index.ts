// =============================================================================
// family-fee-check: the month-end App fee check for the family app (her yes 2026-10-16). Rules: _shared/family-fee.ts.
// Cron (x-cron-secret) or the owner's server key, on the 1st of each month: checks LAST month for every App plan client
// and puts ONE card on the office's list when anyone had no visits (add the fee to their AxisCare invoice) or couldn't
// be checked. ?dry=1 = say what it found, save nothing, no card. Never charges anything; never contacts a family.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { monthlyFeeRun, runFeeCheck, lastMonth, type FeeDeps } from '../_shared/family-fee.ts'
import { jobCaller } from '../_shared/job-auth.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const AC_VERSION = '2023-10-01'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
function axisCreds() {
  let token = ''
  for (const n of ['AXISCARE_API_KEY', 'AXISCARE_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site: /^\d+$/.test(site) ? site : '' }
}
// deno-lint-ignore no-explicit-any
async function ax(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const { token, site } = axisCreds()
  if (!token || !site) return { status: 0, json: { errors: ['AxisCare credentials not set'] } }
  try {
    const r = await fetch(`https://${site}.axiscare.com${path}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json',
      'Content-Type': 'application/json', 'X-AxisCare-Api-Version': AC_VERSION, 'User-Agent': 'CaringCompanions-Hub/1.0 (+https://mo-care.com)' },
      body: body === undefined ? undefined : JSON.stringify(body) })
    const t = await r.text(); let j: unknown = {}
    try { j = t ? JSON.parse(t) : {} } catch { j = { message: t.slice(0, 200) } }
    return { status: r.status, json: j }
  } catch (e) { return { status: 0, json: { errors: [String((e as Error).message ?? e)] } } }
}
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const deps = (dry: boolean): FeeDeps => ({
  ax, now: () => new Date(),
  settings: async () => (await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()).data?.data ?? {},
  appClients: async () => ((await db.from('care_circles').select('id, client_name, axiscare_client_id, app_plan_since, active').eq('app_plan', true)).data ?? [])
    // deno-lint-ignore no-explicit-any
    .filter((k: any) => k.active !== false && k.axiscare_client_id).map((k: any) => ({ circle_id: String(k.id), axiscare_client_id: String(k.axiscare_client_id), client_name: String(k.client_name ?? ''), app_plan_since: k.app_plan_since ?? null })),
  checks: async (month) => (await db.from('family_app_fees').select('*').eq('month', month)).data ?? [],
  saveCheck: async (row) => dry || !(await db.from('family_app_fees').upsert(row, { onConflict: 'month,axiscare_client_id' })).error,
  officeItem: async (item) => dry || !(await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item })).error,
})
async function beat(ok: boolean, note: string) {
  try { await db.rpc('upsert_app_data_item', { target_key: 'automation_heartbeats', item: { id: 'hb_family-fee-check', automation: 'family-fee-check', at: new Date().toISOString(), ok, note: String(note).slice(0, 300) } }) } catch { /* never waits on this */ }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const caller = await jobCaller(req)
  if (!caller) return json({ error: 'not allowed' }, 401)
  const dry = new URL(req.url).searchParams.get('dry') === '1'
  try {
    if (dry) { const out = await runFeeCheck(deps(true), lastMonth(new Date()), 'dry run'); return json({ ok: true, dry, ...out }) }
    const out = await monthlyFeeRun(deps(false))
    await beat(true, `${out.month}: ${out.rows.length} app clients, ${out.owe} to bill, ${out.couldnt_check} couldn't check`)
    return json({ ok: true, ...out })
  } catch (e) {
    await beat(false, String((e as Error)?.message ?? e))
    return json({ error: 'The App fee check did not finish. Please try again.' }, 500)
  }
})
