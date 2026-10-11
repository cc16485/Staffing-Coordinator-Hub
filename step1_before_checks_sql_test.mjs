// STEP 1 BEFORE CHECKS: the server door step1_candidate_create in a real Postgres.  PGLITE=<path> node step1_before_checks_sql_test.mjs
import fs from 'fs'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 500)])
const sq = fs.readFileSync('supabase/step1-before-checks.sql', 'utf8')
ck('no em dash in the SQL', !/—/.test(sq))
ck('server only: revoked from public, anon, authenticated; granted to service_role', /revoke all on function public\.step1_candidate_create\(text, jsonb\) from public, anon, authenticated/.test(sq) && /to service_role/.test(sq))
if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE); const db = new PGlite()
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table public.app_data (key text primary key, data jsonb, updated_at timestamptz default now());
    create table public.app_data_id_counter (key text primary key, last_id bigint not null default 0, updated_at timestamptz default now());
    insert into public.app_data_id_counter values ('candidates', 120);
    create table public.client_journey_step_def (key text primary key, catalog_version int not null default 1, def jsonb not null, active boolean not null default true, updated_at timestamptz default now(), updated_by text);
    insert into public.client_journey_step_def (key, def) values ('cg.approve.advance', '{"after": ["cg.check.oig", "cg.check.edl", "cg.check.fcsr", "cg.refs.cleared"]}'), ('cg.approve.work', '{"after": ["cg.check.fcsr", "cg.check.edl"]}');
    insert into public.app_data values ('candidates', '[{"id": 7, "first": "Real", "last": "Person", "phone": "4175551234"}, {"id": 8, "first": "Linky", "last": "Same", "phone": "4175559999"}]');`)
  await db.exec(sq); await db.exec(sq)
  const defs = (await db.query(`select key, active, def from public.client_journey_step_def order by key`)).rows
  const cn = defs.find((d) => d.key === 'cg.check.casenet'), adv = defs.find((d) => d.key === 'cg.approve.advance'), wk = defs.find((d) => d.key === 'cg.approve.work')
  ck('Case.net: an active readiness row (screening, proof, after the signed consents) with the court site in its how-to', cn && cn.active && cn.def.stage === 'screening' && cn.def.proof === 'proof' && cn.def.after.includes('cg.consent.checks') && /courts\.mo\.gov\/casenet/.test(cn.def.howto[0]), cn)
  ck('Case.net: both approvals wait for it, once (the install ran twice)', adv.def.after.filter((k) => k === 'cg.check.casenet').length === 1 && wk.def.after.filter((k) => k === 'cg.check.casenet').length === 1 && adv.def.after.includes('cg.check.edl'), [adv.def, wk.def])
  const call = async (oid, rec) => (await db.query('select public.step1_candidate_create($1, $2) as r', [oid, JSON.stringify(rec)])).rows[0].r
  const list = async () => (await db.query(`select data from public.app_data where key = 'candidates'`)).rows[0].data
  let r = await call('off-1', { first: 'Bo', last: 'Newhire', phone: '(417) 555-0182', onboarding_path: 'new', oig: 'Pending', id: 3, _rev: 9 })
  let L = await list()
  ck('a new person gets the next number past the counter (never reused), with the offer id', r.ok && r.created && r.id === 121 && L.length === 3 && L[2].id === 121 && L[2].offer_id === 'off-1' && !('_rev' in L[2]), [r, L])
  r = await call('off-1', { first: 'Bo', last: 'Newhire' })
  ck('again for the same offer: the same record, nothing added', r.ok && !r.created && r.how === 'already' && String(r.id) === '121' && (await list()).length === 3, r)
  r = await call('off-2', { first: 'Someone', last: 'Else', phone: '417-555-9999' })
  L = await list()
  ck('an unlinked record with the same phone is linked to the offer (never two records), nothing else touched', r.how === 'linked' && String(r.id) === '8' && L.length === 3 && L[1].offer_id === 'off-2' && L[1].first === 'Linky', [r, L])
  r = await call('off-3', { first: 'real', last: 'PERSON', phone: '' })
  ck('an unlinked record with the same first and last name is linked', r.how === 'linked' && String(r.id) === '7', r)
  r = await call('off-4', { first: 'Cy', last: 'Third', phone: '4175550188' })
  ck('the counter moves on (122)', r.id === 122 && (await db.query(`select last_id from public.app_data_id_counter`)).rows[0].last_id === 122, r)
  let err = ''; try { await call('', { first: 'x' }) } catch (e) { err = e.message }
  ck('refuses without an offer id', /an offer id and a record are needed/.test(err), err)
  await db.exec(fs.readFileSync('supabase/step1-before-checks-rollback.sql', 'utf8'))
  const after = (await db.query(`select key, active, def from public.client_journey_step_def order by key`)).rows
  ck('rollback: the Case.net row inactive and out of both approvals; the records it made stay', !after.find((d) => d.key === 'cg.check.casenet').active && !after.some((d) => (d.def.after || []).includes('cg.check.casenet')) && (await list()).length === 4)
  await db.exec(sq)
  await db.exec('begin'); await db.exec('set local role authenticated')
  try { await call('off-5', { first: 'Hack' }); err = 'went through' } catch (e) { err = e.message } finally { await db.exec('rollback') }
  ck('a signed-in browser cannot call it', /permission denied/.test(err), err)
}
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note))
const bad = res.filter((x) => !x[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
