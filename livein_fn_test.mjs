// Live-In Caregiver Agreement signed on a phone · the rules, the PDF and the real function against a fake database
//   PDFLIB=/path/to/pdf-lib/dist/pdf-lib.esm.js node livein_fn_test.mjs [folder to save the PDFs in]
import fs from 'fs'; import path from 'path'
const PDFLIB = process.env.PDFLIB
if (!PDFLIB || !fs.existsSync(PDFLIB)) { console.log('Set PDFLIB to pdf-lib 1.17.1 dist/pdf-lib.esm.js (npm i pdf-lib@1.17.1).'); process.exit(2) }
const OUT = process.argv[2] || ''
const res = []; const ck = (n, c, d) => res.push([n, !!c, c ? '' : String(JSON.stringify(d ?? null)).slice(0, 700)])
const FN = 'supabase/functions'
const MASTER_BYTES = new Uint8Array(fs.readFileSync('livein-agreement/live-in-caregiver-agreement-rev-2026-10.pdf'))
const SIG = 'data:image/png;base64,' + fs.readFileSync('livein-agreement/test-signature.b64', 'utf8').trim()
const { PDFDocument } = await import(PDFLIB)

/* the shared file, with pdf-lib from disk (esm.sh in Deno) */
const shared = fs.readFileSync(`${FN}/_shared/livein.ts`, 'utf8').replace("'https://esm.sh/pdf-lib@1.17.1'", JSON.stringify(PDFLIB))
const ap = fs.readFileSync(`${FN}/_shared/agreement-pdf.ts`, 'utf8').replace("'https://esm.sh/pdf-lib@1.17.1'", JSON.stringify(PDFLIB))
fs.writeFileSync(`${FN}/_shared/_lv_agreement-pdf.ts`, ap)
fs.writeFileSync(`${FN}/_shared/_lv_livein.ts`, shared.replace("'./agreement-pdf.ts'", "'./_lv_agreement-pdf.ts'"))
const R = await import(path.join(process.cwd(), FN, '_shared/_lv_livein.ts'))

// ---- the rules ----
const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', MASTER_BYTES))].map((x) => x.toString(16).padStart(2, '0')).join('')
ck('the master in the repo is the approved one (sha256 matches)', sha === R.MASTER.sha, sha)
ck('12 pages, kept in hr-docs under master/', R.MASTER.pages === 12 && /^master\/.+\.pdf$/.test(R.MASTER.path) && (await PDFDocument.load(MASTER_BYTES)).getPageCount() === 12)
ck('the list is her two: Rhonda Blakemore and Sheryelle Dunniehigh', R.PEOPLE.length === 2 && R.PEOPLE.includes('Rhonda Blakemore') && R.PEOPLE.includes('Sheryelle Dunniehigh'))
const link = R.linkFor(R.newToken())
ck('a private link: a long random code on cc.mo-care.com/livein.html', /^https:\/\/cc\.mo-care\.com\/livein\.html\?t=[A-Za-z0-9_-]{43}$/.test(link) && R.LINK_RE.test(link), link)
const d = R.draftText('Rhonda Blakemore', 'Samantha Troutman', link)
ck('the text: their first name, who sends it, the link, the office number; no surname, no pay, no em dash', /^Hi Rhonda, this is Samantha at Caring Companions\./.test(d) && d.includes(link) && /417\) 234-8494/.test(d) && !/Blakemore|Troutman|\$|—/.test(d) && d.length < R.MAX_TEXT, d)
ck('...with no sender name, it still reads', /^Hi Rhonda, this is Caring Companions\./.test(R.draftText('Rhonda Blakemore', '', link)))
ck('her own pay statement and the consent words, no em dashes', /\$250\.00 live-in assignment rate/.test(R.STATEMENT) && /all 12 pages/.test(R.CONSENT) && !/—/.test(R.STATEMENT + R.CONSENT))
ck('a finger signature: a PNG data URL is taken', R.sigOf(SIG).length > 200)
ck('...anything else is refused (empty, not a PNG, a JPEG, too big)', !R.sigOf('') && !R.sigOf('data:image/png;base64,' + Buffer.from('GIF89a' + 'x'.repeat(300)).toString('base64'))
  && !R.sigOf(SIG.replace('image/png', 'image/jpeg')) && !R.sigOf('data:image/png;base64,' + 'A'.repeat(400004)) && !R.sigOf('data:image/png;base64,iVBORw0KGgo='))
