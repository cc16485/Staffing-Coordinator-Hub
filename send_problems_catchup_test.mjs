// 384 · the one-time catch-up turns held-back sends into Needs Attention cards. node send_problems_catchup_test.mjs
import fs from 'fs'; import path from 'path'
const FN = 'supabase/functions'; const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 600)])
const REF = [
  { sender: 'interview-messages', channel: 'sms', address: '+14175550101', reasons: ['could not check GHL Do Not Disturb'], at: '2026-09-25T15:00:00Z' },
  { sender: 'interview-messages', channel: 'sms', address: '+14175550101', reasons: ['could not check GHL Do Not Disturb'], at: '2026-09-26T15:00:00Z' },
  { sender: 'reference-chase', channel: 'email', address: 'pat@x.com', reasons: ['could not check GHL Do Not Disturb'], at: '2026-09-27T15:00:00Z' },
  { sender: 'send-invite', channel: 'email', address: 'c@y.com', reasons: ['GHL Do Not Disturb is on for email'], at: '2026-09-28T15:00:00Z' },
]
let OPS = []
const tbl = { contact_send_refusal: REF, job_applicants: [{ first_name: 'Ana', last_name: 'Bee', phone: '(417) 555-0101', email: '' }],
  reference_requests: [{ ref_name: 'Pat Ref', ref_email: 'PAT@x.com', candidate_name: 'Ana Bee' }], domains: [], persons: [] }
const q = (t) => { const b = { select() { return b }, eq() { return b }, gte() { return b }, order() { return b }, in() { return b },
  maybeSingle: async () => t === 'app_data' ? { data: { data: OPS }, error: null } : { data: null, error: null },
  then(ok) { return Promise.resolve({ data: tbl[t] ?? [], error: null }).then(ok) } }; return b }
globalThis.__db = { from: q, rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') { const i = OPS.findIndex((x) => x.id === a.item.id); if (i >= 0) OPS[i] = a.item; else OPS.push(a.item) } return { data: null, error: null } } }
let handler; let OWNER = true
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k' })[k] }, serve: (h) => { handler = h } }
const src = fs.readFileSync(`${FN}/send-problems-catchup/index.ts`, 'utf8')
  .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace(/^import \{ ownerCaller \} from .*$/m, 'const ownerCaller = async () => globalThis.__owner')
const tmp = path.join(process.cwd(), FN, 'send-problems-catchup', '_t.ts'); fs.writeFileSync(tmp, src)
try { await import(tmp) } finally { fs.unlinkSync(tmp) }
const run = async (qs = '') => { const r = await handler(new Request('https://x/f' + qs, { method: 'POST' })); return [r.status, await r.json()] }
globalThis.__owner = false; let [st] = await run(); ck('refuses anyone but the owner key', st === 401)
globalThis.__owner = true; let [s2, j] = await run('?dry=1'); ck('dry: counts only, no cards', s2 === 200 && j.refusals === 4 && j.cards === 3 && j.named === 2 && OPS.length === 0, j)
;[s2, j] = await run()
const im = OPS.find((x) => x.sender === 'interview-messages'), rc = OPS.find((x) => x.sender === 'reference-chase'), si = OPS.find((x) => x.sender === 'send-invite')
ck('one card per person + message, named where the Hub knows them', OPS.length === 3 && /to Ana Bee$/.test(im.title) && im.count === 2 && /to Pat Ref \(reference for Ana Bee\)/.test(rc.title), OPS.map((x) => x.title))
ck('mix-up cards say so and what to check; a real Do Not Disturb card does not', /Hub mix-up \(fixed Oct 1\)/.test(im.detail) && !/mix-up/.test(si.detail) && si.problem === 'dnd', [im.detail, si.detail])
;[s2, j] = await run(); ck('running it twice adds no cards (same card, counted)', OPS.length === 3 && OPS.find((x) => x.sender === 'interview-messages').count === 4, OPS.map((x) => x.count))
let all = true; console.log('\n384 · CATCH-UP · TEST\n' + '='.repeat(50)); for (const [n, g, note] of res) { all &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')) }
console.log(all ? `ALL ${res.length} CHECKS PASS` : 'FAILED')
