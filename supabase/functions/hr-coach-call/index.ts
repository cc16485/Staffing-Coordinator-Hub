// =============================================================================
// hr-coach-call · COACHING BY RECORDED PHONE CALL, part C1 (Samantha 2026-10-18: "Start the coaching calls build")
// =============================================================================
// The door to coaching calls (rules: _shared/coaching-calls.ts). The manager presses Call now on a coaching record; the
// office bridge rings their phone and connects the employee from the office line; this finds the call GoHighLevel
// logged (the manager's first call to that employee after the tap), checks it qualifies and that its recording came
// back, and the manager confirms they spoke. Only then does it count, and hr_coaching_act's done needs it (once live).
// OFF until ops_settings.hr_coaching_calls_live === true (after her two gates: who can hear calls inside GoHighLevel,
// and the attorney-checked employee notice). Until then only Samantha and Zach can try it, as practice, on any record:
// practice rows never count toward completing a coaching record and no audio copy is kept.
// Who: the coach on the record, Samantha and Zach (office coaching: Samantha and Zach only). The audio plays only for
// them, every play logged.
//
//   list       { coaching_id }                 -> { live, min_seconds, calls[] }   (never an audio path)
//   tap        { coaching_id }                 -> rings the manager's phone; a waiting row
//   find       { call_id }                     -> looks again now for the call after that tap
//   candidates { coaching_id }                 -> the manager's own recent calls with this employee (the backup)
//   pick       { coaching_id, message_id }     -> links one of those
//   confirm    { call_id }                     -> "I spoke with them": counts if it qualifies (keeps the private copy)
//   exception  { call_id, reason }             -> Zach or Samantha only: a phone-system failure (no recording)
//   play       { call_id }                     -> the audio (private copy, else GoHighLevel), logged
//   sweep      (schedule)                      -> finds calls for taps from the last 30 minutes; gives up after that
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff } from '../_shared/staff-auth.ts'
import { jobCaller } from '../_shared/job-auth.ts'
import { ghlCallBridge, ghlUserFor } from '../_shared/ghl-call-bridge.ts'
import { normalisePhone } from '../_shared/outreach.ts'
import { logOpen, ipOf } from '../_shared/doc-log.ts'
import { contactCalls, recordingOk, recordingUrl, matchAfterTap, pickList, qualify, minSeconds, digitsOf, MATCH_AFTER_MS, type Call } from '../_shared/coaching-calls.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
// deno-lint-ignore no-explicit-any
type Any = any
const BUCKET = 'hr-audio'
const SHOW = 'id,coaching_id,practice,matched_by,tapped_by,tap_at,call_at,seconds,call_status,direction,recording_ok,state,reason,confirmed_by,confirmed_at,exception_by,exception_reason,created_at'
const GIVE_UP_MS = 30 * 60_000

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } })
  const ghl = { token: Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || '', locationId: Deno.env.get('GHL_LOCATION_ID') || '' }
  const b: Any = await req.json().catch(() => ({}))
  const action = String(b?.action ?? '')
  try {
    const ops = (await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()).data?.data ?? {}
    const live = ops.hr_coaching_calls_live === true, min = minSeconds(ops)
    if (action === 'sweep' || new URL(req.url).searchParams.get('sweep') === '1') {
      const caller = await jobCaller(req)
      if (!caller) return json({ error: 'not allowed' }, 401)
      return json(await sweep(db, ghl, ops, min))
    }
    const who = await requireStaff(db, req, ['owner_admin', 'care_coordinator'])
    if (!who.ok) return json({ error: who.error }, who.status)
    const me = who.email.toLowerCase(), owner = who.roles.includes('owner_admin')
    const recOf = async (id: unknown) => /^[0-9a-f-]{36}$/i.test(String(id ?? '')) ? (await db.from('hr_coaching').select('*').eq('id', String(id)).maybeSingle()).data : null
    /* office coaching (part C3) is for Samantha and Zach only; a caregiver's coach once it is live */
    const mayUse = (c: Any) => !!c && (owner || (live && c.subject_type !== 'office' && String(c.assigned_to || '').toLowerCase() === me))
    if (!live && !owner) return json({ error: 'Coaching calls are not switched on yet.' }, 403)

    if (['list', 'tap', 'candidates', 'pick'].includes(action)) {
      const c = await recOf(b?.coaching_id)
      if (!c) return json({ error: 'That coaching record is not on file.' }, 404)
      if (!mayUse(c)) return json({ error: 'This coaching record is assigned to someone else.' }, 403)
      if (action === 'list') {
        const { data } = await db.from('hr_coaching_call').select(SHOW).eq('coaching_id', c.id).order('created_at', { ascending: false })
        return json({ ok: true, live, min_seconds: min, calls: data || [] })
      }
      if (c.status !== 'open') return json({ error: 'This coaching record is closed.' }, 409)
      if (action === 'tap') return json(await tap(db, ghl, ops, who, c, live))
      if (action === 'candidates') return json(await candidates(db, ghl, ops, me, c))
      return json(await pick(db, ghl, ops, me, c, String(b?.message_id || ''), live, min))
    }
    const row = /^[0-9a-f-]{36}$/i.test(String(b?.call_id ?? '')) ? (await db.from('hr_coaching_call').select('*').eq('id', String(b.call_id)).maybeSingle()).data : null
    if (!row) return json({ error: 'That call is not on file.' }, 404)
    const c = await recOf(row.coaching_id)
    if (!mayUse(c)) return json({ error: 'This coaching record is assigned to someone else.' }, 403)
    if (action === 'find') return json(await findFor(db, ghl, ops, row, min))
    if (action === 'confirm') {
      if (row.state !== 'qualifies') return json({ error: row.state === 'confirmed' ? 'Already confirmed.' : 'This call does not count: ' + (row.reason || 'not found yet') }, 409)
      if (String(row.tapped_by).toLowerCase() !== me && !owner) return json({ error: 'Only the person who made the call confirms it.' }, 403)
      let audio_path: string | null = null
      if (!row.practice) audio_path = await keepAudio(db, ghl, row)
      if (!row.practice && !audio_path) return json({ error: 'GoHighLevel did not give the recording back just now, so it was not confirmed. Try again in a minute.' }, 502)
      await db.from('hr_coaching_call').update({ state: 'confirmed', confirmed_by: me, confirmed_at: new Date().toISOString(), audio_path }).eq('id', row.id).eq('state', 'qualifies')
      return json({ ok: true, state: 'confirmed', practice: row.practice })
    }
    if (action === 'exception') {
      if (!owner) return json({ error: 'Only Zach or Samantha can excuse a missing recording.' }, 403)
      const reason = String(b?.reason || '').trim()
      if (reason.length < 10) return json({ error: 'Say what failed in the phone system (at least a few words).' }, 400)
      if (!['attempt', 'no_call'].includes(row.state) || row.reason?.startsWith('It went to voicemail') || row.reason?.startsWith('Nobody answered')) return json({ error: 'Only a call that connected but has no recording can be excused.' }, 409)
      await db.from('hr_coaching_call').update({ state: 'exception', exception_by: me, exception_reason: reason.slice(0, 400), confirmed_by: me, confirmed_at: new Date().toISOString() }).eq('id', row.id)
      return json({ ok: true, state: 'exception' })
    }
    if (action === 'play') {
      if (!row.ghl_message_id) return json({ error: 'No call is linked yet.' }, 404)
      const logged = await logOpen(db, { subject: 'hr_coaching:' + row.coaching_id, doc: 'coaching_call', path: row.audio_path || ('ghl:' + row.ghl_message_id), who: { email: me, name: who.name, person_id: who.person_id }, ip: ipOf(req) })
      if (!logged) return json({ error: 'The play could not be logged, so it did not play. Try again.' }, 500)
      if (row.audio_path) {
        const { data, error } = await db.storage.from(BUCKET).download(row.audio_path)
        if (error || !data) return json({ error: 'The kept copy could not be opened.' }, 500)
        return new Response(data, { headers: { ...cors, 'Content-Type': data.type || 'audio/x-wav' } })
      }
      const r = await fetch(recordingUrl(ghl.locationId, row.ghl_message_id), { headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-04-15', Accept: '*/*' } })
      if (!r.ok) return json({ error: 'GoHighLevel has no recording for this call.' }, 404)
      return new Response(r.body, { headers: { ...cors, 'Content-Type': r.headers.get('content-type') || 'audio/x-wav' } })
    }
    return json({ error: 'unknown action' }, 400)
  } catch (e) {
    return json({ error: String((e as Error)?.message || e).slice(0, 300) }, 500)
  }
})

async function employeePhone(db: Any, c: Any): Promise<string | null> {
  /* part C3: an office employee's phone comes from the staff list, by their email on the record */
  if (c.subject_type === 'office') {
    const { data: st } = await db.from('app_data').select('data').eq('key', 'coordinator_staff').maybeSingle()
    const hit = (Array.isArray(st?.data) ? st.data : []).filter((x: Any) => String(x?.email || '').toLowerCase() === String(c.subject_email || '').toLowerCase())
    return hit.length === 1 ? normalisePhone(hit[0].phone) : null
  }
  const { data } = await db.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
  const roster: Any[] = Array.isArray(data?.data) ? data.data : []
  const hit = roster.filter((g) => String(g?.axiscare_id ?? '') === String(c.axiscare_caregiver_id))
  return hit.length === 1 ? normalisePhone(hit[0].phone) : null
}
async function linkedIds(db: Any): Promise<Set<string>> {
  const { data } = await db.from('hr_coaching_call').select('ghl_message_id').not('ghl_message_id', 'is', null)
  return new Set((data || []).map((r: Any) => String(r.ghl_message_id)))
}

/* ── Call now: the office bridge rings the manager; the tap is kept so the call can be found, and kept private ── */
async function tap(db: Any, ghl: Any, ops: Any, who: Any, c: Any, live: boolean) {
  const phone = await employeePhone(db, c)
  if (!phone) return { ok: false, error: `${c.caregiver} has no usable phone number on the roster.` }
  const out = await ghlCallBridge(db, ghl, ops, { email: who.email, name: who.name || who.email, via: 'hub' }, { phone })
  if (!out.ok) return { ok: false, error: out.message || ('The call could not start (' + out.why + ').'), why: out.why, wait_sec: out.wait_sec }
  const user = await ghlUserFor(db, ghl, ops, who.email)
  const { data: row, error } = await db.from('hr_coaching_call').insert({ coaching_id: c.id, practice: !live, matched_by: 'tap', tapped_by: who.email.toLowerCase(),
    tap_at: new Date().toISOString(), ghl_contact_id: out.contact_id, phone_digits: digitsOf(phone), ghl_user_id: user.id || null, state: 'waiting' }).select(SHOW).single()
  if (error) return { ok: false, error: 'The call is ringing, but it could not be noted here: ' + error.message }
  return { ok: true, practice: !live, call: row, ringing: out.ringing, app_url: out.app_url, web_url: out.web_url,
    say_first: 'This call is being recorded for our coaching records.' }
}

/* ── After the call: the manager's first call to this employee from a minute before the tap to 10 minutes after ── */
async function findFor(db: Any, ghl: Any, ops: Any, row: Any, min: number) {
  if (row.state !== 'waiting') return { ok: true, state: row.state, reason: row.reason }
  if (!row.ghl_contact_id || !row.ghl_user_id) {
    await db.from('hr_coaching_call').update({ state: 'no_call', reason: 'Your GoHighLevel user is not known to the Hub (Settings, Calls), so the call cannot be matched. Pick it from your recent calls.' }).eq('id', row.id).eq('state', 'waiting')
    return { ok: true, state: 'no_call' }
  }
  const calls = await contactCalls(ghl.token, ghl.locationId, row.ghl_contact_id)
  const hit = matchAfterTap(calls, Date.parse(row.tap_at), row.ghl_user_id, await linkedIds(db))
  if (!hit) {
    if (Date.now() - Date.parse(row.tap_at) > GIVE_UP_MS) await db.from('hr_coaching_call').update({ state: 'no_call', reason: 'No call from you to them was found after the tap. If you did talk, pick the call from your recent calls.' }).eq('id', row.id).eq('state', 'waiting')
    return { ok: true, state: Date.now() - Date.parse(row.tap_at) > GIVE_UP_MS ? 'no_call' : 'waiting' }
  }
  return await link(db, ghl, row, hit, min)
}
async function link(db: Any, ghl: Any, row: Any, call: Call, min: number) {
  const rec = await recordingOk(ghl.token, ghl.locationId, call.id)
  const q = qualify(call, rec, min)
  const patch = { ghl_message_id: call.id, call_at: new Date(call.at).toISOString(), seconds: call.seconds, call_status: call.status, direction: call.direction,
    recording_ok: rec, recording_checked_at: new Date().toISOString(), state: q.ok ? 'qualifies' : 'attempt', reason: q.reason || null }
  const { error } = await db.from('hr_coaching_call').update(patch).eq('id', row.id).eq('state', 'waiting')
  if (error) return { ok: false, error: /duplicate|unique/i.test(error.message) ? 'That call is already linked to another coaching record.' : error.message }
  return { ok: true, state: patch.state, reason: q.reason, seconds: call.seconds }
}

/* ── The backup: the manager's own recent calls with this employee ── */
async function candidates(db: Any, ghl: Any, ops: Any, me: string, c: Any) {
  const phone = await employeePhone(db, c)
  const last = (await db.from('hr_coaching_call').select('ghl_contact_id').eq('coaching_id', c.id).not('ghl_contact_id', 'is', null).order('created_at', { ascending: false }).limit(1)).data?.[0]
  let contact = last?.ghl_contact_id || ''
  if (!contact && phone) {
    const r = await fetch(`https://services.leadconnectorhq.com/contacts/?locationId=${encodeURIComponent(ghl.locationId)}&query=${encodeURIComponent(phone)}`, { headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', Accept: 'application/json' } })
    const hits = r.ok ? ((await r.json().catch(() => ({})))?.contacts || []).filter((k: Any) => digitsOf(k.phone) === digitsOf(phone)) : []
    if (hits.length === 1) contact = String(hits[0].id)
  }
  if (!contact) return { ok: false, error: `${c.caregiver}'s GoHighLevel contact could not be found from their phone number.` }
  const user = await ghlUserFor(db, ghl, ops, me)
  if (!user.id) return { ok: false, error: 'Your GoHighLevel user is not known to the Hub. Ask Samantha to add it under Settings, Calls.' }
  const list = pickList(await contactCalls(ghl.token, ghl.locationId, contact), user.id, await linkedIds(db), Date.now())
  return { ok: true, contact, calls: list.map((k) => ({ message_id: k.id, at: new Date(k.at).toISOString(), seconds: k.seconds, status: k.status, direction: k.direction })) }
}
async function pick(db: Any, ghl: Any, ops: Any, me: string, c: Any, messageId: string, live: boolean, min: number) {
  const list = await candidates(db, ghl, ops, me, c) as Any   /* the same list the manager saw: their own calls, unlinked */
  if (!list.ok) return list
  const k = (list.calls || []).find((x: Any) => x.message_id === messageId)
  if (!k) return { ok: false, error: 'That call is not one of your recent calls with them (or it is linked to another record).' }
  const phone = await employeePhone(db, c)
  const user = await ghlUserFor(db, ghl, ops, me)
  const { data: row, error } = await db.from('hr_coaching_call').insert({ coaching_id: c.id, practice: !live, matched_by: 'pick', tapped_by: me, tap_at: k.at,
    ghl_contact_id: list.contact, phone_digits: phone ? digitsOf(phone) : null, ghl_user_id: user.id, state: 'waiting' }).select('*').single()
  if (error) return { ok: false, error: error.message }
  return await link(db, ghl, row, { id: k.message_id, at: Date.parse(k.at), seconds: k.seconds, status: k.status, userId: user.id, direction: k.direction, contactId: row.ghl_contact_id || '' }, min)
}

/* ── The private copy (live calls only), kept at confirmation ── */
async function keepAudio(db: Any, ghl: Any, row: Any): Promise<string | null> {
  try {
    const r = await fetch(recordingUrl(ghl.locationId, row.ghl_message_id), { headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-04-15', Accept: '*/*' } })
    if (!r.ok) return null
    const type = (r.headers.get('content-type') || 'audio/x-wav').split(';')[0].trim()
    const bytes = new Uint8Array(await r.arrayBuffer())
    if (!bytes.length) return null
    const ext = /mpeg|mp3/.test(type) ? 'mp3' : /mp4/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : 'wav'
    const path = `coaching/${row.coaching_id}/${row.id}.${ext}`
    const { error } = await db.storage.from(BUCKET).upload(path, bytes, { contentType: type, upsert: false })
    return error ? null : path
  } catch { return null }
}

/* ── The schedule: taps from the last 30 minutes get their call looked up; older ones are given up ── */
async function sweep(db: Any, ghl: Any, ops: Any, min: number) {
  const since = new Date(Date.now() - GIVE_UP_MS - MATCH_AFTER_MS).toISOString()
  const { data, error } = await db.from('hr_coaching_call').select('*').eq('state', 'waiting').gte('tap_at', since).limit(20)
  if (error) throw new Error(error.message)
  const out: Record<string, number> = { looked: 0, linked: 0, gave_up: 0 }
  for (const row of data || []) {
    out.looked++
    try { const r: Any = await findFor(db, ghl, ops, row, min); if (r.state === 'qualifies' || r.state === 'attempt') out.linked++; if (r.state === 'no_call') out.gave_up++ } catch { /* the next run tries again */ }
  }
  const { data: old } = await db.from('hr_coaching_call').update({ state: 'no_call', reason: 'No call from you to them was found after the tap. If you did talk, pick the call from your recent calls.' })
    .eq('state', 'waiting').lt('tap_at', since).select('id')
  out.gave_up += (old || []).length
  return { ok: true, ...out }
}
