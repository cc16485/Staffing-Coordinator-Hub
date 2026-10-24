// late-read-probe (1111): owner only, calls the live reader once per sentence and situation, nothing else.
// node late_read_probe_test.mjs
import fs from 'fs'; import path from 'path'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1200)])
const CALLS = []
globalThis.fetch = async (url, o) => { url = String(url); CALLS.push({ url, method: (o && o.method) || 'GET' })
  if (url.includes('api.anthropic.com')) { const body = JSON.parse(o.body); const txt = body.messages[0].content
    const kind = /late|8:30/.test(txt) ? 'late' : /not sure/.test(txt) ? 'other' : 'cant_make_it'
    return new Response(JSON.stringify({ content: [{ text: JSON.stringify({ kind, eta: kind === 'late' ? '08:30' : '', sure: !/not sure/.test(txt), quote: '' }) }] }), { status: 200 }) }
  return new Response('{}', { status: 404 }) }
const ENV = { ANTHROPIC_API_KEY: 'k', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 's' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
/* the probe imports late-watch; give that import its stand-ins */
const lw = fs.readFileSync(path.join(FN, 'late-watch/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => ({})')
  .replace("from '../_shared/job-auth.ts'", "from '" + path.resolve(ROOT, 'test_stubs/job-auth-by-role.mjs') + "'")
  .replace(/from '\.\.\/_shared\/([\w.-]+\.(?:ts|js))'/g, (_, m) => "from '" + path.join(FN, '_shared', m) + "'")
fs.writeFileSync(path.join(FN, 'late-watch', '_lw_t.ts'), lw)
const src = fs.readFileSync(path.join(FN, 'late-read-probe/index.ts'), 'utf8').replace("'../late-watch/index.ts'", "'../late-watch/_lw_t.ts'")
const tmp = path.join(FN, 'late-read-probe', '_t.ts'); fs.writeFileSync(tmp, src)
let M
try { M = await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp); fs.unlinkSync(path.join(FN, 'late-watch', '_lw_t.ts')) }
const jwt = (role) => 'x.' + Buffer.from(JSON.stringify({ role })).toString('base64') + '.y'
const call = async (role, body) => { const r = await handler(new Request('https://x/', { method: 'POST', headers: { Authorization: 'Bearer ' + jwt(role) }, body: JSON.stringify(body) })); return [r.status, await r.json()] }
let [s, j] = await call('anon', { sentences: ['x'] })
ck('a public caller is refused, and the AI is never called', s === 403 && !CALLS.length)
;[s, j] = await call('service_role', { sentences: ["I can't make it today.", "I'll be 30 minutes late.", "I'm not sure I can make it."], shift: '08:00' })
ck('owner: each sentence read twice (before the shift and as a reply)', s === 200 && j.results.length === 3 && j.results.every((r) => r.before && r.reply) && j.results[0].before.sent_at === '7:30 AM' && j.results[0].reply.sent_at === '8:07 AM', j)
ck('the live reader\'s answers come back as they are (kind, sure, arrival time)', j.results[0].before.kind === 'cant_make_it' && j.results[1].reply.kind === 'late' && j.results[1].reply.eta === '8:30 AM' && j.results[2].before.kind === 'other' && j.results[2].before.sure === false, j.results)
ck('READ ONLY: the only calls are to the AI (6 reads), nothing else', CALLS.length === 6 && CALLS.every((c) => c.url.includes('api.anthropic.com')), CALLS.map((c) => c.url))
ck('the late-watch server was not started by loading its reader', typeof handler === 'function')
for (const [n, o, d] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n     ' + d))
console.log(`${res.filter((x) => x[1]).length}/${res.length}`)
