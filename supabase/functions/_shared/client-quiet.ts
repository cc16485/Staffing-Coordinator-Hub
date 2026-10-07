// =============================================================================
// QUIET CLIENTS (Pause care / End care, Samantha 2026-10-07): "Pausing immediately stops shift alerts, routine outreach and
// normal check-in work." The shift jobs (missed clock-ins, running late, open-shift coverage, missed care notes, Care Match
// follow-ups) skip every visit for a client whose care is PAUSED (an open client_pause) or has ENDED (their client role is
// past). Loaded once per run; if it can't be read the run carries on exactly as before (never stops a real alert).
// =============================================================================
// deno-lint-ignore no-explicit-any
type Any = any
let QUIET: Set<string> = new Set()
export async function loadQuiet(db: Any): Promise<Set<string>> {
  try {
    const out = new Set<string>()
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
  } catch { QUIET = new Set() }
  return QUIET
}
/** is this AxisCare visit for a paused or ended client? */
export function isQuiet(v: Any): boolean { const id = v?.client?.id; return id != null && QUIET.has(String(id)) }
export function quietSet(): Set<string> { return QUIET }
