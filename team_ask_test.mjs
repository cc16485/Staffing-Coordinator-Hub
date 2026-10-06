// team-ask ("Send Text Asking" from the Team Builder, part 1, 2026-09-27). The REAL function and the REAL shared
// staff check, outbound gate and opt-out check, against a fake database and a fake GoHighLevel.
// node team_ask_test.mjs
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
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_ta_'))
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

  reset(); let r = await call(null, null, 'OPTIONS'); ck('browser preflight answered with CORS headers', r.h.get('access-control-allow-origin') === '*')
  reset(); r = await call({ action: 'draft', plan_id: 'tb1', caregiver_axiscare_id: '11' }, null); ck('no sign-in: refused (401), GoHighLevel never asked', r.status === 401 && !CALLS.length, r)
  reset(); r = await send({}, 'cg'); ck('a signed-in caregiver account (no office role): refused (403), nothing sent', r.status === 403 && !CALLS.length && !SENT.length, r)
  reset(); r = await call({ action: 'draft', plan_id: 'tb1', caregiver_axiscare_id: '11', caregiver_name: 'Ariel Smith' })
  ck('draft: caregiver first name, phone last 4 only, no opt-out', r.j.caregiver.first === 'Ariel' && r.j.caregiver.phone_last4 === '0101' && !JSON.stringify(r.j).includes(ARIEL) && r.j.caregiver.opt_out.length === 0, r.j)
  ck('draft: client first name from the Journey person, town, Start Contract target, saved care line', r.j.client.first === 'Maryann' && r.j.client.town === 'Nixa' && r.j.client.start_target === '2099-10-05' && r.j.client.care_line === 'Help with meals and short walks', r.j.client)
  ck('draft: never touches GoHighLevel', CALLS.length === 0, CALLS)
  ck('draft: default template has no street address placeholder', r.j.template.includes('{when}') && !r.j.template.includes('{address}'), r.j.template)
  reset(); r = await call({ action: 'draft', plan_id: 'tb2', caregiver_axiscare_id: '22', caregiver_name: 'Opal Out' })
  ck('draft: an opted-out caregiver is flagged before anyone writes the text', r.j.caregiver.opt_out.some((x) => x.includes('opted out')), r.j)
  ck('draft: an unlinked plan falls back to the typed client name, no date', r.j.client.first === 'Other' && r.j.client.start_target === null && r.j.client.linked === false, r.j.client)

  reset(); T.app_data[2].data.team_ask_live = false; r = await send(); ck('switch off: refused (409), nothing sent, board unchanged', r.status === 409 && !CALLS.length && plan1().cells['mon|s1'].status === 'penciled', r)
  reset(); r = await send({ caregiver_axiscare_id: '44', caregiver_name: 'Rex Rejected' }); ck('a cell that does not name this caregiver: refused as "board changed", nothing sent', r.j.outcome === 'board_changed' && !CALLS.length, r)
  reset(); r = await send({ cells: ['thu|s1'] }); ck('a day not on the plan: refused, nothing sent', r.j.outcome === 'board_changed' && !CALLS.length, r)
  reset(); r = await send({ cells: ['wed|s1'] }); ck('a CONFIRMED shift cannot be asked about again', r.j.outcome === 'board_changed' && !SENT.length, r)
  reset(); r = await send({ message: '' }); ck('empty text: refused', r.status === 400 && !CALLS.length)
  reset(); r = await send({ message: 'x'.repeat(641) }); ck('text over 640 characters: refused', r.status === 400 && !CALLS.length)

  reset(); r = await send({ phone: '4175559999' })
  ck('sends ONE text, to the roster number by AxisCare id (a phone in the request is ignored)', r.j.outcome === 'sent' && SENT.length === 1 && SENT[0].to === 'C:+1' + ARIEL, { r, SENT })
  ck('the exact text the person approved is what went out', SENT[0]?.text === 'Hi Ariel, it\'s Caring Companions. Mon & Tue 9am-5pm in Nixa?', SENT)
  const p1 = plan1()
  ck('both shifts now read "asked" by text, stamped with who and the ask id', ['mon|s1', 'tue|s1'].every((k) => p1.cells[k].status === 'asked' && p1.cells[k].ask_channel === 'sms' && p1.cells[k].ask_id === 'ask-0001-abcd' && p1.cells[k].by === 'Krystal Office'), p1.cells)
  ck('the confirmed Wed shift is untouched', p1.cells['wed|s1'].status === 'yes', p1.cells)
  ck('plan.asks keeps the exact text, who, when, which shifts', p1.asks?.length === 1 && p1.asks[0].text === SENT[0].text && p1.asks[0].by_email === 'krystal@mo-care.com' && p1.asks[0].cells.join() === 'mon|s1,tue|s1', p1.asks)
  ck('an append-only op_events line holds the same record', EVENTS.length === 1 && EVENTS[0].verb === 'team_ask_sent' && EVENTS[0].data.message === SENT[0].text && EVENTS[0].actor_name === 'Krystal Office', EVENTS)
  ck('the updated plan comes back so the board shows it at once', r.j.plan?.asks?.length === 1, r.j)
  r = await send(); ck('the same ask sent twice (double click): no second text', r.j.outcome === 'already_sent' && SENT.length === 1, { r, SENT })

  reset(); r = await call({ action: 'send', plan_id: 'tb2', caregiver_axiscare_id: '22', caregiver_name: 'Opal Out', cells: ['mon|s1'], message: 'hi', ask_id: 'ask-0002-abcd' })
  ck('opted out in the Hub record: refused, no text, refusal logged, board unchanged', r.j.outcome === 'refused' && /asked not to get texts/.test(r.j.error) && !SENT.length && REFUSALS.length === 1
     && T.app_data[0].data[1].cells['mon|s1'].status === 'penciled', { r, REFUSALS })
  ck('the refusal is on the record too, without the phone number', EVENTS.some((e) => e.verb === 'team_ask_refused') && !JSON.stringify(EVENTS).includes(OPTED), EVENTS)
  reset(); T.app_data[0].data[0].cells['mon|s1'] = { name: 'Dee Dnd', status: 'penciled', cg_ax_id: '33' }
  r = await send({ caregiver_axiscare_id: '33', caregiver_name: 'Dee Dnd', cells: ['mon|s1'] }); ck('GoHighLevel Do Not Disturb on: refused, no text', r.j.outcome === 'refused' && !SENT.length, r)
  reset(); T.app_data[0].data[0].cells['mon|s1'] = { name: 'Rex Rejected', status: 'penciled', cg_ax_id: '44' }
  r = await send({ caregiver_axiscare_id: '44', caregiver_name: 'Rex Rejected', cells: ['mon|s1'] }); ck('a number reviewed and rejected: refused with that reason, no text', r.j.outcome === 'refused' && /isn't cleared/.test(r.j.error) && !SENT.length, r)
  reset(); GHL_FAIL = true; r = await send(); ck('GoHighLevel fails to send: reported, nothing marked asked', r.j.outcome === 'failed' && plan1().cells['mon|s1'].status === 'penciled' && !plan1().asks, r)
  reset(); RPC_FAIL = true; r = await send(); ck('sent but the board could not be saved: says so plainly (and op_events still has it)', r.j.outcome === 'sent' && r.j.warning && EVENTS.some((e) => e.verb === 'team_ask_sent'), r.j)
  reset(); T.app_data[0].data[0].cells['mon|s1'] = { name: 'Nobody Here', status: 'penciled' }
  r = await send({ caregiver_axiscare_id: '', caregiver_name: 'Nobody Here', cells: ['mon|s1'] }); ck('not on the roster: no number, nothing sent', r.j.outcome === 'no_phone' && !CALLS.length, r)
  reset(); T.app_data[0].data[0].cells['mon|s1'] = { name: 'Sam Twin', status: 'penciled' }
  r = await send({ caregiver_axiscare_id: '', caregiver_name: 'Sam Twin', cells: ['mon|s1'] }); ck('two roster people share the name and no id: never guessed, nothing sent', r.j.outcome === 'no_phone' && !CALLS.length, r)
  // Stage 2: several people on a shift
  reset(); T.app_data[0].data[0].options = { 'mon|s1': [{ id: 'o1', name: 'Dee Dnd', cg_ax_id: '33', status: 'maybe' }, { id: 'o2', name: 'Opal Out', cg_ax_id: '22', status: 'penciled' }, { id: 'o3', name: 'Ann Applicant', applicant_id: 'a1', status: 'penciled' }],
    'tue|s1': [{ id: 'o4', name: 'Sam Twin', status: 'no_reply' }] }
  T.app_data[1].data.push({ first: 'Lia', last: 'Listed', phone: '4175550707', axiscare_id: '55' })
  T.app_data[0].data[0].options['mon|s1'].push({ id: 'o5', name: 'Lia Listed', cg_ax_id: '55', status: 'maybe' })
  r = await send({ caregiver_axiscare_id: '55', caregiver_name: 'Lia Listed', cells: ['mon|s1'], message: 'Hi Lia, Mon 9-5?', ask_id: 'ask-0010-abcd' })
  const lia = plan1().options['mon|s1'].find((o) => o.id === 'o5')
  ck('someone listed on a shift (not the main person) can be texted about it', r.j.outcome === 'sent' && SENT.length === 1 && SENT[0].to === 'C:+14175550707', { r, SENT })
  ck('...their own entry becomes "asked" by text; the main person is untouched', lia.status === 'asked' && lia.ask_id === 'ask-0010-abcd' && lia.ask_channel === 'sms' && plan1().cells['mon|s1'].status === 'penciled' && !plan1().cells['mon|s1'].ask_id, plan1())
  r = await send({ caregiver_axiscare_id: '55', caregiver_name: 'Lia Listed', cells: ['tue|s1'], message: 'Hi', ask_id: 'ask-0011-abcd' })
  ck('...but not about a shift they are not listed on', r.j.outcome === 'board_changed' && SENT.length === 1, r)
  r = await send({ caregiver_axiscare_id: '22', caregiver_name: 'Opal Out', cells: ['mon|s1'], message: 'Hi', ask_id: 'ask-0012-abcd' })
  ck('...a listed person who opted out is still refused', r.j.outcome === 'refused' && SENT.length === 1, r)
  r = await send({ caregiver_axiscare_id: '', caregiver_name: 'Ann Applicant', cells: ['mon|s1'], message: 'Hi', ask_id: 'ask-0013-abcd' })
  ck('...an offered applicant (not on the roster) is never texted from here', ['board_changed', 'no_phone'].includes(r.j.outcome) && SENT.length === 1, r)
  reset(); T.app_data[0].data[0].options = { 'mon|s1': [{ id: 'o9', name: 'Ariel Smith', cg_ax_id: '11', status: 'no_reply' }] }
  T.app_data[0].data[0].cells['mon|s1'] = { name: 'Rex Rejected', status: 'yes', cg_ax_id: '44' }
  r = await send({ cells: ['mon|s1'], ask_id: 'ask-0014-abcd' })
  ck('a "no reply" can be asked again, even when someone else is already the Yes', r.j.outcome === 'sent' && plan1().options['mon|s1'][0].status === 'asked' && plan1().cells['mon|s1'].status === 'yes', { r, p: plan1() })
  reset(); r = await call({ action: 'send', plan_id: 'nope', caregiver_name: 'x', cells: ['mon|s1'], message: 'hi', ask_id: 'ask-0003-abcd' }); ck('unknown plan: 404', r.status === 404 && !CALLS.length)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
