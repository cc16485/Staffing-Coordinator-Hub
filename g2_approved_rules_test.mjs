// G2 · approved rules only: the five jobs that run a rules file from cc.mo-care.com run it only when its SHA-256
// fingerprint is in rules_approved. Real functions and the REAL rules files (cc-hub-live), a fake database, and a
// poisoned file that would set a marker if it ever ran. node g2_approved_rules_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const FN = 'supabase/functions';
/* The clock the functions see: outreach hours read hour + weekday; the morning brief reads a Chicago date-time. */
const CLOCK = { hour: '10', wd: 'Tue', sv: '2026-10-06 07:30:00' }
const realTLS = Date.prototype.toLocaleString;
Date.prototype.toLocaleString = function (loc, o) {
  if (o && o.hour === '2-digit' && !o.minute) return CLOCK.hour; if (o && o.weekday === 'short' && !o.hour) return CLOCK.wd
  if (loc === 'sv-SE' && o && o.timeZone && Object.keys(o).length === 1) return CLOCK.sv
  return realTLS.call(this, loc, o); };
let T, APP, SENT
const reset = () => {
  APP = {}; SENT = []
  T = { contact_optout_current: [], circle_contacts: [], phone_index: [], applicant_alerts: [], nurse_staff: [], coordinator_staff: [],
    auth_identities: [{ auth_user_id: 'u-owner', person_id: 'p-owner', project_ref: 'zngsgedlsxinbygwmxwn' },
                      { auth_user_id: 'u-norole', person_id: 'p-norole', project_ref: 'zngsgedlsxinbygwmxwn' }],
    persons: [{ person_id: 'p-owner', active: true, full_name: 'Olive Owner' }, { person_id: 'p-norole', active: true, full_name: 'Nora Norole' }],
    entity_memberships: [{ person_id: 'p-owner', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p-norole', entity: 'cc_ihs', active: true, ended_at: null }],
    staff_roles: [{ person_id: 'p-owner', entity: 'cc_ihs', role: 'owner_admin' }] }
}
const q = (t) => { const st = { f: [], nn: null, inF: null }; const b = {
  select() { return b; }, order() { return b; }, limit() { return b; }, contains() { return b; }, range() { return b; }, or() { return b; }, is() { return b; },
  gte() { return b; }, ilike() { return b; }, lte() { return b; }, lt() { return b; }, gt() { return b; }, neq() { return b; },
  eq(c, v) { st.f.push([c, v]); return b; }, in(c, v) { st.inF = [c, v]; return b; }, not(c) { st.nn = c; return b; },
  update() { return { eq: () => Promise.resolve({ data: null, error: null }) }; },
  upsert(row) { return Promise.resolve({ data: row, error: null }); },
  insert(row) { (T[t] ||= []).push(row); return Promise.resolve({ data: row, error: null }); },
  maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: x.error })); },
  single() { return b.maybeSingle(); },
  then(ok) {
    if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]; return Promise.resolve({ data: k in APP ? [{ key: k, data: APP[k] }] : [], error: null }).then(ok); }
    let rows = T[t] ?? []; for (const [c, v] of st.f) rows = rows.filter((r) => r[c] === v)
    if (st.inF) rows = rows.filter((r) => st.inF[1].includes(r[st.inF[0]])); if (st.nn) rows = rows.filter((r) => r[st.nn] != null)
    return Promise.resolve({ data: rows, error: null }).then(ok);
  } }; return b; };
const USERS = { 'jwt-owner': { id: 'u-owner', email: 'owner@mo-care.com', app_metadata: {} }, 'jwt-norole': { id: 'u-norole', email: 'norole@mo-care.com', app_metadata: {} } }
globalThis.__db = { from: q,
  rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => x.id === a.item.id); if (i >= 0) arr[i] = a.item; else arr.push(a.item) } return { data: [], error: null } },
  storage: { from: () => ({ list: async () => ({ data: [], error: null }), remove: async () => ({ data: [], error: null }) }) },
  auth: { getUser: async (jwt) => USERS[jwt] ? { data: { user: USERS[jwt] }, error: null } : { data: { user: null }, error: { message: 'bad' } } } };
