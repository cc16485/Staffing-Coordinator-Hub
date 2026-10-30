// Overnight Handoff (Samantha 2026-10-29): the rules in _shared/overnight-handoff.ts, then the REAL lead-digest (the
// 8am Morning Brief) against a fake database and fake GoHighLevel with the clock pinned. Made-up people only.
// node overnight_handoff_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const F = 'supabase/functions'
const OH = await import(path.resolve(F, '_shared/overnight-handoff.ts'))

/* ── the rules ── */
let w = OH.windowFor('2026-10-27', {})   // a Tuesday
ck('Tuesday: overnight is Monday 8pm to Tuesday 7am', w.from === '2026-10-26 20:00:00' && w.to === '2026-10-27 07:00:00', w)
w = OH.windowFor('2026-10-26', {})       // a Monday
ck('Monday: from Friday 8pm', w.from === '2026-10-23 20:00:00' && w.to === '2026-10-26 07:00:00', w)
w = OH.windowFor('2026-10-27', { overnight_handoff_hours: { from: '21:30', to: '6:00' } })
ck('the hours come from Settings', w.from === '2026-10-26 21:30:00' && w.to === '2026-10-27 06:00:00', w)
ck('a note typed Thursday 11pm is for Friday', OH.noteDateFor('2026-10-29 23:10:00') === '2026-10-30')
ck('a note typed Friday 7:30am is for Friday', OH.noteDateFor('2026-10-30 07:30:00') === '2026-10-30')
ck('a note typed Friday 9am is for Monday', OH.noteDateFor('2026-10-30 09:00:00') === '2026-11-02')
ck('a note typed Saturday is for Monday', OH.noteDateFor('2026-10-31 10:00:00') === '2026-11-02')
ck('Sunday 7am is still Monday', OH.noteDateFor('2026-11-01 07:00:00') === '2026-11-02')

