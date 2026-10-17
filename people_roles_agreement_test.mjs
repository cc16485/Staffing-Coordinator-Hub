// people_roles_agreement.sql in a real Postgres, twice, against journey_person and people_on_journey_record shaped like the live
// ones (journey-people.sql's role check line). PGLITE=<path to @electric-sql/pglite/dist/index.js> node people_roles_agreement_test.mjs
import fs from 'fs'; import { pathToFileURL } from 'url'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 400)])
const { PGlite } = await import(pathToFileURL(process.env.PGLITE).href)
const db = new PGlite()
const live = fs.readFileSync('journey-people.sql', 'utf8')
const line = live.split('\n').find((l) => l.includes("<@ array['primary','decision_maker','poa','billing','emergency','professional']::text[] then v_code := 'invalid_role'"))
await db.exec(`create table public.journey_person (row_id serial primary key, roles text[] not null default '{}' check (roles <@ array['primary','decision_maker','poa','billing','emergency','professional']::text[]));
create function public.people_on_journey_record(p_roles text[]) returns jsonb language plpgsql security definer as $d$
declare v_code text; v_msg text;
begin
  <<check>> begin
${line}
  end check;
  if v_code is not null then return jsonb_build_object('outcome','refused','reason',v_code); end if;
  insert into public.journey_person (roles) values (coalesce(p_roles,'{}'));
  return jsonb_build_object('outcome','recorded');
end $d$;`)
const q = fs.readFileSync('people_roles_agreement.sql', 'utf8'); await db.exec(q); await db.exec(q)
const rec = async (roles) => (await db.query(`select public.people_on_journey_record($1::text[]) as r`, [roles])).rows[0].r
ck('1 the door records the agreement\'s roles', (await rec(['medical_decisions', 'poa_health', 'poa_financial'])).outcome === 'recorded')
ck('2 the older roles stay valid (history is never re-labelled)', (await rec(['decision_maker', 'poa'])).outcome === 'recorded')
ck('3 anything else is still refused', (await rec(['boss'])).reason === 'invalid_role')
let bad = null; try { await db.exec(`insert into public.journey_person (roles) values ('{boss}')`) } catch (e) { bad = String(e.message) }
ck('4 the table check still refuses unknown roles, one check after two runs', bad && /check/.test(bad) && (await db.query(`select count(*)::int n from pg_constraint where conrelid = 'public.journey_person'::regclass and contype = 'c'`)).rows[0].n === 1, bad)
ck('5 the live file\'s role line was found (the test runs the real check)', !!line)
for (const [n, ok, note] of res) console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note))
console.log(`\n  people roles SQL: ${res.filter((r) => r[1]).length}/${res.length} passed`); process.exit(res.every((r) => r[1]) ? 0 : 1)
