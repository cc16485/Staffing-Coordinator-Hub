// 587 · The cancel screen and NO replies, in a REAL Postgres (PGlite), on top of the live rules incl. 586.
//   PGLITE=<path to @electric-sql/pglite> HUB=../cc-hub-live node screening_gate_586_test.mjs
// Loads the rules as they are live (noshow_policy.sql + interview-limits.sql + 461 + 512), then 586, then its rollback.
import fs from 'fs'; import path from 'path'
const PG = process.env.PGLITE; if (!PG) { console.log('SKIP: set PGLITE to run against a real Postgres'); process.exit(0) }
// PGLITE may name the package folder or its dist/index.js (the form most tests here use)
const { PGlite } = await import(PG.endsWith('.js') ? PG : path.join(PG, 'dist/index.js'))
const db = new PGlite()
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 600)])
const q = async (s, p) => (await db.query(s, p)).rows
const ex = async (s) => db.exec(s)
const err = async (s, p) => { try { await q(s, p); return null } catch (e) { return String(e.message) } }
const HUB = process.env.HUB || process.env.HUB_ROOT || '../cc-hub-live'
await ex(`create role anon; create role authenticated; create schema auth;
  create table auth_state(role text, email text); insert into auth_state values ('anon', null);
  create function auth.role() returns text language sql stable as $$ select role from public.auth_state limit 1 $$;
  create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email', email) from public.auth_state limit 1 $$;
  create table job_applicants (id uuid primary key default gen_random_uuid(), first_name text, last_name text, phone text, email text, status text default 'partial',
    duplicate_of uuid, screen_grade text, screen_flags text[], created_at timestamptz default now(), decline_reason text,
    completed_at timestamptz, age_ok boolean, work_auth boolean, has_transport boolean, position text, prn jsonb, gave_up_at timestamptz);
  create table job_positions (key text primary key, track text);
  insert into job_positions values ('caregiver', null), ('prn_cna', 'prn');
  create table interview_bookings (id uuid primary key default gen_random_uuid(), applicant_id uuid, coordinator_id uuid, starts_at timestamptz, ends_at timestamptz,
    status text default 'booked', cancelled_at timestamptz, cancelled_by text, cancel_reason text, cancel_notified_at timestamptz, rescheduled_from timestamptz,
    confirmed_at timestamptz, reminded_day_at timestamptz, reminded_hour_at timestamptz, created_at timestamptz default now());
  create table coordinator_busy (id serial, coordinator_id uuid, starts_at timestamptz, ends_at timestamptz, source text, source_id text, label text);
  create table activity_types (key text, minutes int, lead_hours int, per_slot int); insert into activity_types values ('interview', 30, 2, 1);
  create table do_not_rehire (id uuid primary key default gen_random_uuid(), name text, phone_digits text, email text, reason text, added_by text);
  create table coordinators (id uuid primary key default gen_random_uuid(), active boolean default true);
  create table coordinator_availability (coordinator_id uuid, active boolean default true, activity text, day_of_week int, start_time time, end_time time);
  insert into coordinators (id) values ('00000000-0000-4000-8000-0000000000a1');
  insert into coordinator_availability select '00000000-0000-4000-8000-0000000000a1', true, 'interview', d, '08:00', '17:00' from generate_series(0,6) d;`)
await ex(fs.readFileSync('noshow_policy.sql', 'utf8').replace(/^alter table .*$/gm, ''))
await ex(fs.readFileSync(path.join(HUB, 'interview-limits.sql'), 'utf8').replace(/create or replace function interview_mine[\s\S]*?end \$\$;/, ''))
await ex(fs.readFileSync('interview_person_461.sql', 'utf8').replace(/^notify .*$/m, ''))
await ex(fs.readFileSync('interview_first_choice_512.sql', 'utf8').replace(/^notify .*$/m, ''))
await ex(fs.readFileSync('screening_gate_586.sql', 'utf8').replace(/^notify .*$/m, ''))
await ex(fs.readFileSync('applicant_msgs_587.sql', 'utf8').replace(/^notify .*$/m, ''))
const day = (n, h) => `(date_trunc('day', now() at time zone 'America/Chicago') + interval '${n} days' + interval '${h} hours') at time zone 'America/Chicago'`
let ph = 300
const app = async () => (await q(`insert into job_applicants (first_name,last_name,phone,status,completed_at,age_ok,work_auth,has_transport,position)
  values ('Pat','Test',$1,'new',now(),true,true,true,'caregiver') returning id`, ['4175550' + (ph++)]))[0].id
const asRole = async (r) => ex(`update auth_state set role = '${r}'`)
let slot = 3
const book = async (a) => { await q(`select interview_book($1, ${day(slot++, 10)})`, [a]) }
const busy = async (a) => (await q(`select count(*)::int n from coordinator_busy where source = 'interview' and source_id = $1`, [String(a)]))[0].n
const bk = async (a) => (await q(`select * from interview_bookings where applicant_id = $1 order by created_at desc limit 1`, [a]))[0]

