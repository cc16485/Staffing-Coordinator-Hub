// Test stand-in for _shared/staff-auth.ts in the older functional harnesses (J2, 2026-09-29): a test token with role
// authenticated and an email counts as office staff with that email. The real check (Supabase Auth, staff record,
// role, hub access) is tested in j1_job_locks_test.mjs / j2_job_locks_test.mjs.
export const OFFICE_ROLES = ['owner_admin', 'care_coordinator', 'staffing_coordinator']
export async function requireStaff(_admin, req) { try { const t = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const c = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString())
  if (c.role === 'authenticated' && c.email) return { ok: true, person_id: 'p', name: '', email: String(c.email).trim().toLowerCase(), roles: ['care_coordinator'] }
} catch { /* */ } return { ok: false, status: 401, error: 'Sign in first.' } }
