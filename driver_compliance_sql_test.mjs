// Driver compliance (2026-10-13): the tables, the history guards, the private bucket and its keep-guard, and the roster
// door, in a real Postgres with a fake storage schema.  PGLITE=<path> node driver_compliance_sql_test.mjs
import fs from 'fs'; import path from 'path'
const ROOT = path.dirname(new URL(import.meta.url).pathname)
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 500)])
const sq = fs.readFileSync(path.join(ROOT, 'supabase/driver-compliance.sql'), 'utf8'), rb = fs.readFileSync(path.join(ROOT, 'supabase/driver-compliance-rollback.sql'), 'utf8')
ck('no em dash in the SQL', !/—/.test(sq + rb))
ck('the install deletes and truncates nothing (outside comments)', !/\bdelete\s+from\b|\btruncate\s+(table\s+)?public\./i.test(sq.replace(/--.*$/gm, '')))
ck('the rollback drops no table and empties no bucket', !/drop\s+table|delete\s+from|storage\.buckets/i.test(rb.replace(/--.*$/gm, '')))
if (!process.env.PGLITE) ck('PGLITE is set (the database half needs it)', false)
else {
  const { PGlite } = await import(process.env.PGLITE); const db = new PGlite()
  const SS = fs.readFileSync(path.join(ROOT, 'safe_saves_2.sql'), 'utf8')
  const revFns = SS.slice(SS.indexOf('create or replace function public.app_data_rev('), SS.indexOf('-- ── 2. numbers are never reused'))
  const S9 = fs.readFileSync(path.join(ROOT, 'supabase/slice9-evidence.sql'), 'utf8')
  const efk = S9.slice(S9.indexOf('create or replace function public.evidence_field_kept('), S9.indexOf('-- signatures, GHE answers'))
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, created_at timestamptz default now(), updated_at timestamptz default now(), metadata jsonb);
    create table public.app_data (key text primary key, data jsonb, updated_at timestamptz default now(), version bigint not null default 0);
    create table public.app_data_item_change (id bigserial primary key, at timestamptz default now(), key text, record_id text, change text, fields_changed text[], bulk_removed boolean, actor text, role text, origin text, names text, error text);
    ${revFns}
    ${efk}
    grant select on public.app_data to authenticated;`)
  const tryq = async (q, a) => { try { await db.query(q, a); return 'ok' } catch (e) { return String(e.message || e) } }
  const one = async (q, a) => (await db.query(q, a)).rows[0]
  /* the guard refuses before anything when a foundation is missing */
  { const bare = new PGlite(); await bare.exec(`create schema storage; create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]); create table storage.objects (bucket_id text, name text);`)
    let r = 'ok'; try { await bare.exec(sq) } catch (e) { r = String(e.message) }
    ck('without the 421 counter the install refuses and creates nothing', /app_data_rev \(421\) is missing/.test(r) && !(await bare.query(`select to_regclass('public.driver_compliance') as t`)).rows[0].t, r) }

  await db.exec(sq); await db.exec(sq)
  ck('installs twice cleanly', true)
  const b = await one(`select * from storage.buckets where id = 'driver-docs'`)
  ck('the bucket driver-docs: private, 15 MB, images (jpeg, png, heic, webp) and PDF only', b && b.public === false && Number(b.file_size_limit) === 15728640 && ['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf'].every((m) => b.allowed_mime_types.includes(m)) && b.allowed_mime_types.length === 5, b)
  await db.exec(`update storage.buckets set public = true, file_size_limit = 999999999 where id = 'driver-docs'`); await db.exec(sq)
  ck('a bucket someone made public is made private again by a re-run', (await one(`select public, file_size_limit from storage.buckets where id = 'driver-docs'`)).public === false)
  const priv = await one(`select has_table_privilege('authenticated', 'public.driver_compliance', 'select') a, has_table_privilege('anon', 'public.driver_document', 'insert') b, has_table_privilege('authenticated', 'public.driver_compliance_event', 'insert') c,
    has_function_privilege('authenticated', 'public.driver_roster_patch(text, bigint, jsonb, text)', 'execute') d, has_function_privilege('anon', 'public.driver_roster_patch(text, bigint, jsonb, text)', 'execute') e,
    has_function_privilege('service_role', 'public.driver_roster_patch(text, bigint, jsonb, text)', 'execute') f`)
  ck('server only: no browser role reads or writes the tables or calls the door; the server role may', !priv.a && !priv.b && !priv.c && !priv.d && !priv.e && priv.f, priv)
  ck('row level security is on for all three tables', (await one(`select count(*)::int n from pg_class where relname in ('driver_compliance', 'driver_compliance_event', 'driver_document') and relrowsecurity`)).n === 3)

  /* the record */
  const dc = (await one(`insert into public.driver_compliance (offer_id, name, status) values ('11111111-1111-4111-8111-111111111111', 'Ava Lee', 'pending') returning id`)).id
  let r = await tryq(`insert into public.driver_compliance (name, status) values ('Nobody', 'pending')`)
  ck('a record must belong to an offer or a caregiver', /driver_compliance_someone/.test(r), r)
  r = await tryq(`insert into public.driver_compliance (caregiver_id, status) values ('7', 'cleared')`)
  ck('status is one of non_driver, pending, approved, suspended', /check/.test(r), r)
  r = await tryq(`update public.driver_compliance set caregiver_id = '42' where id = $1`, [dc])
  ck('a Step 1 record can be linked to its roster caregiver once', r === 'ok', r)
  r = await tryq(`update public.driver_compliance set caregiver_id = '43' where id = $1`, [dc])
  ck('...and that link never changes after', /never changes/.test(r), r)
  r = await tryq(`update public.driver_compliance set offer_id = '22222222-1111-4111-8111-111111111111' where id = $1`, [dc])
  ck('the offer a record belongs to never changes', /never changes/.test(r), r)
  r = await tryq(`update public.driver_compliance set mvr_result = 'fine' where id = $1`, [dc])
  ck('the driving record result is acceptable or not_acceptable only', /check/.test(r), r)
  r = await tryq(`delete from public.driver_compliance where id = $1`, [dc])
  ck('a record is never deleted', /never deleted/.test(r), r)
  r = await tryq(`truncate public.driver_compliance cascade`)
  ck('...or emptied', /never deleted/.test(r), r)

  /* the history */
  await db.query(`insert into public.driver_compliance_event (dc_id, kind, by_name, detail) values ($1, 'created', 'Step 1', '{"a": 1}')`, [dc])
  r = await tryq(`insert into public.driver_compliance_event (dc_id, kind) values ($1, 'made_up')`, [dc])
  ck('history kinds are the fixed list', /check/.test(r), r)
  r = await tryq(`update public.driver_compliance_event set by_name = 'Someone else'`)
  ck('a history line is never changed', /append-only/.test(r), r)
  r = await tryq(`delete from public.driver_compliance_event`)
  ck('a history line is never removed', /append-only/.test(r), r)
  r = await tryq(`truncate public.driver_compliance_event`)
  ck('the history is never emptied', /append-only/.test(r), r)
  ck('the history line is still there, as written', (await one(`select count(*)::int n, max(by_name) b from public.driver_compliance_event`)).b === 'Step 1')

  /* the documents */
  const doc = (await one(`insert into public.driver_document (dc_id, kind, path, content_type, uploaded_by, expires) values ($1, 'license_front', 'offer/11111111-1111-4111-8111-111111111111/lf.jpg', 'image/jpeg', 'caregiver', '2029-01-01') returning id`, [dc])).id
  r = await tryq(`insert into public.driver_document (dc_id, kind, path, uploaded_by) values ($1, 'license_front', 'offer/11111111-1111-4111-8111-111111111111/lf.jpg', 'caregiver')`, [dc])
  ck('the same file is recorded once (dc, path unique)', /unique|duplicate/.test(r), r)
  r = await tryq(`insert into public.driver_document (dc_id, kind, path, uploaded_by) values ($1, 'selfie', 'x', 'caregiver')`, [dc])
  ck('document kinds are the fixed list', /check/.test(r), r)
  r = await tryq(`update public.driver_document set path = 'elsewhere.jpg' where id = $1`, [doc])
  ck('an uploaded document never changes its path', /never changed/.test(r), r)
  r = await tryq(`update public.driver_document set verified_at = now(), verified_by = 'Krystal' where id = $1`, [doc])
  ck('a verification may be added', r === 'ok', r)
  r = await tryq(`update public.driver_document set verified_by = 'Someone else' where id = $1`, [doc])
  ck('...and never changed after', /verification is never changed/.test(r), r)
  r = await tryq(`update public.driver_document set superseded_at = now() where id = $1`, [doc])
  ck('a newer document may supersede it', r === 'ok', r)
  r = await tryq(`update public.driver_document set superseded_at = null where id = $1`, [doc])
  ck('...and it stays superseded', /stays superseded/.test(r), r)
  r = await tryq(`delete from public.driver_document where id = $1`, [doc])
  ck('a document row is never deleted', /never deleted/.test(r), r)

  /* the storage keep-guard */
  await db.exec(`insert into storage.objects (bucket_id, name) values ('driver-docs', 'dc/x/license_front/1.jpg'), ('onboarding-documents', 'driver/x/vehicle.pdf'), ('lead-docs', 'a/b.pdf')`)
  r = await tryq(`delete from storage.objects where name = 'dc/x/license_front/1.jpg'`)
  ck('a driver document file cannot be deleted', /cannot be deleted/.test(r), r)
  r = await tryq(`update storage.objects set name = 'dc/x/license_front/2.jpg' where name = 'dc/x/license_front/1.jpg'`)
  ck('...or renamed', /cannot be moved or renamed/.test(r), r)
  r = await tryq(`update storage.objects set bucket_id = 'lead-docs' where name = 'dc/x/license_front/1.jpg'`)
  ck('...or moved to another bucket', /cannot be moved or renamed/.test(r), r)
  r = await tryq(`update storage.objects set metadata = '{"size": 3}' where name = 'dc/x/license_front/1.jpg'`)
  ck('storage may still update its own details on a kept file', r === 'ok', r)
  r = await tryq(`delete from storage.objects where bucket_id = 'lead-docs'`)
  ck('other buckets are untouched by this guard', r === 'ok', r)

  /* the roster door */
  await db.exec(`insert into public.app_data (key, data) values ('caregivers', '[{"id": "7", "first": "Ava", "last": "Lee", "dl_expires": "2026-01-01", "dl_proof": "typed.pdf", "orient_date": "2026-09-01"}, {"id": "8", "first": "Ben"}, {"id": "d", "first": "X"}, {"id": "d", "first": "Y"}]')`)
  const door = async (id, base, patch, by) => (await one('select public.driver_roster_patch($1, $2, $3::jsonb' + (by ? ', $4' : '') + ') as r', by ? [id, base, JSON.stringify(patch), by] : [id, base, JSON.stringify(patch)])).r
  const cg = async (id) => (await one(`select x from public.app_data, jsonb_array_elements(data) x where key = 'caregivers' and x->>'id' = $1 limit 1`, [id])).x
  const P = { dl_status: 'Approved Driver', cleared_to_drive: true, dl_expires: '2029-01-01', auto_ins_expires: '2027-03-01', dl_approved_by: 'Samantha', dl_approved_at: '2026-10-13T15:00:00Z' }
  let d = await door('7', 0, P, 'driver-compliance approve'); let x = await cg('7')
  ck('door: writes the six driving fields only, keeps everything else, the database sets _rev 1', d.ok && x.dl_status === 'Approved Driver' && x.cleared_to_drive === true && x.dl_expires === '2029-01-01' && x.dl_proof === 'typed.pdf' && x.orient_date === '2026-09-01' && Number(x._rev) === 1 && d.rev === 1, [d, x])
  const h = await one(`select count(*)::int n, max(origin) o, max(actor) a, max(array_to_string(fields_changed, ',')) f from public.app_data_item_change where record_id = '7'`)
  ck('door: one history line tagged driver-compliance naming the fields', h.n === 1 && h.o === 'driver-compliance' && h.a === 'driver-compliance approve' && /cleared_to_drive/.test(h.f) && /dl_status/.test(h.f), h)
  d = await door('7', 0, { cleared_to_drive: false })
  ck('door: a stale _rev saves nothing and hands back the current record', !d.ok && d.reason === 'changed' && d.current_record.cleared_to_drive === true && (await cg('7')).cleared_to_drive === true, d)
  d = await door('7', 1, P)
  ck('door: nothing different, nothing saved (no second history line)', d.ok && d.unchanged === true && (await one(`select count(*)::int n from public.app_data_item_change`)).n === 1, d)
  r = await tryq(`select public.driver_roster_patch('7', 1, '{"orient_date": "2020-01-01"}'::jsonb)`)
  ck('door: any other roster field is refused', /not a field driver compliance may write/.test(r), r)
  r = await tryq(`select public.driver_roster_patch('7', 1, '{"dl_status": "Cleared"}'::jsonb)`)
  ck('door: dl_status only as one of the four labels', /must be Non-Driver/.test(r), r)
  r = await tryq(`select public.driver_roster_patch('7', 1, '{"cleared_to_drive": "yes"}'::jsonb)`)
  ck('door: cleared_to_drive only true or false', /true or false/.test(r), r)
  r = await tryq(`select public.driver_roster_patch('7', 1, '{"dl_expires": "next year"}'::jsonb)`)
  ck('door: dates only as YYYY-MM-DD', /must be a date/.test(r), r)
  ck('door: a missing caregiver or a shared number saves nothing', (await door('99', 0, P)).reason === 'gone' && (await door('d', 0, P)).reason === 'duplicate_id')
  ck('door: the history rule now keeps cleared_to_drive, dl_status and auto_ins_expires (never an SSN)', (await one(`select public.evidence_field_kept('caregivers', 'cleared_to_drive') a, public.evidence_field_kept('caregivers', 'dl_status') b, public.evidence_field_kept('caregivers', 'auto_ins_expires') c, public.evidence_field_kept('caregivers', 'dl_approved_by') e, public.evidence_field_kept('caregivers', 'ssn') s`)).a === true)
  const e2 = await one(`select public.evidence_field_kept('caregivers', 'dl_status') b, public.evidence_field_kept('caregivers', 'auto_ins_expires') c, public.evidence_field_kept('caregivers', 'dl_approved_by') e, public.evidence_field_kept('caregivers', 'ssn') s`)
  ck('...dl_status, auto_ins_expires and dl_approved_by were already kept; ssn never', e2.b && e2.c && e2.e && !e2.s, e2)

  await db.exec(rb); await db.exec(rb)
  r = await tryq(`delete from storage.objects where name = 'dc/x/license_front/1.jpg'`)
  const after = await one(`select to_regprocedure('public.driver_roster_patch(text, bigint, jsonb, text)') p, to_regclass('public.driver_compliance') t, (select count(*)::int from public.driver_compliance_event) n, (select count(*)::int from storage.buckets where id = 'driver-docs') b, public.evidence_field_kept('caregivers', 'cleared_to_drive') k`)
  ck('rollback (twice): the door, the storage guard and the history word go; the tables, the history and the bucket stay', r === 'ok' && !after.p && after.t && after.n === 1 && after.b === 1 && after.k === false, [r, after])
  await db.exec(sq)
  ck('re-install after a rollback works', !!(await one(`select to_regprocedure('public.driver_roster_patch(text, bigint, jsonb, text)') p`)).p)
}
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (note ? '  ' + note : ''))
console.log(`${res.filter((x) => x[1]).length}/${res.length} passed`); process.exit(res.every((x) => x[1]) ? 0 : 1)
