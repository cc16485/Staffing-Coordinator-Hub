// SLICE 9 · evidence hardening (supabase/slice9-evidence.sql + slice9-rollback.sql)
//   node slice9_evidence_test.mjs                                  SQL scans
//   PGLITE=<path to @electric-sql/pglite> node slice9_evidence_test.mjs   also installs it (twice) in a real Postgres and proves
//                                                                  every watcher, the GHE lock, the bg_reviews guard, the storage
//                                                                  rules and the rollback
import fs from 'fs'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 900)])
const sq = fs.readFileSync('supabase/slice9-evidence.sql', 'utf8')
const rb = fs.readFileSync('supabase/slice9-rollback.sql', 'utf8')
const code = sq.replace(/^--.*$/gm, '')

ck('one transaction, refuses when a table it watches is missing', /^begin;/m.test(code) && /^commit;/m.test(code) && (code.match(/slice 9 refused:/g) || []).length === 5)
ck('no em dash in either file', ![sq, rb].some((t) => /[—―]/.test(t)))
ck('never touches the Phase 1 change history, record_event or the door', !/app_data_item_change|record_event|action_registry|action_authority/.test(code))
ck('the watchers only watch: AFTER triggers that return null with every failure caught', /after insert or update of data on public\.app_data/.test(code) && /after insert or update or delete on public\.evv_submissions/.test(code) && /after update or delete on public\.client_journey_step/.test(code) && (code.match(/exception when others then/g) || []).length >= 6)
ck('the browser roles get nothing on the new tables', /revoke all on public\.%I from public, anon, authenticated/.test(code) && !/grant [^;]* to authenticated/.test(code))
ck('the rollback deletes no history line', !/delete from|truncate/i.test(rb.replace(/^--.*$/gm, '')))
ck('no network calls', !/net\.|http_post|http_get|pg_net/.test(code))

if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE)
  const db = new PGlite()
  const PNG = 'data:image/png;base64,' + 'iVBORw0KGgo'.repeat(40)
  await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create table public.app_data (key text primary key, data jsonb, updated_at timestamptz default now());
alter table public.app_data enable row level security;
create policy app_data_rw on public.app_data for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.app_data to authenticated, service_role;
create function public.upsert_app_data_item(target_key text, item jsonb) returns void language plpgsql as $f$
declare idx int;
begin
  insert into public.app_data (key, data) values (target_key, '[]'::jsonb) on conflict (key) do nothing;
  select i - 1 into idx from public.app_data a, jsonb_array_elements(a.data) with ordinality e(x, i) where a.key = target_key and x->>'id' = item->>'id' limit 1;
  if idx is null then update public.app_data set data = data || jsonb_build_array(item) where key = target_key;
  else update public.app_data set data = jsonb_set(data, array[idx::text], item) where key = target_key; end if;
end $f$;
grant execute on function public.upsert_app_data_item(text, jsonb) to authenticated, service_role;
create table public.client_journey (journey_id uuid primary key default gen_random_uuid(), client_name text not null, status text default 'open', subject text default 'client', updated_at timestamptz default now());
create table public.client_journey_step (journey_id uuid not null references public.client_journey(journey_id) on delete cascade, step_key text not null,
  state text not null default 'open', evidence jsonb not null default '{}', version int not null default 1, updated_at timestamptz default now(), primary key (journey_id, step_key));
