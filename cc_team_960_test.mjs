// cc_team_960_test.mjs · team numbers and management reviews (Care Coordinator Leads and Bonus, Stage 5; policy approved by
// Samantha 2026-10-18): the REAL cc-team against a fake database and a controllable clock. Made-up people only; nothing
// leaves this machine. node cc_team_960_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
let NOW = Date.parse('2026-11-20T18:00:00Z')
const RealDate = Date
class FakeDate extends RealDate { constructor(...a) { if (!a.length) super(NOW); else super(...a) } static now() { return NOW } }
globalThis.Date = FakeDate
const at = (iso) => { NOW = RealDate.parse(iso) }
const S = 'sam@mo-care.com', Z = 'zach@mo-care.com', K = 'kry@mo-care.com', A = 'ang@mo-care.com'
const PEOPLE = [['p-s', 'Samantha Troutman', S, 'owner_admin'], ['p-z', 'Zach Troutman', Z, 'owner_admin'], ['p-k', 'Krystal Land', K, 'care_coordinator'], ['p-a', 'Angiel Rose', A, 'care_coordinator']]
const JWT = { sam: ['u-s', S], zach: ['u-z', Z], kry: ['u-k', K], ang: ['u-a', A] }
let T, APP
const reset = (live = true) => {
  APP = { ops_settings: { team_live: live, team: { hr_lead: Z }, bonus: { decider: S }, lead_rotation: { people: [{ name: 'Krystal', on: true }, { name: 'Angiel', on: true }] } }, automation_heartbeats: [], cc_reviews: [],
    leads: [
      { id: 'l1', first_name: 'Ann', client_first_name: 'Rose', status: 'Contacted', assigned_coordinator: 'Krystal', created_at: '2026-11-02T15:00:00Z', first_human_contact_at: '2026-11-02T16:00:00Z', first_human_attempt_at: '2026-11-02T16:00:00Z', follow_up_due: '2026-11-18' },
      { id: 'l2', first_name: 'Bo', client_first_name: 'Bea', status: 'Contacted', assigned_coordinator: 'Krystal', created_at: '2026-11-03T15:00:00Z', first_human_contact_at: '2026-11-03T16:00:00Z', first_human_attempt_at: '2026-11-03T16:00:00Z', promised_callback_at: '2026-11-19T10:00:00' },
      { id: 'l3', first_name: 'Cy', client_first_name: 'Cal', status: 'Contacted', assigned_coordinator: 'Angiel', created_at: '2026-11-04T15:00:00Z', first_human_contact_at: '2026-11-04T16:00:00Z', first_human_attempt_at: '2026-11-04T16:00:00Z', follow_up_due: '2026-11-25' },
      { id: 'l4', first_name: 'Di', client_first_name: 'Dot', status: 'Converted', said_yes_at: '2026-11-01T00:00:00Z', funding_source: 'private', assigned_coordinator: 'Krystal', original_owner: { name: 'Krystal' }, first_shift_at: '2026-11-05T15:00:00Z', created_at: '2026-10-25T15:00:00Z' },
      { id: 'l5', first_name: 'Ed', client_first_name: 'Eve', status: 'Converted', said_yes_at: '2026-10-15T00:00:00Z', assigned_coordinator: 'Angiel', original_owner: { name: 'Angiel' }, first_shift_at: '2026-10-20T15:00:00Z', created_at: '2026-10-10T15:00:00Z' },
      { id: 'l6', first_name: 'Flo', client_first_name: 'Fay', status: 'Assessment Scheduled', assigned_coordinator: 'Angiel', owner_turn: { to: 'Angiel', how: 'returning', apart: true, at: '2026-11-10T15:00:00Z', seq: 3 }, created_at: '2026-11-10T15:00:00Z', first_human_contact_at: '2026-11-10T16:00:00Z', first_human_attempt_at: '2026-11-10T16:00:00Z', follow_up_due: '2026-11-24' } ],
    care_assessments: [{ id: 'a1', lead_id: 'l6', visit_date: '2026-11-12', status: 'Completed — Awaiting Plan', coordinator: 'Krystal' }],
    cc_bonuses: [{ id: 'bonus_l5', lead_id: 'l5', recipient: 'Angiel', amount: 100, status: 'approved', decided_at: '2026-11-15T15:00:00Z' }],
    ops_items: [{ id: 'ops_rel_l5_day30', kind: 'relationship_call', status: 'open', owner: A, source_id: 'l5', about: 'Eve', due: '2026-11-19T23:00:00Z' }] }
  T = { auth_identities: PEOPLE.map(([p], i) => ({ auth_user_id: Object.values(JWT)[i][0], project_ref: 'zngsgedlsxinbygwmxwn', person_id: p })),
    persons: PEOPLE.map(([p, n, e]) => ({ person_id: p, full_name: n, primary_email: e, active: true })),
    entity_memberships: PEOPLE.map(([p]) => ({ person_id: p, entity: 'cc_ihs', active: true, ended_at: null })),
    staff_roles: PEOPLE.map(([p, , , r]) => ({ person_id: p, entity: 'cc_ihs', role: r })),
    client_journey: [{ subject: 'client', lead_id: 'l5', status: 'active', closed_reason: null, updated_at: '2026-10-20T15:00:00Z' }], op_events: [] }
}
const clone = (x) => JSON.parse(JSON.stringify(x))
const q = (t) => { const st = { f: [], ins: [], not: [], op: 'select', row: null }; const run = () => {
    if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]
      if (st.op === 'update') { APP[k] = clone(st.row.data); return { data: [], error: null } }
      if (st.op === 'insert' && st.row && st.row.key) { APP[st.row.key] = clone(st.row.data); return { data: null, error: null } }
      return { data: k in APP ? [{ key: k, data: clone(APP[k]) }] : [], error: null } }
    const rows = T[t] ?? (T[t] = [])
    if (st.op === 'insert') { rows.push(...(Array.isArray(st.row) ? st.row : [st.row])); return { data: null, error: null } }
    return { data: clone(rows.filter((r) => st.f.every(([c, v]) => r[c] === v) && st.ins.every(([c, vs]) => vs.includes(r[c])) && st.not.every((c) => r[c] != null))), error: null } }
  const b = { select() { return b }, eq(c, v) { st.f.push([c, v]); return b }, in(c, vs) { st.ins.push([c, vs]); return b }, not(c) { st.not.push(c); return b }, limit() { return b }, order() { return b },
    insert(r) { st.op = 'insert'; st.row = r; return b }, update(r) { st.op = 'update'; st.row = r; return b }, upsert(r) { st.op = 'insert'; st.row = r; return b },
    maybeSingle() { const r = run(); return Promise.resolve({ data: r.data ? r.data[0] ?? null : null, error: r.error }) }, then(ok, no) { return Promise.resolve(run()).then(ok, no) } }; return b }
