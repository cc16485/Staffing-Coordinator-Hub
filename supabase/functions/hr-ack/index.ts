// =============================================================================
// hr-ack · WRITE-UP ACKNOWLEDGMENT (HR Agent build step 8, Samantha 2026-10-18: "build step 8")
// =============================================================================
// The caregiver signs that they RECEIVED an approved write-up (not that they agree), on a private link Zach texts or in
// person on an office or Zach's phone; or Zach records a refusal with the date, how it was delivered and a witness. The
// signed or refused notice becomes a PDF in the private bucket hr-docs. Rules and words: _shared/hr-ack.ts.
// PRACTICE until ops_settings.hr_ack_live === true (build step 10): an acknowledgment started in practice runs end to end
// (link, signature, refusal, PDF) but texts nobody, leaves the write-up as it is, writes nothing to AxisCare and makes
// no task. A live one, when finished: the write-up is marked issued with the outcome, AxisCare gets a short note with no
// details, and Zach gets a My Work task to upload the PDF in AxisCare (its system takes no files).
//
// ── Owners (Samantha or Zach, their own Hub sign-in)
//   list     { writeup_id? }                       -> { live, acks[] } (never the link code)
//   start    { writeup_id, via: link|in_person }   -> { ack, link, draft?, phone_last4?, practice }  the write-up must be approved
//   send     { ack_id, message }                   -> { outcome: sent|practice|refused|failed }  Zach's own press, his words
//   record   { ack_id, outcome: refused|did_not_sign, date, how, witness, witness_reason, note }
//   open     { ack_id }                            -> { url } five minutes; every open logged
//   uploaded { ack_id }                            the PDF is in AxisCare (closes his task)
//   cancel   { ack_id }                            a waiting link stops working
// ── The caregiver (their private link https://cc.mo-care.com/notice.html?t=<code>; no sign-in)
//   view     { t }                                 -> { first, level, notice, receipt, status, practice, office_phone }
//   sign     { t, typed_name, consent: true, notice_hash } -> { copy_url }
// ── The owner's Desktop step (server key): sample {} -> { link }  a practice notice for "Test Caregiver" (no write-up)
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff } from '../_shared/staff-auth.ts'
import { ownerCaller } from '../_shared/job-auth.ts'
import { contactForOutbound, normalisePhone } from '../_shared/outreach.ts'
import { MO_FROM } from '../_shared/office-from.ts'
import { logOpen, ipOf } from '../_shared/doc-log.ts'
import { BUCKET, LINK_DAYS, RECEIPT_WORDS, OFFICE_PHONE, MAX_TEXT, sha256, newToken, linkFor, tokenOk, firstName, shortName, nameMatches,
  draftText, axNoteText, unsignedTooLong, refusalMissing, readableNotice, ackPdf, chicagoYmd, type Refusal } from '../_shared/hr-ack.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
