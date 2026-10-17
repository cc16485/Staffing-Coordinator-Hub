// client_agreement_test.mjs · offline check of the client-agreement function (Stage 1, 2026-10-16). Nothing real is touched:
// the database, storage and Supabase Auth are fakes. Needs pdf-lib 1.17.1 on disk for the signed-PDF step:
//   PDFLIB=/path/to/node_modules/pdf-lib/dist/pdf-lib.esm.js node client_agreement_test.mjs [where to save the signed PDF]
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
const PDFLIB = process.env.PDFLIB
if (!PDFLIB || !fs.existsSync(PDFLIB)) { console.log('Set PDFLIB to pdf-lib 1.17.1 dist/pdf-lib.esm.js (npm i pdf-lib@1.17.1).'); process.exit(2) }
const MASTER = fs.readFileSync('client-agreement/client-care-agreement-rev-2026-10.pdf')
const SIG = 'data:image/png;base64,' + fs.readFileSync('client-agreement/test-signature.png').toString('base64')
let T, FILES, FAIL
const reset = () => { FAIL = null; FILES = { 'client-agreements/master/client-care-agreement-rev-2026-10.pdf': new Uint8Array(MASTER) }; T = {
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
    if (st.op === 'update') { const hit = rows.filter(match); hit.forEach((r) => Object.assign(r, clone(st.row))); return { data: clone(hit), error: null } }
    return { data: clone(rows.filter(match)), error: null } }
  const b = { select() { return b }, eq(c, v) { st.f.push([c, v]); return b }, in(c, vs) { st.ins.push([c, vs]); return b }, is(c) { st.isnull.push(c); return b }, limit() { return b }, order() { return b },
    insert(r) { st.op = 'insert'; st.row = r; return b }, update(r) { st.op = 'update'; st.row = r; return b },
    maybeSingle() { const r = run(); return Promise.resolve({ data: r.data ? r.data[0] ?? null : null, error: r.error }) },
    then(ok, no) { return Promise.resolve(run()).then(ok, no) } }; return b }
const storage = { from: (bucket) => ({
  upload: async (p, bytes, o) => { const k = bucket + '/' + p; if (FILES[k] && !o.upsert) return { error: { message: 'exists' } }; FILES[k] = new Uint8Array(bytes); return { data: { path: p }, error: null } },
  download: async (p) => FILES[bucket + '/' + p] ? { data: new Blob([FILES[bucket + '/' + p]]), error: null } : { data: null, error: { message: 'not found' } },
  createSignedUrl: async (p, s) => ({ data: { signedUrl: `https://x/sign/${bucket}/${p}?e=${s}` }, error: null }) }) }
globalThis.__db = { from: q, storage,
  auth: { getUser: async (jwt) => ({ kr: 'u-kr', cg: 'u-cg' })[jwt] ? { data: { user: { id: ({ kr: 'u-kr', cg: 'u-cg' })[jwt], email: jwt + '@mo-care.com', app_metadata: {} } }, error: null } : { data: { user: null }, error: { message: 'bad' } } } }
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_cag_'))
const shared = (s) => s.replace(/from '\.\.\/_shared\/([\w-]+)\.ts'/g, (_, m) => "from '" + path.join(tmp, m + '.ts') + "'").replace(/from '\.\/([\w-]+)\.ts'/g, (_, m) => "from '" + path.join(tmp, m + '.ts') + "'")
  .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db').replace("'https://esm.sh/pdf-lib@1.17.1'", JSON.stringify(PDFLIB))
