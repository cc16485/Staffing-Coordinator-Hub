// =============================================================================
// profile-intro-watch · THE CAREGIVER PROFILE GOES TO THE FAMILY BEFORE A NEW CAREGIVER ARRIVES (2026-10-28)
// Samantha: "Approved as written, including the 5 decisions as you suggested. Build it with the switch off and start the
// practice week." The rules are in _shared/profile-intro.ts.
//
// Every 15 minutes (cron, the jobs' secret): reads AxisCare's visits for today and tomorrow (GETs only), works out which
// caregivers are new to their client, and (switch on) sends the profile or (switch off, practice) lists what it would send
// and the cards it would make in today's row of profile_intro_runs (kept 30 days).
// It also keeps a year of who has visited whom (caregiver_client_history), learned from AxisCare four weeks at a time:
// the first runs fill the last 12 months; after that, one day at a time. Until it has the whole year, nothing is sent or
// listed, and the run says so.
//
//   POST (the schedule, or the owner's server key)      the run. ?dry=1 works it out, sends nothing and keeps no list
//                                                        (it may still learn visit history, which is only AxisCare's own facts).
//   POST {action:'view'} (signed-in office staff)        the last 14 days of runs and the switch, for Settings.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jobCaller } from '../_shared/job-auth.ts'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { loadQuiet, isQuiet, isNotClient } from '../_shared/client-quiet.ts'
import { isPlaceholderCaregiver } from '../_shared/cg-placeholder.ts'
import { contactForOutbound } from '../_shared/outreach.ts'
import { ghlSendChecked } from '../_shared/send-problems.ts'
import * as P from '../_shared/profile-intro.ts'

// deno-lint-ignore no-explicit-any
type Any = any
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
/* Settings calls the view from the browser (CORS from day one) */
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const S = (v: unknown) => String(v ?? '').trim()
const rowsOf = (x: Any): Any[] => Array.isArray(x) ? x : (x && typeof x === 'object' ? Object.values(x) : [])
const nm = (o: Any) => [S(o?.goesBy) || S(o?.firstName), S(o?.lastName)].filter(Boolean).join(' ')
export const WINDOWS_PER_RUN = 4, KEEP_RUN_DAYS = 30

function axCreds() {
  let token = ''
  for (const n of ['AXISCARE_VISITS_TOKEN', 'AXISCARE_API_KEY', 'AXISCARE_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site: /^\d+$/.test(site) ? site : '' }
}
/** every visit from..to (paged, 3 tries on 429) */
async function axVisits(from: string, to: string): Promise<{ ok: boolean; rows: Any[]; error?: string }> {
  const { token, site } = axCreds()
  if (!token || !site) return { ok: false, rows: [], error: 'AxisCare credentials are not set' }
  const rows: Any[] = []
  let url: string | null = `https://${site}.axiscare.com/api/visits?startDate=${from}&endDate=${to}`
  try {
    for (let page = 0; url && page < 60; page++) {
      let r: Response | null = null
      for (let i = 0; i < 3; i++) {
        r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': '2023-10-01' } })
        if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 2000 * (i + 1))); continue }
        break
      }
      if (!r || !r.ok) return { ok: false, rows, error: `AxisCare's visit list answered ${r?.status ?? 'nothing'}` }
      const j: Any = await r.json().catch(() => ({}))
      rows.push(...rowsOf(j?.results?.visits ?? j?.visits))
      url = j?.results?.nextPage ?? j?.nextPage ?? null
    }
  } catch (e) { return { ok: false, rows, error: 'AxisCare could not be reached: ' + String(e).slice(0, 120) } }
  return url ? { ok: false, rows, error: 'the visit list was longer than this reads' } : { ok: true, rows }
}
const clockAt = (c: Any) => { const t = Date.parse(S(c?.time ?? c)); return Number.isFinite(t) ? t : null }
const completed = (v: Any) => { if (!v || v.removed) return false; const a = clockAt(v.clockIn), b = clockAt(v.clockOut); return a != null && b != null && b > a }

