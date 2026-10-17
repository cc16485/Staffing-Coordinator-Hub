// Release 1's database change (family_app_release1.sql), run twice in a real Postgres against a family_bookings table shaped
// like the live one (its original status check). PGLITE=<path to @electric-sql/pglite/dist/index.js> node release1_sql_test.mjs
import fs from 'fs'; import { pathToFileURL } from 'url'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 500)])
const { PGlite } = await import(pathToFileURL(process.env.PGLITE).href)
const db = new PGlite()
await db.exec(`create table public.app_data(key text primary key, data jsonb);
  insert into public.app_data values ('ops_settings', '{"family_app_live": true, "family_choose_live": true, "x": 1}');
  create table public.family_bookings (id uuid primary key default gen_random_uuid(), visit_date date not null,
    status text not null check (status in ('received', 'practice', 'waiting_for_caregiver', 'placed', 'needs_office', 'cancelled')));
  insert into public.family_bookings (visit_date, status) values ('2026-10-22', 'waiting_for_caregiver');`)
const q = fs.readFileSync('family_app_release1.sql', 'utf8')
await db.exec(q); await db.exec(q)
const cols = (await db.query(`select column_name from information_schema.columns where table_name = 'family_bookings'`)).rows.map((r) => r.column_name)
ck('1 new columns in place', ['answer_by', 'team_from', 'asking_from', 'two_stage', 'all_asked_at', 'ended_at', 'ended_why', 'family_unfilled_pending', 'family_unfilled_at', 'family_unfilled_how'].every((c) => cols.includes(c)), cols)
await db.exec(`update public.family_bookings set status = 'not_filled'`)
ck('2 the status not_filled is allowed', (await db.query(`select status from public.family_bookings`)).rows[0].status === 'not_filled')
let bad = null; try { await db.exec(`update public.family_bookings set status = 'nonsense'`) } catch (e) { bad = String(e.message) }
ck('3 other statuses are still refused', bad && /check/.test(bad), bad)
ck('4 exactly one status check (no duplicate after two runs)', (await db.query(`select count(*)::int n from pg_constraint where conrelid = 'public.family_bookings'::regclass and contype = 'c'`)).rows[0].n === 1)
const st = (await db.query(`select data from public.app_data where key = 'ops_settings'`)).rows[0].data
ck('5 her approval of the not-filled message recorded; Let me choose paused; other settings kept', st.family_unfilled_text_approved?.by === 'Samantha' && st.family_choose_live === false && st.x === 1 && st.family_app_live === true, st)
ck('6 existing bookings: not waiting to tell anyone, single stage', (await db.query(`select family_unfilled_pending, two_stage from public.family_bookings`)).rows[0].two_stage === false)
for (const [n, ok, note] of res) console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note))
console.log(`\n  Release 1 SQL: ${res.filter((r) => r[1]).length}/${res.length} passed`); process.exit(res.every((r) => r[1]) ? 0 : 1)
