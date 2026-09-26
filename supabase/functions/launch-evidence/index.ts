// Supabase Edge Function: launch-evidence (shared hub project) · Change 1, 2026-09-26
// ---------------------------------------------------------------------------
// New Clients reads what AxisCare already knows: is there a schedule, who is
// the caregiver, did the first shift really happen (clock-in AND clock-out),
// did EVV work. Actual SOC is the first shift's clock-in date.
//
// IT IMPORTS THE HUB'S OWN DECISION FILE, https://cc.mo-care.com/launch-evidence.js,
// the exact bytes the New Clients card loads. No second copy of the rules here:
// if that fetch fails this function STOPS.
//
// READS AXISCARE ONLY. Nothing is written to AxisCare. Writes to our database
// go through ONE door, launch_evidence_record(), which ticks an existing launch
// box only while it is still empty and keeps the proof.
//
// Actions (POST JSON):
//   refresh {launch_id}                    signed-in staff; the card, when it opens
//   record  {launch_id, fact, reason, date?, name?}
//                                          signed-in staff; "Record by hand" when
//                                          AxisCare cannot show it (reason required)
//   run                                    the scheduler: every open launch
//
// ⚠ Nothing is recorded from AxisCare unless app_data 'ops_settings' has
// launch_evidence_live === true (refresh still SHOWS what AxisCare says).
// Hand records are a person's deliberate act and are not behind the switch.
// Replies to the scheduler (public key) with counts only; names appear only
// for a service-role caller (the owner's report script) or signed-in staff.
// ---------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const ENGINE_URL = 'https://cc.mo-care.com/launch-evidence.js'
const AC_VERSION = Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01'
const AUTOMATION = 'automation:launch-evidence'
const MAX_PER_RUN = 25          // launches read per scheduled run
const MAX_AGE_DAYS = 120        // launches opened longer ago than this are left to people
const AHEAD_DAYS = 42           // how far ahead to read the schedule
const FACTS = ['schedule', 'caregiver', 'first_shift', 'evv']

export function jwtClaims(authHeader: string | null): { role: string | null; email: string | null } {
  const m = /^Bearer\s+(.+)$/.exec(authHeader ?? '')
  if (!m) return { role: null, email: null }
  const parts = m[1].split('.')
  if (parts.length !== 3) return { role: null, email: null }
  try {
    const p = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    return { role: typeof p.role === 'string' ? p.role : null,
             email: typeof p.email === 'string' ? p.email.trim().toLowerCase() : null }
  } catch { return { role: null, email: null } }
}
export function cleanUuid(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s) ? s : null
}
export function chicagoDay(d: Date, addDays = 0): string {
  const x = new Date(d.getTime() + addDays * 86400000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(x)
}
// deno-lint-ignore no-explicit-any
const rowsOf = (v: any): any[] => Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : [])

