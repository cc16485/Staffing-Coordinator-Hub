// Desktop 286 installer (team_ask_install.py) against a fake Supabase: Management API, auth and the function.
// node team_ask_install_test.mjs
import fs from 'fs'; import path from 'path'; import crypto from 'crypto'; import { spawn, spawnSync } from 'child_process'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
const tmp = fs.mkdtempSync(path.join(process.cwd(), '_tai_'))
const TOKEN = 'sbp_' + 'a'.repeat(40), SVC = 'svc-' + 'b'.repeat(40), ANON = 'anon-' + 'c'.repeat(40), AT = 'user-session-' + 'd'.repeat(30)
const FILES = ['supabase/functions/team-ask/index.ts', 'supabase/functions/_shared/outreach.ts', 'supabase/functions/_shared/optout.ts',
  'supabase/functions/_shared/staff-auth.ts', 'supabase/functions/_shared/events.ts']
const SHAS = Object.fromEntries(FILES.map((f) => [f, crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')]))
const STATE = path.join(tmp, 'state.json'), LOG = path.join(tmp, 'log.txt')
fs.writeFileSync(path.join(tmp, 'srv.mjs'), `import http from 'http'; import fs from 'fs'
const [TOKEN, SVC, ANON, AT, STATE, LOG] = process.argv.slice(2)
http.createServer((q, s) => { let b=''; q.on('data', d => b += d); q.on('end', () => {
  const st = JSON.parse(fs.readFileSync(STATE, 'utf8')); const body = b ? JSON.parse(b) : {}
  fs.appendFileSync(LOG, q.method + ' ' + q.url + (body.query ? ' :: ' + body.query.slice(0, 60) : '') + '\\n')
  const send = (code, o) => { s.writeHead(code, {'Content-Type':'application/json'}); s.end(JSON.stringify(o)); fs.writeFileSync(STATE, JSON.stringify(st)) }
  if (q.url.startsWith('/v1/') && q.headers.authorization !== 'Bearer ' + TOKEN) return send(401, {})
  if (q.url.includes('/functions/schedule-push')) return send(200, { verify_jwt: st.vj })
  if (q.url.includes('/functions/team-ask') && q.url.startsWith('/v1/')) return st.deployed ? send(200, { verify_jwt: st.vj }) : send(404, {})
  if (q.url.endsWith('/api-keys')) return send(200, [{ name: 'anon', api_key: ANON }, { name: 'service_role', api_key: SVC }])
  if (q.url.endsWith('/database/query')) { const x = body.query
    if (x.startsWith('select') && x.includes('team_ask_live')) return send(200, [{ v: st.live }])
    if (x.startsWith('update public.app_data')) { if (!st.noUpdate) st.live = true; return send(200, []) }
    if (x.includes('jsonb_array_length')) return send(200, [{ n: st.plans.length }])
    if (x.includes("e->>'id' as id")) return send(200, st.plans.slice(0, 1).map(id => ({ id })))
    return send(400, { message: 'unexpected query' }) }
  if (q.url === '/auth/v1/admin/generate_link') return q.headers.authorization === 'Bearer ' + SVC ? send(200, { hashed_token: 'h' }) : send(401, {})
  if (q.url === '/auth/v1/verify') return send(200, st.noSession ? {} : { access_token: AT })
  if (q.url.startsWith('/auth/v1/logout')) { st.loggedOut = true; return send(204, {}) }
  if (q.url === '/functions/v1/team-ask') {
    if (q.method === 'OPTIONS') return send(200, {})
    if (q.headers.authorization !== 'Bearer ' + AT) return send(401, { error: 'Sign in first.' })
    if (!st.plans.includes(body.plan_id)) return send(404, { error: 'not found' })
    if (body.action === 'draft') return send(200, { live: st.live === true, template: 't', caregiver: { on_roster: false }, client: {} })
    if (st.live !== true) return send(409, { outcome: 'off' })
    st.sendsPastSwitch = (st.sendsPastSwitch || 0) + 1
    return send(409, { outcome: 'board_changed' }) }
  send(404, {}) }) }).listen(0, function () { console.log(this.address().port) })`)
const child = spawn('node', [path.join(tmp, 'srv.mjs'), TOKEN, SVC, ANON, AT, STATE, LOG])
try {
  const port = await new Promise((ok) => child.stdout.once('data', (d) => ok(String(d).trim()))); const B = 'http://127.0.0.1:' + port
  const setState = (o) => { fs.writeFileSync(STATE, JSON.stringify({ live: null, vj: true, deployed: false, plans: ['tb1'], ...o })); fs.writeFileSync(LOG, '') }
  const run = (env = {}) => { const rep = path.join(tmp, 'r.txt'); try { fs.unlinkSync(rep) } catch { /* */ }
    const p = spawnSync('python3', ['team_ask_install.py'], { encoding: 'utf8', env: { ...process.env, SB_REPORT: rep, SB_TOKEN: TOKEN, SB_SHAS: JSON.stringify(SHAS),
      SB_SKIP_FUNCTION: '1', SB_ROOT_HUB: process.cwd(), SB_API_BASE: B, SB_FN_BASE: B, SB_PROOF_EMAIL: 'samantha@mo-care.com', ...env } })
    return { code: p.status, rep: fs.existsSync(rep) ? fs.readFileSync(rep, 'utf8') : '', out: p.stdout + p.stderr, st: JSON.parse(fs.readFileSync(STATE, 'utf8')), log: fs.readFileSync(LOG, 'utf8') } }

  setState({ deployed: true }); let x = run()
  ck('a clean run finishes DONE and writes the report', x.code === 0 && x.rep.includes('RESULT: DONE'), x.rep || x.out)
  ck('the switch is proven OFF first (a send refused), then turned on', x.rep.includes('with the switch off, a send is refused') && x.st.live === true, x.rep)
  ck('switched on, the board check refuses a made-up shift (nothing could send)', x.rep.includes('refused before any text could go') && x.st.sendsPastSwitch === 1, x.rep)
  ck('no sign-in and the public key are both refused', x.rep.includes('no sign-in: refused (401)') && x.rep.includes('the public key alone: refused (401)'), x.rep)
  ck('the proof sign-in is signed out afterwards', x.st.loggedOut === true && x.rep.includes('signed out'), x.rep)
  ck('no token, key or session appears in the report', ![TOKEN, SVC, ANON, AT].some((v) => x.rep.includes(v) || x.out.includes(v)), x.rep)
  ck('the only database write is the one switch line', x.log.split('\n').filter((l) => / :: (update|insert|delete|create|drop|alter)/i.test(l)).length === 1, x.log)
  setState({ deployed: true }); x = run({ SB_SHAS: JSON.stringify({ ...SHAS, [FILES[0]]: 'f'.repeat(64) }) })
  ck('a changed source file: stops before deploying or switching anything', x.code === 3 && x.st.live === null && !x.log.includes('update public'), x)
  setState({ deployed: true, noSession: true }); x = run()
  ck('if the proof sign-in fails: reported, and the switch is NOT turned on', x.code === 9 && x.st.live === null && x.rep.includes('NOT switched on'), x.rep)
  setState({ deployed: true, vj: false }); x = run()
  ck('matches the schedule function when it has the platform check off', x.code === 0 && x.rep.includes('checks the platform sign-in: off'), x.rep)
  setState({ deployed: true, noUpdate: true }); x = run()
  ck('if the switch does not read back true: reported', x.code === 9 && x.rep.includes('the switch reads null'), x.rep)
  setState({ deployed: true, live: true }); x = run()
  ck('a rerun with the switch already on still finishes (the off-proof is skipped, not faked)', x.code === 0 && !x.rep.includes('with the switch off') && x.st.sendsPastSwitch === 1, x.rep)
  setState({ deployed: true, plans: [] }); x = run()
  ck('no plans on file yet: plan checks skipped and said so', x.code === 0 && x.rep.includes('no Team Builder plans yet'), x.rep)
  x = run({ SB_TOKEN: 'nope' }); ck('a wrong token: refused before anything runs', x.code === 1, x)
} finally { child.kill(); fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
