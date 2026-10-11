// =============================================================================
// client-fact — active office staff record a fact about a person (Gate 2a), read "has care begun" (Gate 3), and record people on the Journey (Gate 4a)
// =============================================================================
// The ONLY way into the fact record. The browser cannot write facts; this is the
// gated path:
//   * The platform gateway verifies the caller's token (verify_jwt on).
//   * requireStaff: an active Caring Companions staff member with an office role
//     (owner, care coordinator, staffing coordinator) and Care Coordinator Hub access.
//   * Writes only through client_fact_record(), which checks the kind, layer, value,
//     how sure, who said it, which fact it replaces (a stale save is refused), and
//     "after care began, the intake record can only be corrected". Its answer is
//     returned unchanged. The staff member's email is recorded; it is never taken
//     from the request body.
//   * Nothing here contacts anyone.
//   * PHASE 1, SLICE 3 (2026-10-11): served through the door (_shared/contract.ts). Who may call each action comes
//     from action_authority (seeded: office roles, as before); an undeclared field is refused by name; record and
//     record_person take the once-only lock and leave a started row and an outcome row in the record (ids and
//     outcome words only, never the fact's value); care_began is a read and records nothing. The checks below and
//     the database doors are unchanged.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serveContract, type Field } from '../_shared/contract.ts'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function textOrNull(v: unknown, max = 2000): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
}
export function uuidOrNull(v: unknown): string | null | undefined {
  if (v === null || v === undefined || v === '') return null
  return typeof v === 'string' && UUID.test(v) ? v : undefined          // undefined = invalid
}
export function instantOrNull(v: unknown): string | null | undefined {
  if (v === null || v === undefined || v === '') return null
  return typeof v === 'string' && !isNaN(Date.parse(v)) ? new Date(v).toISOString() : undefined
}

/** The request body as the door's arguments; the recorder always comes from the sign-in. */
export function doorArgs(b: Record<string, unknown>, staffEmail: string): { args?: Record<string, unknown>; error?: string } {
  const ep = uuidOrNull(b.episode_id), sup = uuidOrNull(b.supersedes_fact_id), at = instantOrNull(b.said_at)
  if (!ep) return { error: 'episode_id is required' }
  if (sup === undefined) return { error: 'supersedes_fact_id must be a fact id' }
  if (at === undefined) return { error: 'said_at must be a date and time' }
  const value = b.value === undefined ? null : b.value
  return { args: {
    p_episode_id: ep, p_kind: textOrNull(b.kind, 80), p_layer: textOrNull(b.layer, 20), p_value: value,
    p_certainty: textOrNull(b.certainty, 20), p_change_kind: textOrNull(b.change_kind, 20), p_supersedes_fact_id: sup,
    p_reason: textOrNull(b.reason), p_said_by: textOrNull(b.said_by, 200), p_said_by_relationship: textOrNull(b.said_by_relationship, 100),
    p_said_how: textOrNull(b.said_how, 40), p_said_at: at, p_words: textOrNull(b.words), p_source_ref: textOrNull(b.source_ref, 200),
    p_recorded_by: staffEmail,
  } }
}

const T = (type: Field['type']): Field => ({ type })
const FACT_INPUTS: Record<string, Field> = {
  episode_id: T('uuid'), kind: T('text'), layer: T('text'), value: T('any'), certainty: T('text'), change_kind: T('text'),
  supersedes_fact_id: T('uuid'), reason: T('text'), said_by: T('text'), said_by_relationship: T('text'), said_how: T('text'),
  said_at: T('instant'), words: T('text'), source_ref: T('text'),
}
const PERSON_INPUTS: Record<string, Field> = {
  episode_id: T('uuid'), person_key: T('uuid'), supersedes_row_id: T('uuid'), is_caller: T('bool'), name: T('text'), relationship: T('text'),
  organization: T('text'), roles: T('text_list'), phone: T('text'), email: T('text'), reach_way: T('text'), reach_time: T('text'),
  permission: T('text'), permission_asked_by: T('text'), permission_asked_at: T('instant'), change_kind: T('text'), reason: T('text'),
}

