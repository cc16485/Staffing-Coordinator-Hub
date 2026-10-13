// 700: seven-year retention for signed onboarding records, in a real Postgres.  PGLITE=<path> node onboarding_retention_700_test.mjs
import fs from 'fs'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 500)])
const sq = fs.readFileSync('supabase/onboarding-retention-700.sql', 'utf8'), rb = fs.readFileSync('supabase/onboarding-retention-700-rollback.sql', 'utf8')
ck('no em dash in the SQL', !/—/.test(sq + rb))
ck('the file deletes and updates nothing (no delete from, no update, no truncate outside comments)', !/\bdelete\s+from\b|\bupdate\s+public\.|\btruncate\b/i.test(sq.replace(/--.*$/gm, '')))
if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE); const db = new PGlite()
  await db.exec(`create role anon nologin; create role authenticated nologin; create schema storage;
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, created_at timestamptz default now(), updated_at timestamptz default now(), metadata jsonb);
    create table public.step1_forms (id uuid primary key default gen_random_uuid(), offer_id uuid unique, started_at timestamptz, completed_at timestamptz, practice boolean not null default false, created_at timestamptz default now(), updated_at timestamptz default now());
    insert into storage.objects (bucket_id, name) values ('onboarding-documents', 'step1/o1/vehicle-v3-x.pdf'), ('onboarding-documents', 'offers/o1/offer.pdf'), ('onboarding-documents', 'exports/o1/file.pdf'), ('lead-docs', 'x/y.pdf');
    insert into public.step1_forms (offer_id, started_at, completed_at, updated_at) values ('11111111-1111-4111-8111-111111111111', '2026-10-10T15:00:00Z', '2026-10-11T15:00:00Z', '2026-10-11T15:00:00Z');`)
  await db.exec(sq); await db.exec(sq)
  ck('installs twice cleanly', true)
  const tryq = async (q) => { try { await db.exec(q); return 'ok' } catch (e) { return String(e.message || e) } }
  let r = await tryq(`delete from storage.objects where name = 'step1/o1/vehicle-v3-x.pdf'`)
  ck('a signed Step 1 PDF cannot be deleted', /kept for seven years and cannot be deleted/.test(r), r)
  r = await tryq(`delete from storage.objects where name = 'offers/o1/offer.pdf'`)
  ck('a signed offer letter cannot be deleted', /cannot be deleted/.test(r), r)
  r = await tryq(`update storage.objects set name = 'step1/o1/moved.pdf' where name = 'step1/o1/vehicle-v3-x.pdf'`)
  ck('...or renamed', /cannot be moved or renamed/.test(r), r)
  r = await tryq(`update storage.objects set bucket_id = 'lead-docs' where name = 'step1/o1/vehicle-v3-x.pdf'`)
  ck('...or moved to another bucket', /cannot be moved or renamed/.test(r), r)
  r = await tryq(`update storage.objects set metadata = '{"size": 1}' where name = 'step1/o1/vehicle-v3-x.pdf'`)
  ck('the storage service may still update its own details (metadata) on a kept file', r === 'ok', r)
  r = await tryq(`delete from storage.objects where name = 'exports/o1/file.pdf'`)
  ck('a personnel-file export (a copy made on request) can still be replaced', r === 'ok', r)
  r = await tryq(`delete from storage.objects where bucket_id = 'lead-docs'`)
  ck('other buckets are untouched by this guard', r === 'ok', r)
  ck('both signed files are still there', Number((await db.query(`select count(*) n from storage.objects where bucket_id = 'onboarding-documents'`)).rows[0].n) === 2)
  r = await tryq(`begin; set local cc.retention_purge = 'on'; delete from storage.objects where name = 'offers/o1/offer.pdf'; rollback;`)
  ck('only a deliberate purge (its own setting, in its own transaction) could remove one; here rolled back', r === 'ok', r)
  ck('...and after it the file is still there and the guard is back', Number((await db.query(`select count(*) n from storage.objects where name = 'offers/o1/offer.pdf'`)).rows[0].n) === 1 && /cannot be deleted/.test(await tryq(`delete from storage.objects where name = 'offers/o1/offer.pdf'`)))
  const v = (await db.query(`select * from public.onboarding_retention`)).rows[0]
  ck('the retention view: seven years after completion for someone never hired, and the rule for hires', v && String(v.earliest_removal_if_never_hired.toISOString?.() || v.earliest_removal_if_never_hired).startsWith('2033-10-11') && /seven years after they leave/.test(v.if_hired), v)
  await db.exec(rb); await db.exec(rb)
  r = await tryq(`delete from storage.objects where name = 'offers/o1/offer.pdf'`)
  ck('rollback (twice) removes only the guard and the view', r === 'ok' && (await tryq('select * from public.onboarding_retention')).includes('does not exist'), r)
}
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (note ? '  ' + note : ''))
console.log(`${res.filter((x) => x[1]).length}/${res.length} passed`); process.exit(res.every((x) => x[1]) ? 0 : 1)
