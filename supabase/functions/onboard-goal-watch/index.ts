// =============================================================================
// onboard-goal-watch · Team Builder's onboarding goal (Samantha, 2026-10-14)
// =============================================================================
// Her ask: Team Builder "for planning": show people who are onboarding and their stage, "then we could put our goal for
// when to have them onboarded by so they can work with that client". Her choices: the goal is the client's start date
// (the Start Contract's target date, through the plan's Journey link), which the office can change on the plan
// (plan.onboard_goal); someone falling behind shows in red on Team Builder AND gets a Needs Attention card for the
// onboarding owner when the goal is 3 days away (or passed) and they aren't Approved to Work yet. Nothing is texted.
//
// Each weekday run: every open Team Builder plan with a goal date; everyone on it (any shift, any choice, not a "no") who
// is still onboarding: an applicant not yet a caregiver on the roster (or on it without an AxisCare number), or a
// caregiver locked by their readiness card (work-lock). One card per person per plan, closed by the run once they are
// ready, off the plan, or the goal moves more than 3 days out. Runs on its schedule or the owner's key; ?dry=1 counts only.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jobCaller } from '../_shared/job-auth.ts'
import { workLock } from '../_shared/work-lock.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
// deno-lint-ignore no-explicit-any
type Any = any
export const WARN_DAYS = 3
const S = (v: unknown, n = 160) => String(v ?? '').trim().slice(0, n)
const d10 = (p: unknown) => String(p ?? '').replace(/\D/g, '').slice(-10)
const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '')
const isDay = (s: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? ''))
export const chiToday = (now = new Date()) => now.toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5)
const nice = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
const isOpenItem = (it: Any) => it && !/^(done|closed|dismissed|resolved|cancelled|canceled)$/i.test(String(it.status || 'open'))
const keyOf = (p: Any) => p.applicant_id ? 'a' + S(p.applicant_id, 64) : p.cg_ax_id ? 'c' + digits(p.cg_ax_id) : 'n' + S(p.name, 60).toLowerCase().replace(/[^a-z]/g, '')

/** Everyone on a plan who could be onboarding: the main person and the other choices on each shift, never a "no". */
export function planPeople(plan: Any): Any[] {
  const seen = new Map<string, Any>()
  const add = (p: Any) => { if (!p || p.status === 'no' || !(p.applicant_id || p.cg_ax_id)) return; const k = keyOf(p); if (!seen.has(k)) seen.set(k, { key: k, name: S(p.name, 120), applicant_id: p.applicant_id ? S(p.applicant_id, 64) : null, cg_ax_id: p.cg_ax_id ? digits(p.cg_ax_id) : null }) }
  for (const c of Object.values(plan?.cells || {})) add(c)
  for (const list of Object.values(plan?.options || {})) for (const o of (Array.isArray(list) ? list : [])) add(o)
  return [...seen.values()]
}

