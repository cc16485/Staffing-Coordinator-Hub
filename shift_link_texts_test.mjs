// THE SHIFT PAGE LINK IN CARA'S TEXTS (2026-10-24, her approval + two improvements). coverage-run send_selected and
// follow_up, the real function against a fake database, fake AxisCare and fake GoHighLevel. Proves: switch off and nobody in
// the pilot = today's texts exactly; a pilot caregiver (a PRN member here) gets their own link while everyone else's text is
// unchanged; with a link: town only, no street, no care line; "all or part of it" only when the office allowed a flexible
// start or a hand-off, otherwise "one caregiver for the whole shift"; the regular-shift line; same-day wording; a case's own
// wording gets a link only where {link} was typed; interest checks never; follow-ups fill {link} per person and refuse when
// someone can't have one; the night hold still holds; each link is that person's own and checks out.
// node shift_link_texts_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1200)]);
const FN = 'supabase/functions'
let T, APP, SENT, VISITS
const SVC = 'svc_' + 'k'.repeat(60)
const ymd = (d) => d.toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d) }
/* the next Saturday at least 3 days away, so notice is never the reason in the base case */
const nextSat = (() => { const d = new Date(); d.setDate(d.getDate() + 3); while (d.getDay() !== 6) d.setDate(d.getDate() + 1); return ymd(d) })()
const W = (days, times) => Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, days.includes(d) ? times : []]))
const reset = (kase) => {
  SENT = []; VISITS = []
  APP = {
    caregivers: [
      { first: 'Sarah', last: 'Prn', phone: '4175550101', axiscare_id: '9001', active: true },
      { first: 'Jess', last: 'Prn', phone: '4175550102', axiscare_id: '9002', active: true },
      { first: 'Maria', last: 'Prn', phone: '4175550103', axiscare_id: '9003', active: true },
      { first: 'Ann', last: 'Regular', phone: '4175550104', axiscare_id: '9004', active: true },
      { first: 'Bob', last: 'Regular', phone: '4175550105', axiscare_id: '9005', active: true }],
    caregiver_availability: [
      { id: '9001', axiscare_id: '9001', windows: W(['sat', 'sun'], ['morning']), updated_at: '2026-09-29T10:00:00Z' },
      { id: '9002', axiscare_id: '9002', windows: W(['sat'], ['morning', 'afternoon']), updated_at: '2026-09-20T10:00:00Z' },
      { id: '9003', axiscare_id: '9003', windows: W(['sat'], ['morning']), updated_at: '2026-09-29T10:00:00Z' }],
    coverage_cases: [kase], ops_settings: { coverage_send_live: true, coverage_quiet_from: 0, coverage_quiet_until: 0 /* CI1: no night hold in these tests, whatever the clock */ }, responsibilities: [], nurse_staff: [], coverage_do_not_offer: [], client_checkins: [],
  }
  T = { domains: [], persons: [], contact_optout_current: [], circle_contacts: [], phone_index: [], client_callin_current: [], person_identity: [], person_source_id: [],
    pay_tracks: [{ applicant_id: 'a1', track: 'prn_team', axiscare_caregiver_id: '9001' }, { applicant_id: 'a2', track: 'prn_team', axiscare_caregiver_id: '9002' },
                 { applicant_id: 'a3', track: 'prn_team', axiscare_caregiver_id: '9003' }, { applicant_id: 'a9', track: 'ongoing', axiscare_caregiver_id: '9004' }],
    job_applicants: [{ id: 'a1', prn: { notice: 'same_day' } }, { id: 'a2', prn: { notice: 'few_hours' } }, { id: 'a3', prn: { notice: '48h' } }, { id: 'a9', prn: { notice: 'same_day' } }] }
}
const q = (t) => { const st = { f: [], inF: null, nn: [] }; const b = {
  select() { return b }, order() { return b }, limit() { return b }, gte() { return b }, lte() { return b }, lt() { return b }, gt() { return b }, ilike() { return b }, or() { return b }, contains() { return b }, range() { return b }, neq() { return b },
  eq(c, v) { st.f.push([c, v]); return b }, in(c, v) { st.inF = [c, v]; return b }, is() { return b }, not(c, op, v) { if (op === 'is' && v === null) st.nn.push(c); return b },
  update() { return { eq: () => Promise.resolve({ data: null, error: null }) } }, upsert() { return Promise.resolve({ data: null, error: null }) }, insert() { return Promise.resolve({ data: null, error: null }) },
  maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: null })) }, single() { return b.maybeSingle() },
  then(ok, bad) {
    if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]; return Promise.resolve({ data: k in APP ? [{ key: k, data: APP[k] }] : [], error: null }).then(ok, bad) }
    let r = T[t] ?? []; for (const [c, v] of st.f) r = r.filter((x) => x[c] === v); for (const c of st.nn) r = r.filter((x) => x[c] != null)
    if (st.inF) r = r.filter((x) => st.inF[1].includes(x[st.inF[0]])); return Promise.resolve({ data: r, error: null }).then(ok, bad) } }; return b }
