// The one-time move of earlier mo-care.com/app sign-ups into Leads (app_signups_to_leads.sql), run twice in a real Postgres.
//   PGLITE=<path to @electric-sql/pglite/dist/index.js> node app_signups_to_leads_test.mjs
import fs from 'fs'; import { pathToFileURL } from 'url'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const { PGlite } = await import(pathToFileURL(process.env.PGLITE).href)
const db = new PGlite()
await db.exec(`create table public.early_interest (id bigint generated always as identity primary key, created_at timestamptz not null default now(),
  site text not null, kind text not null, name text not null, email text, phone text, zip text, for_whom text, interests text[], timing text, experience text,
  message text, may_contact boolean not null default false, source text)`)   // the live table's columns (~/Claude/early-interest.sql)
await db.exec(`create table public.app_data(key text primary key, data jsonb); insert into public.app_data values ('leads', '[{"id":"old","first_name":"Ann"}]');
  insert into public.early_interest(site, kind, name, email, phone, zip, for_whom, interests, message, may_contact, created_at) values
  ('missouri','family','Lisa Ray','lisa@example.com',null,'65804','My mother','{app-early-access}','Afternoons please',true,'2026-10-16T15:00:00Z'),
  ('missouri','family','Cher',null,'4175550000',null,null,'{app-early-access}',null,false,'2026-10-16T16:00:00Z'),
  ('oklahoma','family','Okie Person','ok@example.com',null,null,null,'{app-early-access}',null,true,now()),
  ('missouri','caregiver','Care Giver','cg@example.com',null,null,null,'{app-early-access}',null,true,now()),
  ('missouri','family','Other Page','o@example.com',null,null,null,null,null,true,now());`)
const sql = fs.readFileSync('app_signups_to_leads.sql', 'utf8')
await db.exec(sql); await db.exec(sql)
const leads = (await db.query(`select data from public.app_data where key='leads'`)).rows[0].data
const moved = leads.filter((l) => l.id !== 'old')
ck('1 the two Missouri /app family sign-ups became leads; the old lead kept; running twice made no copies', leads.length === 3 && leads[0].id === 'old' && moved.length === 2, leads)
const L = moved.find((l) => l.email === 'lisa@example.com')
ck('2 shaped like a website lead: Lisa / Ray, Website, New, follow-up today, tagged "wants the app"', L && L.first_name === 'Lisa' && L.last_name === 'Ray' && L.source === 'Website' && L.status === 'New' && /^\d{4}-\d{2}-\d{2}$/.test(L.follow_up_due) && JSON.stringify(L.intent_tags) === '["wants the app"]', L)
ck('3 notes: when they signed up, their message, who for, ZIP, and that no acknowledgment went', /Signed up on mo-care.com\/app \(Oct 16\)/.test(L.interest_notes) && /Afternoons please/.test(L.interest_notes) && /Care for: My mother/.test(L.interest_notes) && /ZIP: 65804/.test(L.interest_notes) && /no acknowledgment was sent/.test(L.interest_notes), L.interest_notes)
const C = moved.find((l) => l.phone === '4175550000')
ck('4 a one-word name and a phone-only sign-up work', C && C.first_name === 'Cher' && C.last_name === '' && C.email === '', C)
const marks = (await db.query(`select name, lead_id from public.early_interest order by id`)).rows
ck('5 moved rows carry their lead id; Oklahoma, caregiver and non-app rows untouched', marks[0].lead_id && marks[1].lead_id && !marks[2].lead_id && !marks[3].lead_id && !marks[4].lead_id && moved.some((l) => l.id === marks[0].lead_id), marks)
for (const [n, ok, note] of res) console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note))
console.log(`\n  /app sign-ups to Leads: ${res.filter((r) => r[1]).length}/${res.length} passed`); process.exit(res.every((r) => r[1]) ? 0 : 1)
