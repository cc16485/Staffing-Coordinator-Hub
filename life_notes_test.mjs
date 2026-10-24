// LIFE STORY SUGGESTIONS FROM SHIFT NOTES (2026-10-24, step 3, practice). The rules (_shared/life-notes.ts) and the real
// care-notes run (flagRun) against a fake database, fake AxisCare visits and a fake AI. Proves: only safe kinds, the
// caregiver's real words, nothing sensitive, no family names kept; repeats combined by topic per client with counts and
// caregivers; the same note never counted twice; topics already in the Life Story marked known; "mentioned once" vs "seen
// often" is only a label; practice writes only life_note_suggestion (nothing on profiles, no cards); off = nothing asked;
// the existing concern and Kind Words checks unchanged; the read-back route is the owner's key only.
// node life_notes_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1200)])
const FN = 'supabase/functions'
const LN = await import(path.join(process.cwd(), FN, '_shared/life-notes.ts'))

/* ── 1. the rules ── */
ck('topics combine: "Word puzzles" = "word puzzle"; "Playing cards" = "cards"; "Game shows" = "game show"', LN.topicKey('Word puzzles') === LN.topicKey('word puzzle') && LN.topicKey('Playing cards') === LN.topicKey('cards') && LN.topicKey('Game shows') === LN.topicKey('game show'), [LN.topicKey('Word puzzles'), LN.topicKey('Playing cards'), LN.topicKey('Game shows')])
ck('already in the Life Story: "cards" is known when the Life Story says "Playing cards (sometimes for hours)"; "knitting" is not', LN.inLifeStory('cards', 'Playing cards (sometimes for hours), word search and word puzzles') && LN.inLifeStory('Word puzzles', 'word search and word puzzles') && !LN.inLifeStory('knitting', 'Playing cards'))
const now = '2026-10-24T12:00:00Z'
let r = LN.addMention(null, { ax: '115', client_first: 'Patsy', topic: 'Cards', key: 'card', kind: 'activity', ref: 'carenote:1|115|2026-10-16', cg: 'Mary', day: '2026-10-16', visit_id: 'v1', words: 'played cards at the table', known: false }, now)
ck('first mention: practice, once, one caregiver', r.status === 'practice' && r.mentions === 1 && r.caregivers.join() === 'Mary' && LN.howOften(r) === 'mentioned once')
ck('the same note again is not counted twice', LN.addMention(r, { ax: '115', client_first: 'Patsy', topic: 'Cards', key: 'card', kind: 'activity', ref: 'carenote:1|115|2026-10-16', cg: 'Mary', day: '2026-10-16', visit_id: 'v1', words: 'x', known: false }, now) === null)
r = LN.addMention(r, { ax: '115', client_first: 'Patsy', topic: 'Card games', key: 'card', kind: 'activity', ref: 'carenote:2|115|2026-10-18', cg: 'Nerma', day: '2026-10-18', visit_id: 'v2', words: 'we played a card game', known: false }, now)
ck('a second caregiver: combined, 2 notes, 2 caregivers, "seen often" (a label only, still practice)', r.mentions === 2 && r.caregivers.join() === 'Mary,Nerma' && LN.howOften(r) === 'seen often' && r.status === 'practice' && r.sources.length === 2)
ck('family names masked in the words kept ("cards for several hours with Lisa" -> "with ..."); the client and the topic kept', LN.maskNames('We played cards for several hours today with Lisa', 'Patsy', 'cards') === 'We played cards for several hours today with ...' && LN.maskNames('Patsy did her puzzle book', 'Patsy', 'word puzzles') === 'Patsy did her puzzle book' && LN.maskNames('watched Family Feud', 'Patsy', 'Family Feud') === 'watched Family Feud')
let AIQ = [], AIREQ = []
const fakeAI = async (url, o) => { AIREQ.push(JSON.parse(o.body)); const a = AIQ.shift(); return a === 'down' ? new Response('', { status: 500 }) : new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(a || { details: [] }) }] }), { status: 200 }) }
const NOTE = 'Care note: Patsy did her word search, then we played cards. She had diarrhea all morning. She talked to Lisa. We watched Family Feud.'
AIQ.push({ details: [{ topic: 'Word puzzles', kind: 'activity', words: 'did her word search' }, { topic: 'Diarrhea', kind: 'activity', words: 'She had diarrhea all morning' }, { topic: 'Lisa', kind: 'conversation', words: 'She talked to Lisa' }, { topic: 'Family Feud', kind: 'tv_music_books', words: 'We watched Family Feud' }] })
let a = await LN.askLife(NOTE, 'k', fakeAI)
ck('the AI\'s answer is checked: at most 3 looked at; a health detail and a person\'s name rejected; the rest kept', a.details.map((x) => x.topic).join() === 'Puzzles' && a.rejected === 2, a)
AIQ.push({ details: [{ topic: 'Bingo', kind: 'activity', words: 'loves bingo night' }, { topic: 'Her son', kind: 'conversation', words: 'talked to Lisa' }, { topic: 'Cards', kind: 'medical', words: 'played cards' }] })
a = await LN.askLife(NOTE, 'k', fakeAI)
ck('words not in the note, a family topic, and a kind outside the safe list are all rejected', a.details.length === 0 && a.rejected === 3, a)
ck('the AI is told the safe kinds and the rules, answers in a fixed format, on Claude Haiku 4.5 (the note check\'s model), no temperature', AIREQ[0].model === 'claude-haiku-4-5' && !('temperature' in AIREQ[0]) && AIREQ[0].output_config.format.type === 'json_schema' && /Never anything about health/.test(AIREQ[0].system))
AIQ.push('down'); a = await LN.askLife(NOTE, 'k', fakeAI)
ck('the AI can\'t be reached: nothing kept', a.failed && a.details.length === 0)

