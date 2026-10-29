// PRN ON-CALL SHIFTS (Samantha 2026-10-29: "add a shift choice (daytime, overnight or whole day) when the office confirms on
// call, with its switch off"). The rules (_shared/prn-week.ts SHIFTS, onCallMonth; prn-recognition.ts onCallFor), the REAL
// prn-week with the REAL staff check against a fake database, and the SQL on a throwaway Postgres when PGLITE is set.
// node prn_oncall_shift_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const F = 'supabase/functions'
const PW = await import(path.join(process.cwd(), F, '_shared/prn-week.ts'))
const R = await import(path.join(process.cwd(), F, '_shared/prn-recognition.ts'))

/* ── 1. the rules ── */
ck('the three shifts, as the office reads them', JSON.stringify(PW.SHIFTS) === '{"day":"Daytime, 7am to 5pm","overnight":"Overnight, 5pm to 7am","whole":"Whole day, 24 hours"}')
const M = [{ applicant_id: 'g', name: 'Grace Hill', team: 'cna' }, { applicant_id: 'd', name: 'Denise Gough', team: 'cna' }]
const C = (aid, s, e, shift, o = {}) => ({ kind: 'confirmed', applicant_id: aid, start_date: s, end_date: e, shift, ...o })
const pay = PW.onCallMonth([C('g', '2026-11-07', '2026-11-08', 'overnight'), C('g', '2026-11-14', '2026-11-14', 'whole'), C('d', '2026-10-31', '2026-11-01', 'day'),
  C('d', '2026-11-21', '2026-11-22', null), C('g', '2026-11-28', '2026-11-28', 'day', { cancelled_at: 'x' }), { kind: 'offer', applicant_id: 'g', pattern: 'weekday' }], M, '2026-11')
ck('payroll: each person\'s on-call days in the month, by shift (a weekend counts twice; a taken-back date not at all)', JSON.stringify(pay) === JSON.stringify([
  { applicant_id: 'd', name: 'Denise Gough', day: 1, overnight: 0, whole: 0, not_recorded: 2 }, { applicant_id: 'g', name: 'Grace Hill', day: 0, overnight: 2, whole: 1, not_recorded: 0 }]), pay)
ck('...a stretch across months counts only its days in that month (Oct 31 goes to October)', PW.onCallMonth([C('d', '2026-10-31', '2026-11-01', 'day')], M, '2026-10')[0].day === 1)
ck('...counts only, never dollars', !/\$|25|50/.test(JSON.stringify(pay)))
const w = PW.onCallWeekends([C('g', '2026-11-07', '2026-11-08', 'overnight'), C('d', '2026-11-07', '2026-11-08', null)], M, '2026-11-02')
ck('the On call tab: each confirmed person with their shift (none for older dates)', w.weekends[0].confirmed.map((c) => c.name + ':' + c.shift).join() === 'Grace Hill:overnight,Denise Gough:null', w.weekends[0])
ck('their page: confirmed dates carry the shift', R.onCallFor([C('g', '2026-11-07', '2026-11-08', 'overnight')], '2026-11-02', PW.PATTERNS).confirmed[0].shift === 'overnight')

