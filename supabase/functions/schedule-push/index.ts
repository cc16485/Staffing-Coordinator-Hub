// =============================================================================
// schedule-push — a finished Team Builder plan becomes AxisCare schedules (Change 4, 2026-09-27)
// =============================================================================
// Signed-in staff only. Writes to AxisCare ONLY on "create" and "undo", which the
// hub sends from the coordinator's click. Nothing runs in the background.
//
//   preview  read only: the schedules the plan would create (one per caregiver and
//            shift, days grouped), the AxisCare client from the plan's Journey, each
//            caregiver's AxisCare id, the services AxisCare is using, the start date
//            default (the Start Contract target), and what the client already has
//   create   creates each schedule on its own (one refusal never stops the others),
//            skips any identical schedule already there, then reads AxisCare back
//   undo     same day only: ends the schedules this plan created, from their start
//            date (or today), so no visits remain
//   permission_check (service role) sends a deliberately incomplete schedule for Test
//            Client 5; the kind of refusal says whether this connection may create
//            schedules. Nothing can be created by it.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/* C2a (2026-09-28): every change in AxisCare adds one line to axiscare_change_log (who, when, which client or caregiver,
   the kind, how it went, a short summary; never note text). Best effort: recording never blocks the change itself. */
// deno-lint-ignore no-explicit-any
async function recordAxisChange(db: any, c: { kind: string; subject: 'client' | 'caregiver'; client?: string | null; caregiver?: string | null;
  outcome: 'sent_confirmed' | 'sent' | 'refused' | 'practice'; summary: string; detail?: string | null; by: string; via: string }): Promise<boolean> {
  try {
    const { data, error } = await db.rpc('axiscare_change_record', { p_kind: c.kind, p_subject: c.subject, p_client: c.client ?? null,
      p_caregiver: c.caregiver ?? null, p_outcome: c.outcome, p_summary: String(c.summary).slice(0, 200), p_detail: c.detail ? String(c.detail).slice(0, 300) : null,
      p_by: c.by || 'unknown', p_via: c.via })
    return !error && data?.outcome === 'recorded'
  } catch { return false }
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const AC_VERSION = '2023-10-01'
const DAY: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' }
const ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

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
export const nameKey = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '')
export const hm = (t: unknown) => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? '')); return m ? m[1].padStart(2, '0') + ':' + m[2] : '' }
export function chicagoDay(d: Date, add = 0): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(d.getTime() + add * 86400000))
}

export type Sched = { key: string; caregiver_id: string; caregiver: string; days: string[]; start: string; end: string; overnight: boolean; slot: string }
/* One schedule per caregiver per shift: the days they're CONFIRMED on that shift.
   A cell's AxisCare id wins; otherwise an exact, unique name match in the roster. */