/* ── 1b. the four tweaks (2026-10-24, after the first read-back) ── */
ck('similar topics are one: TV / television / TV shows / watching TV; drives / driving / scenery; chatting / visiting / conversation; word search / crossword / puzzle book', new Set(['TV', 'television', 'TV shows', 'watching TV'].map(LN.topicKey)).size === 1 && new Set(['drives', 'driving', 'Scenery drives'].map(LN.topicKey)).size === 1 && new Set(['chatting', 'visiting', 'conversation', 'socializing'].map(LN.topicKey)).size === 1 && new Set(['word search', 'crosswords', 'puzzle book'].map(LN.topicKey)).size === 1, ['TV', 'television', 'drives', 'chatting', 'word search'].map(LN.topicKey))
ck('different things stay apart: game shows vs TV; football vs movies', LN.topicKey('game shows') !== LN.topicKey('TV') && LN.topicKey('college football') !== LN.topicKey('movies'))
const N2 = 'Care note: I made coffee. Fed the cats. We talked about my wedding. She ate eggplant parmesan. She wanted Huey Magoos for lunch. She asked for a Dr Pepper. Did her leg exercise on her trike. Watched the health video exercises. She loves painting her nails.'
AIQ.push({ details: [{ topic: 'Coffee', kind: 'food_drink', words: 'I made coffee' }, { topic: 'Weddings', kind: 'conversation', words: 'We talked about my wedding' }, { topic: 'Eggplant parmesan', kind: 'food_drink', words: 'She ate eggplant parmesan' }] })
a = await LN.askLife(N2, 'k', fakeAI)
ck('left out: the caregiver\'s task ("I made coffee"), the caregiver\'s own life ("my wedding"), a meal simply eaten', a.details.length === 0 && a.rejected === 3, a)
AIQ.push({ details: [{ topic: 'Huey Magoos', kind: 'food_drink', words: 'She wanted Huey Magoos for lunch' }, { topic: 'Dr Pepper', kind: 'food_drink', words: 'She asked for a Dr Pepper' }, { topic: 'Nail painting', kind: 'activity', words: 'She loves painting her nails' }] })
a = await LN.askLife(N2, 'k', fakeAI)
ck('kept: food she wanted or asked for; something she loves; grouped labels ("Soda", "Being pampered")', a.details.length === 3 && a.details.map((x) => x.topic).join() === 'Huey Magoos,Soda,Being pampered', a)
AIQ.push({ details: [{ topic: 'Leg exercise', kind: 'activity', words: 'Did her leg exercise on her trike' }, { topic: 'Videos', kind: 'activity', words: 'Watched the health video exercises' }, { topic: 'Cats', kind: 'activity', words: 'Fed the cats' }] })
a = await LN.askLife(N2, 'k', fakeAI)
ck('left out: exercise and therapy; feeding the cats (a task)', a.details.length === 0 && a.rejected === 3, a)
ck('the AI is told: the client only, not caregiver tasks or the caregiver\'s life, food only when wanted, no exercise or therapy', /not the client's interests/.test(AIREQ[AIREQ.length - 1].system) && /caregiver's own life/.test(AIREQ[AIREQ.length - 1].system) && /wanted, asked for, chose or loved/.test(AIREQ[AIREQ.length - 1].system) && /exercise, therapy/.test(AIREQ[AIREQ.length - 1].system))
ck('the show rule: generic topics and food only once seen often; known never; a specific interest once is enough', !LN.worthShowing({ topic_key: 'tv', kind: 'tv_music_books', status: 'practice', mentions: 1, caregivers: ['A'] }) && LN.worthShowing({ topic_key: 'tv', kind: 'tv_music_books', status: 'practice', mentions: 3, caregivers: ['A'] }) && !LN.worthShowing({ topic_key: 'huey magoo', kind: 'food_drink', status: 'practice', mentions: 1, caregivers: ['A'] }) && LN.worthShowing({ topic_key: 'birds', kind: 'activity', status: 'practice', mentions: 1, caregivers: ['A'] }) && !LN.worthShowing({ topic_key: 'cards and games', kind: 'activity', status: 'known', mentions: 9, caregivers: ['A', 'B'] }))

