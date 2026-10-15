// =============================================================================
// call-to-lead · "Make this a lead" on a call (Samantha 2026-10-14)
// =============================================================================
// Her words: "our number and phone transcripts need to be used to fill lead and have us easily mark call as a lead
// and based on the transcript fill the lead info". Her decision on the mockup: the AI only TAGS likely new families
// (the call reader's "new client inquiry"); a person presses Make this a lead on any call, the regular lead form opens
// already filled from that call, everything heard on the call is shown yellow, and the person checks it and saves.
//
//   read  {message_id}            GoHighLevel's call, its transcript and contact (all reads), one reading by Claude
//                                 into the form's own fields (_shared/call-lead.ts). WRITES NOTHING. The phone number
//                                 and, when GoHighLevel has them, the caller's name and email come from the contact,
//                                 never from what the AI heard. No transcript: the form still opens with the contact.
//   made  {message_id, lead_id}   after the person saved: checks the lead really carries this call (from_calls), then
//                                 tags the GoHighLevel contact "lead" (the tag the old reader added). Says if it failed.
//
// Office roles only, from the person's own Hub sign-in. Never sends anything to anyone.
// Deploy: supabase functions deploy call-to-lead --project-ref zngsgedlsxinbygwmxwn --no-verify-jwt (the staff check is
// done here, like kind-tell).
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { request, toolAnswer, toPrefill } from '../_shared/call-lead.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const GHL = 'https://services.leadconnectorhq.com'
const H = (tok: string, v = '2021-04-15') => ({ Authorization: `Bearer ${tok}`, Version: v, Accept: 'application/json' })
// deno-lint-ignore no-explicit-any
type Any = any

/* GoHighLevel's transcription: pieces with a speaker channel and the words (same reading as call-pull). */
export function transcriptText(t: Any): string {
  if (typeof t === 'string') return t.trim()
  const arr: Any[] = Array.isArray(t) ? t : (t?.transcription || t?.data || t?.sentences || [])
  if (!Array.isArray(arr)) return ''
  return arr.slice().sort((a, b) => Number(a?.sentenceIndex ?? a?.startTime ?? 0) - Number(b?.sentenceIndex ?? b?.startTime ?? 0))
    .map((p) => {
      const words = String(p?.transcript ?? p?.sentence ?? p?.text ?? '').trim()
      if (!words) return ''
      const ch = p?.mediaChannel ?? p?.channel ?? p?.speaker
      return (ch != null && ch !== '' ? `Speaker ${ch}: ` : '') + words
    }).filter(Boolean).join('\n')
}
const chicagoDay = (iso: string) => {
  const d = new Date(iso); if (isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
    + ' (' + d.toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'long' }) + ')'
}

async function readCall(tok: string, loc: string, id: string) {
  const m = await fetch(`${GHL}/conversations/messages/${encodeURIComponent(id)}`, { headers: H(tok) })
  if (!m.ok) return { error: m.status === 404 ? 'GoHighLevel could not find that call.' : `GoHighLevel answered ${m.status} for that call.` }
  const mj: Any = await m.json().catch(() => ({}))
  const msg: Any = mj?.message ?? mj ?? {}
  if (msg.messageType && msg.messageType !== 'TYPE_CALL') return { error: 'That message is not a call.' }
  let ct: Any = {}
  if (msg.contactId) {
    try { const r = await fetch(`${GHL}/contacts/${encodeURIComponent(msg.contactId)}`, { headers: H(tok, '2021-07-28') }); if (r.ok) ct = (await r.json())?.contact || {} } catch { /* blank contact */ }
  }
  const tr = await fetch(`${GHL}/conversations/locations/${encodeURIComponent(loc)}/messages/${encodeURIComponent(id)}/transcription`, { headers: H(tok) })
  const transcript = tr.ok ? transcriptText(await tr.json().catch(() => null)) : ''
  return { msg, ct, transcript }
}

