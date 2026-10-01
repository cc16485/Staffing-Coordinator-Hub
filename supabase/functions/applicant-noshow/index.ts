// =============================================================================
// applicant-noshow — interview no-shows (Desktop 400, 2026-10-01)
// =============================================================================
// Samantha: "We are pushing the no show button and nothing happens. We want them labeled largely... send the applicant
// a text when we push no show" / "send both text and email" / "they need to be in a no-show category and not allowed
// to re-apply ... Give us the option to excuse the no-show and rebook the interview if they call us and give us a
// reason" / "make sure that these messages are going through ghl conversations".
//
//   • Signed-in office staff only (requireStaff). The public key gets nothing.
//   • The WORDING is fixed here (her words). The caller never supplies message text.
//   • action 'preview' {id}: the exact text and email for that applicant, and which will go.
//   • action 'mark'    {id}: marks the applicant a no-show (status 'noshow', who/when), closes their booked interview
//     as a no-show, then sends the text (only with their yes to texts) and the email, ONCE (noshow_msg_at).
//   • action 'send'    {id}: sends the message for someone already marked, if it has not gone (e.g. it was held).
//   • action 'excuse'  {id, reason}: the office excuses it after a call: back to 'reviewing' (so they can be booked),
//     with who, when and the reason they gave. A reason is required.
//   • Every message goes through GoHighLevel (so it shows in Conversations) via the universal opt-out door, and a
//     message GoHighLevel refuses raises a "Didn't go through" card (NO SILENT FAILURES).
//   • 8am to 6pm Central (reactive_external). Outside that the no-show is still marked and the message waits; the
//     profile offers "Send the no-show message".
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

/* Her words (2026-10-01). The text is hers verbatim plus the opt-out line every Hub text carries. */
export const noshowText = (first: string) =>
  `Hi ${first}, this is Caring Companions In-Home Senior Care. You were scheduled for an in-person interview with our office today and did not attend or contact us prior to your scheduled interview time.\n\n` +
  `Your application has been marked as a No-Show, which means you will not be eligible to reapply or be considered for employment with Caring Companions in the future.\n\n` +
  `We understand that unexpected circumstances can happen. If there is a reasonable explanation for missing your interview, please call our office at ${OFFICE} as soon as possible so we can discuss the situation.\n\n` +
  `Thank you,\nCaring Companions In-Home Senior Care\n\nReply STOP to opt out.`
