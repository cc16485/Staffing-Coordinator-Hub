// Home visit stage 3 · the After screen's reader (_shared/visit-review.ts) and the visit-review function, run for real
// against a fake database and a fake Anthropic. Fictional family. node visit_review_test.mjs
import fs from 'fs'; import path from 'path'; import os from 'os'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 600)])
const L = await import(path.join(FN, '_shared/visit-review.ts'))
/* two 10-minute parts; the labels restart in part 2 (Speaker A is Karen there, Betty in part 1) */
const parts = [{ rec: 'r1', part: 1, offset: 0, turns: [
  { name: 'Speaker A', start: 5, end: 30, text: "Oh, I'm fine most days, it's just the shower that scares me now." },
  { name: 'Speaker B', start: 31, end: 50, text: 'Mom, you told me last week you skipped lunch three days in a row.' },
  { name: 'Speaker C', start: 51, end: 70, text: 'Tell me about your mornings. What time do you get up?' },
  { name: 'Speaker A', start: 71, end: 120, text: 'I get up about seven, coffee with a splash of cream, then my pills from the box Karen fills on Sundays.' },
] }, { rec: 'r2', part: 2, offset: 598, turns: [
  { name: 'Speaker A', start: 2, end: 20, text: 'She takes the evening one too, the little white one.' },
  { name: 'Speaker B', start: 21, end: 40, text: 'I only take pills in the morning, honey.' },
  { name: 'Speaker C', start: 41, end: 60, text: 'Can someone come Saturdays too? I can not always get up there.' },
  { name: 'Speaker B', start: 61, end: 90, text: 'And I use my walker in the house, but not the cane anymore.' },
] }]
const fields = L.cleanFields([
  { path: 'visit.story.morning', label: 'Morning', section: 'Their story' },
  { path: 'visit.meds.fills', label: 'Who fills the pill organizer?', section: 'Daily activities' },
  { path: 'visit.acts.bathing.level', label: 'Bathing and showering: level of need', section: 'Daily activities', options: [['none', 'None'], ['standby', 'Stand-by'], ['full', 'Full help']] },
  { path: 'visit.acts.mobility.level', label: 'Mobility: level of need', options: [['none', 'None'], ['standby', 'Stand-by'], ['full', 'Full help']] },
  { path: 'visit.allergies', label: 'Allergies' },
  { path: '../etc/passwd', label: 'bad' }, { path: 'visit.story.morning', label: 'twice' }, { path: 'constructor.prototype.x.y.z.w', label: 'too deep' },
])
ck('the box list: odd paths and repeats are thrown out', fields.length === 5 && fields[2].options.length === 3, fields)
const tx = L.transcriptText(parts)
ck('the transcript shows each part, and times run across the whole visit (part 2 starts at 9:58)', /--- Part 2 ---/.test(tx) && /\[0:10:00\] P2 Speaker A: She takes the evening one/.test(tx), tx.slice(0, 400))
ck('a quote is found with its part, its time in the visit, its time in the part and its voice label', JSON.stringify(L.findQuote(parts, 'the little white one')) === JSON.stringify({ rec: 'r2', part: 2, at: 600, local: 2, who: 'P2 Speaker A' }))
ck('...curly quotes and case do not matter', L.findQuote(parts, 'I’M FINE most days')?.part === 1)
ck('...a made-up quote is not found', L.findQuote(parts, 'she has never fallen in her life') === null)
const people = [{ name: 'Betty Harlow', rel: 'Client' }, { name: 'Karen Price', rel: 'Daughter' }]
const parsed = {
  voices: [{ label: 'P1 Speaker A', person: 'Betty Harlow' }, { label: 'P1 Speaker B', person: 'Karen Price' }, { label: 'P1 Speaker C', person: 'Caring Companions' },
    { label: 'P2 Speaker A', person: 'Karen Price' }, { label: 'P2 Speaker B', person: 'Betty Harlow' }, { label: 'P2 Speaker C', person: 'Mike Harlow (made up)' }],
  summary: 'Betty, 85, lives alone — and fell in the shower.',
  fills: [
    { path: 'visit.story.morning', value: 'Up about 7, coffee with cream, pills from the box Karen fills Sundays.', quote: 'I get up about seven, coffee with a splash of cream' },
    { path: 'visit.meds.fills', value: 'Karen, on Sundays', quote: 'the box Karen fills on Sundays' },
    { path: 'visit.acts.bathing.level', value: 'Stand-by', quote: "it's just the shower that scares me now" },
    { path: 'visit.acts.mobility.level', value: 'sometimes', quote: 'I use my walker in the house' },
    { path: 'visit.allergies', value: 'Penicillin', quote: 'penicillin gives me hives' },
    { path: 'visit.story.evening', value: 'Dinner at 5:30', quote: "I get up about seven" },
    { path: 'visit.meds.fills', value: 'again', quote: 'the box Karen fills on Sundays' },
  ],
  missed: [{ title: "Evening medicines don't match", text: 'Karen mentioned the evening one; Betty said mornings only. Ask which is right.', quote: 'I only take pills in the morning' },
    { title: 'Saturday care', text: 'Asked about Saturdays; not answered.' }],
}
const v = L.verify(parsed, parts, fields, people)
ck('answers kept: the ones whose quote is really in the transcript, for boxes on the empty list', v.fills.map((f) => f.path).join() === 'visit.story.morning,visit.meds.fills,visit.acts.bathing.level', v.fills)
ck('...a choice box takes its own choice (Stand-by becomes standby); a word that is not a choice is dropped', v.fills[2].value === 'standby' && !v.fills.some((f) => f.path === 'visit.acts.mobility.level'))
ck('...a box that is not on the empty list is dropped, a quote that is not there is dropped, each box once; all counted', v.dropped === 4, v.dropped)
ck('...each kept answer says where it was heard (from the transcript, not the reader)', v.fills.every((f) => typeof f.at === 'number' && f.rec) && v.fills[0].at === 71)
ck('missed or unclear: kept, with the time when its quote is found', v.missed.length === 2 && v.missed[0].at === 619 && v.missed[0].rec === 'r2' && v.missed[1].at === undefined, v.missed)
ck('voices: every label in every part, a name only from the people in the room (else Unknown), a sample line picked here', v.voices.length === 6 && v.voices.find((x) => x.label === 'P2 Speaker C').person === 'Unknown'
  && v.voices.find((x) => x.label === 'P1 Speaker A').person === 'Betty Harlow' && /seven/.test(v.voices.find((x) => x.label === 'P1 Speaker A').sample), v.voices)
