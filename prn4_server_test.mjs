// PRN4 · the 60-day check-in: the sealed link, prn-reconfirm (who's due, hours, cap, quiet period, practice vs live,
// the do-not-text door) and the availability page's link / Still right / Update. Real functions, fake database and
// fake GoHighLevel. node prn4_server_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const FN = 'supabase/functions'
const SECRET = 'S'.repeat(48)
let CLOCK = { wd: 'Tue', hour: '11' }
const realTLS = Date.prototype.toLocaleString, realTLDS = Date.prototype.toLocaleDateString
Date.prototype.toLocaleString = function (loc, o) { if (o && o.hour === '2-digit' && !o.minute && o.timeZone === 'America/Chicago') return CLOCK.hour; return realTLS.call(this, loc, o) }
Date.prototype.toLocaleDateString = function (loc, o) { if (o && o.weekday === 'short' && o.timeZone === 'America/Chicago' && !o.month) return CLOCK.wd; return realTLDS.call(this, loc, o) }
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString()
let T, APP, SENT, OPTED
const reset = () => {
  SENT = []; OPTED = new Set()
  APP = { ops_settings: {}, caregivers: [], caregiver_availability: [] }
  T = { pay_tracks: [], job_applicants: [], prn_checkins: [], contact_optout_current: [], circle_contacts: [], phone_index: [] }
  for (let i = 1; i <= 25; i++) {
    const ax = String(9000 + i)
    T.pay_tracks.push({ applicant_id: 'a' + i, track: 'prn_team', axiscare_caregiver_id: ax })
    T.job_applicants.push({ id: 'a' + i, first_name: 'P' + i, last_name: 'Test', phone: '41755500' + String(i).padStart(2, '0') })
    APP.caregivers.push({ first: 'P' + i, last: 'Test', phone: '41755500' + String(i).padStart(2, '0'), axiscare_id: ax, active: true })
    APP.caregiver_availability.push({ id: ax, axiscare_id: ax, windows: { sat: ['morning'] }, updated_at: daysAgo(i <= 22 ? 70 + i : 10) })
  }
}
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
  if (url.includes('/conversations/messages')) { SENT.push({ to: body.contactId, msg: body.message }); return new Response('{}', { status: 200 }) }
  return new Response('{}', { status: 200 })
}
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', HUB_JOB_SECRET: SECRET }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
fs.writeFileSync(`${FN}/_shared/_job-auth_t4.ts`, "export const jobCaller = async (req) => req.headers.get('x-test') === 'cron' ? 'cron' : null\n")
process.on('exit', () => { try { fs.unlinkSync(`${FN}/_shared/_job-auth_t4.ts`) } catch { /* */ } })
const load = async (name) => {
  const src = fs.readFileSync(`${FN}/${name}/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/(['"])\.\.\/_shared\/job-auth\.ts\1/, "'../_shared/_job-auth_t4.ts'")
  const tmp = path.join(process.cwd(), FN, name, '_t.ts'); fs.writeFileSync(tmp, src)
  let m; try { m = await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) } return { h: handler, m }
}
const L = await import(path.join(process.cwd(), FN, '_shared/prn-links.ts'))

/* ── the sealed link ── */
const exp = L.availExpiry(), link = await L.makeAvailLink(SECRET, '9001', exp)
const parts = Object.fromEntries(new URL(link).searchParams)
ck('link: cc.mo-care.com/availability.html with the caregiver number, an expiry (21 days) and a seal; nothing else about them', link.startsWith('https://cc.mo-care.com/availability.html?c=9001&e=')
   && Object.keys(parts).join() === 'c,e,t' && Math.abs(exp - Math.floor(Date.now() / 1000) - 21 * 86400) <= 2, link)
ck('link: it checks out', await L.checkAvailLink(SECRET, parts))
ck('link: another caregiver number, a changed expiry, a forged seal, an expired link, a missing secret: all refused',
   !(await L.checkAvailLink(SECRET, { ...parts, c: '9002' })) && !(await L.checkAvailLink(SECRET, { ...parts, e: String(exp + 60) }))
   && !(await L.checkAvailLink(SECRET, { ...parts, t: 'A'.repeat(43) })) && !(await L.checkAvailLink(SECRET, parts, exp + 1)) && !(await L.checkAvailLink('', parts)))

/* ── prn-reconfirm ── */
const R = await load('prn-reconfirm')
const run = async (qs = '', hdr = { 'x-test': 'cron' }) => { const r = await R.h(new Request('https://x/functions/v1/prn-reconfirm' + qs, { method: 'POST', headers: hdr, body: '{}' })); return { s: r.status, j: await r.json() } }
reset(); let r = await run('', {})
ck('reconfirm: no schedule secret and no owner key: refused', r.s === 401 && !SENT.length, r)
reset(); CLOCK = { wd: 'Sat', hour: '11' }; r = await run()
ck('reconfirm: Saturday: held, nothing sent', r.j.held && !SENT.length, r); CLOCK = { wd: 'Tue', hour: '17' }; r = await run()
ck('reconfirm: 5pm: held', r.j.held && !SENT.length, r); CLOCK = { wd: 'Tue', hour: '11' }
reset(); r = await run()
ck('reconfirm: practice (switch off): 22 due, 20 this run, would text 20, sends and records nothing', r.j.live === false && r.j.due === 22 && r.j.this_run === 20 && r.j.would_text === 20
   && !SENT.length && !T.prn_checkins.length, r)
reset(); APP.ops_settings.prn_reconfirm_live = true; r = await run('?dry=1')
ck('reconfirm: ?dry=1 is always practice', r.j.live === false && !SENT.length, r)
reset(); APP.ops_settings.prn_reconfirm_live = true
APP.caregiver_availability = APP.caregiver_availability.filter((x) => x.id !== '9002')   // never confirmed
T.prn_checkins.push({ axiscare_caregiver_id: '9003', sent_at: daysAgo(5) })          // texted 5 days ago
OPTED.add('+14175550004')
r = await run()
const m1 = SENT.find((m) => m.to === 'C:+14175550022')?.msg || ''
const firstRun = new Set(SENT.map((m) => m.to))
ck('reconfirm live: 21 due (never confirmed counts, texted 5 days ago doesn\'t), 20 this run, 1 refused by the do-not-text door, 19 texted and recorded',
   r.j.live && r.j.due === 21 && r.j.this_run === 20 && r.j.refused === 1 && r.j.texted === 19 && SENT.length === 19 && T.prn_checkins.filter((x) => !x.answered_at).length === 20, r)
ck('reconfirm: the longest since confirmed goes first (never confirmed leads)', SENT[0].to === 'C:+14175550002', SENT.slice(0, 2))
ck('reconfirm: the text is her wording, their first name, and their own sealed link', /^Hi P22! We're updating our Caring Companions PRN Team availability\. Are you still available for the times you gave us\? Tap to confirm or update: https:\/\/cc\.mo-care\.com\/availability\.html\?c=9022&e=\d+&t=[A-Za-z0-9_-]{43}$/.test(m1), m1)
ck('reconfirm: nobody confirmed in the last 60 days is texted', !SENT.some((m) => /c=90(23|24|25)&/.test(m.msg)), SENT.map((m) => m.to))
SENT = []; r = await run()
ck('reconfirm: run again the same day: nobody just texted is texted again (14 days); the one past the daily limit (P1) goes now', SENT.length === 1 && /c=9001&/.test(SENT[0].msg) && !SENT.some((m) => firstRun.has(m.to)) && r.j.this_run === 2 && r.j.refused === 1, r)
const src = fs.readFileSync(`${FN}/prn-reconfirm/index.ts`, 'utf8')
ck('reconfirm: caregivers only (the do-not-text door, audience caregiver), and nothing about pay', /audience: 'caregiver'/.test(src) && !/\$\d|pay_rates|\brate\b/.test(src.replace(/\/\/.*$/gm, '')))

/* ── the availability page's function ── */
const A = await load('caregiver-availability')
const av = async (body) => { const r = await A.h(new Request('https://x/functions/v1/caregiver-availability', { method: 'POST', body: JSON.stringify(body) })); return { s: r.status, j: await r.json() } }
reset(); T.prn_checkins.push({ axiscare_caregiver_id: '9001', sent_at: daysAgo(2) })
const lk = Object.fromEntries(new URL(await L.makeAvailLink(SECRET, '9001', L.availExpiry())).searchParams)
r = await av({ ...lk })
ck('page with the link: no phone asked; greets them and shows what\'s on file', r.s === 200 && r.j.first_name === 'P1' && r.j.via_link === true && JSON.stringify(r.j.windows) === '{"sat":["morning"]}', r)
r = await av({ ...lk, t: 'A'.repeat(43) }); ck('a forged link: refused, told to use their phone number instead', r.s === 401 && /Enter your phone number instead/.test(r.j.message), r)
r = await av({ ...lk, action: 'confirm' })
const it = APP.caregiver_availability.find((x) => x.id === '9001')
ck('"Still right": confirmed today, windows unchanged, and the check-in marked answered', r.j.confirmed && Date.now() - new Date(it.updated_at).getTime() < 60000 && JSON.stringify(it.windows) === '{"sat":["morning"]}'
   && T.prn_checkins[0].answered_at && T.prn_checkins[0].how === 'still_right', [r, it, T.prn_checkins])
reset(); T.prn_checkins.push({ axiscare_caregiver_id: '9001', sent_at: daysAgo(2) })
r = await av({ ...lk, action: 'save', target_hours: 10, windows: { sun: ['evening', 'bogus'] } })
ck('"Update": saved from the link (bad values dropped), the check-in marked answered as updated', r.j.saved && JSON.stringify(APP.caregiver_availability.find((x) => x.id === '9001').windows.sun) === '["evening"]' && T.prn_checkins[0].how === 'updated', r)
reset(); APP.caregiver_availability = []
r = await av({ ...lk, action: 'confirm' }); ck('"Still right" with nothing on file: says to choose times instead', r.s === 400 && /nothing on file/.test(r.j.error), r)
reset(); APP.caregivers = APP.caregivers.filter((g) => g.axiscare_id !== '9001')
r = await av({ ...lk }); ck('a PRN CNA not on the caregiver roster yet can still use their link (name from their application)', r.j.first_name === 'P1', r)
reset(); r = await av({ phone: '417-555-0003' })
ck('typing a phone number works exactly as before', r.s === 200 && r.j.first_name === 'P3' && r.j.via_link === false, r)
reset(); T.prn_checkins.push({ axiscare_caregiver_id: '9003', sent_at: daysAgo(2) })
await av({ phone: '4175550003', action: 'save', target_hours: 5, windows: { mon: ['morning'] } })
ck('... and saving by phone also answers an open check-in', T.prn_checkins[0].how === 'updated')
for (const [n, o, d] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n     ' + d))
console.log(`${res.filter((x) => x[1]).length}/${res.length}`)
