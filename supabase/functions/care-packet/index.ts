// =============================================================================
// care-packet — a client's caregiver packet (Step 1, Samantha "yes start step 1", 2026-10-12)
// =============================================================================
// Samantha: "send a packet of videos and info on a client's needs to the caregivers who will work with that client"
// (first client: Dan, on hospice, bed bound, bedside commode, PureWick male external catheter, turning to prevent bed
// sores). The packet is a few short notes about the client plus how-to topics; each topic carries the videos she
// approved (the hospice nurses on The Hospice Care Plan first, BD for the PureWick). Each caregiver gets their OWN link
// and taps "I watched it and understand". An edited packet is a new version and asks everyone again.
//
// Her rulings (2026-10-12): private pay caregivers place AND empty the PureWick (Medicaid: external catheters are APC,
// flagged, unchanged); the text carries only a link, never health details (all of that is behind the link).
//
// Deployed with verify_jwt FALSE because the caregiver's page calls it without signing in. So:
//   OFFICE actions call requireStaff() (owner / care coordinator / staffing coordinator, from their own Hub sign-in):
//     'get'        {ax?, lead_id?}  -> the client's packet (or null), the active topics, and who has a link / confirmed
//     'save'       {ax?, lead_id?, client_first, about, items:[{topic, notes}], ready, base_version}
//                  -> creates or updates. Someone else's newer save is never overwritten (stale). A real change to
//                     the words or topics is a new version.
//     'link'       {packet_id, caregiver_axiscare_id} -> that caregiver's personal link (the packet must be ready and
//                  the caregiver on the roster by AxisCare id). NOTHING is texted here: in Step 1 the office copies it.
//     'topic_save' {key, title, notes, videos:[{title, url, publisher?, minutes?}]} -> owner only: the how-to library.
//     STEP 2 (Samantha "build step 2", 2026-10-12; Cara never texts on her own, so a person presses Send every time):
//     'send_draft' {packet_id, caregiver_axiscare_id} -> the exact text (link shown as "(their link)"), which kind (first /
//                  reminder / updated, or none: they already confirmed), phone last 4, opt-out, evening warning. Reads only.
//     'send'       {packet_id, caregiver_axiscare_id, send_id} -> texts THAT text from the office number: roster phone by
//                  AxisCare id (never from the browser), the outbound gate (phone identity + the universal opt-out check),
//                  GoHighLevel; a refusal or failure is on Needs Attention (no silent failures). Switch:
//                  ops_settings.care_packet_send_live (Owners Hub Admin page). A repeat send_id is answered "already_sent".
//   CAREGIVER actions need only their link (i, e, t):
//     'view'  -> what their page shows. Opening the page changes nothing (phones preview links on their own).
//     'ack'   {version} -> "I watched it and understand" for that version (only the current one).
// The only texts are Step 2's three (packetText); the caller never supplies wording. Nothing emails anyone.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { opEvent } from '../_shared/events.ts'
import { checkLink, linkExpiry, makeLink, newRecipientId } from '../_shared/packet-links.ts'
import { contactForOutbound, maySendTo, normalisePhone } from '../_shared/outreach.ts'
import { ghlSendChecked } from '../_shared/send-problems.ts'
import { withStop } from '../_shared/text-consent.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
// deno-lint-ignore no-explicit-any
type Any = any

export const MAX_ABOUT = 2000, MAX_NOTES = 2000, MAX_ITEMS = 12, MAX_VIDEOS = 8
export const BAD_LINK = 'This link is not valid or has expired. Please call the office at (417) 234-8494 for a new one.'

/* Samantha: never an em dash in anything a person reads. */
export function noDash(s: unknown): string {
  return String(s ?? '').replace(/\s*[—―]\s*/g, ', ').replace(/ ,/g, ',').replace(/,\s*,/g, ',')
    .replace(/,\s*([.!?])/g, '$1').replace(/[ \t]{2,}/g, ' ')
}
/* Free text from a person: control characters out (new lines kept), no em dashes, length-capped. */
export function cleanLong(v: unknown, n: number): string {
  return noDash(String(v ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f<>]/g, ' '))
    .replace(/\n{3,}/g, '\n\n').trim().slice(0, n).trim()
}
const clean = (v: unknown, n = 80) => noDash(String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, n)
const firstOf = (s: unknown) => clean(s, 40).split(' ')[0] || ''

