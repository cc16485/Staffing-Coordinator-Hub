// =============================================================================
// incident-report · INCIDENT REPORT, STAGE 1 (Samantha 2026-10-27: "build the incident report as planned with your three
// picks. Start with Stage 1 so Ashley's report can go out")
// =============================================================================
// The office opens a report (from a red shift-note flag, or from the client's profile), checks the words and presses Send;
// the caregiver who was there answers the questions on a private link and signs with a finger and their typed name. The
// signed report becomes a PDF in the private bucket incident-docs, the report is listed on the client's profile, and the
// Incidents owner's card says where it stands. Her three picks: a person presses Send (never automatic when a flag fires);
// ONE reminder text after 24 hours, then the card turns red and nobody is texted again; families are never contacted.
// PRACTICE until ops_settings.incident_reports_live === true: the link, the answers and the PDF all work, but nothing is
// texted and no card is made. Rules and words: _shared/incident.ts.
//
// ── Office (their own Hub sign-in: owner, care coordinator, staffing coordinator)
//   list    { client_ax? | ids? }                 -> { live, reports[] } (never the link code; answers only once signed)
//   start   { source_item_id? , client_ax, client_name, caregiver, happened_on }  -> { report, link, draft, phone_last4, practice }
//           one open report per flag: starting again from the same flag returns the one already there with a NEW link
//   send    { id, message }                       -> { outcome: sent|practice|refused|failed|no_phone }   their words, their press
//   open    { id }                                -> { url } five minutes; every open logged
//   relink  { id }                                -> as start: a NEW link for a report still waiting (the old link stops)
//   cancel  { id }                                a waiting link stops working
// ── The caregiver (https://cc.mo-care.com/incident.html?t=<code>; no sign-in)
//   view    { t }                                 -> { first, client_first, happened_on, questions[], note_words, status, practice }
//   submit  { t, answers, typed_name, strokes, consent: true }  -> { copy_url }
// ── The schedule (hourly; the jobs' secret) or the owner's server key: remind {}
//   texts the ONE reminder that is owed (8am to 8pm Central), turns overdue cards red. Switch off: nothing.
// ── The owner's Desktop step (server key): sample {} -> { link }  a practice report for "Test Caregiver" (no client)
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { ownerCaller, jobCaller } from '../_shared/job-auth.ts'
import { contactForOutbound, normalisePhone } from '../_shared/outreach.ts'
import { MO_FROM } from '../_shared/office-from.ts'
import { logOpen, ipOf, clientSubject } from '../_shared/doc-log.ts'
import { reportSendProblem, ownerFor } from '../_shared/send-problems.ts'
import { BUCKET, LINK_DAYS, OFFICE_PHONE, MAX_TEXT, QUESTIONS, TRUE_WORDS, labelFor, cleanAnswers, answersMissing, toldLate, cleanStrokes, sha256, newToken,
  tokenOk, nameMatches, firstName, shortName, linkFor, draftText, reminderText, caseName, cardState, reminderDue, inReminderHours, noteWords, reportPdf } from '../_shared/incident.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
