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
// PRACTICE: nothing is written to Work. LIVE (2026-10-13, her "Let's stop practicing and go for it!"): while
// ops_settings.call_tasks_live is on, each follow-up becomes a real card in Work (kind call_followup) owned by the person
// the Hub names for its area, a follow-up the reader added to an open card goes on that card's history, and a card a
// later call answered is closed with a note. Prepared steps are drafts on the card; nothing is ever sent.
// v10 (2026-10-12, "it should read GHL texts!"): it also reads GoHighLevel texts: each new burst from one person (once they
// have been quiet 10 minutes), with the thread around it; a burst that is only "ok" or "thanks" needs no reading. Each card
// carries its prepared steps; the Hub looks up the real AxisCare visit and the client's caregivers for them (read only).
// v13 (2026-10-12, "how can we make sure nothing ever falls through the cracks", her "build both"): NO SILENT FAILURES:
// a call or text that could not be read is tried again (3 tries, 30 minutes apart, every try kept), a call GoHighLevel
// never transcribed gets a reading saying so, and the Practice tab shows every one that could not be read. THE PROMISE
// WATCH: every promise the office made and every confirmation it is waiting on gets a due day and an owner; the Hub
// checks the person's later calls, texts, cards and call outcomes and asks whether it was kept (call_promise_watch).
// In practice it only shows "would remind"; nobody is reminded.
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
  ownerFor, dueFor, dueEnd, checkRequest, cleanCheck, nextStatus, cardIdFor, liveCard, chicago, LIVE_KIND, type CallIn, type Who, type OpenCard, type Earlier, type Related, type Action,
  checkMode, stepProof, cardDecision, cardCheckRequest, cleanCardCheck, CARD_CHECK_DAYS, CARD_CHECK_PER_RUN, CARD_CHECK_AI_PER_RUN, CARD_CHECK_EVERY_MS, type Facts, type Ev, type Fact, type CheckMode } from '../_shared/call-tasks.ts'

