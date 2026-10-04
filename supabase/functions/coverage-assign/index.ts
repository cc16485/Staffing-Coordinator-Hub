// Supabase Edge Function: coverage-assign  (shared hub project)
// -----------------------------------------------------------------------------
// When the office clicks "Confirmed — mark covered" on a coverage case, the
// hub calls this to WRITE THE ASSIGNMENT INTO AXISCARE: the confirmed
// caregiver goes onto the visit, so nobody has to re-key it.
//
// The click IS the authorization — a person decided; this executes it.
// Three rules, all from AXISCARE-CAPABILITY.md:
//   1. `caregiverId` is writable via PATCH /api/visits/{visitId}.
//   2. NEVER trust a bare 200: the visit is read back and the caregiver on it
//      must equal the one we set, or the result is "failed", whatever the
//      status code said.
//   3. If the visit cannot be identified with CERTAINTY — a phone-opened case
//      with no visit id, and the client's day holds zero or several
//      unassigned visits — the answer is "assign by hand in AxisCare",
//      never a guess. A wrong write here puts a caregiver on the wrong shift.
//
// Auth: JWT-verified (deploy WITHOUT --no-verify-jwt). CI1 (2026-10-03): an ACTIVE OFFICE STAFF member (requireStaff,
// OFFICE_ROLES) or the owner's server key. It used to accept any signed-in account on the shared project.
//
// CI1 · THE SAFE FILL (her "yes to all" on the call-ins plan): the Hub no longer saves its own copy of a confirmed case.
//   {action:'confirm', case_id, covered_by, not_chosen?: {silent} | {msg}}  exactly one confirm wins (the case must still
//       be open); only the fill is saved; then AxisCare, only where nobody else is on the visit (_shared/coverage-fill.ts).
//       Already filled: {outcome:'already', covered_by, confirmed_by, ...} and nothing changes.
//   {action:'close', case_id, how:'uncovered'|'other_way'|'client_cancelled', note?}  same one-winner rule.
//   {case_id} (no action)  the old call: put an already-confirmed case's caregiver on AxisCare.
// The result is stamped onto the case (c.axiscare_assignment) so the board
// shows "on the schedule ✓" or "assign by hand: why" — silence is not a state.
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { ownerCaller } from '../_shared/job-auth.ts'
import { confirmFill, closeCase, assignInAxis, readCase, patchCase, CLOSE_HOW } from '../_shared/coverage-fill.ts'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS' } })

  /* CI1: an active office staff member, or the owner's server key */
  let byName = 'the owner\'s server key'
  if (!(await ownerCaller(req))) {
    const who = await requireStaff(sb, req, OFFICE_ROLES)
    if (!who.ok) return json({ error: who.error }, who.status)
    byName = who.name || who.email || 'office staff'
  }

  // deno-lint-ignore no-explicit-any
  const b: any = await req.json().catch(() => ({}))
  const caseId = String(b.case_id || '')
  if (!caseId) return json({ error: 'case_id required' }, 400)
  const action = String(b.action || 'assign')

  if (action === 'confirm') {
    const nc = b.not_chosen && typeof b.not_chosen === 'object'
      ? (b.not_chosen.silent === true ? { silent: true } : (typeof b.not_chosen.msg === 'string' && b.not_chosen.msg.trim() ? { msg: b.not_chosen.msg.trim() } : undefined))
      : undefined
    const out = await confirmFill(sb, { caseId, coveredBy: String(b.covered_by || ''), byName, notChosen: nc })
    await logRun(caseId, 'confirm', out.outcome, out.outcome === 'filled' ? out.axiscare.status + ': ' + out.axiscare.detail : JSON.stringify(out).slice(0, 200))
    return json(out, out.outcome === 'not_found' ? 404 : out.outcome === 'bad_request' ? 400 : 200)
  }
  if (action === 'close') {
    const out = await closeCase(sb, { caseId, how: String(b.how || '') as keyof typeof CLOSE_HOW, note: typeof b.note === 'string' ? b.note : '', byName })
    await logRun(caseId, 'close', out.outcome, '')
    return json(out, out.outcome === 'not_found' ? 404 : out.outcome === 'bad_request' ? 400 : 200)
  }
  if (action !== 'assign') return json({ error: 'unknown action' }, 400)

  /* the old call: an already-confirmed case's caregiver onto AxisCare */
  const c = await readCase(sb, caseId)
  if (!c) return json({ error: 'no such case' }, 404)
  if (!c.covered_by || c.resolved_how !== 'covered') return json({ error: 'the case has no confirmed caregiver yet' }, 400)
  const axis = await assignInAxis(sb, c, byName)
  await patchCase(sb, caseId, { axiscare_assignment: { ...axis, at: new Date().toISOString(), by: 'coverage-assign' } })
  await logRun(caseId, 'assign', axis.status, axis.detail)
  return json(axis)
})

async function logRun(caseId: string, what: string, outcome: string, detail: string) {
  try {
    await sb.rpc('upsert_app_data_item', { target_key: 'automation_log', item: {
      id: 'auto_srv_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      at: new Date().toISOString(), automation: 'coverage-assign:' + what, ran_by: 'server',
      ok: ['filled', 'assigned', 'already', 'closed'].includes(outcome), dry: false, case_id: caseId, outcome, detail: String(detail).slice(0, 300) } })
  } catch { /* logging never blocks */ }
}
