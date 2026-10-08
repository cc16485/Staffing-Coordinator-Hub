// Caregiver profile, slice 2a (Desktop 409): caregiver-profile run for real against a fake database, storage, GoHighLevel
// and Claude, plus its message builders, draft clean-up, publish rules and scans of the SQL. node caregiver_profile_test.mjs
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
const tmp = path.join(process.cwd(), FN, 'caregiver-profile', '_t.ts'); fs.writeFileSync(tmp, src)
let M; try { M = await import(tmp) } finally { fs.unlinkSync(tmp) }
const call = async (body) => { const r = await handler(new Request('https://x/f', { method: 'POST', body: JSON.stringify(body) })); return [r.status, await r.json()] }
const texts = () => SENT.filter((m) => m.type === 'SMS'), emails = () => SENT.filter((m) => m.type === 'Email')

// ── pure parts ──
const tok = '11111111-2222-4333-8444-555555555555'
const lm = M.linkMessages('Dana', M.profileLink(tok))
ck('link message: their own link, the photo (needed) and the optional video, a STOP line, no em dash anywhere',
  lm.text.includes('https://cc.mo-care.com/caregiver-profile.html?t=' + tok) && /friendly photo of yourself \(we need this one\)/.test(lm.text) && /short hello video/.test(lm.text)
  && /Families see your profile before you visit/.test(lm.text) && /Reply STOP to opt out\.$/.test(lm.text) && !DASH.test(lm.text + lm.subject + lm.html) && lm.html.includes('?t=' + tok), lm)
ck('noDash turns an em dash into a comma', M.noDash('Kind — patient — and calm.') === 'Kind, patient, and calm.' && M.noDash('Ends —.') === 'Ends.', M.noDash('Kind — patient — and calm.'))
const sd = M.sanitiseDraft('Sure! ```json\n{"about":"Dana Doe is calm — and kind.","experience":"Dana cared for seniors for 3 years."}\n```', 'Dana', 'Doe')
ck('draft clean-up: JSON pulled out of chatter, em dash and last name gone, a missing section becomes an [ask: ...] prompt',
  sd.about === 'Dana is calm, and kind.' && sd.experience === 'Dana cared for seniors for 3 years.' && sd.why === M.PROMPTS.why, sd)
