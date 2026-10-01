// Supabase Edge Function: send-candidate-message (shared hub project)
// -----------------------------------------------------------------------------
// Texts a job candidate from the agency's GoHighLevel number. Moved into this repo from the archived Onboarding folder
// on 2026-09-27 (security slice), because the deployed version texted ANY {phone, message} for ANY caller, and the
// public orientation booking page calls it with the public key: an open SMS relay as Caring Companions.
//
// Two doors, and nothing else gets through:
//   1. STAFF: a signed-in Caring Companions office staff member (owner_admin, care_coordinator, staffing_coordinator)
//      may send a message they wrote: { first, last, phone, message } (the Staffing Hub's invites and courtesy texts).
//      { auth_check: true } answers whether the caller is authorized and sends nothing.
//   2. PUBLIC BOOKING CONFIRMATION: the booking page may ask for ONE fixed "you're booked" text:
//      { kind: 'orientation_confirmation', phone, session_id, first }. No wording is accepted from the page. It is sent
//      only when a real orient_bookings row for that phone and session was saved in the last 15 minutes, the session
//      is real and upcoming in the Hub's own schedule (app_data orient_sessions), no confirmation went to that booking
//      yet, and none went to that phone in the last 24 hours. The text is built here from the Hub's session record.
// Every text goes through the universal opt-out check (GHL Do Not Disturb, the Hub's opt-out record, inquiry
// do-not-contact, Family Circle stops). Deploy with JWT verification ON (the page carries the anon key).
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { ghlContactIfAllowed, normPhone } from '../_shared/optout.ts'
import { reportSendProblem } from '../_shared/send-problems.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const ADDR = '1331 N Stewart Ave Ste B, Springfield MO 65802'
const CONFIRM_WINDOW_MIN = 15
const PER_PHONE_HOURS = 24