ck('no em dashes kept from the reader', !v.summary.includes('—') && v.summary.includes(', and fell'), v.summary)
const pr = L.buildPrompt('Betty', people, fields, 'Allergies: none written', tx)
ck('the prompt: empty boxes only, never guess, exact quotes, choice keys, labels restart each part', /Fill only boxes from the list above/.test(pr) && /Never guess/.test(pr) && /character for character/.test(pr) && /choose one: none \(None\)/.test(pr) && /labels restart in every part/.test(pr))
ck('...names the people in the room and what is already on the form', /Karen Price \(Daughter\)/.test(pr) && /Allergies: none written/.test(pr))

/* ── the function, with a fake database and a fake Anthropic ── */
let T, AI, UPD
const ID = 'k3x9a1b2'
const reset = () => { AI = null; UPD = 0; T = { recordings: [
  { id: 'r2', kind: 'assessment', subject_id: ID, status: 'done', consent_given: true, turns: parts[1].turns, session_id: 's1', part: 2, offset_seconds: 598, created_at: '2' },
  { id: 'r1', kind: 'assessment', subject_id: ID, status: 'done', consent_given: true, turns: parts[0].turns, session_id: 's1', part: 1, offset_seconds: 0, created_at: '1' },
  { id: 'r3', kind: 'assessment', subject_id: ID, status: 'transcribing', consent_given: true, turns: null, session_id: 's1', part: 3, offset_seconds: 1196, created_at: '3' },
  { id: 'rX', kind: 'interview', subject_id: ID, status: 'done', consent_given: true, turns: [{ name: 'X', start: 0, text: 'an interview, never read here' }], created_at: '0' },
] } }
const q = (t) => { const f = []; const b = { select() { return b }, eq(c, v) { f.push([c, v]); return b }, order() { return b },
  update() { UPD++; return b }, insert() { UPD++; return b }, upsert() { UPD++; return b }, delete() { UPD++; return b },
  then(ok) { return Promise.resolve({ data: (T[t] || []).filter((r) => f.every(([c, v]) => r[c] === v)), error: null }).then(ok) } }; return b }
