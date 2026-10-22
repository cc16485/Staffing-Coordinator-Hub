// =============================================================================
// QUIET CLIENTS (Pause care / End care, Samantha 2026-10-07): "Pausing immediately stops shift alerts, routine outreach and
// normal check-in work." The shift jobs (missed clock-ins, running late, open-shift coverage, missed care notes, Care Match
// follow-ups) skip every visit for a client whose care is PAUSED (an open client_pause) or has ENDED (their client role is
// past). Loaded once per run; if it can't be read the run carries on exactly as before (never stops a real alert).
// =============================================================================
// NOT CLIENTS (Samantha 2026-10-12: "nothing should happen for office staff"). Some AxisCare "clients" are not people in
// care: "Office Staff" (#293) holds office time. The Hub's setting ops_settings.not_client_ax (an owner changes it on the
// Clients tab) lists them by AxisCare number; until anyone changes it, it holds Office Staff, the same default the Hub
// uses. They join the quiet list, so every shift job above skips their visits, and isNotClient() lets every other job
// (morning texts, AI note review, Morning Brief, Family Circles, campaigns, review asks, eligibility) leave them out.
// If the setting can't be read the default still applies: a misread never starts texting about office time.
// =============================================================================
// deno-lint-ignore no-explicit-any
type Any = any
export const NOT_CLIENT_START = ['293']
let NOT_CLIENTS: Set<string> = new Set(NOT_CLIENT_START)
/** the not-client AxisCare numbers from the Hub setting (default: Office Staff, #293) */
export async function loadNotClients(db: Any): Promise<Set<string>> {
  try {
    const { data, error } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
    if (error) throw error
    const list = data?.data?.not_client_ax
    NOT_CLIENTS = Array.isArray(list) ? new Set(list.map((x: Any) => String(x?.ax ?? x ?? '').trim()).filter(Boolean)) : new Set(NOT_CLIENT_START)
  } catch { NOT_CLIENTS = new Set(NOT_CLIENT_START) }
  return NOT_CLIENTS
}
/** is this AxisCare client number (or a visit / client object carrying one) a not-client record? */
export function isNotClient(v: Any): boolean {
  const id = v != null && typeof v === 'object' ? (v.client?.id ?? v.id ?? v.axiscare_client_id) : v
  return (id != null && NOT_CLIENTS.has(String(id).trim())) || isPracticeName(v)
}
/* THE PRACTICE CLIENT (2026-10-22, the In Training plan: the Staffing Coordinator puts a short practice visit on a fake AxisCare
   client named "Practice" for a new hire's test clock-in). Caught by name as well as by number, so nothing fires for it even
   before its number is on the not-client list. Only the exact name: "Practice" or "Practice Client" (first + last). */
export const PRACTICE_NAME = /^practice( client)?$/i
export function isPracticeName(v: Any): boolean {
  if (v == null || typeof v !== 'object') return false
  const c = v.client && typeof v.client === 'object' ? v.client : v
  const nm = [c.firstName ?? c.first_name, c.lastName ?? c.last_name].map((x: Any) => String(x ?? '').trim()).filter(Boolean).join(' ') || String(c.name ?? '').trim()
  return !!nm && PRACTICE_NAME.test(nm)
}
export function notClientSet(): Set<string> { return NOT_CLIENTS }
let QUIET: Set<string> = new Set()
export async function loadQuiet(db: Any): Promise<Set<string>> {
  await loadNotClients(db)
  try {
    const out = new Set<string>(NOT_CLIENTS)
    const { data: ps } = await db.from('client_pause').select('axiscare_client_id').eq('status', 'open')
    for (const p of ps ?? []) if (p?.axiscare_client_id) out.add(String(p.axiscare_client_id))
    const { data: roles } = await db.from('person_role').select('person_id, status').eq('role', 'client')
    const byPerson = new Map<string, string[]>()
    for (const r of roles ?? []) { const k = String(r.person_id); byPerson.set(k, [...(byPerson.get(k) || []), String(r.status)]) }
    const ended = [...byPerson.entries()].filter(([, st]) => st.length && !st.includes('active')).map(([k]) => k)
    if (ended.length) {
      const { data: links } = await db.from('person_source_id').select('person_id, source_id').eq('system', 'axiscare').eq('entity_type', 'client').in('person_id', ended)
      for (const l of links ?? []) if (l?.source_id) out.add(String(l.source_id))
    }
    QUIET = out
  } catch { QUIET = new Set(NOT_CLIENTS) }
  return QUIET
}
/** is this AxisCare visit for a paused or ended client, or a not-client record (Office Staff)? */
export function isQuiet(v: Any): boolean { const id = v?.client?.id; return (id != null && QUIET.has(String(id))) || isPracticeName(v) }
export function quietSet(): Set<string> { return QUIET }