globalThis.__db = { from: q,
  rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => x.id === a.item.id); const it = clone(a.item); if (i >= 0) arr[i] = it; else arr.push(it) } return { data: null, error: null } },
  auth: { getUser: async (jwt) => JWT[jwt] ? { data: { user: { id: JWT[jwt][0], email: JWT[jwt][1], app_metadata: {} } }, error: null } : { data: { user: null }, error: { message: 'bad' } } } }
globalThis.fetch = async (url) => { const u = String(url); if (u.includes('axiscare')) return new Response('{}', { status: 500 })
  return new Response('{}', { status: 404 }) }
const JOBSEC = 'j'.repeat(64)
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc_' + 'k'.repeat(60), HUB_JOB_SECRET: JOBSEC, AXISCARE_TOKEN: 'ax', AXISCARE_SITE: '16485' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_cct_'))
const shared = (s) => s.replace(/from '\.\.\/_shared\/([\w-]+)\.(ts|js)'/g, (_, m, e) => "from '" + path.join(tmp, m + '.' + e) + "'").replace(/from '\.\/([\w-]+)\.(ts|js)'/g, (_, m, e) => "from '" + path.join(tmp, m + '.' + e) + "'")
  .replace(/import '\.\.\/_shared\/([\w-]+)\.js'/g, (_, m) => "import '" + path.join(tmp, m + '.js') + "'")
  .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
