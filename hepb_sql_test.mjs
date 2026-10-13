// Hepatitis B vaccination (2026-10-13): the tables, the history guards, the private bucket and its keep-guard, the readiness
// row, in a real Postgres with a fake storage schema.  PGLITE=<path> node hepb_sql_test.mjs
import fs from 'fs'; import path from 'path'
const ROOT = path.dirname(new URL(import.meta.url).pathname)
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 500)])
const sq = fs.readFileSync(path.join(ROOT, 'supabase/hepb-vaccination.sql'), 'utf8'), rb = fs.readFileSync(path.join(ROOT, 'supabase/hepb-vaccination-rollback.sql'), 'utf8')
ck('no em dash in the SQL', !/—/.test(sq + rb))
ck('the install deletes and truncates nothing (outside comments)', !/\bdelete\s+from\b|\btruncate\s+(table\s+)?public\./i.test(sq.replace(/--.*$/gm, '')))
ck('the rollback drops no table and empties no bucket', !/drop\s+table|delete\s+from|storage\.buckets/i.test(rb.replace(/--.*$/gm, '')))
if (!process.env.PGLITE) ck('PGLITE is set (the database half needs it)', false)
else {
  const { PGlite } = await import(process.env.PGLITE); const db = new PGlite()
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, created_at timestamptz default now(), updated_at timestamptz default now(), metadata jsonb);
    create table public.client_journey_step_def (key text primary key, catalog_version int, def jsonb, active boolean, updated_by text, updated_at timestamptz default now());
    insert into public.client_journey_step_def values ('cg.approve.work', 1, '{"after": ["cg.training.orientation"]}', true, 'seed');
    grant select on public.client_journey_step_def to authenticated;`)
  const tryq = async (q, a) => { try { await db.query(q, a); return 'ok' } catch (e) { return String(e.message || e) } }
  const one = async (q, a) => (await db.query(q, a)).rows[0]
  await db.exec(sq); await db.exec(sq)
  ck('installs twice cleanly', true)
  const b = await one(`select * from storage.buckets where id = 'hepb-docs'`)
  ck('the bucket hepb-docs: private, 15 MB, images and PDF only', b && b.public === false && Number(b.file_size_limit) === 15728640 && b.allowed_mime_types.length === 5 && b.allowed_mime_types.includes('application/pdf'), b)
  await db.exec(`update storage.buckets set public = true where id = 'hepb-docs'`); await db.exec(sq)
  ck('a bucket someone made public is made private again by a re-run', (await one(`select public from storage.buckets where id = 'hepb-docs'`)).public === false)
  const priv = await one(`select has_table_privilege('authenticated', 'public.hepb_record', 'select') a, has_table_privilege('anon', 'public.hepb_record', 'select') b, has_table_privilege('authenticated', 'public.hepb_document', 'select') c,
    has_table_privilege('authenticated', 'public.hepb_event', 'insert') d, has_table_privilege('anon', 'public.hepb_document', 'insert') e`)
  ck('confidential medical records: no browser role reads or writes any hepatitis B table', !priv.a && !priv.b && !priv.c && !priv.d && !priv.e, priv)
  ck('row level security is on for all three tables', (await one(`select count(*)::int n from pg_class where relname in ('hepb_record', 'hepb_event', 'hepb_document') and relrowsecurity`)).n === 3)
  const id = (await one(`insert into public.hepb_record (offer_id, name, exposed, status) values ('11111111-1111-4111-8111-111111111111', 'Ava Lee', true, 'pending') returning id`)).id
  let r = await tryq(`insert into public.hepb_record (name, exposed, status) values ('Nobody', true, 'pending')`)
  ck('a record must belong to an offer or a caregiver', /hepb_record_someone/.test(r), r)
  r = await tryq(`insert into public.hepb_record (caregiver_id, exposed, status) values ('7', true, 'mandatory')`)
  ck('status is one of the eight (there is no "required" status: the vaccine is never mandatory)', /check/.test(r), r)
  r = await tryq(`insert into public.hepb_record (caregiver_id, status) values ('8', 'pending')`)
  ck('the exposure decision is never left blank', /null/.test(r), r)
  r = await tryq(`update public.hepb_record set caregiver_id = '42' where id = $1`, [id]); ck('a record can be linked to its roster caregiver once', r === 'ok', r)
  r = await tryq(`update public.hepb_record set caregiver_id = '43' where id = $1`, [id]); ck('...and that link never changes after', /never changes/.test(r), r)
  r = await tryq(`update public.hepb_record set status = 'declined', declined_at = now(), declination_pdf = 'hb/x/declination/v1.pdf', declination_fingerprint = 'f', declination_typed_name = 'Ava Lee' where id = $1`, [id]); ck('a declination is recorded', r === 'ok', r)
  r = await tryq(`update public.hepb_record set declination_typed_name = 'Someone Else' where id = $1`, [id]); ck('a signed declination is never changed', /never changed/.test(r), r)
  r = await tryq(`update public.hepb_record set declined_at = null, declination_pdf = null where id = $1`, [id]); ck('...nor erased', /never changed/.test(r), r)
  r = await tryq(`update public.hepb_record set status = 'vaccine', choice_at = now() where id = $1`, [id]); ck('after declining, choosing the vaccine is allowed (the declination stays)', r === 'ok' && (await one(`select declination_pdf from public.hepb_record where id = $1`, [id])).declination_pdf, r)
  r = await tryq(`delete from public.hepb_record where id = $1`, [id]); ck('a record is never deleted', /never deleted/.test(r), r)
  r = await tryq(`truncate public.hepb_record cascade`); ck('the records are never emptied', /never deleted/.test(r), r)
  await db.query(`insert into public.hepb_event (hepb_id, kind, detail) values ($1, 'chose', '{}')`, [id])
  r = await tryq(`update public.hepb_event set kind = 'note'`); ck('history is append-only (no change)', /append-only/.test(r), r)
  r = await tryq(`delete from public.hepb_event`); ck('history is append-only (no removal)', /append-only/.test(r), r)
  r = await tryq(`insert into public.hepb_event (hepb_id, kind) values ($1, 'deleted')`, [id]); ck('history kinds are the known ones', /check/.test(r), r)
  const did = (await one(`insert into public.hepb_document (hepb_id, kind, path, uploaded_by) values ($1, 'titer_proof', 'hb/x/titer_proof/a.pdf', 'caregiver') returning id`, [id])).id
  r = await tryq(`update public.hepb_document set path = 'elsewhere' where id = $1`, [did]); ck('a document is never changed', /never changed/.test(r), r)
  r = await tryq(`delete from public.hepb_document where id = $1`, [did]); ck('a document is never deleted', /never deleted/.test(r), r)
  r = await tryq(`insert into public.hepb_document (hepb_id, kind, path, uploaded_by) values ($1, 'medical_history', 'hb/x/y.pdf', 'caregiver')`, [id]); ck('document kinds are the known ones', /check/.test(r), r)
  await db.exec(`insert into storage.objects (bucket_id, name) values ('hepb-docs', 'hb/x/declination/v1.pdf'), ('other', 'free.pdf')`)
  r = await tryq(`delete from storage.objects where bucket_id = 'hepb-docs'`); ck('a file in hepb-docs cannot be deleted', /cannot be deleted/.test(r), r)
  r = await tryq(`update storage.objects set name = 'moved.pdf' where bucket_id = 'hepb-docs'`); ck('...moved or renamed', /cannot be moved/.test(r), r)
  r = await tryq(`delete from storage.objects where bucket_id = 'other'`); ck('other buckets are untouched by the guard', r === 'ok', r)
  const d = await one(`select def, active from public.client_journey_step_def where key = 'cg.health.hepb'`)
  ck('the readiness row cg.health.hepb: active, caregiver, NOT required, after Approve to Work', d && d.active && d.def.subject === 'caregiver' && d.def.required === false && d.def.after.includes('cg.approve.work'), d)
  ck('Approve to Work does not wait for it', !(await one(`select def from public.client_journey_step_def where key = 'cg.approve.work'`)).def.after.includes('cg.health.hepb'))
  await db.exec(rb); await db.exec(rb)
  ck('rollback twice: the guard is gone, the row is off, every table and row stays', !(await one(`select count(*)::int n from pg_trigger where tgname = 'hepb_documents_keep'`)).n && !(await one(`select active from public.client_journey_step_def where key = 'cg.health.hepb'`)).active && (await one(`select count(*)::int n from public.hepb_record`)).n === 1 && (await one(`select count(*)::int n from public.hepb_event`)).n === 1)
  await db.exec(sq); ck('re-install after rollback: the row is active again', (await one(`select active from public.client_journey_step_def where key = 'cg.health.hepb'`)).active)
}
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (note ? '  ' + note : ''))
console.log(`${res.filter((x) => x[1]).length}/${res.length} passed`); process.exit(res.every((x) => x[1]) ? 0 : 1)