export const NOSHOW_SUBJECT = 'Missed Interview – Caring Companions'
/* The email version she approved (2026-10-01 screenshot). */
export const noshowHtml = (first: string) => {
  const f = escHtml(first)
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1f2a36">` +
    `<p>Hi ${f},</p>` +
    `<p>You were scheduled for an in-person interview with Caring Companions In-Home Senior Care today and did not attend or contact our office prior to your scheduled interview time.</p>` +
    `<p>As a result, your application has been marked as a <b>No-Show</b>. Applicants who are marked as a No-Show are not eligible to reapply or be considered for future employment with Caring Companions.</p>` +
    `<p>We understand that unexpected circumstances can occur. If there is a reasonable explanation for missing your scheduled interview, please call our office at <b>${OFFICE}</b> as soon as possible. We are happy to discuss the circumstances with you and determine whether your application may be reconsidered.</p>` +
    `<p>Thank you,</p><p>Caring Companions In-Home Senior Care<br>${OFFICE}</p></div>`
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
  const id = String(b.id || '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'which applicant?' }, 400)
  const { data: a, error: aErr } = await db.from('job_applicants')
    .select('id, first_name, last_name, phone, email, sms_consent, status, noshow_at, noshow_msg_at').eq('id', id).maybeSingle()
  if (aErr) return json({ error: aErr.message }, 500)
  if (!a) return json({ error: 'That applicant was not found.' }, 404)
  const first = String(a.first_name || '').trim() || 'there'
  const now = new Date().toISOString()

  if (action === 'excuse') {
    const reason = String(b.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 500)
    if (!reason) return json({ error: 'Write down the reason they gave.' }, 400)
    if (a.status !== 'noshow') return json({ error: 'They are not marked as a no-show.' }, 409)
    const { error } = await db.from('job_applicants').update({ status: 'reviewing', noshow_excused_at: now,
      noshow_excused_by: who.name || who.email, noshow_excuse_reason: reason, seen_at: now }).eq('id', id).eq('status', 'noshow')
    return error ? json({ error: error.message }, 500) : json({ ok: true, excused: true })
  }

  const plan = {
    text: a.phone && a.sms_consent === true ? noshowText(first) : null,
    email: a.email ? { subject: NOSHOW_SUBJECT, html: noshowHtml(first) } : null,
    no_text_why: !a.phone ? 'no phone number' : a.sms_consent !== true ? 'they did not agree to texts on their application' : null,
    already_sent: !!a.noshow_msg_at,
  }
  if (action === 'preview') return json({ ok: true, preview: true, ...plan })
  if (action !== 'mark' && action !== 'send') return json({ error: 'unknown action' }, 400)

  if (action === 'mark') {
    if (!['partial', 'new', 'reviewing', 'interview', 'noshow'].includes(String(a.status)))
      return json({ error: `They are marked "${a.status}", not waiting on an interview.` }, 409)
    if (a.status !== 'noshow') {
      const { error } = await db.from('job_applicants').update({ status: 'noshow', noshow_at: now, noshow_by: who.name || who.email, seen_at: now })
        .eq('id', id)
      if (error) return json({ error: error.message }, 500)
    }
    /* Their booked interview becomes a no-show; the stamp keeps any older automatic message from picking it up. */
    await db.from('interview_bookings').update({ status: 'noshow', outcome_at: now, noshow_notified_at: now })
      .eq('applicant_id', id).eq('status', 'booked')
    await db.from('coordinator_busy').delete().eq('source', 'interview').eq('source_id', id)
  } else if (a.status !== 'noshow') return json({ error: 'They are not marked as a no-show.' }, 409)

  if (a.noshow_msg_at) return json({ ok: true, marked: true, already_sent: true })
  const hours = maySend('reactive_external')
  if (!hours.allowed) return json({ ok: true, marked: true, held: 'Messages to applicants go 8am to 6pm. Open their profile after 8am and press "Send the no-show message".' })
  const ghl = { token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
  if (!ghl.token || !ghl.locationId) return json({ ok: true, marked: true, error: 'Texting is not set up on the server, so no message went.' })
  const H = { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' }
  const whoName = [a.first_name, a.last_name].filter(Boolean).join(' ')
  const common = { humanInitiated: true, audience: 'applicant' as const, sender: 'applicant-noshow' }
  const notSent: string[] = []
  if (plan.no_text_why && a.phone) notSent.push('text: ' + plan.no_text_why)
  let texted = false, emailed = false
  if (plan.text) {
    let why = ''
    const c = await contactForOutbound(db, ghl, { phone: a.phone, email: a.email, firstName: a.first_name, lastName: a.last_name }, 'reactive_external',
      { ...common, channel: 'sms', onOptOut: (r) => { why = 'they opted out of texts (' + r.join(', ') + ')' } })
    if (!c) notSent.push('text: ' + (why || 'the number could not be confirmed as safe to text'))
    else {
      texted = await ghlSendChecked(db, H, 'applicant-noshow', { channel: 'sms', contactId: c.contactId, address: a.phone, who: whoName }, { message: plan.text })
      if (!texted) notSent.push('text: GoHighLevel did not accept it (a card is on Needs Attention)')
    }
  }
  if (plan.email) {
    let why = ''
    const c = await contactForOutbound(db, ghl, { phone: a.phone, email: a.email, firstName: a.first_name, lastName: a.last_name }, 'reactive_external',
      { ...common, channel: 'email', onOptOut: (r) => { why = 'they opted out of email (' + r.join(', ') + ')' } })
    if (!c) notSent.push('email: ' + (why || 'could not be sent'))
    else {
      emailed = await ghlSendChecked(db, H, 'applicant-noshow', { channel: 'email', contactId: c.contactId, address: a.email, who: whoName }, plan.email)
      if (!emailed) notSent.push('email: GoHighLevel did not accept it (a card is on Needs Attention)')
    }
  }
  if (texted || emailed) await db.from('job_applicants').update({ noshow_msg_at: new Date().toISOString() }).eq('id', id)
  return json({ ok: true, marked: true, texted, emailed, not_sent: notSent })
})