// deno-lint-ignore no-explicit-any
type Any = any
const PUBLIC = ['view', 'submit']
const SHOW = 'id,kind,practice,client_ax,client_name,caregiver,happened_on,source_item_id,card_id,status,expires_at,started_by,started_by_name,started_at,sent_at,sent_by,opened_at,reminded_at,submitted_at,signed_name,told_late,pdf_path,cancelled_at,cancelled_by'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } })
  const url = new URL(req.url)
  const b: Any = await req.json().catch(() => ({}))
  const action = String(b?.action ?? '')
  try {
    if (PUBLIC.includes(action)) return await caregiverSide(db, req, action, b)
    if (url.searchParams.get('auth_check') === '1') { const c = await jobCaller(req); return c ? json({ ok: true, caller: c }) : json({ error: 'not allowed' }, 401) }
    if (action === 'sample') { if (!(await ownerCaller(req))) return json({ error: 'not allowed' }, 401); return await sample(db) }
    if (action === 'remind' || (!action && Object.keys(b || {}).length === 0)) {
      const c = await jobCaller(req); if (!c) return json({ error: 'not allowed' }, 401)
      return json(await remind(db))
    }
    /* the Desktop step's proof: the owner's server key may open the practice sample's PDF only, never a real report */
    if (action === 'open' && await ownerCaller(req)) {
      const s0 = await getReport(db, b?.id)
      if (!s0 || !s0.practice || s0.source_item_id !== 'practice-sample') return json({ error: 'not allowed' }, 401)
      const { data } = await db.storage.from(BUCKET).createSignedUrl(String(s0.pdf_path || ''), 60)
      return json({ ok: !!data?.signedUrl, url: data?.signedUrl || null })
    }
    const who = await requireStaff(db, req, OFFICE_ROLES)
    if (!who.ok) return json({ error: who.status === 403 ? 'Only the office can do this.' : who.error }, who.status)
    const me = { email: who.email, name: who.name, person_id: who.person_id }
    const live = await isLive(db)
    if (action === 'list') return await list(db, live, b)
    if (action === 'start') return await start(db, me, live, b)
    const r = await getReport(db, b?.id)
    if (!r) return json({ error: 'That report is not on file. Reload and try again.' }, 404)
    if (action === 'send') return await send(db, me, r, b)
    if (action === 'relink') {
      if (r.status !== 'waiting') return json({ error: 'This report is not waiting to be filled in.' }, 409)
      const token = newToken()
      const { data: again } = await db.from('incident_report').update({ token_hash: await sha256(token), expires_at: new Date(Date.now() + LINK_DAYS * 864e5).toISOString() })
        .eq('id', r.id).eq('status', 'waiting').select('*').maybeSingle()
      if (!again) return json({ error: 'It changed while you were looking. Reload.' }, 409)
      await event(db, r.id, 'new_link', me)
      return await started(db, again, token)
    }
    if (action === 'open') {
      if (!r.pdf_path) return json({ error: 'There is no signed report yet.' }, 404)
      const logged = await logOpen(db, { subject: r.client_ax ? clientSubject(r.client_ax, null) : 'incident:' + r.id, doc: 'incident_report', path: r.pdf_path,
        who: { email: me.email, name: me.name, person_id: me.person_id }, ip: ipOf(req) })
      if (!logged) return json({ error: 'The open could not be logged, so the report was not opened. Try again.' }, 500)
      const { data, error } = await db.storage.from(BUCKET).createSignedUrl(r.pdf_path, 300)
      if (error || !data?.signedUrl) throw new Error('could not open the report')
      return json({ ok: true, url: data.signedUrl, expires_in: 300 })
    }
    if (action === 'cancel') {
      if (r.status !== 'waiting') return json({ error: 'Only a report still waiting to be filled in can be cancelled.' }, 409)
      const { data: done } = await db.from('incident_report').update({ status: 'cancelled', token_hash: null, cancelled_at: new Date().toISOString(), cancelled_by: me.email })
        .eq('id', r.id).eq('status', 'waiting').select('*').maybeSingle()
      if (!done) return json({ error: 'It changed while you were looking. Reload.' }, 409)
      await event(db, r.id, 'cancelled', me)
      await card(db, done)
      return json({ ok: true })
    }
    return json({ error: 'unknown action' }, 400)
  } catch (e) {
    return json({ error: String((e as Error)?.message || e).slice(0, 300) }, 500)
  }
})

async function settings(db: Any): Promise<Any> { const { data } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle(); return data?.data || {} }
async function isLive(db: Any) { return (await settings(db)).incident_reports_live === true }
async function getReport(db: Any, id: unknown) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id ?? ''))) return null
  return (await db.from('incident_report').select('*').eq('id', String(id)).maybeSingle()).data
}
async function event(db: Any, id: string, kind: string, who: { email?: string; name?: string } = {}, detail: Record<string, unknown> = {}) {
  try { await db.from('incident_event').insert({ report_id: id, kind, by_email: who.email || null, by_name: who.name || null, detail }) } catch { /* the outcome is on the row itself */ }
}
async function opsItems(db: Any): Promise<Any[]> { const { data } = await db.from('app_data').select('data').eq('key', 'ops_items').maybeSingle(); return Array.isArray(data?.data) ? data.data : [] }

