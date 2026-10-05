// 458 · step1-import run for real against a fake GoHighLevel, a fake Claude and a fake database. Made-up people only.
//   node step1_import_458_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 800)])
let SAVED = [], AI = [], GHLCALLS = [], AI_REPLY = '', OWNER = true
const CG = [{ id: 101, first: 'Joyce', last: 'Kim', phone: '4175550101', email: 'joyce@example.com', axiscare_id: '9001', candidate_id: '55' },
  { id: 102, first: 'Nora', last: 'Nofile', phone: '4175550102' }, { id: 103, first: 'Ed', last: 'Nophone' }, { id: 104, first: 'Done', last: 'Before', phone: '4175550104' }]
const q = (t) => { let up = null; const b = { select() { return b }, eq() { return b }, maybeSingle() { return Promise.resolve({ data: t === 'app_data' ? { data: CG } : null, error: null }) },
  upsert(r, o) { SAVED.push({ r, o }); return Promise.resolve({ error: null }) },
  then(ok) { return Promise.resolve({ data: t === 'caregiver_application_facts' ? [{ hub_caregiver_id: '104', ghl_file_key: 'fileD', facts: { own_words: { hobbies: 'Gardening' } } }, { hub_caregiver_id: '101', ghl_file_key: 'fileB', facts: JSON.parse(JSON.stringify(globalThis.__emptyFacts || {})) }] : [], error: null }).then(ok) } }; return b }
globalThis.__db = { from: q }
globalThis.fetch = async (url, o) => { url = String(url); GHLCALLS.push((o?.method || 'GET') + ' ' + url.replace(/\?.*/, ''))
  if (url.includes('/customFields')) return new Response(JSON.stringify({ customFields: [{ id: 'F1', name: '📄 Upload Step 1 Application Packet ' }] }), { status: 200 })
  if (url.includes('/contacts/search/duplicate')) { const id = url.includes('0101') ? 'C1' : url.includes('0102') ? 'C2' : url.includes('0104') ? 'C4' : ''; return new Response(JSON.stringify({ contact: id ? { id } : null }), { status: 200 }) }
  if (url.endsWith('/contacts/C1')) return new Response(JSON.stringify({ contact: { customFields: [{ id: 'F1', value: { fileA: { url: 'https://files/a.pdf' }, fileB: { url: 'https://files/b.pdf' } } }] } }), { status: 200 })
  if (url.endsWith('/contacts/C2')) return new Response(JSON.stringify({ contact: { customFields: [] } }), { status: 200 })
  if (url.endsWith('/contacts/C4')) return new Response(JSON.stringify({ contact: { customFields: [{ id: 'F1', value: { fileD: { url: 'https://files/d.pdf' } } }] } }), { status: 200 })
  if (url.startsWith('https://files/')) return new Response(new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52]), { status: 200, headers: { 'content-type': 'application/pdf' } })
  if (url.includes('api.anthropic.com')) { AI.push(JSON.parse(o.body)); return new Response(JSON.stringify({ stop_reason: 'end_turn', usage: { output_tokens: 900 }, content: globalThis.__thinking ? [{ type: 'thinking', thinking: '...' }, { type: 'text', text: '```json\n' + AI_REPLY.replace(/^Here you go: /, '') + '\n```' }] : [{ type: 'text', text: AI_REPLY }] }), { status: 200 }) }
  return new Response('{}', { status: 404 }) }
