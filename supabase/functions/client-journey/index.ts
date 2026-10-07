// =============================================================================
// client-journey: the ONE way to read or change a client's journey (Stages 1–3, Samantha approved 2026-10-06)
// =============================================================================
// Office staff only (owner / care coordinator / staffing coordinator), from their own Hub sign-in, plus the scheduled
// sweep (job secret or the owner key). Runs the same rules file as the Hub page (_shared/journey-rules.js), so what the
// page shows and what the server allows can never differ.
//
//   get        a person's journey: the catalog, the journey, every step state and the history
//   open       start a journey for a lead (or an AxisCare client with no lead). CDS is never started here.
//   apply      change one step: complete (answers, proof files, a note; a verified step only by hand with a reason),
//              wait (who on, and a check-back date: required), block (why, what unblocks it, who), unblock, reopen (why),
//              not_needed (why), exception (OWNERS ONLY: kind + written reason, permanent), assign (a step to a person)
//   assign_cc  give the journey to another Care Coordinator (every Care Coordinator step follows)
//   set_start  the target start date
//   upload_url / file_url   short-lived links for proof files (private bucket client-journey-files)
//   list       a summary per open journey (stage, next step, owner) for the Getting ready lists
//   sweep      (job) stamp when steps became ready, run the Hub's checks (verified steps), refresh My Work cards,
//              start journeys for new leads once someone has talked to them, close journeys whose lead was lost or archived
//   adopt      (job, the move-over 484) start journeys for the named real leads and AxisCare clients, switch on or off
// The move-over (483/484, Samantha 2026-10-06):
//   ROUTING: who gets a journey nobody chose is a RULE in Settings (client_journey_routing: payer -> Care Coordinator,
//            'unknown' while the payer isn't known). Her rule: Medicaid and VA to Angiel, everything else to Krystal.
//            A journey routed while the payer was unknown moves to the right person once the payer is answered.
//   BRIDGE:  the rest of the Hub still reads the First shift launch (client_queue): the launch evidence, when care
//            began, one open episode per client. So when a journey reaches the Team stage with an AxisCare client, it
//            opens (or picks up) that client's launch through upsert_client_launch, and when the journey becomes Active
//            it completes that launch. The Hub shows the journey in its place, never both.
//   While the switch is off, a real journey writes no My Work cards and touches no launch: only TEST journeys do.
// Every change writes the permanent history (client_journey_event) and refreshes that person's My Work cards: one card per
// person per owner, the next step even before anything is late. Nothing here texts, emails or calls anyone.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireStaff, OFFICE_ROLES } from '../_shared/staff-auth.ts'
import { jobCaller } from '../_shared/job-auth.ts'
import '../_shared/journey-rules.js'

// deno-lint-ignore no-explicit-any
type Any = any
// deno-lint-ignore no-explicit-any
const R: Any = (globalThis as any).JourneyRules
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const BUCKET = 'client-journey-files'
const PAYERS = ['private', 'medicaid', 'va', 'ltc', 'other']
const lc = (s: unknown) => String(s ?? '').trim().toLowerCase()
const today = () => R.ymd(Date.now())

export function refOf(j: Any): string { return j.axiscare_client_id ? 'A' + j.axiscare_client_id : j.lead_id ? 'L' + j.lead_id : 'J' + j.journey_id }
/** the lead's payer word, as the Hub stores it (funding_source) -> a journey payer. CDS is not a journey. */
export function payerFrom(fs: unknown): string | 'cds' | null {
  const s = lc(fs)
  if (!s) return null
  if (/cds|self.?direct/.test(s)) return 'cds'
  if (/medicaid|hcbs|ihs/.test(s)) return 'medicaid'
  if (/\bva\b|veteran/.test(s)) return 'va'
  if (/ltc|long.?term/.test(s)) return 'ltc'
  if (/private/.test(s)) return 'private'
  return 'other'
}

async function defs(db: Any): Promise<Any[]> {
  const { data, error } = await db.from('client_journey_step_def').select('key, def, active, catalog_version')
  if (error) throw new Error('could not read the step catalog')
  return (data ?? []).map((r: Any) => ({ ...r.def, key: r.key, active: r.active !== false && r.def?.active !== false }))
}
async function people(db: Any): Promise<{ owners: string[]; staffing: string[]; cc: string[]; names: Record<string, string>; office: Set<string> }> {
  const { data: roles } = await db.from('staff_roles').select('person_id, role').eq('entity', 'cc_ihs')
  const ids = [...new Set((roles ?? []).map((r: Any) => r.person_id))]
  const { data: ps } = ids.length ? await db.from('persons').select('person_id, full_name, primary_email, active').in('person_id', ids) : { data: [] }
  const byId: Record<string, Any> = {}; (ps ?? []).forEach((p: Any) => { if (p.active !== false && p.primary_email) byId[p.person_id] = p })
  const of = (role: string) => [...new Set((roles ?? []).filter((r: Any) => r.role === role && byId[r.person_id]).map((r: Any) => lc(byId[r.person_id].primary_email)))].sort() as string[]
  const names: Record<string, string> = {}; Object.values(byId).forEach((p: Any) => { names[lc(p.primary_email)] = p.full_name || p.primary_email })
  const office = new Set<string>([...of('owner_admin'), ...of('care_coordinator'), ...of('staffing_coordinator')])
  return { owners: of('owner_admin'), staffing: of('staffing_coordinator'), cc: of('care_coordinator'), names, office }
}
/** the routing RULE: an explicit choice, else the lead's own coordinator, else the payer route in Settings, else the
 *  default in Settings, else whoever opened it. Every person named must hold an office role, or the next rule decides. */
