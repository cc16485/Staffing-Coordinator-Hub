// Supabase Edge Function: hometogether-order (shared hub project)
// -----------------------------------------------------------------------------
// The HomeTogether "Set up your HomeTogether" order form (order.html) posts here.
// Each submission does two things in the shared hub:
//   1. Stores the full order + "getting to know them" profile under the
//      `hometogether_orders` collection, so the caregiver has real topics to
//      talk about before the very first visit.
//   2. Creates a lead in the CC pipeline so a coordinator is alerted right away
//      (follow-up clock starts today), and can confirm the order + ship the box.
//
// Public form endpoint: deployed with --no-verify-jwt (forms can't sign in),
// gated by a light token in the URL: ?token=<HT_ORDER_TOKEN>. The token is
// anti-spam, not a secret. Accepts JSON or a normal form post.
//
// Secret:  HT_ORDER_TOKEN   (Samantha sets this in Supabase → Edge Functions → Secrets)
// Deploy:  supabase functions deploy hometogether-order --no-verify-jwt --project-ref zngsgedlsxinbygwmxwn
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
  const expected = Deno.env.get('HT_ORDER_TOKEN')
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

  const s = (v: unknown, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const arr = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)).slice(0, 40) : [])

  const seniorName = s(body.sr_name)
  const buyerName = s(body.you_name)
  if (!seniorName && !buyerName) return json({ error: 'submission had no names' }, 400)

  const now = new Date().toISOString()
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
  const orderId = crypto.randomUUID()

  // 1) The full order + care profile (private, for the care team).
  const order = {
    id: orderId,
    created_at: now,
    status: 'New order',
    // who's setting it up
    buyer_name: buyerName,
    buyer_relationship: s(body.you_rel),
    buyer_phone: s(body.you_phone),
    buyer_email: s(body.you_email),
    buyer_reach: s(body.you_reach),
    // who it's for
    senior_name: seniorName,
    senior_preferred: s(body.sr_pref),
    senior_age: s(body.sr_age, 8),
    senior_phone: s(body.sr_phone),
    ship_street: s(body.ship_street),
    ship_city: s(body.ship_city),
    ship_state: s(body.ship_state, 40),
    ship_zip: s(body.ship_zip, 12),
    living: s(body.sr_living),
    wifi: s(body.sr_wifi),
    tv_hdmi: s(body.sr_tv),
    // emergency & care contacts
    emergency1_name: s(body.ec1_name),
    emergency1_phone: s(body.ec1_phone),
    emergency1_rel: s(body.ec1_rel),
    emergency2_name: s(body.ec2_name),
    emergency2_phone: s(body.ec2_phone),
    doctor_name: s(body.doc_name),
    doctor_phone: s(body.doc_phone),
    approved_callers: s(body.approved),
    // care & visits
    care_tasks: arr(body.care),
    visit_times: arr(body.times),
    call_answer: s(body.answer),
    medications: s(body.meds),
    health_notes: s(body.health),
    allergies: s(body.allergies),
    // getting to know them
    interests: s(body.interests),
    work_life: s(body.work),
    family_pets: s(body.family),
    roots: s(body.roots),
    faith: s(body.faith),
    favorites: s(body.favorites),
    loves_talking_about: s(body.love_topics),
    avoid_topics: s(body.avoid_topics),
    anything_else: s(body.anything),
  }

  // 2) A coordinator-facing lead so someone is alerted and follows up.
  const parts = (buyerName || '').split(/\s+/)
  const notes = [
    `HomeTogether order for ${seniorName || '(senior)'}${order.senior_preferred ? ` ("${order.senior_preferred}")` : ''}.`,
    `Ship to: ${order.ship_street}, ${order.ship_city}, ${order.ship_state} ${order.ship_zip}`.trim(),
    order.wifi ? `Wi‑Fi: ${order.wifi}` : '',
    order.care_tasks.length ? `Visits: ${order.care_tasks.join(', ')}` : '',
    order.emergency1_name ? `Emergency: ${order.emergency1_name} ${order.emergency1_phone}` : '',
    `Full order + care profile is saved under HomeTogether orders (id ${orderId}).`,
  ].filter(Boolean).join('\n')

  const lead = {
    id: crypto.randomUUID(),
    first_name: parts[0] || '(HomeTogether)',
    last_name: parts.slice(1).join(' '),
    phone: order.buyer_phone,
    email: order.buyer_email,
    source: 'HomeTogether',
    status: 'New',
    interest_notes: notes,
    follow_up_due: today,
    created_at: now,
    hometogether_order_id: orderId,
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const o = await supabase.rpc('upsert_app_data_item', { target_key: 'hometogether_orders', item: order })
  if (o.error) return json({ error: o.error.message }, 500)
  // Best-effort lead alert — don't fail the order if the pipeline write hiccups.
  await supabase.rpc('upsert_app_data_item', { target_key: 'leads', item: lead })

  return json({ status: 'order received', id: orderId })
})