/* ── 2. the real care-notes run ── */
let T, APP
const reset = () => { APP = { ops_settings: { care_notes_flag_live: true }, client_profiles: [{ id: 'cp_ax115', life: { enjoys: { text: 'Playing cards (sometimes for hours), word search and word puzzles' } } }], ops_items: [] }; T = { life_note_suggestion: [], kind_words: [] } }
const q = (t) => { const st = { f: [] }; const b = {
  select() { return b }, order() { return b }, limit() { return b }, is() { return b }, in() { return b },
  eq(c, v) { st.f.push([c, v]); return b },
  update(vals) { return { eq: (c, v) => { const rows = (T[t] ||= []); const i = rows.findIndex((x) => x[c] === v); if (i >= 0) rows[i] = { ...rows[i], ...vals }; return Promise.resolve({ data: null, error: null }) } } },
  insert(row) { (T[t] ||= []).push({ id: 'id' + Math.random().toString(36).slice(2), ...row }); return Promise.resolve({ data: null, error: null }) },
  maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: null })) },
  then(ok, bad) {
    if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]; return Promise.resolve({ data: k in APP ? [{ key: k, data: APP[k] }] : [], error: null }).then(ok, bad) }
    let rr = T[t] ?? []; for (const [c, v] of st.f) rr = rr.filter((x) => x[c] === v)
    return Promise.resolve({ data: rr, error: null }).then(ok, bad) } }; return b }
