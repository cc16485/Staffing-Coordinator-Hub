// =============================================================================
// onboarding-permissions · who may approve in the onboarding workflow (Slice 0, Samantha approved 2026-10-08)
// =============================================================================
// Office staff only (their own Hub sign-in; nothing in the request body decides who they are).
//   { action: 'get' }                                   -> the two lists, what the caller may do, and (for owners and
//                                                          list members) the change history
//   { action: 'add' | 'remove', kind: 'advance' | 'work', person_id }
//       advance list: an owner (staff_roles owner_admin) may change it
//       work list:    only someone already on it may change it (Samantha and Zachary); it can never be emptied
// The record is app_data[onboarding_permissions], written here and nowhere else (service role, compare-and-save through
// app_data_save so two owners cannot overwrite each other), and every change lands in the record's history and in
// op_events. Nobody is texted or emailed; nothing in AxisCare, Viventium or GoHighLevel is touched. Until the later
// slices are approved, no Hub action reads these lists: this is the settings store only.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { PERM_KEY, KINDS, type Kind, normalizePerms, mayApprove, mayChange, applyChange, isMember, isOwner } from '../_shared/onboarding-permissions.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// deno-lint-ignore no-explicit-any
async function readPerms(db: any) {
  const { data, error } = await db.from('app_data').select('data, version').eq('key', PERM_KEY).maybeSingle()
  if (error) throw new Error('could not read the permissions: ' + error.message)
  return { perms: normalizePerms(data?.data), version: data ? Number(data.version) || 0 : 0, exists: !!data }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const who = await requireStaff(db, req, OFFICE_ROLES)
  if (!who.ok) return json({ error: who.error }, who.status)
  const me = { person_id: who.person_id, roles: who.roles, email: who.email, name: who.name }
  // deno-lint-ignore no-explicit-any
  const b: Record<string, any> = await req.json().catch(() => ({}))
  const action = String(b.action || 'get')

  const answer = (perms: ReturnType<typeof normalizePerms>) => {
    const insider = isOwner(me) || isMember(perms.work, me.person_id) || isMember(perms.advance, me.person_id)
    return {
      ok: true, version: perms.version,
      advance: perms.advance, work: perms.work,
      history: insider ? perms.history.slice(-100) : [],
      me: { person_id: me.person_id, email: me.email, name: me.name,
        may_approve_advance: mayApprove(perms, 'advance', me), may_approve_work: mayApprove(perms, 'work', me),
        may_change_advance: mayChange(perms, 'advance', me), may_change_work: mayChange(perms, 'work', me) },
    }
  }

  let cur
  try { cur = await readPerms(db) } catch (e) { return json({ error: (e as Error).message }, 500) }
  if (action === 'get') return json(answer(cur.perms))
  if (action !== 'add' && action !== 'remove') return json({ error: "action must be 'get', 'add' or 'remove'" }, 400)
  const kind = String(b.kind || '') as Kind
  if (!KINDS.includes(kind)) return json({ error: "kind must be 'advance' or 'work'" }, 400)
  const pid = String(b.person_id || '').trim()
  if (!pid) return json({ error: 'person_id is required' }, 400)
  if (!mayChange(cur.perms, kind, me)) {
    return json({ error: kind === 'work'
      ? 'Only someone already on the Approve to Work list can change it.'
      : 'Only an owner can change the Approve to Advance list.' }, 403)
  }
  const { data: p, error: pe } = await db.from('persons').select('person_id, full_name, primary_email, active').eq('person_id', pid).maybeSingle()
  if (pe) return json({ error: 'could not read that person: ' + pe.message }, 500)
  if (!p) return json({ error: 'That person is not in the staff list.' }, 404)
  if (action === 'add' && p.active !== true) return json({ error: `${p.full_name || 'That person'} is not an active staff member.` }, 400)
  const target = { person_id: String(p.person_id), email: String(p.primary_email || '').toLowerCase(), name: String(p.full_name || '') }

  // compare-and-save: read, apply, save only if nobody saved in between (three tries)
  for (let attempt = 0; attempt < 3; attempt++) {
    const now = new Date().toISOString()
    const r = applyChange(cur.perms, kind, action, target, me, now)
    if (!r.ok) return json({ error: r.error }, 400)
    const { data: saved, error: se } = await db.rpc('app_data_save', { p_key: PERM_KEY, p_data: r.next, p_expected_version: cur.exists ? cur.version : 0 })
    if (se) return json({ error: 'could not save: ' + se.message }, 500)
    if (saved && saved.ok) {
      try {
        await db.from('op_events').insert({ actor_email: me.email, actor_name: me.name || me.email.split('@')[0], verb: 'onboarding_permission_changed',
          item_id: PERM_KEY, area: 'admin', summary: `${me.name || me.email} ${r.changed}`, data: { kind, action, person_id: target.person_id, email: target.email, name: target.name } })
      } catch { /* the record's own history already has it */ }
      return json({ ...answer(r.next), changed: r.changed })
    }
    try { cur = await readPerms(db) } catch (e) { return json({ error: (e as Error).message }, 500) }
  }
  return json({ error: 'Someone else changed the lists at the same moment. Try again.' }, 409)
})
