// The month-end App fee check (her yes 2026-10-16). Under Node against the REAL _shared/family-fee.ts and family-app-office.ts
// with a stand-in AxisCare and Hub database. Nothing real is touched.
//   node family_app_fee_test.mjs
//   PGLITE=<path to @electric-sql/pglite/dist/index.js> node family_app_fee_test.mjs   also installs family_app_fee.sql twice
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const F = 'supabase/functions'
const imp = (p) => import(pathToFileURL(path.resolve(F, p)).href)
const fee = await imp('_shared/family-fee.ts')
const off = await imp('_shared/family-app-office.ts')
const fam = await imp('_shared/family-app.ts')

let NOW = new Date('2026-11-01T14:00:00Z')   // Sunday Nov 1, 8 AM Central
ck('last month: October 2026 (and January looks back to December)', fee.lastMonth(NOW) === '2026-10' && fee.lastMonth(new Date('2027-01-01T15:00:00Z')) === '2026-12')
ck('month range: Oct 1 to Oct 31; Feb 2028 has 29 days', JSON.stringify(fee.monthRange('2026-10')) === '{"from":"2026-10-01","to":"2026-10-31"}' && fee.monthRange('2028-02').to === '2028-02-29')
ck('the fee: $15 unless the Hub setting says otherwise', fee.feeOf({}) === 15 && fee.feeOf({ family_app_fee: 20 }) === 20)

let W
const utc = (date, hhmm) => `${date}T${String(Number(hhmm.slice(0, 2)) + 5).padStart(2, '0')}:${hhmm.slice(3)}:00Z`
function reset(m = {}) {
  W = { fees: [], items: [], calls: [], failFor: null, events: [], plans: {},
    clients: [
      { circle_id: 'c1', axiscare_client_id: '501', client_name: 'Dot Ray', app_plan_since: '2026-08-12' },     // visits in October
      { circle_id: 'c2', axiscare_client_id: '502', client_name: 'Al Moss', app_plan_since: '2026-09-01' },     // none in October
      { circle_id: 'c3', axiscare_client_id: '503', client_name: 'Lee Park', app_plan_since: '2026-10-20' },    // joined in October
      { circle_id: 'c4', axiscare_client_id: '504', client_name: 'Kim Ode', app_plan_since: null },             // AxisCare down for her
    ],
    visits: { 501: [{ id: 'v1', scheduledStartDate: utc('2026-10-14', '09:00'), timezone: 'US/Central' }] }, ...m }
}
const ax = async (method, p) => {
  W.calls.push([method, p]); const u = new URL('http://x' + p)
  if (method === 'GET' && u.pathname === '/api/visits') {
    const c = u.searchParams.get('clientIds')
    if (c === W.failFor) return { status: 500, json: { errors: ['AxisCare is down'] } }
    const list = W.visits[c] || []
    return list.length ? { status: 200, json: { results: { visits: list } } } : { status: 404, json: { errors: ['No visits found'] } }
  }
  return { status: 404, json: { errors: ['unexpected'] } }
}
const fdeps = () => ({ ax, now: () => NOW, settings: async () => ({}), appClients: async () => W.clients,
  checks: async (m) => W.fees.filter((x) => x.month === m),
  saveCheck: async (row) => { const k = W.fees.findIndex((x) => x.month === row.month && x.axiscare_client_id === row.axiscare_client_id); if (k >= 0) W.fees[k] = row; else W.fees.push(row); return true },
  officeItem: async (item) => { const k = W.items.findIndex((x) => x.id === item.id); if (k >= 0) W.items[k] = item; else W.items.push(item); return true } })