function axisCreds() {
  let token = ''
  for (const n of ['AXISCARE_VISITS_TOKEN', 'AXISCARE_API_KEY', 'AXISCARE_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site: /^\d+$/.test(site) ? site : '' }
}

/* One client's visits over the launch window, every page. Throws with
   .status 429 when AxisCare asks us to slow down. */
// deno-lint-ignore no-explicit-any
export async function clientVisits(ax: string, from: string, to: string): Promise<any[]> {
  const { token, site } = axisCreds()
  if (!token || !site) throw Object.assign(new Error('AxisCare credentials not set'), { status: 0 })
  const base = `https://${site}.axiscare.com`
  let url: string | null = `${base}/api/visits?clientIds=${encodeURIComponent(ax)}&startDate=${from}&endDate=${to}`
  // deno-lint-ignore no-explicit-any
  const out: any[] = []
  for (let page = 0; url && page < 20; page++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': AC_VERSION } })
    if (!r.ok) throw Object.assign(new Error('AxisCare answered ' + r.status), { status: r.status })
    // deno-lint-ignore no-explicit-any
    const j: any = await r.json().catch(() => ({}))
    for (const v of rowsOf(j?.results?.visits ?? j?.visits)) out.push(v)
    const next = j?.results?.nextPage ?? j?.nextPage ?? j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
    url = typeof next === 'string' && next.startsWith(base + '/') ? next : null
  }
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const { role, email } = jwtClaims(req.headers.get('Authorization'))
  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  const action = typeof b.action === 'string' ? b.action : 'run'
  const staff = role === 'authenticated' && !!email
  const full = role === 'service_role'
  if (action !== 'run' && !staff) return json({ error: 'sign in to the hub first' }, 401)
  if (action === 'run' && !['anon', 'service_role'].includes(String(role))) return json({ error: 'the scheduled run only' }, 403)

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const started = new Date().toISOString(), t0 = Date.now()

  /* ── the shared decision file; no local fallback ON PURPOSE ─────────────── */
  // deno-lint-ignore no-explicit-any
  let X: any = null
  try {
    const r = await fetch(ENGINE_URL + '?v=' + Math.floor(Date.now() / 300000), { headers: { Accept: 'application/javascript' } })
    if (!r.ok) throw new Error('launch-evidence.js responded ' + r.status)
    const src = await r.text()
    if (!/CCLaunchEvidence/.test(src)) throw new Error('fetched file does not define CCLaunchEvidence')
    ;(0, eval)(src)
    // deno-lint-ignore no-explicit-any
    X = (globalThis as any).CCLaunchEvidence
    if (typeof X?.evaluate !== 'function') throw new Error('CCLaunchEvidence has no evaluate')
  } catch (err) {
    if (action === 'run') await logRun(sb, { ok: false, started, ms: Date.now() - t0, error: 'could not load ' + ENGINE_URL + ': ' + String(err) })
    return json({ error: 'Could not load the shared launch evidence rules', detail: String(err),
                  note: 'Refusing to decide with a second copy of the rules.' }, 502)
  }

  const { data: setRow } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const live = (setRow as any)?.data?.launch_evidence_live === true

  const LCOLS = 'id, client_name, axiscare_client_id, status, episode_n, start_date, added_at, caregiver_assigned, caregiver_assigned_name, schedule_added, evv_verified, first_shift_done, first_shift_done_at'
  // deno-lint-ignore no-explicit-any
  const evidenceFor = async (ids: string[]): Promise<Record<string, any[]>> => {
    // deno-lint-ignore no-explicit-any
    const by: Record<string, any[]> = {}
    if (!ids.length) return by
    const { data, error } = await sb.from('launch_evidence').select('launch_id, fact, source, ticked, evidence, reason, recorded_by, recorded_at').in('launch_id', ids)
    if (error) throw new Error('could not read launch_evidence: ' + error.message)
    for (const e of data ?? []) (by[e.launch_id] ??= []).push(e)
    return by
  }
  // deno-lint-ignore no-explicit-any
  const evaluateOne = async (L: any, evidence: any[]) => {
    const ep = Number(L.episode_n) || 1
    const opened = String(L.added_at ?? '').slice(0, 10)
    const from = ep > 1 && opened > X.GO_LIVE ? opened : X.GO_LIVE
    const visits = await clientVisits(String(L.axiscare_client_id).trim(), from, chicagoDay(new Date(), AHEAD_DAYS))
    return X.evaluate({ launch: L, visits, evidence, now: new Date() })
  }
  // deno-lint-ignore no-explicit-any
  const door = async (launchId: string, ax: string | null, records: any[], source: string, by: string, reason: string | null) => {
    const { data, error } = await sb.rpc('launch_evidence_record', { p_launch_id: launchId, p_axiscare_client_id: ax,
      p_records: records, p_source: source, p_staff: by, p_reason: reason })
    if (error) return { outcome: 'error', detail: error.message }
    return data
  }

  /* ── one card ───────────────────────────────────────────────────────────── */
  if (action === 'refresh') {
    const id = cleanUuid(b.launch_id)
    if (!id) return json({ error: 'launch_id is required' }, 400)
    const { data: L, error } = await sb.from('client_queue').select(LCOLS).eq('id', id).maybeSingle()
    if (error) return json({ error: 'could not read the launch: ' + error.message }, 500)
    if (!L) return json({ error: 'no such launch' }, 404)
    if (!String(L.axiscare_client_id ?? '').trim()) return json({ ok: false, reason: 'no_axiscare_id', live })
    let evidence = (await evidenceFor([id]))[id] ?? []
    // deno-lint-ignore no-explicit-any
    let ev: any
    try { ev = await evaluateOne(L, evidence) }
    catch (e) {
      // deno-lint-ignore no-explicit-any
      const st = (e as any)?.status
      return json({ ok: false, reason: st === 429 ? 'axiscare_busy' : 'axiscare_unreachable', detail: String((e as Error).message ?? e), live, evidence })
    }
    let recorded = null
    if (live && ev.record?.length) {
      recorded = await door(id, String(L.axiscare_client_id).trim(), ev.record, 'axiscare', AUTOMATION, null)
      evidence = (await evidenceFor([id]))[id] ?? []
    }
    return json({ ok: true, live, evaluation: ev, recorded, evidence })
  }

  /* ── a person records a step by hand ────────────────────────────────────── */
  if (action === 'record') {
    const id = cleanUuid(b.launch_id), fact = String(b.fact ?? '')
    const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 500) : ''
    if (!id || !FACTS.includes(fact)) return json({ error: 'launch_id and a known step are required' }, 400)
    if (reason.length < 5) return json({ outcome: 'reason_required' })
    const detail: Record<string, unknown> = {}
    if (fact === 'first_shift') detail.date = typeof b.date === 'string' ? b.date.slice(0, 10) : null
    const rec: Record<string, unknown> = { fact, detail }
    if (fact === 'caregiver' && typeof b.name === 'string' && b.name.trim()) rec.name = b.name.trim().slice(0, 120)
    const out = await door(id, null, [rec], 'person', email!, reason)
    return json(out)
  }

  if (action !== 'run') return json({ error: "action must be 'refresh', 'record' or 'run'" }, 400)

  /* ── the scheduled run: every open launch with an AxisCare id ───────────── */
  const since = chicagoDay(new Date(), -MAX_AGE_DAYS)
  const { data: open, error: qErr } = await sb.from('client_queue').select(LCOLS).neq('status', 'complete')
  if (qErr) {
    await logRun(sb, { ok: false, started, ms: Date.now() - t0, error: 'could not read launches: ' + qErr.message })
    return json({ error: 'could not read launches', detail: qErr.message }, 500)
  }
  // deno-lint-ignore no-explicit-any
  const all = (open ?? []) as any[]
  const withId = all.filter((L) => String(L.axiscare_client_id ?? '').trim())
  const young = withId.filter((L) => String(L.added_at ?? '').slice(0, 10) >= since)
  const batch = young.sort((a, b2) => String(a.added_at).localeCompare(String(b2.added_at))).slice(0, MAX_PER_RUN)
  const counts = { launches_open: all.length, no_axiscare_id: all.length - withId.length, too_old: withId.length - young.length,
                   deferred: young.length - batch.length, read: 0, facts_found: 0, would_record: 0, recorded: 0, ticked: 0,
                   flagged: 0, errors: 0, rate_limited: false }
  // deno-lint-ignore no-explicit-any
  const preview: any[] = [], errors: unknown[] = []
  let evidence: Record<string, unknown[]> = {}
  try { evidence = await evidenceFor(batch.map((L) => L.id)) }
  catch (e) {
    await logRun(sb, { ok: false, started, ms: Date.now() - t0, error: String(e) })
    return json({ error: String(e) }, 500)
  }
  for (const L of batch) {
    // deno-lint-ignore no-explicit-any
    let ev: any
    try { ev = await evaluateOne(L, evidence[L.id] ?? []) }
    catch (e) {
      // deno-lint-ignore no-explicit-any
      if ((e as any)?.status === 429) { counts.rate_limited = true; break }
      counts.errors++; errors.push({ launch: L.id, error: String((e as Error).message ?? e) }); continue
    }
    counts.read++
    const done = new Set(((evidence[L.id] ?? []) as { fact: string; source: string }[]).filter((x) => x.source === 'axiscare').map((x) => x.fact))
    // deno-lint-ignore no-explicit-any
    const fresh = (ev.record ?? []).filter((r: any) => !done.has(r.fact))
    counts.facts_found += (ev.record ?? []).length
    counts.would_record += fresh.length
    counts.flagged += (ev.exceptions ?? []).length
    let result = null
    if (live && fresh.length) {
      // deno-lint-ignore no-explicit-any
      result = await door(L.id, String(L.axiscare_client_id).trim(), fresh, 'axiscare', AUTOMATION, null) as any
      if (result?.outcome === 'recorded') { counts.recorded += (result.recorded ?? []).length; counts.ticked += (result.ticked ?? []).length }
      else if (result?.outcome !== 'nothing_new') { counts.errors++; errors.push({ launch: L.id, door: result }) }
    }
    if (full) preview.push({ client: L.client_name, axiscare_client_id: L.axiscare_client_id,
      // deno-lint-ignore no-explicit-any
      would_record: fresh.map((r: any) => r.fact + (r.tick ? ' (ticks the box)' : '')),
      actual_soc: ev.actual_soc?.date ?? null, first_shift: ev.first_shift?.state,
      // deno-lint-ignore no-explicit-any
      questions: (ev.exceptions ?? []).map((x: any) => x.text), door: result?.outcome ?? null })
    await new Promise((r) => setTimeout(r, 250))
  }
  const summary = { ok: counts.errors === 0, dry: !live, engine_version: X.version ?? null, ...counts, rows_seen: counts.read }
  await logRun(sb, { ok: summary.ok, dry: !live, started, ms: Date.now() - t0, summary })
  return json(full ? { ...summary, preview, error_list: errors } : summary)
})

/* EVERY RUN IS RECORDED, INCLUDING THE ONES THAT DID NOTHING. */
// deno-lint-ignore no-explicit-any
async function logRun(sb: any, row: Record<string, unknown>) {
  try {
    // deno-lint-ignore no-explicit-any
    const s = (row.summary ?? {}) as any
    await sb.rpc('upsert_app_data_item', {
      target_key: 'automation_log',
      item: {
        id: 'auto_srv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        at: new Date().toISOString(), automation: 'launch_evidence', ran_by: 'server',
        ok: row.ok !== false, dry: row.dry === true, duration_ms: row.ms ?? null,
        sources_evaluated: s.read === undefined ? 0 : 1, rows_seen: s.read ?? 0,
        created: s.recorded ?? s.would_record ?? 0, closed: 0, skipped: s.too_old ?? 0, deferred: s.deferred ?? 0,
        flagged: s.flagged ?? 0, rate_limited: s.rate_limited === true,
        errors: s.errors ?? 0, error: row.error ?? null,
      },
    })
  } catch (e) { console.error('[launch-evidence] could not write the run log', e) }
}
