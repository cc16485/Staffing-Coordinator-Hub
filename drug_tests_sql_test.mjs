// 2026-10-13: drug-tests.sql (the append-only drug test record, its private bucket and keep-guard) and
// welcome-rights-explained.sql (the Orientation Video Call explanation columns and their server-only guard), with their
// rollbacks, in a real Postgres with a fake storage schema.   PGLITE=<path> node drug_tests_sql_test.mjs
import fs from 'fs'; import path from 'path'
const ROOT = path.dirname(new URL(import.meta.url).pathname)
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 500)])
const R = (f) => fs.readFileSync(path.join(ROOT, 'supabase', f), 'utf8')
const dt = R('drug-tests.sql'), dtb = R('drug-tests-rollback.sql'), wr = R('welcome-rights-explained.sql'), wrb = R('welcome-rights-explained-rollback.sql')
const nc = (s) => s.replace(/--.*$/gm, '')
ck('no em dash in the four files', !/—/.test(dt + dtb + wr + wrb))
ck('the installs delete and truncate nothing; the drug test rollback drops no table and empties no bucket', !/\bdelete\s+from\b|\btruncate\s+(table\s+)?public\./i.test(nc(dt) + nc(wr)) && !/drop\s+table|delete\s+from|storage\.buckets/i.test(nc(dtb)))
ck('the drug test SQL holds no list of grounds (the reason is free text)', !/reasonable suspicion|post-accident|random (test|selection|pool)|return to duty/i.test(dt) && /reason text,/.test(dt) && !/reason text check/.test(dt))
if (!process.env.PGLITE) ck('PGLITE is set (the database half needs it)', false)
else {
  const { PGlite } = await import(process.env.PGLITE); const db = new PGlite()
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, created_at timestamptz default now(), updated_at timestamptz default now(), metadata jsonb);
    grant usage on schema storage to authenticated, service_role; grant all on storage.objects to authenticated, service_role;
    create table public.client_journey_step_def (key text primary key, catalog_version int, def jsonb, active boolean, updated_by text);
    insert into public.client_journey_step_def values ('cg.step2.participant_rights', 1, '{"title": "old", "stage": "step1", "proof": "record", "after": ["cg.approve.advance"], "required": true}', true, 'seed');
    create table public.welcome_calls (id uuid primary key default gen_random_uuid(), candidate_id text not null, status text not null default 'invited', done_at timestamptz, done_by text, notes text, i9_checked boolean default false, updated_at timestamptz default now());
    grant select, insert, update on public.welcome_calls to authenticated; grant all on public.welcome_calls to service_role;`)
  const tryq = async (q) => { try { await db.exec(q); return 'ok' } catch (e) { return String(e.message || e) } }
  const one = async (q) => (await db.query(q)).rows[0]
  /* ── drug tests ── */
  await db.exec(dt); await db.exec(dt)
  ck('drug tests: installs twice cleanly', true)
  const b = await one(`select * from storage.buckets where id = 'drug-test-docs'`)
  ck('the bucket drug-test-docs: private, 15 MB, images and PDF only', b && b.public === false && Number(b.file_size_limit) === 15728640 && b.allowed_mime_types.length === 5 && b.allowed_mime_types.includes('application/pdf'), b)
  await db.exec(`update storage.buckets set public = true where id = 'drug-test-docs'`); await db.exec(dt)
  ck('a bucket someone made public is made private again by a re-run', (await one(`select public from storage.buckets where id = 'drug-test-docs'`)).public === false)
  const pv = await one(`select has_table_privilege('authenticated', 'public.drug_test_entry', 'select') a, has_table_privilege('anon', 'public.drug_test_entry', 'select') b, has_table_privilege('authenticated', 'public.drug_test_entry', 'insert') c, has_table_privilege('service_role', 'public.drug_test_entry', 'insert') d`)
  ck('server only: no browser role reads or writes the record', !pv.a && !pv.b && !pv.c, pv)
  const ins = (x) => tryq(`insert into public.drug_test_entry ${x}`)
  ck('a request needs its reason', /drug_test_request_shape/.test(await ins(`(kind, offer_id, date_requested, reason, requested_by_email, entered_by_email) values ('request', 'o1', '2026-10-12', '   ', 's@x', 's@x')`)))
  ck('a request needs its date', /drug_test_request_shape/.test(await ins(`(kind, offer_id, reason, requested_by_email, entered_by_email) values ('request', 'o1', 'Policy calls for it', 's@x', 's@x')`)))
  ck('a record needs a person', /drug_test_someone/.test(await ins(`(kind, date_requested, reason, requested_by_email, entered_by_email) values ('request', '2026-10-12', 'Policy calls for it', 's@x', 's@x')`)))
  await db.exec(`insert into public.drug_test_entry (id, kind, offer_id, date_requested, reason, requested_by_email, entered_by_email) values ('00000000-0000-4000-8000-000000000001', 'request', 'o1', '2026-10-12', 'Policy calls for it', 's@x', 's@x')`)
  ck('a result is one of her five', /drug_test_entry_result_check|check constraint/.test(await ins(`(kind, test_id, offer_id, result, entered_by_email) values ('result', '00000000-0000-4000-8000-000000000001', 'o1', 'unclear', 's@x')`)))
  ck('a result names its test', /drug_test_result_shape/.test(await ins(`(kind, offer_id, result, entered_by_email) values ('result', 'o1', 'negative', 's@x')`)))
  await db.exec(`insert into public.drug_test_entry (id, kind, test_id, offer_id, result, result_date, entered_by_email) values ('00000000-0000-4000-8000-000000000002', 'result', '00000000-0000-4000-8000-000000000001', 'o1', 'negative', '2026-10-13', 's@x')`)
  ck('a correction needs what it corrects and why', /drug_test_correction_shape/.test(await ins(`(kind, test_id, corrects, offer_id, result, entered_by_email) values ('correction', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'o1', 'cancelled', 's@x')`)))
  ck('a correction with its reason is a new line', (await ins(`(kind, test_id, corrects, offer_id, result, correction_reason, entered_by_email) values ('correction', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'o1', 'cancelled', 'Clinic cancelled', 's@x')`)) === 'ok')
  ck('append-only: a line is never changed', /append-only/.test(await tryq(`update public.drug_test_entry set result = 'positive' where id = '00000000-0000-4000-8000-000000000002'`)))
  ck('append-only: a line is never removed', /append-only/.test(await tryq(`delete from public.drug_test_entry`)))
  ck('append-only: never emptied', /append-only/.test(await tryq(`truncate public.drug_test_entry`)))
  ck('three lines stand', Number((await one(`select count(*) n from public.drug_test_entry`)).n) === 3)
  await db.exec(`insert into storage.objects (bucket_id, name) values ('drug-test-docs', 'dt/x/1.pdf'), ('lead-docs', 'a.pdf')`)
  ck('a proof file is never deleted', /cannot be deleted/.test(await tryq(`delete from storage.objects where bucket_id = 'drug-test-docs'`)))
  ck('a proof file is never moved or renamed', /cannot be moved or renamed/.test(await tryq(`update storage.objects set name = 'dt/x/2.pdf' where bucket_id = 'drug-test-docs'`)))
  ck('other buckets are untouched by the guard', (await tryq(`delete from storage.objects where bucket_id = 'lead-docs'`)) === 'ok')
  await db.exec(dtb); await db.exec(dtb)
  ck('rollback (twice): the storage guard goes; the record, its lines, its guard and the bucket stay', (await tryq(`delete from storage.objects where bucket_id = 'drug-test-docs'`)) === 'ok' && Number((await one(`select count(*) n from public.drug_test_entry`)).n) === 3 && /append-only/.test(await tryq(`delete from public.drug_test_entry`)) && !!(await one(`select id from storage.buckets where id = 'drug-test-docs'`)))
  /* ── the Orientation Video Call explanation ── */
  await db.exec(wr); await db.exec(wr)
  ck('rights explained: installs twice cleanly; the four columns', (await db.query(`select column_name from information_schema.columns where table_name = 'welcome_calls' and column_name like 'rights_%' order by 1`)).rows.map((x) => x.column_name).join() === 'rights_ack_confirmed,rights_explained_at,rights_explained_by,rights_explained_by_email')
  const def = (await one(`select def from public.client_journey_step_def where key = 'cg.step2.participant_rights'`)).def
  ck('the readiness row: both needed, stage orientation, a record row; its prerequisites kept', /signed in Step 1/.test(def.title) && /explained at the Orientation Video Call/.test(def.title) && def.stage === 'orientation' && def.proof === 'record' && def.after[0] === 'cg.approve.advance' && def.required === true, def)
  await db.exec(`insert into public.welcome_calls (id, candidate_id, status) values ('00000000-0000-4000-8000-0000000000a1', '42', 'booked')`)
  const asRole = async (role, q) => { try { await db.exec(`set role ${role}; ${q}`); return 'ok' } catch (e) { return String(e.message || e) } finally { await db.exec('reset role') } }
  ck('the Hub page (authenticated) still ticks and writes notes', (await asRole('authenticated', `update public.welcome_calls set i9_checked = true, notes = 'ok' where candidate_id = '42'`)) === 'ok')
  ck('the Hub page cannot record the explanation itself', /recorded only by the Orientation Video Call done press/.test(await asRole('authenticated', `update public.welcome_calls set rights_explained_at = now(), rights_ack_confirmed = true where candidate_id = '42'`)))
  ck('the Hub page cannot insert a call that claims it either', /recorded only by the Orientation Video Call done press/.test(await asRole('authenticated', `insert into public.welcome_calls (candidate_id, rights_ack_confirmed) values ('43', true)`)))
  ck('the server records it', (await asRole('service_role', `update public.welcome_calls set status = 'done', rights_explained_at = '2026-10-13T15:00:00Z', rights_explained_by = 'Krystal', rights_explained_by_email = 'krystal@mo-care.com', rights_ack_confirmed = true where candidate_id = '42'`)) === 'ok')
  ck('once recorded, it never changes (not even by the server)', /never changes/.test(await asRole('service_role', `update public.welcome_calls set rights_explained_by = 'Someone else' where candidate_id = '42'`)))
  ck('other columns still change after it is recorded', (await asRole('service_role', `update public.welcome_calls set notes = 'later note' where candidate_id = '42'`)) === 'ok')
  await db.exec(wrb)
  ck('rollback with an explanation recorded: the guard goes, the columns and the record stay', !(await one(`select 1 x from pg_trigger where tgname = 'welcome_rights_guard_t'`)) && (await one(`select rights_explained_by from public.welcome_calls where candidate_id = '42'`)).rights_explained_by === 'Krystal')
  const db2 = new PGlite()
  await db2.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table public.client_journey_step_def (key text primary key, catalog_version int, def jsonb, active boolean, updated_by text);
    create table public.welcome_calls (id uuid primary key default gen_random_uuid(), candidate_id text not null, status text, updated_at timestamptz);`)
  await db2.exec(wr); await db2.exec(wrb); await db2.exec(wrb)
  ck('rollback with nothing recorded (twice): the columns go too', !(await db2.query(`select 1 from information_schema.columns where table_name = 'welcome_calls' and column_name like 'rights_%'`)).rows.length)
}
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note))
const bad = res.filter((x) => !x[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
