// =============================================================================
// call-tasks — the AI employee reads each answered call for follow-up work (650, approved 2026-10-12)
// =============================================================================
// Every 10 minutes, after call-pull has fetched and handled the answered calls, this takes those calls (call_pull_seen,
// oldest unread first), gets GoHighLevel's transcript and contact again, asks who the number belongs to (call_who: the
// identity layer, never a guess), gathers what the Hub's own systems and workflows already have (cards, call-off and
// missed clock-in cases, the lead and its follow-up, the Client Journey, staffing plans, visit changes), and asks
// Claude Sonnet 5.5 what the call created for the office (_shared/call-tasks.ts). Owners come from the Hub's domains
// and the Staffing seat at that hour, never from the AI. The answer is kept in call_task_reading: the summary, what
// was understood, the promises, every responsibility with its decision and reason, and the would-be cards. Never the
// transcript.
// PRACTICE: nothing is written to Work. Cards become real only after her authority grant and her switch.
// Runs only while ops_settings.call_tasks_practice === true. Nothing is ever sent to anyone. Every GoHighLevel request
// is a read. Runs on its schedule (the vault secret) or the owner's key. The owner may name calls to re-read
// ({ message_ids: [...] }) or run the test bench ({ eval: [...] }: made-up calls, nothing read from GoHighLevel and
// nothing stored).
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'
import { jobCaller } from '../_shared/job-auth.ts'
import { seatHolder } from '../_shared/duty.ts'
import { VERSION, MODEL, request, retryRequest, clean, answerOf, openCards, transcriptText, shortName, related as relatedOf, workflows,
  type CallIn, type Who, type OpenCard, type Earlier, type Related } from '../_shared/call-tasks.ts'

const GHL = 'https://services.leadconnectorhq.com'
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const H = (tok: string, v = '2021-04-15') => ({ Authorization: `Bearer ${tok}`, Version: v, Accept: 'application/json' })
export const PER_RUN = 6, LOOKBACK = 80
const DONE = new Set(['done', 'closed', 'resolved', 'dismissed'])

// deno-lint-ignore no-explicit-any
async function beat(db: any, ok: boolean, note: string) {
  try {
    await db.rpc('upsert_app_data_item', { target_key: 'automation_heartbeats',
      item: { id: 'hb_call-tasks', automation: 'call-tasks', at: new Date().toISOString(), ok, note: String(note).slice(0, 300) } })
  } catch { /* never block on the heartbeat */ }
}

// deno-lint-ignore no-explicit-any
type Any = any
/** Everything a reading needs from the Hub, loaded once per run. */
async function loadHub(db: Any) {
  const keys = ['ops_items', 'coverage_cases', 'timekeeper_cases', 'staffing_plans', 'visit_changes', 'leads', 'duty_windows', 'positions', 'ops_settings']
  const { data: rows } = await db.from('app_data').select('key, data').in('key', keys)
  const k: Record<string, Any> = Object.fromEntries((rows ?? []).map((r: { key: string; data: unknown }) => [r.key, r.data]))
  const arr = (x: Any) => Array.isArray(x) ? x : []
  const { data: doms } = await db.from('domains').select('code, owner_person').eq('active', true)
  const ids = [...new Set((doms ?? []).map((d: Any) => d.owner_person).filter(Boolean))]
  const { data: ppl } = ids.length ? await db.from('persons').select('person_id, full_name, primary_email').in('person_id', ids) : { data: [] }
  const { data: staff } = await db.from('persons').select('full_name, primary_email').not('primary_email', 'is', null).limit(200)
  const nameOf = new Map((ppl ?? []).map((p: Any) => [p.person_id, p.full_name]))
  const byEmail = new Map((staff ?? []).map((p: Any) => [String(p.primary_email || '').toLowerCase(), p.full_name]))
  const domains: Record<string, string> = Object.fromEntries((doms ?? []).map((d: Any) => [d.code, String(nameOf.get(d.owner_person) || '')]))
  const { data: defs } = await db.from('client_journey_step_def').select('key, def').eq('active', true)
  const stepTitles: Record<string, string> = Object.fromEntries((defs ?? []).map((d: Any) => [d.key, String(d.def?.title || d.key)]))
  return { ops: arr(k.ops_items), coverage: arr(k.coverage_cases), timekeeper: arr(k.timekeeper_cases), staffing: arr(k.staffing_plans),
    visitChanges: arr(k.visit_changes), leads: arr(k.leads), windows: arr(k.duty_windows), positions: arr(k.positions), settings: k.ops_settings ?? {},
    domains, byEmail, stepTitles }
}
/** Who held the Staffing seat about 15 minutes after the call (when the reader would have made the card). */
function staffingAt(hub: Any, callAt: string): string {
  const s = seatHolder(hub.windows, 'staffing', new Date(Date.parse(callAt) + 15 * 60e3), hub.settings, '', hub.positions)
  return s.person ? String(hub.byEmail.get(s.person) || s.person.split('@')[0]) : ''
}