try {
  for (const f of fs.readdirSync(path.join(F, '_shared')).filter((f) => f.endsWith('.ts') || f.endsWith('.js'))) fs.writeFileSync(path.join(tmp, f), shared(fs.readFileSync(path.join(F, '_shared', f), 'utf8')))
  fs.writeFileSync(path.join(tmp, 'fn.ts'), shared(fs.readFileSync(path.join(F, 'cc-team/index.ts'), 'utf8')))
  await import(path.join(tmp, 'fn.ts'))
  const cron = async (qs = '') => { const r = await handler(new Request('https://x/fn' + qs, { method: 'POST', headers: { Authorization: 'Bearer eyJanon', 'x-cron-secret': JOBSEC, 'Content-Type': 'application/json' }, body: '{}' })); return { s: r.status, j: await r.json() } }
  const call = async (jwt, body) => { const r = await handler(new Request('https://x/fn', { method: 'POST', headers: { ...(jwt ? { Authorization: 'Bearer ' + jwt } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })); return { s: r.status, j: await r.json() } }

  const rev = () => APP.cc_reviews
  /* ── off: lists, writes nothing ── */
  reset(false); let r = await cron()
  ck('off · it would open one review, for Krystal (2 overdue follow-ups); nothing written', r.s === 200 && r.j.live === false && r.j.write === false && JSON.stringify(r.j.reviews_to_open) === '["Krystal"]' && r.j.overdue_now === 3 && !APP.cc_overdue_log && rev().length === 0, r.j)
  r = await call(null, { action: 'list' }); ck('no sign-in · refused', r.s === 401)
  r = await handler(new Request('https://x/fn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })); ck('no key on the daily check · refused', r.status === 401)

  /* ── on ── */
  reset(true); r = await cron()
  ck('on · one review opens for Krystal with her two overdue items; Angiel (one overdue) gets none', rev().length === 1 && rev()[0].person === 'Krystal' && rev()[0].status === 'open' && rev()[0].items.length === 2, rev())
  ck('on · the overdue log holds the three items, first day seen', (APP.cc_overdue_log || []).length === 3 && APP.cc_overdue_log.every((x) => x.day === '2026-11-20'), APP.cc_overdue_log)
  r = await cron(); ck('again the same day · no second review, nothing doubled', rev().length === 1 && APP.cc_overdue_log.length === 3)

  r = await call('ang', { action: 'list' })
  const am = r.j.months && r.j.months[0]
  ck('Angiel · MY MONTH only: 2 leads assigned (1 a returning client, step 6), 1 assessment owned, 1 retained at 30 days, 1 overdue, 1 bonus ($100)', r.s === 200 && r.j.months.length === 1 && am.person === 'Angiel' && am.leads_assigned === 2 && am.leads_returning === 1 && am.assessments_owned === 1 && am.retained_30 === 1 && am.overdue_now === 1 && am.bonuses === 1 && am.bonus_dollars === 100, r.j.months)
  ck('Angiel · her overdue list (the 30-day relationship call), and no reviews', r.j.my_overdue.length === 1 && r.j.my_overdue[0].kind === 'relationship_call' && r.j.reviews.length === 0, r.j)
  r = await call('kry', { action: 'list' })
  const km = r.j.months[0]
  ck('Krystal · her own: 1 start, 1 assessment helped (Angiel’s family), 2 overdue; she does not see the review about her', r.j.months.length === 1 && km.starts === 1 && km.assessments_helped === 1 && km.overdue_now === 2 && r.j.reviews.length === 0, r.j)
  r = await call('zach', { action: 'list' })
  ck('Zach (HR lead) · both side by side, the review, 1 waiting', r.j.months.length === 2 && r.j.reviews.length === 1 && r.j.waiting === 1 && r.j.me.hr === true, r.j)
  r = await call('sam', { action: 'list' })
  ck('Samantha · both side by side; the review is not hers yet (not unresolved)', r.j.months.length === 2 && r.j.reviews.length === 0, r.j.reviews)

  /* ── decisions ── */
  const id = rev()[0].id
  r = await call('kry', { action: 'act', id, do: 'decide', cause: 'workload', choice: 'no_action' }); ck('Krystal can’t decide (or even see) it', r.s === 404)
  r = await call('zach', { action: 'act', id, do: 'decide', choice: 'coaching' }); ck('decide · needs the cause', r.s === 400 && /cause/.test(r.j.error))
  r = await call('zach', { action: 'act', id, do: 'decide', cause: 'training', choice: 'coaching', deadline: '2026-11-27', plan: 'Setting next dates' }); ck('coaching · needs an owner', r.s === 400 && /owner/.test(r.j.error))
  r = await call('zach', { action: 'act', id, do: 'decide', cause: 'training', choice: 'coaching', coaching_owner: Z, deadline: '2026-11-10', plan: 'x' }); ck('coaching · the deadline can’t be past', r.s === 400 && /deadline/.test(r.j.error))
  r = await call('zach', { action: 'act', id, do: 'decide', cause: 'training', choice: 'coaching', coaching_owner: Z, deadline: '2026-11-27', plan: 'Setting the next date on every call' })
  ck('Zach chooses coaching: cause training, owner, deadline Nov 27, plan; history kept', r.s === 200 && rev()[0].status === 'coaching' && rev()[0].cause === 'training' && rev()[0].coaching.deadline === '2026-11-27' && rev()[0].history.at(-1).by === Z, rev()[0])
  at('2026-11-28T18:00:00Z')
  r = await call('sam', { action: 'list' })
  ck('Nov 28, coaching past its deadline and not done · now Samantha sees it, marked unresolved', r.j.reviews.length === 1 && r.j.reviews[0].unresolved === true, r.j.reviews)
  r = await call('zach', { action: 'act', id, do: 'coaching_done' }); ck('done check · needs a note', r.s === 400 && /note/.test(r.j.error))
  r = await call('zach', { action: 'act', id, do: 'coaching_done', note: 'Walked through next dates with Krystal' })
  ck('Zach checks the coaching off with a note', r.s === 200 && rev()[0].status === 'done' && rev()[0].coaching.done_by === Z, rev()[0])
  r = await call('sam', { action: 'list' }); ck('resolved · Samantha no longer sees it', r.j.reviews.length === 0)

  /* ── only new misses count after a review ── */
  APP.leads.push({ id: 'l7', first_name: 'Gus', client_first_name: 'Gus', status: 'Contacted', assigned_coordinator: 'Krystal', created_at: '2026-11-20T15:00:00Z', first_human_contact_at: '2026-11-20T16:00:00Z', first_human_attempt_at: '2026-11-20T16:00:00Z', follow_up_due: '2026-11-26' })
  r = await cron()
  const kr = () => rev().filter((x) => x.person === 'Krystal')
  ck('after the review · Krystal’s old misses don’t count again; one new miss opens nothing for her', kr().length === 1 && !r.j.reviews_to_open.includes('Krystal'), r.j)
  ck('…while Angiel’s two follow-ups that went overdue this week open one for her', r.j.reviews_to_open.includes('Angiel') && rev().some((x) => x.person === 'Angiel' && x.status === 'open'), r.j)
  APP.leads.push({ id: 'l8', first_name: 'Hal', client_first_name: 'Hal', status: 'Contacted', assigned_coordinator: 'Krystal', created_at: '2026-11-20T15:00:00Z', first_human_contact_at: '2026-11-20T16:00:00Z', first_human_attempt_at: '2026-11-20T16:00:00Z', follow_up_due: '2026-11-27' })
  r = await cron()
  ck('a second new miss for Krystal · a new review opens with just the two new items', kr().length === 2 && kr()[1].status === 'open' && kr()[1].items.length === 2 && kr()[1].items.every((x) => ['Gus', 'Hal'].includes(x.client)), kr())
  ck('no review or decision ever went to the office event record', !T.op_events.length, T.op_events)

  /* ── time off never counts (audit step 2, ops_settings.fair_counts_live) ── */
  reset(true); at('2026-11-20T18:00:00Z'); APP.ops_settings.fair_counts_live = true
  APP.coordinator_staff = [{ email: K, name: 'Krystal Land', out_until: '2026-11-22' }, { email: A, name: 'Angiel Rose' }]
  r = await cron()
  ck('time off · Krystal is out: her 2 overdue follow-ups are logged as excused and open no review', !rev().some((x) => x.person === 'Krystal') && APP.cc_overdue_log.filter((x) => x.person === 'Krystal').every((x) => x.excused === 'out'), { rev: rev(), log: APP.cc_overdue_log })
  r = await call('zach', { action: 'list' })
  const kmo = r.j.months.find((m) => m.person === 'Krystal')
  ck('time off · Team shows them apart: 0 overdue, 2 while out', kmo.overdue_now === 0 && kmo.overdue_while_out === 2, kmo)
  at('2026-11-24T18:00:00Z'); APP.coordinator_staff[0].out_until = ''
  r = await cron()
  ck('back from time off · the same two items stay excused (no review for what went overdue while out)', !rev().some((x) => x.person === 'Krystal'), rev())
  /* ── causes (audit step 3, ops_settings.overdue_causes_live) ── */
  reset(true); at('2026-11-20T18:00:00Z'); APP.ops_settings.overdue_causes_live = true
  r = await cron()
  ck('causes · the first day the misses are logged, no review yet: the owner has a day to mark why', !rev().some((x) => x.person === 'Krystal') && APP.cc_overdue_log.filter((x) => x.person === 'Krystal').length === 2, rev())
  r = await call('kry', { action: 'list' })
  ck('causes · Krystal sees her two misses, each "Mine (it counts)", and the cause list', r.j.causes_live === true && r.j.my_missed.length === 2 && r.j.my_missed.every((x) => x.cause === 'employee' && x.counts) && !!r.j.overdue_causes.staffing, r.j.my_missed)
  const k1 = r.j.my_missed[0].key, k2 = r.j.my_missed[1].key
  r = await call('kry', { action: 'set_cause', key: k1, cause: 'staffing' })
  ck('causes · anything but "mine" needs a note', r.s === 400 && /note/.test(r.j.error), r.j)
  r = await call('ang', { action: 'set_cause', key: k1, cause: 'client', note: 'x' })
  ck('causes · Angiel can’t mark Krystal’s', r.s === 400 && /Only the person/.test(r.j.error), r.j)
  r = await call('kry', { action: 'set_cause', key: k1, cause: 'client', note: 'Family asked us to wait until after the hospital visit' })
  ck('causes · Krystal marks one as a client decision, with her note; it is kept with who and when', r.s === 200 && APP.cc_overdue_log.find((x) => x.key === k1).cause === 'client' && APP.cc_overdue_log.find((x) => x.key === k1).cause_by === K, APP.cc_overdue_log)
  at('2026-11-21T18:00:00Z'); r = await cron()
  ck('causes · next day: only one miss counts, so no review', !rev().some((x) => x.person === 'Krystal'), rev())
  r = await call('kry', { action: 'set_cause', key: k1, cause: 'employee' })
  at('2026-11-22T18:00:00Z'); r = await cron()
  ck('causes · put back to "mine": two count, the review opens with both keys', rev().some((x) => x.person === 'Krystal' && x.items.length === 2 && x.items.every((i) => i.key)), rev())
  r = await call('kry', { action: 'set_cause', key: k2, cause: 'technical', note: 'phone down' })
  ck('causes · once in a review, Krystal can’t change it (Zachary decides)', r.s === 400 && /Zachary decides/.test(r.j.error), r.j)
  r = await call('zach', { action: 'list' })
  const it0 = r.j.reviews.find((x) => x.person === 'Krystal').items[0]
  ck('causes · Zachary sees each item’s cause in the review', it0.cause === 'employee' && it0.in_review === true, it0)
  r = await call('zach', { action: 'set_cause', key: k2, cause: 'technical', note: 'GoHighLevel phone outage that morning' })
  ck('causes · Zachary changes one to phone or Hub problem', r.s === 200 && APP.cc_overdue_log.find((x) => x.key === k2).cause === 'technical', r.j)
  APP.ops_settings.overdue_causes_live = false
  r = await call('kry', { action: 'set_cause', key: k1, cause: 'client', note: 'x' })
  ck('causes off · marking is refused, and counting is as before', r.s === 400 && /switched off/.test(r.j.error), r.j)

  APP.ops_settings.fair_counts_live = false; reset(true); at('2026-11-20T18:00:00Z')
  APP.coordinator_staff = [{ email: K, name: 'Krystal Land', out_until: '2026-11-22' }]
  r = await cron()
  ck('switch off · as before: time off is not looked at, and the review opens', rev().some((x) => x.person === 'Krystal'), rev())
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }

for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n      ' + note))
const bad = res.filter((x) => !x[1]).length
console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