let handler; globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'https://sb', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', ANTHROPIC_API_KEY: 'a' })[k] }, serve: (h) => { handler = h } }
const FN = 'supabase/functions/step1-import/index.ts'
const src = fs.readFileSync(FN, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db').replace(/^import \{ ownerCaller \} from .*$/m, 'const ownerCaller = async () => globalThis.__owner')
const tmp = path.join(process.cwd(), 'supabase/functions/step1-import/_t.ts'); fs.writeFileSync(tmp, src)
let M; try { M = await import(tmp) } finally { fs.unlinkSync(tmp) }
globalThis.__emptyFacts = M.cleanFacts('{}')   // exactly what the first 458 run saved for the 48 empty records
globalThis.__owner = true
const call = async (body) => { const r = await handler(new Request('https://x/f', { method: 'POST', body: JSON.stringify(body) })); return [r.status, await r.json()] }
AI_REPLY = 'Here you go: ' + JSON.stringify({
  own_words: { interest: 'I love older people and hearing their stories.', qualities: 'Patient, kind, on time.', why_us: 'My friend works here.', conversation: 'yes', hobbies: 'Gardening, baking — and church choir' },
  experience: { jobs: [{ title: 'CNA', from: '2019', to: '2023', duties: 'Bathing, meals, call 417-555-0199 for details' }, { title: 'Server', from: '2017', to: '2019', duties: 'Waited tables' }], education: { highest: 'high school', subject: null, graduated: 'yes' } },
  matching: { services: ['companionship', 'Meal Preparation', 'dementia care', 'bank robbery'], hospice: 'yes', cats: 'no', dogs: 'yes', client_smokes: 'no', travel_miles: '25', basic_meal: 'yes', daily_living_help: 'with training', has_gps: 'yes', smoker: 'no' },
  availability: { start_date: 'Oct 15', full_or_part: 'Part-time', hours_ideal: 25, hours_min: 15, hours_max: 32, shifts: ['mornings', 'weekends', 'graveyard'], days: { monday: '8:00-14:00', tuesday: '123-45-6789' }, overnight_days: {} },
  favorites: { candy_bar: 'Snickers', soft_drink: 'Dr Pepper', restaurant: 'Olive Garden', store: 'joyce@example.com' },
  ssn: '123-45-6789', date_of_birth: '01/02/1990', address: '1 Main St', references: [{ name: 'Bob', phone: '4175550000' }] })
// ── the second net (pure) ──
const fx = M.cleanFacts(AI_REPLY)
const J = JSON.stringify(fx)
ck('only the approved groups survive: no SSN, birth date, address or references fields at all', Object.keys(fx).join() === 'own_words,experience,matching,availability,favorites' && !/123-45-6789|01\/02\/1990|Main St|Bob|4175550000/.test(J), J)
ck('a value that hides a phone number, email or SSN is dropped (job duties, a day, a favorite)', fx.experience.jobs[0].duties === null && !fx.availability.days.tuesday && fx.favorites.store === null && fx.availability.days.monday === '8:00-14:00', fx)
ck('their own words kept as written (an em dash becomes a comma)', fx.own_words.interest === 'I love older people and hearing their stories.' && fx.own_words.hobbies === 'Gardening, baking, and church choir', fx.own_words)
ck('lists only from the approved choices (made-up ones dropped), names normalised', fx.matching.services.join() === 'companionship,meal_preparation,dementia_care' && fx.availability.shifts.join() === 'mornings,weekends', [fx.matching.services, fx.availability.shifts])
ck('yes/no answers, numbers and part-time kept; "with training" kept', fx.matching.hospice === 'yes' && fx.matching.cats === 'no' && fx.matching.travel_miles === 25 && fx.availability.full_or_part === 'part-time' && fx.matching.daily_living_help === 'with training' && fx.availability.hours_max === 32)
ck('an unreadable reply is an empty record, never a crash', M.cleanFacts('nope').experience.jobs.length === 0)
ck('the AI is told what never to include', /NEVER include, anywhere/.test(M.EXTRACT_SYSTEM) && /Social Security numbers/.test(M.EXTRACT_SYSTEM) && /criminal, DUI/.test(M.EXTRACT_SYSTEM) && /name of any employer/.test(M.EXTRACT_SYSTEM) && /Never use an em dash/.test(M.EXTRACT_SYSTEM))
// ── a run ──
let [s, r] = await call({ mode: 'practice', offset: 0, limit: 3 })
const st = Object.fromEntries(r.people.map((p) => [p.who, p.state]))
ck('practice: Joyce read (newest file), nothing saved; no file / no phone said plainly', s === 200 && st['Joyce K.'] === 'would save' && st['Nora N.'] === 'no Step 1 PDF in GoHighLevel' && st['Ed N.'] === 'no phone or email in the Hub' && SAVED.length === 0 && AI.length === 1, r)
ck('practice report: counts per group only, no answers', JSON.stringify(r.people[0].found) === JSON.stringify({ own_words: 5, jobs: 2, matching: 10, availability: 7, favorites: 3 }) && !/Snickers|stories|CNA/.test(JSON.stringify(r)), r.people[0])
ck('the AI got the PDF and no temperature setting', AI[0].messages[0].content[0].type === 'document' && !('temperature' in AI[0]) && AI[0].model === 'claude-sonnet-5-5')
ck('every GoHighLevel call is a read', GHLCALLS.filter((x) => x.includes('leadconnectorhq')).every((x) => x.startsWith('GET ')), GHLCALLS)
SAVED = []; AI = []
;[s, r] = await call({ mode: 'live', offset: 0, limit: 3 })
const sv = SAVED[0]
ck('live: one row for Joyce, keyed by her Hub id, with her AxisCare and candidate ids and the file it came from', SAVED.length === 1 && sv.o.onConflict === 'hub_caregiver_id' && sv.r.hub_caregiver_id === '101' && sv.r.axiscare_id === '9001' && sv.r.candidate_id === '55' && sv.r.ghl_file_key === 'fileB' && sv.r.facts.own_words.hobbies, sv)
;[s, r] = await call({ mode: 'live', offset: 3, limit: 1 })
ck('a PDF already read (same GoHighLevel file) is skipped', r.people[0].state === 'already read' && SAVED.length === 1, r)
globalThis.__owner = false; ;[s, r] = await call({}); ck('anyone but the owner: refused', s === 401)
const sql = fs.readFileSync('caregiver_application_facts_458.sql', 'utf8')
ck('SQL: office staff read only, the server writes, the public nothing; safe twice', /revoke all privileges on public\.caregiver_application_facts from anon, authenticated;/.test(sql) && /grant select on public\.caregiver_application_facts to authenticated;/.test(sql) && /create table if not exists/.test(sql) && !/drop table|truncate|delete from/i.test(sql.replace(/--.*$/gm, '')))
// ── 458c: a STORED empty record (all its blanks saved as null) must count as empty, so it is read again ──
const storedEmpty = JSON.parse(JSON.stringify(M.cleanFacts('{}')))
ck('458c: an empty record that was saved (blanks as null) still counts as empty: hours and miles stay blank, never 0', M.total(M.groupsFilled(M.cleanFacts(storedEmpty))) === 0 && M.cleanFacts(storedEmpty).matching.travel_miles === null && M.cleanFacts(storedEmpty).availability.hours_ideal === null, M.groupsFilled(M.cleanFacts(storedEmpty)))
ck('458c: a real 0 is still kept as 0', M.cleanFacts({ matching: { travel_miles: 0 } }).matching.travel_miles === 0)
// ── 458b: what broke the first run ──
globalThis.__owner = true; SAVED = []; globalThis.__thinking = true
;[s, r] = await call({ mode: 'live', offset: 0, limit: 1 })
ck('458b: a reply whose first part is not text (and is wrapped in a code fence) is still read; Joyce\'s EMPTY first-run record is read again', r.people[0].state === 'saved' && SAVED.length === 1 && SAVED[0].r.facts.own_words.hobbies, r.people[0])
ck('458b: the report says the reply\'s shape (block types, size, stop, JSON yes/no, key names), never its words', r.people[0].shape.blocks === 'thinking+text' && r.people[0].shape.parsed === true && /own_words,experience/.test(r.people[0].shape.keys) && !/Snickers|stories/.test(JSON.stringify(r.people[0].shape)), r.people[0].shape)
globalThis.__thinking = false; SAVED = []; const keep = AI_REPLY; AI_REPLY = 'I am sorry, I cannot help with that document.'
;[s, r] = await call({ mode: 'live', offset: 0, limit: 1 })
ck('458b: a reply with no details is NOT saved; it says so, with its shape', /read, but nothing came out/.test(r.people[0].state) && SAVED.length === 0 && r.people[0].shape.parsed === false, r.people[0])
AI_REPLY = keep
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note)); if (ok) pass++ }
console.log(pass === res.length ? `ALL ${res.length} CHECKS PASS` : `${res.length - pass} OF ${res.length} FAILED`); process.exit(pass === res.length ? 0 : 1)