globalThis.__db = { from: q }
const okFetch = async (url, o) => { AI = JSON.parse(o.body); return new Response(JSON.stringify({ content: [{ text: 'Here it is:\n' + JSON.stringify(parsed) }] }), { status: 200 }) }
globalThis.fetch = okFetch
let handler
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'k', ANTHROPIC_API_KEY: 'a' })[k] ?? '' }, serve: (h) => { handler = h } }
let src = fs.readFileSync(path.join(FN, 'visit-review/index.ts'), 'utf8')
src = src.replace(/^import \{ createClient \} from .*$/m, 'const createClient = (..._a: any[]) => (globalThis as any).__db')
  .replace(/^import \{ requireStaff, OFFICE_ROLES \} from .*$/m, 'const OFFICE_ROLES: string[] = []; const requireStaff = async (..._a: any[]) => (globalThis as any).__staff')
  .replace(/'\.\.\/_shared\//g, "'" + path.join(FN, '_shared') + '/')
const tmp = path.join(os.tmpdir(), 'vr_' + process.pid + '.ts'); fs.writeFileSync(tmp, src); try { await import(tmp) } finally { fs.unlinkSync(tmp) }
const call = async (body, method = 'POST') => { const r = await handler(new Request('https://x/f', { method, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) })); return [r.status, method === 'POST' ? await r.json() : null, r.headers.get('access-control-allow-origin')] }
const BODY = { assessment_id: ID, client: 'Betty', people, known: 'Allergies: (empty)', fields: fields }
let [s, j, cors] = await call(null, 'OPTIONS'); ck('the Hub can reach it from the browser (CORS answer)', s === 200 && cors === '*')
reset(); globalThis.__staff = { ok: false, status: 401, error: 'Sign in first.' }
;[s, j] = await call(BODY); ck('someone without an office role is refused, nothing read or sent', s === 401 && !AI, [s, j])
globalThis.__staff = { ok: true, name: 'Samantha', email: 's@x' }
reset(); [s, j] = await call(BODY)
ck('reads the visit: both finished parts in order, the interview recording is never read', s === 200 && j.parts.map((p) => p.rec).join() === 'r1,r2' && !/never read here/.test(AI.messages[0].content), [s, j.parts])
ck('...answers, voices, missed and summary come back verified; the part still being written out is counted', j.fills.length === 3 && j.voices.length === 6 && j.missed.length === 2 && j.parts_waiting === 1 && j.dropped === 4, j)
ck('...saves nothing on the server', UPD === 0)
ck('...says who asked and which reader answered', j.by === 'Samantha' && j.model === 'claude-opus-5-5')
reset(); T.recordings.forEach((r) => { r.consent_given = false }); [s, j] = await call(BODY)
ck('no consent: refused, nothing sent', s === 409 && /without consent/.test(j.error) && !AI, j)
reset(); T.recordings = T.recordings.filter((r) => r.id === 'r3'); [s, j] = await call(BODY)
ck('nothing written out yet: says try again in a few minutes, nothing sent', s === 409 && /still being written out/.test(j.error) && !AI, j)
reset(); T.recordings = []; [s, j] = await call(BODY)
ck('no recording: says so', s === 409 && /no recording/.test(j.error), j)
reset(); [s, j] = await call({ ...BODY, assessment_id: "x' or 1=1" }); ck('a strange visit id is refused', s === 400 && !AI)
globalThis.fetch = async () => new Response(JSON.stringify({ content: [{ text: 'sorry, I cannot' }] }), { status: 200 })
reset(); [s, j] = await call(BODY); ck('an unreadable answer: says try again, nothing changed', s === 502 && /try again/.test(j.error) && UPD === 0, j)
globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: 'overloaded' } }), { status: 529 })
reset(); [s, j] = await call(BODY); ck('the reader service is down: says so with its words', s === 502 && /overloaded/.test(j.error), j)
globalThis.fetch = okFetch
ck('no em dashes in anything new', ![fs.readFileSync(path.join(FN, 'visit-review/index.ts'), 'utf8'), fs.readFileSync(path.join(FN, '_shared/visit-review.ts'), 'utf8')].some((x) => x.includes('—')))
for (const [n, ok, note] of res) console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok ? '' : '  ' + note))
console.log(res.filter((r) => r[1]).length + '/' + res.length + ' passed'); if (res.some((r) => !r[1])) process.exit(1)
