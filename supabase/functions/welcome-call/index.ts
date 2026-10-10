// =============================================================================
// welcome-call — remote orientation welcome calls (Desktop 407, 2026-10-01). Office staff only.
// =============================================================================
// Samantha: the office presses "Invite to welcome call" once references and background checks are clear and
// Viventium Step 2 is done; the new hire books a 15-minute Google Meet call (one shared room); if Step 2 turns out
// not to be done, "let the new employee know that we will have to reschedule until they can get their step two
// documents done".
//
//   action 'preview'    {first}                                  -> the exact invite text and email (nothing sent)
//   action 'invite'     {candidate_id, first, last, phone, email} -> opens (or reuses) their invitation and sends it
//   action 'reschedule' {id, reason: 'step2' | 'other'}          -> frees the time, keeps the invitation open, tells them
//   action 'noshow'     {id}                                     -> marks it missed, frees the time, sends a rebook link
//   action 'now'        {id}                                     -> "we have an opening right now": invites them to
//                                                                   join the Meet room in the next 10 minutes. Their
//                                                                   booking (if any) is left alone, so if they cannot
//                                                                   join nothing changes. (Samantha: an interview
//                                                                   no-show frees a coordinator; offer the time.)
//   action 'done'       {id}                                     -> marks the call done (who, when) and frees any
//                                                                   later time they still had booked
// The WORDING is fixed here; the caller never supplies message text. Texts go 8am-6pm Central only, never to someone
// whose application said no to texts, and end "Reply STOP to opt out."; emails go any time. Every message goes
// through GoHighLevel (shows in Conversations) via the universal opt-out door; a refusal raises a card.
// Confirmations and reminders are sent by interview-messages (every 15 minutes).
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { caregiverGate } from '../_shared/caregiver-journey.ts'   /* SLICE 3b */
import { ghlContactIfAllowed } from '../_shared/optout.ts'
import { ghlSendChecked } from '../_shared/send-problems.ts'
import { latestTextConsent, inTextHours, withStop } from '../_shared/text-consent.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const esc = (s: string) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const clean = (v: unknown, n = 80) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n)
const OFFICE = '(417) 234-8494'
export const bookLink = (id: string) => 'https://cc.mo-care.com/welcome.html?w=' + encodeURIComponent(id)
const TZ = 'America/Chicago'
const fmtDay = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: TZ })
const fmtTime = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ })
const shell = (body: string) => `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1f2a36">${body}` +
  `<p style="color:#57606a">Caring Companions In-Home Senior Care<br>${OFFICE}</p></div>`
const btn = (href: string, label: string) => `<p><a href="${href}" style="background:#F0A63A;color:#122F52;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700;display:inline-block">${label}</a></p>`

/* 2026-10-01 Samantha: the invite must say the call is how they get set up to do their orientation from their phone or computer.
   Her words, kept in one place so the Hub preview and the send can never differ. */
