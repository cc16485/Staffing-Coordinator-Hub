// Supabase Edge Function: cc-bonus  (shared hub project)
// -----------------------------------------------------------------------------
// THE CARE COORDINATOR NEW-CLIENT BONUS (Care Coordinator Leads and Bonus, Stage 4; policy approved by Samantha 2026-10-18).
// The rules are in _shared/bonus-rules.ts. The lines live in ONE app_data slot, 'cc_bonuses', that no browser can read
// (pay is private: install step 959 adds the rules that keep it server-only). Everyone reaches it through here:
//
//   the daily check (its schedule, x-cron-secret; or the owner's server key):
//     · a private-pay lead whose first visit (lead.first_shift_at) is on or after the program start gets ONE line for its
//       original lead owner, if they are on the Care Coordinator list (Settings > Leads > Lead turns)
//     · each open line gets its completed hours from AxisCare (read only: clock-in to clock-out, day 1 to day 30, and
//       the 90 days before the start for "returning client"), and the end of care from the client journey
//     · after day 30: Ready for approval, or Under review with the reason. Never Not earned by itself.
//     Off (ops_settings.bonus_live not true): it lists what it WOULD do and writes nothing. ?dry=1 is the same.
//   a signed-in office person (their own sign-in):
//     · list   owners see every line; the payroll person sees their own plus every approved or paid line; anyone
//              else sees only their own. Each line carries the words for its progress.
//     · act    approve / not_earned / paid / reopen, with the checks in bonus-rules.ts (who may, a written reason)
//     · ot_checked  Samantha records that she confirmed with Viventium how bonuses count toward overtime (once)
//   Decisions are never written to the office event record (everyone in the office reads it; pay is private): each line
//   keeps its own history of who, when and why.
// Nothing here texts, emails or calls anyone. AxisCare is only read.
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jobCaller } from '../_shared/job-auth.ts'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { axVisitsReader } from '../_shared/packet-visits.ts'
import { centralYmd, addDaysYmd } from '../_shared/business-days.ts'
import { opEvent } from '../_shared/events.ts'
import * as B from '../_shared/bonus-rules.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
               'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
// deno-lint-ignore no-explicit-any
type Any = any
const KEY = 'cc_bonuses'
const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const read = async (key: string): Promise<Any[]> => { const { data } = await sb.from('app_data').select('data').eq('key', key).maybeSingle(); return Array.isArray(data?.data) ? data!.data : [] }
const put = (key: string, item: unknown) => sb.rpc('upsert_app_data_item', { target_key: key, item })
const lc = (v: unknown) => String(v ?? '').trim().toLowerCase()
const firstOf = (v: unknown) => String(v ?? '').trim().split(/\s+/)[0] || ''

async function settings(): Promise<Any> { const { data } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle(); return data?.data ?? {} }
/** office people: first name -> email, and email -> name (persons + staff_roles, the same people every function uses) */
async function people(): Promise<{ emailOf: (n: string) => string; nameOf: (e: string) => string }> {
  const { data: roles } = await sb.from('staff_roles').select('person_id, role').eq('entity', 'cc_ihs')
  const ids = [...new Set((roles ?? []).map((r: Any) => r.person_id))]
  const { data: ps } = ids.length ? await sb.from('persons').select('person_id, full_name, primary_email, active').in('person_id', ids) : { data: [] }
  const live = (ps ?? []).filter((p: Any) => p.active !== false && p.primary_email)
  return { emailOf: (n: string) => { const f = lc(firstOf(n)); const p = live.find((x: Any) => lc(firstOf(x.full_name)) === f) || live.find((x: Any) => lc(String(x.primary_email).split('@')[0]) === f); return p ? lc(p.primary_email) : '' },
           nameOf: (e: string) => { const p = live.find((x: Any) => lc(x.primary_email) === lc(e)); return p?.full_name || e } }
}

