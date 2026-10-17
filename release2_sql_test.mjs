// Release 2's database change (family_app_release2.sql), run twice in a real Postgres against a family_bookings table shaped
// like the live one after Release 1. PGLITE=<path to @electric-sql/pglite/dist/index.js> node release2_sql_test.mjs
import fs from 'fs'; import { pathToFileURL } from 'url'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 500)])
const { PGlite } = await import(pathToFileURL(process.env.PGLITE).href)
const db = new PGlite()
await db.exec(`create table public.app_data(key text primary key, data jsonb);
  insert into public.app_data values ('ops_settings', '{"family_app_live": true, "family_unfilled_text_approved": {"by": "Samantha"}, "x": 1}');
  create table public.family_bookings (id uuid primary key default gen_random_uuid(), visit_date date not null, status text not null);
  insert into public.family_bookings (visit_date, status) values ('2026-10-22', 'placed');`)
const q = fs.readFileSync('family_app_release2.sql', 'utf8')
await db.exec(q); await db.exec(q)
const cols = (await db.query(`select column_name from information_schema.columns where table_name = 'family_bookings'`)).rows.map((r) => r.column_name)
ck('1 new columns in place', ['ax_checked_at', 'sync_state', 'sync_note', 'cancel_source', 'family_change_pending', 'family_change_at', 'family_change_from', 'family_change_kind', 'family_change_how'].every((c) => cols.includes(c)), cols)
ck('2 existing visits owe no change message', (await db.query(`select family_change_pending from public.family_bookings`)).rows[0].family_change_pending === false)
const st = (await db.query(`select data from public.app_data where key = 'ops_settings'`)).rows[0].data
ck('3 both change-message approvals recorded as hers', st.family_cgchange_text_approved?.by === 'Samantha' && st.family_timechange_text_approved?.by === 'Samantha', st)
ck('4 every other setting kept', st.x === 1 && st.family_app_live === true && st.family_unfilled_text_approved?.by === 'Samantha', st)
await db.exec(`update public.app_data set data = data || '{"family_timechange_text_approved": null}'`); await db.exec(q)
ck('5 a later change in the Hub is not overwritten by running it again', (await db.query(`select data from public.app_data where key = 'ops_settings'`)).rows[0].data.family_timechange_text_approved === null)
for (const [n, ok, note] of res) console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note))
console.log(`\n  Release 2 SQL: ${res.filter((r) => r[1]).length}/${res.length} passed`); process.exit(res.every((r) => r[1]) ? 0 : 1)
