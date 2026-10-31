// ON CALL FOR OUR CAREGIVERS (Samantha 2026-10-30, Krystal's idea, "Yes to all, we will only have caregivers who can do level 3 be
// on-call"; rules C1 to C7 in _shared/prn-oncall.ts). The rules, the REAL prn-week (invites, the calendar, confirm, a miss) and the
// REAL oncall-page against a fake database, a fake AxisCare and a fake GoHighLevel, and the SQL on a throwaway Postgres when PGLITE
// is set. Nothing real is reached.
// node oncall_caregivers_test.mjs   (PGLITE=<path to @electric-sql/pglite/dist/index.js> for the SQL part)
import fs from 'fs'; import path from 'path'; import { pathToFileURL } from 'url'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const F = 'supabase/functions'
const O = await import(path.join(process.cwd(), F, '_shared/prn-oncall.ts'))
const LK = await import(path.join(process.cwd(), F, '_shared/oncall-links.ts'))

/* ── 1. the rules ── */
ck('a person is a key: a PRN member\'s applicant id, or ax:<AxisCare id>', O.personKey({ applicant_id: 'u1' }) === 'u1' && O.personKey({ applicant_id: null, caregiver_ax: '501' }) === 'ax:501'
  && JSON.stringify(O.personCols('ax:501')) === '{"applicant_id":null,"caregiver_ax":"501"}' && JSON.stringify(O.personCols('u1')) === '{"applicant_id":"u1","caregiver_ax":null}'
  && O.withKeys([{ id: 1, applicant_id: null, caregiver_ax: '7' }])[0].applicant_id === 'ax:7')
ck('C1: Level 3 from their AxisCare classes (the highest they hold)', O.isLevel3(['Level 3 - Advanced Care']) && O.isLevel3(['Level 1', 'Advanced Care']) && !O.isLevel3(['Level 2 - Personal Care']) && !O.isLevel3(['PRN TEAM - CNA']) && !O.isLevel3([]))
ck('C4: the invite: her draft with their first name and link', O.inviteText('', 'Maria', 'https://x/l').startsWith("Hi Maria! We're inviting a few of our caregivers to sign up for on-call shifts.") && O.inviteText('', 'Maria', 'https://x/l').endsWith('Read more and sign up here: https://x/l')
  && !/\$/.test(O.INVITE_DEFAULT) && !/—/.test(O.INVITE_DEFAULT))
ck('...edited: the edit is used, and the link always goes in', O.inviteText('Hi {first_name}, want on call?', 'Bo', 'https://x/l') === 'Hi Bo, want on call? https://x/l')
const census = [{ id: '501', first: 'Maria', last: 'Lopez', goes_by: '', active: true, classes: ['Level 3 - Advanced Care'], phone: '4175550501' },
  { id: '502', first: 'Bob', last: 'Barnes', active: true, classes: ['Level 2 - Personal Care'], phone: '4175550502' },
  { id: '503', first: 'Ina', last: 'Active', active: false, classes: ['Level 3'], phone: '4175550503' },
  { id: '11', first: 'Grace', last: 'Hill', active: true, classes: ['Level 3', 'PRN TEAM - CNA'], phone: '4175550101' },
  { id: '504', first: 'Opal', last: 'Nophone', goes_by: 'Ope', active: true, classes: ['Advanced Care'], phone: '' }]
const V = O.termsVersion(O.TERMS_DEFAULT)
const L1 = O.inviteList({ census, prnAx: ['11'], invites: [{ caregiver_ax: '501', at: '2026-10-30T15:00:00Z', via: 'text', by_name: 'Krystal' }],
  terms: [{ applicant_id: null, caregiver_ax: '501', version: V }], rows: [{ id: 1, kind: 'confirmed', applicant_id: null, caregiver_ax: '501', start_date: '2026-11-07', end_date: '2026-11-07', shift: 'day', cancelled_at: null }],
  marks: [], version: V, today: '2026-10-30' })
ck('C6: the Invite list: active Level 3 caregivers only, never the PRN CNA Team', L1.map((x) => x.caregiver_ax).sort().join() === '501,504', L1)
const maria = L1.find((x) => x.caregiver_ax === '501'), opal = L1.find((x) => x.caregiver_ax === '504')
ck('...with each one\'s status: invited (when, how, by whom), signed, upcoming shifts, phone; goes-by name first', maria.invited_at && maria.invited_via === 'text' && maria.invited_by === 'Krystal' && maria.signed && maria.upcoming === 1 && maria.has_phone
  && !opal.invited_at && !opal.signed && opal.has_phone === false && opal.first === 'Ope' && L1[0].caregiver_ax === '504', L1)
