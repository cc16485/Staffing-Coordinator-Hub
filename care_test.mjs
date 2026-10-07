// PAUSE CARE / END CARE (2026-10-07): her seven proofs, on the REAL client-journey function (care.ts), the REAL rules,
// the REAL shared guard and quiet list, against a fake database. node care_test.mjs
// client-journey: the REAL function, the REAL staff check and the REAL rules file, against a fake database, fake storage
// and a fake AxisCare. node client_journey_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
const CAT = JSON.parse(fs.readFileSync('client-journey/catalog-v1.json', 'utf8')).steps
let T, FILES, AX
const uid = () => 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16))
const reset = (live = true) => { FILES = new Set(); AX = { clients: { '296': true }, visits: [] }
  T = { client_journey_step_def: CAT.map((d) => ({ key: d.key, def: d, active: true, catalog_version: 1 })), client_journey: [], client_journey_step: [], client_journey_event: [],
    app_data: [{ key: 'ops_settings', data: { client_journey_live: live } }, { key: 'ops_items', data: [] },
      { key: 'leads', data: [{ id: 'L1', client_first_name: 'Linda', client_last_name: 'Boyd', funding_source: 'medicaid', assigned_coordinator: 'angie@mo-care.com', phone: '4175550000' },
        { id: 'L2', client_first_name: 'Pat', client_last_name: 'Pay', funding_source: 'private' }, { id: 'L3', client_first_name: 'Cee', client_last_name: 'Dee', funding_source: 'cds' }] }],
    auth_identities: [['u-kr', 'p-kr'], ['u-an', 'p-an'], ['u-sam', 'p-sam'], ['u-sal', 'p-sal']].map(([a, p]) => ({ auth_user_id: a, project_ref: 'zngsgedlsxinbygwmxwn', person_id: p })),
    persons: [['p-kr', 'Krystal Land', 'krystal@mo-care.com'], ['p-an', 'Angie Care', 'angie@mo-care.com'], ['p-sam', 'Samantha Owner', 'sam@mo-care.com'], ['p-sal', 'Sally Staffing', 'sally@mo-care.com']]
      .map(([person_id, full_name, primary_email]) => ({ person_id, full_name, primary_email, active: true })),
    entity_memberships: ['p-kr', 'p-an', 'p-sam', 'p-sal'].map((person_id) => ({ person_id, entity: 'cc_ihs', active: true, ended_at: null })),
    staff_roles: [['p-kr', 'care_coordinator'], ['p-an', 'care_coordinator'], ['p-sam', 'owner_admin'], ['p-sal', 'staffing_coordinator']].map(([person_id, role]) => ({ person_id, entity: 'cc_ihs', role })) } }
