// 420 · the morning brief (lead-digest) at 8am Chicago all year, with today's interviews and assessments.
// Samantha 2026-10-02: "can interviews and booked assessments be on 'Today' and also be in the email that goes out every
// morning - also make that email send at 8am not 7am - also mark interviews 2pm and after as Samantha's interviews".
// The REAL function against a fake database, fake GoHighLevel and a pinned clock. Nothing is sent anywhere.
// node morning_email_420_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
let T, MAIL, RPC, OPTS
const BOOKINGS = [
  { id: 'b1', applicant_id: 'a1', starts_at: '2026-10-02T19:30:00Z', status: 'booked' },     // 2:30pm CDT → Samantha's
  { id: 'b2', applicant_id: 'a2', starts_at: '2026-10-02T14:00:00Z', status: 'booked' },     // 9:00am
  { id: 'b3', applicant_id: 'a3', starts_at: '2026-10-02T19:00:00Z', status: 'noshow' },     // 2:00pm exactly → Samantha's
  { id: 'b4', applicant_id: 'a4', starts_at: '2026-10-02T16:00:00Z', status: 'cancelled' },  // gone
  { id: 'b5', applicant_id: 'a5', starts_at: '2026-10-03T15:00:00Z', status: 'booked' },     // tomorrow
  { id: 'w1', applicant_id: 'a1', starts_at: '2026-12-02T20:00:00Z', status: 'booked' },     // 2:00pm CST (winter)
  { id: 'w2', applicant_id: 'a2', starts_at: '2026-12-02T19:30:00Z', status: 'booked' },     // 1:30pm CST
]
const reset = (o = {}) => { MAIL = []; RPC = []; OPTS = o; T = {
  app_data: [{ key: 'leads', data: [
      { id: 'L1', first_name: 'Dana', last_name: 'Daughter', client_first_name: 'Mae', client_last_name: 'Mom', phone: '4175550101', status: 'Assessment Scheduled', assessment_at: 'Friday, October 2, 2026 10:00 AM', client_address: '1 Elm St, Nixa', created_at: '2026-09-20T10:00:00Z' },
      { id: 'L2', first_name: 'Eli', last_name: 'Ghl', phone: '4175550102', status: 'Assessment Scheduled', assessment_at: 'Friday, October 2, 2026 1:00 PM', created_at: '2026-09-20T10:00:00Z' },
      { id: 'L3', first_name: 'Fay', last_name: 'Lost', status: 'Lost', assessment_at: 'Friday, October 2, 2026 3:00 PM', created_at: '2026-09-20T10:00:00Z' }, ...(o.extraLeads || [])] },
    { key: 'care_assessments', data: [{ id: 'A1', lead_id: 'L1', client_name: 'Mae Mom', visit_date: '2026-10-02', coordinator: 'Krystal', address: '1 Elm St, Nixa', status: 'Scheduled' }] },
    { key: 'ops_settings', data: { morning_brief_recipients: [{ name: 'Samantha', email: 'samantha@mo-care.com', admin: true }, { name: 'Krystal', email: 'krystal@mo-care.com', admin: false }], ...(o.ops || {}) } },
    { key: 'morning_brief_state', data: o.marker ? [{ id: 'sent_' + o.marker }] : [] },
    { key: 'ops_items', data: o.items || [] }, ...(o.bonuses ? [{ key: 'cc_bonuses', data: o.bonuses }] : [])],
  interview_bookings: o.noInterviews ? [] : BOOKINGS,
  job_applicants: [{ id: 'a1', first_name: 'Ava', last_name: 'Afternoon', phone: '4175559991' }, { id: 'a2', first_name: 'Ben', last_name: 'Morning', phone: '4175559992' },
    { id: 'a3', first_name: 'Cal', last_name: 'Missed', phone: '4175559993' }, { id: 'a4', first_name: 'Dee', last_name: 'Cancelled' }, { id: 'a5', first_name: 'Eve', last_name: 'Tomorrow' }] } }