/* times in UTC; Central is UTC-5 in late October (CDT) */
const NIGHT = '2026-10-29T03:15:00Z'      // Wed 10:15pm Central
const EARLY = '2026-10-29T10:40:00Z'      // Thu 5:40am Central
const NOON = '2026-10-28T17:00:00Z'       // Wed noon Central (not overnight)
const LATE = '2026-10-29T13:00:00Z'       // Thu 8:00am Central (after the window)
const WORLD = () => ({
  ops: [
    { id: 'ops_cft_1', kind: 'confirm_times', status: 'open', caregiver: 'Pat Doe', client_first: 'June', missing: 'in', created_at: NIGHT },
    { id: 'ops_cft_2', kind: 'confirm_times', status: 'done', caregiver: 'Lee Roe', client_first: 'Ray', missing: 'out', created_at: NIGHT, closed_at: EARLY },
    { id: 'ops_note_9', status: 'open', urgency: 'high', about: 'Mr. Ames seemed confused', created_at: EARLY },
    { id: 'sp_1', kind: 'send_problem', status: 'open', about: 'Visit reminder to the Price family', created_at: NOON, last_at: NIGHT },
    { id: 'cf_1', kind: 'call_followup', status: 'open', about: 'Daughter asked about Saturday', created_at: EARLY, created_by: 'automation:calls' },
    { id: 'qc_1', status: 'open', about: 'Gate code changed at the Webb home', created_by: 'zach@mo-care.com', created_at: NIGHT },
    { id: 'qc_2', status: 'open', urgency: 'high', about: 'Family wants a call before 9', created_by: 'zach@mo-care.com', created_at: NIGHT },
    { id: 'ops_lead_x', status: 'open', about: 'New inquiry card', created_at: NIGHT },
    { id: 'sweep_1', status: 'open', about: 'Midnight sweep card', created_by: 'automation:sweep', created_at: NIGHT },
    { id: 'old_1', status: 'open', urgency: 'high', about: 'Made at noon', created_by: 'zach@mo-care.com', created_at: NOON },
  ],
  leads: [{ id: 'L1', first_name: 'Ann', last_name: 'Gray', status: 'New', interest_notes: 'weekday mornings', created_at: NIGHT },
    { id: 'L2', first_name: 'Old', last_name: 'Lead', status: 'New', created_at: NOON }],
  covCases: [
    { id: 'c1', status: 'open', calling_off: 'Jo Smith', client: 'Mr. Ellis', shift_date: '2026-10-29', shift_time: '09:00', opened_at: EARLY },
    { id: 'c2', status: 'resolved', resolved_how: 'covered', covered_by: 'Dana Fox', calling_off: 'Kim Day', client: 'Mrs. Cole', shift_date: '2026-10-28', shift_time: '22:00', opened_at: NIGHT, resolved_at: NIGHT },
    { id: 'c3', status: 'open', calling_off: 'Taken Off', client: 'X', opened_at: NIGHT, not_a_callin: true },
    { id: 'c4', status: 'open', calling_off: 'After', client: 'Y', opened_at: LATE },
  ],
  notes: [{ id: 'note_2026-10-29', kind: 'note', text: 'Please call the Harper family first thing.', by_name: 'Samantha T', at: '2026-10-29T04:14:00Z' },
    { id: 'note_2026-10-30', kind: 'note', text: 'Not this morning', by_name: 'Samantha T' }],
  applicants: [{ id: 'a1', first_name: 'Cass', last_name: 'Nguyen', position: 'Caregiver', created_at: NIGHT }],
})
let x = WORLD()
let h = OH.build({ today: '2026-10-29', settings: {}, ...x, isCallIn: (c) => c.not_a_callin !== true })
const T = (arr) => arr.map((l) => l.text).join(' | ')
ck('the note is this morning\'s only', h.note && h.note.text === 'Please call the Harper family first thing.', h.note)
ck('needs: the open call-in', /Call-in, not covered yet: Jo Smith called off Mr\. Ellis \(Thu 9:00am\)/.test(T(h.needs)), h.needs)
ck('needs: the missed clock-in still to confirm', /Missed clock-in to confirm: Pat Doe at June's visit: no clock-in/.test(T(h.needs)))
ck('needs: the caregiver note', /Caregiver note rated high: Mr\. Ames/.test(T(h.needs)))
ck('needs: the text that did not go out (counted by when it last failed)', /did not go out: Visit reminder/.test(T(h.needs)))
ck('needs: what a person marked urgent', /Marked urgent: Family wants a call/.test(T(h.needs)))
ck('handled: the covered call-in', /Call-in covered: Dana Fox took Mrs\. Cole/.test(T(h.handled)), h.handled)
ck('handled: the confirmed clock-out', /Missed clock-in cleared: Lee Roe/.test(T(h.handled)))
ck('came in: the lead, the applicant, the office call, the pass-along', /New lead: Ann Gray, weekday mornings/.test(T(h.came_in)) && /New applicant: Cass Nguyen, Caregiver/.test(T(h.came_in))
  && /Call to the office line: Daughter asked/.test(T(h.came_in)) && /Gate code changed/.test(T(h.came_in)), h.came_in)
const all = T(h.needs) + T(h.handled) + T(h.came_in)
ck('left out: before 8pm, after 7am, taken off in AxisCare, sweeps, inquiry cards', !/Old Lead|Made at noon|Taken Off|After|Midnight sweep|New inquiry card/.test(all), all)
ck('lines are in time order', h.needs.every((l, i) => !i || h.needs[i - 1].at <= l.at))
ck('every line can be found again (key and id)', [...h.needs, ...h.handled].every((l) => l.key && l.id))
h = OH.build({ today: '2026-10-29', settings: {}, ...x, applicants: null, applicantsErr: 'timeout' })
ck('applicants that cannot be read are said', h.errors.length === 1 && /applicants \(timeout\)/.test(h.errors[0]))
h = OH.build({ today: '2026-10-29', settings: {}, ops: [], leads: [], covCases: [], notes: [], applicants: [] })
ck('a quiet night is quiet', OH.quiet(h) && !h.errors.length)
ck('a shift reads like Thu 9:00am', OH.shiftWords('2026-10-29', '09:00') === 'Thu 9:00am' && OH.shiftWords('2026-10-28', '22:00') === 'Wed 10:00pm' && OH.shiftWords('', '') === '')
ck('times read like 10:15pm Wed / 5:40am', OH.when('2026-10-28 22:15:00', '2026-10-29') === '10:15pm Wed' && OH.when('2026-10-29 05:40:00', '2026-10-29') === '5:40am')

/* ── the real Morning Brief ── */
let D, MAIL, WRITES
const reset = (live) => { MAIL = []; WRITES = []; x = WORLD(); D = {
  app_data: [
    { key: 'ops_settings', data: { overnight_handoff_live: live, morning_brief_recipients: [{ name: 'Samantha T', email: 'samantha@mo-care.com', admin: true }, { name: 'Krystal L', email: 'krystal@mo-care.com', admin: false }] } },
    { key: 'ops_items', data: x.ops }, { key: 'leads', data: x.leads }, { key: 'coverage_cases', data: x.covCases }, { key: 'overnight_handoff', data: x.notes },
    { key: 'coordinator_staff', data: [] }],
  job_applicants: x.applicants, interview_bookings: [],
  auth_identities: [{ auth_user_id: 'u-s', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p-s' }],
  persons: [{ person_id: 'p-s', full_name: 'S', active: true }], entity_memberships: [{ person_id: 'p-s', entity: 'cc_ihs', active: true, ended_at: null }],
  staff_roles: [{ person_id: 'p-s', entity: 'cc_ihs', role: 'owner_admin' }] } }
const q = (t) => { const st = { f: [] }; const b = { select() { return b }, in() { return b }, order() { return b }, limit() { return b }, gte() { return b }, lt() { return b },
  eq(c, v) { st.f.push([c, v]); return b }, maybeSingle() { return b.then((r) => ({ data: r.data[0] ?? null, error: null })) },
  then(ok) { let rows = D[t] ?? []; for (const [c, v] of st.f) rows = rows.filter((r) => r[c] === v); return Promise.resolve({ data: rows, error: null }).then(ok) } }; return b }
globalThis.__db = { from: q, rpc: async (fn, a) => { WRITES.push([fn, a]); return { error: null } },
  auth: { getUser: async (jwt) => jwt === 's' ? { data: { user: { id: 'u-s', email: 'samantha@mo-care.com', app_metadata: {} } }, error: null } : { data: { user: null }, error: { message: 'bad' } } } }
globalThis.fetch = async (url, o) => { url = String(url); const body = o?.body ? JSON.parse(o.body) : {}
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + body.email, email: body.email } }), { status: 200 })
  if (url.includes('/conversations/messages')) { MAIL.push({ to: body.contactId.slice(2), subject: body.subject, html: body.html }); return new Response('{}', { status: 200 }) }
  return new Response('{}', { status: 404 }) }