const GHL = 'https://services.leadconnectorhq.com'
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const H = (tok: string, v = '2021-04-15') => ({ Authorization: `Bearer ${tok}`, Version: v, Accept: 'application/json' })
export const PER_RUN = 6, PER_RUN_TEXTS = 6, LOOKBACK = 80, TEXT_QUIET_MS = 10 * 60e3, CONVOS = 40
export const MAX_TRIES = 3, RETRY_MS = 30 * 60e3, WAIT_TRANSCRIPT_MS = 2 * 3600e3, MAX_ATTEMPT = 5
export const LIVE_PER_RUN = 40, LIVE_LOOK_MS = 2 * 864e5
export const WATCH_PER_RUN = 8, WATCH_DAYS = 14, WATCH_AFTER_DUE_MS = 3 * 864e5, CHECK_EVERY_MS = 60 * 60e3
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
type Tries = Map<string, { n: number; ok: boolean; last: number }>
/** What this version has already done with each message: how many tries, whether one worked, when the last was. */
async function triesOf(db: Any, ids: string[]): Promise<Tries> {
  const m: Tries = new Map()
  if (!ids.length) return m
  const { data } = await db.from('call_task_reading').select('message_id, attempt, error, read_at').eq('version', VERSION).in('message_id', ids)
  for (const r of data ?? []) {
    const t = m.get(r.message_id) || { n: 0, ok: false, last: 0 }
    m.set(r.message_id, { n: Math.max(t.n, Number(r.attempt) || 1), ok: t.ok || !r.error, last: Math.max(t.last, Date.parse(String(r.read_at)) || 0) })
  }
  return m
}
/** Read it now: never read, or every try failed, fewer than 3 tries, and the last was 30+ minutes ago. */
export function readNow(t: { n: number; ok: boolean; last: number } | undefined, now = Date.now()): boolean {
  return !t || (!t.ok && t.n < MAX_TRIES && now - t.last >= RETRY_MS)
}
/** Everything a reading needs from the Hub, loaded once per run. */
async function loadHub(db: Any) {
  const keys = ['ops_items', 'coverage_cases', 'timekeeper_cases', 'staffing_plans', 'visit_changes', 'leads', 'duty_windows', 'positions', 'ops_settings']
  const { data: rows } = await db.from('app_data').select('key, data').in('key', keys)
  const k: Record<string, Any> = Object.fromEntries((rows ?? []).map((r: { key: string; data: unknown }) => [r.key, r.data]))
  const arr = (x: Any) => Array.isArray(x) ? x : []
  const { data: doms } = await db.from('domains').select('code, owner_person').eq('active', true)
  const ids = [...new Set((doms ?? []).map((d: Any) => d.owner_person).filter(Boolean))]
  const { data: ppl } = ids.length ? await db.from('persons').select('person_id, full_name, primary_email').in('person_id', ids) : { data: [] }
  /* live cards need the owner's sign-in email: domain owners, plus each Staffing seat holder as staffingAt finds them */
  const emailByName = new Map<string, string>((ppl ?? []).filter((p: Any) => p.full_name && p.primary_email).map((p: Any) => [String(p.full_name).trim().toLowerCase(), String(p.primary_email).toLowerCase()]))
  const { data: staff } = await db.from('persons').select('full_name, primary_email').not('primary_email', 'is', null).limit(200)
  const nameOf = new Map((ppl ?? []).map((p: Any) => [p.person_id, p.full_name]))
  const byEmail = new Map((staff ?? []).map((p: Any) => [String(p.primary_email || '').toLowerCase(), p.full_name]))
  const domains: Record<string, string> = Object.fromEntries((doms ?? []).map((d: Any) => [d.code, String(nameOf.get(d.owner_person) || '')]))
  const { data: defs } = await db.from('client_journey_step_def').select('key, def').eq('active', true)
  const stepTitles: Record<string, string> = Object.fromEntries((defs ?? []).map((d: Any) => [d.key, String(d.def?.title || d.key)]))
  return { ops: arr(k.ops_items), coverage: arr(k.coverage_cases), timekeeper: arr(k.timekeeper_cases), staffing: arr(k.staffing_plans),
    visitChanges: arr(k.visit_changes), leads: arr(k.leads), windows: arr(k.duty_windows), positions: arr(k.positions), settings: k.ops_settings ?? {},
    domains, byEmail, emailByName, stepTitles }
}
/** Who held the Staffing seat about 15 minutes after the call (when the reader would have made the card). */
function staffingAt(hub: Any, callAt: string): string {
  const s = seatHolder(hub.windows, 'staffing', new Date(Date.parse(callAt) + 15 * 60e3), hub.settings, '', hub.positions)
  if (!s.person) return ''
  const name = String(hub.byEmail.get(s.person) || s.person.split('@')[0])
  if (hub.emailByName && /@/.test(s.person)) hub.emailByName.set(name.trim().toLowerCase(), String(s.person).toLowerCase())
  return name
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
  const live = st.call_tasks_live === true
  if (st.call_tasks_practice !== true && !live) { await beat(db, true, 'off (neither call_tasks_practice nor call_tasks_live is on)'); return json({ ok: true, off: true }) }
  const since = String(st.call_tasks_since || st.call_pull_since || '')
  if (!Number.isFinite(Date.parse(since))) { await beat(db, false, 'no start time'); return json({ error: 'no start time set' }, 500) }

  /* 1 · which calls: named ones (owner), else the handled calls since the start that this version has not read */
  const named: string[] = caller === 'owner' && Array.isArray(body.message_ids) ? body.message_ids.map(String).slice(0, 20) : []
  let seenQ = db.from('call_pull_seen').select('message_id, call_at, direction, seconds, caller, stage')
  seenQ = named.length ? seenQ.in('message_id', named) : seenQ.gte('call_at', since).in('stage', ['done', 'practice', 'error', 'no_transcript']).order('call_at', { ascending: true }).limit(LOOKBACK)
  const { data: seenRows, error: sErr } = await seenQ
  if (sErr) { await beat(db, false, 'call_pull_seen read: ' + sErr.message); return json({ error: 'could not read the calls' }, 500) }
  const ids = (seenRows ?? []).map((r: { message_id: string }) => r.message_id)
  const tries = await triesOf(db, ids)
  const todo = (seenRows ?? []).filter((r: { message_id: string }) => named.length ? (tries.get(r.message_id)?.n ?? 0) < MAX_ATTEMPT : readNow(tries.get(r.message_id)))
    .slice(0, Number(body.limit) > 0 ? Math.min(Number(body.limit), 20) : PER_RUN)
  const out: Record<string, number> = { calls: ids.length, read: 0, cards: 0, no_cards: 0, no_transcript: 0, errors: 0, could_not_read: 0, failed: 0 }
  const hub = await loadHub(db)

  for (const s of named.length || todo.length ? todo : []) {
    const row: Record<string, Any> = { message_id: s.message_id, version: VERSION, mode: live ? 'live' : 'practice', channel: 'call', call_at: s.call_at, direction: s.direction === 'in' ? 'in' : 'out',
      seconds: s.seconds, caller: s.caller, match: 'none', model: MODEL, call_type: 'other', tasks: [], resolves: [], detail: {}, attempt: (tries.get(s.message_id)?.n ?? 0) + 1 }
    try {
      /* 2 · the message (for its contact), the transcript and the contact, all reads */
      const m = await fetch(`${GHL}/conversations/messages/${encodeURIComponent(s.message_id)}`, { headers: H(tok) })
      const mj: Any = m.ok ? await m.json().catch(() => ({})) : {}
      const msg: Any = mj?.message ?? mj ?? {}
      const tr = await fetch(`${GHL}/conversations/locations/${encodeURIComponent(loc)}/messages/${encodeURIComponent(s.message_id)}/transcription`, { headers: H(tok) })
      const text = tr.ok ? transcriptText(await tr.json().catch(() => null)) : ''
      if (!text) {
        out.no_transcript++
        if (s.stage !== 'no_transcript' && Date.now() - Date.parse(s.call_at) < WAIT_TRANSCRIPT_MS) continue   // GoHighLevel may still be writing it
        /* never quietly missing: the call gets a reading that says nobody could read it (no retries; GoHighLevel has none) */
        Object.assign(row, { error: `GoHighLevel has no transcript for this call (${Math.round(Number(s.seconds) || 0)} seconds). Listen to the recording.`, attempt: Math.max(row.attempt, MAX_TRIES), model: 'none',
          detail: { contact_id: msg.contactId || null, failure: 'no_transcript' } })
      }
      if (!row.error) {
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
        row.detail = { ...r.detail, contact_id: msg.contactId || null }
        if (r.tasks.length) out.cards += r.tasks.length; else out.no_cards++
      }
      }
    } catch (e) {
      row.error = String((e as Error)?.message || e).slice(0, 300); out.errors++
    }
    if (row.error) { out.could_not_read++; if (row.attempt >= MAX_TRIES) out.failed++ }
    const { error: iErr } = await db.from('call_task_reading').insert(row)
    if (iErr && !/duplicate/i.test(iErr.message)) { out.errors++; out.save_failed = (out.save_failed || 0) + 1; continue }
    out.read++
  }
  /* 6 · GoHighLevel texts (v10): each new burst of texts from one person, read with the thread around it */
  if (st.call_tasks_texts !== false) {
    const tx = await readTexts(db, ai, hub, tok, loc, since, Number(body.text_limit) > 0 ? Math.min(Number(body.text_limit), 20) : PER_RUN_TEXTS, live)
    Object.assign(out, { texts_read: tx.read, text_cards: tx.cards, text_skipped: tx.skipped, text_errors: tx.errors, text_failed: tx.failed })
    out.errors += tx.errors
    if (tx.search_failed) out.save_failed = (out.save_failed || 0) + 1
  }
  /* 7 · LIVE: the readings become cards in Work */
  if (live) {
    const lc = await makeCards(db, hub, st)
    Object.assign(out, { live_cards: lc.made, live_added: lc.added, live_closed: lc.closed, live_unassigned: lc.unassigned, live_errors: lc.errors })
    if (lc.errors) out.save_failed = (out.save_failed || 0) + 1
  }
  /* 7b · CARDS CLOSE THEMSELVES (2026-10-17): open call cards are looked at again; practice, suggest or close */
  const ccMode = checkMode(st)
  if (live && ccMode !== 'off') {
    const cc = await checkCards(db, ai, hub, tok, ccMode)
    Object.assign(out, { card_check_mode: ccMode, cards_open: cc.cards, cards_checked: cc.checked, cards_asked: cc.asked, cards_would_close: cc.would_close,
      cards_would_suggest: cc.would_suggest, cards_closed: cc.closed, cards_suggested: cc.suggested, card_check_errors: cc.errors })
    if (cc.broken) out.save_failed = (out.save_failed || 0) + 1
  }
  /* 8 · the promise watch (v13) */
  const pw = await watchPromises(db, ai, hub, tok, since)
  Object.assign(out, { promises: pw.promises, promise_checks: pw.checked, promises_kept: pw.kept, would_remind: pw.would_remind, promise_errors: pw.errors })
  /* The heartbeat fails only when the run itself broke (a reading could not be saved, GoHighLevel's text search or the
     promise watch could not run): the watchdog then tells the office. A call that could not be read is tried again and
     shown on the Practice tab; it does not fail the run. */
  await beat(db, !(out.save_failed > 0) && !pw.broken, JSON.stringify(out))
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