const Q = []
const q = (t) => { const st = { t, f: [] }; const b = { select() { return b }, order() { return b }, limit() { return b },
  in(c, v) { st.f.push(['in', c, v]); return b }, gte(c, v) { st.f.push(['gte', c, v]); return b }, lt(c, v) { st.f.push(['lt', c, v]); return b },
  eq(c, v) { st.f.push(['eq', c, v]); return b }, maybeSingle() { return b.then((x) => ({ data: x.data?.[0] ?? null, error: x.error })) },
  then(ok, ko) { Q.push(st)
    if (t === 'interview_bookings' && OPTS.ivFails) return Promise.resolve({ data: null, error: { message: 'permission denied for table interview_bookings' } }).then(ok, ko)
    if (t === 'app_data' && OPTS.asFails && st.f.some((f) => f[2] === 'care_assessments')) return Promise.resolve({ data: null, error: { message: 'statement timeout' } }).then(ok, ko)
    let rows = T[t] ?? []
    for (const [k, c, v] of st.f) rows = rows.filter((r) => k === 'eq' ? r[c] === v : k === 'in' ? v.includes(r[c]) : k === 'gte' ? String(r[c]) >= v : k === 'lt' ? String(r[c]) < v : true)
    return Promise.resolve({ data: rows, error: null }).then(ok, ko) } }; return b }
globalThis.__db = { from: q, rpc: async (fn, a) => { RPC.push([fn, a]); return { error: null } },
  auth: { getUser: async () => ({ data: { user: null }, error: { message: 'bad' } }) } }
const realFetch = globalThis.fetch
globalThis.fetch = async (url, o) => { url = String(url); const body = o?.body ? JSON.parse(o.body) : {}
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + body.email, email: body.email } }), { status: 200 })
  if (url.includes('/contacts/search') || url.includes('/contacts/?') || url.includes('/contacts?')) return new Response(JSON.stringify({ contacts: [] }), { status: 200 })
  if (url.includes('/conversations/messages')) { MAIL.push({ to: body.contactId.slice(2), subject: body.subject, html: body.html }); return new Response('{}', { status: 200 }) }
  return new Response('{}', { status: 404 }) }
