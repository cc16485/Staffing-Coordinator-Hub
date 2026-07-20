// Supabase Edge Function: ht-support (shared hub project)
// -----------------------------------------------------------------------------
// The HomeTogether "Submit a request" support form posts here. Each submission
// becomes a support ticket in the shared hub under the `ht_tickets` collection,
// which the Care Coordinator Hub shows in its Support tab.
//
// Public form endpoint: deployed with --no-verify-jwt (forms can't sign in),
// gated by a light token in the URL: ?token=<...>. The token is anti-spam, not
// a secret. Accepts JSON or a normal form post.
//
// Secret: HT_SUPPORT_TOKEN, falling back to HT_ORDER_TOKEN so no new secret is
// required (same anti-spam token the order form already uses).
// Deploy:  supabase functions deploy ht-support --no-verify-jwt --project-ref zngsgedlsxinbygwmxwn
// -----------------------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const url = new URL(req.url)
  const expected = Deno.env.get('HT_SUPPORT_TOKEN') ?? Deno.env.get('HT_ORDER_TOKEN')
  if (!expected || url.searchParams.get('token') !== expected) return json({ error: 'unauthorized' }, 401)

  // deno-lint-ignore no-explicit-any
  let body: Record<string, any> = {}
  const ct = req.headers.get('content-type') || ''
  try {
    if (ct.includes('application/json')) body = await req.json()
    else {
      const form = await req.formData()
      for (const [k, v] of form.entries()) body = { ...body, [k]: String(v) }
    }
  } catch { return json({ error: 'could not read the submission' }, 400) }

  const s = (v: unknown, max = 4000) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

  const name = s(body.name, 200)
  const email = s(body.email, 320)
  const message = s(body.message)
  if (!email || !message) return json({ error: 'email and message are required' }, 400)

  const now = new Date().toISOString()
  // Short, human-friendly ticket number, e.g. HT-4F7K2M
  const ticketNo = 'HT-' + crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()

  const ticket = {
    id: crypto.randomUUID(),
    ticket_no: ticketNo,
    created_at: now,
    updated_at: now,
    status: 'New',
    name,
    email,
    phone: s(body.phone, 40),
    topic: s(body.topic, 80) || 'General question',
    site: s(body.site, 40) || 'HomeTogether',
    page: s(body.page, 300),
    message,
    // future replies land here: [{ at, from, text }]
    thread: [],
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const r = await supabase.rpc('upsert_app_data_item', { target_key: 'ht_tickets', item: ticket })
  if (r.error) return json({ error: r.error.message }, 500)

  // Confirmation email via Resend — best-effort: a mail hiccup must never lose a ticket.
  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (resendKey) {
    const first = (name || 'there').split(/\s+/)[0]
    const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const html = `
<div style="font-family:Georgia,serif;max-width:560px;margin:0 auto;color:#16283A;line-height:1.6">
  <div style="padding:26px 0 12px;font-size:22px;font-weight:700;color:#0D365F">HomeTogether</div>
  <p>Hi ${esc(first)},</p>
  <p>We got your request and our team is on it. You can expect a reply at this address, usually within a few hours during the day.</p>
  <div style="background:#F3F7F8;border:1px solid #DDE8EA;border-radius:10px;padding:14px 18px;margin:18px 0">
    <div style="font-size:13px;color:#5B6B79;text-transform:uppercase;letter-spacing:.04em">Your ticket</div>
    <div style="font-size:18px;font-weight:700;color:#155A68">${esc(ticketNo)}</div>
    <div style="font-size:14px;color:#5B6B79;margin-top:6px">${esc(ticket.topic)}</div>
  </div>
  <p style="font-size:14px;color:#5B6B79">If you need to add anything, just reply to this email and keep the ticket number in the subject.</p>
  <p>Warmly,<br>The HomeTogether team<br><span style="color:#5B6B79;font-size:14px">A Caring Companions company · tryhometogether.com</span></p>
</div>`
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'HomeTogether Support <support@tryhometogether.com>',
          to: [email],
          reply_to: 'support@tryhometogether.com',
          subject: `We got your request (${ticketNo})`,
          html,
        }),
      })
    } catch (_e) { /* ticket already saved; ignore mail errors */ }
  }

  return json({ ok: true, ticket_no: ticketNo })
})
