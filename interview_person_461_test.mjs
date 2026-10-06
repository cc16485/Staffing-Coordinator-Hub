// 461 · one person, one interview + "reapply with us reviewing first", run in a REAL Postgres (PGlite) with made-up people.
//   PGLITE=<path to @electric-sql/pglite> node interview_person_461_test.mjs
// Loads the rules as they are today (noshow_policy.sql + interview-limits.sql), then 461, then the rollback, and checks each.
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

// ── before 461: what happened to Shakira ──
let s1 = await app('Shak', '(417) 555-4959', 'shak@example.com', 'new', 2), s2 = await app('Shak', '417.555.4959', 'other@example.com', 'new', 1)
await book(s1, 3, 14); await book(s2, 3, 15)
await asRole('anon'); await q(`select interview_cancel($1)`, [s1])
let L = await live([s1, s2])
ck('TODAY (before 461): two applications, two bookings; cancelling one leaves the other booked (her Monday 3:00)', L.filter((x) => x.status === 'booked').length === 1 && L.find((x) => x.applicant_id === s2).status === 'booked', L)

ck('TODAY (before 461): a cancelled booking keeps its calendar hold, so that time stays blocked for everyone', (await q(`select count(*)::int as n from coordinator_busy where source_id = $1`, [s1]))[0].n === 1)
// ── install 461 ──
await ex(fs.readFileSync('interview_person_461.sql', 'utf8').replace(/^notify .*$/m, ''))
ck('461 releases the leftover hold of the earlier cancellation (that time is free again); her live booking keeps its hold', (await q(`select count(*)::int as n from coordinator_busy where source_id = $1`, [s1]))[0].n === 0 && (await q(`select count(*)::int as n from coordinator_busy where source_id = $1`, [s2]))[0].n === 1)
let p1 = await app('Pat', '4175550101', 'pat@example.com', 'new', 3), p2 = await app('Pat', '+1 (417) 555-0101', null, 'new', 2), other = await app('Ola', '4175559999', 'ola@example.com')
await book(p1, 8, 14); await book(other, 8, 16)
await book(p2, 9, 10)
L = await live([p1, p2])
ck('461: booking under her second application quietly lets go of the first booking (one person, one interview; marked told, so no message)', L.filter((x) => x.status === 'booked').length === 1 && L.find((x) => x.applicant_id === p1).status === 'cancelled' && L.find((x) => x.applicant_id === p1).quiet && L.find((x) => x.applicant_id === p1).cancel_reason === 'booked again under another application', L)
ck('...a different person is not touched', (await live([other]))[0].status === 'booked')
ck('...only her new booking holds a calendar slot', (await q(`select count(*)::int as n from coordinator_busy where source = 'interview' and source_id = any($1)`, [[p1, p2]]))[0].n === 1)
let mine = (await q(`select interview_mine($1) as m`, [p1]))[0].m
ck('461: her FIRST application link shows the real booking (held under the second)', mine && mine.status === 'booked' && new Date(mine.starts_at).getTime() === (await q(`select starts_at from interview_bookings where applicant_id = $1 and status = 'booked'`, [p2]))[0].starts_at.getTime(), mine)
await asRole('anon'); let c = (await q(`select interview_cancel($1) as c`, [p1]))[0].c
ck('461: cancelling from her first link cancels the booking under her second (nothing left showing) and frees the time', c.cancelled === true && (await live([p1, p2])).every((x) => x.status !== 'booked') && (await q(`select count(*)::int as n from coordinator_busy where source_id = any($1)`, [[p1, p2]]))[0].n === 0, [c, await live([p1, p2])])
await book(p1, 10, 10); await asRole('anon'); await q(`select interview_cancel($1)`, [p2])
c = (await q(`select interview_cancel($1) as c`, [p1]))[0].c
ck('461: the two-changes limit counts the person, not the application (no dodging by applying twice)', c.cancelled === false && c.reason === 'limit', c)

