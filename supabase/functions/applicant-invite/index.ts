// =============================================================================
// applicant-invite — "Send the application" (Desktop 364, 2026-09-29)
// =============================================================================
// Samantha approved ("yes to all"): somebody calls asking about a job; staff type their name, phone, email and the
// position, see the exact text and email, and press Send. They get that position's application link.
//
//   • Signed-in office staff only (requireStaff). The public key gets nothing.
//   • The WORDING is fixed: ops_settings.applicant_invite_msg (Settings) or the default below. The caller never
//     supplies message text, and the link is built here from job_positions / job_postings, so this cannot be used
//     to send anything else (the send-candidate-message lesson, 2026-09-27).
//   • Text only when staff ticked "They asked us to text it"; email whenever there is an address. Every channel goes
//     through the universal opt-out door (contactForOutbound, channel named). STOP wording on every text.
//   • 8am to 6pm Central, any day (reactive_external: they just called). Outside that it says so and sends nothing.
//   • The same phone or email is not sent the link twice within 24 hours (a double tap, not a second invite).
//   • Logged in applicant_invites. NOT a job_applicants row, so their real application is never marked a duplicate.
//
// Body: { action: 'preview' | 'send' | 'close', first_name, last_name, phone, email, position, sms_asked, id }
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { contactForOutbound, maySend } from '../_shared/outreach.ts'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

