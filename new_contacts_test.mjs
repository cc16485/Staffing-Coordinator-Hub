// 397 · new-contacts-check (temporary, read only) against a fake database and a fake GoHighLevel. node new_contacts_test.mjs
import fs from 'fs'; import path from 'path'
const FN = 'supabase/functions'; const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 600)])
const T = { job_applicants: [{ first_name: 'Ana', last_name: 'Bee', phone: '(417) 555-0101', email: 'Ana@x.com' }, { first_name: 'Cal', last_name: 'Dee', phone: '4175550102', email: 'cal@x.com' },
  { first_name: 'No', last_name: 'Email', phone: '4175550103', email: '' }] }
const q = (t) => { const b = { select() { return b }, gte() { return b }, then(ok) { return Promise.resolve({ data: T[t] ?? [], error: null }).then(ok) } }; return b }
globalThis.__db = { from: q }; globalThis.__owner = true
const C = { '+14175550101': 'p1', 'ana@x.com': 'e1', '+14175550102': 'same', 'cal@x.com': 'same' }; const calls = []
globalThis.fetch = async (url, o) => { url = String(url); calls.push(o?.method ?? 'GET')
  const m = url.match(/duplicate\?locationId=loc&(number|email)=([^&]+)/); const id = m && C[decodeURIComponent(m[2])]
  return new Response(JSON.stringify(id ? { contact: { id } } : {}), { status: 200 }) }
let handler; globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 't', GHL_LOCATION_ID: 'loc' })[k] }, serve: (h) => { handler = h } }
const src = fs.readFileSync(`${FN}/new-contacts-check/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db').replace(/^import \{ ownerCaller \} from .*$/m, 'const ownerCaller = async () => globalThis.__owner')
const tmp = path.join(process.cwd(), FN, 'new-contacts-check', '_t.ts'); fs.writeFileSync(tmp, src); try { await import(tmp) } finally { fs.unlinkSync(tmp) }
const run = async (qs = '') => { const r = await handler(new Request('https://x/f' + qs, { method: 'POST' })); return [r.status, await r.json()] }
globalThis.__owner = false; ck('refuses anyone but the owner key', (await run())[0] === 401); globalThis.__owner = true
const [s, j] = await run('?offset=0&limit=15'); const R = (n) => j.results.find((x) => x.name === n)
ck('every new applicant with both a phone and an email is checked', s === 200 && j.total === 2 && j.checked === 2, j)
ck('a split person reads TWO contacts, with both links', R('Ana Bee').result === 'TWO contacts' && /detail\/p1$/.test(R('Ana Bee').texts_contact), j)
ck('phone and email on the same contact reads one contact', R('Cal Dee').result === 'one contact' && !R('Cal Dee').texts_contact, j)
ck('read only: every GoHighLevel call is a GET', calls.every((m) => m === 'GET'), calls)
let all = true; console.log('\n397 · NEW APPLICANT CONTACTS · TEST\n' + '='.repeat(50)); for (const [n, g, note] of res) { all &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')) }
console.log(all ? `ALL ${res.length} CHECKS PASS` : 'FAILED')
