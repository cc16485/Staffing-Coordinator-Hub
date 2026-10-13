// team-ask gets Cara's checks (scheduling review step 3, 2026-10-12): No shift texts, this client's Do Not Return list,
// active in AxisCare, new-hire readiness (fails closed). The REAL function against a fake database and GoHighLevel.
// node team_ask_gate_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
const ARIEL = '4175550101', OPTED = '4175550202', DND = '4175550303', REJ = '4175550404'
let T, CALLS, SENT, EVENTS, REFUSALS, GHL_FAIL, RPC_FAIL
const plan = () => ({ id: 'tb1', client: 'Mary Example', city: 'Nixa', days: ['mon', 'tue', 'wed'], slots: [{ k: 's1', label: 'Shift 1', start: '09:00', end: '17:00' }],
  cells: { 'mon|s1': { name: 'Ariel Smith', status: 'penciled', cg_ax_id: '11' }, 'tue|s1': { name: 'Ariel Smith', status: 'penciled', cg_ax_id: '11' },
           'wed|s1': { name: 'Ariel Smith', status: 'yes', cg_ax_id: '11' } } })
const reset = () => { CALLS = []; SENT = []; EVENTS = []; REFUSALS = []; GHL_FAIL = false; RPC_FAIL = false; T = {
  app_data: [
    { key: 'staffing_plans', data: [plan(), { id: 'tb2', client: 'Other', days: ['mon'], slots: [{ k: 's1', start: '08:00', end: '12:00' }],
      cells: { 'mon|s1': { name: 'Opal Out', status: 'penciled', cg_ax_id: '22' } } }] },
    { key: 'caregivers', data: [{ first: 'Ariel', last: 'Smith', phone: ARIEL, axiscare_id: '11' }, { first: 'Opal', last: 'Out', phone: OPTED, axiscare_id: '22' },
      { first: 'Dee', last: 'Dnd', phone: DND, axiscare_id: '33' }, { first: 'Rex', last: 'Rejected', phone: REJ, axiscare_id: '44' },
      { first: 'Sam', last: 'Twin', phone: '4175550505' }, { first: 'Sam', last: 'Twin', phone: '4175550606' }] },
    { key: 'ops_settings', data: { team_ask_live: true } },
    { key: 'client_care_blurbs', data: [{ id: '900', blurb: 'Help with meals and short walks' }] },
    { key: 'leads', data: [] }],
  auth_identities: [{ auth_user_id: 'u-kr', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p-kr' }, { auth_user_id: 'u-cg', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p-cg' }],
  persons: [{ person_id: 'p-kr', full_name: 'Krystal Office', active: true }, { person_id: 'p-cg', full_name: 'Cara Giver', active: true }],
  entity_memberships: [{ person_id: 'p-kr', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p-cg', entity: 'cc_ihs', active: true, ended_at: null }],
  staff_roles: [{ person_id: 'p-kr', entity: 'cc_ihs', role: 'staffing_coordinator' }, { person_id: 'p-cg', entity: 'cc_ihs', role: 'caregiver' }],
  team_build_link_current: [{ plan_id: 'tb1', episode_id: 'ep1' }], journey_episode: [{ episode_id: 'ep1', person_id: 'pm' }],
  person_identity: [{ id: 'pm', display_name: 'Maryann Example' }], person_source_id: [{ person_id: 'pm', system: 'axiscare', entity_type: 'client', source_id: '900' }],
  start_contract_current: [{ episode_id: 'ep1', target_date: '2099-10-05' }],
  contact_optout_current: [{ address: '+1' + OPTED, channel: 'sms', opted_out: true, source: 'stop_text' }],
  phone_index: [{ phone: '+1' + REJ, confidence: 'suspect', verification_status: 'rejected', source_system: 'import' }],
  circle_contacts: [], op_events: [] } }
const q = (t) => { const st = { f: [], nn: [] }; const b = {
  select() { return b }, order() { return b }, limit() { return b }, in() { return b },
  not(c) { st.nn.push(c); return b }, eq(c, v) { st.f.push([c, v]); return b },
  insert(row) { if (t === 'op_events') EVENTS.push(row); return Promise.resolve({ data: null, error: null }) },
  maybeSingle() { return b.then((x) => ({ data: x.data[0] ?? null, error: null })) },
  then(ok) { let rows = T[t] ?? []; for (const [c, v] of st.f) rows = rows.filter((r) => r[c] === v); for (const c of st.nn) rows = rows.filter((r) => r[c] != null)
    return Promise.resolve({ data: JSON.parse(JSON.stringify(rows)), error: null }).then(ok) } }; return b }
globalThis.__db = { from: q,
  rpc: async (fn, a) => {
    if (fn === 'contact_send_refusal_log') { REFUSALS.push(a); return { data: null, error: null } }
    if (fn === 'upsert_app_data_item') { if (RPC_FAIL) return { error: { message: 'down' } }
      const row = T.app_data.find((r) => r.key === a.target_key); const i = row.data.findIndex((x) => x.id === a.item.id); row.data[i] = JSON.parse(JSON.stringify(a.item)); return { error: null } }
    return { data: null, error: null } },
  auth: { getUser: async (jwt) => jwt === 'kr' ? { data: { user: { id: 'u-kr', email: 'Krystal@mo-care.com', app_metadata: {} } }, error: null }
                               : jwt === 'cg' ? { data: { user: { id: 'u-cg', email: 'cg@mo-care.com', app_metadata: {} } }, error: null }
                               : { data: { user: null }, error: { message: 'bad' } } } }
globalThis.fetch = async (url, o) => {
  url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}; CALLS.push(url)
  if (url.includes('/contacts/upsert')) { const dnd = String(body.phone || '').endsWith(DND)
    return new Response(JSON.stringify({ contact: { id: 'C:' + body.phone, dnd: false, ...(dnd ? { dndSettings: { SMS: { status: 'active' } } } : {}) } }), { status: 200 }) }
  if (url.includes('/conversations/messages')) { if (GHL_FAIL) return new Response('{}', { status: 500 }); SENT.push({ to: body.contactId, text: body.message }); return new Response('{}', { status: 200 }) }
  return new Response('{}', { status: 404 })
}
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_tag_'))
try {
  const src = fs.readFileSync(path.join(F, 'team-ask/index.ts'), 'utf8')
    .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/from '\.\.\/_shared\/(\w[\w-]*)\.ts'/g, (_, m) => "from '" + path.join(process.cwd(), F, '_shared', m + '.ts') + "'")
  fs.writeFileSync(path.join(tmp, 'team-ask.ts'), src); await import(path.join(tmp, 'team-ask.ts'))
  const call = async (body, jwt = 'kr', method = 'POST') => { const r = await handler(new Request('https://x/functions/v1/team-ask', { method,
    headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: 'Bearer ' + jwt } : {}) }, body: method === 'POST' ? JSON.stringify(body) : undefined }))
    let j = null; try { j = await r.json() } catch { /* */ } return { status: r.status, j, h: r.headers } }
  const plan1 = () => T.app_data[0].data.find((p) => p.id === 'tb1')
  const send = (x = {}, jwt = 'kr') => call({ action: 'send', plan_id: 'tb1', caregiver_axiscare_id: '11', caregiver_name: 'Ariel Smith', cells: ['mon|s1', 'tue|s1'],
    message: 'Hi Ariel, it\'s Caring Companions. Mon & Tue 9am-5pm in Nixa?', ask_id: 'ask-0001-abcd', ...x }, jwt)

  const setK = (k, v) => { const row = T.app_data.find((x) => x.key === k); if (row) row.data = v; else T.app_data.push({ key: k, data: v }) }
  const draft = () => call({ action: 'draft', plan_id: 'tb1', caregiver_axiscare_id: '11', caregiver_name: 'Ariel Smith' })

  reset(); let r = await draft(); ck('nobody blocked: the draft says so and the text goes', r.j.blocked === null, r.j)
  r = await send(); ck('...sent', r.j.outcome === 'sent' && SENT.length === 1, r.j)

  reset(); setK('coverage_do_not_offer', [{ name: 'Ariel Smith', reason: 'asked for fewer texts' }])
  r = await draft(); ck('No shift texts (by name): the draft shows why', /Ariel Smith is on the No shift texts list \(asked for fewer texts\)/.test(r.j.blocked), r.j)
  r = await send(); ck('...and the send is refused on the server, nothing marked asked, refusal recorded', r.j.outcome === 'refused' && /No shift texts/.test(r.j.error) && !SENT.length && plan1().cells['mon|s1'].status === 'penciled' && EVENTS.some((e) => e.verb === 'team_ask_refused'), r.j)

  reset(); setK('coverage_do_not_offer', [{ axiscare_id: '11', until: '2000-01-01' }]); r = await send()
  ck('a No shift texts entry whose date has passed no longer blocks', r.j.outcome === 'sent', r.j)
  reset(); setK('coverage_do_not_offer', [{ phone: '(417) 555-0101', until: '2099-01-01' }]); r = await send()
  ck('matched by phone, with its end date said', r.j.outcome === 'refused' && /until 2099-01-01/.test(r.j.error), r.j)

  reset(); setK('dnr_log', [{ caregiver: 'Ariel Smith', client: 'Maryann Example' }]); r = await send()
  ck('Do Not Return for the plan\'s client (the linked Journey person): refused', r.j.outcome === 'refused' && /Maryann's Do Not Return list/.test(r.j.error) && !SENT.length, r.j)
  reset(); setK('dnr_log', [{ caregiver: 'Ariel Smith', client: 'Somebody Else' }]); r = await send()
  ck('Do Not Return for a different client: not this plan, sent', r.j.outcome === 'sent', r.j)

  reset(); T.app_data.find((x) => x.key === 'caregivers').data[0].axiscare_status_active = false; r = await send()
  ck('not active in AxisCare: refused', r.j.outcome === 'refused' && /not an active caregiver/.test(r.j.error), r.j)

  reset(); T.client_journey = [{ journey_id: 'j1', subject: 'caregiver', status: 'open', axiscare_caregiver_id: '11' }]; T.client_journey_step = []; r = await send()
  ck('a new hire not yet approved to work: refused', r.j.outcome === 'refused' && /awaiting Approve to Work/.test(r.j.error), r.j)
  reset(); T.client_journey = [{ journey_id: 'j1', subject: 'caregiver', status: 'open', axiscare_caregiver_id: '11' }]
  T.client_journey_step = [{ journey_id: 'j1', step_key: 'cg.approve.work', state: 'complete' }, { journey_id: 'j1', step_key: 'cg.axiscare.active', state: 'complete' }]; r = await send()
  ck('...once approved and active, sent', r.j.outcome === 'sent', r.j)

  /* Driver Compliance (2026-10-13): a plan that needs transportation goes only to an Approved Driver with current documents */
  const ariel = () => T.app_data.find((x) => x.key === 'caregivers').data[0]
  const setDrv = (f) => Object.assign(ariel(), f)
  const APPROVED = { dl_status: 'Approved Driver', cleared_to_drive: true, dl_expires: '2099-01-01', auto_ins_expires: '2099-01-01' }
  reset(); plan1().needs = ['transportation']; r = await send()
  ck('driving: plan needs transportation, no driver record yet: refused with the reason, nothing marked asked', r.j.outcome === 'refused' && /not cleared to drive clients, and this shift needs transportation \(No driver record yet\)/.test(r.j.error) && !SENT.length && plan1().cells['mon|s1'].status === 'penciled', r.j)
  reset(); plan1().needs = ['transportation']; setDrv({ dl_status: 'Pending Verification', cleared_to_drive: false }); r = await draft()
  ck('driving: Pending Verification: the draft shows why before anyone writes a text', /Not an Approved Driver \(Pending Verification\)/.test(r.j.blocked) && r.j.transport.level === 'required', r.j)
  r = await send(); ck('...and the send is refused', r.j.outcome === 'refused' && !SENT.length, r.j)
  for (const [st, re] of [['Non-Driver', /Not an Approved Driver \(Non-Driver\)/], ['Suspended', /Driving suspended/]]) {
    reset(); plan1().needs = ['transportation']; setDrv({ dl_status: st, cleared_to_drive: false }); r = await send()
    ck('driving: ' + st + ' is refused', r.j.outcome === 'refused' && re.test(r.j.error) && !SENT.length, r.j) }
  reset(); plan1().needs = ['transportation']; setDrv({ ...APPROVED, auto_ins_expires: '2000-01-01', cleared_to_drive: true }); r = await send()
  ck('driving: an Approved Driver whose insurance date has passed (mirror not yet run) is refused', r.j.outcome === 'refused' && /License or insurance expired/.test(r.j.error), r.j)
  reset(); plan1().needs = ['transportation']; setDrv(APPROVED); r = await send()
  ck('driving: an Approved Driver with current documents is texted', r.j.outcome === 'sent' && SENT.length === 1, r.j)
  reset(); setDrv({ dl_status: 'Non-Driver', cleared_to_drive: false }); r = await send()
  ck('non-transport plan: a Non-Driver is texted as before (unaffected)', r.j.outcome === 'sent', r.j)
  reset(); T.journey_episode[0].state = 'open'; T.client_fact_current = [{ episode_id: 'ep1', kind: 'need_transportation', layer: 'plan', value: 'required' }]
  setDrv({ dl_status: 'Pending Verification', cleared_to_drive: false }); r = await send()
  ck('driving from the linked client\'s care needs (need_transportation required on the plan layer): refused', r.j.outcome === 'refused' && /Pending Verification/.test(r.j.error), r.j)
  reset(); setK('leads', [{ id: 'L1', axiscare_client_id: '900', client_attributes: { transportation: 'yes' } }]); setDrv({ dl_status: 'Suspended' }); r = await draft()
  ck('driving from the lead checklist (transportation yes) for the linked client: blocked', /Driving suspended/.test(r.j.blocked) && r.j.transport.from.includes('the lead checklist'), r.j)
  reset(); setK('leads', [{ id: 'L1', axiscare_client_id: '900', client_attributes: { transportation: 'preferred' } }]); setDrv({ dl_status: 'Suspended' }); r = await send()
  ck('driving only preferred on the lead: never blocks (ranked, not excluded)', r.j.outcome === 'sent', r.j)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
