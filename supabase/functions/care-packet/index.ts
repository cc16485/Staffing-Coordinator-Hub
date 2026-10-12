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
//   CAREGIVER actions need only their link (i, e, t):
//     'view'  -> what their page shows. Opening the page changes nothing (phones preview links on their own).
//     'ack'   {version} -> "I watched it and understand" for that version (only the current one).
// No message wording lives here; nothing here texts or emails anyone.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { opEvent } from '../_shared/events.ts'
import { checkLink, linkExpiry, makeLink, newRecipientId } from '../_shared/packet-links.ts'

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
  const { data, error } = await sb.from('care_packet_recipients').select('id, caregiver_axiscare_id, caregiver_name, link_made_at, link_made_by, ack_version, ack_at').eq('packet_id', packetId)
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

    if (action === 'link') {
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
      const name = clean([hits[0].first, hits[0].last].filter(Boolean).join(' '), 80) || 'Caregiver'
      const { data: have, error: e3 } = await sb.from('care_packet_recipients').select('id').eq('packet_id', p.id).eq('caregiver_axiscare_id', axId).limit(1)
      if (e3) throw e3
      const now = new Date().toISOString()
      let id = have?.[0]?.id
      if (id) {
        const { error } = await sb.from('care_packet_recipients').update({ caregiver_name: name, link_made_at: now, link_made_by: who.email }).eq('id', id)
        if (error) throw error
      } else {
        id = newRecipientId()
        const { error } = await sb.from('care_packet_recipients').insert({ id, packet_id: p.id, caregiver_axiscare_id: axId, caregiver_name: name, link_made_at: now, link_made_by: who.email })
        if (error) throw error
      }
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
