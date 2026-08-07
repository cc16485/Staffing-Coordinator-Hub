// Supabase Edge Function: cc-memories (shared hub project)
// Powers The Story Game: caregivers record clients answering a fun question,
// the family watches them in a private library and decides what may be shared.
//
// Two audiences, two different keys, and neither one is a login:
//   caregivers -> a permanent private link holding their player token (k)
//   families   -> a per-client link (c) plus a 6-digit passcode (code)
//
// The family passcode gives watching and hearts. The decision maker's passcode
// gives one extra power: saying yes or no to a video being shared publicly.
// Nothing is ever shareable by default.
//
// Actions (POST JSON, all token-gated like the other public forms):
//   player:load     { k }                          -> question, clients, score
//   player:start    { k, client_id, prompt, ... }  -> signed upload URL
//   player:complete { k, id, size, seconds }
//   family:load     { c, code, vk }                -> videos + viewing links
//   family:heart    { c, code, vk, id }
//   family:share    { c, code, id, decision }      -> decision maker only
//
// Deploy: supabase functions deploy cc-memories --no-verify-jwt. Verify JWT OFF.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const MAX_BYTES = 300 * 1024 * 1024
const BUCKET = 'memories'

// Points are never stored. They are counted from the videos themselves so the
// scoreboard can never drift from what actually happened.
const PT_RECORDED = 1     // showing up
const PT_HEART = 5        // the family loved it
const PT_SHARED = 10      // the family was proud enough to let it out

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

  async function readKey(key: string): Promise<Row[]> {
    const { data } = await supabase.from('app_data').select('data').eq('key', key).maybeSingle()
    return Array.isArray(data?.data) ? data.data : []
  }
  async function save(key: string, item: Row) {
    const { error } = await supabase.rpc('upsert_app_data_item', { target_key: key, item })
    if (error) throw new Error(error.message)
  }
  const monthOf = (iso: string) => String(iso ?? '').slice(0, 7)
  const thisMonth = new Date().toISOString().slice(0, 7)

  function scoreOf(videos: Row[], playerId: string, month?: string) {
    let pts = 0
    for (const v of videos) {
      if (v.player_id !== playerId || v.status !== 'ready' || v.archived) continue
      if (month && monthOf(v.at) !== month) continue
      pts += PT_RECORDED + (Number(v.hearts) || 0) * PT_HEART + (v.share === 'yes' ? PT_SHARED : 0)
    }
    return pts
  }

  // ---------------------------------------------------------------- caregiver
  if (action.startsWith('player:')) {
    const k = s(b.k, 80)
    const players = await readKey('memory_players')
    const player = players.find((p) => p.token && p.token === k && p.active !== false)
    if (!player) return json({ error: 'This link is not working any more. Ask the office for a new one.' }, 403)

    const clientsAll = (await readKey('memory_clients')).filter((c) => c.active !== false && c.consent_at)
    const mine = Array.isArray(player.clients) && player.clients.length
      ? clientsAll.filter((c) => player.clients.includes(c.id))
      : clientsAll

    if (action === 'player:load') {
      const prompts = (await readKey('memory_prompts')).filter((p) => p.active !== false)
      const videos = await readKey('memory_videos')
      const featured = prompts.find((p) => p.featured) || prompts[0] || null
      const board = players
        .filter((p) => p.active !== false)
        .map((p) => ({ id: p.id, name: s(p.name, 60).split(' ')[0], pts: scoreOf(videos, p.id, thisMonth) }))
        .sort((a, x) => x.pts - a.pts)
      const rank = board.findIndex((r) => r.id === player.id) + 1
      const myVideos = videos.filter((v) => v.player_id === player.id && v.status === 'ready' && !v.archived)
      return json({
        ok: true,
        player: { name: player.name, id: player.id },
        featured: featured ? { id: featured.id, text: featured.text } : null,
        prompts: prompts.map((p) => ({ id: p.id, text: p.text })),
        clients: mine.map((c) => ({ id: c.id, name: c.name })),
        me: {
          month_points: scoreOf(videos, player.id, thisMonth),
          all_points: scoreOf(videos, player.id),
          videos: myVideos.length,
          hearts: myVideos.reduce((n, v) => n + (Number(v.hearts) || 0), 0),
          rank,
          of: board.length,
        },
        board: board.slice(0, 5),
      })
    }

    if (action === 'player:start') {
      const client = mine.find((c) => c.id === s(b.client_id, 60))
      if (!client) return json({ error: 'Pick a client from your list first.' }, 400)
      const prompt = s(b.prompt, 300)
      if (!prompt) return json({ error: 'No question chosen.' }, 400)
      const size = Math.max(0, parseInt(s(b.size), 10) || 0)
      if (size > MAX_BYTES) return json({ error: 'That video is too big to send.' }, 413)

      const item: Row = {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        client_id: client.id,
        client_name: client.name,
        player_id: player.id,
        player_name: player.name,
        prompt,
        status: 'uploading',
        path: '',
        size,
        seconds: 0,
        hearts: 0,
        hearted_by: [],
        share: 'pending',
        share_at: '',
        share_by: '',
        family_note: '',
        archived: false,
      }
      const ext = (s(b.ext, 8) || 'mp4').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'mp4'
      item.path = `${client.id}/${item.id}.${ext}`

      await save('memory_videos', item)
      const signed = await supabase.storage.from(BUCKET).createSignedUploadUrl(item.path)
      if (signed.error) return json({ error: 'Could not start the upload: ' + signed.error.message }, 500)
      const raw = signed.data.signedUrl
      return json({
        ok: true,
        id: item.id,
        upload_url: raw.startsWith('http') ? raw : `${Deno.env.get('SUPABASE_URL')}/storage/v1${raw}`,
      })
    }

    if (action === 'player:complete') {
      const videos = await readKey('memory_videos')
      const v = videos.find((x) => x.id === s(b.id, 60) && x.player_id === player.id)
      if (!v) return json({ error: 'not found' }, 404)
      v.status = 'ready'
      v.size = Math.max(0, parseInt(s(b.size), 10) || v.size || 0)
      v.seconds = Math.max(0, Math.round(parseFloat(s(b.seconds)) || 0))
      await save('memory_videos', v)

      // Tell the family there is something new waiting for them.
      const client = (await readKey('memory_clients')).find((c) => c.id === v.client_id)
      if (client?.dm_email) {
        notifyFamily(client, v).catch(() => {})
      }
      const fresh = await readKey('memory_videos')
      return json({ ok: true, month_points: scoreOf(fresh, player.id, thisMonth) })
    }

    return json({ error: 'unknown action' }, 400)
  }

  // ------------------------------------------------------------------- family
  if (action.startsWith('family:')) {
    const clients = await readKey('memory_clients')
    const client = clients.find((c) => c.token && c.token === s(b.c, 80) && c.active !== false)
    if (!client) return json({ error: 'This link is not working any more. Please call the office.' }, 403)

    const code = s(b.code, 12).replace(/\D/g, '')
    const isOwner = !!client.owner_passcode && code === String(client.owner_passcode)
    const isViewer = isOwner || (!!client.passcode && code === String(client.passcode))
    if (!isViewer) return json({ error: 'That code did not match. Check the numbers and try again.' }, 403)

    const videos = (await readKey('memory_videos'))
      .filter((v) => v.client_id === client.id && v.status === 'ready' && !v.archived)
      .sort((a, x) => String(x.at).localeCompare(String(a.at)))

    if (action === 'family:load') {
      const vk = s(b.vk, 60)
      const out = []
      for (const v of videos) {
        let watch = ''
        const signed = await supabase.storage.from(BUCKET).createSignedUrl(v.path, 3600)
        if (signed.data) watch = signed.data.signedUrl
        out.push({
          id: v.id, prompt: v.prompt, at: v.at, player_name: v.player_name,
          seconds: v.seconds, hearts: Number(v.hearts) || 0,
          hearted: Array.isArray(v.hearted_by) && v.hearted_by.includes(vk),
          share: v.share || 'pending', watch,
        })
      }
      return json({
        ok: true,
        client: { name: client.name, first: String(client.name || '').split(' ')[0] },
        role: isOwner ? 'owner' : 'viewer',
        videos: out,
      })
    }

    if (action === 'family:heart') {
      const vk = s(b.vk, 60)
      const v = videos.find((x) => x.id === s(b.id, 60))
      if (!v) return json({ error: 'not found' }, 404)
      v.hearted_by = Array.isArray(v.hearted_by) ? v.hearted_by : []
      if (v.hearted_by.includes(vk)) return json({ ok: true, hearts: Number(v.hearts) || 0, already: true })
      v.hearted_by.push(vk)
      v.hearts = (Number(v.hearts) || 0) + 1
      await save('memory_videos', v)
      return json({ ok: true, hearts: v.hearts })
    }

    if (action === 'family:share') {
      if (!isOwner) return json({ error: 'Only the family decision maker can answer this one.' }, 403)
      const v = videos.find((x) => x.id === s(b.id, 60))
      if (!v) return json({ error: 'not found' }, 404)
      const d = s(b.decision, 10)
      if (d !== 'yes' && d !== 'no' && d !== 'pending') return json({ error: 'bad decision' }, 400)
      v.share = d
      v.share_at = new Date().toISOString()
      v.share_by = s(client.decision_maker, 120) || 'family decision maker'
      if (s(b.note, 500)) v.family_note = s(b.note, 500)
      await save('memory_videos', v)
      return json({ ok: true, share: v.share })
    }

    return json({ error: 'unknown action' }, 400)
  }

  return json({ error: 'unknown action' }, 400)

  // --------------------------------------------------------------- notify
  async function notifyFamily(client: Row, v: Row) {
    const ghlToken = Deno.env.get('GHL_TOKEN')
    const ghlLocation = Deno.env.get('GHL_LOCATION_ID')
    if (!ghlToken || !ghlLocation || !client.dm_email) return
    const h = {
      Authorization: `Bearer ${ghlToken}`, Version: '2021-07-28',
      'Content-Type': 'application/json', Accept: 'application/json',
    }
    const up = await fetch('https://services.leadconnectorhq.com/contacts/upsert', {
      method: 'POST', headers: h,
      body: JSON.stringify({
        locationId: ghlLocation,
        email: client.dm_email,
        firstName: String(client.decision_maker || '').split(' ')[0] || 'there',
      }),
    })
    const contactId = (await up.json().catch(() => ({})))?.contact?.id
    if (!contactId) return
    const first = String(client.name || 'your loved one').split(' ')[0]
    const site = 'https://mo-care.com/memories?c=' + encodeURIComponent(client.token)
    const esc = (t: string) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    const html = '<div style="font-family:Arial,sans-serif;font-size:15px;color:#16283a;line-height:1.6;">'
      + '<p style="font-size:30px;margin:0 0 8px;">🎬</p>'
      + '<p>There is a new video of <b>' + esc(first) + '</b> waiting in the memory library.</p>'
      + '<p style="background:#EAF4F6;border-radius:10px;padding:14px 16px;"><b>The question was:</b><br>'
      + esc(v.prompt) + '</p>'
      + '<p><a href="' + site + '" style="display:inline-block;background:#1F7A8C;color:#fff;font-weight:bold;'
      + 'padding:12px 24px;border-radius:9px;text-decoration:none;">Watch it &rarr;</a></p>'
      + '<p style="color:#55677a;font-size:13px;">You will need the 6-digit code the office gave you. '
      + 'Recorded by ' + esc(v.player_name) + '.</p></div>'
    await fetch('https://services.leadconnectorhq.com/conversations/messages', {
      method: 'POST', headers: h,
      body: JSON.stringify({ type: 'Email', contactId, subject: 'A new memory of ' + first + ' 🎬', html }),
    })
  }
})
