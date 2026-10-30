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
//   -> { ok, v: 2, contact_id, name, open_url, messages: [{ id, at, direction, type, body, status, call? }] }
//      call (calls and voicemails only): { status, duration_s, recording: true when there may be one to play }
// POST { recording: <message id> }      -> the call or voicemail recording itself (audio), for the profile's Listen button
// POST { transcription: <message id> }  -> { ok, text } GoHighLevel's words for that call, '' when it has none
//
// 2026-10-30 (Samantha: "put the text, voicemail, etc right there in the communication tab"): the kind of each message
// now comes from GoHighLevel's own name for it (messageType, e.g. TYPE_SMS). The numbers this used before were one off:
// calls showed as blank "SMS", texts as "Email", emails as "Voicemail".
//
// Deploy: supabase functions deploy ghl-thread (JWT ON — hub users only).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'

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

  /* Office members of Caring Companions only: this reads real conversations. Slice 1 (2026-10-10): it used to accept
     any signed-in account on the shared project. */
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const who = await requireStaff(admin, req, OFFICE_ROLES)
  if (!who.ok) return json({ error: who.error }, who.status)

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
  const h = { Authorization: `Bearer ${tok}`, Version: '2021-07-28', Accept: 'application/json' }

  // ---- one call's recording or words (office only, read only; the same conversations this reads anyway) ----
  const recId = s(b.recording, 60), trId = s(b.transcription, 60)
  if (recId || trId) {
    const id = recId || trId
    if (!/^[A-Za-z0-9_-]{6,60}$/.test(id)) return json({ error: 'that is not a GoHighLevel message id' }, 400)
    try {
      if (recId) {
        const r = await fetch(`${GHL}/conversations/messages/${id}/locations/${encodeURIComponent(loc)}/recording`, { headers: { ...h, Accept: '*/*' } })
        if (!r.ok) return json({ ok: false, error: r.status === 404 ? 'GoHighLevel has no recording of this call.' : `GoHighLevel answered ${r.status}.` }, r.status === 404 ? 404 : 502)
        const type = r.headers.get('content-type') || 'audio/wav'
        if (/json|html/.test(type)) return json({ ok: false, error: 'GoHighLevel has no recording of this call.' }, 404)
        return new Response(r.body, { status: 200, headers: { ...cors, 'Content-Type': type, 'Cache-Control': 'private, no-store' } })
      }
      const r = await fetch(`${GHL}/conversations/locations/${encodeURIComponent(loc)}/messages/${id}/transcription`, { headers: h })
      if (r.status === 404 || r.status === 400) return json({ ok: true, text: '' })
      if (!r.ok) return json({ ok: false, error: `GoHighLevel answered ${r.status}.` }, 502)
      const j = await r.json().catch(() => null)
      const parts: Row[] = Array.isArray(j) ? j : (j?.transcriptions ?? j?.data ?? [])
      const text = parts.map((p) => s(p.transcript ?? p.text, 2000)).filter(Boolean).join(' ').slice(0, 8000)
      return json({ ok: true, text })
    } catch (e) { return json({ ok: false, error: 'Could not reach GoHighLevel: ' + String((e as Error)?.message || e).slice(0, 120) }, 502) }
  }

  if (!phone && !email && !given) return json({ error: 'no phone, email or contact id given' }, 400)
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
  /* GoHighLevel's own names first; its numbers only when a message has no name (1 call, 2 text, 3 email) */
  const KIND: Record<string, string> = {
    TYPE_SMS: 'SMS', TYPE_CAMPAIGN_SMS: 'SMS', TYPE_CAMPAIGN_MANUAL_SMS: 'SMS', TYPE_CUSTOM_SMS: 'SMS', TYPE_CUSTOM_PROVIDER_SMS: 'SMS',
    TYPE_SMS_REVIEW_REQUEST: 'SMS', TYPE_SMS_NO_SHOW_REQUEST: 'SMS',
    TYPE_EMAIL: 'Email', TYPE_CAMPAIGN_EMAIL: 'Email', TYPE_CUSTOM_EMAIL: 'Email', TYPE_CUSTOM_PROVIDER_EMAIL: 'Email',
    TYPE_CALL: 'Call', TYPE_IVR_CALL: 'Call', TYPE_CAMPAIGN_CALL: 'Call', TYPE_CAMPAIGN_MANUAL_CALL: 'Call',
    TYPE_VOICEMAIL: 'Voicemail', TYPE_CAMPAIGN_VOICEMAIL: 'Voicemail',
    TYPE_WHATSAPP: 'WhatsApp', TYPE_FACEBOOK: 'Facebook', TYPE_CAMPAIGN_FACEBOOK: 'Facebook', TYPE_INSTAGRAM: 'Instagram',
    TYPE_LIVE_CHAT: 'Live chat', TYPE_WEBCHAT: 'Live chat', TYPE_INTERNAL_COMMENT: 'Note',
  }
  const BY_NUMBER: Record<number, string> = { 1: 'Call', 2: 'SMS', 3: 'Email' }
  const kindOf = (m: Row) => {
    const t = String(m.messageType || '')
    return KIND[t] ?? (t ? t.replace(/^TYPE_/, '').replace(/^ACTIVITY_.*/, 'Activity') : BY_NUMBER[Number(m.type)] ?? 'Message')
  }
  const out: Row[] = []
  for (const c of convos.slice(0, 5)) {
    try {
      const r = await fetch(`${GHL}/conversations/${c.id}/messages?limit=${limit}`, { headers: h })
      if (!r.ok) continue
      const body = await r.json().catch(() => ({}))
      const msgs: Row[] = body?.messages?.messages ?? body?.messages ?? []
      for (const m of msgs) {
        const kind = kindOf(m)
        let text = s(m.body, 4000)
        const callish = kind === 'Call' || kind === 'Voicemail'
        const cs = s(m.meta?.call?.status || m.status, 40)
        if (!text && kind === 'Call') text = cs ? `Call (${cs})` : 'Call'
        if (!text && m.attachments?.length) text = `[${m.attachments.length} attachment(s)]`
        const dur = Number(m.meta?.call?.duration ?? m.meta?.duration ?? 0) || 0
        out.push({
          id: s(m.id, 60),
          at: m.dateAdded ?? m.dateUpdated ?? '',
          direction: m.direction === 'inbound' ? 'in' : 'out',
          type: kind,
          body: text,
          status: s(m.status, 40),
          ...(callish ? { call: { status: cs, duration_s: dur, recording: kind === 'Voicemail' || dur > 0 || /voicemail|completed/i.test(cs) } } : {}),
        })
      }
    } catch { /* one bad conversation must not lose the rest */ }
  }

  out.sort((a, x) => String(x.at).localeCompare(String(a.at)))
  return json({
    ok: true,
    v: 2,
    contact_id: contactId,
    name,
    open_url: openUrl,
    messages: out.slice(0, limit),
  })
})
