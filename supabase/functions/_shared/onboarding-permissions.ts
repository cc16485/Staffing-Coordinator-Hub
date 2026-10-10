// =============================================================================
// onboarding-permissions.ts · who may approve what in the onboarding workflow (Slice 0, Samantha 2026-10-08)
// =============================================================================
// HER RULE: permissions are granted to individual signed-in people, never to everyone with a job title.
//   · Approve to Advance to Orientation: the owners (staff_roles owner_admin) plus the people on the `advance` list.
//   · Approve to Work: ONLY the people on the `work` list (Samantha and Zachary). An owner role alone is not enough.
//   · The `work` list may be changed only by someone already on it; the `advance` list by an owner. Every change is
//     written into the record's own history (who, when, what) and the office event log.
// The record lives in app_data under PERM_KEY and is read and written ONLY by the onboarding-permissions function
// (service role); no page writes it. Pure functions here, no database: the function and the tests call them.
export const PERM_KEY = 'onboarding_permissions'
/* SLICE 2a (Samantha, 2026-10-09, identity security): 'screening' names the individual staff who may reveal a caregiver's
   Social Security number, date of birth or license number for a check order. Members only (an owner is not a member by
   title); only an owner changes the list. Every reveal is logged. */
export const KINDS = ['advance', 'work', 'screening'] as const
export type Kind = typeof KINDS[number]
export type Member = { person_id: string; email: string; name: string; added_by: string; added_at: string }
export type PermEvent = { at: string; by: string; by_email: string; kind: Kind; action: 'add' | 'remove'; person_id: string; email: string; name: string }
export type Perms = { version: number; advance: Member[]; work: Member[]; screening: Member[]; history: PermEvent[] }
export type Caller = { person_id: string; roles: string[]; email?: string; name?: string }

export function emptyPerms(): Perms { return { version: 0, advance: [], work: [], screening: [], history: [] } }
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
function members(x: unknown): Member[] {
  if (!Array.isArray(x)) return []
  const out: Member[] = []
  for (const m of x) {
    if (!m || typeof m !== 'object') continue
    const r = m as Record<string, unknown>
    const pid = str(r.person_id, 80)
    if (!pid || out.some((o) => o.person_id === pid)) continue
    out.push({ person_id: pid, email: str(r.email).toLowerCase(), name: str(r.name), added_by: str(r.added_by), added_at: str(r.added_at, 40) })
  }
  return out
}
/** The stored record as this module understands it; anything malformed becomes empty rather than guessed. */
export function normalizePerms(x: unknown): Perms {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return emptyPerms()
  const r = x as Record<string, unknown>
  const history = Array.isArray(r.history) ? (r.history as PermEvent[]).filter((e) => e && typeof e === 'object').slice(-500) : []
  return { version: Number.isInteger(r.version) ? (r.version as number) : 0, advance: members(r.advance), work: members(r.work), screening: members(r.screening), history }
}
export const isMember = (list: Member[] | undefined, person_id: string) => !!person_id && Array.isArray(list) && list.some((m) => m.person_id === person_id)
export const isOwner = (c: Caller) => Array.isArray(c.roles) && c.roles.includes('owner_admin')

/** May this signed-in person give the approval? Identity (person_id) decides, never a name or a title. */
export function mayApprove(p: Perms, kind: Kind, c: Caller): boolean {
  if (kind === 'work') return isMember(p.work, c.person_id)
  if (kind === 'advance') return isMember(p.advance, c.person_id) || isOwner(c)
  if (kind === 'screening') return isMember(p.screening, c.person_id)
  return false
}
/** May this signed-in person change the list? Approve to Work: only its own members. Approve to Advance: owners. */
export function mayChange(p: Perms, kind: Kind, c: Caller): boolean {
  if (kind === 'work') return isMember(p.work, c.person_id)
  if (kind === 'advance') return isOwner(c)
  if (kind === 'screening') return isOwner(c)
  return false
}
export type Target = { person_id: string; email: string; name: string }
export type ChangeResult = { ok: true; next: Perms; changed: string } | { ok: false; error: string }
/** Apply one add or remove. Never empties the Approve to Work list. Writes the history line. */
export function applyChange(p: Perms, kind: Kind, action: 'add' | 'remove', target: Target, by: Caller, now: string): ChangeResult {
  if (!KINDS.includes(kind)) return { ok: false, error: 'unknown list' }
  if (action !== 'add' && action !== 'remove') return { ok: false, error: 'action must be add or remove' }
  const pid = str(target.person_id, 80)
  if (!pid) return { ok: false, error: 'no person' }
  const next: Perms = { version: p.version + 1, advance: [...p.advance], work: [...p.work], screening: [...(p.screening || [])], history: [...p.history] }
  const list = kind === 'work' ? next.work : kind === 'screening' ? next.screening : next.advance
  const label = kind === 'work' ? 'Approve to Work' : kind === 'screening' ? 'screening staff' : 'Approve to Advance to Orientation'
  if (action === 'add') {
    if (isMember(list, pid)) return { ok: false, error: `${target.name || target.email || 'They'} are already on the ${label} list` }
    list.push({ person_id: pid, email: str(target.email).toLowerCase(), name: str(target.name), added_by: str(by.email || by.person_id), added_at: now })
  } else {
    if (!isMember(list, pid)) return { ok: false, error: `${target.name || target.email || 'They'} are not on the ${label} list` }
    if (kind === 'work' && list.length === 1) return { ok: false, error: 'The Approve to Work list cannot be emptied' }
    const i = list.findIndex((m) => m.person_id === pid); list.splice(i, 1)
  }
  next.history.push({ at: now, by: str(by.person_id, 80), by_email: str(by.email).toLowerCase(), kind, action, person_id: pid, email: str(target.email).toLowerCase(), name: str(target.name) })
  if (next.history.length > 500) next.history = next.history.slice(-500)
  return { ok: true, next, changed: `${action === 'add' ? 'added' : 'removed'} ${target.name || target.email} ${action === 'add' ? 'to' : 'from'} ${label}` }
}
