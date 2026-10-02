// 415 · hiring wording: the job posting SQL. Scans hiring_wording_415.sql (one transaction, targeted replace() only,
// nothing dropped or deleted, no em dash) and, with PGLITE set, runs it TWICE in a real Postgres against the live
// adverts' wording (copied from the published pages on mo-care.com, 2026-10-02) plus a draft, a closed posting and
// two saved templates. Never touches a real project.
//   node hiring_wording_415_test.mjs
//   PGLITE=<path to @electric-sql/pglite> node hiring_wording_415_test.mjs
import fs from 'fs'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 900)])
const SQL = fs.readFileSync('hiring_wording_415.sql', 'utf8')
const LINE = 'One 20-minute in-person interview at our office, then your paperwork, welcome call and 6 hours of paid training all from home on your phone or computer.'
const code = SQL.replace(/--[^\n]*/g, '')

ck('one transaction: begin first, commit last', /^\s*begin;/i.test(code.trimStart()) && /commit;\s*$/i.test(code.trimEnd()))
ck('nothing dropped, deleted, truncated or granted; no table changed', !/\b(drop|delete|truncate|grant|revoke|alter\s+table|insert)\b/i.test(code))
ck('only two tables are written: job_postings and job_templates', (code.match(/\bupdate\s+public\.(\w+)/gi) || []).map((x) => x.split('.')[1]).sort().join() === 'job_postings,job_templates')
ck('no em dash in the SQL', !/—/.test(SQL))
ck('never says remote', !/\bremote/i.test(SQL))
ck('the one-liner in the SQL is the exact agreed sentence (same as the website builder)', SQL.includes(`'${LINE}'`)
   && (!fs.existsSync('../web/tools/build-jobs.mjs') || fs.readFileSync('../web/tools/build-jobs.mjs', 'utf8').includes(LINE)))
ck('job_templates only if the table is there', /to_regclass\('public\.job_templates'\) is not null/.test(code))

const SPRING = {
  description: "Caring Companions is looking for caregivers across the Springfield area.\n\nYou would be helping older adults stay safe, independent and comfortable in their own homes.\n\nThis is W-2 employment, not contract work. You are paid weekly, overtime is paid for anything over 40 hours in a week, and orientation and training are provided before you start. Schedules are flexible.",
  benefits: "W-2 employment, not a contractor arrangement\nPaid weekly\nOvertime paid for hours over 40 in a workweek\nPaid orientation and training\nOngoing paid training, including dementia and Alzheimer's care\nFlexible scheduling built around you",
  responsibilities: "Follow the care plan\nComplete orientation, onboarding, dementia and Alzheimer's training, and annual in-service training",
}
const PERSONAL = { description: "We train you on safe transfer technique before you start.\n\nThis is W-2 employment, not contract work. You are paid weekly, overtime is paid over 40 hours, and orientation and training are provided before you start.",
  benefits: "Paid weekly\nPaid orientation and training, including safe transfers" }
const RESPITE = { description: "A very sweet family in Mount Vernon, about 5 minutes from the square.\n\nThis is W-2 employment with Caring Companions, not contract work. You are paid weekly, and orientation and training are provided before you start.",
  benefits: "W-2 employment, not a contractor arrangement\nPaid weekly\nPaid orientation and training\nA steady, predictable schedule" }
const PRN = { summary: '$20/hr · Start PRN. Stay flexible.', description: "Start PRN. Stay flexible.\n\nApply in under two minutes. We keep this team open all year.\n\nNote: if you'd like to switch to taking an ongoing client, our CNAs are paid $18 an hour.", benefits: null }