/* ── 2. the real prn-week ── */
const GRACE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', TOM = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', TASHA = 'cccccccc-cccc-cccc-cccc-cccccccccccc', OPTED = '4175550202'
let T, SENT, EVENTS, CALLS, NOW_ID = 1, CLOCK = '11'
const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
const reset = (settings = {}) => { SENT = []; EVENTS = []; CALLS = []; NOW_ID = 1; T = {
  app_data: [{ key: 'ops_settings', data: { prn_thanks_live: true, ...settings } }, { key: 'caregivers', data: [{ first: 'Grace', last: 'Lee', phone: '4175550101', axiscare_id: '11' }, { first: 'Tom', last: 'Ray', phone: OPTED, axiscare_id: '22' }] },
    { key: 'kind_tells', data: [] }, { key: 'caregiver_availability', data: [{ axiscare_id: '22', target_hours: 12 }] },
    { key: 'coverage_cases', data: [{ id: 'cv1', client: 'Linda Smith', shift_date: day(-2) }] }],
  pay_tracks: [{ applicant_id: GRACE, track: 'prn_team', team: 'cna', since: day(-60), axiscare_caregiver_id: '11' }, { applicant_id: TOM, track: 'prn_team', team: 'cna', since: day(-60), axiscare_caregiver_id: '22' },
    { applicant_id: TASHA, track: 'prn_team', team: 'caregiver', since: day(-5), axiscare_caregiver_id: null }],
  job_applicants: [{ id: GRACE, first_name: 'Grace', last_name: 'Lee', phone: '4175550101' }, { id: TOM, first_name: 'Tom', last_name: 'Ray', phone: OPTED }, { id: TASHA, first_name: 'Tasha', last_name: 'Fox', phone: '4175550303' }],
  prn_shift_log: [{ applicant_id: GRACE, axiscare_caregiver_id: '11', case_id: 'cv1', kind: 'confirmed', shift_date: day(-2), recorded_at: new Date().toISOString() }],
  prn_touches: [], prn_oncall: [],
  auth_identities: [{ auth_user_id: 'u-kr', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p-kr' }, { auth_user_id: 'u-cg', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p-cg' }],
  persons: [{ person_id: 'p-kr', full_name: 'Krystal Office', active: true }, { person_id: 'p-cg', full_name: 'Cara Giver', active: true }],
  entity_memberships: [{ person_id: 'p-kr', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p-cg', entity: 'cc_ihs', active: true, ended_at: null }],
  staff_roles: [{ person_id: 'p-kr', entity: 'cc_ihs', role: 'staffing_coordinator' }, { person_id: 'p-cg', entity: 'cc_ihs', role: 'caregiver' }],
  contact_optout_current: [{ address: '+1' + OPTED, channel: 'sms', opted_out: true, source: 'stop_text' }], phone_index: [], circle_contacts: [], op_events: [] } }
const q = (t) => { const st = { f: [], inF: null, nul: [], upd: null }; const b = {
  select() { return b }, order() { return b }, limit() { return b }, not() { return b },
  upsert(row) { const arr = (T[t] ||= []); const i = arr.findIndex((x) => x.month === row.month); if (i >= 0) Object.assign(arr[i], row); else arr.push({ sent_at: null, sent_by: null, sent_count: 0, ...row }); return Promise.resolve({ data: null, error: null }) },
  eq(c, v) { st.f.push([c, v]); return b }, in(c, v) { st.inF = [c, v]; return b }, is(c, v) { if (v === null) st.nul.push(c); return b },
  update(o) { st.upd = o; return b },
  insert(row) { if (t === 'op_events') { EVENTS.push(row); return Promise.resolve({ data: null, error: null }) }
    const arr = (T[t] ||= [])
    if (t === 'prn_touches' && arr.some((x) => x.applicant_id === row.applicant_id && x.kind === row.kind && x.ref === row.ref)) return Promise.resolve({ data: null, error: { message: 'duplicate key value violates unique constraint' } })
    if (t === 'prn_oncall' && row.kind === 'confirmed' && arr.some((x) => x.kind === 'confirmed' && !x.cancelled_at && x.applicant_id === row.applicant_id && x.start_date === row.start_date)) return Promise.resolve({ data: null, error: { message: 'duplicate key value violates unique constraint' } })
    arr.push({ id: NOW_ID++, at: new Date().toISOString(), cancelled_at: null, ...row }); return Promise.resolve({ data: null, error: null }) },
  rows() { let r = T[t] ?? []; for (const [c, v] of st.f) r = r.filter((x) => x[c] === v); if (st.inF) r = r.filter((x) => st.inF[1].includes(x[st.inF[0]])); for (const c of st.nul) r = r.filter((x) => x[c] == null); return r },
  maybeSingle() { return Promise.resolve({ data: JSON.parse(JSON.stringify(b.rows()[0] ?? null)), error: null }) },
  then(ok) { if (st.upd) { for (const x of b.rows()) Object.assign(x, st.upd); return Promise.resolve({ data: null, error: null }).then(ok) }
    return Promise.resolve({ data: JSON.parse(JSON.stringify(b.rows())), error: null }).then(ok) } }; return b }
globalThis.__db = { from: q, rpc: async () => ({ data: null, error: null }),
  auth: { getUser: async (jwt) => jwt === 'kr' ? { data: { user: { id: 'u-kr', email: 'Krystal@mo-care.com', app_metadata: {} } }, error: null }
    : jwt === 'cg' ? { data: { user: { id: 'u-cg', email: 'cg@mo-care.com', app_metadata: {} } }, error: null } : { data: { user: null }, error: { message: 'bad' } } } }
globalThis.fetch = async (url, o) => { url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}; CALLS.push(url)
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + body.phone, dnd: false } }), { status: 200 })
  if (url.includes('/conversations/messages')) { SENT.push({ to: body.contactId, text: body.message, from: body.fromNumber }); return new Response('{}', { status: 200 }) }
  return new Response('{}', { status: 404 }) }
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const tmp = fs.mkdtempSync(path.join(process.cwd(), '_os_'))
try {
  const src = fs.readFileSync(path.join(F, 'prn-week/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/from '\.\.\/_shared\/(\w[\w-]*)\.ts'/g, (_, m) => "from '" + path.join(process.cwd(), F, '_shared', m + '.ts') + "'")
  fs.writeFileSync(path.join(tmp, 'prn-week.ts'), src); await import(path.join(tmp, 'prn-week.ts'))
  const call = async (body, jwt = 'kr') => { const r = await handler(new Request('https://x/functions/v1/prn-week', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: 'Bearer ' + jwt } : {}) }, body: JSON.stringify(body) }))
    let j = null; try { j = await r.json() } catch { /* */ } return { status: r.status, j } }
  const sat = (() => { const d = new Date(day(0) + 'T12:00:00Z'); return new Date(d.getTime() + ((6 - d.getUTCDay() + 7) % 7 + 7) * 86400000).toISOString().slice(0, 10) })()
  const sun = new Date(Date.parse(sat + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10)
  reset(); let r = await call({ action: 'oncall_confirm', applicant_id: GRACE, start_date: sat, end_date: sun })
  ck('switch off: a confirm without a shift still works, as today', r.j.outcome === 'recorded' && T.prn_oncall[0].shift === undefined, [r.j, T.prn_oncall])
  reset(); r = await call({ action: 'oncall_confirm', applicant_id: GRACE, start_date: sat, end_date: sun, shift: 'overnight' })
  ck('...with a shift: kept on the date', r.j.outcome === 'recorded' && T.prn_oncall[0].shift === 'overnight' && EVENTS.some((e) => /\(overnight\)$/.test(e.summary)), [T.prn_oncall, EVENTS])
  reset(); r = await call({ action: 'oncall_confirm', applicant_id: GRACE, start_date: sat, end_date: sun, shift: 'evening' }); ck('...an unknown shift: refused', r.status === 400 && !T.prn_oncall.length)
  reset({ prn_oncall_shift_live: true }); r = await call({ action: 'oncall_confirm', applicant_id: GRACE, start_date: sat, end_date: sun })
  ck('switch on: a confirm must say which shift', r.status === 400 && /daytime \(7am to 5pm\), overnight \(5pm to 7am\) or the whole day/.test(r.j.error) && !T.prn_oncall.length, r.j)
  r = await call({ action: 'oncall_confirm', applicant_id: GRACE, start_date: sat, end_date: sun, shift: 'whole' })
  r = await call({ action: 'week' })
  const wk = r.j.oncall.weekends.find((x) => x.saturday === sat)
  ck('week: the confirmed shift, the shift list, the switch, and payroll counts for this month and last', wk.confirmed[0].shift === 'whole' && r.j.oncall.shift_live === true && Object.keys(r.j.oncall.shifts).join() === 'day,overnight,whole'
    && r.j.oncall.payroll.length === 2 && /^\d{4}-\d\d$/.test(r.j.oncall.payroll[0].month), r.j.oncall)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }

