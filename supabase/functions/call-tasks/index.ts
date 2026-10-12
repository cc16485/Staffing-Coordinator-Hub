// =============================================================================
// call-tasks — the AI employee reads each answered call for follow-up work (650, approved 2026-10-12)
// =============================================================================
// Every 10 minutes, after call-pull has fetched and handled the answered calls, this takes those calls (call_pull_seen,
// newest unread first in time order), gets GoHighLevel's transcript and contact again, asks who the number belongs to
// (call_who: the identity layer, never a guess), and asks Claude Sonnet 5.5 which follow-up cards the call created
// (_shared/call-tasks.ts). The answer is kept in call_task_reading: the would-be cards, never the transcript.
// PRACTICE (slice A): nothing is written to Work. The Hub shows the readings on the Practice list beside the cards
// people made. Cards become real only in slice C, after her authority grant and her switch.
// Runs only while ops_settings.call_tasks_practice === true. Nothing is ever sent to anyone. Every GoHighLevel request
// is a read. Runs on its schedule (the vault secret) or the owner's key; the owner may name calls to re-read
// ({ message_ids: [...] }).
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'
import { jobCaller } from '../_shared/job-auth.ts'
import { VERSION, MODEL, request, retryRequest, clean, answerOf, transcriptText, shortName, related as relatedOf, type CallIn, type Who, type OpenCard, type Earlier } from '../_shared/call-tasks.ts'

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
  // deno-lint-ignore no-explicit-any
  const body: any = await req.json().catch(() => ({}))

  const { data: stRow } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const st: any = stRow?.data ?? {}
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

  const ai = new Anthropic({ apiKey: aiKey })
  const { data: opsRow } = await db.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const ops: any[] = Array.isArray(opsRow?.data) ? opsRow.data : []
  const { data: covRows } = await db.from('app_data').select('key, data').in('key', ['coverage_cases', 'timekeeper_cases'])
  // deno-lint-ignore no-explicit-any
  const byKey: Record<string, any[]> = Object.fromEntries((covRows ?? []).map((r: { key: string; data: unknown }) => [r.key, Array.isArray(r.data) ? r.data : []]))

  for (const s of todo) {
    // deno-lint-ignore no-explicit-any
    const row: Record<string, any> = { message_id: s.message_id, version: VERSION, mode: 'practice', call_at: s.call_at, direction: s.direction === 'in' ? 'in' : 'out',
      seconds: s.seconds, caller: s.caller, match: 'none', model: MODEL, call_type: 'other', tasks: [], resolves: [] }
    try {
      /* 2 · the message (for its contact), the transcript and the contact, all reads */
      const m = await fetch(`${GHL}/conversations/messages/${encodeURIComponent(s.message_id)}`, { headers: H(tok) })
      // deno-lint-ignore no-explicit-any
      const mj: any = m.ok ? await m.json().catch(() => ({})) : {}
      // deno-lint-ignore no-explicit-any
      const msg: any = mj?.message ?? mj ?? {}
      const tr = await fetch(`${GHL}/conversations/locations/${encodeURIComponent(loc)}/messages/${encodeURIComponent(s.message_id)}/transcription`, { headers: H(tok) })
      const text = tr.ok ? transcriptText(await tr.json().catch(() => null)) : ''
      if (!text) { out.no_transcript++; continue }                  // left for the next run (call-pull already waits for transcripts)
      // deno-lint-ignore no-explicit-any
      let ct: any = {}
      if (msg.contactId) {
        try { const r = await fetch(`${GHL}/contacts/${encodeURIComponent(msg.contactId)}`, { headers: H(tok, '2021-07-28') }); if (r.ok) ct = (await r.json())?.contact || {} } catch { /* name stays as seen */ }
      }
      /* 3 · who, by the identity layer */
      const { data: w } = await db.rpc('call_who', { p_phone: String(ct.phone || '') })
      const who: Who = w && typeof w === 'object' ? w : { match: 'none' }
      Object.assign(row, { match: who.match, person_id: who.person_id ?? null, lead_id: who.lead_id ?? null, who_name: who.name ?? null, who_roles: who.roles ?? [] })
      row.caller = row.caller || shortName(ct.firstName, ct.lastName) || null
      /* 4 · open cards about this person, and earlier suggestions for this number in the last day */
      const name = String(who.name || '').trim().toLowerCase()
      const open: OpenCard[] = name ? ops.filter((o) => o && !DONE.has(String(o.status || '')) && String(o.about || '').trim().toLowerCase() === name)
        .slice(-8).map((o) => ({ id: String(o.id), title: String(o.title || '').slice(0, 140), created_at: o.created_at })) : []
      let earlier: Earlier[] = []
      if (who.match === 'one' && (who.person_id || who.lead_id)) {
        const from = new Date(Date.parse(s.call_at) - 24 * 3600e3).toISOString()
        let eq = db.from('call_task_reading').select('message_id, call_at, tasks').eq('version', VERSION).gte('call_at', from).lt('call_at', s.call_at)
        eq = who.person_id ? eq.eq('person_id', who.person_id) : eq.eq('lead_id', who.lead_id)
        const { data: er } = await eq
        earlier = (er ?? []).filter((e: Earlier) => Array.isArray(e.tasks) && e.tasks.length)
      }
      /* 4b · what the Hub's own systems already have for this person around the call (cards, call-off and clock-in cases) */
      const related = relatedOf(String(who.name || ''), s.call_at, ops, byKey.coverage_cases || [], byKey.timekeeper_cases || [])
      /* 5 · the reading */
      const call: CallIn = { message_id: s.message_id, call_at: s.call_at, direction: row.direction, seconds: Number(s.seconds || 0), caller: row.caller || '', transcript: text }
      // deno-lint-ignore no-explicit-any
      const req1 = request(call, who, open, earlier, related)
      // deno-lint-ignore no-explicit-any
      let resp = await (ai.beta.messages as any).create(req1)
      let got = answerOf(resp)
      if (got.error && resp?.stop_reason !== 'refusal' && Array.isArray(resp?.content) && /did not submit/.test(got.error)) {
        // deno-lint-ignore no-explicit-any
        resp = await (ai.beta.messages as any).create(retryRequest(req1, resp))   // once: it answered in text instead of the tool
        got = answerOf(resp)
      }
      if (got.error) { row.error = got.error.slice(0, 300); out.errors++ }
      else {
        const r = clean(got.input, open, earlier, related)
        Object.assign(row, { call_type: r.call_type, tasks: r.tasks.map((t) => ({ ...t, voicemail: r.is_voicemail })), resolves: r.resolves, no_task_reason: r.no_task_reason || null })
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
