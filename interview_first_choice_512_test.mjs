// 512 · Krystal first during her hours, run in a REAL Postgres (PGlite) with made-up people.
//   PGLITE=<path to @electric-sql/pglite> node interview_first_choice_512_test.mjs
// Loads the rules as they are live (noshow_policy.sql + interview-limits.sql + 461), then 512, then its rollback.
import fs from 'fs'; import path from 'path'
const PG = process.env.PGLITE; if (!PG) { console.log('SKIP: set PGLITE to run against a real Postgres'); process.exit(0) }
const { PGlite } = await import(path.join(PG, 'dist/index.js'))
const db = new PGlite()
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 600)])
const q = async (s, p) => (await db.query(s, p)).rows
const ex = async (s) => db.exec(s)
const HUB = process.env.HUB || '../cc-hub-live'
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
  insert into coordinators (id) values ('00000000-0000-4000-8000-0000000000a1'), ('00000000-0000-4000-8000-0000000000b2');
  insert into coordinator_availability select '00000000-0000-4000-8000-0000000000a1', true, 'interview', d, '08:30', '13:30' from generate_series(1,5) d;
  insert into coordinator_availability select '00000000-0000-4000-8000-0000000000b2', true, 'interview', d, '10:00', '16:30' from generate_series(1,5) d;`)
const ns = fs.readFileSync('noshow_policy.sql', 'utf8').replace(/^alter table .*$/gm, '')
await ex(ns)
await ex(fs.readFileSync(path.join(HUB, 'interview-limits.sql'), 'utf8').replace(/create or replace function interview_mine[\s\S]*?end \$\$;/, ''))
const day = (n, h) => `(date_trunc('day', now() at time zone 'America/Chicago') + interval '${n} days' + interval '${h} hours') at time zone 'America/Chicago'`
const app = async (first, phone, email, status = 'new', ago = 0) => (await q(`insert into job_applicants (first_name,last_name,phone,email,status,created_at) values ($1,'Test',$2,$3,$4, now() - ($5 || ' hours')::interval) returning id`, [first, phone, email, status, ago]))[0].id
const book = async (a, n, h) => (await q(`select interview_book($1, ${day(n, h)}) as id`, [a]))[0].id
const live = async (ids) => (await q(`select applicant_id, status, cancelled_by, cancel_reason, cancel_notified_at is not null as quiet from interview_bookings where applicant_id = any($1) order by created_at`, [ids]))
const asRole = async (r) => ex(`update auth_state set role = '${r}'`)


await ex(fs.readFileSync('interview_person_461.sql', 'utf8').replace(/^notify .*$/m, ''))
const K = '00000000-0000-4000-8000-0000000000a1', S = '00000000-0000-4000-8000-0000000000b2'
const who = async (id) => (await q(`select coordinator_id::text c from interview_bookings where id = $1`, [id]))[0].c
/* the next Monday at least 2 days away (Chicago), so every test time is a weekday in the future */
const dow = (await q(`select extract(dow from (now() at time zone 'America/Chicago'))::int d`))[0].d
let n = ((8 - dow) % 7) || 7; if (n < 2) n += 7
const at = (h) => day(n, h)
const bookAt = async (first, h) => { const a = await app(first, '41755' + String(Math.floor(Math.random() * 1e5)).padStart(5, '0'), null); return (await q(`select interview_book($1, ${at(h)}) as id`, [a]))[0].id }
// before 512 (as live after 461): fewer that day wins
await bookAt('k1', 8.5); await bookAt('k2', 9)                  // Krystal's only (Samantha starts at 10)
let id = await bookAt('x1', 11)
ck('BEFORE 512: at 11:00 the one with fewer that day takes it (Samantha, Krystal already has two)', (await who(id)) === S, await who(id))
// 512
await ex(fs.readFileSync('interview_first_choice_512.sql', 'utf8').replace(/^notify .*$/m, ''))
await q(`update coordinators set booking_order = 1 where id = $1`, [K]); await q(`update coordinators set booking_order = 2 where id = $1`, [S])
id = await bookAt('y1', 11.5)
ck('512: during her hours Krystal is first, even with more that day (11:30 goes to Krystal)', (await who(id)) === K, await who(id))
id = await bookAt('y2', 11.5)
ck('...when Krystal already has that time, it goes to Samantha', (await who(id)) === S, await who(id))
id = await bookAt('y3', 14)
ck('...after 1:30 it is Samantha (Krystal\'s hours are over)', (await who(id)) === S, await who(id))
id = await bookAt('y4', 10)
ck('...10:00, both free: Krystal', (await who(id)) === K, await who(id))
let err = ''; try { await bookAt('y5', 9) } catch (e) { err = e.message }
ck('...9:00 when Krystal already has it and Samantha does not start until 10: "that time was just taken"', /that time was just taken/.test(err), err)
const count = async (c) => (await q(`select count(*)::int n from interview_bookings where coordinator_id = $1 and status = 'booked'`, [c]))[0].n
await q(`update coordinators set booking_order = null`)
await bookAt('z0', 9.5)                                           // Krystal only (Samantha starts at 10): Krystal now clearly has more
ck('(set-up: Krystal has more that day than Samantha)', (await count(K)) > (await count(S)) + 0, [await count(K), await count(S)])
id = await bookAt('z1', 12.5)
ck('no order set for anyone: as before (fewer that day: Samantha)', (await who(id)) === S, await who(id))
// rollback
await q(`update coordinators set booking_order = 1 where id = $1`, [K]); await q(`update coordinators set booking_order = 2 where id = $1`, [S])
await ex(fs.readFileSync('interview_first_choice_512_rollback.sql', 'utf8').replace(/^notify .*$/m, ''))
ck('(set-up: Krystal still has more that day)', (await count(K)) > (await count(S)), [await count(K), await count(S)])
id = await bookAt('r1', 13)
ck('ROLLBACK puts the 461 rule back exactly (fewer that day again: Samantha)', (await who(id)) === S, await who(id))
const sql = fs.readFileSync('interview_first_choice_512.sql', 'utf8')
ck('512 is one transaction and drops nothing', /^begin;/m.test(sql) && /^commit;/m.test(sql) && !/drop (table|function|column)|truncate/i.test(sql))
let pass = 0; for (const [nm, ok, note] of res) { console.log((ok ? 'PASS  ' : 'FAIL  ') + nm + (ok ? '' : '  ' + note)); if (ok) pass++ }
console.log(pass === res.length ? `ALL ${res.length} CHECKS PASS` : `${res.length - pass} OF ${res.length} FAILED`); process.exit(pass === res.length ? 0 : 1)