async function ask(apiKey: string, body: Any): Promise<Any> {
  const { betas, ...rest } = body
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-beta': betas.join(','), 'content-type': 'application/json' },
    body: JSON.stringify(rest),
  })
  if (!r.ok) { console.error('anthropic', r.status, (await r.text().catch(() => '')).slice(0, 300)); return null }
  return await r.json().catch(() => null)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const who = await requireStaff(db, req, OFFICE_ROLES)
  if (!who.ok) return json({ error: who.error }, who.status)
  const body: Any = await req.json().catch(() => ({}))
  const id = String(body?.message_id || '').trim()
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) return json({ error: 'Which call? (no call id was sent)' }, 400)
  const tok = Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || ''
  const loc = Deno.env.get('GHL_LOCATION_ID') || ''
  if (!tok || !loc) return json({ error: 'GoHighLevel is not set up on the server.' }, 500)

  if (body.action === 'read') {
    const c = await readCall(tok, loc, id)
    if ('error' in c) return json({ error: c.error }, 502)
    const { msg, ct, transcript } = c
    const contact = { id: String(msg.contactId || ''), first_name: String(ct.firstName || '').trim(), last_name: String(ct.lastName || '').trim(),
      phone: String(ct.phone || '').trim(), email: String(ct.email || '').trim() }
    const call = { message_id: id, at: String(msg.dateAdded || ''), direction: msg.direction === 'outbound' ? 'outbound' : 'inbound', seconds: Number(msg?.meta?.call?.duration || 0) }
    const base = { ok: true, call, contact }
    if (!transcript) {
      const p = toPrefill({}, contact)
      return json({ ...base, transcript: false, ...p, note: 'GoHighLevel has no transcript for this call yet, so only the contact is filled in. Listen to the recording.' })
    }
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY') || ''
    if (!apiKey) return json({ error: 'The AI key is not set on the server.' }, 500)
    const req0 = request({ transcript, callDay: chicagoDay(call.at), direction: call.direction, knownName: [contact.first_name, contact.last_name].filter(Boolean).join(' ') })
    let a = toolAnswer(await ask(apiKey, req0))
    if (!a) a = toolAnswer(await ask(apiKey, req0))   /* one retry: an answer in text instead of the tool */
    if (!a) {
      const p = toPrefill({}, contact)
      return json({ ...base, transcript: true, ...p, note: 'The AI could not read this call, so only the contact is filled in. Listen to the recording.' })
    }
    return json({ ...base, transcript: true, ...toPrefill(a, contact) })
  }

  if (body.action === 'made') {
    const leadId = String(body?.lead_id || '')
    const { data: row } = await db.from('app_data').select('data').eq('key', 'leads').maybeSingle()
    const lead = (Array.isArray(row?.data) ? row!.data : []).find((l: Any) => l && String(l.id) === leadId)
    if (!lead || !(Array.isArray(lead.from_calls) && lead.from_calls.some((x: Any) => x && x.message_id === id)))
      return json({ error: 'That lead was not saved with this call.' }, 409)
    const contactId = String(lead.ghl_contact_id || '')
    if (!contactId) return json({ ok: true, tagged: false, note: 'No GoHighLevel contact on this lead, so nothing was tagged.' })
    try {
      const r = await fetch(`${GHL}/contacts/${encodeURIComponent(contactId)}/tags`, { method: 'POST',
        headers: { Authorization: `Bearer ${tok}`, Version: '2021-07-28', 'Content-Type': 'application/json' }, body: JSON.stringify({ tags: ['lead'] }) })
      if (!r.ok) return json({ ok: false, tagged: false, error: `GoHighLevel did not add the "lead" tag (${r.status}).` }, 502)
    } catch { return json({ ok: false, tagged: false, error: 'Could not reach GoHighLevel to add the "lead" tag.' }, 502) }
    return json({ ok: true, tagged: true })
  }
  return json({ error: 'Unknown action' }, 400)
})
