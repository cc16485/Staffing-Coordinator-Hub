// =============================================================================
// coaching-calls.ts · coaching by recorded phone call (Samantha 2026-10-18: "Start the coaching calls build"; design in
// the doc "Care Coordinator Leads and Bonus", tab "Coaching calls (proposal)"; Desktop 967 findings)
// =============================================================================
// The rules, pure, plus the two GoHighLevel reads they need. Her choices (2026-10-18): the safer matching, with the
// manager's own pick list as the backup; the tab's recommended defaults for the 7 decisions.
//   · After a tap on Call now, the call that counts is the FIRST call in that employee's GoHighLevel conversation that
//     the manager placed (the message's userId is the manager's GoHighLevel user), starting from a minute before the
//     tap to 10 minutes after it. One call counts for one coaching record only.
//   · If nothing matches, the manager picks the call from a short list of their own recent calls with that employee.
//   · Either way it qualifies only when: its status is completed (never voicemail or no answer), it ran at least the
//     minimum (3 minutes, ops_settings.coaching_call_min_seconds), GoHighLevel returned the recording for that exact
//     message, and the manager confirms they spoke with the employee. Anything else is kept as an attempt with the
//     reason, and the coaching stays open. (967: 1 and 2 second "completed" calls and a voicemail had recordings, so a
//     recording alone proves nothing.)
//   · Privacy: a coaching call is kept out of the Calls view, the AI call reader and AxisCare. skipRule() says which
//     calls those must leave alone: a linked call by its message id, and any call with a coaching contact from a
//     minute before a tap to an hour after it (so a call is private even before it is linked).
// =============================================================================
// deno-lint-ignore no-explicit-any
type Any = any
export const DEFAULT_MIN_SECONDS = 180
export const MATCH_BEFORE_MS = 60_000
export const MATCH_AFTER_MS = 10 * 60_000
export const PRIVATE_AFTER_MS = 60 * 60_000
export const PICK_DAYS = 14
export const GHL = 'https://services.leadconnectorhq.com'
const H = (tok: string) => ({ Authorization: `Bearer ${tok}`, Version: '2021-04-15', Accept: 'application/json' })

export type Call = { id: string; at: number; seconds: number; status: string; userId: string; direction: 'in' | 'out'; contactId: string }
export const minSeconds = (ops: Any) => { const n = Number(ops?.coaching_call_min_seconds); return Number.isFinite(n) && n >= 60 && n <= 1800 ? Math.round(n) : DEFAULT_MIN_SECONDS }
export const digitsOf = (p: unknown) => { const d = String(p ?? '').replace(/\D/g, ''); return d.length === 11 && d[0] === '1' ? d.slice(1) : d }

/** A GoHighLevel conversation message, as a call (null when it is not a call). */
export function asCall(m: Any, contactId = ''): Call | null {
  if (!m || m.messageType !== 'TYPE_CALL') return null
  const at = Date.parse(m.dateAdded || m.dateUpdated || '')
  if (!Number.isFinite(at)) return null
  return { id: String(m.id), at, seconds: Number(m?.meta?.call?.duration || 0) || 0, status: String(m?.meta?.call?.status || m.status || '').toLowerCase(),
    userId: String(m.userId || ''), direction: m.direction === 'inbound' ? 'in' : 'out', contactId: String(m.contactId || contactId || '') }
}

/** The call a tap produced: the manager's first call to this contact from a minute before the tap to 10 minutes after,
 *  not already linked to a coaching record. Null when there is none (then the pick list). */
export function matchAfterTap(calls: Call[], tapAt: number, managerUserId: string, linked: Set<string>): Call | null {
  if (!managerUserId) return null
  return calls.filter((c) => c.userId === managerUserId && c.at >= tapAt - MATCH_BEFORE_MS && c.at <= tapAt + MATCH_AFTER_MS && !linked.has(c.id))
    .sort((a, b) => a.at - b.at)[0] || null
}

/** The manager's own recent calls with this employee, newest first, not linked to another record (the backup). */
export function pickList(calls: Call[], managerUserId: string, linked: Set<string>, now: number, days = PICK_DAYS): Call[] {
  if (!managerUserId) return []
  return calls.filter((c) => c.userId === managerUserId && c.at >= now - days * 864e5 && c.at <= now && !linked.has(c.id))
    .sort((a, b) => b.at - a.at).slice(0, 10)
}

