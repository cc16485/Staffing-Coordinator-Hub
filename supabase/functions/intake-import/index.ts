// =============================================================================
// intake-import (443) · start forms import themselves (safe saves step 6). Samantha approved 2026-10-04.
// Every 5 minutes from its schedule (the jobs' secret), or the owner's Desktop step (the server key; ?dry=1 counts
// only). See _shared/intake-import.ts. The rules are the Hub's own intake-import-rules.js (approved fingerprint only);
// the job offers are read from the Training Platform through the same server-only connection the hiring history uses.
// Never reads the SSN; sends nothing.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jobCaller } from '../_shared/job-auth.ts'
import { approvedRules } from '../_shared/approved-rules.ts'
import { runJob, rulesFrom, RULES_FILE, type Deps } from '../_shared/intake-import.ts'
import { checkLink } from '../_shared/applicant-links.ts'

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const caller = await jobCaller(req)
  if (!caller) return json({ error: 'not allowed' }, 401)
  const url = new URL(req.url)
  if (url.searchParams.get('auth_check') === '1') return json({ ok: true, caller })
  const dry = url.searchParams.get('dry') === '1'
  if (dry && caller !== 'owner') return json({ error: 'not allowed' }, 401)
  const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false, autoRefreshToken: false } })
  const deps: Deps = {
    rules: async () => {
      const g = await approvedRules(db, RULES_FILE)
      if (!g.ok) return { ok: false, error: g.error }
      try { return { ok: true, I: rulesFrom(g.src) } } catch (e) { return { ok: false, error: String((e as Error).message ?? e) } }
    },
    offers: async () => {
      const OF_URL = Deno.env.get('OFFERS_PROJECT_URL') ?? '', OF_KEY = Deno.env.get('OFFERS_SERVICE_ROLE_KEY') ?? ''
      if (!OF_URL || !OF_KEY) return { ok: false, error: 'the job offers connection is not set up' }
      try {
        const r = await fetch(`${OF_URL}/rest/v1/job_offers?select=id,email,phone&limit=5000`, { headers: { apikey: OF_KEY, Authorization: `Bearer ${OF_KEY}` } })
        if (!r.ok) return { ok: false, error: 'the Training Platform answered ' + r.status }
        const rows = await r.json()
        return Array.isArray(rows) ? { ok: true, rows } : { ok: false, error: 'no list came back' }
      } catch (e) { return { ok: false, error: String(e).slice(0, 120) } }
    },
    /* the private start link it came through, checked against the moment the form was sent */
    linkOk: (f) => checkLink(Deno.env.get('HUB_JOB_SECRET') ?? '', 'start', f.start_offer_id, f.start_link_exp, f.start_link_sig, Math.floor(Date.parse(f.created_at) / 1000) || 0),
  }
  const runId = 'iim_' + new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) + '_' + crypto.randomUUID().slice(0, 6)
  try { return json(await runJob(db, deps, { caller, runId, dry })) }
  catch (e) { return json({ ok: false, error: 'the run stopped: ' + String(e).slice(0, 200) }, 500) }
})
