// The GHE AxisCare watch (GHE fix slice 3, Samantha 2026-10-08): the REAL ghe-reminders function against a fake database,
// a fake AxisCare (T1001 visits) and a fake GoHighLevel, on chosen days of the month. node ghe_watch_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const clone = (x) => JSON.parse(JSON.stringify(x))
let T, SENT = [], AX = {}, AXFAIL = false, AXCALLS = 0
/* the clock: a chosen Central date at 10:00 */
const RealDate = Date
let NOW = new RealDate('2026-11-03T16:00:00Z').getTime()
globalThis.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(NOW) } static now() { return NOW } }
const at = (ymd) => { NOW = new RealDate(ymd + 'T16:00:00Z').getTime() }
const visit = (ax, start, { code = 'T1001', clocked = false, nurse = ['Natasha', 'Early'] } = {}) => ({ id: 's=' + ax + ':d=' + start, client: { id: +ax }, caregiver: { id: 9, firstName: nurse[0], lastName: nurse[1] },
  scheduledStartDate: start + 'T15:00:00Z', startDate: start + 'T15:00:00Z', service: { code: code === 'T1001' ? 'GHE' : 'PC', procedureCode: code, description: code === 'T1001' ? 'General Health Evaluation' : 'Personal care' },
  clockIn: clocked ? { time: start + 'T15:02:00Z' } : null, clockOut: clocked ? { time: start + 'T16:00:00Z' } : null })
const reset = (live = true) => {
  T = {
    app_data: [
      { key: 'nurse_clients', data: [
        { id: 'c1', name: 'Ann Booked', axiscare_client_id: '1', ghe1: '2026-11', ghe2: '2027-05', assigned_nurse: 'Natasha Early', active: true },
        { id: 'c2', name: 'Bea Unbooked', axiscare_client_id: '2', ghe1: '2026-11', assigned_nurse: 'Natasha Early', active: true },
        { id: 'c3', name: 'Cal Visited', axiscare_client_id: '3', ghe1: '2026-11', assigned_nurse: 'Natasha Early', active: true },
        { id: 'c4', name: 'Dee Nolink', axiscare_client_id: '', ghe1: '2026-11', assigned_nurse: '', active: true },
        { id: 'c5', name: 'Eve December', axiscare_client_id: '5', ghe1: '2026-12', assigned_nurse: 'Natasha Early', active: true },
        { id: 'c6', name: 'Old Gone', axiscare_client_id: '6', ghe1: '2026-11', active: false }] },
      { key: 'ghe_forms', data: [] }, { key: 'nurse_staff', data: [{ name: 'Natasha Early', email: 'natasha@mo-care.com', cred: 'LPN' }] },
      { key: 'nurse_visits', data: [] }, { key: 'coordinator_staff', data: [] }, { key: 'ghe_watch', data: [] },
      { key: 'ops_items', data: [] }, { key: 'automation_heartbeats', data: [] }, { key: 'ops_settings', data: { ghe_watch_live: live } }],
    domains: [{ code: 'payer_programs', entity: 'cc_ihs', owner_person: 'p-kr' }],
    persons: [{ person_id: 'p-kr', primary_email: 'Krystal@mo-care.com' }],
  }
  AX = { '1': [visit('1', '2026-11-27'), visit('1', '2026-11-04', { code: 'T1019', clocked: true })], '2': [visit('2', '2026-11-05', { code: 'T1019', clocked: true })],
    '3': [visit('3', '2026-11-02', { clocked: true })], '5': [visit('5', '2026-12-09')] }
  SENT = []; AXFAIL = false; AXCALLS = 0
}
function q(t) {
  const st = { f: [], single: false }
  const match = (r) => st.f.every(([k, v]) => String(r[k]) === String(v))
  const run = () => { const rows = (T[t] || []).filter(match); return { data: st.single ? (rows[0] ? clone(rows[0]) : null) : clone(rows), error: null } }
  const b = { select() { return b }, eq(k, v) { st.f.push([k, v]); return b }, in() { return b }, limit() { return b },
    maybeSingle() { st.single = true; return Promise.resolve(run()) }, single() { st.single = true; return Promise.resolve(run()) }, then(ok, ko) { return Promise.resolve(run()).then(ok, ko) } }
  return b
}
globalThis.__db = { from: q, rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') { let row = T.app_data.find((r) => r.key === a.target_key); if (!row) { row = { key: a.target_key, data: [] }; T.app_data.push(row) }
  const i = row.data.findIndex((x) => x.id === a.item.id); if (i >= 0) row.data[i] = clone(a.item); else row.data.push(clone(a.item)) } return { data: null, error: null } } }
