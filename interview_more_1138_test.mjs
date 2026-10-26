// 1138: three more interview questions, the REAL SQL against a throwaway Postgres (PGlite), on top of 622's install.
// PGLITE=<path> node interview_more_1138_test.mjs
import fs from 'fs'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 600)])
const { PGlite } = await import(process.env.PGLITE || '/Users/samantha/Claude/Projects/.pglite/node_modules/@electric-sql/pglite/dist/index.js')
const db = new PGlite()
await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create function public.desk_hub_ok() returns boolean language sql stable as $$ select true $$;
create function public.hub_office_ok() returns boolean language sql stable as $$ select true $$;`)
await db.exec(fs.readFileSync(new URL('./interview_v2_622.sql', import.meta.url), 'utf8'))
const sql = fs.readFileSync(new URL('./interview_more_1138.sql', import.meta.url), 'utf8')
const order = async () => (await db.query(`select seeded_as from public.interview_questions where position = 'caregiver' and active order by sort`)).rows.map((x) => x.seeded_as).join(',')
await db.exec(sql); await db.exec(sql)
ck('installs, and installs again without doubling', (await db.query(`select count(*)::int n from public.interview_questions`)).rows[0].n === 9)
ck('order: worked with us first, then story, working now, last 3 jobs, then the rest', await order() === 'v3-01,v2-01,v3-02,v3-03,v2-02,v2-03,v2-04,v2-05,v2-06', await order())
const r = (await db.query(`select count(*) filter (where rubric is null and kind = 'open' and not optional)::int n from public.interview_questions where seeded_as like 'v3-%'`)).rows[0].n
ck('no scores, open questions, none optional', r === 3, r)
// a Hub that moved "Your story" and edited a question keeps both; the new ones still land around it
const db2 = new PGlite()
await db2.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create function public.desk_hub_ok() returns boolean language sql stable as $$ select true $$;
create function public.hub_office_ok() returns boolean language sql stable as $$ select true $$;`)
await db2.exec(fs.readFileSync(new URL('./interview_v2_622.sql', import.meta.url), 'utf8'))
await db2.exec(`update public.interview_questions set sort = 30, question = 'Edited in the Hub' where seeded_as = 'v2-01'; update public.interview_questions set sort = 10 where seeded_as = 'v2-03'`)
await db2.exec(sql)
const o2 = (await db2.query(`select seeded_as from public.interview_questions where active order by sort`)).rows.map((x) => x.seeded_as).join(',')
ck('placed by the live order when the Hub changed it', o2 === 'v3-01,v2-03,v2-02,v2-01,v3-02,v3-03,v2-04,v2-05,v2-06', o2)
ck('a question edited in the Hub keeps its words', (await db2.query(`select question from public.interview_questions where seeded_as = 'v2-01'`)).rows[0].question === 'Edited in the Hub')
let bad = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '  ' + note)); if (!ok) bad++ }
console.log(bad ? `${bad} FAILED` : `all ${res.length} passed`); process.exit(bad ? 1 : 0)
