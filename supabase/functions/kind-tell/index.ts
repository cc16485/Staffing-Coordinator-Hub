// =============================================================================
// kind-tell — tell a caregiver the kind words about them, from the office number (Desktop 474)
// =============================================================================
// Samantha 2026-10-06: "send from the real office number, send it, also put in the caregivers profile under performance
// if they got a compliment". A kind word in the jar about a caregiver gets "Tell <name>": the person reads the text,
// edits it, and presses Send. Nothing goes out on its own.
//
//   draft  the kind word (from the database), the caregiver it's about (their AxisCare id from the kind word's paperclip,
//          or one exact unique name on the roster; otherwise the roster people it could be, to pick from), whether the
//          roster has a phone (last 4 only) and whether they asked for no texts, who was already told, and the message.
//          Reads only.
//   send   re-reads the kind word and the caregiver's phone from the roster (never from the browser), runs the same
//          outbound gate as every caregiver text (phone identity + the universal opt-out check incl. GoHighLevel Do Not
//          Disturb), sends the exact words the person approved from the office number, then records it in
//          app_data kind_tells (who, when, the text) and op_events. A failed or refused send records nothing as told.
//
// Office roles only, from the person's own Hub sign-in. Switch: ops_settings.kind_tell_live.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { contactForOutbound, maySendTo, normalisePhone } from '../_shared/outreach.ts'
import { optOutCheck } from '../_shared/optout.ts'
import { opEvent } from '../_shared/events.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const MAX_TEXT = 640
// deno-lint-ignore no-explicit-any
type Any = any
const nameKey = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '')
const first = (s: unknown) => String(s ?? '').trim().split(/\s+/)[0] || ''
const full = (cg: Any) => [cg?.first, cg?.last].map((x) => String(x ?? '').trim()).filter(Boolean).join(' ')

/** Which roster caregiver a kind word is about: the paperclip's AxisCare id, else one unique exact name, else
 *  one unique "First L." (first name + last initial). Otherwise null, with who it could be. */
