// Supabase Edge Function: cc-team  (shared hub project)
// -----------------------------------------------------------------------------
// TEAM NUMBERS AND MANAGEMENT REVIEWS (Care Coordinator Leads and Bonus, Stage 5; policy approved by Samantha 2026-10-18).
// The rules are in _shared/team-rules.ts. The private records live in two app_data slots no browser can read (install
// step 960 adds the rules): 'cc_reviews' (management reviews and coaching) and 'cc_overdue_log' (which follow-ups went
// overdue, and when). Everyone reaches them through here:
//
//   the daily check (its schedule, x-cron-secret; or the owner's server key):
//     · notes which follow-ups are overdue for each Care Coordinator (first calls an hour late, promised calls, follow-up
//       and check-back dates, second tries, relationship calls)
//     · two different ones within 30 days open ONE management review for the HR lead (Zachary)
//     Off (ops_settings.team_live not true): it lists what it WOULD do and writes nothing. ?dry=1 is the same.
//   a signed-in office person:
//     · list   a Care Coordinator gets MY MONTH (their own numbers and what is overdue for them now); Samantha and
//              Zachary get every Care Coordinator side by side. Reviews: the HR lead sees all, Samantha the unresolved
//              ones, a coaching owner their own coaching; nobody else sees any
//     · act    decide (cause + No action or Coaching with an owner, deadline and plan) / coaching_done (a note)
//     · set_cause  why a follow-up went overdue (audit step 3, ops_settings.overdue_causes_live): the owner marks their own;
//              once it is part of an open review only the HR lead or Samantha can change it. Only "employee" counts.
// Reviews are never discipline and never go to the office event record (everyone reads it). Nothing here texts,
// emails or calls anyone.
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jobCaller } from '../_shared/job-auth.ts'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { centralYmd } from '../_shared/business-days.ts'
import * as T from '../_shared/team-rules.ts'
import '../_shared/lead-rules.js'
// deno-lint-ignore no-explicit-any
const LR: any = (globalThis as any).LeadRules

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
               'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
// deno-lint-ignore no-explicit-any
type Any = any
const REVIEWS = 'cc_reviews', LOG = 'cc_overdue_log'
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const read = async (key: string): Promise<Any> => { const { data } = await sb.from('app_data').select('data').eq('key', key).maybeSingle(); return data?.data ?? null }
const list = async (key: string): Promise<Any[]> => { const d = await read(key); return Array.isArray(d) ? d : [] }
const put = (key: string, item: unknown) => sb.rpc('upsert_app_data_item', { target_key: key, item })
const lc = (v: unknown) => String(v ?? '').trim().toLowerCase()
const firstOf = (v: unknown) => String(v ?? '').trim().split(/\s+/)[0] || ''