async function readTexts(db: Any, ai: Any, hub: Any, tok: string, loc: string, since: string, limit: number, live = false) {
  const res = { read: 0, cards: 0, skipped: 0, errors: 0, failed: 0, search_failed: false }
  const sinceMs = Date.parse(since)
  const c = await fetch(`${GHL}/conversations/search?locationId=${encodeURIComponent(loc)}&limit=${CONVOS}`, { headers: H(tok) })
  if (!c.ok) { res.errors++; res.search_failed = true; return res }
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
  const tries = await triesOf(db, bursts.map((x) => x.id))
  for (const bx of bursts.filter((x) => readNow(tries.get(x.id))).sort((a, b) => a.at.localeCompare(b.at)).slice(0, limit)) {
    const row: Record<string, Any> = { message_id: bx.id, version: VERSION, mode: live ? 'live' : 'practice', channel: 'text', call_at: bx.at, direction: 'in', seconds: 0,
      caller: shortName(bx.name.split(' ')[0], bx.name.split(' ').slice(1).join(' ')) || null, match: 'none', model: MODEL, call_type: 'other', tasks: [], resolves: [], detail: {},
      attempt: (tries.get(bx.id)?.n ?? 0) + 1 }
    try {
      let phone = bx.phone
      if (!phone && bx.contactId) { try { const r = await fetch(`${GHL}/contacts/${encodeURIComponent(bx.contactId)}`, { headers: H(tok, '2021-07-28') }); if (r.ok) phone = String(((await r.json())?.contact || {}).phone || '') } catch { /* unknown */ } }
      const { data: w } = await db.rpc('call_who', { p_phone: phone })
      const who: Who = w && typeof w === 'object' ? w : { match: 'none' }
      Object.assign(row, { match: who.match, person_id: who.person_id ?? null, lead_id: who.lead_id ?? null, who_name: who.name ?? null, who_roles: who.roles ?? [] })
      if (bx.fresh.every((m: Any) => ACK.test(String(m.body || '')))) {
        Object.assign(row, { model: 'none', no_task_reason: 'only an acknowledgement (no reading needed)', detail: { summary: '', items: [], contact_id: bx.contactId || null } }); res.skipped++
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
          Object.assign(row, { call_type: r.call_type, tasks: r.tasks, resolves: r.resolves, no_task_reason: r.no_task_reason || null, detail: { ...r.detail, contact_id: bx.contactId || null } })
          res.cards += r.tasks.length
        }
      }
    } catch (e) { row.error = String((e as Error)?.message || e).slice(0, 300); res.errors++ }
    if (row.error && row.attempt >= MAX_TRIES) res.failed++
    const { error: iErr } = await db.from('call_task_reading').insert(row)
    if (iErr && !/duplicate/i.test(iErr.message)) { res.errors++; res.search_failed = true; continue }
    res.read++
  }
  return res
}

