// 452 · current caregivers fill in their own profile (Samantha, 2026-10-05). caregiver-profile run for real against a fake
// database, storage and GoHighLevel (the same harness as caregiver_profile_test.mjs). Made-up people only. node profile_catchup_452_test.mjs
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
const tmp = path.join(process.cwd(), FN, 'caregiver-profile', '_t452.ts'); fs.writeFileSync(tmp, src)
let M; try { M = await import(tmp) } finally { fs.unlinkSync(tmp) }
const call = async (body) => { const r = await handler(new Request('https://x/f', { method: 'POST', body: JSON.stringify(body) })); return [r.status, await r.json()] }
const texts = () => SENT.filter((m) => m.type === 'SMS'), emails = () => SENT.filter((m) => m.type === 'Email')


reset()
const DONE = (p) => ({ ...p })
// ── pure parts ──
const tok = '11111111-2222-4333-8444-555555555555'
const cm = M.catchupMessages('Dana', M.profileLink(tok)), lm = M.linkMessages('Dana', M.profileLink(tok))
ck('current caregiver text: her wording, their own link, 3 questions + photo + video, STOP line',
  cm.text === "Hi Dana, it's Caring Companions! We're adding a short profile that our families see before you visit, so they know who's coming. Please fill it in yourself here: https://cc.mo-care.com/caregiver-profile.html?t=" + tok + " Answer 3 short questions in your own words, and add a friendly photo (and a short hello video if you like). It takes about 10 minutes. Reply STOP to opt out.", cm.text)
ck('current caregiver email: subject, the three steps, the button to their link, no "we wrote"', cm.subject === 'Your Caring Companions profile: 3 questions and a photo'
  && /Answer 3 short questions in your own words/.test(cm.html) && /If you like, add a short hello video/.test(cm.html) && cm.html.includes('?t=' + tok) && /Fill in my profile/.test(cm.html) && !/we wrote/i.test(cm.html + cm.text), cm.html)
ck('new hires keep their wording', /check the words we wrote about you/.test(lm.text) && lm.subject === 'Add your photo to your Caring Companions profile')
ck('no em dash in anything new', !DASH.test(cm.text + cm.subject + cm.html) && !DASH.test(M.selfCompleteMissing({}).join()))
const full = { about: 'I grew up in Ozark.', experience: 'I cared for my grandma for 4 years.', why_this_work: 'I love the stories.', photo_path: 'x/photo-1.jpg', video_path: 'x/video-1.mp4', consent: true, status: 'new' }
ck('complete: nothing missing', M.selfCompleteMissing(full).length === 0)
const miss = M.selfCompleteMissing({ ...full, why_this_work: '[ask: what they enjoy]', video_path: null, consent: false, about: '' })
ck('missing pieces are named in their words: an empty or [bracket] answer, the permission (the video is optional since 522)', miss.length === 3 && /what families should know about you/.test(miss.join()) && /enjoy most/.test(miss.join()) && !/hello video/.test(miss.join()) && /permission/.test(miss.join()), miss)
ck('publishing a current caregiver does not need the video (522)', !M.publishProblems({ ...full, self_complete: true, video_path: null }).some((x) => /video is required/.test(x)) && M.publishProblems({ ...full, self_complete: true }).length === 0)
ck('a new hire still publishes without a video', M.publishProblems({ ...full, video_path: null }).length === 0)

