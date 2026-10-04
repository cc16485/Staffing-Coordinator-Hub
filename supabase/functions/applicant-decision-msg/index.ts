// =============================================================================
// applicant-decision-msg · a kind word when an applicant is marked "Not hiring" or "Candidate pool" (445, 2026-10-04)
// =============================================================================
// Samantha approved the plan "Private applicant links, and two loose ends" ("yes to all", 2026-10-04,
// https://claude.ai/artifact/MQgrEVdZ8Kr65LBLsha1Aq), decision 3: when the office marks someone Not hiring or Candidate
// pool they hear nothing today and may keep calling or waiting. A short, kind message closes the loop, sent only when a
// person presses the button, within texting hours, with STOP, through GoHighLevel (so it shows in Conversations).
//
//   • Signed-in office staff only (requireStaff). The public key gets nothing.
//   • The WORDING is fixed here. The caller never supplies message text, and the reason we gave in the Hub is never sent.
//   • action 'preview' {id, kind}: the exact message for that applicant and how it would go (text or email).
//   • action 'send'    {id, kind}: sends it ONCE per decision (decision_msg_at + decision_msg_kind). They must already be
//     marked that way (status = kind). A text needs their yes to texts on the application; without it (or without a
//     phone) the email goes instead, if we have one.
//   • action 'skip'    {id}: "don't send it" for a message that was waiting for texting hours.
//   • 8am to 6pm Central (reactive_external). Outside that nothing goes; decision_msg_held_at is stamped so the profile
//     offers "Send the message" after 8am. A message GoHighLevel refuses raises a "Didn't go through" card.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { contactForOutbound, maySend } from '../_shared/outreach.ts'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { ghlSendChecked } from '../_shared/send-problems.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const OFFICE = '417-234-8494'
/* "send-candidate-message" is the office's existing name for a message to a candidate, so a refused one lands on the
   hiring owner's Needs Attention list as "message to a candidate"; the bracket is never shown on a card. */
const SENDER = 'send-candidate-message (applicant decision)'

export type Kind = 'declined' | 'pool'
/* The plan's wording (approved 2026-10-04). */
export const BODY: Record<Kind, (first: string) => string> = {
  declined: (f) => `Hi ${f}, thank you for applying with Caring Companions and for your time. We've decided not to move forward right now. We wish you the very best.`,
  pool: (f) => `Hi ${f}, thank you for applying with Caring Companions. We don't have the right opening for you today, but we've kept your application and will reach out when one comes up.`,
}
export const decisionText = (k: Kind, first: string) => BODY[k](first) + ' Reply STOP to opt out.'
export const DECISION_SUBJECT = 'Your application with Caring Companions'
export const decisionHtml = (k: Kind, first: string) =>
  `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1f2a36">` +
  `<p>${escHtml(BODY[k](first))}</p>` +
  `<p>Caring Companions In-Home Senior Care<br>${OFFICE}</p></div>`
export const LABEL: Record<Kind, string> = { declined: 'not-hiring message', pool: 'candidate pool message' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const who = await requireStaff(db, req, OFFICE_ROLES)
  if (!who.ok) return json({ error: who.error }, who.status)

  // deno-lint-ignore no-explicit-any
  const b: any = await req.json().catch(() => ({}))
  const action = String(b.action || 'preview')
  const id = String(b.id || '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'which applicant?' }, 400)
  const { data: a, error: aErr } = await db.from('job_applicants')
    .select('id, first_name, last_name, phone, email, sms_consent, status, decision_msg_at, decision_msg_kind, decision_msg_held_at').eq('id', id).maybeSingle()
  if (aErr) return json({ error: aErr.message }, 500)
  if (!a) return json({ error: 'That applicant was not found.' }, 404)

  if (action === 'skip') {
    const { error } = await db.from('job_applicants').update({ decision_msg_held_at: null }).eq('id', id)
    return error ? json({ error: error.message }, 500) : json({ ok: true, skipped: true })
  }

  const kind = String(b.kind || '') as Kind
  if (kind !== 'declined' && kind !== 'pool') return json({ error: 'which message? (declined or pool)' }, 400)
  if (a.status !== kind) return json({ error: `They are marked "${a.status}", not "${kind === 'pool' ? 'Candidate pool' : 'Not hiring'}".` }, 409)
  const first = String(a.first_name || '').trim() || 'there'
  const canText = !!a.phone && a.sms_consent === true
  const plan = {
    text: canText ? decisionText(kind, first) : null,
    email: !canText && a.email ? { subject: DECISION_SUBJECT, html: decisionHtml(kind, first) } : null,
    no_text_why: !a.phone ? 'no phone number' : a.sms_consent !== true ? 'they did not agree to texts on their application' : null,
    already_sent: !!a.decision_msg_at && a.decision_msg_kind === kind,
    label: LABEL[kind],
  }
  if (action === 'preview') return json({ ok: true, preview: true, ...plan })
  if (action !== 'send') return json({ error: 'unknown action' }, 400)
  if (plan.already_sent) return json({ ok: true, already_sent: true })
  if (!plan.text && !plan.email) return json({ ok: true, texted: false, emailed: false, not_sent: ['no usable phone (with their yes to texts) or email'] })

  const now = new Date().toISOString()
  const hours = maySend('reactive_external')
  if (!hours.allowed) {
    await db.from('job_applicants').update({ decision_msg_held_at: now }).eq('id', id)
    return json({ ok: true, held: `Messages to applicants go 8am to 6pm. After 8am, open their profile and press "Send the ${LABEL[kind]}".` })
  }
  const ghl = { token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
  if (!ghl.token || !ghl.locationId) return json({ ok: true, error: 'Texting is not set up on the server, so no message went.' })
  const H = { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' }
  const whoName = [a.first_name, a.last_name].filter(Boolean).join(' ')
  const common = { humanInitiated: true, audience: 'applicant' as const, sender: SENDER }
  const notSent: string[] = []
  let texted = false, emailed = false
  if (plan.text) {
    let why = ''
    const c = await contactForOutbound(db, ghl, { phone: a.phone, email: a.email, firstName: a.first_name, lastName: a.last_name }, 'reactive_external',
      { ...common, channel: 'sms', onOptOut: (r) => { why = 'they opted out of texts (' + r.join(', ') + ')' } })
    if (!c) notSent.push('text: ' + (why || 'the number could not be confirmed as safe to text'))
    else {
      texted = await ghlSendChecked(db, H, SENDER, { channel: 'sms', contactId: c.contactId, address: a.phone, who: whoName }, { message: plan.text })
      if (!texted) notSent.push('text: GoHighLevel did not accept it (a card is on Needs Attention)')
    }
  }
  if (plan.email) {
    let why = ''
    const c = await contactForOutbound(db, ghl, { phone: a.phone, email: a.email, firstName: a.first_name, lastName: a.last_name }, 'reactive_external',
      { ...common, channel: 'email', onOptOut: (r) => { why = 'they opted out of email (' + r.join(', ') + ')' } })
    if (!c) notSent.push('email: ' + (why || 'could not be sent'))
    else {
      emailed = await ghlSendChecked(db, H, SENDER, { channel: 'email', contactId: c.contactId, address: a.email, who: whoName }, plan.email)
      if (!emailed) notSent.push('email: GoHighLevel did not accept it (a card is on Needs Attention)')
    }
  }
  if (texted || emailed) await db.from('job_applicants').update({ decision_msg_at: new Date().toISOString(), decision_msg_kind: kind,
    decision_msg_by: who.name || who.email, decision_msg_held_at: null }).eq('id', id)
  return json({ ok: true, texted, emailed, not_sent: notSent })
})
