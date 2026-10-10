// =============================================================================
// applicant-text (574, 2026-10-10) · the office texts an applicant from the Hub, and cancels an interview with its
// own words. Samantha: "yes to all, build it" (2026-10-10): a Text button on every applicant (Applicants tab, the
// Interviews tab once they have booked, their page), a composer that starts from a quick pick such as "we saw you
// started an application with us and have a client right now who may be a good fit", and Cancel asking whether they
// are cancelling or we are, with the message editable before it goes.
//
//   • Signed-in office staff only (requireStaff) for everything but 'release'. The public key gets nothing.
//   • 'draft'            {id}: who they are, whether we may text them (and why not), the hours, the quick picks with
//                        the sender's first name filled in. Sends nothing.
//   • 'send'             {id, message, kind?}: one text, through GoHighLevel (so it shows in Conversations), with the
//                        STOP line. 8am to 6pm Central; outside that it is HELD (her choice: hold and send at 8am) and
//                        the 'release' schedule sends it in the morning. Never to someone whose latest application said
//                        no to texts, never past the universal opt-out. Every send is a row in applicant_texts.
//   • 'cancel_draft'     {id}: the booked time and both cancellation messages (their call / our call).
//   • 'cancel_interview' {id, by, reason?, message?, send?}: cancels the live booking (interview_cancel, by
//                        'applicant' or 'office'), marks it so the interview messages job sends nothing of its own,
//                        then sends the edited message as a text (with their yes to texts) and as an email (when we have
//                        one). 'send: false' cancels with no message.
//   • 'unhold'           {row_id}: a held text is not sent after all.
//   • 'release'          (the schedule, every 15 minutes, with the jobs' secret; or the owner's Desktop step):
//                        sends what is waiting once 8am comes. ?auth_check=1 only says who is calling.
//   A text GoHighLevel refuses raises a "Didn't go through" card (send-problems). Nothing here is autonomous: a person
//   wrote and pressed Send; the schedule only carries it past the night.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { contactForOutbound, maySend } from '../_shared/outreach.ts'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { ghlSendChecked } from '../_shared/send-problems.ts'
import { latestTextConsent, withStop } from '../_shared/text-consent.ts'
import { jobCaller } from '../_shared/job-auth.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
export const OFFICE = '417-234-8494'
const TZ = 'America/Chicago'
/* "send-candidate-message" is the office's name for a message to a candidate, so a refused one lands on the hiring
   owner's Needs Attention list as "message to a candidate"; the bracket is never shown on a card. */
const SENDER_TEXT = 'send-candidate-message (office text)'
const SENDER_CANCEL = 'send-candidate-message (interview cancelled)'
const MAX_LEN = 1000

const fmtDay = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: TZ })
const fmtTime = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ })
const firstWord = (s: unknown) => String(s ?? '').trim().split(/\s+/)[0] || ''
const centralHour = (d: Date) => Number(d.toLocaleString('en-US', { timeZone: TZ, hour: '2-digit', hour12: false })) % 24

/** The next 8am Central after `now` (today's if it is still before 8am). */
export function nextWindow(now: Date = new Date()): Date {
  const ymd = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: TZ })   // YYYY-MM-DD in Central
  const today = ymd(now)
  const target = centralHour(now) < 8 ? today : ymd(new Date(now.getTime() + 86_400_000))
  const [y, m, d] = target.split('-').map(Number)
  let t = new Date(Date.UTC(y, m - 1, d, 14, 0, 0))        // 8am CST; one hour early in summer
  const h = centralHour(t)
  if (h === 9) t = new Date(t.getTime() - 3_600_000)
  else if (h === 7) t = new Date(t.getTime() + 3_600_000)
  return t
}

