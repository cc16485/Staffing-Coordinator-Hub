// 768 · the planned-end kinds, rehearsed in a real Postgres (PGlite): the care-change table as client-care.sql and
// end-date-fix.sql leave it, then 768 twice. PGLITE=<path to @electric-sql/pglite/dist/index.js> node care_planned_end_768_test.mjs
import fs from 'fs'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 500)])
const sql = fs.readFileSync('client-journey/care-planned-end-768.sql', 'utf8')
ck('768 is one transaction that only changes two rules on client_care_change', /^begin;$/m.test(sql) && /^commit;$/m.test(sql) && !/\b(drop table|truncate|delete from|grant|update public)\b/i.test(sql.replace(/--.*$/gm, '')))
if (!process.env.PGLITE) ck('PGLITE not set: the database rehearsal did not run', false)
else {
  const { PGlite } = await import(process.env.PGLITE); const pg = new PGlite(); await pg.waitReady
  const cc = fs.readFileSync('client-journey/client-care.sql', 'utf8')
  const table = cc.slice(cc.indexOf('create table if not exists public.client_care_change'), cc.indexOf('create index if not exists client_care_change_ax'))
  const keep = cc.slice(cc.indexOf('create or replace function public.client_care_change_keep()'), cc.indexOf('for each row execute function public.client_care_change_keep();') + 64)
  await pg.exec('create table public.client_journey (journey_id uuid primary key);' + table.replace('uuid primary key default gen_random_uuid()', 'uuid primary key default md5(random()::text)::uuid') + keep)
  await pg.exec(fs.readFileSync('client-journey/end-date-fix.sql', 'utf8'))
  const ins = (kind, reason) => pg.exec(`insert into public.client_care_change (axiscare_client_id, kind, reason, explanation, effective_date, made_by) values ('296', '${kind}', ${reason ? `'${reason}'` : 'null'}, 'x', '2026-11-16', 'sam')`).then(() => 'ok', (e) => String(e.message))
  ck('before 768: an end_planned is refused (the old kinds)', /client_care_change_kind_check/.test(await ins('end_planned', 'moved_cds')))
  let err = ''; try { await pg.exec(sql) } catch (e) { err = String(e.message) } ck('768 installs (its self-checks pass)', !err, err)
  err = ''; try { await pg.exec(sql) } catch (e) { err = String(e.message) } ck('768 installs again (safe to re-run)', !err, err)
  ck('after 768: a planned end with its reason is recorded', (await ins('end_planned', 'moved_cds')) === 'ok')
  ck('...a planned end without a reason is refused', /ccc_end_needs_reason/.test(await ins('end_planned', null)))
  ck('...a cancellation needs no reason', (await ins('end_cancelled', null)) === 'ok')
  ck('...every earlier kind still works', (await ins('end', 'facility')) === 'ok' && (await ins('end_date', null)) === 'ok' && (await ins('pause', 'hospital')) !== 'ok')   /* a pause still needs its follow-up date */
  ck('...the table is still permanent (no delete)', /permanent/.test(await pg.exec(`delete from public.client_care_change where kind = 'end'`).then(() => 'ok', (e) => String(e.message))))
  const bad = sql.replace("raise notice '768", "raise exception 'injected'; raise notice '768")
  /* the injected failure comes after both rules were dropped and re-added: a rollback must leave both in place */
  err = ''; try { await pg.exec(bad) } catch (e) { err = String(e.message) } try { await pg.exec('rollback') } catch (e) {}
  const def = (await pg.query(`select pg_get_constraintdef(oid) d from pg_constraint where conname = 'ccc_end_needs_reason'`)).rows[0].d
  const kd = (await pg.query(`select count(*)::int n from pg_constraint where conname in ('client_care_change_kind_check', 'ccc_end_needs_reason')`)).rows[0].n
  ck('a failure inside 768 leaves the rules as they were (all or nothing: both still there)', /injected/.test(err) && /end_planned/.test(def) && kd === 2, [err, def, kd])
}
let f = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (!ok) f++ }
console.log(`\n${res.length - f}/${res.length} passed`); process.exit(f ? 1 : 0)
