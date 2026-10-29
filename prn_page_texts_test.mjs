// PRN STEP 5a (Samantha 2026-10-29: "Build all three link texts as you wrote them, each with its switch off"): the welcome with
// the page link, "your PRN Team page is ready" and the 60-day check-in opening the page. The rules
// (_shared/prn-page-texts.ts) and the real prn-welcome and prn-reconfirm, fake database and fake GoHighLevel; plus the SQL on
// a throwaway Postgres when PGLITE is set. Nothing real is reached. node prn_page_texts_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const FN = 'supabase/functions'
const SECRET = 'S'.repeat(48)
let CLOCK = { wd: 'Tue', hour: '11' }
const realTLS = Date.prototype.toLocaleString, realTLDS = Date.prototype.toLocaleDateString
Date.prototype.toLocaleString = function (loc, o) { if (o && o.hour === '2-digit' && !o.minute && o.timeZone === 'America/Chicago') return CLOCK.hour; return realTLS.call(this, loc, o) }
Date.prototype.toLocaleDateString = function (loc, o) { if (o && o.weekday === 'short' && o.timeZone === 'America/Chicago' && !o.month) return CLOCK.wd; return realTLDS.call(this, loc, o) }
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString()
let T, APP, SENT, OPTED
const q = (t) => { const st = { f: [], isNull: [], nn: [], gte: null, upd: null }; const b = {
  select() { return b }, order() { return b }, limit() { return b },
  eq(c, v) { st.f.push([c, v]); return b }, is(c, v) { if (v === null) st.isNull.push(c); return st.upd ? b.run() : b }, not(c, op, v) { if (op === 'is' && v === null) st.nn.push(c); return b },
  gte(c, v) { st.gte = [c, v]; return b }, in() { return b },
  update(o) { st.upd = o; return b }, insert(o) { (T[t] ||= []).push({ ...o }); return Promise.resolve({ data: null, error: null }) },
  rows() { if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]; return k in APP ? [{ key: k, data: APP[k] }] : [] }
    let r = T[t] ?? []; for (const [c, v] of st.f) r = r.filter((x) => x[c] === v); for (const c of st.isNull) r = r.filter((x) => x[c] == null)
    for (const c of st.nn) r = r.filter((x) => x[c] != null); if (st.gte) r = r.filter((x) => String(x[st.gte[0]]) >= st.gte[1]); return r },
  run() { for (const x of b.rows()) Object.assign(x, st.upd); return Promise.resolve({ data: null, error: null }) },
  maybeSingle() { return Promise.resolve({ data: b.rows()[0] ?? null, error: null }) },
  then(ok, bad) { return Promise.resolve({ data: b.rows(), error: null }).then(ok, bad) } }; return b }
globalThis.__db = { from: q, rpc: async (fn, a) => {
  if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => String(x.id) === String(a.item.id)); if (i >= 0) arr[i] = a.item; else arr.push(a.item) }
  return { data: null, error: null } } }
