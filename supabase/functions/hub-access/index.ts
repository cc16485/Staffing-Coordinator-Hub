// Supabase Edge Function: hub-access (hub project zngsgedlsxinbygwmxwn)
// -----------------------------------------------------------------------------
// Lets an owner invite somebody to the Hub, or take that access away, without
// anybody opening the Supabase dashboard — and without the browser ever holding
// a service-role key.
//
// THE AUTHORITY RULE, WHICH IS THE WHOLE POINT:
// Nothing in the request body decides what the caller may do. Not a flag, not
// an email, not a role name. The caller is identified from their JWT, resolved
// through auth_identities to a person, and that person must hold 'owner_admin'
// in staff_roles. A request that says {"is_owner": true} is treated exactly
// like one that does not.
//
// WHAT IT WILL NOT DO, deliberately:
//   · accept app_metadata from the caller. Only hub_access is ever written,
//     and only ever to the fixed slug list below
//   · grant or change owner_admin. Structural authority is not access, and it
//     moves in the ownership build, not here
//   · set anybody's password. People are invited and choose their own
//   · remove the last owner who can still sign in
//
// POST { action, target_email }
//   action: invite | resend | revoke | restore | status
// -----------------------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// The only metadata key this function may touch, and the only values allowed in it.
const META_KEY = 'hub_access'
const KNOWN_HUBS: Record<string, string> = {
  care_coordinator: 'Care Coordinator Hub',
  staffing:         'Staffing Hub',
  team_hub:         'Team Hub',
  /* 'team' is kept ONLY so accessOf() does not silently strip it from an
     existing claim. app_data_key_hub_map and every real account use
     'team_hub'; that is the value the RLS policy checks and the value an
     invite must write. Anything invited as 'team' would be denied every Team
     Hub key. */
  team:             'Team Hub (legacy slug — do not issue)',
}
const CANONICAL_HUB: Record<string, string> = { team: 'team_hub' }
/* The only values that may ever be WRITTEN into hub_access. KNOWN_HUBS is
   wider because it also has to accept 'team' as an incoming request. Never
   materialise a claim from Object.keys(KNOWN_HUBS) — that would write the
   legacy slug, and the RLS policy does not recognise it. */
