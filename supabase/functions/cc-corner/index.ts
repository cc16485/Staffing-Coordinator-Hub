// Supabase Edge Function: cc-corner (shared hub project)
// -----------------------------------------------------------------------------
// Powers Caregivers Corner on mo-care.com — a moderated support wall for
// family caregivers, plus the support-events calendar.
//
//   GET  ?token=...&action=feed  -> approved posts (with approved replies),
//                                   hearts, and upcoming events
//   POST ?token=...  {action:'post',  name, title, body, email?}  -> pending
//   POST ?token=...  {action:'reply', post_id, name, body}        -> pending
//   POST ?token=...  {action:'heart', post_id}                    -> +1 heart
//
// Posts and replies NEVER appear publicly until a coordinator approves them in
// the Care Coordinator Hub -> Community tab (which edits app_data directly).
// Data: app_data keys `corner_posts` and `corner_events`.
// Uses the existing HT_ORDER_TOKEN secret; no new secrets needed.
// Deploy (CLI): supabase functions deploy cc-corner --no-verify-jwt
// -----------------------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const clean = (v: unknown, n: number) => String(v ?? '').replace(/<[^>]*>/g, '').trim().slice(0, n)

async function notifySamantha(subject: string, html: string) {
  const ghlToken = Deno.env.get('GHL_TOKEN')
  const ghlLocation = Deno.env.get('GHL_LOCATION_ID')
  if (!ghlToken || !ghlLocation) return
  try {
    const h = { Authorization: `Bearer ${ghlToken}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' }
    const up = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
      method: 'POST', headers: h,
      body: JSON.stringify({ locationId: ghlLocation, email: 'samantha@mo-care.com', firstName: 'Samantha' }),
    })
    const contactId = (await up.json().catch(() => ({})))?.contact?.id
    if (contactId) {
      await fetch('https://services.leadconnectorhq.com/conversations/messages', {
        method: 'POST', headers: h,
        body: JSON.stringify({ type: 'Email', contactId, subject, html }),
      })
    }
  } catch { /* best effort */ }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const url = new URL(req.url)
  const expected = Deno.env.get('HT_ORDER_TOKEN') ?? Deno.env.get('HT_SUPPORT_TOKEN')
  if (!expected || url.searchParams.get('token') !== expected) return json({ error: 'unauthorized' }, 401)

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const load = async (key: string) => {
    const { data } = await supabase.from('app_data').select('data').eq('key', key).maybeSingle()
    return Array.isArray(data?.data) ? data.data : []
  }

  if (req.method === 'GET') {
    if (url.searchParams.get('action') !== 'feed') return json({ error: 'unknown action' }, 400)
    const posts = (await load('corner_posts'))
      // deno-lint-ignore no-explicit-any
      .filter((p: any) => p?.status === 'approved')
      // deno-lint-ignore no-explicit-any
      .map((p: any) => {
        // deno-lint-ignore no-explicit-any
        const replies = (p.replies || []).filter((r: any) => r?.status === 'approved')
          // deno-lint-ignore no-explicit-any
          .map((r: any) => ({ id: r.id, at: r.at, name: r.name, body: r.body, team: !!r.team }))
        // deno-lint-ignore no-explicit-any
        const lastActivity = replies.reduce((m: string, r: any) => (r.at > m ? r.at : m), p.at || '')
        return {
          id: p.id, at: p.at, name: p.name, title: p.title, body: p.body,
          hearts: p.hearts || 0, pinned: !!p.pinned, lastActivity, replies,
        }
      })
      // pinned prompts first, then whichever conversation moved most recently
      // deno-lint-ignore no-explicit-any
      .sort((a: any, b: any) => (Number(b.pinned) - Number(a.pinned)) || (b.lastActivity || '').localeCompare(a.lastActivity || ''))
      .slice(0, 60)
    const today = new Date().toISOString().slice(0, 10)
    const events = (await load('corner_events'))
      // deno-lint-ignore no-explicit-any
      .filter((e: any) => e?.date && e.date >= today)
      // deno-lint-ignore no-explicit-any
      .sort((a: any, b: any) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')))
      .slice(0, 12)
    return json({ posts, events })
  }

  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  // deno-lint-ignore no-explicit-any
  let b: Record<string, any> = {}
  try { b = await req.json() } catch { return json({ error: 'bad payload' }, 400) }
  if (b.website) return json({ ok: true }) // honeypot: bots fill every field

  const action = clean(b.action, 20)

  if (action === 'heart') {
    const id = clean(b.post_id, 40)
    const posts = await load('corner_posts')
    // deno-lint-ignore no-explicit-any
    const p = posts.find((x: any) => x?.id === id && x?.status === 'approved')
    if (!p) return json({ error: 'not found' }, 404)
    p.hearts = (p.hearts || 0) + 1
    const { error } = await supabase.rpc('upsert_app_data_item', { target_key: 'corner_posts', item: p })
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true, hearts: p.hearts })
  }

  if (action === 'post') {
    const name = clean(b.name, 60) || 'A caregiver'
    const title = clean(b.title, 140)
    const body = clean(b.body, 3000)
    if (!body) return json({ error: 'Please write something first.' }, 400)
    const item = {
      id: crypto.randomUUID(), at: new Date().toISOString(),
      name, title, body,
      email: clean(b.email, 200), // private — never returned by the feed
      status: 'pending', hearts: 0, replies: [], seen: false,
    }
    const { error } = await supabase.rpc('upsert_app_data_item', { target_key: 'corner_posts', item })
    if (error) return json({ error: error.message }, 500)
    await notifySamantha('💬 Caregivers Corner: new post awaiting review',
      '<div style="font-family:Arial,sans-serif;font-size:15px;color:#16283a;line-height:1.6;">'
      + '<p><b>' + item.name + '</b>' + (title ? ': ' + title : '') + '</p><p>' + body.replace(/\n/g, '<br>') + '</p>'
      + '<p style="color:#55677a;font-size:13px;">Approve or remove it in the Care Coordinator Hub &rarr; Campaigns &rarr; Community.</p></div>')
    return json({ ok: true, pending: true })
  }

  if (action === 'reply') {
    const postId = clean(b.post_id, 40)
    const name = clean(b.name, 60) || 'A caregiver'
    const body = clean(b.body, 2000)
    if (!body) return json({ error: 'Please write something first.' }, 400)
    const posts = await load('corner_posts')
    // deno-lint-ignore no-explicit-any
    const p = posts.find((x: any) => x?.id === postId && x?.status === 'approved')
    if (!p) return json({ error: 'not found' }, 404)
    p.replies = p.replies || []
    if (p.replies.length >= 80) return json({ error: 'thread full' }, 400)
    p.replies.push({ id: crypto.randomUUID(), at: new Date().toISOString(), name, body, status: 'pending', team: false })
    p.pending_replies = true
    const { error } = await supabase.rpc('upsert_app_data_item', { target_key: 'corner_posts', item: p })
    if (error) return json({ error: error.message }, 500)
    await notifySamantha('💬 Caregivers Corner: new reply awaiting review',
      '<div style="font-family:Arial,sans-serif;font-size:15px;color:#16283a;line-height:1.6;">'
      + '<p><b>' + name + '</b> replied to "' + (p.title || p.body.slice(0, 60)) + '":</p><p>' + body.replace(/\n/g, '<br>') + '</p>'
      + '<p style="color:#55677a;font-size:13px;">Approve or remove it in the Care Coordinator Hub &rarr; Campaigns &rarr; Community.</p></div>')
    return json({ ok: true, pending: true })
  }

  if (action === 'notify') {
    // Called by the hub after approving a reply (or posting a team reply):
    // emails the original poster, once per reply, if they left an email.
    const postId = clean(b.post_id, 40)
    const replyId = clean(b.reply_id, 40)
    const posts = await load('corner_posts')
    // deno-lint-ignore no-explicit-any
    const p = posts.find((x: any) => x?.id === postId)
    if (!p || !p.email) return json({ ok: true, notified: false })
    // deno-lint-ignore no-explicit-any
    const r = (p.replies || []).find((x: any) => x?.id === replyId && x?.status === 'approved')
    if (!r || r.notified) return json({ ok: true, notified: false })
    const ghlToken = Deno.env.get('GHL_TOKEN')
    const ghlLocation = Deno.env.get('GHL_LOCATION_ID')
    let sent = false
    if (ghlToken && ghlLocation) {
      try {
        const h = { Authorization: `Bearer ${ghlToken}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' }
        const up = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
          method: 'POST', headers: h,
          body: JSON.stringify({ locationId: ghlLocation, email: p.email, firstName: p.name || 'Friend' }),
        })
        const contactId = (await up.json().catch(() => ({})))?.contact?.id
        if (contactId) {
          const esc = (t: string) => String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')
          const sr = await fetch('https://services.leadconnectorhq.com/conversations/messages', {
            method: 'POST', headers: h,
            body: JSON.stringify({
              type: 'Email', contactId,
              subject: (r.team ? 'Caring Companions replied' : esc(r.name || 'Someone') + ' replied') + ' to your post in Caregivers Corner',
              html: '<div style="font-family:Arial,sans-serif;font-size:15px;color:#16283a;line-height:1.7;">'
                + '<p>Hi ' + esc(p.name || 'there') + ',</p>'
                + '<p>' + (r.team ? 'The Caring Companions team' : esc(r.name || 'Someone')) + ' replied to your post' + (p.title ? ' “' + esc(p.title) + '”' : '') + ':</p>'
                + '<p style="background:#EAF4F6;border-radius:10px;padding:14px 18px;">' + esc(r.body) + '</p>'
                + '<p><a href="https://mo-care.com/caregivers-corner.html" style="color:#1F7A8C;font-weight:700;">Read and reply in Caregivers Corner &rarr;</a></p>'
                + '<p style="color:#55677a;font-size:13px;">You got this note because you shared a post in our caregiver community and left your email. We only email you about replies to your own posts.</p></div>',
            }),
          })
          sent = sr.ok
        }
      } catch { /* best effort */ }
    }
    r.notified = true
    await supabase.rpc('upsert_app_data_item', { target_key: 'corner_posts', item: p })
    return json({ ok: true, notified: sent })
  }

  return json({ error: 'unknown action' }, 400)
})
