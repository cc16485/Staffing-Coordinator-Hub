// Supabase Edge Function: ghl-thread (shared hub project)
// One person's GoHighLevel conversation, pulled into the hub.
//
// Until now, seeing what had actually been said to a lead, a client, a
// caregiver or an applicant meant leaving the hub, opening GoHighLevel,
// going to Conversations and searching for their name. So in practice
// nobody looked, and people got texted twice or not at all.
//
// Given a phone or an email, this finds their contact, pulls the recent
// messages across every channel, and hands back a plain list the hub can
// render inside the profile. Read only: it never sends anything.
//
// POST { phone?, email?, contact_id?, limit? }
//   -> { ok, contact_id, name, open_url, messages: [{ at, direction, type, body, status }] }
//
// Deploy: supabase functions deploy ghl-thread (JWT ON — hub users only).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const GHL = 'https://services.leadconnectorhq.com'
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  // Signed-in hub staff only. This reads real conversations.
  const auth = req.headers.get('Authorization') || ''
  if (!auth.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401)
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
  })
  const { data: who } = await supabase.auth.getUser()
  if (!who?.user) return json({ error: 'unauthorized' }, 401)

  const tok = Deno.env.get('GHL_TOKEN')
  const loc = Deno.env.get('GHL_LOCATION_ID')
  if (!tok || !loc) return json({ error: 'GoHighLevel is not connected on this project.' }, 503)

  let b: Row = {}
  try { b = await req.json() } catch { /* empty body is fine */ }
  const s = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n)
  const phone = s(b.phone, 40)
  const email = s(b.email, 200)
  const given = s(b.contact_id, 60)
  const limit = Math.min(50, Math.max(5, parseInt(s(b.limit), 10) || 25))
  if (!phone && !email && !given) return json({ error: 'no phone, email or contact id given' }, 400)

  const h = { Authorization: `Bearer ${tok}`, Version: '2021-07-28', Accept: 'application/json' }
  const digits = (t: string) => t.replace(/\D/g, '').slice(-10)

  // ---- find the contact ----------------------------------------------------
  let contactId = given
  let name = ''
  if (!contactId) {
    // Their own lookup endpoint is the cheap path; the search endpoint is the
    // fallback, because which one a location exposes has moved around.
    const tries = [
      email ? `${GHL}/contacts/lookup?locationId=${encodeURIComponent(loc)}&email=${encodeURIComponent(email)}` : '',
      phone ? `${GHL}/contacts/lookup?locationId=${encodeURIComponent(loc)}&phone=${encodeURIComponent(phone)}` : '',
      `${GHL}/contacts/?locationId=${encodeURIComponent(loc)}&query=${encodeURIComponent(email || phone)}&limit=20`,
    ].filter(Boolean)
    for (const url of tries) {
      try {
        const r = await fetch(url, { headers: h })
        if (!r.ok) continue
        const j = await r.json().catch(() => ({}))
        const list: Row[] = j?.contacts ?? (j?.contact ? [j.contact] : [])
        const hit = list.find((c) =>
          (email && String(c.email || '').toLowerCase() === email.toLowerCase()) ||
          (phone && digits(String(c.phone || '')) === digits(phone))) ?? list[0]
        if (hit?.id) {
          contactId = hit.id
          name = [hit.firstName, hit.lastName].filter(Boolean).join(' ') || hit.contactName || ''
          break
        }
      } catch { /* try the next shape */ }
    }
  }
  if (!contactId) {
    return json({
      ok: true, contact_id: '', name: '', messages: [],
      note: 'Nobody in GoHighLevel matches that phone or email yet.',
    })
  }

  const openUrl = `https://app.hirecara.com/v2/location/${loc}/contacts/detail/${contactId}`

  // ---- their conversations -------------------------------------------------
  let convos: Row[] = []
  try {
    const r = await fetch(
      `${GHL}/conversations/search?locationId=${encodeURIComponent(loc)}&contactId=${encodeURIComponent(contactId)}&limit=10`,
      { headers: h })
    if (r.ok) convos = (await r.json())?.conversations ?? []
  } catch { /* handled below */ }
  if (!convos.length) {
    return json({ ok: true, contact_id: contactId, name, open_url: openUrl, messages: [],
      note: 'They are in GoHighLevel, but there is no conversation with them yet.' })
  }

  // ---- the messages inside them -------------------------------------------
  const TYPE: Record<number, string> = {
    1: 'SMS', 2: 'Email', 3: 'Voicemail', 4: 'Call', 5: 'Call', 25: 'Call',
    19: 'Note', 20: 'Facebook', 21: 'Instagram', 26: 'WhatsApp', 29: 'Live chat',
  }
  const out: Row[] = []
  for (const c of convos.slice(0, 5)) {
    try {
      const r = await fetch(`${GHL}/conversations/${c.id}/messages?limit=${limit}`, { headers: h })
      if (!r.ok) continue
      const body = await r.json().catch(() => ({}))
      const msgs: Row[] = body?.messages?.messages ?? body?.messages ?? []
      for (const m of msgs) {
        const kind = TYPE[Number(m.type)] ?? (m.messageType ? String(m.messageType).replace(/^TYPE_/, '') : 'Message')
        let text = s(m.body, 4000)
        if (!text && kind === 'Call') text = m.meta?.call?.status ? `Call (${m.meta.call.status})` : 'Call'
        if (!text && m.attachments?.length) text = `[${m.attachments.length} attachment(s)]`
        out.push({
          at: m.dateAdded ?? m.dateUpdated ?? '',
          direction: m.direction === 'inbound' ? 'in' : 'out',
          type: kind,
          body: text,
          status: s(m.status, 40),
        })
      }
    } catch { /* one bad conversation must not lose the rest */ }
  }

  out.sort((a, x) => String(x.at).localeCompare(String(a.at)))
  return json({
    ok: true,
    contact_id: contactId,
    name,
    open_url: openUrl,
    messages: out.slice(0, limit),
  })
})
