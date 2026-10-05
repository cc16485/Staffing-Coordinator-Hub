// 455 · hide a photo or video from a caregiver's profile (Samantha, 2026-10-05). The family card and caregiver-profile run
// for real against a fake database and storage. Made-up people only. node hide_455_test.mjs
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
      else out = { data: t === 'app_data' ? [] : rows().map((r) => ({ ...r })), error: null }
      return Promise.resolve(out).then(ok) } }; return b }
const storage = { from: () => ({
  createSignedUploadUrl: async (p) => ({ data: { token: 'tok-' + p, signedUrl: 'https://x/upload/sign/' + p, path: p }, error: null }),
  list: async (dir, o) => ({ data: [...OBJECTS].filter((k) => k.startsWith(dir + '/') && k.slice(dir.length + 1).includes(o.search)).map((k) => ({ name: k.slice(dir.length + 1) })), error: null }),
  remove: async (ps) => { ps.forEach((p) => OBJECTS.delete(p)); return { data: null, error: null } } }) }
globalThis.__db = { from: q, storage, rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') CARDS.push(a.item); return { data: null, error: null } } }
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
const tmp = path.join(process.cwd(), FN, 'caregiver-profile', '_t455.ts'); fs.writeFileSync(tmp, src)
let M; try { M = await import(tmp) } finally { fs.unlinkSync(tmp) }
const call = async (body) => { const r = await handler(new Request('https://x/f', { method: 'POST', body: JSON.stringify(body) })); return [r.status, await r.json()] }
const texts = () => SENT.filter((m) => m.type === 'SMS'), emails = () => SENT.filter((m) => m.type === 'Email')


reset()
// ── the family card ──
const ctmp = path.join(process.cwd(), FN, 'caregiver-card', '_t455.ts')
fs.writeFileSync(ctmp, fs.readFileSync(`${FN}/caregiver-card/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db'))
const PH = handler; let C; try { C = await import(ctmp) } finally { fs.unlinkSync(ctmp) }
handler = PH   // calls below go to caregiver-profile, not the card
const row = { id: 'p1', first_name: 'Grace', last_name: 'Hill', photo_path: 'p1/photo-1.jpg', video_path: 'p1/video-1-std.mp4', about: 'Hi', published: true, status: 'approved' }
const B = 'https://sb/storage/v1/object/public/caregiver-profiles/'
let c = C.cardPayload(row, B)
ck('card: photo and video shown when nothing is hidden', c.photo === B + 'p1/photo-1.jpg' && c.video === B + 'p1/video-1-std.mp4')
c = C.cardPayload({ ...row, video_hidden: true }, B)
ck('card: a hidden video is left off; the photo still shows', c.video === null && c.photo === B + 'p1/photo-1.jpg', c)
c = C.cardPayload({ ...row, photo_hidden: true, photo_url: 'https://old/photo.jpg' }, B)
ck('card: a hidden photo is left off, and the older photo address is not used instead', c.photo === null && c.video === B + 'p1/video-1-std.mp4', c)
ck('card: the server reads the two hide fields', /photo_hidden, video_hidden'/.test(fs.readFileSync(`${FN}/caregiver-card/index.ts`, 'utf8')))
// ── publishing and their page ──
const full = { about: 'a', experience: 'b', why_this_work: 'c', photo_path: 'x/photo-1.jpg', consent: true, status: 'new', self_complete: true }
ck('a current caregiver with NO video: still not published', M.publishProblems({ ...full }).some((x) => /video is required/.test(x)))
ck('...but if the office hid their video, it does not hold publishing up', M.publishProblems({ ...full, video_path: 'x/video-1.mp4', video_hidden: true }).length === 0 && M.publishProblems({ ...full, video_hidden: true }).length === 0)
const g = { id: uuid(), upload_token: uuid(), first_name: 'Grace', status: 'new', published: false, self_complete: true, about: 'a', experience: 'b', why_this_work: 'c', photo_path: null, video_path: null, video_hidden: true, photo_hidden: true, consent: true }
T.caregiver_profiles.push(g); g.photo_path = g.id + '/photo-1700000000000.jpg'; OBJECTS.add(g.photo_path); OBJECTS.add(g.id + '/video-1700000000005.mp4')
let [s, r] = await call({ action: 'submit', t: g.upload_token, about: 'a', experience: 'b', why_this_work: 'c', video_path: g.id + '/video-1700000000005.mp4', consent: true })
ck('a NEW video they send is shown again (video_hidden cleared); the hidden photo they did not change stays hidden', s === 200 && g.video_hidden === false && g.photo_hidden === true, [s, r, g])
ck('the profile helper reads the two hide fields', /needs_review, self_complete, photo_hidden, video_hidden'/.test(fs.readFileSync(`${FN}/caregiver-profile/index.ts`, 'utf8')))
const sql = fs.readFileSync('caregiver_profile_hide_455.sql', 'utf8')
ck('SQL: two fields, false for everyone, safe twice, nothing dropped or rewritten', (sql.match(/add column if not exists (photo|video)_hidden boolean not null default false/g) || []).length === 2 && !/drop |delete |update |truncate /i.test(sql.replace(/--.*$/gm, '')))
ck('no em dash in anything new', !DASH.test(sql + fs.readFileSync(`${FN}/caregiver-card/index.ts`, 'utf8')))
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note)); if (ok) pass++ }
console.log(pass === res.length ? `ALL ${res.length} CHECKS PASS` : `${res.length - pass} OF ${res.length} FAILED`); process.exit(pass === res.length ? 0 : 1)
