// Medicaid visits from AxisCare (slice D, Samantha 2026-10-08): the REAL medicaid-visits function against a fake database
// and a fake AxisCare, on chosen days. node medicaid_visits_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const clone = (x) => JSON.parse(JSON.stringify(x))
const RealDate = Date; let NOW = new RealDate('2026-10-20T20:00:00Z').getTime()
globalThis.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(NOW) } static now() { return NOW } }
const at = (iso) => { NOW = new RealDate(iso).getTime() }
let T, AX, AXFAIL, CALLS
const vis = (ax, day, clocked = false, code = 'T1019', minutes = 120) => ({ id: 'v' + ax + day, client: { id: +ax }, scheduledStartDate: day + 'T14:00:00Z', scheduledEndDate: day + 'T16:00:00Z', service: { procedureCode: code }, caregiver: { firstName: 'Maria', lastName: 'Lopez' },
  clockIn: clocked ? { time: day + 'T14:00:00Z' } : null, clockOut: clocked ? { time: new RealDate(Date.parse(day + 'T14:00:00Z') + minutes * 60000).toISOString() } : null })
const plan = (ax, name, o = {}) => Object.assign({ id: 'mcp_' + ax, kind: 'plan', axiscare_client_id: ax, client_name: name, plan_start: '2026-06-01', plan_end: '2027-01-31', generated: '2026-05-30',
  services: [{ ours: true, kind: 'pc', units: ['2026-09', '2026-10', '2026-11'].map((m) => ({ start: m + '-01', code: 'T1019', units: 120 })) }] }, o)
const reset = (live = true) => {
  T = { app_data: [
      { key: 'medicaid_plans', data: [plan('1', 'Ann Risk'), plan('2', 'Bea Fine'), plan('3', 'Cal Ended', { plan_end: '2026-09-30' }), plan('4', 'Dee Cds', { services: [{ ours: false, kind: 'cds', units: [] }] }), plan('', 'No Ax'), { id: 'mcm_9', kind: 'payer_mark', axiscare_client_id: '9', payer: 'private' }] },
      { key: 'timekeeper_cases', data: [{ visit_id: 'v12026-10-16', resolved_at: 'x', resolved_reason: 'calling_off', resolved_by_name: 'Krystal Land' }] },
      { key: 'visit_watch', data: [] }, { key: 'ops_items', data: [] }, { key: 'automation_heartbeats', data: [] }, { key: 'ops_settings', data: { visit_watch_live: live } }],
    domains: [{ code: 'scheduling_coverage', entity: 'cc_ihs', owner_person: 'p-sal' }, { code: 'payer_programs', entity: 'cc_ihs', owner_person: 'p-ang' }],
    persons: [{ person_id: 'p-sal', primary_email: 'Sally@mo-care.com' }, { person_id: 'p-ang', primary_email: 'angiel@mo-care.com' }] }
  AX = { '1': [vis('1', '2026-10-01', true), vis('1', '2026-10-14', true), vis('1', '2026-10-16'), vis('1', '2026-10-19'), vis('1', '2026-10-28')],
    '2': [vis('2', '2026-10-01', true), vis('2', '2026-10-19', true), vis('2', '2026-10-19', false, 'T1001')],
    '3': [vis('3', '2026-10-02', true)] }
  AXFAIL = false; CALLS = []
}
function q(t) { const st = { f: [], single: false }; const match = (r) => st.f.every(([k, v]) => String(r[k]) === String(v))
  const run = () => { const rows = (T[t] || []).filter(match); return { data: st.single ? (rows[0] ? clone(rows[0]) : null) : clone(rows), error: null } }
  const b = { select() { return b }, eq(k, v) { st.f.push([k, v]); return b }, maybeSingle() { st.single = true; return Promise.resolve(run()) }, then(ok, ko) { return Promise.resolve(run()).then(ok, ko) } }; return b }
globalThis.__db = { from: q, rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') { let row = T.app_data.find((r) => r.key === a.target_key); if (!row) { row = { key: a.target_key, data: [] }; T.app_data.push(row) }
  const i = row.data.findIndex((x) => x.id === a.item.id); if (i >= 0) row.data[i] = clone(a.item); else row.data.push(clone(a.item)) } return { data: null, error: null } } }