ck('names: a full name that matches is taken; one word or another person is not', R.nameMatches('Rhonda Blakemore', 'Rhonda Blakemore') && R.nameMatches('rhonda  k blakemore', 'Rhonda Blakemore') && !R.nameMatches('Rhonda', 'Rhonda Blakemore') && !R.nameMatches('Pat Doe', 'Rhonda Blakemore'))

/* the PDF: the master untouched except page 12, plus the record page */
const at = new Date('2026-10-29T21:52:00Z'), at2 = new Date('2026-10-30T15:10:00Z')
const emp = { name: 'Rhonda Blakemore', sig: R.sigOf(SIG), at, ip: '1.2.3.4', agent: 'TestPhone' }
const one = await R.signedPdf({ master: MASTER_BYTES, row: { id: 'r1', practice: false }, employee: emp })
const both = await R.signedPdf({ master: MASTER_BYTES, row: { id: 'r1', practice: false }, employee: emp, rep: { name: 'Samantha Troutman', sig: R.sigOf(SIG), at: at2, email: 'samantha@mo-care.com' } })
const D1 = await PDFDocument.load(one), D2 = await PDFDocument.load(both)
ck('the signed PDF: 12 pages of the agreement and 1 signature record page', D1.getPageCount() === 13 && D2.getPageCount() === 13)
const raw = (b) => Buffer.from(b).toString('latin1')
/* the words drawn on the pages, from every content stream pdf-lib wrote (compressed) */
const zlib = await import('zlib')
const drawn = (b) => { const s = raw(b), out = []; let i = 0
  while ((i = s.indexOf('stream', i)) > -1) { const st = s.indexOf('\n', i) + 1, en = s.indexOf('endstream', st); if (en < 0) break
    try { out.push(zlib.inflateSync(Buffer.from(s.slice(st, en), 'latin1')).toString('latin1')) } catch { /* not a compressed stream */ } i = en + 9 }
  return out.join('\n') }
const has = (b, t) => drawn(b).includes('<' + Buffer.from(t, 'latin1').toString('hex').toUpperCase() + '>')
ck('...page 12 has the employee name and date written on it; the record page says who, when, and that it is not countersigned yet', has(one, 'Rhonda Blakemore') && has(one, 'October 29, 2026') && has(one, 'Not countersigned yet.'))
ck('...countersigned: the representative and their date, no "not countersigned" line', has(both, 'Samantha Troutman') && has(both, 'October 30, 2026') && !has(both, 'Not countersigned yet.'))
ck('...the fingerprint of the master is on the record page', drawn(both).includes(Buffer.from(R.MASTER.sha.slice(0, 20)).toString('hex').toUpperCase()))
ck('...pages 1 to 11 are the master\'s own pages, unchanged', (await Promise.all([...Array(11).keys()].map(async (i) => {
  const a = (await PDFDocument.load(MASTER_BYTES)).getPages()[i].node.Contents(), b = D2.getPages()[i].node.Contents(); return String(a) === String(b) }))).every(Boolean))
if (OUT) { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'livein-employee-signed.pdf'), one); fs.writeFileSync(path.join(OUT, 'livein-countersigned.pdf'), both) }