const M = [{ applicant_id: 'g', name: 'Grace Hill', team: 'cna', axiscare_id: '11' }, { applicant_id: 'ax:501', name: 'Maria Lopez', team: 'oncall', axiscare_id: '501' }]
const rowsC = O.withKeys([{ id: 9, kind: 'confirmed', applicant_id: null, caregiver_ax: '501', start_date: '2026-11-07', end_date: '2026-11-07', shift: 'day', cancelled_at: null }])
ck('26 + C1: an open shift during a caregiver\'s on-call time finds them (any shift: they are Level 3)', O.onCallNow({ c: { shift_date: '2026-11-07', shift_time: '09:00-13:00' }, rows: rowsC, marks: [], members: M })?.name === 'Maria Lopez')
const cal = O.calendar({ rows: rowsC, marks: [], members: M, today: '2026-11-02' })
ck('C6: the calendar tags a caregiver', cal.find((d) => d.date === '2026-11-07').day.confirmed[0].caregiver === true)
const SECRET = 'S'.repeat(48)
const lk = new URL(await LK.makeOncallLink(SECRET, '501', LK.oncallExpiry()))
ck('C3: their link: oncall.html, their AxisCare id, 30 days, sealed', lk.pathname === '/oncall.html' && lk.searchParams.get('c') === '501' && await LK.checkOncallLink(SECRET, Object.fromEntries(lk.searchParams))
  && !(await LK.checkOncallLink(SECRET, { ...Object.fromEntries(lk.searchParams), c: '502' })) && !(await LK.checkOncallLink('T'.repeat(48), Object.fromEntries(lk.searchParams)))
  && !(await LK.checkOncallLink(SECRET, { ...Object.fromEntries(lk.searchParams), e: 100 })))

