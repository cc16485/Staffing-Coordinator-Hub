// =============================================================================
// Staff authorization for privileged Hub actions (security slice, 2026-09-27)
// =============================================================================
// Why this exists: campaign-auto, campaign-send and circle-send trusted a URL token that is printed in the public
// Hub page (and on the public booking / Caregivers Corner pages). A public credential may identify a public page;
// it must never authorize reading client audiences or sending as Caring Companions.
//
// THE RULE: nothing in the request decides who the caller is. The caller is the signed-in user in the JWT, checked
// with Supabase Auth, resolved through auth_identities to a person, and that person must be ACTIVE, an active
// member of Caring Companions (cc_ihs), and hold one of the allowed staff_roles for cc_ihs. If their account carries
// a hub_access list, it must include the Care Coordinator Hub. Anything missing or unreadable is refused.
//
// Scheduled jobs never use this: they carry a server-only secret (serverSecretOk), held in Supabase Vault for the
// cron and as a function secret here, and never in browser code.
// =============================================================================
export const PROJECT_REF = 'zngsgedlsxinbygwmxwn'
export const ENTITY = 'cc_ihs'
/* Samantha, 2026-09-27: "I want care coordinators and staffing coordinators to have access - its a small office and
   we all help each other." Every office role may use the campaign lookup, manual campaign send and Family Circle
   send. A person with NO role, an unknown role, an inactive record or a finished membership is still refused. */
export const OFFICE_ROLES = ['owner_admin', 'care_coordinator', 'staffing_coordinator']

export type StaffOk = { ok: true; person_id: string; name: string; email: string; roles: string[] }
export type StaffNo = { ok: false; status: 401 | 403 | 500; error: string }

const bearer = (req: Request) => {
  const a = req.headers.get('Authorization') || ''
  return /^Bearer\s+/i.test(a) ? a.replace(/^Bearer\s+/i, '').trim() : ''
}

/** Is the caller a signed-in Caring Companions staff member holding one of `allowed`? */
export async function requireStaff(
  // deno-lint-ignore no-explicit-any
  admin: any, req: Request, allowed: string[],
): Promise<StaffOk | StaffNo> {
  const jwt = bearer(req)
  if (!jwt) return { ok: false, status: 401, error: 'Sign in first.' }
  let user
  try {
    const { data, error } = await admin.auth.getUser(jwt)
    if (error || !data?.user) return { ok: false, status: 401, error: 'Your session has expired. Sign in again.' }
    user = data.user
  } catch { return { ok: false, status: 401, error: 'Your session could not be checked. Sign in again.' } }

  const hubs = user.app_metadata?.hub_access
  if (Array.isArray(hubs) && !hubs.includes('care_coordinator'))
    return { ok: false, status: 403, error: 'Your account does not have Care Coordinator Hub access.' }

  try {
    const { data: ids, error: e1 } = await admin.from('auth_identities').select('person_id')
      .eq('auth_user_id', user.id).eq('project_ref', PROJECT_REF)
    if (e1) return { ok: false, status: 500, error: 'Could not check your permissions.' }
    if (!ids?.length) return { ok: false, status: 403, error: 'Your sign-in is not linked to a staff record.' }
    const pid = String(ids[0].person_id)
    const [{ data: p, error: e2 }, { data: m, error: e3 }, { data: r, error: e4 }] = await Promise.all([
      admin.from('persons').select('full_name, active').eq('person_id', pid).maybeSingle(),
      admin.from('entity_memberships').select('active, ended_at').eq('person_id', pid).eq('entity', ENTITY).maybeSingle(),
      admin.from('staff_roles').select('role').eq('person_id', pid).eq('entity', ENTITY),
    ])
    if (e2 || e3 || e4) return { ok: false, status: 500, error: 'Could not check your permissions.' }
    if (!p || p.active !== true) return { ok: false, status: 403, error: 'Your staff record is not active.' }
    if (!m || m.active !== true || m.ended_at) return { ok: false, status: 403, error: 'You are not an active member of Caring Companions.' }
    const roles = (r ?? []).map((x: { role: string }) => x.role)
    if (!roles.some((x: string) => allowed.includes(x)))
      return { ok: false, status: 403, error: 'Your role does not allow this.' }
    return { ok: true, person_id: pid, name: String(p.full_name || ''), email: String(user.email || '').toLowerCase(), roles }
  } catch { return { ok: false, status: 500, error: 'Could not check your permissions.' } }
}

/** A scheduled job's server-only secret, compared in constant time. Missing or short secret: always false. */
export function serverSecretOk(req: Request, envName: string, header = 'x-cron-secret'): boolean {
  const want = Deno.env.get(envName) || ''
  const got = req.headers.get(header) || ''
  if (want.length < 32 || got.length !== want.length) return false
  let d = 0
  for (let i = 0; i < want.length; i++) d |= want.charCodeAt(i) ^ got.charCodeAt(i)
  return d === 0
}
