// =============================================================================
// caregiver-connect (438) · which Hub record belongs to each AxisCare caregiver.
// Samantha approved 2026-10-03 ("yes to all"): https://claude.ai/artifact/FJUZg3aU2neZBgGNDbCCLm
//
//   The hourly job (its schedule, carrying the jobs' secret; or the owner's Desktop step with the server key):
//     POST {}            one run: practice while ops_settings.cg_connect_live is off, otherwise connects (see
//                        _shared/cg-connect.ts). ?dry=1 (owner only): counts only, records nothing.
//     ?auth_check=1      says who the caller is, does nothing
//   A signed-in office person (the Hub's Connect card):
//     {action:'link', axiscare_id, caregiver_id}   "This is their Hub record"
//     {action:'move', axiscare_id, candidate_id}   "Move over from Background & References"
//     {action:'new',  axiscare_id}                 "Start a new Hub record"
//     {action:'undo', log_id}                      "Not this person"
// The rules are the Hub's own files (caregiver-connect-rules.js, and eligibility-rules.js for the hire snapshot), each run
// only when its fingerprint is approved.
// Never messages anyone; AxisCare is only read.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jobCaller } from '../_shared/job-auth.ts'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { approvedRules } from '../_shared/approved-rules.ts'
import { readCensus } from '../_shared/axis-census.ts'
import { runJob, manualAction, rulesFrom, eligFrom, RULES_FILE, ELIG_FILE, type Deps } from '../_shared/cg-connect.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const url = new URL(req.url)
  // deno-lint-ignore no-explicit-any
  let body: any = {}
  try { body = await req.json() } catch { body = {} }
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } })
  const deps: Deps = {
    census: () => readCensus(),
    rules: async () => {
      const g = await approvedRules(db, RULES_FILE)
      if (!g.ok) return { ok: false, error: g.error }
      const e = await approvedRules(db, ELIG_FILE)   // the hire snapshot (2026-10-04)
      if (!e.ok) return { ok: false, error: e.error }
      try { return { ok: true, C: rulesFrom(g.src), E: eligFrom(e.src) } } catch (x) { return { ok: false, error: String((x as Error).message ?? x) } }
    },
  }

  if (body && typeof body.action === 'string' && body.action) {
    const staff = await requireStaff(db, req, OFFICE_ROLES)
    if (!staff.ok) return json({ ok: false, error: staff.error }, staff.status)
    try {
      const r = await manualAction(db, deps, { name: staff.name, email: staff.email }, body)
      return json(r, r.ok ? 200 : (r as { status?: number }).status ?? 400)
    } catch (e) { return json({ ok: false, message: 'That did not go through: ' + String(e).slice(0, 160) }, 500) }
  }

  const caller = await jobCaller(req)
  if (!caller) return json({ error: 'not allowed' }, 401)
  if (url.searchParams.get('auth_check') === '1') return json({ ok: true, caller })
  const dry = url.searchParams.get('dry') === '1'
  if (dry && caller !== 'owner') return json({ error: 'not allowed' }, 401)
  const runId = 'cgc_' + new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) + '_' + crypto.randomUUID().slice(0, 6)
  try {
    return json(await runJob(db, deps, { caller, runId, dry }))
  } catch (e) {
    return json({ ok: false, error: 'the run stopped: ' + String(e).slice(0, 200) }, 500)
  }
})