const RPC = []
const DB = { from: q, rpc: async (fn, x) => { RPC.push([fn, x?.target_key]); return { data: null, error: null } } }
globalThis.__db = DB
const hAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString()
const VISITS = [
  { id: 'v1', client: { id: 115, firstName: 'Patsy', lastName: 'W' }, caregiver: { id: 1, firstName: 'Mary', lastName: 'E' }, startDate: hAgo(6), clockOut: { time: hAgo(4) }, careNote: 'Patsy and I played cards at the table. She watched Family Feud.', adls: [] },
  { id: 'v2', client: { id: 115, firstName: 'Patsy', lastName: 'W' }, caregiver: { id: 2, firstName: 'Nerma', lastName: 'K' }, startDate: hAgo(9), clockOut: { time: hAgo(7) }, careNote: 'We watched a game show, Wheel of Fortune.', adls: [] },
  { id: 'v3', client: { id: 41, firstName: 'Wanda', lastName: 'K' }, caregiver: { id: 3, firstName: 'Lacey', lastName: 'W' }, startDate: hAgo(10), clockOut: { time: hAgo(8) }, careNote: 'Wanda was reading, could not put the book down.', adls: [] },
]
let AI2 = {}
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485', ANTHROPIC_API_KEY: 'k', CARE_NOTES_PAUSE_MS: '0' }
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: () => {} }
let AICALLS = []
globalThis.fetch = async (url, o) => {
  url = String(url)
  if (url.includes('/api/visits?')) return new Response(JSON.stringify({ results: { visits: VISITS.map(({ careNote, adls, ...v }) => v) } }), { status: 200 })
  const vm = url.match(/\/api\/visits\/([^?]+)/); if (vm) { const v = VISITS.find((x) => x.id === decodeURIComponent(vm[1])); return new Response(JSON.stringify({ results: v }), { status: v ? 200 : 404 }) }
  if (url.includes('api.anthropic.com')) { const b = JSON.parse(o.body); AICALLS.push(b); const txt = String(b.messages?.[0]?.content || '')
    if (/CLIENT ENJOYS/.test(b.system)) { const hit = Object.keys(AI2).find((k) => txt.includes(k)); return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(hit ? AI2[hit] : { details: [] }) }] }), { status: 200 }) }
    return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"concern":false,"kind":false,"level":"none"}' }] }), { status: 200 }) }
  return new Response('{}', { status: 200 })
}
fs.writeFileSync(`${FN}/_shared/_job_stub_ln.ts`, "export async function jobCaller(req: Request, _c = true) { return req.headers.get('authorization') === 'Bearer OWNER' ? 'owner' : null }\n")
process.on('exit', () => { try { fs.unlinkSync(`${FN}/_shared/_job_stub_ln.ts`) } catch { /* */ } })
const src = fs.readFileSync(`${FN}/care-notes/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace(/(['"])\.\.\/_shared\/job-auth\.ts\1/, "'../_shared/_job_stub_ln.ts'")
const tmp = path.join(process.cwd(), FN, 'care-notes', '_ln.ts'); fs.writeFileSync(tmp, src)
let CN; try { CN = await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
const FOUND = { 'played cards at the table': { details: [{ topic: 'Cards', kind: 'activity', words: 'played cards at the table' }, { topic: 'Game shows', kind: 'tv_music_books', words: 'She watched Family Feud' }] },
  'Wheel of Fortune': { details: [{ topic: 'Game show', kind: 'tv_music_books', words: 'We watched a game show, Wheel of Fortune' }] },
  'could not put the book down': { details: [{ topic: 'Reading', kind: 'tv_music_books', words: 'could not put the book down' }] } }

reset(); AI2 = FOUND; AICALLS = []
let out = await CN.flagRun(DB, { practice: false })
ck('switch off: the scheduled run asks nothing about what clients enjoy', out.life_on === false && out.life_asked === 0 && !AICALLS.some((b) => /CLIENT ENJOYS/.test(b.system)) && T.life_note_suggestion.length === 0, out)

reset(); AI2 = FOUND; APP.ops_settings.life_notes_practice = true; AICALLS = []; RPC.length = 0
out = await CN.flagRun(DB, { practice: false })
const rows = T.life_note_suggestion
const gs = rows.find((x) => x.axiscare_client_id === '115' && x.topic_key === LN.topicKey('Game shows')), cards = rows.find((x) => x.topic_key === LN.topicKey('Cards')), rd = rows.find((x) => x.axiscare_client_id === '41')
ck('practice on: each note asked once; "Game shows" from two caregivers combined (2 notes, Mary and Nerma)', out.life_asked === 3 && gs && gs.mentions === 2 && gs.caregivers.sort().join() === 'Mary,Nerma' && gs.status === 'practice', [out, rows])
ck('"Cards" is already in Patsy\'s Life Story: marked known, never a suggestion', cards && cards.status === 'known' && out.life_known === 1, cards)
ck('Wanda: "Reading", mentioned once, with Lacey and the date (no note text beyond the few words)', rd && rd.label === 'Reading' && rd.mentions === 1 && rd.sources[0].cg === 'Lacey' && rd.sources[0].visit_id === 'v3' && rd.sources[0].words === 'could not put the book down', rd)
ck('practice writes nothing else: no profile change, no cards, no Kind Words', !RPC.some(([fn, k]) => k === 'client_profiles' || (k === 'ops_items')) && JSON.stringify(APP.client_profiles[0].life.enjoys) === JSON.stringify({ text: 'Playing cards (sometimes for hours), word search and word puzzles' }), RPC)
ck('the concern check still ran as before on the same notes', AICALLS.some((b) => !/CLIENT ENJOYS/.test(b.system)))
const before = JSON.stringify(rows)
out = await CN.flagRun(DB, { practice: true, lifeOnly: true, hours: 24 })
ck('reading the same notes again (the read-back): nothing counted twice', JSON.stringify(T.life_note_suggestion) === before && out.life_same_note >= 1 && !AICALLS.slice(-3).some((b) => !/CLIENT ENJOYS/.test(b.system)), out)

/* the read-back route */
let handler2; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler2 = h } }
{ const tmp2 = path.join(process.cwd(), FN, 'care-notes', '_ln2.ts'); fs.writeFileSync(tmp2, src); try { await import(tmp2 + '?' + Math.random()) } finally { fs.unlinkSync(tmp2) } }
const call = async (qs, auth) => { const rr = await handler2(new Request('https://x/functions/v1/care-notes' + qs, { method: 'POST', headers: auth ? { Authorization: auth } : {} })); return [rr.status, await rr.json()] }
let [s, j] = await call('?life=1&hours=96&end_hours=96', 'Bearer staff')
ck('read-back route: anyone but the owner\'s key is refused', s === 401)
reset(); AI2 = FOUND
;[s, j] = await call('?life=1&hours=96', 'Bearer OWNER')
ck('read-back route (owner): collects in practice, whatever the switch; writes only the practice store', s === 200 && j.life_on && T.life_note_suggestion.length >= 3 && T.life_note_suggestion.every((x) => ['practice', 'known'].includes(x.status)), j)

for (const [n, okk, note] of res) console.log(okk ? '  ✓' : '  ✗', n, okk ? '' : note)
const bad = res.filter((x) => !x[1]); console.log(`\n${res.length - bad.length}/${res.length} passed`); process.exit(bad.length ? 1 : 0)