// a pinned clock: new Date() and Date.now() are NOW; everything else is the real Date
const RealDate = Date; let NOW = RealDate.parse('2026-10-02T13:00:00Z')
globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [NOW])) } static now() { return NOW } static parse(s) { return RealDate.parse(s) } static UTC(...a) { return RealDate.UTC(...a) } }
const JOBSEC = 'j'.repeat(64)
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', HUB_JOB_SECRET: JOBSEC }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_me420_'))
let M
try {
  fs.writeFileSync(path.join(tmp, 'job-auth.ts'), fs.readFileSync(path.join(F, '_shared/job-auth.ts'), 'utf8')
    .replace(/^import \{ createClient \} from .*$/m, "const createClient = () => ({ from: () => ({ select: () => ({ limit: async () => ({ error: { message: 'denied' } }) }) }) })")
    .replace("from './staff-auth.ts'", "from '" + path.resolve(F, '_shared/staff-auth.ts') + "'"))
  const src = fs.readFileSync(path.join(F, 'lead-digest/index.ts'), 'utf8')
    .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/from '\.\.\/_shared\/(\w[\w-]*)\.ts'/g, (_, m) => "from '" + (m === 'job-auth' ? path.join(tmp, 'job-auth.ts') : path.resolve(F, '_shared', m + '.ts')) + "'")
  fs.writeFileSync(path.join(tmp, 'ld.ts'), src); M = await import(path.join(tmp, 'ld.ts'))
  const cron = async (iso, o = {}) => { NOW = RealDate.parse(iso); reset(o)
    const r = await handler(new Request('https://x/functions/v1/lead-digest', { headers: { 'x-cron-secret': JOBSEC } }))
    let j = null; try { j = await r.json() } catch { /* */ } return { status: r.status, j } }

  // ---- 2026-10-07: the Hub's assessment form now has a visit time; it is the assessment's time in the brief too ----
  const vt = M.assessmentsOn('2026-10-02', [{ id: 'A9', client_name: 'Gus Hub', visit_date: '2026-10-02', visit_time: '11:30', status: 'Scheduled' }], [])
  ck('a Hub visit time is the assessment\'s time in the brief (11:30am)', vt.length === 1 && vt[0].min === 11 * 60 + 30, vt)
  const lx = M.assessmentsOn('2026-10-02', [{ id: 'A8', lead_id: 'LY', client_name: 'Old Record', visit_date: '2026-10-02', status: 'Scheduled' }], [{ id: 'LY', assessment_at: 'Friday, October 2, 2026 9:00 AM' }])
  ck('...an older record without one still takes GoHighLevel\'s booked time (9:00am)', lx.length === 1 && lx[0].min === 9 * 60, lx)

  // ---- 8am all year ----
  let r = await cron('2026-10-02T13:00:00Z')
  ck('summer (CDT): the 13:00 UTC run is 8am in Chicago and sends one brief per recipient', r.status === 200 && r.j.status === 'sent' && MAIL.length === 2, { r, n: MAIL.length })
  ck('summer: the sent-marker for the day is written (so the 14:00 run can never send twice)', RPC.some(([fn, a]) => fn === 'upsert_app_data_item' && a.target_key === 'morning_brief_state' && a.item.id === 'sent_2026-10-02'), RPC)
  const sam = MAIL.find((m) => m.to === 'samantha@mo-care.com'), kry = MAIL.find((m) => m.to === 'krystal@mo-care.com')
  r = await cron('2026-10-02T14:00:00Z')
  ck('summer: the 14:00 UTC run (9am Chicago) sends nothing', r.j.status === 'not 8am in Chicago, no brief' && !MAIL.length, r)
  r = await cron('2026-10-02T12:45:00Z')
  ck('the old 6:45/7:45 times send nothing now', r.j.status === 'not 8am in Chicago, no brief' && !MAIL.length, r)
  r = await cron('2026-12-02T13:00:00Z')
  ck('winter (CST, after Nov 1): the 13:00 UTC run is 7am in Chicago and sends nothing', r.j.status === 'not 8am in Chicago, no brief' && !MAIL.length, r)
  r = await cron('2026-12-02T14:00:00Z')
  ck('winter: the 14:00 UTC run is 8am in Chicago and sends', r.j.status === 'sent' && MAIL.length === 2, r)
  const winter = MAIL.find((m) => m.to === 'samantha@mo-care.com')
  r = await cron('2026-10-02T13:00:00Z', { marker: '2026-10-02' })
  ck('already sent today (marker present): nothing sent', r.j.status === 'already sent today' && !MAIL.length, r)
  r = await cron('2026-10-03T13:00:00Z')
  ck('Saturday 8am: nothing (weekdays only, unchanged)', /weekend/.test(r.j.status) && !MAIL.length, r)

  // ---- what the email says ----
  const h = sam?.html || ''
  ck('"Interviews today (3)": cancelled and tomorrow left out', /Interviews today \(3\)/.test(h) && !/Dee Cancelled|Eve Tomorrow/.test(h), h.slice(0, 200))
  const iv = h.slice(h.indexOf('Interviews today'), h.indexOf('Assessments today'))
  ck('interviews in time order: 9:00am Ben, 2:00pm Cal, 2:30pm Ava', iv.indexOf('9:00am</b> · Ben Morning') > 0 && iv.indexOf('9:00am') < iv.indexOf('2:00pm</b> · Cal Missed') && iv.indexOf('2:00pm') < iv.indexOf('2:30pm</b> · Ava Afternoon'), iv.slice(0, 1500))
  ck('"Samantha\'s interview" on 2:00pm and 2:30pm only (2pm and after), not on 9:00am', (iv.match(/Samantha&#39;s interview/g) || []).length === 2 && !/Ben Morning[^]*?Samantha&#39;s interview[^]*?Cal Missed/.test(iv.replace(/Cal Missed[^]*$/, 'Cal Missed')), iv.slice(0, 1500))
  ck('status chips: booked and no-show', />booked</.test(iv) && />no-show</.test(iv))
  ck('in person at the office, and no applicant phone numbers in the email', /In person at the office/.test(iv) && !/555999/.test(h))
  const as = h.slice(h.indexOf('Assessments today'))
  ck('"Assessments today (2)": the Hub visit (10:00am, address, with Krystal) and the GHL booking (1:00pm), the lost one left out, one family once',
    /Assessments today \(2\)/.test(h) && /10:00am<\/b> · Mae Mom/.test(as) && /1 Elm St, Nixa · with Krystal/.test(as) && /1:00pm<\/b> · Eli Ghl/.test(as) && /address not on file · who is going is not on file/.test(as) && !/Fay Lost/.test(h) && (h.match(/Mae Mom/g) || []).length === 1, as.slice(0, 1200))
  ck('the personal edition (not admin) carries the same two lists', /Interviews today \(3\)/.test(kry?.html || '') && /Assessments today \(2\)/.test(kry?.html || '') && !/Full Picture/.test(kry?.html || ''))
  ck('the at-a-glance strip and the subject count them', />interviews</.test(h) && />assessments</.test(h) && /3 interviews, 2 assessments/.test(sam.subject), sam?.subject)
  ck('the footer says 8am', /Sent at 8am by your hub/.test(h) && !/6:45/.test(h))
  ck('winter: the 2pm CST interview is Samantha\'s, the 1:30pm one is not', /2:00pm<\/b> · Ava Afternoon[^]*?Samantha&#39;s interview/.test(winter?.html || '') && (winter.html.match(/Samantha&#39;s interview/g) || []).length === 1, (winter?.html || '').slice(0, 300))
  ck('interviews are asked for in a window around the Chicago day, cancelled excluded by status', Q.some((s) => s.t === 'interview_bookings' && s.f.some((f) => f[0] === 'in' && f[1] === 'status' && !f[2].includes('cancelled')) && s.f.some((f) => f[0] === 'gte')))

  // ---- no silent failures ----
  r = await cron('2026-10-02T13:00:00Z', { ivFails: true })
  const e1 = MAIL[0]?.html || ''
  ck('interviews can\'t load: the brief still goes AND says so with the reason', r.j.status === 'sent' && MAIL.length === 2 && /Could not load today's interviews \(permission denied for table interview_bookings\)\. Check the Interviews tab/.test(e1) && /Assessments today \(2\)/.test(e1), e1.slice(0, 400))
  ck('the scheduled reply records it ("not loaded") without naming anyone', r.j.briefs.every((b) => b.interviews === 'not loaded') && !JSON.stringify(r.j).includes('@'), r.j)
  r = await cron('2026-10-02T13:00:00Z', { asFails: true })
  ck('assessments can\'t load: the brief says so', /Could not load today's assessments \(statement timeout\)/.test(MAIL[0]?.html || '') && /Interviews today \(3\)/.test(MAIL[0]?.html || ''), (MAIL[0]?.html || '').slice(0, 300))
  r = await cron('2026-10-02T13:00:00Z', { noInterviews: true })
  ck('a day with no interviews: no interview card, nothing invented', !/Interviews today/.test(MAIL[0]?.html || ''))

  // ---- bonus v2 (2026-10-22): the New clients line, counts only, never dollars ----
  const BON = [{ id: 'b1', lead_id: 'x1', client: 'Rose Able', recipient: 'Angiel', recipient_email: 'ang@x', first_visit: '2026-09-02', day30: '2026-10-01', amount: 75, status: 'ready', earned_on: '2026-10-01', rules: 'v2' },
    { id: 'b2', lead_id: 'x2', client: 'Hope Hall', recipient: 'Krystal', recipient_email: 'kry@x', first_visit: '2026-10-01', day30: '2026-10-30', amount: 75, status: 'on_the_way', day: 2, visits: 1, rules: 'v2' }]
  r = await cron('2026-10-02T13:00:00Z', { ops: { bonus_v2_live: true, lead_rotation: { people: [{ name: 'Krystal' }, { name: 'Angiel' }] } }, bonuses: BON })
  const nc = MAIL[0]?.html || ''
  ck('bonus v2 on: a "New clients" line in everyone\'s brief: who made it to day 30 and the team goal', /New clients/.test(nc) && /Angiel(&#39;|\u2019)s Rose Able made it to day 30/.test(nc) && /Team goal: 1 of 8 new clients this month\. 7 more to team lunch/.test(nc) && /New clients/.test(MAIL[1]?.html || ''), nc.slice(0, 600))
  ck('bonus v2: no dollar amount anywhere in the line', !/\$\s?75/.test(nc))
  r = await cron('2026-10-02T13:00:00Z', { bonuses: BON })
  ck('bonus v2 off: no New clients line', !/New clients/.test(MAIL[0]?.html || ''))

  // ---- Settings drive the rule ----
  r = await cron('2026-10-02T13:00:00Z', { ops: { afternoon_interviews: { from: '14:15', name: 'Krystal' } } })
  ck('Settings change the rule (from 2:15pm, Krystal): only the 2:30pm interview is marked, as Krystal\'s', (MAIL[0].html.match(/Krystal&#39;s interview/g) || []).length === 1 && !/Samantha&#39;s interview/.test(MAIL[0].html))

  // ---- the helpers ----
  /* 2026-10-19 (Samantha: "we dont need evv...it would be missed clock in or out"): the admin section lists yesterday's
     call-to-confirm cards as missed clock-ins and clock-outs, open ones first */
  r = await cron('2026-10-02T13:00:00Z', { items: [
    { id: 'ops_cft_1', kind: 'confirm_times', status: 'done', shift_date: '2026-10-01', caregiver: 'Ann Fixed', client_first: 'Rose', missing: 'out' },
    { id: 'ops_cft_2', kind: 'confirm_times', status: 'open', shift_date: '2026-10-01', caregiver: 'Bo Open', client_first: 'Gil', missing: 'in' },
    { id: 'ops_cft_3', kind: 'confirm_times', status: 'open', shift_date: '2026-09-29', caregiver: 'Old Week', client_first: 'Ivy', missing: 'both' } ] })
  const adm = MAIL.find((m) => /samantha/.test(m.to || m.email || JSON.stringify(m)))?.html || MAIL[0]?.html || ''
  const per = MAIL.find((m) => /krystal/.test(m.to || m.email || JSON.stringify(m)))?.html || ''
  ck('missed clock-ins and clock-outs: yesterday\'s two cards, the open one first, still to call; nothing older', /Yesterday&#39;s missed clock-ins and clock-outs \(2\)|Yesterday's missed clock-ins and clock-outs \(2\)/.test(adm)
    && adm.indexOf('Bo Open') > 0 && adm.indexOf('Bo Open') < adm.indexOf('Ann Fixed') && /still to call/.test(adm) && /no clock-in/.test(adm) && /no clock-out/.test(adm) && !/Old Week/.test(adm), adm.slice(0, 300))
  ck('the word EVV is gone from the brief; the personal edition has no admin section', !/EVV/.test(adm) && !/missed clock-ins and clock-outs/.test(per))
  /* 2026-10-22 Speed to lead (one text per family): families who waited over 30 minutes since the last workday's brief */
  const waits = [
    { id: 'W1', first_name: 'Wanda', last_name: 'Called', status: 'Contacted', assigned_coordinator: 'Krystal', created_at: '2026-10-01T15:00:00Z', rungs: { manager_at: '2026-10-01T15:31:00Z' }, speed_miss: { owner: 'krystal@mo-care.com' }, first_human_attempt_at: '2026-10-01T16:02:00Z' },
    { id: 'W2', first_name: 'Will', last_name: 'Waiting', status: 'New', assigned_coordinator: 'Krystal', created_at: '2026-10-01T19:00:00Z', rungs: { manager_at: '2026-10-01T19:31:00Z' } },
    { id: 'W3', first_name: 'Olde', last_name: 'Week', status: 'New', assigned_coordinator: 'Krystal', created_at: '2026-09-29T15:00:00Z', rungs: { manager_at: '2026-09-29T15:31:00Z' } },
    { id: 'W4', first_name: 'Ona', last_name: 'Out', status: 'New', assigned_coordinator: 'Angiel', created_at: '2026-10-01T16:00:00Z', rungs: { manager_at: '2026-10-01T16:31:00Z', manager_excused: 'out' }, speed_miss: { owner: 'Angiel', excused: 'out' } }]
  r = await cron('2026-10-02T13:00:00Z', { extraLeads: waits })
  const adm2 = MAIL.find((m) => /samantha/.test(m.to || m.email || JSON.stringify(m)))?.html || ''
  const per2 = MAIL.find((m) => /krystal/.test(m.to || m.email || JSON.stringify(m)))?.html || ''
  ck('speed to lead · yesterday\'s 30-minute waits are one line each for admins, the not-called one in red, time off marked, nothing older', /Waited over 30 minutes for a first call \(3\)/.test(adm2)
    && /Wanda Called/.test(adm2) && /first call 11:02am/.test(adm2) && /Will Waiting/.test(adm2) && /not called yet/.test(adm2) && /Ona Out/.test(adm2) && /was out, not counted/.test(adm2) && !/Olde Week/.test(adm2), adm2.slice(adm2.indexOf('Waited over'), adm2.indexOf('Waited over') + 900))
  ck('speed to lead · the personal edition has no such line', !/Waited over 30 minutes/.test(per2))
  r = await cron('2026-10-05T13:00:00Z', { extraLeads: [{ id: 'W5', first_name: 'Sat', last_name: 'Urday', status: 'New', created_at: '2026-10-03T15:00:00Z', rungs: { manager_at: '2026-10-03T15:31:00Z' } },
    { id: 'W6', first_name: 'Fri', last_name: 'Day', status: 'New', created_at: '2026-10-02T15:00:00Z', rungs: { manager_at: '2026-10-02T15:31:00Z' } }] })
  const adm3 = MAIL.find((m) => /samantha/.test(m.to || m.email || JSON.stringify(m)))?.html || ''
  ck('speed to lead · on Monday it covers Friday through Sunday', /Waited over 30 minutes for a first call \(2\)/.test(adm3) && /Sat Urday/.test(adm3) && /Fri Day/.test(adm3), adm3.slice(0, 200))
  ck('chiParts: GHL words, timestamps, dates', JSON.stringify(M.chiParts('Friday, October 2, 2026 2:30 PM')) === '{"date":"2026-10-02","min":870}' && M.chiParts('2026-10-03T04:30:00Z').date === '2026-10-02' && M.chiParts('2026-10-02').min === null)
  ck('SEND_HOUR is 8 and nothing the office reads says 6:45 any more', M.SEND_HOUR === 8 && !/6:45am|Sent at 6:45|6:45 scheduled/.test(fs.readFileSync(path.join(F, 'lead-digest/index.ts'), 'utf8')))
  const fsrc = fs.readFileSync(path.join(F, 'lead-digest/index.ts'), 'utf8')
  const copy = fsrc.slice(fsrc.indexOf('let body = '), fsrc.indexOf('const clocks'))
  ck('no em dashes in the email copy that was touched', !copy.includes('—') && !/Open shift<\/b> \$\{esc\(o\.time\)\} —/.test(fsrc))
} finally { fs.rmSync(tmp, { recursive: true, force: true }); globalThis.Date = RealDate; globalThis.fetch = realFetch }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
