// Supabase Edge Function: client-start-run (shared hub project) · Change 8b, 2026-09-27
// ---------------------------------------------------------------------------
// A start of care that has stalled becomes ONE owned My Work item, retitled and rerouted as the
// bottleneck moves, closed by itself when the start moves again, finishes or is abandoned.
// Built in the promise-run shape on purpose:
//
// IT IMPORTS THE HUB'S OWN DECISION FILE, https://cc.mo-care.com/client-start.js (CCStart), the
// exact bytes the Start of Care page runs for its "Stuck" badge. No second formula here. If that
// fetch fails this function STOPS rather than guessing.
//
// Windows (her ruling 2026-09-27, "14 days"): a step the office owns is stuck after 3 days; a
// step DSDS or the family owns, after 14. Leads archived or marked Lost are left out.
// Nothing here contacts anyone: it creates, updates and closes internal work items only.
//
// ⚠ DRY RUN BY DEFAULT. It writes nothing unless app_data 'ops_settings' has
// client_start_live === true. Flip it deliberately, after reading a dry run.
//   ?dry=1   force a dry run          ?max=N   new items this run (default 10)
//   ?days=N  age guard: a start stuck longer than N days (default 60) is listed for a person,
//            not raised, because a start that old is usually not happening and needs a decision
// Replies to the scheduler (public key) with counts only; names appear only for a service-role
// caller (the owner's report script).
// ---------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const ENGINE_URL = Deno.env.get('CLIENT_START_ENGINE_URL') || 'https://cc.mo-care.com/client-start.js'

export function jwtRole(authHeader: string | null): string | null {
  const m = /^Bearer\s+(.+)$/.exec(authHeader ?? '')
  if (!m) return null
  const parts = m[1].split('.')
  if (parts.length !== 3) return null
  try { const p = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))); return typeof p.role === 'string' ? p.role : null }
  catch { return null }
}
export function positiveOr(v: string | null, d: number): number { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d }

/* What to write, decided from the evaluator's answer. Pure, so it is tested without a database.
   - new items: owner from the step's domain; the age guard and the per-run ceiling apply
   - updates: keep a person's own choices on the item (its owner, unless the domain moved;
     anything a person added), take the evaluator's fresh description
   - resolves: closed with the evaluator's reason */
