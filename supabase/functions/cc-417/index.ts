// Supabase Edge Function: cc-417 (shared hub project)
// Powers 417 Caring Community — one question, one minute, from the people who
// take care of our seniors. Brought to you by Caring Companions.
//
// Professionals (hospice nurses, elder law attorneys, senior center directors,
// Medicare brokers, VA reps) record a one-minute answer to the month's
// question. We tag their organization so families can find them. Four
// questions a month become that month's issue, which goes out as an email to
// every referral partner in the 417.
//
// Actions (POST JSON):
//   questions          -> this month's four questions (for the record page)
//   submit:start       -> saves the submission, returns a signed upload URL
//   submit:complete    -> marks it uploaded, emails Samantha to review it
//   gallery            -> published videos, newest issue first (public page)
//
// Nothing publishes on its own. Every submission lands in "review" until
// somebody in the office presses Publish in the hub.
//
// Deploy: supabase functions deploy cc-417 --no-verify-jwt. Verify JWT OFF.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const MAX_BYTES = 300 * 1024 * 1024
const BUCKET = 'caring417'

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const url = new URL(req.url)
  const expected = Deno.env.get('HT_SUPPORT_TOKEN') ?? Deno.env.get('HT_ORDER_TOKEN')
  if (!expected || url.searchParams.get('token') !== expected) return json({ error: 'unauthorized' }, 401)
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  let b: Row = {}
  try { b = await req.json() } catch { return json({ error: 'bad payload' }, 400) }
  const s = (v: unknown, n = 500) => String(v ?? '').trim().slice(0, n)
  const action = s(b.action, 40)

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const thisMonth = new Date().toISOString().slice(0, 7)

  async function readKey(key: string): Promise<Row[]> {
    const { data } = await supabase.from('app_data').select('data').eq('key', key).maybeSingle()
    return Array.isArray(data?.data) ? data.data : []
  }
  async function save(key: string, item: Row) {
    const { error } = await supabase.rpc('upsert_app_data_item', { target_key: key, item })
    if (error) throw new Error(error.message)
  }

  // ------------------------------------------------------------- questions
  if (action === 'questions') {
    const prompts = await readKey('pro_prompts')
    const month = s(b.month, 7) || thisMonth
    const mine = prompts.filter((p) => p.active !== false && (p.month || thisMonth) === month)
    return json({
      ok: true,
      month,
      questions: (mine.length ? mine : prompts.filter((p) => p.active !== false))
        .slice(0, 4)
        .map((p) => ({ id: p.id, text: p.text })),
    })
  }

  // ---------------------------------------------------------------- submit
  if (action === 'submit:start') {
    const name = s(b.name, 120)
    const org = s(b.org, 160)
    if (!name) return json({ error: 'Please tell us your name.' }, 400)
    if (!org) return json({ error: 'Please tell us your organization.' }, 400)
    if (!b.release_signed) return json({ error: 'We need your permission to publish it.' }, 400)
    const size = Math.max(0, parseInt(s(b.size), 10) || 0)
    if (size > MAX_BYTES) return json({ error: 'That video is too large to send.' }, 413)

    const item: Row = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      month: s(b.month, 7) || thisMonth,
      name,
      title: s(b.title, 140),
      org,
      org_url: s(b.org_url, 300),
      org_phone: s(b.org_phone, 40),
      org_social: s(b.org_social, 200),
      category: s(b.category, 60) || 'Other',
      email: s(b.email, 200),
      prompt: s(b.prompt, 300),
      notes: s(b.notes, 1000),
      release_signed: true,
      release_version: s(b.release_version, 60) || 'pro-v1',
      status: 'uploading',
      path: '',
      size,
      seconds: 0,
      featured: false,
      published_at: '',
    }
    const ext = (s(b.ext, 8) || 'mp4').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'mp4'
    item.path = `${item.month}/${item.id}.${ext}`

    await save('pro_videos', item)
    const signed = await supabase.storage.from(BUCKET).createSignedUploadUrl(item.path)
    if (signed.error) return json({ error: 'Could not start the upload: ' + signed.error.message }, 500)
    const raw = signed.data.signedUrl
    return json({
      ok: true,
      id: item.id,
      upload_url: raw.startsWith('http') ? raw : `${Deno.env.get('SUPABASE_URL')}/storage/v1${raw}`,
    })
  }

  if (action === 'submit:complete') {
    const items = await readKey('pro_videos')
    const v = items.find((x) => x.id === s(b.id, 60))
    if (!v) return json({ error: 'not found' }, 404)
    v.status = 'review'
    v.size = Math.max(0, parseInt(s(b.size), 10) || v.size || 0)
    v.seconds = Math.max(0, Math.round(parseFloat(s(b.seconds)) || 0))
    await save('pro_videos', v)
    notifyOffice(v).catch(() => {})
    return json({ ok: true })
  }

  // -------------------------------------------------------------- nominate
  // Anyone can put forward a professional who belongs in the series. This is
  // the best call list there is: "somebody in the community nominated you"
  // opens a door that a cold ask never will.
  if (action === 'nominate') {
    const who = s(b.who_name, 120)
    const org = s(b.who_org, 160)
    if (!who && !org) return json({ error: 'Tell us who you are nominating.' }, 400)
    const item: Row = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      who_name: who,
      who_org: org,
      who_contact: s(b.who_contact, 200),
      category: s(b.category, 60),
      why: s(b.why, 1000),
      from_name: s(b.from_name, 120),
      from_contact: s(b.from_contact, 200),
      status: 'new',
    }
    await save('pro_nominations', item)
    notifyNomination(item).catch(() => {})
    return json({ ok: true })
  }

  // --------------------------------------------------------------- gallery
  if (action === 'gallery') {
    const items = (await readKey('pro_videos'))
      .filter((v) => v.status === 'published')
      .sort((a, x) => String(x.published_at || x.at).localeCompare(String(a.published_at || a.at)))
    const out = items.map((v) => ({
      id: v.id, month: v.month, name: v.name, title: v.title, org: v.org,
      org_url: v.org_url, org_phone: v.org_phone, org_social: v.org_social,
      category: v.category, prompt: v.prompt, seconds: v.seconds, featured: !!v.featured,
      at: v.published_at || v.at,
      watch: supabase.storage.from(BUCKET).getPublicUrl(v.path).data.publicUrl,
    }))
    return json({ ok: true, count: out.length, videos: out })
  }

  return json({ error: 'unknown action' }, 400)

  // ---------------------------------------------------------------- notify
  async function notifyNomination(n: Row) {
    const ghlToken = Deno.env.get('GHL_TOKEN')
    const ghlLocation = Deno.env.get('GHL_LOCATION_ID')
    if (!ghlToken || !ghlLocation) return
    const h = {
      Authorization: `Bearer ${ghlToken}`, Version: '2021-07-28',
      'Content-Type': 'application/json', Accept: 'application/json',
    }
    const up = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
      method: 'POST', headers: h,
      body: JSON.stringify({ locationId: ghlLocation, email: 'samantha@mo-care.com', firstName: 'Samantha' }),
    })
    const contactId = (await up.json().catch(() => ({})))?.contact?.id
    if (!contactId) return
    const esc = (t: string) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')
    const html = '<div style="font-family:Arial,sans-serif;font-size:15px;color:#16283a;line-height:1.6;">'
      + '<p style="font-size:30px;margin:0 0 8px;">👋</p>'
      + '<p><b>' + esc(n.who_name || '(no name given)') + '</b>'
      + (n.who_org ? '<br>' + esc(n.who_org) : '') + (n.category ? ' &middot; ' + esc(n.category) : '') + '</p>'
      + (n.who_contact ? '<p><b>How to reach them:</b> ' + esc(n.who_contact) + '</p>' : '')
      + (n.why ? '<p><b>Why they belong in it:</b><br>' + esc(n.why) + '</p>' : '')
      + '<p style="background:#EAF4F6;border-radius:10px;padding:14px 16px;">'
      + (n.from_name ? 'Nominated by <b>' + esc(n.from_name) + '</b>' + (n.from_contact ? ' (' + esc(n.from_contact) + ')' : '')
        : 'Nominated anonymously')
      + '. When you call, lead with that. It is a far better opening than a cold ask.</p>'
      + '<p style="color:#55677a;font-size:13px;">Also in the hub under 417 Series &rarr; Invite people.</p></div>'
    await fetch('https://services.leadconnectorhq.com/conversations/messages', {
      method: 'POST', headers: h,
      body: JSON.stringify({
        type: 'Email', contactId,
        subject: '👋 Someone nominated ' + (n.who_name || n.who_org) + ' for 417 Caring Community',
        html,
      }),
    })
  }

  async function notifyOffice(v: Row) {
    const ghlToken = Deno.env.get('GHL_TOKEN')
    const ghlLocation = Deno.env.get('GHL_LOCATION_ID')
    if (!ghlToken || !ghlLocation) return
    const h = {
      Authorization: `Bearer ${ghlToken}`, Version: '2021-07-28',
      'Content-Type': 'application/json', Accept: 'application/json',
    }
    const up = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
      method: 'POST', headers: h,
      body: JSON.stringify({ locationId: ghlLocation, email: 'samantha@mo-care.com', firstName: 'Samantha' }),
    })
    const contactId = (await up.json().catch(() => ({})))?.contact?.id
    if (!contactId) return
    const esc = (t: string) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')
    const html = '<div style="font-family:Arial,sans-serif;font-size:15px;color:#16283a;line-height:1.6;">'
      + '<p style="font-size:30px;margin:0 0 8px;">🎙️</p>'
      + '<p><b>' + esc(v.name) + '</b>' + (v.title ? ', ' + esc(v.title) : '') + '<br>'
      + esc(v.org) + (v.category ? ' &middot; ' + esc(v.category) : '') + '</p>'
      + '<p style="background:#EAF4F6;border-radius:10px;padding:14px 16px;"><b>Their question:</b><br>' + esc(v.prompt) + '</p>'
      + (v.notes ? '<p><b>They added:</b><br>' + esc(v.notes) + '</p>' : '')
      + (v.email ? '<p><b>Reach them:</b> ' + esc(v.email) + (v.org_phone ? ' &middot; ' + esc(v.org_phone) : '') + '</p>' : '')
      + '<p style="background:#fdf3e2;border-radius:10px;padding:14px 16px;">Nothing is public yet. '
      + 'Watch it in the hub under <b>417 Series</b> and press Publish if you want it in this month\'s issue.</p>'
      + '<p style="color:#55677a;font-size:13px;">A thank-you the same day is what keeps them referring.</p></div>'
    await fetch('https://services.leadconnectorhq.com/conversations/messages', {
      method: 'POST', headers: h,
      body: JSON.stringify({
        type: 'Email', contactId,
        subject: '🎙️ 417 Caring Community: ' + v.name + ' at ' + v.org + ' sent one in',
        html,
      }),
    })
  }
})
