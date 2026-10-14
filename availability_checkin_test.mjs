// availability-checkin (Samantha, 2026-10-14): every caregiver's 30-day availability text. Who is due, the two wordings,
// the sealed link, AxisCare-active only, never nurses or the PRN Team (they keep their 60-day check-in), the shared 30-day
// log with the office's invite button, hours, cap, practice vs live, the do-not-text door, no silent failures.
// Real function, fake database, fake AxisCare, fake GoHighLevel. node availability_checkin_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const FN = 'supabase/functions'
const SECRET = 'S'.repeat(48)
let CLOCK = { wd: 'Tue', hour: '11' }
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString()
let T, APP, SENT, OPTED, AX, AXDOWN = false, FAILSEND = new Set()
const W = { mon: ['morning'], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }
const reset = () => {
  SENT = []; OPTED = new Set(); AXDOWN = false; FAILSEND = new Set()
  APP = { ops_settings: {}, caregivers: [], caregiver_availability: [], availability_invites: [], nurse_staff: [{ name: 'Nora Nurse' }] }
  T = { pay_tracks: [{ applicant_id: 'p1', track: 'prn_team', axiscare_caregiver_id: '8001' }], contact_optout_current: [], circle_contacts: [], phone_index: [] }
  AX = []
  /* 30 regular caregivers: 1-10 nothing on file, 11-25 on file 40+ days ago, 26-30 on file 5 days ago (not due) */
  for (let i = 1; i <= 30; i++) {
    const ax = String(7000 + i)
    APP.caregivers.push({ first: 'C' + i, last: 'Test', phone: '41755510' + String(i).padStart(2, '0'), axiscare_id: ax, active: true })
    AX.push({ id: Number(ax), status: { active: true } })
    if (i > 10) APP.caregiver_availability.push({ id: ax, axiscare_id: ax, windows: W, updated_at: daysAgo(i <= 25 ? 40 + i : 5) })
  }
  APP.caregivers.push({ first: 'Pam', last: 'Prn', phone: '4175559001', axiscare_id: '8001', active: true }); AX.push({ id: 8001, status: { active: true } })
  APP.caregivers.push({ first: 'Nora', last: 'Nurse', phone: '4175559002', axiscare_id: '8002', active: true }); AX.push({ id: 8002, status: { active: true } })
  APP.caregivers.push({ first: 'Gone', last: 'Away', phone: '4175559003', axiscare_id: '8003', active: true }); AX.push({ id: 8003, status: { active: false } })
  APP.caregivers.push({ first: 'No', last: 'Phone', phone: '', axiscare_id: '8004', active: true }); AX.push({ id: 8004, status: { active: true } })
}
const realTLS = Date.prototype.toLocaleString, realTLDS = Date.prototype.toLocaleDateString
Date.prototype.toLocaleString = function (loc, o) { if (o && o.hour === '2-digit' && !o.minute && o.timeZone === 'America/Chicago') return CLOCK.hour; return realTLS.call(this, loc, o) }
Date.prototype.toLocaleDateString = function (loc, o) { if (o && o.weekday === 'short' && o.timeZone === 'America/Chicago' && !o.month) return CLOCK.wd; return realTLDS.call(this, loc, o) }
const q = (t) => { const st = { f: [], isNull: [], nn: [], gte: null, upd: null }; const b = {
  select() { return b }, order() { return b }, limit() { return b },
  eq(c, v) { st.f.push([c, v]); return b }, is(c, v) { if (v === null) st.isNull.push(c); return st.upd ? b.run() : b }, not(c, op, v) { if (op === 'is' && v === null) st.nn.push(c); return b },
  gte(c, v) { st.gte = [c, v]; return b }, in() { return b },
  update(o) { st.upd = o; return b }, insert(o) { (T[t] ||= []).push({ ...o }); return Promise.resolve({ data: null, error: null }) },
  rows() { if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]; return k in APP ? [{ key: k, data: APP[k] }] : [] }
    let r = T[t] ?? []; for (const [c, v] of st.f) r = r.filter((x) => x[c] === v); for (const c of st.isNull) r = r.filter((x) => x[c] == null)
    for (const c of st.nn) r = r.filter((x) => x[c] != null); if (st.gte) r = r.filter((x) => String(x[st.gte[0]]) >= st.gte[1]); return r },
  run() { for (const x of b.rows()) Object.assign(x, st.upd); return Promise.resolve({ data: null, error: null }) },
  maybeSingle() { return Promise.resolve({ data: b.rows()[0] ?? null, error: null }) },
  then(ok, bad) { return Promise.resolve({ data: b.rows(), error: null }).then(ok, bad) } }; return b }
