// 1033 LEVEL OF CARE: the rules file, the reference-tasks switch, and the SQL in a real Postgres.   PGLITE=<path> node level_1033_sql_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 600)])
const V = await import(path.join(process.cwd(), 'supabase/functions/_shared/care-level-verify.ts'))
const D = await import(path.join(process.cwd(), 'supabase/functions/_shared/step1-documents.ts'))
ck('every task the reference form asks that maps to a level is a real Step 1 task key', Object.keys(V.TASK_DUTIES).every((k) => k in D.SKILLS), Object.keys(V.TASK_DUTIES).filter((k) => !(k in D.SKILLS)))
ck('the mapped duties are on the design’s lists, at the right level', Object.values(V.TASK_DUTIES).every((t) => t.duties.every((d) => V.DUTIES[t.level].some((x) => x.key === d))))
ck('the design’s duty lists: 10 at Level 2, 9 at Level 3', V.DUTIES[2].length === 10 && V.DUTIES[3].length === 9)
const v = (o) => V.validateEvidence(o)
ck('a document with dates, a source and a duty counts; a reference needs who confirmed it', v({ level: 2, kind: 'document', source: 'Mercy Hospital', duties: ['grooming'], from: '2021-03', to: '2022-05' }).ok && !v({ level: 2, kind: 'reference', source: 'X', duties: ['grooming'], from: '2021-03', to: 'now' }).ok)
ck('a Level 3 duty never proves Level 2 (the duty must be on that level’s list)', !v({ level: 2, kind: 'employment', source: 'X', who: 'Y', duties: ['hoyer_lift'], from: '2021-01', to: '2022-01' }).ok)
ck('verified: Level 3 needs Level 2 too; a credential is Level 2 only', V.verifiedLevel([{ level: 3, kind: 'employment', duties: ['hoyer_lift'], date_from: '2021', date_to: '2022' }]) === 1
  && V.verifiedLevel([{ level: 2, kind: 'credential', credential: { status: 'active' } }]) === 2
  && V.verifiedLevel([{ level: 2, kind: 'credential', credential: { status: 'active' } }, { level: 3, kind: 'reference', duties: ['hospice_support'], date_from: '2020-01', date_to: '2021-01' }]) === 3)
ck('from a reference: only "saw" counts, one row per level', V.evidenceFromReference({ id: 'r', task_confirm: { bathing: 'saw', toileting: 'believe', hospice_support: 'saw' }, emp_from: '2020-01-01', emp_to: 'now' }).map((e) => e.level + ':' + e.duties.join('/')).join() === '2:bathing/showering,3:hospice_support')
ck('claimed: their highest preferred level, else Level 2 from "Yes", else Level 1; the interviewer’s suggestion kept apart', V.claimedFrom({ preferred_levels: ['Level 1', 'Level 2'] }, { level_suggested: 3 }).level === 2 && V.claimedFrom({ level2: 'Yes' }, null).level === 2 && V.claimedFrom({}, null).level === null && V.claimedFrom({}, { level_suggested: 3 }).interviewer_level === 3)
const rt = fs.readFileSync('supabase/functions/reference-tasks/index.ts', 'utf8')
ck('reference-tasks: practice hires as before; every real WORK reference only with reference_tasks_all_live (show: true); save allowed exactly when shown', /reference_tasks_all_live === true/.test(rt) && /if \(!L \|\| !L\.show\) return json\(NOT_PRACTICE\)/.test(rt) && /'professional'/.test(rt) && /show: true/.test(rt))
const sw = fs.readFileSync('supabase/functions/caregiver-journey/index.ts', 'utf8')
ck('the reference evidence switch defaults off; approve needs the Approve to Work list; never above verified', /level_from_refs_live === true/.test(sw) && /level_approve[\s\S]*mayApprove\(P, 'work'/.test(sw) && /want > lv\.verified_level/.test(sw) && /There is no override/.test(sw))
const sq = fs.readFileSync('supabase/level-1033.sql', 'utf8'), rb = fs.readFileSync('supabase/level-1033-rollback.sql', 'utf8')
ck('no em dash; no SSN column', !/—/.test(sq + rb) && !/ssn/i.test(sq.split('-- ===')[2] || sq.replace(/^--.*$/mg, '')))
if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE); const db = new PGlite()
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table public.app_data (key text primary key, data jsonb, updated_at timestamptz default now());
    create function public.app_data_rev(r jsonb) returns bigint language sql immutable as $$ select coalesce((r->>'_rev')::bigint, 0) $$;
    insert into public.app_data values ('candidates', '[{"id": 7, "first": "Kim", "_rev": 0}]');`)
  await db.exec(sq); await db.exec(sq)
  const ok = (await db.query(`select public.level_patch('candidates', '7', 0, '{"care_level_approved": 2, "care_level_by": "Samantha"}'::jsonb) as r`)).rows[0].r
  let refused = false; try { await db.query(`select public.level_patch('candidates', '7', 0, '{"step2_verified_at": "x"}'::jsonb)`) } catch { refused = true }
  const rec = (await db.query(`select data->0 as c from public.app_data where key = 'candidates'`)).rows[0].c
  ck('level_patch saves the care_level fields only (ran twice), refuses any other field', ok.ok === true && rec.care_level_approved === 2 && refused, { ok, rec })
  let dup = false; await db.exec(`insert into public.caregiver_level_evidence (offer_id, level, kind, ref_request_id) values ('o', 3, 'reference', 'rq')`)
  try { await db.exec(`insert into public.caregiver_level_evidence (offer_id, level, kind, ref_request_id) values ('o', 3, 'reference', 'rq')`) } catch { dup = true }
  let badLvl = false; try { await db.exec(`insert into public.caregiver_level_evidence (offer_id, level, kind) values ('o', 1, 'reference')`) } catch { badLvl = true }
  ck('the evidence table: a reference answer lands once per level; only Levels 2 and 3; closed to the browser', dup && badLvl && !(await db.query(`select has_table_privilege('authenticated', 'public.caregiver_level_evidence', 'select') as x`)).rows[0].x)
  await db.exec(rb)
  ck('rollback drops the door and keeps the evidence (the audit trail)', !(await db.query(`select to_regprocedure('public.level_patch(text, text, bigint, jsonb)') as x`)).rows[0].x && (await db.query(`select count(*)::int as n from public.caregiver_level_evidence`)).rows[0].n === 1)
} else ck('PGLITE is set', false)
for (const [n, o, note] of res) console.log((o ? 'PASS  ' : 'FAIL  ') + n + (o ? '' : '  ' + note))
const bad = res.filter((x) => !x[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
