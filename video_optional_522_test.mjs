// 522 · the hello video is now optional (Samantha, 2026-10-08): the one notice to every current caregiver. caregiver-profile
// run for real against a fake database and GoHighLevel (the catch-up harness). Made-up people only. node video_optional_522_test.mjs
import fs from 'fs'; import path from 'path'
const FN = 'supabase/functions'; const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 700)])
let HOUR = '10'; const realTLS = Date.prototype.toLocaleString
Date.prototype.toLocaleString = function (loc, o) { if (o && o.hour === '2-digit' && !o.minute) return HOUR; return realTLS.call(this, loc, o) }
const DASH = /[—―]/
let T, SENT, AI, OBJECTS, CARDS
const reset = () => { SENT = []; AI = []; OBJECTS = new Set(); CARDS = []
  T = { caregiver_profiles: [], welcome_calls: [], job_applicants: [], reference_requests: [], hire_intake: [], interview_questions: [],
    contact_optout_current: [], circle_contacts: [], phone_index: [], app_data: [] } }
let nextId = 1
const uuid = () => '00000000-0000-4000-8000-' + String(nextId++).padStart(12, '0')
const q = (t) => { const f = []; let op = 'select', patch = null, row = null; const rows = () => (T[t] || []).filter((r) => f.every((fn) => fn(r)))
  const b = { select() { return b }, eq(c, v) { f.push((r) => r[c] === v); return b }, neq(c, v) { f.push((r) => r[c] !== v); return b }, in(c, v) { f.push((r) => v.includes(r[c])); return b },
    ilike(c, v) { const s = String(v).toLowerCase(); f.push((r) => s.startsWith('%') ? String(r[c] ?? '').toLowerCase().endsWith(s.slice(1)) : String(r[c] ?? '').toLowerCase() === s); return b },
    lt() { return b }, gt() { return b }, or() { return b }, not() { return b }, is() { return b }, order() { return b }, limit() { return b },
    update(p) { op = 'update'; patch = p; return b }, delete() { op = 'delete'; return b },
    insert(r) { op = 'insert'; row = { id: uuid(), upload_token: uuid(), created_at: new Date().toISOString(), ...r }; return b },
    maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: x.error })) }, single() { return b.maybeSingle() },
    then(ok) { let out
      if (op === 'insert') { (T[t] ||= []).push(row); out = { data: [row], error: null } }
      else if (op === 'update') { const hit = rows(); hit.forEach((r) => Object.assign(r, patch)); out = { data: hit, error: null } }
      else if (op === 'delete') { T[t] = (T[t] || []).filter((r) => !f.every((fn) => fn(r))); out = { data: null, error: null } }
      else out = { data: rows().map((r) => ({ ...r })), error: null }
      return Promise.resolve(out).then(ok) } }; return b }
const storage = { from: () => ({
  createSignedUploadUrl: async (p) => ({ data: { token: 'tok-' + p, signedUrl: 'https://x/upload/sign/' + p, path: p }, error: null }),
  list: async (dir, o) => ({ data: [...OBJECTS].filter((k) => k.startsWith(dir + '/') && k.slice(dir.length + 1).includes(o.search)).map((k) => ({ name: k.slice(dir.length + 1) })), error: null }),
  remove: async (ps) => { ps.forEach((p) => OBJECTS.delete(p)); return { data: null, error: null } } }) }
globalThis.__db = { from: q, storage, rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') { CARDS.push(a.item); if (a.target_key === 'cgp_notices') { let row = T.app_data.find((r) => r.key === 'cgp_notices'); if (!row) { row = { key: 'cgp_notices', data: [] }; T.app_data.push(row) } row.data = row.data.filter((x) => x.id !== a.item.id).concat([a.item]) } } return { data: null, error: null } } }
const STAFF = { ok: true, email: 'krystal@mo-care.com', name: 'Krystal' }
globalThis.__staff = STAFF
let AI_REPLY = ''
globalThis.fetch = async (url, o) => { url = String(url); const body = o?.body ? JSON.parse(o.body) : {}
  if (url.includes('api.anthropic.com')) { AI.push(body); return new Response(JSON.stringify({ content: [{ type: 'text', text: AI_REPLY }] }), { status: 200 }) }
  if (url.includes('/contacts/search/duplicate')) return new Response('{}', { status: 200 })
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + (body.phone || body.email), dnd: false } }), { status: 200 })
  if (url.includes('/conversations/messages')) { SENT.push(body); return new Response('{}', { status: 200 }) }
  return new Response('{}', { status: 200 }) }