try {
  for (const m of ['staff-auth', 'doc-log', 'client-agreement', 'client-agreement-map', 'agreement-pdf', 'agreement-contacts']) fs.writeFileSync(path.join(tmp, m + '.ts'), shared(fs.readFileSync(path.join(F, '_shared', m + '.ts'), 'utf8')))
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

  reset(); let r = await call(null, null, 'OPTIONS'); ck('browser preflight: CORS allows the Hub headers (x-cc-via)', r.status === 200 && /x-cc-via/.test(r.h.get('access-control-allow-headers') || ''))
  reset(); r = await call({ action: 'form' }, null); ck('no sign-in: refused (401)', r.status === 401, r)
  reset(); r = await call({ action: 'form' }, 'cg'); ck('a caregiver account: refused (403)', r.status === 403, r)
  reset(); r = await call({ action: 'form' }); ck('form: every field of the agreement, the six initials, the consent words', r.status === 200 && Object.keys(r.j.form.fields).length === 160 && Object.keys(r.j.form.initials).length === 6 && /electronically/.test(r.j.form.esign_words), r.j)
  reset(); r = await call({ action: 'start', client_ax: 'abc', office: OFFICE }); ck('start: a bad client id is refused', r.status === 400, r)
  reset(); r = await call({ action: 'start', client_ax: '296', office: { 'client.client_s_name': 'x' } }); ck('start: the office cannot fill in family fields', r.status === 422 && !T.client_agreements.length, r)
  reset(); r = await call({ action: 'start', client_ax: '296', office: OFFICE, addenda: ['va', 'nope'], start_date: '2026-10-20' })
  const a0 = T.client_agreements[0]
  ck('start: one draft, the office level and rate kept, only known addenda, the master fingerprint recorded', r.status === 200 && a0.status === 'draft' && a0.office.answers['level.personal_care'] === true && a0.office.addenda.join() === 'va' && /^d2c6/.test(a0.pdf_sha256) && a0.created_by === 'kr@mo-care.com', a0)

  reset(); let id = await start()
  r = await call({ action: 'save', id, answers: { 'level.hourly_rate': '20' } }); ck('save: the family cannot change the rate', r.status === 422 && T.client_agreements[0].office.answers['level.hourly_rate'] === '32', r)
  r = await call({ action: 'save', id, answers: { 'sig.client.signature': 'x', 'ini.1': 'x' } }); ck('save: signatures and initials cannot be typed in as answers', r.status === 422, r)
  r = await call({ action: 'save', id, answers: { 'c1.name': 'x'.repeat(201) } }); ck('save: an over-long answer is refused', r.status === 422, r)
  r = await call({ action: 'save', id, answers: { ...FAMILY, 'c9.name': 'nobody' } }); ck('save: an unknown field is refused, nothing half-saved', r.status === 422 && !Object.keys(T.client_agreements[0].answers).length, r)
  r = await call({ action: 'save', id, answers: FAMILY }); ck('save: the family answers are kept on the draft', r.status === 200 && T.client_agreements[0].answers['c1.name'] === 'Nancy Anderson', r)

  const sign = (x = {}) => call({ action: 'sign', id, answers: FAMILY, signer: { name: 'Edward Anderson', role: 'client' }, initials: TAPS, signature: SIG, consent: true, ...x })
  r = await sign({ consent: false }); ck('sign: no e-sign consent, refused', r.status === 400 && r.j.field === 'consent', r)
  r = await sign({ answers: { ...FAMILY, 'backup.full_name': '' } }); ck('sign: the backup caregiver is required', r.status === 422 && r.j.problems.some((p) => p.field === 'backup.full_name'), r.j)
  r = await sign({ answers: { ...FAMILY, 'c1.hipaa_no': true } }); ck('sign: HIPAA Yes and No both ticked, refused', r.status === 422 && r.j.problems.some((p) => /only one/i.test(p.error)), r.j)
  r = await sign({ answers: { ...FAMILY, 'photos.no_photos': true } }); ck('sign: "No photos" with another photo choice, refused', r.status === 422 && r.j.problems.some((p) => p.field === 'photos.no_photos'), r.j)
  r = await sign({ answers: { ...FAMILY, 'c2.name': 'Tom' } }); ck('sign: a second contact needs their HIPAA and medical answers', r.status === 422 && r.j.problems.some((p) => p.field === 'c2.hipaa_yes'), r.j)
  r = await sign({ initials: { ...TAPS, 6: '' } }); ck('sign: all six initials must be tapped', r.status === 422 && r.j.problems.some((p) => p.field === 'ini.6'), r.j)
  r = await sign({ signature: 'data:image/png;base64,AAAA' }); ck('sign: an empty or tiny signature is refused', r.status === 422 && r.j.problems.some((p) => p.field === 'signature'), r.j)
  r = await sign({ signer: { name: 'Edward', role: 'client' } }); ck('sign: a full typed name is required', r.status === 422 && r.j.problems.some((p) => p.field === 'signer.name'), r.j)
  r = await sign({ signer: { name: 'Nancy Anderson', role: 'representative' } }); ck('sign: a representative needs the POA section and the POA initials', r.status === 422 && r.j.problems.some((p) => p.field === 'poa.name') && r.j.problems.some((p) => p.field === 'poa.initials'), r.j)
  ck('nothing was signed by the refused attempts', T.client_agreements[0].status === 'draft' && !Object.keys(FILES).some((k) => k.includes('/sig/')))
  r = await call({ action: 'countersign', id, signature: SIG }); ck('countersign before the client signs: refused', r.status === 409, r)
  r = await sign()
  const a1 = T.client_agreements[0]
  ck('sign: signed, with typed name, initials, time, device, consent words and the signature file', r.status === 200 && a1.status === 'signed' && a1.client_sign.typed_name === 'Edward Anderson' && a1.client_sign.initials_text === 'EA'
    && a1.client_sign.ip === '203.0.113.9' && a1.client_sign.agent === 'TabletSafari/1' && /electronically/.test(a1.client_sign.consent_words) && FILES['client-agreements/' + a1.client_sign.signature_path], a1.client_sign)
  ck('sign: the tablet session that hosted the signing is recorded', a1.client_sign.on_staff_session.email === 'kr@mo-care.com')
  r = await sign(); ck('sign twice: refused as stale', r.status === 409, r)
  r = await call({ action: 'save', id, answers: FAMILY }); ck('save after signing: refused', r.status === 409, r)
  r = await call({ action: 'open', id }); ck('open before countersigning: no PDF yet', r.status === 404, r)

  r = await call({ action: 'countersign', id, signature: SIG })
  const a2 = T.client_agreements[0], pdfBytes = FILES['client-agreements/' + a2.signed_pdf_path]
  ck('countersign: countersigned by the signed-in office person, PDF saved', r.status === 200 && a2.status === 'countersigned' && a2.office_sign.typed_name === 'Krystal Office' && pdfBytes, r)
  const doc = await PDFDocument.load(pdfBytes)
  ck('signed PDF: the 23 agreement pages plus the signature record page', doc.getPageCount() === 24, doc.getPageCount())
  if (process.argv[2]) fs.writeFileSync(path.join(process.argv[2], 'signed-test-agreement.pdf'), pdfBytes)
  r = await call({ action: 'countersign', id, signature: SIG }); ck('countersign twice: refused', r.status === 409, r)
  r = await call({ action: 'open', id }); ck('open: a 5-minute link, and the open is logged with who', r.status === 200 && r.j.expires_in === 300 && T.document_access_log.length === 1 && T.document_access_log[0].by_email === 'kr@mo-care.com' && T.document_access_log[0].offer_id === 'client:296', r.j)
  FAIL = 'document_access_log'; r = await call({ action: 'open', id }); ck('open: if the open cannot be logged, it is not opened', r.status === 500 && !r.j.url, r); FAIL = null
  r = await call({ action: 'void', id, reason: 'mistake made' }); ck('void: a countersigned agreement is kept', r.status === 409, r)
  r = await call({ action: 'list', client_ax: '296' }); ck('list: the client\'s agreements, without signature images or file paths', r.status === 200 && r.j.agreements.length === 1 && r.j.agreements[0].has_pdf && !JSON.stringify(r.j).includes('sig/296'), r.j)

  reset(); id = await start(); r = await call({ action: 'void', id, reason: 'no' }); ck('void: needs a reason', r.status === 400, r)
  r = await call({ action: 'void', id, reason: 'family changed their mind' }); ck('void: a draft is set aside with the reason and who', r.status === 200 && T.client_agreements[0].status === 'void' && /Krystal/.test(T.client_agreements[0].void_reason), r)

  reset(); id = await start(); await call({ action: 'sign', id, answers: { ...FAMILY, 'client.client_s_name': 'Zoë “Bea” Núñez 👵' }, signer: { name: 'Zoë Núñez', role: 'client' }, initials: TAPS, signature: SIG, consent: true })
  r = await call({ action: 'countersign', id, signature: SIG }); ck('accents, curly quotes and emoji do not break the signed PDF', r.status === 200 && T.client_agreements[0].status === 'countersigned', r)

  reset(); id = await start(); await sign(); FILES['client-agreements/master/client-care-agreement-rev-2026-10.pdf'] = new Uint8Array([1, 2, 3])
  r = await call({ action: 'countersign', id, signature: SIG }); ck('a master PDF that is not the one the family read: refused, nothing marked countersigned', r.status === 500 && T.client_agreements[0].status === 'signed' && !T.client_agreements[0].signed_pdf_path, r)

  reset(); FAIL = 'client_agreements'; r = await call({ action: 'list', client_ax: '296' }); ck('a database failure: a plain error, not a crash', r.status === 500 && /went wrong/.test(r.j.error), r)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
const bad = res.filter((x) => !x[1])
for (const [n, okk, note] of res) console.log((okk ? 'PASS ' : 'FAIL ') + n + (note ? '\n     ' + note : ''))
console.log(`\n${res.length - bad.length}/${res.length} passed`); process.exit(bad.length ? 1 : 0)