/** the daily check */
async function sweep(write: boolean, ax = axVisitsReader()) {
  const st = await settings(), set = B.settingsOf(st), today = centralYmd(new Date()), nowIso = new Date().toISOString()
  const [leads, lines, P] = await Promise.all([read('leads'), read(KEY), people()])
  const { data: js } = await sb.from('client_journey').select('lead_id, axiscare_client_id, status, closed_reason, updated_at').eq('subject', 'client').not('lead_id', 'is', null)
  const jOf = new Map((js ?? []).map((j: Any) => [String(j.lead_id), j]))
  const plan: Any = { live: set.live, write, today, start: set.start, new_lines: [] as string[], updated: 0, unreadable: [] as string[], skipped: {} as Record<string, number>, written: 0 }
  const byLead = new Map(lines.map((x: Any) => [String(x.lead_id), x])), fresh = new Set<string>()
  for (const l of leads) {
    if (byLead.has(String(l?.id))) continue
    const c = B.candidate(l, set)
    if (c.skip) { if (l?.first_shift_at) plan.skipped[c.skip] = (plan.skipped[c.skip] || 0) + 1; continue }
    const who = [l.client_first_name, l.client_last_name].filter(Boolean).join(' ').trim() || [l.first_name, l.last_name].filter(Boolean).join(' ').trim() || 'a client'
    const line = { id: 'bonus_' + c.lead_id, lead_id: c.lead_id, client: who, recipient: c.recipient, recipient_email: P.emailOf(c.recipient), first_visit: c.first_visit, day30: c.day30,
      amount: set.amount, status: 'on_the_way', hours: null, reasons: [], created_at: nowIso, history: [{ at: nowIso, by: 'cc-bonus', action: 'created', from: null, to: 'on_the_way', why: 'first visit ' + c.first_visit }] }
    plan.new_lines.push(`${who} → ${c.recipient}`); byLead.set(c.lead_id, line); lines.push(line); fresh.add(line.id)
  }
  for (const line of lines) {
    if (['not_earned', 'approved', 'paid'].includes(line.status)) continue
    const l = leads.find((x: Any) => String(x?.id) === String(line.lead_id)), j: Any = jOf.get(String(line.lead_id))
    const axId = String(l?.axiscare_client_id || j?.axiscare_client_id || '').trim()
    const needRead = !(line.final_read_on && line.final_read_on > line.day30)   /* hours are final once read after day 30; only the end of care can still change */
    let hours: number | null = line.hours ?? null, prior = !!line.prior_care
    if (needRead) {
      const to = today < line.day30 ? today : line.day30
      const vs = /^\d+$/.test(axId) ? await ax(axId, addDaysYmd(line.first_visit, -B.DEFAULTS.returning_gap), to) : null
      if (vs == null) { plan.unreadable.push(line.client); hours = null }
      else { hours = B.hoursOf(vs, line.first_visit, line.day30); prior = B.completedIn(vs, addDaysYmd(line.first_visit, -B.DEFAULTS.returning_gap), addDaysYmd(line.first_visit, -1)).length > 0 }
    }
    const ended = j && j.status === 'closed' && /^care ended/i.test(String(j.closed_reason || '')) ? centralYmd(j.updated_at || nowIso) : (l && String(l.status) === 'Lost' ? centralYmd(l.lost_at || nowIso) : null)
    const next = B.evaluate(line, { today, hours, prior_care: prior, care_ended_on: ended }, set)
    next.prior_care = prior; if (needRead && hours != null) next.final_read_on = today
    if (next.status !== line.status) next.history = [...(line.history || []), { at: nowIso, by: 'cc-bonus', action: 'checked', from: line.status, to: next.status, why: (next.reasons || []).join('; ') || (next.status === 'ready' ? 'every rule met' : '') }].slice(-40)
    if (fresh.has(line.id) || JSON.stringify(next) !== JSON.stringify(line)) { if (!fresh.has(line.id)) plan.updated++; if (write) { await put(KEY, next); plan.written++ } }
  }
  return plan
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'not allowed' }, 405)
  const url = new URL(req.url)
  const body = await req.json().catch(() => ({})) as Record<string, unknown>

  /* the schedule or the owner's server key: the daily check */
  if (!body.action) {
    const caller = await jobCaller(req)
    if (!caller) return json({ error: 'not allowed' }, 401)
    if (url.searchParams.get('auth_check') === '1') return json({ ok: true, caller })
    const st = await settings()
    const write = st.bonus_live === true && url.searchParams.get('dry') !== '1'
    const plan = await sweep(write)
    try { await put('automation_heartbeats', { id: 'hb_cc-bonus', automation: 'cc-bonus', at: new Date().toISOString(), ok: true, note: `${write ? 'live' : 'practice'}: ${plan.new_lines.length} new, ${plan.updated} updated` }) } catch { /* a nicety */ }
    return json(plan)
  }

  /* a signed-in office person */
  const who = await requireStaff(sb, req, OFFICE_ROLES as unknown as string[])
  if (!who.ok) return json({ error: who.error }, who.status)
  const me = { email: lc(who.email), first: firstOf(who.name), owner: who.roles.includes('owner_admin'), name: who.name }
  const st = await settings(), set = B.settingsOf(st), nowIso = new Date().toISOString()
  const role = { owner: me.owner, decider: me.email === set.decider, payroll: !!set.payroll && me.email === set.payroll }

  if (body.action === 'list') {
    const lines = B.visible(await read(KEY), me, set).map((x: Any) => ({ ...x, words: B.progressWords(x, set), status_words: B.STATUS_WORDS[x.status] || x.status,
      history: me.owner || role.payroll ? x.history : undefined }))
      .sort((a: Any, b: Any) => String(b.first_visit).localeCompare(String(a.first_visit)))
    return json({ live: set.live, start: set.start, amount: set.amount, min_hours: set.min_hours, days: set.days, me: { ...role, email: me.email },
      ot_checked: set.ot_checked, lines })
  }
  if (body.action === 'act') {
    const lines = await read(KEY), line = lines.find((x: Any) => x.id === String(body.id || ''))
    if (!line || !B.visible([line], me, set).length) return json({ error: 'That bonus is not on file.' }, 404)
    const r = B.act(line, String(body.do || ''), { email: me.email, name: me.name, owner: me.owner }, { why: body.why, paid_on: body.paid_on }, set, nowIso)
    if (r.error) return json({ error: r.error }, 400)
    const { error } = await put(KEY, r.line)
    if (error) return json({ error: 'Could not save. Nothing changed.' }, 500)
    /* no office event: the event record is read by the whole office, and pay is private. The line keeps its own history. */
    return json({ ok: true, line: { ...r.line, words: B.progressWords(r.line, set), status_words: B.STATUS_WORDS[r.line.status] } })
  }
  if (body.action === 'ot_checked') {
    if (!role.decider) return json({ error: 'Only Samantha records the Viventium overtime check.' }, 403)
    const note = String(body.note || '').trim().slice(0, 300)
    if (!note) return json({ error: 'Write what Viventium said.' }, 400)
    const { data: row } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
    const cur: Any = row?.data ?? {}
    cur.bonus = { ...(cur.bonus || {}), ot_checked: { at: nowIso, by: me.email, note } }
    const { error } = await sb.from('app_data').update({ data: cur }).eq('key', 'ops_settings')
    if (error) return json({ error: 'Could not save. Nothing changed.' }, 500)
    await opEvent(sb, { actor_name: me.name, actor_email: me.email, verb: 'setting_changed', item_id: 'ops_settings', area: 'people_pay', summary: `${me.name} confirmed the Viventium overtime treatment for bonuses` })
    return json({ ok: true })
  }
  return json({ error: 'Unknown action' }, 400)
})