globalThis.__db = { from: q, rpc: async (fn, a) => {
  if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => x.id === a.item.id); if (i >= 0) arr[i] = a.item; else arr.push(a.item) }
  /* CI1: the ask is recorded under the case's lock before the text (the real one is SQL: ci1_sql_test.py) */
  if (fn === 'coverage_case_add_ask') { const c = (APP.coverage_cases || []).find((x) => x.id === a.p_id); if (!c) return { data: 'not_found', error: null }; if (c.status !== 'open') return { data: 'not_open', error: null };
    const ten = (p) => String(p || '').replace(/\D/g, '').slice(-10); c.asked = c.asked || [];
    if (c.asked.some((x) => ten(x.phone) === ten(a.p_ask.phone) || (a.p_ask.axiscare_id && x.axiscare_id === a.p_ask.axiscare_id))) return { data: 'already_asked', error: null };
    c.asked.push(a.p_ask); return { data: 'added', error: null } }
  if (fn === 'coverage_case_remove_ask') { const c = (APP.coverage_cases || []).find((x) => x.id === a.p_id); if (c) c.asked = (c.asked || []).filter((x) => x.id !== a.p_ask_id); return { data: true, error: null } }
  return { data: null, error: null } }, auth: { getUser: async () => ({ data: { user: null }, error: { message: 'no' } }) } }