/* ── the office's list: a client's reports, or the ones on cards ── */
async function list(db: Any, live: boolean, b: Any) {
  let q = db.from('incident_report').select(SHOW + ',answers').order('started_at', { ascending: false }).limit(100)
  const ax = String(b?.client_ax ?? '')
  const ids = (Array.isArray(b?.ids) ? b.ids : []).map(String).filter((x: string) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 50)
  if (/^\d+$/.test(ax)) q = q.eq('client_ax', ax)
  else if (ids.length) q = q.in('id', ids)
  else return json({ error: 'Say which client or which reports.' }, 400)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  const reports = (data || []).map((r: Any) => ({ ...r, answers: r.status === 'submitted' ? r.answers : null,
    questions: r.status === 'submitted' ? QUESTIONS.filter((x) => r.answers && r.answers[x.k] !== undefined).map((x) => ({ k: x.k, label: labelFor(x, r.client_name) })) : null }))
  return json({ ok: true, live, reports })
}

/* ── the office starts one: who, which client, which day; a private link and the words to check ── */
async function start(db: Any, me: Any, live: boolean, b: Any) {
  const src = String(b?.source_item_id ?? '').slice(0, 80)
  let flag: Any = null
  if (src) { flag = (await opsItems(db)).find((x) => x && x.id === src); if (!flag) return json({ error: 'That shift-note card is not on file. Reload and try again.' }, 404) }
  const client_ax = String(b?.client_ax ?? flag?.client_ax ?? '').trim()
  const client_name = String(b?.client_name ?? '').trim().slice(0, 120) || String(flag?.about ?? '').trim().slice(0, 120)
  const caregiver = String(b?.caregiver ?? '').trim().replace(/\s+/g, ' ').slice(0, 120) || String(flag?.caregiver ?? '').trim()
  const happened_on = String(b?.happened_on ?? '')
  if (!client_name) return json({ error: 'Say which client.' }, 400)
  if (caregiver.split(' ').length < 2) return json({ error: 'Pick the caregiver who was there (first and last name).' }, 400)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(happened_on) || happened_on > new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })) return json({ error: 'Pick the day it happened (not in the future).' }, 400)
  if (client_ax && !/^\d+$/.test(client_ax)) return json({ error: 'That client number does not look right.' }, 400)
  const token = newToken(), expires = new Date(Date.now() + LINK_DAYS * 864e5).toISOString()
  /* one open report per flag: the same flag again gets the same report with a new link (the old link stops working) */
  if (src) {
    const { data: same } = await db.from('incident_report').select('*').eq('source_item_id', src).eq('status', 'waiting').maybeSingle()
    if (same) {
      const { data: again } = await db.from('incident_report').update({ token_hash: await sha256(token), expires_at: expires }).eq('id', same.id).eq('status', 'waiting').select('*').maybeSingle()
      if (again) { await event(db, again.id, 'new_link', me); return await started(db, again, token) }
    }
  }
  const row = { kind: 'client', practice: !live, client_ax: client_ax || null, client_name, caregiver, happened_on, source_item_id: src || null, note_words: flag ? noteWords(flag.detail) || null : null,
    caregiver_phone_hint: flag ? normalisePhone(flag.caregiver_phone) : null, token_hash: await sha256(token), expires_at: expires, started_by: me.email, started_by_name: me.name }
  const { data: r, error } = await db.from('incident_report').insert(row).select('*').single()
  if (error) throw new Error('could not start: ' + error.message)
  await event(db, r.id, 'started', me, { practice: !live, from: src ? 'shift flag' : 'profile' })
  if (!r.practice) await card(db, r)
  return await started(db, r, token)
}
async function started(db: Any, r: Any, token: string) {
  const link = linkFor(token)
  const phone = await phoneFor(db, r)
  const out = Object.fromEntries(SHOW.split(',').map((k) => [k, r[k]]))
  return json({ ok: true, practice: r.practice, report: out, link, draft: draftText(r, link), phone_last4: phone ? phone.slice(-4) : '' })
}
/* the caregiver's phone: the roster by name (one match only), else the phone the shift-note card carried */
async function rosterFor(db: Any, name: string): Promise<Any | null> {
  const { data } = await db.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
  const roster: Any[] = Array.isArray(data?.data) ? data.data : []
  const key = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '')
  const h = roster.filter((c) => key([c?.first, c?.last].join(' ')) === key(name))
  return h.length === 1 ? h[0] : null
}
async function phoneFor(db: Any, r: Any): Promise<string | null> {
  const cg = await rosterFor(db, r.caregiver)
  return (cg && normalisePhone(cg.phone)) || normalisePhone(r.caregiver_phone_hint) || null
}

