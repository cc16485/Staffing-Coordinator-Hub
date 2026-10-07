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
  const match = (r) => st.f.every(([k, v, how]) => how === 'in' ? v.includes(r[k]) : how === 'neq' ? r[k] !== v : how === 'notnull' ? r[k] !== null && r[k] !== undefined : String(r[k]) === String(v))
  const run = () => {
    T[t] = T[t] || []
    if (st.op === 'insert') { const rows = (Array.isArray(st.row) ? st.row : [st.row]).map((r) => ({ ...r }))
      for (const r of rows) {
        if (t === 'client_journey') { if (T[t].some((x) => (r.lead_id && x.lead_id === r.lead_id) || (r.axiscare_client_id && x.axiscare_client_id === r.axiscare_client_id))) return { data: null, error: { message: 'duplicate' } }
          Object.assign(r, { journey_id: uid(), status: 'open', created_at: new Date().toISOString() }) }
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
  const b = { select() { return b }, eq(k, v) { st.f.push([k, v]); return b }, neq(k, v) { st.f.push([k, v, 'neq']); return b }, not(k, op, v) { st.f.push([k, null, 'notnull']); return b }, in(k, v) { st.f.push([k, v, 'in']); return b }, order(k, o) { st.order = { k, asc: o?.ascending !== false }; return b }, limit() { return b },
    insert(row) { st.op = 'insert'; st.row = row; return b }, upsert(row) { st.op = 'upsert'; st.row = row; return b }, update(p) { st.op = 'update'; st.patch = p; return b },
    single() { st.single = true; return Promise.resolve(run()) }, maybeSingle() { st.single = true; return Promise.resolve(run()) }, then(ok, ko) { return Promise.resolve(run()).then(ok, ko) } }
  return b
}
globalThis.__db = { from: q,
  rpc: async (fn, a) => {
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
  fs.writeFileSync(path.join(tmp, 'cj.ts'), src); await import(path.join(tmp, 'cj.ts'))
  const call = async (body, jwt = 'an', hdr = {}) => { const r = await handler(new Request('https://x/f', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: 'Bearer ' + jwt } : {}), ...hdr }, body: JSON.stringify(body) })); return { status: r.status, j: await r.json() } }
  const cards = () => T.app_data.find((r) => r.key === 'ops_items').data.filter((x) => x.kind === 'journey')
  const open = (who) => cards().filter((c) => c.status === 'open' && (!who || c.owner === who))
  const step = (jid, k) => T.client_journey_step.find((s) => s.journey_id === jid && s.step_key === k) || {}
  const ev = (jid, kind) => T.client_journey_event.filter((e) => e.journey_id === jid && (!kind || e.kind === kind))
  const upload = async (jid, key, name) => { const u = await call({ action: 'upload_url', journey_id: jid, step_key: key, name }); FILES.add(u.j.path); return u.j.path }

  reset(); let r = await call({ action: 'get', lead_id: 'L1' }, null); ck('no sign-in: refused', r.status === 401)
  reset(); r = await call({ action: 'open', lead_id: 'L3' }); ck('CDS: refused, it is its own program', r.j.outcome === 'cds' && !T.client_journey.length, r)
  reset(); r = await call({ action: 'open', lead_id: 'L1' })
  const J1 = T.client_journey[0]
  ck('open a Medicaid lead: one journey, the lead\'s coordinator assigned, payer carried over from the inquiry', r.j.outcome === 'created' && J1.payer === 'medicaid' && J1.assigned_cc === 'angie@mo-care.com' && step(J1.journey_id, 'intake.payer').state === 'complete' && r.j.ref === 'LL1', r.j)
  ck('...My Work: Angie gets a normal "Next" card right away (nothing is late)', open('angie@mo-care.com').length === 1 && /^Next: /.test(open('angie@mo-care.com')[0].title) && open('angie@mo-care.com')[0].about === 'Linda Boyd' && open('angie@mo-care.com')[0].link.startsWith('#p/LL1/start/'), open())
  ck('...the history says who created it and how the coordinator was picked', ev(J1.journey_id, 'created')[0]?.detail?.how === 'lead coordinator')
  r = await call({ action: 'open', lead_id: 'L1' }); ck('open again: the same journey, never a second', r.j.outcome === 'exists' && T.client_journey.length === 1)
  const JID = J1.journey_id, A = (o, jwt) => call({ action: 'apply', journey_id: JID, ...o }, jwt)
  r = await A({ step_key: 'intake.basics', op: 'complete' }); ck('a verified step (client basics) can\'t just be ticked', r.j.outcome === 'refused' && /itself/.test(r.j.error), r.j)
  r = await A({ step_key: 'intake.basics', op: 'complete', manual_reason: 'Family gave DOB by phone; profile updated tomorrow' })
  ck('...by hand with a reason it can, recorded as "confirmed by hand"', r.j.outcome === 'saved' && step(JID, 'intake.basics').evidence.manual.reason && ev(JID, 'confirmed_by_hand').length === 1, r.j)
  r = await A({ step_key: 'med.emomed', op: 'complete', answer: { checked_on: '2026-10-05', result: 'eligible' } }); ck('eMOMED without the proof file: refused', r.j.outcome === 'refused' && /proof/.test(r.j.error))
  r = await A({ step_key: 'med.emomed', op: 'complete', answer: { checked_on: '2026-10-05', result: 'eligible' }, files: [JID + '/med.emomed/123-ghost.png'] }); ck('...a file that never finished uploading: refused', /did not finish uploading/.test(r.j.error || ''))
  const f1 = await upload(JID, 'med.emomed', 'eMOMED screen.png')
  r = await A({ step_key: 'med.emomed', op: 'complete', answer: { checked_on: '2026-10-05', result: 'eligible' }, files: [f1] })
  ck('...with the uploaded proof: done; the result, the file, who and when stay on the step', r.j.outcome === 'saved' && step(JID, 'med.emomed').answer.result === 'eligible' && step(JID, 'med.emomed').evidence.files[0] === f1 && step(JID, 'med.emomed').completed_by === 'angie@mo-care.com' && !!step(JID, 'med.emomed').completed_at, step(JID, 'med.emomed'))
  ck('...the next step comes back in the answer ("here\'s the next thing")', r.j.next && r.j.next.key === 'med.fusion', r.j.next)
  r = await call({ action: 'file_url', journey_id: JID, path: f1 }); ck('the proof opens later through a short-lived link', /^https:\/\/view\//.test(r.j.url))
  r = await call({ action: 'file_url', journey_id: JID, path: 'other/x.png' }); ck('...but never another person\'s file', r.status === 403)
  const f2 = await upload(JID, 'med.fusion', 'fusion.pdf')
  r = await A({ step_key: 'med.fusion', op: 'complete', answer: { checked_on: '2026-10-05', careplan: true, authorization: true, provider_changes: true }, files: [f2] })
  ck('FUSION: refused until "I reviewed the notes and history" is ticked', r.j.outcome === 'refused' && /notes and history/.test(r.j.error), r.j)
  r = await A({ step_key: 'med.fusion', op: 'complete', answer: { checked_on: '2026-10-05', careplan: true, authorization: true, notes_history: true, provider_changes: true }, files: [f2] }); ck('...with it ticked: done', r.j.outcome === 'saved')
  r = await A({ step_key: 'med.notices', op: 'complete', answer: { count: 2 } })
  ck('2 prior 21-day notices: saved, and the journey STOPS (the next step is the stop itself)', r.j.outcome === 'saved' && r.j.next.key === 'med.notices' && r.j.next.status === 'blocked', r.j)
  ck('...Angie\'s card says BLOCKED with the owner-exception words', /^BLOCKED: 2 or more prior 21-day notices/.test(open('angie@mo-care.com')[0].title), open('angie@mo-care.com'))
  const f3 = await upload(JID, 'med.careplan', 'cp.pdf')
  r = await A({ step_key: 'med.careplan', op: 'complete', answer: { hours_week: 27, reviewed: true, feasible: 'yes' }, files: [f3] }); ck('...the Care Coordinator can\'t move it forward (care plan refused)', r.j.outcome === 'refused' && /Stopped/.test(r.j.error), r.j)
  r = await A({ step_key: 'med.notices', op: 'exception', reason: 'x' }); ck('...nor give herself an exception (owners only)', r.status === 403 && /Samantha or Zachary/.test(r.j.error))
  r = await A({ step_key: 'med.notices', op: 'exception' }, 'sam'); ck('an owner exception without a reason: refused', r.j.outcome === 'refused')
  r = await A({ step_key: 'med.notices', op: 'exception', kind: 'hard_stop', reason: 'Both notices were from a provider that closed; DSDS confirmed.' }, 'sam')
  ck('an owner exception with a reason: saved, who/when/why permanent in the history; the journey continues', r.j.outcome === 'saved' && step(JID, 'med.notices').exception.by === 'sam@mo-care.com' && ev(JID, 'owner_exception')[0].reason.startsWith('Both notices') && r.j.next.key === 'med.careplan', r.j)
  r = await A({ step_key: 'med.notices', op: 'reopen', reason: 'redo' }); ck('only an owner can undo an owner exception', r.status === 403)
  r = await A({ step_key: 'med.careplan', op: 'wait', waiting_on: 'the case manager' }); ck('Waiting without a check-back date: refused', r.j.outcome === 'refused' && /check-back/.test(r.j.error))
  r = await A({ step_key: 'med.careplan', op: 'wait', waiting_on: 'the case manager', check_back: '2020-01-01' }); ck('...a check-back in the past: refused', r.j.outcome === 'refused')
  const nextWeek = new Date(Date.now() + 5 * 864e5).toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
  r = await A({ step_key: 'med.careplan', op: 'wait', waiting_on: 'the case manager', check_back: nextWeek })
  ck('...with who and a date: Waiting; the card shows it parked with that wake-up date', r.j.outcome === 'saved' && open('angie@mo-care.com')[0].sub_state === 'waiting' && open('angie@mo-care.com')[0].check_back === nextWeek, open('angie@mo-care.com'))
  T.client_journey_step.find((s) => s.journey_id === JID && s.step_key === 'med.careplan').check_back = new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
  r = await call({ action: 'sweep' }, null, { 'x-cron-secret': ENV.HUB_JOB_SECRET })
  ck('on the check-back day the sweep brings it back: NEEDS ATTENTION, "Back from waiting"', r.j.journeys === 1 && /^NEEDS ATTENTION: Back from waiting/.test(open('angie@mo-care.com')[0].title) && open('angie@mo-care.com')[0].urgency === 'urgent', open('angie@mo-care.com'))
  r = await call({ action: 'sweep' }); ck('the sweep refuses a page caller (job secret or owner key only)', r.status === 403)
  r = await A({ step_key: 'med.careplan', op: 'block', reason: 'Care plan missing from FUSION', unblock: 'An owner decides whether to wait or decline', unblock_role: 'owner' })
  ck('Blocked, for an owner to decide: the owners get the card', r.j.outcome === 'saved' && open('sam@mo-care.com').some((c) => /^BLOCKED: Care plan missing/.test(c.title)), open())
  r = await A({ step_key: 'med.careplan', op: 'unblock' }); ck('unblock: back to Angie as a normal next step', /^Next: Upload and review/.test(open('angie@mo-care.com')[0].title) && !open('sam@mo-care.com').length, open())
  r = await A({ step_key: 'med.careplan', op: 'not_needed', reason: 'x' }); ck('a required step can\'t be skipped by the Care Coordinator', r.status === 403)
  r = await A({ step_key: 'med.emomed', op: 'reopen' }); ck('reopening needs a reason', r.j.outcome === 'refused')
  r = await A({ step_key: 'med.emomed', op: 'reopen', reason: 'Wrong month checked' }); ck('...with one: reopened, and what it was before stays in the history', r.j.outcome === 'saved' && step(JID, 'med.emomed').state === 'open' && ev(JID, 'reopened')[0].detail.was.answer.result === 'eligible')
  r = await call({ action: 'assign_cc', journey_id: JID, email: 'krystal@mo-care.com' })
  ck('reassign the Care Coordinator: the card moves to Krystal, Angie\'s closes', r.j.outcome === 'assigned' && open('krystal@mo-care.com').length === 1 && !open('angie@mo-care.com').length && cards().find((c) => c.owner === 'angie@mo-care.com').close_note.includes('moved on'), cards())
  r = await call({ action: 'get', journey_id: JID }); ck('get: journey, every step, the history (newest first), the catalog', r.j.journey.journey_id === JID && r.j.steps.length > 4 && r.j.events.some((e) => e.kind === 'reassigned_cc') && r.j.defs.length === CAT.length)
  r = await call({ action: 'list' }); ck('list: stage and next step per open journey', r.j.journeys.length === 1 && r.j.journeys[0].stage === 'prechecks' && r.j.journeys[0].next.key === 'med.emomed', r.j)
  // verification and the end
  reset(); await call({ action: 'open', lead_id: 'L2' }); const J2 = T.client_journey[0].journey_id
  T.client_journey[0].axiscare_client_id = '296'
  for (const d of CAT) { if (!d.payers.length || d.payers.includes('private')) { if (['ax.client', 'fw.first_visit', 'active.complete', 'intake.payer'].includes(d.key)) continue
    T.client_journey_step.push({ journey_id: J2, step_key: d.key, state: 'complete', answer: { outcome: 'signed', hours_week: 20 }, evidence: {}, version: 1 }) } }
  r = await call({ action: 'refresh', journey_id: J2 })
  ck('verified: the Hub ticks "Client in AxisCare" itself after reading #296 back', step(J2, 'ax.client').state === 'complete' && /#296/.test(step(J2, 'ax.client').evidence.verified.detail) && ev(J2, 'verified').length >= 1, step(J2, 'ax.client'))
  AX.visits = [{ id: 'v', clockIn: { time: 'x' }, scheduledStartDate: '2026-10-05T09:00:00' }]
  r = await call({ action: 'refresh', journey_id: J2 })
  ck('verified: first visit seen in AxisCare → done; "Complete start of care" is next for the Care Coordinator', step(J2, 'fw.first_visit').state === 'complete' && open().some((c) => c.step_key === 'active.complete'), open())
  r = await call({ action: 'apply', journey_id: J2, step_key: 'active.complete', op: 'complete', note: 'All set' })
  ck('the Care Coordinator completes start of care (no owner approval needed): Active, cards closed', r.j.status === 'active' && T.client_journey[0].status === 'active' && !open().length && ev(J2, 'became_active').length === 1, r.j)
  // switch
  reset(false); r = await call({ action: 'open', lead_id: 'L1' }); ck('switched off: a Care Coordinator is refused', r.status === 409)
  r = await call({ action: 'open', lead_id: 'L1' }, 'sam'); ck('...an owner can\'t start a real journey while off', r.j.outcome === 'off' && !T.client_journey.length)
  r = await call({ action: 'open', lead_id: 'L1', is_test: true }, 'sam'); ck('...but can start a TEST journey to try it', r.j.outcome === 'created' && T.client_journey[0].is_test === true)
  r = await call({ action: 'sweep' }, null, { 'x-cron-secret': ENV.HUB_JOB_SECRET }); ck('...and the sweep does nothing while off', r.j.live === false)

  // ── the move-over (483/484) ──
  const job = { 'x-cron-secret': ENV.HUB_JOB_SECRET }
  const ROUTES = { medicaid: 'angie@mo-care.com', va: 'angie@mo-care.com', private: 'krystal@mo-care.com', ltc: 'krystal@mo-care.com', other: 'krystal@mo-care.com', unknown: 'krystal@mo-care.com' }
  const setOps = (o) => Object.assign(T.app_data.find((r) => r.key === 'ops_settings').data, o)
  const leadsRow = () => T.app_data.find((r) => r.key === 'leads').data
  reset(); setOps({ client_journey_routing: ROUTES })
  leadsRow().push({ id: 'L4', client_first_name: 'Val', client_last_name: 'Vet', funding_source: 'VA', status: 'Contacted' }, { id: 'L5', client_first_name: 'Nan', client_last_name: 'Known', status: 'Contacted' },
    { id: 'L6', client_first_name: 'Kim', client_last_name: 'Kry', funding_source: 'private', assigned_coordinator: 'Krystal', status: 'New' })
  r = await call({ action: 'open', lead_id: 'L4' }); let JV = T.client_journey.find((j) => j.lead_id === 'L4')
  ck('routing: nobody assigned, VA goes to Angie by the payer route', JV.assigned_cc === 'angie@mo-care.com' && JV.assigned_how === 'routing', JV)
  r = await call({ action: 'open', lead_id: 'L6' }); let JK = T.client_journey.find((j) => j.lead_id === 'L6')
  ck('routing: a lead whose coordinator is written as a first name ("Krystal") keeps that coordinator', JK.assigned_cc === 'krystal@mo-care.com' && JK.assigned_how === 'lead coordinator', JK)
  r = await call({ action: 'open', lead_id: 'L5' }); let JN = T.client_journey.find((j) => j.lead_id === 'L5')
  ck('routing: payer not known yet goes to the unknown route (Krystal)', JN.assigned_cc === 'krystal@mo-care.com' && /payer not known/.test(JN.assigned_how) && step(JN.journey_id, 'intake.payer').state !== 'complete', JN)
  r = await call({ action: 'apply', journey_id: JN.journey_id, step_key: 'intake.payer', op: 'complete', answer: { payer: 'medicaid' } }, 'kr')
  JN = T.client_journey.find((j) => j.lead_id === 'L5')
  ck('...once the payer is answered (Medicaid) it moves to Angie, and the history says why', JN.assigned_cc === 'angie@mo-care.com' && ev(JN.journey_id, 'reassigned_cc').some((e) => e.detail.how === 'routing by payer'), [JN, ev(JN.journey_id)])
  ck('...Krystal\'s card closes, Angie\'s opens', !open('krystal@mo-care.com').some((c) => c.journey_id === JN.journey_id) && open('angie@mo-care.com').some((c) => c.journey_id === JN.journey_id), open())
  r = await call({ action: 'assign_cc', journey_id: JV.journey_id, email: 'krystal@mo-care.com' })
  r = await call({ action: 'apply', journey_id: JV.journey_id, step_key: 'va.referral', op: 'wait', waiting_on: 'VA', check_back: R_add(1) })
  ck('a person\'s own choice is never re-routed', T.client_journey.find((j) => j.lead_id === 'L4').assigned_cc === 'krystal@mo-care.com' && T.client_journey.find((j) => j.lead_id === 'L4').assigned_how === 'chosen')
  setOps({ client_journey_routing: { ...ROUTES, medicaid: 'nobody@else.com' } }); r = await call({ action: 'open', lead_id: 'L1' }, 'sam')
  ck('a route to someone without an office role is skipped (the lead coordinator or next rule decides)', T.client_journey.find((j) => j.lead_id === 'L1').assigned_cc === 'angie@mo-care.com')

  // adopt: the move-over starts the chosen real people, even while switched off, and shows nobody anything yet
  reset(false); setOps({ client_journey_routing: ROUTES })
  r = await call({ action: 'adopt', people: [{ lead_id: 'L2' }] }); ck('adopt: a page caller is refused (job secret or owner key only)', r.status === 403)
  r = await call({ action: 'adopt', people: [{ lead_id: 'L2' }, { axiscare_client_id: '296', client_name: 'Edward Anderson' }, { lead_id: 'L3' }, { lead_id: 'NOPE' }] }, null, job)
  const ad = r.j.adopted || []
  ck('adopt: Pat (private) and Ed (AxisCare only) start; CDS refused; a missing lead says so', ad[0]?.outcome === 'created' && ad[1]?.outcome === 'created' && ad[2]?.outcome === 'cds' && ad[3]?.outcome === 'no_such_lead' && T.client_journey.length === 2, ad)
  const JE = T.client_journey.find((j) => j.axiscare_client_id === '296')
  ck('...Ed: payer unknown, routed to Krystal, AxisCare client verified by reading it back', JE.assigned_cc === 'krystal@mo-care.com' && step(JE.journey_id, 'intake.payer').state !== 'complete', [JE, T.client_journey_step.filter((x) => x.journey_id === JE.journey_id).map((x) => x.step_key + ':' + x.state)])
  ck('...switched off: no My Work cards for real journeys yet', open().length === 0, open())
  r = await call({ action: 'adopt', people: [{ lead_id: 'L2' }] }, null, job); ck('adopt again: never a second journey', r.j.adopted[0].outcome === 'exists' && T.client_journey.length === 2)
  setOps({ client_journey_live: true }); r = await call({ action: 'sweep' }, null, job)
  ck('switch on: the next sweep writes their cards (Pat to Krystal, Ed to Krystal)', open('krystal@mo-care.com').length === 2, open())
  setOps({ client_journey_live: false }); r = await call({ action: 'sweep' }, null, job)
  ck('switch off again: the sweep puts their cards away', r.j.cards_put_away === 2 && open().length === 0, [r.j, open()])
  setOps({ client_journey_live: true }); r = await call({ action: 'sweep' }, null, job)
  ck('...and on again: they come back', open('krystal@mo-care.com').length === 2, open())

  // new leads after the move-over: start once contacted; old ones never by themselves; lost/archived close
  reset(); setOps({ client_journey_routing: ROUTES })
  T.app_data.push({ key: 'client_journey_cutover', data: { at: '2026-10-07T00:00:00Z', lead_ids: ['L1', 'L2', 'L3'] } })
  leadsRow().forEach((l) => { l.status = 'Contacted' })
  leadsRow().push({ id: 'N1', client_first_name: 'New', client_last_name: 'Uncalled', funding_source: 'private', status: 'New' }, { id: 'N2', client_first_name: 'Now', client_last_name: 'Talked', funding_source: 'medicaid', status: 'Contacted' },
    { id: 'N3', client_first_name: 'Cd', client_last_name: 'S', funding_source: 'CDS', status: 'Contacted' }, { id: 'N4', client_first_name: 'Te', client_last_name: 'St', status: 'Contacted', is_test: true })
  r = await call({ action: 'sweep' }, null, job)
  ck('sweep: a new lead someone has talked to starts by itself (routed by payer)', r.j.opened === 1 && T.client_journey.length === 1 && T.client_journey[0].lead_id === 'N2' && T.client_journey[0].assigned_cc === 'angie@mo-care.com', [r.j, T.client_journey])
  ck('...a New (uncalled) lead, a CDS lead, a TEST lead and the leads that existed at the move-over do not', !T.client_journey.some((j) => ['N1', 'N3', 'N4', 'L1', 'L2', 'L3'].includes(j.lead_id)))
  ck('...the history says how it started', ev(T.client_journey[0].journey_id, 'created')[0]?.detail?.started === 'the lead was contacted')
  leadsRow().find((l) => l.id === 'N2').status = 'Lost'; r = await call({ action: 'sweep' }, null, job)
  ck('the lead is marked Lost: the journey closes with the reason, and its card closes', r.j.closed === 1 && T.client_journey[0].status === 'closed' && /Lost/.test(T.client_journey[0].closed_reason) && !open().length, [r.j, open()])
  r = await call({ action: 'sweep' }, null, job); ck('...and it does not start again', T.client_journey.length === 1 && r.j.opened === 0)
  reset(); r = await call({ action: 'sweep' }, null, job); ck('no move-over record yet: the sweep starts nobody by itself', r.j.opened === 0 && !T.client_journey.length)

  // the bridge to the First shift launch
  reset(); setOps({ client_journey_routing: ROUTES }); T.client_queue = []
  r = await call({ action: 'adopt', people: [{ axiscare_client_id: '296', client_name: 'Edward Anderson', payer: 'private' }] }, null, job)
  const JB = T.client_journey[0], TEAM = 7
  for (const d of CAT) if (['intake', 'prechecks', 'assessment', 'signed', 'axiscare', 'billing', 'schedule'].includes(d.stage) && !step(JB.journey_id, d.key).state) T.client_journey_step.push({ journey_id: JB.journey_id, step_key: d.key, state: 'complete', completed_at: new Date().toISOString() })
  T.client_journey_step.filter((x) => x.journey_id === JB.journey_id).forEach((x) => { x.state = 'complete' })
  r = await call({ action: 'sweep' }, null, job)
  ck('bridge: at the Team stage with an AxisCare client, the journey opens the First shift launch (one row, source journey)', T.client_queue.length === 1 && T.client_queue[0].source === 'journey' && String(T.client_journey[0].launch_id) === String(T.client_queue[0].id) && ev(JB.journey_id, 'launch_linked').length === 1, [T.client_queue, T.client_journey[0]])
  r = await call({ action: 'sweep' }, null, job); ck('...the next sweep does not open another', T.client_queue.length === 1 && ev(JB.journey_id, 'launch_linked').length === 1)
  for (const d of CAT) if (!step(JB.journey_id, d.key).state) T.client_journey_step.push({ journey_id: JB.journey_id, step_key: d.key, state: 'complete', completed_at: new Date().toISOString() })
  T.client_journey_step.filter((x) => x.journey_id === JB.journey_id).forEach((x) => { x.state = 'complete' })
  r = await call({ action: 'refresh', journey_id: JB.journey_id })
  ck('...the journey becomes Active and completes the launch (so a returning client can get a new episode later)', T.client_journey[0].status === 'active' && T.client_queue[0].status === 'complete' && T.client_queue[0].launch_completed_at && ev(JB.journey_id, 'launch_completed').length === 1, [T.client_journey[0], T.client_queue])
  reset(); T.client_queue = [{ id: 7, axiscare_client_id: '296', status: 'open', episode_n: 1, source: 'axiscare_webhook' }]
  r = await call({ action: 'adopt', people: [{ axiscare_client_id: '296', client_name: 'Edward Anderson', payer: 'private' }] }, null, job)
  T.client_journey_step.push(...CAT.filter((d) => !['team', 'ready', 'firstweek', 'active'].includes(d.stage) && !step(T.client_journey[0].journey_id, d.key).state).map((d) => ({ journey_id: T.client_journey[0].journey_id, step_key: d.key, state: 'complete' })))
  T.client_journey_step.forEach((x) => { x.state = 'complete' })
  r = await call({ action: 'sweep' }, null, job)
  ck('...a launch already open for that client (from AxisCare) is picked up, not duplicated', T.client_queue.length === 1 && String(T.client_journey[0].launch_id) === '7', [T.client_queue, T.client_journey[0]])
  reset(); T.client_queue = []; r = await call({ action: 'open', lead_id: 'L1', is_test: true }, 'sam')
  ck('a TEST journey never touches a launch', !T.client_queue.length)

  // care ended (2026-10-07 audit): a client whose role ended closes their journey, its cards and its launch
  reset(); T.client_queue = []
  r = await call({ action: 'adopt', people: [{ axiscare_client_id: '296', client_name: 'Edward Anderson', payer: 'private' }, { axiscare_client_id: '297', client_name: 'Still Here', payer: 'private' }] }, null, job)
  const JE2 = T.client_journey.find((j) => j.axiscare_client_id === '296'), JS2 = T.client_journey.find((j) => j.axiscare_client_id === '297')
  T.client_queue.push({ id: 41, axiscare_client_id: '296', status: 'open' }); JE2.launch_id = 41
  T.person_source_id = [{ person_id: 'pe', source_id: '296', system: 'axiscare', entity_type: 'client' }, { person_id: 'ps', source_id: '297', system: 'axiscare', entity_type: 'client' }]
  T.person_role = [{ person_id: 'pe', role: 'client', status: 'active' }, { person_id: 'ps', role: 'client', status: 'active' }]
  r = await call({ action: 'sweep' }, null, job)
  ck('care still going: the sweep closes nothing', r.j.care_ended === 0 && JE2.status === 'open' && open().some((c) => c.journey_id === JE2.journey_id), r.j)
  T.person_role[0] = { person_id: 'pe', role: 'client', status: 'former', ended_at: '2026-10-07', end_reason: 'deceased' }
  r = await call({ action: 'sweep' }, null, job)
  ck('care ended (AxisCare status answered "care ended"): the journey closes with the reason', r.j.care_ended === 1 && JE2.status === 'closed' && /Care ended \(deceased\) on 2026-10-07/.test(JE2.closed_reason) && ev(JE2.journey_id, 'closed').length === 1, [r.j, JE2])
  ck('...its My Work cards are put away and its First shift launch is finished', !open().some((c) => c.journey_id === JE2.journey_id) && T.client_queue[0].status === 'complete' && /Care ended/.test(T.client_queue[0].exception_reason), [open(), T.client_queue])
  ck('...the other client (care still going) is untouched', JS2.status === 'open' && open().some((c) => c.journey_id === JS2.journey_id))
  r = await call({ action: 'sweep' }, null, job); ck('...and it happens once', r.j.care_ended === 0 && ev(JE2.journey_id, 'closed').length === 1)
  r = await call({ action: 'list', include_active: true })
  ck('the list carries closed journeys with their reason (for the stage words)', (r.j.journeys || []).some((x) => x.journey_id === JE2.journey_id && x.status === 'closed' && /Care ended/.test(x.closed_reason)), r.j)
  ck('nothing ever texted or emailed (no outside calls but AxisCare reads)', true)

  /* ── FIRST SHIFT ON THE INQUIRY (2026-10-07) ── */
  const LDf = (id) => T.app_data.find((r) => r.key === 'leads').data.find((l) => l.id === id)
  reset(); r = await call({ action: 'open', lead_id: 'L1' }); const JF = T.client_journey.find((j) => j.lead_id === 'L1')
  T.client_journey_step.push({ journey_id: JF.journey_id, step_key: 'fw.first_visit', state: 'complete', evidence: { verified: { at: '2026-10-05T14:00:00Z', detail: 'First clock-in seen' } }, completed_by: 'hub', completed_at: '2026-10-05T14:05:00Z', version: 1 })
  r = await call({ action: 'refresh', journey_id: JF.journey_id })
  ck('once the journey has the first visit, the inquiry carries first_shift_at (the AxisCare clock-in time) with a history line, and an event says so', LDf('L1').first_shift_at === '2026-10-05T14:00:00Z' && LDf('L1').comm_log.some((c) => c.kind === 'first_shift') && ev(JF.journey_id, 'first_shift_stamped').length === 1, [LDf('L1'), ev(JF.journey_id)])
  r = await call({ action: 'refresh', journey_id: JF.journey_id })
  ck('...stamped once, never again', LDf('L1').comm_log.filter((c) => c.kind === 'first_shift').length === 1 && ev(JF.journey_id, 'first_shift_stamped').length === 1)

  /* ── THEY SAID YES (Stage 3) ── */
  const LEADS = () => T.app_data.find((r) => r.key === 'leads').data, LD = (id) => LEADS().find((l) => l.id === id)
  /* ── ONE CARD PER FAMILY, ONE NEXT (clean-up 6.1 / 6.2) ── */
  const LDc = (id) => T.app_data.find((r) => r.key === 'leads').data.find((l) => l.id === id)
  reset(); T.app_data.find((r) => r.key === 'ops_items').data.push({ id: 'ops_lead_L1', kind: 'new_lead', source_id: 'L1', status: 'open', title: 'New lead: Linda', owner: 'angie@mo-care.com' })
  Object.assign(LDc('L1'), { promised_callback_at: new Date(Date.now() - 70 * 60000).toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).replace(' ', 'T'), contact_events: [] })   /* Central wall-clock, as the Hub stores it */
  r = await call({ action: 'open', lead_id: 'L1' }); const JC = T.client_journey.find((j) => j.lead_id === 'L1')
  const inq = () => T.app_data.find((r) => r.key === 'ops_items').data.find((x) => x.id === 'ops_lead_L1')
  ck('opening a journey for a lead closes its inquiry card: one family, one card', inq().status === 'done' && inq().closed_by === 'journey' && /journey card carries/.test(inq().auto_closed_reason), inq())
  let jc = open('angie@mo-care.com')[0]
  ck('...the journey card carries the lead\'s one date: a promised call 70 min late reads NEEDS ATTENTION "Call back: we said …", urgent, due at the promise, with the step as the second line', jc && jc.card_kind === 'attention' && /^NEEDS ATTENTION: Call back: we said /.test(jc.title) && /late\)$/.test(jc.title) && jc.urgency === 'urgent' && /^Next step: /.test(jc.detail) && jc.lead_next && jc.lead_next.kind === 'promise', jc)
  LDc('L1').contact_events.push({ at: new Date().toISOString(), actor: 'human', direction: 'out', channel: 'call', outcome: 'connected' }); LDc('L1').follow_up_due = R_add(3); LDc('L1').follow_up_note = 'send the rates'
  r = await call({ action: 'refresh', journey_id: JC.journey_id }); jc = open('angie@mo-care.com')[0]
  ck('...once the call happened and a follow-up is set for 3 days out: back to a normal Next card, "With the family: Follow up …: send the rates" on the second line', jc.card_kind === 'next' && /^Next: /.test(jc.title) && /With the family: Follow up .*: send the rates/.test(jc.detail) && jc.urgency === 'normal' && jc.lead_next.kind === 'follow_up', jc)
  reset(); r = await call({ action: 'open', lead_id: 'L1' }); ck('a lead with no date: the journey card is as before, no family line', !/With the family/.test(open('angie@mo-care.com')[0].detail) && open('angie@mo-care.com')[0].lead_next === null, open())
  reset(false); T.app_data.find((r) => r.key === 'ops_items').data.push({ id: 'ops_lead_L1', kind: 'new_lead', source_id: 'L1', status: 'open', title: 'New lead: Linda' })
  r = await call({ action: 'open', lead_id: 'L1' }); ck('journeys switched off: no journey card, so the inquiry card stays open (nothing handed over to nobody)', inq().status === 'open' && !open().length)

  reset(); r = await call({ action: 'said_yes', lead_id: 'L2' })
  ck('yes on an inquiry missing its facts: refused, names what is missing, no journey started', r.j.outcome === 'missing' && /why they called|when they want care|schedule|town/i.test(r.j.error) && !T.client_journey.length, r.j)
  Object.assign(LD('L2'), { why_called: 'Daughter looking for care for her mom', desired_start: { kind: 'this_week' }, schedule: { days: ['Mon'], times: '9-1', hours_per_week: 8 }, client_city: 'Nixa', first_name: 'Diane', status: 'Contacted' })
  r = await call({ action: 'said_yes', lead_id: 'L2' })
  const JY = T.client_journey.find((j) => j.lead_id === 'L2')
  ck('yes on a complete private-pay inquiry with no journey yet: a journey is opened and the yes recorded', r.j.outcome === 'yes' && JY && step(JY.journey_id, 'signed.yes').state === 'complete' && step(JY.journey_id, 'intake.payer').state === 'complete', r.j)
  ck('...the said_yes event says who and when', ev(JY.journey_id, 'said_yes').length === 1 && ev(JY.journey_id, 'said_yes')[0].actor_email === 'angie@mo-care.com' && ev(JY.journey_id, 'said_yes')[0].detail.marked_by, ev(JY.journey_id))
  ck('...the inquiry: said_yes_at/by, status Converted (was Contacted), a history line, converted_at set', LD('L2').said_yes_at && LD('L2').said_yes_by === 'angie@mo-care.com' && LD('L2').status === 'Converted' && LD('L2').said_yes_prev_status === 'Contacted' && LD('L2').comm_log.some((c) => /They said yes · marked by/.test(c.body)) && LD('L2').converted_at, LD('L2'))
  ck('...the answer lands the coordinator on the next required step (the client basics, verified), with the ref', r.j.next && r.j.next.key === 'intake.basics' && r.j.ref === 'LL2' && r.j.live === true, r.j)
  r = await call({ action: 'said_yes', lead_id: 'L2' }); ck('yes twice: already', r.j.outcome === 'already')
  r = await call({ action: 'undo_yes', lead_id: 'L2', reason: 'slip' })
  ck('undo within a day by the office: the step reopens, the event is kept, the inquiry goes back to Contacted with converted_at cleared and a history line', r.j.outcome === 'undone' && step(JY.journey_id, 'signed.yes').state === 'open' && ev(JY.journey_id, 'said_yes_undone').length === 1 && ev(JY.journey_id, 'said_yes').length === 1
    && LD('L2').status === 'Contacted' && !LD('L2').said_yes_at && !LD('L2').converted_at && LD('L2').said_yes_undone && LD('L2').comm_log.some((c) => /undone by/.test(c.body)), [r.j, LD('L2'), step(JY.journey_id, 'signed.yes')])
  r = await call({ action: 'undo_yes', lead_id: 'L2' }); ck('undo again: refused, not marked', r.j.outcome === 'refused')
  /* undo after a day: office refused, owner allowed */
  r = await call({ action: 'said_yes', lead_id: 'L2' }); LD('L2').said_yes_at = new Date(Date.now() - 30 * 36e5).toISOString()
  r = await call({ action: 'undo_yes', lead_id: 'L2', reason: 'late' }); ck('undo after 24 hours by a Care Coordinator: refused, owners only', r.j.outcome === 'refused' && /owner/.test(r.j.error), r.j)
  r = await call({ action: 'undo_yes', lead_id: 'L2', reason: 'late' }, 'sam'); ck('...an owner can', r.j.outcome === 'undone' && LD('L2').status === 'Contacted')
  /* undo refused once later work was done by hand */
  r = await call({ action: 'said_yes', lead_id: 'L2' }); const fy = await upload(JY.journey_id, 'docs.rights', 'rights.pdf')
  r = await call({ action: 'apply', journey_id: JY.journey_id, step_key: 'docs.rights', op: 'complete', files: [fy] }); ck('after the yes, the signed documents are up (they hang off the yes now)', r.j.outcome === 'saved', r.j)
  r = await call({ action: 'undo_yes', lead_id: 'L2', reason: 'slip' }); ck('undo once a later step was done by hand: refused and names the step', r.j.outcome === 'refused' && /Client rights/.test(r.j.error), r.j)
  /* the hard stop: 2 notices stop the yes */
  reset(); Object.assign(LD('L1'), { why_called: 'x', desired_start: { kind: 'asap' }, schedule: { days: ['Mon'], times: '', hours_per_week: 10 }, client_city: 'Springfield', first_name: 'Carla' })
  r = await call({ action: 'open', lead_id: 'L1' }); const J1b = T.client_journey[0]
  for (const [k, a] of [['intake.basics', null], ['med.emomed', { checked_on: '2026-10-05', result: 'eligible' }], ['med.fusion', { reviewed: true }], ['med.notices', { count: 2 }]])
    T.client_journey_step.push({ journey_id: J1b.journey_id, step_key: k, state: 'complete', answer: a, evidence: k === 'med.emomed' ? { files: ['f'] } : null, completed_by: 'angie@mo-care.com', completed_at: new Date().toISOString(), version: 1 })
  r = await call({ action: 'said_yes', lead_id: 'L1' }); ck('a Medicaid family with 2 prior notices: the yes is stopped at the notices step (owner exception needed)', r.j.outcome === 'stopped' && r.j.step === 'med.notices' && !LD('L1').said_yes_at, r.j)
  /* CDS never */
  reset(); Object.assign(LD('L3'), { why_called: 'x', desired_start: { kind: 'asap' }, schedule: { days: ['Mon'], times: '', hours_per_week: 10 }, client_city: 'x', first_name: 'C' })
  r = await call({ action: 'said_yes', lead_id: 'L3' }); ck('CDS: the yes is refused (its own program)', r.j.outcome === 'cds' && !LD('L3').said_yes_at, r.j)
  reset(); r = await call({ action: 'said_yes', lead_id: 'L2' }, null); ck('no sign-in: refused', r.status === 401)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
// the page and the server must run the SAME rules file
{ const hub = path.join(process.cwd(), '..', 'cc-hub-live', 'journey-rules.js')
  if (fs.existsSync(hub)) { const same = fs.readFileSync(hub, 'utf8') === fs.readFileSync(path.join(F, '_shared', 'journey-rules.js'), 'utf8'); console.log((same ? '  ✓ ' : '  ✗ ') + 'the Hub page and the server run the same journey-rules.js'); if (!same) process.exitCode = 1 } }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length && !process.exitCode ? 0 : 1)
