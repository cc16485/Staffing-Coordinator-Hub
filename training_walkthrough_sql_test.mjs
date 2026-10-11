// TRAINING WALKTHROUGH: the three server doors in a real Postgres.  PGLITE=<path> node training_walkthrough_sql_test.mjs
import fs from 'fs'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 600)])
const sq = fs.readFileSync('supabase/training-walkthrough.sql', 'utf8')
ck('no em dash in the SQL', !/—/.test(sq))
ck('server only: revoked from public, anon, authenticated; granted to service_role', /revoke all on function public\.test_people_add\(text, text\), public\.test_people_remove\(text, text\), public\.training_walkthrough_close\(text, text\), public\.tw_card_hit/.test(sq) && /to service_role;/.test(sq))
if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE); const db = new PGlite()
  const OFF = '5b1d0a3e-1111-4222-8333-944455556666', OTHER = '7c2e1b4f-aaaa-4bbb-8ccc-ddddeeeeffff', J = 'a0a0a0a0-1111-2222-3333-444455556666'
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table public.app_data (key text primary key, data jsonb, updated_at timestamptz default now());
    create table public.client_journey (journey_id uuid primary key, subject text, offer_id text, status text, closed_reason text, updated_at timestamptz default now());
    create table public.client_journey_event (id bigserial primary key, journey_id uuid, actor_email text not null, actor_name text, kind text not null, detail jsonb default '{}', reason text);
    create table public.welcome_calls (id uuid primary key default gen_random_uuid(), candidate_id text not null, status text, closed_reason text, updated_at timestamptz default now());
    create table public.coordinator_busy (id bigserial primary key, source text, source_id text);
    insert into public.app_data values ('ops_settings', '{"switch_x": true, "test_people": {"phones": ["4175550000"], "emails": ["boss@x.com"]}}');
    insert into public.app_data values ('candidates', '[{"id": 12, "first": "Real", "last": "Person", "offer_id": "${OTHER}"}, {"id": 121, "first": "Kay", "last": "(TRAINING)", "offer_id": "${OFF}"}, {"id": 122, "first": "Lou", "last": "Linked", "offer_id": "${OFF}"}]');
    insert into public.app_data values ('caregivers', '[{"id": 5, "first": "Old", "last": "Hand"}]');
    insert into public.app_data values ('ops_items', '[{"id": "s1done_${OFF}", "offer_id": "${OFF}", "status": "open"}, {"id": "c2", "candidate_id": "121", "status": "open"},
      {"id": "c3", "title": "Call Kay (TRAINING) back", "status": "open"}, {"id": "c4", "detail": "journey ${J}", "status": "open"},
      {"id": "c5", "title": "Pay 121 dollars", "candidate_id": "12", "status": "open"}, {"id": "c6", "offer_id": "${OTHER}", "status": "open"}, {"id": "c7", "offer_id": "${OFF}", "status": "done", "closed_at": "2026-01-01"}]');
    insert into public.client_journey values ('${J}', 'caregiver', '${OFF}', 'open', null), ('b0b0b0b0-1111-2222-3333-444455556666', 'caregiver', '${OTHER}', 'open', null);
    insert into public.welcome_calls (id, candidate_id, status) values ('c0c0c0c0-1111-2222-3333-444455556666', '121', 'booked'), ('d0d0d0d0-1111-2222-3333-444455556666', '12', 'booked'), ('e0e0e0e0-1111-2222-3333-444455556666', '121', 'done');
    insert into public.coordinator_busy (source, source_id) values ('welcome_call', 'c0c0c0c0-1111-2222-3333-444455556666'), ('welcome_call', 'd0d0d0d0-1111-2222-3333-444455556666');`)
  await db.exec(sq); await db.exec(sq)
  const q1 = async (s, a) => (await db.query(s, a)).rows[0]
  const tp = async () => (await q1(`select data from public.app_data where key = 'ops_settings'`)).data
  ck('the walkthroughs list is seeded once', (await q1(`select data from public.app_data where key = 'training_walkthroughs'`)).data.length === 0)
  let r = (await q1('select public.test_people_add($1, $2) as r', ['(417) 593-2700', ' Kay@Office.COM '])).r
  let s = await tp()
  ck('add: the phone (ten digits) and email (lower case) join the list; the rest of the settings and the list stay', r.added_phone && r.added_email && s.switch_x === true && s.test_people.phones.join() === '4175550000,4175932700' && s.test_people.emails.join() === 'boss@x.com,kay@office.com', [r, s])
  r = (await q1('select public.test_people_add($1, $2) as r', ['4175550000', 'kay@office.com'])).r
  ck('add again: says nothing was added (so an end never removes what someone else put there)', !r.added_phone && !r.added_email && (await tp()).test_people.phones.length === 2, r)
  r = (await q1('select public.test_people_remove($1, $2) as r', ['', 'KAY@office.com'])).r
  s = await tp()
  ck('remove: only what it is given (the email); the phone stays', r.ok && s.test_people.emails.join() === 'boss@x.com' && s.test_people.phones.includes('4175932700'), s)
  await q1('select public.test_people_remove($1, $2) as r', ['417-593-2700', ''])
  ck('remove the phone: the other entries stay', (await tp()).test_people.phones.join() === '4175550000')
  r = (await q1('select public.training_walkthrough_close($1, $2) as r', [OFF, 'Training walkthrough ended by Kay'])).r
  const cands = (await q1(`select data from public.app_data where key = 'candidates'`)).data
  ck('close: only the "(TRAINING)" record with this offer comes off the list; a real record linked to it and other offers stay', r.records_off_lists === 1 && cands.map((c) => c.id).join() === '12,122', [r, cands])
  const items = Object.fromEntries((await q1(`select data from public.app_data where key = 'ops_items'`)).data.map((x) => [x.id, x]))
  ck('close: the cards by offer id, by record id, by "(TRAINING)" name and by journey id are done', ['s1done_' + OFF, 'c2', 'c3', 'c4'].every((k) => items[k].status === 'done' && items[k].close_note === 'Training walkthrough ended'), items)
  ck('close: never a loose number match (card about "121 dollars" for record 12) or another offer; a done card untouched', items.c5.status === 'open' && items.c6.status === 'open' && items.c7.closed_at === '2026-01-01', items)
  const js = (await db.query(`select offer_id, status, closed_reason from public.client_journey order by offer_id`)).rows
  const ev = (await db.query(`select kind, actor_name, reason from public.client_journey_event`)).rows
  ck('close: its readiness card closed with a "closed" event; the other one open', js.find((x) => x.offer_id === OFF).status === 'closed' && js.find((x) => x.offer_id === OTHER).status === 'open' && ev.length === 1 && ev[0].kind === 'closed' && /Kay/.test(ev[0].reason), [js, ev])
  const wc = (await db.query(`select candidate_id, status from public.welcome_calls order by candidate_id, status`)).rows, busy = (await db.query(`select source_id from public.coordinator_busy`)).rows
  ck('close: its booked Orientation Video Call cancelled and its time freed; a done call and another person\'s call untouched', r.welcome_calls_cancelled === 1 && wc.map((x) => x.candidate_id + ':' + x.status).join() === '12:booked,121:cancelled,121:done' && busy.length === 1 && busy[0].source_id.startsWith('d0d0'), [wc, busy])
  r = (await q1('select public.training_walkthrough_close($1, $2) as r', [OFF, 'again'])).r
  ck('close again: nothing more to do, no second event', r.records_off_lists === 0 && r.cards_closed === 0 && (await db.query(`select 1 from public.client_journey_event`)).rows.length === 1, r)
  let err = ''; try { await q1('select public.training_walkthrough_close($1, $2) as r', ['', 'x']) } catch (e) { err = e.message }
  ck('close refuses without an offer id', /which offer/.test(err), err)
  for (const fn of ["public.test_people_add('4175551111', '')", "public.training_walkthrough_close('x', 'y')"]) {
    await db.exec('begin'); await db.exec('set local role authenticated')
    try { await db.query('select ' + fn); err = 'went through' } catch (e) { err = e.message } finally { await db.exec('rollback') }
    ck('a signed-in browser cannot call ' + fn.split('(')[0], /permission denied/.test(err), err)
  }
  await db.exec(fs.readFileSync('supabase/training-walkthrough-rollback.sql', 'utf8'))
  ck('rollback: the doors go; what they did stays', !(await q1(`select to_regprocedure('public.training_walkthrough_close(text, text)') as p`)).p && !(await q1(`select to_regprocedure('public.tw_card_hit(jsonb, text, text[], text[], text[])') as p`)).p && (await q1(`select data from public.app_data where key = 'candidates'`)).data.length === 2)
}
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note))
