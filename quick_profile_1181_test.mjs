// 1181 · quick profile (Samantha, 2026-10-29): a photo and 3 short answers, the office writes it, they OK it. caregiver-profile
// run for real against a fake database and GoHighLevel (the 522 harness). Made-up people only. node quick_profile_1181_test.mjs
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
const tmp = path.join(process.cwd(), FN, 'caregiver-profile', '_t1181.ts'); fs.writeFileSync(tmp, src)
let M; try { M = await import(tmp) } finally { fs.unlinkSync(tmp) }
const call = async (body) => { const r = await handler(new Request('https://x/f', { method: 'POST', body: JSON.stringify(body) })); return [r.status, await r.json()] }
const texts = () => SENT.filter((m) => m.type === 'SMS'), emails = () => SENT.filter((m) => m.type === 'Email')


reset()
let s, r
const prof = () => T.caregiver_profiles[0]
const tok = () => prof().upload_token
/* 1. the office sets up the quick link and sends it */
;[s, r] = await call({ action: 'catchup', quick: true, axiscare_id: '7001', first: 'Dana', last: 'Lee' })
ck('quick set-up: a new row marked quick and self_complete', s === 200 && prof().quick === true && prof().self_complete === true, [s, r])
;[s, r] = await call({ action: 'send_link', profile_id: prof().id, dry: true, phone: '4175550101', email: 'dana@example.com' })
ck('the quick link words: photo, 3 quick questions, we write it, STOP line, no em dash', s === 200 && /We'll write it for you! Just tap here, add a friendly photo and answer 3 quick questions\. It takes about 2 minutes: https:\/\/cc\.mo-care\.com\/caregiver-profile\.html\?t=/.test(r.text)
  && /Reply STOP to opt out\.$/.test(r.text) && r.subject === 'Your Caring Companions profile: a photo and 3 quick questions' && /send it to you to look over/.test(r.html) && !DASH.test(r.text + r.subject + r.html) && !/\bAI\b/.test(r.text + r.html) && !SENT.length, r)
;[s, r] = await call({ action: 'send_link', profile_id: prof().id, phone: '4175550101', email: 'dana@example.com' })
ck('sent by text and email, link_sent_at stamped', s === 200 && r.texted && r.emailed && texts().length === 1 && emails().length === 1 && !!prof().link_sent_at, r)
/* 2. their page */
;[s, r] = await call({ action: 'mine', t: tok() })
ck('their page: quick, stage answers, no words to show', s === 200 && r.quick === true && r.stage === 'answers' && r.quick_answers.years === '', r)
OBJECTS.add(prof().id + '/photo-1730000000000.jpg')
;[s, r] = await call({ action: 'submit', t: tok(), quick: { years: '6', words: 'patient, cheerful', outside: '' }, photo_path: prof().id + '/photo-1730000000000.jpg', consent: true })
ck('a missing answer: not sent, says which', s === 400 && /one thing you love doing outside of work/.test(r.error) && !prof().submitted_at, r)
;[s, r] = await call({ action: 'submit', t: tok(), quick: { years: '6', words: 'patient, cheerful, dependable', outside: 'gardening' }, consent: true })
ck('no photo: not sent', s === 400 && /a photo of yourself/.test(r.error), r)
;[s, r] = await call({ action: 'submit', t: tok(), preferred_name: 'Dee', quick: { years: '6', words: 'patient, cheerful, dependable', outside: 'gardening with my grandkids' }, photo_path: prof().id + '/photo-1730000000000.jpg', consent: true,
  about: 'should be ignored' })
ck('complete: answers, photo and permission saved; the three sections untouched', s === 200 && prof().quick_answers.words === 'patient, cheerful, dependable' && prof().photo_path && prof().consent === true && !prof().about && prof().preferred_name === 'Dee', [r, prof()])
;[s, r] = await call({ action: 'mine', t: tok() })
ck('their page now says we are writing it', r.stage === 'writing', r)
/* 3. the office writes it with Beef it up */
AI_REPLY = JSON.stringify({ about: 'Dee is patient, cheerful and dependable. She loves gardening with her grandkids.', experience: 'Dee has been a caregiver for 6 years.', why: 'Dee enjoys making each day a little brighter.' })
;[s, r] = await call({ action: 'enhance', profile_id: prof().id })
const aiIn = AI[AI.length - 1]?.messages?.[0]?.content || ''
ck('Beef it up works from the quick answers alone', s === 200 && /patient, cheerful, dependable/.test(aiIn) && /gardening with my grandkids/.test(aiIn) && /their_quick_answers/.test(aiIn) && /their_quick_answers/.test(AI[AI.length - 1].system) && /6 years/.test(r.suggestion.experience), [s, r])
AI_REPLY = JSON.stringify({ about: 'x', experience: 'Dee has been a caregiver for 12 years.', why: 'y' })
;[s, r] = await call({ action: 'enhance', profile_id: prof().id })
ck('a number nobody gave is dropped', s === 200 && r.suggestion.experience === '', r)
;[s, r] = await call({ action: 'send_approval', profile_id: prof().id, phone: '4175550101', email: 'dana@example.com' })
ck('send for their OK before the words are in: refused, nothing sent', s === 409 && /all three sections/.test(r.error) && texts().length === 1, r)
Object.assign(prof(), { about: 'Dee is patient, cheerful and dependable — she loves gardening.', experience: 'Dee has been a caregiver for 6 years.', why_this_work: 'Dee enjoys making each day brighter.' })
ck('publish before they OK: refused, says to send it to them', /Send it to them to OK/.test(M.publishProblems(prof()).join()), M.publishProblems(prof()))
;[s, r] = await call({ action: 'send_approval', profile_id: prof().id, dry: true, phone: '4175550101' })
ck('the OK message words: link, Looks good, reply OK, STOP, no em dash', s === 200 && /We wrote your caregiver profile\. Please take a look here: https:\/\/cc\.mo-care\.com\/caregiver-profile\.html\?t=\S+ If it looks good, tap "Looks good" or just reply OK\./.test(r.text)
  && /Reply STOP to opt out\.$/.test(r.text) && r.subject === 'Your caregiver profile is ready for your OK' && !DASH.test(r.text + r.html) && !prof().approval_sent_at, r)