/* ── one text through GoHighLevel (the office's press, or the one reminder) ── */
async function text(db: Any, r: Any, message: string, human: boolean): Promise<{ outcome: string; why?: string; phone?: string }> {
  const phone = await phoneFor(db, r)
  if (!phone) return { outcome: 'no_phone', why: `${r.caregiver} has no usable phone number on the roster` }
  const ghl = { token: Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
  if (!ghl.token || !ghl.locationId) return { outcome: 'failed', why: 'GoHighLevel is not configured' }
  const cg = await rosterFor(db, r.caregiver)
  const w = String(r.caregiver).split(' ')
  let refusal: string[] = []
  const contact = await contactForOutbound(db, ghl, { phone, firstName: cg?.first || w[0], lastName: cg?.last || w[w.length - 1] }, 'urgent_internal',
    { audience: 'caregiver', channel: 'sms', sender: 'incident-report', humanInitiated: human, onOptOut: (x: string[]) => { refusal = x } })
  if (!contact) return { outcome: 'refused', why: refusal.length ? `${r.caregiver} has asked not to get texts (${refusal.join('; ')})` : 'the opt-out check could not be completed (or it is office quiet hours)', phone }
  try {
    const res = await fetch('https://services.leadconnectorhq.com/conversations/messages', { method: 'POST',
      headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'SMS', fromNumber: MO_FROM, contactId: contact.contactId, message }) })
    if (!res.ok) return { outcome: 'failed', why: `GoHighLevel answered ${res.status}`, phone }
  } catch { return { outcome: 'failed', why: 'could not reach GoHighLevel', phone } }
  return { outcome: 'sent', phone }
}

/* ── the office's press: their words, which must carry this report's link ── */
async function send(db: Any, me: Any, r: Any, b: Any) {
  if (r.status !== 'waiting') return json({ error: 'This report is not waiting to be sent.' }, 409)
  const message = String(b?.message ?? '').replace(/\r\n/g, '\n').trim()
  if (!message) return json({ error: 'The message is empty.' }, 400)
  if (message.length > MAX_TEXT) return json({ error: `The message is ${message.length} characters; keep it under ${MAX_TEXT}.` }, 400)
  const m = message.match(/incident\.html\?t=([A-Za-z0-9_-]{40,60})/)
  if (!m || (await sha256(m[1])) !== r.token_hash) return json({ error: 'The message must keep the private link to this report (start it again for a fresh link).' }, 400)
  if (/—/.test(message)) return json({ error: 'Please use a comma instead of the long dash.' }, 400)
  const now = new Date().toISOString()
  if (r.practice) {
    await db.from('incident_report').update({ sent_at: now, sent_by: me.email }).eq('id', r.id)
    await event(db, r.id, 'practice_send', me, { length: message.length })
    return json({ ok: true, outcome: 'practice', note: 'Practice: nothing was texted. Open the link yourself to try it.' })
  }
  const t = await text(db, r, message, true)
  if (t.outcome !== 'sent') {
    await event(db, r.id, 'send_' + t.outcome, me, { why: t.why })
    return json({ outcome: t.outcome, error: `Not sent: ${t.why}. Call ${firstName(r.caregiver)} and read the questions together, or try again.` }, t.outcome === 'failed' ? 502 : 422)
  }
  /* a fresh send restarts the 24-hour clock and owes a fresh reminder */
  const { data: done } = await db.from('incident_report').update({ sent_at: now, sent_by: me.email, reminded_at: null }).eq('id', r.id).select('*').maybeSingle()
  await event(db, r.id, 'sent', me, { phone_last4: String(t.phone || '').slice(-4), length: message.length })
  await card(db, done || r)
  return json({ ok: true, outcome: 'sent' })
}