/* ── The promise watch (v13) ──────────────────────────────────────────────────────────────────────────────────────── */
const lc = (v: unknown) => String(v || '').trim().toLowerCase()
const at = (ms: number) => new Date(ms).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

/** Everything that happened with this person after the promise: their GoHighLevel calls and texts (with the reader's
 *  summary of a later call), cards about them made or changed, call outcomes tapped. Bodies go to the check only. */
async function activityFor(db: Any, hub: Any, tok: string, w: Any, newest: Map<string, Any>): Promise<{ lines: string[]; latest: number; events: Ev[] }> {
  const since = Date.parse(w.call_at), lines: Array<[number, string]> = [], events: Ev[] = []
  let contact = String(newest.get(w.message_id)?.detail?.contact_id || '')
  if (!contact) {
    const r = await fetch(`${GHL}/conversations/messages/${encodeURIComponent(String(w.message_id).replace(/^sms:/, ''))}`, { headers: H(tok) })
    if (r.ok) { const j: Any = await r.json().catch(() => ({})); contact = String((j?.message ?? j)?.contactId || '') }
  }
  if (contact) {
    const cs = await fetch(`${GHL}/conversations/search?contactId=${encodeURIComponent(contact)}&limit=3`, { headers: H(tok) })
    if (!cs.ok) throw new Error(`GoHighLevel conversation search ${cs.status}`)
    for (const cv of ((await cs.json().catch(() => ({})))?.conversations || []).slice(0, 2)) {
      const r = await fetch(`${GHL}/conversations/${encodeURIComponent(cv.id)}/messages?limit=40`, { headers: H(tok) })
      if (!r.ok) throw new Error(`GoHighLevel messages ${r.status}`)
      const b: Any = await r.json().catch(() => ({}))
      for (const m of (b?.messages?.messages || b?.messages || [])) {
        const t = Date.parse(String(m.dateAdded || ''))
        if (!(t > since) || String(m.id) === String(w.message_id).replace(/^sms:/, '')) continue
        const call = /CALL/i.test(String(m.messageType || ''))
        const read = call ? newest.get(String(m.id)) : null
        const who = m.direction === 'inbound' ? 'Them' : 'Office'
        const auto = m.direction !== 'inbound' && /workflow|campaign|bulk/i.test(String(m.source || '')) ? ' (automatic)' : ''
        const what = call ? `${m.direction === 'inbound' ? 'they called' : 'office called'}${read?.detail?.summary ? ': ' + String(read.detail.summary).slice(0, 500) : ''}`
          : Number(m.type) === 1 || /SMS/i.test(String(m.messageType || '')) ? String(m.body || '').slice(0, 500)
          : '(' + String(m.messageType || 'message').replace(/^TYPE_/, '').toLowerCase() + ')'
        lines.push([t, `[${at(t)}] ${who}${auto}: ${what}`])
        /* the same messages, as facts for the card check's hard proof (2026-10-17) */
        events.push({ t, dir: m.direction === 'inbound' ? 'in' : 'out', kind: call ? 'call' : (Number(m.type) === 1 || /SMS/i.test(String(m.messageType || ''))) ? 'sms' : 'other', auto: !!auto })
      }
    }
  }
  const nm = lc(w.who_name)
  if (nm) for (const o of hub.ops) {
    if (!o || lc(o.about) !== nm || (w.card_id && o.id === w.card_id)) continue
    const c = Date.parse(String(o.created_at || '')), u = Date.parse(String(o.closed_at || o.resolved_at || o.updated_at || ''))
    const by = String(o.created_by || '')
    if (c > since) lines.push([c, `[${at(c)}] Card made by ${by.includes('@') || /\s/.test(by) ? by.split('@')[0] : 'the Hub'}: ${String(o.title || '').slice(0, 140)} (${String(o.status || 'open')})`])
    else if (u > since) lines.push([u, `[${at(u)}] Card now ${String(o.status || 'open')}: ${String(o.title || '').slice(0, 140)}`])
  }
  if (w.person_id) {
    const { data: rec } = await db.from('call_record').select('recorded_at, outcome').eq('kind', 'outcome').eq('person_id', w.person_id).gt('recorded_at', w.call_at).limit(10)
    for (const x of rec ?? []) { const t = Date.parse(String(x.recorded_at)); lines.push([t, `[${at(t)}] Office tapped a call outcome: ${String(x.outcome || '').slice(0, 80)}`]) }
  }
  lines.sort((a, b) => a[0] - b[0])
  return { lines: lines.map((l) => l[1]), latest: lines.length ? lines[lines.length - 1][0] : 0, events }
}

