// Supabase Edge Function: ht-local (shared hub project)
// -----------------------------------------------------------------------------
// Live sign-ups for HomeTogether Local (concierge caregiver matching).
//
//   POST ?token=...  {kind:'caregiver', ...}  -> app_data 'local_caregivers'
//   POST ?token=...  {kind:'family',    ...}  -> app_data 'local_families'
//
// Concierge model: nothing becomes public. The team reviews caregivers
// (interview + background check) and personally introduces matches. Both
// sides get a confirmation email; Samantha gets a notification.
// Managed in the Care Coordinator Hub -> HomeTogether -> Local tab.
// Uses the existing HT_ORDER_TOKEN secret; no new secrets needed.
// Also: background-check automation (Phase A):
//   POST {kind:'paylink', caregiver_id}  (hub) -> $45 Stripe Checkout link emailed
//   POST + Checkr webhook (?src=checkr)  -> auto status on report results
// Secrets used: STRIPE_SECRET_KEY (exists), CHECKR_API_KEY, CHECKR_PACKAGE,
// CHECKR_WEBHOOK_SECRET (all optional: without them the pipeline degrades to
// clearly-labeled manual steps in the hub, never silent failure).
// Deploy (CLI): supabase functions deploy ht-local --no-verify-jwt
// -----------------------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const clean = (v: unknown, n: number) => String(v ?? '').replace(/<[^>]*>/g, '').trim().slice(0, n)
const esc = (t: string) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')