/** Still onboarding? An applicant is ready once they are a roster caregiver with an AxisCare number and not locked. */
export function stillOnboarding(p: Any, ctx: { locked: Set<string>; roster: Any[]; apps: Map<string, Any> }): boolean {
  if (p.cg_ax_id) return ctx.locked.has(p.cg_ax_id)
  const a = ctx.apps.get(String(p.applicant_id))
  if (!a) return true
  const ph = d10(a.phone), em = S(a.email, 160).toLowerCase()
  const rec = ctx.roster.find((g) => g?.active !== false && ((ph.length === 10 && d10(g.phone) === ph) || (em && S(g.email, 160).toLowerCase() === em)))
  const ax = rec ? digits(rec.axiscare_id) : ''
  return !ax || ctx.locked.has(ax)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const caller = await jobCaller(req)
  if (!caller) return json({ error: 'not allowed' }, 401)
  const q = new URL(req.url).searchParams
  if (q.get('auth_check') === '1') return json({ ok: true, caller })
  const dry = q.get('dry') === '1'
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const at = new Date().toISOString(), today = chiToday()
  const read = async (k: string) => { const { data, error } = await db.from('app_data').select('data').eq('key', k).maybeSingle(); if (error) throw new Error(k + ' could not be read'); return data?.data }
  let plans: Any[], roster: Any[], items: Any[]
  try { plans = (await read('staffing_plans')) ?? []; roster = (await read('caregivers')) ?? []; items = (await read('ops_items')) ?? [] }
  catch (e) { return json({ ok: false, held: String((e as Error).message) + '. Nothing was changed.' }) }
  const lock = await workLock(db, roster)
  if (!lock.ok) return json({ ok: false, held: lock.why + '. Nothing was changed.' })

  /* the onboarding owner (recruiting_orientation), else the caregivers owner, else honestly unowned */
  let owner = '', ownerName = ''
  for (const code of ['recruiting_orientation', 'caregivers']) {
    try { const { data: d } = await db.from('domains').select('owner_person').eq('entity', 'cc_ihs').eq('code', code).maybeSingle()
      if (d?.owner_person) { const { data: p } = await db.from('persons').select('primary_email, full_name').eq('person_id', d.owner_person).maybeSingle(); owner = S(p?.primary_email, 160); ownerName = S(p?.full_name, 80); if (owner) break } } catch { /* next */ }
  }

  const open = (Array.isArray(plans) ? plans : []).filter((p) => p && p.id && !/^(archived|closed|done|deleted)$/i.test(String(p.status || '')))
  const appIds = [...new Set(open.flatMap((p) => planPeople(p).map((x) => x.applicant_id).filter(Boolean)))]
  const apps = new Map<string, Any>()
  if (appIds.length) { const { data } = await db.from('job_applicants').select('id, first_name, last_name, phone, email').in('id', appIds); for (const a of data ?? []) apps.set(String(a.id), a) }

  const want = new Map<string, Any>(), out = { plans_with_goal: 0, onboarding: 0, cards_open: 0, cards_closed: 0, behind: [] as string[] }
  for (const plan of open) {
    let goal = isDay(plan.onboard_goal) ? String(plan.onboard_goal) : '', from = goal ? 'set on the plan' : ''
    if (!goal) {
      try {
        const { data: l } = await db.from('team_build_link_current').select('episode_id').eq('plan_id', String(plan.id)).maybeSingle()
        if (l?.episode_id) { const { data: sc } = await db.from('start_contract_current').select('target_date').eq('episode_id', l.episode_id).maybeSingle(); if (isDay(String(sc?.target_date ?? '').slice(0, 10))) { goal = String(sc!.target_date).slice(0, 10); from = "the client's start date" } }
      } catch { /* no goal = no card */ }
    }
    if (!goal) continue
    out.plans_with_goal++
    const left = daysBetween(today, goal), client = S(plan.client, 80) || ('the ' + (S(plan.city, 40) || 'open') + ' hours')
    for (const p of planPeople(plan)) {
      if (!stillOnboarding(p, { locked: lock.axis, roster, apps })) continue
      out.onboarding++
      if (left > WARN_DAYS) continue
      const id = 'onbgoal_' + String(plan.id).replace(/[^A-Za-z0-9_-]/g, '_') + '_' + p.key
      out.behind.push(p.name)
      want.set(id, { id, kind: 'onboarding_goal', domain: 'recruiting_orientation', about: p.name, plan_id: String(plan.id), applicant_id: p.applicant_id, axiscare_id: p.cg_ax_id,
        title: `${p.name}: onboarding goal for ${client} is ${left < 0 ? 'past' : left === 0 ? 'today' : 'in ' + left + ' day' + (left === 1 ? '' : 's')}`,
        detail: `${p.name} is on the Team Builder plan for ${client} and is still onboarding (not Approved to Work yet). The goal to have them ready is ${nice(goal)} (${from}).`,
        next_action: `Open Team Builder, ${client}, to see their stage and next step; move them along, or change the goal date on the plan.`,
        status: 'open', urgency: left <= 0 ? 'high' : 'today', goal_date: goal, owner, owner_name: ownerName, opened_by: 'onboard-goal-watch', created_by: 'onboard-goal-watch' })
    }
  }
  if (!dry) {
    for (const [id, it] of want) {
      const prev = items.find((x) => x?.id === id)
      if (prev && isOpenItem(prev)) { if (prev.title !== it.title || prev.goal_date !== it.goal_date) await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { ...prev, title: it.title, detail: it.detail, urgency: it.urgency, goal_date: it.goal_date, last_activity_at: at } }); continue }
      await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { ...it, created_at: at, first_at: at, last_activity_at: at, log: [{ at, by: 'automation', text: 'Opened by the onboarding goal check.' }] } })
      out.cards_open++
    }
    for (const it of items) {
      if (it?.kind !== 'onboarding_goal' || !isOpenItem(it) || want.has(it.id)) continue
      await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { ...it, status: 'done', closed_at: at, closed_by: 'onboard-goal-watch', last_activity_at: at, resolution_code: 'goal_check',
        close_note: 'Closed by the onboarding goal check: they are ready, off the plan, or the goal is more than 3 days away.', log: [...(Array.isArray(it.log) ? it.log : []), { at, by: 'automation', text: 'Closed: ready, off the plan, or the goal moved.' }] } })
      out.cards_closed++
    }
    try { await db.rpc('upsert_app_data_item', { target_key: 'automation_heartbeats', item: { id: 'hb_onboard-goal-watch', automation: 'onboard-goal-watch', at, ok: true, note: JSON.stringify({ ...out, behind: out.behind.length }).slice(0, 300) } }) } catch { /* observer */ }
  }
  return json({ ok: true, dry, ...out, behind: out.behind.length })
})