reset({ failFor: '504' })
let o = await fee.monthlyFeeRun(fdeps())
const by = (id) => o.rows.find((x) => x.axiscare_client_id === id)
ck('a client with a visit in October: free', by('501').result === 'free' && by('501').visits === 1 && by('501').fee === 0, by('501'))
ck('a client with no visits in October: the $15 fee', by('502').result === 'fee' && by('502').visits === 0 && by('502').fee === 15, by('502'))
ck('joined in October: no fee their first month', by('503').result === 'joined' && by('503').fee === 0 && !W.calls.some((c) => /clientIds=503/.test(c[1])), by('503'))
ck('AxisCare could not be read: "couldn\'t check", NEVER counted as having visits', by('504').result === 'couldnt_check' && by('504').visits === null && by('504').fee === 0 && /down/.test(by('504').error), by('504'))
ck('only October was asked for', W.calls.filter((c) => /clientIds=50[124]/.test(c[1])).every((c) => /startDate=2026-10-01&endDate=2026-10-31/.test(c[1])))
const card = W.items[0]
ck('ONE office card: who to bill, and who couldn\'t be checked', W.items.length === 1 && card.id === 'fam_fee_2026-10' && card.title === 'App fee check: 1 client to bill $15 for October 2026' && /Al Moss/.test(card.detail) && /couldn't be checked for: Kim Ode/.test(card.detail) && !/Dot Ray|Lee Park/.test(card.detail), card)
ck('the card says what to do (add it on AxisCare, then tick it here)', /AxisCare invoice/.test(card.next_action) && /tick/.test(card.next_action))
ck('nothing is charged and nobody is texted or emailed (no such calls exist)', W.calls.every((c) => c[0] === 'GET'))
reset(); W.visits[502] = [{ id: 'v9', scheduledStartDate: utc('2026-10-02', '09:00') }]; W.clients = W.clients.slice(0, 2)
o = await fee.monthlyFeeRun(fdeps())
ck('everyone had a visit: no card at all', W.items.length === 0 && o.owe === 0)

// ── the office ───────────────────────────────────────────────────────────────────────────────────────────────────────
const staff = { name: 'Krystal', email: 'k@mo-care.com' }
const circles = { c2: { id: 'c2', client_name: 'Al Moss', active: true, axiscare_client_id: '502', app_plan: true, app_plan_since: '2026-09-01' }, c9: { id: 'c9', client_name: 'New Client', active: true, axiscare_client_id: '509', app_plan: null } }
const odeps = () => ({ ax, now: () => NOW, settings: async () => ({}), fee: fdeps(), circle: async (id) => circles[id] ?? null,
  plans: async () => Object.values(circles), setPlan: async (id, vals) => { Object.assign(circles[id], vals); W.plans[id] = vals; return true },
  markBilled: async (m, cid, vals) => { const r = W.fees.find((x) => x.month === m && x.axiscare_client_id === cid); if (!r) return false; Object.assign(r, vals); return true },
  event: async (e) => W.events.push(e), members: async () => [], recentBookings: async () => [] })
const office = (body) => off.officeAction(odeps(), staff, body)
reset()
o = await office({ action: 'fee_check' })
ck('office: "Check now" runs last month (October) and lists it', o.status === 200 && o.body.month === '2026-10' && o.body.rows.length === 4, o.body)
o = await office({ action: 'fee_billed', month: '2026-10', axiscare_client_id: '502' })
const al = W.fees.find((x) => x.axiscare_client_id === '502')
ck('office: tick "Added to the AxisCare invoice": who and when are kept', o.status === 200 && al.billed_by === 'k@mo-care.com' && al.billed_at === NOW.toISOString() && W.events.some((e) => e.verb === 'family_app_fee_billed'), al)
await office({ action: 'fee_check', month: '2026-10' })
ck('checking again never wipes the office\'s tick', W.fees.find((x) => x.axiscare_client_id === '502').billed_by === 'k@mo-care.com')
o = await office({ action: 'fee_billed', month: '2026-10', axiscare_client_id: '501' })
ck('office: a client with no fee can\'t be ticked', o.status === 409)
o = await office({ action: 'fee_billed', month: '2026-10', axiscare_client_id: '502', on: false })
{ const a2 = W.fees.find((x) => x.axiscare_client_id === '502'); ck('office: the tick can be taken off', o.status === 200 && a2.billed_at === null && a2.billed_by === null, a2) }
o = await office({ action: 'fee_list', month: '2026-10' })
ck('office: the saved list, nothing re-checked', o.status === 200 && o.body.rows.length === 4)
ck('office: a bad month is refused', (await office({ action: 'fee_check', month: '2026-13' })).status === 400)
o = await office({ action: 'app_plan', circle_id: 'c2', on: false })
ck('office: the App plan tick turns off (a set-shift client who only adds extra visits)', o.status === 200 && circles.c2.app_plan === false)
o = await office({ action: 'app_plan', circle_id: 'c2', on: true })
ck('office: on again starts from today (that month is free)', circles.c2.app_plan === true && circles.c2.app_plan_since === '2026-11-01')

// 2026-10-17 her decision: the App plan default comes from the Care Scheduling Type (Flexible on, Regular and Combination off;
// the office can still change it), no longer from the first invite
const src = fs.readFileSync(path.join(F, '_shared/family-app-office.ts'), 'utf8')
ck('App plan: no longer turned on by the invite; set from the scheduling type (Flexible on, others off), only when the type changes', !/if \(k\.app_plan == null\) await d\.setPlan/.test(src) && /const plan = kind === 'flexible'/.test(src) && /if \(k\.care_scheduling_type !== kind\) await saveCareType/.test(src))

// ── the go-live gate ─────────────────────────────────────────────────────────────────────────────────────────────────
ck('go-live gate: live only with the app switch AND the fee check installed', fam.appLive({ family_app_live: true, family_fee_check_ready: true }) && !fam.appLive({ family_app_live: true }) && !fam.appLive({ family_fee_check_ready: true }))

// ── the files ───────────────────────────────────────────────────────────────────────────────────────────────────────
const fn = fs.readFileSync(path.join(F, 'family-fee-check/index.ts'), 'utf8'), lib = fs.readFileSync(path.join(F, '_shared/family-fee.ts'), 'utf8'), sql = fs.readFileSync('family_app_fee.sql', 'utf8')
ck('the monthly run is cron/owner only, CORS, dry run saves nothing', /jobCaller\(req\)/.test(fn) && /req\.method === 'OPTIONS'/.test(fn) && /saveCheck: async \(row\) => dry \|\|/.test(fn) && /officeItem: async \(item\) => dry \|\|/.test(fn))
ck('no texting, emailing or charging anywhere in the fee check', !/ghl|sms|email|stripe|invoice'|charge\(/i.test(fn.replace(/never charges anything; never contacts a family/i, '')) && !/ghl|sendText|stripe/i.test(lib))
ck('no em dashes and no her/she in anything the office reads', ![fn, lib, sql].some((s) => /—/.test(s)) && !/'[^'\n]*\b(her|she)\b[^'\n]*'|`[^`\n]*\b(her|she)\b[^`\n]*`/.test(lib + fn))

if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE)
  const db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table public.care_circles (id text primary key, client_name text, active boolean default true, axiscare_client_id text);
    create table public.app_data (key text primary key, data jsonb);
    insert into public.app_data values ('ops_settings', '{"family_app_fee":20,"family_app_live":false,"other":1}');
    insert into public.care_circles values ('c1','Dot',true,'501');
    create function public.hub_office_ok() returns boolean language sql as 'select true';`)
  const tryQ = async (q) => { try { await db.exec(q); return 'ok' } catch (e) { return 'refused: ' + e.message } }
  ck('PGLITE: installs, and installs again', (await tryQ(sql)) === 'ok' && (await tryQ(sql)) === 'ok')
  const s = (await db.query(`select data from public.app_data where key='ops_settings'`)).rows[0].data
  ck('PGLITE: her $20 kept (only where not set), app still off, the fee check marked installed', s.family_app_fee === 20 && s.family_app_live === false && s.family_fee_check_ready === true && s.other === 1, s)
  const c1 = (await db.query(`select app_plan from public.care_circles where id='c1'`)).rows[0]
  ck('PGLITE: existing clients start with the App plan unset (null), so their first invite turns it on', c1.app_plan === null)
  ck('PGLITE: one row per client per month; results checked', (await tryQ(`insert into public.family_app_fees (month, axiscare_client_id, result) values ('2026-10','501','fee')`)) === 'ok' && (await tryQ(`insert into public.family_app_fees (month, axiscare_client_id, result) values ('2026-10','501','free')`)).startsWith('refused') && (await tryQ(`insert into public.family_app_fees (month, axiscare_client_id, result) values ('2026-11','501','maybe')`)).startsWith('refused'))
  const g = (await db.query(`select grantee, privilege_type from information_schema.role_table_grants where table_name='family_app_fees' and grantee in ('anon','authenticated') order by 1,2`)).rows
  ck('PGLITE: family_app_fees: anon nothing, office read only', JSON.stringify(g) === JSON.stringify([{ grantee: 'authenticated', privilege_type: 'SELECT' }]), g)
}

for (const [n, ok, note] of res) console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note))
const bad = res.filter((x) => !x[1]).length
console.log(`\n  family app fee check: ${res.length - bad}/${res.length} passed`)
process.exit(bad ? 1 : 0)