globalThis.fetch = async (url, o) => {
  url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + body.phone, dnd: OPTED.has(body.phone) } }), { status: 200 })
  if (url.includes('/conversations/messages')) { SENT.push({ to: body.contactId, msg: body.message }); return new Response('{}', { status: 200 }) }
  return new Response('{}', { status: 200 })
}
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', HUB_JOB_SECRET: SECRET }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
fs.writeFileSync(`${FN}/_shared/_job-auth_t5.ts`, "export const jobCaller = async (req) => req.headers.get('x-test') === 'cron' ? 'cron' : null\n")
process.on('exit', () => { try { fs.unlinkSync(`${FN}/_shared/_job-auth_t5.ts`) } catch { /* */ } })
const load = async (name) => {
  const src = fs.readFileSync(`${FN}/${name}/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/(['"])\.\.\/_shared\/job-auth\.ts\1/, "'../_shared/_job-auth_t5.ts'")
  const tmp = path.join(process.cwd(), FN, name, '_t.ts'); fs.writeFileSync(tmp, src)
  let m; try { m = await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) } return { h: handler, m }
}
const X = await import(path.join(process.cwd(), FN, '_shared/prn-page-texts.ts'))
const WL = await import(path.join(process.cwd(), FN, '_shared/prn-welcome.ts'))
const PL = await import(path.join(process.cwd(), FN, '_shared/prn-page-links.ts'))
const LINK = 'https://cc.mo-care.com/prn.html?p=x&e=1&t=y'

/* ── the wording, as she approved it ── */
ck('page ready: word for word', X.pageReadyText(null, 'Grace', LINK) === `Hi Grace, your Caring Companions PRN Team page is ready: ${LINK} See the shifts we've asked you about, update your hours, or let us know you're looking for hours. It's just for you, so please don't share the link.`, X.pageReadyText(null, 'Grace', LINK))
ck('welcome with the link: her welcome, with the page line before "We\'re so glad you\'re here!"', X.welcomeWithLink(WL.welcomeText(null, 'Grace', 'cna'), LINK)
  === `Hi Grace, welcome to Caring Companions' PRN CNA Team! Our PRN Teams are our care continuity team: when a client needs coverage, you're among the first people we call. Saying no is always OK, and once you say yes, families count on you. We'll call you this week to say hello. Here's your own PRN Team page: ${LINK} We're so glad you're here!`, X.welcomeWithLink(WL.welcomeText(null, 'Grace', 'cna'), LINK))
ck('60-day check-in: word for word, opening their page', X.reconfirmPageText(null, 'Grace', LINK + '#hours') === `Hi Grace! We're updating our Caring Companions PRN Team availability. Are you still available for the times you gave us? Tap to confirm or update on your PRN Team page: ${LINK}#hours`)
ck('edited welcome with {link}: the link goes where she put it', X.welcomeWithLink('Welcome, Tina! Page: {link} See you soon.', LINK) === `Welcome, Tina! Page: ${LINK} See you soon.`)
ck('edited welcome of one sentence: the page line goes at the end', X.welcomeWithLink('Welcome to the team, Tina!', LINK) === `Welcome to the team, Tina! Here's your own PRN Team page: ${LINK}`)
ck('edited wording in Settings wins (page ready and check-in)', X.pageReadyText('Your page, {first_name}: {link}', 'Tina', LINK) === `Your page, Tina: ${LINK}` && X.reconfirmPageText('Check {link}, {first_name}', 'Tina', LINK) === `Check ${LINK}, Tina`)
ck('no em dash and no "AI" in any of the three', ![X.PAGE_READY_DEFAULT, X.RECONFIRM_PAGE_DEFAULT, X.WELCOME_LINK_LINE].some((t) => /—|\bAI\b/.test(t)))
const longest = X.welcomeWithLink(WL.welcomeText(null, 'Christopher', 'caregiver'), 'https://cc.mo-care.com/prn.html?p=00000000-0000-4000-8000-000000000000&e=1790000000&t=' + 'A'.repeat(43))
ck('the welcome with a real-length link is still one long text (under 480 characters)', longest.length < 480, longest.length)
ck('the record keeps the message with the link taken out', X.keptMessage(`a ${LINK} b`, LINK) === 'a (their page link) b')

/* ── the switches: each needs the page open too ── */
ck('all off: nothing', JSON.stringify(X.linkSwitches({})) === '{"page":false,"ready":false,"welcome":false,"reconfirm":false}')
ck('the three on, the page closed: none of them go', JSON.stringify(X.linkSwitches({ prn_page_ready_live: true, prn_welcome_link_live: true, prn_reconfirm_page_live: true })) === '{"page":false,"ready":false,"welcome":false,"reconfirm":false}')
ck('the page open, only the check-in on: only the check-in', JSON.stringify(X.linkSwitches({ prn_page_live: true, prn_reconfirm_page_live: true })) === '{"page":true,"ready":false,"welcome":false,"reconfirm":true}')

/* ── who gets "your page is ready" ── */
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
const Tk = (id, linkedDaysAgo, o = {}) => ({ applicant_id: id, track: 'prn_team', team: 'cna', axiscare_caregiver_id: linkedDaysAgo == null ? null : '7' + id, linked_at: linkedDaysAgo == null ? null : daysAgo(linkedDaysAgo), ...o })
const due = X.dueReady([Tk('old', 40), Tk('new', 3), Tk('wk', 8), Tk('none', null), Tk('sent', 50), Tk('welc', 20), Tk('ong', 60, { track: 'ongoing' }), Tk('nolink', 0, { linked_at: null })],
  [{ applicant_id: 'sent', kind: 'page_ready_sent', ref: 'page_ready' }, { applicant_id: 'welc', kind: 'welcome_sent', ref: 'welcome', message: 'Hi ... page: (their page link) We\'re so glad' }], TODAY).map((t) => t.applicant_id)
ck('a member who joined weeks ago: yes', due.includes('old'), due)
ck('linked 3 days ago: no, the welcome covers new members', !due.includes('new'), due)
ck('linked 8 days ago (past the welcome week): yes', due.includes('wk'), due)
ck('not linked in AxisCare yet: no', !due.includes('none'), due)
ck('already sent: never twice', !due.includes('sent'), due)
ck('their welcome already carried the link: no', !due.includes('welc'), due)
ck('moved to ongoing: no', !due.includes('ong'), due)
ck('linked before linked_at was recorded: yes', due.includes('nolink'), due)
ck('longest on the team first', due[0] === 'nolink' || due.indexOf('old') < due.indexOf('wk'), due)
ck('at most 20 a run', X.dueReady(Array.from({ length: 30 }, (_, i) => Tk('m' + i, 30 + i)), [], TODAY).length === 20)

/* ── the real prn-welcome ── */
const resetW = () => {
  SENT = []; OPTED = new Set()
  APP = { ops_settings: { prn_welcome_live: true }, caregivers: [] }
  T = { pay_tracks: [Tk('00000000-0000-4000-8000-000000000001', 1), Tk('00000000-0000-4000-8000-000000000002', 40)], prn_touches: [], job_applicants: [], contact_optout_current: [], circle_contacts: [], phone_index: [] }
  T.pay_tracks.forEach((t, i) => { T.job_applicants.push({ id: t.applicant_id, first_name: ['Grace', 'Tina'][i], last_name: 'Test', phone: '417555010' + i }) })
}
const Wf = await load('prn-welcome')
const runW = async (qs = '') => { const r = await Wf.h(new Request('https://x/functions/v1/prn-welcome' + qs, { method: 'POST', headers: { 'x-test': 'cron' }, body: '{}' })); return { s: r.status, j: await r.json() } }
resetW(); let r = await runW()
ck('welcome, link switch off: Grace gets the welcome exactly as before (no link); Tina gets nothing', SENT.length === 1 && SENT[0].msg === WL.welcomeText(null, 'Grace', 'cna') && r.j.ready_live === false && r.j.ready_due === 1 && r.j.would_ready.length === 1, [r, SENT])
resetW(); APP.ops_settings.prn_welcome_link_live = true; r = await runW()
ck('link switch on, the page still closed: the welcome goes without the link', SENT.length === 1 && !/prn\.html/.test(SENT[0].msg), SENT)
resetW(); Object.assign(APP.ops_settings, { prn_page_live: true, prn_welcome_link_live: true }); r = await runW()
const wm = SENT[0]?.msg || ''
const wq = Object.fromEntries(new URL((wm.match(/https:\S+/) || ['https://x'])[0]).searchParams)
ck('page open and link on: Grace\'s welcome carries her own page link, before the last sentence', SENT.length === 1 && /Here's your own PRN Team page: https:\/\/cc\.mo-care\.com\/prn\.html\?p=00000000-0000-4000-8000-000000000001&e=\d+&t=[A-Za-z0-9_-]{43} We're so glad you're here!$/.test(wm), wm)
ck('the link checks out for Grace and nobody else', await PL.checkPageLink(SECRET, wq) && !(await PL.checkPageLink(SECRET, { ...wq, p: '00000000-0000-4000-8000-000000000002' })))
const wrec = T.prn_touches.find((t) => t.kind === 'welcome_sent')
ck('the welcome record keeps the message without the link itself', wrec && wrec.message.includes('(their page link)') && !wrec.message.includes('t='), wrec)
ck('page ready off: Tina is only listed (practice), not texted', r.j.ready_live === false && r.j.would_ready.length === 1 && !SENT.some((m) => /Tina/.test(m.msg)), r)
resetW(); Object.assign(APP.ops_settings, { prn_page_ready_live: true }); r = await runW()
ck('page ready on, the page closed: nobody gets it', !SENT.some((m) => /page is ready/.test(m.msg)) && r.j.ready_live === false, [r, SENT])
resetW(); Object.assign(APP.ops_settings, { prn_page_live: true, prn_page_ready_live: true }); r = await runW()
const rm = SENT.find((m) => /page is ready/.test(m.msg))?.msg || ''
ck('page open and page ready on: Tina (joined 40 days ago) gets it once, with her own link', r.j.ready_texted === 1 && /^Hi Tina, your Caring Companions PRN Team page is ready: https:\/\/cc\.mo-care\.com\/prn\.html\?p=00000000-0000-4000-8000-000000000002&e=\d+&t=[A-Za-z0-9_-]{43} See the shifts/.test(rm), [r, rm])
ck('Grace (new this week) gets her welcome, not "page is ready"', SENT.filter((m) => /Grace/.test(m.msg)).length === 1 && !/page is ready/.test(SENT.find((m) => /Grace/.test(m.msg)).msg))
const rr = T.prn_touches.find((t) => t.kind === 'page_ready_sent')
ck('page ready is recorded (kind page_ready_sent), without the link itself', rr && rr.ref === 'page_ready' && rr.message.includes('(their page link)') && !/t=/.test(rr.message), rr)
SENT = []; r = await runW()
ck('run again: nobody gets it twice', !SENT.length && r.j.ready_due === 0, [r, SENT])
resetW(); Object.assign(APP.ops_settings, { prn_page_live: true, prn_page_ready_live: true }); OPTED.add('+14175550101'); r = await runW()
ck('page ready respects the do-not-text door: refused, not recorded', r.j.ready_refused === 1 && !T.prn_touches.some((t) => t.kind === 'page_ready_sent'), r)
resetW(); Object.assign(APP.ops_settings, { prn_page_live: true, prn_page_ready_live: true }); r = await runW('?dry=1')
ck('?dry=1 is always practice', !SENT.length && r.j.ready_live === false && r.j.live === false, r)
resetW(); Object.assign(APP.ops_settings, { prn_page_live: true, prn_page_ready_live: true }); CLOCK = { wd: 'Sat', hour: '11' }; r = await runW()
ck('Saturday: held, nothing sent', r.j.held && !SENT.length, r); CLOCK = { wd: 'Tue', hour: '11' }
resetW(); Object.assign(APP.ops_settings, { prn_page_live: true, prn_page_ready_live: true }); ENV.HUB_JOB_SECRET = ''; r = await runW()
ck('no link secret: page ready counts as failed, nothing sent or recorded', r.j.ready_failed === 1 && !SENT.some((m) => /page is ready/.test(m.msg)) && !T.prn_touches.some((t) => t.kind === 'page_ready_sent'), r)
ENV.HUB_JOB_SECRET = SECRET

/* ── the real prn-reconfirm ── */
const resetR = () => {
  SENT = []; OPTED = new Set()
  APP = { ops_settings: { prn_reconfirm_live: true }, caregivers: [], caregiver_availability: [] }
  T = { pay_tracks: [{ applicant_id: '00000000-0000-4000-8000-000000000009', track: 'prn_team', axiscare_caregiver_id: '9009' }], job_applicants: [{ id: '00000000-0000-4000-8000-000000000009', first_name: 'Denise', phone: '4175550109' }],
    prn_checkins: [], contact_optout_current: [], circle_contacts: [], phone_index: [] }
  APP.caregiver_availability.push({ id: '9009', axiscare_id: '9009', windows: {}, updated_at: daysAgo(90) })
}
const Rf = await load('prn-reconfirm')
const runR = async () => { const r = await Rf.h(new Request('https://x/functions/v1/prn-reconfirm', { method: 'POST', headers: { 'x-test': 'cron' }, body: '{}' })); return { s: r.status, j: await r.json() } }
resetR(); r = await runR()
ck('check-in, page switch off: exactly as before (the My Hours page)', SENT.length === 1 && /Tap to confirm or update: https:\/\/cc\.mo-care\.com\/availability\.html\?c=9009&/.test(SENT[0].msg) && r.j.to_page === false, [r, SENT])
resetR(); APP.ops_settings.prn_reconfirm_page_live = true; r = await runR()
ck('check-in switch on, the page closed: still the My Hours page', SENT.length === 1 && /availability\.html/.test(SENT[0].msg), SENT)
resetR(); Object.assign(APP.ops_settings, { prn_page_live: true, prn_reconfirm_page_live: true }); r = await runR()
const cm = SENT[0]?.msg || ''
ck('page open and switch on: opens Denise\'s own PRN Team page at My hours, her wording', /^Hi Denise! We're updating our Caring Companions PRN Team availability\. Are you still available for the times you gave us\? Tap to confirm or update on your PRN Team page: https:\/\/cc\.mo-care\.com\/prn\.html\?p=00000000-0000-4000-8000-000000000009&e=\d+&t=[A-Za-z0-9_-]{43}#hours$/.test(cm) && r.j.to_page === true, cm)
const cq = Object.fromEntries(new URL(cm.match(/https:\S+/)[0].replace('#hours', '')).searchParams)
ck('the check-in link checks out for Denise', await PL.checkPageLink(SECRET, cq))
ck('the check-in is recorded the same way (so it is answered when she saves on the page)', T.prn_checkins.length === 1 && T.prn_checkins[0].axiscare_caregiver_id === '9009')
const pageSrc = fs.readFileSync(`${FN}/prn-page/index.ts`, 'utf8')
ck('saving hours on the page answers the check-in', /prn_checkins'\)\.update\(\{ answered_at: [^}]*how: 'prn_page' \}\)/.test(pageSrc))

if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE)
  const db = new PGlite()
  await db.exec(`create table public.job_applicants (id uuid primary key); create table public.app_data (key text primary key, data jsonb);
    create table public.job_postings (slug text primary key, description text);
    insert into public.job_applicants values ('00000000-0000-0000-0000-000000000001');`)
  try { await db.exec(`do $$ begin create role anon; create role authenticated; create role service_role; exception when others then null; end $$;`) } catch {}
  for (const f of ['prn_week.sql', 'prn_familiar.sql', 'prn_welcome.sql', 'prn_page.sql', 'prn_page_texts.sql', 'prn_page_texts.sql']) await db.exec(fs.readFileSync(f, 'utf8'))
  const A = "'00000000-0000-0000-0000-000000000001'"
  let ok = true; try { await db.exec(`insert into public.prn_touches (applicant_id, kind, ref, by_email) values (${A}, 'page_ready_sent', 'page_ready', 'automatic'), (${A}, 'handled', 'idea:9', 'k@x'), (${A}, 'welcome_sent', 'welcome', 'automatic')`) } catch (e) { ok = false; console.log(e.message) }
  ck("SQL: 'page_ready_sent' is kept, every earlier kind still is (and running it twice is fine)", ok)
  let bad = false; try { await db.exec(`insert into public.prn_touches (applicant_id, kind, ref, by_email) values (${A}, 'paid', 'x', 'k')`) } catch { bad = true }
  ck('SQL: only the known kinds', bad)
} else console.log('  · PGLITE not set: the SQL was not run')

const failed = res.filter((x) => !x[1])
for (const [n, okk, note] of res) console.log((okk ? '  ✓ ' : '  ✗ FAIL ') + n + (okk ? '' : '\n      ' + note))
console.log(`\n${res.length - failed.length}/${res.length}`)
process.exit(failed.length ? 1 : 0)
