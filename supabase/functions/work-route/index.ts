// Supabase Edge Function: work-route  (shared hub project)
// -----------------------------------------------------------------------------
// TODAY COCKPIT, PHASE 3 (Samantha, 2026-10-05): right person first, then escalate. Every 2 minutes:
//   1. ROUTE: new scheduling work made by a job (no person placed it) goes to whoever holds the STAFFING seat on the
//      duty schedule now (Krystal in her staffing hours; the seat's "when nobody is scheduled" person otherwise).
//   2. ESCALATE: work nobody has taken pulls in whoever holds the OWNER ESCALATION seat now. The owner keeps it.
//        uncovered shift starting within 60 minutes   after 5 minutes
//        other urgent staffing / no-clock-in items     after 15 minutes
//        normal work                                   once overdue
//      An escalation that no longer applies (someone took it, it was parked, the due date moved) is marked cleared.
// Writes ops_items only, per item, on the newest copy (the Hub saves the same way). Sends NOTHING: the missed
// clock-in texts to the escalation person come from timekeeper-watch (daytime only).
// Off until ops_settings.routing_live (Owners Hub Admin page); while off, the answer lists what it WOULD do.
// Auth: its schedule (x-cron-secret) or the owner's server key (_shared/job-auth.ts).
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jobCaller } from '../_shared/job-auth.ts'
import { opEvent } from '../_shared/events.ts'
import { escalationDue, minsToShift, onDuty, routable } from '../_shared/duty.ts'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b, null, 2), { status: s, headers: { 'Content-Type': 'application/json' } })
// deno-lint-ignore no-explicit-any
type Any = any
const read = async (key: string): Promise<Any[]> => {
  const { data } = await sb.from('app_data').select('data').eq('key', key).maybeSingle()
  return Array.isArray(data?.data) ? data!.data : []
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 })
  const caller = await jobCaller(req)
  if (!caller) return json({ error: 'not allowed' }, 401)
  const url = new URL(req.url)
  if (url.searchParams.get('auth_check') === '1') return json({ ok: true, caller })
  const now = new Date(), nowIso = now.toISOString()

  const { data: setRow } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  const settings: Any = setRow?.data ?? {}
  const live = settings.routing_live === true && url.searchParams.get('dry') !== '1'
  const since = String(settings.routing_since || '')
  const [windows, positions, items, cases] = await Promise.all([read('duty_windows'), read('positions'), read('ops_items'), read('coverage_cases')])
  const seats = onDuty(windows, settings, now, positions)
  const names = new Map<string, string>()
  try {
    const { data: ps } = await sb.from('persons').select('primary_email, full_name')
    for (const p of (ps ?? []) as Any[]) if (p?.primary_email) names.set(String(p.primary_email).toLowerCase(), String(p.full_name || p.primary_email))
  } catch { /* names are a nicety */ }
  const nameOf = (e: string) => names.get(String(e || '').toLowerCase()) || String(e || '').split('@')[0]
  const first = (e: string) => nameOf(e).split(/\s+/)[0]
  const caseById = new Map(cases.map((c: Any) => [String(c?.id), c]))

  const plan: Any = { live, seats: {
      staffing: { first: seats.staffing.person ? first(seats.staffing.person) : null, from: seats.staffing.source },
      escalation: { first: seats.escalation.person ? first(seats.escalation.person) : null, from: seats.escalation.source } },
    routed: 0, escalated_urgent: 0, escalated_overdue: 0, cleared: 0, written: 0 }
  const changes = new Map<string, (it: Any) => void>()

  for (const it of items) {
    if (!it || it.status !== 'open' || String(it.id).startsWith('ops_send_')) continue
    /* 1 · route */
    let owner = String(it.owner || '').toLowerCase()
    if (routable(it, since) && seats.staffing.person) {
      const to = seats.staffing.person, from = owner
      plan.routed++
      owner = to
      changes.set(String(it.id), (x: Any) => {
        if (String(x.owner || '').toLowerCase() !== to) {
          x.owner_history = [...(Array.isArray(x.owner_history) ? x.owner_history : []), { at: nowIso, by: 'cara', by_name: 'Cara',
            from, from_name: from ? nameOf(from) : '', to, to_name: nameOf(to), how: 'routed', note: 'on Staffing duty now' }].slice(-30)
          x.history = [...(Array.isArray(x.history) ? x.history : []), { at: nowIso, by: 'Cara', text: `Routed to ${nameOf(to)} (on Staffing duty now)` }]
        }
        x.owner = to; x.owner_name = nameOf(to)
        x.routed = { seat: 'staffing', person: to, source: seats.staffing.source, at: nowIso }
      })
    }
    /* 2 · escalate */
    const c = it.coverage_case_id != null ? caseById.get(String(it.coverage_case_id)) : null
    const due = escalationDue(it, now, { minsToShift: c ? minsToShift(c, now) : null, ownerFirst: owner ? first(owner) : 'Nobody' })
    const to = seats.escalation.person
    const prev = it.escalation && !it.escalation.cleared_at ? it.escalation : null
    if (due && to && to !== owner) {
      if (prev && prev.to === to && prev.level === due.level) continue
      due.level === 'urgent' ? plan.escalated_urgent++ : plan.escalated_overdue++
      const before = changes.get(String(it.id))
      changes.set(String(it.id), (x: Any) => {
        before?.(x)
        x.escalation = { to, to_name: nameOf(to), seat: 'owner_escalation', level: due.level, why: due.why, at: nowIso }
        x.history = [...(Array.isArray(x.history) ? x.history : []), { at: nowIso, by: 'Cara', text: `Escalated to ${nameOf(to)}: ${due.why}` }]
      })
    } else if (prev && (!due || to === owner)) {
      plan.cleared++
      const before = changes.get(String(it.id))
      changes.set(String(it.id), (x: Any) => { before?.(x); if (x.escalation) { x.escalation.cleared_at = nowIso; x.escalation.cleared_why = it.claimed_by ? 'taken' : 'no longer due' } })
    }
  }

  if (live && changes.size) {
    /* Apply each change to the NEWEST copy of the item, so a person's edit made a moment ago is never overwritten. */
    const fresh = new Map((await read('ops_items')).map((x: Any) => [String(x?.id), x]))
    for (const [id, apply] of changes) {
      const x = fresh.get(id); if (!x || x.status !== 'open') continue
      apply(x)
      const { error } = await sb.rpc('upsert_app_data_item', { target_key: 'ops_items', item: x })
      if (!error) {
        plan.written++
        if (x.escalation && x.escalation.at === nowIso)
          try { await opEvent(sb, { verb: 'item_escalated', item_id: id, area: String(x.domain || ''), summary: `Escalated to ${x.escalation.to_name}: ${x.escalation.why}` }) } catch { /* the record is a nicety */ }
      }
    }
  }
  try {
    await sb.rpc('upsert_app_data_item', { target_key: 'automation_heartbeats', item: { id: 'hb_work-route', automation: 'work-route', at: nowIso, ok: true,
      note: `routed:${plan.routed} escalated:${plan.escalated_urgent + plan.escalated_overdue} cleared:${plan.cleared}${live ? '' : ' (practice)'}` } })
  } catch { /* the heartbeat must never block routing */ }
  return json(plan)
})