// deno-lint-ignore no-explicit-any
export function plan(result: any, existingItems: any[], domainOwner: (d: string) => string, opts: { maxAgeDays: number; maxPerRun: number; now: string; inScopeIds: Set<string> }) {
  // deno-lint-ignore no-explicit-any
  const create: any[] = [], held: any[] = [], deferred: any[] = [], update: any[] = [], close: any[] = []
  for (const it of result.create) {
    if ((it.client_start?.waited_days ?? 0) > opts.maxAgeDays) { held.push(it); continue }
    if (create.length >= opts.maxPerRun) { deferred.push(it); continue }
    const owner = domainOwner(it.domain) || ''
    create.push({ ...it, urgency: it.priority === 'high' ? 'high' : 'normal', owner, owner_name: owner ? owner.split('@')[0] : '',
      created_by: 'client-start', history: [{ at: opts.now, by: 'automation', what: 'Opened: start of care stuck ' + it.client_start.waited_days + ' days on "' + it.client_start.step + '"' }] })
  }
  for (const it of result.update) {
    const prev = existingItems.find((x) => x.id === it.id) || {}
    const domainMoved = prev.domain !== it.domain
    const owner = domainMoved ? (domainOwner(it.domain) || '') : (prev.owner || domainOwner(it.domain) || '')
    update.push({ ...prev, ...it, urgency: it.priority === 'high' ? 'high' : (prev.urgency === 'high' ? 'high' : 'normal'), owner,
      owner_name: owner ? owner.split('@')[0] : '', status: 'open' })
  }
  /* an open item whose lead is now archived, lost or gone: nothing will ever move it, so close it */
  const resolves = result.resolve.slice()
  for (const it of existingItems)
    if (it && it.status === 'open' && it.opened_by === 'client-start' && !opts.inScopeIds.has(String(it.source_id ?? '')))
      resolves.push({ id: it.id, close_reason: 'The lead is archived, lost or no longer on file.' })
  for (const r of resolves) {
    const prev = existingItems.find((x) => x.id === r.id); if (!prev) continue
    close.push({ ...prev, status: 'done', closed_at: opts.now, closed_by: 'automation:client-start-run', close_note: r.close_reason,
      auto_closed_reason: r.close_reason, last_activity_at: opts.now,
      history: (Array.isArray(prev.history) ? prev.history : []).concat([{ at: opts.now, by: 'automation', what: 'Closed: ' + r.close_reason }]) })
  }
  return { create, held, deferred, update, close }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const url = new URL(req.url)
  const forceDry = url.searchParams.get('dry') === '1'
  const full = jwtRole(req.headers.get('Authorization')) === 'service_role'
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const started = new Date().toISOString(), t0 = Date.now()

  /* 1. The shared decision file. No local fallback ON PURPOSE. */
  // deno-lint-ignore no-explicit-any
  let C: any = null
  let engine: Record<string, unknown> = { url: ENGINE_URL, bytes: 0 }
  try {
    const r = await fetch(ENGINE_URL + '?v=' + Math.floor(Date.now() / 300000), { headers: { Accept: 'application/javascript' } })
    if (!r.ok) throw new Error('client-start.js responded ' + r.status)
    const src = await r.text()
    if (!/CCStart/.test(src) || !/csEvaluate/.test(src)) throw new Error('fetched file does not define CCStart.csEvaluate')
    ;(0, eval)(src)
    // deno-lint-ignore no-explicit-any
    C = (globalThis as any).CCStart
    engine = { url: ENGINE_URL, bytes: src.length, version: C?.version ?? null }
  } catch (err) {
    await logRun(supabase, { ok: false, started, ms: Date.now() - t0, error: 'could not load ' + ENGINE_URL + ': ' + String(err) })
    return json({ error: 'Could not load the shared client-start rules', detail: String(err), note: 'Refusing to evaluate with a second copy of the rules.' }, 502)
  }
  if (typeof C?.csEvaluate !== 'function' || typeof C?.csLeadsInScope !== 'function') {
    await logRun(supabase, { ok: false, started, ms: Date.now() - t0, error: 'client-start.js has no csEvaluate' })
    return json({ error: 'client-start.js loaded but has no csEvaluate' }, 502)
  }
  const maxAgeDays = positiveOr(url.searchParams.get('days'), 60)
  const maxPerRun = positiveOr(url.searchParams.get('max'), 10)

  /* 2. Settings, sources. Read only. */
  const blob = async (key: string) => {
    const { data, error } = await supabase.from('app_data').select('data').eq('key', key).maybeSingle()
    if (error) throw new Error(key + ': ' + error.message)
    // deno-lint-ignore no-explicit-any
    return (data as any)?.data ?? null
  }
  // deno-lint-ignore no-explicit-any
  let settings: any = {}, leads: any[] = [], items: any[] = []
  try {
    settings = (await blob('ops_settings')) || {}
    const L = await blob('leads'); leads = Array.isArray(L) ? L : []
    const I = await blob('ops_items'); items = Array.isArray(I) ? I : []
  } catch (err) {
    await logRun(supabase, { ok: false, started, ms: Date.now() - t0, error: 'could not read the sources: ' + String(err) })
    return json({ error: 'Could not read leads / work items', detail: String(err) }, 500)
  }
  const live = settings?.client_start_live === true && !forceDry
  const { data: persons } = await supabase.from('persons').select('person_id, primary_email')
  const { data: domains } = await supabase.from('domains').select('code, owner_person, entity').eq('entity', 'cc_ihs')
  const domainOwner = (code: string) => {
    // deno-lint-ignore no-explicit-any
    const d = (domains || []).find((x: any) => x.code === code) as any
    // deno-lint-ignore no-explicit-any
    return d?.owner_person ? String((persons || []).find((p: any) => p.person_id === d.owner_person)?.primary_email || '').toLowerCase() : ''
  }

  /* 3. Decide (the shared file), then plan the writes. */
  const inScope = C.csLeadsInScope(leads)
  const now = new Date().toISOString()
  const result = C.csEvaluate(inScope, items, now)
  const p = plan(result, items, domainOwner, { maxAgeDays, maxPerRun, now, inScopeIds: new Set(inScope.map((l: { id: unknown }) => String(l.id))) })
  const summary: Record<string, unknown> = {
    ok: true, dry: !live, live_setting: settings?.client_start_live === true, engine,
    max_age_days: maxAgeDays, max_per_run: maxPerRun,
    leads_with_a_start: leads.filter((l) => l && l.soc).length, in_scope: inScope.length,
    stuck_now: result.create.length + result.update.length,
    would_create: p.create.length, would_update: p.update.length, would_close: p.close.length,
    held_too_old: p.held.length, deferred: p.deferred.length, unrouted: result.unrouted.length, quiet: result.quiet,
    rows_seen: inScope.length,
  }
  if (full) {
    // deno-lint-ignore no-explicit-any
    const row = (i: any) => ({ id: i.id, about: i.about, step: i.client_start?.step, role: i.client_start?.role, waited_days: i.client_start?.waited_days,
      window: i.client_start?.window, owner: i.owner || '(no owner: ' + i.domain + ')', urgency: i.urgency, escalate_on: i.client_start?.escalate_on })
    summary.create_preview = p.create.map(row)
    summary.update_preview = p.update.map(row)
    // deno-lint-ignore no-explicit-any
    summary.close_preview = p.close.map((c: any) => ({ id: c.id, about: c.about, why: c.close_note }))
    // deno-lint-ignore no-explicit-any
    summary.held_preview = p.held.map((i: any) => ({ about: i.about, step: i.client_start?.step, waited_days: i.client_start?.waited_days }))
    summary.unrouted_preview = result.unrouted
  }
  if (!live) { await logRun(supabase, { ok: true, dry: true, started, ms: Date.now() - t0, summary }); return json(summary) }

  /* 4. Write, one item at a time, through the same RPC the hub uses. */
  let created = 0, updated = 0, closed = 0
  const writeErrors: unknown[] = []
  for (const [list, op] of [[p.create, 'create'], [p.update, 'update'], [p.close, 'close']] as const) {
    for (const item of list) {
      const { error } = await supabase.rpc('upsert_app_data_item', { target_key: 'ops_items', item })
      if (error) writeErrors.push({ id: item.id, op, message: error.message })
      else if (op === 'create') created++; else if (op === 'update') updated++; else closed++
    }
  }
  const final = { ...summary, dry: false, created, updated, closed, write_errors: writeErrors }
  await logRun(supabase, { ok: writeErrors.length === 0, dry: false, started, ms: Date.now() - t0, summary: final })
  return json(full ? final : { ok: final.ok, dry: false, created, updated, closed, rows_seen: summary.rows_seen, write_errors: writeErrors.length })
})

/* EVERY RUN IS RECORDED, so "ran and found nothing stuck" never looks like "never ran". */
// deno-lint-ignore no-explicit-any
async function logRun(supabase: any, row: Record<string, unknown>) {
  try {
    // deno-lint-ignore no-explicit-any
    const s = (row.summary ?? {}) as any
    await supabase.rpc('upsert_app_data_item', { target_key: 'automation_log', item: {
      id: 'auto_srv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      at: new Date().toISOString(), automation: 'client_start', ran_by: 'server',
      ok: row.ok !== false, dry: row.dry === true, duration_ms: row.ms ?? null,
      rows_seen: s.rows_seen ?? 0, created: s.created ?? s.would_create ?? 0, updated: s.updated ?? s.would_update ?? 0,
      closed: s.closed ?? s.would_close ?? 0, too_old: s.held_too_old ?? 0, deferred: s.deferred ?? 0,
      errors: (s.write_errors || []).length, error: row.error ?? null,
    } })
  } catch (e) { console.error('[client-start-run] could not write the run log', e) }
}
