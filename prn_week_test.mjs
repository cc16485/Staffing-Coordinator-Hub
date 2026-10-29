// PRN STEP 2 (Samantha 2026-10-28): the "This week" list and the on-call calendar. The rules (_shared/prn-week.ts), the SQL in a
// real Postgres (PGLITE), and the REAL prn-week function with the REAL staff check, outbound gate and opt-out check, against a
// fake database and a fake GoHighLevel. Nothing real is reached. PGLITE=<path> node prn_week_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const F = 'supabase/functions'
const W = await import(path.join(process.cwd(), F, '_shared/prn-week.ts'))

/* ── 1. the rules ── */
const TODAY = '2026-10-28'   /* a Wednesday */
const M = (id, o = {}) => ({ applicant_id: id, name: 'Name ' + id, first: 'First' + id, team: 'cna', since: '2026-09-01', axiscare_id: 'ax' + id, ...o })
const SH = (aid, case_id, d, kind = 'confirmed') => ({ applicant_id: aid, axiscare_caregiver_id: 'ax' + aid, case_id, kind, shift_date: d, recorded_at: d + 'T12:00:00Z' })
const base = { touches: [], kindTo: {}, wantsMore: {}, cases: { c1: { client: 'Linda', shift_date: '2026-10-25' }, c2: { client: 'Ruth', shift_date: '2026-09-01' } }, today: TODAY, sender: 'Krystal Office' }
let w = W.computeWeek({ ...base, members: [M('a')], shifts: [SH('a', 'c1', '2026-10-25')] })
const th = w.items.find((x) => x.kind === 'thanks')
ck('a shift covered Sunday: a thank-you line, with the drafted text, signed with the sender\'s first name', th && th.detail === 'Name a covered Linda on Sunday.'
  && th.draft === 'Hi Firsta, thank you for stepping in for Linda on Sunday. You made a real difference for Linda and their family. Krystal', th)
w = W.computeWeek({ ...base, members: [M('a')], shifts: [SH('a', 'c1', '2026-10-25')], touches: [{ applicant_id: 'a', kind: 'thanks_sent', ref: 'shift:c1', at: '2026-10-26T15:00:00Z' }] })
ck('thanked already: the line is gone', !w.items.some((x) => x.kind === 'thanks'))
w = W.computeWeek({ ...base, members: [M('a')], shifts: [SH('a', 'c2', '2026-09-01')] })
ck('a shift over 3 weeks ago: no thank-you line (too late to be timely)', !w.items.some((x) => x.kind === 'thanks'))
w = W.computeWeek({ ...base, members: [M('a')], shifts: [SH('a', 'c1', '2026-10-25'), SH('a', 'c1', '2026-10-25', 'backed_out')] })
ck('a shift they backed out of: no thank-you', !w.items.some((x) => x.kind === 'thanks'))
const ten = Array.from({ length: 10 }, (_, i) => SH('a', 'old' + i, '2026-08-0' + (i % 9 + 1)))
w = W.computeWeek({ ...base, members: [M('a')], shifts: ten })
ck('10 PRN shifts: a handwritten card line', w.items.some((x) => x.kind === 'milestone' && x.ref === 'shifts:10' && /reached 10 PRN shifts/.test(x.title)), w.items)
w = W.computeWeek({ ...base, members: [M('a')], shifts: ten, touches: [{ applicant_id: 'a', kind: 'card_mailed', ref: 'shifts:10', at: '2026-10-27' }] })
ck('card mailed: the line is gone for good', !w.items.some((x) => x.kind === 'milestone'))
w = W.computeWeek({ ...base, members: [M('a', { since: '2025-10-20' })], shifts: [] })
ck('a year on the team: a card line', w.items.some((x) => x.ref === 'year:1' && /one year on the PRN CNA Team/.test(x.title)), w.items)
w = W.computeWeek({ ...base, members: [M('a')], shifts: [], wantsMore: { axa: 10 } })
ck('would like 10 more hours, no PRN shift yet: an hours line', w.items.some((x) => x.kind === 'hours' && /About 10 a week; no PRN shift yet/.test(x.detail)), w.items)
w = W.computeWeek({ ...base, members: [M('a')], shifts: [SH('a', 'c1', '2026-10-25')], wantsMore: { axa: 10 } })
ck('...but not when they had a PRN shift in the last 2 weeks', !w.items.some((x) => x.kind === 'hours'))
w = W.computeWeek({ ...base, members: [M('a')], shifts: [] })
ck('on the team 57 days, nobody in touch personally: a check-in line, never a mark against them', w.items.some((x) => x.kind === 'checkin' && /No personal contact recorded yet\. Worth a call\./.test(x.detail)), w.items)
w = W.computeWeek({ ...base, members: [M('a')], shifts: [], kindTo: { axa: '2026-10-20T10:00:00Z' } })
ck('kind words texted last week count as being in touch', !w.items.some((x) => x.kind === 'checkin'))
w = W.computeWeek({ ...base, members: [M('a')], shifts: [], touches: [{ applicant_id: 'a', kind: 'called', ref: 'checkin:' + W.weekOf(TODAY), at: '2026-10-28T10:00:00Z' }] })
ck('called this week: the check-in line is gone', !w.items.some((x) => x.kind === 'checkin'))
w = W.computeWeek({ ...base, members: [M('a', { since: '2026-10-19' })], shifts: [] })
ck('new to the team (under 30 days): no check-in line yet', !w.items.some((x) => x.kind === 'checkin'))
w = W.computeWeek({ ...base, members: Array.from({ length: 12 }, (_, i) => M('m' + i)), shifts: [] })
ck('capped at 8 lines, with how many more', w.items.length === 8 && w.more === 4, [w.items.length, w.more])
ck('the week starts Monday', W.weekOf('2026-10-28') === '2026-10-26' && W.weekOf('2026-11-01') === '2026-10-26' && W.weekOf('2026-11-02') === '2026-11-02')
ck('no em dash in the drafted text', !/—/.test(W.THANKS_DEFAULT))
const OC = [{ id: 1, applicant_id: 'a', kind: 'confirmed', start_date: '2026-11-07', end_date: '2026-11-08', cancelled_at: null },
            { id: 2, applicant_id: 'b', kind: 'confirmed', start_date: '2026-11-14', end_date: '2026-11-15', cancelled_at: '2026-10-27T00:00:00Z' },
            { id: 3, applicant_id: 'a', kind: 'offer', pattern: 'every_weekend', at: '2026-10-01' }, { id: 4, applicant_id: 'a', kind: 'offer', pattern: 'every_other_weekend', at: '2026-10-20' },
            { id: 5, applicant_id: 'c', kind: 'offer', pattern: 'weekday', at: '2026-10-20' }]
