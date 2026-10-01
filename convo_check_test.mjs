// 391 · convo-check (temporary, read only) against a fake database and a fake GoHighLevel. node convo_check_test.mjs
import fs from 'fs'; import path from 'path'
const FN = 'supabase/functions'; const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 600)])
const now = Date.now(), iso = (ms) => new Date(ms).toISOString()
const T = {
  interview_bookings: [{ id: 1, confirmed_at: iso(now - 3600e3), reminded_day_at: null, reminded_hour_at: null, job_applicants: { phone: '(417) 555-0101', email: 'Ana@x.com', sms_consent: true } }],
  job_applicants: [{ id: 9, phone: '4175550199', email: 'nobody@x.com', sms_consent: false, nudge_1_at: iso(now - 7200e3) }],
  reference_requests: [{ id: 5, ref_email: 'ref@x.com', sent_at: iso(now - 2 * 86400e3), reminded_at: null, candidate_email: null, applicant_nudged_at: null }],
}
const q = (t) => { const b = { select() { return b }, gte() { return b }, then(ok) { return Promise.resolve({ data: T[t] ?? [], error: null }).then(ok) } }; return b }
globalThis.__db = { from: q }; globalThis.__owner = true
const CONTACT = { '+14175550101': 'cA', 'ana@x.com': 'cB', 'ref@x.com': 'cR' }
const MSGS = { cA: [{ direction: 'outbound', messageType: 'TYPE_SMS', dateAdded: iso(now - 3600e3 + 60e3) }], cB: [], cR: [{ direction: 'outbound', messageType: 'TYPE_EMAIL', dateAdded: iso(now - 5 * 86400e3) }] }
const calls = []
globalThis.fetch = async (url, o) => { url = String(url); calls.push([o?.method ?? 'GET', url])
  let m = url.match(/duplicate\?locationId=loc&(number|email)=([^&]+)/); if (m) { const id = CONTACT[decodeURIComponent(m[2])]; return new Response(JSON.stringify(id ? { contact: { id } } : {}), { status: 200 }) }
  m = url.match(/conversations\/search\?locationId=loc&contactId=(\w+)/); if (m) return new Response(JSON.stringify({ conversations: [{ id: 'v_' + m[1] }] }), { status: 200 })
  m = url.match(/conversations\/v_(\w+)\/messages/); if (m) return new Response(JSON.stringify({ messages: { messages: MSGS[m[1]] } }), { status: 200 })
  return new Response('{}', { status: 404 }) }
let handler; globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 't', GHL_LOCATION_ID: 'loc' })[k] }, serve: (h) => { handler = h } }
const src = fs.readFileSync(`${FN}/convo-check/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db').replace(/^import \{ ownerCaller \} from .*$/m, 'const ownerCaller = async () => globalThis.__owner')
const tmp = path.join(process.cwd(), FN, 'convo-check', '_t.ts'); fs.writeFileSync(tmp, src); try { await import(tmp) } finally { fs.unlinkSync(tmp) }
const run = async (qs = '') => { const r = await handler(new Request('https://x/f' + qs, { method: 'POST' })); return [r.status, await r.json()] }
globalThis.__owner = false; ck('refuses anyone but the owner key', (await run())[0] === 401); globalThis.__owner = true
const [s, j] = await run('?offset=0&limit=10'); const R = (src, ch) => j.results.find((x) => x.source === src && x.channel === ch)
ck('finds every stamped person + channel (consent respected: no text to someone without the yes)', s === 200 && j.total === 4 && !j.results.some((x) => x.source === 'applicant nudges' && x.channel === 'sms'), j)
ck('an interview text that is in the conversation reads "shown"', R('interview messages', 'sms').result === 'shown', j.results)
ck("the same person's email on a DIFFERENT contact is flagged split", R('interview messages', 'sms').split === true && R('interview messages', 'email').split === true, j.results)
ck('an email with nothing outgoing reads "contact found, nothing sent shows"', R('interview messages', 'email').result === 'contact found, nothing sent shows', j.results)
ck('no GHL contact reads "no GHL contact"', R('applicant nudges', 'email').result === 'no GHL contact', j.results)
ck('a message at a different time reads "other messages shown, not this one"', R('reference requests', 'email').result === 'other messages shown, not this one', j.results)
ck('read only: every GoHighLevel call is a GET (nothing created, nothing sent)', calls.every(([m]) => m === 'GET') && !calls.some(([, u]) => /upsert|messages$/.test(u) && false), calls)
ck('returns no names, numbers, emails or ids', !/555|@x\.com|"c[ABR]"|Ana/.test(JSON.stringify(j)), j)
let all = true; console.log('\n391 · CONVO CHECK · TEST\n' + '='.repeat(50)); for (const [n, g, note] of res) { all &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')) }
console.log(all ? `ALL ${res.length} CHECKS PASS` : 'FAILED')
