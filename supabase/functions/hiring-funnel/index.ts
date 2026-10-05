// =============================================================================
// hiring-funnel (448) · the Owners Hub's hiring funnel card. Owners only (requireStaff, owner_admin). Reads the
// applications, interview bookings, start forms, the Hub's candidate and caregiver lists, and AxisCare's caregiver list,
// and returns COUNTS only (see _shared/hiring-funnel.ts). Writes nothing; sends nothing.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff } from '../_shared/staff-auth.ts'
import { readCensus } from '../_shared/axis-census.ts'
import { funnel, lastMonths } from '../_shared/hiring-funnel.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const who = await requireStaff(db, req, ['owner_admin'])
  if (!who.ok) return json({ error: who.error }, who.status)
  const now = new Date()
  const from = lastMonths(now)[0] + '-01T00:00:00-06:00'
  try {
    const [ap, bk, ik, lists] = await Promise.all([
      db.from('job_applicants').select('id, created_at, status, phone, email, hired_at, noshow_at, post_interview').gte('created_at', from).limit(5000),
      db.from('interview_bookings').select('applicant_id, starts_at, status').gte('starts_at', from).limit(5000),
      db.from('hire_intake').select('phone, email, created_at').gte('created_at', from).limit(5000),
      db.from('app_data').select('key, data').in('key', ['candidates', 'caregivers']),
    ])
    for (const r of [ap, bk, ik, lists]) if (r.error) return json({ error: 'could not read the hiring records: ' + String(r.error.message).slice(0, 120) }, 500)
    // deno-lint-ignore no-explicit-any
    const L: any = {}; for (const r of lists.data ?? []) L[r.key] = Array.isArray(r.data) ? r.data : []
    const C = await readCensus()
    const out = funnel({ applicants: ap.data ?? [], bookings: bk.data ?? [], intakes: ik.data ?? [], candidates: L.candidates || [], roster: L.caregivers || [],
      census: C.ok ? C.rows : null, now })
    return json({ ok: true, ...out, census_ok: C.ok, census_error: C.ok ? null : C.error, at: now.toISOString() })
  } catch (e) { return json({ error: 'the count stopped: ' + String(e).slice(0, 160) }, 500) }
})