/* ── 2. the real functions against a fake database, AxisCare and GoHighLevel ── */
const GRACE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', OPTED = '4175550505'
let T, EVENTS, SENT, NID, AXDOWN
const dayN = (k) => new Date(Date.now() + k * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
const AXG = { 501: { id: 501, firstName: 'Maria', lastName: 'Lopez', status: { active: true, label: 'Active' }, classes: [{ label: 'Level 3 - Advanced Care' }], mobilePhone: '4175550501' },
  502: { id: 502, firstName: 'Bob', lastName: 'Barnes', status: { active: true }, classes: [{ label: 'Level 2 - Personal Care' }], mobilePhone: '4175550502' },
  505: { id: 505, firstName: 'Ned', lastName: 'Optout', status: { active: true }, classes: [{ label: 'Level 3' }], mobilePhone: OPTED },
  11: { id: 11, firstName: 'Grace', lastName: 'Hill', status: { active: true }, classes: [{ label: 'Level 3' }, { label: 'PRN TEAM - CNA' }], mobilePhone: '4175550101' } }
const reset = (settings = {}) => { EVENTS = []; SENT = []; NID = 100; AXDOWN = false; T = {
  app_data: [{ key: 'ops_settings', data: { prn_page_live: true, prn_oncall_signup_live: true, prn_oncall_offered: Object.fromEntries(['sun','mon','tue','wed','thu','fri','sat'].flatMap((d) => [[d + ':day', true], [d + ':overnight', true]])), ...settings } }, { key: 'coverage_cases', data: [] }, { key: 'caregivers', data: [{ axiscare_id: '501', phone: '4175550501' }] }],
  pay_tracks: [{ applicant_id: GRACE, track: 'prn_team', team: 'cna', since: dayN(-60), axiscare_caregiver_id: '11' }],
  job_applicants: [{ id: GRACE, first_name: 'Grace', last_name: 'Hill', phone: '4175550101', prn: {} }],
  prn_shift_log: [], prn_touches: [], prn_oncall: [], prn_oncall_series: [], prn_oncall_marks: [], prn_page_log: [], prn_monthly: [], oncall_invites: [],
  prn_oncall_terms: [{ applicant_id: GRACE, caregiver_ax: null, version: O.termsVersion(O.TERMS_DEFAULT), typed_name: 'Grace Hill', agreed_at: 'x' }],
  auth_identities: [{ auth_user_id: 'u-kr', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p-kr' }, { auth_user_id: 'u-sa', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p-sa' }],
  persons: [{ person_id: 'p-kr', full_name: 'Krystal Office', active: true }, { person_id: 'p-sa', full_name: 'Samantha Owner', active: true }],
  entity_memberships: [{ person_id: 'p-kr', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p-sa', entity: 'cc_ihs', active: true, ended_at: null }],
  staff_roles: [{ person_id: 'p-kr', entity: 'cc_ihs', role: 'staffing_coordinator' }, { person_id: 'p-sa', entity: 'cc_ihs', role: 'owner_admin' }],
  contact_optout_current: [{ address: '+1' + OPTED, channel: 'sms', opted_out: true, source: 'stop_text' }], phone_index: [], circle_contacts: [], op_events: [] } }
const UNIQ = { prn_oncall: (a, r) => !a.cancelled_at && a.kind === r.kind && (a.applicant_id || 'ax:' + a.caregiver_ax) === (r.applicant_id || 'ax:' + r.caregiver_ax) && a.start_date === r.start_date && (a.shift || '') === (r.shift || ''),
  prn_oncall_series: (a, r) => ['asked', 'confirmed'].includes(a.status) && (a.applicant_id || 'ax:' + a.caregiver_ax) === (r.applicant_id || 'ax:' + r.caregiver_ax) && a.weekday === r.weekday && a.slot === r.slot,
  prn_oncall_terms: (a, r) => (a.applicant_id || 'ax:' + a.caregiver_ax) === (r.applicant_id || 'ax:' + r.caregiver_ax) && a.version === r.version }
const q = (t) => { const st = { f: [], inF: [], nul: [], gte: [], lte: [], upd: null }; const b = {
  select() { return b }, order() { return b }, limit() { return b }, not() { return b },
  eq(c, v) { st.f.push([c, v]); return b }, in(c, v) { st.inF.push([c, v]); return b }, is(c, v) { if (v === null) st.nul.push(c); return b },
  gte(c, v) { st.gte.push([c, v]); return b }, lte(c, v) { st.lte.push([c, v]); return b }, update(o) { st.upd = o; return b },
  insert(row) { let out
    if (t === 'op_events') { EVENTS.push(row); out = { data: null, error: null } }
    else if (!(t in T)) out = { data: null, error: { message: `relation "${t}" does not exist` } }
    else { const arr = T[t]; if (UNIQ[t] && arr.some((a) => UNIQ[t](a, row))) out = { data: null, error: { message: 'duplicate key value violates unique constraint' } }
      else { const nr = { id: NID++, at: new Date().toISOString(), cancelled_at: null, series_id: null, ...row }; arr.push(nr); out = { data: nr, error: null } } }
    const p = Promise.resolve({ data: null, error: out.error }); p.select = () => ({ maybeSingle: () => Promise.resolve({ data: out.data ? JSON.parse(JSON.stringify(out.data)) : null, error: out.error }) }); return p },
  rows() { if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]; return T.app_data.filter((x) => x.key === k) }
    let r = T[t] ?? []; for (const [c, v] of st.f) r = r.filter((x) => x[c] === v); for (const [c, v] of st.inF) r = r.filter((x) => v.includes(x[c])); for (const c of st.nul) r = r.filter((x) => x[c] == null)
    for (const [c, v] of st.gte) r = r.filter((x) => String(x[c]) >= v); for (const [c, v] of st.lte) r = r.filter((x) => String(x[c]) <= v); return r },
  maybeSingle() { return Promise.resolve({ data: JSON.parse(JSON.stringify(b.rows()[0] ?? null)), error: null }) },
  then(ok, bad) { if (!(t in T) && t !== 'app_data') return Promise.resolve({ data: null, error: { message: `relation "${t}" does not exist` } }).then(ok, bad)
    if (st.upd) { for (const x of b.rows()) Object.assign(x, st.upd); return Promise.resolve({ data: null, error: null }).then(ok, bad) }
    return Promise.resolve({ data: JSON.parse(JSON.stringify(b.rows())), error: null }).then(ok, bad) } }; return b }
globalThis.__db = { from: q, rpc: async () => ({ data: null, error: null }),
  auth: { getUser: async (jwt) => jwt === 'kr' ? { data: { user: { id: 'u-kr', email: 'krystal@mo-care.com', app_metadata: {} } }, error: null }
    : jwt === 'sa' ? { data: { user: { id: 'u-sa', email: 'samantha@mo-care.com', app_metadata: {} } }, error: null } : { data: { user: null }, error: { message: 'bad' } } } }
globalThis.fetch = async (url, o) => { url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}
  if (url.includes('axiscare.com')) {
    if (AXDOWN) return new Response('{}', { status: 500 })
    const m = url.match(/\/api\/caregivers\/(\d+)$/); if (m) return AXG[m[1]] ? new Response(JSON.stringify({ results: { caregiver: AXG[m[1]] } }), { status: 200 }) : new Response('{}', { status: 404 })
    if (/\/api\/caregivers$/.test(url)) return new Response(JSON.stringify({ results: { caregivers: Object.values(AXG) } }), { status: 200 })
  }
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + body.phone, dnd: false } }), { status: 200 })
  if (url.includes('/conversations/messages')) { SENT.push({ to: body.contactId, text: body.message, from: body.fromNumber }); return new Response('{}', { status: 200 }) }
  return new Response('{}', { status: 404 }) }