let handler; globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'https://sb', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', ANTHROPIC_API_KEY: 'a' })[k] }, serve: (h) => { handler = h } }
const src = fs.readFileSync(`${FN}/caregiver-profile/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace(/^import \{ requireStaff, OFFICE_ROLES \} from .*$/m, 'const OFFICE_ROLES = []; const requireStaff = async () => globalThis.__staff')
const tmp = path.join(process.cwd(), FN, 'caregiver-profile', '_t522.ts'); fs.writeFileSync(tmp, src)
let M; try { M = await import(tmp) } finally { fs.unlinkSync(tmp) }
const call = async (body) => { const r = await handler(new Request('https://x/f', { method: 'POST', body: JSON.stringify(body) })); return [r.status, await r.json()] }
const texts = () => SENT.filter((m) => m.type === 'SMS'), emails = () => SENT.filter((m) => m.type === 'Email')



reset()
let s, r
;[s, r] = await call({ action: 'notice', kind: 'video_optional', first: 'Dana', dry: true })
ck('dry: her words, a STOP line, the office number, no em dash, nothing sent', s === 200 && r.dry && /the short hello video is now optional/.test(r.text) && /Reply STOP to opt out\.$/.test(r.text) && /\(417\) 234-8494/.test(r.text)
  && r.subject === 'Your caregiver profile: the hello video is now optional' && /optional\.<\/b>/.test(r.html) && !DASH.test(r.text + r.subject + r.html) && !SENT.length, r)
;[s, r] = await call({ action: 'notice', kind: 'other' })
ck('an unknown notice is refused', s === 400, r)
;[s, r] = await call({ action: 'notice', kind: 'video_optional', first: 'Dana', last: 'Lee', phone: '4175550101', email: 'dana@example.com' })
ck('no caregiver id: refused, nothing sent', s === 400 && !SENT.length, r)
;[s, r] = await call({ action: 'notice', kind: 'video_optional', axiscare_id: '9001', first: 'Dana', last: 'Lee', phone: '4175550101', email: 'dana@example.com' })
ck('text and email go, and it is written down', s === 200 && r.texted && r.emailed && !r.not_sent.length && texts().length === 1 && emails().length === 1
  && /Hi Dana, it's Caring Companions! A quick update/.test(texts()[0].message) && /Reply STOP to opt out\.$/.test(texts()[0].message) && emails()[0].subject === 'Your caregiver profile: the hello video is now optional'
  && CARDS.some((c) => c.id === 'video_optional:9001' && c.texted && c.emailed && c.by === 'Krystal'), [r, SENT, CARDS])
;[s, r] = await call({ action: 'notice', kind: 'video_optional', axiscare_id: '9001', first: 'Dana', last: 'Lee', phone: '4175550101', email: 'dana@example.com' })
ck('the same caregiver a second time: skipped, nothing sent', s === 200 && r.already && !r.texted && !r.emailed && texts().length === 1 && emails().length === 1, r)
;[s, r] = await call({ action: 'notice', kind: 'video_optional', axiscare_id: '9002', first: 'Bo', last: 'Ray', phone: '', email: '' })
ck('nobody to reach: said, not written down', s === 200 && !r.texted && !r.emailed && /no mobile or email/.test(r.not_sent.join()) && !CARDS.some((c) => c.id === 'video_optional:9002'), r)
HOUR = '20'
;[s, r] = await call({ action: 'notice', kind: 'video_optional', axiscare_id: '9003', first: 'Cy', last: 'Fox', phone: '4175550103', email: 'cy@example.com' })
ck('after 6pm: the email goes, the text waits and says so', s === 200 && !r.texted && r.emailed && /8am to 6pm/.test(r.not_sent.join()) && texts().length === 1 && emails().length === 2, r)
HOUR = '10'
T.job_applicants.push({ phone: '4175550104', sms_consent: false, created_at: '2026-09-01' })
;[s, r] = await call({ action: 'notice', kind: 'video_optional', axiscare_id: '9004', first: 'Di', last: 'Ng', phone: '4175550104', email: '' })
ck('no to texts on their application: no text, said plainly, not written down', s === 200 && !r.texted && /did not agree to texts/.test(r.not_sent.join()) && !CARDS.some((c) => c.id === 'video_optional:9004'), r)
globalThis.__staff = { ok: false, error: 'Sign in to the Hub first.', status: 401 }
;[s, r] = await call({ action: 'notice', kind: 'video_optional', axiscare_id: '9005', first: 'Ed', phone: '4175550105' })
ck('not signed-in office staff: refused', s === 401, r)
globalThis.__staff = STAFF
/* the video is optional everywhere */
const full = { about: 'a', experience: 'b', why_this_work: 'c', photo_path: 'x/photo-1.jpg', video_path: null, consent: true, status: 'new', self_complete: true }
ck('a current caregiver with no video publishes', M.publishProblems(full).length === 0, M.publishProblems(full))
ck('their missing list never asks for the video', !/video/.test(M.selfCompleteMissing({ ...full, photo_path: null }).join()))
const cm = M.catchupMessages('Dana', 'https://x')
ck('the catch-up link says the video is if you like', /\(and a short hello video if you like\)/.test(cm.text) && /This one is optional/.test(cm.html) && !DASH.test(cm.text + cm.html))

for (const [n, ok, note] of res) console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  ' + note))
console.log(res.filter((x) => x[1]).length + '/' + res.length + ' passed'); process.exit(res.every((x) => x[1]) ? 0 : 1)