/** The client's key: their AxisCare id once they are a client, otherwise the lead. */
export function clientKey(ax: unknown, lead: unknown): string | null {
  const a = String(ax ?? '').trim(), l = String(lead ?? '').trim()
  if (a && /^[A-Za-z0-9_.-]{1,80}$/.test(a)) return 'ax:' + a
  if (l && /^[A-Za-z0-9_.-]{1,80}$/.test(l)) return 'lead:' + l
  return null
}

export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url), h = u.hostname.replace(/^www\.|^m\./, '')
    let id = ''
    if (h === 'youtu.be') id = u.pathname.slice(1)
    else if (h === 'youtube.com' || h === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v') || ''
      else { const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/); id = m ? m[1] : '' }
    }
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null
  } catch { return null }
}
export function cleanVideos(v: unknown): { ok: true; videos: Any[] } | { ok: false; error: string } {
  if (!Array.isArray(v)) return { ok: false, error: 'Videos must be a list.' }
  if (v.length > MAX_VIDEOS) return { ok: false, error: `At most ${MAX_VIDEOS} videos on one topic.` }
  const out = []
  for (const x of v) {
    const url = String(x?.url ?? '').trim()
    let u: URL
    try { u = new URL(url) } catch { return { ok: false, error: `Not a web address: ${url.slice(0, 80)}` } }
    if (u.protocol !== 'https:') return { ok: false, error: `Videos must be https links: ${url.slice(0, 80)}` }
    const title = clean(x?.title, 120)
    if (!title) return { ok: false, error: 'Every video needs a title.' }
    out.push({ title, url: u.toString(), publisher: clean(x?.publisher, 80), minutes: Number.isFinite(Number(x?.minutes)) && Number(x.minutes) > 0 ? Math.round(Number(x.minutes)) : null })
  }
  return { ok: true, videos: out }
}
export function vimeoId(url: string): string | null {
  try {
    const u = new URL(url), h = u.hostname.replace(/^www\./, '')
    const m = h === 'vimeo.com' ? u.pathname.match(/^\/(\d{6,12})\/?$/) : h === 'player.vimeo.com' ? u.pathname.match(/^\/video\/(\d{6,12})\/?$/) : null
    return m ? m[1] : null
  } catch { return null }
}
/** Where the page's player points: YouTube (privacy-enhanced) or Vimeo play on the page; anything else opens as a link. */
export function embedOf(url: string): string | null {
  const y = youtubeId(url); if (y) return `https://www.youtube-nocookie.com/embed/${y}?rel=0`
  const v = vimeoId(url); if (v) return `https://player.vimeo.com/video/${v}?dnt=1`
  return null
}
export const withEmbed = (v: Any) => ({ ...v, embed: embedOf(v.url) })

/** Has the packet's content (what a caregiver reads) changed? Then it is a new version. */
export const contentOf = (p: Any) => JSON.stringify({ client_first: p.client_first ?? '', about: p.about ?? '', items: p.items ?? [] })

/* Step 2 (2026-10-12): the three texts, in one place so the card's preview and the send can never differ. No health
   details: the client's first name and the link only. Her rule: no em dashes. */
export const KIND_WORDS: Record<string, string> = { first: 'first text', reminder: 'reminder', updated: 'updated packet' }
export function packetText(kind: string, first: string, client: string, link: string): string {
  const c = client || 'your new client'
  if (kind === 'reminder') return withStop(`Hi ${first}, a reminder from Caring Companions: please watch ${c}'s care packet and tap I understand before your next visit: ${link} Questions? Call (417) 234-8494.`)
  if (kind === 'updated') return withStop(`Hi ${first}, it's Caring Companions. ${c}'s care packet was updated. Please look it over and tap I understand again: ${link} Questions? Call (417) 234-8494.`)
  return withStop(`Hi ${first}, it's Caring Companions. Before you work with ${c}, please watch this short care packet and tap I understand: ${link} Questions? Call (417) 234-8494.`)
}
/** Which text this caregiver gets now: first (never texted), updated (confirmed an older version), reminder (texted,
 *  not confirmed), or null (already confirmed this version: nothing to send). */
