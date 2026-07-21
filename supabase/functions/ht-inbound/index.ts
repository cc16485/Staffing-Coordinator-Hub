// Supabase Edge Function: ht-inbound (shared hub project)
// -----------------------------------------------------------------------------
// Resend inbound-email webhook. When anyone emails support@tryhometogether.com:
//   1. If the subject contains a ticket number (HT-XXXXXX), the message is
//      appended to that ticket's thread in `ht_tickets` and the ticket is
//      re-marked "New" so it lights up in the hub's Support tab.
//   2. Otherwise a brand-new ticket is created from the email.
//   3. A copy is forwarded to Samantha's regular inbox with reply-to set to
//      the customer, so she can reply straight from Gmail.
//
// Auth: light token in the URL (?token=), same anti-spam token as ht-support.
// Deploy: dashboard editor, Verify JWT OFF.
// -----------------------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const FORWARD_TO = 'samantha@mo-care.com'
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const url = new URL(req.url)
  const expected = Deno.env.get('HT_SUPPORT_TOKEN') ?? Deno.env.get('HT_ORDER_TOKEN')
  if (!expected || url.searchParams.get('token') !== expected) return json({ error: 'unauthorized' }, 401)

  // deno-lint-ignore no-explicit-any
  let evt: Record<string, any> = {}
  try { evt = await req.json() } catch { return json({ error: 'bad payload' }, 400) }
  if (evt.type && evt.type !== 'email.received') return json({ ok: true, ignored: evt.type })

  const d = evt.data ?? evt
  const fromRaw = String(d.from ?? '')
  const m = fromRaw.match(/<([^>]+)>/)
  const fromEmail = (m ? m[1] : fromRaw).trim().slice(0, 320)
  const fromName = fromRaw.replace(/<[^>]+>/, '').replace(/"/g, '').trim().slice(0, 200)
  const subject = String(d.subject ?? '').slice(0, 300)
  let text = String(d.text ?? '').trim()
  const htmlBody = d.html ?? d.body?.html ?? d.html_body ?? evt.html ?? ''
  if (!text && htmlBody) text = String(htmlBody).replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  if (!text) text = '(This email arrived without a readable text body, it is probably a heavy-design HTML email. Read it in full at resend.com -> Emails -> Receiving.)'
  text = text.slice(0, 8000)
  if (!fromEmail) return json({ error: 'no sender' }, 400)

  // never loop on our own or system mail
  const lower = fromEmail.toLowerCase()
  if (lower.includes('tryhometogether.com') || lower.startsWith('mailer-daemon') || lower.startsWith('postmaster')) {
    return json({ ok: true, ignored: 'self/system' })
  }

  const now = new Date().toISOString()
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const tkMatch = subject.match(/HT-[A-Z0-9]{6}/i)
  let ticketNo = tkMatch ? tkMatch[0].toUpperCase() : ''
  let handled = false

  if (ticketNo) {
    const { data } = await supabase.from('app_data').select('data').eq('key', 'ht_tickets').single()
    const list = (data?.data ?? []) as Record<string, unknown>[]
    const t = list.find((x) => x.ticket_no === ticketNo)
    if (t) {
      const thread = Array.isArray(t.thread) ? t.thread : []
      thread.push({ at: now, from: fromEmail, text })
      t.thread = thread
      t.status = 'New'
      t.updated_at = now
      const r = await supabase.rpc('upsert_app_data_item', { target_key: 'ht_tickets', item: t })
      if (!r.error) handled = true
    }
  }

  if (!handled) {
    ticketNo = 'HT-' + crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()
    const ticket = {
      id: crypto.randomUUID(),
      ticket_no: ticketNo,
      created_at: now,
      updated_at: now,
      status: 'New',
      name: fromName || fromEmail,
      email: fromEmail,
      phone: '',
      topic: subject || 'Email to support@',
      site: 'Email',
      page: '',
      message: text,
      thread: [],
    }
    const r = await supabase.rpc('upsert_app_data_item', { target_key: 'ht_tickets', item: ticket })
    if (r.error) return json({ error: r.error.message }, 500)
  }

  // Forward a copy to Samantha's real inbox; replying there goes to the customer.
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (resendKey) {
    const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'HomeTogether Support <support@tryhometogether.com>',
          to: [FORWARD_TO],
          reply_to: fromEmail,
          subject: `[Support ${ticketNo}] ${subject || '(no subject)'}`,
          html: `
<div style="font-family:Georgia,serif;max-width:600px;color:#16283A;line-height:1.6">
  <p style="background:#F3F7F8;border:1px solid #DDE8EA;border-radius:8px;padding:10px 14px;font-size:13px;color:#5B6B79">
    Support email from <b>${esc(fromName || fromEmail)}</b> &lt;${esc(fromEmail)}&gt; · ticket ${esc(ticketNo)}<br>
    Hitting reply sends your answer straight to them. The full thread is also in the hub's Support tab.
  </p>
  <div style="white-space:pre-wrap">${esc(text)}</div>
</div>`,
        }),
      })
    } catch (_e) { /* ticket already stored */ }
  }

  return json({ ok: true, ticket_no: ticketNo, appended: handled })
})
