// Desktop 288 installer against a fake Supabase. node lead_digest_auth_install_test.mjs
import fs from 'fs'; import path from 'path'; import crypto from 'crypto'; import { spawn, spawnSync } from 'child_process'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 600)])
const tmp = fs.mkdtempSync(path.join(process.cwd(), '_ldi_')), TOKEN = 'sbp_' + 'a'.repeat(40), SVC = 'svc-' + 'b'.repeat(30), ANON = 'anon-' + 'c'.repeat(30), AT = 'sess-' + 'd'.repeat(30)
const FILES = ['supabase/functions/lead-digest/index.ts', 'supabase/functions/_shared/staff-auth.ts']
const SHAS = Object.fromEntries(FILES.map((f) => [f, crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')]))
const STATE = path.join(tmp, 's.json'), LOG = path.join(tmp, 'l.txt')
fs.writeFileSync(path.join(tmp, 'srv.mjs'), `import http from 'http'; import fs from 'fs'
const [TOKEN, SVC, ANON, AT, STATE, LOG] = process.argv.slice(2)
http.createServer((q, s) => { let b=''; q.on('data', d => b += d); q.on('end', () => { const st = JSON.parse(fs.readFileSync(STATE, 'utf8'))
  fs.appendFileSync(LOG, q.method + ' ' + q.url + '\\n'); const send = (c, o) => { s.writeHead(c, {'Content-Type':'application/json'}); s.end(JSON.stringify(o)); fs.writeFileSync(STATE, JSON.stringify(st)) }
  if (q.url.startsWith('/v1/') && q.headers.authorization !== 'Bearer ' + TOKEN) return send(401, {})
  if (q.url.endsWith('/functions/lead-digest')) { st.reads = (st.reads || 0) + 1; return send(200, { verify_jwt: true, version: st.reads === 1 ? 7 : (st.noBump ? 7 : 8) }) }
  if (q.url.endsWith('/api-keys')) return send(200, [{ name: 'anon', api_key: ANON }, { name: 'service_role', api_key: SVC }])
  if (q.url === '/auth/v1/admin/generate_link') return send(200, { hashed_token: 'h' })
  if (q.url === '/auth/v1/verify') return send(200, { access_token: AT })
  if (q.url.startsWith('/auth/v1/logout')) { st.out = true; return send(204, {}) }
  if (q.url.startsWith('/functions/v1/lead-digest')) { st.probes = (st.probes || 0) + 1; const a = q.headers.authorization || ''
    return send(a === 'Bearer ' + AT ? 403 : 401, {}) }
  send(404, {}) }) }).listen(0, function () { console.log(this.address().port) })`)
const child = spawn('node', [path.join(tmp, 'srv.mjs'), TOKEN, SVC, ANON, AT, STATE, LOG])
try {
  const B = 'http://127.0.0.1:' + await new Promise((ok) => child.stdout.once('data', (d) => ok(String(d).trim())))
  const run = (st = {}, env = {}) => { fs.writeFileSync(STATE, JSON.stringify(st)); fs.writeFileSync(LOG, ''); const rep = path.join(tmp, 'r.txt'); try { fs.unlinkSync(rep) } catch { /* */ }
    const p = spawnSync('python3', ['lead_digest_auth_install.py'], { encoding: 'utf8', env: { ...process.env, SB_REPORT: rep, SB_TOKEN: TOKEN, SB_SHAS: JSON.stringify(SHAS), SB_SKIP_FUNCTION: '1',
      SB_ROOT_HUB: process.cwd(), SB_API_BASE: B, SB_FN_BASE: B, SB_PROOF_EMAIL: 'samantha@mo-care.com', ...env } })
    return { code: p.status, rep: fs.existsSync(rep) ? fs.readFileSync(rep, 'utf8') : '', out: p.stdout + p.stderr, st: JSON.parse(fs.readFileSync(STATE, 'utf8')) } }
  let x = run()
  ck('a clean run finishes DONE with all three refusals', x.code === 0 && x.rep.includes('RESULT: DONE') && x.st.probes === 3, x.rep)
  ck('the new version is confirmed running before any probe', x.rep.includes('version 7 → 8'), x.rep)
  ck('the proof sign-in is signed out', x.st.out === true, x.st)
  ck('no token, key or session in the report', ![TOKEN, SVC, ANON, AT].some((v) => x.rep.includes(v) || x.out.includes(v)), x.rep)
  x = run({ noBump: true }); ck('if the new version cannot be confirmed: NO probe reaches the function (never test the old hole)', x.code === 9 && !x.st.probes, x.rep)
  x = run({}, { SB_SHAS: JSON.stringify({ ...SHAS, [FILES[0]]: 'f'.repeat(64) }) }); ck('a changed source: stops, nothing deployed or probed', x.code === 3 && !x.st.probes, x.rep)
  x = run({}, { SB_TOKEN: 'nope' }); ck('a wrong token: refused before anything runs', x.code === 1, x)
} finally { child.kill(); fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