async function ghlEmail(to: string, firstName: string, subject: string, html: string): Promise<boolean> {
  const ghlToken = Deno.env.get('GHL_TOKEN')
  const ghlLocation = Deno.env.get('GHL_LOCATION_ID')
  if (!ghlToken || !ghlLocation || !to) return false
  try {
    const h = { Authorization: `Bearer ${ghlToken}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' }
    const up = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
      method: 'POST', headers: h,
      body: JSON.stringify({ locationId: ghlLocation, email: to, firstName }),
    })
    const contactId = (await up.json().catch(() => ({})))?.contact?.id
    if (!contactId) return false
    const sr = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
      method: 'POST', headers: h,
      body: JSON.stringify({ type: 'Email', contactId, subject, html }),
    })
    return sr.ok
  } catch { return false }
}

async function loadItems(supabase: ReturnType<typeof createClient>, key: string) {
  const { data } = await supabase.from('app_data').select('data').eq('key', key).maybeSingle()
  return Array.isArray(data?.data) ? data.data : []
}

async function checkrHmacOk(payload: string, sig: string): Promise<boolean> {
  const secret = Deno.env.get('CHECKR_WEBHOOK_SECRET')
  if (!secret) return true // not configured yet: accept (endpoint is still token-gated)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  const hex = Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('')
  return hex === sig
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const url = new URL(req.url)
  const expected = Deno.env.get('HT_ORDER_TOKEN') ?? Deno.env.get('HT_SUPPORT_TOKEN')
  if (!expected || url.searchParams.get('token') !== expected) return json({ error: 'unauthorized' }, 401)
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // ---------- Checkr webhook (?src=checkr) ----------
  if (url.searchParams.get('src') === 'checkr') {
    const raw = await req.text()
    const sig = req.headers.get('x-checkr-signature') || ''
    if (!(await checkrHmacOk(raw, sig))) return json({ error: 'bad signature' }, 400)
    // deno-lint-ignore no-explicit-any
    let ev: any = {}
    try { ev = JSON.parse(raw) } catch { return json({ error: 'bad payload' }, 400) }
    const type = String(ev.type || '')
    // deno-lint-ignore no-explicit-any
    const obj: any = ev.data?.object ?? {}
    if (type === 'report.completed' || type === 'report.updated') {
      const candId = String(obj.candidate_id || '')
      const result = String(obj.result || obj.assessment || '')
      const items = await loadItems(supabase, 'local_caregivers')
      // deno-lint-ignore no-explicit-any
      const c: any = items.find((x: any) => x?.checkr_candidate_id === candId)
      if (c) {
        c.checkr_result = result
        c.checkr_report_id = String(obj.id || '')
        if (result === 'clear') {
          c.status = 'cleared'
          c.notes = ((c.notes || '') + '\nBackground check CLEAR (' + new Date().toLocaleDateString('en-US') + ').').trim()
        } else {
          c.consider = true
          c.notes = ((c.notes || '') + '\nBackground check returned CONSIDER. Review the report in Checkr. If declining based on it, use Checkr\u2019s adverse-action flow (FCRA requirement). Do not auto-decline.').trim()
        }
        c.seen = false
        await supabase.rpc('upsert_app_data_item', { target_key: 'local_caregivers', item: c })
        await ghlEmail('samantha@mo-care.com', 'Samantha',
          (result === 'clear' ? '\u2705' : '\u26a0\ufe0f') + ' HT Local background check: ' + (c.name || candId) + ' \u2192 ' + (result || type),
          '<div style="font-family:Arial,sans-serif;font-size:15px;color:#16283a;line-height:1.6;"><p><b>' + esc(c.name || '') + '</b>: report result <b>' + esc(result || 'see Checkr') + '</b>.</p>'
          + (result === 'clear' ? '<p>Status moved to <b>cleared</b>. Next: the interview step, then activate.</p>' : '<p style="color:#a33;"><b>CONSIDER:</b> review in Checkr. If declining based on the report, FCRA requires the adverse-action process (built into Checkr). Never auto-decline.</p>')
          + '<p style="color:#55677a;font-size:13px;">Care Coordinator Hub \u2192 HomeTogether \u2192 Local.</p></div>')
      }
    }
    return json({ received: true })
  }

  // deno-lint-ignore no-explicit-any
  let b: Record<string, any> = {}
  try { b = await req.json() } catch { return json({ error: 'bad payload' }, 400) }
  if (b.website) return json({ ok: true }) // honeypot

  const kind = clean(b.kind, 20)

  if (kind === 'caregiver') {
    const item = {
      id: crypto.randomUUID(), at: new Date().toISOString(),
      name: clean(b.name, 120), email: clean(b.email, 200), phone: clean(b.phone, 40),
      city: clean(b.city, 120), area: clean(b.area, 200),
      years: clean(b.years, 40), rate: clean(b.rate, 40),
      skills: (Array.isArray(b.skills) ? b.skills : []).map((s: unknown) => clean(s, 60)).slice(0, 20),
      certs: (Array.isArray(b.certs) ? b.certs : []).map((s: unknown) => clean(s, 60)).slice(0, 20),
      avail: (Array.isArray(b.avail) ? b.avail : []).map((s: unknown) => clean(s, 40)).slice(0, 14),
      bio: clean(b.bio, 2000),
      status: 'applied', notes: '', seen: false,
    }
    if (!item.name || (!item.email && !item.phone)) return json({ error: 'Name plus an email or phone are required so we can reach you.' }, 400)
    const { error } = await supabase.rpc('upsert_app_data_item', { target_key: 'local_caregivers', item })
    if (error) return json({ error: error.message }, 500)

    await ghlEmail('samantha@mo-care.com', 'Samantha',
      '🧡 HomeTogether Local: new CAREGIVER application, ' + item.name,
      '<div style="font-family:Arial,sans-serif;font-size:15px;color:#16283a;line-height:1.6;">'
      + '<p><b>' + esc(item.name) + '</b> · ' + esc(item.city) + (item.years ? ' · ' + esc(item.years) + ' yrs' : '') + (item.rate ? ' · ' + esc(item.rate) + '/hr' : '') + '</p>'
      + '<p>' + esc(item.phone) + (item.email ? ' · ' + esc(item.email) : '') + '</p>'
      + (item.skills.length ? '<p><b>Skills:</b> ' + esc(item.skills.join(', ')) + '</p>' : '')
      + (item.certs.length ? '<p><b>Certs:</b> ' + esc(item.certs.join(', ')) + '</p>' : '')
      + (item.bio ? '<p><b>Bio:</b> ' + esc(item.bio) + '</p>' : '')
      + '<p style="color:#55677a;font-size:13px;">Review in the Care Coordinator Hub → HomeTogether → Local. Next steps: call, interview, background check.</p></div>')

    if (item.email) {
      await ghlEmail(item.email, item.name.split(' ')[0] || item.name,
        'We got your HomeTogether Local application',
        '<div style="font-family:Arial,sans-serif;font-size:15px;color:#16283a;line-height:1.7;">'
        + '<p>Hi ' + esc(item.name.split(' ')[0] || item.name) + ',</p>'
        + '<p>Thanks for applying to HomeTogether Local. A real person from our Springfield team reviews every application, and we&rsquo;ll call you within 2 business days.</p>'
        + '<p><b>What happens next:</b><br>1. A short phone chat about your experience and what you&rsquo;re looking for<br>2. An interview (video or in person)<br>3. A background check, we cover the cost<br>4. We start personally introducing you to families near you</p>'
        + '<p>No fees, no commissions during our founding period. Questions? Just reply, or call <a href="tel:14172348494">(417) 234-8494</a>.</p>'
        + '<p>Warmly,<br>The HomeTogether Local team</p></div>')
    }
    return json({ ok: true, id: item.id })
  }

  if (kind === 'family') {
    const item = {
      id: crypto.randomUUID(), at: new Date().toISOString(),
      name: clean(b.name, 120), email: clean(b.email, 200), phone: clean(b.phone, 40),
      zip: clean(b.zip, 120), who: clean(b.who, 60),
      care: (Array.isArray(b.care) ? b.care : []).map((s: unknown) => clean(s, 60)).slice(0, 20),
      freq: clean(b.freq, 60), notes: clean(b.notes, 2000),
      status: 'new', team_notes: '', seen: false,
    }
    if (!item.name || (!item.email && !item.phone)) return json({ error: 'Name plus an email or phone are required so we can reach you.' }, 400)
    const { error } = await supabase.rpc('upsert_app_data_item', { target_key: 'local_families', item })
    if (error) return json({ error: error.message }, 500)

    await ghlEmail('samantha@mo-care.com', 'Samantha',
      '🏡 HomeTogether Local: new FAMILY request, ' + item.name + ' (' + (item.zip || 'area n/a') + ')',
      '<div style="font-family:Arial,sans-serif;font-size:15px;color:#16283a;line-height:1.6;">'
      + '<p><b>' + esc(item.name) + '</b> · ' + esc(item.zip) + '</p>'
      + '<p>' + esc(item.phone) + (item.email ? ' · ' + esc(item.email) : '') + '</p>'
      + '<p><b>Care for:</b> ' + esc(item.who || '—') + '<br><b>Needs:</b> ' + esc(item.care.join(', ') || '—') + '<br><b>Frequency:</b> ' + esc(item.freq || '—') + '</p>'
      + (item.notes ? '<p><b>Notes:</b> ' + esc(item.notes) + '</p>' : '')
      + '<p style="color:#55677a;font-size:13px;">Review in the Care Coordinator Hub → HomeTogether → Local. Concierge promise: personal introduction within 2 business days.</p></div>')

    if (item.email) {
      await ghlEmail(item.email, item.name.split(' ')[0] || item.name,
        'Your HomeTogether Local request is in',
        '<div style="font-family:Arial,sans-serif;font-size:15px;color:#16283a;line-height:1.7;">'
        + '<p>Hi ' + esc(item.name.split(' ')[0] || item.name) + ',</p>'
        + '<p>Your request is with our team, a real person, not a bot. Here&rsquo;s how HomeTogether Local works:</p>'
        + '<p>1. A coordinator from our Springfield office calls you, usually within 2 business days<br>2. We hand-pick caregivers near ' + esc(item.zip || 'you') + ' who fit your needs, every one interviewed and background-checked by us first<br>3. We introduce you personally. You talk, you choose, you hire directly<br>4. Talking to your matches is free. No subscription, ever.</p>'
        + '<p>Need care sooner? Call us right now: <a href="tel:14172348494">(417) 234-8494</a>, available 24/7.</p>'
        + '<p>Warmly,<br>The HomeTogether Local team</p></div>')
    }
    return json({ ok: true, id: item.id })
  }

  if (kind === 'paylink') {
    const cid = clean(b.caregiver_id, 40)
    const items = await loadItems(supabase, 'local_caregivers')
    // deno-lint-ignore no-explicit-any
    const c: any = items.find((x: any) => x?.id === cid)
    if (!c) return json({ error: 'caregiver not found' }, 404)
    if (!c.email) return json({ error: 'This caregiver has no email on file; collect one first.' }, 400)
    const sk = Deno.env.get('STRIPE_SECRET_KEY')
    if (!sk) return json({ error: 'Stripe not configured' }, 500)

    const form = new URLSearchParams()
    form.set('mode', 'payment')
    form.set('customer_email', c.email)
    form.set('line_items[0][quantity]', '1')
    form.set('line_items[0][price_data][currency]', 'usd')
    form.set('line_items[0][price_data][unit_amount]', '4500')
    form.set('line_items[0][price_data][product_data][name]', 'HomeTogether Local Background Check')
    form.set('line_items[0][price_data][product_data][description]', 'One-time background check for your caregiver profile. Runs through Checkr; results typically in 1-3 business days.')
    form.set('metadata[hl_caregiver_id]', c.id)
    form.set('payment_intent_data[metadata][hl_caregiver_id]', c.id)
    form.set('success_url', 'https://tryhometogether.com/local.html#checkpaid')
    form.set('cancel_url', 'https://tryhometogether.com/local.html')
    const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + sk, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    })
    // deno-lint-ignore no-explicit-any
    const sess: any = await resp.json()
    if (!resp.ok || !sess.url) return json({ error: 'Stripe: ' + (sess?.error?.message || resp.status) }, 500)

    c.status = 'background check'
    c.pay_link_sent = new Date().toISOString()
    c.notes = ((c.notes || '') + '\n$45 check payment link sent ' + new Date().toLocaleDateString('en-US') + '.').trim()
    await supabase.rpc('upsert_app_data_item', { target_key: 'local_caregivers', item: c })

    await ghlEmail(c.email, (c.name || '').split(' ')[0] || 'there',
      'Your HomeTogether Local background check, next step',
      '<div style="font-family:Arial,sans-serif;font-size:15px;color:#16283a;line-height:1.7;">'
      + '<p>Hi ' + esc((c.name || '').split(' ')[0] || 'there') + ',</p>'
      + '<p>Great news: you\u2019re moving to the background-check step. It\u2019s a one-time <b>$45</b>, paid securely through Stripe, and it covers the full check (run through Checkr, the same service national companies use).</p>'
      + '<p style="margin:18px 0;"><a href="' + sess.url + '" style="background:#E9A13B;color:#123;padding:14px 26px;border-radius:999px;text-decoration:none;font-weight:700;">Pay for my background check \u2192</a></p>'
      + '<p>After payment, watch your email for a message from Checkr to complete your details. Results usually take 1-3 business days, and your \u2713 badge activates when it clears.</p>'
      + '<p>Questions? Reply here or call <a href="tel:14172348494">(417) 234-8494</a>.</p><p>Warmly,<br>The HomeTogether Local team</p></div>')
    return json({ ok: true, link: sess.url })
  }

  return json({ error: 'unknown kind' }, 400)
})