// deno-lint-ignore no-explicit-any
export function groupSchedules(plan: any, roster: Map<string, { id: string; name: string }[]>) {
  const out = new Map<string, Sched>(), blocked: { slot: string; day: string; name: string; why: string }[] = [], unconfirmed: string[] = []
  for (const s of (plan?.slots ?? [])) {
    for (const d of ORDER.filter((x) => (plan?.days ?? []).includes(x))) {
      const c = (plan?.cells ?? {})[d + '|' + s.k]
      const where = `${DAY[d]} ${s.label || ''}`.trim()
      if (!c || c.status !== 'yes') { unconfirmed.push(where); continue }
      let id = c.cg_ax_id ? String(c.cg_ax_id) : '', name = String(c.name ?? '')
      if (!id) {
        const hits = roster.get(nameKey(name)) ?? []
        if (hits.length === 1) { id = hits[0].id; name = hits[0].name }
        else { blocked.push({ slot: s.label || '', day: DAY[d], name, why: hits.length ? `${hits.length} caregivers in AxisCare are named "${name}"; pencil them in again to pick the right one` : `no active AxisCare caregiver is named "${name}"` }); continue }
      }
      const start = hm(s.start), end = hm(s.end), key = `${s.k}|${id}`
      const g = out.get(key) ?? { key, caregiver_id: id, caregiver: name, days: [], start, end, overnight: !!(start && end && end <= start), slot: s.label || '' }
      g.days.push(DAY[d]); out.set(key, g)
    }
  }
  return { schedules: [...out.values()], blocked, unconfirmed }
}
/* AxisCare lists one record per day, with the caregiver's name (not id). */
// deno-lint-ignore no-explicit-any
export function matchExisting(existing: any[], s: Sched) {
  const hits = existing.filter((e) => nameKey([e?.caregiver?.firstName, e?.caregiver?.lastName].join('')) === nameKey(s.caregiver)
    && hm(e?.startTime) === s.start && hm(e?.endTime) === s.end)
  const days = new Set(hits.map((e) => String(e?.day)))
  return { all: s.days.every((d) => days.has(d)), some: s.days.some((d) => days.has(d)), ids: hits.filter((e) => s.days.includes(String(e?.day))).map((e) => String(e.scheduleId)) }
}

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
      'Content-Type': 'application/json', 'X-AxisCare-Api-Version': AC_VERSION }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: r.status, json: await r.json().catch(() => ({})) }
  } catch (e) { return { status: 0, json: { errors: [String((e as Error).message ?? e)] } } }
}
// deno-lint-ignore no-explicit-any
const errText = (r: { status: number; json: any }) => {
  const e = r.json?.errors; const m = Array.isArray(e) ? e.filter(Boolean).join('; ') : (e && typeof e === 'object' ? Object.values(e).join('; ') : '')
  return (r.status === 403 ? 'AxisCare refused: this connection may not create schedules' : 'AxisCare answered ' + r.status) + (m ? ' (' + String(m).slice(0, 240) + ')' : '')
}
const ok2 = (s: number) => s >= 200 && s < 300
// deno-lint-ignore no-explicit-any
const rows = (v: any): any[] => Array.isArray(v) ? v : (v && typeof v === 'object' ? [v] : [])
// deno-lint-ignore no-explicit-any
async function pages(path: string, pick: (j: any) => any[], max = 10): Promise<{ list: any[]; error: string | null }> {
  const { site } = axisCreds()
  // deno-lint-ignore no-explicit-any
  const list: any[] = []; let url: string | null = path
  for (let i = 0; url && i < max; i++) {
    const r = await ax('GET', url)
    if (r.status === 404 && i === 0) return { list, error: null }
    if (!ok2(r.status)) return { list, error: errText(r) }
    list.push(...pick(r.json))
    const next = r.json?.results?.nextPage ?? r.json?.nextPage ?? null
    url = typeof next === 'string' && next.startsWith(`https://${site}.axiscare.com/`) ? next.replace(`https://${site}.axiscare.com`, '') : null
  }
  return { list, error: null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const { role, email } = jwtClaims(req.headers.get('Authorization'))
  const b = await req.json().catch(() => ({})) as Record<string, unknown>

  if (b.action === 'permission_check') {
    if (role !== 'service_role') return json({ error: 'owner script only' }, 403)
    const r = await ax('POST', '/api/schedules', { clientId: 290 })       // deliberately missing days, dates and times
    if (ok2(r.status)) return json({ ok: false, detail: 'AxisCare accepted an incomplete schedule; report this, it should not happen', status: r.status, body: r.json })
    if (r.status === 400 || r.status === 422) return json({ ok: true, status: r.status, detail: 'AxisCare checked the request and refused it as incomplete, which it only does for a caller allowed to create schedules: ' + errText(r) })
    return json({ ok: false, status: r.status, detail: errText(r) })
  }
  if (role !== 'authenticated' || !email) return json({ error: 'sign in to the hub first' }, 401)
  const action = String(b.action ?? '')
  const planId = typeof b.plan_id === 'string' && b.plan_id.length <= 60 ? b.plan_id : ''
  if (!['preview', 'create', 'undo'].includes(action) || !planId) return json({ error: "action (preview, create or undo) and plan_id are required" }, 400)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const today = chicagoDay(new Date())

  const { data: pRow } = await sb.from('app_data').select('data').eq('key', 'staffing_plans').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const plan = (Array.isArray(pRow?.data) ? pRow!.data : []).find((p: any) => p && p.id === planId)
  if (!plan) return json({ error: 'no such plan' }, 404)

  if (action === 'undo') {
    const push = plan.axiscare_push
    const want = (Array.isArray(b.schedule_ids) ? b.schedule_ids : []).map(String)
    const mine = new Set<string>((push?.created ?? []).flatMap((c: { schedule_ids?: string[] }) => c.schedule_ids ?? []).map(String))
    if (!push || !want.length || !want.every((id: string) => mine.has(id))) return json({ outcome: 'not_this_plans', detail: 'only schedules this plan created can be removed here' })
    if (chicagoDay(new Date(push.at)) !== today) return json({ outcome: 'too_late', detail: 'undo is only offered on the day the schedules were created; end them in AxisCare' })
    const eff = String(push.start_date) > today ? String(push.start_date) : today
    const results = []
    for (const id of want) {
      const r = await ax('DELETE', `/api/schedules/${encodeURIComponent(id)}?effectiveDate=${eff}`)
      results.push({ schedule_id: id, ok: ok2(r.status), detail: ok2(r.status) ? null : errText(r) })
    }
    const gone = results.filter((x) => x.ok).length
    await recordAxisChange(sb, { kind: 'schedule', subject: 'client', client: String(push.client_ax ?? ''), outcome: gone === results.length ? 'sent_confirmed' : gone ? 'sent' : 'refused',
      summary: gone + ' of ' + results.length + ' schedule(s) removed (undo)', detail: gone === results.length ? null : (results.length - gone) + ' refused', by: email, via: 'schedule-push' })
    return json({ outcome: results.every((x) => x.ok) ? 'removed' : 'partly_removed', effective: eff, results, by: email, at: new Date().toISOString() })
  }

  // the AxisCare client: the plan's Journey -> person -> AxisCare id
  const { data: link } = await sb.from('team_build_link_current').select('episode_id').eq('plan_id', planId).maybeSingle()
  let clientAx: string | null = null, clientName: string | null = null, target: string | null = null
  if (link?.episode_id) {
    const { data: ep } = await sb.from('journey_episode').select('person_id').eq('episode_id', link.episode_id).maybeSingle()
    if (ep?.person_id) {
      const { data: src } = await sb.from('person_source_id').select('source_id').eq('person_id', ep.person_id).eq('system', 'axiscare').eq('entity_type', 'client').maybeSingle()
      const { data: pi } = await sb.from('person_identity').select('display_name').eq('id', ep.person_id).maybeSingle()
      clientAx = src?.source_id ? String(src.source_id) : null; clientName = pi?.display_name ?? null
    }
    const { data: sc } = await sb.from('start_contract_current').select('target_date').eq('episode_id', link.episode_id).maybeSingle()
    target = sc?.target_date && String(sc.target_date) > today ? String(sc.target_date) : null
  }
  const problems: string[] = []
  if (!link?.episode_id) problems.push('This plan is not linked to a Journey yet. Use "Link to a Journey" on the board first.')
  else if (!clientAx) problems.push('The person this plan is for has no AxisCare client yet (Convert the lead, or answer "Who is this?").')

  // the AxisCare roster (active caregivers), for cells without a stored id
  const cg = await pages('/api/caregivers', (j) => rows(j?.results?.caregivers ?? j?.caregivers))
  if (cg.error) return json({ error: 'could not read the AxisCare caregivers: ' + cg.error }, 502)
  const roster = new Map<string, { id: string; name: string }[]>()
  for (const g of cg.list) {
    if (g?.id == null || (g?.status && g.status.active === false)) continue
    const nm = [g.firstName, g.lastName].map((x: unknown) => String(x ?? '').trim()).filter(Boolean).join(' ')
    const k = nameKey(nm); if (!k) continue
    roster.set(k, [...(roster.get(k) ?? []), { id: String(g.id), name: nm }])
  }
  const grouped = groupSchedules(plan, roster)

  const startDate = typeof b.start_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.start_date) ? b.start_date : (target ?? null)
  // services in use: the client's own visits first, then the agency's last two weeks
  const svc = new Map<string, { code: string; description: string; client: boolean; n: number }>()
  const addSvc = (v: { service?: { code?: string; description?: string } }, mineToo: boolean) => {
    const c = String(v?.service?.code ?? '').trim(); if (!c) return
    const e = svc.get(c) ?? { code: c, description: String(v?.service?.description ?? ''), client: false, n: 0 }
    e.n++; if (mineToo) e.client = true; svc.set(c, e)
  }
  if (clientAx) {
    const mine = await pages(`/api/visits?clientIds=${clientAx}&startDate=${chicagoDay(new Date(), -60)}&endDate=${chicagoDay(new Date(), 30)}`, (j) => rows(j?.results?.visits ?? j?.visits), 5)
    mine.list.forEach((v) => addSvc(v, true))
  }
  const agency = await pages(`/api/visits?startDate=${chicagoDay(new Date(), -14)}&endDate=${today}`, (j) => rows(j?.results?.visits ?? j?.visits), 8)
  agency.list.forEach((v) => addSvc(v, false))
  const services = [...svc.values()].sort((a, b2) => (Number(b2.client) - Number(a.client)) || (b2.n - a.n))

  // what the client already has, around the start date
  // deno-lint-ignore no-explicit-any
  let existing: any[] = [], existingError: string | null = null
  if (clientAx && startDate) {
    const ex = await pages(`/api/schedules?clientIds=${clientAx}&startDate=${startDate}&endDate=${chicagoDay(new Date(startDate + 'T12:00:00Z'), 13)}`, (j) => rows(j?.results?.schedules ?? j?.schedules))
    existing = ex.list; existingError = ex.error
  }
  const planned = grouped.schedules.map((s) => { const m = matchExisting(existing, s); return { ...s, already: m.all, partly: !m.all && m.some } })

  if (action === 'preview') {
    return json({ plan: { id: plan.id, client: plan.client, status: plan.status }, client: clientAx ? { axiscare_client_id: clientAx, name: clientName } : null,
      problems, schedules: planned, blocked: grouped.blocked, unconfirmed: grouped.unconfirmed, services, start_default: startDate,
      existing: existing.map((e) => ({ id: e.scheduleId, day: e.day, start: hm(e.startTime), end: hm(e.endTime), caregiver: [e?.caregiver?.firstName, e?.caregiver?.lastName].filter(Boolean).join(' ') || null, service: e?.service?.code ?? null })),
      existing_error: existingError, already_pushed: plan.axiscare_push ?? null })
  }

  // ── create ──────────────────────────────────────────────────────────────
  const serviceCode = typeof b.service_code === 'string' ? b.service_code.trim() : ''
  if (problems.length) return json({ outcome: 'blocked', problems })
  if ((plan.axiscare_push?.created ?? []).length && b.again !== true)
    return json({ outcome: 'already_pushed', detail: 'this plan already created schedules in AxisCare (' + String(plan.axiscare_push.at).slice(0, 10) + '); undo them first, or send again deliberately' })
  if (!startDate || startDate < today) return json({ outcome: 'start_date_required', detail: 'pick a start date (today or later)' })
  if (!serviceCode) return json({ outcome: 'service_required' })
  if (existingError) return json({ outcome: 'error', detail: 'could not read the client\'s existing schedules, so nothing was created: ' + existingError })
  const created = [], skipped = [], refused = []
  for (const s of planned) {
    if (s.already) { skipped.push({ key: s.key, caregiver: s.caregiver, days: s.days, why: 'already in AxisCare' }); continue }
    const r = await ax('POST', '/api/schedules', { clientId: Number(clientAx), days: s.days, startDate, startTime: s.start, endTime: s.end,
      serviceCode, caregiverId: Number(s.caregiver_id), frequency: 1 })
    if (!ok2(r.status)) { refused.push({ key: s.key, caregiver: s.caregiver, days: s.days, start: s.start, end: s.end, overnight: s.overnight, detail: errText(r) }); continue }
    const ids = rows(r.json?.schedules ?? r.json?.results?.schedules ?? r.json?.results).map((x) => x?.scheduleId).filter((x) => x != null).map(String)
    created.push({ key: s.key, caregiver: s.caregiver, caregiver_id: s.caregiver_id, days: s.days, start: s.start, end: s.end, schedule_ids: ids })
  }
  // read back
  const rb = await pages(`/api/schedules?clientIds=${clientAx}&startDate=${startDate}&endDate=${chicagoDay(new Date(startDate + 'T12:00:00Z'), 13)}`, (j) => rows(j?.results?.schedules ?? j?.schedules))
  const confirmed = created.map((c) => {
    const m = matchExisting(rb.list, { key: c.key, caregiver_id: c.caregiver_id, caregiver: c.caregiver, days: c.days, start: c.start, end: c.end, overnight: false, slot: '' })
    if (!c.schedule_ids.length) c.schedule_ids = m.ids
    return { key: c.key, in_axiscare: m.all }
  })
  const record = { at: new Date().toISOString(), by: email, client_ax: clientAx, start_date: startDate, service_code: serviceCode,
    created, skipped, refused, readback_error: rb.error, confirmed }
  const inAx = confirmed.filter((x) => x.in_axiscare).length
  const recorded = (created.length || refused.length) ? await recordAxisChange(sb, { kind: 'schedule', subject: 'client', client: clientAx,
    outcome: !created.length ? 'refused' : (inAx === created.length && !refused.length && !rb.error) ? 'sent_confirmed' : 'sent',
    summary: created.length + ' schedule(s) created, ' + inAx + ' confirmed' + (refused.length ? ', ' + refused.length + ' refused' : '') + ' (from ' + startDate + ')',
    detail: refused.length ? refused.length + ' refused by AxisCare' : (rb.error ? 'could not read back' : null), by: email, via: 'schedule-push' }) : false
  return json({ outcome: refused.length ? (created.length ? 'partly_created' : 'none_created') : 'created', record, recorded })
})
