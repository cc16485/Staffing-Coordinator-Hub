// Zach's alerts (HR Agent build step 7) · the rules and the real function against a fake database · node hr_alerts_fn_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, d) => res.push([n, !!c, c ? '' : String(JSON.stringify(d ?? null)).slice(0, 800)])
const FN = 'supabase/functions'
const R = await import(path.join(process.cwd(), FN, '_shared/hr-alert-rules.ts'))

// ---- the rules ----
const today = '2026-10-20'
const items = R.waitingItems({ today,
  cases: [{ id: 'c1', kind: 'recurring', status: 'open' }, { id: 'c2', kind: 'serious', status: 'open' }, { id: 'c3', kind: 'coaching', status: 'open' },
    { id: 'c4', kind: 'recurring', status: 'reviewed' }, { id: 'c5', kind: 'recognition', status: 'open' }],
  writeups: [{ id: 'w1', status: 'pending_approval', updated_at: 't1' }, { id: 'w2', status: 'draft' }, { id: 'w3', status: 'issued' }],
  coaching: [{ id: 'k1', status: 'open', due_on: '2026-10-25', help_at: 'h1' }, { id: 'k2', status: 'open', due_on: '2026-10-25', help_at: 'h1', help_reply_at: 'r' },
    { id: 'k3', status: 'open', due_on: '2026-10-19' }, { id: 'k4', status: 'open', due_on: '2026-10-20', handoff_at: 'x1' }, { id: 'k5', status: 'done', due_on: '2026-10-01', help_at: 'h' }] })
ck('waiting: recurring and serious cases only (not coaching, recognition or reviewed)', items.filter((k) => k.startsWith('case:')).join() === 'case:c1,case:c2', items)
ck('waiting: only the write-up sent for approval', items.filter((k) => k.startsWith('approve:')).length === 1 && items.includes('approve:w1:t1'), items)
ck('waiting: an unanswered help request (an answered one is not)', items.includes('help:k1:h1') && !items.some((k) => k.startsWith('help:k2')), items)
ck('waiting: an overdue talk (due today is not overdue yet), a handback; a closed record never', items.includes('late:k3:2026-10-19') && !items.some((k) => k.startsWith('late:k4')) && items.includes('handoff:k4:x1') && !items.some((k) => k.includes('k5')), items)
ck('new: only the ones not told yet', R.newItems(['a', 'b'], ['a']).join() === 'b' && R.newItems(['a'], null).join() === 'a')
const at = (iso) => new Date(iso)
ck('window: Tuesday 9am Central is open', R.sendWindow(at('2026-10-20T14:00:00Z')))
ck('window: Tuesday 7:59am and 6pm Central are closed', !R.sendWindow(at('2026-10-20T12:59:00Z')) && !R.sendWindow(at('2026-10-20T23:00:00Z')))
ck('window: Saturday noon closed, unless weekends are exactly true', !R.sendWindow(at('2026-10-24T17:00:00Z')) && R.sendWindow(at('2026-10-24T17:00:00Z'), { hr_alert_weekends: true }) && !R.sendWindow(at('2026-10-24T17:00:00Z'), { hr_alert_weekends: 'yes' }))
ck('the Chicago date, not the UTC one', R.chicagoDate(at('2026-10-21T03:00:00Z')) === '2026-10-20')
const to = R.recipients({ to_phone: '(417) 555-0100', to_emails: ['Z@Example.com', 'z@example.com', 'bad', ''] })
ck('recipients: phone made +1, emails cleaned and deduped', to.phone === '+14175550100' && to.emails.join() === 'z@example.com', to)
ck('recipients: nothing set = nothing', R.recipients(null).phone === '' && R.recipients(undefined).emails.length === 0)
const words = [R.TEXT, R.TEST_TEXT, R.SUBJECT, R.TEST_SUBJECT, R.emailHtml(), R.emailHtml(true)].join(' ')
ck('the words: generic, the HR link, no em dash', /You have an HR item to review/.test(R.TEXT) && R.TEXT.includes('https://cc.mo-care.com/#hr') && !/—/.test(words))
ck('the text is one short text (under 160 characters)', R.TEXT.length < 160, R.TEXT.length)

