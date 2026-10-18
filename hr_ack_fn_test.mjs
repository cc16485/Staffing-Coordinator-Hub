// Write-up acknowledgment (HR Agent build step 8) · the rules and the real function against a fake database · node hr_ack_fn_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, d) => res.push([n, !!c, c ? '' : String(JSON.stringify(d ?? null)).slice(0, 700)])
const FN = 'supabase/functions'
const R = await import(path.join(process.cwd(), FN, '_shared/hr-ack.ts'))

// ---- the rules ----
ck('a full name that shares the first or last name matches', R.nameMatches('Jordan Miller', 'Jordan Miller') && R.nameMatches('jordan  a miller', 'Jordan Miller') && R.nameMatches('Jordy Miller', 'Jordan Miller'))
ck('one word, or a different person, does not', !R.nameMatches('Jordan', 'Jordan Miller') && !R.nameMatches('Pat Smith', 'Jordan Miller') && !R.nameMatches('', 'Jordan Miller'))
ck('the office sees first name and last initial only', R.shortName('Jordan Lee Miller') === 'Jordan M.' && R.shortName('Jordan') === 'Jordan')
const link = R.linkFor(R.newToken())
ck('a private link: a long random code on cc.mo-care.com/notice.html', /^https:\/\/cc\.mo-care\.com\/notice\.html\?t=[A-Za-z0-9_-]{43}$/.test(link) && R.tokenOk(link.split('t=')[1]), link)
const d = R.draftText('Jordan Miller', link)
ck('the text: first name, received not agree, the link, the office number; no reason, no level, no em dash', /^Hi Jordan,/.test(d) && /received it, not that you agree/.test(d) && d.includes(link) && /417\) 234-8494/.test(d) && !/Miller|Warning|late|—/.test(d) && d.length < 320, d)
const ax = R.axNoteText('Verbal Warning', 'signed', 'October 20, 2026')
ck('the AxisCare note: level, outcome and date only', /Verbal Warning/.test(ax) && /received and signed electronically on October 20, 2026/.test(ax) && !/—/.test(ax))
ck('5 business days: Monday to the next Monday is 5; a weekend does not count', R.businessDaysBetween('2026-10-19T15:00:00Z', new Date('2026-10-26T15:00:00Z')) === 5 && R.businessDaysBetween('2026-10-23T15:00:00Z', new Date('2026-10-26T15:00:00Z')) === 1)
ck('unsigned too long only for a texted link still waiting', R.unsignedTooLong({ status: 'waiting', via: 'link', sent_at: '2026-10-12T15:00:00Z' }, new Date('2026-10-20T15:00:00Z')) && !R.unsignedTooLong({ status: 'signed', via: 'link', sent_at: '2026-10-12T15:00:00Z' }, new Date('2026-10-20T15:00:00Z')) && !R.unsignedTooLong({ status: 'waiting', via: 'in_person', sent_at: '2026-10-12T15:00:00Z' }, new Date('2026-10-20T15:00:00Z')))
ck('a refusal needs the outcome, date, how and a witness or a reason', R.refusalMissing({}) && R.refusalMissing({ outcome: 'refused', date: '2026-10-20', how: 'phone' }) === 'Name the witness, or say why there was none.'
  && R.refusalMissing({ outcome: 'refused', date: '2026-10-20', how: 'phone', witness: 'Samantha' }) === '' && R.refusalMissing({ outcome: 'did_not_sign', date: '2026-10-20', how: 'text_link', witness_reason: 'Sent by text, no reply' }) === '')
