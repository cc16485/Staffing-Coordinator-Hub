// agreement_links_test.mjs · offline check of Stage 3 (874): the office sends a link (client-agreement link_send /
// link_cancel) and the family opens it, checks a 6-digit code, fills in and signs from home (agreement-sign, the public
// door). Nothing real is touched: database, storage, Supabase Auth, the family send gate and GoHighLevel are fakes.
//   PDFLIB=/path/to/pdf-lib/dist/pdf-lib.esm.js node agreement_links_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
const PDFLIB = process.env.PDFLIB
if (!PDFLIB || !fs.existsSync(PDFLIB)) { console.log('Set PDFLIB to pdf-lib 1.17.1 dist/pdf-lib.esm.js (npm i pdf-lib@1.17.1).'); process.exit(2) }
const MASTER = fs.readFileSync('client-agreement/client-care-agreement-rev-2026-10-18b.pdf'), MASTER_THIRD = fs.readFileSync('client-agreement/client-care-agreement-rev-2026-10-18.pdf'), MASTER_SECOND = fs.readFileSync('client-agreement/client-care-agreement-rev-2026-10-17.pdf'), MASTER_FIRST = fs.readFileSync('client-agreement/client-care-agreement-rev-2026-10.pdf')   // 2026-10-18: all three masters are stored
const SIG = 'data:image/png;base64,' + fs.readFileSync('client-agreement/test-signature.png').toString('base64')
let T, FILES, FAIL, GHL, GATE
const reset = () => { FAIL = null; GHL = { calls: [], uploadStatus: 200, sendStatus: 201 }; GATE = { calls: [], refuse: false }; globalThis.__hours = { allowed: true }; FILES = { 'client-agreements/master/client-care-agreement-rev-2026-10-18b.pdf': new Uint8Array(MASTER), 'client-agreements/master/client-care-agreement-rev-2026-10-18.pdf': new Uint8Array(MASTER_THIRD), 'client-agreements/master/client-care-agreement-rev-2026-10-17.pdf': new Uint8Array(MASTER_SECOND), 'client-agreements/master/client-care-agreement-rev-2026-10.pdf': new Uint8Array(MASTER_FIRST) }; T = {
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
const HANDLERS = []; let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { HANDLERS.push(h); handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_cag_'))
const shared = (s) => s.replace(/from '\.\.\/_shared\/([\w-]+)\.ts'/g, (_, m) => "from '" + path.join(tmp, m + '.ts') + "'").replace(/from '\.\/([\w-]+)\.ts'/g, (_, m) => "from '" + path.join(tmp, m + '.ts') + "'")
  .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db').replace("'https://esm.sh/pdf-lib@1.17.1'", JSON.stringify(PDFLIB))
try {
  fs.writeFileSync(path.join(tmp, 'outreach.ts'), 'export const contactForOutbound = (...a) => globalThis.__gate(...a)\nexport const maySend = (k) => k === "requested_external" ? { allowed: true } : globalThis.__hours\n')
  /* every shared module the functions import (the faked send gate, outreach.ts, is written above and kept) */
  for (const f of fs.readdirSync(path.join(F, '_shared')).filter((f) => f.endsWith('.ts') && f !== 'outreach.ts')) fs.writeFileSync(path.join(tmp, f), shared(fs.readFileSync(path.join(F, '_shared', f), 'utf8')))
  fs.writeFileSync(path.join(tmp, 'fn.ts'), shared(fs.readFileSync(path.join(F, 'client-agreement/index.ts'), 'utf8')))
  await import(path.join(tmp, 'fn.ts'))
  fs.writeFileSync(path.join(tmp, 'pub.ts'), shared(fs.readFileSync(path.join(F, 'agreement-sign/index.ts'), 'utf8')))
  await import(path.join(tmp, 'pub.ts'))
  const officeH = HANDLERS[0], publicH = HANDLERS[1]; handler = officeH
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



  const pub = async (body, ua = 'PhoneSafari/1') => { const r = await publicH(new Request('https://x/functions/v1/agreement-sign', { method: 'POST', headers: { 'Content-Type': 'application/json', 'user-agent': ua, 'cf-connecting-ip': '198.51.100.7' }, body: JSON.stringify(body) }))
    let j = null; try { j = await r.json() } catch { /* */ } return { status: r.status, j } }
  const FAM = { ...FAMILY, 'poa.name': 'Nancy Anderson', 'poa.relationship': 'Wife' }
  const SIGNER = { name: 'Nancy Anderson', role: 'representative', relationship: 'Wife' }
  const sends = () => GHL.calls.filter((c) => c.kind === 'send')
  const tokenOf = (m) => (String(m).match(/#t=([A-Za-z0-9_-]+)/) || [])[1]
  const codeOf = () => String(sends().at(-1).body.message || sends().at(-1).body.html).match(/(\d{6})/)[1]
  const L = () => T.client_agreement_links
  const send = (id, extra = {}) => call({ action: 'link_send', id, to_name: 'Nancy Anderson', phone: '417-863-7309', email: 'nancy@example.com', channels: ['sms', 'email'], client_name: 'Edward Anderson', ...extra })

  // ---------- the office sends the link ----------
  reset(); T.client_agreement_links = []; let id = await start()
  for (const [why, extra, field] of [['no name', { to_name: '' }, 'to_name'], ['no way picked', { channels: [] }, 'channels'], ['a short phone', { phone: '417-863' }, 'phone'], ['a bad email', { email: 'nancy at example' }, 'email']]) {
    const r = await send(id, extra); ck(`link: ${why} is refused before anything is sent`, r.status === 400 && r.j.field === field && !L().length && !GATE.calls.length, r.j) }
  globalThis.__hours = { allowed: false }
  let r = await send(id)
  ck('link: after 6pm nothing is sent, says when, and no live link is left behind', r.j.outcome === 'not_sent' && /8am and 6pm/.test(r.j.error) && !sends().length && L().length === 1 && L()[0].revoked_by === 'not delivered', r.j)
  globalThis.__hours = { allowed: true }
  r = await send(id)
  const sms = sends().find((c) => c.body.type === 'SMS'), mail = sends().find((c) => c.body.type === 'Email')
  const token = tokenOf(sms?.body.message)
  ck('link: texted and emailed through the family gate (family, a person\'s tap, sender agreement-link)', r.j.outcome === 'sent' && sms && mail && GATE.calls.slice(-2).every((g) => g.opts.audience === 'family' && g.opts.humanInitiated && g.opts.sender === 'agreement-link'), r.j)
  ck('link: the text is in her voice, with the link and the date it stops working, no em dashes', /^Hi Nancy, this is Caring Companions\. Here is the Client Care Agreement for Edward Anderson to look over and sign: https:\/\/cc\.mo-care\.com\/sign\.html#t=/.test(sms.body.message) && /works until \w+ \d+, 2026/.test(sms.body.message) && !/—/.test(sms.body.message + mail.body.html), sms.body.message)
  ck('link: the email has an Open the agreement button and says a code will be sent', /Open the agreement/.test(mail.body.html) && /6-digit code/.test(mail.body.html) && tokenOf(mail.body.html) === token)
  const live = L().find((x) => !x.revoked_at)
  ck('link: only a hash of the secret is stored, never the secret', token && token.length >= 40 && !JSON.stringify(T).includes(token) && /^[0-9a-f]{64}$/.test(live.token_hash))
  ck('link: works for 7 days', Math.abs(Date.parse(live.expires_at) - Date.now() - 7 * 864e5) < 60e3)
  r = await call({ action: 'list', client_ax: '296' })
  ck('card: the link shows who it went to (masked), how, and that it is live; no hash', r.j.agreements[0].link.to_phone === '(417) ***-7309' && r.j.agreements[0].link.to_email === 'n****@example.com' && r.j.agreements[0].link.live === true && !JSON.stringify(r.j).includes(live.token_hash), r.j.agreements[0].link)
  r = await call({ action: 'link_send', id, to_name: 'Nancy Anderson', phone: '4178637309', channels: ['sms'] }, 'cg'); ck('a caregiver account cannot send links (403)', r.status === 403)

  // ---------- the family opens it ----------
  r = await pub({ action: 'open', t: 'short' }); ck('door: a cut-off link says so', r.status === 400 && r.j.outcome === 'bad_link')
  r = await pub({ action: 'open', t: 'A'.repeat(43) }); ck('door: a made-up link does not work', r.status === 404 && r.j.outcome === 'bad_link')
  r = await pub({ action: 'open', t: token })
  ck('door: open asks for a code, offering the masked phone and email', r.status === 200 && r.j.state === 'need_code' && r.j.to_name === 'Nancy Anderson' && r.j.options.map((o) => o.to).join() === '(417) ***-7309,n****@example.com' && live.opened_at, r.j)
  r = await pub({ action: 'get', t: token }); ck('door: nothing opens without the code', r.status === 401 && r.j.outcome === 'need_code' && !r.j.agreement)
  r = await pub({ action: 'get', t: token, s: 'B'.repeat(43) }); ck('door: a made-up session does not open it', r.status === 401)
  globalThis.__hours = { allowed: false }
  r = await pub({ action: 'code', t: token, via: 'sms' })
  const codeGate = GATE.calls.at(-1)
  ck('code: sent at any hour (her answer), through the family gate as something they asked for', r.status === 200 && r.j.to === '(417) ***-7309' && codeGate.kind === 'requested_external' && codeGate.opts.sender === 'agreement-code' && codeGate.person.phone, r.j)
  globalThis.__hours = { allowed: true }
  let code = codeOf()
  ck('code: "Your Caring Companions code is ######. It works for 10 minutes."', /^Your Caring Companions code is \d{6}\. It works for 10 minutes\./.test(sends().at(-1).body.message))
  ck('code: only its hash is stored', !JSON.stringify(T.client_agreement_links).includes(code) && /^[0-9a-f]{64}$/.test(live.code_hash))
  r = await pub({ action: 'code', t: token, via: 'sms' }); ck('code: a second one right away is refused (wait a minute)', r.status === 429 && r.j.outcome === 'wait')
  r = await pub({ action: 'code', t: token, via: 'fax' }); ck('code: only the ways on the link', r.status === 429 || r.status === 400)
  const wrong = code === '000000' ? '111111' : '000000'
  r = await pub({ action: 'verify', t: token, code: wrong }); ck('verify: a wrong code says how many tries are left', r.status === 400 && /4 tries left/.test(r.j.error), r.j)
  for (let i = 0; i < 4; i++) r = await pub({ action: 'verify', t: token, code: wrong })
  r = await pub({ action: 'verify', t: token, code }); ck('verify: after 5 wrong tries even the right code is refused (send a new one)', r.status === 429 && r.j.outcome === 'too_many', r.j)
  live.code_sent_at = new Date(Date.now() - 60e3).toISOString()
  r = await pub({ action: 'code', t: token, via: 'email' }); code = codeOf()
  ck('code: by email too, when asked', r.status === 200 && sends().at(-1).body.type === 'Email' && /Your code to open the Client Care Agreement/.test(sends().at(-1).body.html))
  live.code_expires_at = new Date(Date.now() - 1000).toISOString()
  r = await pub({ action: 'verify', t: token, code }); ck('verify: an expired code is refused', r.status === 400 && r.j.outcome === 'code_expired')
  live.code_sent_at = new Date(Date.now() - 60e3).toISOString(); await pub({ action: 'code', t: token, via: 'sms' }); code = codeOf()
  r = await pub({ action: 'verify', t: token, code: code.slice(0, 3) + ' ' + code.slice(3) })
  const sess = r.j.s
  ck('verify: the right code (spaces are fine) opens a 2-hour session with the agreement', r.status === 200 && sess && r.j.agreement.status === 'draft' && r.j.form.version === 'Rev. 10/2026' && live.verified_via === 'sms' && !live.code_hash, r.j)
  ck('the family sees only their agreement: no office names, no created_by, no signatures', !('created_by' in r.j.agreement) && !JSON.stringify(r.j.agreement).includes('Krystal') && !('client_sign' in r.j.agreement))
  ck('only the session\'s hash is stored', !JSON.stringify(T.client_agreement_links).includes(sess))
  r = await pub({ action: 'verify', t: token, code }); ck('verify: a code works once', r.status === 400)
  r = await pub({ action: 'save', t: token, s: sess, answers: { 'level.hourly_rate': '1' } }); ck('save: the family cannot change the office\'s rate', r.status === 422, r.j)
  r = await pub({ action: 'save', t: token, s: sess, answers: FAM }); ck('save: their answers are saved', r.status === 200 && T.client_agreements[0].answers['c1.name'] === 'Nancy Anderson', r.j)
  r = await pub({ action: 'sign', t: token, s: sess, answers: FAM, signer: SIGNER, initials: { ...TAPS, poa: '2026-10-17T15:07:00Z' }, signature: SIG, consent: false })
  ck('sign: the e-sign consent is still required', r.status === 400 && T.client_agreements[0].status === 'draft')
  r = await pub({ action: 'sign', t: token, s: sess, answers: FAM, signer: SIGNER, initials: { ...TAPS, poa: '2026-10-17T15:07:00Z' }, signature: SIG, consent: true })
  const cs = T.client_agreements[0].client_sign
  ck('sign: signed from home, with the link and the code check recorded (masked), their phone\'s device', r.status === 200 && T.client_agreements[0].status === 'signed' && cs.via_link.code_via === 'sms' && cs.via_link.code_to === '(417) ***-7309' && cs.via_link.sent_by === 'kr@mo-care.com' && cs.agent === 'PhoneSafari/1' && !cs.on_staff_session, cs)
  ck('sign: the link is closed and the session ended', live.signed_at && !live.session_hash)
  const card = (T.rpc ?? []).find((x) => x[0] === 'upsert_app_data_item' && x[1].item.kind === 'agreement_countersign')
  ck('Needs Attention: "Nancy Anderson signed the Client Care Agreement from home", for the client care team', card && card[1].item.title === 'Nancy Anderson signed the Client Care Agreement from home' && card[1].item.domain === 'client_care' && /Countersign it for Edward Anderson/.test(card[1].item.detail), card)
  r = await pub({ action: 'open', t: token }); ck('door: after signing, the link just says it is signed', r.status === 200 && r.j.state === 'signed')
  r = await call({ action: 'countersign', id, signature: SIG })
  const { execFileSync } = await import('child_process'); const f = path.join(tmp, 'remote.pdf'); fs.writeFileSync(f, FILES['client-agreements/' + T.client_agreements[0].signed_pdf_path])
  const txt = execFileSync('python3', ['-c', 'import sys, fitz; d = fitz.open(sys.argv[1]); sys.stdout.write(d[-1].get_text())', f], { encoding: 'utf8' })
  ck('the signature record page says it was signed from home and how the code was checked', r.status === 200 && /Signed from home/.test(txt) && /Identity check/.test(txt) && /6-digit code sent by text to \(417\) \*\*\*-7309/.test(txt) && !/Signed on the tablet of/.test(txt), txt.slice(0, 900))
  r = await call({ action: 'list', client_ax: '296' }); ck('card: shows it was signed from home', r.j.agreements[0].signed_from_home === true && r.j.agreements[0].link.signed_at)

  // ---------- replaced, cancelled, expired, tablet ----------
  reset(); T.client_agreement_links = []; id = await start(); await send(id); const t1 = tokenOf(sends().at(-2).body.message); await send(id); const t2 = tokenOf(sends().at(-2).body.message)
  ck('a new link replaces the old one: one live link only', L().filter((x) => !x.revoked_at).length === 1 && /replaced/.test(L()[0].revoked_by))
  r = await pub({ action: 'open', t: t1 }); ck('door: the replaced link says to use the newest one', r.status === 410 && r.j.outcome === 'cancelled', r.j)
  r = await call({ action: 'link_cancel', id }); r = await pub({ action: 'open', t: t2 }); ck('door: a cancelled link does not open', r.status === 410 && L().every((x) => x.revoked_at))
  await send(id); const t3 = tokenOf(sends().at(-2).body.message); L().find((x) => !x.revoked_at).expires_at = new Date(Date.now() - 1000).toISOString()
  r = await pub({ action: 'open', t: t3 }); ck('door: an expired link says to call for a new one', r.status === 410 && r.j.outcome === 'expired')
  await send(id); const lv = L().find((x) => !x.revoked_at)
  r = await call({ action: 'sign', id, answers: FAM, signer: SIGNER, initials: { ...TAPS, poa: '2026-10-17T15:07:00Z' }, signature: SIG, consent: true })
  ck('signed on the tablet instead: the home link is closed', r.status === 200 && lv.revoked_by === 'signed on the tablet instead' && !('signer' in r.j), r.j)
  reset(); T.client_agreement_links = []; id = await start(); await send(id); const t4 = tokenOf(sends().at(-2).body.message); await pub({ action: 'open', t: t4 }); await pub({ action: 'code', t: t4, via: 'sms' }); const c4 = codeOf()
  const s4 = (await pub({ action: 'verify', t: t4, code: c4 })).j.s; L()[0].session_expires_at = new Date(Date.now() - 1000).toISOString()
  r = await pub({ action: 'get', t: t4, s: s4 }); ck('door: after 2 hours the session ends and asks for a code again', r.status === 401 && r.j.outcome === 'need_code')
  for (let i = 0; i < 6; i++) { L()[0].code_sent_at = new Date(Date.now() - 60e3).toISOString(); r = await pub({ action: 'code', t: t4, via: 'sms' }) }
  ck('code: at most 6 codes per link', r.status === 429 && r.j.outcome === 'too_many', r.j)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
const bad = res.filter((x) => !x[1])
for (const [n, okk, note] of res) console.log((okk ? 'PASS ' : 'FAIL ') + n + (note ? '\n     ' + note : ''))
console.log(`\n${res.length - bad.length}/${res.length} passed`); process.exit(bad.length ? 1 : 0)
