// PRN STEP 5a (Samantha 2026-10-29): the PRN Team page. The rules only (_shared/prn-page.ts, prn-break.ts, prn-page-links.ts, the
// break in Cara's waves, the This week lines), plus the SQL on a throwaway Postgres when PGLITE is set; nothing real is reached.
// node prn_page_test.mjs
import path from 'path'
import fs from 'fs'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const imp = (f) => import(path.join(process.cwd(), 'supabase/functions/_shared', f))
const P = await imp('prn-page.ts'), B = await imp('prn-break.ts'), L = await imp('prn-page-links.ts'), CW = await imp('cara-waves.ts'), W = await imp('prn-week.ts')
const TODAY = '2026-10-29'

/* the link */
const SECRET = 'x'.repeat(40), ID = '0f1e2d3c-4b5a-4968-8776-655443322110'
const link = await L.makePageLink(SECRET, ID, L.pageExpiry(1_800_000_000))
const q = Object.fromEntries(new URL(link).searchParams)
ck('the link opens cc.mo-care.com/prn.html with the member and an expiry, nothing else', link.startsWith('https://cc.mo-care.com/prn.html?p=' + ID + '&e=') && Object.keys(q).join() === 'p,e,t', link)
ck('...it checks', await L.checkPageLink(SECRET, q, 1_800_000_000))
ck('...it lasts 30 days', Number(q.e) === 1_800_000_000 + 30 * 86400)
ck('...expired: refused', !(await L.checkPageLink(SECRET, q, Number(q.e) + 1)))
ck('...someone else\'s id with this seal: refused', !(await L.checkPageLink(SECRET, { ...q, p: '1f1e2d3c-4b5a-4968-8776-655443322110' }, 1_800_000_000)))
ck('...a different secret: refused', !(await L.checkPageLink('y'.repeat(40), q, 1_800_000_000)))
ck('...a short secret: refused', !(await L.checkPageLink('short', q, 1_800_000_000)))
ck('...not the My Hours link\'s seal (its own purpose)', !(await (await imp('prn-links.ts')).checkAvailLink(SECRET, { c: '123', e: q.e, t: q.t }, 1_800_000_000)))

/* looking for hours: 7 days */
ck('looking for hours: on, with their note, until 7 days from the tap', JSON.stringify(P.lookingState([{ kind: 'looking_on', note: 'any morning next week', at: '2026-10-27T15:00:00Z' }], TODAY)) === JSON.stringify({ on: true, note: 'any morning next week', since: '2026-10-27', until: '2026-11-03' }))
ck('...turned off: off', !P.lookingState([{ kind: 'looking_on', at: '2026-10-27T15:00:00Z' }, { kind: 'looking_off', at: '2026-10-28T15:00:00Z' }], TODAY).on)
ck('...8 days later: off by itself', !P.lookingState([{ kind: 'looking_on', at: '2026-10-20T15:00:00Z' }], TODAY).on)

/* my hours */
let h = P.readHours({ windows: { mon: ['morning', 'nope'], sat: ['evening'] }, target_hours: '12', outside_ok: true })
ck('my hours: known times only, 12 hours, outside OK', h.ok && h.windows.mon.join() === 'morning' && h.windows.sat.join() === 'evening' && h.windows.tue.length === 0 && h.target_hours === 12 && h.outside_ok === true, h)
ck('...hours a week left blank is fine', P.readHours({ windows: {} }).ok && P.readHours({ windows: {} }).target_hours === null)
ck('...90 hours a week: refused', !P.readHours({ target_hours: 90 }).ok)

/* a break */
ck('a break until a date: kept', JSON.stringify(P.readBreak('2026-11-15', TODAY)) === JSON.stringify({ ok: true, until: '2026-11-15' }))
ck('...empty ends it', P.readBreak('', TODAY).ok && P.readBreak('', TODAY).until === null)
ck('...a date that passed: refused', !P.readBreak('2026-10-28', TODAY).ok)
ck('...more than 120 days: refused (text us)', !P.readBreak('2027-04-01', TODAY).ok && /Text us/.test(P.readBreak('2027-04-01', TODAY).error))

