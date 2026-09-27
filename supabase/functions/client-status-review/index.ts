// Supabase Edge Function: client-status-review (shared hub project) · Change 3, 2026-09-27
// ---------------------------------------------------------------------------
// AxisCare's client status reaches the hub, through a person.
//
//   run      (the scheduler, 5 minutes after each 6-hourly status check)
//              1. copies AxisCare's current status per client into client_status_current
//              2. runs the admission scan (server to server), so "Who is this?" opens on its own
//              3. opens one review for every recorded status change on a client the hub knows
//              4. keeps one My Work item per open review, and closes it once answered
//            Dry unless app_data 'ops_settings' has client_status_live === true.
//   decide   (signed-in staff) records a person's answer through client_status_decide().
//            "Returning client" needs the Owner / Decision seat.
//
// It never decides what a status change means, and nothing ends automatically,
// whatever AxisCare's word is. Nothing is written to AxisCare. Nobody is contacted.
// Replies to the scheduler (public key) with counts only.
// ---------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const AUTOMATION = 'automation:client-status'
const MAX_AGE_DAYS = 60
const DECISIONS = ['care_ended', 'on_hold', 'no_change', 'returning']

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
export function chicagoDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(d)
}
/* 11:59pm Springfield time on the given day, as an instant (same idea as the promise engine's endIso) */
export function endOfDayChicago(ymd: string): string {
  const guess = Date.parse(ymd + 'T23:59:59.999Z')
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(guess))
  const g = (t: string) => +((p.find((x) => x.type === t) || { value: '0' }).value)
  const wall = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'), 999)
  return new Date(guess - (wall - guess)).toISOString()
}
// deno-lint-ignore no-explicit-any
export function reviewItem(rv: any, name: string, owner: string, today: string) {
  const seen = String(rv.observed_at ?? '').slice(0, 10)
  const deceased = /deceas/i.test(String(rv.new_label))
  return {
    id: 'csr_' + rv.review_id, kind: 'status_review', status: 'open',
    title: `AxisCare changed ${name} from ${rv.old_label ?? '?'} to ${rv.new_label}`,
    about: name,
    detail: `Seen by the status check on ${seen}. Nothing in the hub changes until someone answers what happened.`
      + (deceased ? ' Nothing contacts the family automatically; any call is a person\'s decision.' : ''),
    next_action: 'Open it and answer: care ended, on hold, AxisCare mistake, or returning client. Answering closes this.',
    urgency: deceased ? 'high' : 'normal', due: endOfDayChicago(today), domain: 'client_care', owner,
    created_at: null, last_activity_at: null, opened_by: 'system', created_by: AUTOMATION,
    source: { type: 'status_review', id: rv.review_id, review_id: rv.review_id, axiscare_client_id: rv.axiscare_client_id, person_id: rv.person_id },
  }
}
export function chooseSeat(seats: string[], decision: string): string | null {
  if (decision === 'returning') return seats.includes('owner_decision') ? 'owner_decision' : null
  if (seats.includes('client_intake')) return 'client_intake'
  if (seats.includes('owner_decision')) return 'owner_decision'
  return null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const { role, email } = jwtClaims(req.headers.get('Authorization'))
  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  const action = typeof b.action === 'string' ? b.action : 'run'
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!, SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const sb = createClient(SUPABASE_URL, SERVICE_KEY)
  const now = new Date(), today = chicagoDay(now), started = now.toISOString(), t0 = Date.now()

  const closeItem = async (reviewId: string, why: string) => {
    const { data } = await sb.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
    // deno-lint-ignore no-explicit-any
    const it = (Array.isArray(data?.data) ? data!.data : []).find((x: any) => x && x.id === 'csr_' + reviewId)
    if (!it || it.status !== 'open') return false
    const at = new Date().toISOString()
    const item = { ...it, status: 'done', closed_at: at, closed_by: AUTOMATION, resolution_code: 'answered', auto_closed_reason: 'answered',
      close_note: why, last_activity_at: at, history: [...(Array.isArray(it.history) ? it.history : []), { at, by: 'automation', text: why }] }
    const { error } = await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item })
    return !error
  }

  /* ── a person's answer ─────────────────────────────────────────────────── */
  if (action === 'decide') {
    if (role !== 'authenticated' || !email) return json({ error: 'sign in to the hub first' }, 401)
    const reviewId = typeof b.review_id === 'string' && /^[0-9a-f-]{36}$/i.test(b.review_id) ? b.review_id : null
    const decision = String(b.decision ?? '')
    if (!reviewId || !DECISIONS.includes(decision)) return json({ error: 'review_id and a known answer are required' }, 400)
    const { data: seatRows, error: seatErr } = await sb.from('journey_seat_member').select('seat').eq('email', email)
    if (seatErr) return json({ error: 'could not read seat membership' }, 500)
    const seat = chooseSeat((seatRows ?? []).map((r) => String(r.seat)), decision)
    if (!seat) return json({ outcome: decision === 'returning' ? 'seat_required' : 'no_seat',
      detail: decision === 'returning' ? 'a returning client is an Owner / Decision matter' : 'your account does not hold a Journey seat; ask the owner to add you' }, 403)
    const date = typeof b.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : null
    const { data, error } = await sb.rpc('client_status_decide', { p_review_id: reviewId, p_decision: decision, p_date: date,
      p_reason: typeof b.reason === 'string' ? b.reason : null, p_note: typeof b.note === 'string' ? b.note.slice(0, 1000) : null,
      p_staff: email, p_seat: seat })
    if (error) return json({ error: 'not saved: ' + error.message }, 500)
    if (data?.outcome === 'decided') await closeItem(reviewId, 'Answered by ' + email + ': ' + decision.replace('_', ' '))
    return json(data)
  }

  if (action !== 'run') return json({ error: "action must be 'run' or 'decide'" }, 400)
  if (!['anon', 'service_role'].includes(String(role))) return json({ error: 'the scheduled run only' }, 403)
  const full = role === 'service_role'

  const blob = async (key: string) => {
    const { data } = await sb.from('app_data').select('data').eq('key', key).maybeSingle()
    // deno-lint-ignore no-explicit-any
    return (data as any)?.data ?? null
  }
  const settings = (await blob('ops_settings')) || {}
  const live = settings?.client_status_live === true
  // deno-lint-ignore no-explicit-any
  const rawLog = await blob('client_status_log')
  // deno-lint-ignore no-explicit-any
  const log: any[] = Array.isArray(rawLog) ? rawLog : []
  const latest = log.find((x) => x?.id === 'latest')
  const map: Record<string, string> = latest?.map && typeof latest.map === 'object' ? latest.map : {}
  const transitions = log.filter((x) => typeof x?.id === 'string' && x.id.startsWith('tr_'))
  const counts = { census: Object.keys(map).length, transitions_seen: transitions.length, current_refreshed: 0,
                   admission_scan: null as unknown, already_reviewed: 0, too_old: 0, no_hub_person: 0, would_open: 0, opened: 0,
                   items_created: 0, items_closed: 0, open_reviews: 0, errors: 0 }
  const errors: unknown[] = []

  // 1. AxisCare's current status, for Active Clients
  if (live && counts.census) {
    const { data, error } = await sb.rpc('client_status_current_refresh', { p_map: map, p_observed_at: new Date().toISOString() })
    if (error) { counts.errors++; errors.push({ step: 'current', error: error.message }) } else counts.current_refreshed = data?.rows ?? 0
  }
  // 2. "Who is this?" for Active clients with no hub person (server to server; the key never leaves the server)
  if (live) {
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/client-admission-scan`, { method: 'POST',
        headers: { Authorization: 'Bearer ' + SERVICE_KEY, apikey: SERVICE_KEY, 'Content-Type': 'application/json' }, body: '{}' })
      const j = await r.json().catch(() => ({}))
      counts.admission_scan = r.ok ? { active: j.active ?? null, unlinked: j.unlinked ?? 0,
        // deno-lint-ignore no-explicit-any
        opened: (j.results ?? []).filter((x: any) => x.outcome === 'opened').length } : { error: 'HTTP ' + r.status }
      if (!r.ok) { counts.errors++; errors.push({ step: 'admission_scan', status: r.status }) }
    } catch (e) { counts.errors++; errors.push({ step: 'admission_scan', error: String(e) }) }
  } else {
    const active = Object.keys(map).filter((k) => map[k] === 'Active')
    const { data: links } = active.length ? await sb.from('person_source_id').select('source_id').eq('system', 'axiscare').eq('entity_type', 'client').in('source_id', active) : { data: [] }
    const linked = new Set((links ?? []).map((l) => String(l.source_id)))
    counts.admission_scan = { would_check: active.filter((a) => !linked.has(a)).length }
  }
  // 3. a review for every recorded change on a client the hub knows
  const { data: done, error: dErr } = await sb.from('client_status_review').select('transition_ref')
  if (dErr) {
    await logRun(sb, { ok: false, dry: !live, started, ms: Date.now() - t0, error: 'could not read reviews: ' + dErr.message })
    return json({ error: 'could not read reviews', detail: dErr.message }, 500)
  }
  const seen = new Set((done ?? []).map((r) => String(r.transition_ref)))
  const cutoff = Date.now() - MAX_AGE_DAYS * 86400000
  const fresh = transitions.filter((t) => { if (seen.has(t.id)) { counts.already_reviewed++; return false }
    if (!(Date.parse(t.observed_at) >= cutoff)) { counts.too_old++; return false } return true })
  const axIds = [...new Set(fresh.map((t) => String(t.axiscare_client_id)))]
  const { data: hubLinks } = axIds.length ? await sb.from('person_source_id').select('source_id').eq('system', 'axiscare').eq('entity_type', 'client').in('source_id', axIds) : { data: [] }
  const known = new Set((hubLinks ?? []).map((l) => String(l.source_id)))
  // deno-lint-ignore no-explicit-any
  const preview: any[] = []
  for (const t of fresh) {
    if (!known.has(String(t.axiscare_client_id))) { counts.no_hub_person++; continue }
    counts.would_open++
    if (full) preview.push({ axiscare_client_id: t.axiscare_client_id, change: `${t.old_status_label} -> ${t.new_status_label}`, seen: String(t.observed_at).slice(0, 10) })
    if (!live) continue
    const { data, error } = await sb.rpc('client_status_review_open', { p_transition: t, p_staff: AUTOMATION })
    if (error || !['opened', 'already_open', 'already_decided'].includes(data?.outcome)) { counts.errors++; errors.push({ step: 'open', ref: t.id, error: error?.message ?? data }) }
    else if (data.outcome === 'opened') counts.opened++
  }
  // 4. My Work: one item per open review; answered ones close
  if (live) {
    const { data: reviews } = await sb.from('client_status_review').select('review_id, axiscare_client_id, person_id, old_label, new_label, observed_at, status')
    // deno-lint-ignore no-explicit-any
    const rows = (reviews ?? []) as any[]
    counts.open_reviews = rows.filter((r) => r.status === 'open').length
    const items = await blob('ops_items')
    // deno-lint-ignore no-explicit-any
    const byId = new Map<string, any>((Array.isArray(items) ? items : []).filter((x: any) => x && x.id).map((x: any) => [x.id, x]))
    const pids = [...new Set(rows.map((r) => r.person_id))]
    const { data: ppl } = pids.length ? await sb.from('person_identity').select('id, display_name').in('id', pids) : { data: [] }
    const nameOf = (pid: string) => String((ppl ?? []).find((p) => p.id === pid)?.display_name || 'this client')
    const { data: persons } = await sb.from('persons').select('person_id, primary_email')
    const { data: domains } = await sb.from('domains').select('code, owner_person, entity').eq('entity', 'cc_ihs')
    // deno-lint-ignore no-explicit-any
    const d = (domains ?? []).find((x: any) => x.code === 'client_care') as any
    // deno-lint-ignore no-explicit-any
    const owner = d?.owner_person ? String((persons ?? []).find((p: any) => p.person_id === d.owner_person)?.primary_email || '').toLowerCase() : ''
    for (const rv of rows) {
      const it = byId.get('csr_' + rv.review_id)
      if (rv.status === 'open' && !it) {
        const at = new Date().toISOString()
        const item = { ...reviewItem(rv, nameOf(rv.person_id), owner, today), created_at: at, last_activity_at: at,
          history: [{ at, by: 'automation', text: 'Opened because AxisCare changed this client\'s status' }] }
        const { error } = await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item })
        if (error) { counts.errors++; errors.push({ step: 'item', review: rv.review_id, error: error.message }) } else counts.items_created++
      } else if (rv.status === 'decided' && it && it.status === 'open') {
        if (await closeItem(rv.review_id, 'Answered; closed automatically.')) counts.items_closed++
      }
    }
  }
  const summary = { ok: counts.errors === 0, dry: !live, ...counts, rows_seen: counts.transitions_seen }
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
        at: new Date().toISOString(), automation: 'client_status', ran_by: 'server',
        ok: row.ok !== false, dry: row.dry === true, duration_ms: row.ms ?? null,
        sources_evaluated: 1, rows_seen: s.transitions_seen ?? 0,
        created: s.opened ?? s.would_open ?? 0, closed: s.items_closed ?? 0, skipped: (s.already_reviewed ?? 0) + (s.no_hub_person ?? 0),
        too_old: s.too_old ?? 0, errors: s.errors ?? 0, error: row.error ?? null,
      },
    })
  } catch (e) { console.error('[client-status-review] could not write the run log', e) }
}