// ── catchup (office) ──
let [s, r] = await call({ action: 'catchup', axiscare_id: '777', first: 'Joyce', last: 'Kim' })
const j = T.caregiver_profiles[0]
ck('a current caregiver with no profile: one row started, self_complete, blank words, not published, no AI', s === 200 && r.started && T.caregiver_profiles.length === 1 && j.self_complete === true && j.axiscare_id === '777' && j.first_name === 'Joyce' && !j.about && j.published === false && j.consent === false && AI.length === 0, [s, r])
;[s, r] = await call({ action: 'catchup', axiscare_id: '777', first: 'Joyce', last: 'Kim' })
ck('pressing it again reuses the same row', s === 200 && T.caregiver_profiles.length === 1 && !r.started)
T.caregiver_profiles.push({ id: uuid(), upload_token: uuid(), candidate_id: '55', first_name: 'Maria', about: '[ask: two or three things]', experience: 'Maria worked 3 years in memory care.', why_this_work: '[ask: why]', status: 'new', published: false })
;[s, r] = await call({ action: 'catchup', axiscare_id: '888', first: 'Maria', last: 'Lopez', legacy_candidate_id: '55' })
const m = T.caregiver_profiles.find((x) => x.candidate_id === '55')
ck('an older unfinished profile (found by their old Hub id) is reused: AxisCare id added, [ask] prompts emptied, real words kept', s === 200 && m.self_complete === true && m.axiscare_id === '888' && m.about === null && m.why_this_work === null && m.experience === 'Maria worked 3 years in memory care.' && T.caregiver_profiles.length === 2, m)
T.caregiver_profiles.push({ id: uuid(), upload_token: uuid(), axiscare_id: '999', first_name: 'Ruth', about: 'Done.', published: true, needs_review: false, status: 'approved' })
;[s, r] = await call({ action: 'catchup', axiscare_id: '999', first: 'Ruth' })
const ru = T.caregiver_profiles.find((x) => x.axiscare_id === '999')
ck('a published profile is left alone', s === 200 && r.skipped === 'published' && !ru.self_complete && ru.about === 'Done.')
;[s, r] = await call({ action: 'catchup', first: 'X' }); ck('no AxisCare id: refused', s === 400)
globalThis.__staff = { ok: false, status: 401, error: 'Please sign in.' }
;[s, r] = await call({ action: 'catchup', axiscare_id: '1', first: 'X' }); ck('not signed-in office staff: refused', s === 401)
globalThis.__staff = STAFF

// ── send_link: the current-caregiver wording ──
SENT = []
;[s, r] = await call({ action: 'send_link', profile_id: j.id, phone: '4175550101', email: 'joyce@example.com', dry: true })
ck('preview shows the current-caregiver text and email', s === 200 && r.dry && /Please fill it in yourself here/.test(r.text) && r.subject === cm.subject && SENT.length === 0, r)
;[s, r] = await call({ action: 'send_link', profile_id: j.id, phone: '4175550101', email: 'joyce@example.com' })
ck('sent: one text and one email with the current-caregiver wording, link_sent stamped', s === 200 && r.texted && r.emailed && texts().length === 1 && /Please fill it in yourself here/.test(texts()[0].message) && emails().length === 1 && /3 questions/.test(emails()[0].subject) && !!j.link_sent_at, [r, SENT.length])

// ── their page: mine + submit ──
;[s, r] = await call({ action: 'mine', t: j.upload_token })
ck('their page is told this is a current caregiver (self_complete)', s === 200 && r.self_complete === true && !r.about)
OBJECTS.add(j.id + '/photo-1700000000000.jpg')
;[s, r] = await call({ action: 'submit', t: j.upload_token, about: 'I grew up in Ozark.', experience: 'My grandma, 4 years.', why_this_work: 'The stories.', photo_path: j.id + '/photo-1700000000000.jpg' })
ck('submit without the video: the video is never what is missing (522); only the permission is', s === 400 && /permission/.test(r.error) && !/video/.test(r.error), r)
OBJECTS.add(j.id + '/video-1700000000001.mp4')
;[s, r] = await call({ action: 'submit', t: j.upload_token, about: '', experience: 'My grandma, 4 years.', why_this_work: 'The stories.', photo_path: j.id + '/photo-1700000000000.jpg', video_path: j.id + '/video-1700000000001.mp4', consent: true })
ck('submit with an empty answer: refused, names it', s === 400 && /what families should know about you/.test(r.error), r)
;[s, r] = await call({ action: 'submit', t: j.upload_token, about: 'I grew up in Ozark.', experience: 'My grandma, 4 years.', why_this_work: 'The stories.', photo_path: j.id + '/photo-1700000000000.jpg', video_path: j.id + '/video-1700000000001.mp4' })
ck('submit without their permission: refused', s === 400 && /permission/.test(r.error), r)
;[s, r] = await call({ action: 'submit', t: j.upload_token, about: 'I grew up in Ozark.', experience: 'My grandma, 4 years.', why_this_work: 'The stories.', photo_path: j.id + '/photo-1700000000000.jpg', video_path: j.id + '/video-1700000000001.mp4', consent: true })
ck('complete: saved with photo, video, words and permission; not published (the office checks first)', s === 200 && j.about === 'I grew up in Ozark.' && j.photo_path && j.video_path && j.consent === true && !!j.submitted_at && j.published === false, [s, r, j])
;[s, r] = await call({ action: 'publish', profile_id: j.id })
ck('the office can publish it now', s === 200 && r.published && j.published === true)
const nh = { id: uuid(), upload_token: uuid(), candidate_id: '70', first_name: 'Nina', status: 'new', published: false }
T.caregiver_profiles.push(nh); OBJECTS.add(nh.id + '/photo-1700000000002.jpg')
;[s, r] = await call({ action: 'submit', t: nh.upload_token, about: 'Nina is kind.', experience: 'x', why_this_work: 'y', photo_path: nh.id + '/photo-1700000000002.jpg', consent: true })
ck('a new hire still saves without a video (unchanged)', s === 200 && nh.about === 'Nina is kind.')
ck('nothing went to the AI', AI.length === 0)

