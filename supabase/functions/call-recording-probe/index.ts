// =============================================================================
// call-recording-probe — READ ONLY, TEMPORARY (Desktop 967, 2026-10-18). Writes nothing, anywhere.
// =============================================================================
// Samantha's coaching-call requirement (2026-10-18): "verify that our GoHighLevel integration can actually retrieve and
// associate call recordings before building ... Do not assume that every call has a recording." This asks GoHighLevel:
//   A. for the most recent answered calls (talk time > 0, last 14 days): does GoHighLevel hand back the AUDIO for that
//      exact call ID? (status, an audio content type, and bytes actually arriving)
//   B. for a few missed calls (no talk time): does it say there is no recording? (proves the Hub can tell them apart)
//   C. for taps on "Call rings your phone first" (op_events 'call_bridge', last 30 days): can the call be found in that
//      contact's conversation afterward, how long after the tap, is it answered, does it name the user who placed it,
//      and does it have a recording?
// Owner key only (job-auth ownerCaller). Returns counts, day, direction, seconds, minutes and yes/no only: never names,
// numbers, contact ids, call ids or audio. Every GoHighLevel request is a GET; the audio is read only far enough to see
// bytes arrive, then dropped. 967 deletes this function after one use.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { ownerCaller } from '../_shared/job-auth.ts'

const GHL = 'https://services.leadconnectorhq.com'
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const H = (tok: string) => ({ Authorization: `Bearer ${tok}`, Version: '2021-04-15', Accept: 'application/json' })
const DAYS = 14, BRIDGE_DAYS = 30, CONVOS = 100, CHECK = 25, MISSED = 5, BRIDGES = 15, FIND_MIN = 20
// deno-lint-ignore no-explicit-any
type Any = any
const day = (t: number) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' })
const bump = (o: Record<string, number>, k: string) => { o[k] = (o[k] || 0) + 1 }

/** does GoHighLevel return audio for this exact call? {code, audio, bytes} (reads only the first chunk) */
async function recording(tok: string, loc: string, id: string): Promise<{ code: number; audio: boolean; bytes: number }> {
  try {
    const r = await fetch(`${GHL}/conversations/messages/${encodeURIComponent(id)}/locations/${encodeURIComponent(loc)}/recording`, { headers: { ...H(tok), Accept: '*/*' } })
    const ct = String(r.headers.get('content-type') || '').toLowerCase()
    let bytes = 0
    if (r.ok && r.body) { const rd = r.body.getReader(); const first = await rd.read(); bytes = first.value ? first.value.length : 0; try { await rd.cancel() } catch { /* */ } }
    else { try { await r.body?.cancel() } catch { /* */ } }
    return { code: r.status, audio: r.ok && (ct.startsWith('audio/') || ct.includes('octet-stream')) && bytes > 0, bytes }
  } catch { return { code: -1, audio: false, bytes: 0 } }
}
const callsIn = (msgs: Any[]) => (msgs || []).filter((m) => m && m.messageType === 'TYPE_CALL').map((m) => ({ id: String(m.id), at: new Date(m.dateAdded || m.dateUpdated || 0).getTime(),
  inbound: m.direction === 'inbound', duration: Number(m?.meta?.call?.duration || 0), status: String(m?.meta?.call?.status || m.status || ''), user: !!m.userId, keys: Object.keys(m || {}), metaKeys: Object.keys(m?.meta?.call || {}) }))
async function messagesOf(tok: string, convId: string): Promise<Any[]> {
  const r = await fetch(`${GHL}/conversations/${encodeURIComponent(convId)}/messages?limit=50`, { headers: H(tok) })
  if (!r.ok) return []
  const b = await r.json().catch(() => ({}))
  return b?.messages?.messages || b?.messages || []
}