// deno-lint-ignore no-explicit-any
type Any = any
const HR_LEAD = 'zach@mo-care.com'
const PUBLIC = ['view', 'sign']
const SHOW = 'id,writeup_id,practice,caregiver,axiscare_caregiver_id,level,via,expires_at,status,started_by,started_at,sent_at,sent_by,opened_at,signed_name,signed_at,refused_on,refused_how,witness,witness_reason,recorded_by,recorded_at,note,pdf_path,ax_note,ax_note_error,ax_upload_at,ax_upload_by'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } })
  const b: Any = await req.json().catch(() => ({}))
  const action = String(b?.action ?? '')
  try {
    if (PUBLIC.includes(action)) return await caregiverSide(db, req, action, b)
    if (action === 'sample') {
      if (!(await ownerCaller(req))) return json({ error: 'not allowed' }, 401)
      return await sample(db)
    }
    /* the Desktop step's proof: the owner's server key may record and open the practice sample only, never a real notice */
    if ((action === 'record' || action === 'open') && await ownerCaller(req)) {
      const s0 = await getAck(db, b?.ack_id)
      if (!s0 || s0.writeup_id !== 'practice-sample' || !s0.practice) return json({ error: 'not allowed' }, 401)
      const me0 = { email: 'desktop-step', name: 'Desktop step' }
      if (action === 'record') return await record(db, me0, s0, b)
      const { data } = await db.storage.from(BUCKET).createSignedUrl(String(s0.pdf_path || ''), 60)
      return json({ ok: !!data?.signedUrl, url: data?.signedUrl || null })
    }
    const who = await requireStaff(db, req, ['owner_admin'])
    if (!who.ok) return json({ error: who.status === 403 ? 'Only Samantha or Zach can do this.' : who.error }, who.status)
    const me = { email: who.email, name: who.name }
    const live = await isLive(db)
    if (action === 'list') {
      let q = db.from('hr_ack').select(SHOW).order('started_at', { ascending: false }).limit(200)
      if (b?.writeup_id) q = q.eq('writeup_id', String(b.writeup_id))
      const { data, error } = await q
      if (error) throw new Error(error.message)
      return json({ ok: true, live, acks: (data || []).map((a: Any) => ({ ...a, unsigned_too_long: unsignedTooLong(a) })) })
    }
    if (action === 'start') return await start(db, me, live, b)
    const ack = await getAck(db, b?.ack_id)
    if (!ack) return json({ error: 'That acknowledgment is not on file. Reload and try again.' }, 404)
    if (action === 'send') return await send(db, me, ack, b)
    if (action === 'record') return await record(db, me, ack, b)
    if (action === 'open') {
      if (!ack.pdf_path) return json({ error: 'There is no PDF yet.' }, 404)
      const logged = await logOpen(db, { subject: 'hr_ack:' + ack.id, doc: 'hr_ack', path: ack.pdf_path, who: { email: me.email, name: me.name, person_id: who.person_id }, ip: ipOf(req) })
      if (!logged) return json({ error: 'The open could not be logged, so the PDF was not opened. Try again.' }, 500)
      const { data, error } = await db.storage.from(BUCKET).createSignedUrl(ack.pdf_path, 300)
      if (error || !data?.signedUrl) throw new Error('could not open the PDF')
      return json({ ok: true, url: data.signedUrl, expires_in: 300 })
    }
    if (action === 'uploaded') {
      if (ack.practice) return json({ error: 'A practice notice is never filed in AxisCare.' }, 409)
      if (!['signed', 'refused', 'did_not_sign'].includes(ack.status)) return json({ error: 'It is not signed or recorded yet.' }, 409)
      await db.from('hr_ack').update({ ax_upload_at: new Date().toISOString(), ax_upload_by: me.email }).eq('id', ack.id)
      await event(db, ack.id, 'axiscare_uploaded', me)
      await card(db, ack, false)
      return json({ ok: true })
    }
    if (action === 'cancel') {
      if (ack.status !== 'waiting') return json({ error: 'Only a notice still waiting for a signature can be cancelled.' }, 409)
      await db.from('hr_ack').update({ status: 'cancelled' }).eq('id', ack.id).eq('status', 'waiting')
      await event(db, ack.id, 'cancelled', me)
      return json({ ok: true })
    }
    return json({ error: 'unknown action' }, 400)
  } catch (e) {
    return json({ error: String((e as Error)?.message || e).slice(0, 300) }, 500)
  }
})

async function isLive(db: Any) { const { data } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle(); return data?.data?.hr_ack_live === true }
async function getAck(db: Any, id: unknown) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id ?? ''))) return null
  return (await db.from('hr_ack').select('*').eq('id', String(id)).maybeSingle()).data
}
async function event(db: Any, ackId: string, kind: string, who: { email?: string; name?: string } = {}, detail: Record<string, unknown> = {}) {
  try { await db.from('hr_ack_event').insert({ ack_id: ackId, kind, by_email: who.email || null, by_name: who.name || null, detail }) } catch { /* the outcome is on the row itself */ }
}
async function writeups(db: Any): Promise<Any[]> { const { data } = await db.from('app_data').select('data').eq('key', 'discipline_actions').maybeSingle(); return Array.isArray(data?.data) ? data.data : [] }

