// 586 · Screening before booking, run in a REAL Postgres (PGlite) with made-up people.
//   PGLITE=<path to @electric-sql/pglite> HUB=../cc-hub-live node screening_gate_586_test.mjs
// Loads the rules as they are live (noshow_policy.sql + interview-limits.sql + 461 + 512), then 586, then its rollback.
import fs from 'fs'; import path from 'path'
const PG = process.env.PGLITE; if (!PG) { console.log('SKIP: set PGLITE to run against a real Postgres'); process.exit(0) }
/* PGLITE may name the package folder or its dist/index.js (the form the other PGlite tests use) */
const { PGlite } = await import(/\.m?js$/.test(PG) ? PG : path.join(PG, 'dist/index.js'))
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
const book512 = (await q(`select pg_get_functiondef('public.interview_book(uuid,timestamptz)'::regprocedure) d`))[0].d
const mine461 = (await q(`select pg_get_functiondef('public.interview_mine(uuid)'::regprocedure) d`))[0].d

const day = (n, h) => `(date_trunc('day', now() at time zone 'America/Chicago') + interval '${n} days' + interval '${h} hours') at time zone 'America/Chicago'`
let ph = 100
const app = async (o = {}) => (await q(`insert into job_applicants (first_name,last_name,phone,status,completed_at,age_ok,work_auth,has_transport,position,prn,decline_reason)
  values ($1,'Test',$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
  [o.first || 'Pat', '4175550' + (ph++), o.status || 'partial', o.done ? new Date().toISOString() : null,
   o.ans === undefined ? true : o.ans, o.ans === undefined ? true : o.ans, o.transport === undefined ? (o.ans === undefined ? true : o.ans) : o.transport,
   o.position || 'caregiver', o.prn ? JSON.stringify(o.prn) : null, o.decline || null]))[0].id
const asRole = async (r, email = null) => ex(`update auth_state set role = '${r}', email = ${email ? `'${email}'` : 'null'}`)
let slot = 3
const tryBook = async (a) => err(`select interview_book($1, ${day(slot++, 10)})`, [a])
const mine = async (a) => (await q(`select interview_mine($1) m`, [a]))[0].m

// ---- before 586: the gap is real
const before = await app({ ans: null })
ck('(set-up) BEFORE 586 a step-1-only application CAN book: the gap is real', (await tryBook(before)) === null)
const preBooking = (await q(`select id, starts_at from interview_bookings where applicant_id = $1 and status = 'booked'`, [before]))[0]

await ex(fs.readFileSync('screening_gate_586.sql', 'utf8').replace(/^notify .*$/m, ''))

// ---- interviews already booked stay as they are
const pre = (await q(`select status, screen_grandfathered g, starts_at from interview_bookings where id = $1`, [preBooking.id]))[0]
ck('an interview booked before 586 is untouched (still booked, same time) and marked as existing', pre.status === 'booked' && pre.g === true && +pre.starts_at === +preBooking.starts_at, pre)
await asRole('anon')
const mvPre = await err(`select interview_reschedule($1, ${day(slot++, 9)}, 'applicant')`, [before])
const preNow = await q(`select status, screen_grandfathered g, booked_by from interview_bookings where applicant_id = $1 order by created_at`, [before])
ck('...they can still move it online like before, and the new time keeps the mark', mvPre === null && preNow.filter((x) => x.status === 'booked').length === 1 && preNow.find((x) => x.status === 'booked').g === true, { mvPre, preNow })
ck('...but they cannot add a second booking on top (still one live booking)', (await q(`select count(*)::int n from interview_bookings where applicant_id = $1 and status = 'booked'`, [before]))[0].n === 1)

// ---- the public (their link / the form)
await asRole('anon')
const step1 = await app({ ans: null })
ck('step 1 only (no screening answers): booking refused with SCREEN_FIRST: questions', /SCREEN_FIRST: questions/.test(await tryBook(step1) || ''))
const m1 = await mine(step1)
ck('their link says screen_first, questions, and that they can still finish online', m1 && m1.status === 'screen_first' && m1.gap === 'questions' && m1.can_finish === true && m1.position === 'caregiver', m1)
const step2 = await app({})
ck('answered step 2 but not finished: refused with SCREEN_FIRST: unfinished', /SCREEN_FIRST: unfinished/.test(await tryBook(step2) || ''))
const done = await app({ done: true, status: 'new' })
ck('finished, all three yes: books', (await tryBook(done)) === null)
ck('their link then shows the booking (not screen_first)', (await mine(done))?.status === 'booked')
const noT = await app({ done: true, status: 'new', transport: false })
ck('a no to transportation (even with no decline written): refused as ineligible', /SCREEN_FIRST: ineligible/.test(await tryBook(noT) || ''))
const decl = await app({ done: true, status: 'new', decline: 'under 18' })
ck('a declined reason: refused as ineligible', /SCREEN_FIRST: ineligible/.test(await tryBook(decl) || ''))
const prnNo = await app({ done: true, status: 'new', position: 'prn_cna' })
ck('PRN role without the two CNA answers: refused (questions)', /SCREEN_FIRST: questions/.test(await tryBook(prnNo) || ''))
const prnYes = await app({ done: true, status: 'new', position: 'prn_cna', prn: { cna: true, one_year: false } })
ck('PRN role, CNA yes and one-year answered (a no is fine): books', (await tryBook(prnYes)) === null)
const prnNotCna = await app({ done: true, status: 'new', position: 'prn_cna', prn: { cna: false, one_year: true } })
ck('PRN role, not a CNA: refused as ineligible', /SCREEN_FIRST: ineligible/.test(await tryBook(prnNotCna) || ''))

// a move goes through interview_book too, and a refused move keeps the old booking
await ex(`begin; set local cc.screening_correction = 'on'; update job_applicants set has_transport = null where id = '${done}'; commit;`)   // fixture only
const mv = await err(`select interview_reschedule($1, ${day(slot++, 11)}, 'applicant')`, [done])
const still = await q(`select status from interview_bookings where applicant_id = $1 order by created_at`, [done])
ck('a move by someone whose answers are missing is refused, and their booking stays', /SCREEN_FIRST/.test(mv || '') && still.length === 1 && still[0].status === 'booked', { mv, still })
await ex(`begin; set local cc.screening_correction = 'on'; update job_applicants set has_transport = true where id = '${done}'; commit;`)   // fixture only

// the public cannot use the office's door or read the helpers
ck('the public cannot record answers as the office', /sign in first|permission/.test(await err(`select applicant_screen_by_office($1, true, true, true)`, [step1]) || ''))
await ex(`set role anon`)
ck('anon has no execute on the gap or the follow-up rule', /permission/.test(await err(`select public.applicant_screening_gap($1)`, [step1]) || '')
  && /permission/.test(await err(`select public.applicant_followup_stop($1)`, [step1]) || ''))
await ex(`reset role`)

// ---- the office
await asRole('authenticated', 'krystal@mo-care.com')
const hand = (await q(`insert into job_applicants (first_name,phone,status,completed_at,position) values ('Hand','4175559999','reviewing',now(),'caregiver') returning id`))[0].id
ck('hand-entered (never saw the form): the office cannot book until the answers are in', /SCREEN_FIRST: questions/.test(await tryBook(hand) || ''))
const g1 = (await q(`select applicant_screen_by_office($1, true, true, true) g`, [hand]))[0].g
const rec = (await q(`select screened_by, screened_at is not null t, status from job_applicants where id = $1`, [hand]))[0]
ck('office records the phone answers: nothing missing, who and when kept', g1 === null && rec.screened_by === 'krystal@mo-care.com' && rec.t, { g1, rec })
ck('then the office can book them', (await tryBook(hand)) === null)
const g2 = (await q(`select applicant_screen_by_office($1, true, true, true) g`, [step1]))[0].g
const r2 = (await q(`select status, completed_at is not null c from job_applicants where id = $1`, [step1]))[0]
ck('office finishing a step-1 application by phone: finished, moved to reviewing, bookable', g2 === null && r2.status === 'reviewing' && r2.c, { g2, r2 })
const g3 = (await q(`select applicant_screen_by_office($1, true, true, true) g`, [decl]))[0].g
ck('office answers cannot clear a decline', g3 === 'ineligible')
const phoneNo = await app({ ans: null })
const g4 = (await q(`select applicant_screen_by_office($1, false, true, true) g`, [phoneNo]))[0].g
ck('an office no stays a no (ineligible, not bookable)', g4 === 'ineligible' && /ineligible/.test(await tryBook(phoneNo) || ''))
ck('all three answers are needed from the office', /all three/.test(await err(`select applicant_screen_by_office($1, true, null, true)`, [prnNo]) || ''))
const gP = (await q(`select applicant_screen_by_office($1, true, true, true, true, true) g`, [prnNo]))[0].g
ck('office PRN answers (CNA yes) fill the PRN questions', gP === null)

// ---- audit: who booked
ck('booked_by: the form/link records "applicant"', (await q(`select booked_by from interview_bookings where applicant_id = $1 and status = 'booked'`, [done]))[0].booked_by === 'applicant')
ck('booked_by: an office booking records the office user', (await q(`select booked_by from interview_bookings where applicant_id = $1 and status = 'booked'`, [hand]))[0].booked_by === 'krystal@mo-care.com')

// ---- answers already given cannot be overwritten
const locked = await app({ done: true, status: 'new' })
ck('office cannot change an answer the applicant gave (function refuses and names it)', /SCREENING_LOCKED/.test(await err(`select applicant_screen_by_office($1, false, true, true)`, [locked]) || ''))
ck('the same answers again is fine (nothing changes)', (await q(`select applicant_screen_by_office($1, true, true, true) g`, [locked]))[0].g === null)
ck('a direct edit by a signed-in user is refused too (any Hub screen)', /SCREENING_LOCKED/.test(await err(`update job_applicants set has_transport = false where id = $1`, [locked]) || ''))
// the office's own decisions keep working: "Not moving forward" with a reason, and reactivating (clears the reason)
const offDec = await app({ done: true, status: 'new' })
ck('office "Not moving forward" still saves its reason', (await err(`update job_applicants set status = 'declined', decline_reason = 'not a fit after interview' where id = $1`, [offDec])) === null)
ck('...and reactivating still clears it', (await err(`update job_applicants set status = 'new', decline_reason = null where id = $1`, [offDec])) === null)
const koNo = await app({ done: true, status: 'declined', transport: false, decline: 'no reliable transportation' })
await q(`update job_applicants set status = 'new', decline_reason = null where id = $1`, [koNo])
ck('reactivating someone who said no to transportation still cannot book them (the no is locked)', /SCREEN_FIRST: ineligible/.test(await tryBook(koNo) || ''))
await asRole('anon')
const filling = await app({})   // partial, answered yes
ck('the applicant still filling in the form may change a yes before finishing', (await err(`update job_applicants set has_transport = false where id = $1`, [filling])) === null)
ck('...but a no is final, even for them', /SCREENING_LOCKED/.test(await err(`update job_applicants set has_transport = true where id = $1`, [filling]) || ''))
ck('...and an old link still cannot book them (ineligible)', /SCREEN_FIRST: ineligible/.test(await tryBook(filling) || ''))
await asRole('authenticated', 'krystal@mo-care.com')
ck('the office cannot fill around a no either', /SCREENING_LOCKED/.test(await err(`select applicant_screen_by_office($1, true, true, true)`, [filling]) || ''))
await ex(`begin; set local cc.screening_correction = 'on'; update job_applicants set has_transport = true where id = '${filling}'; commit;`)
ck('a deliberate correction from the SQL editor is still possible (and only that way)', (await q(`select has_transport t from job_applicants where id = $1`, [filling]))[0].t === true)
await ex(`update job_applicants set has_transport = false where id = '${filling}'`).catch(() => {})

// ---- no booking route around the rule
ck('a direct insert of a booking is refused (only interview_book can book)', /SCREEN_FIRST/.test(await err(`insert into interview_bookings (applicant_id, starts_at, ends_at) values ($1, now() + interval '3 days', now() + interval '3 days 30 minutes')`, [step2]) || ''))
const cxApp = await app({ done: true, status: 'new' }); await tryBook(cxApp)
await q(`select interview_cancel($1, 'test', 'office')`, [cxApp])
const cxRow = (await q(`select id from interview_bookings where applicant_id = $1 and status = 'cancelled' limit 1`, [cxApp]))[0]
ck('turning a cancelled booking back into a booked one directly is refused', /SCREEN_FIRST/.test(await err(`update interview_bookings set status = 'booked' where id = $1`, [cxRow.id]) || ''))
ck('nobody can set the "booked before 586" mark', /SCREENING_LOCKED/.test(await err(`update interview_bookings set screen_grandfathered = true where id = $1`, [cxRow.id]) || ''))
ck('stamping a booking (the reminders) still works', (await err(`update interview_bookings set reminded_day_at = now() where applicant_id = $1 and status = 'booked'`, [done])) === null)

// ---- follow-ups stop
const stop = async (a) => (await q(`select applicant_followup_stop($1) s`, [a]))[0].s
const open1 = await app({ done: true, status: 'new' })
ck('finished, not booked: follow-ups may go', (await stop(open1)) === null)
const unfinished = await app({ ans: null })
ck('unfinished, not booked: follow-ups may go (they are invited to finish)', (await stop(unfinished)) === null)
ck('booked: stop', (await stop(done)) === 'booked')
ck('declined: stop', (await stop(decl)) === 'ineligible')
ck('a no to transportation: stop', (await stop(noT)) === 'ineligible')
await asRole('anon')
await q(`select interview_cancel($1, 'changed my mind', 'office')`, [prnYes])
ck('they cancelled their own interview (withdrew): stop', /withdrew/.test(await stop(prnYes) || ''))
await asRole('authenticated')
const oc = await app({ done: true, status: 'new' }); await tryBook(oc)
await q(`select interview_cancel($1, 'we need to', 'office')`, [oc])
ck('the office cancelled: stop', /office cancelled/.test(await stop(oc) || ''))
await ex(`update job_applicants set status = 'pool' where id = '${open1}'`)
ck('moved out of the open statuses (pool, declined, hired, no-show): stop', (await stop(open1)) === 'closed')
const twin = (await q(`insert into job_applicants (first_name,phone,status,completed_at,age_ok,work_auth,has_transport,position)
  select 'Twin', phone, 'new', now(), true, true, true, 'caregiver' from job_applicants where id = $1 returning id`, [hand]))[0].id
ck('same person booked under another application: stop', (await stop(twin)) === 'booked')

// ---- rollback, and the shape of the file
await ex(fs.readFileSync('screening_gate_586_rollback.sql', 'utf8').replace(/^notify .*$/m, ''))
const b2 = (await q(`select pg_get_functiondef('public.interview_book(uuid,timestamptz)'::regprocedure) d`))[0].d
const m2 = (await q(`select pg_get_functiondef('public.interview_mine(uuid)'::regprocedure) d`))[0].d
ck('ROLLBACK puts interview_book back exactly as 512 had it', b2 === book512)
ck('ROLLBACK puts interview_mine back exactly as 461 had it', m2 === mine461)
ck('ROLLBACK removes the 586 functions and both guards', (await q(`select count(*)::int n from pg_proc where proname in ('applicant_screening_gap','applicant_screen_by_office','applicant_followup_stop','applicant_grandfathered_move','job_applicants_screen_guard','interview_bookings_screen_guard')`))[0].n === 0
  && (await q(`select count(*)::int n from pg_trigger where tgname like '%screen_guard'`))[0].n === 0)
ck('after ROLLBACK, booking works as before 586 (the existing booking route is intact)', (await tryBook(await app({ done: true, status: 'new' }))) === null)
const sql = fs.readFileSync('screening_gate_586.sql', 'utf8')
const drops = sql.replace(/--.*$/gm, '').match(/^.*\bdrop\b.*$/gim) || []
ck('586 is one transaction and drops nothing but its own two triggers (so running it twice is safe)', /^begin;$/m.test(sql) && /^commit;$/m.test(sql)
  && drops.length === 2 && drops.every((l) => /drop trigger if exists (job_applicants|interview_bookings)_screen_guard/.test(l)), drops)
const S586 = fs.readFileSync('screening_gate_586.sql', 'utf8').replace(/^notify .*$/m, '')
await ex(S586); const exErr = async (t) => { try { await ex(t); return null } catch (e) { return String(e.message) } }
const reErr = await exErr(S586); ck('installing 586 a second time on top of itself works', reErr === null, reErr)
await ex(fs.readFileSync('screening_gate_586_rollback.sql', 'utf8').replace(/^notify .*$/m, ''))
// a deployment that fails part way changes nothing: the whole file is one transaction
const broken = S586.replace(/^commit;$/m, 'select 1/0;\ncommit;')
const bErr = await exErr(broken); await ex('rollback').catch(() => {})
const b3 = (await q(`select pg_get_functiondef('public.interview_book(uuid,timestamptz)'::regprocedure) d`))[0].d
ck('a failed deployment leaves everything exactly as it was (no half install)', !!bErr && b3 === book512
  && (await q(`select count(*)::int n from pg_proc where proname = 'applicant_screening_gap'`))[0].n === 0, bErr)

let pass = 0; for (const [nm, ok, note] of res) { console.log((ok ? 'PASS  ' : 'FAIL  ') + nm + (ok ? '' : '  ' + note)); if (ok) pass++ }
console.log(pass === res.length ? `ALL ${res.length} CHECKS PASS` : `${res.length - pass} OF ${res.length} FAILED`); process.exit(pass === res.length ? 0 : 1)