async function watchPromises(db: Any, ai: Any, hub: Any, tok: string, since: string) {
  const res = { promises: 0, checked: 0, kept: 0, would_remind: 0, errors: 0, broken: false }
  const now = Date.now(), nowIso = new Date(now).toISOString()
  const from = new Date(Math.max(Date.parse(since), now - WATCH_DAYS * 864e5)).toISOString()
  const { data: rd, error: rErr } = await db.from('call_task_reading').select('message_id, version, channel, call_at, person_id, lead_id, who_name, caller, detail, error, read_at')
    .gte('call_at', from).order('read_at', { ascending: false }).limit(1000)
  const { data: have, error: wErr } = await db.from('call_promise_watch').select('*').gte('call_at', from)
  if (rErr || wErr) { res.broken = true; res.errors++; return res }
  const newest = new Map<string, Any>()
  for (const r of rd ?? []) if (!newest.has(r.message_id)) newest.set(r.message_id, r)
  const byKey = new Map<string, Any>((have ?? []).map((w: Any) => [w.message_id + '#' + w.idx, w]))
  const save = async (q: Any) => { const { error } = await q; if (error) { res.errors++; res.broken = true } }

  /* 1 · every promise in the newest reading of each call or text has a row; one a newer reading dropped says so */
  for (const r of newest.values()) {
    if (r.error) continue
    const keep = new Set<number>()
    const cs: Any[] = Array.isArray(r.detail?.commitments) ? r.detail.commitments.slice(0, 10) : []
    for (const [idx, c] of cs.entries()) {
      const due = dueFor(c, r.call_at)
      if (!due) continue
      keep.add(idx)
      const area = String(c.area || 'office_admin')
      const f = { version: r.version, channel: r.channel || 'call', call_at: r.call_at, person_id: r.person_id, lead_id: r.lead_id, who_name: r.who_name, caller: r.caller,
        what: String(c.what || '').slice(0, 160), kind: c.kind, area, owner: ownerFor(area, { domains: hub.domains, staffing: staffingAt(hub, r.call_at) }), due }
      const w = byKey.get(r.message_id + '#' + idx)
      if (!w) {
        await save(db.from('call_promise_watch').insert({ message_id: r.message_id, idx, ...f, status: 'waiting', history: [{ at: nowIso, status: 'waiting', why: 'promise found' }] }))
      } else if (w.version !== r.version || w.status === 'dropped') {
        const back = w.status === 'dropped'
        await save(db.from('call_promise_watch').update({ ...f, ...(back ? { status: 'waiting', history: [...(w.history || []), { at: nowIso, status: 'waiting', why: 'found again in a newer reading' }] } : {}) }).eq('id', w.id))
      }
    }
    for (const w of (have ?? []).filter((x: Any) => x.message_id === r.message_id && !keep.has(x.idx) && x.status !== 'dropped'))
      await save(db.from('call_promise_watch').update({ status: 'dropped', history: [...(w.history || []), { at: nowIso, status: 'dropped', why: 'a newer reading no longer has this promise' }] }).eq('id', w.id))
  }

  /* 2 · check the promises still owed, soonest due first; the AI is asked only when something new happened with them */
  const { data: open, error: oErr } = await db.from('call_promise_watch').select('*').in('status', ['waiting', 'would_remind']).gte('call_at', from).order('due', { ascending: true }).limit(200)
  if (oErr) { res.broken = true; res.errors++; return res }
  res.promises = (open ?? []).length
  let asked = 0
  for (const w of open ?? []) {
    const end = dueEnd(String(w.due)), late = now > end
    if (now > end + WATCH_AFTER_DUE_MS) continue                         // stays as it was (would remind) after 3 days
    if (w.checked_at && now - Date.parse(w.checked_at) < CHECK_EVERY_MS) continue
    let verdict: 'kept' | 'not_yet' | 'unclear' | 'none' = 'none', why = '', evidence: string[] | null = null, latest = 0
    try {
      const act = await activityFor(db, hub, tok, w, newest)
      latest = act.latest
      if (!act.lines.length) why = late ? 'Nothing with them since the promise: no call, text or card.' : `Nothing yet; due ${w.due}.`
      else if (act.latest > (Date.parse(w.last_activity_at || '') || 0)) {
        if (asked >= WATCH_PER_RUN) continue
        asked++
        const resp = await ai.beta.messages.create(checkRequest({ what: w.what, kind: w.kind, due: String(w.due), who: w.who_name || w.caller || '', call_at: w.call_at, channel: w.channel }, act.lines))
        const got = cleanCheck(resp)
        if ('error' in got) throw new Error(got.error)
        verdict = got.status; why = got.why; evidence = got.evidence
      } else { verdict = 'not_yet'; why = w.why || '' }
    } catch (e) {
      res.errors++
      await save(db.from('call_promise_watch').update({ checked_at: nowIso, why: ('The check could not run: ' + String((e as Error)?.message || e)).slice(0, 300) }).eq('id', w.id))
      continue
    }
    const status = nextStatus(w.status, verdict, late)
    res.checked++
    if (status === 'kept' || status === 'kept_late') res.kept++
    if (status === 'would_remind') res.would_remind++
    const upd: Record<string, Any> = { status, why: why.slice(0, 300) || null, checks: (w.checks || 0) + 1, checked_at: nowIso, last_activity_at: latest ? new Date(latest).toISOString() : w.last_activity_at }
    if (evidence) upd.evidence = evidence
    if (status !== w.status) upd.history = [...(w.history || []), { at: nowIso, status, why: why.slice(0, 200) }]
    await save(db.from('call_promise_watch').update(upd).eq('id', w.id))
  }
  return res
}

