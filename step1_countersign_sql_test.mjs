// step1-countersign.sql in a real Postgres (PGlite): the company signature columns, write once; Approve to Work waits for it.
// PGLITE=<path> node step1_countersign_sql_test.mjs
import fs from 'fs'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 400)])
const sq = fs.readFileSync('supabase/step1-countersign.sql', 'utf8'), rb = fs.readFileSync('supabase/step1-countersign-rollback.sql', 'utf8')
ck('no em dash in the SQL', !/—/.test(sq + rb))
if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE); const db = new PGlite()
  await db.exec(fs.readFileSync('supabase/slice2a-step1-tables.sql', 'utf8').replace(/grant [^;]*to service_role;/gi, '').replace(/revoke [^;]*;/gi, ''))
  await db.exec(`create table if not exists public.client_journey_step_def (key text primary key, catalog_version int not null default 1, def jsonb not null, active boolean not null default true, updated_at timestamptz default now(), updated_by text);
    insert into public.client_journey_step_def (key, def) values ('cg.approve.work', '{"after": ["cg.check.fcsr"]}');
    insert into public.step1_forms (offer_id, signatures, pdfs) values ('11111111-1111-4111-8111-111111111111', '{"employment_agreement": {"at": "x"}}', '{"employment_agreement": "p1.pdf"}');`)
  await db.exec(sq); await db.exec(sq)
  ck('installs twice cleanly', true)
  const tryq = async (q) => { try { await db.exec(q); return 'ok' } catch (e) { return String(e.message || e) } }
  ck('a company signature can be added', await tryq(`update public.step1_forms set countersignatures = '{"employment_agreement": {"at": "y", "by_name": "Samantha"}}' where true`) === 'ok')
  ck('...and never changed', /company signature on employment_agreement is never changed/.test(await tryq(`update public.step1_forms set countersignatures = '{"employment_agreement": {"at": "z"}}' where true`)))
  ck('the countersigned PDF can be added once', await tryq(`update public.step1_forms set countersigned_pdfs = '{"employment_agreement": "cs.pdf"}' where true`) === 'ok' && /never replaced/.test(await tryq(`update public.step1_forms set countersigned_pdfs = '{"employment_agreement": "other.pdf"}' where true`)))
  ck('the earlier guards still hold (signature, PDF)', /never changed/.test(await tryq(`update public.step1_forms set signatures = '{}' where true`)) && /never replaced/.test(await tryq(`update public.step1_forms set pdfs = '{}' where true`)))
  const defs = Object.fromEntries((await db.query(`select key, active, def from public.client_journey_step_def`)).rows.map((r) => [r.key, r]))
  ck('the readiness row exists, required, owned by an owner; Approve to Work waits for it once (installed twice)', defs['cg.company.countersign']?.active && defs['cg.company.countersign'].def.required === true && defs['cg.approve.work'].def.after.filter((k) => k === 'cg.company.countersign').length === 1, defs)
  await db.exec(rb); await db.exec(rb)
  const d2 = Object.fromEntries((await db.query(`select key, active, def from public.client_journey_step_def`)).rows.map((r) => [r.key, r]))
  ck('rollback (twice): Approve to Work stops waiting, the row inactive, the signature kept', !d2['cg.approve.work'].def.after.includes('cg.company.countersign') && d2['cg.company.countersign'].active === false && (await db.query(`select countersignatures from public.step1_forms`)).rows[0].countersignatures.employment_agreement.by_name === 'Samantha', d2)
}
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (note ? '  ' + note : ''))
console.log(`${res.filter((x) => x[1]).length}/${res.length} passed`); process.exit(res.every((x) => x[1]) ? 0 : 1)