const R_add = (n) => new Date(Date.now() + n * 864e5).toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
const clone = (x) => JSON.parse(JSON.stringify(x))
function q(t) {
  const st = { f: [], ins: [], op: 'select', patch: null, row: null, single: false }
  const match = (r) => st.f.every(([k, v, how]) => how === 'in' ? v.includes(r[k]) : how === 'neq' ? r[k] !== v : how === 'lte' ? String(r[k]) <= String(v) : how === 'notnull' ? r[k] !== null && r[k] !== undefined : String(r[k]) === String(v))
  const run = () => {
    T[t] = T[t] || []
    if (st.op === 'insert') { const rows = (Array.isArray(st.row) ? st.row : [st.row]).map((r) => ({ ...r }))
      for (const r of rows) {
        if (t === 'client_journey') { if (T[t].some((x) => x.status !== 'closed' && ((r.lead_id && x.lead_id === r.lead_id) || (r.axiscare_client_id && x.axiscare_client_id === r.axiscare_client_id)))) return { data: null, error: { message: 'duplicate' } }
          Object.assign(r, { journey_id: uid(), status: 'open', created_at: new Date().toISOString() }) }
        if (t === 'client_care_change') { if (r.reason === 'other' && !r.explanation) return { data: null, error: { message: 'ccc_other_needs_why' } }; Object.assign(r, { change_id: uid(), made_at: new Date().toISOString(), checklist: r.checklist || [] }) }
        if (t === 'client_pause') { if (T[t].some((x) => x.status === 'open' && x.axiscare_client_id === r.axiscare_client_id)) return { data: null, error: { message: 'client_pause_one_open' } }; Object.assign(r, { pause_id: uid(), status: 'open' }) }
        if (t === 'client_journey_event') { r.id = T[t].length + 1; r.at = new Date().toISOString(); r.is_test = !!(T.client_journey.find((j) => j.journey_id === r.journey_id) || {}).is_test }
        T[t].push(r) }
      return { data: st.single ? clone(rows[0]) : clone(rows), error: null } }
    if (st.op === 'upsert') { const r = st.row, i = T[t].findIndex((x) => x.journey_id === r.journey_id && x.step_key === r.step_key)
      if (r.state === 'waiting' && !r.check_back) return { data: null, error: { message: 'cj_waiting_needs_check_back' } }
      if (i >= 0) T[t][i] = { ...T[t][i], ...r }; else T[t].push({ ...r }); return { data: null, error: null } }
    if (st.op === 'update') { T[t].filter(match).forEach((r) => Object.assign(r, st.patch)); return { data: null, error: null } }
    let rows = T[t].filter(match)
    if (st.order) rows = rows.slice().sort((a, b) => (st.order.asc ? 1 : -1) * String(a[st.order.k]).localeCompare(String(b[st.order.k])))
    return { data: st.single ? (rows[0] ? clone(rows[0]) : null) : clone(rows), error: null }
  }
  const b = { select() { return b }, eq(k, v) { st.f.push([k, v]); return b }, neq(k, v) { st.f.push([k, v, 'neq']); return b }, lte(k, v) { st.f.push([k, v, 'lte']); return b }, limit() { return b }, not(k, op, v) { st.f.push([k, null, 'notnull']); return b }, in(k, v) { st.f.push([k, v, 'in']); return b }, order(k, o) { st.order = { k, asc: o?.ascending !== false }; return b }, limit() { return b },
    insert(row) { st.op = 'insert'; st.row = row; return b }, upsert(row) { st.op = 'upsert'; st.row = row; return b }, update(p) { st.op = 'update'; st.patch = p; return b },
    single() { st.single = true; return Promise.resolve(run()) }, maybeSingle() { st.single = true; return Promise.resolve(run()) }, then(ok, ko) { return Promise.resolve(run()).then(ok, ko) } }
  return b
}
globalThis.__db = { from: q,
  rpc: async (fn, a) => {
    if (fn === 'client_care_end_role') { const rs = (T.person_role || []).filter((r) => r.person_id === a.p_person && r.role === 'client' && r.status === 'active'); rs.forEach((r) => Object.assign(r, { status: 'former', ended_at: a.p_date, end_reason: a.p_reason })); return { data: { outcome: 'ended', client_role_ended: rs.length > 0 }, error: null } }
    if (fn === 'client_care_return_role') { (T.person_role = T.person_role || []).push({ person_id: a.p_person, role: 'client', status: 'active', started_at: a.p_date }); return { data: { outcome: 'returned' }, error: null } }
    if (fn === 'client_status_decide') { const rv = (T.client_status_review || []).find((x) => x.review_id === a.p_review_id); if (!rv || rv.status !== 'open') return { data: { outcome: 'already_decided' }, error: null }
      if (a.p_decision === 'returning' && a.p_seat !== 'owner_decision') return { data: { outcome: 'seat_required' }, error: null }
      if (a.p_decision === 'care_ended') (T.person_role || []).filter((r) => r.person_id === rv.person_id && r.status === 'active').forEach((r) => Object.assign(r, { status: 'former', ended_at: a.p_date, end_reason: a.p_reason }))
      if (a.p_decision === 'returning') T.person_role.push({ person_id: rv.person_id, role: 'client', status: 'active', started_at: a.p_date })
      Object.assign(rv, { status: 'decided', decision: a.p_decision, decided_by: a.p_staff }); return { data: { outcome: 'decided' }, error: null } }
    if (fn === 'upsert_client_launch') { T.client_queue = T.client_queue || []; const o = T.client_queue.find((x) => x.axiscare_client_id === a.p.axiscare_client_id && x.status !== 'complete')
      if (o) return { data: { id: o.id, action: 'exists', episode_n: o.episode_n }, error: null }
      const n = T.client_queue.filter((x) => x.axiscare_client_id === a.p.axiscare_client_id).length + 1, row = { id: 100 + T.client_queue.length, ...a.p, status: 'open', episode_n: n }
      T.client_queue.push(row); return { data: { id: row.id, action: 'created', episode_n: n }, error: null } }
    if (fn === 'upsert_app_data_item') { const row = T.app_data.find((r) => r.key === a.target_key); const i = row.data.findIndex((x) => x.id === a.item.id); if (i >= 0) row.data[i] = clone(a.item); else row.data.push(clone(a.item)) } return { data: null, error: null } },
  storage: { from: () => ({ createSignedUploadUrl: async (p) => ({ data: { token: 't', signedUrl: 'https://up/' + p }, error: null }), createSignedUrl: async (p) => ({ data: { signedUrl: 'https://view/' + p }, error: null }),
    list: async (dir, o) => ({ data: [...FILES].filter((f) => f.startsWith(dir + '/')).map((f) => ({ name: f.slice(dir.length + 1) })).filter((x) => !o?.search || x.name === o.search), error: null }) }) },
  auth: { getUser: async (jwt) => ({ kr: 'u-kr', an: 'u-an', sam: 'u-sam', sal: 'u-sal' }[jwt] ? { data: { user: { id: { kr: 'u-kr', an: 'u-an', sam: 'u-sam', sal: 'u-sal' }[jwt], email: { kr: 'krystal@mo-care.com', an: 'angie@mo-care.com', sam: 'sam@mo-care.com', sal: 'sally@mo-care.com' }[jwt], app_metadata: {} } }, error: null } : { data: { user: null }, error: { message: 'bad' } }) } }
