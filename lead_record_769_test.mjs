// 769: the recorder's table, its safe one-lead save, the Hub's one-record read and the "whose was this?" pick.
// The REAL SQL against a throwaway Postgres (PGlite). PGLITE=<path> node lead_record_769_test.mjs
import fs from 'fs'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 600)])
const { PGlite } = await import(process.env.PGLITE || '/Users/samantha/Claude/Projects/.pglite/node_modules/@electric-sql/pglite/dist/index.js')
const db = new PGlite()
const sql = fs.readFileSync(new URL('./lead_record_769.sql', import.meta.url), 'utf8')
await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant usage on schema auth to authenticated, anon, service_role;
create table public.app_data (key text primary key, data jsonb, updated_at timestamptz default now());
-- staff may read leads; a sign-in with no hub (claims.staff <> 'yes') may not
create function public.can_access_data_key(k text) returns boolean language sql stable as $$ select coalesce(auth.jwt()->>'staff', '') = 'yes' $$;
alter table public.app_data enable row level security;
create policy app_data_rw on public.app_data for all to authenticated using (public.can_access_data_key(key)) with check (public.can_access_data_key(key));
grant select, insert, update, delete on public.app_data to authenticated, service_role;`)
await db.query(`insert into public.app_data (key, data) values ('leads', $1)`, [JSON.stringify([{ id: 'L1', status: 'New' }, { id: 'L2', status: 'Contacted', notes: 'x' }])])
await db.exec(sql); await db.exec(sql)
ck('installs, and installs again (safe to re-run)', true)
const as = async (role, q, params = [], claims = {}) => {
  await db.exec('begin')
  await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role, ...claims })])
  await db.exec(`set local role ${role}`)
  try { const r = await db.query(q, params); await db.exec('commit'); return r } catch (e) { await db.exec('rollback'); return 'refused: ' + e.message }
}
const STAFF = { staff: 'yes', email: 'krystal@mo-care.com' }
const leads = async () => (await db.query(`select data from app_data where key = 'leads'`)).rows[0].data
const put = (role, before, after) => as(role, 'select public.lead_put_if_same($1, $2, $3) as ok', ['L1', JSON.stringify(before), JSON.stringify(after)])

let r = await put('service_role', { id: 'L1', status: 'New' }, { id: 'L1', status: 'Contacted', contact_events: [{ ref: 'ghl:m1' }] })
ck('the server saves a lead that is still exactly what it read', r.rows?.[0]?.ok === true && (await leads())[0].status === 'Contacted' && (await leads())[1].notes === 'x', r)
r = await put('service_role', { id: 'L1', status: 'New' }, { id: 'L1', status: 'Lost' })
ck('...and refuses (false, nothing changed) when someone saved it in between', r.rows?.[0]?.ok === false && (await leads())[0].status === 'Contacted', r)
r = await as('service_role', 'select public.lead_put_if_same($1, $2, $3) as ok', ['L1', JSON.stringify((await leads())[0]), JSON.stringify({ id: 'L9' })])
ck('...and refuses a save whose id does not match', typeof r === 'string' && /mismatch/.test(r), r)
r = await put('authenticated', (await leads())[0], { id: 'L1', status: 'Lost' })
ck('a signed-in person cannot use the server\'s save', typeof r === 'string' && /permission/.test(r) && (await leads())[0].status === 'Contacted', r)

r = await as('authenticated', `select public.app_data_item_get('leads', 'L2') as x`, [], STAFF)
ck('office staff read one lead (the Hub uses it before saving a lead)', r.rows?.[0]?.x?.notes === 'x', r)
r = await as('authenticated', `select public.app_data_item_get('leads', 'L2') as x`, [], { staff: 'no' })
ck('...a sign-in without access to leads reads nothing', r.rows?.[0]?.x === null, r)
r = await as('anon', `select public.app_data_item_get('leads', 'L2') as x`)
ck('...and a visitor is refused', typeof r === 'string' && /permission/.test(r), r)

await as('service_role', `insert into public.lead_record_seen (message_id, mode, msg_at, kind, status, candidates, line, ev) values
  ('m9', 'live', now(), 'call', 'several', '["L1","L2"]', '☎ They called, Krystal answered, 2 min', '{"outcome":"connected"}'),
  ('m3', 'live', now(), 'call', 'recorded', '[]', 'x', null), ('m9', 'practice', now(), 'call', 'several', '["L1","L2"]', 'x', null)`)
r = await as('authenticated', `select count(*)::int as n from public.lead_record_seen`, [], STAFF)
ck('office staff read what the recorder did', r.rows?.[0]?.n === 3, r)
r = await as('authenticated', `select count(*)::int as n from public.lead_record_seen`, [], { staff: 'no' })
ck('...a sign-in without access to leads sees none of it', r.rows?.[0]?.n === 0, r)
r = await as('authenticated', `insert into public.lead_record_seen (message_id, mode, msg_at, kind, status) values ('z', 'live', now(), 'sms', 'recorded')`, [], STAFF)
ck('...and nobody but the server writes it', typeof r === 'string' && /permission/.test(r), r)
r = await as('authenticated', `select public.lead_record_pick('m9', 'L7') as ok`, [], STAFF)
ck('"whose was this?": a lead that was not one of the choices is refused', r.rows?.[0]?.ok === false, r)
r = await as('authenticated', `select public.lead_record_pick('m9', 'L2') as ok`, [], STAFF)
const row = (await db.query(`select status, lead_id, picked_by from public.lead_record_seen where message_id = 'm9' and mode = 'live'`)).rows[0]
ck('...picking one of them marks it picked, with who picked', r.rows?.[0]?.ok === true && row.status === 'picked' && row.lead_id === 'L2' && row.picked_by === 'krystal@mo-care.com', [r, row])
r = await as('authenticated', `select public.lead_record_pick('m9', 'L1') as ok`, [], STAFF)
ck('...and it cannot be picked twice', r.rows?.[0]?.ok === false, r)
r = await as('authenticated', `select public.lead_record_pick('m3', 'L1') as ok`, [], { staff: 'no' })
ck('...a sign-in without access to leads cannot pick', typeof r === 'string' && /not allowed/.test(r), r)
r = await as('authenticated', `select count(*)::int as n from public.lead_record_state`, [], STAFF)
ck('the scan position is server only', typeof r === 'string' && /permission/.test(r), r)
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
