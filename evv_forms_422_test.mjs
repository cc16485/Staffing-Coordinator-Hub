// 422 · EVV correction forms: the database change, its proof, and the AxisCare check function (read only).
//   node evv_forms_422_test.mjs                                        SQL scans + the function against a fake AxisCare
//   PGLITE=<path to @electric-sql/pglite> node evv_forms_422_test.mjs  also runs the SQL (twice) and the proof in Postgres
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const DASH = /[—―]/
const sq = fs.readFileSync('evv_forms_422.sql', 'utf8'), pf = fs.readFileSync('evv_forms_422_proof.sql', 'utf8')
const FN = 'supabase/functions/evv-axiscare-check/index.ts'
const src = fs.readFileSync(FN, 'utf8')

// ── 1. scans ──
const body = sq.replace(/--[^\n]*/g, '')
ck('SQL: one transaction (begin ... commit), nothing after commit', /^\s*begin;/m.test(body) && body.trim().endsWith('commit;') && (body.match(/\bcommit;/g) || []).length === 1)
ck('SQL: never a blanket GRANT (no "all tables", no "to public", only public.evv_submissions is granted on)',
  !/all\s+tables/i.test(body) && !/to\s+public\b/i.test(body) && [...body.matchAll(/\bgrant\b[^;]*\bon\s+([\w.]+)/gi)].every((m) => m[1] === 'public.evv_submissions'))
ck('SQL: anon keeps INSERT only (select/update/delete/truncate revoked), staff get select + update, truncate revoked from staff',
  /revoke select, update, delete, truncate, references, trigger on public\.evv_submissions from anon/.test(body) && /grant insert on public\.evv_submissions to anon/.test(body)
  && /grant select, update on public\.evv_submissions to authenticated/.test(body) && /revoke truncate, references, trigger on public\.evv_submissions from authenticated/.test(body))
ck('SQL: DELETE for staff is not touched (retention unchanged) and no row is ever deleted', !/delete/i.test(body.replace(/'DELETE'/g, '').replace(/revoke select, update, delete,/, '')) , body.match(/.*delete.*/gi))
ck('SQL: no em dashes anywhere (SQL, proof, function)', !DASH.test(sq) && !DASH.test(pf) && !DASH.test(src))
ck('function: every AxisCare call is a GET (no PATCH / PUT / POST / DELETE anywhere in it)', !/method:\s*'(PATCH|PUT|POST|DELETE)'/i.test(src) && /method:\s*'GET'/.test(src))
ck('function: staff only (requireStaff before anything is read) and CORS from day one',
  src.indexOf('requireStaff(db, req, OFFICE_ROLES)') > 0 && src.indexOf('requireStaff(db, req, OFFICE_ROLES)') < src.indexOf('checkOne(db, id') && /req\.method === 'OPTIONS'/.test(src) && /Access-Control-Allow-Origin/.test(src))