/** learn up to WINDOWS_PER_RUN four-week windows of completed visits into caregiver_client_history */
async function learnHistory(today: string): Promise<{ ok: boolean; through: string; error?: string }> {
  const yesterday = P.addDays(today, -1), oldest = P.addDays(today, -P.LOOKBACK_DAYS)
  const { data: st } = await sb.from('app_data').select('data').eq('key', 'profile_intro_history').maybeSingle()
  let through = S(st?.data?.through)
  if (!through || through < P.addDays(oldest, -1)) through = P.addDays(oldest, -1)
  for (let n = 0; n < WINDOWS_PER_RUN && through < yesterday; n++) {
    const from = P.addDays(through, 1), end = P.addDays(from, 27), to = end < yesterday ? end : yesterday
    const r = await axVisits(from, to)
    if (!r.ok) return { ok: false, through, error: r.error }
    const best = new Map<string, Any>()
    for (const v of r.rows) {
      if (!completed(v)) continue
      const c = S(v?.client?.id), g = S(v?.caregiver?.id), day = S(v?.scheduledStartDate ?? v?.startDate).slice(0, 10)
      if (!c || !g || !day || isPlaceholderCaregiver(v?.caregiver?.firstName, v?.caregiver?.lastName)) continue
      const k = P.pairKey(c, g), had = best.get(k)
      if (!had || day > had.last_day) best.set(k, { client_axiscare_id: c, caregiver_axiscare_id: g, last_day: day })
    }
    const list = [...best.values()]
    /* oldest window first, so a later window's day always lands last */
    for (let i = 0; i < list.length; i += 500) {
      const { error } = await sb.from('caregiver_client_history').upsert(list.slice(i, i + 500))
      if (error) return { ok: false, through, error: "the visit history couldn't be saved: " + error.message }
    }
    through = to
    const { error: e2 } = await sb.from('app_data').upsert({ key: 'profile_intro_history', data: { through, at: new Date().toISOString() } })
    if (e2) return { ok: false, through, error: "the visit history's progress couldn't be saved" }
  }
  return through >= yesterday ? { ok: true, through } : { ok: false, through, error: `still learning a year of visits (through ${through})` }
}

function deps(today: string, ghl: { token: string; locationId: string } | null, dry: boolean) {
  const h = ghl ? { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' } : {}
  const since = P.addDays(today, -P.LOOKBACK_DAYS)
  const d: P.IntroDeps = {
    now: () => new Date(),
    settings: async () => { const { data } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle(); return data?.data ?? {} },
    visits: async () => {
      await loadQuiet(sb)   // paused and ended clients, and not-client records
      const r = await axVisits(today, P.addDays(today, 1))
      if (!r.ok) return { ok: false, rows: [], error: r.error }
      const rows: P.Visit[] = []
      for (const v of r.rows) {
        if (!v || v.removed || v?.caregiver?.id == null || v?.client?.id == null) continue
        if (isPlaceholderCaregiver(v.caregiver.firstName, v.caregiver.lastName) || isQuiet(v) || isNotClient(v)) continue
        rows.push({ id: S(v.id), client: S(v.client.id), clientName: nm(v.client) || `AxisCare client #${S(v.client.id)}`,
          cg: S(v.caregiver.id), cgName: nm(v.caregiver) || 'A caregiver', start: S(v.scheduledStartDate ?? v.startDate) })
      }
      return { ok: true, rows }
    },
    history: async () => {
      const l = await learnHistory(today)
      if (!l.ok) return { ok: false, pairs: new Set(), clients: new Set(), error: l.error }
      const pairs = new Set<string>(), clients = new Set<string>()
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from('caregiver_client_history').select('client_axiscare_id, caregiver_axiscare_id').gte('last_day', since).range(from, from + 999)
        if (error) return { ok: false, pairs, clients, error: "the visit history couldn't be read" }
        for (const r of data ?? []) { pairs.add(P.pairKey(r.client_axiscare_id, r.caregiver_axiscare_id)); clients.add(S(r.client_axiscare_id)) }
        if (!data || data.length < 1000) break
      }
      return { ok: true, pairs, clients }
    },
    introduced: async () => {
      const { data } = await sb.from('caregiver_intro_log').select('client_axiscare_id, caregiver_axiscare_id')
        .gte('sent_at', since + 'T00:00:00Z').not('client_axiscare_id', 'is', null).not('caregiver_axiscare_id', 'is', null).not('sent_to', 'is', null)
      return new Set((data ?? []).map((r: Any) => P.pairKey(r.client_axiscare_id, r.caregiver_axiscare_id)))
    },
    ledger: async () => {
      const { data } = await sb.from('profile_intro_pairs').select('*')
      return new Map((data ?? []).map((r: Any) => [S(r.id), r]))
    },
    saveLedger: async (row) => { if (dry) return;
      const keep = ['id', 'client_axiscare_id', 'caregiver_axiscare_id', 'client_name', 'caregiver_name', 'visit_id', 'visit_start', 'reason',
        'status', 'tries', 'last_try', 'sent_at', 'sent_to', 'card', 'card_at', 'why']
      const r: Any = { updated_at: new Date().toISOString() }; for (const k of keep) if (k in row) r[k] = row[k]
      await sb.from('profile_intro_pairs').upsert(r)
    },
    profileOf: async (cg) => {
      const { data } = await sb.from('caregiver_profiles').select('id, first_name, preferred_name, last_name, published, status, axiscare_id')
        .eq('axiscare_id', cg).eq('published', true)
      const live = (data ?? []).filter((p: Any) => p.status !== 'withdrawn')
      return live.length === 1 ? { profile: live[0], why: '' } : { profile: null, why: live.length ? 'two published profiles' : 'no published profile' }
    },
    circleOf: async (client) => {
      const { data: circs } = await sb.from('care_circles').select('id, client_name').eq('active', true).eq('axiscare_client_id', client)
      if (!circs || circs.length !== 1) return { circle: null, contacts: [], why: circs && circs.length > 1 ? 'two family circles are linked to them' : 'their family circle isn\'t linked to AxisCare' }
      const { data: mem } = await sb.from('circle_contacts').select('*').eq('circle_id', circs[0].id)
      return { circle: circs[0], contacts: mem ?? [], why: '' }
    },
    coordinatorOf: async (client) => {
      const { data } = await sb.from('client_journey').select('assigned_cc, updated_at').eq('axiscare_client_id', client).order('updated_at', { ascending: false }).limit(1)
      return S(data?.[0]?.assigned_cc).toLowerCase() || null
    },
    send: async (c, channel, msg) => {
      if (!ghl) return { ok: false, why: 'GoHighLevel is not connected' }
      const first = S(c.name).split(/\s+/)[0] || 'there'
      let opted = false
      const dest = await contactForOutbound(sb, ghl, { phone: channel === 'sms' ? c.phone : '', email: channel === 'email' ? c.email : '', firstName: first,
        lastName: S(c.name).split(/\s+/).slice(1).join(' ') }, 'reactive_external',
        { audience: 'family', explicitlyEnabled: true, channel, sender: 'profile-intro', onOptOut: () => { opted = true } })
      if (!dest) return opted ? { ok: false, optedOut: true, why: 'opted out' } : { ok: false, why: 'the outbound door refused it' }
      const ok = await ghlSendChecked(sb, h as Record<string, string>, 'profile-intro',
        { channel, contactId: dest.contactId, address: channel === 'sms' ? c.phone : c.email, who: c.name },
        channel === 'sms' ? { message: msg.text } : { subject: msg.subject, html: msg.html })
      return ok ? { ok: true } : { ok: false, why: 'GoHighLevel did not take it' }
    },
    logIntro: async (row) => { if (dry) return; await sb.from('caregiver_intro_log').insert(row) },
    officeItem: async (item) => { if (dry) return; await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item }) },
    closeItem: async (id, note) => { if (dry) return;
      const { data } = await sb.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
      const cur = rowsOf(data?.data).find((x: Any) => x && x.id === id)
      if (cur && cur.status !== 'done') await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { ...cur, status: 'done',
        closed_at: new Date().toISOString(), closed_by: 'caregiver profile check', close_note: note } })
    },
  }
  return d
}

