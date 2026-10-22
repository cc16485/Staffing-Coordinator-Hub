// =============================================================================
// step2-handoff · SLICE 4 (Samantha "go", 2026-10-10): Viventium Step 2 without an integration. Three audited office actions
// replace the two ticks; the caregiver reports DONE by link or text; the office verifies with the Admin checklist; the
// Orientation Video Call invitation follows (option A). Nothing here reads Viventium; a caregiver's DONE never equals verification.
// =============================================================================
//   staff (signed-in office person):
//   { action: 'sent', candidate_id, note?, resend? }   Record Viventium Step 2 Sent (refused before Approve to Advance on the
//                                                      new path; pressing twice refused; resend is its own stamp). New path:
//                                                      the Step 2 text + email with the private DONE link (step2_send_live,
//                                                      else recorded as practice). Old path: no message (today's Viventium
//                                                      welcome stays until she retires it).
//   { action: 'reported', candidate_id }               the office heard DONE itself (a call, an old-path person)
//   { action: 'verify', candidate_id, ticked: [], i9_section2?, note? }   Verify Viventium Step 2 Complete: who, when, the
//                                                      checklist as ticked (the Admin list, versioned); ticked items confirm
//                                                      the matching readiness-card rows in that person's name; I-9 Section 2
//                                                      is its own line (the person who examined the documents) and confirms
//                                                      nothing else. Then the Orientation Video Call invitation (wc_auto_invite_live,
//                                                      else practice) through welcome-call's own door, same words and gates.
//   IN TRAINING PLAN v2, PART B (Samantha approved 2026-10-22), with ops_settings.orientation_button_live:
//   verify no longer sends the invitation; it opens the "Add to AxisCare as In Training" card instead, and the office sends with:
//   { action: 'axis_sheet', candidate_id, check? }    what to type into AxisCare (name, phone, email, street, city, zip; the
//                                                      birth date is shown by the Hub's own logged reveal); check: true also
//                                                      finds them in AxisCare and checks the zip and birth date (nothing sent)
//   { action: 'send_orientation', candidate_id }       Send orientation information: finds them In Training in AxisCare, checks
//                                                      the zip and the birth date match their Step 1 (nothing is sent until they
//                                                      do), asks the Training Platform for their orientation link without it
//                                                      sending anything, then the ONE welcome message (booking, profile,
//                                                      orientation, badge) through welcome-call's door. Pressing again = Send again.
//   { action: 'still_open', candidate_id, task, preview? }   the office message when a task is still open (preview first)
//   { action: 'undo', candidate_id, which: 'sent'|'reported'|'verified', reason }   who and why; sends nothing; deletes nothing
//   { action: 'preview', first? }                      the four messages with a placeholder link
//   caregiver (no sign-in): { action: 'done', c, e, t }   the private link tapped; counted only at Sent; receipt (step2_send_live)
//   GoHighLevel (?token=STEP2_REPLY_TOKEN, a Customer Replied workflow on contacts tagged step2-sent): { id, phone, name, message }
//                                                      DONE / done / finished counts only when the phone matches exactly one
//                                                      person at Sent; anything else is an office review card
//   job (x-cron-secret, every 15 minutes): { action: 'pass' }   day 3 / day 6 reminders (step2_reminders_live, new path;
//                                                      2026-10-13: Monday to Saturday 9am to 6pm Central, HELD outside it,
//                                                      recorded only when sent or refused for good, three tries then a card),
//                                                      the Orientation Video Call invitation text held after hours (sent at
//                                                      the first pass inside 8am to 6pm), the
//                                                      cards (Sent not recorded by the deadline; DONE not verified by the
//                                                      deadline; no DONE by day 8), closed when the state moves on
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { jobCaller } from '../_shared/job-auth.ts'
import { caregiverGate } from '../_shared/caregiver-journey.ts'
import { ghlContactIfAllowed } from '../_shared/optout.ts'
import { ghlSendChecked } from '../_shared/send-problems.ts'
import { latestTextConsent, inTextHours } from '../_shared/text-consent.ts'
import { makeStep2Link, checkLink } from '../_shared/applicant-links.ts'
import { dueNextBusinessDay, centralYmd } from '../_shared/business-days.ts'
import { sentMessages, reminderMessages, receiptText, stillOpenText, isDoneReply, rowFor, stateOf, reminderDue, inReminderWindow, refusedForGood, REMINDER_TRIES } from '../_shared/step2.ts'
import { testPerson } from '../_shared/test-people.ts'
import { profileReminderMessages, profileLink } from '../_shared/welcome-message.ts'   /* 2026-10-21 the one welcome message + profile reminders */
import { validKey, packetLine } from '../_shared/positions.ts'   /* LPN HIRING 2026-10-14: the Step 2 LPN packet tick */
import { findPerson, matchProblems, axisCaregivers, axisCaregiver, axisAddress, axisDob, zip5, ymd } from '../_shared/axis-setup.ts'   /* 2026-10-22 In Training plan v2 */
import { open as unseal } from '../_shared/step1-crypto.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown, n = 160) => String(v ?? '').trim().slice(0, n)
const digits10 = (p: unknown) => String(p ?? '').replace(/\D/g, '').slice(-10)
const DONE = ['complete', 'not_needed', 'exception']
const STALL_DAYS = 8
type Person = { key: 'candidates' | 'caregivers'; rec: Any; id: string }