export const DEFAULT_MSG = `Hi {first_name}, thanks for calling Caring Companions! Here's the application for {position}. It takes about 2 minutes: {link}`
const STOP = ' Reply STOP to opt out.'
const SITE = 'https://mo-care.com'
const clean = (v: unknown, n = 80) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n)
export const digits10 = (p: unknown) => { let d = String(p ?? '').replace(/\D/g, ''); if (d.length === 11 && d[0] === '1') d = d.slice(1); return d.length === 10 ? d : '' }
const okEmail = (e: string) => /^[^\s@",()]+@[^\s@",()]+\.[^\s@",()]+$/.test(e)
const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function buildText(tmpl: string, first: string, position: string, link: string): string {
  const t = (tmpl && tmpl.includes('{link}')) ? tmpl : DEFAULT_MSG
  const body = t.replaceAll('{first_name}', first).replaceAll('{position}', position).replaceAll('{link}', link).trim()
  return /\bSTOP\b/.test(body) ? body : body + STOP
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

  if (action === 'close') {
    const id = Number(b.id)
    if (!Number.isInteger(id) || id < 1) return json({ error: 'which one?' }, 400)
    const { error } = await db.from('applicant_invites').update({ closed_at: new Date().toISOString(), closed_by: who.email })
      .eq('id', id).is('closed_at', null)
    return error ? json({ error: error.message }, 500) : json({ ok: true })
  }
  if (action !== 'preview' && action !== 'send') return json({ error: 'unknown action' }, 400)

  const first = clean(b.first_name, 40), last = clean(b.last_name, 60)
  const phone = digits10(b.phone), email = clean(b.email, 120).toLowerCase()
  const smsAsked = b.sms_asked === true
  if (!first) return json({ error: 'A first name is needed.' }, 400)
  if (b.phone && !phone) return json({ error: 'That phone number is not 10 digits.' }, 400)
  if (email && !okEmail(email)) return json({ error: 'That email does not look right.' }, 400)
  if (!phone && !email) return json({ error: 'Add a phone number or an email.' }, 400)

  /* The link is ours to build: a live posting for that position if there is one, else the position's own form. */
  const posKey = clean(b.position, 40)
  const { data: pos } = await db.from('job_positions').select('key,label,active').eq('key', posKey).maybeSingle()
  if (!pos || pos.active === false) return json({ error: 'That position is not open.' }, 400)
  const { data: posts } = await db.from('job_postings').select('slug').eq('position', pos.key).eq('status', 'published').limit(1)
  const slug = posts?.[0]?.slug
  const link = slug
    ? `${SITE}/apply?job=${encodeURIComponent(slug)}&channel_source=phone`
    : `${SITE}/apply?position=${encodeURIComponent(pos.key)}&channel_source=phone`

  const { data: stRow } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  const tmpl = String(stRow?.data?.applicant_invite_msg || '')
  const text = buildText(tmpl, first, pos.label, link)
  const subject = `Your application for ${pos.label} at Caring Companions`
  const { data: sch } = await db.from('scheduling_settings').select('phone').eq('id', 1).maybeSingle()
  const office = sch?.phone ?? '(417) 234-8494'
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1f2a36">` +
    `<p>Hi ${escHtml(first)},</p><p>Thanks for calling Caring Companions about our ${escHtml(pos.label)} position. ` +
    `Here is the application. It takes about 2 minutes, and at the end you can pick an interview time.</p>` +
    `<p><a href="${link}" style="background:#F0A63A;color:#122F52;text-decoration:none;padding:12px 20px;border-radius:8px;` +
    `font-weight:700;display:inline-block">Start the application</a></p>` +
    `<p style="color:#57606a">Questions? Call us at ${escHtml(office)}.<br>Caring Companions In-Home Senior Care</p></div>`

  const hours = maySend('reactive_external')
  const plan = {
    text: phone && smsAsked ? text : null,
    email: email ? { subject, html } : null,
    no_text_why: !phone ? 'no phone number' : (!smsAsked ? 'they did not ask for a text' : null),
    link, position: pos.label, in_hours: hours.allowed, hours: hours.reason,
  }
  if (action === 'preview') return json({ ok: true, preview: true, ...plan })
  if (!hours.allowed) return json({ ok: false, held: 'Texts and emails to applicants go 8am to 6pm. Send it after 8am.' }, 200)

  /* A double tap, not a second invite. */
  const since = new Date(Date.now() - 864e5).toISOString()
  const ors = [phone ? `phone.eq.${phone}` : '', email ? `email.eq."${email}"` : ''].filter(Boolean).join(',')
  const { data: recent } = await db.from('applicant_invites').select('id').gte('created_at', since).or(ors).limit(1)
  if (recent?.length) return json({ ok: false, error: 'They were already sent the application in the last 24 hours.' }, 409)

  const ghl = { token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
  if (!ghl.token || !ghl.locationId) return json({ error: 'Texting is not set up on the server.' }, 500)
  const H = { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' }
  const notSent: string[] = []
  if (plan.no_text_why && phone) notSent.push('text: ' + plan.no_text_why)
  const common = { humanInitiated: true, audience: 'applicant' as const, sender: 'applicant-invite' }

  let texted = false, emailed = false
  if (plan.text) {
    let why = ''
    const c = await contactForOutbound(db, ghl, { phone, firstName: first, lastName: last || undefined }, 'reactive_external',
      { ...common, channel: 'sms', onOptOut: (r) => { why = 'they opted out of texts (' + r.join(', ') + ')' } })
    if (!c) notSent.push('text: ' + (why || 'the number could not be confirmed as safe to text'))
    else {
      try {
        const r = await fetch('https://services.leadconnectorhq.com/conversations/messages', { method: 'POST', headers: H,
          body: JSON.stringify({ type: 'SMS', contactId: c.contactId, message: plan.text }) })
        texted = r.ok; if (!r.ok) notSent.push('text: the texting service refused it (' + r.status + ')')
      } catch { notSent.push('text: the texting service did not answer') }
    }
  }
  if (plan.email) {
    let why = ''
    const c = await contactForOutbound(db, ghl, { email, firstName: first, lastName: last || undefined }, 'reactive_external',
      { ...common, channel: 'email', onOptOut: (r) => { why = 'they opted out of email (' + r.join(', ') + ')' } })
    if (!c) notSent.push('email: ' + (why || 'could not be sent'))
    else {
      try {
        const r = await fetch('https://services.leadconnectorhq.com/conversations/messages', { method: 'POST', headers: H,
          body: JSON.stringify({ type: 'Email', contactId: c.contactId, subject, html }) })
        emailed = r.ok; if (!r.ok) notSent.push('email: the email service refused it (' + r.status + ')')
      } catch { notSent.push('email: the email service did not answer') }
    }
  }

  if (!texted && !emailed) return json({ ok: false, texted, emailed, not_sent: notSent, error: 'Nothing was sent. ' + notSent.join('; ') }, 200)
  const { data: row, error } = await db.from('applicant_invites').insert({
    first_name: first, last_name: last || null, phone: phone || null, email: email || null,
    position: pos.key, position_label: pos.label, link, sms_asked: smsAsked, texted, emailed, not_sent: notSent,
    sent_by: who.email, sent_by_name: who.name,
  }).select('id').single()
  return json({ ok: true, id: row?.id ?? null, texted, emailed, not_sent: notSent, logged: !error })
})
