// INCIDENT REPORT, STAGE 1 (Samantha 2026-10-27): the REAL _shared/incident.ts and the REAL incident-report function against a
// fake database and a fake GoHighLevel. Her three picks: a person presses Send; ONE reminder after 24 hours (8am to 8pm), then
// the card turns red and nobody is texted again; families are never contacted. Practice until the switch: nothing texted, no
// card. Fake data only.   node incident_report_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, d) => res.push([n, !!c, c ? '' : String(JSON.stringify(d ?? null)).slice(0, 900)])
const FN = 'supabase/functions'
const R = await import(path.join(process.cwd(), FN, '_shared/incident.ts'))

// ---- the rules ----
const full = { time: '2:15 pm', where: 'Bathroom', what: 'Carol slid off the toilet seat onto the floor while I was getting her towel.', hurt: 'Yes', hurt_how: 'A red mark on her left hip, she said it hurt a little.',
  did: 'I helped her sit up, checked her, and got her to her chair.', help: ['Family'], saw: 'no one', told: 'I only wrote it in my shift note', more: '' }
let a = R.cleanAnswers(full)
ck('a full set of answers is complete', R.answersMissing(a, 'Carol Fite') === '', R.answersMissing(a, 'Carol Fite'))
ck('the questions name the client by first name', R.labelFor(R.QUESTIONS.find((q) => q.k === 'hurt'), 'Carol Fite') === 'Was Carol hurt?')
ck('what happened needs more than a few words', /say a little more: What happened/.test(R.answersMissing(R.cleanAnswers({ ...full, what: 'she fell' }), 'Carol Fite')))
ck('hurt = Yes needs what was seen', /Please answer: What did you see/.test(R.answersMissing(R.cleanAnswers({ ...full, hurt_how: '' }), 'Carol Fite')))
a = R.cleanAnswers({ ...full, hurt: 'No' })
ck('hurt = No drops the follow-up question', !('hurt_how' in a) && R.answersMissing(a, 'Carol Fite') === '')
ck('called or texted the office needs when and who', /When did you call/.test(R.answersMissing(R.cleanAnswers({ ...full, told: 'I called the office' }), 'Carol Fite'))
  && R.answersMissing(R.cleanAnswers({ ...full, told: 'I called the office', told_when: '2:30 pm, Krystal' }), 'Carol Fite') === '')
ck('only in the note, or not told: a late report (recorded for Stage 4)', R.toldLate(R.cleanAnswers(full)) && R.toldLate({ told: 'I have not told the office until now' }) && !R.toldLate({ told: 'I called the office' }))
ck('unknown keys, made-up choices and long dashes are cleaned', (() => { const c = R.cleanAnswers({ ...full, evil: 'x', where: 'Moon', help: ['911', 'Hacker', 'No one'], what: 'She fell — hard on the floor by the tub' })
  return !('evil' in c) && !('where' in c) && JSON.stringify(c.help) === '["911"]' && !/—/.test(c.what) })())
const sig = [[[0.1, 0.5], [0.2, 0.3], [0.3, 0.6], [0.4, 0.4], [0.5, 0.5]], [[0.6, 0.3], [0.7, 0.6], [0.8, 0.4], [0.9, 0.5]]]
ck('a finger signature: strokes inside the box', JSON.stringify(R.cleanStrokes(sig)) === JSON.stringify(sig))
ck('no ink, a dot, or junk is not a signature', !R.cleanStrokes([]) && !R.cleanStrokes([[[0.5, 0.5], [0.51, 0.5], [0.5, 0.51], [0.51, 0.51], [0.5, 0.5], [0.5, 0.5], [0.5, 0.5], [0.5, 0.5]]]) && !R.cleanStrokes('x') && !R.cleanStrokes([[[5, 5]]]))
const link = R.linkFor(R.newToken())
ck('a private link: a long random code on cc.mo-care.com/incident.html', /^https:\/\/cc\.mo-care\.com\/incident\.html\?t=[A-Za-z0-9_-]{43}$/.test(link) && R.tokenOk(link.split('t=')[1]), link)
const rep = { caregiver: 'Ashley Lloyd', client_name: 'Carol Fite', happened_on: '2026-10-26' }
const d = R.draftText(rep, link)
ck('the text: her first name, the client\'s first name, the day, the link, call the office; no details, no long dash', /^Hi Ashley,/.test(d) && /with Carol on Monday, October 26/.test(d) && d.includes(link) && /call the office right away/.test(d)
  && !/Fite|Lloyd|fall|hip|—/.test(d) && d.length < R.MAX_TEXT, d)
