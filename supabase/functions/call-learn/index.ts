// =============================================================================
// call-learn · Learned on this call (step 1, Desktop 1050, 2026-10-22)
// =============================================================================
// Samantha: "sometimes we speak to someone several times before they book an assessment, we want to compaile as much
// information as possible, dont lose any info." Approved mockup https://claude.ai/artifact/BapTUgrqCvdYjjjvgFRDDR, her
// yes to all 5 decisions and "Build step 1 in practice".
//
// Every 5 minutes, two minutes after lead-record: each answered call the recorder put on a lead (a conversation, or a
// call someone already logged by hand) is read ONCE with the same reader as "Make this a lead" (_shared/call-lead.ts),
// and what it heard is kept in call_learned for the Hub's "Learned on this call" box. GoHighLevel may still be writing
// the transcript: no transcript yet = tried again on later runs (4 tries), then "no transcript".
// Nothing here changes a lead: a person adds what is right from the box (the Hub's own lead form and save). The
// transcript is never stored; only what the reader filled in. Every GoHighLevel request is a read. Nothing is sent.
// While ops_settings.call_learn_live is not true the Hub shows the box to owners only, with adding off (practice).
// Runs on its schedule (the vault secret) or the owner's key. ?limit=N reads at most N calls (the installer's proof).
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jobCaller } from '../_shared/job-auth.ts'
import { request, toolAnswer, toPrefill } from '../_shared/call-lead.ts'
import { adlCatalog } from '../_shared/axiscare-adls.ts'
import { transcriptText, pickTodo, toStore, PER_RUN, MAX_TRIES, MIN_SECONDS } from '../_shared/call-learn.ts'
// deno-lint-ignore no-explicit-any
type Any = any

const GHL = 'https://services.leadconnectorhq.com'
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const H = (tok: string, v = '2021-04-15') => ({ Authorization: `Bearer ${tok}`, Version: v, Accept: 'application/json' })
export const BUDGET_MS = 100e3
const chicagoDay = (iso: string) => {
  const d = new Date(iso); if (isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
    + ' (' + d.toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'long' }) + ')'
}

async function beat(db: Any, ok: boolean, note: string) {
  try {
    await db.rpc('upsert_app_data_item', { target_key: 'automation_heartbeats',
      item: { id: 'hb_call-learn', automation: 'call-learn', at: new Date().toISOString(), ok, note: String(note).slice(0, 300) } })
  } catch { /* never block on the heartbeat */ }
}
/** One Messages API call: the response, or why there is none (kept on the call so a failure is never quiet). */
async function ask(apiKey: string, body: Any): Promise<{ resp: Any; why: string }> {
  const { betas, ...rest } = body
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-beta': betas.join(','), 'content-type': 'application/json' },
      body: JSON.stringify(rest) })
    if (!r.ok) {
      const t = await r.text().catch(() => ''); console.error('anthropic', r.status, t.slice(0, 300))
      let type = '', msg = ''; try { const e = JSON.parse(t)?.error || {}; type = String(e.type || ''); msg = String(e.message || '') } catch { /* not JSON */ }
      /* the service's own words say which setting it refused (1056b: a bare "400 (invalid_request_error)" could not be fixed) */
      return { resp: null, why: `the AI service answered ${r.status}${type ? ' (' + type + ')' : ''}${msg ? ': ' + msg.replace(/\s+/g, ' ').slice(0, 240) : ''}` }
    }
    const resp = await r.json().catch(() => null)
    return resp ? { resp, why: '' } : { resp: null, why: 'the AI service sent an unreadable answer' }
  } catch { return { resp: null, why: 'the AI service could not be reached' } }
}
/* 1050 found it: on a call with little to fill in, the model sometimes answers in words instead of the form. Forcing the
   tool is a 400 on Claude Opus 5.5, so it gets its own answer back unchanged and is asked once more for the form. */
export const NUDGE = 'Answer only by calling fill_lead_form. Leave empty every box the call did not answer; an empty form is the right answer for a call with nothing to fill in.'