// ---- the function ----
let T, APP, STORE, SENT, OPEN_LOG, WHO, NOW_OWNERKEY
const reset = (o = {}) => {
  APP = { caregivers: [{ first: 'Rhonda', last: 'Blakemore', axiscare_id: '77', phone: '4175550100' }, { first: 'Sheryelle', last: 'Dunniehigh', axiscare_id: '78', phone: '' }], ops_items: [] }
  T = { livein_sign: [], livein_sign_event: [] }; STORE = { 'master/live-in-caregiver-agreement-rev-2026-10.pdf': o.badMaster ? new Uint8Array([1, 2, 3]) : MASTER_BYTES }
  SENT = []; OPEN_LOG = []; WHO = o.who === undefined ? 'samantha' : o.who; NOW_OWNERKEY = false
}
let idn = 0
const uuid = () => '00000000-0000-4000-8000-' + String(++idn).padStart(12, '0')
const q = (t) => { const st = { f: [], op: 'select' }; const rows = () => (T[t] || []).filter((x) => st.f.every(([c, v]) => x[c] === v))
  const fin = () => {
    if (t === 'app_data') { const k = st.f.find(([c]) => c === 'key')[1]; return { data: k in APP ? { data: APP[k] } : null, error: null } }
    if (st.op === 'insert') { if (t === 'livein_sign') { const r = { id: uuid(), status: 'waiting', started_at: new Date().toISOString(), ...st.row }; T.livein_sign.push(r); return { data: r, error: null } } T[t].push({ ...st.row }); return { data: null, error: null } }
    if (st.op === 'update') { const hit = rows(); for (const x of hit) Object.assign(x, st.row); return { data: hit[0] || null, error: null } }
    return { data: rows(), error: null } }
  const b = { select(c) { if (typeof c === 'string' && c !== '*') st.cols = c.split(','); return b }, eq(c, v) { st.f.push([c, v]); return b }, order() { return b }, limit() { return b },
    insert(row) { st.op = 'insert'; st.row = row; return b }, update(row) { st.op = 'update'; st.row = row; return b },
    single() { const r = fin(); let d = Array.isArray(r.data) ? r.data[0] : r.data; if (d && st.cols) d = Object.fromEntries(st.cols.map((c) => [c, d[c]])); return Promise.resolve({ data: d, error: r.error }) },
    maybeSingle() { const r = fin(); let d = Array.isArray(r.data) ? (r.data[0] || null) : r.data; if (d && st.cols) d = Object.fromEntries(st.cols.map((c) => [c, d[c]])); return Promise.resolve({ data: d, error: r.error }) },
    then(ok) { const r = fin(); if (st.cols && Array.isArray(r.data)) r.data = r.data.map((d) => Object.fromEntries(st.cols.map((c) => [c, d[c]]))); return Promise.resolve(r).then(ok) } }; return b }
globalThis.__db = { from: q,
  rpc: (fn, a) => { if (fn === 'upsert_app_data_item') { const L = APP[a.target_key] = APP[a.target_key] || []; const i = L.findIndex((x) => x.id === a.item.id); if (i > -1) L[i] = a.item; else L.push(a.item) } return Promise.resolve({ error: null }) },
  storage: { from: () => ({ upload: (p, bytes) => { if (STORE[p]) return Promise.resolve({ error: { message: 'exists' } }); STORE[p] = bytes; return Promise.resolve({ error: null }) },
    download: (p) => Promise.resolve(STORE[p] ? { data: new Blob([STORE[p]]), error: null } : { data: null, error: { message: 'not found' } }),
    createSignedUrl: (p, s) => Promise.resolve({ data: { signedUrl: 'https://signed/' + p + '?s=' + s }, error: null }) }) } }
