// Rules guard (2026-10-18): rules_fingerprint_approved answers yes/no for one exact (file, fingerprint) and nothing more;
// the table stays server-only. Real G2 table SQL in a real Postgres.  PGLITE=<path> node rules_guard_rpc_test.mjs
import fs from 'fs'; import path from 'path'
const ROOT = path.dirname(new URL(import.meta.url).pathname)
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 500)])
const sq = fs.readFileSync(path.join(ROOT, 'rules_guard_rpc.sql'), 'utf8'), rb = fs.readFileSync(path.join(ROOT, 'rules_guard_rpc_rollback.sql'), 'utf8')
const g2 = fs.readFileSync(path.join(ROOT, 'g2_rules_approved.sql'), 'utf8')
const code = (s) => s.replace(/--.*$/gm, '')
ck('no em dash in the SQL', !/—/.test(sq + rb))
ck('the install touches no table: no insert, update, delete, truncate, grant on a table, or alter table', !/\binsert\b|\bupdate\b|\bdelete\b|\btruncate\b|\balter\s+table\b|\bgrant\b[^;]*\bon\s+(table\s+)?public\.rules_approved/i.test(code(sq)))
ck('the function is security definer with a pinned search_path', /security definer/i.test(sq) && /set search_path = pg_catalog, public/.test(sq))
ck('the rollback only drops the function', code(rb).trim() === 'drop function if exists public.rules_fingerprint_approved(text, text);')
if (!process.env.PGLITE) ck('PGLITE is set (the database half needs it)', false)
else {
  const { PGlite } = await import(process.env.PGLITE); const db = new PGlite()
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;`)
  await db.exec(g2)
  const A = 'a'.repeat(64), B = 'b'.repeat(64)
  await db.exec(`insert into public.rules_approved (file, sha256, note) values ('eligibility-rules.js', '${A}', 'test')`)
  await db.exec(sq)
  await db.exec(sq)   // runs twice cleanly
  ck('installs twice cleanly', true)
  const as = async (role, q, a) => { try { await db.exec(`set role ${role}`); const r = await db.query(q, a); return r.rows } catch (e) { return 'ERR ' + String(e.message || e) } finally { await db.exec('reset role') } }
  const yes = async (role, f, s) => { const r = await as(role, 'select public.rules_fingerprint_approved($1, $2) as v', [f, s]); return Array.isArray(r) ? r[0].v : r }
  ck('anon: an approved fingerprint answers true (it works, not only refuses)', (await yes('anon', 'eligibility-rules.js', A)) === true)
  ck('anon: an unapproved fingerprint answers false', (await yes('anon', 'eligibility-rules.js', B)) === false)
  ck('anon: the right fingerprint for a different file answers false', (await yes('anon', 'obligations.js', A)) === false)
  ck('anon: a bad file name or fingerprint answers false, never an error', (await yes('anon', '../x', A)) === false && (await yes('anon', 'eligibility-rules.js', 'A'.repeat(64))) === false && (await yes('anon', null, null)) === false)
  ck('anon: a pattern instead of a fingerprint answers false', (await yes('anon', 'eligibility-rules.js', '%')) === false)
  ck('authenticated can ask too', (await yes('authenticated', 'eligibility-rules.js', A)) === true)
  const rd = await as('anon', 'select * from public.rules_approved')
  ck('anon still cannot read the table', typeof rd === 'string' && /permission denied/.test(rd), rd)
  const wr = await as('anon', `insert into public.rules_approved (file, sha256) values ('obligations.js', '${B}')`)
  ck('anon still cannot write the table', typeof wr === 'string' && /permission denied/.test(wr), wr)
  const rda = await as('authenticated', 'select * from public.rules_approved')
  ck('signed-in staff still cannot read the table', typeof rda === 'string' && /permission denied/.test(rda), rda)
  const cnt = (await db.query('select count(*)::int as n from public.rules_approved')).rows[0].n
  ck('the approved list is unchanged by the install and the questions', cnt === 1, cnt)
  await db.exec(rb)
  const gone = await as('anon', 'select public.rules_fingerprint_approved($1, $2)', ['eligibility-rules.js', A])
  ck('after rollback the function is gone and the table stays', typeof gone === 'string' && (await db.query('select count(*)::int as n from public.rules_approved')).rows[0].n === 1, gone)
}
let p = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '  ' + note)); if (ok) p++ }
console.log(`${p}/${res.length} passed`); process.exit(p === res.length ? 0 : 1)
