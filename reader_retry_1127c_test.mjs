// 1127c · THE RUNNING-LATE READER TRIES A BUSY AI AGAIN, AND SAYS WHY A READ FAILED (2026-10-26, after 1127b: 4 of 20
// readings came back with no answer, back to back, and nothing said why). A fake AI only.
// node reader_retry_1127c_test.mjs
import fs from 'fs'; import path from 'path'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
let PLAN = [], CALLS = 0, BODIES = [], HEADERS = []
const ok = { kind: 'late', eta: '16:30', sure: true, quote: "I'll be 30 minutes late", why: 'x' }
globalThis.fetch = async (url, o = {}) => {
  if (!String(url).includes('api.anthropic.com')) return new Response('{}', { status: 404 })
  CALLS++; BODIES.push(JSON.parse(o.body)); HEADERS.push(o.headers || {})
  const step = PLAN.shift() ?? 200
  if (step === 'throw') throw new Error('network down')
  if (step === 'nojson') return new Response(JSON.stringify({ content: [{ type: 'text', text: 'sorry' }], stop_reason: 'end_turn' }), { status: 200 })
  if (step === 'think') return new Response(JSON.stringify({ content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: JSON.stringify(ok) }], stop_reason: 'end_turn' }), { status: 200 })
  if (step === 'cut') return new Response(JSON.stringify({ content: [{ type: 'thinking', thinking: '' }], stop_reason: 'max_tokens' }), { status: 200 })
  if (step === 'refusal') return new Response(JSON.stringify({ content: [], stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'general_harms' } }), { status: 200 })
  if (step === 200) return new Response(JSON.stringify({ content: [{ text: JSON.stringify(ok) }] }), { status: 200 })
  return new Response(JSON.stringify({ error: { message: step === 400 ? 'temperature is not supported' : 'Overloaded' } }), { status: step, headers: step === 429 ? { 'retry-after': '0' } : {} })
}
const ENV = { ANTHROPIC_API_KEY: 'k', LATE_AI_RETRY_MS: '0', SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 's' }
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: () => {} }
const src = fs.readFileSync(path.join(FN, 'late-watch/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => ({})')
  .replace("from '../_shared/job-auth.ts'", "from '" + path.resolve(ROOT, 'test_stubs/job-auth-by-role.mjs') + "'")
  .replace(/from '\.\.\/_shared\/([\w.-]+\.(?:ts|js))'/g, (_, m) => "from '" + path.join(FN, '_shared', m) + "'")
const tmp = path.join(FN, 'late-watch', '_t1127c.ts'); fs.writeFileSync(tmp, src)
let LW; try { LW = await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
const start = Date.parse('2026-10-26T21:00:00Z'), say = [{ at: start - 30 * 60e3, body: "I'll be 30 minutes late" }]
const read = async (plan) => { PLAN = [...plan]; CALLS = 0; BODIES = []; HEADERS = []; return LW.readLate(start, say) }

let r = await read([529, 529, 200])
ck('overloaded twice, then an answer: it keeps trying and the reading comes back (3 tries)', !r.failed && r.kind === 'late' && r.tries === 3 && CALLS === 3, { r, CALLS })
r = await read([429, 200]); ck('"too many requests" once, then an answer (2 tries)', !r.failed && r.tries === 2 && CALLS === 2, r)
r = await read(['throw', 200]); ck('no connection once, then an answer', !r.failed && r.tries === 2, r)
r = await read([500, 200]); ck('a server error once, then an answer', !r.failed && r.tries === 2, r)
r = await read([529, 529, 529, 200]); ck('still overloaded after 3 tries: it stops (never more than 3) and says why', r.failed && CALLS === 3 && r.tries === 3 && /overloaded \(529\)/.test(r.error), { r, CALLS })
r = await read([400, 400]); ck('a request the API refuses twice (the 1127 temperature mistake): stops after the plain try, and says what the AI said', r.failed && CALLS === 2 && /refused the request \(400\): temperature is not supported/.test(r.error), { r, CALLS })
r = await read(['nojson', 'nojson', 'nojson']); ck('an answer with no reading in it: tried again (3 at most), then says so with how it stopped', r.failed && CALLS === 3 && /without a reading \(stop: end_turn; blocks: text\)/.test(r.error), { r, CALLS })
r = await read(['nojson', 200]); ck('...and a second try that reads it is used', !r.failed && r.tries === 2, r)
r = await read(['think']); ck('1127c: the model thought first (a thinking block before the answer): the answer is still read', !r.failed && r.kind === 'late' && r.tries === 1, r)
r = await read(['cut', 'cut', 'cut']); ck('cut off before its reading: says so', r.failed && /ran out of room/.test(r.error), r)
r = await read(['refusal']); ck('a safety decline: not retried here (the server-side fallback already tried), says which kind', r.failed && CALLS === 1 && /declined to read this \(general_harms\)/.test(r.error), { r, CALLS })
r = await read([400, 200]); ck('the API refuses the request (400): one plain request (no effort, no fallback) still reads it', !r.failed && r.tries === 2 && CALLS === 2 && BODIES[1] && !('fallbacks' in BODIES[1]) && !('output_config' in BODIES[1]) && !HEADERS[1]['anthropic-beta'], { r, b: BODIES[1] })
r = await read([200]); ck('the normal request asks for low effort and the server-side fallback, with its beta header', BODIES[0].output_config?.effort === 'low' && BODIES[0].fallbacks === 'default' && HEADERS[0]['anthropic-beta'] === 'server-side-fallback-2026-07-01' && BODIES[0].max_tokens >= 2000, { b: BODIES[0], h: HEADERS[0] })
r = await read([200]); ck('a normal read is one try, unchanged', !r.failed && r.tries === 1 && CALLS === 1 && r.eta != null, r)
ENV.ANTHROPIC_API_KEY = ''; r = await read([200]); ck('no AI key: says so, and the AI is never called', r.failed && CALLS === 0 && /no AI key/.test(r.error), r); ENV.ANTHROPIC_API_KEY = 'k'

ck('late-watch: each failed read\'s reason is in the run\'s answer and the last 10 are kept on its state', /aiErrors\.push\(\{ at: nowIso, why: String\(rd\.error/.test(src) && /ai_failed_why: aiErrors/.test(src)
  && /ai_errors: \[\.\.\.\(Array\.isArray\(state\.ai_errors\) \? state\.ai_errors : \[\]\), \.\.\.aiErrors\]\.slice\(-10\)/.test(src))
ck('the retry waits at most 5 seconds (the AI\'s retry-after, or a short pause)', /Math\.min\(5000,/.test(src) && LW.READ_TRIES === 3)
const probe = fs.readFileSync(path.join(FN, 'late-read-probe/index.ts'), 'utf8')
ck('the owner check shows why a read failed and how many tries it took', /error: r\.error \?\? null, tries: r\.tries \?\? null/.test(probe))
ck('still no temperature sent', !/temperature: *[0-9]/.test(src.slice(src.indexOf('export async function readLate'), src.indexOf('/* WHEN "CAN\'T MAKE IT"'))))
const words = src.slice(src.indexOf('/* A BUSY AI IS TRIED AGAIN'), src.indexOf('export async function readLate'))
ck('no em dashes in the new wording', !/—/.test(words))

for (const [n, o, d] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n     ' + d))
const pass = res.filter((x) => x[1]).length
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