globalThis.fetch = async (u) => {
  const url = new URL(String(u))
  if (/axiscare\.com/.test(url.host)) { AXCALLS++; if (AXFAIL) return new Response('{}', { status: 500 })
    const ids = url.searchParams.get('clientIds'), from = url.searchParams.get('startDate'), to = url.searchParams.get('endDate')
    const vs = (AX[ids] || []).filter((v) => v.scheduledStartDate.slice(0, 10) >= from && v.scheduledStartDate.slice(0, 10) <= to)
    return new Response(JSON.stringify({ results: { visits: vs, nextPage: null } }), { status: 200 }) }
  return new Response('{}', { status: 404 })
}
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k', AXISCARE_API_KEY: 'axk', AXISCARE_SITE: '16485', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'L' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_gw_'))
try {
  fs.writeFileSync(path.join(tmp, 'job-auth.ts'), 'export async function jobCaller() { return "cron" }\n')
  fs.writeFileSync(path.join(tmp, 'outreach.ts'), 'export function outreachGate() { return null }\n')
  fs.writeFileSync(path.join(tmp, 'staff-contact.ts'), 'export async function ghlStaffContact(_c, o) { return "ct_" + o.email }\n')
  fs.writeFileSync(path.join(tmp, 'send-problems.ts'), 'export async function reportSendProblem() {}\nexport async function ghlSendChecked(_db, _h, _s, to, msg) { globalThis.__sent.push({ to: to.address, subject: msg.subject, html: msg.html }); return true }\n')
  fs.copyFileSync(path.join(F, '_shared', 'ghe-rules.js'), path.join(tmp, 'ghe-rules.js'))
  globalThis.__sent = SENT
  globalThis.GheRules = (await import(path.join(tmp, 'ghe-rules.js'))).default   /* in Deno the file sets self.GheRules itself; under node it is a CommonJS module */
  const src = fs.readFileSync(path.join(F, 'ghe-reminders/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/from '\.\.\/_shared\/([\w-]+)\.ts'/g, (_, m) => "from '" + path.join(tmp, m + '.ts') + "'").replace("'../_shared/ghe-rules.js'", "'" + path.join(tmp, 'ghe-rules.js') + "'")
  fs.writeFileSync(path.join(tmp, 'gr.ts'), src); await import(path.join(tmp, 'gr.ts'))
  const run = async (qs = '') => { globalThis.__sent = SENT; const r = await handler(new Request('https://x/f' + qs, { method: 'POST' })); return { status: r.status, j: await r.json() } }
  const W = (cid, m) => T.app_data.find((r) => r.key === 'ghe_watch').data.find((x) => x.id === `gw_${cid}_${m}`) || {}
  const cards = (k) => T.app_data.find((r) => r.key === 'ops_items').data.filter((x) => !k || x.kind === k)

  /* Nov 3 (a Tuesday): early in the month */
  reset(true); at('2026-11-03'); let r = await run()
  ck('reads AxisCare for each GHE window of last, this and next month (5 active windows; the inactive client left out)', r.j.watched === 5 && AXCALLS === 4 && r.j.not_linked === 1, r.j)
  ck('...Ann: a T1001 visit on Nov 27 = booked (her personal-care shift does not count), with the nurse\'s name', W('c1', '2026-11').state === 'booked' && W('c1', '2026-11').visit.at.startsWith('2026-11-27') && W('c1', '2026-11').visit.nurse === 'Natasha Early', W('c1', '2026-11'))
  ck('...Bea: only a personal-care (T1019) visit = no GHE booked', W('c2', '2026-11').state === 'none')
  ck('...Cal: a T1001 visit clocked in and out = visited (done)', W('c3', '2026-11').state === 'visited' && W('c3', '2026-11').stage === 'done' && /15:02/.test(W('c3', '2026-11').visit.clock_in))
  ck('...Dee: no AxisCare link = can\'t be checked, said so', W('c4', '2026-11').state === 'not_linked')
  ck('...Eve: next month\'s visit already booked', W('c5', '2026-12').stage === 'booked_ahead')
  ck('...before the 10th: no warnings, no cards', cards().length === 0 && !SENT.some((s) => /not booked yet/.test(s.subject)), [cards(), SENT.map((s) => s.subject)])
  ck('...the coordinator is the owner of Payer Programs (Krystal)', r.j.coordinator.email === 'krystal@mo-care.com', r.j.coordinator)

  /* Nov 10 */
  at('2026-11-10'); SENT.length = 0; r = await run()
  const warn = SENT.filter((s) => /GHE not booked yet: Bea Unbooked/.test(s.subject))
  ck('the 10th, Bea still not booked: one email to her nurse and one to the coordinator', warn.length === 2 && warn.some((s) => s.to === 'natasha@mo-care.com') && warn.some((s) => s.to === 'krystal@mo-care.com') && /add the visit in AxisCare as T1001/.test(warn[0].html), SENT.map((s) => s.to + ' ' + s.subject))
  ck('...Ann (booked) and Cal (visited) get no warning; Dee (no AxisCare link) gets none from AxisCare', !SENT.some((s) => /Ann Booked|Cal Visited|Dee Nolink/.test(s.subject)))
  at('2026-11-11'); SENT.length = 0; await run()
  ck('...once: the next day, no second warning', !SENT.some((s) => /not booked yet/.test(s.subject)))

  /* Nov 20 */
  at('2026-11-20'); SENT.length = 0; await run()
  const uc = cards('ghe_unbooked')
  ck('the 20th, still not booked: a Needs Attention card for the coordinator (Payer Programs), saying the nurse books it in AxisCare', uc.length === 1 && uc[0].owner === 'krystal@mo-care.com' && uc[0].domain === 'payer_programs' && uc[0].status === 'open' && /Bea Unbooked/.test(uc[0].title) && /closes itself once AxisCare shows it booked/.test(uc[0].detail), uc)
  ck('...the 20th digest tells the nurse which are booked and which are not', SENT.some((s) => s.to === 'natasha@mo-care.com' && /Bea Unbooked<\/b> — 2026-11 \(not booked in AxisCare yet\)/.test(s.html) && /Ann Booked<\/b> — 2026-11 \(booked in AxisCare 2026-11-27\)/.test(s.html)), SENT.map((s) => s.html).join('\n').slice(0, 900))
  /* the nurse books it */
  AX['2'].push(visit('2', '2026-11-26')); at('2026-11-23'); await run()
  ck('once AxisCare shows it booked, the card closes itself', cards('ghe_unbooked')[0].status === 'done' && /AxisCare shows it booked/.test(cards('ghe_unbooked')[0].done_by), cards('ghe_unbooked'))
  reset(true); AX['1'] = [visit('1', '2026-11-12')]; at('2026-11-20'); await run()
  ck('a booking that passed without a clock-in: the card says so ("passed without a clock-in")', cards('ghe_unbooked').some((c) => /GHE visit passed without a clock-in: Ann Booked/.test(c.title) && /2026-11-12 was not clocked/.test(c.detail)), cards('ghe_unbooked').map((c) => c.title))
  ck('...a client not linked to AxisCare never gets an AxisCare card or warning (it can\'t be checked)', !cards().some((c) => /Dee/.test(c.title)) && !SENT.some((s) => /Dee Nolink/.test(s.subject)))
  /* a person closed a card: respected */
  AX['2'] = AX['2'].filter((v) => v.scheduledStartDate.slice(0, 10) !== '2026-11-26')
  reset(true); at('2026-11-20'); await run(); T.app_data.find((r) => r.key === 'ops_items').data[0].status = 'done'; at('2026-11-21'); await run()
  ck('a card a person closed is not reopened', cards('ghe_unbooked')[0].status === 'done')

  /* last week */
  reset(true); at('2026-11-24'); SENT.length = 0; await run()
  ck('the last week, still not booked: Samantha hears, once', SENT.filter((s) => s.to === 'samantha@mo-care.com' && /GHE still not booked, 2026-11 ends soon: Bea Unbooked/.test(s.subject)).length === 1 && !SENT.some((s) => s.to === 'samantha@mo-care.com' && /Ann Booked/.test(s.subject)), SENT.map((s) => s.to + ' ' + s.subject))
  at('2026-11-25'); SENT.length = 0; await run()
  ck('...not again the next day', !SENT.some((s) => /ends soon/.test(s.subject)))

  /* the month over */
  reset(true); AX['1'] = [visit('1', '2026-11-18')]; at('2026-12-01'); await run()
  const mc = cards('ghe_missed')
  ck('December 1: November ended with no visit clocked → a Missed GHE card each for Ann (booked, never clocked) and Bea; not Cal (visited)', mc.length === 2 && mc.every((c) => c.urgency === 'urgent' && c.owner === 'krystal@mo-care.com') && mc.some((c) => /Ann Booked/.test(c.title)) && mc.some((c) => /Bea Unbooked/.test(c.title)) && !mc.some((c) => /Cal/.test(c.title)), mc.map((c) => c.title))
  ck('...the card says the next steps: next month (not billed or paid), outside our control (PCCP team), refusal (report to DSDS)', /not billed or paid/.test(mc[0].detail) && /PCCP team/.test(mc[0].detail) && /report it to DSDS/.test(mc[0].detail))
  ck('...Ann\'s watch: "not_visited" (the booking passed without a clock-in)', W('c1', '2026-11').state === 'not_visited' && W('c1', '2026-11').stage === 'missed')
  const wc = T.app_data.find((r) => r.key === 'ghe_watch').data.find((x) => x.id === 'gw_c2_2026-11'); wc.resolved = { reason: 'make_up', by: 'krystal@mo-care.com' }
  T.app_data.find((r) => r.key === 'ops_items').data.forEach((c) => { if (/Bea/.test(c.title)) c.status = 'done' })
  at('2026-12-02'); await run()
  ck('...a resolved missed GHE is not raised again', cards('ghe_missed').filter((c) => /Bea/.test(c.title) && c.status === 'open').length === 0)
  /* a GHE form counts as done too */
  reset(true); T.app_data.find((r) => r.key === 'ghe_forms').data.push({ client: 'Bea Unbooked', visit_date: '2026-11-15', status: 'ready' }); at('2026-12-01'); await run()
  ck('a GHE form dated in the month counts as done (no missed card for Bea)', !cards('ghe_missed').some((c) => /Bea/.test(c.title)))

  /* switched off, AxisCare down, practice run */
  reset(false); at('2026-11-20'); SENT.length = 0; r = await run()
  ck('switched off: AxisCare is read and recorded, but no card and no ladder email', W('c2', '2026-11').state === 'none' && cards().length === 0 && !SENT.some((s) => /not booked yet|ends soon/.test(s.subject)) && r.j.live === false, r.j)
  reset(true); at('2026-11-20'); AXFAIL = true; SENT.length = 0; r = await run()
  ck('AxisCare doesn\'t answer: nothing is assumed (no card, no warning), the heartbeat says so', r.j.axiscare_failed === 4 && cards().length === 0 && !SENT.some((s) => /not booked yet/.test(s.subject)) && /AxisCare failed 4/.test(T.app_data.find((x) => x.key === 'automation_heartbeats').data[0].note), r.j)
  reset(true); at('2026-11-20'); SENT.length = 0; r = await run('?dry=1')
  ck('a practice run (dry=1) writes nothing and sends nothing, and reports what it saw', SENT.length === 0 && T.app_data.find((x) => x.key === 'ghe_watch').data.length === 0 && cards().length === 0 && r.j.seen.length === 5, r.j)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, okk, d] of res) { console.log((okk ? 'PASS  ' : 'FAIL  ') + n + (okk ? '' : '  ' + d)); if (okk) pass++ }
console.log(`\n${pass} passed, ${res.length - pass} failed`); process.exit(pass === res.length ? 0 : 1)