// ── reapply with us reviewing first ──
let d1 = await app('Dee', '4175550202', 'dee@example.com', 'declined', 5), d2 = await app('Dee', '4175550202', 'dee@example.com', 'new', 1)
ck('declined before, applied again: needs review', (await q(`select applicant_needs_review($1) as r`, [d2]))[0].r === true)
mine = (await q(`select interview_mine($1) as m`, [d2]))[0].m
ck('...her link says "review" (the page tells her the office will be in touch)', mine && mine.status === 'review', mine)
let err = ''; try { await book(d2, 11, 11) } catch (e) { err = e.message }
ck('...she cannot book (REVIEW_FIRST, which the page explains), and nothing is booked', /^REVIEW_FIRST/.test(err) && (await live([d2])).length === 0, err)
await q(`update job_applicants set review_cleared_at = now(), review_cleared_by = 'office' where id = $1`, [d2])
await book(d2, 11, 11)
ck('...once the office approves, she can book', (await live([d2]))[0]?.status === 'booked')
let e1 = await app('Eve', '4175550303', null, 'new', 5), e2 = await app('Eve', '4175550303', null, 'declined', 1)
ck('declining a LATER duplicate does not block her earlier, open application', (await q(`select applicant_needs_review($1) as r`, [e1]))[0].r === false)
ck('...and the reason the Hub shows is "declined before"', (await q(`select applicant_review_reason($1) as r`, [d1 === d2 ? d1 : (await app('Dee', '4175550202', 'dee@example.com', 'new', 0))]))[0].r === 'declined')
// ── on the do-not-rehire list (Amanda Peak, 2026-10-05: told by phone she could not be rehired, applied several times) ──
let g1 = await app('Gia', '4175550606', 'gia@example.com', 'new', 1)
await q(`insert into do_not_rehire (name, phone_digits, reason) values ('Gia Test', '(417) 555-0606', 'told by phone')`)
ck('on the do-not-rehire list (matched by phone): reason "dnr", even on her FIRST application', (await q(`select applicant_review_reason($1) as r`, [g1]))[0].r === 'dnr')
mine = (await q(`select interview_mine($1) as m`, [g1]))[0].m
ck('...her link says "review", never a list of times', mine && mine.status === 'review', mine)
err = ''; try { await book(g1, 14, 9) } catch (e) { err = e.message }
ck('...she cannot book, and nothing is booked', /^REVIEW_FIRST/.test(err) && (await live([g1])).length === 0, err)
await q(`update job_applicants set review_cleared_at = now(), review_cleared_by = 'office' where id = $1`, [g1])
ck('..."Approve, let them book" does not override the list (the office takes them off the list instead)', (await q(`select applicant_needs_review($1) as r`, [g1]))[0].r === true)
let h1 = await app('Hal', '4175550707', 'Hal@Example.com', 'new', 1)
await q(`insert into do_not_rehire (name, email) values ('Hal Test', 'hal@example.com ')`)
ck('matched by email too (any capitals or spaces)', (await q(`select applicant_review_reason($1) as r`, [h1]))[0].r === 'dnr')
await q(`delete from do_not_rehire where name = 'Gia Test'`)
await book(g1, 14, 9)
ck('taken off the list: she can book again', (await live([g1]))[0]?.status === 'booked')
let f1 = await app('Fay', '4175550404', null, 'new')
ck('someone new is never held for review', (await q(`select applicant_needs_review($1) as r`, [f1]))[0].r === false)
await asRole('authenticated'); await book(f1, 12, 9); c = (await q(`select interview_cancel($1, 'office tidy', 'office') as c`, [f1]))[0].c
ck('the office can still cancel any time', c.cancelled === true && (await live([f1]))[0].cancelled_by === 'office')

// ── rollback ──
await ex(fs.readFileSync('interview_person_461_rollback.sql', 'utf8').replace(/^notify .*$/m, ''))
let r1 = await app('Rob', '4175550505', null, 'new', 2), r2 = await app('Rob', '4175550505', null, 'new', 1)
await book(r1, 13, 9); await book(r2, 13, 10)
ck('ROLLBACK puts back the old rules exactly (two applications, two bookings again)', (await live([r1, r2])).filter((x) => x.status === 'booked').length === 2)
const sql = fs.readFileSync('interview_person_461.sql', 'utf8')
ck('461 is one transaction; it drops nothing; the person helpers are not open to the public', /^begin;/m.test(sql) && /^commit;/m.test(sql) && !/drop (table|function)|truncate|delete from public\.job_applicants/i.test(sql) && /revoke all on function public\.applicant_person_ids\(uuid\) from public, anon, authenticated;/.test(sql))
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note)); if (ok) pass++ }
console.log(pass === res.length ? `ALL ${res.length} CHECKS PASS` : `${res.length - pass} OF ${res.length} FAILED`); process.exit(pass === res.length ? 0 : 1)
