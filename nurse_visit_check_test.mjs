// Nurse visit checks, the billing hold and nurse license reminders (LPN nurse visit plan, Samantha approved 2026-10-14;
// Desktop 707): the REAL nurse-visit-check function and its REAL shared rules against a fake database, a fake AxisCare and a
// fake GoHighLevel, at a pinned clock. node nurse_visit_check_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const clone = (x) => JSON.parse(JSON.stringify(x))
const RealDate = Date
let NOW = new RealDate('2026-10-14T15:00:00Z').getTime()   /* 10am Central */
globalThis.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(NOW) } static now() { return NOW } }
const at = (iso) => { NOW = new RealDate(iso).getTime() }

let T, AX, AXFAIL, PATCHES, PATCHFAIL, SENT, ROLE
const V = (ax, id, day, { svc = 'Medication organizer setup', code = 'T1001', clocked = true, note = 'Filled the organizer, no concerns.', nurse = ['Lena', 'Pruitt'], doNotBill, hour = 15 } = {}) => {
  const t = `${day}T${String(hour).padStart(2, '0')}:00:00Z`
  return { id, client: { id: +ax }, caregiver: { id: 9, firstName: nurse[0], lastName: nurse[1] }, scheduledStartDate: t, startDate: t,
    service: { code, procedureCode: code, description: svc }, clockIn: clocked ? { time: t } : null, clockOut: clocked ? { time: day + 'T16:00:00Z' } : null,
    careNote: note, ...(doNotBill === undefined ? {} : { doNotBill }) }
}
const months = (from, n, units) => Array.from({ length: n }, (_, i) => { const d = new RealDate(Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1 + i, 1)); const e = new RealDate(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)); return { start: d.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10), code: 'T1001', units } })
const plan = (ax, start, end, services) => ({ id: `mcp_${ax}_${start}_g`, kind: 'plan', axiscare_client_id: ax, client_name: 'Client ' + ax, plan_start: start, plan_end: end, generated: start, services })
const reset = (st = {}) => {
  T = {
    app_data: [
      { key: 'ops_settings', data: { ...st } },
      { key: 'nurse_clients', data: [{ id: 'nc1', name: 'Ann Able', axiscare_client_id: '1', ghe1: '2026-09', ghe2: '2027-03', assigned_nurse: 'Lena Pruitt', active: true }] },
      { key: 'medicaid_plans', data: [
        plan('1', '2026-06-01', '2027-05-31', [
          { kind: 'pc', ours: true, start: '2026-06-01', end: '2027-05-31', units: [] },
          { kind: 'nurse', ours: true, start: '2026-06-01', end: '2027-05-31', prior_auth: '12345678', units: months('2026-06-01', 12, 4) },
          { kind: 'ghe', ours: true, start: '2026-09-01', end: '2026-09-30', units: [{ start: '2026-09-01', end: '2026-09-30', code: 'T1001', units: 1 }] }]),
        plan('2', '2026-06-01', '2027-05-31', [{ kind: 'pc', ours: true, start: '2026-06-01', end: '2027-05-31', units: [] }]),
        { id: 'pm_3', kind: 'payer_mark', axiscare_client_id: '3', payer: 'private' },
        plan('4', '2026-05-01', '2026-11-16', [{ kind: 'nurse', ours: true, start: '2026-05-01', end: '2026-11-16', units: [] }]),
        plan('6', '2026-06-01', '2027-05-31', [{ kind: 'nurse', ours: true, start: '2026-06-01', end: '2027-05-31', units: [] }]),
      ] },
      { key: 'ghe_forms', data: [{ id: 'g1', client: 'Ann Able', client_id: 'nc1', visit_date: '2026-09-10', nurse: 'Lena Pruitt', status: 'rn_review', sig_nurse: 'x' }] },
      { key: 'nurse_staff', data: [{ name: 'Lena Pruitt', cred: 'LPN', license: 'PN1', expires: '2026-11-13', email: 'lena@example.test', employee: true },
        { name: 'Natasha Early', cred: 'RN', license: 'RN1', expires: '2027-08-31', email: 'natasha@example.test', employee: true, supervising_rn: true }] },
      { key: 'ghe_watch', data: [{ id: 'gw_nc1_2026-09', state: 'visited', visit: { id: 'v4' } }] },
      { key: 'nurse_bill_check', data: [] }, { key: 'ops_items', data: [] }, { key: 'nurse_license_reminders', data: [] },
      { key: 'caregivers', data: [{ id: 5, first: 'Lena', last: 'Pruitt', email: 'lena@example.test', phone: '4175551234' }] },
      { key: 'automation_heartbeats', data: [] }, { key: 'automation_log', data: [] }],
    domains: [{ code: 'payer_programs', entity: 'cc_ihs', owner_person: 'p-kr' }],
    persons: [{ person_id: 'p-kr', primary_email: 'Krystal@mo-care.com' }],
  }
  const six = Array.from({ length: 27 }, (_, i) => V('6', 'c6_' + i, new RealDate(Date.UTC(2026, 5, 2 + i * 4)).toISOString().slice(0, 10)))
  AX = [
    V('1', 'v1', '2026-10-01'), V('1', 'v2', '2026-10-01', { hour: 18 }), V('1', 'v3', '2026-10-05', { note: '' }),
    V('1', 'v4', '2026-09-10', { svc: 'Nurse Visit (T1001)', note: '' }),
    V('1', 'v5', '2026-10-07'), V('1', 'v6', '2026-10-08'),
    V('1', 'pc1', '2026-10-02', { svc: 'Personal care', code: 'T1019' }), V('1', 'fut', '2026-10-20', { clocked: false }),
    V('2', 'w1', '2026-10-03', { svc: 'Nurse Visit (T1001)' }),
    V('3', 'p1', '2026-10-03', { svc: 'Nurse visit', code: 'NURSE' }),
    V('4', 'u1', '2026-10-04'), ...six]
  AXFAIL = false; PATCHES = []; PATCHFAIL = new Set(); SENT = []; ROLE = 'staff'
}
function q(t) {
  const st = { f: [], single: false }
  const match = (r) => st.f.every(([k, v]) => String(r[k]) === String(v))
  const run = () => { const rows = (T[t] || []).filter(match); return { data: st.single ? (rows[0] ? clone(rows[0]) : null) : clone(rows), error: null } }
  const b = { select() { return b }, eq(k, v) { st.f.push([k, v]); return b }, in() { return b }, limit() { return b }, ilike() { return b }, order() { return b },
    maybeSingle() { st.single = true; return Promise.resolve(run()) }, single() { st.single = true; return Promise.resolve(run()) }, then(ok, ko) { return Promise.resolve(run()).then(ok, ko) } }
  return b
}
globalThis.__db = { from: q, rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') { let row = T.app_data.find((r) => r.key === a.target_key); if (!row) { row = { key: a.target_key, data: [] }; T.app_data.push(row) }
  const i = row.data.findIndex((x) => x.id === a.item.id); if (i >= 0) row.data[i] = clone(a.item); else row.data.push(clone(a.item)) } return { data: null, error: null } } }
