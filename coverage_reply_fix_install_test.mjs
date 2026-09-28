// Desktop 287 installer against a fake Supabase. node coverage_reply_fix_install_test.mjs
import fs from 'fs'; import path from 'path'; import crypto from 'crypto'; import { spawn, spawnSync } from 'child_process'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 600)])
const tmp = fs.mkdtempSync(path.join(process.cwd(), '_cri_')), TOKEN = 'sbp_' + 'a'.repeat(40), STATE = path.join(tmp, 's.json'), LOG = path.join(tmp, 'l.txt')
const SHA = crypto.createHash('sha256').update(fs.readFileSync('supabase/functions/coverage-reply/index.ts')).digest('hex')
fs.writeFileSync(path.join(tmp, 'srv.mjs'), `import http from 'http'; import fs from 'fs'
const [TOKEN, STATE, LOG] = process.argv.slice(2)
http.createServer((q, s) => { let b=''; q.on('data', d => b += d); q.on('end', () => { const st = JSON.parse(fs.readFileSync(STATE, 'utf8')); const body = b ? JSON.parse(b) : {}
  fs.appendFileSync(LOG, q.method + ' ' + q.url + (body.query ? ' :: ' + body.query.trim().slice(0, 12) : '') + '\\n')
  const send = (c, o) => { s.writeHead(c, {'Content-Type':'application/json'}); s.end(JSON.stringify(o)) }
  if (q.url.startsWith('/v1/') && q.headers.authorization !== 'Bearer ' + TOKEN) return send(401, {})
  if (q.url.endsWith('/functions/coverage-reply')) return st.noRead ? send(500, {}) : send(200, { verify_jwt: false })
  if (q.url.endsWith('/database/query')) return st.badSql ? send(400, { message: 'boom' }) : send(200, [{ auto_asks: 4, picked_asks: 7, picked_waiting: 5, picked_waiting_open: 2, auto_replied: 3, picked_replied: 0 }])
  if (q.url.startsWith('/functions/v1/coverage-reply')) return send(q.url.includes('token=wrong') ? 401 : 200, {})
  send(404, {}) }) }).listen(0, function () { console.log(this.address().port) })`)
const child = spawn('node', [path.join(tmp, 'srv.mjs'), TOKEN, STATE, LOG])
try {
  const B = 'http://127.0.0.1:' + await new Promise((ok) => child.stdout.once('data', (d) => ok(String(d).trim())))
  const run = (st = {}, env = {}) => { fs.writeFileSync(STATE, JSON.stringify(st)); fs.writeFileSync(LOG, ''); const rep = path.join(tmp, 'r.txt'); try { fs.unlinkSync(rep) } catch { /* */ }
    const p = spawnSync('python3', ['coverage_reply_fix_install.py'], { encoding: 'utf8', env: { ...process.env, SB_REPORT: rep, SB_TOKEN: TOKEN, SB_EXPECTED_SHA: SHA, SB_SKIP_FUNCTION: '1',
      SB_ROOT_HUB: process.cwd(), SB_API_BASE: B, SB_FN_BASE: B, ...env } })
    return { code: p.status, rep: fs.existsSync(rep) ? fs.readFileSync(rep, 'utf8') : '', log: fs.readFileSync(LOG, 'utf8') } }
  let x = run()
  ck('a clean run finishes DONE', x.code === 0 && x.rep.includes('RESULT: DONE'), x.rep)
  ck('reports the texted asks and the picked asks whose replies were never recorded', x.rep.includes('7 picked by a coordinator (0 with a reply recorded)') && x.rep.includes('never recorded): 5, of which 2'), x.rep)
  ck('keeps the platform sign-in check off exactly as before (GoHighLevel calls it)', x.rep.includes('--no-verify-jwt') && x.rep.includes('checks callers exactly as before'), x.rep)
  ck('a wrong token is refused live', x.rep.includes('a wrong token is still refused (401)'), x.rep)
  ck('the database is only read (no writes)', !/ :: (update|insert|delete|create|drop|alter)/i.test(x.log), x.log)
  x = run({}, { SB_EXPECTED_SHA: 'f'.repeat(64) }); ck('a changed source: stops, nothing deployed', x.code === 3 && !x.rep.includes('would deploy'), x.rep)
  x = run({ noRead: true }); ck('cannot read how it checks callers: stops before anything', x.code === 2, x.rep)
  x = run({ badSql: true }); ck('a database error still writes a report (crash handler)', x.code === 8 && x.rep.includes('stopped unexpectedly'), x.rep)
  x = run({}, { SB_TOKEN: 'nope' }); ck('a wrong token: refused before anything runs', x.code === 1 && x.log === '', x)
} finally { child.kill(); fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