export function inviteMessages(first: string, link: string) {
  return {
    text: withStop(`Hi ${first}, great news from Caring Companions! Your background check and references are complete. ` +
      `Next step: a quick 15-minute welcome video call where we show you how to complete your paid orientation from your phone or computer. ` +
      `Book a time here: ${link}`),
    subject: 'Book your welcome call with Caring Companions',
    html: shell(`<p>Hi ${esc(first)},</p><p>Great news! Your background check and references are complete, and you are almost ready to start.</p>` +
      `<p><b>Next step: a quick 15-minute welcome video call</b> with our office. On the call we will show you how to complete your paid orientation ` +
      `from your phone or computer, so you can do it from home. Pick a time that suits you:</p>${btn(link, 'Book my welcome call')}` +
      `<p>We will also check your ID for your employment paperwork, help you set up the AxisCare app, and go over your caregiver profile together. ` +
      `Please have the <b>original ID documents</b> you uploaded in Viventium with you. You can join from your phone, no app needed.</p>`),
  }
}
export function rescheduleMessages(first: string, link: string, when: string, step2: boolean) {
  return step2 ? {
    text: withStop(`Hi ${first}, your Viventium Step 2 paperwork needs to be finished before your welcome call, so we have moved your ${when} call. ` +
      `Please finish Step 2 (look for the email from Viventium), then pick a new time here: ${link} Questions? Call ${OFFICE}.`),
    subject: 'Please finish your Viventium Step 2, then pick a new time',
    html: shell(`<p>Hi ${esc(first)},</p><p>Your <b>Viventium Step 2</b> paperwork needs to be finished before your welcome call, so we have moved your ${esc(when)} call.</p>` +
      `<p>Look for the email from Viventium and finish Step 2. Once it is done, pick a new time here:</p>${btn(link, 'Pick a new time')}`),
  } : {
    text: withStop(`Hi ${first}, we need to move your ${when} welcome call with Caring Companions. Please pick a new time here: ${link} Sorry for the change! Questions? Call ${OFFICE}.`),
    subject: 'Please pick a new time for your welcome call',
    html: shell(`<p>Hi ${esc(first)},</p><p>We need to move your ${esc(when)} welcome call. Sorry for the change! Please pick a new time here:</p>${btn(link, 'Pick a new time')}`),
  }
}
export function nowMessages(first: string, meet: string, link: string, booked: boolean) {
  const after = booked ? 'If now does not work, no problem, your booked time stays the same.' : `If now does not work, no problem, pick a time here: ${link}`
  return {
    text: withStop(`Hi ${first}, it's Caring Companions. We have an opening right now for your 15-minute welcome video call. ` +
      `If you can join in the next 10 minutes, tap here: ${meet} Please have your original ID documents with you. ${after}`),
    subject: 'We have an opening right now for your welcome call',
    html: shell(`<p>Hi ${esc(first)},</p><p>We have an opening <b>right now</b> for your 15-minute welcome video call. If you can join in the next 10 minutes, tap here:</p>` +
      btn(meet, 'Join the video call now') + `<p>Please have the original ID documents you uploaded in Viventium with you.</p><p>${esc(after)}</p>`),
  }
}
export function noshowMessages(first: string, link: string) {
  return {
    text: withStop(`Hi ${first}, we missed you at your welcome video call with Caring Companions. No problem, pick a new time here: ${link} Questions? Call ${OFFICE}.`),
    subject: 'We missed you at your welcome call',
    html: shell(`<p>Hi ${esc(first)},</p><p>We missed you at your welcome video call. No problem, pick a new time that suits you:</p>${btn(link, 'Pick a new time')}`),
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const who = await requireStaff(db, req, OFFICE_ROLES)
  if (!who.ok) return json({ error: who.error }, who.status)
  // deno-lint-ignore no-explicit-any
  const b: any = await req.json().catch(() => ({}))
  const action = String(b.action || 'preview')
  const staff = who.name || who.email

  if (action === 'preview') return json({ ok: true, ...inviteMessages(clean(b.first, 40) || 'there', bookLink('…')) })

  const ghl = { token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
  const H = { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' }
  /* text (hours + their yes to texts) and email, each through the opt-out door; returns what went and what did not */
  // deno-lint-ignore no-explicit-any
  async function deliver(w: any, m: { text: string; subject: string; html: string }) {
    const notSent: string[] = []; let texted = false, emailed = false
    const name = [w.first_name, w.last_name].filter(Boolean).join(' ')
    if (!ghl.token || !ghl.locationId) return { texted, emailed, not_sent: ['texting is not set up on the server'] }
    if (w.phone) {
      const c = await latestTextConsent(db, w.phone)
      if (!inTextHours()) notSent.push('text: texts go 8am to 6pm Central (the email still went)')
      else if (!c.ok) notSent.push('text: ' + c.why)
      else {
        const id = await ghlContactIfAllowed(db, ghl, 'welcome-call', { channel: 'sms', phone: w.phone, email: w.email, firstName: w.first_name, lastName: w.last_name })
        if (!id) notSent.push('text: they opted out, or the number could not be confirmed')
        else if (!(texted = await ghlSendChecked(db, H, 'welcome-call', { channel: 'sms', contactId: id, address: w.phone, who: name }, { message: m.text })))
          notSent.push('text: GoHighLevel did not accept it (a card is on Needs Attention)')
      }
    }
    if (w.email) {
      const id = await ghlContactIfAllowed(db, ghl, 'welcome-call', { channel: 'email', email: w.email, phone: w.phone, firstName: w.first_name, lastName: w.last_name })
      if (!id) notSent.push('email: they opted out, or the address could not be confirmed')
      else if (!(emailed = await ghlSendChecked(db, H, 'welcome-call', { channel: 'email', contactId: id, address: w.email, who: name }, { subject: m.subject, html: m.html })))
        notSent.push('email: GoHighLevel did not accept it (a card is on Needs Attention)')
    }
    if (!w.phone && !w.email) notSent.push('no phone number or email on file')
    return { texted, emailed, not_sent: notSent }
  }

  if (action === 'invite') {
    const cand = clean(b.candidate_id, 40)
    if (!cand) return json({ error: 'which candidate?' }, 400)
    const row = { first_name: clean(b.first, 40), last_name: clean(b.last, 60), phone: clean(b.phone, 30) || null, email: clean(b.email, 120).toLowerCase() || null }
    if (!row.phone && !row.email) return json({ error: 'They need a phone number or an email first.' }, 400)
    /* SLICE 3b: on the new path the welcome call waits for Approve to Advance (the old path has no card and is untouched) */
    const gate = await caregiverGate(db, { candidate_id: cand }, 'cg.approve.advance')
    if (!gate.allowed) return json({ error: gate.why, gate: 'cg.approve.advance' }, 409)
    const { data: open } = await db.from('welcome_calls').select('*').eq('candidate_id', cand).in('status', ['invited', 'booked', 'noshow']).order('invited_at', { ascending: false }).limit(1)
    let w = open?.[0]
    if (w) { await db.from('welcome_calls').update({ ...row, updated_at: new Date().toISOString() }).eq('id', w.id); w = { ...w, ...row } }
    else {
      const { data, error } = await db.from('welcome_calls').insert({ candidate_id: cand, ...row, invited_by: staff }).select('*').single()
      if (error) return json({ error: error.message }, 500)
      w = data
    }
    const sent = await deliver(w, inviteMessages(w.first_name || 'there', bookLink(w.id)))
    return json({ ok: true, id: w.id, link: bookLink(w.id), reused: !!open?.length, ...sent })
  }

  const id = String(b.id || '')
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'which call?' }, 400)
  const { data: w } = await db.from('welcome_calls').select('*').eq('id', id).maybeSingle()
  if (!w) return json({ error: 'That welcome call was not found.' }, 404)
  const now = new Date().toISOString()
  const when = w.starts_at ? `${fmtDay(new Date(w.starts_at))} at ${fmtTime(new Date(w.starts_at))}` : 'welcome'
  const free = () => db.from('coordinator_busy').delete().eq('source', 'welcome_call').eq('source_id', id)

  if (action === 'done') {
    await db.from('welcome_calls').update({ status: 'done', done_at: now, done_by: staff, updated_at: now }).eq('id', id)
    await free()                                   // a later time they still held goes back on offer
    return json({ ok: true, done: true })
  }
  if (action === 'now') {
    if (!['invited', 'booked', 'noshow'].includes(w.status)) return json({ error: 'That invitation is closed.' }, 409)
    /* one shared Meet room: not while another welcome call is booked in the next 15 minutes */
    const soon = new Date(Date.now() + 15 * 60_000).toISOString()
    const { data: clash } = await db.from('coordinator_busy').select('source_id').eq('source', 'welcome_call')
      .lt('starts_at', soon).gt('ends_at', now).neq('source_id', id).limit(1)
    if (clash?.length) return json({ error: 'Another welcome call is booked in the shared room right now. Try again after it.' }, 409)
    const { data: set } = await db.from('scheduling_settings').select('welcome_meet_url').eq('id', 1).maybeSingle()
    const meet = String(set?.welcome_meet_url || 'https://meet.google.com/yqj-nzuo-tgp')
    return json({ ok: true, meet, ...(await deliver(w, nowMessages(w.first_name || 'there', meet, bookLink(id), w.status === 'booked'))) })
  }
  if (action === 'reschedule') {
    const step2 = b.reason === 'step2'
    await db.from('welcome_calls').update({ status: 'invited', starts_at: null, ends_at: null, closed_reason: step2 ? 'Step 2 not done' : 'moved by the office', updated_at: now }).eq('id', id)
    await free()
    return json({ ok: true, ...(await deliver(w, rescheduleMessages(w.first_name || 'there', bookLink(id), when, step2))) })
  }
  if (action === 'noshow') {
    await db.from('welcome_calls').update({ status: 'noshow', starts_at: null, ends_at: null, closed_reason: 'missed the call', updated_at: now }).eq('id', id)
    await free()
    return json({ ok: true, ...(await deliver(w, noshowMessages(w.first_name || 'there', bookLink(id)))) })
  }
  return json({ error: 'unknown action' }, 400)
})