// ---- the function ----
let APP, T, SENT, PROBS, NOW, FAIL
const reset = (opts = {}) => {
  APP = { ops_settings: opts.ops || {}, discipline_actions: [{ id: 'w1', status: 'pending_approval', caregiver: 'Jordan Miller', updated_at: 't1' }], automation_heartbeats: [] }
  T = { hr_cases: [{ id: 'c1', kind: 'serious', status: 'open', caregiver: 'Jordan Miller' }], hr_coaching: [],
    hr_alert_state: opts.noRow ? [] : [{ id: 'zach', to_phone: '4175550100', to_emails: ['z@example.com', 'z2@example.com'], seen: [], practice_log: [] }] }
  SENT = []; PROBS = []; FAIL = opts.fail || ''
  NOW = opts.now || '2026-10-20T15:00:00Z'
}
const q = (t) => { const st = { f: [], op: 'select' }; const b = {
  select() { return b }, eq(c, v) { st.f.push([c, v]); return b },
  maybeSingle() { if (t === 'app_data') { const k = st.f.find(([c]) => c === 'key')[1]; return Promise.resolve({ data: k in APP ? { data: APP[k] } : null, error: null }) }
    const r = (T[t] || []).filter((x) => st.f.every(([c, v]) => x[c] === v)); return Promise.resolve({ data: r[0] || null, error: null }) },
  update(row) { st.op = 'update'; st.row = row; return b },
  insert(row) { if (FAIL === 'save') return Promise.resolve({ error: { message: 'boom' } }); T[t].push({ ...row }); return Promise.resolve({ error: null }) },
  then(res_) {
    if (st.op === 'update') { if (FAIL === 'save') return res_({ error: { message: 'boom' } }); for (const x of T[t]) if (st.f.every(([c, v]) => x[c] === v)) Object.assign(x, st.row); return res_({ error: null }) }
    if (FAIL === 'read' && t === 'hr_coaching') return res_({ data: null, error: { message: 'boom' } })
    return res_({ data: (T[t] || []).filter((x) => st.f.every(([c, v]) => x[c] === v)), error: null }) } }; return b }