if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE)
  const db = new PGlite()
  await db.exec(`
    create table public.job_postings (id serial primary key, updated_at timestamptz not null default now(), slug text not null unique,
      status text not null default 'draft', title text not null default 't', description text not null, summary text, responsibilities text, qualifications text, benefits text);
    create table public.job_templates (id serial primary key, updated_at timestamptz not null default now(), name text not null,
      summary text, description text, responsibilities text, qualifications text, benefits text);
    create function public.touch() returns trigger language plpgsql as $$ begin new.updated_at = clock_timestamp(); return new; end $$;
    create trigger a before update on public.job_postings for each row execute function public.touch();
    create trigger a before update on public.job_templates for each row execute function public.touch();`)
  const ins = async (t, row) => { const k = Object.keys(row); await db.query(`insert into public.${t} (${k.join(',')}) values (${k.map((_, i) => '$' + (i + 1)).join(',')})`, k.map((x) => row[x])) }
  await ins('job_postings', { slug: 'caregiver-springfield', status: 'published', ...SPRING })
  await ins('job_postings', { slug: 'caregiver-personal-care-springfield', status: 'published', ...PERSONAL })
  await ins('job_postings', { slug: 'respite-caregiver-mount-vernon', status: 'published', ...RESPITE })
  await ins('job_postings', { slug: 'prn-cna-springfield', status: 'published', ...PRN })
  await ins('job_postings', { slug: 'draft-one', status: 'draft', description: 'A draft.\r\n\r\n', benefits: 'Paid orientation and training\r\n- Ongoing paid training, including dementia and Alzheimer\'s care' })
  await ins('job_postings', { slug: 'old-closed', status: 'closed', description: 'Closed. Orientation and training are provided before you start, and orientation and training are provided before you start.' })
  await ins('job_postings', { slug: 'already-fine', status: 'published', description: 'Nothing old here.\n\n' + LINE, benefits: 'Paid weekly' })
  await ins('job_templates', { name: 'Caregiver', ...SPRING })
  await ins('job_templates', { name: 'Empty', description: null })
  const rows = async (t) => (await db.query(`select * from public.${t} order by id`)).rows
  const before = { p: await rows('job_postings'), t: await rows('job_templates') }
  await db.exec(SQL)
  const p = await rows('job_postings'), t = await rows('job_templates'); const by = (s) => p.find((r) => r.slug === s)
  const changed = p.filter((r, i) => r.updated_at.getTime() !== before.p[i].updated_at.getTime()).map((r) => r.slug)
  ck('rows touched: the 4 live adverts + the draft + the closed one; the one already fine is left alone (updated_at untouched)',
     changed.join() === 'caregiver-springfield,caregiver-personal-care-springfield,respite-caregiver-mount-vernon,prn-cna-springfield,draft-one,old-closed', changed)
  const S = by('caregiver-springfield')
  ck('Springfield benefits: the two training lines become one honest line; nothing else in the list moves',
     S.benefits === "W-2 employment, not a contractor arrangement\nPaid weekly\nOvertime paid for hours over 40 in a workweek\nPaid orientation and Alzheimer's and dementia training (6 hours)\nFlexible scheduling built around you", S.benefits)
  ck('Springfield description: "you complete 6 hours of paid orientation and dementia training from home before you start", the rest untouched',
     S.description.includes('overtime is paid for anything over 40 hours in a week, and you complete 6 hours of paid orientation and dementia training from home before you start. Schedules are flexible.')
     && S.description.startsWith(SPRING.description.split('This is W-2')[0]), S.description)
  ck('the one-liner is the last paragraph of each open posting, once', p.filter((r) => r.status !== 'closed').every((r) => r.description.endsWith('\n\n' + LINE) && r.description.split(LINE).length === 2), p.map((r) => r.description.slice(-60)))
  ck('a closed posting gets the wording fix but not the one-liner (both occurrences fixed)', !by('old-closed').description.includes(LINE) && by('old-closed').description === 'Closed. You complete 6 hours of paid orientation and dementia training from home before you start, and you complete 6 hours of paid orientation and dementia training from home before you start.', by('old-closed').description)
  ck('responsibilities line (no paid claim) is left alone', S.responsibilities === SPRING.responsibilities)
  ck('personal care: "Paid orientation and dementia training (6 hours)"; the transfer training sentence stays', by('caregiver-personal-care-springfield').benefits === 'Paid weekly\nPaid orientation and dementia training (6 hours)' && by('caregiver-personal-care-springfield').description.includes('We train you on safe transfer technique before you start.'), by('caregiver-personal-care-springfield'))
  ck('respite: "Paid orientation and dementia training"; "about 5 minutes from the square" is NOT touched', by('respite-caregiver-mount-vernon').benefits.includes('\nPaid orientation and dementia training\n') && by('respite-caregiver-mount-vernon').description.includes('about 5 minutes from the square'), by('respite-caregiver-mount-vernon'))
  ck('PRN: "Apply in about 2 minutes."; summary unchanged', by('prn-cna-springfield').description.includes('Apply in about 2 minutes. We keep this team open all year.') && by('prn-cna-springfield').summary === PRN.summary, by('prn-cna-springfield'))
  ck('draft with Windows line breaks and a "-" bullet: the two lines still become one; trailing blank lines trimmed before the one-liner',
     by('draft-one').benefits === "Paid orientation and Alzheimer's and dementia training (6 hours)" && by('draft-one').description === 'A draft.\n\n' + LINE, by('draft-one'))
  ck('templates: same fixes + the one-liner; an empty template stays empty', t[0].benefits === S.benefits && t[0].description === S.description && t[1].description === null, t)
  const all = JSON.stringify([p, t])
  ck('after: no "Ongoing paid training", no "under two minutes", no "orientation and training are provided" (either case)', !/Ongoing paid training|under two minutes|orientation and training are provided/i.test(all), null)
  ck('after: no em dash, never "remote"', !/—|\bremote/i.test(all))
  const snap = JSON.stringify(await rows('job_postings')) + JSON.stringify(await rows('job_templates'))
  await db.exec(SQL)
  ck('a second run changes nothing at all (not even updated_at)', JSON.stringify(await rows('job_postings')) + JSON.stringify(await rows('job_templates')) === snap)
  await db.exec('drop table public.job_templates')
  await db.exec(SQL)
  ck('runs cleanly when job_templates does not exist', true)
} else console.log('(PGLITE not set: the SQL was scanned, not run)')

console.log('\n415 · HIRING WORDING SQL · TEST\n' + '='.repeat(50)); let ok = true
for (const [n, g, note] of res) { ok &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')) }
console.log('='.repeat(50)); console.log(ok ? `ALL ${res.length} CHECKS PASS` : 'FAILED'); process.exit(ok ? 0 : 1)