globalThis.__who = () => WHO; globalThis.__ownerKey = () => NOW_OWNERKEY; globalThis.__sent = (x) => SENT.push(x); globalThis.__log = (x) => OPEN_LOG.push(x)
const stubs = {
  '_lv_auth.ts': "export const requireStaff = async (db, req, roles) => { const w = globalThis.__who(); if (!w) return { ok: false, status: 401, error: 'Sign in' }; if (w === 'krystal') return { ok: false, status: 403, error: 'no' }; return { ok: true, person_id: 'p1', name: w === 'zach' ? 'Zach Troutman' : 'Samantha Troutman', email: w + '@mo-care.com', roles: ['owner_admin'] } }\n",
  '_lv_job.ts': "export const ownerCaller = async () => globalThis.__ownerKey()\n",
  '_lv_out.ts': "export const normalisePhone = (p) => { const d = String(p || '').replace(/\\D/g, ''); return d.length === 10 ? '+1' + d : null }\nexport const contactForOutbound = async (db, ghl, person, kind, opts) => { globalThis.__sent({ person, kind, opts }); if (globalThis.__optout) { opts.onOptOut(['texts: STOP']); return null } return { contactId: 'c1' } }\n",
  '_lv_log.ts': "export const logOpen = async (db, r) => { globalThis.__log(r); return !globalThis.__logFail }\nexport const ipOf = () => '9.9.9.9'\n",
}
for (const [f, c] of Object.entries(stubs)) fs.writeFileSync(`${FN}/_shared/${f}`, c)
process.on('exit', () => { for (const f of [...Object.keys(stubs), '_lv_livein.ts', '_lv_agreement-pdf.ts']) try { fs.unlinkSync(`${FN}/_shared/${f}`) } catch { /* */ } })
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'l' }
globalThis.fetch = async (url, init) => { const u = String(url); if (u.includes('leadconnectorhq')) { SENT.push({ url: u, body: JSON.parse(init.body) }); return { ok: !globalThis.__ghlFail, status: globalThis.__ghlFail ? 400 : 200 } } throw new Error('unexpected fetch ' + u) }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const src = fs.readFileSync(`${FN}/livein-sign/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace("'../_shared/staff-auth.ts'", "'../_shared/_lv_auth.ts'").replace("'../_shared/job-auth.ts'", "'../_shared/_lv_job.ts'")
  .replace("'../_shared/outreach.ts'", "'../_shared/_lv_out.ts'").replace("'../_shared/doc-log.ts'", "'../_shared/_lv_log.ts'").replace("'../_shared/livein.ts'", "'../_shared/_lv_livein.ts'")
ck('the function lets a browser call it (CORS with apikey, from the first deploy)', /'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'/.test(src) && /req\.method === 'OPTIONS'/.test(src))
const tmp = path.join(process.cwd(), FN, 'livein-sign', '_t.ts'); fs.writeFileSync(tmp, src)
try { await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
const call = async (body, headers = {}) => { const r = await handler(new Request('https://x/functions/v1/livein-sign', { method: 'POST', headers: { 'user-agent': 'TestPhone', ...headers }, body: JSON.stringify(body) })); return { s: r.status, j: await r.json().catch(() => ({})) } }
const tok = (l) => l.split('t=')[1]

reset({ who: null }); let r = await call({ action: 'list' }); ck('no sign-in: refused', r.s === 401)
reset({ who: 'krystal' }); r = await call({ action: 'start', name: 'Rhonda Blakemore' }); ck('Krystal: refused (owners only)', r.s === 403 && !T.livein_sign.length)
r = await call({ action: 'view', t: 'x'.repeat(43) }); ck('a made-up link is refused', r.s === 404)
reset(); r = await call({ action: 'list' })
ck('list: her two people, the last 4 of the phone only, nothing yet', r.s === 200 && r.j.people.length === 2 && r.j.people.find((p) => p.name === 'Rhonda Blakemore').phone_last4 === '0100' && r.j.people.find((p) => p.name === 'Sheryelle Dunniehigh').phone_last4 === '' && !JSON.stringify(r.j).includes('4175550100') && !r.j.rows.length, r.j)
r = await call({ action: 'start', name: 'Pat Doe' }); ck('someone not on the list: refused', r.s === 400 && !T.livein_sign.length)
r = await call({ action: 'start', name: 'rhonda blakemore' }); const L1 = r.j.link
ck('start: a link, a draft text in her name, the last 4 of the phone; a real (not practice) row for 7 days', r.s === 200 && R.LINK_RE.test(L1) && r.j.draft.includes(L1) && /this is Samantha/.test(r.j.draft) && r.j.phone_last4 === '0100'
  && T.livein_sign[0].practice === false && T.livein_sign[0].caregiver === 'Rhonda Blakemore' && T.livein_sign[0].axiscare_caregiver_id === '77' && (new Date(T.livein_sign[0].expires_at) - Date.now()) > 6.9 * 864e5, r.j)
ck('...the row keeps only the hash of the link, and the master it was started on', T.livein_sign[0].token_hash && T.livein_sign[0].token_hash !== tok(L1) && T.livein_sign[0].master_sha === R.MASTER.sha)
ck('...the list never shows the link hash or signatures', !('token_hash' in r.j.row) && !('sig_png' in r.j.row))
const id1 = T.livein_sign[0].id
r = await call({ action: 'send', id: id1, message: 'Hi Rhonda, sign here please' }); ck('the text must keep this agreement\'s link', r.s === 400 && /private link/.test(r.j.error))
r = await call({ action: 'send', id: id1, message: 'Hi Rhonda — sign: ' + L1 }); ck('no long dash in the text', r.s === 400)
r = await call({ action: 'send', id: id1, message: 'x'.repeat(700) + L1 }); ck('a text that is too long is refused', r.s === 400)
r = await call({ action: 'send', id: id1, message: 'Hi Rhonda, please read and sign: ' + L1 })
const sms = SENT.find((x) => x.url)
ck('send: her exact words, a person\'s send to a caregiver, from the office line', r.j.outcome === 'sent' && sms.body.message.endsWith(L1) && sms.body.fromNumber === '+14172348494' && SENT[0].opts.humanInitiated === true && SENT[0].opts.audience === 'caregiver' && !!T.livein_sign[0].sent_at, r)
r = await call({ action: 'view', t: tok(L1) })
ck('the caregiver opens it: first name, 12 pages, the statement and consent; opened is noted', r.s === 200 && r.j.first === 'Rhonda' && r.j.pages === 12 && /\$250\.00/.test(r.j.statement) && /all 12 pages/.test(r.j.consent) && r.j.status === 'waiting' && !!T.livein_sign[0].opened_at, r.j)
ck('...without any office detail (no AxisCare number, no hash, no surname)', !JSON.stringify(r.j).includes('77') && !JSON.stringify(r.j).includes(T.livein_sign[0].token_hash) && !JSON.stringify(r.j).includes('Blakemore'))
const good = { action: 'sign', t: tok(L1), typed_name: 'Rhonda Blakemore', consent: true, master_sha: R.MASTER.sha, signature: SIG }
r = await call({ ...good, consent: undefined }); ck('signing needs the tick', r.s === 400 && /Tick/.test(r.j.error))
r = await call({ ...good, typed_name: 'Pat Doe' }); ck('a different name is refused', r.s === 400 && /full first and last name/.test(r.j.error))
r = await call({ ...good, signature: '' }); ck('no finger signature: refused', r.s === 400 && /Sign in the box/.test(r.j.error))
r = await call({ ...good, master_sha: 'old' }); ck('a different agreement is refused', r.s === 409)
reset({ badMaster: true }); r = await call({ action: 'start', name: 'Rhonda Blakemore' })
r = await call({ ...good, t: tok(r.j.link) }); ck('a master on file that is not the approved one: nothing is signed', r.s === 500 && /not the approved one/.test(r.j.error) && T.livein_sign[0].status === 'waiting')
reset(); r = await call({ action: 'start', name: 'Rhonda Blakemore' }); const L2 = r.j.link, id2 = T.livein_sign[0].id
r = await call({ ...good, t: tok(L2) })
const row2 = T.livein_sign[0]
ck('sign: signed, the PDF kept under livein/, their copy link for 10 minutes', r.s === 200 && row2.status === 'signed' && row2.signed_name === 'Rhonda Blakemore' && /^livein\/.+-employee-\d+\.pdf$/.test(row2.pdf_path) && STORE[row2.pdf_path] && /s=600$/.test(r.j.copy_url), r)
ck('...the signature, time, device and browser are kept', row2.sig_png === R.sigOf(SIG) && row2.sign_ip === '9.9.9.9' && row2.sign_agent === 'TestPhone' && !!row2.signed_at)
ck('...the kept PDF is the 13-page signed agreement', (await PDFDocument.load(STORE[row2.pdf_path])).getPageCount() === 13)
ck('...the link stops working once signed', row2.token_hash === null && (await call({ action: 'view', t: tok(L2) })).s === 404)
const task = APP.ops_items.find((x) => x.kind === 'livein_countersign')
ck('...Samantha gets a My Work task: first name + last initial only, links to HR, Live-In Agreement', task && task.owner === 'samantha@mo-care.com' && task.status === 'open' && task.title.endsWith('Rhonda B.') && !/Blakemore/.test(JSON.stringify(task)) && task.link === '#hr/livein', task)
r = await call({ action: 'countersign', id: id2, signature: '' }); ck('countersign needs her finger signature', r.s === 400)
r = await call({ action: 'countersign', id: id2, signature: SIG })
ck('countersign: done with her name, the finished PDF under livein/, the task closes', r.s === 200 && row2.status === 'countersigned' && row2.rep_name === 'Samantha Troutman' && row2.rep_email === 'samantha@mo-care.com' && /-final-\d+\.pdf$/.test(row2.final_pdf_path) && STORE[row2.final_pdf_path] && APP.ops_items.find((x) => x.kind === 'livein_countersign').status === 'done', r)
ck('...the employee-only PDF is kept too', !!STORE[row2.pdf_path] && row2.pdf_path !== row2.final_pdf_path)
r = await call({ action: 'countersign', id: id2, signature: SIG }); ck('...it cannot be countersigned twice', r.s === 409)
r = await call({ action: 'open', id: id2 }); ck('opening the PDF: the finished one, five minutes, logged with who', r.j.expires_in === 300 && r.j.url.includes(row2.final_pdf_path) && OPEN_LOG.length === 1 && OPEN_LOG[0].who.email === 'samantha@mo-care.com' && OPEN_LOG[0].subject === 'livein:' + id2)
globalThis.__logFail = true; r = await call({ action: 'open', id: id2 }); globalThis.__logFail = false; ck('...not opened if the open cannot be logged', r.s === 500)
reset(); r = await call({ action: 'start', name: 'Rhonda Blakemore' }); r = await call({ action: 'countersign', id: T.livein_sign[0].id, signature: SIG }); ck('countersign before they sign: refused', r.s === 409)

// texts that cannot go
reset(); r = await call({ action: 'start', name: 'Sheryelle Dunniehigh' })
ck('no phone on the roster: the link is still made', r.s === 200 && r.j.phone_last4 === '')
r = await call({ action: 'send', id: T.livein_sign[0].id, message: 'Hi Sheryelle, sign: ' + r.j.link }); ck('...and Send says so plainly (copy the link instead), nothing texted', r.s === 422 && /Copy the link/.test(r.j.error) && !SENT.some((x) => x.url))
globalThis.__optout = true; reset(); r = await call({ action: 'start', name: 'Rhonda Blakemore' })
r = await call({ action: 'send', id: T.livein_sign[0].id, message: 'Hi, sign: ' + r.j.link }); globalThis.__optout = false
ck('a caregiver who asked for no texts: not sent, says why', r.s === 422 && /asked not to get texts/.test(r.j.error) && !SENT.some((x) => x.url) && T.livein_sign_event.some((e) => e.kind === 'send_refused'))
globalThis.__ghlFail = true; reset(); r = await call({ action: 'start', name: 'Rhonda Blakemore' })
r = await call({ action: 'send', id: T.livein_sign[0].id, message: 'Hi, sign: ' + r.j.link }); globalThis.__ghlFail = false
ck('GoHighLevel refuses: "Not sent" with the reason, and not marked sent', r.s === 502 && /Not sent: GoHighLevel answered 400/.test(r.j.error) && !T.livein_sign[0].sent_at)

// cancel, start again, expiry
reset(); r = await call({ action: 'start', name: 'Rhonda Blakemore' }); const L5 = r.j.link
r = await call({ action: 'start', name: 'Rhonda Blakemore' })
ck('starting again cancels the earlier link', T.livein_sign[0].status === 'cancelled' && (await call({ action: 'view', t: tok(L5) })).s === 404 && T.livein_sign[1].status === 'waiting')
const L6 = r.j.link; r = await call({ action: 'cancel', id: T.livein_sign[1].id }); ck('cancel: the link stops working', T.livein_sign[1].status === 'cancelled' && (await call({ action: 'view', t: tok(L6) })).s === 404)
reset(); r = await call({ action: 'start', name: 'Rhonda Blakemore' }); T.livein_sign[0].expires_at = new Date(Date.now() - 1000).toISOString()
const L7 = r.j.link; r = await call({ action: 'view', t: tok(L7) }); ck('an expired link: shows expired', r.j.status === 'expired')
r = await call({ ...good, t: tok(L7) }); ck('...and cannot be signed', r.s === 410)

// the Desktop step's proof
reset({ who: null }); r = await call({ action: 'sample' }); ck('sample: refused without the owner\'s server key', r.s === 401)
NOW_OWNERKEY = true; r = await call({ action: 'sample' })
const S = T.livein_sign[0]
ck('sample: a practice agreement for "Test Caregiver", with its link', r.s === 200 && S.practice === true && S.caregiver === 'Test Caregiver' && R.LINK_RE.test(r.j.link))
r = await call({ ...good, t: r.j.token, typed_name: 'Test Caregiver' })
ck('...it signs end to end into a practice PDF, with no task', r.s === 200 && S.status === 'signed' && /^practice\//.test(S.pdf_path) && !APP.ops_items.length)
r = await call({ action: 'countersign', id: S.id, signature: SIG }); ck('...the server key may countersign the practice sample', r.s === 200 && S.status === 'countersigned' && /^practice\//.test(S.final_pdf_path) && S.rep_email === 'desktop-step')
r = await call({ action: 'open', id: S.id }); ck('...and open it', r.s === 200 && r.j.url.includes(S.final_pdf_path))
NOW_OWNERKEY = false; WHO = 'samantha'; r = await call({ action: 'start', name: 'Rhonda Blakemore' }); const real = T.livein_sign[1]
r = await call({ ...good, t: tok(r.j.link) }); NOW_OWNERKEY = true; WHO = null
r = await call({ action: 'countersign', id: real.id, signature: SIG }); ck('...but never a real one', r.s === 401 && real.status === 'signed')
r = await call({ action: 'open', id: real.id }); ck('...nor open a real one', r.s === 401)

const failed = res.filter((x) => !x[1])
for (const [n, ok, d] of res) console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '  ' + d))
console.log(`\n${res.length - failed.length} of ${res.length} passed`)
process.exit(failed.length ? 1 : 0)
