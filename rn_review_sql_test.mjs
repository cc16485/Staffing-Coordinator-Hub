// RN review (2026-10-14): nurse_flag, the RN's write-once GHE signature, the append-only history, the private bucket
// nurse-docs and its keep-guard, and the seven-year view, in a real Postgres with a fake storage schema.
//   PGLITE=<path> node rn_review_sql_test.mjs
import fs from 'fs'; import path from 'path'
const ROOT = path.dirname(new URL(import.meta.url).pathname)
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 500)])
const sq = fs.readFileSync(path.join(ROOT, 'supabase/nurse-review.sql'), 'utf8'), rb = fs.readFileSync(path.join(ROOT, 'supabase/nurse-review-rollback.sql'), 'utf8')
ck('no em dash in the SQL', !/\u2014/.test(sq + rb))
ck('the install deletes and truncates nothing, and grants nothing to a browser role (outside comments)', !/\bdelete\s+from\b|\btruncate\s+(table\s+)?public\./i.test(sq.replace(/--.*$/gm, '')) && !/grant[^;]*\bto\s+(anon|authenticated|public)\b/i.test(sq.replace(/--.*$/gm, '')))
ck('the rollback drops no table and empties no bucket', !/drop\s+table|delete\s+from|storage\.buckets/i.test(rb.replace(/--.*$/gm, '')))
if (!process.env.PGLITE) ck('PGLITE is set (the database half needs it)', false)
else {
  const { PGlite } = await import(process.env.PGLITE); const db = new PGlite()
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, created_at timestamptz default now(), updated_at timestamptz default now(), metadata jsonb);
    create table public.app_data (key text primary key, data jsonb, updated_at timestamptz default now(), version bigint not null default 0);
    /* the live access rule (ops-foundation 012 to 016): a signed-in page reads or writes a key only when its hub list holds the key's hub */
    create table public.app_data_key_hub_map (data_key text, hub_slug text);
    create function public.jwt_hub_access() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb -> 'app_metadata' -> 'hub_access' $$;
    create function public.can_access_data_key(k text) returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
      select public.jwt_hub_access() is null or exists (select 1 from public.app_data_key_hub_map m where m.data_key = k and public.jwt_hub_access() ? m.hub_slug) $$;
    alter table public.app_data enable row level security;
    create policy "Hub-scoped read/write" on public.app_data for all to public using (public.can_access_data_key(key)) with check (public.can_access_data_key(key));
    grant select, insert, update, delete on public.app_data to authenticated;
    insert into public.app_data_key_hub_map values ('ghe_forms', 'care_coordinator'), ('nurse_staff', 'care_coordinator'), ('leads', 'care_coordinator'), ('caregivers', 'staffing'), ('caregivers', 'care_coordinator'), ('hub_portals', 'team_hub'), ('ops_settings', 'care_coordinator'), ('ops_settings', 'team_hub');
    insert into public.app_data (key, data) values ('ghe_forms', '[]'), ('nurse_staff', '[]'), ('leads', '[{"id": "l1"}]'), ('caregivers', '[]'), ('hub_portals', '[]'), ('ops_settings', '{}');`)
  { const S9 = fs.readFileSync(path.join(ROOT, 'supabase/slice9-evidence.sql'), 'utf8')
    await db.exec(S9.slice(S9.indexOf('create or replace function public.ghe_forms_lock()'), S9.indexOf('-- ── bg_reviews'))) }
  const tryq = async (q, a) => { try { await db.query(q, a); return 'ok' } catch (e) { return String(e.message || e) } }
  const one = async (q, a) => (await db.query(q, a)).rows[0]
  { const bare = new PGlite(); let r0 = 'ok'; try { await bare.exec(sq) } catch (e) { r0 = String(e.message) }
    ck('without app_data the install refuses and creates nothing', /app_data is missing/.test(r0) && !(await bare.query(`select to_regclass('public.nurse_flag') t`)).rows[0].t, r0) }
  await db.exec(sq); await db.exec(sq)
  ck('installs twice cleanly', true)
  const b = await one(`select * from storage.buckets where id = 'nurse-docs'`)
  ck('the bucket nurse-docs: private, 10 MB, PDF only', b && b.public === false && Number(b.file_size_limit) === 10485760 && b.allowed_mime_types.join() === 'application/pdf', b)
  await db.exec(`update storage.buckets set public = true where id = 'nurse-docs'`); await db.exec(sq)
  ck('a bucket someone made public is made private again by a re-run', (await one(`select public from storage.buckets where id = 'nurse-docs'`)).public === false)
  const priv = await one(`select has_table_privilege('authenticated', 'public.nurse_flag', 'select') a, has_table_privilege('anon', 'public.nurse_flag', 'insert') b, has_table_privilege('authenticated', 'public.rn_ghe_signature', 'select') c,
    has_table_privilege('authenticated', 'public.rn_review_event', 'insert') d, has_table_privilege('authenticated', 'public.rn_review_retention', 'select') e, has_table_privilege('anon', 'public.rn_ghe_signature', 'update') f,
    has_table_privilege('service_role', 'public.nurse_flag', 'insert') g, has_table_privilege('service_role', 'public.rn_review_event', 'update') h`)
  ck('server only: no browser role reads or writes any table or the view; the server role writes flags and signatures, and only adds history', !priv.a && !priv.b && !priv.c && !priv.d && !priv.e && !priv.f && priv.g && !priv.h, priv)
  ck('row level security is on for all three tables', (await one(`select count(*)::int n from pg_class where relname in ('nurse_flag', 'rn_ghe_signature', 'rn_review_event') and relrowsecurity`)).n === 3)

  /* nurse_flag */
  let r = await tryq(`insert into public.nurse_flag (service_key, seen, by_name) values ('skin_monitoring', 'Red heel area.', 'Lena Park')`)
  ck('a mark must name the client (Hub or AxisCare)', /nurse_flag_client/.test(r), r)
  r = await tryq(`insert into public.nurse_flag (client_id, service_key, seen, by_name) values ('nc1', 'Skin Monitoring!', 'Red heel area.', 'Lena Park')`)
  ck('the service key is a plain key', /check/.test(r), r)
  r = await tryq(`insert into public.nurse_flag (client_id, service_key, seen, by_name) values ('nc1', 'skin_monitoring', 'Red', 'Lena Park')`)
  ck('what was seen needs a few words', /check/.test(r), r)
  const f = (await one(`insert into public.nurse_flag (client_id, client_axiscare_id, service_key, seen, by_name, rn_name) values ('nc1', '7001', 'skin_monitoring', 'Red heel area, 2 cm.', 'Lena Park', 'Natasha Early') returning id, status`))
  ck('a mark starts open', f.status === 'open')
  r = await tryq(`update public.nurse_flag set seen = 'something else' where id = $1`, [f.id])
  ck('what the LPN marked never changes', /never changed/.test(r), r)
  r = await tryq(`update public.nurse_flag set status = 'reviewed' where id = $1`, [f.id])
  ck('reviewed needs her note, who and when', /nurse_flag_review/.test(r), r)
  r = await tryq(`update public.nurse_flag set status = 'reviewed', rn_note = 'Offload heels; recheck Friday.', reviewed_at = now(), reviewed_by = 'Natasha Early' where id = $1`, [f.id])
  ck('the RN reviews it with her note', r === 'ok', r)
  r = await tryq(`update public.nurse_flag set rn_note = 'changed my mind' where id = $1`, [f.id])
  ck('a review is final', /final/.test(r), r)
  r = await tryq(`update public.nurse_flag set status = 'open', rn_note = null, reviewed_at = null, reviewed_by = null where id = $1`, [f.id])
  ck('a reviewed mark cannot be reopened', /final/.test(r), r)
  ck('a mark is never deleted or emptied', /never deleted/.test(await tryq(`delete from public.nurse_flag where id = $1`, [f.id])) && /never deleted/.test(await tryq(`truncate public.nurse_flag`)))

  /* the signature */
  const ins = (g) => tryq(`insert into public.rn_ghe_signature (ghe_id, rn_name, rn_email, typed_name, consent, consent_words, version, form_fingerprint) values ($1, 'Natasha Early', 'natasha@mo-care.com', 'Natasha Early', true, 'I agree', 1, $2)`, [g, 'a'.repeat(64)])
  ck('a signature is recorded', (await ins('g1')) === 'ok')
  ck('one signature per GHE form: a second is refused by the database', /unique|duplicate/.test(await ins('g1')))
  r = await tryq(`insert into public.rn_ghe_signature (ghe_id, rn_name, rn_email, typed_name, consent, consent_words, version, form_fingerprint) values ('g2', 'N', 'n@x', 'Natasha Early', false, 'I agree', 1, $1)`, ['a'.repeat(64)])
  ck('no signature without consent', /check/.test(r), r)
  r = await tryq(`insert into public.rn_ghe_signature (ghe_id, rn_name, rn_email, typed_name, consent, consent_words, version, form_fingerprint) values ('g3', 'N', 'n@x', 'Natasha Early', true, 'I agree', 1, 'nope')`)
  ck('the fingerprint is a sha-256', /check/.test(r), r)
  ck('the typed name, the time and the fingerprint never change', /write-once/.test(await tryq(`update public.rn_ghe_signature set typed_name = 'Someone Else' where ghe_id = 'g1'`)) && /write-once/.test(await tryq(`update public.rn_ghe_signature set signed_at = now() - interval '1 day' where ghe_id = 'g1'`)))
  ck('the PDF path is set once', (await tryq(`update public.rn_ghe_signature set pdf_path = 'ghe/g1/a.pdf' where ghe_id = 'g1'`)) === 'ok' && /never changes/.test(await tryq(`update public.rn_ghe_signature set pdf_path = 'ghe/g1/b.pdf' where ghe_id = 'g1'`)))
  ck('the form-updated time is set once', (await tryq(`update public.rn_ghe_signature set form_updated_at = now() where ghe_id = 'g1'`)) === 'ok' && /set once/.test(await tryq(`update public.rn_ghe_signature set form_updated_at = now() + interval '1 hour' where ghe_id = 'g1'`)))
  ck('a signature is never deleted', /never deleted/.test(await tryq(`delete from public.rn_ghe_signature`)) && /never deleted/.test(await tryq(`truncate public.rn_ghe_signature`)))

  /* the history */
  await db.exec(`insert into public.rn_review_event (kind, ghe_id, by_name, detail) values ('signed', 'g1', 'Natasha Early', '{"consent": true}')`)
  ck('the history is append-only', /append-only/.test(await tryq(`update public.rn_review_event set kind = 'sent_back'`)) && /append-only/.test(await tryq(`delete from public.rn_review_event`)) && /append-only/.test(await tryq(`truncate public.rn_review_event`)))
  ck('only known kinds of history line', /check/.test(await tryq(`insert into public.rn_review_event (kind) values ('opened')`)))

  /* the files */
  await db.exec(`insert into storage.objects (bucket_id, name) values ('nurse-docs', 'ghe/g1/a.pdf'), ('driver-docs', 'x.pdf')`)
  ck('a signed nursing PDF cannot be deleted', /kept for seven years and cannot be deleted/.test(await tryq(`delete from storage.objects where bucket_id = 'nurse-docs'`)))
  ck('...moved or renamed', /cannot be moved or renamed/.test(await tryq(`update storage.objects set name = 'elsewhere.pdf' where bucket_id = 'nurse-docs'`)) && /cannot be moved or renamed/.test(await tryq(`update storage.objects set bucket_id = 'other' where bucket_id = 'nurse-docs'`)))
  ck('...its other details may still be updated by storage (metadata)', (await tryq(`update storage.objects set metadata = '{"size": 1}' where bucket_id = 'nurse-docs'`)) === 'ok')
  ck('files in other buckets are not this guard\'s business', (await tryq(`delete from storage.objects where bucket_id = 'driver-docs'`)) === 'ok')
  ck('the only door is a deliberate purge setting in its own transaction', (await db.exec(`begin; set local cc.retention_purge = 'on'; delete from storage.objects where bucket_id = 'nurse-docs'; rollback;`).then(() => 'ok', (e) => String(e.message))) === 'ok' && (await one(`select count(*)::int n from storage.objects where bucket_id = 'nurse-docs'`)).n === 1)
  const v = (await db.query(`select * from public.rn_review_retention order by what`)).rows
  ck('the seven-year view: each signature and mark with its earliest removal date', v.length === 2 && v.every((x) => x.earliest_removal) && v.some((x) => x.what === 'signature' && x.ghe_id === 'g1'), v)

  /* ── RLS: an account whose hub list is exactly ["rn_review"] reaches no app_data key ── */
  const as = async (claims, fn) => { await db.exec(`select set_config('request.jwt.claims', '${JSON.stringify(claims)}', false); set role authenticated;`); try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claims', '', false);`) } }
  const RN = { role: 'authenticated', email: 'natasha@mo-care.com', app_metadata: { hub_access: ['rn_review'] } }, CC = { role: 'authenticated', app_metadata: { hub_access: ['care_coordinator'] } }
  ck('no app_data key is mapped to rn_review (the slug unlocks nothing)', (await one(`select count(*)::int n from public.app_data_key_hub_map where hub_slug = 'rn_review'`)).n === 0)
  const rnSees = await as(RN, async () => (await db.query(`select key from public.app_data`)).rows.length)
  const rnCan = await as(RN, async () => (await db.query(`select public.can_access_data_key(k) ok from unnest(array['ghe_forms','leads','caregivers','hub_portals','ops_settings','nurse_staff']) k`)).rows.some((r) => r.ok))
  ck('RLS: an rn_review-only sign-in reads no app_data key at all (ghe_forms, leads, caregivers, ops_settings, nurse_staff, Team Hub keys)', rnSees === 0 && rnCan === false, [rnSees, rnCan])
  const rnWrite = await as(RN, async () => [await tryq(`update public.app_data set data = '[]' where key = 'leads'`).then(() => (one(`select data from public.app_data where key = 'leads'`))), await tryq(`insert into public.app_data (key, data) values ('rn_sneak', '[]')`)])
  ck('RLS: ...and cannot write one (an update touches nothing; a new key is refused)', JSON.stringify((await one(`select data from public.app_data where key = 'leads'`)).data) === '[{"id":"l1"}]' && /row-level security|policy/i.test(rnWrite[1]), rnWrite)
  const ccSees = await as(CC, async () => (await db.query(`select key from public.app_data order by key`)).rows.map((r) => r.key).join())
  ck('RLS: the same check lets a Care Coordinator Hub sign-in read its keys (the test is real)', ccSees === 'caregivers,ghe_forms,leads,nurse_staff,ops_settings', ccSees)
  const allSees = await as({ role: 'authenticated', app_metadata: {} }, async () => (await db.query(`select key from public.app_data`)).rows.length)
  ck('RLS, the shared-project risk stated: a sign-in with NO hub list reads every key (why Natasha\'s account must be RN review only)', allSees === 6, allSees)

  /* ── her signature on the GHE form is kept, without waiting for the participant ── */
  const F = (o) => ({ id: 'g9', client: 'Ada Client', visit_date: '2026-10-06', nurse: 'Lena Park', total: 9, checks: ['#ghe_reason_grid input[value="ghe"]'], radios: { ghe_s_mobility: '3' }, sig_nurse: 'data:image/png;base64,AAA', sig_part: '', f: { ghe_bp: '128/80', ghe_sig_part_date: '', ghe_sig_sup_date: '' }, status: 'rn_review', ...o })
  const put = (arr) => tryq(`update public.app_data set data = $1::jsonb where key = 'ghe_forms'`, [JSON.stringify(arr)])
  const ghe = async () => (await one(`select data from public.app_data where key = 'ghe_forms'`)).data
  ck('before she signs, an unsigned form saves freely', (await put([F()])) === 'ok' && (await put([F({ f: { ghe_bp: '130/80', ghe_sig_part_date: '', ghe_sig_sup_date: '' } })])) === 'ok')
  const sid = (await one(`insert into public.rn_ghe_signature (ghe_id, rn_name, rn_email, typed_name, consent, consent_words, version, form_fingerprint) values ('g9', 'Natasha Early', 'natasha@mo-care.com', 'Natasha Early', true, 'I agree', 1, $1) returning id`, ['b'.repeat(64)])).id
  const SIGNED = F({ f: { ghe_bp: '130/80', ghe_sig_part_date: '', ghe_sig_sup_date: '2026-10-14' }, status: 'ready', sig_sup: 'data:image/png;base64,SIG', rn_reviewer: 'Natasha Early', rn_reviewed_at: '2026-10-14T15:00:00Z', rn_reviewed_by: 'natasha@mo-care.com', rn_signature: { id: sid, typed_name: 'Natasha Early' } })
  ck('the server writes her signature onto the form (no participant signature yet)', (await put([SIGNED])) === 'ok' && (await ghe())[0].sig_sup === 'data:image/png;base64,SIG')
  ck('a later save that redraws or blanks her signature, or drops the reviewer, keeps hers exactly (participant not signed)', (await put([{ ...SIGNED, sig_sup: 'data:image/png;base64,REDRAWN', rn_reviewer: '', rn_signature: undefined, f: { ...SIGNED.f, ghe_sig_sup_date: '2026-10-15' } }])) === 'ok'
    && (await ghe())[0].sig_sup === 'data:image/png;base64,SIG' && (await ghe())[0].rn_reviewer === 'Natasha Early' && (await ghe())[0].rn_signature.id === sid && (await ghe())[0].f.ghe_sig_sup_date === '2026-10-14', await ghe())
  ck('...and the same as a signed-in Care Coordinator Hub page (through RLS)', (await as(CC, () => put([{ ...SIGNED, sig_sup: '' }]))) === 'ok' && (await ghe())[0].sig_sup === 'data:image/png;base64,SIG')
  ck('what she signed cannot change: an answer, the score, the nurse', /answers cannot change/.test(await put([{ ...SIGNED, f: { ...SIGNED.f, ghe_bp: '150/95' } }])) && /total cannot change/.test(await put([{ ...SIGNED, total: 12 }])) && /nurse cannot change/.test(await put([{ ...SIGNED, nurse: 'Lou Lane' }])))
  ck('the signed form cannot be removed (array save without it, or deleting the key)', /cannot be removed/.test(await put([])) && /cannot be removed/.test(await tryq(`delete from public.app_data where key = 'ghe_forms'`)))
  const PART = { ...SIGNED, sig_part: 'data:image/png;base64,PART', f: { ...SIGNED.f, ghe_sig_part_date: '2026-10-16' } }
  ck('the participant can still sign after her (HCBS 8.00 Appendix 4 sets no order), and the office can mark it uploaded', (await put([PART])) === 'ok' && (await put([{ ...PART, status: 'uploaded', uploaded_on: '2026-10-17' }])) === 'ok' && (await ghe())[0].sig_part === 'data:image/png;base64,PART' && (await ghe())[0].status === 'uploaded')
  ck('an Amend still works: the signed form is kept, marked replaced, beside its corrected copy', (await put([{ ...PART, status: 'uploaded', uploaded_on: '2026-10-17', superseded_by: 'g10' }, { id: 'g10', client: 'Ada Client', status: 'draft', amends: 'g9' }])) === 'ok')
  ck('a form whose rn_signature names no real signature row is not protected by this (it is not her signature)', (await put([{ ...PART, status: 'uploaded', uploaded_on: '2026-10-17', superseded_by: 'g10' }, { id: 'g10', client: 'Ada Client', status: 'draft', amends: 'g9' }, F({ id: 'g11', rn_signature: { id: '00000000-0000-4000-8000-000000000000' }, sig_sup: 'x' })])) === 'ok'
    && (await put([{ ...PART, status: 'uploaded', uploaded_on: '2026-10-17', superseded_by: 'g10' }, { id: 'g10', client: 'Ada Client', status: 'draft', amends: 'g9' }, F({ id: 'g11', sig_sup: '' })])) === 'ok')
  ck('the keeper runs as its owner, before the slice 9 lock, and no browser role may call it', (await one(`select prosecdef from pg_proc where proname = 'ghe_rn_signature_keep'`)).prosecdef === true
    && (await one(`select string_agg(tgname, ',' order by tgname) t from pg_trigger where tgrelid = 'public.app_data'::regclass and not tgisinternal`)).t === 'ghe_forms_a_rn_keep_t,ghe_forms_lock_t'
    && !(await one(`select has_function_privilege('authenticated', 'public.ghe_rn_signature_keep()', 'execute') a`)).a)

  await db.exec(rb); await db.exec(rb)
  ck('rollback twice: the storage guard, the GHE signature keeper and the view are gone; every table, row and file stays', (await one(`select count(*)::int n from pg_trigger where tgname in ('nurse_documents_keep', 'ghe_forms_a_rn_keep_t')`)).n === 0 && !(await one(`select to_regclass('public.rn_review_retention') v`)).v
    && (await one(`select count(*)::int n from public.rn_ghe_signature`)).n === 2 && (await one(`select count(*)::int n from public.nurse_flag`)).n === 1 && (await one(`select count(*)::int n from storage.objects where bucket_id = 'nurse-docs'`)).n === 1)
  await db.exec(sq)
  ck('and it installs again after a rollback', (await one(`select count(*)::int n from pg_trigger where tgname in ('nurse_documents_keep', 'ghe_forms_a_rn_keep_t')`)).n === 2)
}
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (note ? '  ' + note : ''))
console.log(`${res.filter((x) => x[1]).length}/${res.length} passed`); process.exit(res.every((x) => x[1]) ? 0 : 1)