globalThis.fetch = async (url) => { url = String(url)
  const m = /\/api\/clients\/(\d+)/.exec(url); if (m) return new Response('{}', { status: AX.clients[m[1]] ? 200 : 404 })
  if (url.includes('/api/visits')) return new Response(JSON.stringify({ results: { visits: AX.visits } }), { status: 200 })
  return new Response('{}', { status: 404 }) }
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k', AXISCARE_API_KEY: 'a', AXISCARE_SITE: '16485', HUB_JOB_SECRET: 'j'.repeat(40) }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_cj_'))
try {
  fs.writeFileSync(path.join(tmp, 'job-auth.ts'), fs.readFileSync(path.join(F, '_shared/job-auth.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => ({ from: () => ({ select: () => ({ limit: async () => ({ error: { message: "no" } }) }) }) })')
    .replace("'./staff-auth.ts'", "'" + path.join(process.cwd(), F, '_shared', 'staff-auth.ts') + "'"))
  const src = fs.readFileSync(path.join(F, 'client-journey/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace("'../_shared/job-auth.ts'", "'" + path.join(tmp, 'job-auth.ts') + "'")
    .replace(/from '\.\.\/_shared\/([\w-]+)\.ts'/g, (_, m) => "from '" + path.join(process.cwd(), F, '_shared', m + '.ts') + "'")
    .replace("import '../_shared/journey-rules.js'", "import '" + path.join(process.cwd(), F, '_shared', 'journey-rules.js') + "'")
    .replace("import '../_shared/lead-rules.js'", "import '" + path.join(process.cwd(), F, '_shared', 'lead-rules.js') + "'")
  fs.copyFileSync(path.join(F, 'client-journey/care.ts'), path.join(tmp, 'care.ts'))
  fs.writeFileSync(path.join(tmp, 'cj.ts'), src); const MOD = await import(path.join(tmp, 'cj.ts')); globalThis.shiftFactsT = (v) => MOD.shiftFacts(v, 'a', 'b')
  const call = async (body, jwt = 'an', hdr = {}) => { const r = await handler(new Request('https://x/f', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: 'Bearer ' + jwt } : {}), ...hdr }, body: JSON.stringify(body) })); return { status: r.status, j: await r.json() } }
  const cards = () => T.app_data.find((r) => r.key === 'ops_items').data.filter((x) => x.kind === 'journey')
  const open = (who) => cards().filter((c) => c.status === 'open' && (!who || c.owner === who))
  const step = (jid, k) => T.client_journey_step.find((s) => s.journey_id === jid && s.step_key === k) || {}
  const ev = (jid, kind) => T.client_journey_event.filter((e) => e.journey_id === jid && (!kind || e.kind === kind))
  const upload = async (jid, key, name) => { const u = await call({ action: 'upload_url', journey_id: jid, step_key: key, name }); FILES.add(u.j.path); return u.j.path }

  const QUIET = await import(path.join(process.cwd(), F, '_shared', 'client-quiet.ts'))
  const GUARD = await import(path.join(process.cwd(), F, '_shared', 'audience-guard.ts'))
  const items = () => T.app_data.find((r) => r.key === 'ops_items').data
  const item = (id) => items().find((x) => x.id === id)
  const job = { 'x-cron-secret': ENV.HUB_JOB_SECRET }
  const setup = () => { reset(); Object.assign(T, {
      person_source_id: [{ person_id: 'p-ed', system: 'axiscare', entity_type: 'client', source_id: '296' }, { person_id: 'p-old', system: 'axiscare', entity_type: 'client', source_id: '410' }, { person_id: 'p-gone', system: 'axiscare', entity_type: 'client', source_id: '411' }],
      person_role: [{ person_id: 'p-ed', role: 'client', status: 'active' }, { person_id: 'p-old', role: 'client', status: 'former', ended_at: '2025-03-01', end_reason: 'Moved out of our service area' }, { person_id: 'p-gone', role: 'client', status: 'former', ended_at: '2026-01-02', end_reason: 'deceased' }],
      person_identity: [{ id: 'p-ed', display_name: 'Edward Anderson' }, { id: 'p-old', display_name: 'Olive Past' }, { id: 'p-gone', display_name: 'Gil Gone' }],
      client_pause: [], client_care_change: [], client_queue: [], client_status_review: [] })
    T.app_data.push({ key: 'client_checkins', data: [{ id: 'ci1', client_name: 'Edward Anderson', axiscare_client_id: '296', next_checkin_due: '2026-10-01', checkin_date: '2026-09-01' }] })
    items().push({ id: 'ops_ci_ci1_2026-10-01', kind: 'client_issue', status: 'open', title: 'Client check-in due — Edward Anderson', about: 'Edward Anderson', source: { type: 'client_checkins', id: 'ci1' } },
      { id: 'ops_concern_1', kind: 'client_issue', status: 'open', title: 'Family asked about Tuesday', axiscare_client_id: '296' }) }

  // a current client with a journey under way (Krystal is his Care Coordinator)
  setup(); let r = await call({ action: 'adopt', people: [{ axiscare_client_id: '296', client_name: 'Edward Anderson', payer: 'medicaid' }] }, null, job)
  const JE = T.client_journey[0]; JE.assigned_cc = 'krystal@mo-care.com'
  r = await call({ action: 'sweep' }, null, job)
  const jcards = () => items().filter((x) => x.kind === 'journey' && x.status === 'open' && x.journey_id === JE.journey_id)
  ck('(setup) Edward has his journey cards on My Work and an open check-in reminder', jcards().length >= 1 && item('ops_ci_ci1_2026-10-01').status === 'open', items())

  // 1 · PAUSE
  r = await call({ action: 'care_pause', axiscare_client_id: '296', reason: 'hospital', effective_date: R_add(0), followup_date: R_add(5) }, 'sal')
  ck('only a Care Coordinator or owner can pause care (Staffing is refused)', r.status === 403 && !T.client_pause.length, r.j)
  r = await call({ action: 'care_pause', axiscare_client_id: '296', reason: 'hospital', effective_date: R_add(0) }, 'an')
  ck('a pause needs a follow-up date', r.j.outcome === 'refused' && /follow-up date/.test(r.j.error) && !T.client_pause.length, r.j)
  r = await call({ action: 'care_pause', axiscare_client_id: '296', reason: 'hospital', effective_date: R_add(0), followup_date: R_add(5), notified_by: 'his daughter' }, 'an')
  const P = T.client_pause[0], RC = 'ops_pause_' + P.pause_id.replace(/-/g, '').slice(0, 12)
  ck('1 · Pause: one open pause, recorded with who, when, effective date, reason and who told us', r.j.outcome === 'paused' && P.status === 'open' && T.client_care_change[0].kind === 'pause' && T.client_care_change[0].made_by === 'angie@mo-care.com' && T.client_care_change[0].notified_by === 'his daughter' && T.client_care_change[0].effective_date === R_add(0) && T.client_care_change[0].made_at, T.client_care_change)
  ck('1 · ...the restart card goes to HIS Care Coordinator (Krystal, not the person who paused), waiting until the follow-up date', item(RC) && item(RC).owner === 'krystal@mo-care.com' && item(RC).status === 'open' && item(RC).sub_state === 'waiting' && item(RC).check_back === R_add(5) && /Is care restarting for Edward Anderson/.test(item(RC).title), item(RC))
  ck('1 · ...his journey cards are put away at once', jcards().length === 0, jcards())
  ck('1 · ...his normal check-in work steps aside (kept, marked "care paused")', item('ops_ci_ci1_2026-10-01').status === 'done' && item('ops_ci_ci1_2026-10-01').paused_for === P.pause_id, item('ops_ci_ci1_2026-10-01'))
  await QUIET.loadQuiet(globalThis.__db)
  ck('1 · ...every shift job now skips his visits (missed clock-ins, running late, coverage, missed notes, Care Match)', QUIET.isQuiet({ client: { id: 296 } }) && !QUIET.isQuiet({ client: { id: 999 } }))
  T.app_data.find((x) => x.key === 'leads').data.push({ id: 'Lz', email: 'edfamily@x.com', status: 'Converted', axiscare_client_id: '296' })
  const g1 = await GUARD.loadGuard(globalThis.__db)
  ck('1 · ...and routine outreach: campaigns treat him as Paused (his family left out of every campaign)', g1.stateOf('edfamily@x.com') === 'paused' && !GUARD.verdict(g1.stateOf('edfamily@x.com'), 'client').ok, g1.stateOf('edfamily@x.com'))
  ck('1 · ...a Hospital pause on Medicaid gives the human checklist from the regulation (never automatic)', T.client_care_change[0].checklist.map((x) => x.key).join() === 'missed_visits,rn_report' && T.client_care_change[0].checklist.every((x) => x.source === 'regulation' && x.state === 'open'), T.client_care_change[0].checklist)
  r = await call({ action: 'care_pause', axiscare_client_id: '296', reason: 'hospital', effective_date: R_add(0), followup_date: R_add(5) }, 'an')
  ck('1 · ...pausing twice is refused (pause longer instead)', r.j.outcome === 'refused' && T.client_pause.length === 1)
  T.client_pause[0].followup_date = R_add(0); r = await call({ action: 'sweep' }, null, job)
  ck('1 · on the follow-up date the card comes onto today\'s list ("Follow up today")', r.j.pause_due === 1 && item(RC).sub_state === null && /^Follow up today/.test(item(RC).title) && item(RC).urgency === 'high', [r.j, item(RC)])
  ck('1 · ...and the sweep still keeps his journey cards away while paused', jcards().length === 0)

  // 2 · RESUME
  const before = T.client_journey.length
  r = await call({ action: 'care_resume', axiscare_client_id: '296' }, 'kr')
  ck('2 · Resume: the pause closes, the restart card closes', r.j.outcome === 'resumed' && T.client_pause[0].status === 'closed' && T.client_pause[0].closed_kind === 'resumed' && item(RC).status === 'done', [r.j, T.client_pause[0]])
  ck('2 · ...his journey cards come back on the SAME journey (no second client, no second journey)', jcards().length >= 1 && T.client_journey.length === before && T.client_journey.every((j) => j.journey_id === JE.journey_id), [T.client_journey.length, jcards()])
  ck('2 · ...his check-in work comes back exactly as it was', item('ops_ci_ci1_2026-10-01').status === 'open' && !item('ops_ci_ci1_2026-10-01').paused_for, item('ops_ci_ci1_2026-10-01'))
  await QUIET.loadQuiet(globalThis.__db); ck('2 · ...the shift jobs see him again', !QUIET.isQuiet({ client: { id: 296 } }))

  // 3 · END
  r = await call({ action: 'care_end', axiscare_client_id: '296', reason: 'other', effective_date: R_add(0) }, 'an')
  ck('3 · End needs an explanation for Other', r.j.outcome === 'refused' && /Explain/.test(r.j.error) && T.client_journey[0].status !== 'closed', r.j)
  r = await call({ action: 'care_end', axiscare_client_id: '296', reason: 'facility', effective_date: R_add(1) }, 'an')
  ck('3 · ...and a date that is not in the future', r.j.outcome === 'refused' && /effective date/.test(r.j.error))
  const evBefore = T.client_journey_event.length, stepsBefore = T.client_journey_step.length
  r = await call({ action: 'care_end', axiscare_client_id: '296', reason: 'facility', effective_date: R_add(0), notified_by: 'Mercy social worker', explanation: 'Moved to Maranatha Village' }, 'an')
  const EC = T.client_care_change.find((c) => c.kind === 'end')
  ck('3 · End: his journey closes with the reason ("Care ended (Admitted to a facility) on …")', r.j.outcome === 'ended' && T.client_journey[0].status === 'closed' && /^Care ended \(Admitted to a facility\) on /.test(T.client_journey[0].closed_reason), [r.j, T.client_journey[0]])
  ck('3 · ...his open work closes with a note: journey cards, the check-in reminder, the family\'s request', jcards().length === 0 && item('ops_ci_ci1_2026-10-01').status === 'done' && item('ops_concern_1').status === 'done' && /Care ended/.test(item('ops_concern_1').close_note), [item('ops_ci_ci1_2026-10-01'), item('ops_concern_1')])
  ck('3 · ...NOTHING is deleted: every step and every history line is still there, plus the closing', T.client_journey_step.length === stepsBefore && T.client_journey_event.length > evBefore && T.client_journey_event.some((e) => e.kind === 'care_paused') && T.client_journey_event.some((e) => e.kind === 'closed'))
  ck('3 · ...his client role becomes past with the date and reason; the change records who, when, who told us and the explanation', T.person_role.find((x) => x.person_id === 'p-ed').status === 'former' && EC.made_by === 'angie@mo-care.com' && EC.notified_by === 'Mercy social worker' && EC.explanation === 'Moved to Maranatha Village' && EC.effective_date === R_add(0))
  ck('3 · ...Medicaid: "Tell DSDS in writing" right away (facility), a human checklist with the rule cited', EC.checklist[0].key === 'dsds_written' && /\(16\)\(B\)/.test(EC.checklist[0].rule) && EC.checklist.every((x) => x.state === 'open'), EC.checklist)
  r = await call({ action: 'care_checklist', change_id: EC.change_id, item: 'dsds_written', state: 'done' }, 'an')
  ck('...ticking a checklist step needs how it was done or proof', r.j.outcome === 'refused')
  r = await call({ action: 'care_checklist', change_id: EC.change_id, item: 'dsds_written', state: 'done', how: 'PCCP Request Form', on: R_add(0) }, 'an')
  ck('...ticked: who, when, how, kept on the change', T.client_care_change.find((c) => c.kind === 'end').checklist[0].state === 'done' && T.client_care_change.find((c) => c.kind === 'end').checklist[0].by === 'angie@mo-care.com')
  r = await call({ action: 'care_state', axiscare_client_id: '296' }, 'an')
  ck('...his state reads Past, with every change in order (pause, resume, end) and his journey kept', r.j.state === 'past' && r.j.changes.map((c) => c.kind).join() === 'pause,resume,end' && r.j.episodes.length === 1 && r.j.episodes[0].status === 'closed', r.j)
  r = await call({ action: 'sweep' }, null, job)
  ck('...the next sweep changes nothing about him (no new cards, no reopened journey)', T.client_journey[0].status === 'closed' && jcards().length === 0)

  // 7 · RETURN (a person approves; the same person, a new episode)
  r = await call({ action: 'care_return', axiscare_client_id: '296' }, 'an')
  ck('7 · Return: a Care Coordinator can\'t start a new episode (an owner decides)', r.status === 403 && T.client_journey.length === 1, r.j)
  r = await call({ action: 'care_return', axiscare_client_id: '296', explanation: 'Back home from Maranatha, family called' }, 'sam')
  const J2 = T.client_journey.find((j) => j.journey_id !== JE.journey_id)
  ck('7 · ...an owner confirms: a NEW journey (episode 2) on the same person, linked to the old one; the old one is untouched', r.j.outcome === 'returned' && J2 && J2.episode_n === 2 && J2.previous_journey_id === JE.journey_id && J2.axiscare_client_id === '296' && T.client_journey.find((j) => j.journey_id === JE.journey_id).status === 'closed', [r.j, T.client_journey])
  ck('7 · ...his client role is active again; the past role is kept', T.person_role.filter((x) => x.person_id === 'p-ed').map((x) => x.status).sort().join() === 'active,former')
  r = await call({ action: 'care_state', axiscare_client_id: '296' }, 'an')
  ck('7 · ...his history shows both episodes', r.j.episodes.length === 2 && r.j.episodes[0].status === 'closed' && r.j.episodes[1].episode_n === 2, r.j.episodes)

  // 5 · DECEASED
  setup(); await call({ action: 'adopt', people: [{ axiscare_client_id: '296', client_name: 'Edward Anderson', payer: 'private' }] }, null, job)
  T.client_journey[0].assigned_cc = 'krystal@mo-care.com'; await call({ action: 'sweep' }, null, job)
  r = await call({ action: 'care_end', axiscare_client_id: '296', reason: 'deceased', effective_date: R_add(0), notified_by: 'his son' }, 'kr')
  const SYM = item('ops_sym_296')
  ck('5 · Deceased: care ends, ONE sympathy-card task for his Care Coordinator, a person sends it (the Hub sends nothing)', r.j.outcome === 'ended' && SYM && SYM.kind === 'sympathy' && SYM.owner === 'krystal@mo-care.com' && /the Hub sends nothing/.test(SYM.detail), SYM)
  ck('5 · ...every other card for him is closed; the sympathy task is the only open one', items().filter((x) => x.status === 'open' && (x.axiscare_client_id === '296' || x.journey_id === T.client_journey[0].journey_id || String(x.id).startsWith('ops_ci_'))).map((x) => x.id).join() === 'ops_sym_296', items().filter((x) => x.status === 'open'))
  r = await call({ action: 'care_end', axiscare_client_id: '296', reason: 'deceased', effective_date: R_add(0) }, 'kr')
  ck('5 · ...it can\'t happen twice', r.j.outcome === 'refused' && items().filter((x) => x.id === 'ops_sym_296').length === 1)
  r = await call({ action: 'care_return', axiscare_client_id: '296' }, 'sam')
  ck('5 · ...no new episode can start for him, not even by an owner', r.j.outcome === 'refused' && /died/.test(r.j.error))
  await QUIET.loadQuiet(globalThis.__db); ck('5 · ...every shift job skips him', QUIET.isQuiet({ client: { id: 296 } }))
  T.app_data.find((x) => x.key === 'leads').data.push({ id: 'Lx', email: 'son@x.com', status: 'Converted', axiscare_client_id: '296' })
  const g5 = await GUARD.loadGuard(globalThis.__db)
  ck('5 · ...and no campaign can reach his family (any audience)', ['client', 'client-contact', 'lead', ''].every((tag) => !GUARD.verdict(g5.stateOf('son@x.com'), tag).ok))

  // 6 · CAMPAIGNS for a PAUSED client
  setup(); await call({ action: 'adopt', people: [{ axiscare_client_id: '296', client_name: 'Edward Anderson', payer: 'private' }] }, null, job)
  T.app_data.find((x) => x.key === 'leads').data.push({ id: 'Ly', email: 'daughter@x.com', status: 'Converted', axiscare_client_id: '296' })
  let gx = await GUARD.loadGuard(globalThis.__db)
  const before6 = GUARD.verdict(gx.stateOf('daughter@x.com'), 'client').ok
  await call({ action: 'care_pause', axiscare_client_id: '296', reason: 'family_away', effective_date: R_add(0), followup_date: R_add(7) }, 'an')
  gx = await GUARD.loadGuard(globalThis.__db)
  ck('6 · Paused: his family drops out of client, family, lead and pasted campaigns the moment care is paused', before6 && ['client', 'client-contact', 'lead', ''].every((tag) => !GUARD.verdict(gx.stateOf('daughter@x.com'), tag).ok), gx.stateOf('daughter@x.com'))
  await call({ action: 'care_resume', axiscare_client_id: '296' }, 'an'); gx = await GUARD.loadGuard(globalThis.__db)
  ck('6 · ...and comes back on resume', GUARD.verdict(gx.stateOf('daughter@x.com'), 'client').ok)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