globalThis.__db = { from: q, rpc: async (fn, a) => {
  if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => String(x.id) === String(a.item.id)); if (i >= 0) arr[i] = a.item; else arr.push(a.item) }
  return { data: null, error: null } } }
globalThis.fetch = async (url, o) => {
  url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + body.phone, dnd: OPTED.has(body.phone) } }), { status: 200 })
  if (url.includes('/conversations/messages')) { if (FAILSEND.has(body.contactId)) return new Response('{"message":"no"}', { status: 422 }); SENT.push({ to: body.contactId, msg: body.message }); return new Response('{}', { status: 200 }) }
  if (url.includes('axiscare.com/api/caregivers')) { if (AXDOWN) return new Response('{}', { status: 503 }); return new Response(JSON.stringify({ results: { caregivers: AX, nextPage: null } }), { status: 200 }) }
  return new Response('{}', { status: 200 })
}
const ENV = { AXISCARE_API_KEY: 'a', AXISCARE_SITE: '16485', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', HUB_JOB_SECRET: SECRET }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
fs.writeFileSync(`${FN}/_shared/_job-auth_t5.ts`, "export const jobCaller = async (req) => req.headers.get('x-test') === 'cron' ? 'cron' : null\n")
process.on('exit', () => { try { fs.unlinkSync(`${FN}/_shared/_job-auth_t5.ts`) } catch { /* */ } })
const load = async (name) => {
  const src = fs.readFileSync(`${FN}/${name}/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/(['"])\.\.\/_shared\/job-auth\.ts\1/, "'../_shared/_job-auth_t5.ts'")
  const tmp = path.join(process.cwd(), FN, name, '_t.ts'); fs.writeFileSync(tmp, src)
  let m; try { m = await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) } return { h: handler, m }
}

const L = await import(path.join(process.cwd(), FN, '_shared/prn-links.ts'))
const R = await load('availability-checkin')
const run = async (qs = '', hdr = { 'x-test': 'cron' }) => { const r = await R.h(new Request('https://x/functions/v1/availability-checkin' + qs, { method: 'POST', headers: hdr, body: '{}' })); return { s: r.status, j: await r.json() } }
reset(); let r = await run('', {})
ck('no schedule secret and no owner key: refused', r.s === 401 && !SENT.length, r)
reset(); CLOCK = { wd: 'Sun', hour: '11' }; r = await run()
ck('Sunday: held, nothing sent', r.j.held && !SENT.length, r); CLOCK = { wd: 'Wed', hour: '9' }; r = await run()
ck('9am: held', r.j.held && !SENT.length, r); CLOCK = { wd: 'Tue', hour: '11' }
reset(); r = await run()
ck('practice (switch off): 25 due (10 with nothing on file, 15 on file 30+ days), 25 this run, sends and logs nothing; nurse, PRN, not active in AxisCare and no phone left out and counted',
   r.j.live === false && r.j.due === 25 && r.j.this_run === 25 && r.j.would_text.length === 25 && !SENT.length && !APP.availability_invites.length
   && r.j.skipped.nurse === 1 && r.j.skipped.prn_team === 1 && r.j.skipped.not_in_axiscare === 1 && r.j.skipped.no_phone === 1, r)
reset(); AXDOWN = true; APP.ops_settings.avail_checkin_live = true; r = await run()
ck('AxisCare unreadable: the run holds, nobody texted (never texts on roster data alone)', r.j.ok === false && /AxisCare could not be read/.test(r.j.held) && !SENT.length, r)
reset(); APP.ops_settings.avail_checkin_live = true; r = await run('?dry=1')
ck('?dry=1 is always practice', r.j.live === false && !SENT.length, r)
reset(); APP.ops_settings.avail_checkin_live = true
APP.availability_invites.push({ id: '7001', name: 'C1 Test', at: daysAgo(10) }, { id: '7002', name: 'C2 Test', at: daysAgo(31) })   // office button 10 days ago / 31 days ago
for (let i = 31; i <= 34; i++) { const ax = String(7000 + i); APP.caregivers.push({ first: 'C' + i, last: 'Test', phone: '41755510' + i, axiscare_id: ax, active: true }); AX.push({ id: Number(ax), status: { active: true } }) }
OPTED.add('+14175551003'); FAILSEND.add('C:+14175551004')
r = await run()
const to = (i) => SENT.find((m) => m.to === 'C:+141755510' + String(i).padStart(2, '0'))?.msg || ''
ck('live: 28 due (texted by the office 10 days ago is not; 31 days ago is), 25 this run, 1 refused by the do-not-text door, 1 refused by GoHighLevel and named, 23 texted and logged',
   r.j.live && r.j.due === 28 && r.j.this_run === 25 && r.j.refused === 1 && r.j.failed === 1 && r.j.failed_to.join() === 'C4 Test' && r.j.texted === 23 && SENT.length === 23 && APP.availability_invites.filter((x) => x.via === 'availability-checkin').length === 23, r)
ck('nothing on file goes first; texted by the office 10 days ago is not texted', to(2) && !to(1) && SENT.slice(0, 8).every((m) => /Tell us the days and times you can work/.test(m.msg)), SENT.slice(0, 3))
ck('nothing on file: asks them to fill it in, mentions the outside-hours choice, their own sealed link', /^Hi C2, it's Caring Companions! Tell us the days and times you can work so we can offer you shifts that fit: https:\/\/cc\.mo-care\.com\/availability\.html\?c=7002&e=\d+&t=[A-Za-z0-9_-]{43} You can also choose to get texts about shifts outside those times\. It takes 30 seconds\.$/.test(to(2)), to(2))
const m11 = to(25), lk = Object.fromEntries(new URL((m11.match(/https:\S+/) || ["https://x"])[0]).searchParams)
ck('on file: keep or update, and the outside-hours choice, with a link that checks out for them only', /^Hi C25, it's Caring Companions! Are the days and times you can work still the same\? Tap to keep them or update them, and to choose if you'd like texts about shifts outside those times: https:/.test(m11)
   && lk.c === '7025' && await L.checkAvailLink(SECRET, lk), m11)
ck('nobody confirmed in the last 30 days, no nurse, no PRN member, nobody inactive in AxisCare is texted', !SENT.some((m) => /c=70(26|27|28|29|30)&|c=800[1-4]&/.test(m.msg)))
ck('no em dash in either text', !SENT.some((m) => /\u2014/.test(m.msg)))
SENT = []; FAILSEND = new Set(); r = await run()
ck('run again the same day: nobody just texted again; the 3 past the limit and the 1 GoHighLevel refused go now (the do-not-text one is refused again)', SENT.length === 4 && r.j.texted === 4 && r.j.refused === 1 && SENT.some((m) => m.to === 'C:+14175551004'), r)
reset(); APP.ops_settings.avail_checkin_live = true; APP.ops_settings.avail_checkin_msg_on_file = 'Hey {first_name}, still right? {link}'; r = await run()
ck('wording from Settings is used', SENT.some((m) => /^Hey C25, still right\? https:/.test(m.msg)), SENT.slice(10, 12))
for (const [n, o, d] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n     ' + d))
console.log(`${res.filter((x) => x[1]).length}/${res.length}`); process.exit(res.every((x) => x[1]) ? 0 : 1)