globalThis.__dbFor = (key) => ({ from: () => { const b = { select() { return b }, limit() { return Promise.resolve(key === SVC ? { data: [], error: null } : { data: null, error: { message: 'denied' } }) } }; return b } })
globalThis.fetch = async (url, o) => {
  url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + (body.phone || body.email), dnd: false } }), { status: 200 })
  if (url.includes('/conversations/messages')) { SENT.push({ to: body.contactId, msg: body.message }); return new Response('{}', { status: 200 }) }
  if (/axiscare\.com\/api\/caregivers(\?|$)/.test(url)) return new Response(JSON.stringify({ results: { caregivers: APP.caregivers.map((c) => ({ id: Number(c.axiscare_id), status: { active: true }, classes: [], mailingAddress: { city: 'Nixa', postalCode: '65714' } })) } }), { status: 200 })
  if (/axiscare\.com\/api\/clients\//.test(url)) return new Response(JSON.stringify({ results: { client: { classes: [], residentialAddress: { city: 'Nixa', postalCode: '65714' } } } }), { status: 200 })
  if (url.includes('axiscare.com')) return new Response(JSON.stringify({ results: { visits: VISITS }, nextPage: null }), { status: 200 })
  return new Response('{}', { status: 200 })
}
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SVC, GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485', HUB_JOB_SECRET: 'j'.repeat(64) }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
{ const ja = fs.readFileSync(`${FN}/_shared/job-auth.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = (u, key) => globalThis.__dbFor(key)')
  fs.writeFileSync(`${FN}/_shared/_job-auth_slt.ts`, ja) }
process.on('exit', () => { try { fs.unlinkSync(`${FN}/_shared/_job-auth_slt.ts`) } catch { /* */ } })
const src = fs.readFileSync(`${FN}/coverage-run/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace(/(['"])\.\.\/_shared\/job-auth\.ts\1/, "'../_shared/_job-auth_slt.ts'")
const tmp = path.join(process.cwd(), FN, 'coverage-run', '_slt.ts'); fs.writeFileSync(tmp, src)
let M; try { M = await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
const act = async (body) => { const r = await handler(new Request('https://x/functions/v1/coverage-run', { method: 'POST', headers: { Authorization: 'Bearer ' + SVC, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })); return r.json() }
const names = (arr) => (arr || []).map((x) => x.name)
const K = (o) => ({ id: 'cv1', status: 'open', reason: 'calloff', client: 'Ruth Kay', client_axiscare_id: '500', shift_date: nextSat, shift_time: '07:00-11:00', asked: [], ...o })


const SL = await import(path.join(process.cwd(), FN, '_shared/shift-links.ts'))
const LT = await import(path.join(process.cwd(), FN, '_shared/shift-link-texts.ts'))
const SECRET = 'j'.repeat(64)
const KC = (o) => K({ client: 'Ruth Kay', client_city: 'Nixa', client_street: '1234 Elm St', care_note: 'Likes her coffee at 10', ...o })
const send = async (who, extra) => { const r = await act({ action: 'send_selected', case_id: 'cv1', recipients: who, ...(extra || {}) }); return r }
const msgTo = (ph) => (SENT.filter((s) => s.to === 'C:+1' + ph).pop() || {}).msg || ''
const linkIn = (m) => { const x = /https:\/\/cc\.mo-care\.com\/shift\.html\?\S+/.exec(m); return x ? Object.fromEntries(new URL(x[0]).searchParams) : null }

/* switch off, nobody in the pilot: today's texts, exactly */
reset(KC()); let r = await send(['Sarah Prn', 'Ann Regular'])
let sm = msgTo('4175550101'), am = msgTo('4175550104')
ck('switch off, no pilot: today\'s texts exactly (street, care line, Reply YES or NO), no link', /PRN opportunity: Ruth at Elm St, Nixa/.test(sm) && /Likes her coffee at 10/.test(sm) && !/shift\.html/.test(sm + am) && /at Elm St, Nixa/.test(am) && /Reply YES or NO/.test(am), [sm, am, r])
ck('... and no ask is stamped with a link', APP.coverage_cases[0].asked.every((a) => !a.link_sent && !a.pilot_link))

/* the pilot: Sarah (PRN) only */
reset(KC()); APP.ops_settings.shift_link_pilot = [{ axiscare_id: '9001', name: 'Sarah Prn' }]
r = await send(['Sarah Prn', 'Ann Regular']); sm = msgTo('4175550101'); am = msgTo('4175550104')
const sAsk = APP.coverage_cases[0].asked.find((a) => a.name === 'Sarah Prn'), aAsk = APP.coverage_cases[0].asked.find((a) => a.name === 'Ann Regular')
ck('pilot: Sarah (PRN) gets her own link, the PRN wording, town only, no street, no care line', /^Hi Sarah! Caring Companions PRN opportunity in Nixa for Ruth: /.test(sm) && /View details and answer here: https:\/\/cc\.mo-care\.com\/shift\.html\?/.test(sm) && /You can also reply YES or NO\. No pressure either way\.$/.test(sm) && !/Elm|coffee/.test(sm), sm)
ck('pilot: an exact-time shift with no hand-off says one caregiver for the whole shift (no "part of it")', /It needs one caregiver for the whole shift\./.test(sm) && !/part of it/.test(sm), sm)
const L1 = linkIn(sm)
ck('pilot: the link is Sarah\'s own (her ask on this case) and checks out; it ends with the shift day', L1 && L1.c === 'cv1' && L1.a === sAsk.id && Number(L1.e) === SL.shiftDayEnd(APP.coverage_cases[0].shift_date) && await SL.checkShiftLink(SECRET, L1), [L1, sAsk])
ck('pilot: her ask is stamped as a pilot link; Ann (not in the pilot) gets today\'s text, no link', sAsk.link_sent === 'pilot' && sAsk.pilot_link === true && !aAsk.link_sent && /at Elm St, Nixa/.test(am) && !/shift\.html/.test(am), [sAsk, am])

/* switch on: everyone; the wording follows the shift's time rules */
reset(KC({ time_flex: 'flexible_start', flex_minutes: 60 })); APP.ops_settings.shift_link_texts_live = true
r = await send(['Ann Regular']); am = msgTo('4175550104')
ck('switch on: everyone gets a link; a flexible start invites all or part of it (her wording)', /^Hi Ann! Caring Companions has an open shift in Nixa for Ruth on .+\. View details and let us know if you can work all or part of it: https:\/\/cc\.mo-care\.com\/shift\.html\?\S+ You can also reply YES or NO\.$/.test(am), am)
reset(KC({ handoff_ok: true })); APP.ops_settings.shift_link_texts_live = true
r = await send(['Ann Regular']); am = msgTo('4175550104')
ck('hand-off allowed: all or part of it too', /all or part of it/.test(am) && !/whole shift/.test(am), am)
reset(KC({ shift_pattern: { v: 2, kind: 'open_ongoing', weekday: 'Saturday' } })); APP.ops_settings.shift_link_texts_live = true
r = await send(['Ann Regular']); am = msgTo('4175550104')
ck('an ongoing opening says it could become a regular Saturday shift', /This could become a regular Saturday shift\. It needs one caregiver for the whole shift\./.test(am), am)
reset(KC({ shift_date: inDays(0), shift_time: '23:00-23:45' })); APP.ops_settings.shift_link_texts_live = true
r = await send(['Ann Regular']); am = msgTo('4175550104')
ck('same day: the last-minute wording with the link', /^Hi Ann! Caring Companions needs a last-minute fill-in in Nixa for Ruth: today /.test(am) && /shift\.html/.test(am), [am, r])

/* the case's own wording, interest checks */
reset(KC({ msg_other: 'Hi {first_name}, special shift for {client} at {address}: {when}. Reply YES or NO.' })); APP.ops_settings.shift_link_texts_live = true
r = await send(['Ann Regular']); am = msgTo('4175550104')
ck('a case\'s own wording without {link}: sent as written, no link added', /^Hi Ann, special shift for Ruth at Elm St, Nixa: .+\. Reply YES or NO\.$/.test(am) && !/shift\.html/.test(am), [am, r])
reset(KC({ msg_other: 'Hi {first_name}, special shift for {client} at {address}: {when}. Details: {link} Reply YES or NO.' })); APP.ops_settings.shift_link_texts_live = true
r = await send(['Ann Regular']); am = msgTo('4175550104')
ck('... with {link} typed in: the link goes there, and the street becomes the town', /^Hi Ann, special shift for Ruth in Nixa: .+ Details: https:\/\/cc\.mo-care\.com\/shift\.html\?\S+ Reply YES or NO\.$/.test(am), am)
reset(KC({ kind: 'interest', reason: 'open' })); APP.ops_settings.shift_link_texts_live = true
r = await send(['Ann Regular']); am = msgTo('4175550104')
ck('interest check for a potential new client: never a link', am && !/shift\.html/.test(am) && /potential new client/.test(am), [am, r])

/* the pure templates: no dashes, a sensible length */
const all = ['other', 'sameday', 'tier1', 'prn'].flatMap((k) => [LT.linkTemplate(k, true), LT.linkTemplate(k, false)])
ck('templates: never an em or en dash; each keeps "reply YES or NO"; none mentions pay', all.every((t) => !/[–—]/.test(t) && /reply YES or NO/.test(t) && !/\$|pay|rate/i.test(t)))
const filled = LT.fillLinked(LT.linkTemplate('other', true), { first: 'Maria', client: 'Ruth', when: 'Sat, Oct 31 8am-5pm', town: 'Nixa', pattern: 'This could become a regular Saturday shift. ', link: 'https://cc.mo-care.com/shift.html?c=cov_1729999999999&a=ask_m1x2y3z4a5&e=1761886800&t=' + 'x'.repeat(43) })
ck('length: no more than 3 text parts with a real-length link (under 459 characters)', filled.length < 459, filled.length)
ck('tier1 (they work with the client): the short wording with the link', /^Hi \{first_name\}, can you cover \{client\} \{when\}\? \{pattern\}It needs one caregiver for the whole shift\. Details: \{link\} It's Caring Companions\. You can also reply YES or NO\.$/.test(LT.linkTemplate('tier1', false)) && /All or part of it is welcome\./.test(LT.linkTemplate('tier1', true)))

/* follow-ups */
reset(KC()); APP.ops_settings.shift_link_pilot = [{ axiscare_id: '9001', name: 'Sarah Prn' }]
await send(['Sarah Prn', 'Ann Regular']); const ids = APP.coverage_cases[0].asked.map((a) => a.id); SENT = []
r = await act({ action: 'follow_up', case_id: 'cv1', ask_ids: ids, message: 'Hi {first_name}, just checking on Ruth\'s shift. Here are the details again: {link} Or reply YES or NO.' })
ck('follow-up with {link} to someone who can\'t have a link yet: nothing sent, and the office is told who', r.error && /aren't on for Ann Regular/.test(r.error) && SENT.length === 0, r)
r = await act({ action: 'follow_up', case_id: 'cv1', ask_ids: [ids[0]], message: 'Hi {first_name}, just checking on Ruth\'s shift. Here are the details again: {link} Or reply YES or NO.' })
const fl = linkIn(msgTo('4175550101'))
ck('follow-up to the pilot caregiver: her own link, the same ask', r.sent && r.sent.length === 1 && fl && fl.a === ids[0] && await SL.checkShiftLink(SECRET, fl), [r, fl])
SENT = []; r = await act({ action: 'follow_up', case_id: 'cv1', ask_ids: ids, message: 'Hi {first_name}, still need help with Ruth\'s shift. Reply YES or NO.' })
ck('follow-up without {link}: as today, to everyone', r.sent && r.sent.length === 2 && !/shift\.html/.test(SENT.map((s) => s.msg).join(' ')), r)

/* the night hold is unchanged */
reset(KC()); APP.ops_settings.shift_link_texts_live = true; APP.ops_settings.coverage_quiet_from = 0; APP.ops_settings.coverage_quiet_until = 24
r = await send(['Ann Regular'])
ck('night hold: still holds with links on (nothing sent)', r.held_night === true && SENT.length === 0, r)

for (const [n, okk, note] of res) console.log(okk ? '  ✓' : '  ✗', n, okk ? '' : note)
const bad = res.filter((x) => !x[1]); console.log(`\n${res.length - bad.length}/${res.length} passed`); process.exit(bad.length ? 1 : 0)
