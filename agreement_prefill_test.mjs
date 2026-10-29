// agreement_prefill_test.mjs · offline check of the Client Care Agreement pre-fill (Samantha 2026-10-29: "the more they only
// have to tap the better"). start fills the typing boxes from AxisCare (client + responsible parties), the Family Circle, the
// lead and the home visit; prefill reports it with the visit's level and rate; fill_blanks fills only empty boxes. Choices
// (Yes / No, Accept / Decline) are never filled. Nothing real is touched: the database, Auth and AxisCare are fakes.
//   PDFLIB=/path/to/pdf-lib/dist/pdf-lib.esm.js node agreement_prefill_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const PDFLIB = process.env.PDFLIB
if (!PDFLIB || !fs.existsSync(PDFLIB)) { console.log('Set PDFLIB to pdf-lib 1.17.1 dist/pdf-lib.esm.js (npm i pdf-lib@1.17.1).'); process.exit(2) }
let T, AX, AXMODE, FAIL
const CLIENT = { id: 296, firstName: 'Edward', lastName: 'Anderson', dateOfBirth: '1941-03-04', homePhone: '4175550100', residentialAddress: { streetAddress1: '123 Maple St', streetAddress2: 'Apt 4', city: 'Springfield', state: 'MO', postalCode: '65804-1234' } }
const RPS = [{ listNumber: '2', name: 'Tom Anderson', relationship: 'Son', phones: [{ type: 'Mobile', number: '417-555-0111' }], email: '', hipaaDisclosureAuthorization: true },
  { listNumber: '1', name: 'Nancy Anderson', relationship: 'Daughter', email: 'Nancy@Example.com', address: { line1: '9 Oak Rd', city: 'Ozark', state: 'MO', zip: '65721' }, phones: [{ type: 'Home', number: '417-555-0200' }, { type: 'Mobile', number: '(417) 863-7309' }], hipaaDisclosureAuthorization: true, canMakeMedicalDecisions: true }]
const reset = () => { FAIL = null; AXMODE = {}; AX = []; T = {
  client_agreements: [], care_circles: [{ id: 'circ1', active: true, axiscare_client_id: '296' }],
  circle_contacts: [{ id: 'm1', circle_id: 'circ1', name: 'Amy Lee', relationship: 'Niece', phone: '4175550300', email: 'amy@example.com', is_primary: false },
    { id: 'm2', circle_id: 'circ1', name: 'Nancy Anderson', relationship: 'Daughter', phone: '', email: 'nancy@example.com', is_primary: true }],
  app_data: [{ key: 'leads', data: [{ id: 'L1', axiscare_client_id: '296', first_name: 'Bob', last_name: 'Smith', relationship: 'Friend', phone: '4175550400', email: 'bob@example.com',
      client_first_name: 'Eddie', client_last_name: 'Anderson', client_address: '1 Lead St', client_city: 'Nixa', client_zip: '65714', client_phone: '4175550999', client_dob: '1941-03-04' }, { id: 'L2', axiscare_client_id: '999' }] },
    { key: 'care_assessments', data: [{ id: 'v-old', axiscare_client_id: '296', updated_at: '2026-10-01T10:00:00Z', visit: { level: 'wellness', rate: '30', attendees: [] } },
      { id: 'v1', lead_id: 'L1', updated_at: '2026-10-29T10:00:00Z', visit: { level: 'personal', rate: '32', attendees: [{ name: 'Edward Anderson', role: 'client' }, { name: 'Nancy Anderson', rel: 'Daughter', role: 'poa' }] } }] }],
  auth_identities: [{ auth_user_id: 'u-kr', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p-kr' }],
  persons: [{ person_id: 'p-kr', full_name: 'Krystal Office', active: true }],
  entity_memberships: [{ person_id: 'p-kr', entity: 'cc_ihs', active: true, ended_at: null }],
  staff_roles: [{ person_id: 'p-kr', entity: 'cc_ihs', role: 'care_coordinator' }] } }
const clone = (x) => JSON.parse(JSON.stringify(x))
const q = (t) => { const st = { f: [], ins: [], isnull: [], op: 'select', row: null }; const run = () => {
    if (FAIL === t) return { data: null, error: { message: 'down' } }
    const rows = T[t] ?? (T[t] = [])
    const match = (r) => st.f.every(([c, v]) => r[c] === v) && st.ins.every(([c, vs]) => vs.includes(r[c])) && st.isnull.every((c) => r[c] == null)
    if (st.op === 'insert') { const add = (Array.isArray(st.row) ? st.row : [st.row]).map((r) => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...r })); rows.push(...add); return { data: clone(add), error: null } }
    if (st.op === 'update') { const hit = rows.filter(match); hit.forEach((r) => Object.assign(r, clone(st.row))); return { data: clone(hit), error: null } }
    return { data: clone(rows.filter(match)), error: null } }
  const b = { select() { return b }, eq(c, v) { st.f.push([c, v]); return b }, in(c, vs) { st.ins.push([c, vs]); return b }, is(c) { st.isnull.push(c); return b }, limit() { return b }, order() { return b },
    insert(r) { st.op = 'insert'; st.row = r; return b }, update(r) { st.op = 'update'; st.row = r; return b },
    maybeSingle() { const r = run(); return Promise.resolve({ data: r.data ? r.data[0] ?? null : null, error: r.error }) },
    then(ok, no) { return Promise.resolve(run()).then(ok, no) } }; return b }