/* ── the hourly job: the ONE reminder owed, and red cards for the overdue ── */
async function remind(db: Any) {
  const st = await settings(db)
  const out = { live: st.incident_reports_live === true, reminded: 0, failed: 0, cards: 0, skipped_hours: false }
  if (!out.live) return out
  const { data } = await db.from('incident_report').select('*').eq('status', 'waiting').eq('practice', false).not('sent_at', 'is', null).limit(200)
  const now = new Date()
  for (const r of (data || [])) {
    if (reminderDue(r, now)) {
      if (!inReminderHours(now)) { out.skipped_hours = true } else {
        const token = newToken()
        /* claim it first, so two runs never text twice; a failed text keeps the claim (no second try: the card goes red) */
        const { data: claimed } = await db.from('incident_report').update({ reminded_at: now.toISOString(), token_hash: await sha256(token), expires_at: new Date(now.getTime() + LINK_DAYS * 864e5).toISOString() })
          .eq('id', r.id).eq('status', 'waiting').is('reminded_at', null).select('*').maybeSingle()
        if (claimed) {
          const t = await text(db, claimed, reminderText(claimed, linkFor(token)), false)
          if (t.outcome === 'sent') { out.reminded++; await event(db, r.id, 'reminded', { name: 'Hub reminder' }) }
          else {
            out.failed++
            await event(db, r.id, 'remind_' + t.outcome, { name: 'Hub reminder' }, { why: t.why })
            await reportSendProblem(db, { sender: 'incident-report', channel: 'sms', address: t.phone || '', who: r.caregiver, reasons: [t.why || t.outcome], failed: t.outcome === 'failed',
              note: `This was the one reminder for the incident report (${caseName(r)}). Call ${firstName(r.caregiver)} instead.` })
          }
          r.reminded_at = claimed.reminded_at
        }
      }
    }
    if (await card(db, r, now)) out.cards++
  }
  return out
}

/* ── the Incidents owner's card: one per report, its words follow the report ── */
async function card(db: Any, r: Any, now: Date = new Date()): Promise<boolean> {
  if (r.practice) return false
  try {
    const items = await opsItems(db)
    const id = r.card_id || 'ops_inc_' + String(r.id).slice(0, 8)
    const prev = items.find((x) => x && x.id === id)
    const s = cardState(r, now)
    if (prev && (prev.status === 'done' || prev.status === 'resolved')) return false   // a person closed it; leave it closed
    if (prev && prev.next_action === s.next && prev.urgency === s.urgency && (s.open || prev.status !== 'open')) return false
    const owner = prev?.owner || await ownerFor(db, 'incidents') || r.started_by
    const at = now.toISOString()
    const item = { ...(prev || { created_at: at, owner, owner_name: '', created_by: r.started_by_name || r.started_by, created_by_email: r.started_by, opened_by: 'person', source: r.source_item_id ? 'shift_flag' : 'incident_report' }),
      id, kind: 'client_issue', domain: 'incidents', incident_id: r.id, source_id: r.source_item_id || prev?.source_id || null, client_ax: r.client_ax || '', about: r.client_name,
      caregiver: r.caregiver, title: 'Incident report: ' + caseName(r) + ', ' + shortName(r.caregiver), next_action: s.next, urgency: s.urgency,
      due: prev?.due && s.urgency !== 'urgent' ? prev.due : new Date(now.getTime() + (s.urgency === 'urgent' ? 2 : 24) * 36e5).toISOString(),
      status: s.open ? 'open' : 'done', closed_at: s.open ? null : at, closed_by: s.open ? null : 'system', close_note: s.open ? null : s.next, last_activity_at: at }
    const { error } = await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item })
    if (!error && !r.card_id) await db.from('incident_report').update({ card_id: id }).eq('id', r.id)
    return !error
  } catch { return false }
}

async function savePdf(db: Any, r: Any, bytes: Uint8Array): Promise<string> {
  const path = `${r.practice ? 'practice' : 'reports'}/${r.client_ax || 'no-client'}/${r.id}-${Date.now()}.pdf`
  const { error } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: false })
  if (error) throw new Error('could not keep the report: ' + error.message)
  return path
}

