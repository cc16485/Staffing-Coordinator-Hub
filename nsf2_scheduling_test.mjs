// NO SILENT FAILURES, slice 2 (2026-10-01) · scheduling senders: coverage-run, coverage-reply, timekeeper-watch,
// caregiver-availability, caregiver-intro, carematch-watch, team-ask, prn-reconfirm, shift-confirm, clockin-alert,
// _shared/clockin-admins (textAdmin), late-watch, late-alert, missed-notes.
// The REAL code against a fake database and a fake GoHighLevel that can refuse a text. Proves: a refused automatic send
// raises a Needs Attention card (and is still not recorded as sent), a ?dry=1 run sends nothing and raises nothing, an
// interactive batch names who failed, and the admin alert helper raises a card for a refusal or a missing phone.
// Then a scan: no automatic send in these files posts to GoHighLevel unchecked.
// node nsf2_scheduling_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const FN = 'supabase/functions'
const SECRET = 'S'.repeat(48)
const realTLS = Date.prototype.toLocaleString, realTLDS = Date.prototype.toLocaleDateString
Date.prototype.toLocaleString = function (loc, o) { if (o && o.hour === '2-digit' && !o.minute && o.timeZone === 'America/Chicago') return '11'; return realTLS.call(this, loc, o) }
Date.prototype.toLocaleDateString = function (loc, o) { if (o && o.weekday === 'short' && o.timeZone === 'America/Chicago' && !o.month) return 'Tue'; return realTLDS.call(this, loc, o) }
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString()
let T, APP, SENT, REFUSE
const reset = () => {
  SENT = []; REFUSE = new Set()
  APP = { ops_settings: {}, caregivers: [], caregiver_availability: [], availability_invites: [], nurse_staff: [] }
  T = { pay_tracks: [], job_applicants: [], prn_checkins: [], contact_optout_current: [], circle_contacts: [], phone_index: [], domains: [], persons: [] }
  for (let i = 1; i <= 3; i++) {
    const ax = String(9000 + i)
    T.pay_tracks.push({ applicant_id: 'a' + i, track: 'prn_team', axiscare_caregiver_id: ax })
    T.job_applicants.push({ id: 'a' + i, first_name: 'P' + i, last_name: 'Test', phone: '41755500' + String(i).padStart(2, '0') })
    APP.caregivers.push({ id: i, first: 'P' + i, last: 'Test', phone: '41755500' + String(i).padStart(2, '0'), axiscare_id: ax, active: true })
    APP.caregiver_availability.push({ id: ax, axiscare_id: ax, windows: { sat: ['morning'] }, updated_at: daysAgo(100) })
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
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + body.phone, dnd: false } }), { status: 200 })
  if (url.includes('/conversations/messages') && o?.method === 'POST') {
    if (REFUSE.has(body.contactId)) return new Response(JSON.stringify({ message: 'number is not SMS capable' }), { status: 422 })
    SENT.push({ to: body.contactId, msg: body.message }); return new Response('{}', { status: 200 })
  }
  return new Response('{}', { status: 200 })
}
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', HUB_JOB_SECRET: SECRET }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const JA = `${FN}/_shared/_job-auth_nsf2s.ts`
fs.writeFileSync(JA, "export const jobCaller = async (req) => req.headers.get('x-test') === 'cron' ? 'cron' : null\n")
process.on('exit', () => { try { fs.unlinkSync(JA) } catch { /* */ } })
const load = async (name) => {
  const src = fs.readFileSync(`${FN}/${name}/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/(['"])\.\.\/_shared\/job-auth\.ts\1/, "'../_shared/_job-auth_nsf2s.ts'")
  const tmp = path.join(process.cwd(), FN, name, '_nsf2s_t.ts'); fs.writeFileSync(tmp, src)
  try { await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) } return handler
}
const cards = (sender) => (APP.ops_items || []).filter((x) => x.kind === 'send_problem' && (!sender || x.sender === sender))

/* ── prn-reconfirm (automatic, a schedule) ── */
const R = await load('prn-reconfirm')
const run = async (qs = '') => { const r = await R(new Request('https://x/functions/v1/prn-reconfirm' + qs, { method: 'POST', headers: { 'x-test': 'cron' }, body: '{}' })); return { s: r.status, j: await r.json() } }
reset(); APP.ops_settings.prn_reconfirm_live = true; REFUSE.add('C:+14175550002')
let r = await run()
const c1 = cards('prn-reconfirm')
ck('prn-reconfirm: GoHighLevel refuses one text: the other two go, the refused one counts as failed and is NOT recorded as sent',
   r.j.texted === 2 && r.j.failed === 1 && SENT.length === 2 && !T.prn_checkins.some((x) => x.axiscare_caregiver_id === '9002'), r)
ck('prn-reconfirm: ... and it raises ONE "didn\'t go through" card with their name, number and the reason',
   c1.length === 1 && c1[0].problem === 'failed' && c1[0].who === 'P2' && c1[0].phone === '+14175550002' && /422/.test(c1[0].detail) && c1[0].domain === 'caregivers', c1)
reset(); APP.ops_settings.prn_reconfirm_live = true; REFUSE.add('C:+14175550002'); r = await run('?dry=1')
ck('prn-reconfirm: a ?dry=1 run sends nothing and raises no card, even with a refusing GoHighLevel', !SENT.length && !cards().length && r.j.live === false, r)

/* ── caregiver-availability invite (interactive: a coordinator pressed the button) ── */
const A = await load('caregiver-availability')
const jwt = 'x.' + Buffer.from(JSON.stringify({ role: 'authenticated' })).toString('base64url') + '.y'
reset(); REFUSE.add('C:+14175550001')
let rr = await A(new Request('https://x/functions/v1/caregiver-availability', { method: 'POST', headers: { authorization: 'Bearer ' + jwt }, body: JSON.stringify({ action: 'invite' }) }))
let j = await rr.json()
ck('availability invite: a refused invite is named in the reply (failed_to) instead of vanishing, and is not recorded as invited',
   j.sent === 2 && j.failed === 1 && j.failed_to[0] === 'P1 Test' && !APP.availability_invites.some((x) => x.id === '9001'), j)
ck('availability invite: ... and a card is raised for it', cards('caregiver-availability').length === 1 && cards('caregiver-availability')[0].who === 'P1 Test', cards())

/* ── textAdmin (the admin alert every clock-in / running-late job uses) ── */
const CA = await import(path.join(process.cwd(), FN, '_shared/clockin-admins.ts'))
const ghl = { token: 'g', locationId: 'loc' }
reset(); REFUSE.add('C:+14175559999')
let ok = await CA.textAdmin(globalThis.__db, ghl, { email: 'kay@mo-care.com', name: 'Kay Admin', first: 'Kay', phone: '+14175559999' }, 'NO CLOCK-IN: test')
let ca = cards('staff-alert')
ck('textAdmin: GoHighLevel refuses: returns false and raises a card naming the admin', ok === false && ca.length === 1 && ca[0].who === 'Kay Admin' && ca[0].problem === 'failed' && ca[0].domain === 'office_ops', ca)
reset(); ok = await CA.textAdmin(globalThis.__db, ghl, { email: 'kay@mo-care.com', name: 'Kay Admin', first: 'Kay', phone: '+14175559999' }, 'NO CLOCK-IN: test')
ck('textAdmin: a text that goes: true, nothing raised', ok === true && SENT.length === 1 && !cards().length, cards())
reset(); ok = await CA.textAdmin(globalThis.__db, ghl, { email: 'nophone@mo-care.com', name: 'No Phone', first: 'No', phone: null }, 'x')
ca = cards('staff-alert')
ck('textAdmin: an admin with no phone on file is no longer skipped silently: a card says there is no usable phone number', ok === false && ca.length === 1 && ca[0].problem === 'no_address' && ca[0].who === 'No Phone', ca)

/* ── scan · every send site in the group ── */
const SP = await import(path.join(process.cwd(), FN, '_shared/send-problems.ts'))
const files = ['coverage-run', 'timekeeper-watch', 'coverage-reply', 'caregiver-availability', 'caregiver-intro', 'carematch-watch', 'team-ask',
  'prn-reconfirm', 'shift-confirm', 'clockin-alert', 'late-watch', 'late-alert', 'missed-notes'].map((n) => [n, fs.readFileSync(`${FN}/${n}/index.ts`, 'utf8')])
files.push(['_shared/clockin-admins', fs.readFileSync(`${FN}/_shared/clockin-admins.ts`, 'utf8')])
const raw = (s) => (s.match(/fetch\('https:\/\/services\.leadconnectorhq\.com\/conversations\/messages'/g) || []).length
/* Only interactive sends that already answer the person with an error keep a raw post: team-ask (502 "Not sent"),
   coverage-run send_selected (lists failed[]), clockin-alert EVV form (502 "could not be sent"). */
const allowedRaw = { 'team-ask': 1, 'coverage-run': 1, 'clockin-alert': 1 }
const bad = files.filter(([n, s]) => raw(s) !== (allowedRaw[n] || 0)).map(([n, s]) => n + ':' + raw(s))
ck('scan · NO SILENT FAILURES: every automatic send in the scheduling group goes through ghlSendChecked (only 3 interactive sends that already report keep a raw post)', !bad.length, bad)
const cr = files.find(([n]) => n === 'coverage-run')[1]
ck('scan · coverage-run\'s one raw send is the coordinator\'s send_selected, which answers with failed[]', /if \(!r\.ok\) \{ failed\.push\(`\$\{x\.name\} \(SMS \$\{r\.status\}\)`\); continue \}/.test(cr))
const ta = files.find(([n]) => n === 'team-ask')[1], cl = files.find(([n]) => n === 'clockin-alert')[1]
ck('scan · team-ask and the EVV form answer a refused send with an error, never ok', /if \(!sentOk\) return json\(\{ outcome: 'failed'/.test(ta) && /if \(!ok\) return json\(\{ error: 'The text could not be sent/.test(cl))
const senders = [...new Set(files.flatMap(([, s]) => [...s.matchAll(/'([a-z][a-z-]+(?: \([^')]*\))?)', \{ channel: '|sender: '([a-z][a-z-]+(?: \([^')]*\))?)'/g)].map((m) => m[1] || m[2])))]
const unknown = senders.filter((x) => !SP.SENDER_WORDS[SP.senderKey(x)])
ck('scan · every sender name these files use reads as a known message on a card (SENDER_WORDS)', senders.length >= 10 && !unknown.length, { senders, unknown })
const changed = files.filter(([n, s]) => /send-problems\.ts'/.test(s)).map(([n]) => n)
ck('scan · each changed file says why (NO SILENT FAILURES comment)', changed.every((n) => /NO SILENT FAILURES \(2026-10-01\)/.test(files.find(([m]) => m === n)[1])) && changed.length === 12, changed)

console.log('\nNO SILENT FAILURES · slice 2 · SCHEDULING SENDERS\n' + '='.repeat(60)); let all = true
for (const [n, g, note] of res) { all &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')) }
console.log('='.repeat(60)); console.log(all ? `ALL ${res.length} CHECKS PASS` : 'FAILED')
if (!all) process.exitCode = 1