/* ── 3. the SQL ── */
const sql = fs.readFileSync('prn_oncall_shift.sql', 'utf8')
if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE); const db = new PGlite()
  await db.exec(`create table public.job_applicants (id uuid primary key); create table public.app_data (key text primary key, data jsonb); create table public.job_postings (slug text primary key, description text);
    insert into public.job_applicants values ('00000000-0000-0000-0000-000000000001');`)
  try { await db.exec(`do $$ begin create role anon; create role authenticated; create role service_role; exception when others then null; end $$;`) } catch {}
  await db.exec(fs.readFileSync('prn_week.sql', 'utf8'))
  await db.exec('begin;' + sql + 'commit;'); await db.exec('begin;' + sql + 'commit;')
  const A = "'00000000-0000-0000-0000-000000000001'"
  await db.query(`insert into public.prn_oncall (applicant_id, kind, start_date, end_date, by_email, shift) values (${A}, 'confirmed', '2026-11-07', '2026-11-08', 'k', 'overnight')`)
  await db.query(`insert into public.prn_oncall (applicant_id, kind, start_date, end_date, by_email) values (${A}, 'confirmed', '2026-11-14', '2026-11-15', 'k')`)
  let bad = false; try { await db.query(`insert into public.prn_oncall (applicant_id, kind, start_date, end_date, by_email, shift) values (${A}, 'confirmed', '2026-11-21', '2026-11-22', 'k', 'evening')`) } catch { bad = true }
  let offer = false; try { await db.query(`insert into public.prn_oncall (applicant_id, kind, pattern, by_email, shift) values (${A}, 'offer', 'weekday', 'k', 'day')`) } catch { offer = true }
  ck('SQL: runs twice; a confirmed date keeps its shift (or none, from before); an unknown shift or a shift on an offer is refused', bad && offer)
} else ck('SQL on a throwaway Postgres (skipped: PGLITE not set)', true)

const fails = res.filter((r) => !r[1])
for (const [n, okk, note] of res) console.log((okk ? 'PASS ' : 'FAIL ') + n + (okk ? '' : '  ' + note))
console.log(`\n${res.length - fails.length}/${res.length} passed`)
process.exit(fails.length ? 1 : 0)