/* ── records: a Background & References row, or the roster record the person moved to (keeps candidate_id) ── */
async function list(db: Any, key: string): Promise<Any[]> { const { data } = await db.from('app_data').select('data').eq('key', key).maybeSingle(); return Array.isArray(data?.data) ? data.data : [] }
async function person(db: Any, candId: string): Promise<Person | null> {
  const c = (await list(db, 'candidates')).find((x) => String(x?.id) === candId); if (c) return { key: 'candidates', rec: c, id: String(c.id) }
  const r = (await list(db, 'caregivers')).find((x) => x?.candidate_id != null && String(x.candidate_id) === candId); if (r) return { key: 'caregivers', rec: r, id: String(r.id) }
  return null
}
const candIdOf = (p: Person) => p.key === 'candidates' ? String(p.rec.id) : String(p.rec.candidate_id)
const rev = (x: Any) => (/^[0-9]{1,15}$/.test(String(x?._rev ?? '')) ? Number(x._rev) : 0)
/** the Step 2 fields only, through the server's own door; nobody's other change is lost */
async function patch(db: Any, p: Person, fields: Any, tries = 3): Promise<boolean> {
  let rec = p.rec
  for (let i = 0; i < tries; i++) {
    const { data, error } = await db.rpc('step2_patch', { p_key: p.key, p_id: p.id, p_base_rev: rev(rec), p_patch: fields })
    if (error) throw new Error('could not save: ' + error.message)
    if (data?.ok) { Object.assign(p.rec, fields); return true }
    if (data?.reason !== 'changed' || !data.current_record) return false
    rec = data.current_record; p.rec = rec
  }
  return false
}
const hist = (rec: Any, entry: Any) => { const h = Array.isArray(rec.step2_history) ? rec.step2_history.slice(-49) : []; h.push(entry); return h }
async function journeyFor(db: Any, rec: Any): Promise<{ j: Any; steps: Any[] } | null> {
  if (!rec?.offer_id) return null
  const { data: j } = await db.from('client_journey').select('*').eq('subject', 'caregiver').eq('offer_id', String(rec.offer_id)).maybeSingle()
  if (!j || !['open', 'active'].includes(j.status)) return null
  const { data: steps } = await db.from('client_journey_step').select('*').eq('journey_id', j.journey_id)
  return { j, steps: steps ?? [] }
}
async function putStep(db: Any, journeyId: string, key: string, fields: Any) {
  const { data: cur } = await db.from('client_journey_step').select('version').eq('journey_id', journeyId).eq('step_key', key).maybeSingle()
  const { error } = await db.from('client_journey_step').upsert({ journey_id: journeyId, step_key: key, ...fields, version: (cur?.version ?? 0) + 1, updated_at: new Date().toISOString() }, { onConflict: 'journey_id,step_key' })
  if (error) throw new Error('could not save the card row: ' + error.message)
}
async function event(db: Any, journeyId: string, step: string | null, who: { email?: string; name?: string }, kind: string, detail: Any = {}, reason: string | null = null) {
  await db.from('client_journey_event').insert({ journey_id: journeyId, step_key: step, actor_email: who.email || 'hub', actor_name: who.name || 'The Hub', kind, detail, reason })
}
async function settings(db: Any) { const { data } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle(); return (data?.data && typeof data.data === 'object') ? data.data : {} }
const onb = (st: Any) => {
  const o = st?.onboarding && typeof st.onboarding === 'object' ? st.onboarding : {}
  const days = (Array.isArray(o.step2_days) ? o.step2_days : []).map(Number).filter((n: number) => Number.isInteger(n) && n >= 1 && n <= 30).slice(0, 2)
  const num = (v: unknown, d: number) => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 10 ? Number(v) : d
  return { step2_days: days.length === 2 && days[0] < days[1] ? days : [3, 6], sent_due_days: num(o.step2_sent_due_days, 1), verify_due_days: num(o.verify_due_days, 1), hour: Number.isInteger(Number(o.due_hour)) && Number(o.due_hour) >= 6 && Number(o.due_hour) <= 22 ? Number(o.due_hour) : 17 }
}
const checklist = (st: Any) => { const c = st?.viventium_step2_checklist; return c && typeof c === 'object' && Array.isArray(c.items) && c.items.length ? { version: Number(c.version) || 0, items: c.items.map((x: unknown) => S(x, 200)).filter(Boolean) } : { version: 0, items: ['Offer letter signed in Viventium', 'I-9 Section 1', 'Federal W-4', 'Missouri W-4', 'Direct deposit', 'Employee handbook acknowledged', /* 2026-10-13: Client Rights, Code of Ethics and HIPAA moved into Step 1 and the Orientation Video Call */ 'Driver license or ID uploaded', 'Social Security card uploaded'] } }

/* ── LPN HIRING (Samantha approved the LPN nurse visit plan, 2026-10-14): an LPN or RN hire's Viventium Step 2 LPN packet
   (job description, RN supervision acknowledgment, documentation expectations) is ONE extra tick on Verify, shown only for
   them; it confirms cg.step2.position_description. Who is a nurse: the offer's position key (Training Platform); when the
   offer cannot be read, their Step 1 record's nursing license form says the same. A caregiver never sees or gets it. ── */
async function nursePacket(db: Any, rec: Any): Promise<string | null> {
  const oid = S(rec?.offer_id, 64); if (!oid) return null
  const url = Deno.env.get('OFFERS_PROJECT_URL') ?? '', key = Deno.env.get('OFFERS_SERVICE_ROLE_KEY') ?? ''
  if (url && key) {
    try { const r = await fetch(`${url}/rest/v1/job_offers?id=eq.${encodeURIComponent(oid)}&select=position_key`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
      if (r.ok) { const rows = await r.json(); if (Array.isArray(rows) && rows.length === 1) { const k = validKey(rows[0]?.position_key); return k === 'lpn' || k === 'rn' ? packetLine(k) : null } } } catch { /* the Step 1 record answers below */ }
  }
  try { const { data } = await db.from('step1_forms').select('nurse_form, answers').eq('offer_id', oid).maybeSingle()
    if (data?.nurse_form === true) return packetLine(/registered/i.test(String(data.answers?.nurse_license_type || '')) ? 'rn' : 'lpn') } catch { /* not a nurse as far as the records say */ }
  return null
}

/* ── the Needs Attention cards ── */
async function raiseCard(db: Any, c: { id: string; kind: string; title: string; detail: string; who: string; candidate_id: string; urgency: 'urgent' | 'today' | 'normal'; owner?: string; due?: string }) {
  try {
    const now = new Date().toISOString()
    const items = await list(db, 'ops_items'); const prev = items.find((x) => x && x.id === c.id)
    const isOpen = (x: Any) => x && x.status !== 'done' && x.status !== 'resolved'
    if (prev && !isOpen(prev)) return
    const item = { ...(prev && isOpen(prev) ? prev : { owner: c.owner || '', owner_name: '', created_at: now, first_at: now }), id: c.id, kind: c.kind, domain: 'caregivers', status: 'open', urgency: c.urgency, title: c.title, detail: c.detail, who: c.who, candidate_id: c.candidate_id,
      last_at: now, due: (prev && isOpen(prev) && prev.due) || c.due || new Date(Date.now() + 24 * 3_600_000).toISOString(), closed_at: null, closed_by: null, close_note: null, resolved_at: null, created_by: 'step2-handoff', opened_by: 'step2-handoff' }
    await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item })
  } catch (e) { console.warn('[step2-handoff] could not raise a card: ' + String(e).slice(0, 160)) }
}
async function closeCard(db: Any, id: string, note: string) {
  try {
    const prev = (await list(db, 'ops_items')).find((x) => x && x.id === id)
    if (!prev || prev.status === 'done' || prev.status === 'resolved') return
    const now = new Date().toISOString()
    await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { ...prev, status: 'done', closed_at: now, closed_by: 'step2-handoff', close_reason: note, last_activity_at: now } })
  } catch (e) { console.warn('[step2-handoff] could not close a card: ' + String(e).slice(0, 160)) }
}