const fmtTime = (t: string) => {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}
const fmtDateLong = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US',
  { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const ghlToken = Deno.env.get('GHL_API_KEY') ?? Deno.env.get('GHL_TOKEN') ?? ''
  const ghlLocation = Deno.env.get('GHL_LOCATION_ID') ?? ''
  // deno-lint-ignore no-explicit-any
  let b: Record<string, any> = {}
  try { b = await req.json() } catch { return json({ error: 'bad payload' }, 400) }

  /* NO SILENT FAILURES (2026-10-01): `card` is set for the public booking confirmation, which nobody in the office
     watches: a refused or unreachable send there raises a Needs Attention card. A staff send answers the person who
     pressed Send with the reason instead (an error, never success). Opt-out holds already raise their own card. */
  const sendSms = async (sender: string, phone: unknown, first: string, message: string, card?: { who?: string }) => {
    const problem = async (why: string) => {
      if (card) await reportSendProblem(db, { sender, channel: 'sms', address: phone, who: card.who || first, reasons: [why], failed: true })
    }
    if (!ghlToken || !ghlLocation) { await problem('GoHighLevel is not configured on the server'); return { ok: false, error: 'GoHighLevel is not configured.' } }
    const cid = await ghlContactIfAllowed(db, { token: ghlToken, locationId: ghlLocation }, sender, { channel: 'sms', phone, firstName: first })
    if (!cid) return { ok: false, error: 'Not sent: this number has opted out of texts, or we could not confirm it may be texted.' }
    try {
      const r = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
        method: 'POST', headers: { Authorization: `Bearer ${ghlToken}`, Version: '2021-04-15', 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ type: 'SMS', contactId: cid, message }),
      })
      const sb = await r.json().catch(() => ({}))
      if (r.ok) return { ok: true, contact_id: cid, message_id: sb?.messageId || sb?.msg || null }
      await problem(`error ${r.status}${sb?.message ? ': ' + String(sb.message).slice(0, 100) : ''}`)
      return { ok: false, error: `GoHighLevel message send failed (${r.status})` }
    } catch (e) {
      await problem('GoHighLevel could not be reached: ' + String((e as Error)?.message ?? e).slice(0, 80))
      return { ok: false, error: 'GoHighLevel could not be reached. Nothing was sent.' }
    }
  }

  /* ── door 2: the public booking confirmation (fixed wording, a real booking only) ── */
  if (b.kind === 'orientation_confirmation') {
    const phone = normPhone(b.phone)
    const sessionId = String(b.session_id ?? '').trim()
    if (!phone || !sessionId) return json({ error: 'phone and session are required' }, 400)
    const last10 = phone.slice(-10)
    const since = new Date(Date.now() - CONFIRM_WINDOW_MIN * 60000).toISOString()
    const { data: rows, error } = await db.from('orient_bookings').select('*').eq('session_id', sessionId).gte('booked_at', since)
    if (error) return json({ error: 'could not check the booking' }, 500)
    // deno-lint-ignore no-explicit-any
    const booking = (rows ?? []).find((r: any) => String(r.phone || '').replace(/\D/g, '').slice(-10) === last10 && !r.confirm_sms_at)
    if (!booking) return json({ error: 'no matching booking' }, 404)
    const dayAgo = new Date(Date.now() - PER_PHONE_HOURS * 3600e3).toISOString()
    const { data: recent } = await db.from('orient_bookings').select('phone, confirm_sms_at').gte('confirm_sms_at', dayAgo)
    // deno-lint-ignore no-explicit-any
    if ((recent ?? []).some((r: any) => String(r.phone || '').replace(/\D/g, '').slice(-10) === last10))
      return json({ ok: true, sent: false, reason: 'a confirmation already went to this number today' })
    const { data: st } = await db.from('app_data').select('data').eq('key', 'orient_sessions').maybeSingle()
    // deno-lint-ignore no-explicit-any
    const s = (Array.isArray(st?.data) ? st!.data : []).find((x: any) => String(x?.id) === sessionId)
    if (!s || !s.date || new Date(String(s.date) + 'T23:59:59-06:00').getTime() < Date.now()) return json({ error: 'no such upcoming session' }, 404)
    const first = String(booking.first || '').trim() || 'there'
    const remote = s.is_remote === 'yes' || s.is_remote === true
    const where = remote ? `This is a video call${s.video_link ? ': ' + s.video_link : ' — we will send you the link'}.` : `Location: ${ADDR}.`
    const message = `You're all set, ${first}! 🎉 Your Caring Companions orientation is ${fmtDateLong(String(s.date))} at ${fmtTime(String(s.time || ''))}. ${where} ` +
      `Please bring your photo ID, Social Security card, and a voided check or bank info for direct deposit. Questions? Call/text (417) 234-8494.`
    const out = await sendSms('send-candidate-message (booking confirmation)', booking.phone, first, message,
      { who: [booking.first, booking.last].map((v) => String(v ?? '').trim()).filter(Boolean).join(' ') })
    if (out.ok) await db.from('orient_bookings').update({ confirm_sms_at: new Date().toISOString() }).eq('id', booking.id)
    return json(out.ok ? { success: true, sent: true } : { ok: true, sent: false })   // the public page never learns why
  }

  /* ── door 1: signed-in office staff, their own wording ── */
  const who = await requireStaff(db, req, OFFICE_ROLES)
  if (!who.ok) return json({ error: who.error }, who.status)
  if (b.auth_check === true) return json({ ok: true, authorized: true, roles: who.roles })
  const { first, phone, message } = b
  if (!message || !phone) return json({ error: 'Missing required fields: phone and message' }, 400)
  if (!normPhone(phone)) return json({ error: `Phone number "${phone}" is not a valid 10-digit US number` }, 400)
  const out = await sendSms('send-candidate-message', phone, String(first || ''), String(message))
  return json(out.ok ? { success: true, contact_id: out.contact_id, message_id: out.message_id } : { error: out.error })
})
