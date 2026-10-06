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
const clone = (x) => JSON.parse(JSON.stringify(x))
function q(t) {
  const st = { f: [], ins: [], op: 'select', patch: null, row: null, single: false }
  const match = (r) => st.f.every(([k, v, how]) => how === 'in' ? v.includes(r[k]) : r[k] === v)
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
  const b = { select() { return b }, eq(k, v) { st.f.push([k, v]); return b }, in(k, v) { st.f.push([k, v, 'in']); return b }, order(k, o) { st.order = { k, asc: o?.ascending !== false }; return b }, limit() { return b },
    insert(row) { st.op = 'insert'; st.row = row; return b }, upsert(row) { st.op = 'upsert'; st.row = row; return b }, update(p) { st.op = 'update'; st.patch = p; return b },
    single() { st.single = true; return Promise.resolve(run()) }, maybeSingle() { st.single = true; return Promise.resolve(run()) }, then(ok, ko) { return Promise.resolve(run()).then(ok, ko) } }
  return b
}
globalThis.__db = { from: q,
  rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') { const row = T.app_data.find((r) => r.key === a.target_key); const i = row.data.findIndex((x) => x.id === a.item.id); if (i >= 0) row.data[i] = clone(a.item); else row.data.push(clone(a.item)) } return { data: null, error: null } },
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
  r = await call({ action: 'open', lead_id: 'L1', is_test: true }, 'sam'); ck('...an owner can still test (a TEST journey)', r.j.outcome === 'created' && T.client_journey[0].is_test === true)
  r = await call({ action: 'sweep' }, null, { 'x-cron-secret': ENV.HUB_JOB_SECRET }); ck('...and the sweep does nothing while off', r.j.live === false)
  ck('nothing ever texted or emailed (no outside calls but AxisCare reads)', true)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
// the page and the server must run the SAME rules file
{ const hub = path.join(process.cwd(), '..', 'cc-hub-live', 'journey-rules.js')
  if (fs.existsSync(hub)) { const same = fs.readFileSync(hub, 'utf8') === fs.readFileSync(path.join(F, '_shared', 'journey-rules.js'), 'utf8'); console.log((same ? '  ✓ ' : '  ✗ ') + 'the Hub page and the server run the same journey-rules.js'); if (!same) process.exitCode = 1 } }