const rm = R.reminderText(rep, link)
ck('the reminder: still need it, the new link, no details', /reminder/.test(rm) && rm.includes(link) && !/Fite|fall/.test(rm), rm)
ck('the office sees "Carol F., Oct 26"', R.caseName(rep) === 'Carol F., Oct 26')
const t0 = new Date('2026-10-27T15:00:00Z')
ck('the card: text the link first', /^Text Ashley the report link/.test(R.cardState({ ...rep, status: 'waiting' }, t0).next))
ck('...then waiting, then red after 24 hours with "Call Ashley"', /^Waiting for Ashley/.test(R.cardState({ ...rep, status: 'waiting', sent_at: '2026-10-27T10:00:00Z' }, t0).next)
  && R.cardState({ ...rep, status: 'waiting', sent_at: '2026-10-26T10:00:00Z' }, t0).urgency === 'urgent' && /Call Ashley/.test(R.cardState({ ...rep, status: 'waiting', sent_at: '2026-10-26T10:00:00Z' }, t0).next))
ck('...signed: read it and close with what was done', /filled in and signed/.test(R.cardState({ ...rep, status: 'submitted' }, t0).next) && R.cardState({ ...rep, status: 'cancelled' }).open === false)
ck('the reminder is owed once: real, sent 24h+ ago, never reminded', R.reminderDue({ status: 'waiting', sent_at: '2026-10-26T10:00:00Z' }, t0) && !R.reminderDue({ status: 'waiting', sent_at: '2026-10-26T10:00:00Z', reminded_at: 'x' }, t0)
  && !R.reminderDue({ status: 'waiting', sent_at: '2026-10-26T10:00:00Z', practice: true }, t0) && !R.reminderDue({ status: 'waiting', sent_at: '2026-10-27T10:00:00Z' }, t0) && !R.reminderDue({ status: 'submitted', sent_at: '2026-10-26T10:00:00Z' }, t0))
ck('reminders only 8am to 8pm Central', R.inReminderHours(new Date('2026-10-27T13:00:00Z')) && R.inReminderHours(new Date('2026-10-28T00:59:00Z')) && !R.inReminderHours(new Date('2026-10-28T01:00:00Z')) && !R.inReminderHours(new Date('2026-10-27T12:59:00Z')))
ck('the note words: only the quoted shift note', R.noteWords('Red flag\n"Carol slipped in the bathroom, she says she is ok."\nTasks: bath: done') === 'Carol slipped in the bathroom, she says she is ok.')
const pdf = Buffer.from(R.reportPdf({ ...rep, id: 'r1', kind: 'client', started_by_name: 'Samantha T', started_at: '2026-10-27T15:00:00Z', note_words: 'Carol slipped', answers_hash: 'abc' }, R.cleanAnswers(full),
  { typedName: 'Ashley Lloyd', strokes: sig, at: new Date('2026-10-27T16:00:00Z'), ip: '1.2.3.4', agent: 'Phone' })).toString('latin1')
ck('the signed PDF builds, with the drawn signature as lines', pdf.startsWith('%PDF') && / l S Q/.test(pdf) && /%%EOF\s*$/.test(pdf), pdf.slice(0, 40))