/* ── Zach starts one: a snapshot of the approved notice, a private link ── */
async function start(db: Any, me: Any, live: boolean, b: Any) {
  const via = b?.via === 'in_person' ? 'in_person' : b?.via === 'link' ? 'link' : ''
  if (!via) return json({ error: 'Pick text a link or sign in person.' }, 400)
  const w = (await writeups(db)).find((x) => x && String(x.id) === String(b?.writeup_id ?? ''))
  if (!w) return json({ error: 'That write-up is not on file. Reload and try again.' }, 404)
  if (w.status !== 'approved') return json({ error: 'Only an approved write-up can be sent for a signature.' }, 409)
  const notice = String(w.body || '').trim()
  if (!notice) return json({ error: 'The write-up has no notice text yet.' }, 409)
  const token = newToken(), now = new Date()
  const expires = new Date(now.getTime() + (via === 'in_person' ? 2 * 36e5 : LINK_DAYS * 864e5))
  await db.from('hr_ack').update({ status: 'cancelled' }).eq('writeup_id', String(w.id)).eq('status', 'waiting')
  const row = { writeup_id: String(w.id), practice: !live, caregiver: String(w.caregiver || ''), axiscare_caregiver_id: String(w.axiscare_caregiver_id || w.ax_caregiver_id || '') || null,
    level: String(w.level || ''), notice, notice_hash: await sha256(notice), via, token_hash: await sha256(token), expires_at: expires.toISOString(), started_by: me.email }
  const { data: ack, error } = await db.from('hr_ack').insert(row).select(SHOW).single()
  if (error) throw new Error('could not start: ' + error.message)
  await event(db, ack.id, 'started', me, { via, practice: !live })
  const link = linkFor(token)
  if (via === 'in_person') return json({ ok: true, practice: !live, ack, link })
  const cg = await rosterFor(db, ack)
  const phone = cg ? normalisePhone(cg.phone) : null
  return json({ ok: true, practice: !live, ack, link, draft: draftText(ack.caregiver, link), phone_last4: phone ? phone.slice(-4) : '' })
}
async function rosterFor(db: Any, ack: Any): Promise<Any | null> {
  const { data } = await db.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
  const roster: Any[] = Array.isArray(data?.data) ? data.data : []
  if (ack.axiscare_caregiver_id) { const h = roster.filter((c) => String(c?.axiscare_id ?? '') === String(ack.axiscare_caregiver_id)); if (h.length === 1) return h[0] }
  const key = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '')
  const h = roster.filter((c) => key([c?.first, c?.last].join(' ')) === key(ack.caregiver))
  return h.length === 1 ? h[0] : null
}

/* ── Zach's press: his words, which must carry this notice's link ── */
async function send(db: Any, me: Any, ack: Any, b: Any) {
  if (ack.status !== 'waiting' || ack.via !== 'link') return json({ error: 'This notice is not waiting to be sent.' }, 409)
  const message = String(b?.message ?? '').replace(/\r\n/g, '\n').trim()
  if (!message) return json({ error: 'The message is empty.' }, 400)
  if (message.length > MAX_TEXT) return json({ error: `The message is ${message.length} characters; keep it under ${MAX_TEXT}.` }, 400)
  const m = message.match(/notice\.html\?t=([A-Za-z0-9_-]{40,60})/)
  if (!m || (await sha256(m[1])) !== ack.token_hash) return json({ error: 'The message must keep the private link to this notice.' }, 400)
  if (/\u2014/.test(message)) return json({ error: 'Please use a comma instead of the long dash.' }, 400)
  const now = new Date().toISOString()
  if (ack.practice) {
    await db.from('hr_ack').update({ sent_at: now, sent_by: me.email }).eq('id', ack.id)
    await event(db, ack.id, 'practice_send', me, { length: message.length })
    return json({ ok: true, outcome: 'practice', note: 'Practice: nothing was texted. Open the link yourself to try signing.' })
  }
  const cg = await rosterFor(db, ack)
  const phone = cg ? normalisePhone(cg.phone) : null
  if (!phone) return json({ outcome: 'no_phone', error: `${ack.caregiver} has no usable phone number on the roster. Sign in person instead.` }, 422)
  const ghl = { token: Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
  if (!ghl.token || !ghl.locationId) return json({ error: 'GoHighLevel is not configured. Nothing was sent.' }, 502)
  let refusal: string[] = []
  const contact = await contactForOutbound(db, ghl, { phone, firstName: cg.first, lastName: cg.last }, 'urgent_internal',
    { audience: 'caregiver', channel: 'sms', sender: 'hr-ack', humanInitiated: true, onOptOut: (r: string[]) => { refusal = r } })
  if (!contact) {
    const why = refusal.length ? `${ack.caregiver} has asked not to get texts (${refusal.join('; ')}). Sign in person instead` : 'the opt-out check could not be completed. Try again in a minute'
    await event(db, ack.id, 'send_refused', me, { why })
    return json({ outcome: 'refused', error: `Not sent: ${why}.` }, 422)
  }
  let ok = false, err = ''
  try {
    const r = await fetch('https://services.leadconnectorhq.com/conversations/messages', { method: 'POST',
      headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'SMS', fromNumber: MO_FROM, contactId: contact.contactId, message }) })
    ok = r.ok; if (!r.ok) err = `GoHighLevel answered ${r.status}`
  } catch { err = 'could not reach GoHighLevel' }
  if (!ok) { await event(db, ack.id, 'send_failed', me, { why: err }); return json({ outcome: 'failed', error: `Not sent: ${err}.` }, 502) }
  await db.from('hr_ack').update({ sent_at: now, sent_by: me.email }).eq('id', ack.id)
  await event(db, ack.id, 'sent', me, { phone_last4: phone.slice(-4), length: message.length })
  return json({ ok: true, outcome: 'sent' })
}