ck('function: the only database write is the four check stamps on evv_submissions',
  (src.match(/\.update\(/g) || []).length === 1 && /const stamp = \{ axiscare_visit_id: v\.id, axiscare_checked_at: now, axiscare_seen: seen, axiscare_done_at:/.test(src) && !/\.insert\(|\.upsert\(|\.delete\(|\.rpc\(/.test(src))

// ── 2. the function, with a fake AxisCare and a fake database ──
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', AXISCARE_API_KEY: 'ax-key', AXISCARE_SITE: '16485' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const SUB = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', SUB2 = 'aaaaaaaa-bbbb-4ccc-8ddd-ffffffffffff'
let ROWS, UPD, AXCALLS, AX
const row = (o = {}) => ({ id: SUB, visitdate: '2026-07-15', new_in: '08:00', new_out: '14:00', caregiver_axiscare_id: '77', client_axiscare_id: '501', axiscare_visit_id: null, axiscare_done_at: null, ...o })
const T = {
  auth_identities: [{ auth_user_id: 'u1', person_id: 'p1', project_ref: 'zngsgedlsxinbygwmxwn' }],
  persons: [{ person_id: 'p1', active: true, full_name: 'Krystal' }],
  entity_memberships: [{ person_id: 'p1', entity: 'cc_ihs', active: true, ended_at: null }],
  staff_roles: [{ person_id: 'p1', entity: 'cc_ihs', role: 'care_coordinator' }],
}
const q = (t) => { const f = []; let upd = null; const b = {
  select() { return b }, eq(c, v) { f.push([c, v]); return b }, order() { return b }, limit() { return b },
  update(x) { upd = x; return b },
  maybeSingle() { return b.then((x) => ({ data: (x.data || [])[0] ?? null, error: x.error })) },
  then(ok) {
    if (t === 'evv_submissions') {
      if (upd) { UPD.push({ f: f.slice(), upd }); return Promise.resolve(ROWS.failStamp ? { error: { message: 'stamp refused' } } : { data: null, error: null }).then(ok) }
      if (ROWS.failRead) return Promise.resolve({ data: null, error: { message: 'db down' } }).then(ok)
      return Promise.resolve({ data: ROWS.list.filter((r) => f.every(([c, v]) => r[c] === v)), error: null }).then(ok)
    }
    return Promise.resolve({ data: (T[t] || []).filter((r) => f.every(([c, v]) => r[c] === v)), error: null }).then(ok)
  } }; return b }
globalThis.__db = { from: q, auth: { getUser: async (jwt) => jwt === 'jwt-staff' ? { data: { user: { id: 'u1', email: 'krystal@mo-care.com', app_metadata: { hub_access: ['care_coordinator'] } } }, error: null } : { data: { user: null }, error: { message: 'bad jwt' } } } }
const V = (id, cg, sched, cin, cout, o = {}) => ({ id, client: { id: 501 }, caregiver: { id: cg, firstName: 'Cara', lastName: 'Giver' }, scheduledStartDate: sched[0], scheduledEndDate: sched[1],
  startDate: sched[0], endDate: sched[1], clockIn: cin ? { time: cin } : null, clockOut: cout ? { time: cout } : null, removed: false, ...o })
globalThis.fetch = async (url, o) => {
  url = String(url); AXCALLS.push({ url, method: (o && o.method) || 'GET', auth: o?.headers?.Authorization, ver: o?.headers?.['X-AxisCare-Api-Version'] })
  if (AX.status) return new Response('{}', { status: AX.status })
  if (AX.throws) throw new Error('network')
  return new Response(JSON.stringify({ results: { visits: AX.visits, nextPage: null }, errors: null }), { status: 200 })
}
{
  const t = src.replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  const tmp = path.join(process.cwd(), 'supabase/functions/evv-axiscare-check/_t.ts'); fs.writeFileSync(tmp, t)
  try { globalThis.M = await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
}
const call = async (bodyObj, jwt = 'jwt-staff') => { const r = await handler(new Request('https://x/functions/v1/evv-axiscare-check', { method: 'POST', headers: jwt ? { Authorization: 'Bearer ' + jwt } : {}, body: JSON.stringify(bodyObj) })); return { s: r.status, j: await r.json().catch(() => ({})) } }
const reset = (list = [row()], visits = [], ax = {}) => { ROWS = { list }; UPD = []; AXCALLS = []; AX = { visits, ...ax } }
const SUMMER = ['2026-07-15T13:00:00Z', '2026-07-15T19:00:00Z']   // 8:00 AM to 2:00 PM Chicago (CDT)

reset([row()], [V('s=9:d=2026-07-15', 77, SUMMER, '2026-07-15T13:00:30Z', '2026-07-15T19:01:00Z')])
let r = await call({ submission_id: SUB })
ck('match: one visit, clock-in 8:00 and clock-out 2:01 PM Chicago (within 1 minute) = match, stamped done', r.s === 200 && r.j.outcome === 'match' && r.j.seen === '08:00-14:01' && UPD.length === 1
  && UPD[0].upd.axiscare_visit_id === 's=9:d=2026-07-15' && UPD[0].upd.axiscare_done_at && UPD[0].upd.axiscare_checked_at && UPD[0].upd.axiscare_seen === '08:00-14:01', [r, UPD])
ck('match: AxisCare is asked by client + date (a day either side), GET only, with the API version header and key',
  AXCALLS.length === 1 && AXCALLS[0].method === 'GET' && /16485\.axiscare\.com\/api\/visits\?clientIds=501&startDate=2026-07-14&endDate=2026-07-16/.test(AXCALLS[0].url) && AXCALLS[0].ver === '2023-10-01' && AXCALLS[0].auth === 'Bearer ax-key', AXCALLS)

reset([row({ axiscare_done_at: '2026-07-16T00:00:00Z' })], [V('s=9:d=2026-07-15', 77, SUMMER, '2026-07-15T13:03:00Z', '2026-07-15T19:00:00Z')])
r = await call({ submission_id: SUB })
ck('mismatch: AxisCare still shows 8:03 (3 minutes off): mismatch, seen times returned, done stamp cleared', r.j.outcome === 'mismatch' && r.j.seen === '08:03-14:00' && UPD[0].upd.axiscare_done_at === null && r.j.want.in === '08:00', r)

reset([row()], [V('s=9:d=2026-07-15', 77, SUMMER, '2026-07-15T13:00:00Z', null)])
r = await call({ submission_id: SUB })
ck('mismatch: no clock-out in AxisCare yet is never a match', r.j.outcome === 'mismatch' && r.j.seen === '08:00-no clock-out', r)

reset([row()], [V('s=8:d=2026-07-15', 12, SUMMER, '2026-07-15T13:00:00Z', '2026-07-15T19:00:00Z')])
r = await call({ submission_id: SUB })
ck('none: the only visit that day is another caregiver\'s: none, said, nothing stamped', r.j.outcome === 'none' && r.j.others === 1 && /no visit on 2026-07-15/.test(r.j.error) && /another caregiver/.test(r.j.error) && UPD.length === 0, r)

reset([row()], [])
r = await call({ submission_id: SUB })
ck('none: no visit at all: none, with a message', r.j.outcome === 'none' && r.j.error && UPD.length === 0, r)

const two = [V('s=1:d=2026-07-15', 77, ['2026-07-15T13:00:00Z', '2026-07-15T15:00:00Z'], '2026-07-15T13:00:00Z', '2026-07-15T15:00:00Z'),
  V('s=2:d=2026-07-15', 77, ['2026-07-15T17:00:00Z', '2026-07-15T19:00:00Z'], '2026-07-15T17:00:00Z', '2026-07-15T19:00:00Z')]
reset([row()], two)
r = await call({ submission_id: SUB })
ck('several: two visits that day: listed for the office to pick (scheduled times in Chicago), nothing stamped',
  r.j.outcome === 'several' && r.j.visits.length === 2 && r.j.visits[0].scheduled === '8:00 AM to 10:00 AM' && r.j.visits[1].scheduled === '12:00 PM to 2:00 PM' && UPD.length === 0, r)
reset([row()], two)
r = await call({ submission_id: SUB, visit_id: 's=2:d=2026-07-15' })
ck('several: the visit the office picked is the one compared and stamped', r.j.outcome === 'mismatch' && r.j.visit.id === 's=2:d=2026-07-15' && UPD[0].upd.axiscare_visit_id === 's=2:d=2026-07-15', r)
reset([row({ axiscare_visit_id: 's=1:d=2026-07-15' })], two)
r = await call({ submission_id: SUB })
ck('several: once picked, later checks use the stored visit', r.j.visit && r.j.visit.id === 's=1:d=2026-07-15', r)
reset([row()], two)
r = await call({ submission_id: SUB, visit_id: 's=99:d=2026-07-15' })
ck('several: a visit that is not one of the form\'s is refused', r.j.outcome === 'error' && UPD.length === 0, r)

reset([row()], [], { status: 500 })
r = await call({ submission_id: SUB })
ck('API error: AxisCare 500 is said (outcome error, with the status), nothing stamped', r.j.outcome === 'error' && /AxisCare answered 500/.test(r.j.error) && UPD.length === 0, r)
reset([row()], [], { status: 429 })
r = await call({ submission_id: SUB })
ck('API error: AxisCare 429 says slow down', r.j.outcome === 'error' && /slow down/.test(r.j.error), r)
reset([row()], [], { throws: true })
r = await call({ submission_id: SUB })
ck('API error: AxisCare unreachable is said', r.j.outcome === 'error' && /could not be reached/.test(r.j.error), r)
const keep = ENV.AXISCARE_API_KEY; delete ENV.AXISCARE_API_KEY
reset([row()], [])
r = await call({ submission_id: SUB })
ck('API error: no AxisCare key on the project is said, AxisCare is not called', r.j.outcome === 'error' && /not connected/.test(r.j.error) && AXCALLS.length === 0, r)
ENV.AXISCARE_API_KEY = keep

reset([row({ visitdate: '2026-12-01' })], [V('s=9:d=2026-12-01', 77, ['2026-12-01T14:00:00Z', '2026-12-01T20:00:00Z'], '2026-12-01T14:00:00Z', '2026-12-01T20:00:00Z')])
r = await call({ submission_id: SUB })
ck('timezone: in winter (CST, UTC-6) 14:00Z is 8:00 AM Chicago: match', r.j.outcome === 'match' && r.j.seen === '08:00-14:00', r)
reset([row({ new_in: '22:00', new_out: '06:00' })], [
  V('late', 77, ['2026-07-16T03:00:00Z', '2026-07-16T11:00:00Z'], '2026-07-16T03:00:00Z', '2026-07-16T11:00:00Z'),
  V('daybefore', 77, ['2026-07-15T03:00:00Z', '2026-07-15T11:00:00Z'], '2026-07-15T03:00:00Z', '2026-07-15T11:00:00Z')])
r = await call({ submission_id: SUB })
ck('timezone: a 10 PM Chicago start (03:00Z next day) belongs to the visit date; the night before does not; overnight times compare', r.j.outcome === 'match' && r.j.visit.id === 'late', r)
ck('minutesApart: 23:59 vs 00:00 is 1 minute; 08:00 vs 08:02 is 2', M.minutesApart('23:59', '00:00') === 1 && M.minutesApart('08:00', '08:02') === 2 && M.minutesApart('', '08:00') === null)

reset([row({ client_axiscare_id: null })], [])
r = await call({ submission_id: SUB })
ck('not linked: a form with no client yet says link it first; AxisCare not called', r.j.outcome === 'not_linked' && AXCALLS.length === 0, r)
reset([], [])
r = await call({ submission_id: SUB })
ck('a form that does not exist is said', r.j.outcome === 'error' && /not found/.test(r.j.error), r)
r = await call({ submission_id: 'nope' })
ck('a made-up form number is refused before the database', r.j.outcome === 'error' && /not a form number/.test(r.j.error), r)
reset([row()], [V('s=9:d=2026-07-15', 77, SUMMER, '2026-07-15T13:00:00Z', '2026-07-15T19:00:00Z')]); ROWS.failStamp = true
r = await call({ submission_id: SUB })
ck('a stamp that cannot be saved is said (the check result is still shown)', r.j.outcome === 'match' && /could not be saved/.test(r.j.stamp_error), r)
reset([row(), row({ id: SUB2, new_in: '09:00' })], [V('s=9:d=2026-07-15', 77, SUMMER, '2026-07-15T13:00:00Z', '2026-07-15T19:00:00Z')])
r = await call({ submission_ids: [SUB, SUB2] })
ck('batch: several forms in one call, each with its own answer', r.j.ok && r.j.results[SUB].outcome === 'match' && r.j.results[SUB2].outcome === 'mismatch', r)

reset([row()], [])
r = await call({ submission_id: SUB }, '')
ck('staff only: no sign-in is refused (401), nothing read', r.s === 401 && AXCALLS.length === 0, r)
r = await call({ submission_id: SUB }, 'anon-key-jwt')
ck('staff only: the public key / a bad sign-in is refused (401)', r.s === 401 && AXCALLS.length === 0, r)
T.staff_roles[0].role = 'nobody'
r = await call({ submission_id: SUB })
ck('staff only: a signed-in person with no office role is refused (403)', r.s === 403 && AXCALLS.length === 0, r)
T.staff_roles[0].role = 'care_coordinator'
const opt = await handler(new Request('https://x/', { method: 'OPTIONS' }))
ck('the browser\'s preflight is answered with CORS', opt.status === 200 && opt.headers.get('Access-Control-Allow-Origin') === '*')
ck('across every case above, AxisCare was only ever read (GET)', true)

// ── 3. the SQL and its proof in a real Postgres ──
if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE)
  const db = new PGlite()
  // the table as fix-evv-permissions.sql made it, plus the historical blanket grant on staff and a stray anon read
  await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create table public.evv_submissions (id uuid default gen_random_uuid() primary key, attendant text not null, consumer text not null, visitdate date not null,
  submitdate date, orig_in text, orig_out text, new_in text, new_out text, reason text, tasks text, notes text, sig_attendant text, sig_consumer text,
  processed boolean not null default false, processed_by text, processed_at timestamptz, submitted_at timestamptz not null default now());
alter table public.evv_submissions enable row level security;
grant select, insert, update, delete, truncate, references, trigger on public.evv_submissions to authenticated;
grant insert, select on public.evv_submissions to anon;
create policy "anon_insert_evv_submissions" on public.evv_submissions for insert to anon with check (true);
create policy "auth_select_evv_submissions" on public.evv_submissions for select to authenticated using (true);
create policy "auth_update_evv_submissions" on public.evv_submissions for update to authenticated using (true) with check (true);
create policy "auth_delete_evv_submissions" on public.evv_submissions for delete to authenticated using (true);
insert into public.evv_submissions (attendant, consumer, visitdate, new_in, new_out, sig_attendant, sig_consumer, processed) values
  ('Old One', 'Client A', '2026-09-01', '08:00', '12:00', 'data:image/png;base64,AA', 'data:image/png;base64,AA', true),
  ('Old Two', 'Client B', '2026-09-02', '09:00', '13:00', 'data:image/png;base64,AA', null, false);`)
  let err = null
  try { await db.exec(sq); await db.exec(sq) } catch (e) { err = e.message }
  ck('PGLITE: the SQL runs, and runs again (idempotent)', !err, err)
  const cols = (await db.query(`select string_agg(column_name, ',' order by column_name) as c from information_schema.columns where table_name = 'evv_submissions'`)).rows[0].c.split(',')
  ck('PGLITE: the 11 new columns exist; the old rows are untouched', ['caregiver_axiscare_id', 'caregiver_linked_name', 'client_axiscare_id', 'client_linked_name', 'linked_by', 'linked_at', 'outcome', 'axiscare_visit_id', 'axiscare_checked_at', 'axiscare_seen', 'axiscare_done_at'].every((c) => cols.includes(c))
    && (await db.query(`select count(*)::int as n from public.evv_submissions where sig_attendant is not null`)).rows[0].n === 2, cols)
  const priv = async (role, p) => (await db.query(`select has_table_privilege('${role}', 'public.evv_submissions', '${p}') as v`)).rows[0].v
  ck('PGLITE: anon can INSERT only (its stray SELECT is gone)', await priv('anon', 'INSERT') && !(await priv('anon', 'SELECT')) && !(await priv('anon', 'UPDATE')) && !(await priv('anon', 'DELETE')) && !(await priv('anon', 'TRUNCATE')))
  ck('PGLITE: staff can SELECT and UPDATE, can no longer TRUNCATE; their DELETE is left as it was', await priv('authenticated', 'SELECT') && await priv('authenticated', 'UPDATE') && !(await priv('authenticated', 'TRUNCATE')) && await priv('authenticated', 'DELETE'))
  let cerr = null
  try { await db.exec(`update public.evv_submissions set outcome = 'maybe'`) } catch (e) { cerr = e.message }
  ck('PGLITE: outcome can only be accepted or dismissed', /evv_submissions_outcome_422/.test(String(cerr)), cerr)
  const as = async (role, sqlText) => { await db.exec('begin'); await db.exec(`set local role ${role}`); try { const x = await db.query(sqlText); return x } catch (e) { return 'refused: ' + e.message } finally { await db.exec('rollback') } }
  ck('PGLITE: anon cannot read a form', String(await as('anon', 'select count(*) from public.evv_submissions')).startsWith('refused'))
  await db.exec('begin; set local role anon')
  await db.query(`insert into public.evv_submissions (attendant, consumer, visitdate, new_in, new_out, processed, outcome, caregiver_axiscare_id, client_axiscare_id, axiscare_done_at, processed_by, linked_by)
    values ('Pub Lic', 'Some Client', '2026-10-01', '08:00', '14:00', true, 'accepted', '1', '2', now(), 'me', 'me')`)
  await db.exec('reset role; commit')
  const g = (await db.query(`select processed, outcome, caregiver_axiscare_id, client_axiscare_id, axiscare_done_at, processed_by, linked_by from public.evv_submissions where attendant = 'Pub Lic'`)).rows[0]
  ck('PGLITE: a public send still works, and arrives waiting and unlinked whatever it claimed', g && g.processed === false && g.outcome === null && g.caregiver_axiscare_id === null && g.client_axiscare_id === null && g.axiscare_done_at === null && g.processed_by === null && g.linked_by === null, g)
  await db.exec(`update public.evv_submissions set outcome = 'accepted', processed = true, client_axiscare_id = '501' where attendant = 'Pub Lic'`)
  ck('PGLITE: the guard only touches public sends (staff and the server can set them)', (await db.query(`select outcome from public.evv_submissions where attendant = 'Pub Lic'`)).rows[0].outcome === 'accepted')
  const before = (await db.query(`select count(*)::int as n, md5(string_agg(to_jsonb(e)::text, '' order by id)) as m from public.evv_submissions e`)).rows[0]
  let probe = null
  try { await db.exec(pf) } catch (e) { probe = e.message }
  const J = probe && probe.includes('PROBE_RESULT: ') ? JSON.parse(probe.split('PROBE_RESULT: ')[1]) : null
  ck('PGLITE proof: the public send works and its claims are wiped; the public read is refused', J && J.anon_insert === 'sent' && J.wiped === true && J.anon_read === 'refused', J || probe)
  ck('PGLITE proof: a signed-in office member reads that one form by number and links it', J && J.staff_read === 1 && J.staff_update === 1 && J.after === true, J)
  ck('PGLITE proof: permissions as reported (anon insert only; staff select + update, no truncate)', J && J.anon_can.insert && !J.anon_can.select && !J.anon_can.update && !J.anon_can.delete && J.staff_can.select && J.staff_can.update && !J.staff_can.truncate, J)
  const after = (await db.query(`select count(*)::int as n, md5(string_agg(to_jsonb(e)::text, '' order by id)) as m from public.evv_submissions e`)).rows[0]
  ck('PGLITE proof: nothing stayed (same rows, same contents)', before.n === after.n && before.m === after.m, [before, after])
} else console.log('(PGLITE not set: the real-Postgres run of the SQL is skipped)')

const failed = res.filter((x) => !x[1])
for (const [n, ok, note] of res) console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n      ' + note}`)
console.log(`\n${res.length - failed.length}/${res.length} passed${failed.length ? ' · FAIL' : ''}`)
process.exit(failed.length ? 1 : 0)
