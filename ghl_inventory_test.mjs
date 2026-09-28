// ghl-inventory (read-only GoHighLevel workflow + tag list) and its Desktop 285 installer (2026-09-27).
// Part A: the REAL function with a fake GoHighLevel. Part B: the REAL installer against a fake Management API.
// node ghl_inventory_test.mjs
import fs from 'fs'; import path from 'path'; import crypto from 'crypto'; import { spawnSync } from 'child_process'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 600)])
const SVC = 'service-key-' + 'z'.repeat(40)
const jwt = (role) => 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.sig'
let CALLS, MODE
globalThis.fetch = async (url, o) => {
  url = String(url); CALLS.push({ url, method: (o && o.method) || 'GET' })
  if (MODE === 'down') throw new Error('unreachable')
  if (url.includes('/workflows/')) return MODE === 'noscope' ? new Response('{}', { status: 401 })
    : new Response(JSON.stringify({ workflows: [{ id: 'w1', name: 'New Lead Nurture', status: 'published', updatedAt: '2026-08-01T10:00:00Z', locationId: 'loc' },
                                                 { id: 'w2', name: 'Old Test', status: 'draft', updatedAt: '2025-01-02T00:00:00Z' }] }), { status: 200 })
  if (url.includes('/tags')) return new Response(JSON.stringify({ tags: [{ name: 'Lead' }, { name: 'coverage-asked' }, { name: 'something else' }] }), { status: 200 })
  return new Response('{}', { status: 404 })
}
const ENV = { SUPABASE_SERVICE_ROLE_KEY: SVC, GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const tmp = fs.mkdtempSync(path.join(process.cwd(), '_ginv_'))
try {
  const f = path.join(tmp, 'ghl-inventory.ts'); fs.copyFileSync('supabase/functions/ghl-inventory/index.ts', f); await import(f)
  const call = async (auth) => { const r = await handler(new Request('https://x/functions/v1/ghl-inventory', { method: 'POST', headers: auth ? { Authorization: 'Bearer ' + auth } : {}, body: '{}' })); return { status: r.status, j: await r.json() } }
  for (const [name, auth] of [['no sign-in', null], ['the public key', jwt('anon')], ['a staff sign-in', jwt('authenticated')], ['a made-up key', 'nope']]) {
    CALLS = []; MODE = 'ok'; const r = await call(auth)
    ck(`A · ${name}: refused (401) before GoHighLevel is asked anything`, r.status === 401 && CALLS.length === 0, { r, CALLS })
  }
  CALLS = []; MODE = 'ok'; let r = await call(SVC)
  ck('A · the exact service key: answers', r.status === 200 && r.j.ok === true, r)
  ck('A · lists workflows as name, status, date only', JSON.stringify(r.j.workflows) === JSON.stringify([{ name: 'New Lead Nurture', status: 'published', updated: '2026-08-01' }, { name: 'Old Test', status: 'draft', updated: '2025-01-02' }]), r.j.workflows)
  ck('A · tags matched without caring about capitals ("Lead" counts as lead)', r.j.tags.find((t) => t.tag === 'lead').exists === true && r.j.tags.find((t) => t.tag === 'coverage-asked').exists && !r.j.tags.find((t) => t.tag === 'confirm-asked').exists, r.j.tags)
  ck('A · only our tags are named back (the other tag is only counted)', !JSON.stringify(r.j).includes('something else') && r.j.tag_count === 3, r.j)
  ck('A · only two reads, both GET, never a contact or conversation', CALLS.length === 2 && CALLS.every((c) => c.method === 'GET' && !/contacts|conversations/.test(c.url)), CALLS)
  CALLS = []; r = await call(jwt('service_role')); ck('A · a platform-verified service sign-in: answers', r.status === 200, r)
  MODE = 'noscope'; r = await call(SVC); ck('A · GoHighLevel refuses workflows: says so, tags still listed', r.j.workflows?.error?.includes('may not be allowed') && Array.isArray(r.j.tags), r.j)
  MODE = 'down'; r = await call(SVC); ck('A · GoHighLevel unreachable: says so, no crash', r.status === 200 && r.j.workflows.error && r.j.tags.error, r.j)
  ENV.GHL_TOKEN = ''; ENV.GHL_API_KEY = 'legacy'; MODE = 'ok'; r = await call(SVC); ck('A · works with the older GHL_API_KEY secret too', r.status === 200 && Array.isArray(r.j.workflows), r.j)

  // Part B: the installer, against a fake Management API + fake function
  const SHA = crypto.createHash('sha256').update(fs.readFileSync('supabase/functions/ghl-inventory/index.ts')).digest('hex')
  const TOKEN = 'sbp_' + 'a'.repeat(40)
  const run = (env = {}) => { const rep = path.join(tmp, 'r.txt'); try { fs.unlinkSync(rep) } catch { /* */ }
    const p = spawnSync('python3', ['ghl_inventory_run.py'], { env: { ...process.env, SB_REPORT: rep, SB_TOKEN: TOKEN, SB_EXPECTED_SHA: SHA, SB_SKIP_FUNCTION: '1', SB_ROOT_HUB: process.cwd(), ...env }, encoding: 'utf8' })
    return { code: p.status, rep: fs.existsSync(rep) ? fs.readFileSync(rep, 'utf8') : '', out: p.stdout + p.stderr } }
  const good = [200, { ok: true, workflows: [{ name: 'New Lead Nurture', status: 'published', updated: '2026-08-01' }, { name: 'Old Test', status: 'draft', updated: '2025-01-02' }], tags: [{ tag: 'lead', exists: true }, { tag: 'confirm-asked', exists: false }], tag_count: 3 }]
  const serverJs = path.join(tmp, 'srv.mjs')
  fs.writeFileSync(serverJs, `import http from 'http'; import fs from 'fs'
const [TOKEN, SVC, LOG, STATE] = process.argv.slice(2)
const srv = http.createServer((q, s) => { let b=''; q.on('data', d => b += d); q.on('end', () => {
  fs.appendFileSync(LOG, q.method + ' ' + q.url + '\\n'); const st = JSON.parse(fs.readFileSync(STATE, 'utf8'))
  const send = (code, o) => { s.writeHead(code, {'Content-Type':'application/json'}); s.end(JSON.stringify(o)) }
  if (q.url.startsWith('/v1/') && q.headers.authorization !== 'Bearer ' + TOKEN) return send(401, {})
  if (q.url.endsWith('/api-keys')) return send(200, [{name:'anon', api_key:'anon-k'}, {name:'service_role', api_key:SVC}])
  if (q.url.endsWith('/secrets')) return send(200, st.secrets[q.url.split('/')[3]] || [])
  if (q.url === '/functions/v1/ghl-inventory') return q.headers.authorization === 'Bearer ' + SVC ? send(...st.fn) : send(401, {error:'server only'})
  send(404, {}) }) })
srv.listen(0, () => console.log(srv.address().port))`)
  const LOG = path.join(tmp, 'log.txt'), STATE = path.join(tmp, 'state.json')
  const { spawn } = await import('child_process')
  const child = spawn('node', [serverJs, TOKEN, SVC, LOG, STATE])
  const port = await new Promise((ok) => child.stdout.once('data', (d) => ok(String(d).trim())))
  const B = 'http://127.0.0.1:' + port
  const setState = (fn, sec) => { fs.writeFileSync(STATE, JSON.stringify({ fn, secrets: sec })); fs.writeFileSync(LOG, '') }
  const inst = (env = {}) => run({ SB_API_BASE: B, SB_FN_BASE: B, ...env })
  const same = { zngsgedlsxinbygwmxwn: [{ name: 'GHL_LOCATION_ID', value: 'fp1' }], rdqujxiycycwhskyvrwa: [{ name: 'GHL_LOCATION_ID', value: 'fp1' }] }
  setState(good, same); let x = inst()
  ck('B · finishes and writes the report', x.code === 0 && x.rep.includes('1 live, 1 draft or off'), x)
  ck('B · live workflows listed first, marked LIVE', /● LIVE\s+New Lead Nurture/.test(x.rep) && /○ DRAFT\s+Old Test/.test(x.rep), x.rep)
  ck('B · tags shown as exists / not there', x.rep.includes('✓ exists   lead') && x.rep.includes('· not there  confirm-asked'), x.rep)
  ck('B · same GoHighLevel account detected by fingerprint', x.rep.includes('the SAME account'), x.rep)
  ck('B · no key, token or fingerprint in the report', !x.rep.includes(SVC) && !x.rep.includes(TOKEN) && !x.rep.includes('fp1') && !x.out.includes(SVC), x.rep)
  const log = fs.readFileSync(LOG, 'utf8').trim().split('\n')
  ck('B · the only non-GET call is the read-only function itself (no secret or setting written)', log.every((l) => l.startsWith('GET ') || l === 'POST /functions/v1/ghl-inventory'), log)
  setState(good, { zngsgedlsxinbygwmxwn: [{ name: 'GHL_LOCATION_ID', value: 'fp1' }], rdqujxiycycwhskyvrwa: [{ name: 'GHL_LOCATION_ID', value: 'fp2' }] })
  x = inst(); ck('B · different accounts detected', x.rep.includes('different accounts'), x.rep)
  setState([200, { ok: true, workflows: { error: 'GoHighLevel answered 401 (this key may not be allowed to read workflows)' }, tags: [], tag_count: 0 }], same)
  x = inst(); ck('B · workflow permission missing: said plainly, report still written', x.code === 0 && x.rep.includes('could not list them') && x.rep.includes('may not be allowed'), x.rep)
  setState([500, { error: 'GHL not configured' }], same); x = inst(); ck('B · function error: stops with a report', x.code === 4 && x.rep.includes('did not answer'), x)
  setState(good, same); x = inst({ SB_EXPECTED_SHA: 'f'.repeat(64) }); ck('B · a changed function is refused before anything runs', x.code === 2 && fs.readFileSync(LOG, 'utf8') === '', x)
  x = inst({ SB_TOKEN: 'nope' }); ck('B · a wrong token is refused before anything runs', x.code === 1 && fs.readFileSync(LOG, 'utf8') === '', x)
  setState([200, { ok: true, workflows: [{ status: 'published' }], tags: 'garbage', tag_count: 1 }], same)
  x = inst(); ck('B · an unexpected answer shape still writes a report (crash handler)', x.rep.length > 0 && x.code !== 0 ? x.rep.includes('stopped unexpectedly') : x.rep.length > 0, x)
  child.kill()
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