serveContract('client_fact', {
  /* Gate 3: the one "has care begun" rule, read-only, for the Hub (so the Hub and the door never disagree) */
  care_began: {
    inputs: { episode_id: T('uuid') },
    run: async ({ input }) => {
      const ep = uuidOrNull(input.episode_id)
      if (!ep) return { status: 400, body: { error: 'episode_id is required' } }
      const { data, error } = await sb.rpc('care_began_for_episode', { p_episode_id: ep })
      if (error) return { body: { began: null, reason: 'could_not_check' } }
      return { body: data }
    },
  },
  /* Gate 2a: a fact, through client_fact_record() */
  record: {
    inputs: FACT_INPUTS,
    verb: 'fact_recorded',
    run: async ({ input, actor }) => {
      const { args, error: bad } = doorArgs(input, actor.email)
      if (bad || !args) return { status: 400, body: { error: bad } }
      const { data, error } = await sb.rpc('client_fact_record', args)
      if (error) return { status: 500, body: { error: 'not recorded: ' + error.message } }
      return { body: data }
    },
    item: (i) => String(i.episode_id || ''),
    data: (i) => ({ kind: textOrNull(i.kind, 80), layer: textOrNull(i.layer, 20), change_kind: textOrNull(i.change_kind, 20) }),
    keep: (a) => ({ fact_id: a.body?.fact_id ?? null }),
    evidence: (i, a) => [{ kind: 'episode', id: String(i.episode_id) }, ...(a.body?.fact_id ? [{ kind: 'fact', id: String(a.body.fact_id) }] : [])],
  },
  /* Gate 4a: a person on the Journey (roles, how to reach them, permission to discuss care) */
  record_person: {
    inputs: PERSON_INPUTS,
    verb: 'person_recorded',
    run: async ({ input: b, actor }) => {
      const ep = uuidOrNull(b.episode_id), key = uuidOrNull(b.person_key), sup = uuidOrNull(b.supersedes_row_id), asked = instantOrNull(b.permission_asked_at)
      if (!ep) return { status: 400, body: { error: 'episode_id is required' } }
      if (key === undefined || sup === undefined) return { status: 400, body: { error: 'person_key and supersedes_row_id must be ids' } }
      if (asked === undefined) return { status: 400, body: { error: 'permission_asked_at must be a date and time' } }
      const roles = Array.isArray(b.roles) ? b.roles.filter((x: unknown) => typeof x === 'string').slice(0, 10) : []
      const { data, error } = await sb.rpc('people_on_journey_record', {
        p_episode_id: ep, p_person_key: key, p_is_caller: b.is_caller === true, p_name: textOrNull(b.name, 200),
        p_relationship: textOrNull(b.relationship, 100), p_organization: textOrNull(b.organization, 200), p_roles: roles,
        p_phone: textOrNull(b.phone, 40), p_email: textOrNull(b.email, 200), p_reach_way: textOrNull(b.reach_way, 10),
        p_reach_time: textOrNull(b.reach_time, 200), p_permission: textOrNull(b.permission, 20),
        p_permission_asked_by: textOrNull(b.permission_asked_by, 200), p_permission_asked_at: asked,
        p_change_kind: textOrNull(b.change_kind, 20), p_supersedes_row_id: sup, p_reason: textOrNull(b.reason),
        p_recorded_by: actor.email,
      })
      if (error) return { status: 500, body: { error: 'not recorded: ' + error.message } }
      return { body: data }
    },
    item: (i) => String(i.episode_id || ''),
    data: (i) => ({ change_kind: textOrNull(i.change_kind, 20), is_caller: i.is_caller === true }),
    keep: (a) => ({ person_key: a.body?.person_key ?? null, row_id: a.body?.row_id ?? null }),
    evidence: (i, a) => [{ kind: 'episode', id: String(i.episode_id) }, ...(a.body?.row_id ? [{ kind: 'journey_person', id: String(a.body.row_id) }] : [])],
  },
}, sb)
