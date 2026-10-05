// 457 · "Beef it up with AI" (Samantha, 2026-10-05: office panel; their words + application). caregiver-profile run for real
// against a fake database and a fake Claude. Made-up people only. node beef_457_test.mjs
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
const tmp = path.join(process.cwd(), FN, 'caregiver-profile', '_t457.ts'); fs.writeFileSync(tmp, src)
let M; try { M = await import(tmp) } finally { fs.unlinkSync(tmp) }
const call = async (body) => { const r = await handler(new Request('https://x/f', { method: 'POST', body: JSON.stringify(body) })); return [r.status, await r.json()] }
const texts = () => SENT.filter((m) => m.type === 'SMS'), emails = () => SENT.filter((m) => m.type === 'Email')


reset()
const g = { id: uuid(), upload_token: uuid(), first_name: 'Grace', last_name: 'Hill', applicant_id: null, status: 'new', published: false, self_complete: true,
  about: 'I am from Ozark. I like to cook.', experience: 'I took care of my grandma.', why_this_work: 'I like helping.', photo_path: 'x/photo-1.jpg', consent: true }
T.caregiver_profiles.push(g)
T.job_applicants.push({ id: '11111111-1111-4111-8111-111111111111', first_name: 'Grace', phone: '4175550111', email: 'grace@example.com', experience_years: '3-5', experience_kinds: ['Memory care'],
  experience: 'Worked in assisted living.', work_history: [{ employer: 'Sunny Acres', role: 'Caregiver', from: '2021', current: true }], created_at: '2026-01-01' })
T.caregiver_application_facts = [{ axiscare_id: '7001', facts: { own_words: { interest: 'I love hearing their stories.', qualities: 'Patient', why_us: null, conversation: 'yes', hobbies: 'Gardening and baking' },
  experience: { jobs: [{ title: 'CNA', from: '2019', to: '2023', duties: 'Bathing and meals' }], education: { highest: 'high school' } },
  matching: { smoker: 'yes', services: ['dementia_care'] }, availability: { hours_ideal: 25 }, favorites: { candy_bar: 'Snickers' } } }]
g.axiscare_id = '7001'
AI.length = 0
AI_REPLY = JSON.stringify({ about: "I'm from Ozark and I love to cook. I'm easy to be around.", experience: 'I took care of my grandma, and I have 3-5 years in memory care at assisted living.', why: 'I like helping people feel at home.' })
const before = JSON.stringify(g)
let [s, r] = await call({ action: 'enhance', profile_id: g.id, phone: '(417) 555-0111', email: 'grace@example.com' })
ck('a fuller version comes back, from their words', s === 200 && r.suggestion && /Ozark/.test(r.suggestion.about) && r.application_found === true, [s, r])
ck('nothing is saved: the office compares and chooses', JSON.stringify(g) === before)
const sent = AI[0] && AI[0].messages[0].content
ck('the AI gets their words and their application facts (no employer name, no phone)', /I took care of my grandma/.test(sent) && /Memory care/.test(sent) && /assisted living/.test(sent) && !/Sunny Acres|5550111|grace@example/.test(sent), sent)
ck('their Step 1 application reaches the AI: their words, hobbies, past jobs; never matching answers, availability or favorites', /Gardening and baking/.test(sent) && /I love hearing their stories/.test(sent) && /Bathing and meals/.test(sent) && !/Snickers|smoker|hours_ideal|dementia_care/.test(sent), sent)
ck('the AI is told: keep their voice, keep their details, only given facts, nothing private, no em dash', /Keep their voice/.test(AI[0].system) && /Keep every specific detail/.test(AI[0].system) && /Add ONLY from the facts given/.test(AI[0].system) && /Never mention anything private/.test(AI[0].system) && /Never use an em dash/.test(AI[0].system))
AI_REPLY = JSON.stringify({ about: 'I am from Ozark and I have cooked for 20 years.', experience: 'Grandma Hill was my first.', why: '' })
;[s, r] = await call({ action: 'enhance', profile_id: g.id })
ck('a section with a number nobody gave goes back to their own words', r.suggestion.about === g.about, r.suggestion)
ck('their last name is taken out; an empty answer from the AI keeps theirs', !/Hill/.test(r.suggestion.experience) && r.suggestion.why === g.why_this_work, r.suggestion)
const empty = { id: uuid(), upload_token: uuid(), first_name: 'Nina', status: 'new', published: false, about: '', experience: null, why_this_work: '' }
T.caregiver_profiles.push(empty)
;[s, r] = await call({ action: 'enhance', profile_id: empty.id }); ck('no words yet: nothing to build on, said so', s === 409 && /no words yet/.test(r.error))
globalThis.__staff = { ok: false, status: 401, error: 'Please sign in.' }
;[s, r] = await call({ action: 'enhance', profile_id: g.id }); ck('not signed-in office staff: refused', s === 401)
globalThis.__staff = STAFF
const fsrc = fs.readFileSync(`${FN}/caregiver-profile/index.ts`, 'utf8')
ck('no temperature setting anywhere (claude-sonnet-5-5 refuses it; every AI draft was failing)', !/temperature/.test(fsrc.replace(/\/\/.*$/gm, '')) && !('temperature' in AI[0]))
ck('the draft and Beef it up share one application lookup', (fsrc.match(/await findApplication\(db,/g) || []).length === 2)
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note)); if (ok) pass++ }
console.log(pass === res.length ? `ALL ${res.length} CHECKS PASS` : `${res.length - pass} OF ${res.length} FAILED`); process.exit(pass === res.length ? 0 : 1)
