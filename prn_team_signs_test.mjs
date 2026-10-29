// PRN · OUR TEAMS SIGNS (2026-10-29, plan section 8; her "continue"): last heard from us, last PRN shift, would like more hours,
// "may be drifting" only when two or more signs line up; the ask list's "Looking for hours" tag (plan section 5); and the fix for
// the 60-day check-in answered on the PRN Team page. The rules (_shared/prn-week.ts memberSigns), the REAL prn-week against a
// fake database, coverage-run (its source), and the SQL on a throwaway Postgres when PGLITE is set. node prn_team_signs_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const F = 'supabase/functions'
const PW = await import(path.join(process.cwd(), F, '_shared/prn-week.ts'))
const TODAY = '2026-11-20'
const M = { applicant_id: 'g', name: 'Grace Hill', first: 'Grace', team: 'cna', since: '2026-06-01', axiscare_id: '11' }
const SH = (d, kind = 'confirmed', cs = 'c' + d) => ({ applicant_id: 'g', axiscare_caregiver_id: '11', case_id: cs, kind, shift_date: d })
const base = { member: M, shifts: [], touches: [], kindAt: null, wantsMore: null, looking: false, checkins: [], asks: [], today: TODAY }
const sig = (o) => PW.memberSigns({ ...base, ...o })

/* ── 1. the rules ── */
let s = sig({ shifts: [SH('2026-11-10'), SH('2026-11-15'), SH('2026-11-15', 'backed_out')], touches: [{ applicant_id: 'g', kind: 'thanks_sent', at: '2026-11-11T15:00:00Z' }, { applicant_id: 'g', kind: 'monthly_sent', at: '2026-11-02T15:00:00Z' }, { applicant_id: 'g', kind: 'welcome_sent', at: '2026-11-12T15:00:00Z' }], wantsMore: 20 })
ck('last PRN shift (a back-out doesn\'t count), last personal contact (a thank-you; never the monthly or the automatic welcome), wants about 20 hours', s.last_shift === '2026-11-10' && s.last_contact === '2026-11-11' && s.wants_more === 20 && s.drifting === false, s)
ck('...kind words count as personal contact', sig({ kindAt: '2026-11-18T10:00:00Z' }).last_contact === '2026-11-18')
const quiet = { shifts: [SH('2026-09-01')], checkins: [{ axiscare_caregiver_id: '11', sent_at: '2026-11-05T16:00:00Z', answered_at: null }] }
s = sig(quiet)
ck('may be drifting: two signs line up (no PRN shift in 45 days, no answer to the 60-day check-in), with the reasons', s.drifting === true && s.drifting_why.join() === 'no answer to the 60-day check-in,no PRN shift in 45+ days', s)
ck('...one sign alone: not drifting, and no reasons shown', sig({ shifts: [SH('2026-09-01')] }).drifting === false && sig({ shifts: [SH('2026-09-01')] }).drifting_why.length === 0)
ck('...the check-in answered: one sign, not drifting', sig({ ...quiet, checkins: [{ axiscare_caregiver_id: '11', sent_at: '2026-11-05T16:00:00Z', answered_at: '2026-11-06T10:00:00Z' }] }).drifting === false)
ck('...a check-in sent this week isn\'t counted yet', sig({ ...quiet, checkins: [{ axiscare_caregiver_id: '11', sent_at: '2026-11-18T16:00:00Z', answered_at: null }] }).drifting === false)
const asks = (st) => [1, 4, 9].map((n) => ({ at: new Date(Date.parse(TODAY + 'T12:00:00Z') - n * 864e5).toISOString(), state: st, replied_at: st === 'waiting' ? null : '2026-11-19' }))
s = sig({ shifts: [SH('2026-09-01')], asks: asks('waiting') })
ck('...no answer to the last 3 shift texts plus no shift in 45 days: drifting', s.drifting === true && s.drifting_why.includes('no answer to the last 3 shift texts'), s)
ck('...a "no" is an answer: declines are never counted against anyone', sig({ shifts: [SH('2026-09-01')], asks: asks('no') }).drifting === false)
ck('...someone looking for hours is never shown as drifting', sig({ ...quiet, looking: true }).drifting === false)
ck('...new to the team (under 45 days) with no shift yet: not drifting', sig({ member: { ...M, since: '2026-10-25' }, checkins: quiet.checkins }).drifting === false)