const oc = W.onCallWeekends(OC, [M('a'), M('b'), M('c', { team: 'caregiver' })], TODAY)
ck('the next 8 weekends from this Saturday', oc.weekends.length === 8 && oc.weekends[0].saturday === '2026-10-31' && oc.weekends[0].sunday === '2026-11-01', oc.weekends[0])
ck('Nov 7 to 8 confirmed; Nov 14 to 15 taken back = a gap', oc.weekends[1].confirmed.map((x) => x.name).join() === 'Name a' && oc.weekends[2].gap === true, oc.weekends.slice(1, 3))
ck('the latest offer per PRN CNA counts; a PRN Caregiver Team member is not on call', oc.offers.length === 1 && oc.offers[0].pattern_word === 'Every other weekend', oc.offers)

/* ── 2. the SQL in a real Postgres ── */
const SQL = fs.readFileSync('prn_week.sql', 'utf8')
ck('no em dash anywhere in the SQL', !/—/.test(SQL))
if (!process.env.PGLITE) ck('PGLITE is set', false)
else {
  const { PGlite } = await import(process.env.PGLITE); const db = new PGlite()
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create table public.job_applicants (id uuid primary key default gen_random_uuid(), first_name text);`)
  await db.exec(SQL); await db.exec(SQL)
  ck('runs twice cleanly', true)
  const a = (await db.query(`insert into public.job_applicants (first_name) values ('Grace') returning id`)).rows[0].id
  await db.query(`insert into public.prn_touches (applicant_id, kind, ref, by_email) values ($1, 'card_mailed', 'shifts:10', 'k@x')`, [a])
  let e = null; try { await db.query(`insert into public.prn_touches (applicant_id, kind, ref, by_email) values ($1, 'card_mailed', 'shifts:10', 'k@x')`, [a]) } catch (x) { e = x.message }
  ck('one record per person, kind and line', /duplicate|unique/.test(e || ''), e)
  e = null; try { await db.query(`update public.prn_touches set note = 'x'`) } catch (x) { e = x.message }
  ck('what the office did is never edited', /HISTORY_IS_KEPT/.test(e || ''), e)
  e = null; try { await db.query(`delete from public.prn_touches`) } catch (x) { e = x.message }
  ck('...or deleted', /HISTORY_IS_KEPT/.test(e || ''), e)
  e = null; try { await db.query(`insert into public.prn_oncall (applicant_id, kind, by_email) values ($1, 'offer', 'k@x')`, [a]) } catch (x) { e = x.message }
  ck('an offer must say what they offered', /prn_oncall_offer_has_pattern/.test(e || ''), e)
  e = null; try { await db.query(`insert into public.prn_oncall (applicant_id, kind, start_date, end_date, by_email) values ($1, 'confirmed', '2026-11-01', '2026-11-12', 'k@x')`, [a]) } catch (x) { e = x.message }
  ck('a confirmed stretch is at most 7 days', /prn_oncall_confirmed_has_dates/.test(e || ''), e)
  const oc1 = (await db.query(`insert into public.prn_oncall (applicant_id, kind, start_date, end_date, by_email) values ($1, 'confirmed', '2026-11-07', '2026-11-08', 'k@x') returning id`, [a])).rows[0].id
  e = null; try { await db.query(`insert into public.prn_oncall (applicant_id, kind, start_date, end_date, by_email) values ($1, 'confirmed', '2026-11-07', '2026-11-08', 'k@x')`, [a]) } catch (x) { e = x.message }
  ck('the same weekend is not confirmed twice for one person', /duplicate|unique/.test(e || ''), e)
  e = null; try { await db.query(`update public.prn_oncall set start_date = '2026-11-14' where id = $1`, [oc1]) } catch (x) { e = x.message }
  ck('a confirmed date is never changed', /ONLY_CANCEL/.test(e || ''), e)
  await db.query(`update public.prn_oncall set cancelled_at = now(), cancelled_by = 'Krystal' where id = $1`, [oc1])
  ck('...only taken back', (await db.query(`select cancelled_at is not null as c from public.prn_oncall where id = $1`, [oc1])).rows[0].c)
  e = null; try { await db.query(`update public.prn_oncall set cancelled_at = now() where id = $1`, [oc1]) } catch (x) { e = x.message }
  ck('...once', /ONLY_CANCEL/.test(e || ''), e)
  await db.query(`insert into public.prn_oncall (applicant_id, kind, start_date, end_date, by_email) values ($1, 'confirmed', '2026-11-07', '2026-11-08', 'k@x')`, [a])
  ck('after taking it back, the weekend can be confirmed again', true)
  e = null; try { await db.query(`delete from public.prn_oncall`) } catch (x) { e = x.message }
  ck('on-call rows are never deleted', /HISTORY_IS_KEPT/.test(e || ''), e)
  const g = (await db.query(`select has_table_privilege('authenticated', 'public.prn_touches', 'select') r, has_table_privilege('authenticated', 'public.prn_touches', 'insert') w,
    has_table_privilege('anon', 'public.prn_oncall', 'select') a`)).rows[0]
  ck('office staff can read; only the server writes; the public gets nothing', g.r === true && g.w === false && g.a === false, g)
}

/* ── 3. the real prn-week function ── */
const GRACE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', TOM = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', TASHA = 'cccccccc-cccc-cccc-cccc-cccccccccccc', OPTED = '4175550202'
let T, SENT, EVENTS, CALLS, NOW_ID = 1
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
  select() { return b }, order() { return b }, gte() { return b }, lte() { return b }, limit() { return b }, not() { return b },
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
const tmp = fs.mkdtempSync(path.join(process.cwd(), '_pw_'))
try {
  const src = fs.readFileSync(path.join(F, 'prn-week/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/from '\.\.\/_shared\/(\w[\w-]*)\.ts'/g, (_, m) => "from '" + path.join(process.cwd(), F, '_shared', m + '.ts') + "'")
  fs.writeFileSync(path.join(tmp, 'prn-week.ts'), src); await import(path.join(tmp, 'prn-week.ts'))
  const call = async (body, jwt = 'kr') => { const r = await handler(new Request('https://x/functions/v1/prn-week', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: 'Bearer ' + jwt } : {}) }, body: JSON.stringify(body) }))
    let j = null; try { j = await r.json() } catch { /* */ } return { status: r.status, j } }
  reset(); let r = await call({ action: 'week' }, null); ck('no sign-in: refused', r.status === 401, r)
  reset(); r = await call({ action: 'week' }, 'cg'); ck('a caregiver sign-in: refused', r.status === 403, r)
  reset(); r = await call({ action: 'week' })
  const kinds = (r.j.items || []).map((x) => x.kind + ':' + x.name).sort()
  ck('week: thank Grace (Linda), Tom would like more hours, check in with Grace and Tom; nothing for Tasha (new)', r.status === 200
    && JSON.stringify(kinds) === JSON.stringify(['checkin:Grace Lee', 'checkin:Tom Ray', 'hours:Tom Ray', 'thanks:Grace Lee']), [r.status, kinds])
  ck('week: switches and owner come back (list off by default, owner Krystal), and no stipend', r.j.live === false && r.j.thanks_live === true && r.j.owner === 'Krystal' && r.j.oncall.stipend === null, r.j)
  ck('week: sends nothing', !SENT.length)
  const th = r.j.items.find((x) => x.kind === 'thanks')
  ck('the drafted thank-you names Linda and is signed Krystal', /^Hi Grace, thank you for stepping in for Linda .+\. You made a real difference for Linda and their family\. Krystal$/.test(th.draft), th.draft)
  r = await call({ action: 'send_thanks', applicant_id: GRACE, case_id: 'cv1', message: th.draft, send_id: 'send-0001' })
  ck('send: the exact words, from the office number, recorded', r.j.outcome === 'sent' && SENT.length === 1 && SENT[0].text === th.draft && T.prn_touches.some((x) => x.kind === 'thanks_sent' && x.ref === 'shift:cv1' && x.message === th.draft), [r.j, SENT, T.prn_touches])
  r = await call({ action: 'send_thanks', applicant_id: GRACE, case_id: 'cv1', message: th.draft, send_id: 'send-0002' })
  ck('sent once: a second press sends nothing', r.j.outcome === 'already_sent' && SENT.length === 1, r.j)
  r = await call({ action: 'week' }); ck('...and the line is gone', !r.j.items.some((x) => x.kind === 'thanks'), r.j.items)
  reset({ prn_thanks_live: false }); r = await call({ action: 'send_thanks', applicant_id: GRACE, case_id: 'cv1', message: 'Hi Grace, thank you.', send_id: 'send-0003' })
  ck('switch off: refused, nothing sent, nothing recorded', r.status === 409 && !SENT.length && !T.prn_touches.length, r)
  reset(); r = await call({ action: 'send_thanks', applicant_id: TOM, case_id: 'cv1', message: 'Hi Tom, thank you.', send_id: 'send-0004' })
  ck('someone who asked for no texts: not sent, and it says why', r.status === 422 && /asked not to get texts/.test(r.j.error) && !SENT.length && !T.prn_touches.length, r.j)
  reset(); r = await call({ action: 'send_thanks', applicant_id: GRACE, case_id: 'cv1', message: 'Hi Grace — thank you.', send_id: 'send-0005' })
  ck('an em dash is refused before anything is sent', r.status === 400 && !SENT.length, r.j)
  reset(); r = await call({ action: 'mark', applicant_id: TOM, kind: 'called', ref: 'checkin:' + W.weekOf(day(0)) })
  const r2 = await call({ action: 'week' })
  ck('mark called: Tom\'s check-in line is gone this week', r.j.outcome === 'recorded' && !r2.j.items.some((x) => x.kind === 'checkin' && x.name === 'Tom Ray'), r2.j.items)
  r = await call({ action: 'mark', applicant_id: TOM, kind: 'paid', ref: 'x' }); ck('mark: only the four kinds', r.status === 400)
  reset(); r = await call({ action: 'oncall_offer', applicant_id: GRACE, pattern: 'every_other_weekend' })
  const sat = r && (() => { const d = new Date(day(0) + 'T12:00:00Z'); return new Date(d.getTime() + ((6 - d.getUTCDay() + 7) % 7 + 7) * 86400000).toISOString().slice(0, 10) })()
  const sun = new Date(Date.parse(sat + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10)
  let r3 = await call({ action: 'oncall_confirm', applicant_id: GRACE, start_date: sat, end_date: sun })
  r = await call({ action: 'week' })
  ck('on call: Grace\'s offer and her confirmed weekend show; the other weekends are gaps', r3.j.outcome === 'recorded' && r.j.oncall.offers[0]?.pattern_word === 'Every other weekend'
    && r.j.oncall.weekends.find((x) => x.saturday === sat)?.confirmed[0]?.name === 'Grace Lee' && r.j.oncall.weekends.filter((x) => x.gap).length === 7, r.j.oncall)
  r3 = await call({ action: 'oncall_confirm', applicant_id: TASHA, start_date: sat, end_date: sun })
  ck('on call is for the PRN CNA Team only', r3.status === 422, r3.j)
  r3 = await call({ action: 'oncall_confirm', applicant_id: GRACE, start_date: day(-3), end_date: day(-2) })
  ck('a date that has passed is refused', r3.status === 400, r3.j)
  const id = T.prn_oncall.find((x) => x.kind === 'confirmed').id
  r3 = await call({ action: 'oncall_cancel', id }); r = await call({ action: 'week' })
  ck('taking it back makes that weekend a gap again (kept, marked cancelled)', r3.j.outcome === 'cancelled' && r.j.oncall.weekends.every((x) => x.gap) && T.prn_oncall.find((x) => x.id === id).cancelled_by === 'Krystal Office', r.j.oncall.weekends.slice(0, 2))
  ck('every change is in the office history', EVENTS.some((e) => e.verb === 'prn_oncall_offer') && EVENTS.some((e) => e.verb === 'prn_oncall_confirmed') && EVENTS.some((e) => e.verb === 'prn_oncall_cancelled'), EVENTS.map((e) => e.verb))
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }

for (const [n, o, d] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n     ' + d))
console.log(`${res.filter((x) => x[1]).length}/${res.length}`)
