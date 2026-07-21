// Supabase Edge Function: vapi-interview (shared hub project)
// -----------------------------------------------------------------------------
// Receives Vapi call webhooks for the HomeTogether Hire AI phone interview.
// A caregiver calls the interview number, an assistant speaking in Samantha's
// ElevenLabs voice conducts a short warm interview, and at the end of the call
// Vapi POSTs an "end-of-call-report" here. We match the caller to their
// caregiver record (by phone), store the recording URL + transcript + summary
// on that record, flag it for review, and email Samantha.
//
// Endpoint (Vapi "Server URL" on the assistant / phone number):
//   POST  ?src=vapi          {message:{type:'end-of-call-report', ...}}
//   verified by header  X-Vapi-Secret: <VAPI_SECRET>
//
// Config read used by the public site (which number to call):
//   POST  ?token=<HT_ORDER_TOKEN>   {kind:'config'}  -> {interview_number}
//
// Secrets: VAPI_SECRET (shared with the assistant's server config),
//   HT_INTERVIEW_NUMBER (the assigned Vapi phone number, E.164),
//   HT_ORDER_TOKEN (reused, gates the config read),
//   GHL_TOKEN / GHL_LOCATION_ID (email, optional).
// Deploy: supabase functions deploy vapi-interview --no-verify-jwt
// -----------------------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-vapi-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const esc = (t: string) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')
const digits = (v: unknown) => String(v ?? '').replace(/\D/g, '')
const last10 = (v: unknown) => digits(v).slice(-10)

async function ghlEmail(to: string, firstName: string, subject: string, html: string): Promise<boolean> {
  const ghlToken = Deno.env.get('GHL_TOKEN')
  const ghlLocation = Deno.env.get('GHL_LOCATION_ID')
  if (!ghlToken || !ghlLocation || !to) return false
  try {
    const h = { Authorization: `Bearer ${ghlToken}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' }
    const up = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
      method: 'POST', headers: h, body: JSON.stringify({ locationId: ghlLocation, email: to, firstName }),
    })
    const contactId = (await up.json().catch(() => ({})))?.contact?.id
    if (!contactId) return false
    const sr = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
      method: 'POST', headers: h, body: JSON.stringify({ type: 'Email', contactId, subject, html }),
    })
    return sr.ok
  } catch { return false }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const url = new URL(req.url)
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // ---------- Public site: which number do caregivers call? ----------
  if (url.searchParams.get('src') !== 'vapi') {
    const expected = Deno.env.get('HT_ORDER_TOKEN') ?? Deno.env.get('HT_SUPPORT_TOKEN')
    if (!expected || url.searchParams.get('token') !== expected) return json({ error: 'unauthorized' }, 401)
    const body = await req.json().catch(() => ({}))
    if (body?.kind === 'config') {
      return json({ ok: true, interview_number: Deno.env.get('HT_INTERVIEW_NUMBER') || '' })
    }
    return json({ error: 'unknown kind' }, 400)
  }

  // ---------- Vapi webhook ----------
  const secret = Deno.env.get('VAPI_SECRET')
  if (secret && req.headers.get('x-vapi-secret') !== secret) return json({ error: 'unauthorized' }, 401)

  // deno-lint-ignore no-explicit-any
  let payload: any = {}
  try { payload = await req.json() } catch { return json({ received: true }) }
  const msg = payload?.message ?? payload
  const type = msg?.type

  // We only persist on the final report; acknowledge everything else so Vapi is happy.
  if (type !== 'end-of-call-report') return json({ received: true })

  const call = msg?.call ?? {}
  const callerNumber = msg?.customer?.number || call?.customer?.number || ''
  const transcript = msg?.transcript || msg?.artifact?.transcript || ''
  const summary = msg?.summary || msg?.analysis?.summary || ''
  const rubric = msg?.analysis?.structuredData || msg?.structuredData || null
  const recordingUrl = msg?.recordingUrl || msg?.artifact?.recordingUrl || msg?.stereoRecordingUrl || msg?.artifact?.stereoRecordingUrl || ''
  const startedAt = msg?.startedAt || call?.startedAt || new Date().toISOString()
  const durationSec = Math.round(Number(msg?.durationSeconds || msg?.durationSec || 0)) || null

  const interview = {
    at: new Date().toISOString(), startedAt,
    caller: String(callerNumber || ''),
    recordingUrl: String(recordingUrl || ''),
    transcript: String(transcript || '').slice(0, 20000),
    summary: String(summary || '').slice(0, 4000),
    rubric,
    durationSec,
  }

  // Match the caller to a caregiver by phone (last 10 digits).
  const { data } = await supabase.from('app_data').select('data').eq('key', 'local_caregivers').maybeSingle()
  const items = Array.isArray(data?.data) ? data.data : []
  const want = last10(callerNumber)
  // deno-lint-ignore no-explicit-any
  const c: any = want ? items.find((x: any) => last10(x?.phone) === want) : undefined

  if (c) {
    c.interview = interview
    c.interview_done = true
    c.seen = false
    c.notes = ((c.notes || '') + '\nAI phone interview completed ' + new Date().toLocaleDateString('en-US') + (durationSec ? ' (' + Math.round(durationSec / 60) + ' min)' : '') + '.').trim()
    await supabase.rpc('upsert_app_data_item', { target_key: 'local_caregivers', item: c })
    await ghlEmail('samantha@mo-care.com', 'Samantha',
      '🎙️ HT Hire: ' + (c.name || 'a caregiver') + ' finished their AI interview',
      '<div style="font-family:Arial,sans-serif;font-size:15px;color:#16283a;line-height:1.6;">'
      + '<p><b>' + esc(c.name || 'A caregiver') + '</b> just completed the AI phone interview' + (durationSec ? ' (' + Math.round(durationSec / 60) + ' min)' : '') + '.</p>'
      + (recordingUrl ? '<p><a href="' + recordingUrl + '">Listen to the recording</a></p>' : '')
      + (summary ? '<p><b>Summary:</b> ' + esc(summary) + '</p>' : '')
      + '<p style="color:#55677a;font-size:13px;">Full recording and transcript are on their card in the Care Coordinator Hub → HomeTogether → Local.</p></div>')
  } else {
    // Unmatched: store in a holding list so nothing is lost.
    const stray = { id: crypto.randomUUID(), ...interview }
    await supabase.rpc('upsert_app_data_item', { target_key: 'local_interviews_unmatched', item: stray })
    await ghlEmail('samantha@mo-care.com', 'Samantha',
      '🎙️ HT Hire: an AI interview came in from an unrecognized number',
      '<div style="font-family:Arial,sans-serif;font-size:15px;color:#16283a;line-height:1.6;">'
      + '<p>Someone completed the AI interview from <b>' + esc(String(callerNumber || 'an unknown number')) + '</b>, which does not match any caregiver on file (they likely called from a different phone).</p>'
      + (recordingUrl ? '<p><a href="' + recordingUrl + '">Listen to the recording</a></p>' : '')
      + (summary ? '<p><b>Summary:</b> ' + esc(summary) + '</p>' : '')
      + '<p style="color:#55677a;font-size:13px;">It is saved in the hub under unmatched interviews so you can link it to the right caregiver.</p></div>')
  }

  return json({ received: true, matched: !!c })
})