const JOBSEC = 'j'.repeat(64)
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', HUB_JOB_SECRET: JOBSEC }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (fn) => { handler = fn } }
const tmp = fs.mkdtempSync(path.join(process.cwd(), '_oh_'))
try {
  fs.writeFileSync(path.join(tmp, 'job-auth.ts'), fs.readFileSync(path.join(F, '_shared/job-auth.ts'), 'utf8')
    .replace(/^import \{ createClient \} from .*$/m, "const createClient = () => ({ from: () => ({ select: () => ({ limit: async () => ({ error: { message: 'denied' } }) }) }) })")
    .replace("from './staff-auth.ts'", "from '" + path.resolve(F, '_shared/staff-auth.ts') + "'"))
  const src = fs.readFileSync(path.join(F, 'lead-digest/index.ts'), 'utf8')
    .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/from '\.\.\/_shared\/(\w[\w-]*)\.ts'/g, (_, m) => "from '" + (m === 'job-auth' ? path.join(tmp, 'job-auth.ts') : path.resolve(F, '_shared', m + '.ts')) + "'")
  fs.writeFileSync(path.join(tmp, 'ld.ts'), src); await import(path.join(tmp, 'ld.ts'))
  const RealDate = Date
  const pinAt = (iso) => { const t = new RealDate(iso).getTime(); globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [t])) } static now() { return t } } }
  const run = async (live, qs, hdr) => { pinAt('2026-10-29T13:05:00Z'); try { reset(live)   // Thu 8:05am Central
    const r = await handler(new Request('https://x/functions/v1/lead-digest' + qs, { headers: hdr })); return { s: r.status, j: await r.json() } } finally { globalThis.Date = RealDate } }

  let r = await run(false, '', { 'x-cron-secret': JOBSEC })
  const kOff = MAIL.find((m) => m.to === 'krystal@mo-care.com') || {}
  ck('switch off: the 8am run sends as before', r.s === 200 && MAIL.length === 2, r)
  ck('switch off: no Overnight Handoff, While you were out is still there', !/Overnight Handoff/.test(kOff.html) && /While you were out/.test(kOff.html))
  ck('switch off: nothing saved for My Work', !WRITES.some(([, a]) => a?.target_key === 'overnight_handoff') && r.j.overnight_handoff === 'off')

  r = await run(true, '', { 'x-cron-secret': JOBSEC })
  const k = MAIL.find((m) => m.to === 'krystal@mo-care.com') || {}, s = MAIL.find((m) => m.to === 'samantha@mo-care.com') || {}
  ck('switch on: both briefs go', r.s === 200 && MAIL.length === 2, r)
  ck('switch on: Krystal\'s brief opens with the Overnight Handoff', k.html.indexOf('Overnight Handoff') > -1 && k.html.indexOf('Overnight Handoff') < (k.html.indexOf('Leads to call') >>> 0))
  ck('the note is first, word for word', /NOTE FROM SAMANTHA/.test(k.html) && /Please call the Harper family first thing\./.test(k.html) && k.html.indexOf('NOTE FROM') < k.html.indexOf('Needs you this morning'))
  ck('the three lists are in the email', /Needs you this morning · 5/.test(k.html) && /Handled overnight · 2/.test(k.html) && /Came in overnight · 4/.test(k.html), k.html.match(/(Needs|Handled|Came in)[^<]{0,40}/g))
  ck('names in the email are escaped', /Mrs\. Cole/.test(k.html) && /June&#39;s visit/.test(k.html))
  ck('the subject leads with the note', /^Your morning, Krystal: a note from Samantha, 5 from overnight to act on/.test(k.subject), k.subject)
  ck('While you were out is replaced', !/While you were out/.test(k.html) && !/While you were out/.test(s.html))
  ck('Samantha gets the same handoff', /Overnight Handoff/.test(s.html) && /Needs you this morning · 5/.test(s.html))
  ck('says the hours and how to mark it read', /Overnight is 8:00pm Wed to 7:00am/.test(k.html) && /Mark it read on My Work/.test(k.html))
  const saved = WRITES.find(([, a]) => a?.target_key === 'overnight_handoff')?.[1]?.item
  ck('the 8am run saves the same handoff for My Work', saved && saved.id === 'report_2026-10-29' && saved.kind === 'report' && saved.needs.length === 5 && saved.note?.text && saved.sent === 2, saved)
  ck('the reply carries counts only', r.j.overnight_handoff?.needs === 5 && r.j.overnight_handoff?.note === true && !JSON.stringify(r.j).includes('Harper'))

  r = await run(true, '?to=samantha%40mo-care.com&force=1', { Authorization: 'Bearer s' })
  ck('a test brief shows the handoff but saves nothing', r.s === 200 && MAIL.length === 1 && /Overnight Handoff/.test(MAIL[0].html) && !WRITES.some(([, a]) => a?.target_key === 'overnight_handoff'), r)

  /* a quiet night */
  pinAt('2026-10-29T13:05:00Z'); reset(true); D.app_data = D.app_data.map((row) => ['ops_items', 'leads', 'coverage_cases', 'overnight_handoff'].includes(row.key) ? { ...row, data: [] } : row); D.job_applicants = []
  const rq = await handler(new Request('https://x/functions/v1/lead-digest', { headers: { 'x-cron-secret': JOBSEC } })); globalThis.Date = RealDate
  const kq = MAIL.find((m) => m.to === 'krystal@mo-care.com') || {}
  ck('a quiet night says so, and still asks to mark it read', rq.status === 200 && /Nothing happened overnight that needs you\./.test(kq.html) && /Mark it read on My Work/.test(kq.html), kq.subject)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
