// kind-tell (Desktop 474): tell a caregiver the kind words about them, from the office number. The REAL function and the
// REAL staff check, outbound gate and opt-out check, against a fake database and a fake GoHighLevel. node kind_tell_test.mjs
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
    { key: 'ops_settings', data: { kind_tell_live: true } },
    { key: 'kind_tells', data: [] },
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
  circle_contacts: [], op_events: [],
  kind_words: [
    { id: '11111111-1111-1111-1111-111111111111', status: 'kind', quote: 'Ariel is the best part of my week', who: 'Ruth', about: 'Ariel Smith', about_role: 'caregiver', link: { type: 'client', ax: '601' } },
    { id: '22222222-2222-2222-2222-222222222222', status: 'kind', quote: 'She is wonderful', who: "Ruth's family", about: 'Opal O.', about_role: 'caregiver', link: null },
    { id: '33333333-3333-3333-3333-333333333333', status: 'kind', quote: 'Sam always calls ahead', who: 'Bob', about: 'Sam', about_role: 'caregiver', link: null },
    { id: '44444444-4444-4444-4444-444444444444', status: 'suggested', quote: 'not yet', who: 'X', about: 'Ariel Smith', about_role: 'caregiver' },
    { id: '55555555-5555-5555-5555-555555555555', status: 'kind', quote: 'Thank you Dee', who: 'Pat', about: 'Dee Dnd', about_role: 'caregiver', link: { type: 'caregiver', id: '33' } }] } }
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
      const row = T.app_data.find((r) => r.key === a.target_key); const i = row.data.findIndex((x) => x.id === a.item.id); if (i >= 0) row.data[i] = JSON.parse(JSON.stringify(a.item)); else row.data.push(JSON.parse(JSON.stringify(a.item))); return { error: null } }
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
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_kt_'))
try {
  const src = fs.readFileSync(path.join(F, 'kind-tell/index.ts'), 'utf8')
    .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/from '\.\.\/_shared\/(\w[\w-]*)\.ts'/g, (_, m) => "from '" + path.join(process.cwd(), F, '_shared', m + '.ts') + "'")
  fs.writeFileSync(path.join(tmp, 'kind-tell.ts'), src); await import(path.join(tmp, 'kind-tell.ts'))
  const call = async (body, jwt = 'kr', method = 'POST') => { const r = await handler(new Request('https://x/functions/v1/kind-tell', { method,
    headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: 'Bearer ' + jwt } : {}) }, body: method === 'POST' ? JSON.stringify(body) : undefined }))
    let j = null; try { j = await r.json() } catch { /* */ } return { status: r.status, j, h: r.headers } }
  const K = (n) => String(n).repeat(8) + '-' + String(n).repeat(4) + '-' + String(n).repeat(4) + '-' + String(n).repeat(4) + '-' + String(n).repeat(12)
  const tells = () => T.app_data.find((r) => r.key === 'kind_tells').data
  reset(); let r = await call(null, null, 'OPTIONS'); ck('browser preflight answered with CORS headers', r.h.get('access-control-allow-origin') === '*')
  reset(); r = await call({ action: 'draft', kind_word_id: K(1) }, null); ck('no sign-in: refused, GoHighLevel never asked', r.status === 401 && !CALLS.length, r)
  reset(); r = await call({ action: 'draft', kind_word_id: K(1) }, 'cg'); ck('a caregiver sign-in (not office): refused', r.status === 403, r)
  reset(); r = await call({ action: 'draft', kind_word_id: K(1) })
  ck('draft: the caregiver by exact name on the roster, last 4 only, the message from the jar', r.j.caregiver.name === 'Ariel Smith' && r.j.caregiver.phone_last4 === '0101' && r.j.caregiver.ax === '11' && /^Hi Ariel, it's Caring Companions\. Ruth said this about you: "Ariel is the best part of my week" Thank you for the care you give\. Krystal$/.test(r.j.message) && !JSON.stringify(r.j).includes(ARIEL), r.j)
  ck('...draft sends nothing', !SENT.length)
  r = await call({ action: 'draft', kind_word_id: K(2) })
  ck('"Opal O." (first name + last initial) is found; her opt-out shows on the draft', r.j.caregiver && r.j.caregiver.name === 'Opal Out' && r.j.caregiver.opt_out.length > 0, r.j)
  r = await call({ action: 'draft', kind_word_id: K(3) })
  ck('just "Sam" with two Sams on the roster: no guess, it asks which one (only roster people with an AxisCare id)', r.j.caregiver === null && r.j.candidates.length === 0 && r.j.message === '', r.j)
  r = await call({ action: 'draft', kind_word_id: K(5) })
  ck('a paperclip to the caregiver wins over the name', r.j.caregiver.ax === '33', r.j)
  r = await call({ action: 'draft', kind_word_id: K(4) })
  ck('a suggestion not yet in the jar: refused', r.status === 404)
  // send
  reset(); r = await call({ action: 'send', kind_word_id: K(1), message: 'Hi Ariel! Ruth said you are the best part of her week. Thank you. Krystal', send_id: 'send-0001-abcd' })
  ck('send: the exact approved words go to the roster number from the office (GoHighLevel)', r.j.outcome === 'sent' && SENT.length === 1 && SENT[0].to === 'C:+1' + ARIEL && /best part of her week/.test(SENT[0].text), [r.j, SENT])
  ck('...recorded as told (who, when, the words) and in op_events', tells()[0].id === K(1) && tells()[0].tells[0].caregiver === 'Ariel Smith' && tells()[0].tells[0].by === 'Krystal Office' && EVENTS.some((e) => e.verb === 'kind_tell_sent'), [tells(), EVENTS])
  r = await call({ action: 'send', kind_word_id: K(1), message: 'again', send_id: 'send-0001-abcd' })
  ck('...the same press twice sends once', r.j.outcome === 'already_sent' && SENT.length === 1)
  r = await call({ action: 'draft', kind_word_id: K(1) })
  ck('...the next draft shows who was told', r.j.told.length === 1 && r.j.told[0].caregiver === 'Ariel Smith')
  reset(); r = await call({ action: 'send', kind_word_id: K(2), message: 'Hi Opal', send_id: 'send-0002-abcd' })
  ck('opted out: refused, nothing sent, nothing marked told', r.j.outcome === 'refused' && !SENT.length && !tells().length, r.j)
  reset(); r = await call({ action: 'send', kind_word_id: K(5), message: 'Hi Dee', send_id: 'send-0003-abcd' })
  ck('GoHighLevel Do Not Disturb: refused', r.j.outcome === 'refused' && !SENT.length, r.j)
  reset(); r = await call({ action: 'send', kind_word_id: K(3), message: 'Hi Sam', send_id: 'send-0004-abcd' })
  ck('no unique caregiver: refused until one is picked', r.j.outcome === 'no_caregiver' && !SENT.length)
  reset(); r = await call({ action: 'send', kind_word_id: K(1), caregiver_ax: '44', message: 'Hi', send_id: 'send-0005-abcd' })
  ck('a picked caregiver whose number was rejected: refused', r.j.outcome === 'refused' && !SENT.length, r.j)
  reset(); T.app_data.find((r) => r.key === 'ops_settings').data.kind_tell_live = false
  r = await call({ action: 'send', kind_word_id: K(1), message: 'Hi', send_id: 'send-0006-abcd' })
  ck('switched off: nothing sent', r.j.outcome === 'off' && !SENT.length)
  reset(); GHL_FAIL = true; r = await call({ action: 'send', kind_word_id: K(1), message: 'Hi', send_id: 'send-0007-abcd' })
  ck('GoHighLevel refuses: says so, nothing marked told', r.j.outcome === 'failed' && !tells().length)
  reset(); r = await call({ action: 'send', kind_word_id: K(1), message: 'x'.repeat(700), send_id: 'send-0008-abcd' })
  ck('too long: refused before anything goes', r.status === 400 && !SENT.length)
  { const src = fs.readFileSync(path.join(F, '_shared/outreach.ts'), 'utf8'), sp = fs.readFileSync(path.join(F, '_shared/send-problems.ts'), 'utf8')
    ck('kind-tell is a registered sender (outbound gate) and has its own failure label', /'kind-tell':\s*\{ class: 'urgent_internal'/.test(src) && /'kind-tell': \['kind words text to a caregiver'/.test(sp)) }
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
for (const [n, o, d] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n   ' + d))
console.log(res.filter((x) => x[1]).length + '/' + res.length + ' passed')
process.exitCode = res.every((x) => x[1]) ? 0 : 1
