// Supabase Edge Function: cc-story (shared hub project)
// Powers the public "Share Your Story" page (mo-care.com/share-your-story).
// Families and caregivers record a short video in the browser (or upload one),
// sign the release, and it lands in the hub's Feedback tab as kind "story".
//
// Three steps, all POST, all token-gated like the other public forms:
//   { step: 'start' }    -> saves the submission + returns a signed upload URL
//   { step: 'complete' } -> marks the video uploaded and emails Samantha
//   { step: 'written' }  -> written story, no video, saves + emails
//
// Videos go to the PRIVATE "stories" bucket. Nothing is ever public: the hub
// makes a short-lived signed link when Samantha presses Watch.
// Deploy: supabase functions deploy cc-story --no-verify-jwt. Verify JWT OFF.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const MAX_BYTES = 300 * 1024 * 1024 // 300 MB — a 2-minute phone video is far under this

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const url = new URL(req.url)
  const expected = Deno.env.get('HT_SUPPORT_TOKEN') ?? Deno.env.get('HT_ORDER_TOKEN')
  if (!expected || url.searchParams.get('token') !== expected) return json({ error: 'unauthorized' }, 401)
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  // deno-lint-ignore no-explicit-any
  let b: Record<string, any> = {}
  try { b = await req.json() } catch { return json({ error: 'bad payload' }, 400) }
  const s = (v: unknown, n = 500) => String(v ?? '').trim().slice(0, n)

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const step = s(b.step, 20) || 'start'

  // ---------- shared helpers ----------
  async function loadItem(id: string) {
    const { data } = await supabase.from('app_data').select('data').eq('key', 'feedback').maybeSingle()
    const items = Array.isArray(data?.data) ? data.data : []
    // deno-lint-ignore no-explicit-any
    return items.find((x: any) => x && x.id === id) ?? null
  }

  // deno-lint-ignore no-explicit-any
  async function notify(item: Record<string, any>) {
    const ghlToken = Deno.env.get('GHL_TOKEN')
    const ghlLocation = Deno.env.get('GHL_LOCATION_ID')
    if (!ghlToken || !ghlLocation) return false
    try {
      const h = {
        Authorization: `Bearer ${ghlToken}`, Version: '2021-07-28',
        'Content-Type': 'application/json', Accept: 'application/json',
      }
      const up = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
        method: 'POST', headers: h,
        body: JSON.stringify({ locationId: ghlLocation, email: 'samantha@mo-care.com', firstName: 'Samantha' }),
      })
      const contactId = (await up.json().catch(() => ({})))?.contact?.id
      if (!contactId) return false
      const esc = (t: string) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')
      const isCaregiver = item.who === 'caregiver'
      const kindLabel = item.has_video ? 'video story' : 'written story'
      const subject = (item.has_video ? '🎥 ' : '✍️ ') + 'New ' + kindLabel + ' from '
        + (item.name || 'someone') + (isCaregiver ? ' (caregiver)' : ' (family)')
      const html = '<div style="font-family:Arial,sans-serif;font-size:15px;color:#16283a;line-height:1.6;">'
        + '<p style="font-size:30px;margin:0 0 8px;">' + (item.has_video ? '🎥' : '✍️') + '</p>'
        + '<p><b>' + esc(item.name || 'No name given') + '</b>'
        + (item.relationship ? ' &middot; ' + esc(item.relationship) : '')
        + ' &middot; ' + (isCaregiver ? 'caregiver' : 'client family') + '</p>'
        + (item.contact ? '<p><b>Contact:</b> ' + esc(item.contact) + '</p>' : '')
        + (item.caregiver ? '<p><b>Caregiver they mention:</b> ' + esc(item.caregiver) + '</p>' : '')
        + (item.message ? '<p><b>What they wanted you to know:</b><br>' + esc(item.message) + '</p>' : '')
        + '<p><b>Permission to use in marketing:</b> ' + (item.release_signed ? 'YES, release signed' : 'NOT given') + '<br>'
        + '<b>How they want to be shown:</b> ' + esc(item.display_pref || 'first name only') + '</p>'
        + (item.has_video
          ? '<p style="background:#EAF4F6;border-radius:8px;padding:12px 14px;">Watch it in the hub: <b>Campaigns &rarr; Feedback</b>. Press <b>Watch video</b> on their card.</p>'
          : '<p style="color:#55677a;">No video with this one, they wrote it out instead. It is in the hub under Campaigns &rarr; Feedback.</p>')
        + '<p style="color:#55677a;font-size:13px;">A thank-you is worth sending within a day. They just did you a real favor.</p></div>'
      const sr = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
        method: 'POST', headers: h,
        body: JSON.stringify({ type: 'Email', contactId, subject, html }),
      })
      return sr.ok
    } catch { return false }
  }

  // ---------- step: start / written ----------
  if (step === 'start' || step === 'written') {
    const name = s(b.name, 120)
    if (!name) return json({ error: 'name required' }, 400)
    if (!b.release_signed) return json({ error: 'release required' }, 400)

    const who = s(b.who, 40) === 'caregiver' ? 'caregiver' : 'client family'
    const item = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      kind: 'story',
      rating: null,
      who,
      name,
      contact: s(b.contact, 200),
      relationship: s(b.relationship, 120),
      caregiver: s(b.caregiver, 120),
      message: s(b.message, 4000),
      prompt: s(b.prompt, 300),
      display_pref: s(b.display_pref, 120) || 'First name only',
      release_signed: true,
      release_version: s(b.release_version, 60) || 'v1',
      release_at: new Date().toISOString(),
      has_video: step === 'start',
      status: step === 'start' ? 'uploading' : 'ready',
      video_path: '',
      video_size: 0,
      video_type: '',
      video_seconds: 0,
      seen: false,
    }

    if (step === 'written') {
      const { error } = await supabase.rpc('upsert_app_data_item', { target_key: 'feedback', item })
      if (error) return json({ error: error.message }, 500)
      const notified = await notify(item)
      return json({ ok: true, id: item.id, notified })
    }

    // Video path: reserve a slot and hand back a signed upload URL.
    const size = Math.max(0, parseInt(s(b.size), 10) || 0)
    if (size > MAX_BYTES) return json({ error: 'video too large' }, 413)
    const ext = (s(b.ext, 8) || 'mp4').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'mp4'
    const safeName = name.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 40) || 'story'
    const path = `${item.id}/${who === 'caregiver' ? 'caregiver' : 'family'}-${safeName}-${Date.now()}.${ext}`
    item.video_path = path
    item.video_type = s(b.type, 80)
    item.video_size = size

    const { error } = await supabase.rpc('upsert_app_data_item', { target_key: 'feedback', item })
    if (error) return json({ error: error.message }, 500)

    const signed = await supabase.storage.from('stories').createSignedUploadUrl(path)
    if (signed.error) return json({ error: 'could not start the upload: ' + signed.error.message }, 500)
    const raw = signed.data.signedUrl
    const uploadUrl = raw.startsWith('http') ? raw : `${Deno.env.get('SUPABASE_URL')}/storage/v1${raw}`
    return json({ ok: true, id: item.id, upload_url: uploadUrl, path })
  }

  // ---------- step: complete ----------
  if (step === 'complete') {
    const id = s(b.id, 60)
    if (!id) return json({ error: 'id required' }, 400)
    const item = await loadItem(id)
    if (!item) return json({ error: 'not found' }, 404)
    item.status = 'ready'
    item.video_size = Math.max(0, parseInt(s(b.size), 10) || item.video_size || 0)
    item.video_seconds = Math.max(0, Math.round(parseFloat(s(b.seconds)) || 0))
    if (s(b.message, 4000)) item.message = s(b.message, 4000)
    const { error } = await supabase.rpc('upsert_app_data_item', { target_key: 'feedback', item })
    if (error) return json({ error: error.message }, 500)
    const notified = await notify(item)
    return json({ ok: true, id, notified })
  }

  return json({ error: 'unknown step' }, 400)
})
