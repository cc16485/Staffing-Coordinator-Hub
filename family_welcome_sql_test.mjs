// family_welcome.sql, run twice in a real Postgres. PGLITE=<path to @electric-sql/pglite/dist/index.js> node family_welcome_sql_test.mjs
import fs from 'fs'; import { pathToFileURL } from 'url'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 400)])
const { PGlite } = await import(pathToFileURL(process.env.PGLITE).href)
const db = new PGlite()
await db.exec(`create table public.app_data(key text primary key, data jsonb); insert into public.app_data values ('ops_settings', '{"family_app_live": true, "family_welcome_skip_clients": ["55"]}');
  create table public.care_circles (id uuid primary key default gen_random_uuid(), client_name text); insert into public.care_circles (client_name) values ('Dorothy');
  create table public.circle_contacts (id serial primary key, name text, circle_id uuid); insert into public.circle_contacts (name) values ('Lisa');`)
const q = fs.readFileSync('family_welcome.sql', 'utf8'); await db.exec(q); await db.exec(q)
const cols = async (t) => (await db.query(`select column_name from information_schema.columns where table_name = '${t}'`)).rows.map((r) => r.column_name)
const cc = await cols('circle_contacts'), k = await cols('care_circles')
ck('1 the welcome record fields', ['welcome_sent_at', 'welcome_sent_by', 'welcome_version', 'welcome_how', 'welcome_ready_at', 'welcome_skip_at', 'welcome_skip_by', 'welcome_skip_reason'].every((c) => cc.includes(c)), cc)
ck('2 the Care Scheduling Type fields', ['care_scheduling_type', 'care_scheduling_type_at', 'care_scheduling_type_by'].every((c) => k.includes(c)), k)
await db.exec(`update public.care_circles set care_scheduling_type = 'flexible'`)
let bad = null; try { await db.exec(`update public.care_circles set care_scheduling_type = 'weekly'`) } catch (e) { bad = String(e.message) }
ck('3 only the three types', bad && /check/.test(bad), bad)
const st = (await db.query(`select data from public.app_data where key = 'ops_settings'`)).rows[0].data
ck('4 reminder on; an existing skip list is kept as the office set it; other settings kept', st.family_welcome_alert_live === true && JSON.stringify(st.family_welcome_skip_clients) === '["55"]' && st.family_app_live === true, st)
for (const [n, ok, note] of res) console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note))
console.log(`\n  welcome SQL: ${res.filter((r) => r[1]).length}/${res.length} passed`); process.exit(res.every((r) => r[1]) ? 0 : 1)
