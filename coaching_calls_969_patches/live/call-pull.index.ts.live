// =============================================================================
// call-pull — finished calls reach the Hub by themselves (Desktop 372, 2026-09-30)
// =============================================================================
// Samantha approved ("yes to all"): the GoHighLevel call-transcript workflow never delivered, but GoHighLevel
// transcribes every answered call (371). Every 10 minutes this takes answered calls made since go-live
// (ops_settings.call_pull_since), gets GoHighLevel's transcript and the contact's name/phone/email, and hands them to
// call-followup (the call reader), exactly the shape the old workflow sent. Each call is handled once (call_pull_seen).
//
// PRACTICE until ops_settings.call_pull_live === true: the call reader is asked with ?dry=1, so it says what it would
// do (create/update a lead, or "not a client lead") and creates nothing. Calls seen in practice are not redone later.
// Missed calls (no talk time) are skipped: the Operations Inbox has those. Nothing is ever sent to anyone.
// Runs on its schedule (the vault secret) or the owner's key. Every GoHighLevel request here is a read.
//
// 2026-10-14 (Samantha, "Make this a lead"): the AI no longer makes leads. Calls with a transcript are only recorded
// here (stage done/practice, outcome "ready for the call reader"); call-tasks reads them, and its "new client inquiry"
// shows as the "Sounds like a new family" tag on the Hub. A person presses Make this a lead (call-to-lead). call-followup
// is no longer asked.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jobCaller } from '../_shared/job-auth.ts'

const GHL = 'https://services.leadconnectorhq.com'
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const H = (tok: string, v = '2021-04-15') => ({ Authorization: `Bearer ${tok}`, Version: v, Accept: 'application/json' })
export const CONVOS = 60, PER_RUN = 8, WAIT_TRANSCRIPT_MS = 2 * 3600e3, MAX_TRIES = 3

/* GoHighLevel's transcription: an array of pieces with a speaker channel and the words. Kept tolerant of field names. */
// deno-lint-ignore no-explicit-any
export function transcriptText(t: any): string {
  // deno-lint-ignore no-explicit-any
  const arr: any[] = Array.isArray(t) ? t : (t?.transcription || t?.data || t?.sentences || [])
  if (typeof t === 'string') return t.trim()
  if (!Array.isArray(arr)) return ''
  return arr.slice().sort((a, b) => Number(a?.sentenceIndex ?? a?.startTime ?? 0) - Number(b?.sentenceIndex ?? b?.startTime ?? 0))
    .map((p) => {
      const words = String(p?.transcript ?? p?.sentence ?? p?.text ?? '').trim()
      if (!words) return ''
      const ch = p?.mediaChannel ?? p?.channel ?? p?.speaker
      return (ch != null && ch !== '' ? `Speaker ${ch}: ` : '') + words
    }).filter(Boolean).join('\n')
}
export const shortName = (f: unknown, l: unknown) =>
  [String(f || '').trim(), String(l || '').trim().slice(0, 1)].filter(Boolean).join(' ') + (String(l || '').trim() ? '.' : '')

// deno-lint-ignore no-explicit-any
async function beat(db: any, ok: boolean, note: string) {
  try {
    await db.rpc('upsert_app_data_item', { target_key: 'automation_heartbeats',
      item: { id: 'hb_call-pull', automation: 'call-pull', at: new Date().toISOString(), ok, note: String(note).slice(0, 300) } })
  } catch { /* never block on the heartbeat */ }
}