/* ── LIVE CARDS (2026-10-13) ───────────────────────────────────────────────────────────────────────────────────────────
   The newest reading of each call or text since the switch went on (call_tasks_live_since, and never older than 2 days)
   becomes cards. Only cards that do not exist yet are made (any status: one closed by a person stays closed). A follow-up
   the reader put on an open card is added to that card's history once. A suggestion a later call answered closes its
   card if the AI made it and it is still open. Every write goes through upsert_app_data_item like every other job. */
async function makeCards(db: Any, hub: Any, st: Any) {
  const res = { made: 0, added: 0, closed: 0, unassigned: 0, errors: 0 }
  const now = Date.now(), nowIso = new Date(now).toISOString()
  const liveSince = Math.max(Date.parse(String(st.call_tasks_live_since || '')) || 0, now - LIVE_LOOK_MS)
  const { data: rd, error } = await db.from('call_task_reading').select('message_id, version, channel, call_at, person_id, lead_id, who_name, caller, tasks, resolves, detail, error, read_at')
    .gte('call_at', new Date(liveSince).toISOString()).order('read_at', { ascending: false }).limit(400)
  if (error) { res.errors++; return res }
  const newest = new Map<string, Any>()
  for (const r of rd ?? []) if (!newest.has(r.message_id)) newest.set(r.message_id, r)
  const { data: row } = await db.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
  const ops: Any[] = Array.isArray(row?.data) ? row.data : []
  const byId = new Map<string, Any>(ops.filter((x: Any) => x && x.id).map((x: Any) => [String(x.id), x]))
  const put = async (item: Any) => {
    const { error: e } = await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item })
    if (e) { res.errors++; return false }
    byId.set(String(item.id), item); return true
  }
  let writes = 0
  for (const r of [...newest.values()].sort((a, b) => String(a.call_at).localeCompare(String(b.call_at)))) {
    if (r.error || writes >= LIVE_PER_RUN) continue
    const tasks: Any[] = Array.isArray(r.tasks) ? r.tasks : []
    for (const [i, t] of tasks.entries()) {
      const id = cardIdFor(r.message_id, i)
      if (byId.has(id) || writes >= LIVE_PER_RUN) continue
      const name = String(t?.owner?.name || '').trim()
      const email = name ? hub.emailByName.get(name.toLowerCase()) || '' : ''
      if (!email) res.unassigned++
      if (await put(liveCard(r, t, i, email ? { email, name } : null, now))) { res.made++; writes++ }
    }
    /* the reader said this belongs on a card that is already open */
    for (const it of (Array.isArray(r.detail?.items) ? r.detail.items : [])) {
      if (it?.decision !== 'add_to_existing_card' || !it.card_id || writes >= LIVE_PER_RUN) continue
      const c = byId.get(String(it.card_id))
      if (!c || ['done', 'closed', 'resolved', 'dismissed'].includes(String(c.status))) continue
      const hist: Any[] = Array.isArray(c.history) ? c.history : []
      if (hist.some((h: Any) => h && h.ref === r.message_id)) continue
      const what = r.channel === 'text' ? 'Texts' : 'A call'
      const line = `${what} with ${r.who_name || r.caller || 'them'} (${chicago(r.call_at)}) added: ${String(it.why || it.responsibility || '').slice(0, 400)}`
      if (await put({ ...c, history: [...hist, { at: nowIso, by: 'AI (call follow-ups)', ref: r.message_id, text: line }], last_activity_at: nowIso })) { res.added++; writes++ }
    }
    /* a later call answered an earlier suggestion: close the AI's card if nobody has touched its status */
    for (const x of (Array.isArray(r.resolves) ? r.resolves : [])) {
      const c = byId.get(cardIdFor(String(x.message_id), Number(x.task_index)))
      if (!c || c.kind !== LIVE_KIND || c.status !== 'open' || writes >= LIVE_PER_RUN) continue
      const hist: Any[] = Array.isArray(c.history) ? c.history : []
      const note = `A later ${r.channel === 'text' ? 'text' : 'call'} with ${r.who_name || r.caller || 'them'} (${chicago(r.call_at)}) took care of this`
      if (await put({ ...c, status: 'done', closed_at: nowIso, closed_by: 'call-tasks', close_reason: note, last_activity_at: nowIso,
        history: [...hist, { at: nowIso, by: 'AI (call follow-ups)', ref: r.message_id, text: note }] })) { res.closed++; writes++ }
    }
  }
  return res
}

/* ── CARDS CLOSE THEMSELVES (2026-10-17) ─────────────────────────────────────────────────────────────────────────────
   See _shared/call-tasks.ts for her rules. Every open call card the AI made in the last 14 days is looked at again, at
   most hourly, 12 a run, longest-unchecked first; the AI is asked only when something new happened (8 a run). What it
   found is kept in call_card_check (practice shows it there and nowhere else). In suggest and close modes the card is
   changed through call_card_patch, which only touches a card that is still open and never replaces a person's edits. */
