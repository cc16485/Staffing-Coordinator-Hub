// 772: the practice list gets the contact name and matched number, then starts over. Practice rows only; live rows stay.
// The REAL SQL against a throwaway Postgres (PGlite). PGLITE=<path> node lead_record_check_772_test.mjs
import fs from 'fs'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 400)])
const { PGlite } = await import(process.env.PGLITE || '/Users/samantha/Claude/Projects/.pglite/node_modules/@electric-sql/pglite/dist/index.js')
const db = new PGlite()
await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create table public.app_data (key text primary key, data jsonb, updated_at timestamptz default now());
create function public.can_access_data_key(k text) returns boolean language sql stable as $$ select true $$;`)
await db.exec(fs.readFileSync(new URL('./lead_record_769.sql', import.meta.url), 'utf8'))
await db.exec(`insert into public.lead_record_seen (message_id, mode, msg_at, kind, status) values ('a', 'practice', now(), 'sms', 'would_record'), ('b', 'live', now(), 'call', 'recorded');
insert into public.lead_record_state (mode, scanned_to) values ('practice', now()), ('live', now());`)
const sql = fs.readFileSync(new URL('./lead_record_check_772.sql', import.meta.url), 'utf8')
await db.exec(sql); await db.exec(sql)
ck('installs, and installs again', true)
const rows = (await db.query(`select message_id, mode from public.lead_record_seen order by 1`)).rows, st = (await db.query(`select mode from public.lead_record_state`)).rows
ck('the practice list starts over; the live rows and the live scan position stay', rows.length === 1 && rows[0].mode === 'live' && st.length === 1 && st[0].mode === 'live', [rows, st])
await db.exec(`insert into public.lead_record_seen (message_id, mode, msg_at, kind, status, contact_name, matched_on) values ('c', 'practice', now(), 'sms', 'would_record', 'Carol Price', 'client_phone')`)
ck('rows keep the contact name and the matched number', (await db.query(`select contact_name, matched_on from public.lead_record_seen where message_id = 'c'`)).rows[0].matched_on === 'client_phone')
let bad = ''; try { await db.exec(`insert into public.lead_record_seen (message_id, mode, msg_at, kind, status, matched_on) values ('d', 'practice', now(), 'sms', 'would_record', 'email')`) } catch (e) { bad = e.message }
ck('...only phone or client_phone', /check/.test(bad), bad)
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
