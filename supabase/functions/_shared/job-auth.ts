// Who may start a scheduled job (S3, 2026-09-28). The five job functions (the two backups, the reference follow-up,
// the reference check-in and the SSN purge) used to answer anyone, and three of them handed names to a practice run.
// Now a job answers only:
//   'cron'  · its own schedule, which sends a secret kept in the database's vault (x-cron-secret), compared in
//             constant time; or
//   'owner' · the owner's Desktop scripts, holding the project's private server key (the same check lead-reconcile
//             uses: an exact match, or the database itself confirming the key by letting it read a table only the
//             server role can see; a public or forged key fails).
// Anything unclear fails closed.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serverSecretOk } from './staff-auth.ts'

const URL_ = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

function same(a: string, b: string): boolean {
  if (!a || !b || a.length < 20 || a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

export async function ownerCaller(req: Request): Promise<boolean> {
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim()
  if (same(bearer, SERVICE)) return true
  if (!bearer || bearer.length < 20 || !URL_) return false
  try {
    const probe = createClient(URL_, bearer, { auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: 'Bearer ' + bearer, apikey: bearer } } })
    const { error } = await probe.from('identity_door_audit').select('id', { head: true, count: 'exact' }).limit(1)
    return !error
  } catch { return false }
}

/** 'cron' when the schedule's vault secret matches, 'owner' for the server key, otherwise null. */
export async function jobCaller(req: Request, cron = true): Promise<'cron' | 'owner' | null> {
  if (cron && serverSecretOk(req, 'HUB_JOB_SECRET')) return 'cron'
  if (await ownerCaller(req)) return 'owner'
  return null
}