/* ── Zach records a refusal, or that it was never signed ── */
async function record(db: Any, me: Any, ack: Any, b: Any) {
  if (ack.status !== 'waiting') return json({ error: 'This notice already has an outcome.' }, 409)
  const r = { outcome: b?.outcome, date: String(b?.date || ''), how: String(b?.how || ''), witness: String(b?.witness || '').trim().slice(0, 120),
    witness_reason: String(b?.witness_reason || '').trim().slice(0, 300), note: String(b?.note || '').trim().slice(0, 600) }
  const miss = refusalMissing(r)
  if (miss) return json({ error: miss }, 400)
  if (r.date > chicagoYmd()) return json({ error: 'The date cannot be in the future.' }, 400)
  const at = new Date()
  const refusal: Refusal = { ...r, how: r.how as Refusal['how'], by: me.name || me.email, at }
  const pdf_path = await savePdf(db, ack, ackPdf(ack, { refusal }))
  const { data: done, error } = await db.from('hr_ack').update({ status: r.outcome, refused_on: r.date, refused_how: r.how, witness: r.witness || null,
    witness_reason: r.witness ? null : r.witness_reason, note: r.note || null, recorded_by: me.email, recorded_at: at.toISOString(), pdf_path })
    .eq('id', ack.id).eq('status', 'waiting').select('*').maybeSingle()
  if (error || !done) return json({ error: 'Someone else recorded an outcome first. Reload.' }, 409)
  await event(db, ack.id, r.outcome, me, { how: r.how, witness: !!r.witness })
  const filed = await finish(db, done, r.outcome)
  return json({ ok: true, status: r.outcome, practice: done.practice, filed })
}

async function savePdf(db: Any, ack: Any, bytes: Uint8Array): Promise<string> {
  const path = `${ack.practice ? 'practice' : 'notices'}/${ack.writeup_id.replace(/[^A-Za-z0-9_-]/g, '_')}/${ack.id}-${Date.now()}.pdf`
  const { error } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: false })
  if (error) throw new Error('could not keep the PDF: ' + error.message)
  return path
}