async function people(): Promise<{ emailOf: (n: string) => string }> {
  const { data: roles } = await sb.from('staff_roles').select('person_id, role').eq('entity', 'cc_ihs')
  const ids = [...new Set((roles ?? []).map((r: Any) => r.person_id))]
  const { data: ps } = ids.length ? await sb.from('persons').select('person_id, full_name, primary_email, active').in('person_id', ids) : { data: [] }
  const live = (ps ?? []).filter((p: Any) => p.active !== false && p.primary_email)
  return { emailOf: (n: string) => { const f = lc(firstOf(n)); const p = live.find((x: Any) => lc(firstOf(x.full_name)) === f) || live.find((x: Any) => lc(String(x.primary_email).split('@')[0]) === f); return p ? lc(p.primary_email) : '' } }
}
async function facts() {
  const [st, leads, assessments, bonuses, cards, P, staff] = await Promise.all([read('ops_settings'), list('leads'), list('care_assessments'), list('cc_bonuses'), list('ops_items'), people(), list('coordinator_staff')])
  const { data: js } = await sb.from('client_journey').select('lead_id, status, closed_reason, updated_at').eq('subject', 'client').not('lead_id', 'is', null)
  const set = T.settingsOf(st || {}), nowIso = new Date().toISOString(), today = centralYmd(nowIso)
  const raw = T.overdueNow(leads, cards, LR, st || {}, nowIso, set.people, P.emailOf)
  /* time off never counts (audit step 2): out = the Team page's out_until, today or later */
  const isOut = (name: string) => { const f = lc(firstOf(name)); return !!f && staff.some((x: Any) => x && lc(firstOf(x.name)) === f && String(x.out_until || '').slice(0, 10) >= today) }
  const overdue = (st || {}).fair_counts_live === true ? T.excuse(raw, isOut) : raw
  return { st: st || {}, set, leads, assessments, bonuses, journeys: js ?? [], overdue, nowIso, today, P, cards }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'not allowed' }, 405)
  const url = new URL(req.url)
  const body = await req.json().catch(() => ({})) as Record<string, unknown>

  /* the daily check */
  if (!body.action) {
    const caller = await jobCaller(req)
    if (!caller) return json({ error: 'not allowed' }, 401)
    if (url.searchParams.get('auth_check') === '1') return json({ ok: true, caller })
    const f = await facts(), write = f.set.live && url.searchParams.get('dry') !== '1'
    const log0 = await list(LOG), log1 = T.logOverdue(log0, f.overdue, f.today)
    const added = log1.filter((x: Any) => !log0.some((y: Any) => y.key === x.key))
    const reviews = await list(REVIEWS), open = T.reviewsToOpen(log1, reviews, f.set.people, f.today, undefined, f.set.causes_live)
    const plan = { live: f.set.live, write, today: f.today, overdue_now: f.overdue.length, newly_overdue: added.length, reviews_to_open: open.map((r: Any) => r.person), written: 0 }
    if (write) {
      if (log1.length !== log0.length) { const { error } = await sb.from('app_data').upsert({ key: LOG, data: log1 }); if (!error) plan.written++ }
      for (const r of open) { await put(REVIEWS, r); plan.written++ }
    }
    try { await put('automation_heartbeats', { id: 'hb_cc-team', automation: 'cc-team', at: f.nowIso, ok: true, note: `${write ? 'live' : 'practice'}: ${f.overdue.length} overdue now, ${open.length} review(s) opened` }) } catch { /* a nicety */ }
    return json(plan)
  }

  /* a signed-in office person */
  const who = await requireStaff(sb, req, OFFICE_ROLES as unknown as string[])
  if (!who.ok) return json({ error: who.error }, who.status)
  const me = { email: lc(who.email), first: firstOf(who.name), name: who.name, owner: who.roles.includes('owner_admin') }
  const f = await facts()
  const role = { owner: me.owner, hr: me.email === f.set.hr_lead, decider: me.email === f.set.decider, cc: f.set.people.some((p: string) => lc(p) === lc(me.first)) }

  if (body.action === 'list') {
    const d = { leads: f.leads, assessments: f.assessments, bonuses: f.bonuses, journeys: f.journeys, overdue: f.overdue }
    /* audit step 7: balanced measures beside the others, only while ops_settings.balanced_measures_live is on */
    const hours = LR.responseHours(f.st), firstCallMin = (l: Any) => { if (!l?.first_human_attempt_at) return null; const st = LR.clockStart(l, hours); return st ? Math.max(0, Math.round((Date.parse(l.first_human_attempt_at) - Date.parse(st)) / 60000)) : null }   /* the same math as the Leads board's median */
    const withBal = (p: string) => { const mo = T.monthFor(p, d, f.today); return f.set.balance_live ? { ...mo, balance: T.balanceFor(p, { leads: f.leads, cards: f.cards, emailOf: f.P.emailOf, firstCallMin }, f.today) } : mo }
    const months = me.owner ? f.set.people.map(withBal) : (role.cc ? [withBal(me.first)] : [])
    const myOverdue = role.cc ? f.overdue.filter((o: Any) => lc(o.person) === lc(me.first)).map((o: Any) => ({ kind: o.kind, client: o.client, since: o.since, lead_id: o.lead_id })) : []
    /* audit step 3: the logged misses of the last 30 days with their cause (the owner's own; the HR lead and Samantha see causes in reviews) */
    const log = await list(LOG), allReviews = await list(REVIEWS), from30 = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10)
    const inReview = (k: string) => allReviews.some((r: Any) => ['open', 'coaching'].includes(r.status) && (r.items || []).some((i: Any) => i.key === k))
    const shape = (x: Any) => ({ key: x.key, kind: x.kind, client: x.client, day: x.day, cause: T.causeOf(x), cause_note: x.cause_note || '', counts: T.counts(x, f.set.causes_live), in_review: inReview(x.key) })
    const myMissed = role.cc ? log.filter((x: Any) => lc(firstOf(x.person)) === lc(me.first) && x.day >= from30).map(shape) : []
    const byKey = new Map(log.map((x: Any) => [x.key, x]))
    const hrView = me.email === f.set.hr_lead || me.email === f.set.decider
    const reviews = T.visibleReviews(allReviews, me.email, f.set, f.today).map((r: Any) => ({ ...r, unresolved: T.unresolved(r, f.today),
      ...(hrView ? { items: (r.items || []).map((i: Any) => (byKey.get(i.key) ? { ...i, ...shape(byKey.get(i.key)) } : i)) } : { items: undefined, note: undefined, history: undefined }) }))
    return json({ live: f.set.live, causes_live: f.set.causes_live, overdue_causes: T.OVERDUE_CAUSES, me: { ...role, email: me.email }, month: T.monthOf(f.today).label, months, my_overdue: myOverdue, my_missed: myMissed, reviews,
      waiting: role.hr ? reviews.filter((r: Any) => r.status === 'open').length : 0, causes: T.CAUSES })
  }
  if (body.action === 'set_cause') {
    if (!f.set.causes_live) return json({ error: 'Causes are switched off.' }, 400)
    const log = await list(LOG), entry = log.find((x: Any) => x.key === String(body.key || ''))
    const out = T.setCause(entry, String(body.cause || ''), String(body.note || ''), { email: me.email, first: me.first }, await list(REVIEWS), f.set, f.nowIso)
    if (out.error) return json({ error: out.error }, 400)
    const { error } = await sb.from('app_data').upsert({ key: LOG, data: log.map((x: Any) => (x.key === out.entry.key ? out.entry : x)) })
    if (error) return json({ error: 'Could not save. Nothing changed.' }, 500)
    return json({ ok: true, cause: out.entry.cause })
  }
  if (body.action === 'act') {
    const all = await list(REVIEWS), r = all.find((x: Any) => x.id === String(body.id || ''))
    if (!r || !T.visibleReviews([r], me.email, f.set, f.today).length) return json({ error: 'That review is not on file.' }, 404)
    const out = T.act(r, String(body.do || ''), { email: me.email, name: me.name }, body, f.set, f.nowIso, f.today)
    if (out.error) return json({ error: out.error }, 400)
    const { error } = await put(REVIEWS, out.review)
    if (error) return json({ error: 'Could not save. Nothing changed.' }, 500)
    /* no office event: reviews are private */
    return json({ ok: true, review: { ...out.review, unresolved: T.unresolved(out.review, f.today) } })
  }
  return json({ error: 'Unknown action' }, 400)
})
