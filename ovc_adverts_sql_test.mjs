// ORIENTATION VIDEO CALL in the job adverts: the SQL in a real Postgres.  PGLITE=<path> node ovc_adverts_sql_test.mjs
import fs from 'fs'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 600)])
const sq = fs.readFileSync('supabase/ovc-adverts.sql', 'utf8'), code = sq.replace(/--[^\n]*/g, '')
ck('one transaction; nothing dropped, deleted, inserted or granted', /^\s*begin;/.test(code) && /commit;\s*$/.test(code) && !/\b(drop|delete|truncate|grant|revoke|alter\s+table|insert)\b/i.test(code))
ck('no em dash', !/—/.test(sq))
if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE); const db = new PGlite()
  const OLD = 'One 20-minute in-person interview at our office, then your paperwork, welcome call and 6 hours of paid training all from home on your phone or computer.'
  await db.exec(`create table public.job_postings (id serial primary key, slug text, status text, summary text, description text, responsibilities text, qualifications text, benefits text, updated_at timestamptz default '2026-01-01');
    create table public.job_templates (id serial primary key, name text, summary text, description text, responsibilities text, qualifications text, benefits text);
    create function public.touch() returns trigger language plpgsql as $t$ begin new.updated_at = now(); return new; end $t$;
    create trigger t before update on public.job_postings for each row execute function public.touch();`)
  await db.query(`insert into public.job_postings (slug, status, summary, description, benefits) values ($1, 'published', 'Caregiver role', $2, $3), ('quiet', 'published', 'Nothing to change', 'Just words. Welcome to the team!', null), ('old', 'closed', null, $4, null)`,
    ['caregiver-springfield', 'We love our team.\n\n' + OLD, '- Paid training\n- A 15-minute welcome video call from home', 'After a welcome call you start.'])
  await db.query(`insert into public.job_templates (name, description) values ('Caregiver', $1)`, ['Welcome video call, then training. ' + OLD])
  await db.exec(sq); const first = (await db.query(`select slug, summary, description, benefits, updated_at from public.job_postings order by id`)).rows
  await db.exec(sq); const second = (await db.query(`select slug, summary, description, benefits, updated_at from public.job_postings order by id`)).rows
  const [cg, quiet, old] = first, tpl = (await db.query(`select description from public.job_templates`)).rows[0].description
  ck('the one-liner: only the old phrase changes, her words around it stay', cg.description === 'We love our team.\n\nOne 20-minute in-person interview at our office, then your paperwork, Orientation Video Call and 6 hours of paid training all from home on your phone or computer.', cg.description)
  ck('"A 15-minute welcome video call" keeps its "A" (the article only changes right before the phrase)', cg.benefits === '- Paid training\n- A 15-minute Orientation Video Call from home', cg.benefits)
  ck('"a welcome call" becomes "an Orientation Video Call" (a closed posting too)', old.description === 'After an Orientation Video Call you start.', old.description)
  ck('a template: capital "Welcome video call" and the one-liner', tpl === 'Orientation Video Call, then training. One 20-minute in-person interview at our office, then your paperwork, Orientation Video Call and 6 hours of paid training all from home on your phone or computer.', tpl)
  ck('a posting without the phrase is not touched ("Welcome to the team!" stays; its date unchanged, so the sitemap is quiet)', quiet.description === 'Just words. Welcome to the team!' && new Date(quiet.updated_at).toISOString().startsWith('2026-01-01'), quiet)
  ck('run again: nothing changes (the dates stay)', JSON.stringify(first) === JSON.stringify(second))
}
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note))
