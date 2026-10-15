// =============================================================================
// lead-readiness · how serious each open family sounds, for the ranked Leads list (Desktop 770, 2026-10-15)
// =============================================================================
// Samantha: "be able to know order of importance....how serious they sound, how many hours they want, put a dollar amount
// on them when we can". Approved mockup Part 1: https://claude.ai/artifact/MhFEgbLXTzmPCbegzHVv49
// Every 15 minutes: each open lead whose story changed since its last reading (form, call summaries from the call reader,
// the history of calls and texts) is read once (Claude Sonnet 5.5): ready / deciding / looking, why, hours a week if said.
// The reading goes in lead_readiness (one row per lead). No lead is changed. Nobody is contacted.
// Off when ops_settings.lead_readiness_off === true. Runs on its schedule (the vault secret) or the owner's key.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jobCaller } from '../_shared/job-auth.ts'
import { MODEL, inputFor, request, answer, openLead, fingerprint } from '../_shared/lead-readiness.ts'
// deno-lint-ignore no-explicit-any
type Any = any
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
export const PER_RUN = 8, MAX_TRIES = 3

async function beat(db: Any, ok: boolean, note: string) {
  try {
    await db.rpc('upsert_app_data_item', { target_key: 'automation_heartbeats',
      item: { id: 'hb_lead-readiness', automation: 'lead-readiness', at: new Date().toISOString(), ok, note: String(note).slice(0, 300) } })
  } catch { /* never block on the heartbeat */ }
}
async function ask(apiKey: string, body: Any): Promise<Any> {
  const { betas, ...rest } = body
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-beta': betas.join(','), 'content-type': 'application/json' }, body: JSON.stringify(rest) })
  if (!r.ok) return { error: `the AI answered ${r.status}` }
  return await r.json().catch(() => ({ error: 'the AI answer could not be read' }))
}

Deno.serve(async (req) => {
  const caller = await jobCaller(req)
  if (!caller) return json({ error: 'not allowed' }, 401)
  const q = new URL(req.url).searchParams
  if (q.get('auth_check') === '1') return json({ ok: true, caller })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') || ''
  if (!apiKey) { await beat(db, false, 'no AI key'); return json({ error: 'not set up' }, 500) }
  const st: Any = (await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()).data?.data ?? {}
  if (st.lead_readiness_off === true) { await beat(db, true, 'off (lead_readiness_off)'); return json({ ok: true, off: true }) }
  const body: Any = await req.json().catch(() => ({}))
  const only: string[] = caller === 'owner' && Array.isArray(body.lead_ids) ? body.lead_ids.map(String).slice(0, 20) : []
  const dry = q.get('dry') === '1'

  const leads: Any[] = ((await db.from('app_data').select('data').eq('key', 'leads').maybeSingle()).data?.data) ?? []
  const open = leads.filter(openLead).filter((l) => !only.length || only.includes(String(l.id)))
  const { data: have } = await db.from('lead_readiness').select('lead_id, based_on, pending_fp, tries, error')
  const prev = new Map((have ?? []).map((r: Any) => [String(r.lead_id), r]))
  const out: Record<string, number> = { open: open.length, changed: 0, read: 0, errors: 0, skipped_failed: 0 }

  /* what changed, newest activity first */
  const todo: Array<{ l: Any; inp: Any; fp: string; last: string }> = []
  /* the call reader's summaries for these families, newest first (one query) */
  const sums = new Map<string, string[]>()
  const ids = open.map((l) => String(l.id))
  for (let i = 0; i < ids.length; i += 100) {
    const { data: rs } = await db.from('call_task_reading').select('lead_id, call_at, detail').in('lead_id', ids.slice(i, i + 100)).order('call_at', { ascending: false }).limit(1000)
    for (const r of rs ?? []) { const k = String(r.lead_id); if (!sums.has(k)) sums.set(k, []); sums.get(k)!.push(String(r?.detail?.summary || '')) }
  }
  for (const l of open) {
    const inp = inputFor(l, sums.get(String(l.id)) || [])
    const fp = await fingerprint(inp.text)
    const p = prev.get(String(l.id))
    if (p && p.based_on === fp) continue
    if (p && p.pending_fp === fp && (p.tries ?? 0) >= MAX_TRIES) { out.skipped_failed++; continue }   // tried 3 times on this story; waits for it to change
    const ev = Array.isArray(l.contact_events) ? l.contact_events : []
    todo.push({ l, inp, fp, last: String(ev.length ? ev[ev.length - 1]?.at : l.created_at || '') })
  }
  out.changed = todo.length
  todo.sort((a, b) => b.last.localeCompare(a.last))
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

  for (const t of todo.slice(0, only.length ? 20 : PER_RUN)) {
    const p = prev.get(String(t.l.id))
    const resp = await ask(apiKey, request(t.inp, today))
    const a = resp?.error ? null : answer(resp)
    /* a failed read keeps the last good reading and counts tries on this story (never silent: error is shown) */
    const row: Record<string, unknown> = !a
      ? { lead_id: String(t.l.id), pending_fp: t.fp, error: String(resp?.error || 'no reading came back').slice(0, 200), tries: (p?.pending_fp === t.fp ? (p?.tries ?? 0) : 0) + 1 }
      : { lead_id: String(t.l.id), based_on: t.fp, pending_fp: null, source: t.inp.source, model: MODEL, read_at: new Date().toISOString(), level: a.level, why: a.why, hours_heard: a.hours_per_week, error: null, tries: 0 }
    if (a) out.read++; else out.errors++
    if (dry) continue
    const { error } = await db.from('lead_readiness').upsert(row, { onConflict: 'lead_id' })
    if (error) out.errors++
  }
  await beat(db, out.errors === 0, JSON.stringify(out))
  return json({ ok: true, dry, ...out })
})
