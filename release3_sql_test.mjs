// Release 3's database change (family_app_release3.sql), run twice in a real Postgres against tables shaped like the live ones
// after Release 2. PGLITE=<path to @electric-sql/pglite/dist/index.js> node release3_sql_test.mjs
import fs from 'fs'; import { pathToFileURL } from 'url'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 500)])
const { PGlite } = await import(pathToFileURL(process.env.PGLITE).href)
const db = new PGlite()
await db.exec(`create table public.app_data(key text primary key, data jsonb);
  insert into public.app_data values ('ops_settings', '{"family_app_live": true, "family_cgchange_text_approved": {"by": "Samantha"}, "x": 1}');
  create table public.care_circles (id uuid primary key default gen_random_uuid(), client_name text);
  insert into public.care_circles (client_name) values ('Dorothy');
  create table public.family_bookings (id uuid primary key default gen_random_uuid(), visit_date date not null, answer_by timestamptz,
    status text not null constraint family_bookings_status_check check (status in ('received', 'practice', 'waiting_for_caregiver', 'placed', 'needs_office', 'cancelled', 'not_filled')));
  insert into public.family_bookings (visit_date, status) values ('2026-10-22', 'waiting_for_caregiver');`)
const q = fs.readFileSync('family_app_release3.sql', 'utf8')
await db.exec(q); await db.exec(q)
const cols = (t) => db.query(`select column_name from information_schema.columns where table_name = '${t}'`).then((r) => r.rows.map((x) => x.column_name))
const fb = await cols('family_bookings'), cc = await cols('care_circles')
ck('1 the booking fields are in place', ['home_notes', 'note_check', 'note_hidden', 'hold_reason', 'held_by', 'held_at', 'reviewed_at', 'reviewed_by', 'review_decision', 'decline_reason', 'family_declined_pending', 'family_declined_at', 'family_declined_how', 'help_fill', 'fill_task_at', 'fill_closed_by', 'unfilled_kind'].every((c) => fb.includes(c)), fb)
ck('2 the Family Circle fields are in place', cc.includes('app_tasks') && cc.includes('help_fill'), cc)
await db.exec(`update public.family_bookings set status = 'held'`); await db.exec(`update public.family_bookings set status = 'declined'`)
ck('3 held and declined are allowed', (await db.query(`select status from public.family_bookings`)).rows[0].status === 'declined')
let bad = null; try { await db.exec(`update public.family_bookings set status = 'nonsense'`) } catch (e) { bad = String(e.message) }
ck('4 other statuses are still refused, one status check after two runs', bad && /check/.test(bad) && (await db.query(`select count(*)::int n from pg_constraint where conrelid = 'public.family_bookings'::regclass and contype = 'c'`)).rows[0].n === 1, bad)
const st = (await db.query(`select data from public.app_data where key = 'ops_settings'`)).rows[0].data
ck('5 both message approvals recorded as hers; every other setting kept', st.family_declined_text_approved?.by === 'Samantha' && st.family_couldnt_text_approved?.by === 'Samantha' && st.x === 1 && st.family_cgchange_text_approved?.by === 'Samantha', st)
ck('6 existing requests: no Help us fill, nothing owed, note shown', (await db.query(`select help_fill, family_declined_pending, note_hidden from public.family_bookings`)).rows.every((r) => !r.help_fill && !r.family_declined_pending && !r.note_hidden))
for (const [n, ok, note] of res) console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note))
console.log(`\n  Release 3 SQL: ${res.filter((r) => r[1]).length}/${res.length} passed`); process.exit(res.every((r) => r[1]) ? 0 : 1)