/* the break and shift texts (her decision 11) */
ck('on a break: a shift before or on the last day is not asked', /on a break until Nov 15/.test(B.onBreak('2026-11-15', '2026-11-15')) && !!B.onBreak('2026-11-15', '2026-11-01'))
ck('...a shift after the break: asked as usual', B.onBreak('2026-11-15', '2026-11-16') === null)
ck('...no break: nothing changes', B.onBreak(null, '2026-11-01') === null && B.onBreak('', '2026-11-01') === null)
const row = (o = {}) => ({ name: 'Grace Hill', axiscare_id: '11', windows: { sun: ['morning'] }, prn_pref: { notice: null, interests: [], short_notice_ok: true, ...o } })
const kase = { shift_date: '2026-11-01', shift_time: '08:00-12:00' }
let j = CW.judgeForWaves([row({ break_until: '2026-11-15' })], kase, { minsToStart: 3000, ongoing: false })
ck("Cara's waves: a PRN member on a break is left out, as \"on_break\" with the reason", j.ordered.length === 0 && j.excluded[0]?.code === 'on_break' && /on a break until Nov 15/.test(j.excluded[0].why), j)
j = CW.judgeForWaves([row({ break_until: '2026-10-30' })], kase, { minsToStart: 3000, ongoing: false })
ck("...the break ended before the shift: asked as usual", j.ordered.length === 1, j)
ck('...the ask list words it "On a break" (never asked, not "possible with review")', /on_break: 'On a break'/.test(fs.readFileSync('supabase/functions/_shared/ask-list.ts', 'utf8')))
const cr = fs.readFileSync('supabase/functions/coverage-run/index.ts', 'utf8')
ck("the automatic rounds (prnFit) check the break first, and the PRN list carries it", /const brk = onBreak\(p\.break_until, date\)[^\n]*\n  if \(brk\) return \{ fit: false, why: brk \}/.test(cr) && /break_until: a\?\.prn\?\.break_until \?\? null/.test(cr) && /break_until: pmw\.break_until \?\? null/.test(cr))

/* Offered to You */
const cases = [
  { id: 'c1', status: 'open', client: 'Mary Smith', client_city: 'Nixa', shift_date: '2026-11-01', shift_time: '08:00-12:00', asked: [{ id: 'a1', axiscare_id: '11', state: 'waiting' }] },
  { id: 'c2', status: 'open', client: 'Ruth Lee', shift_date: '2026-10-30', shift_time: '09:00-13:00', asked: [{ id: 'a2', axiscare_id: '11', state: 'yes' }] },
  { id: 'c3', status: 'done', client: 'Ann Bell', shift_date: '2026-11-02', asked: [{ id: 'a3', axiscare_id: '11', state: 'waiting' }] },
  { id: 'c4', status: 'open', client: 'Joan Fox', shift_date: '2026-10-28', asked: [{ id: 'a4', axiscare_id: '11' }] },
  { id: 'c5', status: 'open', client: 'Lou Day', shift_date: '2026-11-03', asked: [{ id: 'a5', axiscare_id: '99' }] },
  { id: 'c6', status: 'open', client: 'Bea Ott', shift_date: '2026-11-03', asked: [{ id: 'a6', axiscare_id: '11', state: 'closed_silent' }] }]
const off = P.offeredTo(cases, '11', TODAY)
ck('Offered to You: open shifts we asked them about, soonest first', off.map((o) => o.case_id).join() === 'c2,c1', off)
ck('...first name and town only (no last name)', off[1].client_first === 'Mary' && off[1].town === 'Nixa' && !JSON.stringify(off).includes('Smith'))
ck('...already answered yes shows as answered', off[0].answered === 'yes' && off[1].answered === null)
ck('...not on the schedule yet: nothing offered', P.offeredTo(cases, null, TODAY).length === 0)

/* thank-yous */
const th = P.thanksFor({ touches: [{ kind: 'thanks_sent', message: 'Hi Grace, thank you for stepping in for Mary on Sunday.', by_name: 'Krystal Land', at: '2026-10-20T15:00:00Z' }, { kind: 'thanks_sent', message: null, at: '2026-10-21' }, { kind: 'called', message: 'x' }],
  kindTells: [{ id: 'k1', tells: [{ caregiver_ax: '11', text: "Mary's daughter said you made her mom laugh all morning.", by: 'Samantha Troutman', at: '2026-10-25T15:00:00Z' }, { caregiver_ax: '12', text: 'not hers' }] }],
  ax: '11', covered: 10, since: '2025-10-01', today: TODAY })