await asRole('anon')
const a1 = await app(); await book(a1)
const r1 = (await q(`select interview_cancel_with_reason($1, 'found_job', 'Starting at the hospital Monday') r`, [a1]))[0].r
const b1 = await bk(a1)
ck('cancel screen: cancels, keeps the reason and their note, frees the time', r1.cancelled === true && b1.status === 'cancelled' && b1.cancel_kind === 'found_job'
  && b1.cancel_reason === 'Found another job: Starting at the hospital Monday' && b1.cancelled_by === 'applicant' && (await busy(a1)) === 0, [r1, b1])
const a2 = await app(); await book(a2)
const r2 = (await q(`select interview_cancel_with_reason($1, null, null) r`, [a2]))[0].r
ck('cancel screen with no reason: still cancels (the reason is optional)', r2.cancelled === true && (await bk(a2)).cancel_kind === null)
const a3 = await app(); await book(a3)
ck('an unknown reason is refused (nothing cancelled)', /unknown reason/.test(await err(`select interview_cancel_with_reason($1, 'hacked', null)`, [a3]) || '') && (await bk(a3)).status === 'booked')
// within 2 hours, the cancel screen keeps the phone-only rule, a NO reply does not
await ex(`begin; set local cc.screening_correction = 'on'; update interview_bookings set starts_at = now() + interval '1 hour', ends_at = now() + interval '90 minutes' where applicant_id = '${a3}' and status = 'booked'; commit;`)
const r3 = (await q(`select interview_cancel_with_reason($1, 'schedule', null) r`, [a3]))[0].r
ck('cancel screen within 2 hours: same phone-only rule as before (not cancelled)', r3.cancelled === false && r3.reason === 'too_close' && (await bk(a3)).status === 'booked', r3)
await asRole('authenticated')
const b3 = await bk(a3)
const r4 = (await q(`select interview_cancel_by_reply($1, 'No sorry cant make it') r`, [b3.id]))[0].r
const b3n = await bk(a3)
ck('a NO reply: cancelled even close to the time, words kept, marked replied_no', r4.cancelled === true && b3n.status === 'cancelled' && b3n.cancel_kind === 'replied_no'
  && b3n.reply_kind === 'no' && b3n.reply_text === 'No sorry cant make it' && /^Replied NO to the reminder: No sorry/.test(b3n.cancel_reason) && b3n.cancelled_by === 'applicant', [r4, b3n])
ck('...its time is back on the calendar', (await busy(a3)) === 0)
ck('...and the cancellation notice is still to send (the message job sends it)', b3n.cancel_notified_at === null)
ck('a NO for an interview already cancelled: nothing happens', (await q(`select interview_cancel_by_reply($1, 'no') r`, [b3.id]))[0].r.cancelled === false)
const a5 = await app(); await book(a5); const b5 = await bk(a5)
await q(`select interview_record_reply($1, 'yes', 'Yes see you then')`, [b5.id])
const b5n = await bk(a5)
ck('a YES is kept on the booking and changes nothing else', b5n.status === 'booked' && b5n.reply_kind === 'yes' && b5n.reply_text === 'Yes see you then' && (await busy(a5)) === 1, b5n)
await ex(`set role anon`)
ck('the public cannot use the NO or YES functions', /permission/.test(await err(`select interview_cancel_by_reply($1, 'no')`, [b5.id]) || '') && /permission/.test(await err(`select interview_record_reply($1, 'yes', 'x')`, [b5.id]) || ''))
await ex(`reset role`)
const sql = fs.readFileSync('applicant_msgs_587.sql', 'utf8')
ck('587 is one transaction and drops nothing', /^begin;$/m.test(sql) && /^commit;$/m.test(sql) && !/\bdrop\b/i.test(sql.replace(/--.*$/gm, '')))
const exErr = async (t) => { try { await ex(t); return null } catch (e) { return String(e.message) } }
ck('installing 587 twice works', (await exErr(sql.replace(/^notify .*$/m, ''))) === null)
await ex(fs.readFileSync('applicant_msgs_587_rollback.sql', 'utf8').replace(/^notify .*$/m, ''))
ck('ROLLBACK removes the three functions', (await q(`select count(*)::int n from pg_proc where proname in ('interview_cancel_with_reason','interview_cancel_by_reply','interview_record_reply')`))[0].n === 0)
await asRole('anon'); const a6 = await app(); await book(a6)
ck('after ROLLBACK the plain cancel still works', (await q(`select interview_cancel($1, null, 'applicant') r`, [a6]))[0].r.cancelled === true)
const broken = sql.replace(/^notify .*$/m, '').replace(/^commit;$/m, 'select 1/0;\ncommit;')
ck('a failed install changes nothing', !!(await exErr(broken)) && (await ex('rollback').catch(() => {}), (await q(`select count(*)::int n from pg_proc where proname = 'interview_cancel_by_reply'`))[0].n === 0))

let pass = 0; for (const [nm, ok, note] of res) { console.log((ok ? 'PASS  ' : 'FAIL  ') + nm + (ok ? '' : '  ' + note)); if (ok) pass++ }
console.log(pass === res.length ? `ALL ${res.length} CHECKS PASS` : `${res.length - pass} OF ${res.length} FAILED`); process.exit(pass === res.length ? 0 : 1)
