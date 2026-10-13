// STEP 1 LINK TIGHTEN (2026-10-13): step1_candidate_create links only on the same first name AND the same phone or email,
// never on a name alone, never flips an old-path record (a new record + one card naming both). Real Postgres (PGlite).
//   PGLITE=<path> node step1_link_tighten_sql_test.mjs
import fs from 'fs'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 600)])
const base = fs.readFileSync('supabase/step1-before-checks.sql', 'utf8')
const sq = fs.readFileSync('supabase/step1-link-tighten.sql', 'utf8'), rb = fs.readFileSync('supabase/step1-link-tighten-rollback.sql', 'utf8')
ck('no em dash in the SQL or the card words', !/—/.test(sq) && !/—/.test(rb))
ck('server only: revoked from public, anon, authenticated; granted to service_role (both files)', [sq, rb].every((s) => /revoke all on function public\.step1_candidate_create\(text, jsonb\) from public, anon, authenticated/.test(s) && /to service_role/.test(s)))
if (!process.env.PGLITE) { console.log('PGLITE not set: the database half was skipped') }
else {
  const { PGlite } = await import(process.env.PGLITE); const db = new PGlite()
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table public.app_data (key text primary key, data jsonb, updated_at timestamptz default now());
    create table public.app_data_id_counter (key text primary key, last_id bigint not null default 0, updated_at timestamptz default now());
    insert into public.app_data_id_counter values ('candidates', 120);
    create table public.client_journey_step_def (key text primary key, catalog_version int not null default 1, def jsonb not null, active boolean not null default true, updated_at timestamptz default now(), updated_by text);
    insert into public.client_journey_step_def (key, def) values ('cg.approve.advance', '{"after": []}'), ('cg.approve.work', '{"after": []}');
    create table public.persons (person_id text primary key, full_name text, primary_email text);
    create table public.domains (code text, entity text, owner_person text);
    insert into public.persons values ('p-kry', 'Krystal', 'Krystal@mo-care.com');
    insert into public.domains values ('recruiting_orientation', 'cc_ihs', 'p-kry');
    insert into public.app_data values ('candidates', '[
      {"id": 7, "first": "Real", "last": "Person", "phone": "4175551234"},
      {"id": 8, "first": "Linky", "last": "Same", "phone": "4175559999"},
      {"id": 9, "first": "Mail", "last": "Match", "phone": "", "email": "Mail.Match@Example.com"},
      {"id": 10, "first": "Olden", "last": "Path", "phone": "4175553333", "onboarding_path": "old"},
      {"id": 11, "first": "Gone", "last": "Away", "phone": "4175554444", "not_hired": true}]');`)
  await db.exec(base); await db.exec(sq); await db.exec(sq)
  const call = async (oid, rec) => (await db.query('select public.step1_candidate_create($1, $2) as r', [oid, JSON.stringify(rec)])).rows[0].r
  const list = async () => (await db.query(`select data from public.app_data where key = 'candidates'`)).rows[0].data
  const ops = async () => ((await db.query(`select data from public.app_data where key = 'ops_items'`)).rows[0] || { data: [] }).data
  const byId = async (id) => (await list()).find((x) => String(x.id) === String(id))
  /* a name alone never links */
  let r = await call('off-1', { first: 'real', last: 'PERSON', phone: '', email: '' })
  ck('the same first and last name with no phone or email match: a NEW record, the old one untouched', r.how === 'created' && r.id === 121 && !(await byId(7)).offer_id, r)
  r = await call('off-2', { first: 'Real', last: 'Person', phone: '417-555-0000', email: 'other@x.com' })
  ck('the same name with a different phone and email: a new record', r.how === 'created' && r.id === 122 && !(await byId(7)).offer_id, r)
  /* the same phone but a different first name: never linked */
  r = await call('off-3', { first: 'Someone', last: 'Same', phone: '4175559999' })
  ck('the same phone, a different first name: a new record (no link on the phone alone)', r.how === 'created' && !(await byId(8)).offer_id, r)
  /* same first name + phone: linked */
  r = await call('off-4', { first: ' LINKY ', last: 'Changed', phone: '+1 (417) 555-9999', onboarding_path: 'new' })
  let L8 = await byId(8)
  ck('the same first name and the same phone (last ten digits): linked, the offer id and the new path added, nothing else touched', r.how === 'linked' && String(r.id) === '8' && L8.offer_id === 'off-4' && L8.onboarding_path === 'new' && L8.last === 'Same', [r, L8])
  /* same first name + email: linked */
  r = await call('off-5', { first: 'Mail', last: 'Match', phone: '', email: 'mail.match@example.com ' })
  ck('the same first name and the same email (any case): linked', r.how === 'linked' && String(r.id) === '9' && (await byId(9)).offer_id === 'off-5', r)
  /* an old-path record is never flipped */
  r = await call('off-6', { first: 'Olden', last: 'Path', phone: '417.555.3333', onboarding_path: 'new' })
  const L10 = await byId(10), made = await byId(r.id), cards = await ops()
  ck('an old-path record with the same first name and phone: NOT flipped (no offer id, still old)', !L10.offer_id && L10.onboarding_path === 'old', L10)
  ck('a new record is made for the offer instead', r.ok && r.created && r.how === 'created_old_path_kept' && made && made.offer_id === 'off-6' && made.onboarding_path === 'new' && String(r.other_id) === '10', [r, made])
  const card = cards.find((x) => x.id === 's1dup_off-6')
  ck('ONE card for the Recruiting & Orientation owner naming both records', cards.length === 1 && card && card.kind === 'step1_possible_duplicate' && card.domain === 'recruiting_orientation' && card.owner === 'krystal@mo-care.com' && card.status === 'open' && /number 10/.test(card.detail) && new RegExp('number ' + r.id).test(card.detail) && /Olden Path/.test(card.detail) && !/—/.test(card.title + card.detail), card)
  r = await call('off-6', { first: 'Olden', last: 'Path', phone: '4175553333' })
  ck('the same offer again: the same record, no second card', r.how === 'already' && (await ops()).length === 1, r)
  /* not hired records are skipped as before */
  r = await call('off-7', { first: 'Gone', last: 'Away', phone: '4175554444' })
  ck('a not-hired record is never linked', r.how === 'created' && !(await byId(11)).offer_id, r)
  let err = ''; try { await call('', { first: 'x' }) } catch (e) { err = e.message }
  ck('refuses without an offer id', /an offer id and a record are needed/.test(err), err)
  /* no domains table: the card still raises, unowned */
  await db.exec(`drop table public.domains`)
  await db.exec(`insert into public.app_data_id_counter values ('x', 0) on conflict do nothing; update public.app_data set data = data || '[{"id": 12, "first": "Ivy", "last": "Old", "email": "ivy@x.com", "onboarding_path": "old"}]'::jsonb where key = 'candidates'`)
  r = await call('off-8', { first: 'Ivy', last: 'Old', email: 'IVY@x.com' })
  const c8 = (await ops()).find((x) => x.id === 's1dup_off-8')
  ck('no owner on file: the card is still raised (unowned), never a silent failure', r.how === 'created_old_path_kept' && c8 && c8.owner === '', [r, c8])
  /* rollback: the earlier version again (links on a name) */
  await db.exec(rb)
  r = await call('off-9', { first: 'Real', last: 'Person' })
  ck('rollback: the step1-before-checks version is back (name link), records and cards stay', r.how === 'linked' && String(r.id) === '7' && (await ops()).length === 2, r)
  await db.exec(sq)
  await db.exec('begin'); await db.exec('set local role authenticated')
  try { await call('off-10', { first: 'Hack' }); err = 'went through' } catch (e) { err = e.message } finally { await db.exec('rollback') }
  ck('a signed-in browser cannot call it', /permission denied/.test(err), err)
}
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note))
const bad = res.filter((x) => !x[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
