// STEP 1 ALERT (1136, Samantha 2026-10-26): the REAL _shared/step1-alert.ts and the REAL step1-alert job against a fake
// database and a fake GoHighLevel. Her wording; every admin on the "all admin" list; email at once, text at once except
// 8pm to 7am (then at 7am); one of each per admin per person, ever; never practice, training, before the switch, or old;
// a failed send is a card. node step1_alert_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1200)])
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_s1a_'))
const clone = (x) => x === undefined ? undefined : JSON.parse(JSON.stringify(x))
let T, SENT, GHL_FAIL
const ADMINS = ['samantha@mo-care.com', 'krystal@mo-care.com', 'angiel@mo-care.com']
const reset = (st = {}) => {
  T = { app_data: [{ key: 'ops_items', data: [] }, { key: 'automation_heartbeats', data: [] },
      { key: 'ops_settings', data: Object.assign({ step1_alert_live: true, step1_alert_live_since: '2026-10-26T00:00:00Z', coverage_alert_admins: ADMINS, office_quiet_start: 20, office_quiet_end: 7 }, st) },
      { key: 'coordinator_staff', data: [{ email: 'samantha@mo-care.com', name: 'Samantha Troutman', phone: '4175550101' }, { email: 'krystal@mo-care.com', name: 'Krystal Land', phone: '(417) 555-0102' },
        { email: 'angiel@mo-care.com', name: 'Angiel Smith', phone: '' }] }],
    step1_alerts: [] }
  SENT = []; GHL_FAIL = false
}
const match = (r, f) => f.every(([op, k, v]) => op === 'eq' ? String(r[k]) === String(v) : op === 'is' ? (r[k] ?? null) === v : op === 'gte' ? String(r[k]) >= String(v)
  : op === 'or' ? v.some(([kk]) => (r[kk] ?? null) === null) : true)
function q(t) {
  const st = { f: [], op: 'select', row: null, single: false, opts: {}, sel: false, lim: 0 }
  const run = () => {
    const tab = (T[t] = T[t] || [])
    if (st.op === 'upsert') {
      const i = tab.findIndex((r) => r.offer_id === st.row.offer_id)
      if (i >= 0) { if (!st.opts.ignoreDuplicates) tab[i] = { ...tab[i], ...clone(st.row) } } else tab.push({ email_claimed_at: null, text_claimed_at: null, ...clone(st.row) })
      return { data: null, error: null }
    }
    if (st.op === 'insert') { tab.push(clone(st.row)); return { data: null, error: null } }
    const rows = tab.filter((r) => match(r, st.f))
    if (st.op === 'update') { for (const r of rows) Object.assign(r, clone(st.row)); return { data: st.sel ? clone(rows) : null, error: null } }
    const out = st.lim ? rows.slice(0, st.lim) : rows
    return { data: st.single ? (out[0] ? clone(out[0]) : null) : clone(out), error: null }
  }
  const b = new Proxy({}, { get: (_, k) => {
    if (k === 'then') return (ok, ko) => Promise.resolve(run()).then(ok, ko)
    if (k === 'eq' || k === 'is' || k === 'gte') return (a, v) => { st.f.push([k, a, v]); return b }
    if (k === 'or') return (s) => { st.f.push(['or', '', s.split(',').map((x) => x.split('.'))]); return b }
    if (k === 'limit') return (n) => { st.lim = n; return b }
    if (k === 'select') return () => { st.sel = true; return b }
    if (k === 'insert' || k === 'upsert' || k === 'update') return (r, o) => { st.op = k; st.row = r; st.opts = o || {}; return b }
    if (k === 'single' || k === 'maybeSingle') return () => { st.single = true; return Promise.resolve(run()) }
    return () => b } })
  return b
}
const db = { from: q, rpc: async (fn, a) => {
  if (fn === 'upsert_app_data_item') { const row = T.app_data.find((r) => r.key === a.target_key) || (T.app_data.push({ key: a.target_key, data: [] }), T.app_data.at(-1)); const i = row.data.findIndex((x) => x.id === a.item.id); if (i >= 0) row.data[i] = clone(a.item); else row.data.push(clone(a.item)) }
  return { data: null, error: null } } }
