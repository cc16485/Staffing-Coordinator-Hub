// =============================================================================
// pilot-readiness: ONE-TIME, READ ONLY. Samantha 2026-10-16: "Yes, build the pilot check". Deployed by Desktop 845, called once,
// deleted by the same step. Only the owner's installer can call it (role service_role). Reads AxisCare (active clients,
// responsible parties, the last 60 days of visits) and the Hub (Family Circles, About boxes, caregiver roster, settings) and
// returns the readiness report (rules: _shared/pilot-readiness.ts). Writes nothing anywhere. Contacts nobody.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { clientVisits, visitView, stateOf, estimateRate, type Ax } from '../_shared/family-app.ts'
import { axClients } from '../_shared/client-lookup.ts'
import { report, type Facts } from '../_shared/pilot-readiness.ts'

function axisCreds() {
  let token = ''
  for (const n of ['AXISCARE_API_KEY', 'AXISCARE_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site: /^\d+$/.test(site) ? site : '' }
}
const ax: Ax = async (method, path) => {
  const { token, site } = axisCreds()
  if (!token || !site) return { status: 0, json: { errors: ['AxisCare credentials not set'] } }
  try {
    const r = await fetch(`https://${site}.axiscare.com${path}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': '2023-10-01' } })
    const t = await r.text(); let json: unknown = {}; try { json = t ? JSON.parse(t) : {} } catch { json = {} }
    return { status: r.status, json }
  } catch (e) { return { status: 0, json: { errors: [String(e)] } } }
}
export function roleOf(authHeader: string | null): string | null {
  const t = String(authHeader ?? '').replace(/^Bearer\s+/i, ''), parts = t.split('.')
  if (parts.length !== 3) return null
  try { const p = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))); return typeof p.role === 'string' ? p.role : null } catch { return null }
}
// deno-lint-ignore no-explicit-any
const rowsOf = (x: any): any[] => Array.isArray(x) ? x : (x && typeof x === 'object' ? Object.values(x) : [])
const S = (v: unknown) => String(v ?? '').trim()
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (roleOf(req.headers.get('Authorization')) !== 'service_role') return json({ error: 'owner script only' }, 403)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const key = async (k: string) => (await db.from('app_data').select('data').eq('key', k).maybeSingle()).data?.data
  const st = (await key('ops_settings')) ?? {}
  const tests = new Set((Array.isArray(st.family_app_test_clients) ? st.family_app_test_clients : []).map(String))
  const list = await axClients()
  if (list.error) return json({ error: 'AxisCare clients: ' + list.error }, 502)
  const active = list.clients.filter((c) => c?.status?.active === true && !tests.has(String(c.id)) && !/\btest\b/i.test(`${c?.firstName ?? ''} ${c?.lastName ?? ''}`))
  const { data: circles } = await db.from('care_circles').select('id, axiscare_client_id, active, caregiver_about')
  const { data: contacts } = await db.from('circle_contacts').select('circle_id, email, app_status, stopped_at, axiscare_removed_at')
  const roster = rowsOf(await key('caregivers'))
  const phoneOf = new Map(roster.filter((g) => S(g?.axiscare_id)).map((g) => [S(g.axiscare_id), S(g.phone).replace(/\D/g, '').length >= 10]))
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
  const from = new Date(Date.now() - 60 * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
  const rows: Facts[] = []
  for (const c of active) {
    const id = S(c.id)
    const k = (circles ?? []).filter((x) => S(x.axiscare_client_id) === id && x.active !== false)
    const live = (contacts ?? []).filter((x) => k.some((y) => String(y.id) === String(x.circle_id)) && !x.stopped_at && !x.axiscare_removed_at && x.app_status !== 'revoked')
    const rp = await ax('GET', `/api/clients/${encodeURIComponent(id)}/responsibleParties`)
    const rps = rowsOf(rp.json?.results?.responsibleParties ?? rp.json?.results ?? [])
    let cgs: string[] = []
    try { cgs = [...new Set((await clientVisits(ax, id, from, today)).map(visitView).map((v) => v.caregiver?.axiscare_id).filter(Boolean) as string[])] } catch { cgs = [] }
    const state = stateOf(c)
    let rate: number | null = null, rateFrom: Facts['rateFrom'] = null
    try { const e = await estimateRate(ax, id, state, st, today); rate = e.rate; rateFrom = e.rate == null ? null : (Number(st?.[`family_app_rate_${state}`]) === e.rate ? 'state' : 'client') } catch { /* none */ }
    rows.push({ ax: id, name: [S(c.firstName), S(c.lastName)].filter(Boolean).join(' '), state, clientEmail: S(c.personalEmail ?? c.email) || null,
      rpEmails: rps.map((p) => S(p?.email)).filter(Boolean), circleEmails: live.map((x) => S(x.email)).filter(Boolean),
      appOn: live.filter((x) => x.app_status === 'active').length, rate, rateFrom, about: k.some((x) => S(x.caregiver_about).length > 0),
      recentCaregivers: cgs.length, reachable: cgs.filter((g) => phoneOf.get(g) === true).length })
  }
  return json({ ok: true, count: rows.length, text: report(rows) })
})