Deno.serve(async (req) => {
  const caller = await jobCaller(req)
  if (!caller) return json({ error: 'not allowed' }, 401)
  const q = new URL(req.url).searchParams
  if (q.get('auth_check') === '1') return json({ ok: true, caller })
  const t0 = Date.now()
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const tok = Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || '', loc = Deno.env.get('GHL_LOCATION_ID') || ''
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') || ''
  if (!tok || !loc || !apiKey) { await beat(db, false, 'missing GoHighLevel or AI key'); return json({ error: 'not set up' }, 500) }
  const st: Any = (await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()).data?.data ?? {}
  const since = Date.parse(String(st.call_learn_since || ''))
  if (!Number.isFinite(since)) { await beat(db, false, 'no call_learn_since set'); return json({ error: 'no start time set' }, 500) }
  const max = Math.max(1, Math.min(PER_RUN, Number(q.get('limit') || PER_RUN) || PER_RUN))
  const out: Record<string, Any> = { live: st.call_learn_live === true, looked_at: 0, read: 0, waiting: 0, no_transcript: 0, skipped: 0, errors: 0 }

  /* 1 · the recorder's answered calls on a lead since the start, and what was already read */
  const seen: Any[] = (await db.from('lead_record_seen').select('message_id, msg_at, kind, status, lead_id, ev').eq('mode', 'live').eq('kind', 'call')
    .in('status', ['recorded', 'already']).gte('msg_at', new Date(since).toISOString()).order('msg_at', { ascending: true }).limit(500)).data ?? []
  const done: Any[] = seen.length ? (await db.from('call_learned').select('message_id, status, tries').in('message_id', seen.map((s) => s.message_id))).data ?? [] : []
  const leads: Any[] = (await db.from('app_data').select('data').eq('key', 'leads').maybeSingle()).data?.data ?? []
  const todo = pickTodo(seen, done, leads, max)
  const tries = new Map(done.map((d: Any) => [String(d.message_id), Number(d.tries || 0)]))
  let users: Any = {}
  try { users = (((await db.from('app_data').select('data').eq('key', 'ghl_users').maybeSingle()).data?.data ?? []).find((x: Any) => x?.id === 'people') || {}).people || {} } catch { users = {} }
  const cat = todo.length ? await adlCatalog() : { list: [] }

  /* 2 · read each one (within the time budget) */
  for (const s of todo) {
    if (Date.now() - t0 > BUDGET_MS) { out.out_of_time = true; break }
    out.looked_at++
    const id = String(s.message_id), n = (tries.get(id) || 0) + 1
    const row: Any = { message_id: id, lead_id: String(s.lead_id), msg_at: s.msg_at, tries: n, read_at: new Date().toISOString() }
    const save = async (status: string, extra: Any = {}) => {
      const { error } = await db.from('call_learned').upsert({ ...row, status, ...extra }, { onConflict: 'message_id' })
      if (error) { out.errors++; out.save_failed = String(error.message).slice(0, 160) } else out[status === 'error' ? 'errors' : status]++
    }
    const m = await fetch(`${GHL}/conversations/messages/${encodeURIComponent(id)}`, { headers: H(tok) })
    if (!m.ok) { await save('error', { note: `GoHighLevel answered ${m.status} for the call` }); continue }
    const msg: Any = ((await m.json().catch(() => ({}))) as Any)?.message ?? {}
    row.direction = msg.direction === 'outbound' ? 'outbound' : 'inbound'
    row.seconds = Math.max(0, Number(msg?.meta?.call?.duration || 0) || 0)
    row.staff = String(s.ev?.by || users[String(msg.userId || '')]?.email || '').toLowerCase().slice(0, 120) || null
    if (row.seconds < MIN_SECONDS) { await save('skipped', { note: 'shorter than ' + MIN_SECONDS + ' seconds' }); continue }
    const tr = await fetch(`${GHL}/conversations/locations/${encodeURIComponent(loc)}/messages/${encodeURIComponent(id)}/transcription`, { headers: H(tok) })
    const transcript = tr.ok ? transcriptText(await tr.json().catch(() => null)) : ''
    if (!transcript) { await save(n >= MAX_TRIES ? 'no_transcript' : 'waiting', { note: 'GoHighLevel has no transcript ' + (n >= MAX_TRIES ? 'for this call' : 'yet') }); continue }
    const req0 = request({ transcript, callDay: chicagoDay(String(s.msg_at)), direction: row.direction, knownName: '', adls: (cat as Any).list || [] })
    let r = await ask(apiKey, req0), a = toolAnswer(r.resp)
    if (!a && r.resp && r.resp.stop_reason !== 'refusal' && Array.isArray(r.resp.content)) {
      r = await ask(apiKey, { ...req0, messages: [...req0.messages, { role: 'assistant', content: r.resp.content }, { role: 'user', content: NUDGE }] })
      a = toolAnswer(r.resp)
    } else if (!a && !r.resp) { r = await ask(apiKey, req0); a = toolAnswer(r.resp) }   /* the service failed: once more */
    if (!a) {
      if (r.resp && r.resp.stop_reason === 'refusal') await save('skipped', { note: 'the AI would not read this call' })
      else if (r.resp) await save('skipped', { note: 'the AI found nothing it could fill in from this call' })
      else await save('error', { note: r.why || 'the AI could not read this call' })
      continue
    }
    const kept = toStore(toPrefill(a, { first_name: '', last_name: '', phone: '', email: '' }, (cat as Any).list || []))
    await save('read', { reading: kept, note: null })
  }
  await beat(db, out.errors === 0, JSON.stringify(out))
  return json({ ok: true, ...out })
})
