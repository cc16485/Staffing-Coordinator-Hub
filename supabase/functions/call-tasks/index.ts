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
// v10 (2026-10-12, "it should read GHL texts!"): it also reads GoHighLevel texts: each new burst from one person (once they
// have been quiet 10 minutes), with the thread around it; a burst that is only "ok" or "thanks" needs no reading. Each card
// carries its prepared steps; the Hub looks up the real AxisCare visit and the client's caregivers for them (read only).
// Runs only while ops_settings.call_tasks_practice === true (texts unless ops_settings.call_tasks_texts === false). Nothing is ever sent to anyone. Every GoHighLevel request
// is a read. Runs on its schedule (the vault secret) or the owner's key. The owner may name calls to re-read
// ({ message_ids: [...] }) or run the test bench ({ eval: [...] }: made-up calls, nothing read from GoHighLevel and
// nothing stored).
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'npm:@anthropic-ai/sdk'
import { jobCaller } from '../_shared/job-auth.ts'
import { seatHolder } from '../_shared/duty.ts'
import { VERSION, MODEL, ACK, request, retryRequest, clean, answerOf, openCards, transcriptText, shortName, related as relatedOf, workflows,
  type CallIn, type Who, type OpenCard, type Earlier, type Related, type Action } from '../_shared/call-tasks.ts'

const GHL = 'https://services.leadconnectorhq.com'
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const H = (tok: string, v = '2021-04-15') => ({ Authorization: `Bearer ${tok}`, Version: v, Accept: 'application/json' })
export const PER_RUN = 6, PER_RUN_TEXTS = 6, LOOKBACK = 80, TEXT_QUIET_MS = 10 * 60e3, CONVOS = 40
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