globalThis.fetch = async (url, o) => {
  url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + (body.phone || body.email), dnd: false } }), { status: 200 })
  if (url.includes('/conversations/messages')) { SENT.push({ to: body.contactId, type: body.type }); return new Response('{}', { status: 200 }) }
  if (url.includes('api.resend.com')) { SENT.push({ to: body.to?.[0], type: 'resend' }); return new Response('{"id":"x"}', { status: 200 }) }
  if (url.includes('axiscare')) return new Response(JSON.stringify({ results: [], nextPage: null }), { status: 200 })
  return new Response('{}', { status: 200 })
}
const SVC = 'svc_' + 'k'.repeat(60), JOBSEC = 'j'.repeat(64)
const ENV = { HUB_JOB_SECRET: JOBSEC, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SVC, GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc',
  AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485', RESEND_API_KEY: 'r' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } }
globalThis.__dbFor = (key) => ({ from: (t) => { const b = { select() { return b; }, limit() { return Promise.resolve(t === 'identity_door_audit' && key !== SVC ? { data: null, error: { message: 'permission denied' } } : { data: [], error: null }); } }; return b; } })
{ const ja = fs.readFileSync(`${FN}/_shared/job-auth.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = (u, key) => globalThis.__dbFor(key)')
  fs.writeFileSync(`${FN}/_shared/_job-auth_t.ts`, ja) }
process.on('exit', () => { try { fs.unlinkSync(`${FN}/_shared/_job-auth_t.ts`) } catch { /* */ } })
const load = async (name) => { const src = fs.readFileSync(`${FN}/${name}/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/(['"])\.\.\/_shared\/job-auth\.ts\1/, "'../_shared/_job-auth_t.ts'")
  const tmp = path.join(process.cwd(), FN, name, '_t.ts'); fs.writeFileSync(tmp, src); try { await import(tmp + '?' + Math.random()); } finally { fs.unlinkSync(tmp); } return handler; };
const call = async (h, url, headers = {}, body = {}, method = 'POST') => {
  const r = await h(new Request(url, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) }))
  let j = null; try { j = await r.json() } catch { /* */ } return { s: r.status, j } }
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const ANON = 'eyJ' + 'a'.repeat(120)
const FORGED = b64({ alg: 'HS256', typ: 'JWT' }) + '.' + b64({ role: 'service_role', iss: 'supabase' }) + '.' + 'x'.repeat(43)
const H = { none: {}, anon: { Authorization: 'Bearer ' + ANON, apikey: ANON }, wrong: { Authorization: 'Bearer ' + ANON, 'x-cron-secret': 'x'.repeat(64) },
  forged: { Authorization: 'Bearer ' + FORGED, apikey: ANON }, staff: { Authorization: 'Bearer jwt-owner' }, norole: { Authorization: 'Bearer jwt-norole' },
  cron: { Authorization: 'Bearer ' + ANON, 'x-cron-secret': JOBSEC }, owner: { Authorization: 'Bearer ' + SVC } }

import crypto from 'crypto'
const HUB = '../cc-hub-live/'
const REAL = Object.fromEntries(['client-start.js', 'promise-engine.js', 'launch-evidence.js', 'obligations.js', 'eligibility-rules.js'].map((f) => [f, fs.readFileSync(HUB + f)]))
const fp = (b) => crypto.createHash('sha256').update(b).digest('hex')
let SERVED = {}, DOWN = new Set(), SITE_HITS = []
const baseFetch = globalThis.fetch
globalThis.fetch = async (u, o) => { u = String(u)
  const m = u.match(/^https:\/\/cc\.mo-care\.com\/([a-z0-9-]+\.js)/)
  if (m) { SITE_HITS.push(m[1]); if (DOWN.has(m[1])) return new Response('nope', { status: 503 }); return new Response(SERVED[m[1]] ?? '', { status: SERVED[m[1]] ? 200 : 404 }) }
  if (/evil\.example/.test(u)) { SITE_HITS.push('EVIL'); return new Response('globalThis.__PWNED = true', { status: 200 }) }
  return baseFetch(u, o) }
const POISON = (f) => Buffer.concat([REAL[f], Buffer.from('\n;globalThis.__PWNED = true\n')])
const approve = (pairs) => { T.rules_approved = pairs.map(([file, b]) => ({ file, sha256: fp(b) })) }
const JOBS = { 'client-start-run': ['client-start.js'], 'promise-run': ['promise-engine.js'], 'launch-evidence': ['launch-evidence.js'],
               'obligations-run': ['obligations.js', 'eligibility-rules.js'], 'eligibility-sweep': ['eligibility-rules.js'] }
const BODY = { 'launch-evidence': { action: 'run' } }
ENV.CLIENT_START_ENGINE_URL = 'https://evil.example/client-start.js'

/* ── 1 · the helper itself ── */
{ const src = fs.readFileSync(`${FN}/_shared/approved-rules.ts`, 'utf8')
  const tmp = path.join(process.cwd(), FN, '_shared', '_ar_t.ts'); fs.writeFileSync(tmp, src); const A = await import(tmp + '?' + Math.random()); fs.unlinkSync(tmp)
  reset(); SERVED = { 'promise-engine.js': REAL['promise-engine.js'] }; approve([['promise-engine.js', REAL['promise-engine.js']]])
  let g = await A.approvedRules(globalThis.__db, 'promise-engine.js')
  ck('G2 helper: the approved version comes back, byte for byte', g.ok && g.src === REAL['promise-engine.js'].toString('utf8') && g.fingerprint === fp(REAL['promise-engine.js']), g.error)
  SERVED['promise-engine.js'] = POISON('promise-engine.js'); g = await A.approvedRules(globalThis.__db, 'promise-engine.js')
  ck('G2 helper: one changed line means a different fingerprint, refused, and no text handed back', !g.ok && /not approved/.test(g.error) && !('src' in g), g)
  SERVED['promise-engine.js'] = REAL['promise-engine.js']; approve([['client-start.js', REAL['promise-engine.js']]]); g = await A.approvedRules(globalThis.__db, 'promise-engine.js')
  ck('G2 helper: a fingerprint approved for a different file does not count', !g.ok, g)
  const realFrom = globalThis.__db.from; globalThis.__db.from = (t) => t === 'rules_approved' ? { select: () => ({ eq: () => ({ eq: () => ({ limit: async () => ({ data: null, error: { message: 'permission denied' } }) }) }) }) } : realFrom(t)
  g = await A.approvedRules(globalThis.__db, 'promise-engine.js'); globalThis.__db.from = realFrom
  ck('G2 helper: if the approved list cannot be read, nothing runs', !g.ok && /could not read the approved rules list/.test(g.error), g)
  DOWN.add('promise-engine.js'); approve([['promise-engine.js', REAL['promise-engine.js']]]); g = await A.approvedRules(globalThis.__db, 'promise-engine.js'); DOWN.clear()
  ck('G2 helper: a failed download is refused (no fingerprint)', !g.ok && g.fingerprint === null, g)
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), REAL['promise-engine.js']]); SERVED['promise-engine.js'] = bom; approve([['promise-engine.js', REAL['promise-engine.js']]])
  g = await A.approvedRules(globalThis.__db, 'promise-engine.js')
  ck('G2 helper: the fingerprint is of the exact bytes served (an invisible byte-order mark is a different version)', !g.ok, g) }