// ---- the function ----
/* a movable clock, so both the daytime reminder and the overnight hold are checked whatever time the test runs */
const RealDate = Date; let SHIFT = 0
globalThis.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + SHIFT) } static now() { return RealDate.now() + SHIFT } }
const setCentralHour = (h) => { SHIFT = 0; const cur = Number(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false })) % 24; SHIFT = ((h - cur + 24) % 24) * 36e5 }
let T, APP, STORE, SENT, LOG, WHO, OWNERKEY, CRON, PROBLEMS
let idn = 0
const uuid = () => '00000000-0000-4000-8000-' + String(++idn).padStart(12, '0')
const reset = (o = {}) => {
  APP = { ops_settings: { incident_reports_live: !!o.live }, caregivers: [{ first: 'Ashley', last: 'Lloyd', phone: '4175550100' }, { first: 'Pat', last: 'Doe', phone: '' }],
    ops_items: [{ id: 'flag1', kind: 'care_note', level: 'red', about: 'Carol Fite', client_ax: '501', caregiver: 'Ashley Lloyd', caregiver_phone: '4175550100', visit_day: 'Mon, Oct 26',
      detail: 'Red flag\n"Carol slipped off the toilet onto the floor, she says she is ok."\n', status: 'open' }] }
  T = { incident_report: [], incident_event: [] }; STORE = {}; SENT = []; LOG = []; PROBLEMS = []
  WHO = o.who === undefined ? 'krystal' : o.who; OWNERKEY = false; CRON = false
}
const match = (x, f) => f.every(([op, c, v]) => op === 'eq' ? String(x[c]) === String(v) : op === 'is' ? (x[c] ?? null) === v : op === 'not_is' ? (x[c] ?? null) !== v : op === 'in' ? v.includes(String(x[c])) : true)
const q = (t) => { const st = { f: [], op: 'select', cols: null }
  const rows = () => (T[t] || []).filter((x) => match(x, st.f))
  const fin = () => {
    if (t === 'app_data') { const k = st.f.find(([, c]) => c === 'key')[2]; return { data: k in APP ? { data: APP[k] } : null, error: null } }
    if (st.op === 'insert') {
      const r = t === 'incident_report' ? { id: uuid(), status: 'waiting', started_at: new Date().toISOString(), ...st.row } : { ...st.row }
      if (t === 'incident_report' && T.incident_report.some((x) => x.token_hash && x.token_hash === r.token_hash)) return { data: null, error: { message: 'dup' } }
      T[t].push(r); return { data: r, error: null } }
    if (st.op === 'update') { const hit = rows()
      for (const x of hit) { if (x.status === 'submitted' && st.row.answers !== undefined) return { data: null, error: { message: 'signed' } }; Object.assign(x, st.row) }
      return { data: hit[0] || null, error: null } }
    const pick = (x) => st.cols ? Object.fromEntries(st.cols.filter((c) => c in x).map((c) => [c, x[c]])) : x
    return { data: rows().map(pick), error: null } }
  const b = { select(c) { if (st.op === 'select' && typeof c === 'string' && c !== '*') st.cols = c.split(','); return b }, eq(c, v) { st.f.push(['eq', c, v]); return b }, is(c, v) { st.f.push(['is', c, v]); return b }, not(c, _o, v) { st.f.push(['not_is', c, v]); return b },
    in(c, v) { st.f.push(['in', c, v]); return b }, order() { return b }, limit() { return b },
    insert(row) { st.op = 'insert'; st.row = row; return b }, update(row) { st.op = 'update'; st.row = row; return b },
    single() { const r = fin(); return Promise.resolve({ data: Array.isArray(r.data) ? r.data[0] : r.data, error: r.error }) },
    maybeSingle() { const r = fin(); return Promise.resolve({ data: Array.isArray(r.data) ? (r.data[0] || null) : r.data, error: r.error }) },
    then(ok, no) { return Promise.resolve(fin()).then(ok, no) } }; return b }
globalThis.__db = { from: q,
  rpc: (fn, x) => { if (fn === 'upsert_app_data_item') { const L = APP[x.target_key] = APP[x.target_key] || []; const i = L.findIndex((y) => y.id === x.item.id); if (i > -1) L[i] = x.item; else L.push(x.item) } return Promise.resolve({ error: null }) },
  storage: { from: () => ({ upload: (p, bytes) => { if (STORE[p]) return Promise.resolve({ error: { message: 'exists' } }); STORE[p] = bytes; return Promise.resolve({ error: null }) },
    createSignedUrl: (p, s) => Promise.resolve({ data: { signedUrl: 'https://signed/' + p + '?s=' + s }, error: null }) }) } }