ck('thank-yous: the exact texts the office sent, newest first, signed with a first name', th[0].kind === 'kind_words' && th[0].from === 'Samantha' && th[1].kind === 'thanks' && th[1].from === 'Krystal', th)
ck('...a "thanked another way" without a text, and other people\'s kind words, are not shown', th.filter((x) => x.kind !== 'milestone').length === 2 && !JSON.stringify(th).includes('not hers'))
ck('...milestones: 10 shifts and a year', th.some((x) => /stepped in for 10 PRN shifts/.test(x.text)) && th.some((x) => /One year on the team/.test(x.text)))
ck('courses: only the two optional courses, never orientation', P.COURSES.map((c) => c.slug).join() === 'dementia-care,on-the-job-training')
ck('no em dash in anything the page says', !/—/.test(fs.readFileSync('supabase/functions/_shared/prn-page.ts', 'utf8') + fs.readFileSync('supabase/functions/prn-page/index.ts', 'utf8').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')))

/* This week lines */
const mem = [{ applicant_id: 'g', name: 'Grace Hill', first: 'Grace', team: 'cna' }]
const log = [{ id: 7, applicant_id: 'g', kind: 'looking_on', note: 'any morning next week', at: '2026-10-28T15:00:00Z' },
  { id: 8, applicant_id: 'g', kind: 'course_request', note: 'dementia-care', at: '2026-10-28T16:00:00Z' },
  { id: 9, applicant_id: 'g', kind: 'idea', note: 'A group text for open weekends', at: '2026-10-28T17:00:00Z' }]
let lines = P.pageLines({ members: mem, log, touches: [], today: TODAY })
ck('This week: "Grace is looking for hours" with her note', lines[0]?.title === 'Grace is looking for hours' && /"any morning next week"/.test(lines[0].detail), lines)
ck('...a course she asked for, and how to assign it', lines.some((l) => l.title === "Grace would like to take Alzheimer's & Dementia Care" && /Training Platform/.test(l.detail)))
ck('...an idea she shared, in her words', lines.some((l) => l.kind === 'idea' && l.detail === '"A group text for open weekends"'))
lines = P.pageLines({ members: mem, log, touches: [{ applicant_id: 'g', kind: 'called', ref: 'looking:2026-10-28' }, { applicant_id: 'g', kind: 'handled', ref: 'course:dementia-care' }, { applicant_id: 'g', kind: 'handled', ref: 'idea:9' }], today: TODAY })
ck('...called, assigned and read: the lines are gone', !lines.length, lines)
const wk = W.computeWeek({ members: [{ ...mem[0], since: '2026-10-01', axiscare_id: '11' }], shifts: [], touches: [], kindTo: {}, wantsMore: {}, cases: {}, today: TODAY, sender: 'Krystal', extra: P.pageLines({ members: mem, log, touches: [], today: TODAY }) })
ck('...looking for hours is the first line on This week', wk.items[0].kind === 'looking', wk.items.map((x) => x.kind))

/* the SQL */
if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE)
  const db = new PGlite()
  await db.exec(`create table public.job_applicants (id uuid primary key); create table public.app_data (key text primary key, data jsonb);
    create table public.job_postings (slug text primary key, description text);
    insert into public.job_applicants values ('00000000-0000-0000-0000-000000000001');`)
  try { await db.exec(`do $$ begin create role anon; create role authenticated; create role service_role; exception when others then null; end $$;`) } catch {}
  for (const f of ['prn_week.sql', 'prn_familiar.sql', 'prn_welcome.sql']) await db.exec(fs.readFileSync(f, 'utf8'))
  await db.exec(fs.readFileSync('prn_page.sql', 'utf8')); await db.exec(fs.readFileSync('prn_page.sql', 'utf8'))
  const A = "'00000000-0000-0000-0000-000000000001'"
  let ok = true; try { await db.exec(`insert into public.prn_page_log (applicant_id, kind, note) values (${A}, 'looking_on', 'mornings'), (${A}, 'office_preview', null), (${A}, 'idea', 'x')`) } catch (e) { ok = false; console.log(e.message) }
  ck('SQL: the page records go in (and running it twice is fine)', ok)
  let frozen = false; try { await db.exec(`update public.prn_page_log set note = 'changed'`) } catch { frozen = true }
  let gone = false; try { await db.exec(`delete from public.prn_page_log`) } catch { gone = true }
  ck('SQL: what happened on a page is never edited or deleted', frozen && gone)
  let bad = false; try { await db.exec(`insert into public.prn_page_log (applicant_id, kind) values (${A}, 'paid')`) } catch { bad = true }
  ck('SQL: only the known kinds', bad)
  ok = true; try { await db.exec(`insert into public.prn_touches (applicant_id, kind, ref, by_email) values (${A}, 'handled', 'idea:9', 'k@x'), (${A}, 'welcome_call', 'welcome', 'k@x')`) } catch (e) { ok = false; console.log(e.message) }
  ck("SQL: 'handled' is allowed on This week, and step 4's kinds still are", ok)
} else console.log('  · PGLITE not set: the SQL was not run')

const bad = res.filter((r) => !r[1])
for (const [n, okk, note] of res) console.log((okk ? '  ✓ ' : '  ✗ FAIL ') + n + (okk ? '' : '\n      ' + note))
console.log(`\n${res.length - bad.length}/${res.length}`)
process.exit(bad.length ? 1 : 0)
