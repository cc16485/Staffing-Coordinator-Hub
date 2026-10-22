// 1050: the call_learned table and its one decision, the REAL SQL against a throwaway Postgres (PGlite).
// PGLITE=<path> node call_learned_1050_test.mjs
import fs from 'fs'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 600)])
const { PGlite } = await import(process.env.PGLITE || '/Users/samantha/Claude/Projects/.pglite/node_modules/@electric-sql/pglite/dist/index.js')
const db = new PGlite()
await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to authenticated, anon, service_role;
create function public.can_access_data_key(k text) returns boolean language sql stable as $$ select coalesce(auth.jwt()->>'staff', '') = 'yes' $$;
grant execute on function public.can_access_data_key(text) to authenticated, anon;`)
const sql = fs.readFileSync(new URL('./call_learned_1050.sql', import.meta.url), 'utf8')
await db.exec(sql); await db.exec(sql)
ck('installs, and installs again (safe to re-run)', true)
const as = async (role, q, params = [], claims = {}) => {
  await db.exec('begin')
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role, ...claims })])
  await db.exec(`set local role ${role}`)
  try { const r = await db.query(q, params); await db.exec('commit'); return r } catch (e) { await db.exec('rollback'); return 'refused: ' + e.message }
}
const STAFF = { staff: 'yes', email: 'krystal@mo-care.com' }
let r = await as('service_role', `insert into public.call_learned (message_id, lead_id, msg_at, status, reading) values ('m1', 'L1', now(), 'read', '{"heard":["safety"]}'), ('m2', 'L1', now(), 'waiting', null)`)
ck('the server writes rows', typeof r !== 'string', r)
r = await as('authenticated', `select message_id from public.call_learned order by 1`, [], STAFF)
ck('office staff read them', r.rows?.length === 2, r)
r = await as('authenticated', `select message_id from public.call_learned`, [], { email: 'x@y.z' })
ck('a sign-in with no hub access reads nothing', r.rows?.length === 0, r)
r = await as('anon', `select message_id from public.call_learned`)
ck('the public cannot read them', typeof r === 'string' && /permission/.test(r), r)
r = await as('authenticated', `update public.call_learned set decided = 'added' where message_id = 'm1'`, [], STAFF)
ck('staff cannot write the table directly', typeof r === 'string' && /permission/.test(r), r)
r = await as('authenticated', `select public.call_learned_decide('m1', 'wrong', '  hours were wrong  ') as ok`, [], STAFF)
const m1 = (await db.query(`select decided, decided_by, decided_note, decided_at from public.call_learned where message_id = 'm1'`)).rows[0]
ck('a person marks a read call (who, when, note)', r.rows?.[0]?.ok === true && m1.decided === 'wrong' && m1.decided_by === 'krystal@mo-care.com' && m1.decided_note === 'hours were wrong' && m1.decided_at, m1)
r = await as('authenticated', `select public.call_learned_decide('m2', 'added') as ok`, [], STAFF)
ck('...only a call that was read (not one still waiting)', r.rows?.[0]?.ok === false, r)
r = await as('authenticated', `select public.call_learned_decide('m1', 'deleted') as ok`, [], STAFF)
ck('...only added, wrong or dismissed', typeof r === 'string' && /unknown decision/.test(r), r)
r = await as('authenticated', `select public.call_learned_decide('m1', 'added') as ok`, [], { email: 'x@y.z' })
ck('...and only by someone with hub access', typeof r === 'string' && /not allowed/.test(r), r)
r = await as('anon', `select public.call_learned_decide('m1', 'added') as ok`)
ck('...never the public', typeof r === 'string' && /permission/.test(r), r)
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