globalThis.fetch = async (u, o = {}) => {
  const url = new URL(String(u))
  if (/axiscare\.com/.test(url.host)) {
    if (o.method === 'PATCH') { const id = decodeURIComponent(url.pathname.split('/').pop()); const body = JSON.parse(o.body); PATCHES.push({ id, ...body })
      if (PATCHFAIL.has(id)) return new Response(JSON.stringify({ errors: ['A modification reason is required.'] }), { status: 400 })
      const v = AX.find((x) => x.id === id); if (v) v.doNotBill = body.doNotBill; return new Response('{}', { status: 200 }) }
    if (AXFAIL) return new Response('{}', { status: 500 })
    const ids = (url.searchParams.get('clientIds') || '').split(','), from = url.searchParams.get('startDate'), to = url.searchParams.get('endDate')
    /* AxisCare's GET does not document doNotBill: the fake leaves it out unless a test sets readDnb */
    const vs = AX.filter((v) => ids.includes(String(v.client.id)) && v.scheduledStartDate.slice(0, 10) >= from && v.scheduledStartDate.slice(0, 10) <= to)
      .map((v) => { const c = clone(v); if (!globalThis.__readDnb) delete c.doNotBill; return c })
    return new Response(JSON.stringify({ results: { visits: vs, nextPage: null } }), { status: 200 })
  }
  return new Response('{}', { status: 404 })
}
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k', AXISCARE_API_KEY: 'axk', AXISCARE_SITE: '16485', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'L' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_nvc_'))
try {
  fs.writeFileSync(path.join(tmp, 'job-auth.ts'), 'export async function jobCaller(req) { return req.headers.get("x-cron-secret") === "s" ? "cron" : null }\n')
  fs.writeFileSync(path.join(tmp, 'staff-auth.ts'), 'export const OFFICE_ROLES = ["owner_admin"]\nexport async function requireStaff(_db, req) { return req.headers.get("Authorization") === "Bearer staff" ? { ok: true, name: "Krystal", email: "k@x" } : { ok: false, status: 401, error: "Sign in first." } }\n')
  fs.writeFileSync(path.join(tmp, 'optout.ts'), 'export function practicePerson(p, e) { return /555018\\d$/.test(String(p||"").replace(/\\D/g,"")) || /@practice\\.invalid$/.test(String(e||"")) }\nexport async function ghlContactIfAllowed(_db, _g, sender, to) { globalThis.__sender = sender; return to.channel === "sms" ? "c_" + to.phone : "c_" + to.email }\n')
  fs.writeFileSync(path.join(tmp, 'send-problems.ts'), 'export async function ghlSendChecked(_db, _h, sender, to, msg) { globalThis.__sent.push({ sender, channel: to.channel, to: to.address, ...msg }); return true }\n')
  fs.writeFileSync(path.join(tmp, 'text-consent.ts'), 'export async function latestTextConsent() { return { ok: true } }\nexport const inTextHours = (now = new Date()) => { const h = Number(now.toLocaleString("en-US", { timeZone: "America/Chicago", hour: "2-digit", hour12: false })) % 24; return h >= 8 && h < 18 }\nexport const withStop = (t) => /\\bSTOP\\b/.test(t) ? t : t.trimEnd() + " Reply STOP to opt out."\n')
  for (const f of ['business-days.ts', 'test-people.ts', 'step2.ts', 'nurse-services.ts', 'nurse-bill.ts', 'nurse-license.ts']) fs.copyFileSync(path.join(F, '_shared', f), path.join(tmp, f))
  const src = fs.readFileSync(path.join(F, 'nurse-visit-check/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/from '\.\.\/_shared\/([\w-]+)\.ts'/g, (_, m) => "from '" + path.join(tmp, m + '.ts') + "'")
  fs.writeFileSync(path.join(tmp, 'nvc.ts'), src); await import(path.join(tmp, 'nvc.ts'))
  const NS = await import(path.join(tmp, 'nurse-services.ts')), NB = await import(path.join(tmp, 'nurse-bill.ts')), NL = await import(path.join(tmp, 'nurse-license.ts'))
  const post = async (body, hdr = { 'x-cron-secret': 's' }, qs = '') => { globalThis.__sent = SENT; const r = await handler(new Request('https://x/f' + qs, { method: 'POST', headers: hdr, body: JSON.stringify(body) })); return { status: r.status, j: await r.json() } }
  const items = () => T.app_data.find((r) => r.key === 'nurse_bill_check').data
  const I = (id) => items().find((x) => x.id === 'nb_' + id) || {}
  const cards = (re) => T.app_data.find((r) => r.key === 'ops_items').data.filter((x) => !re || re.test(x.id))
  const S = (k) => T.app_data.find((r) => r.key === 'ops_settings').data

  /* ── the service list ── */
  ck('services: the built-in list has her five (priority: med setup, GHE, skin monitoring) plus the T1001 catch-all, conservative flags', NS.nurseServices({}).from === 'built-in' && NS.DEFAULT_NURSE_SERVICES.map((s) => s.key).join() === 'med_setup,ghe,skin_monitoring,nail_care,insulin_prefill,nurse_visit' && NS.DEFAULT_NURSE_SERVICES.filter((s) => s.priority).map((s) => s.key).join() === 'med_setup,ghe,skin_monitoring' && NS.DEFAULT_NURSE_SERVICES.every((s) => s.auth) && NS.DEFAULT_NURSE_SERVICES.find((s) => s.key === 'ghe').rn_sign_if_lpn === true && NS.DEFAULT_NURSE_SERVICES.filter((s) => s.rn_sign).length === 0)
  ck('...never "skin assessment" anywhere in the list', !/assessment/i.test(JSON.stringify(NS.DEFAULT_NURSE_SERVICES)))
  const custom = NS.nurseServices({ nurse_services: [{ key: 'Wound Check', name: 'Wound check', axis: 'wound check, T1001-W' }, { key: 'bad' }, { key: 'wound_check', name: 'dup', axis: ['x'] }] })
  ck('...the setting wins when it has a usable service; bad and duplicate rows are dropped; a comma list of matches works', custom.from === 'settings' && custom.list.length === 1 && custom.list[0].key === 'wound_check' && custom.list[0].axis.join('|') === 'wound check|T1001-W' && custom.dropped === 2, custom)
  const L = NS.DEFAULT_NURSE_SERVICES
  ck('...matching: a named service first, by whole words in the code or description', NS.matchService(V('1', 'a', '2026-10-01', { svc: 'Skin monitoring (T1001)' }), L).key === 'skin_monitoring' && NS.matchService(V('1', 'a', '2026-10-01', { svc: 'GHE', code: 'T1001' }), L).key === 'ghe' && NS.matchService(V('1', 'a', '2026-10-01', { svc: 'Nurse Visit (T1001)' }), L).key === 'nurse_visit')
  ck('...personal care (T1019) and a word inside a longer word never match', NS.matchService(V('1', 'a', '2026-10-01', { svc: 'Personal care', code: 'T1019' }), L) === null && NS.matchService(V('1', 'a', '2026-10-01', { svc: 'Sunghe care', code: 'X' }), L) === null)

  /* ── the six-month period rule ── */
  const p1 = NB.periodOf({ plan_start: '2026-06-01', plan_end: '2027-05-31' }, '2026-10-14'), p2 = NB.periodOf({ plan_start: '2026-06-01', plan_end: '2027-05-31' }, '2026-12-01')
  ck('period: a one-year plan is two periods (first six calendar months, then the rest)', p1.certain && p1.from === '2026-06-01' && p1.to === '2026-11-30' && p2.from === '2026-12-01' && p2.to === '2027-05-31', [p1, p2])
  ck('...a six-month plan is one period; another length or no plan is uncertain, with why', NB.periodOf({ plan_start: '2026-06-01', plan_end: '2026-11-30' }, '2026-07-01').to === '2026-11-30' && NB.periodOf({ plan_start: '2026-05-01', plan_end: '2026-11-16' }, '2026-07-01').certain === false && /200 days/.test(NB.periodOf({ plan_start: '2026-05-01', plan_end: '2026-11-16' }, '2026-07-01').why) && NB.periodOf(null, '2026-07-01').certain === false)
  ck('...a plan starting on the 31st: the second period starts on the last day of the sixth month after', NB.periodOf({ plan_start: '2026-08-31', plan_end: '2027-08-30' }, '2027-03-01').from === '2027-02-28')

  /* ── practice: the switch off ── */
  reset()
  let r = await post({ action: 'pass' })
  ck('the pass refuses anyone but the schedule (or the owner)', (await post({ action: 'pass' }, {})).status === 401)
  ck('practice (switch off): every client read, nurse visits checked, results kept', r.status === 200 && r.j.visits.live === false && r.j.visits.clients === 4 && items().some((x) => x.id === 'nb_summary'), r.j)
  ck('...no card and no AxisCare write while off', cards(/^nurse_/).length === 0 && PATCHES.length === 0, [cards(), PATCHES])
  ck('...ready: a documented, authorized med setup, first of the day', I('v1').ready === true && I('v1').service_key === 'med_setup' && I('v1').practice === true, I('v1'))
  ck('(b) a second nurse visit the same day: not ready, says Missouri pays one a day', I('v2').ready === false && /second nurse visit for this client on Oct 1, 2026\. Missouri pays one nurse visit a day/.test(I('v2').reasons.join(' ')), I('v2'))
  ck('(d) no visit note: not ready, in plain words', I('v3').ready === false && I('v3').reasons.join(' ') === 'No visit note in AxisCare. The nurse adds what was done to the visit note.', I('v3'))
  ck('(a) units: October authorizes 4; the fifth October visit is over the authorization', I('v6').ready === false && /Over the authorization: 4 nurse visits authorized from Oct 1, 2026 to Oct 31, 2026, and this is visit 5\./.test(I('v6').reasons.join(' ')) && I('v5').ready === true, [I('v5'), I('v6')])
  ck('(e) the generic T1001 visit in the GHE month (named by the GHE watch) is the GHE; its note is not required; the LPN form waits for the RN', I('v4').service_key === 'ghe' && I('v4').ready === false && I('v4').reasons.join(' ') === 'The LPN\'s GHE form is waiting for the RN\'s review and signature.', I('v4'))
  ck('(a) a plan with no nurse line: not authorized', I('w1').ready === false && /The care plan has no authorized nurse visits on Oct 3, 2026\./.test(I('w1').reasons.join(' ')), I('w1'))
  ck('a private-pay client (payer marked) is never checked; personal care and visits not yet done are left out', !I('p1').id && !I('pc1').id && !I('fut').id)
  ck('(c) a plan of 200 days: the period is uncertain, flagged "check the count by hand", never guessed', I('u1').ready === false && /The six-month period is not known \(the care plan runs May 1, 2026 to Nov 16, 2026 \(200 days\)[^)]*\), so the 26-visit limit was not checked\. Check the count by hand\./.test(I('u1').reasons.join(' ')), I('u1'))
  ck('(c) 27 visits in one period: the 27th is not ready (26 at most), the 26th is', I('c6_26').ready === false && /This is nurse visit 27 in the six-month period Jun 1, 2026 to Nov 30, 2026\. Missouri pays at most 26\./.test(I('c6_26').reasons.join(' ')) && I('c6_25').ready === true, [I('c6_25'), I('c6_26')])
  const sum = items().find((x) => x.id === 'nb_summary'), s1 = sum.clients.find((c) => c.ax === '1')
  ck('summary for the panel: authorized against used this period (Jun to Nov): 6 months x 4 + the GHE 1 = 25 authorized, 6 used', s1.authorized === 25 && s1.used === 6 && s1.cap === 26 && s1.period.from === '2026-06-01', s1)
  ck('...a would-hold is recorded in practice (nothing written to AxisCare)', I('v3').would_hold === true && PATCHES.length === 0)

  /* ── live: cards ── */
  S().nurse_visit_check_live = true
  r = await post({ action: 'pass' })
  const c3 = cards(/^nurse_bill_v3$/)[0]
  ck('live: one card per not-ready visit, id nurse_bill_<visit>, owned by the owner of Payer Programs, Payer Programs domain', !!c3 && c3.owner === 'krystal@mo-care.com' && c3.domain === 'payer_programs' && c3.status === 'open' && cards(/^nurse_bill_/).length === r.j.visits.not_ready && !cards(/^nurse_bill_v1$/).length, [cards().map((c) => c.id), r.j.visits])
  ck('...its words: what, when, why, what to do, and that the billing team is told; no em dash', c3.title === 'Nurse visit not ready to bill: Ann Able, Oct 5, 2026' && /No visit note in AxisCare/.test(c3.detail) && /tell the AxisCare billing team not to bill it/.test(c3.detail) && /closes itself/.test(c3.detail) && !cards().some((c) => /—/.test(c.title + c.detail)), c3)
  r = await post({ action: 'pass' })
  ck('...a second pass makes no second card', cards(/^nurse_bill_v3$/).length === 1 && r.j.visits.cards_raised === 0, r.j.visits)
  AX.find((v) => v.id === 'v3').careNote = 'Filled the organizer.'
  r = await post({ action: 'pass' })
  ck('fixed in AxisCare (the note added): the visit is ready and its card closes itself', I('v3').ready === true && cards(/^nurse_bill_v3$/)[0].status === 'done' && /ready to bill now/.test(cards(/^nurse_bill_v3$/)[0].done_by), cards(/^nurse_bill_v3$/)[0])
  const cw = T.app_data.find((x) => x.key === 'ops_items').data.find((x) => x.id === 'nurse_bill_w1'); cw.status = 'done'
  r = await post({ action: 'pass' })
  ck('a card a person closed stays closed', cards(/^nurse_bill_w1$/)[0].status === 'done')

  /* ── the billing hold ── */
  S().nurse_bill_hold_live = true; PATCHFAIL.add('v2')
  AX.find((v) => v.id === 'v6').doNotBill = true; globalThis.__readDnb = false
  r = await post({ action: 'pass' })
  ck('hold on: do-not-bill set on not-ready nurse visits, recorded on the visit', PATCHES.some((p) => p.id === 'v4' && p.doNotBill === true) && I('v4').hold.state === 'held' && I('v4').hold.before === 'not readable', [PATCHES, I('v4').hold])
  ck('...never on a ready visit', !PATCHES.some((p) => p.id === 'v1' || p.id === 'v5'))
  ck('...an AxisCare write that fails becomes a card (and is tried again next time)', cards(/^nurse_hold_failed_v2$/).length === 1 && /did not take the do-not-bill hold/.test(cards(/^nurse_hold_failed_v2$/)[0].title) && /modification reason/.test(cards(/^nurse_hold_failed_v2$/)[0].detail) && !I('v2').hold, cards(/^nurse_hold_failed/))
  const before = PATCHES.length; globalThis.__readDnb = true
  T.app_data.find((x) => x.key === 'nurse_bill_check').data.find((x) => x.id === 'nb_c6_26').hold = undefined
  AX.find((v) => v.id === 'c6_26').doNotBill = true
  r = await post({ action: 'pass' })
  ck('a visit AxisCare already shows do-not-bill without a Hub hold is the office\'s own mark: never touched', !PATCHES.slice(before).some((p) => p.id === 'c6_26') && I('c6_26').office_marked === true, PATCHES.slice(before))
  /* v4 becomes ready: the RN signs the GHE form */
  Object.assign(T.app_data.find((x) => x.key === 'ghe_forms').data[0], { status: 'ready', sig_sup: 'y', rn_reviewer: 'Natasha Early' })
  r = await post({ action: 'pass' })
  ck('ready again (the RN signed the LPN\'s GHE): the Hub releases ONLY its own hold, and its card closes', PATCHES.some((p) => p.id === 'v4' && p.doNotBill === false) && I('v4').hold.state === 'released' && cards(/^nurse_bill_v4$/)[0].status === 'done', [I('v4'), PATCHES.filter((p) => p.id === 'v4')])
  ck('...the office\'s own do-not-bill is never released', !PATCHES.some((p) => p.id === 'c6_26' && p.doNotBill === false))
  /* the office takes a Hub hold off by hand: never set again */
  const heldId = items().find((x) => x.hold && x.hold.state === 'held')?.visit_id
  AX.find((v) => v.id === heldId).doNotBill = false
  const b2 = PATCHES.length; r = await post({ action: 'pass' })
  ck('a Hub hold the office took off by hand (AxisCare shows billable while the visit is still not ready) is left alone', !!heldId && !PATCHES.slice(b2).some((p) => p.id === heldId), [heldId, PATCHES.slice(b2)])
  /* the hold needs the check switch too */
  S().nurse_visit_check_live = false; const b3 = PATCHES.length; r = await post({ action: 'pass' })
  ck('hold switch on but the check switch off: nothing is written to AxisCare (practice)', PATCHES.length === b3 && r.j.visits.hold_live === false)
  S().nurse_visit_check_live = true

  /* ── an AxisCare read that fails is never a problem ── */
  const snap = JSON.stringify(items().filter((x) => x.id !== 'nb_summary')), cardsBefore = JSON.stringify(cards()), b4 = PATCHES.length
  AXFAIL = true; r = await post({ action: 'pass' })
  ck('AxisCare read fails: nothing marked, no card raised or closed, no hold set or released; said in the result', r.j.visits.read_failed === 4 && JSON.stringify(items().filter((x) => x.id !== 'nb_summary')) === snap && JSON.stringify(cards()) === cardsBefore && PATCHES.length === b4, r.j.visits)
  ck('...the panel summary keeps the last good numbers, marked stale', items().find((x) => x.id === 'nb_summary').clients.every((c) => c.stale === true))
  AXFAIL = false

  /* ── dry ── */
  const snap2 = JSON.stringify(T.app_data), b5 = PATCHES.length
  r = await post({ action: 'pass' }, { 'x-cron-secret': 's' }, '?dry=1')
  ck('dry run: computes, writes nothing, sends nothing, no AxisCare write', JSON.stringify(T.app_data) === snap2 && PATCHES.length === b5 && r.j.visits.dry === true)

  /* ── the office ── */
  ck('report/run/services: office staff only', (await post({ action: 'report' }, {})).status === 401 && (await post({ action: 'run' }, {})).status === 401)
  r = await post({ action: 'report' }, { Authorization: 'Bearer staff' })
  ck('report: not-ready visits with reasons, holds, clients authorized vs used, the switches', r.j.ok && r.j.live === true && r.j.not_ready.some((x) => x.visit_id === 'v2' && x.reasons.length) && Array.isArray(r.j.holds) && r.j.clients.some((c) => c.ax === '1'), r.j)
  r = await post({ action: 'run' }, { Authorization: 'Bearer staff' })
  ck('Check now (run): the check runs at once for the office and answers with the report', r.j.ok !== false && r.j.visits_checked > 0 && r.j.report && Array.isArray(r.j.report.not_ready), r.j)
  r = await post({ action: 'services' }, { Authorization: 'Bearer staff' })
  ck('services: the built-in list, the saved one (none yet), and the one in use', r.j.ok && r.j.defaults.length === 6 && r.j.current === null && r.j.from === 'built-in', r.j)

  /* ── license reminders ── */
  const msgs = { d30: NL.licenseMessage('Lena', { cred: 'LPN' }, { stage: 'd30', expires: '2026-11-13', days_left: 30 }), d14: NL.licenseMessage('Lena', { cred: 'LPN' }, { stage: 'd14', expires: '2026-11-13', days_left: 14 }), d7: NL.licenseMessage('Lena', { cred: 'LPN' }, { stage: 'd7', expires: '2026-11-13', days_left: 7 }) }
  ck('license words: short, warm, no em dash, never "plain language"', Object.values(msgs).every((m) => !/—/.test(m.text + m.subject + m.html) && !/plain (language|english)/i.test(m.text)) && /^Hi Lena, this is Caring Companions\. Your Missouri LPN license on file expires November 13, 2026\./.test(msgs.d30.text), msgs)
  reset({ nurse_visit_check_live: false })
  const LR = () => (T.app_data.find((x) => x.key === 'nurse_license_reminders').data[0] || {}).stamps || {}
  r = await post({ action: 'pass' })
  ck('switch off: Lena (30 days out) is stamped practice, nothing sent, no card', r.j.license.practice === 1 && SENT.length === 0 && LR()['2026-11-13:d30']?.practice === true && cards(/^nurse_license/).length === 0, [r.j.license, LR()])
  reset({ nurse_license_reminders_live: true })
  r = await post({ action: 'pass' })
  ck('live, 30 days before: one text (with the STOP line) and one email to the nurse, through the outreach sender', SENT.length === 2 && SENT.every((s) => s.sender === 'nurse-visit-check') && SENT.find((s) => s.channel === 'sms').to === '4175551234' && / Reply STOP to opt out\.$/.test(SENT.find((s) => s.channel === 'sms').message) && SENT.find((s) => s.channel === 'email').to === 'lena@example.test', SENT)
  ck('...and a card for the office (owner of Payer Programs)', cards(/^nurse_license_lena@example\.test_2026-11-13_d30$/).length === 1 && cards(/^nurse_license_/)[0].owner === 'krystal@mo-care.com' && /Nursys QuickConfirm/.test(cards(/^nurse_license_/)[0].detail), cards())
  SENT.length = 0; r = await post({ action: 'pass' })
  ck('...stamped: the next pass sends nothing again', SENT.length === 0 && r.j.license.due === 0)
  at('2026-10-30T15:00:00Z'); SENT.length = 0; r = await post({ action: 'pass' })
  ck('14 days before: the d14 reminder, once', SENT.length === 2 && /we do not have your renewal yet/.test(SENT[0].message || SENT[1].message) && !!LR()['2026-11-13:d14'], SENT)
  at('2026-11-07T02:00:00Z'); SENT.length = 0; r = await post({ action: 'pass' })
  ck('7 days before at 8pm Central: held (never dropped), nothing sent', SENT.length === 0 && r.j.license.held === 1 && !!LR()['2026-11-13:d7:held'] && !LR()['2026-11-13:d7'])
  at('2026-11-07T15:00:00Z'); r = await post({ action: 'pass' })
  ck('...sent in the morning, with "your nurse visits pause" and a card marked today', SENT.length === 2 && /pause until it is/.test(SENT.find((s) => s.channel === 'sms').message) && cards(/_d7$/)[0].urgency === 'today', SENT)
  at('2026-11-14T15:00:00Z'); SENT.length = 0; r = await post({ action: 'pass' })
  ck('expired: an urgent card for the office, nothing to the nurse, once', SENT.length === 0 && cards(/^nurse_license_expired_/).length === 1 && cards(/^nurse_license_expired_/)[0].urgency === 'urgent' && /already mark them not ready/.test(cards(/^nurse_license_expired_/)[0].detail), cards(/expired/))
  at('2026-10-14T15:00:00Z')
  reset({ test_people: { phones: ['4175551234'], emails: ['lena@example.test'] } }); r = await post({ action: 'pass' })
  ck('switch off but the nurse is on the Admin test list: she gets the message (no office card)', SENT.length === 2 && cards(/^nurse_license/).length === 0)
  reset({ nurse_license_reminders_live: true }); T.app_data.find((x) => x.key === 'nurse_staff').data[0].email = 'lena@practice.invalid'; T.app_data.find((x) => x.key === 'caregivers').data = []
  r = await post({ action: 'pass' })
  ck('a practice address is never contacted', SENT.length === 0 && r.j.license.practice === 1)

  /* ── registered as a sender ── */
  const OR = fs.readFileSync(path.join(F, '_shared/outreach.ts'), 'utf8'), SP = fs.readFileSync(path.join(F, '_shared/send-problems.ts'), 'utf8')
  ck('the sender is registered (outreach SENDER_REGISTER, scheduled, routine_internal) and the send-problem words know it', /'nurse-visit-check':\s+\{ class: 'routine_internal', scheduled: true,/.test(OR) && /'nurse-visit-check': \['nurse license reminder', 'caregivers'\]/.test(SP))
  const all = ['nurse-visit-check/index.ts', '_shared/nurse-services.ts', '_shared/nurse-bill.ts', '_shared/nurse-license.ts'].map((f) => fs.readFileSync(path.join(F, f), 'utf8')).join('\n')
  ck('no em dash in any of the new files; never "skin assessment" outside the rule comment', !/—/.test(all) && !all.split('\n').some((l) => !/^\s*\/\//.test(l) && /skin assessment/i.test(l)))
  ck('the function has the browser door from day one (CORS, OPTIONS)', /Access-Control-Allow-Origin/.test(all) && /req\.method === 'OPTIONS'/.test(all))
  console.log('\nEXACT REMINDER TEXTS (as sent, with the STOP line):'); for (const [k, m] of Object.entries(msgs)) console.log(' ', k, '|', m.subject, '|', m.text + ' Reply STOP to opt out.')
} catch (e) { ck('the test ran to the end', false, String(e && e.stack || e).slice(0, 600)) } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note))
const p = res.filter((x) => x[1]).length; console.log(`\n${p}/${res.length} passed`); process.exit(p === res.length ? 0 : 1)
