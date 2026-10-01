// Hub half of "fix the training platform texts" (2026-10-01): outreach-check answers report + text_ok. node training_texts_hub_test.mjs
import fs from 'fs'; import path from 'path'
const FN = 'supabase/functions'; const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 600)])
let CARDS = [], APPS = []
const q = (t) => { const st = { f: [] }; const b = { select() { return b }, eq() { return b }, ilike(c, v) { st.like = v; return b }, order() { return b }, limit() { return b },
  maybeSingle: async () => ({ data: t === 'app_data' ? { data: [] } : null, error: null }),
  then(ok) { const rows = t === 'job_applicants' ? APPS.filter((r) => String(r.phone).endsWith(String(st.like || '').replace(/%/g, '').slice(-4)) || true) : []; return Promise.resolve({ data: rows, error: null }).then(ok) } }; return b }
globalThis.__db = { from: q, rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') CARDS.push(a.item); return { data: null, error: null } } }
let handler; globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'k', OUTREACH_SECRET: 's'.repeat(40), GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc' })[k] }, serve: (h) => { handler = h } }
const src = fs.readFileSync(`${FN}/outreach-check/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
const tmp = path.join(process.cwd(), FN, 'outreach-check', '_t.ts'); fs.writeFileSync(tmp, src); try { await import(tmp) } finally { fs.unlinkSync(tmp) }
const post = async (body, secret = 's'.repeat(40)) => { const r = await handler(new Request('https://x/f', { method: 'POST', headers: { 'x-outreach-secret': secret }, body: JSON.stringify(body) })); return [r.status, await r.json()] }
let [s, j] = await post({ report: true, sender: 'send-invite', channel: 'sms', phone: '4175550101', who: 'Dana Doe', why: 'error 422: bad number' }, 'wrong')
ck('a report without the server secret is refused, no card', s === 401 && !CARDS.length, j)
;[s, j] = await post({ report: true, sender: 'send-invite', channel: 'sms', phone: '4175550101', who: 'Dana Doe', why: 'error 422: bad number' })
ck('a Training failure raises a "Didn\'t go through" card, named, in office words', s === 200 && j.reported && CARDS.length === 1 && CARDS[0].kind === 'send_problem' && /Text didn't go through: orientation \/ training invite to Dana Doe/.test(CARDS[0].title) && /error 422/.test(CARDS[0].detail), CARDS)
CARDS = []; ;[s, j] = await post({ report: true, sender: 'notify-cleared', channel: 'sms', phone: '4175550102', who: 'Ana', why: 'error 500' })
ck('the "cleared to work" text has its own words', /"cleared to work" text/.test(CARDS[0]?.title), CARDS)
APPS = [{ phone: '(417) 555-0101', sms_consent: false, created_at: '2026-09-30' }, { phone: '417-555-0101', sms_consent: true, created_at: '2026-08-01' }]
;[s, j] = await post({ text_ok: true, phone: '4175550101' }); ck("text_ok: the LATEST application said no to texts: false, with the reason", j.text_ok === false && /did not agree/.test(j.why), j)
APPS = [{ phone: '4175550101', sms_consent: true, created_at: '2026-09-30' }]; ;[s, j] = await post({ text_ok: true, phone: '(417) 555-0101' }); ck('text_ok: said yes: true', j.text_ok === true, j)
APPS = []; ;[s, j] = await post({ text_ok: true, phone: '4175550199' }); ck('text_ok: no application on file (an existing employee): true', j.text_ok === true, j)
;[s, j] = await post({ text_ok: true, phone: '12' }); ck('text_ok: unusable number: false', j.text_ok === false, j)
let all = true; console.log('\nTRAINING TEXTS · HUB · TEST\n' + '='.repeat(50)); for (const [n, g, note] of res) { all &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')) }
console.log(all ? `ALL ${res.length} CHECKS PASS` : 'FAILED')