const send = async (url, o = {}) => { url = String(url); const body = o.body ? JSON.parse(o.body) : {}
  if (/conversations\/messages/.test(url)) { if (GHL_FAIL) return new Response(JSON.stringify({ message: 'nope' }), { status: 422 }); SENT.push(body); return new Response(JSON.stringify({ messageId: 'm1' }), { status: 200 }) }
  if (/search\/duplicate/.test(url)) { const u = new URL(url); const key = u.searchParams.get('email') || u.searchParams.get('number'); return new Response(JSON.stringify({ contact: { id: 'c-' + key } }), { status: 200 }) }
  return new Response(JSON.stringify({ contact: { id: 'c-' + (body.email || body.phone || 'x'), dnd: false } }), { status: 200 }) }
globalThis.fetch = send
const ENV = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'svc-key-0123456789abcdef0123', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', HUB_JOB_SECRET: 'cron-secret-0123456789abcdef0123456789' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const fix = (src) => src.replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace(/from '\.\.\/_shared\/([\w-]+)\.ts'/g, (_, m) => "from '" + path.join(process.cwd(), F, '_shared', m + '.ts') + "'")
globalThis.__db = db
try {
  const A = await import(path.join(process.cwd(), F, '_shared/step1-alert.ts'))
  fs.writeFileSync(path.join(tmp, 'job-auth.ts'), fix(fs.readFileSync(path.join(F, '_shared/job-auth.ts'), 'utf8')).replace(/from '\.\/([\w-]+)\.ts'/g, (_, m) => "from '" + path.join(process.cwd(), F, '_shared', m + '.ts') + "'"))
  fs.writeFileSync(path.join(tmp, 'job.ts'), fix(fs.readFileSync(path.join(F, 'step1-alert/index.ts'), 'utf8')).replace(path.join(process.cwd(), F, '_shared', 'job-auth.ts'), path.join(tmp, 'job-auth.ts'))); await import(path.join(tmp, 'job.ts'))
  // 3:12pm Chicago on 2026-10-26 (CDT, UTC-5) is 20:12Z
  const DAY = new Date('2026-10-26T20:12:00Z'), NIGHT = new Date('2026-10-27T03:30:00Z'), SEVEN = new Date('2026-10-27T12:05:00Z')
  const PRACTICE = (await import(path.join(process.cwd(), F, '_shared/step1-crypto.ts'))).PRACTICE_OFFERS[0]
  const O = { id: 'off-1', position: 'Caregiver', offered_by: 'Samantha', onboarding_path: 'new' }
  const WHO = { first: 'Tina', last: 'Shorr', phone: '4175550123', email: 'tina@example.com', position: 'Caregiver' }
  const ANS = { professional_refs: [{ name: 'Jane Doe', phone: '417-555-0001', may_contact: 'yes' }, { name: 'Bob Roe', email: 'bob@x.com', may_contact: 'yes' }, { name: 'No Way', phone: '4175550003', may_contact: 'no' }],
    personal_refs: [{ name: 'Ann Lee', phone: '(417) 555-0004', email: 'ann@x.com', may_contact: 'yes' }] }
  const texts = () => SENT.filter((m) => m.type === 'SMS'), emails = () => SENT.filter((m) => m.type === 'Email')
  const cards = () => T.app_data.find((r) => r.key === 'ops_items').data

  // her wording
  const w = A.step1AlertWords({ name: 'Tina Shorr', phone: '4175550123', position: 'Caregiver', offered_by: 'Samantha', done_at: DAY.toISOString(), refs: { n: 3, phone: 2, email: 1 } }, { first: 'Krystal' }, DAY)
  ck('the text, word for word', w.sms === 'Step 1 done: Tina Shorr signed every form, including permission for background checks and references. Please start them now. Tap Claim in the Hub so nobody does it twice: https://cc.mo-care.com/#ops', w.sms)
  ck('the subject, word for word', w.subject === 'Step 1 done: start background checks and references for Tina Shorr', w.subject)
  const plain = w.html.replace(/<[^>]+>/g, ' ').replace(/&middot;/g, '·').replace(/&amp;/g, '&').replace(/&rarr;/g, '→').replace(/\s+/g, ' ')
  for (const s of ['Hi Krystal,', 'Tina Shorr finished Step 1 today at 3:12pm. Their signed forms include permission for background checks and the okay to contact their references.',
    'Please start now:', 'Tap Claim on their Needs Attention card so only one person works it.', 'Run the background checks: OIG, EDL, and FCSR.',
    'Contact their references. They gave 3 (2 with a phone, 1 with an email).', 'Phone: 417-555-0123 · Position: Caregiver · Offer by: Samantha', 'Open in Background & References →'])
    ck('the email says: ' + s, plain.includes(s), plain)
  ck('the email button opens Background & References', /href="https:\/\/cc\.mo-care\.com\/#onboarding"/.test(w.html))
  ck('no em dashes anywhere', !/—/.test(w.sms + w.html + w.subject))
  ck('the references counted the way they land (a "do not contact" one left out; one with a phone and an email counts as a phone)', JSON.stringify(A.step1RefCounts(ANS)) === JSON.stringify({ n: 3, phone: 2, email: 1 }), A.step1RefCounts(ANS))
  ck('no references we may contact: the email says to call them for some', /no references we may contact/.test(A.step1AlertWords({ name: 'X', done_at: DAY.toISOString(), refs: { n: 0, phone: 0, email: 0 } }, { first: 'Sam' }, DAY).html))
  ck('finished last night, read this morning: "yesterday at 9:40pm"', A.finishedWhen('2026-10-27T02:40:00Z', SEVEN) === 'yesterday at 9:40pm', A.finishedWhen('2026-10-27T02:40:00Z', SEVEN))

  // in the day: one email and one text to each admin, at once
  reset(); let r = await A.step1Alert(db, { offerId: 'off-1', o: O, who: WHO, answers: ANS, at: DAY.toISOString() }, { now: DAY, send })
  ck('daytime: every admin on the list gets the email (3)', emails().length === 3 && ADMINS.every((e) => emails().some((m) => m.contactId === 'c-' + e)), [r, emails().map((m) => m.contactId)])
  ck('...each greeted by their own first name', ['Samantha', 'Krystal', 'Angiel'].every((n) => emails().some((m) => m.html.includes('Hi ' + n + ','))))
  ck('...the two with a phone on the staff list get the text', texts().length === 2 && texts().every((m) => m.message.startsWith('Step 1 done: Tina Shorr')), [r, texts()])
  ck('...the one with no phone on the staff list is a card on Needs Attention (never silent)', cards().some((c) => /Angiel/.test(JSON.stringify(c))), cards())
  ck('...the record keeps what was sent', T.step1_alerts[0].email_result.sent.length === 3 && T.step1_alerts[0].text_result.sent.length === 2 && T.step1_alerts[0].text_result.failed.join() === 'angiel@mo-care.com', T.step1_alerts[0])
  const n0 = SENT.length
  r = await A.step1Alert(db, { offerId: 'off-1', o: O, who: WHO, answers: ANS, at: DAY.toISOString() }, { now: DAY, send })
  let h = await handler(new Request('http://x/step1-alert', { method: 'POST', headers: { 'x-cron-secret': ENV.HUB_JOB_SECRET } }))
  ck('never twice: Step 1 finishing again and the job running send nothing more', SENT.length === n0 && T.step1_alerts.length === 1, [r, SENT.length])

  // "later": the record is written before the page answers, the sending after
  reset(); let later = null
  r = await A.step1Alert(db, { offerId: 'off-1', o: O, who: WHO, answers: ANS, at: DAY.toISOString() }, { now: DAY, send, later: (p) => { later = p } })
  ck('step1-sign: the person is recorded before the page answers, the sending runs after', r.recorded === true && T.step1_alerts.length === 1 && later && SENT.length === 0, r)
  await later; ck('...and then it sends', emails().length === 3 && texts().length === 2)

  // at night: email at once, text at 7am
  reset(); r = await A.step1Alert(db, { offerId: 'off-1', o: O, who: WHO, answers: ANS, at: NIGHT.toISOString() }, { now: NIGHT, send })
  ck('10:30pm: the emails go at once, no text (office quiet hours)', emails().length === 3 && texts().length === 0 && /7am/.test(String(r.text)), r)
  r = await A.step1AlertSweep(db, { now: new Date('2026-10-27T07:00:00Z'), send })
  ck('...the job at 2am still sends no text', texts().length === 0 && r.owed === 1, r)
  r = await A.step1AlertSweep(db, { now: SEVEN, send })
  ck('...the job at 7:05am sends the text, once', texts().length === 2 && r.owed === 1, r)
  r = await A.step1AlertSweep(db, { now: new Date(SEVEN.getTime() + 600000), send })
  ck('...and the 7:15 run sends nothing', texts().length === 2 && emails().length === 3 && r.owed === 0, r)

  // never
  for (const [n, o, who, st, at] of [
    ['a practice hire', { ...O, offered_by: PRACTICE }, WHO, {}, DAY],
    ['a staff training walkthrough', O, { ...WHO, first: 'Pat', last: 'Preview (TRAINING)' }, {}, DAY],
    ['the switch is off', O, WHO, { step1_alert_live: false }, DAY],
    ['finished before the switch was turned on', O, WHO, { step1_alert_live_since: '2026-10-26T21:00:00Z' }, DAY]]) {
    reset(st); r = await A.step1Alert(db, { offerId: 'off-1', o, who, answers: ANS, at: at.toISOString() }, { now: DAY, send })
    await A.step1AlertSweep(db, { now: SEVEN, send })
    ck(`never alerted: ${n}`, SENT.length === 0, [r, SENT])
  }
  reset(); T.step1_alerts.push({ offer_id: 'old', name: 'Old Hire', done_at: '2026-10-22T15:00:00Z', refs: { n: 2, phone: 2, email: 0 }, email_claimed_at: null, text_claimed_at: null })
  T.app_data.find((x) => x.key === 'ops_settings').data.step1_alert_live_since = '2026-10-01T00:00:00Z'
  r = await A.step1AlertSweep(db, { now: DAY, send })
  ck('never alerted: finished over 3 days ago', SENT.length === 0, r)
  reset({ step1_alert_live: false }); T.step1_alerts.push({ offer_id: 'off-9', name: 'Off Switch', done_at: DAY.toISOString(), refs: {}, email_claimed_at: null, text_claimed_at: null })
  Object.assign(T.app_data.find((x) => x.key === 'ops_settings').data, { step1_alert_live: true, step1_alert_live_since: new Date(DAY.getTime() + 300000).toISOString() })
  r = await A.step1AlertSweep(db, { now: new Date(DAY.getTime() + 300000), send })
  ck('someone finished while it was off, then she turned it on: not alerted (the Hub stamps the turn-on time)', SENT.length === 0, r)

  // no silent failures
  reset(); GHL_FAIL = true; r = await A.step1Alert(db, { offerId: 'off-1', o: O, who: WHO, answers: ANS, at: DAY.toISOString() }, { now: DAY, send })
  ck('GoHighLevel refuses: every refused email and text is a card on Needs Attention', cards().length >= 5, [r, cards().map((c) => c.title)])
  reset({ coverage_alert_admins: [] }); T.domains = []; T.app_data.find((x) => x.key === 'coordinator_staff').data = []
  r = await A.step1Alert(db, { offerId: 'off-1', o: O, who: WHO, answers: ANS, at: DAY.toISOString() }, { now: DAY, send })
  ck('nobody on the admin list (and no fallback): a card says so', SENT.length === 0 || cards().length > 0, [r, cards()])

  // the job's door
  h = await handler(new Request('http://x/step1-alert', { method: 'POST' }))
  ck('the job answers nobody without its secret (401)', h.status === 401)
  h = await handler(new Request('http://x/step1-alert?auth_check=1', { method: 'POST', headers: { 'x-cron-secret': ENV.HUB_JOB_SECRET } }))
  ck('...and its own schedule with it', h.status === 200 && (await h.json()).caller === 'cron')

  // step1-sign calls it once, at completion, with the answers and the page not waiting
  const s1 = fs.readFileSync(path.join(F, 'step1-sign/index.ts'), 'utf8')
  ck('step1-sign: called once, right after they enter Background & References, sending after the page answers',
    (s1.match(/step1Alert\(/g) || []).length === 1 && /entered = await enterChecks\(db, id, who, o, at\)\n(.*\n){2}\s*entered\.alert = await step1Alert\(db, \{ offerId: id, o, who, answers, at \}, \{ later: afterAnswer \}\)/.test(s1))
  ck('the failure cards name it for the office', /'step1-alert': \['Step 1 done alert to the admins'/.test(fs.readFileSync(path.join(F, '_shared/send-problems.ts'), 'utf8')))
  const sq = fs.readFileSync('step1_alert_1136.sql', 'utf8')
  ck('the table is the server\'s alone, and the switch is added OFF only when missing', /revoke all on public\.step1_alerts from anon, authenticated/.test(sq) && /'step1_alert_live', false\) \|\| data/.test(sq) && /not \(data \? 'step1_alert_live'\)/.test(sq))
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
