// =============================================================================
// call-place — office staff say who an unmatched call was with (K3, approved 2026-09-28)
// =============================================================================
// The call record never guesses: a call on a number nobody (or more than one person) has stays unmatched. Here a
// signed-in office staff member places it: on an inquiry, on a client, or "not one of ours". Who placed it is their
// sign-in's email, never anything in the request. Writes only through call_record_place() (service_role), which
// checks the inquiry or client exists and that each call line is unmatched and not already placed.
//   { action?: 'place', call_ids: number[], decision: 'lead' | 'client' | 'not_ours', lead_id?, person_id?, axiscare_client_id?, note? }
// Nothing here contacts anyone or writes to AxisCare.
// PHASE 1, SLICE 3 (2026-10-11): served through the door (_shared/contract.ts): who may call it comes from
// action_authority (seeded: office roles, as before); an undeclared field is refused by name; the once-only lock and
// a started row and an outcome row in the record (the call line ids and the decision, never the note). An older open
// page that sends no action still reaches 'place'. The checks below and the database door are unchanged.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serveContract, type Field } from '../_shared/contract.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const T = (type: Field['type']): Field => ({ type })
const idsOf = (v: unknown) => Array.isArray(v) ? v.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0) : []

serveContract('call_place', {
  place: {
    inputs: { call_ids: T('int_list'), decision: T('text'), lead_id: T('text'), person_id: T('text'), axiscare_client_id: T('text'), note: T('text') },
    verb: 'call_placed',
    run: async ({ input: b, actor }) => {
      const ids = idsOf(b.call_ids)
      if (!ids.length || ids.length > 20) return { status: 400, body: { error: 'call_ids must list 1 to 20 call lines' } }
      const decision = String(b.decision || '')
      if (!['lead', 'client', 'not_ours'].includes(decision)) return { status: 400, body: { error: "decision must be 'lead', 'client' or 'not_ours'" } }
      const person = typeof b.person_id === 'string' && UUID.test(b.person_id) ? b.person_id : null
      const { data, error } = await sb.rpc('call_record_place', {
        p_ids: ids, p_decision: decision,
        p_lead: decision === 'lead' ? String(b.lead_id || '').slice(0, 100) : null,
        p_person: decision === 'client' ? person : null,
        p_axiscare_client: decision === 'client' ? String(b.axiscare_client_id || '') : null,
        p_by: actor.email, p_note: typeof b.note === 'string' ? b.note.slice(0, 300) : null,
      })
      if (error) return { status: 500, body: { error: 'Could not place the call: ' + error.message } }
      return { status: data?.outcome === 'placed' ? 200 : 400, body: data }
    },
    item: (b) => b.decision === 'lead' ? 'lead:' + String(b.lead_id || '').slice(0, 100) : b.decision === 'client' ? 'person:' + String(b.person_id || '') : 'calls',
    data: (b) => ({ decision: String(b.decision || ''), lines: idsOf(b.call_ids).length }),
    keep: (a) => ({ lines: a.body?.lines ?? null }),
    evidence: (b) => [...idsOf(b.call_ids).map((id) => ({ kind: 'call_line', id: String(id) })),
      ...(b.decision === 'lead' && b.lead_id ? [{ kind: 'lead', id: String(b.lead_id).slice(0, 100) }] : []),
      ...(b.decision === 'client' && b.axiscare_client_id ? [{ kind: 'axiscare_client', id: String(b.axiscare_client_id) }] : [])],
  },
}, sb, { defaultAction: 'place' })
