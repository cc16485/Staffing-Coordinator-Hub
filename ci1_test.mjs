// CI1 · the safe fill: coverage-assign's confirm / close / assign against a stand-in database (the one-case patch
// behaves like the real SQL one, which has its own test on Postgres: ci1_sql_test.py) and a fake AxisCare.
// node ci1_test.mjs
import fs from 'fs'; import path from 'path';
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? '').slice(0, 700)])
let CASES, ROSTER, AXV, AXCALLS, REC, STAFF, OWNER
const reset = () => {
  CASES = [{ id: 'k1', status: 'open', client: 'Ruth Adams', client_axiscare_id: '501', axiscare_visit_id: '900', shift_date: '2026-10-05', shift_time: '09:00-13:00',
    calling_off: 'Maria Test', calling_off_id: '11', asked: [{ id: 'a1', name: 'Joe Smith', axiscare_id: '22', state: 'yes', replied_at: 't' }, { id: 'a2', name: 'Ann Lee', axiscare_id: '33', state: 'yes', replied_at: 't' }] }]
  ROSTER = []; AXV = { 900: { id: 900, caregiver: { id: 11, firstName: 'Maria', lastName: 'Test' } } }; AXCALLS = []; REC = []
  STAFF = { ok: true, name: 'Krystal Office', email: 'k@cc.test' }; OWNER = false
}
const db = { rpc: async (n, a) => {
    if (n === 'axiscare_change_record') { REC.push(a); return { data: { outcome: 'recorded' }, error: null } }
    if (n === 'coverage_case_patch') { const i = CASES.findIndex((c) => c.id === a.p_id); if (i < 0) return { data: { outcome: 'not_found' }, error: null }
      for (const [k, v] of Object.entries(a.p_expect || {})) if ((CASES[i][k] ?? null) !== v) return { data: { outcome: 'conflict', item: CASES[i] }, error: null }
      CASES[i] = { ...CASES[i], ...a.p_patch }; return { data: { outcome: 'ok', item: CASES[i] }, error: null } }
    return { data: null, error: null } },
  from: (t) => { const f = []; const p = { select() { return p }, eq(k, v) { f.push([k, v]); return p }, maybeSingle() { return p },
    then(ok, bad) { const key = (f.find((x) => x[0] === 'key') || [])[1]
      const data = t === 'app_data' ? { data: key === 'coverage_cases' ? CASES : key === 'caregivers' ? ROSTER : [] } : null
      return Promise.resolve({ data, error: null }).then(ok, bad) } }; return p } }
globalThis.__db = db
globalThis.fetch = async (u, o = {}) => { const url = new URL(String(u)), m = (o.method || 'GET').toUpperCase(); AXCALLS.push(m + ' ' + url.pathname)
  const R = (s, b) => new Response(JSON.stringify(b), { status: s })
  const vm = url.pathname.match(/^\/api\/visits\/(\d+)$/)
  if (vm && m === 'GET') return R(200, { results: { visit: AXV[vm[1]] } })
  if (vm && m === 'PATCH') { AXV[vm[1]].caregiver = { id: JSON.parse(o.body).caregiverId }; return R(200, { success: true }) }
  if (url.pathname === '/api/visits' && m === 'GET') return R(200, { results: { visits: Object.values(AXV).filter((v) => !v.caregiver) } })
  throw new Error('unexpected ' + m + ' ' + url) }
