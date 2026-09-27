// =============================================================================
// callin-plan — what Cara does with a client's "When a caregiver calls in" plan (2026-09-27)
// =============================================================================
// The plan lives in client_callin_current (append-only history behind it), tied to the
// AxisCare client id. Cara follows ONLY the fixed choices; the free-text note is for people.
//
//   only_ask       only these caregivers are offered or texted; everyone else is shown as
//                  "not on <client>'s call-in list"
//   must_cover     the admin text goes out at any hour, marked MUST BE COVERED
//   family_covers  a person calls the family first: Cara starts no automatic texts
//   flexible       a person offers another time or day first: Cara starts no automatic texts
//   backup         shown to staff; Cara never contacts them
// =============================================================================

export type CallinPlan = {
  axiscare_client_id: string; client_name: string; coverage_need: string | null
  only_ask: { axiscare_id: string; name: string }[]
  backup_name: string | null; backup_phone: string | null; backup_relationship: string | null
  note: string | null; source_who: string; source_how: string | null
  entered_by: string; entered_by_name: string | null; entered_at: string
}

export const NEED_LABEL: Record<string, string> = {
  must_cover: 'Must be covered, no matter what',
  if_we_can: 'Cover it if we can',
  family_covers: 'Family would rather cover it themselves (call them first)',
  flexible: 'Flexible: the visit can move to another time or day',
}

// deno-lint-ignore no-explicit-any
export const onlyAskIds = (p: any): Set<string> =>
  new Set((Array.isArray(p?.only_ask) ? p.only_ask : []).map((x: { axiscare_id?: unknown }) => String(x?.axiscare_id ?? '')).filter(Boolean))

/* Why a caregiver is left out by the plan, or null when the plan allows them. */
// deno-lint-ignore no-explicit-any
export function onlyAskCut(p: any, x: { axiscare_id?: unknown }, clientName: string): string | null {
  const ids = onlyAskIds(p)
  if (!ids.size) return null
  if (ids.has(String(x?.axiscare_id ?? ''))) return null
  const first = String(clientName || '').trim().split(/\s+/)[0] || 'the client'
  const names = (p.only_ask as { name: string }[]).map((o) => String(o.name).split(/\s+/)[0]).join(' or ')
  return `not on ${first}'s call-in list (only ${names})`
}

// deno-lint-ignore no-explicit-any
export const holdsAutoTexts = (p: any) => p?.coverage_need === 'family_covers' || p?.coverage_need === 'flexible'
// deno-lint-ignore no-explicit-any
export const isMustCover = (p: any) => p?.coverage_need === 'must_cover'

const phone = (d: string | null) => d && /^\d{10}$/.test(d) ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : ''

/* One line for texts, emails and the picker. The note is left out on purpose: it is read on the case. */
// deno-lint-ignore no-explicit-any
export function planLine(p: any): string {
  if (!p) return ''
  const parts: string[] = []
  if (p.coverage_need && NEED_LABEL[p.coverage_need]) parts.push(NEED_LABEL[p.coverage_need])
  const ids = onlyAskIds(p)
  if (ids.size) parts.push('only ask ' + (p.only_ask as { name: string }[]).map((o) => o.name).join(' or '))
  if (p.backup_name) parts.push('backup: ' + p.backup_name + (p.backup_relationship ? ` (${p.backup_relationship})` : '') + (p.backup_phone ? ' ' + phone(p.backup_phone) : ''))
  return parts.join(' · ')
}

/* { plan: null, error: false } = no plan recorded (today's behavior).
   { error: true } = the plan couldn't be read: the caller holds automatic texts and says so. */
export type PlanRead = { plan: CallinPlan | null; error: boolean }
// deno-lint-ignore no-explicit-any
export async function readPlan(sb: any, axId: string | null | undefined, cache: Map<string, PlanRead>): Promise<PlanRead> {
  const id = String(axId ?? '').trim()
  if (!/^\d+$/.test(id)) return { plan: null, error: false }
  const hit = cache.get(id); if (hit) return hit
  let out: PlanRead
  try {
    const { data, error } = await sb.from('client_callin_current').select('*').eq('axiscare_client_id', id).maybeSingle()
    out = error ? { plan: null, error: true } : { plan: (data as CallinPlan) ?? null, error: false }
  } catch { out = { plan: null, error: true } }
  cache.set(id, out)
  return out
}