/* ── After a signature or a recorded refusal: file it (live only) ── */
async function finish(db: Any, ack: Any, outcome: 'signed' | 'refused' | 'did_not_sign') {
  if (ack.practice) { await event(db, ack.id, 'practice_done', {}, { outcome }); return { practice: true } }
  const out: Record<string, unknown> = {}
  const when = new Date(), whenDay = chicagoYmd(when)
  // 1. the write-up is issued, with how it was acknowledged
  try {
    const w = (await writeups(db)).find((x) => x && String(x.id) === ack.writeup_id)
    if (w) {
      const item = { ...w, status: 'issued', issued_at: w.issued_at || when.toISOString(),
        ack: { id: ack.id, status: outcome, at: (ack.signed_at || ack.recorded_at || when.toISOString()), signed_name: ack.signed_name || null, witness: ack.witness || null, via: ack.via } }
      const { error } = await db.rpc('upsert_app_data_item', { target_key: 'discipline_actions', item })
      out.writeup = error ? 'failed: ' + error.message : 'issued'
      /* the attendance events it covers stop counting toward the next step (as Mark issued did) */
      const ids = new Set((Array.isArray(w.event_ids) ? w.event_ids : []).map(String))
      if (ids.size) {
        const { data: ev } = await db.from('app_data').select('data').eq('key', 'attendance_events').maybeSingle()
        let n = 0
        for (const e of (Array.isArray(ev?.data) ? ev.data : [])) {
          if (e && ids.has(String(e.id)) && !e.action_id) { const r = await db.rpc('upsert_app_data_item', { target_key: 'attendance_events', item: { ...e, action_id: w.id } }); if (!r.error) n++ }
        }
        out.events = n
      }
    } else out.writeup = 'not found'
  } catch (e) { out.writeup = 'failed: ' + String(e).slice(0, 80) }
  // 2. AxisCare: a short note with no details
  const note = axNoteText(ack.level, outcome, new Date(whenDay + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }))
  const ax = await axNote(ack.axiscare_caregiver_id, note)
  await db.from('hr_ack').update({ ax_note: ax.ok ? 'sent' : ax.skipped ? 'skipped' : 'failed', ax_note_error: ax.ok ? null : ax.why }).eq('id', ack.id)
  await event(db, ack.id, ax.ok ? 'axiscare_note' : 'axiscare_note_failed', {}, ax.ok ? {} : { why: ax.why })
  out.axiscare_note = ax.ok ? 'sent' : ax.why
  // 3. Zach's task to upload the PDF in AxisCare
  await card(db, ack, true)
  out.task = 'made'
  return out
}
async function axNote(id: unknown, note: string): Promise<{ ok: boolean; skipped?: boolean; why?: string }> {
  const cg = String(id ?? '')
  if (!/^\d+$/.test(cg)) return { ok: false, skipped: true, why: 'no AxisCare number on the write-up' }
  let token = ''; for (const n of ['AXISCARE_API_KEY', 'AXISCARE_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  if (!token || !/^\d+$/.test(site)) return { ok: false, why: 'AxisCare is not configured' }
  try {
    const r = await fetch(`https://${site}.axiscare.com/api/notes/caregiver/${cg}`, { method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'X-AxisCare-Api-Version': '2023-10-01', 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ note, important: true }) })
    return r.ok ? { ok: true } : { ok: false, why: `AxisCare answered ${r.status}` }
  } catch { return { ok: false, why: 'could not reach AxisCare' } }
}
async function card(db: Any, ack: Any, open: boolean) {
  const now = new Date().toISOString()
  try {
    await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: {
      id: 'ops_hrfile_' + ack.id, kind: 'hr_file', source_id: ack.id, sensitive: true,
      title: 'Upload a notice PDF to AxisCare: ' + shortName(ack.caregiver),
      detail: 'Open it on HR, Formal cases, download the PDF and add it to their AxisCare documents. Then press Uploaded to AxisCare.',
      next_action: 'Upload the PDF in AxisCare, then mark it on the HR page.', about: shortName(ack.caregiver), owner: HR_LEAD,
      domain: 'caregiver_performance', urgency: 'normal', status: open ? 'open' : 'done', closed_at: open ? null : now, closed_by: open ? null : 'system',
      created_at: ack.recorded_at || ack.signed_at || now, last_activity_at: now, due: new Date(Date.now() + 3 * 864e5).toISOString(), opened_by: 'system', link: '#hr/formal' } })
  } catch { /* the write-up window shows the upload button anyway */ }
}

