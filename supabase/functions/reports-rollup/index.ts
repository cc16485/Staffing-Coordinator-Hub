// Supabase Edge Function: reports-rollup (shared hub project)
// -----------------------------------------------------------------------------
// One call returns the cross-business numbers for hub.mo-care.com/reports.html:
//   - Agency (shared app_data: leads, caregivers, visits, discipline, referrers)
//   - HomeTogether TV (orders + support tickets, shared app_data)
//   - HomeTogether Hire (htl_* tables in the Hire project, via service key)
//   - Training (completions in the Training project, via service key)
// Plus 8-week weekly trend buckets for the small charts.
//
// Auth: POST with the SHARED project user's access token (Authorization: Bearer).
// Only owner emails may read (REPORTS_OWNERS secret, comma list; defaults to
// Samantha + Zach). Secrets: HIRE_SERVICE_KEY, TRAINING_SERVICE_KEY.
// Deploy: supabase functions deploy reports-rollup --no-verify-jwt --project-ref zngsgedlsxinbygwmxwn
// -----------------------------------------------------------------------------

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const HIRE_URL = 'https://lrlczrpehjpncqixubuk.supabase.co'
const TRAINING_URL = 'https://rdqujxiycycwhskyvrwa.supabase.co'

// deno-lint-ignore no-explicit-any
async function rest(base: string, key: string, path: string): Promise<any[]> {
  try {
    const r = await fetch(`${base}/rest/v1/${path}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    if (!r.ok) return []
    return await r.json()
  } catch { return [] }
}

const DAY = 864e5
const within = (iso: string | null | undefined, days: number) =>
  !!iso && (Date.now() - new Date(iso).getTime()) < days * DAY

// 8 weekly buckets, oldest first; bucket 7 = this week (rolling 7-day windows)
function weekly(dates: (string | null | undefined)[]): number[] {
  const out = new Array(8).fill(0)
  const now = Date.now()
  for (const d of dates) {
    if (!d) continue
    const age = now - new Date(d).getTime()
    if (age < 0 || age >= 56 * DAY) continue
    out[7 - Math.floor(age / (7 * DAY))]++
  }
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const { data: u } = await admin.auth.getUser(jwt)
  const email = (u?.user?.email || '').toLowerCase()
  const owners = (Deno.env.get('REPORTS_OWNERS') ?? 'samantha@mo-care.com,zach@mo-care.com')
    .toLowerCase().split(',').map((s) => s.trim()).filter(Boolean)
  if (!email || !owners.includes(email)) return json({ error: 'Reports are for owners.' }, 403)

  // ---------- shared hub data ----------
  const KEYS = ['leads', 'caregivers', 'hometogether_orders', 'ht_tickets', 'client_checkins',
    'supervisory_visits', 'discipline_actions', 'referral_orgs', 'feedback', 'handoffs', 'consult_bookings']
  const { data: rows } = await admin.from('app_data').select('key,data').in('key', KEYS)
  // deno-lint-ignore no-explicit-any
  const D: Record<string, any[]> = {}
  for (const k of KEYS) D[k] = []
  // deno-lint-ignore no-explicit-any
  for (const r of rows ?? []) D[r.key] = Array.isArray(r.data) ? r.data : []

  const leads = D.leads
  const openish = (s: string) => !/closed|resolved|done|won|complete/i.test(s || '')

  const agency = {
    leads_total: leads.length,
    leads_30d: leads.filter((l) => within(l.created_at, 30)).length,
    caregivers_total: D.caregivers.length,
    referrers_total: D.referral_orgs.length,
    checkins_30d: D.client_checkins.filter((c) => within(c.created_at || c.date, 30)).length,
    supervisory_30d: D.supervisory_visits.filter((v) => within(v.created_at || v.date, 30)).length,
    discipline_open: D.discipline_actions.filter((d) => openish(d.status)).length,
    consults_30d: D.consult_bookings.filter((b) => within(b.created_at, 30)).length,
    feedback_30d: D.feedback.filter((f) => within(f.created_at, 30)).length,
  }

  const orders = D.hometogether_orders
  const tickets = D.ht_tickets
  const tv = {
    orders_total: orders.length,
    orders_30d: orders.filter((o) => within(o.created_at, 30)).length,
    orders_new: orders.filter((o) => /new/i.test(o.status || '')).length,
    tickets_total: tickets.length,
    tickets_open: tickets.filter((t) => openish(t.status)).length,
  }

  // ---------- HomeTogether Hire ----------
  const hk = Deno.env.get('HIRE_SERVICE_KEY') ?? ''
  const [fams, cgs, jobs, apps] = await Promise.all([
    rest(HIRE_URL, hk, 'htl_families?select=created_at,founding_number,subscription_status'),
    rest(HIRE_URL, hk, 'htl_caregivers?select=created_at,published'),
    rest(HIRE_URL, hk, 'htl_jobs?select=created_at'),
    rest(HIRE_URL, hk, 'htl_applications?select=created_at'),
  ])
  const hire = {
    families_total: fams.length,
    families_30d: fams.filter((f) => within(f.created_at, 30)).length,
    founding_claimed: fams.filter((f) => f.founding_number != null).length,
    founding_left: Math.max(0, 100 - fams.filter((f) => f.founding_number != null).length),
    members_active: fams.filter((f) => f.subscription_status === 'active').length,
    caregivers_total: cgs.length,
    caregivers_published: cgs.filter((c) => c.published).length,
    jobs_total: jobs.length,
    applications_total: apps.length,
  }

  // ---------- Training ----------
  const tk = Deno.env.get('TRAINING_SERVICE_KEY') ?? ''
  const [comps, roster] = await Promise.all([
    rest(TRAINING_URL, tk, 'completions?select=hours,completed_at'),
    rest(TRAINING_URL, tk, 'caregivers?select=id'),
  ])
  const ytd = new Date(new Date().getFullYear(), 0, 1).getTime()
  const training = {
    roster_total: roster.length,
    completions_30d: comps.filter((c) => within(c.completed_at, 30)).length,
    hours_30d: Math.round(comps.filter((c) => within(c.completed_at, 30))
      .reduce((s, c) => s + (Number(c.hours) || 0), 0) * 10) / 10,
    hours_ytd: Math.round(comps.filter((c) => c.completed_at && new Date(c.completed_at).getTime() >= ytd)
      .reduce((s, c) => s + (Number(c.hours) || 0), 0) * 10) / 10,
  }

  const trends = {
    leads: weekly(leads.map((l) => l.created_at)),
    tv_orders: weekly(orders.map((o) => o.created_at)),
    hire_families: weekly(fams.map((f) => f.created_at)),
    completions: weekly(comps.map((c) => c.completed_at)),
  }

  return json({ generated_at: new Date().toISOString(), agency, tv, hire, training, trends })
})
