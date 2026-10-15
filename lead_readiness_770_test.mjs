// 770: the readiness table. The REAL SQL against a throwaway Postgres (PGlite). PGLITE=<path> node lead_readiness_770_test.mjs
import fs from 'fs'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 600)])
const { PGlite } = await import(process.env.PGLITE || '/Users/samantha/Claude/Projects/.pglite/node_modules/@electric-sql/pglite/dist/index.js')
const db = new PGlite()
await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create function public.can_access_data_key(k text) returns boolean language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb->>'staff' = 'yes' $$;`)
const sql = fs.readFileSync(new URL('./lead_readiness_770.sql', import.meta.url), 'utf8')
await db.exec(sql); await db.exec(sql)
ck('installs, and installs again (safe to re-run)', true)
const as = async (role, q, claims = {}) => {
  await db.exec('begin'); await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]); await db.exec(`set local role ${role}`)
  try { const r = await db.query(q); await db.exec('commit'); return r } catch (e) { await db.exec('rollback'); return 'refused: ' + e.message }
}
let r = await as('service_role', `insert into public.lead_readiness (lead_id, level, why, hours_heard, source) values ('A', 'ready', 'x', 12, 'call')`)
ck('the server writes a reading', typeof r !== 'string', r)
r = await as('service_role', `insert into public.lead_readiness (lead_id, level) values ('B', 'maybe')`)
ck('...only ready, deciding or looking', typeof r === 'string' && /check/.test(r), r)
r = await as('service_role', `insert into public.lead_readiness (lead_id, hours_heard) values ('C', 900)`)
ck('...and sensible hours', typeof r === 'string' && /check/.test(r), r)
r = await as('authenticated', `select level from public.lead_readiness`, { staff: 'yes' })
ck('office staff read the readings', r.rows?.[0]?.level === 'ready', r)
r = await as('authenticated', `select level from public.lead_readiness`, { staff: 'no' })
ck('...a sign-in without access to leads reads none', r.rows?.length === 0, r)
r = await as('authenticated', `update public.lead_readiness set level = 'looking'`, { staff: 'yes' })
ck('...and only the server writes them', typeof r === 'string' && /permission/.test(r), r)
r = await as('anon', `select * from public.lead_readiness`)
ck('a visitor is refused', typeof r === 'string' && /permission/.test(r), r)
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