/* ── 2 · each job: approved runs, poisoned never runs, rules_check reports ── */
for (const [fn, files] of Object.entries(JOBS)) {
  reset(); const h = await load(fn); const u = `https://x/functions/v1/${fn}`
  SERVED = Object.fromEntries(files.map((f) => [f, REAL[f]])); approve(files.map((f) => [f, REAL[f]]))
  let r = await call(h, u + '?rules_check=1', H.owner, BODY[fn] ?? {})
  ck(`G2 · ${fn}: rules_check (your key) reports every file approved, fingerprints only`, r.s === 200 && r.j?.all_approved === true && r.j.rules_check.length === files.length && r.j.rules_check.every((x) => x.fingerprint.length === 12), r)
  r = await call(h, u + '?rules_check=1', H.anon, BODY[fn] ?? {}); ck(`G2 · ${fn}: rules_check with the public key is refused`, r.s === 401, r)
  delete globalThis.__PWNED; SERVED[files[0]] = POISON(files[0]); SITE_HITS = []
  r = await call(h, u + '?dry=1', H.owner, BODY[fn] ?? {})
  ck(`G2 · ${fn}: a changed rules file is refused and not one line of it runs`, globalThis.__PWNED === undefined && r.s === 502 && /not approved/.test(JSON.stringify(r.j)), { s: r.s, j: JSON.stringify(r.j).slice(0, 300), pwned: globalThis.__PWNED })
  r = await call(h, u + '?rules_check=1', H.owner, BODY[fn] ?? {})
  ck(`G2 · ${fn}: rules_check then shows that file as not approved`, r.j?.all_approved === false && r.j.rules_check[0].approved === false, r)
  SERVED[files[0]] = REAL[files[0]]; T.rules_approved = []; delete globalThis.__PWNED
  r = await call(h, u + '?dry=1', H.owner, BODY[fn] ?? {})
  ck(`G2 · ${fn}: with nothing approved yet it refuses (fails closed)`, r.s === 502 && /not approved/.test(JSON.stringify(r.j)), { s: r.s, j: JSON.stringify(r.j).slice(0, 200) })
  approve(files.map((f) => [f, REAL[f]]))
  r = await call(h, u + '?dry=1', H.owner, BODY[fn] ?? {})
  ck(`G2 · ${fn}: with the approved file it gets past loading the rules (as before)`, !/not approved|Could not load/.test(JSON.stringify(r.j ?? '')) , { s: r.s, j: JSON.stringify(r.j).slice(0, 300) })
}
/* ── 3 · obligations-run: the second file (eligibility rules) unapproved stays non-fatal, but is NOT run ── */
{ reset(); const h = await load('obligations-run'); SERVED = { 'obligations.js': REAL['obligations.js'], 'eligibility-rules.js': POISON('eligibility-rules.js') }
  approve([['obligations.js', REAL['obligations.js']], ['eligibility-rules.js', REAL['eligibility-rules.js']]]); delete globalThis.__PWNED
  const r = await call(h, 'https://x/functions/v1/obligations-run?dry=1', H.owner, {})
  ck('G2 · obligations-run: an unapproved eligibility-rules.js is reported and never run; the run carries on as before without it', globalThis.__PWNED === undefined && r.s !== 401, { s: r.s, pwned: globalThis.__PWNED }) }
