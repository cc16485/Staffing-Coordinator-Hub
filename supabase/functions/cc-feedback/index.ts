// Supabase Edge Function: cc-feedback (shared hub project)
// Receives star check-ins and Caregiver of the Year nominations from the
// public feedback pages, stores them in app_data key "feedback" (so the hub's
// Feedback tab can show them), and emails Samantha through the GHL pipe.
// Deploy: dashboard editor, Verify JWT OFF. Token-gated like the other forms.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const url = new URL(req.url)
  const expected = Deno.env.get('HT_SUPPORT_TOKEN') ?? Deno.env.get('HT_ORDER_TOKEN')
  if (!expected || url.searchParams.get('token') !== expected) return json({ error: 'unauthorized' }, 401)

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  if (req.method === 'GET' && url.searchParams.get('list')) {
    const { data } = await supabase.from('app_data').select('data').eq('key', 'feedback').maybeSingle()
    const items = Array.isArray(data?.data) ? data.data : []
    return json({ count: items.length, latest: items.slice(-5) })
  }
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  // deno-lint-ignore no-explicit-any
  let b: Record<string, any> = {}
  try { b = await req.json() } catch { return json({ error: 'bad payload' }, 400) }
  const s = (v: unknown, n = 500) => String(v ?? '').trim().slice(0, n)

  const kind = s(b.kind) === 'nomination' ? 'nomination' : 'rating'
  const rating = Math.min(5, Math.max(0, parseInt(s(b.rating), 10) || 0))
  if (kind === 'rating' && !rating) return json({ error: 'rating required' }, 400)

  const item = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    kind,
    rating: kind === 'rating' ? rating : null,
    who: s(b.who, 40) || 'client family',
    name: s(b.name, 120),
    contact: s(b.contact, 200),
    message: s(b.message, 2000),
    caregiver: s(b.caregiver, 120),
    partial: !!b.partial, // star tapped in the email but form never submitted
    seen: false,
  }
  const { error } = await supabase.rpc('upsert_app_data_item', { target_key: 'feedback', item })
  if (error) return json({ error: error.message }, 500)

  // Email Samantha through GHL (best effort — storage already succeeded).
  let notified = false
  const ghlToken = Deno.env.get('GHL_TOKEN')
  const ghlLocation = Deno.env.get('GHL_LOCATION_ID')
  if (ghlToken && ghlLocation) {
    try {
      const h = { Authorization: `Bearer ${ghlToken}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' }
      const up = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
        method: 'POST', headers: h,
        body: JSON.stringify({ locationId: ghlLocation, email: 'samantha@mo-care.com', firstName: 'Samantha' }),
      })
      const contactId = (await up.json().catch(() => ({})))?.contact?.id
      if (contactId) {
        const starRow = (n: number) => '★★★★★☆☆☆☆☆'.slice(5 - n, 10 - n)
        const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')
        const subject = kind === 'nomination'
          ? '🏆 Caregiver of the Year nomination: ' + (item.caregiver || '(unnamed)')
          : starRow(rating) + ' ' + rating + '-star check-in' + (item.name ? ' from ' + item.name : '') + ' (' + item.who + ')' + (item.partial ? ' (star tap only)' : '')
        const html = '<div style="font-family:Arial,sans-serif;font-size:15px;color:#16283a;line-height:1.6;">'
          + (kind === 'rating' ? '<p style="font-size:28px;letter-spacing:3px;color:#F0A63A;margin:0 0 8px;">' + starRow(rating) + '</p>' : '<p style="font-size:30px;margin:0 0 8px;">🏆</p>')
          + (item.caregiver ? '<p><b>Caregiver nominated:</b> ' + esc(item.caregiver) + '</p>' : '')
          + (item.name ? '<p><b>Name:</b> ' + esc(item.name) + '</p>' : '<p><i>No name given.</i></p>')
          + (item.contact ? '<p><b>Contact:</b> ' + esc(item.contact) + '</p>' : '')
          + (item.message ? '<p><b>Message:</b><br>' + esc(item.message) + '</p>' : '')
          + (kind === 'rating' && rating <= 3 ? '<p style="color:#a33;"><b>Low rating. A personal follow-up call is worth it.</b></p>' : '')
          + '<p style="color:#55677a;font-size:13px;">Also saved to the hub → Campaigns → Feedback tab.</p></div>'
        const sr = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
          method: 'POST', headers: h,
          body: JSON.stringify({ type: 'Email', contactId, subject, html }),
        })
        notified = sr.ok
      }
    } catch { /* stored fine; email is best effort */ }
  }
  return json({ ok: true, id: item.id, notified })
})