export function routeCc(pp: Any, st: Any, payer: string | null, lead: Any, asked: string, opener: string): { cc: string; how: string } {
  const ok = (e: unknown) => { const x = lc(e); return x && pp.office.has(x) ? x : '' }
  if (ok(asked)) return { cc: ok(asked), how: 'chosen' }
  const lc0 = lc(lead?.assigned_coordinator)
  if (lc0) {
    const hit = [...pp.office].find((e: string) => e === lc0 || lc(pp.names[e]) === lc0 || lc(pp.names[e]).split(' ')[0] === lc0.split(' ')[0] || e.split('@')[0] === lc0.split('@')[0])
    if (hit) return { cc: hit, how: 'lead coordinator' }
  }
  const routes = st?.client_journey_routing && typeof st.client_journey_routing === 'object' ? st.client_journey_routing : {}
  const r = ok(routes[payer || 'unknown'])
  if (r) return { cc: r, how: payer ? 'routing' : 'routing (payer not known yet)' }
  if (ok(st?.client_journey_default_cc)) return { cc: ok(st.client_journey_default_cc), how: 'default in Settings' }
  return { cc: lc(opener) || pp.owners[0] || '', how: 'opened by' }
}
const nameOf = (lead: Any) => String([lead?.client_first_name, lead?.client_last_name].filter(Boolean).join(' ') || [lead?.first_name, lead?.last_name].filter(Boolean).join(' ') || '').trim()
const live = (st: Any) => st?.client_journey_live === true
/** start one journey (the Hub's Start button, the sweep for a new lead, and the move-over all come through here) */
async function openOne(db: Any, dfs: Any[], pp: Any, st: Any, who: Any, o: { lead: Any; leadId: string | null; axId: string | null; payer?: unknown; name?: string; asked?: string; is_test?: boolean; how?: string }) {
  const pay = payerFrom(o.payer ?? o.lead?.funding_source)
  if (pay === 'cds') return { outcome: 'cds', error: 'CDS is its own program and does not use this journey.', code: 422 }
  const name = String(o.name || nameOf(o.lead)).trim()
  if (!name) return { outcome: 'no_name', error: 'The client needs a name first.', code: 400 }
  const r = routeCc(pp, st, pay, o.lead, o.asked || '', who.email)
  const row = { lead_id: o.leadId, axiscare_client_id: o.axId || (o.lead && /^\d+$/.test(String(o.lead.axiscare_client_id || '').trim()) ? String(o.lead.axiscare_client_id).trim() : null),
    client_name: name, payer: pay, assigned_cc: r.cc, assigned_how: r.how, created_by: who.email, is_test: o.is_test === true }
  const { data: j, error } = await db.from('client_journey').insert(row).select('*').single()
  if (error) return { outcome: 'error', error: 'Could not start the journey: ' + error.message, code: 500 }
  await event(db, j.journey_id, null, who, 'created', { assigned_cc: r.cc, payer: pay, how: r.how, started: o.how || 'by hand' })
  if (pay) {
    await putStep(db, j.journey_id, 'intake.payer', { state: 'complete', answer: { payer: pay }, evidence: { note: 'From the inquiry' }, completed_by: who.email, completed_by_name: who.name, completed_at: new Date().toISOString() })
    await event(db, j.journey_id, 'intake.payer', who, 'completed', { answer: { payer: pay }, from: 'the inquiry' })
  }
  const fresh = await load(db, { journey_id: j.journey_id })
  const out = await settle(db, fresh!.j, fresh!.steps, dfs, pp, st)
  return { outcome: 'created', journey_id: j.journey_id, ref: refOf(j), stage: out.view.stage, assigned_cc: r.cc, how: r.how, code: 200 }
}
const HUB = { email: 'hub', name: 'The Hub' }
/* ── the bridge to the First shift launch (client_queue) ── */
export const TEAM_AT = 'team'
async function bridge(db: Any, j: Any, view: Any, st: Any): Promise<string | null> {
  if (j.is_test || !live(st) || !j.axiscare_client_id) return null
  const now = new Date().toISOString()
  const at = R.STAGES.indexOf(view.stage), team = R.STAGES.indexOf(TEAM_AT)
  if (!j.launch_id && j.status === 'open' && at >= team) {
    const { data, error } = await db.rpc('upsert_client_launch', { p: { client_name: j.client_name, payer: j.payer, axiscare_client_id: j.axiscare_client_id,
      start_date: j.target_start || null, source: 'journey', created_by: 'client journey' } })
    if (error) { await event(db, j.journey_id, null, HUB, 'launch_failed', { error: String(error.message).slice(0, 300) }); return 'failed' }
    let id = data?.id ?? null
    if (!id) { const { data: q } = await db.from('client_queue').select('id').eq('axiscare_client_id', j.axiscare_client_id).neq('status', 'complete').limit(1); id = q?.[0]?.id ?? null }
    if (id) { await db.from('client_journey').update({ launch_id: id, updated_at: now }).eq('journey_id', j.journey_id); j.launch_id = id
      await event(db, j.journey_id, null, HUB, 'launch_linked', { launch_id: id, action: data?.action ?? null, episode_n: data?.episode_n ?? null }); return 'linked' }
    return null
  }
  if (j.launch_id && j.status === 'active') {
    const { data: q } = await db.from('client_queue').select('id, status').eq('id', j.launch_id).maybeSingle()
    if (q && q.status !== 'complete') {
      const { error } = await db.from('client_queue').update({ status: 'complete', completed_at: now, launch_completed_at: now }).eq('id', j.launch_id)
      await event(db, j.journey_id, null, HUB, error ? 'launch_failed' : 'launch_completed', error ? { error: String(error.message).slice(0, 300) } : { launch_id: j.launch_id })
      return error ? 'failed' : 'completed'
    }
  }
  return null
}
async function settings(db: Any): Promise<Any> {
  const { data } = await db.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  return data?.data ?? {}
}
function ctxFor(pp: Any, st: Any) {
  const staffing = lc(st?.client_journey_staffing_default) || pp.staffing[0] || pp.owners[0] || null
  return { today: today(), owner_emails: pp.owners, staffing_email: staffing }
}
async function load(db: Any, by: Any): Promise<{ j: Any; steps: Any[] } | null> {
  let q = db.from('client_journey').select('*')
  if (by.journey_id) q = q.eq('journey_id', String(by.journey_id))
  else if (by.axiscare_client_id) q = q.eq('axiscare_client_id', String(by.axiscare_client_id))
  else if (by.lead_id) q = q.eq('lead_id', String(by.lead_id))
  else return null
  const { data: j } = await q.maybeSingle()
  if (!j) return null
  const { data: steps } = await db.from('client_journey_step').select('*').eq('journey_id', j.journey_id)
  return { j, steps: steps ?? [] }
}
async function event(db: Any, journeyId: string, step: string | null, who: Any, kind: string, detail: Any = {}, reason: string | null = null) {
  await db.from('client_journey_event').insert({ journey_id: journeyId, step_key: step, actor_email: who.email || 'hub', actor_name: who.name || 'The Hub', kind, detail, reason })
}
async function putStep(db: Any, journeyId: string, key: string, patch: Any) {
  const { data: cur } = await db.from('client_journey_step').select('version').eq('journey_id', journeyId).eq('step_key', key).maybeSingle()
  const row = { journey_id: journeyId, step_key: key, ...patch, version: (cur?.version ?? 0) + 1, updated_at: new Date().toISOString() }
  const { error } = await db.from('client_journey_step').upsert(row, { onConflict: 'journey_id,step_key' })
  if (error) throw new Error('could not save the step: ' + error.message)
}

