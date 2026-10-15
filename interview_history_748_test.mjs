// 748 · every interview cancel and move recorded right, run in a REAL Postgres (PGlite) with made-up people.
//   PGLITE=<path to @electric-sql/pglite> HUB_ROOT=<care-coordinator-hub checkout> node interview_history_748_test.mjs
// Loads the rules as they are live (noshow_policy.sql + interview-limits.sql + 461), shows the bug, installs 748, checks it,
// then the rollback.
import fs from 'fs'; import path from 'path'
const PG = process.env.PGLITE; if (!PG) { console.log('SKIP: set PGLITE to run against a real Postgres'); process.exit(0) }
const { PGlite } = await import(PG.endsWith('.js') ? PG : path.join(PG, 'dist/index.js'))   // PGLITE may name the package folder or its dist/index.js (the other tests use the file)
const db = new PGlite()
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 600)])
const q = async (s, p) => (await db.query(s, p)).rows
const ex = async (s) => db.exec(s)
const HUB = process.env.HUB || process.env.HUB_ROOT || '../cc-hub-live'
await ex(`create role anon; create role authenticated; create schema auth;
  create table auth_state(role text); insert into auth_state values ('anon');
  create function auth.role() returns text language sql stable as $$ select role from public.auth_state limit 1 $$;
  create table job_applicants (id uuid primary key default gen_random_uuid(), first_name text, last_name text, phone text, email text, status text default 'partial',
    duplicate_of uuid, screen_grade text, screen_flags text[], created_at timestamptz default now(), decline_reason text);
  create table interview_bookings (id uuid primary key default gen_random_uuid(), applicant_id uuid, coordinator_id uuid, starts_at timestamptz, ends_at timestamptz,
    status text default 'booked', cancelled_at timestamptz, cancelled_by text, cancel_reason text, cancel_notified_at timestamptz, rescheduled_from timestamptz,
    confirmed_at timestamptz, reminded_day_at timestamptz, reminded_hour_at timestamptz, created_at timestamptz default now());
  create table coordinator_busy (id serial, coordinator_id uuid, starts_at timestamptz, ends_at timestamptz, source text, source_id text, label text);
  create table activity_types (key text, minutes int, lead_hours int, per_slot int); insert into activity_types values ('interview', 30, 2, 1);
  create table do_not_rehire (id uuid primary key default gen_random_uuid(), name text, phone_digits text, email text, reason text, added_by text);
  create table coordinators (id uuid primary key default gen_random_uuid(), active boolean default true);
  create table coordinator_availability (coordinator_id uuid, active boolean default true, activity text, day_of_week int, start_time time, end_time time);
  insert into coordinators (id) values ('00000000-0000-4000-8000-0000000000c1');
  insert into coordinator_availability select '00000000-0000-4000-8000-0000000000c1', true, 'interview', d, '00:00', '23:59' from generate_series(0,6) d;`)
const ns = fs.readFileSync('noshow_policy.sql', 'utf8').replace(/^alter table .*$/gm, '')
await ex(ns)
await ex(fs.readFileSync(path.join(HUB, 'interview-limits.sql'), 'utf8').replace(/create or replace function interview_mine[\s\S]*?end \$\$;/, ''))
const day = (n, h) => `(date_trunc('day', now() at time zone 'America/Chicago') + interval '${n} days' + interval '${h} hours') at time zone 'America/Chicago'`
const app = async (first, phone, email, status = 'new', ago = 0) => (await q(`insert into job_applicants (first_name,last_name,phone,email,status,created_at) values ($1,'Test',$2,$3,$4, now() - ($5 || ' hours')::interval) returning id`, [first, phone, email, status, ago]))[0].id
const book = async (a, n, h) => (await q(`select interview_book($1, ${day(n, h)}) as id`, [a]))[0].id
const live = async (ids) => (await q(`select applicant_id, status, cancelled_by, cancel_reason, cancel_notified_at is not null as quiet from interview_bookings where applicant_id = any($1) order by created_at`, [ids]))
const asRole = async (r) => ex(`update auth_state set role = '${r}'`)