/* ── The caregiver's link ── */
async function caregiverSide(db: Any, req: Request, action: string, b: Any) {
  if (!tokenOk(b?.t)) return json({ error: 'This link is not valid. Call the office at ' + OFFICE_PHONE + '.' }, 404)
  const { data: ack } = await db.from('hr_ack').select('*').eq('token_hash', await sha256(String(b.t))).maybeSingle()
  if (!ack || ack.status === 'cancelled') return json({ error: 'This link is no longer active. Call the office at ' + OFFICE_PHONE + '.' }, 404)
  const expired = ack.status === 'waiting' && ack.expires_at && new Date(ack.expires_at).getTime() < Date.now()
  if (action === 'view') {
    if (ack.status === 'waiting' && !ack.opened_at) { await db.from('hr_ack').update({ opened_at: new Date().toISOString() }).eq('id', ack.id); await event(db, ack.id, 'opened', {}, { ip: ipOf(req) }) }
    return json({ ok: true, first: firstName(ack.caregiver), level: ack.level, notice: readableNotice(ack.notice), notice_hash: ack.notice_hash, receipt: RECEIPT_WORDS,
      status: expired ? 'expired' : ack.status, signed_at: ack.signed_at, practice: ack.practice, office_phone: OFFICE_PHONE })
  }
  // sign
  if (ack.status !== 'waiting') return json({ error: ack.status === 'signed' ? 'This notice is already signed. Thank you.' : 'This notice can no longer be signed here. Call the office at ' + OFFICE_PHONE + '.' }, 409)
  if (expired) return json({ error: 'This link has expired. Call the office at ' + OFFICE_PHONE + ' for a new one.' }, 410)
  if (b?.consent !== true) return json({ error: 'Tick the box to confirm you received the notice.' }, 400)
  if (String(b?.notice_hash || '') !== ack.notice_hash) return json({ error: 'The notice changed. Reload the page and read it again.' }, 409)
  const typed = String(b?.typed_name || '').trim().replace(/\s+/g, ' ').slice(0, 120)
  if (!nameMatches(typed, ack.caregiver)) return json({ error: 'Type your full first and last name, as on your employee record.' }, 400)
  const at = new Date(), ip = ipOf(req).split(',')[0].trim().slice(0, 64), agent = String(req.headers.get('user-agent') || '').slice(0, 300)
  const signedVia = ack.via === 'in_person' ? 'in_person' : 'link'
  const pdf_path = await savePdf(db, ack, ackPdf(ack, { signed: { typedName: typed, at, ip, agent, via: signedVia } }))
  const { data: done, error } = await db.from('hr_ack').update({ status: 'signed', signed_name: typed, signed_at: at.toISOString(), sign_ip: ip, sign_agent: agent, pdf_path, token_hash: null })
    .eq('id', ack.id).eq('status', 'waiting').select('*').maybeSingle()
  if (error || !done) return json({ error: 'This notice was already signed or closed. Thank you.' }, 409)
  await event(db, ack.id, 'signed', { name: typed }, { via: signedVia })
  await finish(db, done, 'signed')
  const { data: u } = await db.storage.from(BUCKET).createSignedUrl(pdf_path, 600)
  return json({ ok: true, copy_url: u?.signedUrl || null, practice: done.practice })
}

/* ── A practice notice for the Desktop step's proof (no write-up, never filed) ── */
async function sample(db: Any) {
  const token = newToken()
  const notice = 'CARING COMPANIONS: CORRECTIVE ACTION NOTICE\nEmployee: Test Caregiver\nAction level: Verbal Warning\n\nTHIS NOTICE IS BEING ISSUED FOR: practice only.\n\nTHE FACTS:\n  • A practice notice for the Desktop step proof.'
  const { data: ack, error } = await db.from('hr_ack').insert({ writeup_id: 'practice-sample', practice: true, caregiver: 'Test Caregiver', level: 'Verbal Warning',
    notice, notice_hash: await sha256(notice), via: 'sample', token_hash: await sha256(token), expires_at: new Date(Date.now() + 36e5).toISOString(), started_by: 'desktop-step', sent_at: new Date().toISOString() })
    .select('id').single()
  if (error) throw new Error('could not make the sample: ' + error.message)
  await event(db, ack.id, 'started', { name: 'Desktop step' }, { via: 'sample', practice: true })
  return json({ ok: true, ack_id: ack.id, link: linkFor(token), token })
}