export type Pick = { key: string; label: string; text: string }
/* The quick picks (her example first). The office edits them; the STOP line is added at send time. */
export function picks(first: string, me: string, a: { status?: string }, booked?: { day: string; time: string } | null): Pick[] {
  const hi = `Hi ${first}, this is ${me} from Caring Companions.`
  const out: Pick[] = [
    { key: 'fit', label: 'A client who may fit', text: `${hi} We saw you started an application with us, and we have a client right now who may be a good fit for your experience and availability. Would you like to hear more? Reply here or call us at ${OFFICE}.` },
    { key: 'interested', label: 'Still interested?', text: `${hi} Are you still interested in a caregiver position with us? Reply here and we will take it from there.` },
    { key: 'call', label: 'Please call us', text: `${hi} Could you give us a call at ${OFFICE} when you have a moment? Thank you.` },
    { key: 'tried', label: 'We tried to reach you', text: `${hi} We tried to reach you by phone and could not get through. Reply here or call us at ${OFFICE} when you can.` },
  ]
  if (a.status === 'partial') out.push({ key: 'finish', label: 'Finish the application', text: `${hi} We saw you started an application with us and would love for you to finish it. Any questions, just reply here.` })
  if (booked) out.push({ key: 'interview', label: 'About their interview', text: `${hi} Just a reminder about your in-person interview at our office on ${booked.day} at ${booked.time}. See you then! Need to change it? Call or text us at ${OFFICE}.` })
  out.push({ key: 'own', label: 'Write my own', text: `${hi} ` })
  return out
}
export const CANCEL_SUBJECT = (day: string) => `Your interview on ${day} is cancelled`
export function cancelDrafts(first: string, me: string, day: string, time: string, bookUrl: string) {
  return {
    applicant: `Hi ${first}, your interview with Caring Companions for ${day} at ${time} is cancelled as you asked, so there is nothing more to do. Want a different time? Pick one here: ${bookUrl} or call us at ${OFFICE}.`,
    office: `Hi ${first}, this is ${me} from Caring Companions. We are sorry, we need to cancel your interview for ${day} at ${time}. We would still like to meet you, so please pick a new time here: ${bookUrl} or call us at ${OFFICE}.`,
  }
}
const cancelHtml = (message: string) => {
  const body = escHtml(message).replace(/(https?:\/\/\S+?)([.,]?)(\s|$)/g, '<a href="$1">$1</a>$2$3')
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.7;color:#1f2a36"><p>${body}</p>` +
    `<p>Caring Companions In-Home Senior Care<br>${OFFICE}</p></div>`
}

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })
  const ghl = { token: Deno.env.get('GHL_TOKEN') ?? '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
  const H = { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' }
  const url = new URL(req.url)
  // deno-lint-ignore no-explicit-any
  const b: any = await req.json().catch(() => ({}))
  const action = String(b.action || url.searchParams.get('action') || (url.searchParams.get('auth_check') === '1' ? 'auth_check' : 'draft'))

  /* ---- one real send: text (and, for a cancellation, the email), through the gates ---- */
  const deliver = async (row: Row, a: Row, sender: string) => {
    const notSent: string[] = []
    let texted = false, emailed = false
    if (!ghl.token || !ghl.locationId) return { texted, emailed, notSent: ['texting is not set up on the server'] }
    const person = { phone: a.phone, email: a.email, firstName: a.first_name, lastName: a.last_name }
    const whoName = [a.first_name, a.last_name].filter(Boolean).join(' ')
    const common = { humanInitiated: true, audience: 'applicant' as const, sender }
    if (row.phone) {
      let why = ''
      const c = await contactForOutbound(db, ghl, person, 'reactive_external', { ...common, channel: 'sms', onOptOut: (r) => { why = 'they opted out of texts (' + r.join(', ') + ')' } })
      if (!c) notSent.push('text: ' + (why || 'the number could not be confirmed as safe to text'))
      else {
        texted = await ghlSendChecked(db, H, sender, { channel: 'sms', contactId: c.contactId, address: a.phone, who: whoName }, { message: row.message })
        if (!texted) notSent.push('text: GoHighLevel did not accept it (a card is on Needs Attention)')
      }
    }
    if (row.email && row.email_subject) {
      let why = ''
      const c = await contactForOutbound(db, ghl, person, 'reactive_external', { ...common, channel: 'email', onOptOut: (r) => { why = 'they opted out of email (' + r.join(', ') + ')' } })
      if (!c) notSent.push('email: ' + (why || 'could not be sent'))
      else {
        emailed = await ghlSendChecked(db, H, sender, { channel: 'email', contactId: c.contactId, address: a.email, who: whoName }, { subject: row.email_subject, html: cancelHtml(row.message.replace(/ Reply STOP to opt out\.$/, '')) })
        if (!emailed) notSent.push('email: GoHighLevel did not accept it (a card is on Needs Attention)')
      }
    }
    return { texted, emailed, notSent }
  }

  /* ---- the schedule: send what waited for 8am ---- */
  if (action === 'release' || action === 'auth_check') {
    const caller = await jobCaller(req)
    if (!caller) return json({ error: 'not allowed' }, 401)
    if (action === 'auth_check') return json({ ok: true, caller })
    const dry = url.searchParams.get('dry') === '1'
    if (!maySend('reactive_external').allowed) return json({ ok: true, released: 0, held: 'outside 8am to 6pm' })
    const { data: due, error } = await db.from('applicant_texts').select('*').eq('status', 'held').lte('send_after', new Date().toISOString()).order('send_after').limit(50)
    if (error) return json({ ok: false, error: error.message }, 500)
    let released = 0, failed = 0
    for (const row of (due ?? []) as Row[]) {
      if (dry) continue
      const { data: a } = await db.from('job_applicants').select('id, first_name, last_name, phone, email').eq('id', row.applicant_id).maybeSingle()
      if (!a) { await db.from('applicant_texts').update({ status: 'failed', error: 'applicant not found' }).eq('id', row.id); failed++; continue }
      const r = await deliver(row, a, row.kind === 'cancel' ? SENDER_CANCEL : SENDER_TEXT)
      const ok = r.texted || r.emailed
      await db.from('applicant_texts').update({ status: ok ? 'sent' : 'failed', sent_at: ok ? new Date().toISOString() : null, texted: r.texted, emailed: r.emailed, error: r.notSent.join('; ') || null }).eq('id', row.id)
      ok ? released++ : failed++
    }
    return json({ ok: true, due: (due ?? []).length, released, failed, dry })
  }

  /* ---- everything else is a signed-in office person ---- */
  const who = await requireStaff(db, req, OFFICE_ROLES)
  if (!who.ok) return json({ error: who.error }, who.status)
  const me = firstWord(who.name) || 'the office'

  if (action === 'unhold') {
    const rid = Number(b.row_id)
    if (!rid) return json({ error: 'which text?' }, 400)
    const { data, error } = await db.from('applicant_texts').update({ status: 'cancelled', error: 'not sent: ' + (who.name || who.email) + ' chose not to' }).eq('id', rid).eq('status', 'held').select('id')
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true, unheld: (data ?? []).length })
  }

  const id = String(b.id || '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'which applicant?' }, 400)
  const { data: a, error: aErr } = await db.from('job_applicants').select('id, first_name, last_name, phone, email, sms_consent, status').eq('id', id).maybeSingle()
  if (aErr) return json({ error: aErr.message }, 500)
  if (!a) return json({ error: 'That applicant was not found.' }, 404)
  const first = String(a.first_name || '').trim() || 'there'
  const { data: bk } = await db.from('interview_bookings').select('id, starts_at, status').eq('applicant_id', id).eq('status', 'booked').order('starts_at').limit(1).maybeSingle()
  const booked = bk ? { day: fmtDay(new Date(bk.starts_at)), time: fmtTime(new Date(bk.starts_at)), starts_at: bk.starts_at } : null
  const consent = a.phone ? await latestTextConsent(db, a.phone) : { ok: false, why: 'no phone number on their application' }
  const hours = maySend('reactive_external')
  const window = hours.allowed ? null : nextWindow()
  const waits = window ? `It is outside 8am to 6pm Central, so it will be held and sent at ${fmtTime(window)} on ${fmtDay(window)}.` : null

  if (action === 'draft') {
    return json({ ok: true, first, name: [a.first_name, a.last_name].filter(Boolean).join(' '), phone: a.phone || null, email: a.email || null, status: a.status,
      can_text: consent.ok, why_not: consent.ok ? null : consent.why, in_hours: hours.allowed, send_after: window ? window.toISOString() : null, waits,
      booked, me, picks: picks(first, me, a, booked) })
  }

  if (action === 'cancel_draft') {
    if (!booked) return json({ error: 'They have no interview booked.' }, 409)
    const bookUrl = 'https://mo-care.com/apply?book=' + encodeURIComponent(id)
    return json({ ok: true, first, name: [a.first_name, a.last_name].filter(Boolean).join(' '), booked, can_text: consent.ok, why_not: consent.ok ? null : consent.why,
      email: a.email || null, in_hours: hours.allowed, waits, me, drafts: cancelDrafts(first, me, booked.day, booked.time, bookUrl), subject: CANCEL_SUBJECT(booked.day) })
  }

  /* a message the office wrote (edited from a pick, or the cancellation), as one row, sent now or held */
  const queue = async (kind: 'text' | 'reply' | 'cancel', message: string, withEmail: boolean, subject: string | null, sender: string) => {
    const text = withStop(message.trim().replace(/\s+/g, ' ').slice(0, MAX_LEN))
    const canText = consent.ok && !!a.phone
    const canEmail = withEmail && !!a.email
    if (!canText && !canEmail) return { status: 409, body: { error: 'Not sent: ' + (consent.why || 'no phone') + (withEmail ? ', and we have no email for them' : '') + '. Call them instead.' } }
    const row: Row = { applicant_id: id, kind, status: 'held', phone: canText ? a.phone : null, email: canEmail ? a.email : null, message: text,
      email_subject: canEmail ? subject : null, created_by: who.name || who.email, send_after: window ? window.toISOString() : new Date().toISOString() }
    if (window) {
      const { data: ins, error } = await db.from('applicant_texts').insert(row).select('id').maybeSingle()
      if (error) return { status: 500, body: { error: 'Could not keep the message: ' + error.message } }
      return { status: 200, body: { ok: true, held: true, row_id: ins?.id ?? null, send_after: window.toISOString(), waits, not_text: canText ? null : consent.why, text } }
    }
    const r = await deliver(row, a, sender)
    const ok = r.texted || r.emailed
    Object.assign(row, { status: ok ? 'sent' : 'failed', sent_at: ok ? new Date().toISOString() : null, texted: r.texted, emailed: r.emailed, error: r.notSent.join('; ') || null })
    const { data: ins, error } = await db.from('applicant_texts').insert(row).select('id').maybeSingle()
    if (error) console.warn('[applicant-text] could not record the send: ' + error.message)
    return { status: 200, body: { ok: true, sent: ok, texted: r.texted, emailed: r.emailed, not_sent: r.notSent, row_id: ins?.id ?? null, not_text: canText ? null : consent.why, text } }
  }

  if (action === 'send') {
    const message = String(b.message || '').trim()
    if (message.length < 2) return json({ error: 'Write the message first.' }, 400)
    const kind = b.kind === 'reply' ? 'reply' : 'text'
    const r = await queue(kind, message, false, null, SENDER_TEXT)
    return json(r.body, r.status)
  }

  if (action === 'cancel_interview') {
    if (!booked) return json({ error: 'There was no live booking to cancel. Refresh and look again.' }, 409)
    const by = b.by === 'applicant' ? 'applicant' : b.by === 'office' ? 'office' : null
    if (!by) return json({ error: 'Who is cancelling: they are (applicant) or we are (office)?' }, 400)
    const reason = String(b.reason || '').trim().slice(0, 300) || null
    const send = b.send !== false
    const message = String(b.message || '').trim()
    if (send && message.length < 2) return json({ error: 'Write the message first, or choose to cancel with no message.' }, 400)
    const { data: rc, error: rcErr } = await db.rpc('interview_cancel', { p_applicant: id, p_reason: reason, p_by: by })
    if (rcErr) return json({ error: 'Could not cancel it: ' + rcErr.message }, 500)
    if (!rc || rc.cancelled !== true) return json({ error: 'There was no live booking to cancel. Refresh and look again.' }, 409)
    /* the interview messages job would send its own notice next run; this one is the office's, so mark it told */
    await db.from('interview_bookings').update({ cancel_notified_at: new Date().toISOString() }).eq('id', bk!.id)
    if (!send) return json({ ok: true, cancelled: true, sent: false, by })
    const r = await queue('cancel', message, true, CANCEL_SUBJECT(booked.day), SENDER_CANCEL)
    if (r.status === 409) return json({ ok: true, cancelled: true, by, sent: false, not_sent: [String(r.body.error)] })
    return json({ ...r.body, cancelled: true, by }, r.status)
  }

  return json({ error: 'unknown action' }, 400)
})
