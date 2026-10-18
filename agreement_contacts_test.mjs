// agreement_contacts_test.mjs · offline check of Stage 2 (872): the office reviews the signed Contacts & Permissions and
// approves them into AxisCare responsible parties 1-3 and the Hub Family Circle. Nothing real is touched: the database,
// storage, Supabase Auth and AxisCare are fakes. PDFLIB as for client_agreement_test.mjs (the function imports pdf-lib).
//   PDFLIB=/path/to/pdf-lib/dist/pdf-lib.esm.js node agreement_contacts_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
const PDFLIB = process.env.PDFLIB
if (!PDFLIB || !fs.existsSync(PDFLIB)) { console.log('Set PDFLIB to pdf-lib 1.17.1 dist/pdf-lib.esm.js (npm i pdf-lib@1.17.1).'); process.exit(2) }
const MASTER = fs.readFileSync('client-agreement/client-care-agreement-rev-2026-10.pdf')
const SIG = 'data:image/png;base64,' + fs.readFileSync('client-agreement/test-signature.png').toString('base64')
let T, FILES, FAIL, AXS, AXCALLS, AXMODE, RPC
const reset = () => { FAIL = null; AXCALLS = []; RPC = []; AXMODE = {}; AXS = {
  1: { listNumber: '1', name: 'Nancy Anderson', relationship: 'Spouse', email: 'old@example.com', dateOfBirth: '1945-02-03', address: { line1: '9 Old Rd', line2: 'Apt 2', city: 'Ozark', state: 'MO', zip: '65721' }, phones: [{ listNumber: '1', type: 'Home', number: '417-555-0001' }], hipaaDisclosureAuthorization: false, canMakeMedicalDecisions: null },
  2: { listNumber: '2', name: 'Someone Else', relationship: 'Friend', phones: [], hipaaDisclosureAuthorization: true, canMakeMedicalDecisions: false } }; FILES = { 'client-agreements/master/client-care-agreement-rev-2026-10.pdf': new Uint8Array(MASTER) }; T = {
  client_agreements: [], document_access_log: [], care_circles: [{ id: 'circ1', client_name: 'Edward Anderson', active: true, axiscare_client_id: '296' }],
  circle_contacts: [{ id: 'm1', circle_id: 'circ1', name: 'Nancy Anderson', source: 'axiscare', axiscare_list_number: 1, is_primary: true, sms_consent: false, wants_changes: true, wants_late: true, stopped_at: null }],
  auth_identities: [{ auth_user_id: 'u-kr', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p-kr' }, { auth_user_id: 'u-cg', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p-cg' }],
  persons: [{ person_id: 'p-kr', full_name: 'Krystal Office', active: true }, { person_id: 'p-cg', full_name: 'Cara Giver', active: true }],
  entity_memberships: ['p-kr', 'p-cg'].map((p) => ({ person_id: p, entity: 'cc_ihs', active: true, ended_at: null })),
  staff_roles: [{ person_id: 'p-kr', entity: 'cc_ihs', role: 'care_coordinator' }, { person_id: 'p-cg', entity: 'cc_ihs', role: 'caregiver' }] } }
const clone = (x) => JSON.parse(JSON.stringify(x))
const q = (t) => { const st = { f: [], ins: [], isnull: [], op: 'select', row: null }; const run = () => {
    if (FAIL === t) return { data: null, error: { message: 'down' } }
    const rows = T[t] ?? (T[t] = [])
    const match = (r) => st.f.every(([c, v]) => r[c] === v) && st.ins.every(([c, vs]) => vs.includes(r[c])) && st.isnull.every((c) => r[c] == null)
    if (st.op === 'insert') { const add = (Array.isArray(st.row) ? st.row : [st.row]).map((r) => ({ id: crypto.randomUUID(), created_at: new Date().toISOString(), ...r })); rows.push(...add); return { data: clone(add), error: null } }
    if (st.op === 'update') { const hit = rows.filter(match); hit.forEach((r) => Object.assign(r, clone(st.row))); return { data: clone(hit), error: null } }
    return { data: clone(rows.filter(match)), error: null } }
  const b = { select() { return b }, eq(c, v) { st.f.push([c, v]); return b }, in(c, vs) { st.ins.push([c, vs]); return b }, is(c) { st.isnull.push(c); return b }, limit() { return b }, order() { return b },
    insert(r) { if (t === 'circle_contacts' && FAIL === 'insert_contacts') { st.op = 'select'; return { select: () => Promise.resolve({ data: null, error: { message: 'insert refused' } }) } } st.op = 'insert'; st.row = r; return b }, update(r) { st.op = 'update'; st.row = r; return b },
    maybeSingle() { const r = run(); return Promise.resolve({ data: r.data ? r.data[0] ?? null : null, error: r.error }) },
    then(ok, no) { return Promise.resolve(run()).then(ok, no) } }; return b }