const fsrc = fs.readFileSync(`${FN}/caregiver-profile/index.ts`, 'utf8'), sql = fs.readFileSync('caregiver_profile_catchup_452.sql', 'utf8')
ck('the SQL only adds one field, safely twice, in one transaction', /add column if not exists self_complete boolean not null default false/.test(sql) && /^begin;/m.test(sql) && /^commit;/m.test(sql) && !/drop |delete |truncate |update /i.test(sql.replace(/--.*$/gm, '')))
ck('catchup is an office action (after the sign-in check), never public', fsrc.indexOf("if (action === 'catchup')") > fsrc.indexOf('const who = await requireStaff') && !/\['mine', 'upload_url', 'submit', 'catchup'\]/.test(fsrc))

// ── "Help me say it" (profile-polish, mode 'say') ──
const psrc = fs.readFileSync(`${FN}/profile-polish/index.ts`, 'utf8')
const ptmp = path.join(process.cwd(), FN, 'profile-polish', '_t452.ts'); fs.writeFileSync(ptmp, psrc)
let PP; try { PP = await import(ptmp) } finally { fs.unlinkSync(ptmp) }
const pcall = async (body) => { const r = await handler(new Request('https://x/p', { method: 'POST', body: JSON.stringify(body) })); return [r.status, await r.json()] }
AI.length = 0; AI_REPLY = "I'm from Ozark and a mom of three. I love cooking, and people tell me I'm quiet and patient."
let [ps, pr] = await pcall({ mode: 'say', text: 'from ozark, 3 kids, love cooking, quiet and patient', question: 'What should families know about you?' })
ck('Help me say it: their notes come back as sentences in their voice', ps === 200 && pr.said === AI_REPLY, [ps, pr])
ck('...the AI is told the question and given only what they typed, with the "only what they typed, first person, plain words" rules', AI.length === 1 && /The question: What should families know about you\?/.test(AI[0].messages[0].content) && /from ozark, 3 kids/.test(AI[0].messages[0].content)
  && /Use ONLY what they typed/.test(AI[0].system) && /First person/.test(AI[0].system) && /Keep their plain, everyday words/.test(AI[0].system) && /Never use an em dash/.test(AI[0].system))
AI_REPLY = "I've cared for seniors for 12 years and I love it."
;[ps, pr] = await pcall({ mode: 'say', text: 'cared for my grandma, love it' })
ck('a number they never typed (made up): refused, nothing handed back', ps === 422 && !pr.said && /fine to keep/.test(pr.error), [ps, pr])
AI_REPLY = 'x'.repeat(900)
;[ps, pr] = await pcall({ mode: 'say', text: 'love it' })
ck('a reply far longer than what they gave: refused', ps === 422)
AI_REPLY = 'I love helping people — it makes my day.'
;[ps, pr] = await pcall({ mode: 'say', text: 'love helping people, makes my day' })
ck('an em dash in the reply becomes a comma', ps === 200 && pr.said === 'I love helping people, it makes my day.', pr)
AI_REPLY = 'Thanks for writing.'
;[ps, pr] = await pcall({ mode: 'spelling', text: 'Thanks for writting.' })
ck('the spelling check is unchanged', ps === 200 && pr.polished === 'Thanks for writing.', pr)
ck('the new rules are written down in the helper, with her decision', /452 \(Samantha, 2026-10-05/.test(psrc) && /yes add help me say it/.test(psrc))

let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note)); if (ok) pass++ }
console.log(pass === res.length ? `ALL ${res.length} CHECKS PASS` : `${res.length - pass} OF ${res.length} FAILED`); process.exit(pass === res.length ? 0 : 1)
