// Running late · L0 · the read-only look against fake AxisCare, fake GoHighLevel and a fake AI.
// node late_watch_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1200)]);
const FN = 'supabase/functions'
const MIN = 60e3, H = 60 * MIN
const NOW = Date.parse('2026-09-28T20:00:00Z')                 // 3pm Central
const chi = (t) => new Date(t).toLocaleString('en-GB', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false })
let VISITS, CONTACTS, CONVOS, CALLS, AI, APP, T
const at = (h, m = 0) => Date.parse('2026-09-28T00:00:00Z') + (h + 5) * H + m * MIN   // h:m Central (CDT = UTC-5)
const V = (id, cg, cl, startT, inT, extra = {}) => ({ id, caregiver: { id: cg }, client: { id: cl }, scheduledStartDate: new Date(startT).toISOString(),
  clockIn: inT == null ? null : { time: new Date(inT).toISOString() }, ...extra })
const reset = () => {
  CALLS = []; AI = []
  APP = { caregivers: [{ first: 'Maria', last: 'Test', phone: '(417) 555-0101', axiscare_id: '1' }, { first: 'Joe', last: 'Test', phone: '4175550102', axiscare_id: '2' },
    { first: 'Ann', last: 'Test', phone: '', axiscare_id: '3' }, { first: 'Bo', last: 'Test', phone: '4175550104', axiscare_id: '4' }] }
  VISITS = [
    V('a1', 1, 100, at(9), at(9, 21)),         // Maria: texted "15 min late" at 8:40, clocked in 9:21
    V('a2', 1, 101, at(13), at(13, 2)),        // Maria: on time, no texts
    V('b1', 2, 200, at(10), null),             // Joe: "can't make it", no clock-in
    V('b2', 2, 201, at(12), at(12, 40)),       // Joe: called at 11:30 (no text), 40 min late
    V('c1', 3, 300, at(8), at(8, 1)),          // Ann: no phone on roster
    V('d1', 4, 400, at(11), at(11, 3)),        // Bo: not in GoHighLevel
    V('x1', 1, 102, NOW + 2 * H, null),        // not started yet: ignored
    V('x2', 2, 202, at(14), null, { removed: true }),
  ]
  CONTACTS = { '4175550101': [{ id: 'cM', phone: '+14175550101' }], '4175550102': [{ id: 'cJ', phone: '+14175550102' }], '4175550104': [{ id: 'cOther', phone: '+14175559999' }] }
  CONVOS = {
    cM: [{ id: 'm1', direction: 'inbound', messageType: 'TYPE_SMS', body: 'running 15 min late sorry', dateAdded: new Date(at(8, 40)).toISOString() },
         { id: 'm0', direction: 'outbound', messageType: 'TYPE_SMS', body: 'your shifts today', dateAdded: new Date(at(6, 45)).toISOString() },
         { id: 'mOld', direction: 'inbound', messageType: 'TYPE_SMS', body: 'late last month', dateAdded: new Date(NOW - 40 * 864e5).toISOString() }],
    cJ: [{ id: 'j1', direction: 'inbound', messageType: 'TYPE_SMS', body: "I can't make it today, sick", dateAdded: new Date(at(8, 30)).toISOString() },
         { id: 'j2', direction: 'inbound', messageType: 'TYPE_CALL', dateAdded: new Date(at(11, 30)).toISOString() }],
  }
}
globalThis.fetch = async (url, o) => {
  url = String(url); const m = o?.method || 'GET'; CALLS.push({ m, url })
  if (url.includes('api.anthropic.com')) {
    const b = JSON.parse(o.body); const u = b.messages[0].content; AI.push(u)
    const start = u.match(/Shift starts ([^.\n]+)\./)[1]
    let a = { kind: 'other', eta: '', sure: true }
    if (/late/.test(u)) a = { kind: 'late', eta: chi(at(9, 15)), sure: true }
    if (/can't make it/.test(u)) a = { kind: 'cant_make_it', eta: '', sure: true }
    return new Response(JSON.stringify({ content: [{ text: JSON.stringify(a) }], _start: start }), { status: 200 })
  }
  if (/axiscare\.com\/api\/visits\?/.test(url)) return new Response(JSON.stringify({ results: { visits: VISITS, nextPage: null } }), { status: 200 })
  if (url.includes('/contacts/lookup')) return new Response('{}', { status: 404 })
  if (url.includes('/contacts/?')) { const q = decodeURIComponent(url.match(/query=([^&]+)/)[1]); return new Response(JSON.stringify({ contacts: CONTACTS[q] || [] }), { status: 200 }) }
  if (url.includes('/conversations/search')) { const cid = decodeURIComponent(url.match(/contactId=([^&]+)/)[1]); return new Response(JSON.stringify({ conversations: CONVOS[cid] ? [{ id: 'cv_' + cid }] : [] }), { status: 200 }) }
  const cm = url.match(/\/conversations\/cv_([^/]+)\/messages/)
  if (cm) { const all = CONVOS[cm[1]] || []; const sorted = all.slice().sort((a, b) => Date.parse(b.dateAdded) - Date.parse(a.dateAdded))
    return new Response(JSON.stringify({ messages: { messages: sorted, nextPage: false } }), { status: 200 }) }
  return new Response('{}', { status: 404 })
}
const q = (t) => { const st = { f: [] }; const b = { select() { return b }, eq(c, v) { st.f.push([c, v]); return b },
  rows() { if (t === 'app_data') { const k = st.f.find(([c]) => c === 'key')[1]; return k in APP ? [{ key: k, data: APP[k] }] : [] } let r = T[t] ?? []; for (const [c, v] of st.f) r = r.filter((x) => x[c] === v); return r },
  maybeSingle() { return Promise.resolve({ data: b.rows()[0] ?? null, error: null }) },
  then(ok, bad) { return Promise.resolve({ data: b.rows(), error: null }).then(ok, bad) } }; return b }
const db = { from: q }
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485', ANTHROPIC_API_KEY: 'a', LATE_WATCH_PAUSE_MS: '0' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
fs.writeFileSync(`${FN}/_shared/_job-auth_lw.ts`, "export const jobCaller = async (req, cron = true) => req.headers.get('x-test') === 'owner' ? 'owner' : (cron && req.headers.get('x-test') === 'cron' ? 'cron' : null)\n")
process.on('exit', () => { try { fs.unlinkSync(`${FN}/_shared/_job-auth_lw.ts`) } catch { /* */ } })
const src = fs.readFileSync(`${FN}/late-watch/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace(/(['"])\.\.\/_shared\/job-auth\.ts\1/, "'../_shared/_job-auth_lw.ts'")
globalThis.__db = db
const tmp = path.join(process.cwd(), FN, 'late-watch', '_t.ts'); fs.writeFileSync(tmp, src)
let M; try { M = await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
const call = async (qs, hdr) => { const r = await handler(new Request('https://x/functions/v1/late-watch' + qs, { method: 'POST', headers: hdr, body: '{}' })); return { s: r.status, j: await r.json() } }

/* the door */
reset()
for (const [who, hdr] of [['no key', {}], ['the schedule secret', { 'x-test': 'cron' }]]) {
  const r = await call('?l0=1', hdr); ck(`${who}: refused, nothing read`, r.s === 401 && CALLS.length === 0, r)
}
let r

/* the look */
reset(); const all = await M.l0(db, 14, 0, 20, NOW); const c = all.counts
ck('four caregivers with started shifts (a future and a removed visit are left out); one pass covers them', all.caregivers_total === 4 && all.next_offset === null && c.shifts === 6, all)
ck('lateness buckets from the clock-in: on time 3, 10–29 late 1, 30+ late 1, no clock-in 1', c.shifts_on_time === 3 && c.shifts_late_10_29 === 1 && c.shifts_late_30_plus === 1 && c.shifts_no_clock_in === 1, c)
ck('no phone on the roster: counted, not looked up', c.caregivers_no_phone_on_roster === 1 && c.shifts_caregiver_no_phone === 1, c)
ck('a GoHighLevel search whose only result is someone else\'s number is "not in GoHighLevel" (never the first result)', c.caregivers_not_in_ghl === 1 && !CALLS.some((x) => /cOther/.test(x.url)), c)
ck('texts and calls land on the right shift: Maria\'s 8:40 text on the 9:00; Joe\'s text on the 10:00, his call on the 12:00', c.shifts_with_text === 2 && c.shifts_with_call === 1, c)
ck('outbound texts and texts from before the window are not read as theirs', AI.length === 2 && !AI.some((u) => /your shifts today|last month/.test(u)), AI)
ck('the AI: one late (with a time), one can\'t make it', c.ai_late === 1 && c.ai_late_with_time === 1 && c.ai_cant_make_it === 1 && c.ai_cant_make_it_then_no_clock_in === 1, c)
ck('the time they gave vs the clock-in: said 9:15, clocked in 9:21 → within 6–15 minutes', c.eta_6_15_min_after === 1 && c.ai_late_told_before_start === 1 && c.ai_late_eta_10_plus === 1, c)
ck('heads-ups for the shifts 10+ minutes late: both had one (a text, and a call)', c.late10_total === 2 && c.late10_heads_up_text_or_call === 2 && c.late10_ai_said_late === 1, c)
ck('the AI is told the shift start and each text\'s time', /Shift starts 9:00\s?AM/.test(AI[0]) && /\[8:40\s?AM\] running 15 min late/.test(AI[0]), AI[0])
const out = JSON.stringify(all)
ck('the answer holds counts only: no words, names, phone numbers or ids', !/running|sorry|sick|Maria|Joe|417|555|cM|cJ|a1|b1/.test(out.replace(/"(window)":"[^"]*"/, '')), out)
ck('read only: every AxisCare and GoHighLevel call is a GET (only the AI is a POST)', CALLS.every((x) => x.m === 'GET' || x.url.includes('api.anthropic.com')), CALLS.filter((x) => x.m !== 'GET'))

/* batches */
reset(); const p1 = await M.l0(db, 14, 0, 2, NOW), p2 = await M.l0(db, 14, 2, 2, NOW)
ck('in batches: 2 + 2 caregivers, then done', p1.slice_size === 2 && p1.next_offset === 2 && p2.slice_size === 2 && p2.next_offset === null && (p1.counts.shifts + p2.counts.shifts) === 6, [p1, p2])

/* the AI failing */
reset(); const realFetch = globalThis.fetch
globalThis.fetch = async (u, o) => String(u).includes('anthropic') ? new Response('{}', { status: 529 }) : realFetch(u, o)
const f = await M.l0(db, 14, 0, 20, NOW); globalThis.fetch = realFetch
ck('the AI unavailable: counted as failed, never as late', f.counts.ai_failed === 2 && !f.counts.ai_late, f.counts)

/* pieces */
const s = (st, ci) => ({ cg: '1', cl: '1', start: st, clockIn: ci })
const A = s(at(9), at(9, 5)), B = s(at(10), null)
const g = M.assign([A, B], [{ at: at(9, 40) }, { at: at(8) }, { at: at(6, 59) }, { at: at(11, 29) }, { at: at(11, 31) }])
ck('back-to-back: 9:40 goes to the 10:00 (9:00 already clocked in); 8:00 to the 9:00; 6:59 and 11:31 to none; 11:29 to the 10:00',
  (g.get(A) || []).length === 1 && (g.get(B) || []).length === 2, [...g.values()])
ck('a time they give: "09:20" is that day; nonsense and far-off times are refused', M.etaOn('09:20', at(9)) === at(9, 20) && M.etaOn('25:00', at(9)) === null && M.etaOn('9', at(9)) === null && M.etaOn('03:00', at(9)) === null)

/* circles */
reset(); T = { care_circles: [{ id: 'k1', axiscare_client_id: '100', active: true }, { id: 'k2', axiscare_client_id: '200', active: true }, { id: 'k3', axiscare_client_id: '201', active: true }, { id: 'k4', axiscare_client_id: '201', active: true }],
  circle_contacts: [{ circle_id: 'k1', sms_consent: true, phone: '4175550000' }, { circle_id: 'k1', sms_consent: true, phone: '4175550001', stopped_at: 'x' },
    { circle_id: 'k2', sms_consent: false, phone: '4175550002' }, { circle_id: 'k1', sms_consent: true, wants_changes: false, phone: '4175550003' }] }
const cc = await M.circles(db, 14, NOW)
ck('circles: 6 clients; one circle with a member who can get it (STOP and "no updates" left out), one where nobody agreed, one client with two circles, the rest none',
  cc.counts.clients_with_shifts === 6 && cc.counts.circle_has_member_who_can_get_it === 1 && cc.counts.members_who_can_get_it === 1 && cc.counts.circle_but_nobody_agreed_to_texts === 1
  && cc.counts.two_linked_circles === 1 && cc.counts.no_linked_circle === 3, cc)
ck('circles answer counts only', !/417|k1|100/.test(JSON.stringify(cc).replace(/"window":"[^"]*"/, '')), cc)

for (const [n, ok, note] of res) console.log((ok ? 'PASS' : 'FAIL') + ' · ' + n + (ok ? '' : '\n       ' + note))
const pass = res.filter((x) => x[1]).length; console.log(`${pass}/${res.length}`); process.exit(pass === res.length ? 0 : 1)