const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485' }
let handler; globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h } }
const src = fs.readFileSync(path.join(FN, 'coverage-assign/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace(/^import \{ requireStaff, OFFICE_ROLES \} from .*$/m, 'const OFFICE_ROLES = []; const requireStaff = async () => globalThis.__staff()')
  .replace(/^import \{ ownerCaller \} from .*$/m, 'const ownerCaller = async () => globalThis.__owner()')
  .replace(/'\.\.\/_shared\/coverage-fill\.ts'/, "'" + path.join(FN, '_shared/coverage-fill.ts') + "'")
globalThis.__staff = () => STAFF; globalThis.__owner = () => OWNER
const tmp = path.join(FN, 'coverage-assign/_ci1.ts'); fs.writeFileSync(tmp, src); try { await import(tmp) } finally { fs.unlinkSync(tmp) }
const call = async (body) => { const r = await handler(new Request('http://x', { method: 'POST', headers: { authorization: 'Bearer x' }, body: JSON.stringify(body) })); return { s: r.status, j: await r.json() } }
const k1 = () => CASES[0]

/* who */
reset(); STAFF = { ok: false, status: 401, error: 'Sign in first.' }; let r = await call({ action: 'confirm', case_id: 'k1', covered_by: 'Joe Smith' })
ck('not signed in: refused, nothing changed', r.s === 401 && k1().status === 'open' && !AXCALLS.length, r)
reset(); STAFF = { ok: false, status: 403, error: 'Your account does not have Care Coordinator Hub access.' }; r = await call({ action: 'confirm', case_id: 'k1', covered_by: 'Joe Smith' })
ck('a signed-in account that is not office staff: refused (it used to be let in)', r.s === 403 && k1().status === 'open' && !AXCALLS.length, r)

/* confirm */
reset(); r = await call({ action: 'confirm', case_id: 'k1', covered_by: 'Joe Smith', not_chosen: { silent: true } })
ck('confirm: filled by Joe, confirmed by the signed-in person, the other yes told nothing (her choice)', r.j.outcome === 'filled' && k1().status === 'done' && k1().resolved_how === 'covered' && k1().covered_by === 'Joe Smith'
  && k1().confirmed_by === 'Krystal Office' && k1().not_chosen_silent === true && k1().asked.length === 2, [r, k1()])
ck('confirm: AxisCare: the visit was Maria\'s (the caller-off), so Joe is put on it and read back', r.j.axiscare.status === 'assigned' && AXV[900].caregiver.id === 22 && k1().axiscare_assignment.status === 'assigned'
  && REC.at(-1).p_outcome === 'sent_confirmed', [r.j, AXCALLS])
const n0 = AXCALLS.length; r = await call({ action: 'confirm', case_id: 'k1', covered_by: 'Ann Lee' })
ck('a second confirm (Ann) after Joe: "already", who and by whom; nothing changes, AxisCare untouched', r.j.outcome === 'already' && r.j.covered_by === 'Joe Smith' && r.j.confirmed_by === 'Krystal Office' && k1().covered_by === 'Joe Smith' && AXCALLS.length === n0, r)
reset(); AXV[900].caregiver = { id: 44, firstName: 'Bea', lastName: 'Other' }; r = await call({ action: 'confirm', case_id: 'k1', covered_by: 'Joe Smith' })
ck('AxisCare already shows someone else on the visit: the case is filled in the Hub, AxisCare is NOT changed, and it says who is there', r.j.outcome === 'filled' && r.j.axiscare.status === 'by_hand'
  && /Bea Other/.test(r.j.axiscare.detail) && AXV[900].caregiver.id === 44 && !AXCALLS.some((x) => x.startsWith('PATCH')), [r.j, AXCALLS])
reset(); AXV[900].caregiver = null; r = await call({ action: 'confirm', case_id: 'k1', covered_by: 'Joe Smith' })
ck('nobody on the visit: Joe is put on', r.j.axiscare.status === 'assigned' && AXV[900].caregiver.id === 22, r.j)
reset(); AXV[900].caregiver = { id: 22 }; r = await call({ action: 'confirm', case_id: 'k1', covered_by: 'Joe Smith' })
ck('Joe is already on the visit: nothing written, "already"', r.j.axiscare.status === 'already' && !AXCALLS.some((x) => x.startsWith('PATCH')), r.j)
reset(); r = await call({ action: 'confirm', case_id: 'k1', covered_by: 'Joe Smith', not_chosen: { msg: 'Thanks so much, {first_name}!' } })
ck('the coordinator\'s own words for the other yeses are kept', k1().not_chosen_msg === 'Thanks so much, {first_name}!' && k1().not_chosen_silent == null, k1())
reset(); r = await call({ action: 'confirm', case_id: 'k1', covered_by: '' }); ck('confirm with nobody named: refused', r.s === 400 && k1().status === 'open', r)
reset(); r = await call({ action: 'confirm', case_id: 'nope', covered_by: 'Joe' }); ck('a case that is not there: 404', r.s === 404, r)
reset(); delete CASES[0].axiscare_visit_id; AXV = { 901: { id: 901, caregiver: null } }; ROSTER = [{ first: 'Sam', last: 'New', axiscare_id: '55' }]
r = await call({ action: 'confirm', case_id: 'k1', covered_by: 'Sam New' })
ck('a phone-opened case (no visit attached): the client\'s only open visit that day, the person found on the roster', r.j.axiscare.status === 'assigned' && AXV[901].caregiver.id === 55, r.j)

/* close */
reset(); r = await call({ action: 'close', case_id: 'k1', how: 'uncovered', note: 'nobody free' })
ck('close uncovered: closed, nobody covering, the note kept', r.j.outcome === 'closed' && k1().status === 'done' && k1().resolved_how === 'uncovered' && k1().covered_by === null && k1().close_note === 'nobody free', [r, k1()])
r = await call({ action: 'close', case_id: 'k1', how: 'other_way' }); ck('a second close: "already"', r.j.outcome === 'already', r)
reset(); r = await call({ action: 'close', case_id: 'k1', how: 'whatever' }); ck('an unknown way to close: refused', r.s === 400 && k1().status === 'open', r)

/* the old call */
reset(); CASES[0] = { ...CASES[0], status: 'done', resolved_how: 'covered', covered_by: 'Joe Smith' }; r = await call({ case_id: 'k1' })
ck('the old call (no action) still puts a confirmed caregiver on AxisCare', r.j.status === 'assigned' && k1().axiscare_assignment.status === 'assigned', r)
reset(); r = await call({ case_id: 'k1' }); ck('the old call on an open case: refused', r.s === 400, r)
reset(); OWNER = true; STAFF = { ok: false, status: 401, error: 'no' }; r = await call({ action: 'close', case_id: 'k1', how: 'uncovered' })
ck('the owner\'s server key may close (the installer\'s proof never uses it on a real case)', r.j.outcome === 'closed' && k1().confirmed_by === "the owner's server key", r)

/* the caregiver night rule (coverage-run) */
const cr = fs.readFileSync(path.join(FN, 'coverage-run/index.ts'), 'utf8')
const fnSrc = cr.slice(cr.indexOf('export function caregiverNightHold'), cr.indexOf('async function acquireRunLock')).replace('export function', 'function').replace(/: any/g, '').replace(/: boolean/g, '').replace(/now = new Date\(\)\)/, 'now)')
const hold = new Function(fnSrc + '; return caregiverNightHold')()
const at = (iso) => new Date(iso)   // CDT = UTC-5
const c = (date, time) => ({ shift_date: date, shift_time: time })
ck('night rule: 10pm, shift tomorrow 9am: held', hold(c('2026-10-06', '09:00-13:00'), {}, at('2026-10-06T03:00:00Z')) === true)
ck('night rule: 10pm, shift at 11:30pm tonight: sent (within 3 hours)', hold(c('2026-10-05', '23:30-03:30'), {}, at('2026-10-06T03:00:00Z')) === false)
ck('night rule: 6am, shift at 8am: sent; shift at noon: held', hold(c('2026-10-06', '08:00-12:00'), {}, at('2026-10-06T11:00:00Z')) === false && hold(c('2026-10-06', '12:00-16:00'), {}, at('2026-10-06T11:00:00Z')) === true)
ck('night rule: 10am: never held', hold(c('2026-10-09', '09:00-13:00'), {}, at('2026-10-06T15:00:00Z')) === false)
ck('night rule: an interest check (no shift) at night: held', hold({}, {}, at('2026-10-06T03:00:00Z')) === true)
ck('night rule: her settings (quiet 22 to 7) are used', hold(c('2026-10-07', '09:00-13:00'), { coverage_quiet_from: 22, coverage_quiet_until: 7 }, at('2026-10-06T02:30:00Z')) === false)
ck('the coordinator\'s send checks the night rule before anything else is done', /if \(caregiverNightHold\(kase, st\)\)\s*\n\s*return jr\(\{ error: 'held:/.test(cr) && cr.indexOf('caregiverNightHold(kase, st)') < cr.indexOf("coverage_case_add_ask"))

let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '\n     ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
