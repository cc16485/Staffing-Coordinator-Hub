// 1037 · THE PRN CAREGIVER TEAM: the SQL in a real Postgres (prn2.sql underneath, the job tables as the live ones hold the
// columns these use).   PGLITE=<path> node prn_caregiver_1037_sql_test.mjs
import fs from 'fs'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 700)])
const sq = fs.readFileSync('supabase/prn-caregiver-1037.sql', 'utf8'), rb = fs.readFileSync('supabase/prn-caregiver-1037-rollback.sql', 'utf8')
ck('no em dash anywhere in the SQL', !/—/.test(sq + rb))
ck('the exact wording: the pay acknowledgment (its own version) and the ongoing note', sq.includes("'I understand that Caring Companions PRN Caregiver Team members are paid $18/hour.'") && sq.includes("'PRN-PAY-2026-10C'") && sq.includes("'If you later move to a regular schedule, the ongoing caregiver rate is $16/hour.'"))
if (!process.env.PGLITE) ck('PGLITE is set', false)
else {
  const { PGlite } = await import(process.env.PGLITE); const db = new PGlite()
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table public.app_data (key text primary key, data jsonb, updated_at timestamptz default now());
    insert into public.app_data values ('ops_settings', '{"prn_team_minimum": 20}');
    create table public.job_positions (key text primary key, label text not null, screener jsonb not null default '[]', pay_min numeric(8,2), pay_max numeric(8,2), pay_unit text default 'HOUR', sort int default 0, active boolean not null default true, track text, pay_ack text, pay_ack_version text);
    insert into public.job_positions (key, label, pay_min, track, pay_ack, pay_ack_version) values ('prn_cna', 'PRN CNA Team', 20, 'prn', 'I understand that Caring Companions PRN CNA Team members are paid $20/hour.', 'PRN-PAY-2026-09B'), ('caregiver', 'Caregiver', 16, null, null, null);
    create table public.job_applicants (id uuid primary key default gen_random_uuid(), position text, prn jsonb, completed_at timestamptz, decline_reason text, pay_ack_at timestamptz,
      screen_flags text[], screen_grade text, office text, age_ok boolean, work_auth boolean, has_transport boolean, can_pass_background boolean, one_year text, status text default 'new');
    create table public.job_postings (slug text primary key, status text, title text, description text, employment_type text, pay_min numeric, pay_max numeric, pay_unit text, summary text, qualifications text, openings int, position text, indeed_feed boolean, valid_through date, internal_note text);`)
  await db.exec(fs.readFileSync('prn2.sql', 'utf8'))
  await db.exec(sq); await db.exec(sq)
  const role = (await db.query(`select * from public.job_positions where key = 'prn_caregiver'`)).rows[0], cna = (await db.query(`select * from public.job_positions where key = 'prn_cna'`)).rows[0]
  ck('the role prn_caregiver "PRN Caregiver Team": PRN track, $18, no CNA needed, its own acknowledgment and note (ran twice, once)', role && role.label === 'PRN Caregiver Team' && role.track === 'prn' && Number(role.pay_min) === 18 && role.requires_cna === false && role.pay_ack_version === 'PRN-PAY-2026-10C' && /\$16\/hour/.test(role.pay_note)
    && (await db.query(`select count(*)::int as n from public.job_positions where key = 'prn_caregiver'`)).rows[0].n === 1, role)
  ck('the PRN CNA Team still needs a CNA, and its $18 note now comes from the role', cna.requires_cna === true && /our CNAs are paid \$18 an hour/.test(cna.pay_note), cna)
  const app = async (pos, prn, extra = '') => (await db.query(`insert into public.job_applicants (position, prn, completed_at, screen_grade, screen_flags, age_ok, work_auth, has_transport, one_year${extra ? ', ' + extra.split('=')[0] : ''}) values ($1, $2, now(), 'qualified', '{}', true, true, true, 'yes'${extra ? ', ' + extra.split('=')[1] : ''}) returning id`, [pos, JSON.stringify(prn)])).rows[0].id
  const gap = async (id) => (await db.query(`select public.applicant_screening_gap($1) as g`, [id])).rows[0].g
  const flags = async (id) => { await db.query(`select public.applicant_screen_prn($1)`, [id]); return (await db.query(`select screen_flags, screen_grade from public.job_applicants where id = $1`, [id])).rows[0] }
  const g1 = await app('prn_caregiver', { one_year: true, days: ['mon'], times: ['morning'] })
  ck('a PRN Caregiver with no CNA answer at all: not "questions", not ineligible (the gap is clear)', (await gap(g1)) === null, await gap(g1))
  const g2 = await app('prn_caregiver', { one_year: true, cna: false, days: ['mon'], times: ['morning'] })
  ck('a PRN Caregiver who says "not a CNA": never turned away for it', (await gap(g2)) === null)
  const c1 = await app('prn_cna', { one_year: true, days: ['mon'], times: ['morning'] })
  const c2 = await app('prn_cna', { one_year: true, cna: false, days: ['mon'], times: ['morning'] })
  ck('the PRN CNA Team as before: no CNA answer = questions, not a CNA = ineligible', (await gap(c1)) === 'questions' && (await gap(c2)) === 'ineligible')
  const g3 = await app('prn_caregiver', { cna: false, days: ['mon'], times: ['morning'] })
  ck('the year of paid experience is still asked of the PRN Caregiver Team (missing = questions)', (await gap(g3)) === 'questions')
  const f1 = await flags(g1), f2 = await flags(c1)
  ck('the PRN screen: no "CNA not confirmed" for the caregiver team; still for the CNA team', !(f1.screen_flags || []).includes('CNA not confirmed') && (f2.screen_flags || []).includes('CNA not confirmed'), { f1, f2 })
  const a = (await db.query(`insert into public.job_applicants (position) values ('prn_caregiver') returning id`)).rows[0].id
  const st = (await db.query(`select public.pay_track_start($1, 'caregiver', 18, current_date, 'Krystal', 'Joined the PRN Caregiver Team (offer sent)') as r`, [a])).rows[0].r
  const again = (await db.query(`select public.pay_track_start($1, 'caregiver', 18, current_date, 'Krystal', 'x') as r`, [a])).rows[0].r
  const tc = (await db.query(`select public.pay_team_change($1, 'caregiver', 'cna', 20, current_date, 'Krystal', 'CNA earned') as r`, [a])).rows[0].r
  let stale = false; try { await db.query(`select public.pay_team_change($1, 'caregiver', 'cna', 20, current_date, 'Krystal', 'again')`, [a]) } catch { stale = true }
  const t = (await db.query(`select team, rate::float, track from public.pay_tracks where applicant_id = $1`, [a])).rows[0]
  const h = (await db.query(`select from_team, to_team, reason from public.pay_track_history where applicant_id = $1 order by id`, [a])).rows
  ck('pay_track_start: on the caregiver team at $18, once; pay_team_change: to the CNA team at $20, refused if the team already changed; the history keeps both lines with the teams', st.outcome === 'changed' && again.outcome === 'already' && tc.to_team === 'cna' && stale && t.team === 'cna' && t.rate === 20
    && h.length === 2 && h[0].to_team === 'caregiver' && h[1].from_team === 'caregiver' && h[1].to_team === 'cna' && h[1].reason === 'CNA earned', { st, tc, t, h })
  let badTeam = false; try { await db.exec(`update public.pay_tracks set team = 'nurse'`) } catch { badTeam = true }
  ck('a team is only cna or caregiver; the two new doors are the server’s only', badTeam && !(await db.query(`select has_function_privilege('authenticated', 'public.pay_team_change(uuid, text, text, numeric, date, text, text)', 'execute') as x`)).rows[0].x)
  const ops = (await db.query(`select data from public.app_data where key = 'ops_settings'`)).rows[0].data
  ck('the team goal: prn_caregiver_minimum 10 (only when not set), prn_team_minimum 20 kept', ops.prn_caregiver_minimum === 10 && ops.prn_team_minimum === 20, ops)
  await db.exec(`update public.app_data set data = data || '{"prn_caregiver_minimum": 12}' where key = 'ops_settings'`); await db.exec(sq)
  ck('a goal she changed on the Admin page is never overwritten by a re-run', (await db.query(`select data->>'prn_caregiver_minimum' as v from public.app_data where key = 'ops_settings'`)).rows[0].v === '12')
  const post = (await db.query(`select * from public.job_postings where slug = 'prn-caregiver-springfield'`)).rows[0]
  ck('the always-on posting: PER_DIEM, no expiry, $18, the prn_caregiver role, saved as a draft to publish on Recruit', post && post.employment_type === 'PER_DIEM' && post.valid_through === null && Number(post.pay_min) === 18 && post.position === 'prn_caregiver' && post.status === 'draft' && /\$16 an hour/.test(post.description) && !/CNA/.test(post.qualifications), post)
  await db.exec(rb)
  ck('rollback: the role and the posting switched off (never deleted), the two doors gone', (await db.query(`select active from public.job_positions where key = 'prn_caregiver'`)).rows[0].active === false && !(await db.query(`select to_regprocedure('public.pay_team_change(uuid, text, text, numeric, date, text, text)') as x`)).rows[0].x)
}
for (const [n, o, note] of res) console.log((o ? 'PASS  ' : 'FAIL  ') + n + (o ? '' : '  ' + note))
const bad = res.filter((x) => !x[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
