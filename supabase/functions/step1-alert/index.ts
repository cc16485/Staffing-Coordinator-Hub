// STEP 1 ALERT, the every-10-minutes job (Samantha 2026-10-26; _shared/step1-alert.ts has the rules).
// The moment Step 1 completes, step1-sign emails and texts the admins itself. This job sends what that moment could not:
// the 7am text for someone who finished between 8pm and 7am, and anything the moment missed. One text and one email per
// admin per person, ever. Answers only its own schedule (x-cron-secret) or the owner's Desktop scripts (jobCaller).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jobCaller } from '../_shared/job-auth.ts'
import { step1AlertSweep } from '../_shared/step1-alert.ts'

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })

// deno-lint-ignore no-explicit-any
async function beat(db: any, ok: boolean, note: string) {
  try {
    await db.rpc('upsert_app_data_item', { target_key: 'automation_heartbeats',
      item: { id: 'hb_step1-alert', automation: 'step1-alert', at: new Date().toISOString(), ok, note: String(note).slice(0, 300) } })
  } catch { /* never block on the heartbeat */ }
}

Deno.serve(async (req) => {
  const caller = await jobCaller(req)
  if (!caller) return json({ error: 'not allowed' }, 401)
  if (new URL(req.url).searchParams.get('auth_check') === '1') return json({ ok: true, caller })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  try {
    const out = await step1AlertSweep(db)
    await beat(db, !out.error, out.live ? `${out.owed ?? 0} owed` + (out.error ? ': ' + out.error : '') : 'switch off')
    return json(out, out.error ? 500 : 200)
  } catch (e) {
    await beat(db, false, String((e as Error)?.message ?? e))
    return json({ error: String((e as Error)?.message ?? e).slice(0, 200) }, 500)
  }
})