/** Does the call (without the manager's word) count? The reason, in words, when it does not. */
export function qualify(c: Pick<Call, 'status' | 'seconds'>, recordingOk: boolean | null, min: number): { ok: boolean; reason: string } {
  const st = String(c.status || '').toLowerCase()
  if (st.includes('voicemail')) return { ok: false, reason: 'It went to voicemail.' }
  if (/no[-_ ]?answer|missed|busy|fail|cancel/.test(st)) return { ok: false, reason: 'Nobody answered.' }
  if (st !== 'completed' && st !== 'answered') return { ok: false, reason: `The call did not connect (${st || 'no status'}).` }
  if (c.seconds < min) return { ok: false, reason: `It was too short (${c.seconds} seconds; at least ${Math.round(min / 60)} minutes counts).` }
  if (recordingOk !== true) return { ok: false, reason: 'GoHighLevel has no recording for this call.' }
  return { ok: true, reason: '' }
}

export type SkipRow = { ghl_message_id?: string | null; ghl_contact_id?: string | null; phone_digits?: string | null; tap_at?: string | null }
/** Which calls the Calls view, the AI call reader and AxisCare must leave alone. */
export function skipRule(rows: SkipRow[]) {
  const ids = new Set(rows.map((r) => String(r.ghl_message_id || '')).filter(Boolean))
  const taps = rows.filter((r) => r.tap_at).map((r) => ({ contact: String(r.ghl_contact_id || ''), phone: String(r.phone_digits || ''), at: Date.parse(String(r.tap_at)) }))
    .filter((t) => Number.isFinite(t.at))
  return (m: { id?: unknown; contactId?: unknown; phone?: unknown; at?: unknown }): boolean => {
    if (m.id && ids.has(String(m.id))) return true
    const at = typeof m.at === 'number' ? m.at : Date.parse(String(m.at ?? ''))
    const cid = String(m.contactId ?? ''), ph = digitsOf(m.phone)
    return taps.some((t) => ((cid && t.contact === cid) || (ph.length === 10 && t.phone === ph))
      && (!Number.isFinite(at) || (at >= t.at - MATCH_BEFORE_MS && at <= t.at + PRIVATE_AFTER_MS)))
  }
}
/** The skip rule from the database: every coaching call ever tapped or linked (a small table). Throws when it cannot
 *  read; the callers then keep calls private (they do not show, read or send them) until it can. */
export async function loadSkip(db: Any) {
  const { data, error } = await db.from('hr_coaching_call').select('ghl_message_id, ghl_contact_id, phone_digits, tap_at')
  if (error) throw new Error('coaching calls could not be read: ' + error.message)
  return skipRule(data || [])
}

/* ── GoHighLevel reads ── */
/** Every call in this contact's conversations (the first 3), newest conversation first. */
export async function contactCalls(tok: string, loc: string, contactId: string, send: typeof fetch = fetch): Promise<Call[]> {
  const s = await send(`${GHL}/conversations/search?locationId=${encodeURIComponent(loc)}&contactId=${encodeURIComponent(contactId)}`, { headers: H(tok) })
  if (!s.ok) throw new Error('GoHighLevel answered ' + s.status)
  const convs: Any[] = (await s.json().catch(() => ({})))?.conversations || []
  const out: Call[] = []
  for (const c of convs.slice(0, 3)) {
    const r = await send(`${GHL}/conversations/${encodeURIComponent(String(c.id))}/messages?limit=50`, { headers: H(tok) })
    if (!r.ok) continue
    const b = await r.json().catch(() => ({}))
    for (const m of (b?.messages?.messages || b?.messages || [])) { const k = asCall(m, contactId); if (k) out.push(k) }
  }
  return out
}
export const recordingUrl = (loc: string, id: string) => `${GHL}/conversations/messages/${encodeURIComponent(id)}/locations/${encodeURIComponent(loc)}/recording`
/** Did GoHighLevel return audio for this exact call? (2xx, an audio type, at least one byte; the stream is then closed) */
export async function recordingOk(tok: string, loc: string, id: string, send: typeof fetch = fetch): Promise<boolean> {
  try {
    const r = await send(recordingUrl(loc, id), { headers: { ...H(tok), Accept: '*/*' } })
    const ct = String(r.headers.get('content-type') || '').toLowerCase()
    if (!r.ok || !(ct.startsWith('audio/') || ct.includes('octet-stream')) || !r.body) { try { await r.body?.cancel() } catch { /* */ } return false }
    const rd = r.body.getReader(); const first = await rd.read(); try { await rd.cancel() } catch { /* */ }
    return !!first.value && first.value.length > 0
  } catch { return false }
}