export function sendKind(rec: Any, version: number): string | null {
  if (rec && rec.ack_version === version) return null
  if (rec && rec.ack_version != null) return 'updated'
  if (rec && rec.last_sent_at) return 'reminder'
  return 'first'
}
/** The office's evening line, as kind-tell and team-ask warn: before 8am or from 8pm Central the card asks first. */
export function inOfficeTextHours(now = new Date()): boolean {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hourCycle: 'h23' }).format(now))
  return h >= 8 && h < 20
}
async function ensureRecipient(sb: Any, p: Any, axId: string, name: string, rec: Any, by: string): Promise<string> {
  const now = new Date().toISOString()
  if (rec?.id) {
    const { error } = await sb.from('care_packet_recipients').update({ caregiver_name: name, link_made_at: now, link_made_by: by }).eq('id', rec.id)
    if (error) throw error
    return rec.id
  }
  const id = newRecipientId()
  const { error } = await sb.from('care_packet_recipients').insert({ id, packet_id: p.id, caregiver_axiscare_id: axId, caregiver_name: name, link_made_at: now, link_made_by: by })
  if (error) throw error
  return id
}

async function findPacket(sb: Any, ax: string, lead: string): Promise<Any | null> {
  if (ax) { const { data, error } = await sb.from('care_packets').select('*').eq('axiscare_client_id', ax).limit(1); if (error) throw error; if (data?.[0]) return data[0] }
  if (lead) { const { data, error } = await sb.from('care_packets').select('*').eq('lead_id', lead).limit(1); if (error) throw error; if (data?.[0]) return data[0] }
  return null
}
async function topics(sb: Any): Promise<Any[]> {
  const { data, error } = await sb.from('care_topics').select('*').eq('active', true)
  if (error) throw error
  return (data ?? []).sort((a: Any, b: Any) => String(a.title).localeCompare(String(b.title)))
}
async function recipients(sb: Any, packetId: string): Promise<Any[]> {
  const { data, error } = await sb.from('care_packet_recipients').select('id, caregiver_axiscare_id, caregiver_name, link_made_at, link_made_by, ack_version, ack_at, last_sent_at, last_sent_by, last_send_kind, send_count').eq('packet_id', packetId)
  if (error) throw error
  return (data ?? []).sort((a: Any, b: Any) => String(a.caregiver_name).localeCompare(String(b.caregiver_name)))
}

