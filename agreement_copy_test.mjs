// agreement_copy_test.mjs · offline check of 873: "Signed electronically on ___" on the PDF, the family's printed copy with
// a big "COPY", and the emailed copy (codes hidden) sent through GoHighLevel on the office's tap. Nothing real is touched:
// the database, storage, Supabase Auth, the family send gate and GoHighLevel are fakes. Reads the PDFs' text with PyMuPDF
// (python3 -m pip install pymupdf).
//   PDFLIB=/path/to/pdf-lib/dist/pdf-lib.esm.js node agreement_copy_test.mjs [where to save the PDFs]
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
const PDFLIB = process.env.PDFLIB
if (!PDFLIB || !fs.existsSync(PDFLIB)) { console.log('Set PDFLIB to pdf-lib 1.17.1 dist/pdf-lib.esm.js (npm i pdf-lib@1.17.1).'); process.exit(2) }
const MASTER = fs.readFileSync('client-agreement/client-care-agreement-rev-2026-10.pdf')
const SIG = 'data:image/png;base64,' + fs.readFileSync('client-agreement/test-signature.png').toString('base64')
let T, FILES, FAIL, GHL, GATE
const reset = () => { FAIL = null; GHL = { calls: [], uploadStatus: 200, sendStatus: 201 }; GATE = { calls: [], refuse: false }; globalThis.__hours = { allowed: true }; FILES = { 'client-agreements/master/client-care-agreement-rev-2026-10.pdf': new Uint8Array(MASTER) }; T = {
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
globalThis.__db = { from: q, storage, rpc: async (fn, args) => { (T.rpc ?? (T.rpc = [])).push([fn, args]); return { data: { outcome: 'recorded' }, error: null } },
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


  const sign = async (id, extra = {}) => call({ action: 'sign', id, answers: { ...FAMILY, ...extra }, signer: { name: 'Nancy Anderson', role: 'representative', relationship: 'Wife' }, initials: { ...TAPS, poa: '2026-10-16T15:07:00Z' }, signature: SIG, consent: true })
  const FAM = { ...FAMILY, 'poa.name': 'Nancy Anderson', 'poa.relationship': 'Wife', 'access.3_garage_door_access_code': true, 'access.garage_code': '9753' }
  const textOf = async (bytes) => { const d = await PDFDocument.load(bytes); return d }
  const { execFileSync } = await import('child_process')
  const textCache = new Map()
  const pdfText = (bytes) => { const k = bytes; if (textCache.has(k)) return textCache.get(k); const f = path.join(tmp, 'x' + Math.random() + '.pdf'); fs.writeFileSync(f, bytes); const t = execFileSync('python3', ['-c', 'import sys, fitz; d = fitz.open(sys.argv[1]); sys.stdout.write(chr(12).join(p.get_text() for p in d))', f], { encoding: 'utf8' }); textCache.set(k, t); return t }
  const has = (bytes, s) => pdfText(bytes).includes(s)
  const pages = (bytes) => pdfText(bytes).split('\f').filter((x) => x.trim())
  const OUT = process.argv[2]

  // 1. countersign with the family's copy emailed
  reset(); let id = await start(); let r = await sign(id, FAM)
  ck('setup: the family signed', r.status === 200, r.j)
  r = await call({ action: 'countersign', id, signature: SIG, email_copy: { to: 'nancy@example.com' } })
  const a = T.client_agreements[0], orig = FILES['client-agreements/' + a.signed_pdf_path]
  ck('countersign + email: countersigned and the email reported as sent', r.status === 200 && a.status === 'countersigned' && r.j.email?.outcome === 'sent' && /nancy@example.com/.test(r.j.email.detail), r.j)
  ck('the original says "Signed electronically on" beside each signature and at the foot of every page', pages(orig).length === 24 && pages(orig).every((p) => /Signed electronically on October \d+, 2026 · Caring Companions Client Care Agreement/.test(p)) && (pdfText(orig).match(/Signed electronically on October \d+, 2026 at/g) || []).length >= 3, pdfText(orig).slice(0, 300))
  const od = await textOf(orig); ck('the original is still the 23 pages plus the signature record page', od.getPageCount() === 24)
  ck('the original has no "COPY" and keeps the lockbox and garage codes', !has(orig, 'COPY') && has(orig, '2468') && has(orig, '9753'))
  const up = GHL.calls.find((c) => c.kind === 'upload'), sent = GHL.calls.find((c) => c.kind === 'send')
  ck('the copy goes through the family send gate: family, a person\'s tap, email channel, sender client-agreement', GATE.calls.length === 1 && GATE.calls[0].opts.audience === 'family' && GATE.calls[0].opts.humanInitiated === true && GATE.calls[0].opts.channel === 'email' && GATE.calls[0].opts.sender === 'client-agreement' && GATE.calls[0].person.firstName === 'Nancy', GATE.calls)
  ck('GoHighLevel: the PDF is uploaded as a secure attachment to that contact, with the Hub\'s key', up && up.secure === 'true' && up.contactId === 'ct-nancy@example.com' && up.locationId === 'loc1' && up.auth === 'Bearer ghl-k' && up.name.endsWith('.pdf'), up && { ...up, bytes: up.bytes?.length })
  ck('the emailed copy has the big "COPY" and hides the codes ("on file with the office")', up && pages(up.bytes).every((p) => p.includes('COPY')) && has(up.bytes, 'on file with the office') && !has(up.bytes, '2468') && !has(up.bytes, '9753'))
  ck('the email: an Email to that contact, the attachment, her wording, no em dashes', sent && sent.body.type === 'Email' && sent.body.contactId === 'ct-nancy@example.com' && sent.body.attachments[0] === 'https://files.example/secure/abc'
    && sent.body.subject === 'Your signed Client Care Agreement' && /Hi Nancy,/.test(sent.body.html) && /Client Handbook/.test(sent.body.html) && /Edward/.test(sent.body.html) && !/—/.test(sent.body.html), sent?.body)
  const e1 = T.client_agreements[0].copies.emails[0]
  ck('the agreement records who it went to, when, by whom, and keeps the exact file that was sent', e1.to === 'nancy@example.com' && e1.by === 'kr@mo-care.com' && e1.outcome === 'sent' && FILES['client-agreements/' + e1.path], e1)
  if (OUT) { fs.writeFileSync(path.join(OUT, 'agreement-original.pdf'), orig); fs.writeFileSync(path.join(OUT, 'agreement-email-copy.pdf'), up.bytes) }

  // 2. the printed family copy
  r = await call({ action: 'copy_print', id })
  const pp = T.client_agreements[0].copies.print_path, pc = FILES['client-agreements/' + pp]
  ck('print copy: a 5-minute link, the open logged with who', r.status === 200 && r.j.expires_in === 300 && T.document_access_log.some((x) => x.doc === 'client_agreement_family_copy' && x.by_email === 'kr@mo-care.com'), r.j)
  ck('print copy: the big "COPY" on every page, codes kept (it stays in their home), same 24 pages', pc && pages(pc).length === 24 && pages(pc).every((p) => p.includes('COPY')) && has(pc, '2468'))
  const n0 = Object.keys(FILES).length; r = await call({ action: 'copy_print', id })
  ck('print copy again: the same stored copy, not a new file each time', r.status === 200 && Object.keys(FILES).length === n0)
  if (OUT) fs.writeFileSync(path.join(OUT, 'agreement-print-copy.pdf'), pc)
  r = await call({ action: 'list', client_ax: '296' })
  ck('list shows the copies (to, when, how it went), never the file paths', r.j.agreements[0].copies.emails[0].to === 'nancy@example.com' && r.j.agreements[0].copies.printed === true && !JSON.stringify(r.j.agreements[0].copies).includes('signed/'), r.j.agreements[0].copies)

  // 3. later sends from the card
  globalThis.__hours = { allowed: false }
  r = await call({ action: 'copy_email', id })
  ck('after 6pm: held, says when to send, nothing goes to GoHighLevel', r.j.email.outcome === 'held' && /8am to 6pm/.test(r.j.email.detail) && GHL.calls.length === 2 && GATE.calls.length === 1, r.j)
  globalThis.__hours = { allowed: true }
  r = await call({ action: 'copy_email', id }); ck('no address given: the primary contact\'s email is used', r.j.email.outcome === 'sent' && r.j.email.to === 'nancy@example.com', r.j)
  r = await call({ action: 'copy_email', id, to: 'tom at home' }); ck('a bad address: refused, nothing sent', r.status === 400 && GATE.calls.length === 2, r)
  GATE.refuse = true; r = await call({ action: 'copy_email', id, to: 'tom@example.com' })
  ck('the gate refuses (opted out): said plainly, nothing sent, recorded', r.j.email.outcome === 'refused' && /opted out/.test(r.j.email.detail) && T.client_agreements[0].copies.emails.at(-1).outcome === 'refused', r.j); GATE.refuse = false
  GHL.uploadStatus = 401; r = await call({ action: 'copy_email', id })
  ck('GoHighLevel refuses the attachment: not sent, said plainly, and a Needs Attention card is raised', r.j.email.outcome === 'failed' && /could not be attached/.test(r.j.email.detail) && (T.rpc ?? []).length > 0, { j: r.j, rpc: T.rpc }); GHL.uploadStatus = 200
  GHL.sendStatus = 500; r = await call({ action: 'copy_email', id }); ck('GoHighLevel refuses the email: not sent, said plainly', r.j.email.outcome === 'failed' && /refused/.test(r.j.email.detail), r.j); GHL.sendStatus = 201
  r = await call({ action: 'copy_email', id }, 'cg'); ck('a caregiver account cannot send copies (403)', r.status === 403, r)

  // 4. families who declined email, bad address at countersign, and before countersigning
  reset(); id = await start(); await sign(id, { ...FAM, 'comm.accept': false, 'comm.decline': true })
  r = await call({ action: 'countersign', id, signature: SIG, email_copy: { to: 'nancy@example.com' } })
  ck('they declined email (Permission to communicate): countersigned, but no email, and it says to print', r.status === 200 && T.client_agreements[0].status === 'countersigned' && r.j.email.outcome === 'refused' && /Print their copy/.test(r.j.email.detail) && !GHL.calls.length, r.j)
  reset(); id = await start(); await sign(id, FAM)
  r = await call({ action: 'countersign', id, signature: SIG, email_copy: { to: 'nancy at example' } })
  ck('a bad address at countersign: stopped before anything is signed, so it can be fixed', r.status === 400 && T.client_agreements[0].status === 'signed', r)
  r = await call({ action: 'countersign', id, signature: SIG })
  ck('countersign without the email: no email, nothing sent', r.status === 200 && r.j.email === null && !GHL.calls.length, r.j)
  reset(); id = await start(); await sign(id, FAM); r = await call({ action: 'copy_print', id }); ck('before countersigning there is no family copy', r.status === 409, r)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
const bad = res.filter((x) => !x[1])
for (const [n, okk, note] of res) console.log((okk ? 'PASS ' : 'FAIL ') + n + (note ? '\n     ' + note : ''))
console.log(`\n${res.length - bad.length}/${res.length} passed`); process.exit(bad.length ? 1 : 0)