globalThis.__db = { from: q, storage: { from: () => ({}) }, rpc: async () => ({ data: null, error: null }),
  auth: { getUser: async (jwt) => jwt === 'kr' ? { data: { user: { id: 'u-kr', email: 'kr@mo-care.com', app_metadata: {} } }, error: null } : { data: { user: null }, error: { message: 'bad' } } } }
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', AXISCARE_TOKEN: 'axt', AXISCARE_SITE: '16485' }
const J = (s, o) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } })
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url), method = init.method || 'GET'; AX.push(method + ' ' + u.pathname)
  if (AXMODE.down) return J(500, { errors: ['down'] })
  if (method === 'GET' && u.pathname === '/api/clients/296') return J(200, { results: CLIENT })
  if (method === 'GET' && u.pathname === '/api/clients/296/responsibleParties') return J(200, { results: { responsibleParties: RPS } })
  return J(404, {})
}
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_cap_'))
const shared = (s) => s.replace(/from '\.\.\/_shared\/([\w-]+)\.ts'/g, (_, m) => "from '" + path.join(tmp, m + '.ts') + "'").replace(/from '\.\/([\w-]+)\.ts'/g, (_, m) => "from '" + path.join(tmp, m + '.ts') + "'")
  .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db').replace("'https://esm.sh/pdf-lib@1.17.1'", JSON.stringify(PDFLIB))