globalThis.fetch = async (u) => { const url = new URL(String(u)); if (/axiscare\.com/.test(url.host)) { CALLS.push(url.searchParams.get('clientIds') + ' ' + url.searchParams.get('startDate') + '..' + url.searchParams.get('endDate')); if (AXFAIL) return new Response('{}', { status: 500 })
  const id = url.searchParams.get('clientIds'), f = url.searchParams.get('startDate'), to = url.searchParams.get('endDate')
  return new Response(JSON.stringify({ results: { visits: (AX[id] || []).filter((v) => v.scheduledStartDate.slice(0, 10) >= f && v.scheduledStartDate.slice(0, 10) <= to), nextPage: null } }), { status: 200 }) } return new Response('{}', { status: 404 }) }
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k', AXISCARE_API_KEY: 'a', AXISCARE_SITE: '16485' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_mv_'))
try {
  fs.writeFileSync(path.join(tmp, 'job-auth.ts'), 'export async function jobCaller(req) { return req.headers.get("x-test") === "no" ? null : "cron" }\n')
  fs.copyFileSync(path.join(F, '_shared', 'visit-rules.js'), path.join(tmp, 'visit-rules.js'))
  globalThis.VisitRules = (await import(path.join(tmp, 'visit-rules.js'))).default
  const src = fs.readFileSync(path.join(F, 'medicaid-visits/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace("'../_shared/job-auth.ts'", "'" + path.join(tmp, 'job-auth.ts') + "'").replace("'../_shared/visit-rules.js'", "'" + path.join(tmp, 'visit-rules.js') + "'")
  fs.writeFileSync(path.join(tmp, 'mv.ts'), src); await import(path.join(tmp, 'mv.ts'))
  const run = async (qs = '', hdr = {}) => { const r = await handler(new Request('https://x/f' + qs, { method: 'POST', headers: hdr })); return { status: r.status, j: await r.json() } }
  const W = (id) => T.app_data.find((r) => r.key === 'visit_watch').data.find((x) => x.id === id) || {}
  const cards = (k) => T.app_data.find((r) => r.key === 'ops_items').data.filter((x) => !k || x.kind === k)

  reset(true); at('2026-10-20T20:00:00Z'); let r = await run('', { 'x-test': 'no' })
  ck('only its schedule (or the owner) may run it', r.status === 401)
  r = await run()
  ck('only clients with a current Medicaid plan of our care and an AxisCare number: Ann and Bea (not the ended plan, the CDS plan, no number, private pay)', r.j.clients === 2 && CALLS.every((c) => /^[12] /.test(c)) && CALLS.length === 2, [r.j, CALLS])
  ck('...AxisCare is read from the 1st of the month to today', CALLS[0].endsWith('2026-10-01..2026-10-20'), CALLS)
  const a = W('vw_1_2026-10')
  ck('Ann: 2 delivered (Oct 1, 14) = 16 units of 120; 2 not delivered (Oct 16 with the alert\'s reason "calling_off", Oct 19 with none)', a.delivered_units === 16 && a.authorized_units === 120 && a.missed.map((m) => m.day).join() === '2026-10-16,2026-10-19' && a.missed[0].reason.reason === 'calling_off' && a.missed[1].reason === null, a)
  ck('...at risk: 2 in a row not delivered, last delivered Oct 14', a.risk.at_risk && a.risk.in_a_row === 2 && a.risk.last_delivered === '2026-10-14')
  const rc = cards('visit_risk')
  ck('...two cards: Staffing (Sally) to arrange a make-up, the Medicaid coordinator (Angiel) to see it set and record reasons; urgent, citing (4)(A)5', rc.length === 2 && rc.some((c) => c.owner === 'sally@mo-care.com' && /make-up visit or a substitute/.test(c.detail)) && rc.some((c) => c.owner === 'angiel@mo-care.com' && /record the reasons/.test(c.detail)) && rc.every((c) => c.urgency === 'urgent' && /\(4\)\(A\)5/.test(c.detail) && /2026-10-16, 2026-10-19/.test(c.detail)), rc)
  const b = W('vw_2_2026-10')
  ck('Bea: both visits delivered, the GHE (T1001) visit not counted; not at risk; no card', b.visits_delivered === 2 && b.visits_scheduled === 2 && !b.risk.at_risk && !cards().some((c) => /Bea/.test(c.title)), b)
  /* a visit is delivered again */
  AX['1'].push(vis('1', '2026-10-21', true)); at('2026-10-21T20:00:00Z'); await run()
  ck('once a visit is delivered again, both risk cards close themselves', cards('visit_risk').every((c) => c.status === 'done' && /a visit was delivered/.test(c.done_by)), cards('visit_risk'))
  /* a person closed it */
  reset(true); at('2026-10-20T20:00:00Z'); await run(); cards('visit_risk').forEach((c) => { c.status = 'done' }); at('2026-10-20T21:00:00Z'); await run()
  ck('a card a person closed is not reopened', cards('visit_risk').every((c) => c.status === 'done'))
  /* the monthly review */
  reset(true); AX['1'] = [vis('1', '2026-09-03', true), vis('1', '2026-09-10'), vis('1', '2026-10-01', true)]; at('2026-10-02T20:00:00Z'); r = await run()
  ck('the first days of a month: last month is read too (to finish it)', r.j.months.join() === '2026-09,2026-10' && CALLS.some((c) => /2026-09-01\.\.2026-09-30/.test(c)), [r.j.months, CALLS])
  const rv = cards('visit_review')
  ck('...a monthly visit review card for September for each client, for the Medicaid coordinator, with the numbers', rv.length === 2 && rv.every((c) => c.owner === 'angiel@mo-care.com') && rv.some((c) => /Monthly visit review, 2026-09: Ann Risk/.test(c.title) && /8 of 120 authorized units delivered \(clocked time\), 1 visit not delivered/.test(c.detail)), rv)
  const sw = T.app_data.find((x) => x.key === 'visit_watch').data.find((x) => x.id === 'vw_1_2026-09'); sw.review = { signed_at: 'x', signed_name: 'Angiel' }
  T.app_data.find((x) => x.key === 'ops_items').data = []; at('2026-10-03T20:00:00Z'); await run()
  ck('...a signed month gets no review card again', !cards('visit_review').some((c) => /Ann Risk/.test(c.title)) && cards('visit_review').some((c) => /Bea Fine/.test(c.title)))
  ck('...and the signature is kept when the month is read again', W('vw_1_2026-09').review && W('vw_1_2026-09').review.signed_name === 'Angiel')
  /* switch off, AxisCare down, practice */
  reset(false); at('2026-10-20T20:00:00Z'); r = await run()
  ck('switched off: AxisCare is read and kept for the Payer tab, but no card', W('vw_1_2026-10').risk && cards().length === 0 && r.j.live === false && r.j.at_risk.length === 1)
  reset(true); AXFAIL = true; r = await run()
  ck('AxisCare doesn\'t answer: nothing is assumed (nothing written, no card), the heartbeat says so', r.j.axiscare_failed === 2 && T.app_data.find((x) => x.key === 'visit_watch').data.length === 0 && cards().length === 0 && /AxisCare failed 2/.test(T.app_data.find((x) => x.key === 'automation_heartbeats').data[0].note), r.j)
  reset(true); r = await run('?dry=1')
  ck('a practice run (dry=1) writes nothing and reports who is at risk', T.app_data.find((x) => x.key === 'visit_watch').data.length === 0 && cards().length === 0 && r.j.at_risk.length === 1 && r.j.at_risk[0].name === 'Ann Risk', r.j)

  /* ADW respite (we only do basic) */
  const rsv = (day, h1, h2, o = {}) => Object.assign({ id: 'r' + day + h1, scheduledStartDate: day + 'T' + h1 + ':00:00Z', scheduledEndDate: day + 'T' + h2 + ':00:00Z', service: { procedureCode: 'S5150', description: 'Basic Respite' }, caregiver: { firstName: 'Ana', lastName: 'Ruiz' } }, o)
  const resp = () => { T.app_data.find((x) => x.key === 'medicaid_plans').data.push(plan('5', 'Rae Respite', { services: [{ ours: true, kind: 'adw_respite', units: [{ start: '2026-10-01', code: 'S5150', units: 400 }] }] })) }
  reset(true); resp(); AX['5'] = ['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'].map((d) => rsv(d, '12', '22')); at('2026-10-20T20:00:00Z'); r = await run()
  const rw = W('vw_5_2026-10')
  ck('respite: the schedule ahead is read (this Monday to 2 weeks out) and the week of Oct 19 booked for 50 hours is over 49', CALLS.some((c) => /^5 2026-10-01\.\.2026-11-03/.test(c)) && rw.respite && rw.respite.over_weeks[0].week === '2026-10-19' && rw.respite.over_weeks[0].hours === 50, [CALLS, rw.respite])
  const rcards = cards('respite_limit')
  ck('...a card for Staffing and one for the Medicaid coordinator: fix the schedule in AxisCare, citing the limit', rcards.length === 2 && rcards.some((c) => c.owner === 'sally@mo-care.com') && rcards.some((c) => c.owner === 'angiel@mo-care.com') && rcards.every((c) => /49-hour weekly limit: week of 2026-10-19 has 50 hours/.test(c.detail) && /Provider Bulletin 49-03/.test(c.detail)), rcards)
  AX['5'] = AX['5'].slice(0, 4); at('2026-10-20T21:00:00Z'); await run()
  ck('...once the schedule is cut to 40 hours, both cards close themselves', cards('respite_limit').every((c) => c.status === 'done' && /within the limits/.test(c.done_by)))
  reset(true); resp(); AX['5'] = [rsv('2026-10-22', '14', '18'), vis('5', '2026-10-22'), rsv('2026-10-23', '14', '16', { service: { procedureCode: 'S5150 TF', description: 'Advanced Respite' } })]; r = await run()
  const rc2 = cards('respite_limit')[0]
  ck('respite overlapping personal care, and advanced respite booked (we only do basic): both named on the card', /overlaps another visit on 2026-10-22/.test(rc2.detail) && /ADVANCED respite is booked on 2026-10-23 with Ana Ruiz/.test(rc2.detail), rc2)
  ck('...the practice report lists the respite problems', r.j.respite.length === 1 && r.j.respite[0].name === 'Rae Respite')
  reset(true); r = await run()
  ck('clients without our respite line: no extra AxisCare read, no respite card', !CALLS.some((c) => /2026-11-03/.test(c)) && !cards('respite_limit').length)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, okk, d] of res) { console.log((okk ? 'PASS  ' : 'FAIL  ') + n + (okk ? '' : '  ' + d)); if (okk) pass++ }
console.log(`\n${pass} passed, ${res.length - pass} failed`); process.exit(pass === res.length ? 0 : 1)