/** What AxisCare now shows for a visit a step changes (read only). A read that fails is never proof. */
async function visitFact(a: Action, ids: { client?: string; caregiver?: string }, card: Any): Promise<Fact> {
  if (!a.date) return { proven: false, line: '' }
  const list = ids.caregiver ? await axVisits(`caregiverIds=${encodeURIComponent(ids.caregiver)}&startDate=${a.date}&endDate=${a.date}`)
    : ids.client ? await axVisits(`clientIds=${encodeURIComponent(ids.client)}&startDate=${a.date}&endDate=${a.date}`) : null
  if (list === null) return { proven: false, line: '' }
  const hits = list.filter((v: Any) => !a.client_name || sameName(a.client_name, v.client))
  const was: Any = (a.resolved as Any)?.visit || null
  const who = a.client_name || was?.client || 'the client'
  const line = `[AxisCare now] ${who}, ${a.date}: ${hits.length ? hits.map((v: Any) => `${v.start}-${v.end} with ${v.caregiver || 'nobody'}`).join('; ') : 'no visit'}`
  let proven = false
  if (was && /^\s*(cancel|remove)\b/i.test(String(card.title || ''))) proven = !hits.some((v: Any) => v.start === was.start)
  else if (was && a.start && a.end && (was.start !== a.start || was.end !== a.end))
    proven = hits.some((v: Any) => v.start === a.start && v.end === a.end) && !hits.some((v: Any) => v.start === was.start && v.end === was.end)
  /* ADDING A VISIT (2026-10-18): when the card was made AxisCare had no matching visit that day (the reading's own lookup
     said so), and now there is one for that client at exactly the asked-for time. If that first lookup could not read
     AxisCare or found several visits, nobody knows whether the visit was already there, so it is never proof. */
  else if (!was && a.start && a.end && /^no matching visit/.test(String((a.resolved as Any)?.note || '')))
    proven = hits.some((v: Any) => v.start === a.start && v.end === a.end)
  return { proven, line }
}
/** Whether a call-off case for that client and day was opened after the card. */
function coverageFact(a: Action, card: Any, coverage: Any[]): Fact {
  const since = Date.parse(String(card.created_at || ''))
  const who = String(a.client_name || card.about || '')
  const c = coverage.find((x: Any) => x && Date.parse(String(x.opened_at || '')) > since && sameName(who, String(x.client || '')) && (!a.date || String(x.shift_date) === a.date))
  return c ? { proven: true, line: `[Hub] Call-off case opened ${chicago(String(c.opened_at))} for ${c.client}, ${c.shift_date}` } : { proven: false, line: '' }
}
async function checkCards(db: Any, ai: Any, hub: Any, tok: string, mode: CheckMode) {
  const res = { cards: 0, checked: 0, asked: 0, would_close: 0, would_suggest: 0, closed: 0, suggested: 0, errors: 0, broken: false }
  const now = Date.now(), nowIso = new Date(now).toISOString()
  const { data: row } = await db.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
  const ops: Any[] = Array.isArray(row?.data) ? row.data : []
  const cands = ops.filter((o: Any) => o && o.kind === LIVE_KIND && o.status === 'open' && o.created_by === 'call-tasks'
    && now - (Date.parse(String(o.created_at || '')) || 0) <= CARD_CHECK_DAYS * 864e5)
  res.cards = cands.length
  if (!cands.length) return res
  const { data: have, error: hErr } = await db.from('call_card_check').select('*').in('card_id', cands.map((c: Any) => c.id))
  if (hErr) { res.broken = true; res.errors++; return res }
  const byId = new Map<string, Any>((have ?? []).map((h: Any) => [String(h.card_id), h]))
  const due = cands.filter((c: Any) => { const h = byId.get(c.id); return !h || !h.checked_at || now - Date.parse(h.checked_at) >= CARD_CHECK_EVERY_MS })
    .sort((a: Any, b: Any) => String(byId.get(a.id)?.checked_at || '').localeCompare(String(byId.get(b.id)?.checked_at || '')))
    .slice(0, CARD_CHECK_PER_RUN)
  const mids = [...new Set(due.map((c: Any) => String(c.source?.message_id || '')).filter(Boolean))]
  const { data: rd } = mids.length ? await db.from('call_task_reading').select('message_id, read_at, tasks, detail, person_id, call_at').in('message_id', mids).order('read_at', { ascending: false }) : { data: [] }
  const newest = new Map<string, Any>()
  for (const r of rd ?? []) if (!newest.has(r.message_id)) newest.set(r.message_id, r)
  const patch = async (id: string, p: Record<string, Any>, note: string) => {
    const { data, error } = await db.rpc('call_card_patch', { p_id: id, p_patch: p, p_history: { at: nowIso, by: 'AI (call follow-ups)', text: note } })
    if (error) { res.errors++; return false }
    return data === true
  }
  for (const c of due) {
    const h = byId.get(c.id)
    const rec: Record<string, Any> = { card_id: c.id, message_id: String(c.source?.message_id || '') || null, mode, checked_at: nowIso, checks: (h?.checks || 0) + 1 }
    try {
      const r = newest.get(String(c.source?.message_id || ''))
      const ti = Number((/_(\d+)$/.exec(String(c.id)) || [])[1] || 0)
      const acts: Action[] = Array.isArray(r?.tasks?.[ti]?.actions) ? r.tasks[ti].actions : []
      const w = { message_id: String(c.source?.message_id || ''), call_at: String(c.created_at), who_name: c.about, person_id: c.person_id || r?.person_id || null, card_id: c.id }
      const act = await activityFor(db, hub, tok, w, newest)
      const ids: { client?: string; caregiver?: string } = {}
      if (w.person_id && acts.some((a) => a.kind === 'axiscare_visit_change')) {
        const { data: src } = await db.from('person_source_id').select('entity_type, source_id').eq('person_id', w.person_id).eq('system', 'axiscare').eq('needs_review', false)
        for (const x of src ?? []) { if (x.entity_type === 'client') ids.client = String(x.source_id); if (x.entity_type === 'caregiver') ids.caregiver = String(x.source_id) }
      }
      const facts: Facts = { events: act.events, visits: {}, coverage: {} }
      const factLines: string[] = []
      for (const [i, a] of acts.entries()) {
        if (a.kind === 'axiscare_visit_change') { const v = await visitFact(a, ids, c); facts.visits[i] = v; if (v.line) factLines.push(v.line) }
        if (a.kind === 'open_calloff_case') { const v = coverageFact(a, c, hub.coverage); facts.coverage[i] = v; if (v.line) factLines.push(v.line) }
      }
      const proofs = acts.map((a, i) => ({ kind: a.kind, ...stepProof(a, i, c, facts) }))
      const lines = [...act.lines, ...factLines]
      const sig = String(act.latest) + '|' + factLines.join('|')
      let verdict = String(h?.verdict || 'none'), why = String(h?.why || ''), evidence: string[] = Array.isArray(h?.evidence) ? h.evidence : []
      const allProven = acts.length > 0 && proofs.every((p) => p.proven)
      if (!lines.length) { verdict = 'none'; why = 'Nothing has happened with them since the card was made.'; evidence = [] }
      else if (allProven) { verdict = 'done'; why = proofs.map((p) => p.how).join('; ').slice(0, 300); evidence = proofs.map((p) => p.how).slice(0, 5) }   // proof needs no AI
      else if (sig !== h?.sig) {
        if (res.asked >= CARD_CHECK_AI_PER_RUN) continue          // asked enough this run: this card waits for the next one
        res.asked++
        const got = cleanCardCheck(await ai.beta.messages.create(cardCheckRequest(c, Array.isArray(c.steps) ? c.steps : [], lines)))
        if ('error' in got) throw new Error(got.error)
        verdict = got.status; why = got.why; evidence = got.evidence
      }
      const would = cardDecision(acts, proofs, verdict, 'practice')
      if (would === 'close') res.would_close++
      if (would === 'suggest') res.would_suggest++
      /* a person's "Not yet" holds until something new happens with them */
      const no = Date.parse(String(c.looks_done_no?.at || '')) || 0
      const fresh = !no || act.latest > no
      const doIt = mode === 'practice' || !fresh ? 'none' : cardDecision(acts, proofs, verdict, mode)
      if (doIt === 'close') {
        const how = proofs.map((p) => p.how).filter(Boolean).join('; ')
        if (await patch(c.id, { status: 'done', closed_at: nowIso, closed_by: 'call-tasks', resolution_code: 'proof', close_reason: ('Closed on proof: ' + how).slice(0, 400),
          last_activity_at: nowIso, looks_done: { at: nowIso, why: how.slice(0, 300), evidence: proofs.map((p) => p.how).filter(Boolean).slice(0, 5), source: 'proof', sig } }, ('Closed on proof: ' + how).slice(0, 400))) res.closed++
      } else if (doIt === 'suggest' && c.looks_done?.sig !== sig) {
        const all = acts.length > 0 && proofs.every((p) => p.proven)
        const ld = all ? { at: nowIso, why: proofs.map((p) => p.how).join('; ').slice(0, 300), evidence: proofs.map((p) => p.how).slice(0, 5), source: 'proof', sig }
          : { at: nowIso, why, evidence, source: 'ai', sig }
        if (await patch(c.id, { looks_done: ld }, 'Looks done: ' + String(ld.why).slice(0, 300))) res.suggested++
      }
      Object.assign(rec, { sig, verdict, why: why.slice(0, 300) || null, evidence: evidence.slice(0, 5), proofs, would, done: doIt, last_activity_at: act.latest ? new Date(act.latest).toISOString() : null, error: null })
      if (!h || h.would !== would || h.verdict !== verdict) rec.history = [...(Array.isArray(h?.history) ? h.history : []), { at: nowIso, verdict, would, done: doIt }].slice(-30)
      res.checked++
    } catch (e) {
      res.errors++
      Object.assign(rec, { error: String((e as Error)?.message || e).slice(0, 300) })
    }
    /* one save that works whether or not a row exists yet (2026-10-18): two runs at once (a Desktop step's run beside the
       10-minute one) used to both insert the same card and the second was refused, failing the heartbeat */
    const { error: sErr } = await db.from('call_card_check').upsert(rec, { onConflict: 'card_id' })
    if (sErr) { res.errors++; res.broken = true }
  }
  return res
}