const ISSUABLE_HUBS = ['care_coordinator', 'staffing', 'team_hub']
const ACTIONS = ['invite', 'resend', 'revoke', 'restore', 'status']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const admin = createClient(url, service, { auth: { persistSession: false } })

  // ── 1. Who is asking? From the token, never from the body. ────────────────
  const authz = req.headers.get('Authorization') || ''
  const jwt = authz.startsWith('Bearer ') ? authz.slice(7) : ''
  if (!jwt) return json({ error: 'Sign in first.' }, 401)

  const asCaller = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  })
  const { data: me, error: meErr } = await asCaller.auth.getUser()
  if (meErr || !me?.user) return json({ error: 'Your session has expired. Sign in again.' }, 401)
  const callerId = me.user.id
  const callerEmail = (me.user.email || '').toLowerCase()

  // ── 2. May they? Read it from the database. ───────────────────────────────
  // Two plain lookups, no embedded resource. The embed I first wrote —
  // 'person_id, staff_roles:person_id(role)' — made PostgREST resolve
  // person_id as a relationship to persons and then look for a 'role' column
  // there, which failed with "column persons_1.role does not exist". It was
  // redundant with the direct query below in the first place.
  const { data: authority, error: authErr } = await admin
    .from('auth_identities')
    .select('person_id')
    .eq('auth_user_id', callerId)
  if (authErr) return json({ error: 'Could not check your permissions.', detail: authErr.message }, 500)

  let isOwner = false
  let callerPerson: string | null = null
  if (authority && authority.length) {
    callerPerson = (authority[0] as Record<string, unknown>).person_id as string
    const { data: roles } = await admin
      .from('staff_roles').select('role').eq('person_id', callerPerson)
    isOwner = !!roles?.some((r: { role: string }) => r.role === 'owner_admin')
  }
  if (!isOwner) {
    return json({
      error: 'Only an owner can change Hub access.',
      detail: callerPerson
        ? 'Your account is linked to a person record, but that person does not hold owner_admin.'
        : 'Your sign-in is not linked to a person record yet. Run the identity migration.',
    }, 403)
  }

  // ── 3. What are they asking for? ──────────────────────────────────────────
  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* empty body is fine for status */ }
  const action = String(body.action || 'status')
  const target = String(body.target_email || '').trim().toLowerCase()
  let hub = String(body.hub || 'care_coordinator')

  if (!ACTIONS.includes(action)) return json({ error: `Unknown action "${action}".` }, 400)
  if (!KNOWN_HUBS[hub]) return json({ error: `Unknown hub "${hub}".` }, 400)
  // Normalise before anything is written, so a legacy slug can be asked for
  // but never stored.
  hub = CANONICAL_HUB[hub] || hub
  if (!target || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(target))
    return json({ error: 'A work email address is required.' }, 400)

  // Find the target account, if it exists. listUsers is paged; ask for the page
  // that could contain them rather than assuming page one.
  const findUser = async () => {
    for (let page = 1; page <= 20; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
      if (error) throw new Error(error.message)
      const hit = data.users.find((u) => (u.email || '').toLowerCase() === target)
      if (hit) return hit
      if (data.users.length < 200) return null
    }
    return null
  }

  let user
  try { user = await findUser() } catch (e) {
    return json({ error: 'Could not read the account list.', detail: String(e) }, 500)
  }

  const accessOf = (u: typeof user) => {
    const a = u?.app_metadata?.[META_KEY]
    if (!Array.isArray(a)) return null                      // null = predates the list, means all
    // Upgrade a legacy 'team' claim to 'team_hub' rather than merely keeping it.
    // Keeping it would stop the strip but leave the account denied every Team
    // Hub key, because the RLS policy only ever checks 'team_hub'.
    return Array.from(new Set((a as string[])
      .map((x) => CANONICAL_HUB[x] || x)
      .filter((x) => ISSUABLE_HUBS.includes(x))))
  }
  const describe = (u: typeof user) => {
    if (!u) return { state: 'none', label: 'No account' }
    const access = accessOf(u)
    const hasIt = access === null || access.includes(hub)   // null = predates the list, means all
    if (!u.email_confirmed_at && !u.last_sign_in_at)
      return { state: 'invited', label: 'Invitation sent, not accepted yet', access }
    return { state: hasIt ? 'active' : 'revoked',
             label: hasIt ? 'Can sign in' : 'Account exists, no access to this hub', access }
  }

  if (action === 'status') return json({ ok: true, target, ...describe(user) })

  // ── 4. The safeguard that matters most ────────────────────────────────────
  // Never remove the last owner who can still get in. Checked against the
  // database, and it counts only owners whose account can actually sign in.
  if ((action === 'revoke') && user) {
    const { data: ids } = await admin.from('auth_identities').select('person_id, auth_user_id')
    const { data: owners } = await admin.from('staff_roles')
      .select('person_id').eq('role', 'owner_admin')
    const ownerAuthIds = new Set(
      (ids || []).filter((i) => (owners || []).some((o) => o.person_id === i.person_id))
                 .map((i) => i.auth_user_id))
    if (ownerAuthIds.has(user.id)) {
      let stillIn = 0
      for (let page = 1; page <= 20; page++) {
        const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 })
        if (!data) break
        for (const u of data.users) {
          if (u.id === user.id) continue
          if (!ownerAuthIds.has(u.id)) continue
          const a = u.app_metadata?.[META_KEY]
          const ok = !Array.isArray(a) || (a as string[]).includes(hub)
          if (ok && (u.email_confirmed_at || u.last_sign_in_at)) stillIn++
        }
        if (data.users.length < 200) break
      }
      if (stillIn === 0)
        return json({ error: 'That would leave nobody who can sign in and put it back.',
                      detail: 'Give another owner access first.' }, 409)
    }
  }

  // ── 5. Do exactly one thing ───────────────────────────────────────────────
  let result: Record<string, unknown> = {}
  try {
    if (action === 'invite' || action === 'resend') {
      if (user && (user.email_confirmed_at || user.last_sign_in_at) && action === 'invite') {
        // Already a real account — this is a restore, not an invitation.
        const next = Array.from(new Set([...(accessOf(user) || []), hub]))
        const { error } = await admin.auth.admin.updateUserById(user.id,
          { app_metadata: { [META_KEY]: next } })
        if (error) throw new Error(error.message)
        result = { did: 'restored', note: 'They already had an account, so access was restored rather than a new invitation sent.' }
      } else {
        const { data, error } = await admin.auth.admin.inviteUserByEmail(target,
          { data: {}, redirectTo: `https://cc.mo-care.com/` })
        if (error) throw new Error(error.message)
        // Set access separately: never from anything the caller supplied.
        if (data?.user) {
          const next = Array.from(new Set([...(accessOf(data.user) || []), hub]))
          await admin.auth.admin.updateUserById(data.user.id,
            { app_metadata: { [META_KEY]: next } })
        }
        result = { did: action === 'resend' ? 'resent' : 'invited' }
      }
    } else if (action === 'revoke') {
      if (!user) return json({ error: 'There is no account for that address.' }, 404)
      const current = accessOf(user) ?? [...ISSUABLE_HUBS]   // null meant everything
      const next = current.filter((h) => h !== hub)
      const { error } = await admin.auth.admin.updateUserById(user.id,
        { app_metadata: { [META_KEY]: next } })
      if (error) throw new Error(error.message)
      result = { did: 'revoked', remaining: next }
    } else if (action === 'restore') {
      if (!user) return json({ error: 'There is no account for that address. Invite them instead.' }, 404)
      const next = Array.from(new Set([...(accessOf(user) || []), hub]))
      const { error } = await admin.auth.admin.updateUserById(user.id,
        { app_metadata: { [META_KEY]: next } })
      if (error) throw new Error(error.message)
      result = { did: 'restored', access: next }
    }
  } catch (e) {
    return json({ error: 'The change did not go through.', detail: String(e) }, 500)
  }

  // ── 6. Say who did it. An unattributed access change is not acceptable. ───
  const entry = {
    id: `aa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    by: callerEmail,
    by_person: callerPerson,
    action, target, hub,
    result: result.did || action,
  }
  try {
    await admin.rpc('upsert_app_data_item', { target_key: 'admin_audit', item: entry })
  } catch { /* the change succeeded; losing the audit line must not fail it */ }

  const after = await findUser().catch(() => null)
  return json({ ok: true, target, hub, hub_label: KNOWN_HUBS[hub], ...result, ...describe(after),
                audit: entry })
})