const storage = { from: (bucket) => ({
  upload: async (p, bytes, o) => { const k = bucket + '/' + p; if (FILES[k] && !o.upsert) return { error: { message: 'exists' } }; FILES[k] = new Uint8Array(bytes); return { data: { path: p }, error: null } },
  download: async (p) => FILES[bucket + '/' + p] ? { data: new Blob([FILES[bucket + '/' + p]]), error: null } : { data: null, error: { message: 'not found' } },
  createSignedUrl: async (p, s) => ({ data: { signedUrl: `https://x/sign/${bucket}/${p}?e=${s}` }, error: null }) }) }
globalThis.__db = { from: q, storage,
  rpc: async (fn, args) => { RPC.push([fn, args]); if (fn === 'family_circle_link') { const c = T.care_circles.find((x) => String(x.id) === args.p_circle_id); c.axiscare_client_id = args.p_axiscare_client_id; c.active = true; return { data: { outcome: 'linked' }, error: null } } return { data: { outcome: 'recorded' }, error: null } },
  auth: { getUser: async (jwt) => ({ kr: 'u-kr', cg: 'u-cg' })[jwt] ? { data: { user: { id: ({ kr: 'u-kr', cg: 'u-cg' })[jwt], email: jwt + '@mo-care.com', app_metadata: {} } }, error: null } : { data: { user: null }, error: { message: 'bad' } } } }
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', AXISCARE_TOKEN: 'axt', AXISCARE_SITE: '16485' }
const J = (s, o) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } })
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url), m = u.pathname.match(/^\/api\/clients\/(\d+)\/responsibleParties(?:\/(\d))?$/), method = init.method || 'GET'
  AXCALLS.push({ method, path: u.pathname, body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.Authorization, host: u.host })
  if (!m) return J(404, {})
  if (method === 'GET' && !m[2]) return AXMODE.getFail ? J(500, { errors: ['down'] }) : J(200, { results: { responsibleParties: Object.values(AXS) } })
  if (method === 'GET') { const s = AXS[m[2]]; if (!s) return J(404, {}); const v = JSON.parse(JSON.stringify(s)); if (AXMODE.flipHipaa) v.hipaaDisclosureAuthorization = !v.hipaaDisclosureAuthorization; return J(200, { results: v }) }
  if (method === 'PUT') { if (AXMODE.putFail) return J(403, { errors: ['not allowed'] }); AXS[m[2]] = { listNumber: m[2], ...JSON.parse(init.body) }; return J(200, { results: AXS[m[2]] }) }
  return J(405, {})
}
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_cag_'))
const shared = (s) => s.replace(/from '\.\.\/_shared\/([\w-]+)\.ts'/g, (_, m) => "from '" + path.join(tmp, m + '.ts') + "'").replace(/from '\.\/([\w-]+)\.ts'/g, (_, m) => "from '" + path.join(tmp, m + '.ts') + "'")
  .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db').replace("'https://esm.sh/pdf-lib@1.17.1'", JSON.stringify(PDFLIB))