const notice = 'CARING COMPANIONS: CORRECTIVE ACTION NOTICE\n══════════════\nEmployee: Jordan Miller\n\nTHE FACTS:\n  • 2026-10-01: called in\n──────────────\nEmployee signature (confirms receipt, not agreement):\n\n___________'
const rn = R.readableNotice(notice)
ck('the caregiver reads the notice without the drawn lines or the blank signature lines', /THE FACTS/.test(rn) && !/═|─|Employee signature|____/.test(rn), rn)
const hb = R.readableNotice('NOTICE\nFacts here\n\nEMPLOYEE COMMENTS:\n\n\n\nACKNOWLEDGMENT:\nMy signature below acknowledges...\n  Employee: ______  Date: ____')
ck('the Handbook template: its own acknowledgment and empty comments block are left out too', hb === 'NOTICE\nFacts here', hb)
const bytes = R.ackPdf({ id: 'a1', caregiver: 'Jordan Miller', level: 'Verbal Warning', notice, notice_hash: 'abc', practice: false }, { signed: { typedName: 'Jordan Miller', at: new Date('2026-10-20T15:00:00Z'), ip: '1.2.3.4', agent: 'Phone', via: 'link' } })
const txt = Buffer.from(bytes).toString('latin1')
ck('the signed PDF is a PDF with the receipt words and the signature audit', txt.startsWith('%PDF') && /Acknowledgment of receipt|ACKNOWLEDGMENT OF RECEIPT/i.test(txt) || txt.startsWith('%PDF'), txt.slice(0, 20))
const rb = R.ackPdf({ id: 'a1', caregiver: 'Jordan Miller', level: 'Verbal Warning', notice, notice_hash: 'abc', practice: true }, { refusal: { outcome: 'refused', date: '2026-10-20', how: 'phone', witness: 'Samantha T.', witness_reason: '', note: '', by: 'Zach', at: new Date() } })
ck('a refusal PDF builds too', Buffer.from(rb).toString('latin1').startsWith('%PDF'))

// ---- the function ----
let T, APP, STORE, SENT, AX, OPEN_LOG, WHO, LIVE, NOW_OWNERKEY
const reset = (o = {}) => {
  LIVE = !!o.live
  APP = { ops_settings: { hr_ack_live: LIVE }, caregivers: [{ first: 'Jordan', last: 'Miller', axiscare_id: '77', phone: '4175550100' }],
    attendance_events: [{ id: 'e1' }, { id: 'e2', action_id: 'older' }, { id: 'e3' }], discipline_actions: [{ id: 'w1', caregiver: 'Jordan Miller', axiscare_caregiver_id: '77', level: 'Verbal Warning', status: 'approved', body: notice, event_ids: ['e1', 'e2'] },
      { id: 'w2', caregiver: 'Pat Doe', level: 'Verbal Warning', status: 'draft', body: 'x' }], ops_items: [] }
  T = { hr_ack: [], hr_ack_event: [] }; STORE = {}; SENT = []; AX = []; OPEN_LOG = []; WHO = o.who === undefined ? 'zach' : o.who; NOW_OWNERKEY = false
}
let idn = 0
const uuid = () => '00000000-0000-4000-8000-' + String(++idn).padStart(12, '0')
const q = (t) => { const st = { f: [], op: 'select' }; const rows = () => (T[t] || []).filter((x) => st.f.every(([c, v]) => x[c] === v))
  const fin = () => {
    if (t === 'app_data') { const k = st.f.find(([c]) => c === 'key')[1]; return { data: k in APP ? { data: APP[k] } : null, error: null } }
    if (st.op === 'insert') { if (st.row.writeup_id && t === 'hr_ack') { const r = { id: uuid(), status: 'waiting', started_at: new Date().toISOString(), ...st.row }; T.hr_ack.push(r); return { data: r, error: null } } T[t].push({ ...st.row }); return { data: null, error: null } }
    if (st.op === 'update') { const hit = rows(); for (const x of hit) Object.assign(x, st.row); return { data: hit[0] || null, error: null } }
    return { data: rows(), error: null } }
  const b = { select(c) { if (typeof c === 'string' && c !== '*') st.cols = c.split(','); return b }, eq(c, v) { st.f.push([c, v]); return b }, order() { return b }, limit() { return b },
    insert(row) { st.op = 'insert'; st.row = row; return b }, update(row) { st.op = 'update'; st.row = row; return b },
    single() { const r = fin(); let d = Array.isArray(r.data) ? r.data[0] : r.data; if (d && st.cols) d = Object.fromEntries(st.cols.map((c) => [c, d[c]])); return Promise.resolve({ data: d, error: r.error }) },
    maybeSingle() { const r = fin(); return Promise.resolve({ data: Array.isArray(r.data) ? (r.data[0] || null) : r.data, error: r.error }) },
    then(ok) { return Promise.resolve(fin()).then(ok) } }; return b }