/* ── sending: the office path (hours, their yes to texts, the opt-out door; a refusal raises a card); the contact is tagged step2-sent so GoHighLevel routes the reply ── */
async function deliver(db: Any, rec: Any, m: { text: string; subject?: string; html?: string }, sender: string, send: typeof fetch = fetch) {
  const ghl = { token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
  const H = { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' }
  const notSent: string[] = []; let texted = false, emailed = false
  const name = `${rec.first || ''} ${rec.last || ''}`.trim(), phone = S(rec.phone, 30), email = S(rec.email, 160).toLowerCase()
  if (!ghl.token || !ghl.locationId) return { texted, emailed, not_sent: ['texting is not set up on the server'] }
  if (phone) {
    const c = await latestTextConsent(db, phone)
    if (!inTextHours()) notSent.push('text: texts go 8am to 6pm Central' + (m.html ? ' (the email still went)' : ''))
    else if (!c.ok) notSent.push('text: ' + c.why)
    else {
      const id = await ghlContactIfAllowed(db, ghl, sender, { channel: 'sms', phone, email, firstName: rec.first, lastName: rec.last, extra: { tags: ['step2-sent'] } }, send)
      if (!id) notSent.push('text: they opted out, or the number could not be confirmed')
      else if (!(texted = await ghlSendChecked(db, H, sender, { channel: 'sms', contactId: id, address: phone, who: name }, { message: m.text }, send))) notSent.push('text: GoHighLevel did not accept it (a card is on Needs Attention)')
    }
  }
  if (email && m.html) {
    const id = await ghlContactIfAllowed(db, ghl, sender, { channel: 'email', email, phone, firstName: rec.first, lastName: rec.last, extra: { tags: ['step2-sent'] } }, send)
    if (!id) notSent.push('email: they opted out, or the address could not be confirmed')
    else if (!(emailed = await ghlSendChecked(db, H, sender, { channel: 'email', contactId: id, address: email, who: name }, { subject: m.subject, html: m.html }, send))) notSent.push('email: GoHighLevel did not accept it (a card is on Needs Attention)')
  }
  if (!phone && !email) notSent.push('no phone number or email on file')
  return { texted, emailed, not_sent: notSent }
}
const doneLink = (candId: string) => makeStep2Link(Deno.env.get('HUB_JOB_SECRET') ?? '', candId)
/** the Orientation Video Call invitation through welcome-call's own server door (same words, gate and opt-out door) */
async function inviteVia(c: Any, cid: string, by: string, only?: 'text', welcome = false, orientationUrl?: string): Promise<{ ok: boolean; status: number; j: Any }> {
  const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/welcome-call`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '', Authorization: 'Bearer ' + (Deno.env.get('SUPABASE_ANON_KEY') ?? ''), 'x-cron-secret': Deno.env.get('HUB_JOB_SECRET') ?? '' }, body: JSON.stringify({ action: 'invite_auto', candidate_id: cid, first: c.first || '', last: c.last || '', phone: c.phone || '', email: c.email || '', by, ...(only ? { only } : {}), ...(welcome ? { welcome: true } : {}), ...(orientationUrl ? { orientation_url: orientationUrl } : {}) }) })
  const j = await r.json().catch(() => ({}))
  return { ok: r.ok && !!j?.ok, status: r.status, j }
}

/* ── IN TRAINING PLAN v2, PART B (2026-10-22): the AxisCare setup card and Send orientation information ── */
const TRAINING_JOB_OFFER = 'https://rdqujxiycycwhskyvrwa.supabase.co/functions/v1/job-offer'
/** their Step 1 identity record: address and zip as they gave them, and whether a birth date is on file (sealed) */
async function step1Id(db: Any, offerId: string): Promise<Any | null> {
  if (!offerId) return null
  const { data } = await db.from('step1_identity').select('address1,address2,city,state,zip,dob_sealed,purged_at').eq('offer_id', offerId).maybeSingle()
  return data ?? null
}
/** the AxisCare check: found In Training by phone or email, and the zip and birth date the app sign-up needs. The birth date is
    compared on the server and never shown here; the comparison is logged like a reveal (doc identity:dob, "compared"). */
async function axisCheck(db: Any, c: Any, who: Any, send: typeof fetch = fetch): Promise<Any> {
  const list = await axisCaregivers(send)
  if (!list.ok) return { ok: false, found: false, problems: [list.why + ' Nothing was sent. Try again in a minute.'] }
  const f = findPerson(list.all, [c.phone, c.mobile], [c.email])
  if (!f.match) return { ok: false, found: false, short: f.short, problems: [f.why] }
  const full = (await axisCaregiver(String(f.match.id), send)) || f.match
  const addr = axisAddress(full), axDob = axisDob(full)
  const id = await step1Id(db, S(c.offer_id, 64))
  let dob: string | null = null, dobWhy: string | null = null
  if (id?.dob_sealed && !id?.purged_at) {
    try {
      dob = ymd(await unseal(Deno.env.get('STEP1_KEK') ?? '', S(c.offer_id, 64), id.dob_sealed)) || null
      await db.from('document_access_log').insert({ offer_id: S(c.offer_id, 64), doc: 'identity:dob', path: '(compared with AxisCare on the server; not shown)', by_person: who.person_id ?? null, by_email: who.email ?? null, by_name: who.name ?? null, reason: 'AxisCare app sign-up check (Send orientation information)' })
    } catch { dobWhy = 'their Step 1 birth date could not be read, so it was not compared' }
  } else dobWhy = 'no Step 1 birth date on file to compare with'
  const problems = matchProblems({ zip: addr.zip, dob: axDob }, { zip: zip5(id?.zip), dob })
  return { ok: !problems.length, found: true, axiscare_id: String(f.match.id), label: S(f.match?.status?.label, 40), zip: { axiscare: addr.zip || null, step1: zip5(id?.zip) || null, match: !!addr.zip && (!id?.zip || addr.zip === zip5(id.zip)) },
    dob: { on_axiscare: !!axDob, compared: !!dob, match: !!axDob && (!dob || axDob === dob), note: dobWhy }, problems }
}
/** the Training Platform makes them (enrolls orientation) and hands back their link; it sends nothing itself (link_only) */
async function orientationLinkOnly(c: Any, axId: string, send: typeof fetch = fetch): Promise<{ ok: true; url: string; status: string } | { ok: false; why: string }> {
  const secret = Deno.env.get('OUTREACH_SECRET') ?? ''
  if (secret.length < 32) return { ok: false, why: 'the server secret is not set' }
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000)
    const r = await send(TRAINING_JOB_OFFER, { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', 'x-outreach-secret': secret },
      body: JSON.stringify({ action: 'orientation_link', link_only: true, offer_id: S(c.offer_id, 64) || undefined, axiscare_id: axId, phone: S(c.phone, 30), email: S(c.email, 160), first: S(c.first, 60), last: S(c.last, 60) }) })
    clearTimeout(t); const j = await r.json().catch(() => ({}))
    if (r.ok && /^https:\/\//.test(S(j?.url, 400))) return { ok: true, url: S(j.url, 400), status: S(j.status, 30) }
    return { ok: false, why: S(j?.why || j?.error, 240) || 'the Training Platform answered ' + r.status }
  } catch (e) { return { ok: false, why: S((e as Error)?.message, 120) || 'could not reach the Training Platform' } }
}

/** The caregiver's DONE (link or reply): counted only at Sent; the receipt; never verification. */
async function reportDone(db: Any, p: Person, how: 'link' | 'reply' | 'office', st: Any, who: { email?: string; name?: string }, send: typeof fetch = fetch) {
  const now = new Date().toISOString(), state = stateOf(p.rec), cid = candIdOf(p), name = `${p.rec.first || ''} ${p.rec.last || ''}`.trim()
  if (state === 'verified') return { state: 'verified' as const }
  if (state === 'not_sent') {
    await raiseCard(db, { id: 'step2_early_' + cid, kind: 'step2_done_before_sent', urgency: 'today', who: name, candidate_id: cid, owner: S(st.staffing_email, 160).toLowerCase(), title: name + ' says Step 2 is done but nobody recorded sending it', detail: `A DONE arrived by ${how} before Record Viventium Step 2 Sent was pressed. Check Viventium, record Sent if it was sent, then verify.` })
    return { state: 'noted' as const }
  }
  if (state === 'reported') return { state: 'reported' as const, again: true }
  await patch(db, p, { step2_done_at: now, step2_done_by: how === 'office' ? (who.email || 'office') : 'caregiver', step2_done_how: how, step2_history: hist(p.rec, { at: now, what: 'reported', how, by: who.email || 'caregiver' }) })
  const jr = await journeyFor(db, p.rec); if (jr) await event(db, jr.j.journey_id, null, who, 'step2_reported', { how })
  let receipt: Any = { state: 'none' }
  if (how !== 'office' && jr) {
    if (st.step2_send_live !== true && !testPerson(st, p.rec)) receipt = { state: 'practice', at: now, words: receiptText(p.rec.first || 'there') }
    else { const r = await deliver(db, p.rec, { text: receiptText(p.rec.first || 'there') }, 'step2-handoff', send); receipt = { state: r.texted ? 'sent' : 'failed', at: now, why: r.not_sent.join('; ') || null } }
    await patch(db, p, { step2_receipt: receipt })
  }
  await closeCard(db, 'step2_stalled_' + cid, 'They reported Step 2 done.')
  return { state: 'reported' as const, receipt }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false, autoRefreshToken: false } })
  const url = new URL(req.url)
  const raw = await req.text()
  let b: Any = {}
  try { b = JSON.parse(raw) } catch {
    const grab = (k: string) => (raw.match(new RegExp('"' + k + '"\\s*:\\s*"([^"]*)"')) || [])[1] || ''
    b = { id: grab('id'), phone: grab('phone'), name: grab('name') }; const m = raw.match(/"message"\s*:\s*([\s\S]*)\}\s*$/); if (m) b.message = m[1].trim().replace(/^"/, '').replace(/",?$/, '').trim()
  }
  const action = S(b.action, 20)
  try {
    const st = await settings(db), now = new Date().toISOString()
    /* ── GoHighLevel: a text reply from a contact tagged step2-sent ── */
    if (url.searchParams.get('token')) {
      const want = Deno.env.get('STEP2_REPLY_TOKEN') ?? ''
      if (want.length < 20 || url.searchParams.get('token') !== want) return json({ error: 'unauthorized' }, 401)
      const field = (k: string) => { const v = typeof b[k] === 'string' ? String(b[k]).trim() : ''; return v.includes('{{') ? '' : v }
      const text = field('message') || field('body') || field('text'), ph = digits10(field('phone')), nm = field('name')
      if (!text) return json({ ok: true, routed: 'no message text, nothing to record' })
      const owner = S(st.staffing_email, 160).toLowerCase()
      if (!isDoneReply(text)) {
        await raiseCard(db, { id: 'step2_reply_' + (ph || Date.now()), kind: 'step2_reply', urgency: 'today', who: nm || ph, candidate_id: '', owner, title: (nm || 'A caregiver') + ' replied to the Step 2 text', detail: `Their words: "${S(text, 300)}". A person answers this; the Hub recorded nothing.` })
        return json({ ok: true, routed: 'review card' })
      }
      const people: Person[] = []
      if (ph) {
        for (const c of await list(db, 'candidates')) if (digits10(c?.phone) === ph && ['sent', 'reported'].includes(stateOf(c))) people.push({ key: 'candidates', rec: c, id: String(c.id) })
        for (const r of await list(db, 'caregivers')) if (r?.candidate_id != null && digits10(r?.phone) === ph && ['sent', 'reported'].includes(stateOf(r))) people.push({ key: 'caregivers', rec: r, id: String(r.id) })
      }
      if (people.length !== 1) {
        await raiseCard(db, { id: 'step2_reply_' + (ph || Date.now()), kind: 'step2_reply_review', urgency: 'today', who: nm || ph, candidate_id: '', owner, title: 'DONE reply could not be matched: ' + (nm || ph || 'unknown number'), detail: people.length ? `${people.length} people at Step 2 Sent share this phone number. Record DONE on the right one by hand; nothing was changed.` : 'No one at Step 2 Sent has this phone number (a number not on file, or someone already verified). Nothing was changed.' })
        return json({ ok: true, routed: 'review card', matched: people.length })
      }
      const r = await reportDone(db, people[0], 'reply', st, { email: 'caregiver', name: nm || 'The caregiver' })
      return json({ ok: true, routed: r.state })
    }
    /* ── the caregiver's private link ── */
    if (action === 'done') {
      const secret = Deno.env.get('HUB_JOB_SECRET') ?? ''
      if (!(await checkLink(secret, 'step2', b.c, b.e, b.t))) return json({ ok: false, error: 'This link is not valid any more. Call or text the office at (417) 234-8494 and we will sort it out.' }, 401)
      const p = await person(db, S(b.c, 12)); if (!p) return json({ ok: false, error: 'We could not find your record. Call or text the office at (417) 234-8494.' }, 404)
      const r = await reportDone(db, p, 'link', st, { email: 'caregiver', name: 'The caregiver' })
      return json({ ok: true, first: p.rec.first || '', state: r.state, practice: st.step2_send_live !== true })
    }
    /* ── the 15-minute pass ── */
    if (action === 'pass') {
      if (!(await jobCaller(req))) return json({ error: 'the pass is for the schedule or an owner' }, 401)
      const o = onb(st), hol = st.company_holidays, owner = S(st.staffing_email, 160).toLowerCase(), today = centralYmd(now)
      const out: Any = { ok: true, looked_at: 0, reminders_sent: 0, reminders_practice: 0, reminders_held: 0, reminders_retry: 0, reminders_failed: 0, invite_texts_sent: 0, cards: 0, closed: 0, live: { reminders: st.step2_reminders_live === true } }
      const all: Person[] = [...(await list(db, 'candidates')).map((c) => ({ key: 'candidates' as const, rec: c, id: String(c.id) })), ...(await list(db, 'caregivers')).filter((r) => r?.candidate_id != null).map((r) => ({ key: 'caregivers' as const, rec: r, id: String(r.id) }))]
      for (const p of all) {
        const c = p.rec, cid = candIdOf(p), state = stateOf(c), name = `${c.first || ''} ${c.last || ''}`.trim()
        /* 2026-10-21 LEAVING ONBOARDING: someone who left (or is not hired) gets no Step 2 reminder, invitation text, profile
           reminder or card */
        if (c.not_hired || c.onboarding_left) { out.skipped_left = (out.skipped_left || 0) + 1; continue }
        const jr = await journeyFor(db, c)
        if (state === 'verified') {
          for (const k of ['step2_notsent_', 'step2_verify_', 'step2_stalled_']) await closeCard(db, k + cid, 'Step 2 verified.')
          /* GO-LIVE (2026-10-13, hold rather than drop): the invitation text held after hours goes at the first pass inside
             8am to 6pm Central (like the Training Platform's held offer text); recorded only when sent or refused for good */
          const inv = c.step2_invite
          if (jr && inv && inv.text_held === true && inTextHours() && (st.wc_auto_invite_live === true || testPerson(st, c))) {
            let next: Any
            try {
              const r = await inviteVia(c, cid, 'held text', 'text', inv.welcome === true)
              next = r.ok && r.j.texted ? { ...inv, text_held: false, texted: true, text_sent_at: now }
                : r.ok && r.j.skipped ? { ...inv, text_held: false, text_skipped: r.j.skipped, text_skipped_at: now }
                : r.ok && r.j.text_held ? inv
                : r.ok && refusedForGood(r.j.not_sent || []) ? { ...inv, text_held: false, text_refused: (r.j.not_sent || []).join('; '), text_refused_at: now }
                : { ...inv, text_tries: (Number(inv.text_tries) || 0) + 1, text_last_why: r.j?.error || (r.j?.not_sent || []).join('; ') || ('answered ' + r.status) }
            } catch (e) { next = { ...inv, text_tries: (Number(inv.text_tries) || 0) + 1, text_last_why: 'could not reach welcome-call: ' + String((e as Error)?.message ?? e).slice(0, 120) } }
            if (next.text_held && Number(next.text_tries) >= REMINDER_TRIES) { next = { ...next, text_held: false, text_failed: next.text_last_why, text_failed_at: now } }
            if (next !== inv) {
              await patch(db, p, { step2_invite: next })
              await event(db, jr.j.journey_id, null, {}, next.texted && !inv.texted ? 'welcome_invite_text_sent' : next.text_held ? 'welcome_invite_text_retry' : 'welcome_invite_text_closed', { text_sent_at: next.text_sent_at || null, skipped: next.text_skipped || null, refused: next.text_refused || null, failed: next.text_failed || null })
              if (next.text_refused || next.text_failed) await raiseCard(db, { id: 'step2_invite_' + cid, kind: 'send_problem', urgency: 'today', who: name, candidate_id: cid, owner, title: 'Orientation Video Call invitation text did not go to ' + name, detail: String(next.text_refused || next.text_failed) + '.' + (inv.emailed ? ' The invitation email did go.' : ' The invitation email did not go either.') + ' Call them, or press Invite to Orientation Video Call on the Orientations tab.' })
              if (next.texted && !inv.texted) out.invite_texts_sent = (out.invite_texts_sent || 0) + 1
            }
          }
          /* 2026-10-21 PROFILE REMINDERS (stop 6): day 3 and day 6 after the welcome message, while their profile is not sent in,
             inside the reminder window; ops_settings.profile_reminders_live (off = recorded as practice, nothing sent). A
             reminder that cannot go is a card (no silent failures). */
          if (jr && inv && inv.welcome === true && ['sent', 'held'].includes(inv.state) && inv.at) {
            const days = Math.floor((Date.parse(today + 'T00:00:00Z') - Date.parse(centralYmd(inv.at) + 'T00:00:00Z')) / 86400000)
            const pr = { ...(c.profile_reminders && typeof c.profile_reminders === 'object' ? c.profile_reminders : {}) }
            const dueDay = [6, 3].find((d) => days >= d && !pr['d' + d])
            if (dueDay && inReminderWindow()) {
              const { data: pf } = await db.from('caregiver_profiles').select('id, upload_token, submitted_at, published, status').eq('candidate_id', cid).neq('status', 'withdrawn').limit(1)
              const prof = pf?.[0]
              if (prof && !prof.submitted_at && !prof.published) {
                if (dueDay === 6 && !pr.d3) pr.d3 = { at: now, passed_over: 'd6' }
                if (st.profile_reminders_live !== true && !testPerson(st, c)) { pr['d' + dueDay] = { at: now, practice: true }; out.profile_reminders_practice = (out.profile_reminders_practice || 0) + 1 }
                else {
                  const r = await deliver(db, c, profileReminderMessages(c.first || 'there', profileLink(prof.upload_token)), 'step2-handoff')
                  pr['d' + dueDay] = { at: now, texted: r.texted, emailed: r.emailed, not_sent: r.not_sent }
                  if (r.texted || r.emailed) out.profile_reminders_sent = (out.profile_reminders_sent || 0) + 1
                  else await raiseCard(db, { id: 'profile_reminder_' + cid + '_d' + dueDay, kind: 'send_problem', urgency: 'today', who: name, candidate_id: cid, owner, title: 'Profile reminder did not reach ' + name, detail: `The day ${dueDay} reminder to finish their caregiver profile could not go: ${(r.not_sent || []).join('; ') || 'no reason given'}. Give them a call.` })
                }
                await patch(db, p, { profile_reminders: pr })
                await event(db, jr.j.journey_id, null, {}, 'profile_reminder', { day: dueDay, practice: !!pr['d' + dueDay].practice })
              }
            }
          }
          continue
        }
        if (!jr && state === 'not_sent') continue
        out.looked_at++
        if (state === 'not_sent') {
          const adv = jr!.steps.find((s: Any) => s.step_key === 'cg.approve.advance')
          if (adv && DONE.includes(adv.state) && adv.completed_at) {
            const due = dueNextBusinessDay(adv.completed_at, hol, o.hour, o.sent_due_days)
            if (due < now) { await raiseCard(db, { id: 'step2_notsent_' + cid, kind: 'step2_not_sent', urgency: 'today', who: name, candidate_id: cid, owner, due, title: 'Viventium Step 2 not sent to ' + name, detail: `Approved to advance ${adv.completed_at.slice(0, 10)}; Record Viventium Step 2 Sent was due ${due.slice(0, 10)} 5pm Central. Create them in Viventium, then record it on the Orientations tab.` }); out.cards++ }
          }
          continue
        }
        await closeCard(db, 'step2_notsent_' + cid, 'Step 2 recorded sent.')
        if (state === 'sent') {
          /* reminders: day 3 and day 6 (Admin), new path only (the old path has no DONE link).
             GO-LIVE (2026-10-13, her rules: reminders Monday to Saturday 9am to 6pm Central; hold rather than drop): outside the
             window nothing is recorded, so the next pass inside it sends it; a reminder is recorded only when it went or was
             refused for good (said no to texts, opted out, nothing on file: a card); anything else is tried again on the next
             pass, three tries, then recorded as failed with a card. */
          const d = jr ? reminderDue(c, o.step2_days, today, (iso) => centralYmd(iso)) : 0
          if (d && !inReminderWindow()) out.reminders_held++
          else if (d) {
            const rem = { ...(c.step2_reminders && typeof c.step2_reminders === 'object' ? c.step2_reminders : {}) }
            for (const e of o.step2_days) if (e < d && !rem['d' + e]) rem['d' + e] = { at: now, passed_over: 'd' + d }
            const live = st.step2_reminders_live === true || testPerson(st, c)
            let recorded: Any = null
            if (!live) { recorded = rem['d' + d] = { at: now, practice: true }; out.reminders_practice++ }
            else {
              const r = await deliver(db, c, reminderMessages(c.first || 'there', await doneLink(cid)), 'step2-handoff')
              const tries = (Number(rem['d' + d + '_tries']?.n) || 0) + 1
              if (r.texted || r.emailed) { recorded = rem['d' + d] = { at: now, texted: r.texted, emailed: r.emailed, not_sent: r.not_sent }; out.reminders_sent++ }
              else if (refusedForGood(r.not_sent) || tries >= REMINDER_TRIES) {
                recorded = rem['d' + d] = { at: now, texted: false, emailed: false, not_sent: r.not_sent, ...(refusedForGood(r.not_sent) ? { refused: true } : { failed: true, tries }) }; out.reminders_failed++
                await raiseCard(db, { id: 'step2_reminder_' + cid + '_d' + d, kind: 'send_problem', urgency: 'today', who: name, candidate_id: cid, owner, title: 'Step 2 reminder did not reach ' + name, detail: `The day ${d} Step 2 reminder could not go: ${r.not_sent.join('; ') || 'no reason given'}. Call them about their Viventium tasks.` })
              } else { rem['d' + d + '_tries'] = { n: tries, last_at: now, not_sent: r.not_sent }; out.reminders_retry++ }
            }
            await patch(db, p, { step2_reminders: rem })
            if (jr && recorded) await event(db, jr.j.journey_id, null, {}, 'step2_reminder', { day: d, practice: !live, ...(recorded.refused ? { refused: true } : {}), ...(recorded.failed ? { failed: true } : {}) })
          }
          const elapsed = Math.floor((Date.parse(today + 'T00:00:00Z') - Date.parse(centralYmd(c.step2_sent_at) + 'T00:00:00Z')) / 86400000)
          if (elapsed >= STALL_DAYS) { await raiseCard(db, { id: 'step2_stalled_' + cid, kind: 'step2_stalled', urgency: 'today', who: name, candidate_id: cid, owner, title: 'Step 2 not finished: call ' + name, detail: `Step 2 was recorded sent ${centralYmd(c.step2_sent_at)} and no DONE has come in ${elapsed} days${jr ? ' (the two reminders have gone)' : ''}. Call them, then record what you learn.` }); out.cards++ }
          continue
        }
        if (state === 'reported') {
          const due = dueNextBusinessDay(c.step2_done_at, hol, o.hour, o.verify_due_days)
          if (due < now) { await raiseCard(db, { id: 'step2_verify_' + cid, kind: 'step2_verify', urgency: 'today', who: name, candidate_id: cid, owner, due, title: 'Verify Step 2 for ' + name, detail: `They reported DONE ${c.step2_done_at.slice(0, 10)} (${c.step2_done_how || 'office'}); verification was due ${due.slice(0, 10)} 5pm Central. Open Viventium, check every task, then press Verify Viventium Step 2 Complete on the Orientations tab.` }); out.cards++ }
          await closeCard(db, 'step2_stalled_' + cid, 'They reported Step 2 done.')
        }
      }
      try { await db.rpc('upsert_app_data_item', { target_key: 'automation_log', item: { id: 'auto_srv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), at: now, automation: 'step2_handoff', ran_by: 'server', ok: true, dry: st.step2_reminders_live !== true, summary: out } }) } catch { /* the log must not take the pass down */ }
      return json(out)
    }
    /* ── the office ── */
    const who = await requireStaff(db, req, OFFICE_ROLES)
    if (!who.ok) return json({ error: who.error }, who.status)
    const actor = { email: who.email, name: who.name }
    if (action === 'preview') {
      const f = S(b.first, 40) || 'there', L = '…'; const m = sentMessages(f, L), r = reminderMessages(f, L)
      /* LPN HIRING: with candidate_id, an LPN or RN hire's packet tick (the key is there only for them) */
      let np: string | null = null; if (/^\d{1,12}$/.test(S(b.candidate_id, 12))) { const pp = await person(db, S(b.candidate_id, 12)); if (pp) np = await nursePacket(db, pp.rec) }
      return json({ ok: true, sent: { text: m.text, subject: m.subject }, reminder: { text: r.text }, receipt: receiptText(f), still_open: stillOpenText(f, '{task}', L), checklist: checklist(st), switches: { send: st.step2_send_live === true, reminders: st.step2_reminders_live === true, invite: st.wc_auto_invite_live === true }, ...(np ? { nurse_packet: np } : {}) })
    }
    const cid = S(b.candidate_id, 12); if (!/^\d{1,12}$/.test(cid)) return json({ error: 'Which person?' }, 400)
    const p = await person(db, cid); if (!p) return json({ error: 'That person is not in Background & References or on the roster.' }, 404)
    /* 2026-10-21: nothing more for someone who left onboarding or is not hired (Come back first) */
    if ((p.rec.not_hired || p.rec.onboarding_left) && action !== 'undo') return json({ error: 'They left onboarding' + (p.rec.not_hired_reason ? ' (' + S(p.rec.not_hired_reason, 40) + ')' : '') + ', so nothing was sent or recorded. Bring them back first if they are returning.', left: true }, 409)
    const c = p.rec, name = `${c.first || ''} ${c.last || ''}`.trim(), state = stateOf(c), jr = await journeyFor(db, c)
    if (action === 'sent') {
      const resend = b.resend === true
      if (state === 'verified') return json({ error: 'Step 2 is already verified for ' + name + '.' }, 409)
      if (c.step2_sent_at && !resend) return json({ error: 'Step 2 Sent was already recorded for ' + name + ' (' + String(c.step2_sent_at).slice(0, 10) + ' by ' + S(c.step2_sent_by) + '). Use Resend the Step 2 message if they need it again.' }, 409)
      if (!c.step2_sent_at && resend) return json({ error: 'Record Viventium Step 2 Sent first.' }, 409)
      if (jr) { const g = await caregiverGate(db, { candidate_id: cid }, 'cg.approve.advance'); if (!g.allowed) return json({ error: g.why, gate: 'cg.approve.advance' }, 409) }
      const note = S(b.note, 200)
      const fields: Any = resend ? { step2_resent_at: now, step2_resent_by: who.email } : { step2_sent_at: now, step2_sent_by: who.email, step2_sent_note: note || null }
      fields.step2_history = hist(c, { at: now, what: resend ? 'resent' : 'sent', by: who.email, note: note || undefined })
      let msg: Any = { state: 'none' }
      if (jr) {
        const m = sentMessages(c.first || 'there', await doneLink(cid))
        if (st.step2_send_live !== true && !testPerson(st, c)) msg = { state: 'practice', at: now, text: m.text, subject: m.subject }
        else { const r = await deliver(db, c, m, 'step2-handoff'); msg = { state: r.texted || r.emailed ? 'sent' : 'failed', at: now, texted: r.texted, emailed: r.emailed, not_sent: r.not_sent } }
        fields.step2_msg = msg
      }
      if (!(await patch(db, p, fields))) return json({ error: 'Someone else changed this record at the same moment. Open it again and retry.' }, 409)
      if (jr) await event(db, jr.j.journey_id, null, actor, resend ? 'step2_resent' : 'step2_sent', { message: msg.state, note: note || null })
      await closeCard(db, 'step2_notsent_' + cid, 'Step 2 recorded sent.'); await closeCard(db, 'step2_early_' + cid, 'Step 2 recorded sent.')
      return json({ ok: true, state: stateOf(c), message: msg, new_path: !!jr })
    }
    if (action === 'reported') {
      if (state === 'not_sent') return json({ error: 'Record Viventium Step 2 Sent first.' }, 409)
      const r = await reportDone(db, p, 'office', st, actor)
      return json({ ok: true, state: stateOf(c), ...r })
    }
    if (action === 'verify') {
      if (state === 'not_sent') return json({ error: 'Record Viventium Step 2 Sent first. Verify cannot come before Sent.' }, 409)
      if (state === 'verified') return json({ error: 'Already verified for ' + name + ' (' + String(c.step2_verified_at).slice(0, 10) + ' by ' + S(c.step2_verified_by) + ').' }, 409)
      const ck = checklist(st), ticked = (Array.isArray(b.ticked) ? b.ticked : []).map((x: unknown) => S(x, 200)).filter((x: string) => ck.items.includes(x))
      const i9s2 = b.i9_section2 === true, note = S(b.note, 300)
      /* LPN HIRING: the packet tick counts only for an LPN or RN hire (refused for anyone else, nothing recorded) */
      const np = b.nurse_packet === true ? await nursePacket(db, c) : null
      if (b.nurse_packet === true && !np) return json({ error: 'The LPN packet tick is only for an LPN or RN hire. Nothing was recorded.' }, 400)
      if (!ticked.length && !i9s2 && !np) return json({ error: 'Tick what you checked in Viventium. Nothing was recorded.' }, 400)
      const list_ = ck.items.map((t: string) => ({ text: t, ticked: ticked.includes(t) }))
      if (np) list_.push({ text: np, ticked: true, nurse_packet: true } as Any)
      const fields: Any = { step2_verified_at: now, step2_verified_by: who.email, step2_checklist: { version: ck.version, items: list_, by: who.email, name: who.name, at: now }, step2_note: note || null, step2_history: hist(c, { at: now, what: 'verified', by: who.email, ticked: ticked.length, i9_section2: i9s2 }) }
      if (i9s2) { fields.step2_i9_s2_by = who.email; fields.step2_i9_s2_at = now }
      const confirmed: string[] = []
      if (jr) {
        const keys = new Set<string>(); for (const t of ticked) { const k = rowFor(t); if (k) keys.add(k) }
        /* 2026-10-13 (her ruling, 19 CSR 15-7.021(24)(B)5): participant rights completes only from the Step 1 Client Rights signature
           AND the explanation recorded at the Orientation Video Call, never from a Viventium tick */
        keys.delete('cg.step2.participant_rights')
        if (i9s2) keys.add('cg.i9.section2')
        if (np) keys.add('cg.step2.position_description')
        for (const k of keys) {
          const cur = jr.steps.find((s: Any) => s.step_key === k); if (cur && DONE.includes(cur.state)) continue
          await putStep(db, jr.j.journey_id, k, { state: 'complete', evidence: { confirmed: { by: who.email, name: who.name, at: now, list: 'office', via: 'step2 verify', checklist_version: ck.version } }, completed_by: who.email, completed_by_name: who.name, completed_at: now, blocked_reason: null })
          await event(db, jr.j.journey_id, k, actor, 'confirmed', { list: 'office', via: 'step2 verify' }); confirmed.push(k)
        }
        await event(db, jr.j.journey_id, null, actor, 'step2_verified', { ticked, i9_section2: i9s2, confirmed, note: note || null, ...(np ? { nurse_packet: np } : {}) })
      }
      let invite: Any = { state: 'none' }
      /* IN TRAINING PLAN v2, PART B (2026-10-22): with orientation_button_live, nothing is sent at Verify. The Staffing Coordinator
         gets the "Add to AxisCare as In Training" card and sends with Send orientation information. */
      if (jr && st.orientation_button_live === true) {
        invite = { state: 'button', at: now, why: 'Add them to AxisCare as In Training, then press Send orientation information.' }
        await raiseCard(db, { id: 'step2_axsetup_' + cid, kind: 'axiscare_setup', urgency: 'today', who: name, candidate_id: cid, owner: S(st.staffing_email, 160).toLowerCase(),
          title: 'Add ' + name + ' to AxisCare as In Training, then send their orientation information',
          detail: `Step 2 is checked. Open their onboarding card: type the details shown (name, phone, email, address with zip code, birth date) into AxisCare and set their status to In Training. Then press Send orientation information. The Hub checks the zip code and birth date match first, because the AxisCare app sign-up needs them to.`,
          due: dueNextBusinessDay(now, st.company_holidays, onb(st).hour, 1) })
      } else if (jr) {
        if (st.wc_auto_invite_live !== true && !testPerson(st, c)) { invite = { state: 'practice', at: now, why: 'wc_auto_invite_live is off: the invitation was not sent; press Invite to Orientation Video Call yourself' } }
        else {
          try {
            /* 2026-10-21 stop 5: the ONE welcome message (booking, profile, orientation, badge) with welcome_message_live */
            const welcomeOn = st.welcome_message_live === true || testPerson(st, c)
            const r = await inviteVia(c, cid, who.name || who.email, undefined, welcomeOn)
            const j = r.j
            /* GO-LIVE (2026-10-13): a text held after hours is not a failure: the pass sends it at the first chance inside hours */
            invite = r.ok ? { state: j.texted || j.emailed ? 'sent' : j.text_held ? 'held' : 'failed', at: now, texted: !!j.texted, emailed: !!j.emailed, not_sent: j.not_sent || [], id: j.id || null, ...(j.text_held ? { text_held: true } : {}), ...(j.welcome ? { welcome: true, profile_id: j.profile_id || null } : {}) } : { state: 'failed', at: now, why: j?.error || ('Orientation Video Call answered ' + r.status) }
          } catch (e) { invite = { state: 'failed', at: now, why: 'could not reach welcome-call: ' + String((e as Error)?.message ?? e).slice(0, 120) } }
        }
        fields.step2_invite = invite
        await event(db, jr.j.journey_id, null, actor, 'welcome_invite_' + invite.state, invite)
        if (invite.state === 'failed') await raiseCard(db, { id: 'step2_invite_' + cid, kind: 'send_problem', urgency: 'today', who: name, candidate_id: cid, owner: S(st.staffing_email, 160).toLowerCase(), title: 'Orientation Video Call invitation did not go to ' + name, detail: String(invite.why || (invite.not_sent || []).join('; ') || 'refused') + '. Press Invite to Orientation Video Call on the Orientations tab.' })
      }
      if (!(await patch(db, p, fields))) return json({ error: 'Someone else changed this record at the same moment. Open it again and retry.' }, 409)
      for (const k of ['step2_notsent_', 'step2_verify_', 'step2_stalled_', 'step2_early_']) await closeCard(db, k + cid, 'Step 2 verified.')
      return json({ ok: true, state: 'verified', confirmed, invite, new_path: !!jr })
    }
    if (action === 'axis_sheet') {
      if (state !== 'verified') return json({ error: 'Check Step 2 first. The AxisCare setup comes after Step 2 is checked.' }, 409)
      const id = await step1Id(db, S(c.offer_id, 64))
      const out: Any = { ok: true, name, first: S(c.first, 60), last: S(c.last, 60), phone: S(c.phone, 30), email: S(c.email, 160), offer_id: S(c.offer_id, 64) || null,
        address: id && !id.purged_at ? { address1: S(id.address1, 120), address2: S(id.address2, 120), city: S(id.city, 60), state: S(id.state, 4), zip: S(id.zip, 12) } : null,
        has_dob: !!(id?.dob_sealed && !id?.purged_at), sent: c.step2_invite?.orientation ? c.step2_invite : null, switch_live: st.orientation_button_live === true }
      if (b.check === true) out.check = await axisCheck(db, c, who)
      return json(out)
    }
    if (action === 'send_orientation') {
      if (state !== 'verified') return json({ error: 'Check Step 2 first. Nothing was sent.' }, 409)
      if (!jr) return json({ error: 'This is for people on the new onboarding path (they have a readiness card). Nothing was sent.' }, 409)
      const chk = await axisCheck(db, c, who)
      if (!chk.ok) return json({ error: 'Not sent yet. ' + chk.problems.join(' '), check: chk }, 409)
      const link = await orientationLinkOnly(c, chk.axiscare_id)
      if (!link.ok) return json({ error: 'Not sent: the Training Platform did not give their orientation link (' + link.why + '). Try again in a minute.', check: chk }, 502)
      let invite: Any
      try {
        const r = await inviteVia(c, cid, who.name || who.email, undefined, true, link.url)
        const j = r.j
        invite = r.ok ? { state: j.texted || j.emailed ? 'sent' : j.text_held ? 'held' : 'failed', at: now, by: who.email, texted: !!j.texted, emailed: !!j.emailed, not_sent: j.not_sent || [], id: j.id || null, ...(j.text_held ? { text_held: true } : {}), welcome: true, profile_id: j.profile_id || null }
          : { state: 'failed', at: now, by: who.email, why: j?.error || ('the welcome message answered ' + r.status) }
      } catch (e) { invite = { state: 'failed', at: now, by: who.email, why: 'could not reach welcome-call: ' + String((e as Error)?.message ?? e).slice(0, 120) } }
      invite.orientation = { url_sent: invite.state !== 'failed', training: link.status, axiscare_id: chk.axiscare_id, at: now }
      const again = !!c.step2_invite?.orientation
      await patch(db, p, { step2_invite: invite, step2_history: hist(c, { at: now, what: again ? 'orientation_sent_again' : 'orientation_sent', by: who.email, state: invite.state }) })
      await event(db, jr.j.journey_id, null, actor, 'orientation_info_' + invite.state, { again, axiscare_id: chk.axiscare_id, texted: !!invite.texted, emailed: !!invite.emailed, not_sent: invite.not_sent || [] })
      if (invite.state === 'failed') await raiseCard(db, { id: 'step2_invite_' + cid, kind: 'send_problem', urgency: 'today', who: name, candidate_id: cid, owner: S(st.staffing_email, 160).toLowerCase(), title: 'Orientation information did not go to ' + name, detail: String(invite.why || (invite.not_sent || []).join('; ') || 'refused') + '. Open their onboarding card and press Send again.' })
      else await closeCard(db, 'step2_axsetup_' + cid, 'Orientation information sent.')
      return json({ ok: invite.state !== 'failed', invite, check: chk, again })
    }
    if (action === 'still_open') {
      const task = S(b.task, 120); if (!task) return json({ error: 'Which task is still open?' }, 400)
      if (!jr) return json({ error: 'The still-open message goes only to people on the new onboarding path (they have the DONE link). Call ' + name + ' instead.' }, 409)
      if (state === 'not_sent' || state === 'verified') return json({ error: 'That message is for someone who reported DONE while a task is still open.' }, 409)
      const text = stillOpenText(c.first || 'there', task, b.preview === true ? '…' : await doneLink(cid))
      if (b.preview === true) return json({ ok: true, preview: text })
      const r = await deliver(db, c, { text }, 'step2-handoff')
      await patch(db, p, { step2_still_open_at: now, step2_still_open_by: who.email, step2_still_open_task: task, step2_history: hist(c, { at: now, what: 'still_open', by: who.email, task, texted: r.texted }) })
      await event(db, jr.j.journey_id, null, actor, 'step2_still_open', { task, texted: r.texted, not_sent: r.not_sent })
      return json({ ok: true, texted: r.texted, not_sent: r.not_sent })
    }
    if (action === 'undo') {
      const which = S(b.which, 12), reason = S(b.reason, 300)
      if (!['sent', 'reported', 'verified'].includes(which)) return json({ error: 'Undo what?' }, 400)
      if (reason.length < 5) return json({ error: 'Please give the reason (at least five characters). Nothing was changed.' }, 400)
      const fields: Any = { step2_history: hist(c, { at: now, what: 'undo_' + which, by: who.email, reason }) }
      if (which === 'verified') { if (!c.step2_verified_at) return json({ error: 'Nothing to undo.' }, 409); Object.assign(fields, { step2_verified_at: null, step2_verified_by: null, step2_i9_s2_by: null, step2_i9_s2_at: null }) }
      if (which === 'reported') { if (!c.step2_done_at) return json({ error: 'Nothing to undo.' }, 409); if (c.step2_verified_at) return json({ error: 'Undo the verification first.' }, 409); Object.assign(fields, { step2_done_at: null, step2_done_by: null, step2_done_how: null }) }
      if (which === 'sent') { if (!c.step2_sent_at) return json({ error: 'Nothing to undo.' }, 409); if (c.step2_done_at || c.step2_verified_at) return json({ error: 'Undo the later steps first.' }, 409); Object.assign(fields, { step2_sent_at: null, step2_sent_by: null, step2_resent_at: null, step2_resent_by: null }) }
      if (!(await patch(db, p, fields))) return json({ error: 'Someone else changed this record at the same moment. Open it again and retry.' }, 409)
      if (jr) {
        if (which === 'verified') for (const s of jr.steps) if (s.evidence?.confirmed?.via === 'step2 verify' && s.state === 'complete') { await putStep(db, jr.j.journey_id, s.step_key, { state: 'open', completed_by: null, completed_by_name: null, completed_at: null, evidence: { ...(s.evidence || {}), unconfirmed: { by: who.email, at: now, reason } } }); await event(db, jr.j.journey_id, s.step_key, actor, 'unconfirmed', { via: 'step2 undo' }, reason) }
        await event(db, jr.j.journey_id, null, actor, 'step2_undo', { which }, reason)
      }
      return json({ ok: true, state: stateOf(c) })
    }
    return json({ error: 'Unknown action.' }, 400)
  } catch (e) {
    return json({ error: 'Something went wrong: ' + ((e as Error).message || 'error') + '. Nothing was changed.' }, 500)
  }
})
