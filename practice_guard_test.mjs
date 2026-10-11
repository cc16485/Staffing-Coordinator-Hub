// PRACTICE ADDRESS GUARD (Samantha "approve the two fixes", 2026-10-11): a 555-01xx number or an example/test email is never
// texted, emailed or added to GoHighLevel. Fake database and fake GoHighLevel; nothing real is touched.
//   node practice_guard_test.mjs
import fs from 'fs'; import path from 'path'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 600)])
const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'svc', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'L' }
let handler = null; globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h } }
const CALLS = []; const RPC = []; const INSERTS = []
globalThis.fetch = async (u, o = {}) => { CALLS.push(String(u)); return new Response(JSON.stringify({ contact: { id: 'c1', phone: '+14175551234', email: 'real@mo-care.com' } }), { status: 200 }) }
const db = {
  rpc: async (n, a) => { RPC.push([n, a]); return { data: null, error: null } },
  from: (t) => { const q = { select: () => q, eq: () => q, not: () => q, in: () => q, order: () => q, limit: () => q, maybeSingle: async () => ({ data: null, error: null }),
    insert: async (r) => { INSERTS.push([t, r]); return { error: null } }, upsert: async (r) => { INSERTS.push([t, r]); return { error: null } }, update: () => q,
    then: (ok) => ok({ data: [], error: null }) }; return q },
}
const TMP = path.join(ROOT, '.pg_under_test'); fs.rmSync(TMP, { recursive: true, force: true }); fs.cpSync(FN, TMP, { recursive: true })
for (const p of fs.readdirSync(TMP, { recursive: true })) { const f = path.join(TMP, String(p)); if (!f.endsWith('.ts')) continue; fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db').replace(/^import .* from ['"]https:[^'"]*['"];?$/mg, '')) }
globalThis.__db = db
let O, ATT; try { O = await import(path.join(TMP, '_shared', 'optout.ts')); await import(path.join(TMP, 'ghl-attach-doc', 'index.ts')); ATT = handler } finally { fs.rmSync(TMP, { recursive: true, force: true }) }

ck('practice numbers: any format of 555-0180 to 555-0189', ['4175550183', '(417) 555-0189', '+1 417 555 0180', '5550186'].every(O.practicePhone))
ck('real numbers, and the 555-01xx numbers the tests use for pretend real people, are not practice numbers', !['4175551234', '4175550200', '4175550101', '4175550199', '4175550179', '4175550190', ''].some(O.practicePhone))
ck('practice emails: @practice.invalid', ['pat@practice.invalid', 'PAT.P@Practice.Invalid', 'x@hire.practice.invalid'].every(O.practiceEmail))
ck('real emails are not practice emails', !['samantha@mo-care.com', 'pat@example.com', 'a@cc.test', 'a@example.invalid', 'a@notpractice.invalid', 'practice.invalid@gmail.com'].some(O.practiceEmail))
ck('a practice person: every address given is a practice one', O.practicePerson('4175550183', '') && O.practicePerson('', 'pat@practice.invalid') && O.practicePerson('4175550183', 'pat@practice.invalid') && !O.practicePerson('4175550183', 'real@gmail.com') && !O.practicePerson('', ''))

CALLS.length = 0; RPC.length = 0; INSERTS.length = 0
let v = await O.optOutCheck(db, { channel: 'sms', phone: '4175550183', ghlContact: { dnd: false } })
ck('the universal check refuses a practice number, with the reason, before reading anything', !v.allowed && v.reasons.length === 1 && v.reasons[0] === O.PRACTICE_WHY && !CALLS.length, v)
v = await O.optOutCheck(db, { channel: 'email', email: 'pat@practice.invalid', ghlContact: { dnd: false } })
ck('...and a practice email', !v.allowed && v.reasons[0] === O.PRACTICE_WHY)
v = await O.optOutCheck(db, { channel: 'sms', phone: '4175551234', ghlContact: { dnd: false } })
ck('a real number still goes through the usual checks (nothing new refuses it)', v.allowed === true, v)

CALLS.length = 0; RPC.length = 0; INSERTS.length = 0
let id = await O.ghlContactIfAllowed(db, { token: 'g', locationId: 'L' }, 'welcome-call', { channel: 'sms', phone: '4175550183', firstName: 'Pat', lastName: 'Practice' })
ck('the GoHighLevel door: a practice number gets no contact (GoHighLevel is never called)', id === null && !CALLS.some((u) => /leadconnectorhq/.test(u)), CALLS)
ck('...the refusal is logged', RPC.some(([n, a]) => n === 'contact_send_refusal_log' && a.p_reasons[0] === O.PRACTICE_WHY && a.p_sender === 'welcome-call'), RPC)
ck('...and no Needs Attention card is raised (nothing failed)', !INSERTS.some(([t]) => t === 'app_data') && !RPC.some(([n]) => n === 'upsert_app_data_item'), [INSERTS, RPC.map((r) => r[0])])
id = await O.ghlContactIfAllowed(db, { token: 'g', locationId: 'L' }, 'welcome-call', { channel: 'email', email: 'pat@practice.invalid', phone: '4175550183' })
ck('...a practice email too', id === null && !CALLS.some((u) => /leadconnectorhq/.test(u)))
CALLS.length = 0
id = await O.ghlContactIfAllowed(db, { token: 'g', locationId: 'L' }, 'welcome-call', { channel: 'sms', phone: '4175551234' })
ck('a real number still reaches GoHighLevel as before', CALLS.some((u) => /contacts\/upsert/.test(u)), CALLS)

CALLS.length = 0
const ok = await O.mayContact(db, 'step2-handoff', { channel: 'sms', phone: '417-555-0185', ghlContact: { dnd: false } })
ck('mayContact (the other senders\' door) says no for a practice number', ok === false && !CALLS.length)

// ghl-attach-doc: a practice person is never added to GoHighLevel
const req = (b) => new Request('http://x/ghl-attach-doc', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' }, body: JSON.stringify(b) })
globalThis.__staff = true
CALLS.length = 0
let r = null
try { r = await ATT(req({ first: 'Pat', last: 'Practice', phone: '4175550183', email: 'pat@practice.invalid', label: 'EDL proof', file_url: 'https://x/y.pdf' })) } catch (e) { r = e }
const j = r && r.json ? await r.json() : r
ck('the proof-to-GoHighLevel step: a practice person is skipped, nothing reaches GoHighLevel', (j && j.skipped === 'practice') || (j && j.error && !CALLS.some((u) => /leadconnectorhq/.test(u))), [j, CALLS])

const src = fs.readFileSync(path.join(FN, '_shared/optout.ts'), 'utf8') + fs.readFileSync(path.join(FN, 'ghl-attach-doc/index.ts'), 'utf8')
ck('no em dash added', !/—/.test(src.split('PRACTICE ADDRESSES')[1] || ''))
for (const [n, ok_, note] of res) console.log((ok_ ? 'PASS  ' : 'FAIL  ') + n + (ok_ ? '' : '  ' + note))
const bad = res.filter((x) => !x[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