Deno.serve(async (req) => {
  if (!(await ownerCaller(req))) return json({ error: 'not allowed' }, 401)
  const tok = Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || ''
  const loc = Deno.env.get('GHL_LOCATION_ID') || ''
  if (!tok || !loc) return json({ error: 'GoHighLevel key or location missing on the server' }, 500)
  const now = Date.now(), since = now - DAYS * 864e5

  /* A + B: recent calls across recent conversations */
  const cRes = await fetch(`${GHL}/conversations/search?locationId=${encodeURIComponent(loc)}&limit=${CONVOS}`, { headers: H(tok) })
  if (!cRes.ok) return json({ error: `conversations/search answered ${cRes.status}` }, 200)
  const convos: Any[] = (await cRes.json())?.conversations || []
  const calls: Any[] = [], msgKeys = new Set<string>(), metaKeys = new Set<string>(), statuses: Record<string, number> = {}
  for (let i = 0; i < convos.length; i += 10) {
    await Promise.all(convos.slice(i, i + 10).map(async (c) => {
      try { for (const k of callsIn(await messagesOf(tok, c.id))) { if (!(k.at >= since)) continue; k.keys.forEach((x: string) => msgKeys.add(x)); k.metaKeys.forEach((x: string) => metaKeys.add(x)); bump(statuses, k.status || '(none)'); calls.push(k) } }
      catch { /* one conversation failing must not stop the look */ }
    }))
  }
  calls.sort((a, b) => b.at - a.at)
  const answered = calls.filter((c) => c.duration > 0), missed = calls.filter((c) => c.duration <= 0)
  const recAnswers: Record<string, number> = {}, rows: Any[] = []
  for (const c of answered.slice(0, CHECK)) {
    const r = await recording(tok, loc, c.id); bump(recAnswers, String(r.code))
    rows.push({ day: day(c.at), direction: c.inbound ? 'in' : 'out', seconds: c.duration, status: c.status || '(none)', recording: r.audio ? 'yes' : 'no', answered_with: r.code, names_user: c.user })
  }
  const missedRows: Any[] = []
  for (const c of missed.slice(0, MISSED)) { const r = await recording(tok, loc, c.id); missedRows.push({ day: day(c.at), status: c.status || '(none)', recording: r.audio ? 'yes' : 'no', answered_with: r.code }) }

  /* C: taps on "Call rings your phone first" */
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: taps } = await db.from('op_events').select('at, item_id').eq('verb', 'call_bridge').gte('at', new Date(now - BRIDGE_DAYS * 864e5).toISOString()).order('at', { ascending: false }).limit(BRIDGES)
  const bridgeRows: Any[] = []
  for (const t of taps ?? []) {
    const cid = String(t.item_id || '').replace(/^ghl:/, ''), tapAt = Date.parse(t.at)
    let row: Any = { day: day(tapAt), found: 'no', minutes_after_tap: null, seconds: null, recording: 'no', answered_with: null, names_user: null }
    try {
      const s = await fetch(`${GHL}/conversations/search?locationId=${encodeURIComponent(loc)}&contactId=${encodeURIComponent(cid)}`, { headers: H(tok) })
      const cv: Any[] = s.ok ? ((await s.json())?.conversations || []) : []
      const hits: Any[] = []
      for (const c of cv.slice(0, 3)) for (const k of callsIn(await messagesOf(tok, c.id))) if (k.at >= tapAt - 60e3 && k.at <= tapAt + FIND_MIN * 60e3) hits.push(k)
      hits.sort((a, b) => a.at - b.at)
      const k = hits[0]
      if (k) { const r = k.duration > 0 ? await recording(tok, loc, k.id) : { code: 0, audio: false, bytes: 0 }
        row = { day: day(tapAt), found: hits.length > 1 ? 'yes (' + hits.length + ' calls in the window)' : 'yes', minutes_after_tap: Math.round((k.at - tapAt) / 6e4 * 10) / 10,
          seconds: k.duration, status: k.status || '(none)', recording: r.audio ? 'yes' : 'no', answered_with: r.code || 'not asked (no talk time)', names_user: k.user } }
    } catch { row.found = 'error' }
    bridgeRows.push(row)
  }
  return json({ ok: true, days: DAYS, conversations_looked_at: convos.length, calls: calls.length, answered: answered.length, missed: missed.length,
    checked: rows.length, with_recording: rows.filter((r) => r.recording === 'yes').length, recording_answers: recAnswers, rows,
    missed_checked: missedRows.length, missed_with_recording: missedRows.filter((r) => r.recording === 'yes').length, missed_rows: missedRows,
    bridge_days: BRIDGE_DAYS, bridge_taps: bridgeRows.length, bridge_found: bridgeRows.filter((r) => String(r.found).startsWith('yes')).length,
    bridge_with_recording: bridgeRows.filter((r) => r.recording === 'yes').length, bridge_rows: bridgeRows,
    call_statuses: statuses, message_fields: [...msgKeys].sort(), call_fields: [...metaKeys].sort() })
})