await ex(fs.readFileSync('interview_person_461.sql', 'utf8').replace(/^notify .*$/m, ''))
await ex(`create role service_role`)
const st = async (a) => (await q(`select status, cancelled_by, cancel_reason from interview_bookings where applicant_id = $1 order by created_at desc limit 1`, [a]))[0]
const used2 = async (a) => { await book(a, 3, 9); await asRole('anon'); await q(`select interview_cancel($1)`, [a]); await book(a, 3, 10); await q(`select interview_cancel($1)`, [a]) }

// ── as it is live today (461) ──
let a = await app('Ann', '4175551001', 'ann@example.com')
await book(a, 4, 9); await asRole('service_role')
await q(`select interview_cancel($1, 'coordinator out sick', 'office')`, [a])
let r = await st(a)
ck('TODAY (461): the office\'s Cancel sheet (the Hub\'s server) saying "we need to cancel" is saved as the APPLICANT cancelling', r.cancelled_by === 'applicant', r)
let b = await app('Bo', '4175551002', 'bo@example.com'); await used2(b); await book(b, 5, 9)
await asRole('service_role'); let c = (await q(`select interview_cancel($1, null, 'office') as c`, [b]))[0].c
ck('TODAY (461): after the applicant used their two online changes, the office cannot cancel for them at all', c.cancelled === false && c.reason === 'limit', c)
await asRole('anon'); await q(`select interview_cancel($1)`, [b]).catch(() => {})
await asRole('authenticated'); await q(`select interview_cancel($1, null, 'office')`, [b])