/** today's row: what would go / went and the cards, merged across the day's runs (one line per pair) */
async function saveRun(today: string, out: Any) {
  const { data: cur } = await sb.from('profile_intro_runs').select('*').eq('run_day', today).maybeSingle()
  const merge = (a: Any[], b: Any[], key: (x: Any) => string) => { const m = new Map(a.map((x) => [key(x), x])); for (const x of b) m.set(key(x), { ...m.get(key(x)), ...x }); return [...m.values()] }
  const row = { run_day: today, ran_at: new Date().toISOString(), live: !!out.live, ok: !out.problems.length,
    problems: out.problems, would: merge(cur?.would ?? [], out.would, (x) => x.pair), cards: merge(cur?.cards ?? [], out.cards, (x) => x.pair + '|' + x.kind),
    sent: (Number(cur?.sent) || 0) + (out.sent || 0) }
  await sb.from('profile_intro_runs').upsert(row)
  await sb.from('profile_intro_runs').delete().lt('run_day', P.addDays(today, -KEEP_RUN_DAYS))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const body = await req.json().catch(() => ({}))
  if (body?.action === 'view') {
    const who = await requireStaff(sb, req, OFFICE_ROLES)
    if (!who.ok) return json({ error: who.error }, who.status)
    const { data: runs } = await sb.from('profile_intro_runs').select('*').order('run_day', { ascending: false }).limit(14)
    const { data: st } = await sb.from('app_data').select('data').eq('key', 'profile_intro_history').maybeSingle()
    return json({ ok: true, runs: runs ?? [], history_through: st?.data?.through ?? null })
  }
  const caller = await jobCaller(req)
  if (!caller) return json({ error: 'not allowed' }, 401)
  if (new URL(req.url).searchParams.get('auth_check') === '1') return json({ ok: true, caller })
  const dry = new URL(req.url).searchParams.get('dry') === '1'
  const today = P.chiNow(new Date()).slice(0, 10)
  const tok = Deno.env.get('GHL_TOKEN'), loc = Deno.env.get('GHL_LOCATION_ID')
  try {
    const out: Any = await P.profileIntro(deps(today, tok && loc ? { token: tok, locationId: loc } : null, dry), { dry })
    if (!dry && !out.off) await saveRun(today, out)
    return json({ ok: true, dry, saved: !dry && !out.off, ...out })
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).slice(0, 300)
    if (!dry) await saveRun(today, { live: false, problems: ['the run stopped: ' + msg], would: [], cards: [], sent: 0 }).catch(() => {})
    return json({ ok: false, error: msg }, 500)
  }
})