try {
  fs.writeFileSync(path.join(tmp, 'outreach.ts'), 'export const contactForOutbound = async () => null\nexport const maySend = () => ({ allowed: false })\n')
  for (const f of fs.readdirSync(path.join(F, '_shared')).filter((f) => f.endsWith('.ts') && f !== 'outreach.ts')) fs.writeFileSync(path.join(tmp, f), shared(fs.readFileSync(path.join(F, '_shared', f), 'utf8')))
  fs.writeFileSync(path.join(tmp, 'fn.ts'), shared(fs.readFileSync(path.join(F, 'client-agreement/index.ts'), 'utf8')))
  await import(path.join(tmp, 'fn.ts'))
  const P = await import(path.join(tmp, 'agreement-prefill.ts'))
  const call = async (body, jwt = 'kr') => { const r = await handler(new Request('https://x/functions/v1/client-agreement', { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: 'Bearer ' + jwt } : {}) }, body: JSON.stringify(body) }))
    let j = null; try { j = await r.json() } catch { /* */ } return { status: r.status, j } }
  const OFFICE = { 'level.personal_care': true, 'level.hourly_rate': '32' }

  // ---- the pure parts ----
  ck('phones read the same however they were typed', P.phoneText('4175550100') === '(417) 555-0100' && P.phoneText('+1 417-555-0100') === '(417) 555-0100' && P.phoneText('ext 12') === 'ext 12')
  ck('dates of birth print as on paper', P.dobText('1941-03-04') === '03/04/1941' && P.dobText('1941-03-04T00:00:00Z') === '03/04/1941' && P.dobText('3/4/1941') === '3/4/1941' && P.dobText('soon') === '')
  ck('the home visit\'s level and rate become the office answers', JSON.stringify(P.officeFromVisit({ visit: { level: 'advanced', rate: '$34' } })) === JSON.stringify({ 'level.advanced_care': true, 'level.hourly_rate': '34' })
    && Object.keys(P.officeFromVisit({ visit: { level: '', rate: 'about 30' } })).length === 0)
  ck('fillBlanks never changes a box someone typed in', JSON.stringify(P.fillBlanks({ 'c1.name': 'Typed', 'c2.name': '' }, { answers: { 'c1.name': 'Hub', 'c2.name': 'Hub2' }, from: { 'c1.name': 'AxisCare', 'c2.name': 'Lead' }, notes: [] }).answers) === JSON.stringify({ 'c2.name': 'Hub2' }))
  const many = P.peopleFor({ rps: [1, 2, 3].map((n) => ({ listNumber: String(n), name: 'P' + 'abc'[n - 1] })), members: [{ name: 'Pd' }, { name: 'Pe', is_primary: true }] })
  ck('the Family Circle\'s primary contact is Contact 1', many[0].name === 'Pe' && many.length === 5)
  ck('the client themself is never a contact', P.peopleFor({ lead: { first_name: 'Ed', last_name: 'A', relationship: 'Self' }, visit: { attendees: [{ name: 'Ed A', role: 'client' }] } }).length === 0)

  // ---- start fills the boxes ----
  reset(); let r = await call({ action: 'start', client_ax: '296', office: OFFICE }); const ag = r.j?.agreement, a = ag?.answers ?? {}
  ck('start still saves a draft with the office answers', r.status === 200 && ag.status === 'draft' && ag.office.answers['level.hourly_rate'] === '32', r.j)
  ck('the client\'s details come from AxisCare (not the lead) and print as on paper',
    a['client.client_s_name'] === 'Edward Anderson' && a['client.address'] === '123 Maple St Apt 4' && a['client.city'] === 'Springfield' && a['client.zip'] === '65804' && a['client.phone_number'] === '(417) 555-0100' && a['ci.date_of_birth'] === '03/04/1941', a)
  ck('Contact 1 is the primary (Nancy), with AxisCare\'s details and both phones', a['c1.name'] === 'Nancy Anderson' && a['c1.relationship'] === 'Daughter' && a['c1.cell_phone'] === '(417) 863-7309' && a['c1.home_phone'] === '(417) 555-0200'
    && a['c1.email'] === 'Nancy@Example.com' && a['c1.address'] === '9 Oak Rd' && a['c1.city'] === 'Ozark' && a['c1.state'] === 'MO' && a['c1.zip'] === '65721', a)
  ck('the same person in AxisCare and the Family Circle is listed once (by email, then name)', ['c1', 'c2', 'c3', 'c4'].filter((c) => a[c + '.name'] === 'Nancy Anderson').length === 1, a)
  ck('then the other AxisCare party, the Family Circle and the lead\'s caller', a['c2.name'] === 'Tom Anderson' && a['c2.cell_phone'] === '(417) 555-0111' && a['c3.name'] === 'Amy Lee' && a['c3.cell_phone'] === '(417) 555-0300' && a['c4.name'] === 'Bob Smith' && a['c4.email'] === 'bob@example.com', a)
  ck('the POA comes from the person tapped "Legal rep" at the home visit, with their phone and email', a['poa.name'] === 'Nancy Anderson' && a['poa.relationship'] === 'Daughter' && a['poa.cell_phone'] === '(417) 863-7309' && a['poa.email'] === 'Nancy@Example.com', a)
  ck('no choice is ever ticked: no Yes / No, Accept / Decline or permission box', Object.values(a).every((v) => typeof v === 'string'), a)
  ck('nothing the server writes at signing, and nothing the office sets, is filled', Object.keys(a).every((k) => !/^(ini|sig|date|level|rates)\.|^ci\.sig\.|^ci\.client_s_name$/.test(k)), Object.keys(a))
  ck('where each box came from is kept, with the values (so the tablet knows which are still as filled in)', ag.office.prefill['client.address'] === 'AxisCare' && ag.office.prefill['c3.name'] === 'Family Circle' && ag.office.prefill['c4.name'] === 'Lead' && ag.office.prefill_values['c1.name'] === 'Nancy Anderson', ag.office)
  ck('AxisCare is only read, never changed', AX.every((x) => x.startsWith('GET ')), AX)

  // ---- the lead fills in when AxisCare cannot be reached, and says so ----
  reset(); AXMODE.down = true; r = await call({ action: 'start', client_ax: '296', office: OFFICE }); const b2 = r.j.agreement
  ck('AxisCare down: the agreement still starts, the client\'s details come from the lead', r.status === 200 && b2.answers['client.client_s_name'] === 'Eddie Anderson' && b2.answers['client.city'] === 'Nixa' && b2.answers['client.phone_number'] === '(417) 555-0999' && b2.office.prefill['client.city'] === 'Lead', b2.answers)
  ck('...and the office is told AxisCare could not be read', (b2.office.prefill_notes || []).some((n) => /AxisCare could not be read/.test(n)), b2.office.prefill_notes)

  // ---- prefill (the set-up screen) ----
  reset(); r = await call({ action: 'prefill', client_ax: '296' })
  ck('prefill says how many boxes and from where, and picks the LATEST home visit\'s level and rate', r.status === 200 && r.j.count > 20 && r.j.sources.includes('AxisCare') && r.j.visit_found === true
    && JSON.stringify(r.j.office) === JSON.stringify({ 'level.personal_care': true, 'level.hourly_rate': '32' }), r.j)
  ck('prefill writes nothing', T.client_agreements.length === 0)
  T.circle_contacts.push({ id: 'm3', circle_id: 'circ1', name: 'Zed One' }, { id: 'm4', circle_id: 'circ1', name: 'Zed Two' })
  r = await call({ action: 'prefill', client_ax: '296' })
  ck('more than 4 people: the note names who was left off', r.j.notes.some((n) => /room for 4/.test(n) && /Zed Two, Bob Smith were left off/.test(n)), r.j.notes)
  r = await call({ action: 'prefill', client_ax: 'abc' }); ck('prefill needs a client number', r.status === 400)
  r = await call({ action: 'prefill', client_ax: '296' }, 'nobody'); ck('prefill needs an office sign-in', r.status === 401 || r.status === 403, r)

  // ---- fill_blanks on a draft started before ----
  reset(); T.client_agreements.push({ id: '22222222-2222-4222-8222-222222222222', axiscare_client_id: '296', status: 'draft', office: { answers: OFFICE }, answers: { 'client.city': 'Typed City', 'c1.name': 'Someone Typed', 'car.decline': true } })
  r = await call({ action: 'fill_blanks', id: '22222222-2222-4222-8222-222222222222' }); const row = T.client_agreements[0]
  ck('fill_blanks fills only the empty boxes and keeps every typed answer and tick', r.status === 200 && r.j.filled > 10 && row.answers['client.city'] === 'Typed City' && row.answers['c1.name'] === 'Someone Typed' && row.answers['car.decline'] === true && row.answers['client.address'] === '123 Maple St Apt 4'
    && !row.office.prefill['client.city'] && row.office.prefill['client.address'] === 'AxisCare' && row.office.answers['level.hourly_rate'] === '32', { r: r.j, row })
  row.status = 'signed'; r = await call({ action: 'fill_blanks', id: row.id }); ck('fill_blanks never touches a signed agreement', r.status === 409)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
const bad = res.filter((x) => !x[1])
for (const [n, okk, note] of res) console.log((okk ? 'PASS ' : 'FAIL ') + n + (note ? '\n     ' + note : ''))
console.log(`\n${res.length - bad.length}/${res.length} passed`); process.exit(bad.length ? 1 : 0)