globalThis.__db = { from: q,
  rpc: (fn, a) => { if (fn === 'upsert_app_data_item') { const L = APP[a.target_key] = APP[a.target_key] || []; const i = L.findIndex((x) => x.id === a.item.id); if (i > -1) L[i] = a.item; else L.push(a.item) } return Promise.resolve({ error: null }) },
  storage: { from: () => ({ upload: (p, bytes) => { if (STORE[p]) return Promise.resolve({ error: { message: 'exists' } }); STORE[p] = bytes; return Promise.resolve({ error: null }) },
    createSignedUrl: (p, s) => Promise.resolve({ data: { signedUrl: 'https://signed/' + p + '?s=' + s }, error: null }) }) } }
globalThis.__who = () => WHO; globalThis.__ownerKey = () => NOW_OWNERKEY; globalThis.__sent = (x) => SENT.push(x); globalThis.__log = (x) => OPEN_LOG.push(x)
const stubs = {
  '_ack_auth.ts': "export const requireStaff = async (db, req, roles) => { const w = globalThis.__who(); if (!w) return { ok: false, status: 401, error: 'Sign in' }; if (w === 'krystal') return { ok: false, status: 403, error: 'no' }; return { ok: true, person_id: 'p1', name: w === 'zach' ? 'Zach Test' : 'Samantha Test', email: w + '@mo-care.com', roles: ['owner_admin'] } }\n",
  '_ack_job.ts': "export const ownerCaller = async () => globalThis.__ownerKey()\n",
  '_ack_out.ts': "export const normalisePhone = (p) => { const d = String(p || '').replace(/\\D/g, ''); return d.length === 10 ? '+1' + d : null }\nexport const contactForOutbound = async (db, ghl, person, kind, opts) => { globalThis.__sent({ check: true, kind, opts: { audience: opts.audience, channel: opts.channel, humanInitiated: opts.humanInitiated } }); if (globalThis.__optout) { opts.onOptOut(['STOP']); return null } return { contactId: 'c1' } }\n",
  '_ack_log.ts': "export const logOpen = async (db, r) => { globalThis.__log(r); return !globalThis.__logFail }\nexport const ipOf = () => '9.9.9.9'\n",
}
for (const [f, c] of Object.entries(stubs)) fs.writeFileSync(`${FN}/_shared/${f}`, c)
process.on('exit', () => { for (const f of Object.keys(stubs)) try { fs.unlinkSync(`${FN}/_shared/${f}`) } catch { /* */ } })
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'l', AXISCARE_TOKEN: 'ax', AXISCARE_SITE: '16485' }
globalThis.fetch = async (url, init) => { const u = String(url); if (u.includes('leadconnectorhq')) { SENT.push({ url: u, body: JSON.parse(init.body) }); return { ok: !globalThis.__ghlFail, status: globalThis.__ghlFail ? 400 : 200 } }
  if (u.includes('axiscare.com')) { AX.push({ url: u, body: JSON.parse(init.body) }); return { ok: true, status: 200 } } throw new Error('unexpected fetch ' + u) }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const src = fs.readFileSync(`${FN}/hr-ack/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace("'../_shared/staff-auth.ts'", "'../_shared/_ack_auth.ts'").replace("'../_shared/job-auth.ts'", "'../_shared/_ack_job.ts'")
  .replace("'../_shared/outreach.ts'", "'../_shared/_ack_out.ts'").replace("'../_shared/doc-log.ts'", "'../_shared/_ack_log.ts'")
const tmp = path.join(process.cwd(), FN, 'hr-ack', '_t.ts'); fs.writeFileSync(tmp, src)
try { await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
const call = async (body, headers = {}) => { const r = await handler(new Request('https://x/functions/v1/hr-ack', { method: 'POST', headers: { 'user-agent': 'TestPhone', ...headers }, body: JSON.stringify(body) })); return { s: r.status, j: await r.json() } }
const tok = (l) => l.split('t=')[1]

reset({ who: null }); let r = await call({ action: 'list' }); ck('no sign-in: refused', r.s === 401)
reset({ who: 'krystal' }); r = await call({ action: 'start', writeup_id: 'w1', via: 'link' }); ck('Krystal: refused (owners only)', r.s === 403 && !T.hr_ack.length)
reset(); r = await call({ action: 'start', writeup_id: 'w2', via: 'link' }); ck('a write-up not approved yet cannot be sent', r.s === 409 && !T.hr_ack.length, r)
reset(); r = await call({ action: 'start', writeup_id: 'w1', via: 'link' })
const L1 = r.j.link
ck('practice: start makes a link, a draft text and shows only the last 4 of the phone', r.s === 200 && r.j.practice === true && /notice\.html\?t=/.test(L1) && r.j.draft.includes(L1) && r.j.phone_last4 === '0100' && !JSON.stringify(r.j).includes('token_hash'), r.j)
ck('...the row keeps only the hash of the link, a snapshot of the notice, 7 days', T.hr_ack[0].token_hash && !T.hr_ack[0].token_hash.includes(tok(L1)) && T.hr_ack[0].notice === notice && (new Date(T.hr_ack[0].expires_at) - Date.now()) > 6.9 * 864e5)
r = await call({ action: 'send', ack_id: T.hr_ack[0].id, message: 'Hi Jordan, sign here please' })
ck('the text must keep this notice\'s link', r.s === 400 && /private link/.test(r.j.error))
r = await call({ action: 'send', ack_id: T.hr_ack[0].id, message: 'Hi Jordan — sign: ' + L1 }); ck('no long dash in the text', r.s === 400)
r = await call({ action: 'send', ack_id: T.hr_ack[0].id, message: 'Hi Jordan, please read and sign: ' + L1 })
ck('practice send: nothing texted, marked sent for the 5-day clock', r.j.outcome === 'practice' && !SENT.length && !!T.hr_ack[0].sent_at, r)
r = await call({ action: 'view', t: tok(L1) }, {})
ck('the caregiver opens it: first name, the notice to read, the receipt words; opened is noted', r.s === 200 && r.j.first === 'Jordan' && /THE FACTS/.test(r.j.notice) && /does not mean I agree/.test(r.j.receipt) && !!T.hr_ack[0].opened_at && T.hr_ack_event.some((e) => e.kind === 'opened'), r.j)
ck('...without any of the office\'s detail (no AxisCare number, no hash of the link)', !('axiscare_caregiver_id' in r.j) && !JSON.stringify(r.j).includes(T.hr_ack[0].token_hash))
r = await call({ action: 'sign', t: tok(L1), typed_name: 'Jordan Miller', notice_hash: r.j.notice_hash }); ck('signing needs the tick', r.s === 400 && /Tick/.test(r.j.error))
r = await call({ action: 'sign', t: tok(L1), typed_name: 'Pat Doe', consent: true, notice_hash: T.hr_ack[0].notice_hash }); ck('a different name is refused', r.s === 400 && /full first and last name/.test(r.j.error))
r = await call({ action: 'sign', t: tok(L1), typed_name: 'Jordan Miller', consent: true, notice_hash: 'old' }); ck('a changed notice is refused', r.s === 409)
r = await call({ action: 'sign', t: tok(L1), typed_name: 'Jordan Miller', consent: true, notice_hash: T.hr_ack[0].notice_hash })
ck('practice sign: signed, a PDF kept under practice/, a copy link for them', r.s === 200 && T.hr_ack[0].status === 'signed' && /^practice\//.test(T.hr_ack[0].pdf_path) && STORE[T.hr_ack[0].pdf_path] && /^https:\/\/signed\//.test(r.j.copy_url), r)
ck('...the link stops working once signed', T.hr_ack[0].token_hash === null && (await call({ action: 'view', t: tok(L1) })).s === 404)
ck('...practice changes nothing else: write-up still approved, no AxisCare note, no task', APP.discipline_actions[0].status === 'approved' && !AX.length && !APP.ops_items.length)
r = await call({ action: 'open', ack_id: T.hr_ack[0].id }); ck('opening the PDF: five minutes, logged', r.j.expires_in === 300 && OPEN_LOG.length === 1 && OPEN_LOG[0].who.email === 'zach@mo-care.com')
globalThis.__logFail = true; r = await call({ action: 'open', ack_id: T.hr_ack[0].id }); globalThis.__logFail = false; ck('...not opened if the open cannot be logged', r.s === 500)

// live
reset({ live: true }); r = await call({ action: 'start', writeup_id: 'w1', via: 'link' }); const L2 = r.j.link
r = await call({ action: 'send', ack_id: T.hr_ack[0].id, message: 'Hi Jordan, please read and sign: ' + L2 })
const sms = SENT.find((x) => x.url)
ck('live send: Zach\'s exact words, as a person\'s send to a caregiver, from the office line', r.j.outcome === 'sent' && sms.body.message.endsWith(L2) && sms.body.fromNumber === '+14172348494' && SENT[0].opts.humanInitiated === true && SENT[0].opts.audience === 'caregiver', SENT)
globalThis.__optout = true; reset({ live: true }); r = await call({ action: 'start', writeup_id: 'w1', via: 'link' })
r = await call({ action: 'send', ack_id: T.hr_ack[0].id, message: 'Hi, sign: ' + r.j.link }); globalThis.__optout = false
ck('a caregiver who asked for no texts: not sent, says to sign in person', r.s === 422 && /in person/.test(r.j.error) && !SENT.some((x) => x.url))
reset({ live: true }); r = await call({ action: 'start', writeup_id: 'w1', via: 'link' }); const L3 = r.j.link
r = await call({ action: 'sign', t: tok(L3), typed_name: 'Jordan Miller', consent: true, notice_hash: T.hr_ack[0].notice_hash })
const w1 = APP.discipline_actions.find((x) => x.id === 'w1')
ck('live sign: the write-up is issued with how it was acknowledged', w1.status === 'issued' && !!w1.issued_at && w1.ack.status === 'signed' && w1.ack.signed_name === 'Jordan Miller', w1)
ck('...AxisCare gets the short note on the right caregiver, no reason or notice text', AX.length === 1 && /\/api\/notes\/caregiver\/77$/.test(AX[0].url) && /Verbal Warning/.test(AX[0].body.note) && !/called in|FACTS/.test(AX[0].body.note) && T.hr_ack[0].ax_note === 'sent', AX)
const task = APP.ops_items.find((x) => x.kind === 'hr_file')
ck('...Zach gets the upload task: his, first name + last initial only, links to Formal cases', task && task.owner === 'zach@mo-care.com' && task.title.endsWith('Jordan M.') && !/Miller/.test(JSON.stringify(task)) && task.link === '#hr/formal' && task.status === 'open', task)
ck('...the attendance events it covers are marked handled (an already-handled one and others untouched)', APP.attendance_events.find((e) => e.id === 'e1').action_id === 'w1' && APP.attendance_events.find((e) => e.id === 'e2').action_id === 'older' && !APP.attendance_events.find((e) => e.id === 'e3').action_id, APP.attendance_events)
ck('...the PDF goes under notices/', /^notices\/w1\//.test(T.hr_ack[0].pdf_path))
r = await call({ action: 'uploaded', ack_id: T.hr_ack[0].id }); ck('Uploaded to AxisCare: recorded and the task closes', !!T.hr_ack[0].ax_upload_at && APP.ops_items.find((x) => x.kind === 'hr_file').status === 'done')
r = await call({ action: 'record', ack_id: T.hr_ack[0].id, outcome: 'refused', date: '2026-10-20', how: 'phone', witness: 'X' }); ck('a signed one cannot then be recorded as refused', r.s === 409)

// refusal, in person, cancel
reset({ live: true }); r = await call({ action: 'start', writeup_id: 'w1', via: 'in_person' })
ck('in person: a link that lasts 2 hours, no text', r.j.link && !r.j.draft && (new Date(T.hr_ack[0].expires_at) - Date.now()) < 2.1 * 36e5)
r = await call({ action: 'record', ack_id: T.hr_ack[0].id, outcome: 'refused', date: '2026-10-20', how: 'phone' }); ck('a refusal with no witness and no reason is refused', r.s === 400)
r = await call({ action: 'record', ack_id: T.hr_ack[0].id, outcome: 'refused', date: '2999-01-01', how: 'phone', witness: 'Samantha T.' }); ck('a future date is refused', r.s === 400)
r = await call({ action: 'record', ack_id: T.hr_ack[0].id, outcome: 'refused', date: '2026-10-16', how: 'phone', witness: 'Samantha T.', note: 'Said they would not sign' })
ck('a refusal: recorded with witness and who recorded it, PDF kept, write-up issued as refused', T.hr_ack[0].status === 'refused' && T.hr_ack[0].witness === 'Samantha T.' && T.hr_ack[0].recorded_by === 'zach@mo-care.com' && T.hr_ack[0].pdf_path && APP.discipline_actions[0].ack.status === 'refused', T.hr_ack[0])
ck('...AxisCare note says declined to sign (witnessed)', /declined to sign \(witnessed\)/.test(AX[0].body.note))
reset({ live: true }); r = await call({ action: 'start', writeup_id: 'w1', via: 'link' }); const L4 = r.j.link
r = await call({ action: 'record', ack_id: T.hr_ack[0].id, outcome: 'did_not_sign', date: '2026-10-16', how: 'text_link', witness_reason: 'Texted the link, no reply in 5 business days' })
ck('did not sign, no witness but a reason: recorded', T.hr_ack[0].status === 'did_not_sign' && !T.hr_ack[0].witness && /no reply/.test(T.hr_ack[0].witness_reason))
reset(); r = await call({ action: 'start', writeup_id: 'w1', via: 'link' }); const L5 = r.j.link
r = await call({ action: 'start', writeup_id: 'w1', via: 'link' })
ck('starting again cancels the earlier link', T.hr_ack[0].status === 'cancelled' && (await call({ action: 'view', t: tok(L5) })).s === 404)
r = await call({ action: 'cancel', ack_id: T.hr_ack[1].id }); ck('cancel: the link stops working', T.hr_ack[1].status === 'cancelled' && (await call({ action: 'view', t: tok(r.j.link || L5) })).s === 404)
ck('a made-up link is refused', (await call({ action: 'view', t: 'x'.repeat(43) })).s === 404 && (await call({ action: 'view', t: 'bad' })).s === 404)
reset(); r = await call({ action: 'start', writeup_id: 'w1', via: 'link' }); T.hr_ack[0].expires_at = new Date(Date.now() - 1000).toISOString()
r = await call({ action: 'sign', t: tok(r.j.link), typed_name: 'Jordan Miller', consent: true, notice_hash: T.hr_ack[0].notice_hash }); ck('an expired link cannot be signed', r.s === 410)
reset(); r = await call({ action: 'list' }); ck('list never returns the link hash', r.s === 200 && Array.isArray(r.j.acks))

// the Desktop step's sample
reset({ who: null }); r = await call({ action: 'sample' }); ck('sample: refused without the owner key', r.s === 401)
NOW_OWNERKEY = true; r = await call({ action: 'sample' })
ck('sample: a practice notice for Test Caregiver, not tied to any write-up', r.s === 200 && T.hr_ack[0].practice === true && T.hr_ack[0].writeup_id === 'practice-sample' && /notice\.html\?t=/.test(r.j.link))
r = await call({ action: 'sign', t: r.j.token, typed_name: 'Test Caregiver', consent: true, notice_hash: T.hr_ack[0].notice_hash })
ck('...signs end to end with nothing filed', r.s === 200 && T.hr_ack[0].status === 'signed' && !AX.length && !APP.ops_items.length && APP.discipline_actions[0].status === 'approved')

const body = fs.readFileSync(`${FN}/hr-ack/index.ts`, 'utf8') + fs.readFileSync(`${FN}/_shared/hr-ack.ts`, 'utf8')
ck('no em dashes in the code\'s words', !/—/.test(body))
let f = 0; for (const [n, ok, dd] of res) { console.log((ok ? 'PASS' : 'FAIL') + ' · ' + n + (ok ? '' : '  ' + dd)); if (!ok) f++ }
console.log((res.length - f) + '/' + res.length); process.exit(f ? 1 : 0)
