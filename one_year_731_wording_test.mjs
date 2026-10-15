// 731 part 2 · the job advert wording, run in a REAL Postgres (PGlite) with made-up postings.
//   PGLITE=<path to @electric-sql/pglite> node one_year_731_wording_test.mjs
import fs from 'fs'; import path from 'path'
const PG = process.env.PGLITE; if (!PG) { console.log('SKIP: set PGLITE to run against a real Postgres'); process.exit(0) }
const { PGlite } = await import(/\.m?js$/.test(PG) ? PG : path.join(PG, 'dist/index.js'))
const db = new PGlite()
await db.exec(`create table job_postings(id serial, status text, summary text, description text, responsibilities text, qualifications text, benefits text);
create table job_templates(id serial, summary text, description text, responsibilities text, qualifications text, benefits text);
insert into job_postings(status,description,qualifications) values
 ('published',E'Intro.\n\nExperience helps, but reliability and kindness matter more. If you have cared for someone before, even a family member, we would like to hear from you.',E'Be at least 18 years old\nPass all required background screenings'),
 ('published','W-2. Experience helps, but reliability and kindness matter more.','Be at least 18 years old'),
 ('published','PRN',E'Hold a current CNA certification\nAt least a year of caregiving experience'),
 ('closed',null,null);
insert into job_templates(description,qualifications) values ('Experience helps, but reliability and kindness matter more.','Be at least 18 years old');`)
const sql = fs.readFileSync('one_year_731_wording.sql', 'utf8')
await db.exec(sql); const r1 = (await db.query('select * from job_postings order by id')).rows
await db.exec(sql); const r2 = (await db.query('select * from job_postings order by id')).rows
const t = (await db.query('select * from job_templates')).rows
const res = []; const ck = (n, c) => res.push([n, !!c])
ck('the long sentence is replaced', r1[0].description.includes('We ask for at least one year of paid caregiving experience. If your experience is caring for a family member') && !r1[0].description.includes('Experience helps'))
ck('the short sentence is replaced', r1[1].description === 'W-2. We ask for at least one year of paid caregiving experience.')
ck('the year is the first line of "What we are looking for"', r1[0].qualifications.startsWith('Have at least one year of paid caregiving experience') && r1[0].qualifications.endsWith('screenings'))
ck('the PRN posting already asks for a year: untouched', r1[2].qualifications === 'Hold a current CNA certification\nAt least a year of caregiving experience')
ck('an empty closed posting stays empty', r1[3].description === null && r1[3].qualifications === null)
ck('the saved templates are updated too', t[0].description === 'We ask for at least one year of paid caregiving experience.' && t[0].qualifications.startsWith('Have at least one year'))
ck('running it twice changes nothing more', JSON.stringify(r1) === JSON.stringify(r2))
ck('no em dashes in the new words', !/—/.test(sql))
for (const [n, c] of res) console.log((c ? 'PASS ' : 'FAIL ') + n)
const ok = res.filter((r) => r[1]).length; console.log(`${ok}/${res.length}`); process.exit(ok === res.length ? 0 : 1)
