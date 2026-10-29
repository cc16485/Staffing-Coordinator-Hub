// PRN STEP 7 (Samantha 2026-10-29: "Yes, build step 7 with its switches off"): the twice-yearly "What would make PRN better?"
// questions (page + invite), on call on their page (PRN CNA Team), and the milestones on their page. The rules
// (_shared/prn-recognition.ts), the real prn-welcome and prn-page against a fake database and fake GoHighLevel, This week's
// lines, and the SQL on a throwaway Postgres when PGLITE is set. Nothing real is reached. node prn_recognition_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const FN = 'supabase/functions'
const SECRET = 'S'.repeat(48)
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString()
let CLOCK = { wd: 'Tue', hour: '11' }
const realTLS = Date.prototype.toLocaleString, realTLDS = Date.prototype.toLocaleDateString
Date.prototype.toLocaleString = function (loc, o) { if (o && o.hour === '2-digit' && !o.minute && o.timeZone === 'America/Chicago') return CLOCK.hour; return realTLS.call(this, loc, o) }
Date.prototype.toLocaleDateString = function (loc, o) { if (o && o.weekday === 'short' && o.timeZone === 'America/Chicago' && !o.month) return CLOCK.wd; if (loc === 'en-CA' && o && o.timeZone === 'America/Chicago' && !o.weekday && globalThis.__today && Math.abs(this.getTime() - Date.now()) < 5000) return globalThis.__today; return realTLDS.call(this, loc, o) }
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
fs.writeFileSync(`${FN}/_shared/_job-auth_t7.ts`, "export const jobCaller = async (req) => req.headers.get('x-test') === 'cron' ? 'cron' : null\n")
process.on('exit', () => { try { fs.unlinkSync(`${FN}/_shared/_job-auth_t7.ts`) } catch { /* */ } })
const load = async (name) => {
  const src = fs.readFileSync(`${FN}/${name}/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/(['"])\.\.\/_shared\/job-auth\.ts\1/, "'../_shared/_job-auth_t7.ts'")
  const tmp = path.join(process.cwd(), FN, name, '_t.ts'); fs.writeFileSync(tmp, src)
  let m; try { m = await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) } return { h: handler, m }
}
const R = await import(path.join(process.cwd(), FN, '_shared/prn-recognition.ts'))
const P = await import(path.join(process.cwd(), FN, '_shared/prn-page.ts'))
const PL = await import(path.join(process.cwd(), FN, '_shared/prn-page-links.ts'))
const PW = await import(path.join(process.cwd(), FN, '_shared/prn-week.ts'))

/* ── 1. twice a year ── */
ck('rounds: May and November, the first 30 days', R.feedbackRound('2026-11-04')?.id === '2026-11' && R.feedbackRound('2026-11-30')?.id === '2026-11' && R.feedbackRound('2026-05-01')?.until === '2026-05-30'
  && R.feedbackRound('2026-10-29') === null && R.feedbackRound('2026-12-01') === null && R.feedbackRound('2026-05-31') === null)
ck('the two questions, word for word', R.FEEDBACK_QUESTIONS.join(' | ') === 'What would make being on the PRN Team better for you? | Is there anything we could do to make picking up shifts easier?')
ck('the invite, word for word', R.feedbackText(null, 'Grace', 'L') === "Hi Grace, it's Caring Companions. We'd love to hear from you: two quick questions about the PRN Team are on your page: L Thank you for standing in the gap with us.")
ck('...her own wording wins', R.feedbackText('{first_name}! {link}', 'Tina', 'L') === 'Tina! L')
const Tk = (id, o = {}) => ({ applicant_id: id, track: 'prn_team', axiscare_caregiver_id: '7' + id, linked_at: daysAgo(30), ...o })
const fd = R.dueFeedback([Tk('a'), Tk('b'), Tk('c', { axiscare_caregiver_id: null }), Tk('d', { track: 'ongoing' })], [{ applicant_id: 'b', kind: 'feedback_invite_sent', ref: 'feedback:2026-11' }, { applicant_id: 'a', kind: 'feedback_invite_sent', ref: 'feedback:2026-05' }], '2026-11').map((t) => t.applicant_id)
ck('invites: on a PRN Team, on the schedule, once per round (May\'s invite doesn\'t count for November)', fd.join() === 'a', fd)
ck('...at most 20 a run', R.dueFeedback(Array.from({ length: 30 }, (_, i) => Tk('m' + i)), [], '2026-11').length === 20)
ck('answers: at least one; each kept as "1: ... / 2: ..."', !R.readFeedback({ a1: '', a2: ' ' }).ok && R.readFeedback({ a1: 'More weekend notice', a2: '' }).note === '1: More weekend notice\n2: (left blank)')
ck('...too long refused', !R.readFeedback({ a1: 'x'.repeat(281) }).ok)
ck('switch: off by default; needs the page open too', !R.feedbackLive({}) && !R.feedbackLive({ prn_feedback_live: true }) && R.feedbackLive({ prn_feedback_live: true, prn_page_live: true }))

/* ── 2. on call ── */
const oc = R.onCallFor([{ kind: 'offer', pattern: 'weekday', at: '2026-10-01T10:00:00Z' }, { kind: 'offer', pattern: 'every_other_weekend', at: '2026-10-20T10:00:00Z' },
  { kind: 'confirmed', start_date: '2026-11-07', end_date: '2026-11-08' }, { kind: 'confirmed', start_date: '2026-10-24', end_date: '2026-10-25' }, { kind: 'confirmed', start_date: '2026-11-14', end_date: '2026-11-15', cancelled_at: 'x' }], '2026-10-29', PW.PATTERNS)
ck('on call: their latest offer, and only confirmed dates still ahead (a taken-back one is gone)', oc.pattern === 'every_other_weekend' && oc.pattern_word === 'Every other weekend' && JSON.stringify(oc.confirmed) === '[{"start_date":"2026-11-07","end_date":"2026-11-08","shift":null}]', oc)
ck('...her two shifts and the expectations she decided, word for word, and no pay', R.ONCALL_WORDS === 'On call comes in two shifts: daytime, 7am to 5pm, and overnight, 5pm to 7am the next morning. Take one, or both for a whole day. On call means you reply within 15 minutes and can start a shift within 1 hour. The office confirms each date and shift with you first.' && !/\$|stipend|pay/i.test(R.ONCALL_WORDS))

/* ── 3. milestones (their own only, never compared) ── */
const ms = (covered, shifts = [], since = '2026-03-01', today = '2026-10-29') => R.milestonesFor({ covered, shifts, since, today }).map((m) => m.text)
ck('first PRN shift', ms(1)[0] === 'You stepped in for your first PRN shift. Thank you for standing in the gap.')
ck('...then the highest reached only: 7 shifts says 5; 30 says 25', ms(7)[0] === "You've stepped in for 5 PRN shifts. Thank you for standing in the gap." && ms(30)[0] === "You've stepped in for 25 PRN shifts. Thank you for standing in the gap." && ms(30).filter((t) => /PRN shifts/.test(t)).length === 1)
ck('...none yet: nothing', ms(0).length === 0)
ck('a year on the team', ms(0, [], '2025-10-01').includes('One year on the team. Thank you for being with us.'))
const SH = (d, kind = 'confirmed') => ({ shift_date: d, kind })
ck('kept every yes this season (3+ shifts, none backed out, last 90 days)', ms(3, [SH('2026-10-01'), SH('2026-09-15'), SH('2026-08-20')]).includes('You kept every shift you said yes to this season. Families count on that, and so do we.'))
ck('...a back-out this season: not said (and nothing negative is said either)', !ms(3, [SH('2026-10-01'), SH('2026-09-15'), SH('2026-08-20'), SH('2026-09-15', 'backed_out')]).some((t) => /kept every/.test(t)))
ck('...only two shifts: not yet', !ms(2, [SH('2026-10-01'), SH('2026-09-15')]).some((t) => /kept every/.test(t)))
ck('the page\'s thank-yous carry the same milestones (10 shifts and a year still read as before)', P.thanksFor({ touches: [], kindTells: [], ax: '11', covered: 10, since: '2025-10-01', today: '2026-10-29', shifts: [] }).map((x) => x.text).join(' | ')
  .includes("You've stepped in for 10 PRN shifts. Thank you for standing in the gap. | One year on the team."))
ck('no em dash and no "AI" in anything a member reads', ![...R.FEEDBACK_QUESTIONS, R.FEEDBACK_TEXT_DEFAULT, R.ONCALL_WORDS, ...ms(30, [SH('2026-10-01'), SH('2026-09-15'), SH('2026-08-20')], '2024-01-01')].some((t) => /—|\bAI\b/.test(t)))

/* ── 4. This week lines ── */
const lines = P.pageLines({ members: [{ applicant_id: 'g', name: 'Grace Hill', first: 'Grace', team: 'cna' }], today: '2026-11-04',
  log: [{ id: 41, applicant_id: 'g', kind: 'feedback', note: '[2026-11]\n1: More weekend notice\n2: (left blank)', at: '2026-11-04T15:00:00Z' }, { id: 42, applicant_id: 'g', kind: 'oncall_offer', note: 'Every other weekend', at: '2026-11-04T15:00:00Z' }], touches: [] })
const lf = lines.find((l) => l.kind === 'feedback'), lo = lines.find((l) => l.kind === 'oncall')
ck('This week: Grace\'s answers, without the round tag', lf && lf.title === 'Grace answered "What would make PRN better?"' && lf.detail === '1: More weekend notice · 2: (left blank)', lf)
ck('...an on-call offer from her page, to confirm in On call', lo && lo.title === 'Grace would like to be on call: every other weekend' && /Confirm dates with them in On call/.test(lo.detail), lo)
ck('...marked done, gone', P.pageLines({ members: [{ applicant_id: 'g', name: 'Grace Hill', first: 'Grace', team: 'cna' }], today: '2026-11-04', log: [{ id: 41, applicant_id: 'g', kind: 'feedback', note: 'x' }],
  touches: [{ applicant_id: 'g', kind: 'handled', ref: 'feedback:41' }] }).length === 0)

/* ── 5. the real prn-welcome: the invite ── */
const G = '00000000-0000-4000-8000-000000000001', TI = '00000000-0000-4000-8000-000000000002'
const resetW = (st = {}) => {
  SENT = []; OPTED = new Set()
  APP = { ops_settings: { ...st }, caregivers: [] }
  T = { pay_tracks: [Tk(G, { linked_at: daysAgo(40) }), Tk(TI, { linked_at: daysAgo(60), team: 'caregiver' })], prn_touches: [{ applicant_id: G, kind: 'welcome_sent', ref: 'welcome', message: 'x' }, { applicant_id: TI, kind: 'welcome_sent', ref: 'welcome', message: 'x' },
    { applicant_id: G, kind: 'page_ready_sent', ref: 'page_ready' }, { applicant_id: TI, kind: 'page_ready_sent', ref: 'page_ready' }],
    job_applicants: [{ id: G, first_name: 'Grace', last_name: 'Hill', phone: '4175550101' }, { id: TI, first_name: 'Tina', last_name: 'Shorr', phone: '4175550102' }], contact_optout_current: [], circle_contacts: [], phone_index: [] }
}
const Wf = await load('prn-welcome')
const runW = async (qs = '') => { const r = await Wf.h(new Request('https://x/functions/v1/prn-welcome' + qs, { method: 'POST', headers: { 'x-test': 'cron' }, body: '{}' })); return { s: r.status, j: await r.json() } }
globalThis.__today = '2026-10-29'; resetW({ prn_feedback_live: true, prn_page_live: true }); let r = await runW()
ck('October: no round, no invite', r.j.feedback_round === null && r.j.feedback_due === 0 && !SENT.length, r.j)
globalThis.__today = '2026-11-04'; resetW({}); r = await runW()
ck('November, switch off: practice (lists who would get it), nothing sent', r.j.feedback_round === '2026-11' && r.j.feedback_live === false && r.j.would_feedback.length === 2 && !SENT.length, r.j)
resetW({ prn_feedback_live: true }); r = await runW()
ck('...switch on, the page closed: still nothing', r.j.feedback_live === false && !SENT.length, r.j)
resetW({ prn_feedback_live: true, prn_page_live: true }); r = await runW()
ck('...both on: Grace and Tina each get one invite with their own page link', r.j.feedback_texted === 2 && SENT.length === 2 && SENT.every((m) => /^Hi (Grace|Tina), it's Caring Companions\. We'd love to hear from you: two quick questions about the PRN Team are on your page: https:\/\/cc\.mo-care\.com\/prn\.html\?p=[0-9a-f-]{36}&e=\d+&t=[A-Za-z0-9_-]{43} Thank you for standing in the gap with us\.$/.test(m.msg)), [r.j, SENT])
ck('...recorded once per member for the round, without the link', T.prn_touches.filter((t) => t.kind === 'feedback_invite_sent' && t.ref === 'feedback:2026-11' && /\(their page link\)/.test(t.message)).length === 2)
SENT = []; r = await runW(); ck('...run again: nobody twice', !SENT.length && r.j.feedback_due === 0, r.j)
resetW({ prn_feedback_live: true, prn_page_live: true }); OPTED.add('+14175550101'); r = await runW()
ck('...the do-not-text door: refused, not recorded (and carded by the door)', r.j.feedback_refused === 1 && r.j.feedback_texted === 1 && !T.prn_touches.some((t) => t.kind === 'feedback_invite_sent' && t.applicant_id === G), r.j)
resetW({ prn_feedback_live: true, prn_page_live: true }); r = await runW('?dry=1'); ck('...?dry=1: practice', !SENT.length && r.j.feedback_live === false)

/* ── 6. the real prn-page ── */
const { h: page } = await load('prn-page')
const link = Object.fromEntries(new URL(await PL.makePageLink(SECRET, G, PL.pageExpiry())).searchParams)
const linkTi = Object.fromEntries(new URL(await PL.makePageLink(SECRET, TI, PL.pageExpiry())).searchParams)
const resetP = (st = {}) => { APP = { ops_settings: { prn_page_live: true, ...st } }
  T = { pay_tracks: [{ applicant_id: G, track: 'prn_team', team: 'cna', since: '2026-03-01', axiscare_caregiver_id: '11' }, { applicant_id: TI, track: 'prn_team', team: 'caregiver', since: '2026-03-01', axiscare_caregiver_id: '12' }],
    job_applicants: [{ id: G, first_name: 'Grace', last_name: 'Hill', prn: {} }, { id: TI, first_name: 'Tina', last_name: 'Shorr', prn: {} }], prn_page_log: [], prn_oncall: [], prn_touches: [], prn_shift_log: [] } }
const call = async (b, L = link) => { const x = await page(new Request('https://x/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...L, ...b }) })); return { s: x.status, j: await x.json() } }
globalThis.__today = '2026-11-04'; resetP(); r = await call({ action: 'view' })
ck('page, questions switched off: not shown', r.j.ok && r.j.feedback === null, r.j.feedback)
r = await call({ action: 'feedback', a1: 'More notice' }); ck('...answering is refused, nothing kept', r.s === 409 && !T.prn_page_log.some((x) => x.kind === 'feedback'))
resetP({ prn_feedback_live: true }); r = await call({ action: 'view' })
ck('switched on in November: the two questions, open until Nov 30', r.j.feedback && r.j.feedback.round === '2026-11' && r.j.feedback.until === '2026-11-30' && r.j.feedback.questions.length === 2 && r.j.feedback.answered === false, r.j.feedback)
r = await call({ action: 'feedback', a1: 'More weekend notice', a2: '' })
ck('...answered: kept with the round, and thanks them', r.j.ok && /The office reads every answer/.test(r.j.message) && T.prn_page_log.some((x) => x.kind === 'feedback' && x.note === '[2026-11]\n1: More weekend notice\n2: (left blank)'), [r.j, T.prn_page_log])
r = await call({ action: 'feedback', a1: 'again' }); ck('...once a round', r.s === 409 && /already answered/.test(r.j.error))
r = await call({ action: 'view' }); ck('...the questions now show as answered', r.j.feedback.answered === true)
globalThis.__today = '2026-10-29'; resetP({ prn_feedback_live: true }); r = await call({ action: 'view' })
ck('October: no questions', r.j.feedback === null)
r = await call({ action: 'view' }); ck('on call: a PRN CNA sees the question with the expectations', r.j.oncall && r.j.oncall.pattern === null && Object.keys(r.j.oncall.patterns).length === 5 && /15 minutes/.test(r.j.oncall.words), r.j.oncall)
r = await call({ action: 'oncall', pattern: 'every_other_weekend' })
ck('...an offer from their page goes where the office reads offers, marked "Their PRN Team page"; nobody is put on call', r.j.ok && T.prn_oncall.some((x) => x.kind === 'offer' && x.pattern === 'every_other_weekend' && x.note === 'Their PRN Team page') && !T.prn_oncall.some((x) => x.kind === 'confirmed')
  && T.prn_page_log.some((x) => x.kind === 'oncall_offer' && x.note === 'Every other weekend'), T)
r = await call({ action: 'oncall', pattern: 'not_now' }); ck('..."not right now" never counts against them', /never counts against you/.test(r.j.message))
r = await call({ action: 'oncall', pattern: 'twice' }); ck('...an unknown answer is refused', r.s === 400)
r = await call({ action: 'view' }, linkTi); ck('the PRN Caregiver Team: no on-call question (CNA Team only to start)', r.j.ok && r.j.oncall === null)
r = await call({ action: 'oncall', pattern: 'weekday' }, linkTi); ck('...and it is refused', r.s === 409)
resetP(); APP.ops_settings.prn_page_live = false; r = await call({ action: 'oncall', pattern: 'weekday' }); ck('page closed: nothing saved', r.j.closed === true && !T.prn_oncall.length)

/* ── 7. the SQL ── */
const sql = fs.readFileSync('prn_recognition.sql', 'utf8')
if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE); const db = new PGlite()
  await db.exec(`create table public.job_applicants (id uuid primary key); create table public.app_data (key text primary key, data jsonb);
    create table public.job_postings (slug text primary key, description text);
    insert into public.job_applicants values ('00000000-0000-0000-0000-000000000001');`)
  try { await db.exec(`do $$ begin create role anon; create role authenticated; create role service_role; exception when others then null; end $$;`) } catch {}
  for (const f of ['prn_week.sql', 'prn_familiar.sql', 'prn_welcome.sql', 'prn_page.sql', 'prn_page_texts.sql', 'prn_open_shifts.sql', 'prn_monthly.sql']) await db.exec(fs.readFileSync(f, 'utf8'))
  await db.exec('begin;' + sql + 'commit;'); await db.exec('begin;' + sql + 'commit;')
  const A = "'00000000-0000-0000-0000-000000000001'"
  let okAll = true
  try {
    await db.query(`insert into public.prn_page_log (applicant_id, kind, note) values (${A}, 'feedback', 'x'), (${A}, 'oncall_offer', 'Every weekend'), (${A}, 'interested', 'c1'), (${A}, 'idea', 'y')`)
    await db.query(`insert into public.prn_touches (applicant_id, kind, ref, by_email) values (${A}, 'feedback_invite_sent', 'feedback:2026-11', 'a'), (${A}, 'monthly_sent', 'monthly:2026-10', 'a'), (${A}, 'page_ready_sent', 'page_ready', 'a')`)
  } catch (e) { okAll = String(e.message) }
  let bad = false; try { await db.query(`insert into public.prn_page_log (applicant_id, kind) values (${A}, 'nonsense')`) } catch { bad = true }
  ck('SQL: runs twice; the new kinds kept and every earlier one still; anything else refused', okAll === true && bad, okAll)
} else ck('SQL on a throwaway Postgres (skipped: PGLITE not set)', true)
const out = fs.readFileSync(`${FN}/_shared/outreach.ts`, 'utf8'), sp = await import(path.join(process.cwd(), FN, '_shared/send-problems.ts'))
ck('a refused or failed invite reads as "PRN Team twice-yearly questions invite" on Needs Attention, and the sender is registered', sp.SENDER_WORDS['prn-feedback']?.[0] === 'PRN Team twice-yearly questions invite' && /'prn-feedback':\s+\{ class: 'routine_internal'/.test(out))

const fails = res.filter((r) => !r[1])
for (const [n, okk, note] of res) console.log((okk ? 'PASS ' : 'FAIL ') + n + (okk ? '' : '  ' + note))
console.log(`\n${res.length - fails.length}/${res.length} passed`)
process.exit(fails.length ? 1 : 0)