/* ── 2. coverage-run: the ask list's "Looking for hours" tag (its source; it needs AxisCare to run) ── */
const cr = fs.readFileSync(`${F}/coverage-run/index.ts`, 'utf8')
ck('ask list: PRN members looking for hours carry a "Looking for hours" tag in any group; it never changes the order', /const looking = await lookingAxIds\(\)/.test(cr) && /for \(const g of \['ready', 'review', 'dont'\]\) for \(const r of \(groups\[g\] \|\| \[\]\) as any\[\]\) if \(r\?\.axiscare_id && looking\.has\(String\(r\.axiscare_id\)\)\) r\.looking = true/.test(cr)
  && /lookingState\(\(log \?\? \[\]\)\.filter/.test(cr) && /catch \{ return new Set\(\) \}/.test(cr))

/* ── 3. the real prn-week ── */
const GRACE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', TOM = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', TASHA = 'cccccccc-cccc-cccc-cccc-cccccccccccc', OPTED = '4175550202'
let T, SENT, EVENTS, CALLS, NOW_ID = 1, CLOCK = '11'
const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
const reset = (settings = {}) => { SENT = []; EVENTS = []; CALLS = []; NOW_ID = 1; T = {
  app_data: [{ key: 'ops_settings', data: { prn_thanks_live: true, ...settings } }, { key: 'caregivers', data: [{ first: 'Grace', last: 'Lee', phone: '4175550101', axiscare_id: '11' }, { first: 'Tom', last: 'Ray', phone: OPTED, axiscare_id: '22' }] },
    { key: 'kind_tells', data: [] }, { key: 'caregiver_availability', data: [{ axiscare_id: '22', target_hours: 12 }] },
    { key: 'coverage_cases', data: [{ id: 'cv1', client: 'Linda Smith', shift_date: day(-2) }] }],
  pay_tracks: [{ applicant_id: GRACE, track: 'prn_team', team: 'cna', since: day(-60), axiscare_caregiver_id: '11' }, { applicant_id: TOM, track: 'prn_team', team: 'cna', since: day(-60), axiscare_caregiver_id: '22' },
    { applicant_id: TASHA, track: 'prn_team', team: 'caregiver', since: day(-5), axiscare_caregiver_id: null }],
  job_applicants: [{ id: GRACE, first_name: 'Grace', last_name: 'Lee', phone: '4175550101' }, { id: TOM, first_name: 'Tom', last_name: 'Ray', phone: OPTED }, { id: TASHA, first_name: 'Tasha', last_name: 'Fox', phone: '4175550303' }],
  prn_shift_log: [{ applicant_id: GRACE, axiscare_caregiver_id: '11', case_id: 'cv1', kind: 'confirmed', shift_date: day(-2), recorded_at: new Date().toISOString() }],
  prn_touches: [], prn_oncall: [],
  auth_identities: [{ auth_user_id: 'u-kr', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p-kr' }, { auth_user_id: 'u-cg', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p-cg' }],
  persons: [{ person_id: 'p-kr', full_name: 'Krystal Office', active: true }, { person_id: 'p-cg', full_name: 'Cara Giver', active: true }],
  entity_memberships: [{ person_id: 'p-kr', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p-cg', entity: 'cc_ihs', active: true, ended_at: null }],
  staff_roles: [{ person_id: 'p-kr', entity: 'cc_ihs', role: 'staffing_coordinator' }, { person_id: 'p-cg', entity: 'cc_ihs', role: 'caregiver' }],
  contact_optout_current: [{ address: '+1' + OPTED, channel: 'sms', opted_out: true, source: 'stop_text' }], phone_index: [], circle_contacts: [], op_events: [] } }
const q = (t) => { const st = { f: [], inF: null, nul: [], upd: null }; const b = {
  select() { return b }, order() { return b }, limit() { return b }, not() { return b },
  upsert(row) { const arr = (T[t] ||= []); const i = arr.findIndex((x) => x.month === row.month); if (i >= 0) Object.assign(arr[i], row); else arr.push({ sent_at: null, sent_by: null, sent_count: 0, ...row }); return Promise.resolve({ data: null, error: null }) },
  eq(c, v) { st.f.push([c, v]); return b }, in(c, v) { st.inF = [c, v]; return b }, is(c, v) { if (v === null) st.nul.push(c); return b },
  update(o) { st.upd = o; return b },
  insert(row) { if (t === 'op_events') { EVENTS.push(row); return Promise.resolve({ data: null, error: null }) }
    const arr = (T[t] ||= [])
    if (t === 'prn_touches' && arr.some((x) => x.applicant_id === row.applicant_id && x.kind === row.kind && x.ref === row.ref)) return Promise.resolve({ data: null, error: { message: 'duplicate key value violates unique constraint' } })
    if (t === 'prn_oncall' && row.kind === 'confirmed' && arr.some((x) => x.kind === 'confirmed' && !x.cancelled_at && x.applicant_id === row.applicant_id && x.start_date === row.start_date)) return Promise.resolve({ data: null, error: { message: 'duplicate key value violates unique constraint' } })
    arr.push({ id: NOW_ID++, at: new Date().toISOString(), cancelled_at: null, ...row }); return Promise.resolve({ data: null, error: null }) },
  rows() { let r = T[t] ?? []; for (const [c, v] of st.f) r = r.filter((x) => x[c] === v); if (st.inF) r = r.filter((x) => st.inF[1].includes(x[st.inF[0]])); for (const c of st.nul) r = r.filter((x) => x[c] == null); return r },
  maybeSingle() { return Promise.resolve({ data: JSON.parse(JSON.stringify(b.rows()[0] ?? null)), error: null }) },
  then(ok) { if (st.upd) { for (const x of b.rows()) Object.assign(x, st.upd); return Promise.resolve({ data: null, error: null }).then(ok) }
    return Promise.resolve({ data: JSON.parse(JSON.stringify(b.rows())), error: null }).then(ok) } }; return b }
globalThis.__db = { from: q, rpc: async () => ({ data: null, error: null }),
  auth: { getUser: async (jwt) => jwt === 'kr' ? { data: { user: { id: 'u-kr', email: 'Krystal@mo-care.com', app_metadata: {} } }, error: null }
    : jwt === 'cg' ? { data: { user: { id: 'u-cg', email: 'cg@mo-care.com', app_metadata: {} } }, error: null } : { data: { user: null }, error: { message: 'bad' } } } }
globalThis.fetch = async (url, o) => { url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}; CALLS.push(url)
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + body.phone, dnd: false } }), { status: 200 })
  if (url.includes('/conversations/messages')) { SENT.push({ to: body.contactId, text: body.message, from: body.fromNumber }); return new Response('{}', { status: 200 }) }
  return new Response('{}', { status: 404 }) }
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const tmp = fs.mkdtempSync(path.join(process.cwd(), '_ts_'))
try {
  const src = fs.readFileSync(path.join(F, 'prn-week/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/from '\.\.\/_shared\/(\w[\w-]*)\.ts'/g, (_, m) => "from '" + path.join(process.cwd(), F, '_shared', m + '.ts') + "'")
  fs.writeFileSync(path.join(tmp, 'prn-week.ts'), src); await import(path.join(tmp, 'prn-week.ts'))
  const call = async (body, jwt = 'kr') => { const r = await handler(new Request('https://x/functions/v1/prn-week', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: 'Bearer ' + jwt } : {}) }, body: JSON.stringify(body) }))
    let j = null; try { j = await r.json() } catch { /* */ } return { status: r.status, j } }
  reset(); T.prn_checkins = [{ axiscare_caregiver_id: '22', sent_at: new Date(Date.now() - 10 * 864e5).toISOString(), answered_at: null }]
  T.prn_shift_log = []; T.pay_tracks[1].since = day(-90)
  let r = await call({ action: 'week' })
  const g = r.j.members.find((m) => m.name === 'Grace Lee').page.signs, t = r.j.members.find((m) => m.name === 'Tom Ray').page.signs
  ck('week: each member carries their signs; the switch comes back off', r.j.signs_live === false && 'last_contact' in g && 'last_shift' in g && t.wants_more === 12, [g, t])
  ck('...Tom: no answer to the check-in and no PRN shift in 90 days: may be drifting', t.drifting === true && t.drifting_why.length === 2, t)
  ck('...sends nothing', !SENT.length)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }

