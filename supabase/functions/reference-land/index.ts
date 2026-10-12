// =============================================================================
// reference-land · REFERENCE ANSWERS LAND BY THEMSELVES (Samantha 2026-10-12, step 3)
// =============================================================================
// The server half of the Hub's "Sync reference answers" button, answer landing only (see _shared/reference-land.ts).
// Callers: its own schedule every 15 minutes (the vault secret) or the owner's Desktop step (the server key).
//   POST { mode: 'report' }  READ ONLY: what would land, what is skipped and why. Writes nothing, switch or not.
//   POST { mode: 'apply' }   lands answers, ONLY while ops_settings.ref_land_live is true (the Owners Hub Admin switch
//                            "Reference answers land by themselves"); otherwise { ok: true, off: true } and nothing changes.
//   GET  ?rules_check=1      which rules file it would run and whether it is approved (nothing is run)
// The rules come from cc.mo-care.com/eligibility-rules.js, run only when its fingerprint is approved (approved-rules.ts).
// No text, email, call, PDF or AxisCare write is reachable from here.
// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jobCaller } from '../_shared/job-auth.ts'
import { approvedRules, rulesCheck } from '../_shared/approved-rules.ts'
import { apply, NO_LANDING_YET, readKey, recordRun, report } from '../_shared/reference-land.ts'

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const RULES = 'eligibility-rules.js'

Deno.serve(async (req) => {
  const who = await jobCaller(req); if (!who) return json({ error: 'not allowed' }, 401)
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false, autoRefreshToken: false } })
  if (new URL(req.url).searchParams.get('rules_check') === '1') return json(await rulesCheck(db, [RULES]))
  const b: any = await req.json().catch(() => ({}))
  const mode = b?.mode === 'apply' ? 'apply' : b?.mode === 'report' ? 'report' : null
  if (!mode) return json({ error: "say which: { mode: 'report' } or { mode: 'apply' }" }, 400)
  const t0 = Date.now(), at = new Date().toISOString()
  try {
    if (mode === 'apply') {
      const st = (await readKey(db, 'ops_settings')) || {}
      if (st.ref_land_live !== true) return json({ ok: true, off: true, note: 'the switch "Reference answers land by themselves" is off; nothing changed' })
    }
    /* the one shared copy of answer to slot, approved by fingerprint, or nothing */
    const g = await approvedRules(db, RULES)
    if (!g.ok) {
      if (mode === 'apply') await recordRun(db, { ok: false, error: 'not run: ' + g.error }, at, Date.now() - t0)
      return json({ error: 'not run: ' + g.error }, 502)
    }
    ;(0, eval)(g.src)
    const E = (globalThis as any).CCElig
    if (!E || typeof E.refAnswerPatch !== 'function') {
      if (mode === 'apply') await recordRun(db, { ok: false, error: NO_LANDING_YET }, at, Date.now() - t0)
      return json({ ok: mode === 'report', mode, wrote_nothing: true, rules_missing_landing: true, message: NO_LANDING_YET, fingerprint: g.fingerprint.slice(0, 12) }, mode === 'report' ? 200 : 502)
    }
    if (mode === 'report') return json({ ...(await report(db, E)), run_by: who, fingerprint: g.fingerprint.slice(0, 12) })
    const out = await apply(db, E)
    await recordRun(db, out, at, Date.now() - t0)
    return json({ ...out, run_by: who, fingerprint: g.fingerprint.slice(0, 12) })
  } catch (e) {
    const error = String((e as Error).message || e).slice(0, 300)
    if (mode === 'apply') await recordRun(db, { ok: false, error }, at, Date.now() - t0)
    return json({ error, note: 'stopped; anything landed before this line stays landed and marked' }, 502)
  }
})