/* ── 4 · Client Start can no longer be pointed elsewhere ── */
{ reset(); const h = await load('client-start-run'); SERVED = { 'client-start.js': REAL['client-start.js'] }; approve([['client-start.js', REAL['client-start.js']]]); SITE_HITS = []
  await call(h, 'https://x/functions/v1/client-start-run?dry=1', H.owner, {})
  ck('G2 · client-start-run: the CLIENT_START_ENGINE_URL setting is ignored (it fetched only the Hub file)', !SITE_HITS.includes('EVIL') && SITE_HITS.includes('client-start.js'), SITE_HITS)
  const src = fs.readFileSync(`${FN}/client-start-run/index.ts`, 'utf8'); ck('G2 · client-start-run: the override is gone from the code', !/CLIENT_START_ENGINE_URL/.test(src)) }
/* ── 5 · no job fetches a rules file any other way ── */
for (const fn of Object.keys(JOBS)) { const src = fs.readFileSync(`${FN}/${fn}/index.ts`, 'utf8')
  ck(`G2 · ${fn}: every eval is of text that came through approvedRules`, !/fetch\((ENGINE|OBLIG|RULES)_URL/.test(src) && (src.match(/\(0, eval\)\(/g) || []).length === (src.match(/approvedRules\(/g) || []).length, (src.match(/\(0, eval\)\(/g) || []).length) }

for (const [n, o, note] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n   ' + note))
console.log(res.filter((x) => x[1]).length + '/' + res.length)