const realTLS = Date.prototype.toLocaleString
let HOUR = '11'; Date.prototype.toLocaleString = function (loc, o) { return o && o.hour === '2-digit' && o.hour12 === false && !o.minute ? HOUR : realTLS.call(this, loc, o) }
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', HUB_JOB_SECRET: SECRET, AXISCARE_TOKEN: 'ax', AXISCARE_SITE: '16485' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const tmp = fs.mkdtempSync(path.join(process.cwd(), '_occ_'))
const load = async (name) => { const src = fs.readFileSync(path.join(F, name, 'index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace(/from '\.\.\/_shared\/(\w[\w-]*)\.ts'/g, (_, m) => "from '" + path.join(process.cwd(), F, '_shared', m + '.ts') + "'")
  fs.writeFileSync(path.join(tmp, name + '.ts'), src); await import(path.join(tmp, name + '.ts')); return handler }
try {
  const week = await load('prn-week'), pageH = await load('oncall-page')
  const call = async (h, fn, body, jwt) => { const r = await h(new Request('https://x/functions/v1/' + fn, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: 'Bearer ' + jwt } : {}) }, body: JSON.stringify(body) }))
    let j = null; try { j = await r.json() } catch { /* */ } return { status: r.status, j } }
  const W = (body, jwt = 'kr') => call(week, 'prn-week', body, jwt)
  const link = async (ax) => Object.fromEntries(new URL(await LK.makeOncallLink(SECRET, ax, LK.oncallExpiry())).searchParams)
  const P = async (ax, body) => call(pageH, 'oncall-page', { ...(await link(ax)), ...body })
  const d5 = dayN(5), d6 = dayN(6)

  /* the office: the list, invites off */
  reset()
  let r = await W({ action: 'oncall_invites' })
  ck('office: the Invite caregivers list: Maria and Ned (Level 3, active); not Bob (Level 2), not Grace (PRN CNA Team); the drafted text; switch off', r.j?.ok && r.j.people.map((x) => x.caregiver_ax).sort().join() === '501,505'
    && r.j.live === false && r.j.message === O.INVITE_DEFAULT, r.j)
  r = await W({ action: 'oncall_invite_send', caregiver_ax: '501', message: '', send_id: 'oci-test-0001' })
  ck('C7: switch off: Send invite is refused, nothing texted, nothing recorded', r.status === 409 && !SENT.length && !T.oncall_invites.length)
  r = await W({ action: 'oncall_invite_link', caregiver_ax: '501' })
  ck('...Copy link still works (recorded, their page says not open yet)', r.j?.outcome === 'link' && /oncall\.html\?c=501&e=\d+&t=/.test(r.j.link) && T.oncall_invites.length === 1 && T.oncall_invites[0].via === 'link' && T.oncall_invites[0].name === 'Maria Lopez', r.j)
  r = await call(pageH, 'oncall-page', { ...(Object.fromEntries(new URL(r.j.link).searchParams)), action: 'view' })
  ck('...and their page, switch off: "isn\'t open yet", nothing else', r.j?.closed === true && !r.j.signup, r.j)
  r = await W({ action: 'oncall_invite_link', caregiver_ax: '502' })
  ck('C1: Bob (Level 2) can\'t be invited', r.status === 404 && /Level 3/.test(r.j.error))
  r = await call(pageH, 'oncall-page', { action: 'preview', caregiver_ax: '501' }, 'kr')
  ck('the office preview works with the switch off, marked waiting; what on call is; the expectations', r.j?.ok && r.j.preview && r.j.waiting === true && /keeping your phone close/.test(r.j.about) && r.j.signup.terms === O.TERMS_DEFAULT && r.j.signup.slots.length === 28, r.j)
  r = await call(pageH, 'oncall-page', { action: 'preview', caregiver_ax: '501' })
  ck('...not without an office sign-in', r.status === 401 || r.status === 403)

  /* switch on: the invite */
  reset({ prn_oncall_invite_live: true })
  HOUR = '22'; r = await W({ action: 'oncall_invite_send', caregiver_ax: '501', message: '', send_id: 'oci-test-0002' })
  ck('C5: never 9pm to 8am', r.status === 409 && r.j.outcome === 'night' && !SENT.length)
  HOUR = '11'; r = await W({ action: 'oncall_invite_send', caregiver_ax: '501', message: 'Hi {first_name}! Want to be on call? {link}', send_id: 'oci-test-0003' })
  ck('C5: Send invite: from the office line, their edited words with their own link; recorded (link kept out of the record)', r.j?.outcome === 'sent' && SENT.length === 1 && SENT[0].from === '+14172348494' && /^Hi Maria! Want to be on call\? https:\/\/cc\.mo-care\.com\/oncall\.html\?c=501&/.test(SENT[0].text)
    && T.oncall_invites[0].via === 'text' && !/oncall\.html\?c=501&e=/.test(T.oncall_invites[0].message) && EVENTS.some((e) => e.verb === 'oncall_invite_sent'), [r.j, SENT, T.oncall_invites])
  r = await W({ action: 'oncall_invite_send', caregiver_ax: '505', message: '', send_id: 'oci-test-0004' })
  ck('...someone who texted STOP: not sent, says why', r.status === 422 && /asked not to get texts|isn't cleared/.test(r.j.error) && SENT.length === 1, r.j)
  r = await W({ action: 'oncall_invite_send', caregiver_ax: '501', message: 'Hi — there {link}', send_id: 'oci-test-0005' })
  ck('...no em dashes', r.status === 400 && SENT.length === 1)

  /* their page */
  r = await P('501', { action: 'view' })
  ck('C3: Maria\'s page: what on call is, sign first, the calendar', r.j?.ok && !r.j.preview && r.j.first === 'Maria' && !r.j.signup.signed && r.j.signup.slots.length === 28 && r.j.signup.weekly_ready === true && !/Grace/.test(JSON.stringify(r.j)), r.j)
  r = await P('501', { action: 'ask', slots: [{ date: d5, slot: 'day' }] })
  ck('...no sign-up before signing the expectations', r.status === 409 && r.j.sign === true && !T.prn_oncall.length)
  r = await P('501', { action: 'sign', agree: true, version: O.termsVersion(O.TERMS_DEFAULT), typed_name: 'Maria Lopez' })
  ck('...signing keeps the exact words under her AxisCare id', r.j?.ok && T.prn_oncall_terms.some((x) => x.caregiver_ax === '501' && x.applicant_id === null && x.body === O.TERMS_DEFAULT && x.typed_name === 'Maria Lopez'), [r.j, T.prn_oncall_terms])
  r = await P('501', { action: 'ask', slots: [{ date: d5, slot: 'day' }, { date: d6, slot: 'overnight', weekly: true }] })
  const mine = T.prn_oncall.filter((x) => x.caregiver_ax === '501')
  ck('...her asks land as "asked" under her AxisCare id, one time and every week', r.j?.ok && mine.length === 2 && mine.every((x) => x.kind === 'asked' && x.applicant_id === null) && T.prn_oncall_series.length === 1 && T.prn_oncall_series[0].caregiver_ax === '501'
    && mine.find((x) => x.start_date === d6).series_id === T.prn_oncall_series[0].id, [r.j, mine, T.prn_oncall_series])
  r = await P('502', { action: 'view' })
  ck('C1: someone not at Level 3 (a link made earlier): "On call is for Level 3", nothing shown', r.status === 403 && r.j.notlevel === true && !r.j.signup)
  r = await P('11', { action: 'view' })
  ck('...someone on the PRN CNA Team: "use your PRN Team page"', r.j?.prn === true && !r.j.signup)
  AXDOWN = true; r = await P('501', { action: 'ask', slots: [{ date: dayN(9), slot: 'day' }] }); AXDOWN = false
  ck('...AxisCare can\'t be read: nothing saved, try again', r.status === 503 && T.prn_oncall.filter((x) => x.caregiver_ax === '501').length === 2)
  r = await call(pageH, 'oncall-page', { c: '501', e: 4102444800, t: 'x'.repeat(43), action: 'view' })
  ck('...a forged link is refused', r.status === 401 && r.j.expired)

  /* the office: calendar, confirm, a miss */
  r = await W({ action: 'week' })
  const cd = r.j.oncall.calendar.find((x) => x.date === d5)
  ck('C6: the calendar shows Maria\'s ask with a Caregiver tag; the people list has her (signed), beside the PRN CNA Team', cd.day.asked[0].name === 'Maria Lopez' && cd.day.asked[0].caregiver === true
    && r.j.oncall.people.some((p) => p.applicant_id === 'ax:501' && p.caregiver === true && p.signed === true) && r.j.oncall.people.some((p) => p.applicant_id === GRACE && !p.caregiver), r.j.oncall.people)
  const ask5 = T.prn_oncall.find((x) => x.caregiver_ax === '501' && x.start_date === d5)
  r = await W({ action: 'oncall_confirm', ask_id: ask5.id })
  ck('...one tap confirms it, under her AxisCare id', r.j?.outcome === 'recorded' && T.prn_oncall.some((x) => x.kind === 'confirmed' && x.caregiver_ax === '501' && x.applicant_id === null && x.start_date === d5), r.j)
  const ask6 = T.prn_oncall.find((x) => x.caregiver_ax === '501' && x.start_date === d6 && x.kind === 'asked')
  r = await W({ action: 'oncall_confirm', ask_id: ask6.id })
  ck('...her every-week ask: one OK, its weeks added under her id', r.j?.every_week === true && T.prn_oncall.filter((x) => x.kind === 'confirmed' && x.caregiver_ax === '501' && x.series_id === T.prn_oncall_series[0].id && !x.cancelled_at).length >= 3, T.prn_oncall)
  r = await W({ action: 'oncall_confirm', applicant_id: GRACE, date: d5, shift: 'day' })
  ck('...one person per shift across both: Grace can\'t take Maria\'s shift', r.status === 409 && /Maria Lopez is already on call/.test(r.j.error), r.j)
  T.app_data.find((x) => x.key === 'coverage_cases').data = [{ id: 'cv1', status: 'open', client: 'Ruth Lane', shift_date: d5, shift_time: '09:00-13:00', opened_at: new Date().toISOString(), asked: [] }]
  r = await W({ action: 'oncall_now' })
  ck('26: an open shift during Maria\'s on-call time: "On call now: Maria", with her phone', r.j.cases.length === 1 && r.j.cases[0].name === 'Maria Lopez' && r.j.cases[0].caregiver === true && r.j.cases[0].phone === '+14175550501', r.j)
  const c5 = T.prn_oncall.find((x) => x.kind === 'confirmed' && x.caregiver_ax === '501' && x.start_date === d5)
  r = await W({ action: 'oncall_mark', oncall_id: c5.id, kind: 'no_answer', case_id: 'cv1' })
  ck('25: a miss: recorded under her id, her other shifts taken back, her every-week shift ended, her phone to call', r.j?.outcome === 'missed' && T.prn_oncall_marks.some((x) => x.caregiver_ax === '501' && x.kind === 'no_answer')
    && T.prn_oncall.filter((x) => x.caregiver_ax === '501' && x.kind === 'confirmed' && !x.cancelled_at && x.id !== c5.id).length === 0 && T.prn_oncall_series[0].status === 'ended' && r.j.phone === '+14175550501', [r.j, T.prn_oncall_series])
  r = await P('501', { action: 'ask', slots: [{ date: dayN(12), slot: 'day' }] })
  ck('...she can\'t sign up again', r.status === 409 && /isn't open to you/.test(r.j.error))
  r = await W({ action: 'oncall_lift', applicant_id: 'ax:501', reason: 'Talked it through' }, 'sa')
  ck('...until an owner lets her (recorded under her id)', r.j?.outcome === 'lifted' && T.prn_oncall_marks.some((x) => x.caregiver_ax === '501' && x.kind === 'lifted') && (await P('501', { action: 'ask', slots: [{ date: dayN(12), slot: 'day' }] })).j?.ok)
  r = await W({ action: 'oncall_invites' })
  ck('...the Invite list shows her status: invited by text, signed, upcoming shifts', (() => { const m = r.j.people.find((x) => x.caregiver_ax === '501'); return m.invited_via === 'text' && m.signed && m.upcoming >= 0 && !m.blocked })(), r.j.people)

  /* before the SQL runs */
  reset({ prn_oncall_invite_live: true }); delete T.oncall_invites
  r = await W({ action: 'oncall_invites' })
  ck('before the SQL runs: the list says the records are not set up yet', r.status === 500 && r.j.ready === false)
  r = await W({ action: 'week' })
  ck('...the calendar still loads (PRN people only)', r.j?.ok && r.j.oncall.people.every((p) => !p.caregiver))
} finally { fs.rmSync(tmp, { recursive: true, force: true }); Date.prototype.toLocaleString = realTLS }

const src = ['_shared/prn-oncall.ts', 'prn-week/index.ts', 'oncall-page/index.ts', '_shared/oncall-links.ts'].map((f) => fs.readFileSync(path.join(F, f), 'utf8')).join('')
ck('no em dashes in anything people read, never pay amounts on their page', !/—/.test(src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').replace("/—/.test(message)", '')) && !/\$\d/.test(fs.readFileSync(path.join(F, 'oncall-page/index.ts'), 'utf8')))
const out = fs.readFileSync(path.join(F, '_shared/outreach.ts'), 'utf8'), sp = fs.readFileSync(path.join(F, '_shared/send-problems.ts'), 'utf8')
ck('the invite sender is registered (outbound gate and "Didn\'t go through" wording)', /'oncall-invite':\s+\{ class: 'routine_internal', scheduled: false/.test(out) && /'oncall-invite': \['on-call invite to a caregiver', 'caregivers'\]/.test(sp))
const cr = fs.readFileSync(path.join(F, 'coverage-run/index.ts'), 'utf8'), hold = cr.slice(cr.indexOf('async function onCallHoldFor'), cr.indexOf('/* CI1 (2026-10-03)'))
ck('coverage-run: the hold finds an on-call caregiver too (invites read; no invite records = PRN only)', /from\('oncall_invites'\)/.test(hold) && /inv\.error \? \[\]/.test(hold) && /withKeys\(oc\.data/.test(hold) && /team: 'oncall'/.test(hold))

/* ── 3. the SQL ── */
if (process.env.PGLITE) {
  const { PGlite } = await import(pathToFileURL(process.env.PGLITE).href); const db = new PGlite()
  await db.exec(`create table public.job_applicants (id uuid primary key); insert into public.job_applicants values ('00000000-0000-0000-0000-000000000001');`)
  try { await db.exec(`do $$ begin create role anon; create role authenticated; create role service_role; exception when others then null; end $$;`) } catch { /* */ }
  for (const f of ['prn_week.sql', 'prn_oncall_shift.sql', 'prn_page.sql', 'prn_open_shifts.sql', 'prn_recognition.sql', 'prn_oncall_calendar.sql', 'prn_oncall_weekly.sql']) { try { await db.exec('begin;' + fs.readFileSync(f, 'utf8') + 'commit;') } catch (e) { await db.exec('rollback;').catch(() => {}); ck('SQL: ' + f + ' runs (setup)', false, e.message) } }
  const A1 = "'00000000-0000-0000-0000-000000000001'"
  const tryQ = async (s) => { try { await db.query(s); return true } catch { return false } }
  const old = await tryQ(`insert into public.prn_oncall (applicant_id, kind, start_date, end_date, shift, by_email) values (${A1}, 'confirmed', '2026-11-01', '2026-11-01', 'day', 'k')`)
  const sql = fs.readFileSync('oncall_caregivers.sql', 'utf8')
  let twice = true; try { await db.exec('begin;' + sql + 'commit;'); await db.exec('begin;' + sql + 'commit;') } catch (e) { twice = false; ck('SQL runs', false, e.message) }
  const cg = await tryQ(`insert into public.prn_oncall (caregiver_ax, kind, start_date, end_date, shift, by_email) values ('501', 'confirmed', '2026-11-02', '2026-11-02', 'day', 'k')`)
  const both = await tryQ(`insert into public.prn_oncall (applicant_id, caregiver_ax, kind, start_date, end_date, shift, by_email) values (${A1}, '501', 'confirmed', '2026-11-03', '2026-11-03', 'day', 'k')`)
  const neither = await tryQ(`insert into public.prn_oncall (kind, start_date, end_date, shift, by_email) values ('confirmed', '2026-11-04', '2026-11-04', 'day', 'k')`)
  const badAx = await tryQ(`insert into public.prn_oncall (caregiver_ax, kind, start_date, end_date, shift, by_email) values ('abc', 'confirmed', '2026-11-05', '2026-11-05', 'day', 'k')`)
  const sameShift = await tryQ(`insert into public.prn_oncall (applicant_id, kind, start_date, end_date, shift, by_email) values (${A1}, 'confirmed', '2026-11-02', '2026-11-02', 'day', 'k')`)
  const ask1 = await tryQ(`insert into public.prn_oncall (caregiver_ax, kind, start_date, end_date, shift, by_email) values ('501', 'asked', '2026-11-08', '2026-11-08', 'day', 'p')`)
  const ask2 = await tryQ(`insert into public.prn_oncall (caregiver_ax, kind, start_date, end_date, shift, by_email) values ('501', 'asked', '2026-11-08', '2026-11-08', 'day', 'p')`)
  const ser1 = await tryQ(`insert into public.prn_oncall_series (caregiver_ax, slot, weekday, first_date, status, by_email) values ('501', 'day', 6, '2026-11-07', 'asked', 'p')`)
  const ser2 = await tryQ(`insert into public.prn_oncall_series (caregiver_ax, slot, weekday, first_date, status, by_email) values ('501', 'day', 6, '2026-11-14', 'asked', 'p')`)
  const t1 = await tryQ(`insert into public.prn_oncall_terms (caregiver_ax, version, body, typed_name) values ('501', 'v0a1b2c3d', 'These are the on-call expectations.', 'Maria Lopez')`)
  const t2 = await tryQ(`insert into public.prn_oncall_terms (caregiver_ax, version, body, typed_name) values ('501', 'v0a1b2c3d', 'These are the on-call expectations.', 'Maria Lopez')`)
  const mk = await tryQ(`insert into public.prn_oncall_marks (caregiver_ax, kind, note, by_email) values ('501', 'lifted', 'Talked it through', 'k')`)
  const inv = await tryQ(`insert into public.oncall_invites (caregiver_ax, name, via, by_email) values ('501', 'Maria Lopez', 'text', 'k')`)
  const invEdit = await tryQ(`update public.oncall_invites set name = 'x'`), invBad = await tryQ(`insert into public.oncall_invites (caregiver_ax, name, via, by_email) values ('501', 'Maria Lopez', 'email', 'k')`)
  const pr = (await db.query(`select has_table_privilege('anon', 'public.oncall_invites', 'select') as a, has_table_privilege('authenticated', 'public.oncall_invites', 'insert') as i`)).rows[0]
  ck('SQL: runs twice; the PRN record already there is untouched; a record names a PRN member or a caregiver, never both, never neither; one person per shift across both; asks, every-week shifts and signatures once per caregiver; marks take a caregiver; invites kept as written, the public can\'t read them',
    old && twice && cg && !both && !neither && !badAx && !sameShift && ask1 && !ask2 && ser1 && !ser2 && t1 && !t2 && mk && inv && !invEdit && !invBad && !pr.a && !pr.i, { old, twice, cg, both, neither, badAx, sameShift, ask1, ask2, ser1, ser2, t1, t2, mk, inv, invEdit, invBad, pr })
} else ck('SQL on a throwaway Postgres (skipped: PGLITE not set)', true)

const fails = res.filter((r) => !r[1])
for (const [nm, okk, note] of res) console.log((okk ? 'PASS ' : 'FAIL ') + nm + (okk ? '' : '  ' + note))
console.log(`\n${res.length - fails.length}/${res.length} passed`)
process.exit(fails.length ? 1 : 0)