/* ── The caregiver's link ── */
async function caregiverSide(db: Any, req: Request, action: string, b: Any) {
  if (!tokenOk(b?.t)) return json({ error: 'This link is not valid. Call the office at ' + OFFICE_PHONE + '.' }, 404)
  const { data: r } = await db.from('incident_report').select('*').eq('token_hash', await sha256(String(b.t))).maybeSingle()
  if (!r || r.status === 'cancelled') return json({ error: 'This link is no longer active. Call the office at ' + OFFICE_PHONE + '.' }, 404)
  const expired = r.status === 'waiting' && r.expires_at && new Date(r.expires_at).getTime() < Date.now()
  if (action === 'view') {
    if (r.status === 'waiting' && !r.opened_at) { await db.from('incident_report').update({ opened_at: new Date().toISOString() }).eq('id', r.id); await event(db, r.id, 'opened', {}, { ip: ipOf(req).slice(0, 64) }) }
    return json({ ok: true, first: firstName(r.caregiver), client_first: firstName(r.client_name), client_short: shortName(r.client_name), happened_on: r.happened_on,
      note_words: r.note_words || '', questions: QUESTIONS.map((q) => ({ ...q, label: labelFor(q, r.client_name) })), true_words: TRUE_WORDS,
      status: expired ? 'expired' : r.status, practice: r.practice, office_phone: OFFICE_PHONE })
  }
  // submit
  if (r.status !== 'waiting') return json({ error: r.status === 'submitted' ? 'This report is already filled in and signed. Thank you.' : 'This report can no longer be filled in here. Call the office at ' + OFFICE_PHONE + '.' }, 409)
  if (expired) return json({ error: 'This link has expired. Call the office at ' + OFFICE_PHONE + ' for a new one.' }, 410)
  const answers = cleanAnswers(b?.answers)
  const missing = answersMissing(answers, r.client_name)
  if (missing) return json({ error: missing }, 400)
  if (b?.consent !== true) return json({ error: 'Tick the box to say what you wrote is true.' }, 400)
  const strokes = cleanStrokes(b?.strokes)
  if (!strokes) return json({ error: 'Sign in the box with your finger.' }, 400)
  const typed = String(b?.typed_name || '').trim().replace(/\s+/g, ' ').slice(0, 120)
  if (!nameMatches(typed, r.caregiver)) return json({ error: 'Type your full first and last name, as on your employee record.' }, 400)
  const at = new Date(), ip = ipOf(req).split(',')[0].trim().slice(0, 64), agent = String(req.headers.get('user-agent') || '').slice(0, 300)
  const answers_hash = await sha256(JSON.stringify(answers))
  const pdf_path = await savePdf(db, r, reportPdf({ ...r, answers_hash }, answers, { typedName: typed, strokes, at, ip, agent }))
  const { data: done, error } = await db.from('incident_report').update({ status: 'submitted', answers, answers_hash, signature: strokes, signed_name: typed, submitted_at: at.toISOString(),
    sign_ip: ip, sign_agent: agent, told_late: toldLate(answers), pdf_path, token_hash: null }).eq('id', r.id).eq('status', 'waiting').select('*').maybeSingle()
  if (error || !done) return json({ error: 'This report was already filled in or closed. Thank you.' }, 409)
  await event(db, r.id, 'submitted', { name: typed }, { told_late: done.told_late })
  await card(db, done)
  const { data: u } = await db.storage.from(BUCKET).createSignedUrl(pdf_path, 600)
  return json({ ok: true, copy_url: u?.signedUrl || null, practice: done.practice })
}

/* ── A practice report for the Desktop step's proof (no client, never on a card) ── */
async function sample(db: Any) {
  const token = newToken()
  const { data: r, error } = await db.from('incident_report').insert({ kind: 'client', practice: true, client_name: 'Test Client', caregiver: 'Test Caregiver',
    happened_on: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }), source_item_id: 'practice-sample', token_hash: await sha256(token),
    expires_at: new Date(Date.now() + 36e5).toISOString(), started_by: 'desktop-step', started_by_name: 'Desktop step', sent_at: new Date().toISOString() }).select('id').single()
  if (error) throw new Error('could not make the sample: ' + error.message)
  await event(db, r.id, 'started', { name: 'Desktop step' }, { practice: true, sample: true })
  return json({ ok: true, id: r.id, link: linkFor(token), token })
}