const sg = M.sanitiseDraft('I cannot help with that', 'Dana', 'Doe')
ck('draft clean-up: an unreadable reply is all prompts, never empty', sg.about === M.PROMPTS.about && sg.experience === M.PROMPTS.experience && sg.why === M.PROMPTS.why, sg)
ck('draft clean-up: a very long section is cut to the limit', M.sanitiseDraft({ about: 'a'.repeat(5000) }).about.length <= M.MAX_TEXT)
const good = { photo_path: 'x/photo-1.jpg', consent: true, about: 'Dana is kind.', experience: 'Dana has cared for seniors.', why_this_work: 'Dana loves it.', status: 'new' }
ck('publish rules: a complete profile has no problems', M.publishProblems(good).length === 0, M.publishProblems(good))
const pp = M.publishProblems({ ...good, photo_path: null, consent: false, why_this_work: '[ask: what they enjoy most]', experience: '' })
ck('publish rules: no photo, no permission, an [ask:] prompt left and an empty section are each named', pp.length === 4 && /No photo/.test(pp.join()) && /permission/.test(pp.join()) && /\[ask/.test(pp.join()) && /is empty/.test(pp.join()), pp)
ck('publish rules: a withdrawn profile never publishes', M.publishProblems({ ...good, status: 'withdrawn' }).some((x) => /withdrawn/.test(x)))
ck('same person: email, phone or first name agree; a stranger with a colliding id does not',
  M.samePerson({ email: 'D@X.com' }, { email: 'd@x.com' }) && M.samePerson({ phone: '417-555-0101' }, { phone: '(417) 555-0101' }) && M.samePerson({ first_name: 'Dana' }, { first: 'dana' })
  && !M.samePerson({ first_name: 'Robert', phone: '4175559999', email: 'r@y.com' }, { first: 'Dana', phone: '4175550101', email: 'd@x.com' }))
const app = { id: 'a1', first_name: 'Dana', phone: '4175550101', email: 'dana@x.com', experience_years: '3-5', experience: 'Cared for my grandma.', experience_kinds: ['Memory care'],
  work_history: [{ employer: 'Sunny Acres Nursing', role: 'CNA', from: '2020', current: true, supervisor: 'Bob Smith', supervisor_phone: '4175551234' }],
  can_pass_background: true, notes: 'office only note', post_interview: { smoker: 'yes', bg_check: 'yes', notes: 'office notes here', skills: { dementia: 'lots', hoyer: 'none' }, custom_skill: 'Cooking',
  script: { 'aaaaaaaa-0000-4000-8000-000000000001': { score: 'amazing', note: 'Loves hearing their stories' }, 'aaaaaaaa-0000-4000-8000-000000000002': { score: 'no_go', note: 'secret' } } } }
const facts = M.applicationFacts('Dana', app, { 'aaaaaaaa-0000-4000-8000-000000000001': 'Why do you want to do this work?' })
const fj = JSON.stringify(facts)
ck('AI facts: experience, care skills and their interview answers go in; employers, supervisors, phones, screening answers, scores and office notes never do',
  /grandma/.test(fj) && /CNA/.test(fj) && /very experienced/.test(fj) && /Loves hearing their stories/.test(fj) && /Cooking/.test(fj)
  && !/Sunny Acres|Bob Smith|5551234|office|secret|amazing|smoker|bg_check|can_pass|hoyer/i.test(fj), facts)
ck('AI prompt: third person, first name only, only given facts, [ask: ...] where missing, nothing private, never an em dash, JSON only',
  /Third person, using their first name only/.test(M.DRAFT_SYSTEM) && /ONLY facts given/.test(M.DRAFT_SYSTEM) && /\[ask: what they enjoy most about caregiving\]/.test(M.DRAFT_SYSTEM)
  && /Never mention anything private: age, health/.test(M.DRAFT_SYSTEM) && /Never use an em dash/.test(M.DRAFT_SYSTEM) && /Reply with JSON only/.test(M.DRAFT_SYSTEM) && !DASH.test(M.DRAFT_SYSTEM))

// ── the function ──
const CAND = { action: 'draft', candidate_id: '42', first: 'Dana', last: 'Doe', phone: '(417) 555-0101', email: 'dana@x.com' }
reset(); globalThis.__staff = { ok: false, status: 401, error: 'Sign in first.' }
let [s, j] = await call(CAND); ck('not signed-in office staff: draft refused, nothing created', s === 401 && !T.caregiver_profiles.length, j)
;[s, j] = await call({ action: 'publish', profile_id: tok }); ck('not signed-in: publish refused', s === 401, j)
;[s, j] = await call({ action: 'send_link', profile_id: tok, dry: true }); ck('not signed-in: send_link (even a preview) refused', s === 401, j)
;[s, j] = await call({ action: 'mine', t: tok }); ck('the public page needs no sign-in, and an unknown link gets a friendly 404', s === 404 && /call \(417\) 234-8494/.test(j.error), [s, j])
;[s, j] = await call({ action: 'mine', t: 'not-a-uuid' }); ck('a malformed link is a 404 before the database is asked', s === 404, j)
globalThis.__staff = STAFF

reset(); T.job_applicants = [{ ...app, candidate_id: 42 }]
T.interview_questions = [{ id: 'aaaaaaaa-0000-4000-8000-000000000001', question: 'Why do you want to do this work?', kind: 'open' }]
AI_REPLY = '{"about":"Dana Doe is warm — and patient.","experience":"Dana has worked as a CNA since 2020.","why":"Dana loves hearing her clients\' stories."}'
;[s, j] = await call(CAND)
let p = T.caregiver_profiles[0]
ck('draft: application found by candidate id, Claude (claude-sonnet-5-5) asked with safe facts, row saved with who/when',
  s === 200 && j.application_found && AI.length === 1 && AI[0].model === 'claude-sonnet-5-5' && !/Sunny Acres|Bob Smith/.test(JSON.stringify(AI[0].messages)) && p && p.candidate_id === '42'
  && p.applicant_id === 'a1' && p.drafted_by === 'Krystal' && p.drafted_at && p.years_experience === '3-5' && p.last_name === 'Doe' && p.published === false && p.consent === false, [j, p, AI[0]?.model])
ck('draft: what was saved has no em dash and no last name', p.about === 'Dana is warm, and patient.' && !DASH.test(p.about + p.experience + p.why_this_work), p)
;[s, j] = await call(CAND); ck('pressing Draft again reuses the draft (Claude not asked again, no second row)', j.reused && AI.length === 1 && T.caregiver_profiles.length === 1, j)
AI_REPLY = '{"about":"Dana is kind.","experience":"Dana has been a CNA since 2020.","why":"[ask: what they enjoy most about caregiving]"}'
;[s, j] = await call({ ...CAND, redo: true }); ck('Redo draft asks Claude again and replaces the words on the same row', AI.length === 2 && T.caregiver_profiles.length === 1 && T.caregiver_profiles[0].about === 'Dana is kind.', j)

reset(); T.job_applicants = [{ id: 'a9', candidate_id: 42, first_name: 'Robert', phone: '4175559999', email: 'r@y.com', experience: 'Not Dana' }]
;[s, j] = await call(CAND); p = T.caregiver_profiles[0]
ck('a different person under the same candidate id is ignored: no AI, the draft is all [ask:] prompts and the office is told', s === 200 && !j.application_found && !AI.length
  && p.about === M.PROMPTS.about && p.why_this_work === M.PROMPTS.why && /No online application/.test(j.note) && !p.applicant_id, [j, p])
reset(); T.job_applicants = [{ ...app, candidate_id: null }]; AI_REPLY = '{"about":"a","experience":"b","why":"c"}'
;[s, j] = await call(CAND); ck('no candidate id on the application: found by email instead', j.application_found && T.caregiver_profiles[0].applicant_id === 'a1', j)

// send the link
reset(); await call(CAND); p = T.caregiver_profiles[0]
T.welcome_calls = [{ id: 'w1', candidate_id: '42', status: 'booked', phone: '(417) 555-0101', email: 'dana@x.com', photo_link_sent: false, invited_at: '2026-10-01' },
  { id: 'w0', candidate_id: '42', status: 'done', photo_link_sent: false, invited_at: '2026-09-01' }]
;[s, j] = await call({ action: 'send_link', profile_id: p.id, dry: true })
ck('send_link preview: the exact text and email with their personal link, nothing sent, nothing stamped', s === 200 && j.dry && j.text.includes('caregiver-profile.html?t=' + p.upload_token)
  && j.to.phone && !SENT.length && !p.link_sent_at, j)
;[s, j] = await call({ action: 'send_link', profile_id: p.id })
ck('send_link: a text + email through GoHighLevel, link_sent stamped, "Photo link sent" ticked on the open welcome call only',
  j.texted && j.emailed && texts().length === 1 && emails().length === 1 && texts()[0].message.includes('?t=' + p.upload_token) && p.link_sent_by === 'Krystal'
  && T.welcome_calls[0].photo_link_sent === true && T.welcome_calls[1].photo_link_sent === false, [j, T.welcome_calls])
SENT = []; HOUR = '19'; ;[s, j] = await call({ action: 'send_link', profile_id: p.id }); HOUR = '10'
ck('7pm: no text (8am to 6pm), the email still goes, the office is told why', !j.texted && j.emailed && /8am to 6pm/.test(j.not_sent.join(' ')), j)
SENT = []; T.job_applicants = [{ phone: '4175550101', sms_consent: false, created_at: '2026-09-01' }]; ;[s, j] = await call({ action: 'send_link', profile_id: p.id })
ck('their application said no to texts: email only, and the office is told', !j.texted && j.emailed && /did not agree to texts/.test(j.not_sent.join(' ')), j)

// the new hire's page
const t = p.upload_token
;[s, j] = await call({ action: 'mine', t })
ck('their page: their drafted words and first name, never the token, candidate id or last name', s === 200 && j.first_name === 'Dana' && j.about === p.about && j.published === false
  && j.photo_url === null && !('upload_token' in j) && !('candidate_id' in j) && !('last_name' in j), j)
;[s, j] = await call({ action: 'upload_url', t, kind: 'photo', ext: 'exe' }); ck('upload: a file that is not a photo is refused', s === 400, j)
;[s, j] = await call({ action: 'upload_url', t, kind: 'video', ext: 'jpg' }); ck('upload: a photo sent as a video is refused', s === 400, j)
;[s, j] = await call({ action: 'upload_url', t, kind: 'photo', ext: 'JPG' })
ck('upload: a one-time signed link for a file inside their own folder', s === 200 && new RegExp('^' + p.id + '/photo-\\d+\\.jpg$').test(j.path) && j.token && j.signed_url, j)
const photo = j.path
;[s, j] = await call({ action: 'submit', t, about: 'x', photo_path: 'someone-else/photo-1234567890123.jpg', consent: true }); ck('submit: a file outside their own folder is refused', s === 400 && !p.submitted_at, j)
;[s, j] = await call({ action: 'submit', t, about: 'x', photo_path: photo, consent: true }); ck('submit: a photo that never finished uploading is refused', s === 400 && /did not finish/.test(j.error), j)
OBJECTS.add(photo)
;[s, j] = await call({ action: 'submit', t, preferred_name: 'Dee', about: 'I am calm — and I love to cook.', experience: p.experience, why_this_work: 'I love hearing stories.', photo_path: photo, consent: true })
ck('submit: their words saved (em dash gone), the photo and their permission recorded', s === 200 && j.ok && !j.needs_photo && p.photo_path === photo && p.consent === true && p.consent_at
  && p.about === 'I am calm, and I love to cook.' && p.preferred_name === 'Dee' && p.submitted_at && p.submit_count === 1, [j, p])
;[s, j] = await call({ action: 'submit', t, about: 'Words only.', consent: true })
ck('submit: words only (no new photo) keeps the photo they already sent', s === 200 && p.photo_path === photo && p.about === 'Words only.', [j, p])
;[s, j] = await call({ action: 'mine', t }); ck('their page shows their photo from the public bucket address', j.photo_url === 'https://sb/storage/v1/object/public/caregiver-profiles/' + photo, j)
p.submit_count = 20; p.submit_day = new Date().toISOString().slice(0, 10)
;[s, j] = await call({ action: 'submit', t, about: 'again' }); ck('more than 20 saves in a day: refused kindly', s === 429, j)
p.submit_count = 1

// publish
p.experience = 'Dana has been a CNA since 2020.'; p.why_this_work = '[ask: what they enjoy most about caregiving]'
;[s, j] = await call({ action: 'publish', profile_id: p.id }); ck('publish with an [ask:] prompt left: refused with the reason, nothing changes', s === 409 && j.problems.length === 1 && /\[ask/.test(j.error) && !p.published, j)
p.why_this_work = 'Dana loves hearing stories — every day.'
;[s, j] = await call({ action: 'publish', profile_id: p.id })
ck('publish: published, approved, who/when stamped, em dash cleaned, the card link returned', s === 200 && p.published && p.status === 'approved' && p.published_by === 'Krystal' && p.published_at
  && p.why_this_work === 'Dana loves hearing stories, every day.' && j.card === 'https://cc.mo-care.com/caregiver.html?id=' + p.id, [j, p])
;[s, j] = await call({ action: 'submit', t, about: 'changed' }); ck('after publish their link is locked: "Call the office at 417-234-8494 to change it."', s === 409 && j.error === M.PUBLISHED_NOTE && p.about !== 'changed', j)
;[s, j] = await call({ action: 'upload_url', t, kind: 'photo', ext: 'jpg' }); ck('after publish no new uploads either', s === 409, j)
;[s, j] = await call({ action: 'send_link', profile_id: p.id }); ck('after publish the office cannot send the link (the page would be locked)', s === 409, j)
;[s, j] = await call({ action: 'mine', t }); ck('their page still opens after publish, showing it is published', s === 200 && j.published === true, j)
;[s, j] = await call({ ...CAND, redo: true }); ck('a published profile cannot be redrafted until it is unpublished', s === 409, j)
;[s, j] = await call({ action: 'unpublish', profile_id: p.id }); ck('unpublish takes it down', s === 200 && p.published === false, j)
p.status = 'withdrawn'; ;[s, j] = await call({ action: 'mine', t }); ck('a withdrawn profile: their link is a 404', s === 404, j)

// a current employee
reset(); AI_REPLY = '{"about":"Sam is cheerful.","experience":"Sam has cared for seniors.","why":"Sam enjoys it."}'
;[s, j] = await call({ action: 'draft', axiscare_id: '9001', first: 'Sam', last: 'Lee', email: 'sam@x.com' })
ck('employee "Start a profile": keyed by AxisCare id (no candidate id), drafted even with no application (prompts)', s === 200 && T.caregiver_profiles.length === 1
  && T.caregiver_profiles[0].axiscare_id === '9001' && T.caregiver_profiles[0].candidate_id === null && T.caregiver_profiles[0].about === M.PROMPTS.about, [j, T.caregiver_profiles])
;[s, j] = await call({ action: 'draft', axiscare_id: '9001', first: 'Sam', last: 'Lee', redo: true }); ck('employee redo finds the same row by AxisCare id', T.caregiver_profiles.length === 1, T.caregiver_profiles)
;[s, j] = await call({ action: 'draft', first: 'Sam' }); ck('draft with neither a candidate id nor an AxisCare id is refused', s === 400, j)

// ── scans ──
const sq = fs.readFileSync('caregiver_profile_2a.sql', 'utf8'), card = fs.readFileSync(`${FN}/caregiver-card/index.ts`, 'utf8'), sp = fs.readFileSync(`${FN}/_shared/send-problems.ts`, 'utf8')
ck('SQL gap 1: the anonymous insert policy is dropped and anon loses every grant on caregiver_profiles',
  /drop policy if exists cgp_anon_insert on public\.caregiver_profiles;/.test(sq) && /revoke all on public\.caregiver_profiles from anon;/.test(sq) && !/create policy cgp_anon_insert/.test(sq) && !/grant [^;]*caregiver_profiles to anon/.test(sq))
ck('SQL gap 2: bucket uploads and listing are staff only; the bucket stays public for the card',
  /drop policy if exists cgp_files_write on storage\.objects;\s*create policy cgp_files_write on storage\.objects\s*for insert to authenticated/.test(sq)
  && /create policy cgp_files_read on storage\.objects\s*for select to authenticated/.test(sq) && !/to anon/.test(sq) && !/update storage\.buckets/.test(sq))
ck('SQL: the new columns, one live profile per candidate, a unique personal token, an AxisCare id index, and the 2c helper',
  ['candidate_id', 'applicant_id', 'last_name', 'upload_token   uuid not null default gen_random_uuid()', 'drafted_at', 'drafted_by', 'link_sent_at', 'link_sent_by', 'submitted_at', 'published_at', 'published_by'].every((c) => sq.includes('add column if not exists ' + c))
  && /caregiver_profiles_candidate_uniq\s+on public\.caregiver_profiles \(candidate_id\) where candidate_id is not null and status <> 'withdrawn'/.test(sq)
  && /unique index if not exists caregiver_profiles_token_uniq on public\.caregiver_profiles \(upload_token\)/.test(sq) && /caregiver_profiles_axiscare_idx/.test(sq)
  && /function public\.caregiver_profile_published\(p_candidate_id text\)/.test(sq))
ck('the family card is unchanged: published and not withdrawn only, and never the token', /!data\.published \|\| data\.status === 'withdrawn'/.test(card) && !/upload_token/.test(card))
ck('a refused profile-link message reads as a known message on a Needs Attention card (SENDER_WORDS)', /'caregiver-profile': \['caregiver profile link', 'caregivers'\]/.test(sp))
const fsrc = fs.readFileSync(`${FN}/caregiver-profile/index.ts`, 'utf8')
ck('NO SILENT FAILURES: every message goes through the opt-out door and ghlSendChecked (2 for the link, 2 for the 522 notice), nothing posts unchecked',
  (fsrc.match(/ghlSendChecked\(/g) || []).length === 4 && (fsrc.match(/ghlContactIfAllowed\(/g) || []).length === 4 && !/conversations\/messages/.test(fsrc))
ck('office actions check the signed-in staff member themselves (the function is deployed without the gateway check)', /const who = await requireStaff\(db, req, OFFICE_ROLES\)/.test(fsrc)
  && fsrc.indexOf("['mine', 'upload_url', 'submit'].includes(action)") < fsrc.indexOf('const who = await requireStaff'))
ck('CORS from day one: the cors headers and an OPTIONS answer', /'Access-Control-Allow-Origin': '\*'/.test(fsrc) && /req\.method === 'OPTIONS'/.test(fsrc))
ck('no em dash in anything the function says to a person', !DASH.test(fsrc.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\[\\u2014\\u2015\]/g, '')))

let all = true; console.log('\nCAREGIVER PROFILE 2a · TEST\n' + '='.repeat(50)); for (const [n, g, note] of res) { all &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')) }
console.log(all ? `ALL ${res.length} CHECKS PASS` : 'FAILED'); if (!all) process.exitCode = 1
