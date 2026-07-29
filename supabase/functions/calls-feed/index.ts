// Supabase Edge Function: calls-feed (shared hub project)
// -----------------------------------------------------------------------------
// GoHighLevel has no standalone phone page — calls are buried inside
// Conversations and a reporting table. This gives the CC Hub a real Calls view:
// who called, when, which direction, how long, and the recording.
//
// GHL has no "list all calls" endpoint either, so we walk recent conversations
// and pull the TYPE_CALL messages out of each. That's a fan-out, so results are
// cached in app_data 'calls_cache' and only refetched when stale.
//
// Modes (POST body):
//   {}                      -> cached list, refetching only if older than TTL
//   { refresh: true }       -> force a refetch
//   { recording: "<msgId>" } -> streams that call's audio back
//
// The recording proxy exists so the GHL token never reaches a browser. The hub
// fetches the audio with its own Supabase session and plays it from a blob.
//
// Auth: POST with a signed-in SHARED-project user's access token (same gate as
// interview-feed). Secrets: GHL_TOKEN (or GHL_API_KEY), GHL_LOCATION_ID.
// Deploy: supabase functions deploy calls-feed --project-ref zngsgedlsxinbygwmxwn
// -----------------------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const GHL_BASE = 'https://services.leadconnectorhq.com'
const CACHE_KEY = 'calls_cache'
const CACHE_TTL_MS = 5 * 60 * 1000   // calls don't need to be to-the-second fresh
const CONVOS_SCANNED = 60            // most recent conversations to look inside
const FANOUT = 10                    // parallel message fetches
const MAX_CALLS = 120

type Call = {
  id: string
  contact_id: string
  conversation_id: string
  name: string
  phone: string
  direction: 'inbound' | 'outbound'
  status: string
  duration: number          // seconds; 0 when never connected
  at: string                // ISO
  has_recording: boolean
}

const ghlHeaders = (tok: string) => ({
  Authorization: `Bearer ${tok}`,
  Version: '2021-04-15',
  Accept: 'application/json',
})

// A call that never connected has no duration. GHL words these a few different
// ways depending on what the carrier reported, so treat anything that isn't a
// completed call with airtime as missed.
function isMissed(status: string, duration: number): boolean {
  const s = (status || '').toLowerCase()
  if (s.includes('no-answer') || s.includes('busy') || s.includes('failed') || s.includes('canceled')) return true
  return duration <= 0
}

async function fetchCalls(tok: string, locationId: string): Promise<Call[]> {
  const cRes = await fetch(
    `${GHL_BASE}/conversations/search?locationId=${encodeURIComponent(locationId)}&limit=${CONVOS_SCANNED}`,
    { headers: ghlHeaders(tok) },
  )
  if (!cRes.ok) throw new Error(`conversations/search returned ${cRes.status}`)
  // deno-lint-ignore no-explicit-any
  const convos: any[] = (await cRes.json())?.conversations || []

  const out: Call[] = []
  for (let i = 0; i < convos.length; i += FANOUT) {
    const batch = convos.slice(i, i + FANOUT)
    await Promise.all(batch.map(async (c) => {
      try {
        const r = await fetch(`${GHL_BASE}/conversations/${c.id}/messages?limit=50`, { headers: ghlHeaders(tok) })
        if (!r.ok) return
        const body = await r.json()
        // GHL nests this one level deeper than you'd expect.
        // deno-lint-ignore no-explicit-any
        const msgs: any[] = body?.messages?.messages || body?.messages || []
        for (const m of msgs) {
          if (m.messageType !== 'TYPE_CALL') continue
          const duration = Number(m?.meta?.call?.duration || 0)
          const inbound = m.direction === 'inbound'
          out.push({
            id: String(m.id),
            contact_id: String(m.contactId || c.contactId || ''),
            conversation_id: String(c.id),
            name: c.fullName || c.contactName || 'Unknown caller',
            // Show the other party's number, not ours.
            phone: String((inbound ? m.from : m.to) || c.phone || ''),
            direction: inbound ? 'inbound' : 'outbound',
            status: String(m?.meta?.call?.status || m.status || ''),
            duration,
            at: m.dateAdded || m.dateUpdated || '',
            has_recording: duration > 0,
          })
        }
      } catch (_e) { /* one bad conversation shouldn't empty the page */ }
    }))
  }

  out.sort((a, b) => (b.at || '').localeCompare(a.at || ''))
  return out.slice(0, MAX_CALLS)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const { data: u } = await admin.auth.getUser(jwt)
  if (!u?.user) return json({ error: 'sign in required' }, 401)

  const tok = Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY')
  const locationId = Deno.env.get('GHL_LOCATION_ID')
  if (!tok || !locationId) return json({ error: 'GoHighLevel is not configured on this project' }, 500)

  // deno-lint-ignore no-explicit-any
  let body: Record<string, any> = {}
  try { body = await req.json() } catch { /* an empty body is a plain list request */ }

  // ── Recording proxy ────────────────────────────────────────────────────────
  if (body.recording) {
    const url = `${GHL_BASE}/conversations/messages/${encodeURIComponent(String(body.recording))}/locations/${encodeURIComponent(locationId)}/recording`
    const r = await fetch(url, { headers: ghlHeaders(tok) })
    if (!r.ok) return json({ error: 'no recording for that call', status: r.status }, r.status === 404 ? 404 : 502)
    return new Response(r.body, {
      headers: { ...cors, 'Content-Type': r.headers.get('content-type') || 'audio/x-wav' },
    })
  }

  // ── List ───────────────────────────────────────────────────────────────────
  const { data: cached } = await admin.from('app_data').select('data').eq('key', CACHE_KEY).maybeSingle()
  // deno-lint-ignore no-explicit-any
  const prev: any = cached?.data || null
  const age = prev?.generated_at ? Date.now() - Date.parse(prev.generated_at) : Infinity

  if (!body.refresh && prev?.calls && age < CACHE_TTL_MS) {
    return json({ calls: prev.calls, generated_at: prev.generated_at, cached: true })
  }

  try {
    const calls = await fetchCalls(tok, locationId)
    const payload = { calls, generated_at: new Date().toISOString() }
    // Service role writes app_data directly; `key` is the primary key.
    const { error: wErr } = await admin.from('app_data').upsert({ key: CACHE_KEY, data: payload })
    if (wErr) console.error('calls-feed cache write failed (serving live results anyway):', wErr.message)
    return json({ ...payload, cached: false })
  } catch (err) {
    console.error('calls-feed:', err)
    // Stale beats blank — show what we had rather than an empty page.
    if (prev?.calls) return json({ calls: prev.calls, generated_at: prev.generated_at, cached: true, stale: true })
    return json({ error: String(err) }, 502)
  }
})
