// 731 · A year of paid experience, run in a REAL Postgres (PGlite) with made-up people.
//   PGLITE=<path to @electric-sql/pglite> HUB_ROOT=<care-coordinator-hub checkout> node one_year_731_test.mjs
// Loads the rules as they are live (noshow_policy + interview-limits + 461 + 512 + 586), then 731, then its rollback.
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
    completed_at timestamptz, age_ok boolean, work_auth boolean, has_transport boolean, position text, prn jsonb, gave_up_at timestamptz,
    posting_slug text, posting_title text, source text, channel text, zip text, city text, job_type text, hours_wanted text, will_build_up boolean,
    experience_kinds text[], sms_consent boolean, role_answers jsonb, has_license boolean, has_insurance boolean, can_pass_background boolean,
    lived_outside_mo boolean, states_lived text, experience_years text, experience text, availability text, referral_source text, work_history jsonb);
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
// 647 (2026-10-13) made the office screen office staff only, editing that one line in place. Here an office member is any
// sign-in (the live test is the staff roles).
await ex(`create function public.hub_office_ok() returns boolean language sql stable as $$ select coalesce(auth.role(),'anon') = 'authenticated' $$`)
{ const d = (await q(`select pg_get_functiondef('public.applicant_screen_by_office(uuid,boolean,boolean,boolean,boolean,boolean)'::regprocedure) d`))[0].d
  await ex(d.replace("if coalesce(auth.role(),'anon') <> 'authenticated' then raise exception 'sign in first'; end if;",
    "if not public.hub_office_ok() then raise exception 'office staff only'; end if;")) }
const day = (n, h) => `(date_trunc('day', now() at time zone 'America/Chicago') + interval '${n} days' + interval '${h} hours') at time zone 'America/Chicago'`
const asRole = async (r, email = null) => ex(`update auth_state set role = '${r}', email = ${email ? `'${email}'` : 'null'}`)
let slot = 3
const tryBook = async (a) => err(`select interview_book($1, ${day(slot++, 10)})`, [a])
const gap = async (a) => (await q(`select applicant_screening_gap($1) g`, [a]))[0].g
const stop = async (a) => (await q(`select applicant_followup_stop($1) s`, [a]))[0].s
const row = async (a) => (await q(`select * from job_applicants where id = $1`, [a]))[0]
let ph = 300
// The form, as an anonymous visitor: step 1 creates the row, step 2 answers, step 3 finishes.
const form = async (oneYear, opts = {}) => {
  await asRole('anon')
  const id = (await q(`select apply_save(null, $1::jsonb, false) id`, [JSON.stringify({ first_name: 'Pat', last_name: 'Test', phone: '4175551' + (ph++), position: opts.position || 'caregiver' })]))[0].id
  const p2 = { age_ok: true, work_auth: true, has_transport: true, position: opts.position || 'caregiver' }
  if (oneYear !== undefined) p2.one_year = oneYear
  if (opts.decline) p2.decline_reason = opts.decline
  await q(`select apply_save($1, $2::jsonb, false)`, [id, JSON.stringify(p2)])
  if (!opts.decline && !opts.stopAt2) await q(`select apply_save($1, $2::jsonb, true)`, [id, JSON.stringify({ availability: 'weekdays' })])
  return id
}

// ---- before 731: someone with no experience question is bookable (today's behaviour)
const old = await form(undefined)
ck('(set-up) before 731, a finished form with no experience answer has no gap', (await gap(old)) === null)

await ex(fs.readFileSync('one_year_731.sql', 'utf8'))

// ---- the form
const yes = await form('yes')
ck('a year or more: no gap, they can book', (await gap(yes)) === null && (await tryBook(yes)) === null)
const no = await form('no', { decline: 'under one year of paid experience' })
const rNo = await row(no)
ck('under a year: the form declines it, saved as no, status declined', rNo.one_year === 'no' && rNo.status === 'declined' && rNo.decline_reason === 'under one year of paid experience', rNo)
ck('...the screening rule calls it ineligible and booking is refused', (await gap(no)) === 'ineligible' && /application not open|SCREEN_FIRST/.test(await tryBook(no) || ''))
const fam = await form('family')
ck('unpaid family caregiving: finished, but the gap is questions (waits for the office)', (await gap(fam)) === 'questions' && (await row(fam)).status === 'new')
ck('...booking from their link is refused', /SCREEN_FIRST/.test(await tryBook(fam) || ''))
ck('...and the "pick a time" follow-ups stop while it waits', /verify family caregiving/.test(await stop(fam) || ''))
const junk = await form('maybe')
ck('a made-up answer is ignored (only yes, family, no are stored)', (await row(junk)).one_year === null)
ck('...and that application still needs the question (gap questions)', (await gap(junk)) === 'questions')
ck('(old applications) one finished before 731 now needs the question before an interview', (await gap(old)) === 'questions')

