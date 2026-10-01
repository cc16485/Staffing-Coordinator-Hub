// =============================================================================
// call-transcript-probe — READ ONLY, TEMPORARY (Desktop 371, 2026-09-30). Writes nothing, anywhere.
// =============================================================================
// Question: does GoHighLevel have transcripts for our recent answered calls? If yes, the Hub can fetch calls and
// their transcripts itself (no GHL workflow). If no, call transcription is off in GoHighLevel.
// Owner key only (job-auth ownerCaller). Returns counts, day, direction, duration and yes/no only: never names,
// numbers, contact ids or transcript words. Every GHL request is a GET. 371 deletes this function after one use.
// =============================================================================
import { ownerCaller } from '../_shared/job-auth.ts'

const GHL = 'https://services.leadconnectorhq.com'
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const H = (tok: string) => ({ Authorization: `Bearer ${tok}`, Version: '2021-04-15', Accept: 'application/json' })
const DAYS = 14, CONVOS = 100, CHECK = 20

Deno.serve(async (req) => {
  if (!(await ownerCaller(req))) return json({ error: 'not allowed' }, 401)
  const tok = Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || ''
  const loc = Deno.env.get('GHL_LOCATION_ID') || ''
  if (!tok || !loc) return json({ error: 'GoHighLevel key or location missing on the server' }, 500)
  const since = Date.now() - DAYS * 864e5

  const cRes = await fetch(`${GHL}/conversations/search?locationId=${encodeURIComponent(loc)}&limit=${CONVOS}`, { headers: H(tok) })
  if (!cRes.ok) return json({ error: `conversations/search answered ${cRes.status}` }, 200)
  // deno-lint-ignore no-explicit-any
  const convos: any[] = (await cRes.json())?.conversations || []

  // deno-lint-ignore no-explicit-any
  const calls: any[] = []
  const metaKeys = new Set<string>()
  for (let i = 0; i < convos.length; i += 10) {
    await Promise.all(convos.slice(i, i + 10).map(async (c) => {
      try {
        const r = await fetch(`${GHL}/conversations/${c.id}/messages?limit=50`, { headers: H(tok) })
        if (!r.ok) return
        const b = await r.json()
        // deno-lint-ignore no-explicit-any
        const msgs: any[] = b?.messages?.messages || b?.messages || []
        for (const m of msgs) {
          if (m.messageType !== 'TYPE_CALL') continue
          const at = new Date(m.dateAdded || m.dateUpdated || 0).getTime()
          if (!(at >= since)) continue
          Object.keys(m?.meta?.call || {}).forEach((k) => metaKeys.add(k))
          calls.push({ id: String(m.id), at, inbound: m.direction === 'inbound',
            duration: Number(m?.meta?.call?.duration || 0), status: String(m?.meta?.call?.status || m.status || '') })
        }
      } catch { /* one conversation failing must not stop the look */ }
    }))
  }
  calls.sort((a, b) => b.at - a.at)
  const answered = calls.filter((c) => c.duration > 0)
  const statusCodes: Record<string, number> = {}
  const rows: Array<Record<string, unknown>> = []
  for (const c of answered.slice(0, CHECK)) {
    let code = 0, has = false, pieces = 0
    try {
      const r = await fetch(`${GHL}/conversations/locations/${encodeURIComponent(loc)}/messages/${encodeURIComponent(c.id)}/transcription`, { headers: H(tok) })
      code = r.status
      if (r.ok) {
        const t = await r.json().catch(() => null)
        // deno-lint-ignore no-explicit-any
        const arr: any[] = Array.isArray(t) ? t : (t?.transcription || t?.data || t?.sentences || [])
        pieces = Array.isArray(arr) ? arr.length : 0
        has = pieces > 0 || (typeof t === 'string' && t.length > 0)
      }
    } catch { code = -1 }
    statusCodes[String(code)] = (statusCodes[String(code)] || 0) + 1
    rows.push({ day: new Date(c.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' }),
      direction: c.inbound ? 'in' : 'out', seconds: c.duration, transcript: has ? 'yes' : 'no', answered_with: code, pieces })
  }
  return json({ ok: true, days: DAYS, conversations_looked_at: convos.length, calls: calls.length, answered: answered.length,
    checked: rows.length, with_transcript: rows.filter((r) => r.transcript === 'yes').length,
    transcription_answers: statusCodes, call_fields_ghl_sends: [...metaKeys].sort(), rows })
})