/* ── AxisCare, read only: the visits a prepared step is about (v10) ── */
function axCreds() {
  let token = ''
  for (const n of ['AXISCARE_API_KEY', 'AXISCARE_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site: /^\d+$/.test(site) ? site : '' }
}
const rowsOf = (v: Any): Any[] => Array.isArray(v) ? v : (v && typeof v === 'object') ? Object.values(v) : []
export function shapeVisit(v: Any) {
  const s = String(v?.scheduledStartDate ?? v?.startDate ?? ''), e = String(v?.scheduledEndDate ?? v?.endDate ?? '')
  return { visit_id: v?.id != null ? String(v.id) : '', client: [v?.client?.firstName, v?.client?.lastName].filter(Boolean).join(' '), client_id: v?.client?.id != null ? String(v.client.id) : '',
    caregiver: [v?.caregiver?.firstName, v?.caregiver?.lastName].filter(Boolean).join(' '), caregiver_id: v?.caregiver?.id != null ? String(v.caregiver.id) : '',
    date: s.slice(0, 10), start: s.slice(11, 16), end: e.slice(11, 16), removed: v?.removed === true }
}
async function axVisits(q: string): Promise<Any[] | null> {
  const { token, site } = axCreds(); if (!token || !site) return null
  try {
    const r = await fetch(`https://${site}.axiscare.com/api/visits?${q}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': '2023-10-01', 'User-Agent': 'CaringCompanions-Hub/1.0' } })
    if (!r.ok) return null
    const j: Any = await r.json().catch(() => ({}))
    return rowsOf(j?.results?.visits ?? j?.visits ?? j?.results ?? []).map(shapeVisit).filter((v: Any) => v.date && !v.removed)
  } catch { return null }
}
const chiDay = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
const sameName = (a: string, b: string) => { const x = a.trim().toLowerCase(), y = b.trim().toLowerCase(); if (!x || !y) return false; return y.includes(x) || x.includes(y) || x.split(/\s+/)[0] === y.split(/\s+/)[0] }
/** The Hub finds the visit and the people for each prepared step; the AI never does. Shown in practice, used live. */
async function resolveActions(acts: Action[], ids: { client?: string; caregiver?: string }, callAt: string): Promise<Action[]> {
  const out: Action[] = []
  let clientId = ids.client || ''
  for (const a of acts) {
    const r: Record<string, unknown> = {}
    if (a.kind === 'axiscare_visit_change' && a.date) {
      const list = ids.caregiver ? await axVisits(`caregiverIds=${encodeURIComponent(ids.caregiver)}&startDate=${a.date}&endDate=${a.date}`)
        : clientId ? await axVisits(`clientIds=${encodeURIComponent(clientId)}&startDate=${a.date}&endDate=${a.date}`) : null
      if (list === null) r.note = 'AxisCare could not be read for this visit'
      else {
        const hits = list.filter((v: Any) => !a.client_name || sameName(a.client_name, v.client))
        if (hits.length === 1) { const v = hits[0]; Object.assign(r, { found: true, visit: { client: v.client, caregiver: v.caregiver, date: v.date, start: v.start, end: v.end }, after: { start: a.start || v.start, end: a.end || v.end } }); clientId = clientId || v.client_id }
        else r.note = hits.length ? `${hits.length} visits match that day; a person picks the right one` : 'no matching visit in AxisCare that day'
      }
    }
    if (a.kind === 'text_client_caregivers') {
      const d0 = chiDay(Date.parse(callAt)), d14 = chiDay(Date.parse(callAt) + 14 * 864e5)
      const list = clientId ? await axVisits(`clientIds=${encodeURIComponent(clientId)}&startDate=${d0}&endDate=${d14}`) : null
      if (list === null) r.note = clientId ? 'AxisCare could not be read for this client' : 'the client could not be found in AxisCare'
      else r.caregivers = [...new Set(list.map((v: Any) => v.caregiver).filter(Boolean))].slice(0, 12)
    }
    out.push(Object.keys(r).length ? { ...a, resolved: r } : a)
  }
  return out
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
      const call: CallIn = { message_id: String(e.id || 'eval'), call_at: String(e.call_at), direction: e.direction === 'in' ? 'in' : 'out', seconds: Number(e.seconds || 120), caller: String(e.caller || ''), transcript: String(e.transcript || ''), channel: e.channel === 'text' ? 'text' : 'call' }
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
  const out: Record<string, number> = { calls: ids.length, read: 0, cards: 0, no_cards: 0, no_transcript: 0, errors: 0 }
  const hub = await loadHub(db)

  for (const s of named.length || todo.length ? todo : []) {
    const row: Record<string, Any> = { message_id: s.message_id, version: VERSION, mode: 'practice', channel: 'call', call_at: s.call_at, direction: s.direction === 'in' ? 'in' : 'out',
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
        await withActions(r, db, who, s.call_at)
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
  /* 6 · GoHighLevel texts (v10): each new burst of texts from one person, read with the thread around it */
  if (st.call_tasks_texts !== false) {
    const tx = await readTexts(db, ai, hub, tok, loc, since, Number(body.text_limit) > 0 ? Math.min(Number(body.text_limit), 20) : PER_RUN_TEXTS)
    Object.assign(out, { texts_read: tx.read, text_cards: tx.cards, text_skipped: tx.skipped, text_errors: tx.errors })
    out.errors += tx.errors
  }
  await beat(db, out.errors === 0, JSON.stringify(out))
  return json({ ok: true, ...out })
})

/** The prepared steps get their real visit and people from AxisCare (read only), on cards and tasks alike. */
async function withActions(r: Any, db: Any, who: Who, callAt: string) {
  const ids: { client?: string; caregiver?: string } = {}
  if (who.person_id) {
    const { data: src } = await db.from('person_source_id').select('entity_type, source_id').eq('person_id', who.person_id).eq('system', 'axiscare').eq('needs_review', false)
    for (const x of src ?? []) { if (x.entity_type === 'client') ids.client = String(x.source_id); if (x.entity_type === 'caregiver') ids.caregiver = String(x.source_id) }
  }
  for (const it of r.detail.items) if ((it.actions || []).length) it.actions = await resolveActions(it.actions, ids, callAt)
  r.tasks = r.tasks.map((t: Any) => { const it = r.detail.items.find((i: Any) => i.decision === 'new_card' && i.title === t.title); return it ? { ...t, actions: it.actions || [] } : t })
}

/** One person's newest texts, oldest first, as a conversation the reader can follow. Bodies never stored. */
export function threadText(msgs: Any[]): string {
  return msgs.map((m: Any) => {
    const at = new Date(String(m.dateAdded || m.dateUpdated || '')).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', minute: '2-digit' })
    const sms = Number(m.type) === 1 || /SMS/i.test(String(m.messageType || ''))
    const what = sms ? String(m.body || '').slice(0, 600) : /CALL/i.test(String(m.messageType || '')) ? '(a phone call)' : '(' + String(m.messageType || 'message').replace(/^TYPE_/, '').toLowerCase() + ')'
    return `[${at}] ${m.direction === 'inbound' ? 'Them' : 'Office'}: ${what}`
  }).join('\n')
}

async function readTexts(db: Any, ai: Any, hub: Any, tok: string, loc: string, since: string, limit: number) {
  const res = { read: 0, cards: 0, skipped: 0, errors: 0 }
  const sinceMs = Date.parse(since)
  const c = await fetch(`${GHL}/conversations/search?locationId=${encodeURIComponent(loc)}&limit=${CONVOS}`, { headers: H(tok) })
  if (!c.ok) { res.errors++; return res }
  const convos: Any[] = ((await c.json().catch(() => ({})))?.conversations || []).filter((x: Any) => Number(x.lastMessageDate || 0) >= sinceMs || Date.parse(String(x.lastMessageDate || '')) >= sinceMs)
  const bursts: Any[] = []
  for (const cv of convos) {
    if (bursts.length >= limit * 3) break
    try {
      const r = await fetch(`${GHL}/conversations/${encodeURIComponent(cv.id)}/messages?limit=30`, { headers: H(tok) })
      if (!r.ok) continue
      const b: Any = await r.json().catch(() => ({}))
      const msgs: Any[] = (b?.messages?.messages || b?.messages || []).slice().sort((x: Any, y: Any) => String(x.dateAdded || '').localeCompare(String(y.dateAdded || '')))
      const sms = (m: Any) => Number(m.type) === 1 || /SMS/i.test(String(m.messageType || ''))
      const inb = msgs.filter((m: Any) => m.direction === 'inbound' && sms(m) && Date.parse(String(m.dateAdded || '')) >= sinceMs && String(m.body || '').trim())
      if (!inb.length) continue
      const last = inb[inb.length - 1]
      if (Date.now() - Date.parse(String(last.dateAdded)) < TEXT_QUIET_MS) continue   // they may still be typing
      const lastOut = [...msgs].reverse().find((m: Any) => m.direction !== 'inbound' && Date.parse(String(m.dateAdded || '')) < Date.parse(String(last.dateAdded)))
      const fresh = inb.filter((m: Any) => !lastOut || String(m.dateAdded) > String(lastOut.dateAdded))
      bursts.push({ id: 'sms:' + String(last.id), at: String(last.dateAdded), contactId: String(cv.contactId || last.contactId || ''), phone: String(cv.phone || ''), name: String(cv.fullName || cv.contactName || ''),
        thread: msgs.slice(-15), fresh: fresh.length ? fresh : [last] })
    } catch { /* one conversation never stops the run */ }
  }
  if (!bursts.length) return res
  const { data: done } = await db.from('call_task_reading').select('message_id').eq('version', VERSION).in('message_id', bursts.map((x) => x.id))
  const seen = new Set((done ?? []).map((d: Any) => d.message_id))
  for (const bx of bursts.filter((x) => !seen.has(x.id)).sort((a, b) => a.at.localeCompare(b.at)).slice(0, limit)) {
    const row: Record<string, Any> = { message_id: bx.id, version: VERSION, mode: 'practice', channel: 'text', call_at: bx.at, direction: 'in', seconds: 0,
      caller: shortName(bx.name.split(' ')[0], bx.name.split(' ').slice(1).join(' ')) || null, match: 'none', model: MODEL, call_type: 'other', tasks: [], resolves: [], detail: {} }
    try {
      let phone = bx.phone
      if (!phone && bx.contactId) { try { const r = await fetch(`${GHL}/contacts/${encodeURIComponent(bx.contactId)}`, { headers: H(tok, '2021-07-28') }); if (r.ok) phone = String(((await r.json())?.contact || {}).phone || '') } catch { /* unknown */ } }
      const { data: w } = await db.rpc('call_who', { p_phone: phone })
      const who: Who = w && typeof w === 'object' ? w : { match: 'none' }
      Object.assign(row, { match: who.match, person_id: who.person_id ?? null, lead_id: who.lead_id ?? null, who_name: who.name ?? null, who_roles: who.roles ?? [] })
      if (bx.fresh.every((m: Any) => ACK.test(String(m.body || '')))) {
        Object.assign(row, { model: 'none', no_task_reason: 'only an acknowledgement (no reading needed)', detail: { summary: '', items: [] } }); res.skipped++
      } else {
        const name = String(who.name || '').trim().toLowerCase()
        const open = openCards(name, bx.at, hub.ops, DONE)
        let earlier: Earlier[] = []
        if (who.match === 'one' && (who.person_id || who.lead_id)) {
          let eq = db.from('call_task_reading').select('message_id, call_at, tasks').eq('version', VERSION).gte('call_at', new Date(Date.parse(bx.at) - 24 * 3600e3).toISOString()).lt('call_at', bx.at)
          eq = who.person_id ? eq.eq('person_id', who.person_id) : eq.eq('lead_id', who.lead_id)
          earlier = ((await eq).data ?? []).filter((e: Earlier) => Array.isArray(e.tasks) && e.tasks.length)
        }
        const related = [...relatedOf(String(who.name || ''), bx.at, hub.ops, hub.coverage, hub.timekeeper),
          ...workflows(String(who.name || ''), bx.at, { stepTitles: hub.stepTitles, staffing: hub.staffing, visitChanges: hub.visitChanges, leads: hub.leads })]
        const call: CallIn = { message_id: bx.id, call_at: bx.at, direction: 'in', seconds: 0, caller: row.caller || '', transcript: threadText(bx.thread), channel: 'text' }
        const got = await readOne(ai, call, who, open, earlier, related, { domains: hub.domains, staffing: staffingAt(hub, bx.at) })
        if (got.error) { row.error = got.error.slice(0, 300); res.errors++ }
        else {
          const r = got.reading!
          await withActions(r, db, who, bx.at)
          Object.assign(row, { call_type: r.call_type, tasks: r.tasks, resolves: r.resolves, no_task_reason: r.no_task_reason || null, detail: r.detail })
          res.cards += r.tasks.length
        }
      }
    } catch (e) { row.error = String((e as Error)?.message || e).slice(0, 300); res.errors++ }
    const { error: iErr } = await db.from('call_task_reading').insert(row)
    if (iErr && !/duplicate/i.test(iErr.message)) { res.errors++; continue }
    res.read++
  }
  return res
}
