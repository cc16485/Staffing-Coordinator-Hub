// Test stand-in for _shared/job-auth.ts in the older functional harnesses (J2, 2026-09-29). Those harnesses send
// unsigned test tokens and check what a job DOES once it is let in; the real lock (vault secret, owner key, forged
// tokens refused) is tested in j1_job_locks_test.mjs / j2_job_locks_test.mjs. Here: a test token with role
// service_role counts as the owner, role anon (or no token) as the schedule, anything else is refused.
const roleOf = (req) => { try { const t = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  if (!t) return 'anon'; return String(JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).role || '') } catch { return '' } }
export const jobCaller = async (req) => { const r = roleOf(req); return r === 'service_role' ? 'owner' : r === 'anon' ? 'cron' : null }
export const ownerCaller = async (req) => roleOf(req) === 'service_role'