globalThis.__db = { from: q, rpc: (fn, a) => { if (a.target_key === 'automation_heartbeats') APP.automation_heartbeats.push(a.item); return Promise.resolve({ error: null }) } }
globalThis.__sent = (x) => SENT.push(x); globalThis.__prob = (x) => PROBS.push(x)
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'l' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const stubs = {
  '_ha_job.ts': "export const jobCaller = async (req) => req.headers.get('x-test') || null\n",
  '_ha_admin.ts': "export const textAdmin = async (sb, ghl, a, message) => { if (globalThis.__failText) { globalThis.__prob({ channel: 'sms' }); return false } globalThis.__sent({ channel: 'sms', to: a.phone, message }); return true }\n",
  '_ha_send.ts': "export const ghlSendChecked = async (db, h, sender, to, body) => { globalThis.__sent({ channel: 'email', sender, to: to.address, ...body }); return true }\nexport const reportSendProblem = async (db, p) => { globalThis.__prob(p) }\n",
  '_ha_contact.ts': "export const ghlStaffContact = async () => 'cid'\n",
}
for (const [f, c] of Object.entries(stubs)) fs.writeFileSync(`${FN}/_shared/${f}`, c)
process.on('exit', () => { for (const f of Object.keys(stubs)) try { fs.unlinkSync(`${FN}/_shared/${f}`) } catch { /* */ } })
const RealDate = Date
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [NOW])) } static now() { return new RealDate(NOW).getTime() } }
const src = fs.readFileSync(`${FN}/hr-alerts/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace("'../_shared/job-auth.ts'", "'../_shared/_ha_job.ts'").replace("'../_shared/clockin-admins.ts'", "'../_shared/_ha_admin.ts'")
  .replace("'../_shared/send-problems.ts'", "'../_shared/_ha_send.ts'").replace("'../_shared/staff-contact.ts'", "'../_shared/_ha_contact.ts'")
const tmp = path.join(process.cwd(), FN, 'hr-alerts', '_t.ts'); fs.writeFileSync(tmp, src)
try { await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
const run = async (qs = '', who = 'cron') => { const r = await handler(new Request('https://x/functions/v1/hr-alerts' + qs, { method: 'POST', headers: who ? { 'x-test': who } : {}, body: '{}' })); return { s: r.status, j: await r.json() } }
const row = () => T.hr_alert_state[0]

reset(); let r = await run('', null)
ck('no schedule secret and no owner key: refused', r.s === 401 && !SENT.length, r)
r = await run('?auth_check=1'); ck('auth check names the caller', r.s === 200 && r.j.caller === 'cron')
reset(); r = await run('?dry=1')
ck('a dry run counts and changes nothing', r.s === 200 && r.j.waiting === 2 && r.j.new === 2 && !SENT.length && row().seen.length === 0 && !APP.automation_heartbeats.length, r)
reset(); r = await run()
ck('practice: 2 new items in the day: nothing sent, the alert it would have sent is logged', r.j.live === false && r.j.alerted === true && !SENT.length && row().practice_log.length === 1, r)
ck('...the log has counts only: 1 text, 2 emails, no names', JSON.stringify(row().practice_log[0]).match(/"would_text":1,"would_email":2/) && !/Jordan|Miller|serious|w1|c1/.test(JSON.stringify(row().practice_log)), row().practice_log)
ck('...both items are now told', row().seen.length === 2 && APP.automation_heartbeats[0]?.ok === true)
r = await run(); ck('run again: nothing new, no second alert', r.j.new === 0 && r.j.alerted === false && row().practice_log.length === 1, r)
T.hr_coaching.push({ id: 'k1', status: 'open', due_on: '2026-10-25', help_at: 'h1' }); r = await run()
ck('a new help request: one more alert', r.j.new === 1 && r.j.alerted === true && row().practice_log.length === 2, r)
T.hr_cases[0].status = 'reviewed'; r = await run(); ck('a closed item drops off the told list', r.j.waiting === 2 && !row().seen.includes('case:c1'), row().seen)

reset({ ops: { hr_alerts_live: true } }); r = await run()
ck('live: one text and one email to each address', r.j.live === true && r.j.texts === 1 && r.j.emails === 2 && SENT.length === 3, r)
const all = JSON.stringify(SENT)
ck('...the text is the generic one, with the HR link', SENT[0].channel === 'sms' && SENT[0].to === '+14175550100' && SENT[0].message === R.TEXT, SENT[0])
ck('...no name, reason or write-up anywhere in what was sent', !/Jordan|Miller|serious|pending|w1|c1/i.test(all), all.slice(0, 400))
ck('...the emails go under the hr-alert sender with the generic subject', SENT.slice(1).every((x) => x.sender === 'hr-alert' && x.subject === R.SUBJECT), SENT)
ck('...last sent is recorded and nothing goes to the practice log', !!row().last_sent_at && row().practice_log.length === 0)
r = await run(); ck('live, run again: nothing new, nothing sent', r.j.alerted === false && SENT.length === 3, r)
reset({ ops: { hr_alerts_live: 'yes' } }); r = await run(); ck('only exactly true turns it live', r.j.live === false && !SENT.length)

reset({ ops: { hr_alerts_live: true }, now: '2026-10-21T02:00:00Z' }); r = await run()
ck('9pm Central: nothing sent, the items stay new', r.j.alerted === false && !SENT.length && row().seen.length === 0, r)
NOW = '2026-10-21T13:05:00Z'; r = await run(); ck('...and they go at 8am', r.j.alerted === true && SENT.length === 3, r)
reset({ ops: { hr_alerts_live: true }, now: '2026-10-24T17:00:00Z' }); r = await run(); ck('Saturday: waits for Monday', r.j.alerted === false && !SENT.length)

reset({ ops: { hr_alerts_live: true }, noRow: true }); r = await run()
ck('no recipients set: nothing sent, a Needs Attention card says so', !SENT.length && PROBS.length === 1 && /Desktop 965/.test(PROBS[0].reasons[0]) && T.hr_alert_state.length === 1, { r, PROBS })
reset({ ops: { hr_alerts_live: true } }); globalThis.__failText = true; r = await run(); globalThis.__failText = false
ck('a text that cannot go: a card, the emails still go, no retry storm (told)', r.j.texts === 0 && r.j.emails === 2 && PROBS.length === 1 && row().seen.length === 2, r)

reset(); r = await run('?test=1', 'cron'); ck('test: refused for the schedule (owner only)', r.s === 403 && !SENT.length)
reset(); r = await run('?test=1', 'owner')
ck('test (practice): one test text and two test emails go', r.s === 200 && r.j.texts === 1 && r.j.emails === 2 && SENT[0].message === R.TEST_TEXT && SENT[1].subject === R.TEST_SUBJECT, r)
ck('...a test does not touch what Zach was told', row().seen.length === 0 && row().practice_log.length === 0)
reset({ now: '2026-10-21T03:00:00Z' }); r = await run('?test=1', 'owner'); ck('test at night: refused', r.s === 409 && !SENT.length)

reset({ fail: 'read' }); r = await run(); ck('a failed read: an error, nothing sent, a failed heartbeat', r.s === 500 && !SENT.length && APP.automation_heartbeats[0]?.ok === false, r)
reset({ fail: 'save' }); r = await run(); ck('a failed save: an error', r.s === 500, r)

const body = fs.readFileSync(`${FN}/hr-alerts/index.ts`, 'utf8') + fs.readFileSync(`${FN}/_shared/hr-alert-rules.ts`, 'utf8')
ck('no em dashes in the job', !/—/.test(body))
ck('no phone number or personal email in the public code', !/\d{3}[-. ]?\d{3}[-. ]?\d{4}/.test(body.replace(/2026-10-\d\d/g, '')) && !/gmail/i.test(body))
ck('the job reads nothing from the case but its id, kind and status', /select\('id,kind,status'\)/.test(body) && /select\('id,status,due_on,help_at,help_reply_at,handoff_at'\)/.test(body))

globalThis.Date = RealDate
let f = 0; for (const [n, ok, d] of res) { console.log((ok ? 'PASS' : 'FAIL') + ' · ' + n + (ok ? '' : '  ' + d)); if (!ok) f++ }
console.log((res.length - f) + '/' + res.length); process.exit(f ? 1 : 0)