try {
  fs.writeFileSync(path.join(tmp, 'outreach.ts'), 'export const contactForOutbound = async () => null\nexport const maySend = () => ({ allowed: false })\n')   // 873: no family email in this test
  /* every shared module the functions import (the faked send gate, outreach.ts, is written above and kept) */
  for (const f of fs.readdirSync(path.join(F, '_shared')).filter((f) => f.endsWith('.ts') && f !== 'outreach.ts')) fs.writeFileSync(path.join(tmp, f), shared(fs.readFileSync(path.join(F, '_shared', f), 'utf8')))
  fs.writeFileSync(path.join(tmp, 'fn.ts'), shared(fs.readFileSync(path.join(F, 'client-agreement/index.ts'), 'utf8')))
  await import(path.join(tmp, 'fn.ts'))
  const { PDFDocument } = await import(PDFLIB)
  const call = async (body, jwt = 'kr', method = 'POST') => { const r = await handler(new Request('https://x/functions/v1/client-agreement', { method,
    headers: { 'Content-Type': 'application/json', 'user-agent': 'TabletSafari/1', 'cf-connecting-ip': '203.0.113.9', ...(jwt ? { Authorization: 'Bearer ' + jwt } : {}) }, body: method === 'POST' ? JSON.stringify(body) : undefined }))
    let j = null; try { j = await r.json() } catch { /* */ } return { status: r.status, j, h: r.headers } }
  const OFFICE = { 'level.personal_care': true, 'level.hourly_rate': '32' }
  const FAMILY = { 'client.client_s_name': 'Edward Anderson', 'client.address': '123 Maple St', 'client.city': 'Springfield', 'client.zip': '65804', 'client.phone_number': '417-555-0100',
    'c1.name': 'Nancy Anderson', 'c1.relationship': 'Wife', 'c1.cell_phone': '417-863-7309', 'c1.email': 'nancy@example.com', 'c1.hipaa_yes': true, 'c1.medical_yes': true, 'c1.poa_health': true,
    'c1.text_running_late': true, 'c1.axis_care_notes': true, 'c1.email_invoices': true, 'ci.date_of_birth': '3/4/1941',
    'backup.full_name': 'Tom Anderson', 'backup.relationship_to_client': 'Son', 'backup.primary_phone': '417-555-0111',
    'access.2_lockbox_access_a_ke': true, 'access.lockbox_location': 'Back porch', 'access.lockbox_code': '2468',
    'car.decline': true, 'comm.accept': true, 'photos.share_with_my_family': true }
  const TAPS = Object.fromEntries(['1', '2', '3', '4', '5', '6'].map((n) => [n, '2026-10-16T15:0' + n + ':00Z']))
  const start = async () => (await call({ action: 'start', client_ax: '296', office: OFFICE })).j.agreement.id


  const ANS = { ...FAMILY,
    'c1.name': 'Nancy Anderson', 'c1.relationship': 'Wife', 'c1.cell_phone': '417-863-7309', 'c1.home_phone': '417-555-0002', 'c1.email': 'nancy@example.com',
    'c1.address': '123 Maple St', 'c1.city': 'Springfield', 'c1.state': 'Missouri', 'c1.zip': '65804', 'c1.hipaa_yes': true, 'c1.medical_yes': true, 'c1.poa_health': true,
    'c1.text_running_late': true, 'c1.axis_care_notes': true, 'c1.axis_invoices': true, 'c1.email_invoices': true, 'c1.email_weekly_calendar': true, 'c1.book_no': true,
    'c2.name': 'Tom Anderson', 'c2.relationship': 'Son', 'c2.cell_phone': '417-555-011', 'c2.hipaa_no': true, 'c2.medical_no': true, 'c2.text_caregiver_change': true, 'c2.book_yes': true,
    'c3.name': 'Jane Doe', 'c3.relationship': 'Neighbor', 'c3.hipaa_no': true, 'c3.medical_no': true, 'c3.text_running_late': true,
    'c4.name': 'Bob Ray', 'c4.relationship': 'Friend', 'c4.cell_phone': '417-555-0444', 'c4.hipaa_no': true, 'c4.medical_no': true }
  const seed = (status = 'countersigned', answers = ANS) => { const id = crypto.randomUUID(); T.client_agreements.push({ id, axiscare_client_id: '296', status, version: 'Rev. 10/2026', office: { answers: OFFICE }, answers, contacts_review: null }); return id }
  const puts = () => AXCALLS.filter((x) => x.method === 'PUT')
  const person = (name) => T.circle_contacts.find((m) => m.name === name)

  reset(); let id = seed('signed'); let r = await call({ action: 'contacts', id })
  ck('review before the office countersigns: refused', r.status === 409, r)
  reset(); id = seed(); r = await call({ action: 'contacts', id }, 'cg'); ck('a caregiver account cannot review contacts (403)', r.status === 403, r)
  r = await call({ action: 'contacts', id }); const cs = r.j.contacts
  ck('review lists the 4 signed contacts in order', r.status === 200 && cs.map((c) => c.name).join('|') === 'Nancy Anderson|Tom Anderson|Jane Doe|Bob Ray', r.j)
  ck('plan: Nancy updates her own AxisCare slot 1; Tom takes free slot 3; nobody touches Someone Else in slot 2',
    cs[0].plan.axiscare.action === 'update' && cs[0].plan.axiscare.slot === 1 && cs[1].plan.axiscare.action === 'add' && cs[1].plan.axiscare.slot === 3, cs.map((c) => c.plan))
  ck('plan: Jane and Bob go to the Hub only, because AxisCare\'s three slots are taken', cs[2].plan.axiscare.action === 'hub_only' && cs[3].plan.axiscare.action === 'hub_only' && /three/.test(cs[2].plan.axiscare.why))
  ck('plan: Nancy is the Family Circle member already there; the others are new', cs[0].plan.hub.action === 'update' && cs[0].plan.hub.member_id === 'm1' && cs[1].plan.hub.action === 'add')
  ck('review shows what AxisCare holds now for Nancy, side by side', cs[0].axiscare_now.email === 'old@example.com' && cs[0].axiscare_now.hipaa_authorized === false)
  ck('checklist: Nancy\'s AxisCare sign-in (care notes and invoices) and her emails (weekly calendar, invoices)',
    cs[0].todo.map((x) => x.key).join() === 'c1.signin,c1.emails' && /care notes and invoices/.test(cs[0].todo[0].text) && /weekly calendar, invoices/.test(cs[0].todo[1].text), cs[0].todo)
  ck('checklist: Jane asked for texts but gave no phone, so the office is asked to get one', cs[2].todo.some((x) => x.key === 'c3.phone'))
  ck('looking at the review changes nothing anywhere', !puts().length && T.circle_contacts.length === 1 && !T.client_agreements[0].contacts_review)

  r = await call({ action: 'contacts_apply', id, people: [{ n: 2, edits: { cell: '417-555-0111', email: 'not an email' } }] })
  ck('a typo fix that is still wrong (email) is refused for that person, nothing sent', r.status === 200 && r.j.results[0].outcome === 'problems' && !puts().length, r.j)
  r = await call({ action: 'contacts_apply', id, people: [{ n: 1 }, { n: 2, edits: { cell: '417-555-0111', hipaa: true } }, { n: 3 }, { n: 4, include: false }] })
  const p1 = puts().find((x) => x.path.endsWith('/1'))?.body, p3 = puts().find((x) => x.path.endsWith('/3'))?.body
  ck('approve: AxisCare gets exactly two writes, slots 1 and 3, never slot 2', r.status === 200 && puts().length === 2 && p1 && p3 && !puts().some((x) => x.path.endsWith('/2')), puts().map((x) => x.path))
  ck('slot 1: the signed HIPAA Yes and Medical Decisions Yes go to AxisCare (they were No / blank)', p1.hipaaDisclosureAuthorization === true && p1.canMakeMedicalDecisions === true, p1)
  ck('slot 1: address from the agreement with "Missouri" sent as MO, the old line 2 and date of birth kept', p1.address.line1 === '123 Maple St' && p1.address.state === 'MO' && p1.address.line2 === 'Apt 2' && p1.dateOfBirth === '1945-02-03', p1)
  ck('slot 1: cell as Mobile and home as Home, the new email', JSON.stringify(p1.phones) === JSON.stringify([{ listNumber: '1', type: 'Mobile', number: '417-863-7309' }, { listNumber: '2', type: 'Home', number: '417-555-0002' }]) && p1.email === 'nancy@example.com', p1)
  ck('slot 3: Tom with the office\'s phone fix; the signed No answers are not edited by the office', p3.name === 'Tom Anderson' && p3.phones[0].number === '417-555-0111' && p3.hipaaDisclosureAuthorization === false && p3.canMakeMedicalDecisions === false, p3)
  ck('every AxisCare write goes to site 16485 with the server token', puts().every((x) => x.host === '16485.axiscare.com' && x.auth === 'Bearer axt'))
  const n1 = person('Nancy Anderson'), n2 = person('Tom Anderson'), n3 = person('Jane Doe')
  ck('Hub: Nancy updated in place (no duplicate), with AxisCare\'s read-back answers', T.circle_contacts.filter((m) => m.name === 'Nancy Anderson').length === 1 && n1.hipaa_authorized === true && n1.can_make_medical_decisions === true && n1.from_agreement === id && n1.from_agreement_n === 1, n1)
  ck('Hub: Nancy ticked only Running late: running-late texts on, caregiver-change texts off', n1.sms_consent === true && n1.wants_late === true && n1.wants_changes === false, n1)
  ck('Hub: Tom ticked only Caregiver change: caregiver-change on, running-late off', n2 && n2.sms_consent === true && n2.wants_changes === true && n2.wants_late === false && n2.source === 'axiscare' && n2.axiscare_list_number === 3, n2)
  ck('Hub: Jane is in the Family Circle only (not marked as AxisCare), texts as ticked', n3 && n3.source === undefined && n3.wants_late === true && n3.wants_changes === false && n3.hipaa_authorized === false, n3)
  // 2026-10-18b: "Can book in the app" Yes / No on Exhibit I
  ck('Hub: Nancy marked "No" for the Booking App: booking off and the choice recorded (even though she is in AxisCare)', n1.app_can_book === false && n1.app_book_choice === false, n1)
  ck('Hub: Tom marked "Yes": booking on and the choice recorded', n2.app_can_book === true && n2.app_book_choice === true, n2)
  ck('Hub: Jane left it blank: booking and the choice are not touched', !('app_can_book' in n3) && !('app_book_choice' in n3), n3)
  ck('Hub: Bob was left out by the office and is nowhere', !person('Bob Ray') && !puts().some((x) => x.body?.name === 'Bob Ray'))
  ck('Hub: Nancy stays the main contact; nobody new is made main', n1.is_primary === true && n2.is_primary === false && n3.is_primary === false)
  const logs = RPC.filter((x) => x[0] === 'axiscare_change_record')
  ck('every AxisCare write is in the AxisCare change log as confirmed, by the office person', logs.length === 2 && logs.every((x) => x[1].p_outcome === 'sent_confirmed' && x[1].p_by === 'kr@mo-care.com' && x[1].p_via === 'client-agreement'), logs)
  const rv = T.client_agreements[0].contacts_review
  ck('the review is recorded on the agreement: who, when, each person\'s outcome', rv.people[1].outcome === 'done' && rv.people[2].outcome === 'done' && rv.people[3].axiscare.outcome === 'hub_only' && rv.people[4].outcome === 'left_out' && rv.last_by === 'kr@mo-care.com' && rv.people[2].changed.join() === 'cell', rv)
  const before = puts().length
  r = await call({ action: 'contacts_apply', id, people: [{ n: 1 }, { n: 2 }] })
  ck('approving again: the people already done are skipped, nothing sent twice', r.j.results.every((x) => x.outcome === 'already_done') && puts().length === before, r.j)
  r = await call({ action: 'contacts_todo', id, key: 'c1.signin', done: true })
  ck('checklist: ticking "sign-in set up" records who and when', r.status === 200 && T.client_agreements[0].contacts_review.todo['c1.signin'].by === 'kr@mo-care.com')
  r = await call({ action: 'contacts_todo', id, key: 'c9.emails', done: true }); ck('checklist: something not on the list is refused', r.status === 400, r)
  r = await call({ action: 'contacts_todo', id, key: 'c1.signin', done: false }); ck('checklist: a tick can be taken back', !T.client_agreements[0].contacts_review.todo['c1.signin'])

  reset(); id = seed(); AXMODE.putFail = true
  r = await call({ action: 'contacts_apply', id, people: [{ n: 2 }] })
  ck('AxisCare refuses: said plainly, logged as refused, the person still lands in the Family Circle, and can be tried again',
    r.j.results[0].axiscare.outcome === 'refused' && /refused/.test(r.j.results[0].axiscare.detail) && r.j.results[0].outcome === 'needs_another_try' && person('Tom Anderson')
    && RPC.some((x) => x[0] === 'axiscare_change_record' && x[1].p_outcome === 'refused'), r.j)
  AXMODE.putFail = false; r = await call({ action: 'contacts_apply', id, people: [{ n: 2 }] })
  ck('trying again after a refusal: sent, and the same Family Circle member is updated (no duplicate)', r.j.results[0].outcome === 'done' && T.circle_contacts.filter((m) => m.name === 'Tom Anderson').length === 1, r.j)

  reset(); id = seed(); AXMODE.flipHipaa = true; r = await call({ action: 'contacts_apply', id, people: [{ n: 1 }] })
  ck('AxisCare reads back a different HIPAA answer: flagged to check, not called confirmed', r.j.results[0].axiscare.outcome === 'saved_differently' && /check the client in AxisCare/.test(r.j.results[0].axiscare.detail), r.j)

  reset(); id = seed(); AXMODE.getFail = true; r = await call({ action: 'contacts_apply', id, people: [{ n: 1 }] })
  ck('AxisCare cannot be read: nothing is changed anywhere', r.status === 502 && !puts().length && !T.circle_contacts.some((m) => m.from_agreement), r)

  reset(); T.care_circles = []; T.circle_contacts = []; delete AXS[1]; id = seed(); r = await call({ action: 'contacts_apply', id, people: [{ n: 1 }] })
  ck('no Family Circle yet: one is made, linked to the client through the link door, and Nancy is its main contact',
    T.care_circles.length === 1 && RPC.some((x) => x[0] === 'family_circle_link' && x[1].p_axiscare_client_id === '296' && x[1].p_how === 'client_agreement') && person('Nancy Anderson')?.is_primary === true && person('Nancy Anderson')?.circle_id === T.care_circles[0].id, { circles: T.care_circles, rpc: RPC })

  reset(); T.care_circles.push({ id: 'circ2', client_name: 'Edward A', active: true, axiscare_client_id: '296' }); id = seed(); r = await call({ action: 'contacts_apply', id, people: [{ n: 1 }] })
  ck('two Family Circles linked to the client: stopped, nothing sent', r.status === 409 && !puts().length, r)
  reset(); id = seed(); FAIL = 'insert_contacts'; r = await call({ action: 'contacts_apply', id, people: [{ n: 2 }] })
  ck('the Family Circle cannot be saved: said plainly as needing another try', r.j.results[0].hub.outcome === 'failed' && r.j.results[0].outcome === 'needs_another_try', r.j); FAIL = null
  reset(); id = seed(); r = await call({ action: 'list', client_ax: '296' }); ck('list carries the review so the Hub card can show it', r.status === 200 && 'contacts_review' in r.j.agreements[0], r.j)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
const bad = res.filter((x) => !x[1])
for (const [n, okk, note] of res) console.log((okk ? 'PASS ' : 'FAIL ') + n + (note ? '\n     ' + note : ''))
console.log(`\n${res.length - bad.length}/${res.length} passed`); process.exit(bad.length ? 1 : 0)