/* ── the Hub's own checks for "verified" steps ───────────────────────────── */
async function leadOf(db: Any, leadId: string | null): Promise<Any | null> {
  if (!leadId) return null
  const { data } = await db.from('app_data').select('data').eq('key', 'leads').maybeSingle()
  return (Array.isArray(data?.data) ? data.data : []).find((l: Any) => String(l?.id) === String(leadId)) ?? null
}
export const VERIFY: Record<string, (x: Any) => Promise<Any | null>> = {
  lead_basics: async ({ lead }) => {
    if (!lead) return null
    const miss = [['client name', (lead.client_first_name || '') + (lead.client_last_name || '')], ['date of birth', lead.client_dob], ['address', lead.client_address], ['phone', lead.client_phone || lead.phone]]
      .filter(([, v]) => !String(v ?? '').trim()).map(([k]) => k)
    return miss.length ? null : { detail: 'Name, date of birth, address and phone are on the profile' }
  },
  assessment_booked: async ({ lead }) => {
    if (!lead) return null
    const at = lead.assessment_at || lead.assessment_date
    return at || /assessment scheduled/i.test(String(lead.status || '')) ? { detail: 'Assessment booked' + (at ? ' for ' + String(at).slice(0, 16) : '') } : null
  },
  axiscare_client: async ({ j, lead, ax }) => {
    const id = j.axiscare_client_id || (lead && String(lead.axiscare_client_id || '').trim()) || ''
    if (!/^\d+$/.test(id)) return null
    const r = await ax(`/api/clients/${id}`)
    return r && r.status === 200 ? { detail: 'AxisCare client #' + id + ' read back', axiscare_client_id: id } : null
  },
  first_visit: async ({ j, ax }) => {
    if (!j.axiscare_client_id) return null
    const from = R.addDays(today(), -30), to = today()
    const r = await ax(`/api/visits?clientIds=${j.axiscare_client_id}&startDate=${from}&endDate=${to}`)
    const vs = r && r.status === 200 ? (r.json?.results?.visits ?? r.json?.visits ?? []) : []
    const v = (Array.isArray(vs) ? vs : Object.values(vs)).find((x: Any) => x && !x.removed && (x.clockIn || x.actualStartDate))
    return v ? { detail: 'First clock-in seen in AxisCare (' + String(v.scheduledStartDate || v.startDate || '').slice(0, 10) + ')' } : null
  },
}
function axFetcher() {
  let token = ''
  for (const n of ['AXISCARE_API_KEY', 'AXISCARE_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return async (path: string) => {
    if (!token || !/^\d+$/.test(site)) return null
    try { const r = await fetch(`https://${site}.axiscare.com${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': '2023-10-01' } })
      return { status: r.status, json: await r.json().catch(() => ({})) } } catch { return null }
  }
}

/** stamp ready_since, run the checks for verified steps, refresh My Work. Returns what changed. */
async function settle(db: Any, j: Any, steps: Any[], dfs: Any[], pp: Any, st: Any, opts: Any = {}): Promise<Any> {
  const ctx = ctxFor(pp, st)
  let view = R.compute(dfs, j, steps, ctx), changed = 0
  const now = new Date().toISOString()
  const ax = axFetcher(), lead = await leadOf(db, j.lead_id)
  for (const r of view.rows) {
    if (['ready', 'attention', 'blocked'].includes(r.status) && !r.st.ready_since && r.st.state !== 'waiting') {
      await putStep(db, j.journey_id, r.key, { ...stripRow(r.st), ready_since: now }); changed++
    }
    if (r.def.proof === 'verified' && ['ready', 'attention'].includes(r.status) && r.def.verify && VERIFY[r.def.verify] && opts.verify !== false) {
      const ok = await VERIFY[r.def.verify]({ j, lead, ax, db })
      if (ok) {
        await putStep(db, j.journey_id, r.key, { ...stripRow(r.st), state: 'complete', evidence: { ...(r.st.evidence || {}), verified: { at: now, detail: ok.detail } },
          completed_by: 'hub', completed_by_name: 'The Hub (verified)', completed_at: now })
        if (ok.axiscare_client_id && !j.axiscare_client_id) { await db.from('client_journey').update({ axiscare_client_id: ok.axiscare_client_id, updated_at: now }).eq('journey_id', j.journey_id); j.axiscare_client_id = ok.axiscare_client_id }
        await event(db, j.journey_id, r.key, { email: 'hub', name: 'The Hub' }, 'verified', { detail: ok.detail }); changed++
      }
    }
  }
  if (changed) { const fresh = await load(db, { journey_id: j.journey_id }); if (fresh) { steps = fresh.steps; view = R.compute(dfs, j, steps, ctx) } }
  if (view.complete && j.status === 'open' && steps.some((s: Any) => s.step_key === 'active.complete' && s.state === 'complete')) {
    await db.from('client_journey').update({ status: 'active', updated_at: now }).eq('journey_id', j.journey_id); j.status = 'active'
    await event(db, j.journey_id, null, { email: 'hub', name: 'The Hub' }, 'became_active', {})
  }
  const launch = await bridge(db, j, view, st)
  const cards = await refreshCards(db, j, view, pp, st)
  return { view, cards, changed, launch }
}
const stripRow = (s: Any) => { const o = { ...s }; delete o.journey_id; delete o.step_key; delete o.version; delete o.updated_at; return o }

/* ── My Work: one card per person per owner ─────────────────────────────── */
export function cardId(journeyId: string, owner: string | null) {
  let h = 0; const s = String(owner || 'none'); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return 'ops_jr_' + journeyId.replace(/-/g, '').slice(0, 12) + '_' + h.toString(36)
}
export function cardText(c: Any) {
  return c.kind === 'attention' ? 'NEEDS ATTENTION: ' + (c.why ? c.why + ' · ' : '') + c.title
    : c.kind === 'blocked' ? 'BLOCKED: ' + (c.why || c.title)
    : c.kind === 'waiting' ? 'Waiting: ' + c.title + (c.waiting_on ? ' (on ' + c.waiting_on + ')' : '')
    : 'Next: ' + c.title
}
async function refreshCards(db: Any, j: Any, view: Any, pp: Any, st: Any) {
  const ctx = ctxFor(pp, st)
  /* switched off: a real journey shows nobody anything yet (TEST journeys still do, for the owner trying it) */
  let cards = j.status === 'open' && (j.is_test || live(st)) ? R.cardsFor(j, view, ctx) : []
  /* nobody assigned: the owners get it, saying so */
  cards = cards.flatMap((c: Any) => c.owner ? [c] : pp.owners.map((o: string) => ({ ...c, owner: o, why: 'Nobody is assigned: ' + (c.why || 'assign a Care Coordinator') })))
  const { data: row } = await db.from('app_data').select('data').eq('key', 'ops_items').maybeSingle()
  const items: Any[] = Array.isArray(row?.data) ? row.data : []
  const prefix = 'ops_jr_' + j.journey_id.replace(/-/g, '').slice(0, 12) + '_'
  const want = new Map<string, Any>(), now = new Date().toISOString(), ref = refOf(j)
  for (const c of cards) {
    const id = cardId(j.journey_id, c.owner)
    /* Act Now: needs attention, or blocked with the start date within 7 days */
    const urgent = c.kind === 'attention' || (c.kind === 'blocked' && c.start_in != null && c.start_in <= 7), high = c.kind === 'blocked'
    want.set(id, { id, kind: 'journey', status: 'open', source_type: 'journey', journey_id: j.journey_id, step_key: c.step_key, card_kind: c.kind,
      title: cardText(c), about: j.client_name, detail: (c.also?.length ? 'Also ready: ' + c.also.join(' · ') : ''),
      link: '#p/' + ref + '/start/' + c.step_key, owner: c.owner, owner_name: pp.names[c.owner] || c.owner,
      urgency: urgent ? 'urgent' : high ? 'high' : 'normal',
      due: (urgent ? today() : (c.due || null)) ? new Date((urgent ? today() : c.due) + 'T17:00:00-05:00').toISOString() : null,
      sub_state: c.kind === 'waiting' ? 'waiting' : null, waiting_on: c.kind === 'waiting' ? (c.waiting_on || 'someone outside') : null, check_back: c.kind === 'waiting' ? c.check_back : null,
      start_in: c.start_in, is_test: !!j.is_test, created_by: 'journey', opened_by: 'journey' })
  }
  let wrote = 0, closed = 0
  for (const [id, it] of want) {
    const cur = items.find((x) => x?.id === id)
    const same = cur && cur.status === 'open' && ['title', 'detail', 'link', 'owner', 'urgency', 'due', 'sub_state', 'check_back', 'step_key', 'card_kind'].every((k) => JSON.stringify(cur[k] ?? null) === JSON.stringify(it[k] ?? null))
    if (same) continue
    const out = cur ? { ...cur, ...it, updated_at: now } : { ...it, created_at: now }
    if (cur && cur.status !== 'open') { out.status = 'open'; out.reopened_at = now }
    await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: out }); wrote++
  }
  for (const cur of items.filter((x) => x?.id?.startsWith(prefix) && x.status === 'open' && !want.has(x.id))) {
    await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { ...cur, status: 'done', closed_at: now, closed_by: 'journey', close_note: 'Nothing left for this person here; the journey moved on' } }); closed++
  }
  return { open: want.size, wrote, closed }
}

async function allLeads(db: Any): Promise<Any[]> {
  const { data } = await db.from('app_data').select('data').eq('key', 'leads').maybeSingle()
  return (Array.isArray(data?.data) ? data.data : []).filter((l: Any) => l && l.id != null)
}
/** NEW LEADS (after the move-over): a journey starts once someone has talked to them (status past New; a brand-new lead is
 *  the New lead card's job). Leads that already existed at the move-over never start by themselves: the move-over chose
 *  those, and anyone else gets the Start button. A lead marked Lost or archived closes its open journey. */
export function autoPlan(leads: Any[], js: Any[], cutover: Any) {
  const pre = new Set((Array.isArray(cutover?.lead_ids) ? cutover.lead_ids : []).map(String))
  const byLead = new Map(js.filter((j: Any) => j.lead_id).map((j: Any) => [String(j.lead_id), j]))
  const open: Any[] = [], close: Any[] = []
  if (!cutover?.at) return { open, close }
  for (const l of leads) {
    const id = String(l.id), j = byLead.get(id) as Any
    const gone = l.archived || l.status === 'Lost'
    if (j) { if (gone && j.status === 'open' && !j.is_test) close.push({ j, why: l.archived ? 'The lead was archived' : 'The lead was marked Lost' }); continue }
    if (gone || l.is_test || pre.has(id) || !l.status || l.status === 'New') continue
    if (payerFrom(l.funding_source) === 'cds' || !nameOf(l)) continue
    open.push(l)
  }
  return { open: open.slice(0, 10), close }
}
async function autoOpenClose(db: Any, dfs: Any[], pp: Any, st: Any) {
  const [{ data: cut }, leads, { data: js }] = await Promise.all([db.from('app_data').select('data').eq('key', 'client_journey_cutover').maybeSingle(), allLeads(db),
    db.from('client_journey').select('journey_id, lead_id, status, is_test')])
  const plan = autoPlan(leads, js ?? [], cut?.data), now = new Date().toISOString()
  let opened = 0, closed = 0
  for (const l of plan.open) { const r = await openOne(db, dfs, pp, st, HUB, { lead: l, leadId: String(l.id), axId: null, how: 'the lead was contacted' }); if (r.outcome === 'created') opened++ }
  for (const c of plan.close) {
    await db.from('client_journey').update({ status: 'closed', closed_reason: c.why, updated_at: now }).eq('journey_id', c.j.journey_id)
    await event(db, c.j.journey_id, null, HUB, 'closed', {}, c.why)
    const full = await load(db, { journey_id: c.j.journey_id }); if (full) await refreshCards(db, full.j, R.compute(dfs, full.j, full.steps, ctxFor(pp, st)), pp, st); closed++
  }
  return { opened, closed }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  let b: Any = {}; try { b = await req.json() } catch { return json({ error: 'bad request' }, 400) }

  /* the scheduled sweep: every open journey */
  if (b.action === 'sweep') {
    if (!(await jobCaller(req))) return json({ error: 'not allowed' }, 403)
    const [dfs, pp, st] = await Promise.all([defs(db), people(db), settings(db)])
    if (st.client_journey_live !== true) {
      /* switched off: real journeys show nobody anything, so their open My Work cards are put away (they come back on the
         first sweep after it is turned on again). TEST journeys keep theirs. */
      const { data: row } = await db.from('app_data').select('data').eq('key', 'ops_items').maybeSingle(), now = new Date().toISOString()
      let put = 0
      for (const it of (Array.isArray(row?.data) ? row.data : []).filter((x: Any) => x?.kind === 'journey' && x.status === 'open' && !x.is_test)) {
        await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { ...it, status: 'done', closed_at: now, closed_by: 'journey', close_note: 'Client journeys were switched off' } }); put++ }
      return json({ ok: true, live: false, note: 'client_journey_live is off: nothing swept', cards_put_away: put })
    }
    const auto = await autoOpenClose(db, dfs, pp, st)
    const { data: js } = await db.from('client_journey').select('*').in('status', ['open', 'active'])
    let n = 0, cards = 0, launches = 0
    for (const j of js ?? []) {
      if (j.status === 'active' && !j.launch_id) continue
      const { data: steps } = await db.from('client_journey_step').select('*').eq('journey_id', j.journey_id)
      const out = await settle(db, j, steps ?? [], dfs, pp, st, j.status === 'active' ? { verify: false } : {}); n++; cards += out.cards.wrote + out.cards.closed; if (out.launch) launches++
    }
    return json({ ok: true, journeys: n, card_changes: cards, launch_changes: launches, ...auto })
  }
  if (b.action === 'adopt') {
    if (!(await jobCaller(req))) return json({ error: 'not allowed' }, 403)
    const [dfs, pp, st] = await Promise.all([defs(db), people(db), settings(db)])
    const leads = await allLeads(db), out: Any[] = []
    for (const x of Array.isArray(b.people) ? b.people.slice(0, 50) : []) {
      const leadId = x.lead_id != null ? String(x.lead_id) : null, axId = x.axiscare_client_id ? String(x.axiscare_client_id) : null
      const had = await load(db, leadId ? { lead_id: leadId } : { axiscare_client_id: axId })
      if (had) { out.push({ ...x, outcome: 'exists', journey_id: had.j.journey_id }); continue }
      const lead = leadId ? leads.find((l: Any) => String(l?.id) === leadId) ?? null : null
      if (leadId && !lead) { out.push({ ...x, outcome: 'no_such_lead' }); continue }
      const r = await openOne(db, dfs, pp, st, { email: 'hub', name: 'The move-over (484)' }, { lead, leadId, axId, payer: x.payer, name: x.client_name, how: 'the move-over' })
      out.push({ ...x, ...r })
    }
    return json({ ok: true, adopted: out })
  }

  const who = await requireStaff(db, req, OFFICE_ROLES)
  if (!who.ok) return json({ error: who.error }, who.status)
  const isOwner = who.roles.includes('owner_admin')
  const [dfs, pp, st] = await Promise.all([defs(db), people(db), settings(db)])
  if (st.client_journey_live !== true && !isOwner) return json({ error: 'Client journeys are switched off right now.' }, 409)

  if (b.action === 'list') {
    const { data: js } = await db.from('client_journey').select('*').in('status', b.include_active ? ['open', 'active'] : ['open']).limit(500)
    const ids = (js ?? []).map((j: Any) => j.journey_id)
    const { data: steps } = ids.length ? await db.from('client_journey_step').select('*').in('journey_id', ids) : { data: [] }
    const ctx = ctxFor(pp, st)
    return json({ journeys: (js ?? []).map((j: Any) => {
      const v = R.compute(dfs, j, (steps ?? []).filter((s: Any) => s.journey_id === j.journey_id), ctx)
      return { journey_id: j.journey_id, ref: refOf(j), client_name: j.client_name, payer: j.payer, status: j.status, stage: v.stage, stage_label: v.stageLabel,
        target_start: j.target_start, assigned_cc: j.assigned_cc, is_test: j.is_test, lead_id: j.lead_id, axiscare_client_id: j.axiscare_client_id, launch_id: j.launch_id ?? null,
        next: v.next ? { key: v.next.key, title: v.next.def.title, status: v.next.status, why: v.next.attention || v.next.why || '', owner: v.next.owner.email } : null, stopped: !!v.stop }
    }) })
  }

  if (b.action === 'get') {
    const got = await load(db, b)
    if (!got) return json({ journey: null, defs: dfs })
    const { data: ev } = await db.from('client_journey_event').select('*').eq('journey_id', got.j.journey_id).order('at', { ascending: false }).limit(300)
    return json({ journey: got.j, steps: got.steps, events: ev ?? [], defs: dfs, ref: refOf(got.j), names: pp.names, is_owner: isOwner,
      ctx: ctxFor(pp, st), office: [...pp.office].map((e) => ({ email: e, name: pp.names[e] || e, roles: [pp.owners.includes(e) && 'owner_admin', pp.cc.includes(e) && 'care_coordinator', pp.staffing.includes(e) && 'staffing_coordinator'].filter(Boolean) })) })
  }

  if (b.action === 'open') {
    const leadId = b.lead_id != null ? String(b.lead_id) : null, axId = b.axiscare_client_id ? String(b.axiscare_client_id) : null
    if (!leadId && !axId) return json({ error: 'which person?' }, 400)
    const had = await load(db, leadId ? { lead_id: leadId } : { axiscare_client_id: axId })
    if (had) return json({ outcome: 'exists', journey_id: had.j.journey_id })
    if (st.client_journey_live !== true && b.is_test !== true) return json({ outcome: 'off', error: 'Client journeys are switched off: only TEST journeys can be started.' }, 409)
    const lead = await leadOf(db, leadId)
    const r = await openOne(db, dfs, pp, st, who, { lead, leadId, axId, payer: b.payer, name: b.client_name, asked: lc(b.assigned_cc), is_test: b.is_test === true })
    return json(r, r.code)
  }

  const got = await load(db, b)
  if (!got) return json({ error: 'That journey was not found.' }, 404)
  const { j } = got
  const now = new Date().toISOString()

  if (b.action === 'assign_cc') {
    const to = lc(b.email); if (!pp.office.has(to)) return json({ error: 'Pick someone with an office role.' }, 400)
    if (to === lc(j.assigned_cc)) return json({ outcome: 'same' })
    await db.from('client_journey').update({ assigned_cc: to, assigned_how: 'chosen', updated_at: now }).eq('journey_id', j.journey_id)
    await event(db, j.journey_id, null, who, 'reassigned_cc', { from: j.assigned_cc, to }, b.reason || null)
    j.assigned_cc = to
    const out = await settle(db, j, got.steps, dfs, pp, st, { verify: false })
    return json({ outcome: 'assigned', cards: out.cards })
  }
  if (b.action === 'set_start') {
    const d = String(b.date || ''); if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) return json({ error: 'bad date' }, 400)
    await db.from('client_journey').update({ target_start: d || null, updated_at: now }).eq('journey_id', j.journey_id)
    await event(db, j.journey_id, null, who, 'target_start', { from: j.target_start, to: d || null }); j.target_start = d || null
    await settle(db, j, got.steps, dfs, pp, st, { verify: false })
    return json({ outcome: 'saved' })
  }
  if (b.action === 'upload_url') {
    const key = String(b.step_key || ''), name = String(b.name || 'file').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80)
    if (!dfs.some((d) => d.key === key)) return json({ error: 'unknown step' }, 400)
    const path = `${j.journey_id}/${key}/${Date.now()}-${name}`
    const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path)
    if (error) return json({ error: 'Could not prepare the upload.' }, 500)
    return json({ path, token: data.token, url: data.signedUrl })
  }
  if (b.action === 'file_url') {
    const path = String(b.path || ''); if (!path.startsWith(j.journey_id + '/')) return json({ error: 'not this journey\'s file' }, 403)
    const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, 600)
    if (error) return json({ error: 'Could not open the file.' }, 500)
    return json({ url: data.signedUrl })
  }
  if (b.action === 'refresh') { const out = await settle(db, j, got.steps, dfs, pp, st); return json({ outcome: 'ok', changed: out.changed, cards: out.cards }) }

  if (b.action !== 'apply') return json({ error: 'unknown action' }, 400)
  const key = String(b.step_key || ''), op = String(b.op || '')
  const ctx = ctxFor(pp, st), view = R.compute(dfs, j, got.steps, ctx)
  const row = view.rows.find((r: Any) => r.key === key)
  if (!row) return json({ error: 'That step does not apply to this person.' }, 400)
  const s = row.st, reason = String(b.reason || '').trim(), done = R.DONE.includes(s.state)
  if (b.expected_version != null && (s.version ?? 0) !== Number(b.expected_version)) return json({ outcome: 'changed_meanwhile', error: 'Someone changed this step a moment ago. Look again.' }, 409)

  if (op === 'complete') {
    if (done && !row.stop) return json({ outcome: 'already', error: 'This step is already done.' }, 409)
    const files: string[] = (Array.isArray(b.files) ? b.files : []).map(String).filter((p: string) => p.startsWith(j.journey_id + '/' + key + '/'))
    for (const p of files) { const dir = p.slice(0, p.lastIndexOf('/')), nm = p.slice(p.lastIndexOf('/') + 1)
      const { data: ls } = await db.storage.from(BUCKET).list(dir, { search: nm }); if (!(ls ?? []).some((f: Any) => f.name === nm)) return json({ error: 'A proof file did not finish uploading. Attach it again.' }, 400) }
    const answer = b.answer && typeof b.answer === 'object' ? b.answer : {}
    const can = R.canComplete(row, { answer, files, manual_reason: String(b.manual_reason || '').trim() })
    if (!can.ok) return json({ outcome: 'refused', error: can.why }, 422)
    const evidence = { ...(s.evidence || {}), ...(files.length ? { files: [...((s.evidence || {}).files || []), ...files] } : {}),
      ...(b.note ? { note: String(b.note).slice(0, 2000) } : {}), ...(b.manual_reason ? { manual: { reason: String(b.manual_reason).slice(0, 500), by: who.email, at: now } } : {}) }
    await putStep(db, j.journey_id, key, { ...stripRow(s), state: 'complete', answer: Object.keys(answer).length ? answer : (s.answer ?? null), evidence, waiting_on: null, check_back: null,
      blocked_reason: null, unblock: null, unblock_role: null, exception: null, completed_by: who.email, completed_by_name: who.name, completed_at: now })
    await event(db, j.journey_id, key, who, b.manual_reason ? 'confirmed_by_hand' : 'completed', { answer, files, note: b.note || null }, b.manual_reason || null)
    const oa = row.def.on_answer || {}
    if (oa.set_payer && answer[oa.set_payer]) { const p = PAYERS.includes(answer[oa.set_payer]) ? answer[oa.set_payer] : null
      if (p) { await db.from('client_journey').update({ payer: p, payer_other: p === 'other' ? String(answer.other_name || '').slice(0, 200) : null, updated_at: now }).eq('journey_id', j.journey_id); j.payer = p
        /* routed before anyone knew the payer: now the payer's route decides (a person's own choice is never overridden) */
        if (String(j.assigned_how || '').startsWith('routing')) {
          const r = routeCc(pp, st, p, null, '', who.email)
          if (r.how === 'routing' && r.cc !== lc(j.assigned_cc)) {
            await db.from('client_journey').update({ assigned_cc: r.cc, assigned_how: 'routing', updated_at: now }).eq('journey_id', j.journey_id)
            await event(db, j.journey_id, null, HUB, 'reassigned_cc', { from: j.assigned_cc, to: r.cc, how: 'routing by payer' }); j.assigned_cc = r.cc; j.assigned_how = 'routing'
          }
        } } }
    if (oa.set_target_start && /^\d{4}-\d{2}-\d{2}$/.test(String(answer[oa.set_target_start] || ''))) { await db.from('client_journey').update({ target_start: answer[oa.set_target_start], updated_at: now }).eq('journey_id', j.journey_id); j.target_start = answer[oa.set_target_start] }
  } else if (op === 'wait') {
    const cb = String(b.check_back || '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cb)) return json({ outcome: 'refused', error: 'Waiting needs a check-back date.' }, 422)
    if (cb < today()) return json({ outcome: 'refused', error: 'The check-back date can\'t be in the past.' }, 422)
    if (!String(b.waiting_on || '').trim()) return json({ outcome: 'refused', error: 'Say who or what we are waiting on.' }, 422)
    if (row.status === 'later' || done) return json({ outcome: 'refused', error: 'Only a step that is up now can wait.' }, 422)
    await putStep(db, j.journey_id, key, { ...stripRow(s), state: 'waiting', waiting_on: String(b.waiting_on).slice(0, 200), check_back: cb })
    await event(db, j.journey_id, key, who, 'waiting', { waiting_on: b.waiting_on, check_back: cb }, reason || null)
  } else if (op === 'block') {
    if (!reason) return json({ outcome: 'refused', error: 'Say why it is blocked.' }, 422)
    if (row.status === 'later' || done) return json({ outcome: 'refused', error: 'Only a step that is up now can be blocked.' }, 422)
    const ur = ['owner', 'care_coordinator', 'staffing_coordinator'].includes(b.unblock_role) ? b.unblock_role : null
    await putStep(db, j.journey_id, key, { ...stripRow(s), state: 'blocked', blocked_reason: reason.slice(0, 500), unblock: String(b.unblock || '').slice(0, 300), unblock_role: ur })
    await event(db, j.journey_id, key, who, 'blocked', { unblock: b.unblock || '', unblock_role: ur }, reason)
  } else if (op === 'unblock') {
    if (!['blocked', 'waiting'].includes(s.state)) return json({ outcome: 'refused', error: 'This step is not blocked or waiting.' }, 422)
    await putStep(db, j.journey_id, key, { ...stripRow(s), state: 'open', blocked_reason: null, unblock: null, unblock_role: null, waiting_on: null, check_back: null })
    await event(db, j.journey_id, key, who, s.state === 'waiting' ? 'back_from_waiting' : 'unblocked', {}, reason || null)
  } else if (op === 'reopen') {
    if (!done && !row.stop) return json({ outcome: 'refused', error: 'This step is not done.' }, 422)
    if (!reason) return json({ outcome: 'refused', error: 'Say why it is being reopened.' }, 422)
    if (s.state === 'exception' && !isOwner) return json({ outcome: 'refused', error: 'Only an owner can undo an owner exception.' }, 403)
    await putStep(db, j.journey_id, key, { ...stripRow(s), state: 'open', completed_by: null, completed_by_name: null, completed_at: null, exception: null })
    await event(db, j.journey_id, key, who, 'reopened', { was: { state: s.state, answer: s.answer ?? null, evidence: s.evidence ?? null, by: s.completed_by, at: s.completed_at } }, reason)
  } else if (op === 'not_needed') {
    if (!reason) return json({ outcome: 'refused', error: 'Say why this step isn\'t needed.' }, 422)
    if (row.def.required !== false && !isOwner) return json({ outcome: 'refused', error: 'This step is required. Only an owner can mark it not needed.' }, 403)
    await putStep(db, j.journey_id, key, { ...stripRow(s), state: 'not_needed', completed_by: who.email, completed_by_name: who.name, completed_at: now })
    await event(db, j.journey_id, key, who, 'not_needed', {}, reason)
  } else if (op === 'exception') {
    if (!isOwner) return json({ outcome: 'refused', error: 'Only Samantha or Zachary can allow an owner exception.' }, 403)
    if (!reason) return json({ outcome: 'refused', error: 'An owner exception needs a written reason.' }, 422)
    const kind = Object.keys(R.EXCEPTION_KINDS).includes(b.kind) ? b.kind : (row.def.exception_kind || 'other')
    await putStep(db, j.journey_id, key, { ...stripRow(s), state: 'exception', exception: { by: who.email, by_name: who.name, at: now, kind, reason: reason.slice(0, 2000) },
      completed_by: who.email, completed_by_name: who.name, completed_at: now, blocked_reason: null })
    await event(db, j.journey_id, key, who, 'owner_exception', { kind, label: R.EXCEPTION_KINDS[kind] }, reason)
  } else if (op === 'assign') {
    const to = lc(b.email); if (to && !pp.office.has(to)) return json({ error: 'Pick someone with an office role.' }, 400)
    await putStep(db, j.journey_id, key, { ...stripRow(s), owner_email: to || null })
    await event(db, j.journey_id, key, who, 'step_assigned', { to: to || 'the role holder' }, reason || null)
  } else return json({ error: 'unknown change' }, 400)

  const fresh = await load(db, { journey_id: j.journey_id })
  const out = await settle(db, fresh!.j, fresh!.steps, dfs, pp, st)
  return json({ outcome: 'saved', next: out.view.next ? { key: out.view.next.key, title: out.view.next.def.title, status: out.view.next.status } : null,
    stage: out.view.stage, complete: out.view.complete, status: fresh!.j.status, cards: out.cards })
})