globalThis.__who = () => WHO; globalThis.__ownerKey = () => OWNERKEY; globalThis.__cron = () => CRON; globalThis.__sent = (x) => SENT.push(x); globalThis.__log = (x) => LOG.push(x); globalThis.__problem = (x) => PROBLEMS.push(x)
const stubs = {
  '_inc_auth.ts': "export const OFFICE_ROLES = ['owner_admin','care_coordinator','staffing_coordinator']\nexport const requireStaff = async (db, req, roles) => { const w = globalThis.__who(); if (!w) return { ok: false, status: 401, error: 'Sign in' }; if (w === 'outsider') return { ok: false, status: 403, error: 'no' }; return { ok: true, person_id: 'p1', name: w === 'krystal' ? 'Krystal Test' : 'Samantha Test', email: w + '@mo-care.com', roles: ['care_coordinator'] } }\n",
  '_inc_job.ts': "export const ownerCaller = async () => globalThis.__ownerKey()\nexport const jobCaller = async () => globalThis.__cron() ? 'cron' : globalThis.__ownerKey() ? 'owner' : null\n",
  '_inc_out.ts': "export const normalisePhone = (p) => { const d = String(p || '').replace(/\\D/g, ''); return d.length === 10 ? '+1' + d : null }\nexport const contactForOutbound = async (db, ghl, person, kind, opts) => { globalThis.__sent({ check: true, kind, opts: { audience: opts.audience, channel: opts.channel, humanInitiated: opts.humanInitiated, sender: opts.sender } }); if (globalThis.__optout) { opts.onOptOut(['STOP']); return null } return { contactId: 'c1' } }\n",
  '_inc_log.ts': "export const logOpen = async (db, r) => { globalThis.__log(r); return !globalThis.__logFail }\nexport const ipOf = () => '9.9.9.9'\nexport const clientSubject = (ax) => 'client:' + ax\n",
  '_inc_sp.ts': "export const reportSendProblem = async (db, p) => { globalThis.__problem(p) }\nexport const ownerFor = async () => 'samantha@mo-care.com'\n",
}
for (const [f, c] of Object.entries(stubs)) fs.writeFileSync(`${FN}/_shared/${f}`, c)
process.on('exit', () => { for (const f of Object.keys(stubs)) try { fs.unlinkSync(`${FN}/_shared/${f}`) } catch { /* */ } })
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'l' }
globalThis.fetch = async (url, init) => { const u = String(url); if (u.includes('leadconnectorhq')) { SENT.push({ url: u, body: JSON.parse(init.body) }); return { ok: !globalThis.__ghlFail, status: globalThis.__ghlFail ? 400 : 200 } } throw new Error('unexpected fetch ' + u) }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const src = fs.readFileSync(`${FN}/incident-report/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace("'../_shared/staff-auth.ts'", "'../_shared/_inc_auth.ts'").replace("'../_shared/job-auth.ts'", "'../_shared/_inc_job.ts'")
  .replace("'../_shared/outreach.ts'", "'../_shared/_inc_out.ts'").replace("'../_shared/doc-log.ts'", "'../_shared/_inc_log.ts'").replace("'../_shared/send-problems.ts'", "'../_shared/_inc_sp.ts'")
const tmp = path.join(process.cwd(), FN, 'incident-report', '_t.ts'); fs.writeFileSync(tmp, src)
try { await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
const call = async (body, qs = '') => { const r = await handler(new Request('https://x/functions/v1/incident-report' + qs, { method: 'POST', headers: { 'user-agent': 'TestPhone' }, body: JSON.stringify(body) })); return { s: r.status, j: await r.json() } }
const tok = (l) => l.split('t=')[1]
const texts = () => SENT.filter((x) => x.url)
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })

reset({ who: null }); let r = await call({ action: 'list', client_ax: '501' }); ck('no sign-in: refused', r.s === 401)
reset({ who: 'outsider' }); r = await call({ action: 'start', source_item_id: 'flag1', happened_on: '2026-10-26' }); ck('not office staff: refused', r.s === 403 && !T.incident_report.length)
reset(); r = await call({ action: 'start', source_item_id: 'flag1', happened_on: '2999-01-01' }); ck('a day in the future is refused', r.s === 400 && !T.incident_report.length)
r = await call({ action: 'start', source_item_id: 'nope', happened_on: '2026-10-26' }); ck('a flag that is not on file is refused', r.s === 404)
r = await call({ action: 'start', client_name: 'Carol Fite', caregiver: 'Ashley', happened_on: '2026-10-26' }); ck('the caregiver needs a first and last name', r.s === 400)

// practice, from the red flag
reset(); r = await call({ action: 'start', source_item_id: 'flag1', happened_on: '2026-10-26' })
const L1 = r.j.link, R1 = () => T.incident_report[0]
ck('practice: from the flag, the client, caregiver and note words come from the card', r.s === 200 && r.j.practice === true && R1().client_name === 'Carol Fite' && R1().client_ax === '501' && R1().caregiver === 'Ashley Lloyd'
  && /slipped off the toilet/.test(R1().note_words) && r.j.draft.includes(L1) && r.j.phone_last4 === '0100', r.j)
ck('...the row keeps only the hash of the link; 7 days; the answer never carries the hash', R1().token_hash && !R1().token_hash.includes(tok(L1)) && (new Date(R1().expires_at) - Date.now()) > 6.9 * 864e5 && !JSON.stringify(r.j).includes(R1().token_hash))
ck('...practice makes no card', !APP.ops_items.some((x) => x.kind === 'client_issue'))
r = await call({ action: 'send', id: R1().id, message: 'Hi Ashley, fill this in please' }); ck('the text must keep this report\'s link', r.s === 400 && /private link/.test(r.j.error))
r = await call({ action: 'send', id: R1().id, message: 'Hi Ashley — ' + L1 }); ck('no long dash in the text', r.s === 400)
r = await call({ action: 'send', id: R1().id, message: 'Hi Ashley, please fill in your report: ' + L1 })
ck('practice send: nothing texted', r.j.outcome === 'practice' && !texts().length && !!R1().sent_at, r)
r = await call({ action: 'view', t: tok(L1) })
ck('the caregiver opens it: her first name, Carol F., the day, the questions with Carol\'s name, her note words', r.s === 200 && r.j.first === 'Ashley' && r.j.client_short === 'Carol F.' && r.j.happened_on === '2026-10-26'
  && r.j.questions.some((x) => x.label === 'Was Carol hurt?') && /slipped/.test(r.j.note_words) && !!R1().opened_at, r.j)
ck('...without the office\'s detail (no client number, no phone, no hash)', !JSON.stringify(r.j).includes('501') && !JSON.stringify(r.j).includes('4175550100') && !JSON.stringify(r.j).includes(R1().token_hash))
r = await call({ action: 'submit', t: tok(L1), answers: { ...full, what: '' }, typed_name: 'Ashley Lloyd', strokes: sig, consent: true }); ck('a missing answer is refused, by its question', r.s === 400 && /What happened/.test(r.j.error))
r = await call({ action: 'submit', t: tok(L1), answers: full, typed_name: 'Ashley Lloyd', strokes: sig }); ck('it needs the true-and-complete tick', r.s === 400 && /Tick/.test(r.j.error))
r = await call({ action: 'submit', t: tok(L1), answers: full, typed_name: 'Ashley Lloyd', strokes: [], consent: true }); ck('it needs a finger signature', r.s === 400 && /Sign in the box/.test(r.j.error))
r = await call({ action: 'submit', t: tok(L1), answers: full, typed_name: 'Pat Doe', strokes: sig, consent: true }); ck('a different name is refused', r.s === 400 && /full first and last name/.test(r.j.error))
r = await call({ action: 'submit', t: tok(L1), answers: full, typed_name: 'Ashley Lloyd', strokes: sig, consent: true })
ck('practice submit: signed, answers and signature kept, PDF under practice/, a copy for her', r.s === 200 && R1().status === 'submitted' && R1().answers.where === 'Bathroom' && R1().signature.length === 2 && /^practice\/501\//.test(R1().pdf_path) && STORE[R1().pdf_path] && /^https:\/\/signed\//.test(r.j.copy_url), r)
ck('...the note-only report is marked late (for Stage 4)', R1().told_late === true)
ck('...the link stops working once signed', R1().token_hash === null && (await call({ action: 'view', t: tok(L1) })).s === 404)
ck('...nothing texted, no card', !texts().length && !APP.ops_items.some((x) => x.kind === 'client_issue'))
r = await call({ action: 'list', client_ax: '501' })
ck('the client\'s list: the signed answers with their questions, never the link hash', r.j.reports.length === 1 && r.j.reports[0].answers.hurt === 'Yes' && r.j.reports[0].questions.some((x) => x.label === 'Was Carol hurt?') && !JSON.stringify(r.j).includes('token_hash'), r.j)
r = await call({ action: 'open', id: R1().id }); ck('opening the PDF: five minutes, logged against the client', r.j.expires_in === 300 && LOG.length === 1 && LOG[0].subject === 'client:501' && LOG[0].who.email === 'krystal@mo-care.com')
globalThis.__logFail = true; r = await call({ action: 'open', id: R1().id }); globalThis.__logFail = false; ck('...not opened if the open cannot be logged', r.s === 500)

// live
reset({ live: true }); r = await call({ action: 'start', source_item_id: 'flag1', happened_on: '2026-10-26' }); const L2 = r.j.link
let card = APP.ops_items.find((x) => x.kind === 'client_issue')
ck('live start: a card for the Incidents owner, "Text Ashley the report link", Carol F. only', card && card.owner === 'samantha@mo-care.com' && card.domain === 'incidents' && card.incident_id === R1().id && card.title === 'Incident report: Carol F., Oct 26, Ashley L.'
  && /^Text Ashley/.test(card.next_action) && card.source_id === 'flag1' && R1().card_id === card.id, card)
r = await call({ action: 'start', source_item_id: 'flag1', happened_on: '2026-10-26' }); const L2b = r.j.link
ck('starting again from the same flag: the same report, a new link, the old link stops', T.incident_report.length === 1 && L2b !== L2 && (await call({ action: 'view', t: tok(L2) })).s === 404 && (await call({ action: 'view', t: tok(L2b) })).s === 200)
r = await call({ action: 'send', id: R1().id, message: 'Hi Ashley, please fill in your report: ' + L2b })
const sms = texts()[0]
ck('live send: Krystal\'s exact words, a person\'s send to a caregiver, from the office line', r.j.outcome === 'sent' && sms.body.message.endsWith(L2b) && sms.body.fromNumber === '+14172348494'
  && SENT[0].opts.humanInitiated === true && SENT[0].opts.audience === 'caregiver' && SENT[0].opts.sender === 'incident-report', SENT)
card = APP.ops_items.find((x) => x.kind === 'client_issue')
ck('...the card says it is waiting for Ashley', /^Waiting for Ashley/.test(card.next_action) && card.status === 'open')
// the hourly job
CRON = true; WHO = null
r = await call({}); ck('the job right after sending: nothing owed', r.j.reminded === 0 && texts().length === 1, r.j)
R1().sent_at = new Date(Date.now() - 25 * 36e5).toISOString()
setCentralHour(2); r = await call({})
ck('at 2am: no reminder yet (it waits for the morning) but the card already turns red', r.j.reminded === 0 && r.j.skipped_hours === true && texts().length === 1
  && APP.ops_items.find((x) => x.kind === 'client_issue').urgency === 'urgent' && /Call Ashley/.test(APP.ops_items.find((x) => x.kind === 'client_issue').next_action), r.j)
setCentralHour(10); r = await call({})
{
  ck('24 hours later: ONE reminder, an automatic caregiver text with a new link', r.j.reminded === 1 && texts().length === 2 && SENT.filter((x) => x.check)[1].opts.humanInitiated === false && /reminder/.test(texts()[1].body.message) && !!R1().reminded_at, r.j)
  const L3 = texts()[1].body.message.match(/https:\/\/\S+incident\.html\?t=[A-Za-z0-9_-]+/)[0]
  ck('...the reminder\'s link works and the first one stops', (await call({ action: 'view', t: tok(L3) })).s === 200 && (await call({ action: 'view', t: tok(L2b) })).s === 404)
  card = APP.ops_items.find((x) => x.kind === 'client_issue')
  ck('...the card turns red: "Call Ashley"', card.urgency === 'urgent' && /Call Ashley/.test(card.next_action), card)
  r = await call({}); ck('the next run: no second reminder, ever', r.j.reminded === 0 && texts().length === 2)
  WHO = 'krystal'; CRON = false
  r = await call({ action: 'submit', t: tok(L3), answers: { ...full, told: 'I called the office', told_when: '2:30 pm, Krystal' }, typed_name: 'Ashley Lloyd', strokes: sig, consent: true })
  ck('live submit: signed, PDF under reports/, not late (she called)', r.s === 200 && R1().status === 'submitted' && /^reports\/501\//.test(R1().pdf_path) && R1().told_late === false, r)
  card = APP.ops_items.find((x) => x.kind === 'client_issue')
  ck('...the card: read it and close it with what was done', /filled in and signed/.test(card.next_action) && card.status === 'open' && card.urgency === 'today', card)
}
ck('families are never texted: every text went to Ashley\'s contact through the caregiver gate', SENT.filter((x) => x.check).every((x) => x.opts.audience === 'caregiver'))

// a failed reminder is a card; a closed card stays closed; the switch off does nothing
reset({ live: true }); CRON = false; r = await call({ action: 'start', source_item_id: 'flag1', happened_on: '2026-10-26' })
await call({ action: 'send', id: R1().id, message: 'Hi Ashley: ' + r.j.link })
R1().sent_at = new Date(Date.now() - 30 * 36e5).toISOString(); globalThis.__ghlFail = true; CRON = true
r = await call({}); globalThis.__ghlFail = false
ck('a reminder GoHighLevel refuses: a "didn\'t go through" card, and no retry', r.j.failed === 1 && PROBLEMS.length === 1 && PROBLEMS[0].sender === 'incident-report' && !!R1().reminded_at && (await call({})).j.reminded === 0, r.j)
reset({ live: false }); T.incident_report.push({ id: uuid(), status: 'waiting', practice: false, sent_at: new Date(Date.now() - 30 * 36e5).toISOString(), caregiver: 'Ashley Lloyd', client_name: 'Carol Fite', happened_on: '2026-10-26' })
CRON = true; r = await call({}); ck('the switch off: the job sends nothing', r.j.live === false && !texts().length)
CRON = false; r = await call({}); ck('the job refuses the public key', r.s === 401)
reset({ live: true }); r = await call({ action: 'start', client_ax: '501', client_name: 'Carol Fite', caregiver: 'Ashley Lloyd', happened_on: today })
ck('from the profile (no flag): a report and a card', r.s === 200 && !R1().source_item_id && APP.ops_items.some((x) => x.incident_id === R1().id))
APP.ops_items.find((x) => x.incident_id === R1().id).status = 'done'
await call({ action: 'send', id: R1().id, message: 'Hi Ashley: ' + r.j.link })
ck('a card a person closed stays closed', APP.ops_items.find((x) => x.incident_id === R1().id).status === 'done')
globalThis.__optout = true; reset({ live: true }); r = await call({ action: 'start', source_item_id: 'flag1', happened_on: '2026-10-26' })
r = await call({ action: 'send', id: R1().id, message: 'Hi: ' + r.j.link }); globalThis.__optout = false
ck('a caregiver who asked for no texts: not sent, says to call her', r.s === 422 && /Call Ashley/.test(r.j.error) && !texts().length)
reset({ live: true }); r = await call({ action: 'start', client_name: 'Carol Fite', client_ax: '501', caregiver: 'Pat Doe', happened_on: '2026-10-26' })
r = await call({ action: 'send', id: R1().id, message: 'Hi Pat: ' + r.j.link }); ck('no phone on the roster: not sent, says so', r.j.outcome === 'no_phone' && !texts().length)
r = await call({ action: 'relink', id: R1().id }); const Lr = r.j.link
ck('relink: a new link for the same report', r.s === 200 && T.incident_report.length === 1 && (await call({ action: 'view', t: tok(Lr) })).s === 200 && r.j.draft.includes(Lr))
r = await call({ action: 'cancel', id: R1().id }); ck('cancel: the link stops working and the card closes', R1().status === 'cancelled' && APP.ops_items.find((x) => x.incident_id === R1().id).status === 'done')
ck('...a cancelled report cannot get a new link', (await call({ action: 'relink', id: R1().id })).s === 409 && (await call({ action: 'view', t: tok(Lr) })).s === 404)
ck('a made-up link is refused', (await call({ action: 'view', t: 'x'.repeat(43) })).s === 404 && (await call({ action: 'view', t: 'bad' })).s === 404)
reset(); r = await call({ action: 'start', source_item_id: 'flag1', happened_on: '2026-10-26' }); R1().expires_at = new Date(Date.now() - 1000).toISOString()
ck('an expired link says to call for a new one', (await call({ action: 'view', t: tok(r.j.link) })).j.status === 'expired' && (await call({ action: 'submit', t: tok(r.j.link), answers: full, typed_name: 'Ashley Lloyd', strokes: sig, consent: true })).s === 410)
// ---- Stage 2: the office's review ----
const RV = { family: { told: 'yes', who: 'Carol\'s daughter Jan', when: 'Oct 26, 3pm' }, medical: { what: 'none' }, careplan: { change: true, note: 'Gait belt for every bathroom transfer.' }, ane: { suspect: false }, note: '' }
ck('review rules: every question needs an answer', /family told/.test(R.reviewMissing(R.cleanReview({}))) && /medical care/.test(R.reviewMissing(R.cleanReview({ family: RV.family })))
  && /abuse, neglect/.test(R.reviewMissing(R.cleanReview({ ...RV, ane: {} }))) && R.reviewMissing(R.cleanReview(RV)) === '')
ck('...family told needs who and when; not told needs why', /who in the family/.test(R.reviewMissing(R.cleanReview({ ...RV, family: { told: 'yes' } }))) && /why the family/.test(R.reviewMissing(R.cleanReview({ ...RV, family: { told: 'not_needed' } }))))
ck('...suspected abuse or neglect needs the hotline call and its report number', /1-800-392-0210/.test(R.reviewMissing(R.cleanReview({ ...RV, ane: { suspect: true } }))) && R.reviewMissing(R.cleanReview({ ...RV, ane: { suspect: true, hotline_at: 'Oct 27 9am', reference: 'R123' } })) === '')
ck('...a care plan change says what', /what in the care plan/.test(R.reviewMissing(R.cleanReview({ ...RV, careplan: { change: true } }))))
ck('the summary line', R.reviewSummary(R.cleanReview(RV)) === "Family told (Carol's daughter Jan, Oct 26, 3pm) · No care needed · care plan to change · not abuse or neglect", R.reviewSummary(R.cleanReview(RV)))
reset({ live: true }); r = await call({ action: 'start', source_item_id: 'flag1', happened_on: '2026-10-26' }); const Lv = r.j.link
r = await call({ action: 'review', id: R1().id, ...RV }); ck('a report not signed yet cannot be reviewed', r.s === 409)
await call({ action: 'submit', t: tok(Lv), answers: full, typed_name: 'Ashley Lloyd', strokes: sig, consent: true })
r = await call({ action: 'review', id: R1().id, ...RV, ane: {} }); ck('a review with a question unanswered is refused', r.s === 400 && /abuse/.test(r.j.error))
r = await call({ action: 'review', id: R1().id, ...RV })
const icard = APP.ops_items.find((x) => x.incident_id === R1().id && x.domain === 'incidents'), cpc = APP.ops_items.find((x) => x.id.startsWith('ops_inccp_'))
ck('the review saves, with who did it', r.s === 200 && R1().reviewed_by === 'krystal@mo-care.com' && R1().review.family.who === "Carol's daughter Jan", r.j)
ck('...closes the incident card with what was done', icard.status === 'done' && /^Reviewed: Family told/.test(icard.close_note), icard)
ck('...a care plan change is a card for the Client Care owner', cpc && cpc.domain === 'client_care' && cpc.status === 'open' && /Update the care plan/.test(cpc.title) && cpc.client_ax === '501' && /Gait belt/.test(cpc.detail), cpc)
r = await call({ action: 'review', id: R1().id, ...RV }); ck('...and it can only be saved once', r.s === 409)
r = await call({ action: 'list', caregiver: 'Ashley  Lloyd' })
ck('a caregiver\'s reports (their Performance tab), with the review', r.s === 200 && r.j.reports.length === 1 && r.j.reports[0].review && r.j.hotline === '1-800-392-0210', r.j)
ck('...one name is not enough to list', (await call({ action: 'list', caregiver: 'Ashley' })).s === 400)

// the Desktop step's sample
reset({ who: null }); OWNERKEY = true; r = await call({ action: 'sample' })
ck('the sample: a practice report for Test Caregiver, on no card', r.s === 200 && T.incident_report[0].practice && T.incident_report[0].source_item_id === 'practice-sample' && !APP.ops_items.some((x) => x.kind === 'client_issue'))
OWNERKEY = false; ck('...only the owner\'s server key can make one', (await call({ action: 'sample' })).s === 401)

SHIFT = 0
const bad = res.filter((x) => !x[1])
for (const [n, okk, note] of res) console.log((okk ? '  ✓ ' : '  ✗ ') + n + (okk ? '' : '\n      ' + note))
console.log(`\n${res.length - bad.length}/${res.length} passed`)
process.exit(bad.length ? 1 : 0)