if (typeof Deno !== 'undefined' && Deno.serve) Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only.' }, 405)
  let b: Any = {}
  try { b = await req.json() } catch { return json({ error: 'Bad request.' }, 400) }
  const action = String(b?.action ?? '')
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const SECRET = Deno.env.get('HUB_JOB_SECRET') || ''

  try {
    /* ---------------- the caregiver's page ---------------- */
    if (action === 'view' || action === 'ack') {
      if (!(await checkLink(SECRET, b))) return json({ error: BAD_LINK }, 403)
      const { data: rr, error: e1 } = await sb.from('care_packet_recipients').select('*').eq('id', String(b.i)).limit(1)
      if (e1) throw e1
      const r = rr?.[0]
      if (!r) return json({ error: BAD_LINK }, 403)
      const { data: pp, error: e2 } = await sb.from('care_packets').select('*').eq('id', r.packet_id).limit(1)
      if (e2) throw e2
      const p = pp?.[0]
      if (!p || !p.ready) return json({ error: 'This packet is being updated. Please check back soon, or call the office at (417) 234-8494.' }, 409)
      if (action === 'ack') {
        const v = Number(b.version)
        if (v !== p.version) return json({ error: 'This packet was just updated. Please look over the new version, then tap the button again.', outcome: 'changed' }, 409)
        if (r.ack_version === p.version) return json({ outcome: 'already', ack_at: r.ack_at })
        const at = new Date().toISOString()
        const { error: e3 } = await sb.from('care_packet_acks').insert({ recipient_id: r.id, packet_id: p.id, version: p.version, at })
        if (e3) throw e3
        const { error: e4 } = await sb.from('care_packet_recipients').update({ ack_version: p.version, ack_at: at }).eq('id', r.id)
        if (e4) throw e4
        await opEvent(sb, { verb: 'care_packet_understood', actor_kind: 'employee', actor_name: r.caregiver_name, actor_id: 'axiscare:' + r.caregiver_axiscare_id, via: 'link',
          item_id: 'care_packet:' + p.id, summary: `${r.caregiver_name} watched ${p.client_first || 'the client'}'s caregiver packet and confirmed they understand (version ${p.version})`,
          data: { packet_id: p.id, version: p.version, recipient_id: r.id }, outcome: 'done' })
        return json({ outcome: 'done', ack_at: at })
      }
      const byKey = new Map((await topics(sb)).map((t) => [t.key, t]))
      const items = (p.items ?? []).map((it: Any) => { const t = byKey.get(it.topic); return t ? { title: t.title, notes: it.notes || t.notes || '', videos: (t.videos ?? []).map(withEmbed) } : null }).filter(Boolean)
      return json({ caregiver_first: firstOf(r.caregiver_name), client_first: p.client_first, about: p.about, items, version: p.version,
        acknowledged: r.ack_version === p.version, ack_at: r.ack_version === p.version ? r.ack_at : null, earlier_ack: r.ack_version != null && r.ack_version !== p.version })
    }

    /* ---------------- the office ---------------- */
    const who = await requireStaff(sb, req, OFFICE_ROLES)
    if (!who.ok) return json({ error: who.error }, who.status)

    if (action === 'get') {
      const ax = String(b.ax ?? '').trim(), lead = String(b.lead_id ?? '').trim()
      if (!clientKey(ax, lead)) return json({ error: 'Which client?' }, 400)
      const p = await findPacket(sb, ax, lead)
      return json({ packet: p, topics: await topics(sb), recipients: p ? await recipients(sb, p.id) : [] })
    }

    if (action === 'save') {
      const ax = String(b.ax ?? '').trim(), lead = String(b.lead_id ?? '').trim(), key = clientKey(ax, lead)
      if (!key) return json({ error: 'Which client?' }, 400)
      if (!Array.isArray(b.items) || b.items.length > MAX_ITEMS) return json({ error: `Pick up to ${MAX_ITEMS} topics.` }, 400)
      const known = new Set((await topics(sb)).map((t) => t.key)), seen = new Set()
      const items = []
      for (const it of b.items) {
        const k = String(it?.topic ?? '')
        if (!known.has(k)) return json({ error: 'One of the topics is not in the library any more. Reload and try again.' }, 400)
        if (seen.has(k)) continue
        seen.add(k); items.push({ topic: k, notes: cleanLong(it?.notes, MAX_NOTES) })
      }
      const next = { client_first: clean(b.client_first, 40), about: cleanLong(b.about, MAX_ABOUT), items }
      const ready = b.ready === true
      if (ready && !items.length) return json({ error: 'Add at least one topic before marking it ready.' }, 400)
      const now = new Date().toISOString()
      const cur = await findPacket(sb, ax, lead)
      if (!cur) {
        const row = { client_key: key, axiscare_client_id: ax || null, lead_id: lead || null, ...next, version: 1, ready, updated_by: who.email, updated_at: now }
        const { data, error } = await sb.from('care_packets').insert(row).select('*')
        if (error) throw error
        await opEvent(sb, { verb: 'care_packet_saved', actor_email: who.email, actor_name: who.name, via: 'hub', item_id: 'care_packet:' + data[0].id,
          summary: `started ${next.client_first || 'a client'}'s caregiver packet (${items.length} topic${items.length === 1 ? '' : 's'}${ready ? ', ready' : ''})`, data: { version: 1, ready }, outcome: 'done' })
        return json({ outcome: 'saved', packet: data[0], recipients: [] })
      }
      if (Number(b.base_version) !== cur.version)
        return json({ outcome: 'stale', error: `${cur.updated_by || 'Someone'} changed this packet after you opened it. Reload to see their change first.` }, 409)
      const changed = contentOf(cur) !== contentOf(next)
      const patch: Any = { ...next, ready, updated_by: who.email, updated_at: now, version: changed ? cur.version + 1 : cur.version }
      if (ax && !cur.axiscare_client_id) patch.axiscare_client_id = ax
      if (lead && !cur.lead_id) patch.lead_id = lead
      const { data, error } = await sb.from('care_packets').update(patch).eq('id', cur.id).eq('version', cur.version).select('*')
      if (error) throw error
      if (!data?.length) return json({ outcome: 'stale', error: 'Someone changed this packet a moment ago. Reload to see their change first.' }, 409)
      await opEvent(sb, { verb: 'care_packet_saved', actor_email: who.email, actor_name: who.name, via: 'hub', item_id: 'care_packet:' + cur.id,
        summary: `${changed ? 'updated' : 'saved'} ${next.client_first || 'a client'}'s caregiver packet${changed ? ' (version ' + patch.version + ', caregivers confirm again)' : ''}${ready !== cur.ready ? (ready ? ', marked ready' : ', marked not ready') : ''}`,
        data: { version: patch.version, changed, ready }, outcome: 'done' })
      return json({ outcome: 'saved', changed, packet: data[0], recipients: await recipients(sb, cur.id) })
    }

    if (action === 'link' || action === 'send_draft' || action === 'send') {
      const pid = String(b.packet_id ?? ''), axId = String(b.caregiver_axiscare_id ?? '').trim()
      if (!/^[0-9a-f-]{36}$/i.test(pid) || !/^[A-Za-z0-9_-]{1,40}$/.test(axId)) return json({ error: 'Pick a caregiver.' }, 400)
      if (!SECRET || SECRET.length < 32) return json({ error: 'Links are not set up on the server (HUB_JOB_SECRET).' }, 500)
      const { data: pp, error: e1 } = await sb.from('care_packets').select('*').eq('id', pid).limit(1)
      if (e1) throw e1
      const p = pp?.[0]
      if (!p) return json({ error: 'That packet is gone. Reload.' }, 404)
      if (!p.ready) return json({ error: 'Mark the packet ready before making caregiver links.' }, 409)
      const { data: rosterRow, error: e2 } = await sb.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
      if (e2) throw e2
      const hits = (Array.isArray(rosterRow?.data) ? rosterRow.data : []).filter((c: Any) => String(c?.axiscare_id ?? '') === axId)
      if (hits.length !== 1) return json({ error: hits.length ? 'Two caregivers share that AxisCare id on the roster. Fix the roster first.' : 'That caregiver is not on the roster by AxisCare id.' }, 422)
      const cg = hits[0]
      const name = clean([cg.first, cg.last].filter(Boolean).join(' '), 80) || 'Caregiver'
      const { data: have, error: e3 } = await sb.from('care_packet_recipients').select('*').eq('packet_id', p.id).eq('caregiver_axiscare_id', axId).limit(1)
      if (e3) throw e3
      const rec = have?.[0] ?? null

      /* Step 2: which text, from where they stand. Already confirmed this version: nothing to send. */
      const kind = sendKind(rec, p.version)
      if (action === 'send_draft' || action === 'send') {
        const { data: st, error: e4 } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
        if (e4) throw e4
        const live = st?.data?.care_packet_send_live === true
        const phone = normalisePhone(cg.phone)
        if (action === 'send_draft') {
          const { data: oo } = phone ? await sb.from('contact_optout_current').select('opted_out').eq('address', phone).eq('channel', 'sms').limit(1) : { data: [] }
          return json({ live, kind, caregiver_first: firstOf(name), phone_last4: phone ? phone.slice(-4) : null, opted_out: oo?.[0]?.opted_out === true,
            text: kind ? packetText(kind, firstOf(name), p.client_first, '(their link)') : null, late: !inOfficeTextHours(),
            last_sent_at: rec?.last_sent_at ?? null, last_sent_by: rec?.last_sent_by ?? null })
        }
        if (!live) return json({ outcome: 'off', error: 'Sending packets from the Hub is switched off (Owners Hub Admin page). Nothing was sent. Use Get their link instead.' }, 409)
        const sendId = String(b.send_id ?? '')
        if (!/^[a-z0-9-]{8,64}$/i.test(sendId)) return json({ error: 'bad send id' }, 400)
        if (rec?.last_send_id === sendId) return json({ outcome: 'already_sent', recipients: await recipients(sb, p.id) })
        if (!kind) return json({ outcome: 'confirmed', error: `${name} already confirmed this version. Nothing was sent.` }, 409)
        if (!phone) return json({ outcome: 'no_phone', error: `${name} has no usable phone number on the roster. Nothing was sent.` }, 422)
        const ghl = { token: Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
        if (!ghl.token || !ghl.locationId) return json({ error: 'GoHighLevel is not configured. Nothing was sent.' }, 502)
        const dest = await maySendTo(sb, phone)
        let refusal: string[] = []
        const contact = await contactForOutbound(sb, ghl, { phone, firstName: cg.first, lastName: cg.last }, 'urgent_internal',
          { audience: 'caregiver', channel: 'sms', sender: 'care-packet', humanInitiated: true, onOptOut: (r: string[]) => { refusal = r } })
        if (!contact) {
          const why = refusal.length ? `${name} has asked not to get texts (${refusal.join('; ')})`
            : !dest.allowed ? `${name}'s phone number isn't cleared for texting (${dest.reason}). Check the number on their profile`
            : 'the opt-out check could not be completed (GoHighLevel did not answer). Try again in a minute'
          await opEvent(sb, { verb: 'care_packet_send_refused', actor_email: who.email, actor_name: who.name, via: 'hub', item_id: 'care_packet:' + p.id,
            summary: `${p.client_first || 'A client'}'s caregiver packet text to ${name} not sent`, data: { caregiver_axiscare_id: axId, why }, outcome: 'refused' })
          return json({ outcome: 'refused', error: `Not sent: ${why}.` }, 422)
        }
        const r2 = await ensureRecipient(sb, p, axId, name, rec, who.email)
        const link = await makeLink(SECRET, r2, linkExpiry())
        const text = packetText(kind, firstOf(name), p.client_first, link)
        const sent = await ghlSendChecked(sb, { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' }, 'care-packet',
          { channel: 'sms', contactId: contact.contactId, address: phone, who: name }, { message: text })
        if (!sent) {
          await opEvent(sb, { verb: 'care_packet_send_refused', actor_email: who.email, actor_name: who.name, via: 'hub', item_id: 'care_packet:' + p.id,
            summary: `${p.client_first || 'A client'}'s caregiver packet text to ${name} did not go through`, data: { caregiver_axiscare_id: axId, why: 'GoHighLevel refused' }, outcome: 'failed' })
          return json({ outcome: 'failed', error: 'Not sent: GoHighLevel did not take the text. It is on Needs Attention.' }, 502)
        }
        const at = new Date().toISOString()
        const { error: e5 } = await sb.from('care_packet_recipients').update({ last_sent_at: at, last_sent_by: who.email, last_send_kind: kind, last_send_id: sendId,
          send_count: (Number(rec?.send_count) || 0) + 1 }).eq('id', r2)
        await opEvent(sb, { verb: 'care_packet_sent', actor_email: who.email, actor_name: who.name, via: 'hub', item_id: 'care_packet:' + p.id,
          summary: `${who.name || 'Staff'} texted ${name} ${p.client_first || 'a client'}'s caregiver packet (${KIND_WORDS[kind]})`,
          data: { caregiver_axiscare_id: axId, kind, version: p.version, recipient_id: r2 }, outcome: 'done' })
        return json({ outcome: 'sent', kind, recipients: await recipients(sb, p.id),
          warning: e5 ? 'The text was sent, but the card could not record it. Note it by hand.' : null })
      }

      const id = await ensureRecipient(sb, p, axId, name, rec, who.email)
      const link = await makeLink(SECRET, id, linkExpiry())
      await opEvent(sb, { verb: 'care_packet_link', actor_email: who.email, actor_name: who.name, via: 'hub', item_id: 'care_packet:' + p.id,
        summary: `made ${name}'s link to ${p.client_first || 'a client'}'s caregiver packet`, data: { recipient_id: id, caregiver_axiscare_id: axId }, outcome: 'done' })
      return json({ outcome: 'made', link, caregiver_first: firstOf(name), client_first: p.client_first, recipients: await recipients(sb, p.id) })
    }

    if (action === 'topic_save') {
      if (!who.roles.includes('owner_admin')) return json({ error: 'Only an owner can change the how-to library.' }, 403)
      const key = String(b.key ?? '').trim()
      if (!/^[a-z0-9_]{2,40}$/.test(key)) return json({ error: 'Topic key: 2 to 40 lowercase letters, numbers or _.' }, 400)
      const title = clean(b.title, 80)
      if (!title) return json({ error: 'The topic needs a title.' }, 400)
      const v = cleanVideos(b.videos ?? [])
      if (!v.ok) return json({ error: v.error }, 400)
      const row = { key, title, notes: cleanLong(b.notes, MAX_NOTES), videos: v.videos, active: b.active !== false, updated_by: who.email, updated_at: new Date().toISOString() }
      const { error } = await sb.from('care_topics').upsert(row, { onConflict: 'key' })
      if (error) throw error
      await opEvent(sb, { verb: 'care_topic_saved', actor_email: who.email, actor_name: who.name, via: 'hub', item_id: 'care_topic:' + key,
        summary: `saved the how-to topic "${title}" (${v.videos.length} video${v.videos.length === 1 ? '' : 's'})`, outcome: 'done' })
      return json({ outcome: 'saved', topics: await topics(sb) })
    }

    return json({ error: 'Unknown action.' }, 400)
  } catch (e) {
    console.error('care-packet', action, (e as Error)?.message ?? e)
    return json({ error: 'Something went wrong. Try again, and tell Samantha if it keeps happening.' }, 500)
  }
})
