// agreement_steps_test.mjs · offline check of Stage 4 (875): countersigning a Client Care Agreement ticks Start of Care p1
// "Care Agreement provided" and p2 "Signed Care Agreement received" and the journey's docs.agreement, never p3 / ax.docs,
// never a step a person already ticked, never over someone else's change, and never blocks the countersign.
//   PDFLIB=/path/to/pdf-lib/dist/pdf-lib.esm.js node agreement_steps_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
const PDFLIB = process.env.PDFLIB
if (!PDFLIB || !fs.existsSync(PDFLIB)) { console.log('Set PDFLIB to pdf-lib 1.17.1 dist/pdf-lib.esm.js (npm i pdf-lib@1.17.1).'); process.exit(2) }
const MASTER = fs.readFileSync('client-agreement/client-care-agreement-rev-2026-10-17.pdf'), MASTER_FIRST = fs.readFileSync('client-agreement/client-care-agreement-rev-2026-10.pdf')   // 2026-10-17: both masters are stored
const SIG = 'data:image/png;base64,' + fs.readFileSync('client-agreement/test-signature.png').toString('base64')
let T, FILES, FAIL, GHL, GATE
const reset = () => { FAIL = null; GHL = { calls: [], uploadStatus: 200, sendStatus: 201 }; GATE = { calls: [], refuse: false }; globalThis.__hours = { allowed: true }; FILES = { 'client-agreements/master/client-care-agreement-rev-2026-10-17.pdf': new Uint8Array(MASTER), 'client-agreements/master/client-care-agreement-rev-2026-10.pdf': new Uint8Array(MASTER_FIRST) }; T = {
  client_agreements: [], document_access_log: [],
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
    if (st.op === 'upsert') { const i = rows.findIndex((x) => x.journey_id === st.row.journey_id && x.step_key === st.row.step_key); if (i >= 0) rows[i] = { ...rows[i], ...clone(st.row) }; else rows.push(clone(st.row)); return { data: [clone(st.row)], error: null } }
    if (st.op === 'update') { const hit = rows.filter(match); hit.forEach((r) => Object.assign(r, clone(st.row))); return { data: clone(hit), error: null } }
    return { data: clone(rows.filter(match)), error: null } }
  const b = { select() { return b }, eq(c, v) { st.f.push([c, v]); return b }, in(c, vs) { st.ins.push([c, vs]); return b }, is(c) { st.isnull.push(c); return b }, limit() { return b }, order() { return b },
    insert(r) { st.op = 'insert'; st.row = r; return b },
    upsert(r) { st.op = 'upsert'; st.row = r; return b }, update(r) { st.op = 'update'; st.row = r; return b },
    maybeSingle() { const r = run(); return Promise.resolve({ data: r.data ? r.data[0] ?? null : null, error: r.error }) },
    then(ok, no) { return Promise.resolve(run()).then(ok, no) } }; return b }
const storage = { from: (bucket) => ({
  upload: async (p, bytes, o) => { const k = bucket + '/' + p; if (FILES[k] && !o.upsert) return { error: { message: 'exists' } }; FILES[k] = new Uint8Array(bytes); return { data: { path: p }, error: null } },
  download: async (p) => FILES[bucket + '/' + p] ? { data: new Blob([FILES[bucket + '/' + p]]), error: null } : { data: null, error: { message: 'not found' } },
  createSignedUrl: async (p, s) => ({ data: { signedUrl: `https://x/sign/${bucket}/${p}?e=${s}` }, error: null }) }) }
globalThis.__db = { from: q, storage, rpc: async (fn, args) => { (T.rpc ?? (T.rpc = [])).push([fn, args])
    if (fn === 'lead_put_if_same') { if (globalThis.__leadRace) return { data: false, error: null }; const L = T.app_data.find((x) => x.key === 'leads').data, i = L.findIndex((l) => l.id === args.p_id)
      if (i < 0 || JSON.stringify(L[i]) !== JSON.stringify(args.p_before)) return { data: false, error: null }; L[i] = clone(args.p_after); return { data: true, error: null } }
    return { data: { outcome: 'recorded' }, error: null } },
  auth: { getUser: async (jwt) => ({ kr: 'u-kr', cg: 'u-cg' })[jwt] ? { data: { user: { id: ({ kr: 'u-kr', cg: 'u-cg' })[jwt], email: jwt + '@mo-care.com', app_metadata: {} } }, error: null } : { data: { user: null }, error: { message: 'bad' } } } }
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_API_KEY: 'ghl-k', GHL_LOCATION_ID: 'loc1' }
globalThis.__gate = async (db, ghl, person, kind, opts) => { GATE.calls.push({ person, kind, opts, ghl }); return GATE.refuse ? null : { contactId: 'ct-' + person.email, phone: null } }
globalThis.fetch = async (url, init = {}) => {
  const u = String(url)
  if (u.endsWith('/conversations/messages/upload')) { const f = init.body.get('fileAttachment'); GHL.calls.push({ kind: 'upload', auth: init.headers.Authorization, contactId: init.body.get('contactId'), locationId: init.body.get('locationId'), secure: init.body.get('isSecureAttachment'), name: f?.name, bytes: f ? new Uint8Array(await f.arrayBuffer()) : null })
    return new Response(JSON.stringify(GHL.uploadStatus === 200 ? { uploadedFiles: { [f?.name || 'x']: 'https://files.example/secure/abc' } } : { message: 'nope' }), { status: GHL.uploadStatus }) }
  if (u.endsWith('/conversations/messages')) { GHL.calls.push({ kind: 'send', body: JSON.parse(init.body) }); return new Response('{}', { status: GHL.sendStatus }) }
  return new Response('{}', { status: 404 }) }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_cag_'))
