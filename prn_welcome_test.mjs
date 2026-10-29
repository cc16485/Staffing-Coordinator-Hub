// PRN STEP 4 (Samantha 2026-10-29): the team welcome. The rules only (_shared/prn-welcome.ts, the This week list), plus the
// SQL on a throwaway Postgres when PGLITE is set; nothing real is reached. node prn_welcome_test.mjs
import path from 'path'
import fs from 'fs'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const P = await import(path.join(process.cwd(), 'supabase/functions/_shared/prn-welcome.ts'))
const W = await import(path.join(process.cwd(), 'supabase/functions/_shared/prn-week.ts'))
const TODAY = '2026-10-29'

/* her wording */
ck('the welcome text is her approved wording, word for word',
  P.welcomeText(null, 'Grace', 'cna') === "Hi Grace, welcome to Caring Companions' PRN CNA Team! Our PRN Teams are our care continuity team: when a client needs coverage, you're among the first people we call. Saying no is always OK, and once you say yes, families count on you. We'll call you this week to say hello. We're so glad you're here!")
ck('the PRN Caregiver Team is named for its members', /welcome to Caring Companions' PRN Caregiver Team!/.test(P.welcomeText('', 'Tina', 'caregiver')))
ck('her edited wording in Settings wins', P.welcomeText('Welcome, {first_name}, to the {team}.', 'Tina', 'cna') === 'Welcome, Tina, to the PRN CNA Team.')
ck('no em dash and no "AI" in the wording', !/—/.test(P.WELCOME_DEFAULT) && !/\bAI\b/.test(P.WELCOME_DEFAULT))
ck('one text, under 320 characters', P.welcomeText(null, 'Christopher', 'caregiver').length < 320, P.welcomeText(null, 'Christopher', 'caregiver').length)

/* who is welcomed: linked in AxisCare in the last 7 days, once */
const T = (id, linked, o = {}) => ({ applicant_id: id, track: 'prn_team', team: 'cna', axiscare_caregiver_id: linked ? '7' + id.length : null, linked_at: linked, ...o })
const tracks = [T('a', '2026-10-29T15:00:00Z'), T('bb', '2026-10-23T15:00:00Z'), T('ccc', '2026-10-20T15:00:00Z'), T('dddd', null), T('eeeee', '2026-10-28T15:00:00Z'), T('ffffff', '2026-10-29T15:00:00Z', { track: 'ongoing' })]
const due = P.dueWelcomes(tracks, [{ applicant_id: 'eeeee', kind: 'welcome_sent', ref: 'welcome' }], TODAY).map((t) => t.applicant_id)
ck('linked today: welcomed', due.includes('a'), due)
ck('linked 6 days ago: still welcomed', due.includes('bb'), due)
ck('linked 9 days ago (before the switch went on, say): never welcomed late', !due.includes('ccc'), due)
ck('offer sent but not linked in AxisCare yet: not welcomed', !due.includes('dddd'), due)
ck('already welcomed: never twice', !due.includes('eeeee'), due)
ck('moved to ongoing: not welcomed as PRN', !due.includes('ffffff'), due)
ck('linked late in the evening Central (after midnight UTC) counts as that Central day', P.dueWelcomes([T('g', '2026-10-30T03:30:00Z')], [], TODAY).length === 1)

/* the welcome call line */
const mem = [{ applicant_id: 'a', name: 'Grace Hill', first: 'Grace', team: 'cna', linked_at: '2026-10-27T15:00:00Z' },
  { applicant_id: 'b', name: 'Tina Shorr', first: 'Tina', team: 'caregiver', linked_at: '2026-10-10T15:00:00Z' },
  { applicant_id: 'c', name: 'Denise Gough', first: 'Denise', team: 'cna', linked_at: null }]
let lines = P.welcomeLines({ members: mem, touches: [{ applicant_id: 'a', kind: 'welcome_sent', ref: 'welcome' }], today: TODAY })
const gl = lines.find((x) => x.applicant_id === 'a')
ck('Grace (linked 2 days ago): "Welcome call with Grace", the text noted as sent', gl && gl.title === 'Welcome call with Grace' && /New on the PRN CNA Team \(linked in AxisCare 2 days ago\)\. The welcome text went out\./.test(gl.detail) && gl.ref === 'welcome', gl)
ck('Tina (linked 19 days ago): past the first 2 weeks, no line', !lines.some((x) => x.applicant_id === 'b'))
ck('Denise (not linked yet): no line until she is', !lines.some((x) => x.applicant_id === 'c'))
ck('the call done: the line is gone', !P.welcomeLines({ members: mem, touches: [{ applicant_id: 'a', kind: 'welcome_call', ref: 'welcome' }], today: TODAY }).length)
ck('"Not this one": the line is gone', !P.welcomeLines({ members: mem, touches: [{ applicant_id: 'a', kind: 'not_this_one', ref: 'welcome' }], today: TODAY }).length)

/* the call's answers */
const good = { towns_times: 'Springfield and Nixa, weekday mornings', short_notice: 'yes', more_hours: 'maybe', enjoys: 'memory care, chatty clients', oncall: 'one_weekend_month', office_interest: true }
let r = P.readCall(good, 'cna')
ck('a full call is accepted', r.ok && r.answers.oncall === 'one_weekend_month' && r.answers.office_interest === true, r)
ck('the note kept on the record reads plainly', r.ok && P.callSummary(r.answers) === 'Towns and times: Springfield and Nixa, weekday mornings. Short notice OK: yes. More hours someday: maybe. Enjoys: memory care, chatty clients. On call: one weekend a month. Interested in office work someday', r.ok && P.callSummary(r.answers))
r = P.readCall(good, 'caregiver')
ck('on call is for the PRN CNA Team only: dropped for the Caregiver Team', r.ok && r.answers.oncall === '', r)
ck('towns and times are needed', !P.readCall({ ...good, towns_times: '' }, 'cna').ok)
ck('short notice must be yes, no or not asked', !P.readCall({ ...good, short_notice: 'sometimes' }, 'cna').ok && P.readCall({ ...good, short_notice: 'not_asked' }, 'cna').ok)
ck('more hours must be yes, no or maybe', !P.readCall({ ...good, more_hours: '' }, 'cna').ok)
ck('an unknown on-call answer is refused', !P.readCall({ ...good, oncall: 'sometimes' }, 'cna').ok)
ck('an em dash is refused', !P.readCall({ ...good, enjoys: 'memory care — chatty' }, 'cna').ok)
ck('office work is only a yes when ticked', P.readCall({ ...good, office_interest: 'yes' }, 'cna').answers.office_interest === false)

/* the This week list: the welcome call first; the automatic welcome text is not personal contact, the call is */
const M = { applicant_id: 'a', name: 'Grace Hill', first: 'Grace', team: 'cna', since: '2026-09-01', axiscare_id: '9', linked_at: '2026-10-27T15:00:00Z' }
let wk = W.computeWeek({ members: [M], shifts: [], touches: [{ applicant_id: 'a', kind: 'welcome_sent', ref: 'welcome', at: '2026-10-28T15:00:00Z' }], kindTo: {}, wantsMore: {}, cases: {}, today: TODAY, sender: 'Krystal', extra: [gl] })
ck('the welcome call is at the top of the list', wk.items[0].kind === 'welcome', wk.items.map((x) => x.kind))
ck('the automatic welcome text does not count as personal contact (the check-in line still shows)', wk.items.some((x) => x.kind === 'checkin'), wk.items.map((x) => x.kind))
wk = W.computeWeek({ members: [M], shifts: [], touches: [{ applicant_id: 'a', kind: 'welcome_call', ref: 'welcome', at: '2026-10-28T15:00:00Z' }], kindTo: {}, wantsMore: {}, cases: {}, today: TODAY, sender: 'Krystal', extra: [] })
ck('the welcome call counts as personal contact (no check-in line)', !wk.items.some((x) => x.kind === 'checkin'), wk.items.map((x) => x.kind))

/* the SQL, on a throwaway Postgres */
if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE)
  const db = new PGlite()
  await db.exec(`create table public.job_applicants (id uuid primary key);
    create table public.app_data (key text primary key, data jsonb);
    create table public.job_postings (slug text primary key, description text);
    create function public.upsert_app_data_item(target_key text, item jsonb) returns void language sql as 'select 1';
    insert into public.job_applicants values ('00000000-0000-0000-0000-000000000001');
    insert into public.job_postings values ('prn-cna-springfield', E'Start PRN. Stay flexible.\\n\\nJoin Caring Companions'' elite PRN CNA Team'),
      ('prn-caregiver-springfield', E'We rewrote this one in the Hub.'), ('cna-springfield', E'Start PRN. Stay flexible.\\n\\nNot PRN');`)
  try { await db.exec(`do $$ begin create role anon; create role authenticated; create role service_role; exception when others then null; end $$;`) } catch {}
  await db.exec(fs.readFileSync('prn_week.sql', 'utf8'))
  await db.exec(fs.readFileSync('prn_familiar.sql', 'utf8'))
  const run = async () => db.exec(fs.readFileSync('prn_welcome.sql', 'utf8'))
  await run(); await run()
  const A = "'00000000-0000-0000-0000-000000000001'"
  let ok = true; try { await db.exec(`insert into public.prn_touches (applicant_id, kind, ref, message, by_email) values (${A}, 'welcome_sent', 'welcome', 'Hi', 'automatic'), (${A}, 'welcome_call', 'welcome', null, 'k@x')`) } catch (e) { ok = false; console.log(e.message) }
  ck('SQL: welcome_sent and welcome_call are allowed (and running it twice is fine)', ok)
  let twice = false; try { await db.exec(`insert into public.prn_touches (applicant_id, kind, ref, by_email) values (${A}, 'welcome_sent', 'welcome', 'automatic')`) } catch { twice = true }
  ck('SQL: the same welcome can never be recorded twice', twice)
  ok = true; try { await db.exec(`insert into public.prn_touches (applicant_id, kind, ref, by_email) values (${A}, 'goback_yes', 'client:mary', 'k@x')`) } catch { ok = false }
  ck('SQL: the step 3 kinds are still allowed', ok)
  const p = (await db.query(`select slug, description from public.job_postings order by slug`)).rows
  const d = (s) => p.find((x) => x.slug === s).description
  ck('SQL: her line opens the PRN CNA posting, once, and "Start PRN. Stay flexible." stays',
    d('prn-cna-springfield') === "Join our PRN Team. We stand in the gap so families never go without care.\n\nStart PRN. Stay flexible.\n\nJoin Caring Companions' elite PRN CNA Team", d('prn-cna-springfield'))
  ck('SQL: a posting rewritten in the Hub is left alone', d('prn-caregiver-springfield') === 'We rewrote this one in the Hub.')
  ck('SQL: a posting that is not PRN is left alone', !/stand in the gap/.test(d('cna-springfield')))
} else console.log('  · PGLITE not set: the SQL was not run')

const bad = res.filter((r) => !r[1])
for (const [n, okk, note] of res) console.log((okk ? '  ✓ ' : '  ✗ FAIL ') + n + (okk ? '' : '\n      ' + note))
console.log(`\n${res.length - bad.length}/${res.length}`)
process.exit(bad.length ? 1 : 0)