export function whoIsIt(roster: Any[], kw: Any, pickAx = ''): { cg: Any | null; candidates: Any[] } {
  const byAx = (ax: string) => { const h = roster.filter((c) => String(c?.axiscare_id ?? '') === ax); return h.length === 1 ? h[0] : null }
  if (pickAx) return { cg: byAx(pickAx), candidates: [] }
  const link = kw?.link || {}
  if (link.type === 'caregiver' && link.id) { const c = byAx(String(link.id)); if (c) return { cg: c, candidates: [] } }
  const about = String(kw?.about ?? '').trim()
  if (about) {
    const exact = roster.filter((c) => nameKey(full(c)) === nameKey(about)); if (exact.length === 1) return { cg: exact[0], candidates: [] }
    const m = about.match(/^([A-Za-z'-]+)\s+([A-Za-z])\.?$/)
    if (m) { const h = roster.filter((c) => nameKey(c?.first) === nameKey(m[1]) && String(c?.last ?? '').trim().toLowerCase().startsWith(m[2].toLowerCase())); if (h.length === 1) return { cg: h[0], candidates: [] } }
  }
  const f = nameKey(first(about))
  const candidates = f ? roster.filter((c) => nameKey(c?.first) === f && c?.axiscare_id).slice(0, 8) : []
  return { cg: null, candidates }
}
export function draftText(kw: Any, cg: Any, by: string) {
  const who = String(kw?.who || 'Someone').replace(/^The /, 'the ')
  return `Hi ${first(cg?.first || kw?.about) || 'there'}, it's Caring Companions. ${who.charAt(0).toUpperCase() + who.slice(1)} said this about you: "${String(kw?.quote ?? '').trim()}" Thank you for the care you give. ${first(by)}`
}
// deno-lint-ignore no-explicit-any
async function readKey(sb: any, key: string): Promise<Any[]> {
  const { data } = await sb.from('app_data').select('data').eq('key', key).maybeSingle()
  return Array.isArray(data?.data) ? data.data : []
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const who = await requireStaff(sb, req, OFFICE_ROLES)
  if (!who.ok) return json({ error: who.error }, who.status)
  let b: Any = {}
  try { b = await req.json() } catch { b = {} }
  const kwId = String(b?.kind_word_id ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(kwId)) return json({ error: 'No kind word.' }, 400)
  const { data: kw } = await sb.from('kind_words').select('id,quote,who,about,about_role,link,status,said_on').eq('id', kwId).maybeSingle()
  if (!kw || kw.status !== 'kind') return json({ error: 'That kind word is not in the jar.' }, 404)
  const { data: os } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  const live = os?.data?.kind_tell_live === true
  const roster = await readKey(sb, 'caregivers')
  const pick = String(b?.caregiver_ax ?? '').replace(/[^0-9]/g, '')
  const { cg, candidates } = whoIsIt(roster, kw, pick)
  const phone = cg ? normalisePhone(cg.phone) : null
  const tells = (await readKey(sb, 'kind_tells')).find((x) => x?.id === kwId)?.tells ?? []

  if (b?.action === 'draft') {
    let optOut: string[] = []
    if (phone) { try { const v = await optOutCheck(sb, { channel: 'sms', phone, viaGhl: false }); optOut = v?.allowed === false ? (v.reasons || ['asked not to get texts']) : [] } catch { /* the send re-checks */ } }
    return json({ live, kind: { quote: kw.quote, who: kw.who, about: kw.about },
      caregiver: cg ? { ax: String(cg.axiscare_id ?? ''), name: full(cg), first: first(cg.first), phone_last4: phone ? phone.slice(-4) : '', opt_out: optOut } : null,
      candidates: cg ? [] : candidates.map((c) => ({ ax: String(c.axiscare_id), name: full(c) })),
      told: tells.map((t: Any) => ({ at: t.at, by: t.by, caregiver: t.caregiver })),
      message: cg ? draftText(kw, cg, who.name) : '' })
  }
  if (b?.action !== 'send') return json({ error: 'unknown action' }, 400)
  if (!live) return json({ outcome: 'off', error: 'Texting kind words is switched off (Owners Hub Admin page). Nothing was sent.' }, 409)
  const sendId = String(b?.send_id ?? '')
  if (!/^[a-z0-9-]{8,64}$/i.test(sendId)) return json({ error: 'bad send id' }, 400)
  if (tells.some((t: Any) => t?.id === sendId)) return json({ outcome: 'already_sent' })
  const message = String(b?.message ?? '').replace(/\r\n/g, '\n').trim()
  if (!message) return json({ error: 'The message is empty.' }, 400)
  if (message.length > MAX_TEXT) return json({ error: `The message is ${message.length} characters; keep it under ${MAX_TEXT}.` }, 400)
  if (!cg) return json({ outcome: 'no_caregiver', error: 'Pick which caregiver this is about first.' }, 422)
  if (!phone) return json({ outcome: 'no_phone', error: `${full(cg)} has no usable phone number on the roster.` }, 422)
  const ghl = { token: Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || '', locationId: Deno.env.get('GHL_LOCATION_ID') ?? '' }
  if (!ghl.token || !ghl.locationId) return json({ error: 'GoHighLevel is not configured. Nothing was sent.' }, 502)
  const dest = await maySendTo(sb, phone)
  let refusal: string[] = []
  const contact = await contactForOutbound(sb, ghl, { phone, firstName: cg.first, lastName: cg.last }, 'urgent_internal',
    { audience: 'caregiver', channel: 'sms', sender: 'kind-tell', humanInitiated: true, onOptOut: (r: string[]) => { refusal = r } })
  if (!contact) {
    const why = refusal.length ? `${full(cg)} has asked not to get texts (${refusal.join('; ')})`
      : !dest.allowed ? `${full(cg)}'s phone number isn't cleared for texting (${dest.reason}). Check the number on their profile`
      : 'the opt-out check could not be completed (GoHighLevel did not answer). Try again in a minute'
    await opEvent(sb, { verb: 'kind_tell_refused', actor_name: who.name, actor_email: who.email, item_id: kwId, area: 'caregivers', summary: `Kind words to ${full(cg)} not sent`, data: { why } })
    return json({ outcome: 'refused', error: `Not sent: ${why}.` }, 422)
  }
  let ok = false, err = ''
  try {
    const r = await fetch('https://services.leadconnectorhq.com/conversations/messages', { method: 'POST',
      headers: { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'SMS', contactId: contact.contactId, message }) })
    ok = r.ok; if (!r.ok) err = `GoHighLevel answered ${r.status}`
  } catch { err = 'could not reach GoHighLevel' }
  if (!ok) return json({ outcome: 'failed', error: `Not sent: ${err}.` }, 502)
  const tell = { id: sendId, at: new Date().toISOString(), by: who.name, by_email: who.email, caregiver_ax: String(cg.axiscare_id ?? ''), caregiver: full(cg), text: message }
  const fresh = (await readKey(sb, 'kind_tells')).find((x) => x?.id === kwId) ?? { id: kwId, tells: [] }
  fresh.tells = (Array.isArray(fresh.tells) ? fresh.tells : []).filter((t: Any) => t?.id !== sendId).concat([tell])
  const { error } = await sb.rpc('upsert_app_data_item', { target_key: 'kind_tells', item: fresh })
  await opEvent(sb, { verb: 'kind_tell_sent', actor_name: who.name, actor_email: who.email, item_id: kwId, area: 'caregivers',
    summary: `${who.name} texted ${full(cg)} the kind words about them`, data: { caregiver_ax: tell.caregiver_ax, message } })
  return json({ outcome: 'sent', tell, warning: error ? 'The text was sent, but it could not be marked as told.' : null })
})