;[s, r] = await call({ action: 'send_approval', profile_id: prof().id, phone: '4175550101', email: 'dana@example.com' })
ck('sent for their OK: words remembered (no em dash), link_sent_at unchanged', s === 200 && r.texted && r.emailed && !!prof().approval_sent_at && prof().approval_words.about === 'Dee is patient, cheerful and dependable, she loves gardening.' && texts().length === 2, [r, prof().approval_words])
/* 4. their OK */
;[s, r] = await call({ action: 'mine', t: tok() })
ck('their page: stage approve, shows the words', r.stage === 'approve' && /gardening/.test(r.about), r)
;[s, r] = await call({ action: 'submit', t: tok(), quick: { years: '1', words: 'a', outside: 'b' }, photo_path: prof().id + '/photo-1730000000000.jpg', consent: true })
ck('answers are closed once the words were sent', s === 409 && prof().quick_answers.years === '6', r)
;[s, r] = await call({ action: 'approve', t: tok(), change: 'Please say I have 2 grandkids.' })
ck('change something: saved for the office, any OK cleared', s === 200 && prof().change_request === 'Please say I have 2 grandkids.' && !prof().approved_at, r)
;[s, r] = await call({ action: 'mine', t: tok() })
ck('their page remembers they asked', r.change_sent === true && r.stage === 'approve', r)
const seen = { about: prof().about, experience: prof().experience, why_this_work: prof().why_this_work }
prof().about = 'Dee is patient, cheerful and dependable. She loves gardening with her 2 grandkids.'
;[s, r] = await call({ action: 'approve', t: tok(), ok: true, words: seen })
ck('OK on words that changed since they loaded the page: refused, read again', s === 409 && r.changed && !prof().approved_at, r)
;[s, r] = await call({ action: 'approve', t: tok(), ok: true, words: { about: prof().about, experience: prof().experience, why_this_work: prof().why_this_work } })
ck('Looks good: OK recorded with the exact words', s === 200 && !!prof().approved_at && prof().approved_by === 'them, on their page' && /2 grandkids/.test(prof().approval_words.about), [r, prof()])
ck('publish is clear now', M.publishProblems(prof()).length === 0, M.publishProblems(prof()))
;[s, r] = await call({ action: 'mine', t: tok() })
ck('their page: approved', r.stage === 'approved', r)
prof().why_this_work = 'Dee enjoys making every day brighter.'
ck('an edit after their OK: publish refused, send again', /changed after they OK/.test(M.publishProblems(prof()).join()), M.publishProblems(prof()))
;[s, r] = await call({ action: 'record_ok', profile_id: prof().id })
ck('They said OK (text or phone): recorded with who', s === 200 && /recorded by Krystal/.test(prof().approved_by) && M.publishProblems(prof()).length === 0, [r, prof().approved_by])
;[s, r] = await call({ action: 'publish', profile_id: prof().id })
ck('publish goes', s === 200 && prof().published === true, r)
/* 5. switching and the old ways */
T.caregiver_profiles.push({ id: uuid(), upload_token: uuid(), axiscare_id: '7002', first_name: 'Bo', status: 'new', self_complete: true, quick: false, link_sent_at: '2026-10-06T10:00:00Z' })
;[s, r] = await call({ action: 'catchup', quick: true, axiscare_id: '7002', first: 'Bo', last: 'Ray' })
const bo = T.caregiver_profiles.find((x) => x.axiscare_id === '7002')
ck('a long-form caregiver still waiting switches to quick; their old link date is cleared', s === 200 && bo.quick === true && bo.link_sent_at === null, bo)
T.caregiver_profiles.push({ id: uuid(), upload_token: uuid(), axiscare_id: '7003', first_name: 'Cy', status: 'new', self_complete: true, quick: false, submitted_at: '2026-10-07', photo_path: 'p', consent: true, about: 'mine' })
;[s, r] = await call({ action: 'catchup', quick: true, axiscare_id: '7003', first: 'Cy' })
ck('a long-form profile already sent in stays long-form', T.caregiver_profiles.find((x) => x.axiscare_id === '7003').quick === false, r)
;[s, r] = await call({ action: 'catchup', axiscare_id: '7004', first: 'Di' })
ck('without quick, catch-up is the old way', T.caregiver_profiles.find((x) => x.axiscare_id === '7004').quick === false)
;[s, r] = await call({ action: 'send_approval', profile_id: T.caregiver_profiles.find((x) => x.axiscare_id === '7004').id })
ck('the OK message is only for quick profiles', s === 409)
;[s, r] = await call({ action: 'approve', t: T.caregiver_profiles.find((x) => x.axiscare_id === '7002').upload_token, ok: true })
ck('their page cannot OK before anything was sent', s === 409)
const lf = { about: 'a', experience: 'b', why_this_work: 'c', photo_path: 'x', consent: true, status: 'new', self_complete: true }
ck('long-form and new-hire publishing is unchanged', M.publishProblems(lf).length === 0)

for (const [n, ok, note] of res) console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  ' + note))
console.log(res.filter((x) => x[1]).length + '/' + res.length + ' passed'); process.exit(res.every((x) => x[1]) ? 0 : 1)