// ── install 748 ──
const sql748 = fs.readFileSync('interview_history_748.sql', 'utf8')
ck('748 is one transaction', (sql748.match(/^begin;$/gm) || []).length === 1 && (sql748.match(/^commit;$/gm) || []).length === 1)
await ex(sql748.replace(/^notify .*$/m, ''))
ck('748 adds office_user to the bookings', (await q(`select count(*)::int n from information_schema.columns where table_name = 'interview_bookings' and column_name = 'office_user'`))[0].n === 1)
a = await app('Cy', '4175551003', 'cy@example.com'); await book(a, 4, 11)
await asRole('service_role'); await q(`select interview_cancel($1, 'coordinator out sick', 'office')`, [a]); r = await st(a)
ck('748: the office sheet "we need to cancel" is saved as the office, with the reason', r.cancelled_by === 'office' && r.cancel_reason === 'coordinator out sick', r)
a = await app('Di', '4175551004', 'di@example.com'); await book(a, 4, 12)
await asRole('service_role'); await q(`select interview_cancel($1, 'car trouble', 'applicant')`, [a]); r = await st(a)
ck('748: the office sheet "they asked to cancel" is saved as the applicant (it counts in their history)', r.cancelled_by === 'applicant' && r.cancel_reason === 'car trouble', r)
b = await app('Ed', '4175551005', 'ed@example.com'); await used2(b); await book(b, 5, 11)
await asRole('anon'); c = (await q(`select interview_cancel($1) as c`, [b]))[0].c
ck('748: the public apply page is still held to two online changes', c.cancelled === false && c.reason === 'limit', c)
await asRole('service_role'); c = (await q(`select interview_cancel($1, 'called in, sick child', 'applicant') as c`, [b]))[0].c
ck('748: ...but when they ring up, the office can still cancel for them, and it is saved as theirs', c.cancelled === true && (await st(b)).cancelled_by === 'applicant', [c, await st(b)])
ck('...their changes now add up to three (two online, one by phone)', (await q(`select interview_self_changes($1) as n`, [b]))[0].n === 3)
a = await app('Flo', '4175551006', 'flo@example.com'); await book(a, 9, 9)
// a booking an hour from now: too close for the page, fine for the office
await q(`update interview_bookings set starts_at = now() + interval '1 hour' where applicant_id = $1`, [a])
await asRole('anon'); c = (await q(`select interview_cancel($1) as c`, [a]))[0].c
ck('748: the page still refuses within two hours', c.cancelled === false && c.reason === 'too_close', c)
await asRole('service_role'); c = (await q(`select interview_cancel($1, null, 'office') as c`, [a]))[0].c
ck('748: ...the office can cancel within two hours', c.cancelled === true, c)
// moves
b = await app('Gus', '4175551007', 'gus@example.com'); await used2(b); await book(b, 6, 9)
await asRole('anon'); let err = ''; try { await q(`select interview_reschedule($1, ${day(6, 13)})`, [b]) } catch (e) { err = e.message }
ck('748: the page still cannot move a booking after two changes', /^CHANGE_LIMIT/.test(err), err)
await asRole('authenticated'); await q(`select interview_reschedule($1, ${day(6, 13)}, 'applicant')`, [b])
let mv = (await q(`select status, cancelled_by, cancel_reason from interview_bookings where applicant_id = $1 and cancelled_by = 'reschedule'`, [b]))
ck('748: the office\'s Move with "they asked" works past the limit and is saved as moved by the applicant', mv.length === 1 && mv[0].cancel_reason === 'moved by the applicant' && (await q(`select count(*)::int n from interview_bookings where applicant_id = $1 and status = 'booked'`, [b]))[0].n === 1, mv)
await q(`select interview_reschedule($1, ${day(6, 15)}, 'office')`, [b])
mv = (await q(`select cancel_reason from interview_bookings where applicant_id = $1 and cancelled_by = 'reschedule' order by cancelled_at, created_at`, [b])).map((x) => x.cancel_reason)
ck('748: ...and "we need to move it" is saved as moved by the office (not held against them)', mv.includes('moved by the office') && (await q(`select interview_self_changes($1) as n`, [b]))[0].n === 3, mv)
await asRole('anon'); a = await app('Hal', '4175551008', 'hal@example.com'); await book(a, 7, 9)
await q(`select interview_reschedule($1, ${day(7, 13)}, 'office')`, [a])
ck('748: an anonymous caller claiming to be the office is still treated as the applicant', (await q(`select cancel_reason from interview_bookings where applicant_id = $1 and cancelled_by = 'reschedule'`, [a]))[0].cancel_reason === 'moved by the applicant')

// ── rollback ──
await ex(fs.readFileSync('interview_history_748_rollback.sql', 'utf8').replace(/^notify .*$/m, ''))
a = await app('Ivy', '4175551009', 'ivy@example.com'); await book(a, 8, 9)
await asRole('service_role'); await q(`select interview_cancel($1, null, 'office')`, [a])
ck('rollback: back to 461 exactly (the server is treated as the applicant again)', (await st(a)).cancelled_by === 'applicant')
const body461 = (n) => fs.readFileSync('interview_person_461.sql', 'utf8').match(new RegExp('create or replace function public\\.' + n + '\\([\\s\\S]*?end \\$\\$;'))[0]
const prosrcOf = async (n) => (await q(`select prosrc from pg_proc where proname = $1`, [n]))[0].prosrc.trim()
ck('rollback: the two rules are word for word 461\'s', (await prosrcOf('interview_cancel')) === body461('interview_cancel').split('as $$')[1].replace(/end \$\$;$/, 'end').trim() && (await prosrcOf('interview_reschedule')) === body461('interview_reschedule').split('as $$')[1].replace(/end \$\$;$/, 'end').trim())

const bad = res.filter((x) => !x[1])
res.forEach(([n, ok, note]) => console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  ' + note)))
console.log(`${res.length - bad.length}/${res.length} checks passed`)
process.exit(bad.length ? 1 : 0)
