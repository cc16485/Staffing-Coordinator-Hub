// 396 · staff-contacts-check (temporary, read only) against fakes. node staff_contacts_test.mjs
import fs from 'fs'; import path from 'path'
const FN = 'supabase/functions'; const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 700)])
const T = { applicant_alerts: [{ name: 'Krystal K', phone: '4175550001', email: 'krystal@x.com', active: true }, { name: 'Ok Person', phone: '4175550002', email: 'ok@x.com', active: true }] }
const APP = { coordinator_staff: [{ name: 'Noemail Nan', phone: '4175550003', email: '' }, { name: 'Krystal K', email: 'KRYSTAL@x.com', phone: '' }], ops_settings: { coverage_alert_admins: ['krystal@x.com', 'boss@x.com'] } }
const q = (t) => { const st = {}; const b = { select() { return b }, eq(c, v) { st[c] = v; return b }, maybeSingle: async () => ({ data: t === 'app_data' ? { data: APP[st.key] } : null, error: null }),
  then(ok) { return Promise.resolve({ data: T[t] ?? [], error: null }).then(ok) } }; return b }
globalThis.__db = { from: q }; globalThis.__owner = true
const DUP = { 'number=+14175550001': 'kP', 'email=krystal@x.com': 'kE', 'number=+14175550002': 'oo', 'email=ok@x.com': 'oo', 'number=+14175550003': 'nP', 'email=boss@x.com': 'bE' }
const BY = { kP: { id: 'kP', email: '' }, oo: { id: 'oo', email: 'ok@x.com' }, nP: { id: 'nP', email: '' } }; const calls = []
globalThis.fetch = async (url, o) => { url = String(url); calls.push(o?.method ?? 'GET')
  let m = url.match(/duplicate\?locationId=loc&(.+)$/); if (m) { const id = DUP[decodeURIComponent(m[1])]; return new Response(JSON.stringify(id ? { contact: { id } } : {}), { status: 200 }) }
  m = url.match(/\/contacts\/(\w+)$/); return new Response(JSON.stringify({ contact: BY[m?.[1]] ?? null }), { status: 200 }) }
let handler; globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 't', GHL_LOCATION_ID: 'loc' })[k] }, serve: (h) => { handler = h } }
const src = fs.readFileSync(`${FN}/staff-contacts-check/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db').replace(/^import \{ ownerCaller \} from .*$/m, 'const ownerCaller = async () => globalThis.__owner')
const tmp = path.join(process.cwd(), FN, 'staff-contacts-check', '_t.ts'); fs.writeFileSync(tmp, src); try { await import(tmp) } finally { fs.unlinkSync(tmp) }
const run = async () => { const r = await handler(new Request('https://x/f', { method: 'POST' })); return [r.status, await r.json()] }
globalThis.__owner = false; ck('refuses anyone but the owner key', (await run())[0] === 401); globalThis.__owner = true
const [s, j] = await run(); const R = (n) => j.results.find((x) => x.name === n)
ck('everyone on any alert list, once (Krystal on three lists is one person)', s === 200 && j.people === 4 && R('Krystal K').lists.length === 3, j)
ck('Krystal: phone and email on TWO contacts is called out, with both links', /TWO contacts/.test(R('Krystal K').problem) && /detail\/kP$/.test(R('Krystal K').phone_contact) && /detail\/kE$/.test(R('Krystal K').email_contact), R('Krystal K'))
ck('one contact with both: no problem', R('Ok Person').problem === '', R('Ok Person'))
ck('no email in the Hub is called out', /no email in the Hub/.test(R('Noemail Nan').problem), R('Noemail Nan'))
ck('read only: every GoHighLevel call is a GET', calls.every((m) => m === 'GET'), calls)
let all = true; console.log('\n396 · STAFF CONTACTS · TEST\n' + '='.repeat(50)); for (const [n, g, note] of res) { all &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')) }
console.log(all ? `ALL ${res.length} CHECKS PASS` : 'FAILED')