// ---- the applicant can change their mind while still filling in the form, unless it was a no
await asRole('anon')
const mid = await form('family', { stopAt2: true })
ck('still filling in: family can be changed to yes', (await err(`select apply_save($1, '{"one_year":"yes"}'::jsonb, false)`, [mid])) === null && (await row(mid)).one_year === 'yes')
const midNo = await form('no', { stopAt2: true })
ck('still filling in: a no cannot be changed to yes', /SCREENING_LOCKED/.test(await err(`select apply_save($1, '{"one_year":"yes"}'::jsonb, false)`, [midNo]) || '') && (await row(midNo)).one_year === 'no')

// ---- the office
await asRole('authenticated', 'office@example.com')
const office = (id, oy, who = null) => err(`select applicant_screen_by_office($1, true, true, true, null, null, $2, $3)`, [id, oy, who])
ck('office verifying family care must say who confirmed it', /who confirmed/.test(await office(fam, 'family_ok') || ''))
ck('office verifies: family becomes family_ok with the confirmer, and the gap clears', (await office(fam, 'family_ok', 'Hospice nurse, Jane Doe')) === null
  && (await row(fam)).one_year === 'family_ok' && (await row(fam)).one_year_confirmer === 'Hospice nurse, Jane Doe' && (await gap(fam)) === null, await row(fam))
ck('...then they can be booked', (await tryBook(fam)) === null)
const fam2 = await form('family')
await asRole('authenticated', 'office@example.com')
ck('office cannot verify it: family becomes no and the application is ineligible', (await office(fam2, 'no')) === null && (await gap(fam2)) === 'ineligible')
ck('the office cannot change a yes to a no', /SCREENING_LOCKED/.test(await office(yes, 'no') || ''))
ck('the office cannot turn a no into family_ok', /SCREENING_LOCKED/.test(await office(no, 'family_ok', 'someone') || '') || /not open/.test(await office(no, 'family_ok', 'someone') || ''))
ck('the office cannot set family itself (only yes, family_ok, no)', /must be yes, family_ok or no/.test(await office(old, 'family') || ''))
ck('office answers an old application on the phone: yes clears the gap', (await office(old, 'yes')) === null && (await gap(old)) === null)
ck('office calls with the old six answers still work (no experience answer: still waiting)', (await err(`select applicant_screen_by_office($1, true, true, true)`, [junk])) === null && (await gap(junk)) === 'questions')
ck('a direct table write cannot change a given answer', /SCREENING_LOCKED/.test(await err(`update job_applicants set one_year = 'yes' where id = $1`, [no]) || ''))
await asRole('anon')
ck('the public cannot use the office door', /office staff only|permission denied/.test(await office(junk, 'yes') || ''))
await asRole('authenticated', 'office@example.com')
ck('the check constraint refuses anything else', /one_year_chk/.test(await err(`update job_applicants set one_year = 'maybe' where id = $1`, [junk]) || ''))

// ---- the rollback
await ex(fs.readFileSync('one_year_731_rollback.sql', 'utf8'))
const afterRb = await form(undefined)
ck('after the rollback a finished form with no experience answer can book again (586 behaviour)', (await gap(afterRb)) === null)
await asRole('authenticated', 'office@example.com')
ck('...the office call with six answers works again', (await err(`select applicant_screen_by_office($1, true, true, true)`, [afterRb])) === null)
ck('...it is office staff only again (as 647 left it)', /hub_office_ok/.test((await q(`select pg_get_functiondef('public.applicant_screen_by_office(uuid,boolean,boolean,boolean,boolean,boolean)'::regprocedure) d`))[0].d))
ck('...and the eight-answer office function is gone', (await q(`select count(*)::int n from pg_proc where proname = 'applicant_screen_by_office'`))[0].n === 1)

const ok = res.filter((r) => r[1]).length
for (const [n, c, note] of res) console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  ' + note))
console.log(`${ok}/${res.length}`); process.exit(ok === res.length ? 0 : 1)