/* ── 4. the SQL: the 60-day check-in answered on the PRN Team page ── */
const sql = fs.readFileSync('prn_team_signs.sql', 'utf8')
if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE); const db = new PGlite()
  await db.exec(`create table public.job_applicants (id uuid primary key);`)
  try { await db.exec(`do $$ begin create role anon; create role authenticated; create role service_role; exception when others then null; end $$;`) } catch {}
  await db.exec(fs.readFileSync('prn4.sql', 'utf8').replace(/^begin;|^commit;/gim, ''))
  await db.query(`insert into public.prn_checkins (axiscare_caregiver_id) values ('11')`)
  let before = false; try { await db.query(`update public.prn_checkins set answered_at = now(), how = 'prn_page'`) } catch { before = true }
  await db.exec('begin;' + sql + 'commit;'); await db.exec('begin;' + sql + 'commit;')
  await db.query(`update public.prn_checkins set answered_at = now(), how = 'prn_page'`)
  const okOld = (await db.query(`update public.prn_checkins set how = 'still_right' returning id`)).rows.length === 1
  let bad = false; try { await db.query(`update public.prn_checkins set how = 'nonsense'`) } catch { bad = true }
  ck('SQL: before the fix, an answer from the PRN Team page was refused; after it (run twice), it is kept, the earlier answers still are, anything else is refused', before && okOld && bad, { before, okOld, bad })
} else ck('SQL on a throwaway Postgres (skipped: PGLITE not set)', true)

const fails = res.filter((r) => !r[1])
for (const [n, okk, note] of res) console.log((okk ? 'PASS ' : 'FAIL ') + n + (okk ? '' : '  ' + note))
console.log(`\n${res.length - fails.length}/${res.length} passed`)
process.exit(fails.length ? 1 : 0)