/** One reading: context, the model (one retry when it answers in text), the cleaned answer. */
async function readOne(ai: Any, call: CallIn, who: Who, open: OpenCard[], earlier: Earlier[], related: Related[], owners: { domains: Record<string, string>; staffing?: string }) {
  const req1 = request(call, who, open, earlier, related)
  let resp = await ai.beta.messages.create(req1)
  let got = answerOf(resp)
  if (got.error && resp?.stop_reason !== 'refusal' && Array.isArray(resp?.content) && /did not submit/.test(got.error)) {
    resp = await ai.beta.messages.create(retryRequest(req1, resp))   // once: it answered in text instead of the tool
    got = answerOf(resp)
  }
  if (got.error) return { error: got.error }
  return { reading: clean(got.input, open, earlier, related, owners) }
}

Deno.serve(async (req) => {
  const caller = await jobCaller(req)
  if (!caller) return json({ error: 'not allowed' }, 401)
  const q = new URL(req.url).searchParams
  if (q.get('auth_check') === '1') return json({ ok: true, caller })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const tok = Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || ''
  const loc = Deno.env.get('GHL_LOCATION_ID') || ''
  const aiKey = Deno.env.get('ANTHROPIC_API_KEY') || ''
  if (!tok || !loc || !aiKey) { await beat(db, false, 'missing GoHighLevel key/location or the AI key'); return json({ error: 'not set up' }, 500) }
  const body: Any = await req.json().catch(() => ({}))
  const ai: Any = new Anthropic({ apiKey: aiKey })

  /* THE TEST BENCH (owner only): made-up calls with their own context; nothing read from GoHighLevel, nothing stored */
  if (Array.isArray(body.eval)) {
    if (caller !== 'owner') return json({ error: 'the test bench is for the owner only' }, 403)
    const hub = await loadHub(db)
    const out = []
    for (const e of body.eval.slice(0, 10)) {
      const call: CallIn = { message_id: String(e.id || 'eval'), call_at: String(e.call_at), direction: e.direction === 'in' ? 'in' : 'out', seconds: Number(e.seconds || 120), caller: String(e.caller || ''), transcript: String(e.transcript || '') }
      const who: Who = e.who || { match: 'none' }, c = e.context || {}
      const open = openCards(String(who.name || ''), call.call_at, c.ops || [], DONE)
      const rel = [...relatedOf(String(who.name || ''), call.call_at, c.ops || [], c.coverage || [], c.timekeeper || []),
        ...workflows(String(who.name || ''), call.call_at, { lead: c.lead, journeys: c.journeys, steps: c.steps, stepTitles: hub.stepTitles, staffing: c.staffing, visitChanges: c.visitChanges, leads: c.leads })]
      try { out.push({ id: call.message_id, ...(await readOne(ai, call, who, open, c.earlier || [], rel, { domains: hub.domains, staffing: e.staffing ?? staffingAt(hub, call.call_at) })) }) }
      catch (err) { out.push({ id: call.message_id, error: String((err as Error)?.message || err).slice(0, 300) }) }
    }
    return json({ ok: true, version: VERSION, results: out })
  }

  const st: Any = (await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()).data?.data ?? {}
  if (st.call_tasks_practice !== true) { await beat(db, true, 'off (call_tasks_practice is not on)'); return json({ ok: true, off: true }) }
  const since = String(st.call_tasks_since || st.call_pull_since || '')
  if (!Number.isFinite(Date.parse(since))) { await beat(db, false, 'no start time'); return json({ error: 'no start time set' }, 500) }

  /* 1 · which calls: named ones (owner), else the handled calls since the start that this version has not read */
  const named: string[] = caller === 'owner' && Array.isArray(body.message_ids) ? body.message_ids.map(String).slice(0, 20) : []
  let seenQ = db.from('call_pull_seen').select('message_id, call_at, direction, seconds, caller, stage')
  seenQ = named.length ? seenQ.in('message_id', named) : seenQ.gte('call_at', since).in('stage', ['done', 'practice']).order('call_at', { ascending: true }).limit(LOOKBACK)
  const { data: seenRows, error: sErr } = await seenQ
  if (sErr) { await beat(db, false, 'call_pull_seen read: ' + sErr.message); return json({ error: 'could not read the calls' }, 500) }
  const ids = (seenRows ?? []).map((r: { message_id: string }) => r.message_id)
  const { data: doneRows } = ids.length ? await db.from('call_task_reading').select('message_id').eq('version', VERSION).in('message_id', ids) : { data: [] }
  const already = new Set((doneRows ?? []).map((r: { message_id: string }) => r.message_id))
  const todo = (seenRows ?? []).filter((r: { message_id: string }) => !already.has(r.message_id)).slice(0, Number(body.limit) > 0 ? Math.min(Number(body.limit), 20) : PER_RUN)
  const out = { calls: ids.length, read: 0, cards: 0, no_cards: 0, no_transcript: 0, errors: 0 }
  if (!todo.length) { await beat(db, true, JSON.stringify(out)); return json({ ok: true, ...out }) }
  const hub = await loadHub(db)

  for (const s of todo) {
    const row: Record<string, Any> = { message_id: s.message_id, version: VERSION, mode: 'practice', call_at: s.call_at, direction: s.direction === 'in' ? 'in' : 'out',
      seconds: s.seconds, caller: s.caller, match: 'none', model: MODEL, call_type: 'other', tasks: [], resolves: [], detail: {} }
    try {
      /* 2 · the message (for its contact), the transcript and the contact, all reads */
      const m = await fetch(`${GHL}/conversations/messages/${encodeURIComponent(s.message_id)}`, { headers: H(tok) })
      const mj: Any = m.ok ? await m.json().catch(() => ({})) : {}
      const msg: Any = mj?.message ?? mj ?? {}
      const tr = await fetch(`${GHL}/conversations/locations/${encodeURIComponent(loc)}/messages/${encodeURIComponent(s.message_id)}/transcription`, { headers: H(tok) })
      const text = tr.ok ? transcriptText(await tr.json().catch(() => null)) : ''
      if (!text) { out.no_transcript++; continue }                  // left for the next run (call-pull already waits for transcripts)
      let ct: Any = {}
      if (msg.contactId) {
        try { const r = await fetch(`${GHL}/contacts/${encodeURIComponent(msg.contactId)}`, { headers: H(tok, '2021-07-28') }); if (r.ok) ct = (await r.json())?.contact || {} } catch { /* name stays as seen */ }
      }
      /* 3 · who, by the identity layer */
      const { data: w } = await db.rpc('call_who', { p_phone: String(ct.phone || '') })
      const who: Who = w && typeof w === 'object' ? w : { match: 'none' }
      Object.assign(row, { match: who.match, person_id: who.person_id ?? null, lead_id: who.lead_id ?? null, who_name: who.name ?? null, who_roles: who.roles ?? [] })
      row.caller = row.caller || shortName(ct.firstName, ct.lastName) || null
      /* 4 · open cards, earlier suggestions, and what the Hub's systems and workflows already have */
      const name = String(who.name || '').trim().toLowerCase()
      const open: OpenCard[] = openCards(name, s.call_at, hub.ops, DONE)   // as live would see them: nothing made more than 20 minutes after the call
      let earlier: Earlier[] = []
      if (who.match === 'one' && (who.person_id || who.lead_id)) {
        const from = new Date(Date.parse(s.call_at) - 24 * 3600e3).toISOString()
        let eq = db.from('call_task_reading').select('message_id, call_at, tasks').eq('version', VERSION).gte('call_at', from).lt('call_at', s.call_at)
        eq = who.person_id ? eq.eq('person_id', who.person_id) : eq.eq('lead_id', who.lead_id)
        const { data: er } = await eq
        earlier = (er ?? []).filter((e: Earlier) => Array.isArray(e.tasks) && e.tasks.length)
      }
      let journeys: Any[] = [], steps: Any[] = []
      if (who.person_id || who.lead_id) {
        let jq = db.from('client_journey').select('journey_id, client_name, status, target_start, assigned_cc, person_id, lead_id').eq('status', 'open')
        jq = who.person_id ? jq.eq('person_id', who.person_id) : jq.eq('lead_id', who.lead_id)
        journeys = (await jq).data ?? []
        if (journeys.length) steps = (await db.from('client_journey_step').select('journey_id, step_key, state, waiting_on').in('journey_id', journeys.map((j: Any) => j.journey_id))).data ?? []
      }
      const lead = who.lead_id ? hub.leads.find((l: Any) => String(l?.id) === String(who.lead_id)) : null
      const related = [...relatedOf(String(who.name || ''), s.call_at, hub.ops, hub.coverage, hub.timekeeper),
        ...workflows(String(who.name || ''), s.call_at, { lead, journeys, steps, stepTitles: hub.stepTitles, staffing: hub.staffing, visitChanges: hub.visitChanges, leads: hub.leads })]
      /* 5 · the reading; owners from the Hub, never from the AI */
      const call: CallIn = { message_id: s.message_id, call_at: s.call_at, direction: row.direction, seconds: Number(s.seconds || 0), caller: row.caller || '', transcript: text }
      const got = await readOne(ai, call, who, open, earlier, related, { domains: hub.domains, staffing: staffingAt(hub, s.call_at) })
      if (got.error) { row.error = got.error.slice(0, 300); out.errors++ }
      else {
        const r = got.reading!
        Object.assign(row, { call_type: r.call_type, tasks: r.tasks.map((t) => ({ ...t, voicemail: r.is_voicemail })), resolves: r.resolves, no_task_reason: r.no_task_reason || null, detail: r.detail })
        if (r.tasks.length) out.cards += r.tasks.length; else out.no_cards++
      }
    } catch (e) {
      row.error = String((e as Error)?.message || e).slice(0, 300); out.errors++
    }
    const { error: iErr } = await db.from('call_task_reading').insert(row)
    if (iErr && !/duplicate/i.test(iErr.message)) { out.errors++; continue }
    out.read++
  }
  await beat(db, out.errors === 0, JSON.stringify(out))
  return json({ ok: true, ...out })
})