Deno.serve(async (req) => {
  const caller = await jobCaller(req)
  if (!caller) return json({ error: 'not allowed' }, 401)
  const q = new URL(req.url).searchParams
  if (q.get('auth_check') === '1') return json({ ok: true, caller })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const tok = Deno.env.get('GHL_TOKEN') || Deno.env.get('GHL_API_KEY') || ''
  const loc = Deno.env.get('GHL_LOCATION_ID') || ''
  if (!tok || !loc) { await beat(db, false, 'missing GoHighLevel key/location'); return json({ error: 'not set up' }, 500) }

  const { data: stRow } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const st: any = stRow?.data ?? {}
  const since = Date.parse(String(st.call_pull_since || ''))
  if (!Number.isFinite(since)) { await beat(db, false, 'no call_pull_since set'); return json({ error: 'no start time set' }, 500) }
  const live = st.call_pull_live === true && q.get('dry') !== '1'

  /* 1 · answered calls since go-live, newest conversations first */
  const out = { live, calls_seen: 0, new_calls: 0, handled: 0, practice: 0, done: 0, waiting_transcript: 0, no_transcript: 0, errors: 0 }
  const cRes = await fetch(`${GHL}/conversations/search?locationId=${encodeURIComponent(loc)}&limit=${CONVOS}`, { headers: H(tok) })
  if (!cRes.ok) { await beat(db, false, `conversations/search ${cRes.status}`); return json({ error: `GoHighLevel answered ${cRes.status}` }, 502) }
  // deno-lint-ignore no-explicit-any
  const convos: any[] = (await cRes.json())?.conversations || []
  // deno-lint-ignore no-explicit-any
  const calls: any[] = []
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
          const at = Date.parse(m.dateAdded || m.dateUpdated || '')
          const seconds = Number(m?.meta?.call?.duration || 0)
          if (!(at >= since) || seconds <= 0) continue
          calls.push({ id: String(m.id), at, seconds, inbound: m.direction === 'inbound', contactId: String(m.contactId || c.contactId || '') })
        }
      } catch { /* one conversation failing never stops the run */ }
    }))
  }
  out.calls_seen = calls.length
  if (!calls.length) { await beat(db, true, JSON.stringify(out)); return json({ ok: true, ...out }) }

  const { data: seenRows } = await db.from('call_pull_seen').select('message_id, stage, tries').in('message_id', calls.map((c) => c.id))
  const seen = new Map((seenRows ?? []).map((r: { message_id: string; stage: string; tries: number }) => [r.message_id, r]))
  const todo = calls.filter((c) => { const s = seen.get(c.id); return !s || (s.stage === 'error' && s.tries < MAX_TRIES) })
    .sort((a, b) => a.at - b.at)
  out.new_calls = todo.length

  for (const c of todo.slice(0, PER_RUN)) {
    const prev = seen.get(c.id)
    const row: Record<string, unknown> = { message_id: c.id, call_at: new Date(c.at).toISOString(), direction: c.inbound ? 'in' : 'out',
      seconds: c.seconds, tries: (prev?.tries ?? 0) + 1, handled_at: new Date().toISOString() }
    /* 2 · the transcript (GoHighLevel may still be writing it: wait up to 2 hours, then leave it) */
    const tr = await fetch(`${GHL}/conversations/locations/${encodeURIComponent(loc)}/messages/${encodeURIComponent(c.id)}/transcription`, { headers: H(tok) })
    const text = tr.ok ? transcriptText(await tr.json().catch(() => null)) : ''
    if (!text) {
      if (Date.now() - c.at < WAIT_TRANSCRIPT_MS) { out.waiting_transcript++; continue }
      await db.from('call_pull_seen').upsert({ ...row, stage: 'no_transcript', outcome: `no transcript (${tr.status})` })
      out.no_transcript++; continue
    }
    /* 3 · who it was with, from GoHighLevel's own contact (never from what the AI heard) */
    // deno-lint-ignore no-explicit-any
    let ct: any = {}
    if (c.contactId) {
      try { const r = await fetch(`${GHL}/contacts/${encodeURIComponent(c.contactId)}`, { headers: H(tok, '2021-07-28') }); if (r.ok) ct = (await r.json())?.contact || {} } catch { /* name stays blank */ }
    }
    row.caller = shortName(ct.firstName, ct.lastName) || null
    /* 4 · recorded for the call reader (call-tasks); no lead is made here any more */
    const { error: upErr } = await db.from('call_pull_seen').upsert({ ...row, stage: live ? 'done' : 'practice', outcome: 'ready for the call reader', branch: null })
    if (upErr) { out.errors++; continue }
    out.handled++; if (live) out.done++; else out.practice++
  }
  await beat(db, out.errors === 0, JSON.stringify(out))
  return json({ ok: true, ...out })
})
