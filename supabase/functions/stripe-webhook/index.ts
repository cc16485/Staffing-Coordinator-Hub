// Supabase Edge Function: stripe-webhook (shared hub project)
// -----------------------------------------------------------------------------
// Stripe calls this when a HomeTogether checkout completes, so every device
// order lands in the hub's Orders tab automatically (next to the device
// tracker and runbook) instead of living only in Stripe emails.
//
// Setup once function is deployed:
//   1) Stripe Dashboard -> Developers -> Webhooks -> Add endpoint
//      URL: https://zngsgedlsxinbygwmxwn.supabase.co/functions/v1/stripe-webhook
//      Events: checkout.session.completed
//   2) Copy the endpoint's signing secret (whsec_...) into Supabase secrets
//      as STRIPE_WEBHOOK_SECRET. Signature is verified on every call.
// Deploy: dashboard editor, Verify JWT OFF.
// -----------------------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })

async function verifyStripeSig(payload: string, sigHeader: string, secret: string): Promise<boolean> {
  // Stripe-Signature: t=timestamp,v1=hexhmac  (HMAC-SHA256 of `${t}.${payload}`)
  const parts = Object.fromEntries(sigHeader.split(',').map((p) => p.split('=') as [string, string]))
  const t = parts['t']
  const v1 = parts['v1']
  if (!t || !v1) return false
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false // 5 min tolerance
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`))
  const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('')
  if (hex.length !== v1.length) return false
  let diff = 0
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i)
  return diff === 0
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const payload = await req.text()

  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
  if (!secret) return json({ error: 'webhook secret not configured' }, 500)
  const sig = req.headers.get('stripe-signature') || ''
  if (!(await verifyStripeSig(payload, sig, secret))) return json({ error: 'bad signature' }, 400)

  // deno-lint-ignore no-explicit-any
  let event: any
  try { event = JSON.parse(payload) } catch { return json({ error: 'bad payload' }, 400) }
  if (event.type !== 'checkout.session.completed') return json({ received: true, ignored: event.type })

  const s = event.data?.object ?? {}

  // ---------- HomeTogether Local: caregiver background-check payment ----------
  const hlId = s.metadata?.hl_caregiver_id
  if (hlId) {
    const supabaseHL = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data } = await supabaseHL.from('app_data').select('data').eq('key', 'local_caregivers').maybeSingle()
    const items = Array.isArray(data?.data) ? data.data : []
    // deno-lint-ignore no-explicit-any
    const c: any = items.find((x: any) => x?.id === hlId)
    if (!c) return json({ received: true, note: 'caregiver not found' })
    c.paid_at = new Date().toISOString()
    c.notes = ((c.notes || '') + '\n$45 background-check payment received ' + new Date().toLocaleDateString('en-US') + '.').trim()

    const checkrKey = Deno.env.get('CHECKR_API_KEY')
    const pkg = Deno.env.get('CHECKR_PACKAGE')
    let checkrNote = ''
    if (checkrKey && pkg) {
      try {
        const auth = 'Basic ' + btoa(checkrKey + ':')
        const nameParts = String(c.name || '').trim().split(/\s+/)
        const cand = await fetch('https://api.checkr.com/v1/candidates', {
          method: 'POST',
          headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ email: c.email || '', first_name: nameParts[0] || '', last_name: nameParts.slice(1).join(' ') || nameParts[0] || '', ...(c.phone ? { phone: c.phone.replace(/\D/g, '') } : {}) }).toString(),
        })
        // deno-lint-ignore no-explicit-any
        const cj: any = await cand.json()
        if (cand.ok && cj.id) {
          c.checkr_candidate_id = cj.id
          const inv = await fetch('https://api.checkr.com/v1/invitations', {
            method: 'POST',
            headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ candidate_id: cj.id, package: pkg, 'work_locations[][country]': 'US', 'work_locations[][state]': 'MO' }).toString(),
          })
          // deno-lint-ignore no-explicit-any
          const ij: any = await inv.json()
          if (inv.ok) { checkrNote = 'Checkr invitation sent automatically; caregiver completes it by email.'; c.checkr_invitation_id = ij.id || '' }
          else checkrNote = 'PAID, but Checkr invitation failed (' + (ij?.error || inv.status) + '). Order the check manually in Checkr.'
        } else checkrNote = 'PAID, but Checkr candidate creation failed (' + (cj?.error || cand.status) + '). Order the check manually in Checkr.'
      } catch (e) { checkrNote = 'PAID, but Checkr call errored (' + String(e).slice(0, 80) + '). Order the check manually in Checkr.' }
    } else {
      checkrNote = 'PAID. Checkr automation not configured yet (CHECKR_API_KEY / CHECKR_PACKAGE): order the check manually in Checkr for ' + (c.email || c.name) + '.'
    }
    c.notes = (c.notes + '\n' + checkrNote).trim()
    c.seen = false
    await supabaseHL.rpc('upsert_app_data_item', { target_key: 'local_caregivers', item: c })

    // best-effort emails via GHL
    const ghlToken = Deno.env.get('GHL_TOKEN'); const ghlLocation = Deno.env.get('GHL_LOCATION_ID')
    if (ghlToken && ghlLocation) {
      try {
        const h = { Authorization: `Bearer ${ghlToken}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' }
        const send = async (to: string, first: string, subject: string, html: string) => {
          const up = await fetch('https://services.leadconnectorhq.com/contacts/upsert', { method: 'POST', headers: h, body: JSON.stringify({ locationId: ghlLocation, email: to, firstName: first }) })
          const cid = (await up.json().catch(() => ({})))?.contact?.id
          if (cid) await fetch('https://services.leadconnectorhq.com/conversations/messages', { method: 'POST', headers: h, body: JSON.stringify({ type: 'Email', contactId: cid, subject, html }) })
        }
        await send('samantha@mo-care.com', 'Samantha', '💳 HT Local: ' + (c.name || '') + ' paid for their background check', '<p><b>' + (c.name || '') + '</b> paid $45. ' + checkrNote + '</p><p style="color:#55677a;font-size:13px;">Hub → HomeTogether → Local.</p>')
        if (c.email) await send(c.email, String(c.name || '').split(' ')[0] || 'there', 'Payment received, your background check is underway', '<p>Thanks, your $45 payment is in. Watch your email for a message from <b>Checkr</b> to complete your details; results usually take 1-3 business days, and your ✓ badge activates when it clears.</p><p>The HomeTogether Local team · (417) 234-8494</p>')
      } catch { /* stored fine */ }
    }
    return json({ received: true, local: true })
  }

  const ship = s.shipping_details ?? s.customer_details ?? {}
  const addr = ship.address ?? {}
  const email = s.customer_details?.email ?? ''
  const name = ship.name ?? s.customer_details?.name ?? ''
  const total = typeof s.amount_total === 'number' ? '$' + (s.amount_total / 100).toFixed(2) : ''

  const order = {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    status: 'New order',
    source: 'Stripe checkout',
    buyer_name: name,
    buyer_email: email,
    buyer_phone: s.customer_details?.phone ?? '',
    senior_name: '(same or see notes)',
    ship_street: [addr.line1, addr.line2].filter(Boolean).join(', '),
    ship_city: addr.city ?? '',
    ship_state: addr.state ?? '',
    ship_zip: addr.postal_code ?? '',
    notes: 'Paid via Stripe checkout (' + (s.mode ?? '') + '), total ' + total +
      '. Stripe session ' + (s.id ?? '') + '. Next: create the HomeSight account, assign a Hub from the shelf ' +
      '(runbook above), record the serial in the device tracker, and ship. Check the Support tab for an add-ons ticket from this order.',
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { error } = await supabase.rpc('upsert_app_data_item', { target_key: 'hometogether_orders', item: order })
  if (error) return json({ error: error.message }, 500)
  return json({ received: true, order_id: order.id })
})