create table public.client_care_change (change_id uuid primary key default gen_random_uuid(), axiscare_client_id text not null, kind text not null, checklist jsonb not null default '[]', updated_at timestamptz default now(), is_test boolean default false);
create table public.evv_submissions (id uuid primary key default gen_random_uuid(), client_name text, sig_consumer text, sig_attendant text, outcome text, updated_at timestamptz default now());
create table public.bg_reviews (id uuid primary key default gen_random_uuid(), candidate_id text, history jsonb not null default '[]', status text default 'open', updated_at timestamptz default now());
grant all on public.client_journey, public.client_journey_step, public.client_care_change, public.evv_submissions, public.bg_reviews to service_role;
create schema storage; grant usage on schema storage to authenticated, service_role;
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
create policy "agency docs readable by signed in staff" on storage.objects for select to authenticated using (bucket_id = 'agency-docs');
create policy "agency docs writable by signed in staff" on storage.objects for insert to authenticated with check (bucket_id = 'agency-docs');
create policy "agency docs updatable by signed in staff" on storage.objects for update to authenticated using (bucket_id = 'agency-docs');
create policy "agency docs deletable by signed in staff" on storage.objects for delete to authenticated using (bucket_id = 'agency-docs');
create policy "lead-docs staff delete" on storage.objects for delete to authenticated using (bucket_id = 'lead-docs');
create policy "lead-docs staff read" on storage.objects for select to authenticated using (bucket_id = 'lead-docs');
create policy "lead-docs staff write" on storage.objects for insert to authenticated with check (bucket_id = 'lead-docs');
create policy "lead-docs all (test of the ALL split)" on storage.objects for all to authenticated using (bucket_id = 'lead-docs' and name like 'x/%');
create policy "caring417 staff delete" on storage.objects for delete to authenticated using (bucket_id = 'caring417');
create policy "caring417 read" on storage.objects for select to authenticated using (bucket_id = 'caring417');
insert into storage.objects (bucket_id, name) values ('lead-docs', 'L1/a.pdf'), ('agency-docs', 'policy.pdf'), ('caring417', 'v.mp4');
insert into public.app_data (key, data) values
  ('caregivers', '[{"id":"c1","first":"Pat","last":"Example","phone":"4175550101","email":"p@example.test","oig":"clear","oig_date":"2026-09-01","alz_hrs":4}]'),
  ('candidates', '[]'), ('medicaid_plans', '[]'), ('ghe_forms', '[]'), ('ops_items', '[{"id":"o1"}]');`)
  await db.exec(sq); await db.exec(sq)
  ck('PGLITE: installs, and installs again (safe to re-run)', true)

  const SIGNED = { role: 'authenticated', sub: 'u-1', email: 'krystal@example.test' }
  const as = async (q, params = [], claims = SIGNED) => {
    await db.exec('begin')
    await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
    await db.exec(`set local role ${claims.role}`)
    try { const r = await db.query(q, params); await db.exec('commit'); return r } catch (e) { await db.exec('rollback'); return 'refused: ' + e.message }
  }
  const upsert = (key, item, claims) => as('select public.upsert_app_data_item($1, $2)', [key, JSON.stringify(item)], claims)
  const H = async (w = 'true') => (await db.query(`select source, record_id, change, field, old_value, new_value, actor, role, error from public.evidence_history where ${w} order by id`)).rows
  const clear = async () => { await db.exec(`drop trigger evidence_history_keep on public.evidence_history; delete from public.evidence_history; create trigger evidence_history_keep before update or delete on public.evidence_history for each row execute function public.evidence_append_only();`) }
  const cg = async () => (await db.query(`select data->0 as c from public.app_data where key = 'caregivers'`)).rows[0].c

  // ── 1. caregivers: evidence values kept, contact details never ──
  await clear()
  const c1 = await cg()
  let r = await upsert('caregivers', { ...c1, oig_date: '2026-10-01', oig_proof: 'bgcheck/c1/oig.json', phone: '4175550199', alz_hrs: 5 })
  let h = await H()
  ck('a caregiver evidence change is recorded with before, after and who', typeof r !== 'string' && h.length === 3 && h.find((x) => x.field === 'oig_date' && x.old_value === '2026-09-01' && x.new_value === '2026-10-01' && x.actor === 'krystal@example.test' && x.role === 'authenticated') && h.find((x) => x.field === 'oig_proof' && x.old_value === null) && h.find((x) => x.field === 'alz_hrs' && x.old_value === 4 && x.new_value === 5), h)
  ck('the phone change is not in the evidence history', !h.some((x) => x.field === 'phone'), h)
  await clear()
  r = await upsert('candidates', { id: 'k1', first: 'Sam', last: 'Applicant', phone: '4175550123', email: 's@example.test', dob: '1990-01-01', fcsr: 'clear', fcsr_date: '2026-10-02', r1s: 'good', r1_phone: '4175550000' })
  h = await H()
  ck('a new person: one added line holding only the evidence fields (no name, phone, email or birth date)', h.length === 1 && h[0].change === 'added' && JSON.stringify(h[0].new_value) === JSON.stringify({ r1s: 'good', fcsr: 'clear', fcsr_date: '2026-10-02' }), h)
  await clear()
  await as(`update public.app_data set data = '[]' where key = 'candidates'`)
  h = await H()
  ck('a person removed: one removed line keeps what their evidence said', h.length === 1 && h[0].change === 'removed' && h[0].old_value.fcsr_date === '2026-10-02', h)
  await clear()
  await upsert('ops_items', { id: 'o1', title: 'changed' })
  ck('other keys are not watched', (await H()).length === 0)

  // ── 2. medicaid plans and GHE forms ──
  await clear()
  await upsert('medicaid_plans', { id: 'mcp_1', plan_start: '2026-10-01', received_on: '2026-10-02', file_name: 'plan.pdf' })
  await upsert('medicaid_plans', { id: 'mcp_1', plan_start: '2026-10-01', received_on: '2026-10-02', file_name: 'plan.pdf', fusion_verified: { by: 'k@example.test', checked_on: '2026-10-03' } })
  h = await H(`change = 'changed'`)
  ck('a plan Fusion check is recorded with its value', h.length === 1 && h[0].field === 'fusion_verified' && h[0].new_value.checked_on === '2026-10-03', h)
  await clear()
  const G = { id: 'g1', client: 'Mary Client', visit_date: '2026-10-05', nurse: 'Lee LPN', f: { ghe_notes: 'all good', ghe_sig_sup_date: '' }, checks: ['#a input[value="1"]'], radios: { q1: 'yes' }, total: 12, status: 'draft', sig_nurse: PNG, sig_part: '', sig_sup: '' }
  await upsert('ghe_forms', G)
  h = await H()
  const raw = JSON.stringify(h)
  ck('GHE answers and signatures are fingerprints, never copied', h.length === 1 && h[0].new_value.sig_nurse && h[0].new_value.sig_nurse.md5 && h[0].new_value.f.md5 && !raw.includes('iVBORw0KGgo') && !raw.includes('all good'), h)

  // ── 3. the GHE lock ──
  r = await upsert('ghe_forms', { ...G, f: { ...G.f, ghe_notes: 'edited before signing' } })
  ck('an unsigned form can still be edited', typeof r !== 'string', r)
  const S = { ...G, f: { ...G.f, ghe_notes: 'edited before signing' }, sig_part: PNG + 'P' }
  r = await upsert('ghe_forms', S)
  ck('the participant signs', typeof r !== 'string', r)
  r = await upsert('ghe_forms', { ...S, f: { ...S.f, ghe_notes: 'changed after signing' } })
  ck('after the participant signs, the answers cannot change', typeof r === 'string' && /answers cannot change/.test(r) && /Mary Client, visit 2026-10-05/.test(r), r)
  for (const [k, v] of [['visit_date', '2026-10-06'], ['total', 13], ['sig_part', ''], ['sig_nurse', PNG + 'X'], ['client', 'Someone Else'], ['checks', []]]) {
    r = await upsert('ghe_forms', { ...S, [k]: v })
    ck(`after signing, ${k} cannot change`, typeof r === 'string' && r.includes('cannot change'), r)
  }
  r = await upsert('ghe_forms', { ...S, status: 'rn_review', rn_reviewer: 'Robin RN', f: { ...S.f, ghe_sig_sup_date: '2026-10-07' } })
  ck('the workflow still moves and the RN signature date can be set', typeof r !== 'string', r)
  const S2 = { ...S, status: 'rn_review', rn_reviewer: 'Robin RN', f: { ...S.f, ghe_sig_sup_date: '2026-10-07' }, sig_sup: PNG + 'S' }
  r = await upsert('ghe_forms', S2)
  ck('the supervising RN signs once', typeof r !== 'string', r)
  r = await upsert('ghe_forms', { ...S2, sig_sup: PNG + 'T' })
  ck('then the RN signature cannot change', typeof r === 'string' && /supervising nurse/.test(r), r)
  r = await upsert('ghe_forms', { ...S2, f: { ...S2.f, ghe_sig_sup_date: '2026-10-08' } })
  ck('then the RN signature date cannot change', typeof r === 'string', r)
  r = await upsert('ghe_forms', { ...S2, status: 'uploaded', uploaded_on: '2026-10-09', fusion_checked: { seen: true } })
  ck('upload and the Fusion check still record', typeof r !== 'string', r)
  r = await as(`update public.app_data set data = '[]' where key = 'ghe_forms'`)
  ck('a signed form cannot be removed from the list', typeof r === 'string' && /cannot be removed/.test(r), r)
  r = await as(`delete from public.app_data where key = 'ghe_forms'`)
  ck('the list holding a signed form cannot be deleted', typeof r === 'string' && /cannot be removed/.test(r), r)
  r = await as(`update public.app_data set data = '[]' where key = 'ghe_forms'`, [], { role: 'service_role' })
  ck('the server cannot remove it either', typeof r === 'string', r)
  const cur = (await db.query(`select data->0 as g from public.app_data where key = 'ghe_forms'`)).rows[0].g
  r = await upsert('ghe_forms', { ...cur, superseded_by: 'g2', superseded_at: '2026-10-10T10:00:00Z' })
  const r2 = await upsert('ghe_forms', { ...G, id: 'g2', amends: 'g1', amend_reason: 'The visit date was written wrong on the form', f: { ...G.f }, sig_nurse: '', sig_part: '' })
  ck('Amend: the signed form is marked replaced and the corrected copy is added; both stay', typeof r !== 'string' && typeof r2 !== 'string' && (await db.query(`select jsonb_array_length(data) n from public.app_data where key = 'ghe_forms'`)).rows[0].n === 2, [r, r2])

  // ── 4. EVV and the discharge checklist ──
  await clear()
  const e = (await db.query(`insert into public.evv_submissions (client_name, sig_attendant) values ('Mary Client', $1) returning id`, [PNG])).rows[0].id
  await db.query(`update public.evv_submissions set sig_consumer = $1, outcome = 'accepted', updated_at = now() where id = $2`, [PNG + 'C', e])
  h = await H(`source = 'evv_submissions'`)
  ck('an EVV form: added, then each changed column with before and after; the signature only as a fingerprint', h.length === 3 && h[0].change === 'added' && h.find((x) => x.field === 'outcome' && x.new_value === 'accepted') && h.find((x) => x.field === 'sig_consumer' && x.new_value.md5) && !JSON.stringify(h).includes('iVBOR') && !h.some((x) => x.field === 'updated_at'), h)
  const ch = (await db.query(`insert into public.client_care_change (axiscare_client_id, kind, checklist) values ('123', 'end', '[{"key":"dsds","state":"open"}]') returning change_id`)).rows[0].change_id
  await db.query(`update public.client_care_change set checklist = '[{"key":"dsds","state":"done","by":"k"}]' where change_id = $1`, [ch])
  await db.query(`update public.client_care_change set checklist = '[{"key":"dsds","state":"open","reopened":true}]' where change_id = $1`, [ch])
  h = await H(`source = 'client_care_change' and change = 'changed'`)
  ck('a discharge checklist tick and its reopening are both kept with the values', h.length === 2 && h[0].new_value[0].state === 'done' && h[1].old_value[0].state === 'done' && h[1].new_value[0].state === 'open', h)

  // ── 5. journey row versions ──
  const j = (await db.query(`insert into public.client_journey (client_name) values ('Mary Client') returning journey_id`)).rows[0].journey_id
  await db.query(`insert into public.client_journey_step (journey_id, step_key, state) values ($1, 'cg.oig', 'open')`, [j])
  await db.query(`update public.client_journey_step set state = 'complete', evidence = '{"proof":"x"}', version = 2 where journey_id = $1`, [j])
  await db.query(`update public.client_journey_step set updated_at = now() + interval '1 day' where journey_id = $1`, [j])
  await db.query(`update public.client_journey set status = 'closed' where journey_id = $1`, [j])
  await db.query(`delete from public.client_journey where journey_id = $1`, [j])
  const v = (await db.query(`select source, step_key, op, row_before from public.journey_row_version where journey_id = $1 order by id`, [j])).rows
  ck('every earlier version of the step and the journey is kept, even after the journey is deleted; a touch of updated_at alone is not a version', v.length === 4 && v[0].source === 'client_journey_step' && v[0].row_before.state === 'open' && v[1].op === 'UPDATE' && v[2].source === 'client_journey' && v.some((x) => x.op === 'DELETE' && x.row_before.state === 'complete'), v)

  // ── 6. bg_reviews ──
  const b = (await db.query(`insert into public.bg_reviews (candidate_id, history) values ('k1', '[{"what":"opened"}]') returning id`)).rows[0].id
  r = await as(`update public.bg_reviews set history = history || '[{"what":"called"}]' where id = '${b}'`, [], { role: 'service_role' })
  ck('a background review history line can be added', typeof r !== 'string', r)
  r = await as(`update public.bg_reviews set history = '[{"what":"called"}]' where id = '${b}'`, [], { role: 'service_role' })
  ck('it cannot be shortened', typeof r === 'string' && /can only have lines added/.test(r), r)
  r = await as(`update public.bg_reviews set history = '[{"what":"opened, edited"},{"what":"called"}]' where id = '${b}'`, [], { role: 'service_role' })
  ck('an earlier line cannot be rewritten', typeof r === 'string', r)
  r = await as(`update public.bg_reviews set status = 'closed' where id = '${b}'`, [], { role: 'service_role' })
  ck('the rest of the review still updates', typeof r !== 'string', r)

  // ── 7. who can reach the new tables; nothing can be changed or removed ──
  r = await as(`select count(*) from public.evidence_history`)
  ck('a signed-in browser cannot read the evidence history', typeof r === 'string' && /permission denied/.test(r), r)
  r = await as(`select count(*) from public.journey_row_version`, [], { role: 'anon' })
  ck('anon cannot read the journey versions', typeof r === 'string', r)
  for (const q of [`update public.evidence_history set actor = 'x'`, `delete from public.evidence_history`, `truncate public.evidence_history`, `delete from public.journey_row_version`, `truncate public.journey_row_version`]) {
    let out; try { await db.exec(q); out = 'went through' } catch (x) { out = x.message }
    ck(`even the owner cannot: ${q.split(' ').slice(0, 3).join(' ')}`, /is permanent/.test(out), out)
  }

  // ── 8. a failure inside a watcher never stops the save, and is itself recorded ──
  await db.exec(`alter table public.evidence_history add constraint t_block check (change <> 'changed') not valid`)
  r = await upsert('caregivers', { ...(await cg()), oig_date: '2026-10-11' })
  const back = (await cg()).oig_date
  await db.exec(`alter table public.evidence_history drop constraint t_block`)
  h = await H(`change = 'trigger_error'`)
  ck('a watcher failure: the save still went through and a trigger_error line says so', typeof r !== 'string' && back === '2026-10-11' && h.length === 1 && /t_block/.test(h[0].error), [r, back, h])

  // ── 9. storage ──
  const pol = async () => (await db.query(`select policyname, cmd from pg_policies where schemaname = 'storage' order by 1`)).rows.map((x) => x.policyname + ' ' + x.cmd)
  const p = await pol()
  ck('browser delete and update rules for lead-docs and agency-docs are gone; read and add stay; other buckets untouched',
    !p.some((x) => /(lead-docs staff delete|agency docs deletable|agency docs updatable|lead-docs all \(test of the ALL split\) ALL)/.test(x)) && p.includes('lead-docs staff read SELECT') && p.includes('agency docs writable by signed in staff INSERT') && p.includes('caring417 staff delete DELETE')
    && p.includes('lead-docs all (test of the ALL split) (read, slice 9) SELECT') && p.includes('lead-docs all (test of the ALL split) (add, slice 9) INSERT'), p)
  r = await as(`delete from storage.objects where bucket_id in ('lead-docs', 'agency-docs') returning id`)
  const left = (await db.query(`select count(*)::int n from storage.objects where bucket_id in ('lead-docs', 'agency-docs')`)).rows[0].n
  ck('a signed-in browser deletes nothing in those buckets', typeof r !== 'string' && r.rows.length === 0 && left === 2, [r, left])
  r = await as(`update storage.objects set name = 'renamed' where bucket_id = 'agency-docs' returning id`)
  ck('and overwrites nothing', typeof r !== 'string' && r.rows.length === 0, r)
  r = await as(`select count(*)::int n from storage.objects where bucket_id in ('lead-docs', 'agency-docs')`)
  const r3 = await as(`insert into storage.objects (bucket_id, name) values ('lead-docs', 'L1/new.pdf') returning id`)
  ck('reading and adding still work', typeof r !== 'string' && r.rows[0].n === 2 && typeof r3 !== 'string', [r, r3])
  r = await as(`delete from storage.objects where bucket_id = 'caring417' returning id`)
  ck('another bucket keeps its own rules', typeof r !== 'string' && r.rows.length === 1, r)
  const kept = (await db.query(`select policyname, cmd from public.evidence_storage_rule_removed order by id`)).rows
  ck('the four removed rules are kept for the rollback (installing twice did not add them again)', kept.length === 4, kept)

  // ── 9b. the 584 installer's probe, run here exactly as written: it reports and leaves nothing behind ──
  await db.exec(`insert into public.app_data (key, data) values ('candidates', '[]') on conflict (key) do nothing`)
  const PROBE = /PROBE = r"""([\s\S]*?)"""/.exec(fs.readFileSync('slice9_evidence_584.py', 'utf8'))[1]
  const evBefore = (await db.query(`select count(*)::int n from public.evidence_history`)).rows[0].n
  const gBefore = (await db.query(`select data from public.app_data where key = 'ghe_forms'`)).rows[0].data
  let pmsg = ''; try { await db.exec(PROBE); pmsg = 'no exception' } catch (x) { pmsg = x.message }
  const parts = pmsg.split('PROBE_RESULT|')[1]?.split('|') || []
  ck('the installer probe: 2 history lines for the probe applicant, the GHE change and removal refused, the bg history guard refused', parts[0] === '2' && /answers cannot change/.test(parts[2]) && /cannot be removed/.test(parts[3]) && /can only have lines added/.test(parts[4]), pmsg)
  const evAfter = (await db.query(`select count(*)::int n from public.evidence_history`)).rows[0].n
  const gAfter = (await db.query(`select data from public.app_data where key = 'ghe_forms'`)).rows[0].data
  ck('...and everything it did was rolled back', evAfter === evBefore && JSON.stringify(gAfter) === JSON.stringify(gBefore), [evBefore, evAfter])
  // ── 10. rollback ──
  const before = (await db.query(`select count(*)::int n from public.evidence_history`)).rows[0].n
  await db.exec(rb)
  const p2 = await pol()
  ck('rollback: every removed rule is back exactly, the split copies are gone', ['lead-docs staff delete DELETE', 'agency docs deletable by signed in staff DELETE', 'agency docs updatable by signed in staff UPDATE', 'lead-docs all (test of the ALL split) ALL'].every((x) => p2.includes(x)) && !p2.some((x) => /slice 9/.test(x)), p2)
  const after = (await db.query(`select count(*)::int n from public.evidence_history`)).rows[0].n
  r = await upsert('ghe_forms', { ...cur, total: 99 })
  ck('rollback: the history stays, the lock is off', after === before && typeof r !== 'string', [before, after, r])
  const rs = (await db.query(`select count(*)::int n from public.evidence_storage_rule_removed where restored_at is not null`)).rows[0].n
  ck('rollback: each restored rule is stamped restored', rs === 4, rs)
  await db.exec(rb)
  ck('rollback runs twice safely', true)
}
const bad = res.filter((x) => !x[1])
for (const [n, ok, note] of res) console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok ? '' : '\n      ' + note))
console.log(`\n${res.length - bad.length}/${res.length} passed`)
process.exit(bad.length ? 1 : 0)