const shared = (s) => s.replace(/from '\.\.\/_shared\/([\w-]+)\.ts'/g, (_, m) => "from '" + path.join(tmp, m + '.ts') + "'").replace(/from '\.\/([\w-]+)\.ts'/g, (_, m) => "from '" + path.join(tmp, m + '.ts') + "'")
  .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db').replace("'https://esm.sh/pdf-lib@1.17.1'", JSON.stringify(PDFLIB))
try {
  fs.writeFileSync(path.join(tmp, 'outreach.ts'), 'export const contactForOutbound = (...a) => globalThis.__gate(...a)\nexport const maySend = () => globalThis.__hours\n')
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



  const FAM = { ...FAMILY, 'poa.name': 'Nancy Anderson', 'poa.relationship': 'Wife' }
  const SOC = (over = {}) => ({ pathway: 'PP', started_at: '2026-10-10T15:00:00Z', steps: [
    { id: 'p0', label: 'In-home assessment completed with the client/family', done_at: '2026-10-12T15:00:00Z', done_by: 'Krystal' },
    { id: 'p1', label: 'Care Agreement provided', done_at: null }, { id: 'p2', label: 'Signed Care Agreement received', role: 'family', done_at: null },
    { id: 'p3', label: 'Signed Care Agreement uploaded to AxisCare', done_at: null }, { id: 'p4', label: 'Billing setup completed in AxisCare', done_at: null }], ...over })
  const setup = async (o = {}) => {
    reset(); T.client_journey_step = []; T.client_journey_event = []
    T.app_data = [{ key: 'leads', data: o.leads ?? [{ id: 'L1', name: 'Edward', axiscare_client_id: '296', soc: SOC() }, { id: 'L2', axiscare_client_id: '999', soc: SOC() }] }]
    T.client_journey = o.journeys ?? [{ journey_id: 'J1', subject: 'client', axiscare_client_id: '296', status: 'open', is_test: false, created_at: '2026-10-10T15:00:00Z' }]
    if (o.steps) T.client_journey_step = o.steps
    const id = await start()
    await call({ action: 'sign', id, answers: FAM, signer: { name: 'Nancy Anderson', role: 'representative', relationship: 'Wife' }, initials: { ...TAPS, poa: '2026-10-16T15:07:00Z' }, signature: SIG, consent: true })
    if (o.home) T.client_agreements[0].client_sign.via_link = { link_id: 'x', sent_by: 'kr@mo-care.com', sent_at: '2026-10-16T15:00:00Z', sent_to: 'x', code_via: 'sms', code_to: 'x', verified_at: '2026-10-16T15:01:00Z' }
    if (o.breakSteps) FAIL = 'client_journey'
    return { id, r: await call({ action: 'countersign', id, signature: SIG }) }
  }
  const lead = (id = 'L1') => T.app_data[0].data.find((l) => l.id === id)
  const step = (k) => lead().soc.steps.find((s) => s.id === k)

  let { r } = await setup()
  ck('countersign ticks Start of Care and the journey, and says so', r.status === 200 && r.j.steps.soc === 'ticked' && r.j.steps.journey === 'ticked', r.j)
  ck('SOC p1 "Care Agreement provided" and p2 "Signed Care Agreement received": done, Automatic, countersigned by Krystal', ['p1', 'p2'].every((k) => step(k).done_at && step(k).done_by === 'Automatic: signed in the Hub, countersigned by Krystal Office'), lead().soc.steps)
  ck('the note says how it was signed and where to open it', /Client Care Agreement signed on the tablet on \w+ \d+, 2026, countersigned by Krystal Office\. Open it from the Client Care Agreement card\./.test(step('p2').note), step('p2').note)
  ck('"uploaded to AxisCare" (p3) and billing (p4) stay for a person; the assessment (p0) is unchanged', !step('p3').done_at && !step('p4').done_at && step('p0').done_by === 'Krystal')
  ck('another client\'s Start of Care is never touched', lead('L2').soc.steps.every((s) => s.id === 'p0' || !s.done_at))
  const js = T.client_journey_step.find((s) => s.step_key === 'docs.agreement'), ev = T.client_journey_event.find((e) => e.step_key === 'docs.agreement')
  ck('journey: "Service agreement signed and on file" complete, by the Client Care Agreement, with the agreement as evidence', js && js.state === 'complete' && js.completed_by_name === 'Client Care Agreement (signed in the Hub)' && js.evidence.agreement.id === T.client_agreements[0].id && js.version === 1, js)
  ck('journey: an event is recorded (Verified by the Hub), and AxisCare upload (ax.docs) is left alone', ev && ev.kind === 'verified' && ev.detail.countersigned_by === 'Krystal Office' && !T.client_journey_step.some((s) => s.step_key === 'ax.docs'), ev)
  const saves = (T.rpc ?? []).filter((x) => x[0] === 'lead_put_if_same')
  ck('Start of Care is saved with the conflict-safe write, one lead only', saves.length === 1 && saves[0][1].p_id === 'L1')

  ;({ r } = await setup({ leads: [{ id: 'L1', axiscare_client_id: '296', soc: SOC({ steps: SOC().steps.map((s) => s.id === 'p1' ? { ...s, done_at: '2026-10-15T15:00:00Z', done_by: 'Samantha' } : s) }) }] }))
  ck('a step a person already ticked keeps their name; only the open one is ticked', step('p1').done_by === 'Samantha' && step('p2').done_by.startsWith('Automatic') && r.j.steps.soc === 'ticked')
  ;({ r } = await setup({ home: true }))
  ck('signed from home: the note says "from home"', /signed from home on/.test(step('p1').note) && r.j.steps.soc === 'ticked')
  globalThis.__leadRace = true
  ;({ r } = await setup()); globalThis.__leadRace = false
  ck('someone else changed the lead at the same moment: nothing is overwritten, it says conflict, the countersign still stands', r.status === 200 && r.j.steps.soc === 'conflict' && !step('p1').done_at && T.client_agreements[0].status === 'countersigned', r.j)
  ;({ r } = await setup({ leads: [{ id: 'L1', axiscare_client_id: '296', soc: SOC({ pathway: 'A1' }) }] }))
  ck('a Medicaid (not private pay) Start of Care is not touched', r.j.steps.soc === 'no_soc' && !lead().soc.steps.some((s) => s.id === 'p1' && s.done_at))
  ;({ r } = await setup({ leads: [{ id: 'L1', axiscare_client_id: '296', soc: SOC({ abandoned: true }) }] }))
  ck('a set-aside Start of Care is not touched', r.j.steps.soc === 'no_soc')
  ;({ r } = await setup({ leads: [] }))
  ck('no Start of Care for the client: nothing to tick, said plainly', r.j.steps.soc === 'no_soc')
  ;({ r } = await setup({ steps: [{ journey_id: 'J1', step_key: 'docs.agreement', state: 'complete', completed_by_name: 'Krystal Office', version: 3, evidence: { files: ['scan.pdf'] } }] }))
  ck('a journey step a person already completed (paper scan) is kept as it is', r.j.steps.journey === 'already' && T.client_journey_step[0].completed_by_name === 'Krystal Office' && T.client_journey_step[0].version === 3)
  ;({ r } = await setup({ journeys: [] }))
  ck('no journey for the client: said plainly', r.j.steps.journey === 'no_journey')
  ;({ r } = await setup({ journeys: [{ journey_id: 'J9', subject: 'client', axiscare_client_id: '296', status: 'closed', created_at: '2026-01-01' }] }))
  ck('a closed journey is not reopened', r.j.steps.journey === 'no_journey' && !T.client_journey_step.length)
  ;({ r } = await setup({ breakSteps: true }))
  ck('if the journey cannot be read, the countersign still stands and it says so', r.status === 200 && r.j.steps.journey === 'error' && T.client_agreements[0].status === 'countersigned', r.j); FAIL = null
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
const bad = res.filter((x) => !x[1])
for (const [n, okk, note] of res) console.log((okk ? 'PASS ' : 'FAIL ') + n + (note ? '\n     ' + note : ''))
console.log(`\n${res.length - bad.length}/${res.length} passed`); process.exit(bad.length ? 1 : 0)
