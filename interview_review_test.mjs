// 648 · the AI Interview Review's rules (_shared/interview-review.ts) and the interview-review function, run for real
// against a fake database and a fake Anthropic. node interview_review_test.mjs
import fs from 'fs'; import path from 'path'; import os from 'os'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 600)])
const L = await import(path.join(FN, '_shared/interview-review.ts'))
const A = 'Speaker B', I = 'Speaker A'
const parts = [{ rec: 'r1', part: 1, turns: [
  { name: I, start: 0, end: 10, text: 'Thanks for coming in. Tell me a little about yourself.' },
  { name: A, start: 9, end: 40, text: "I was with Comfort Keepers almost three years, mostly dementia and two Parkinson's clients." },
  { name: I, start: 41, end: 50, text: 'Tell me about a time something was wrong.' },
  { name: A, start: 51, end: 300, text: 'She was sleeping so I ran to the store for maybe twenty minutes. Mrs. Patterson on Elm Street, she had it real bad.' },
] }, { rec: 'r2', part: 2, turns: [
  { name: I, start: 0, end: 5, text: 'Any questions for me?' },
  { name: A, start: 4, end: 20, text: 'I like having the same people every week.' },
] }]

ck('quotes are found with their part and time (curly quotes and case do not matter)', JSON.stringify(L.findQuote(parts, 'mostly dementia and two Parkinson’s clients', A)) === JSON.stringify({ part: 1, at: 9, rec: 'r1' }))
ck('...in part 2 too', L.findQuote(parts, 'the same people every week', A)?.part === 2)
ck('...a made-up quote is not found', L.findQuote(parts, 'I have never been late in my life', A) === null)
const parsed = { applicant_speaker: A, summary: 'Three years of home care.',
  strengths: [{ said: [{ quote: 'almost three years, mostly dementia' }], note: 'Dementia experience.' },
              { said: [{ quote: 'I invented this quote entirely' }], note: 'made up' }],
  concerns: [{ said: [{ quote: 'ran to the store for maybe twenty minutes' }, { quote: '1 to 3 years', source: 'application' }], clarify: 'Was the client safe to leave?' }],
  safety: [{ said: [{ quote: 'Mrs. Patterson on Elm Street' }], clarify: 'Named a past client and street. Ask about privacy.' }],
  missed: [{ text: 'Question 5 was half answered.' }], reference_questions: [{ text: 'Did Jordan ever leave a client alone?' }],
  score: 9, recommendation: 'hire' }
const v = L.verify(parsed, parts, 'Years of experience: 1 to 3 years')
ck('an item whose only quote is not in the transcript is dropped, and counted', v.dropped === 1 && !v.items.some((x) => /made up/.test(x.text || '')), v)
ck('every kept quote carries where it was said (from the transcript, not the AI)', v.items.filter((x) => x.said.length).every((x) => x.said.some((s) => s.source === 'transcript' && typeof s.at === 'number')), v.items)
ck('an application quote is kept only when it is really on the application', v.items.find((x) => x.section === 'concerns').said.some((s) => s.source === 'application'))
ck('said and suggested are kept apart (said[] vs clarify)', v.items.find((x) => x.section === 'safety').clarify.startsWith('Named a past client') && v.items.find((x) => x.section === 'safety').said[0].quote === 'Mrs. Patterson on Elm Street')
ck('missed questions and reference questions need no quote', v.items.filter((x) => x.section === 'missed' || x.section === 'reference_questions').length === 2)
ck('a score or recommendation from the AI is never kept', !JSON.stringify(v).includes('recommendation') && !JSON.stringify(v).includes('"score"'))
const st = L.stats(parts, A)
ck('talk share from the timings', st.applicant_share === Math.round((31 + 249 + 16) / (10 + 31 + 9 + 249 + 5 + 16) * 100), st)
ck('talking over: the applicant started while the interviewer was still talking (part 1 at 0:09, part 2 at 0:04)', st.overlap_count === 2 && st.overlaps[0].at === 9 && st.overlaps[1].part === 2, st)
ck('longest answer: 249 seconds, part 1 at 0:51', st.longest.secs === 249 && st.longest.at === 51, st.longest)
const facts = L.applicationFacts({ first_name: 'J', ssn: '123-45-6789', dob: '1990-01-01', phone: '4175550101', email: 'x@y.com', address: '1 Elm', hours_wanted: 30, city: 'Nixa', experience_kinds: [] })
ck('application facts: nothing private (no SSN, birth date, phone, email, address), empties left out', /Hours a week wanted: 30/.test(facts) && /Town: Nixa/.test(facts) && !/123-45|1990|4175550101|x@y|1 Elm|Kinds/.test(facts), facts)
const pr = L.buildPrompt('full', 'Jordan', L.transcriptText(parts), ['1. Tell me about yourself'], facts)
ck('the prompt forbids scores, verdicts and personality, accent or tone judgments, and protected traits', /Never give a hiring recommendation, a score/.test(pr) && /accent, grammar, tone/.test(pr) && /religion, pregnancy/.test(pr), '')
ck('...asks for exact quotes, kept apart from suggestions', /exact quote/.test(pr) && /"clarify" is a neutral question/.test(pr))
ck('...the transcript shows part numbers when there are two parts', /--- Part 2 ---/.test(pr) && /\[P2 0:04\]/.test(pr))
ck('the quick check (before they leave) asks only for concerns and missed questions', /"missed"/.test(L.buildPrompt('check', 'J', 'x', [], '')) && !/"summary"/.test(L.buildPrompt('check', 'J', 'x', [], '')))

/* ── the function, with a fake database and a fake Anthropic ── */
let T, INS, AI
const reset = () => { INS = []; T = {
  job_applicants: [{ id: '11111111-1111-1111-1111-111111111111', first_name: 'Jordan', last_name: 'Ellis', position: 'caregiver', ssn: '123-45-6789', hours_wanted: 30 }],
  recordings: [{ id: 'r1', kind: 'interview', subject_id: '11111111-1111-1111-1111-111111111111', status: 'done', consent_given: true, turns: parts[0].turns, created_at: '1' },
               { id: 'r2', kind: 'interview', subject_id: '11111111-1111-1111-1111-111111111111', status: 'done', consent_given: true, turns: parts[1].turns, created_at: '2' }],
  interview_questions: [{ question: 'Tell me about yourself', sort: 1, position: 'caregiver', active: true }], interview_reviews: [] } }
const q = (t) => { const f = []; let ins = null; const b = { select() { return b }, eq(c, v) { f.push([c, v]); return b }, order() { return b },
  insert(r) { ins = r; return b }, single() { return b.maybeSingle() },
  maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? x.data[0] ?? null : x.data, error: x.error })) },
  then(ok) { if (ins) { const row = { id: 'rv1', created_at: 'now', ...ins }; T[t].push(row); INS.push(row); return Promise.resolve({ data: [row], error: null }).then(ok) }
    return Promise.resolve({ data: (T[t] || []).filter((r) => f.every(([c, v]) => r[c] === undefined || r[c] === v)), error: null }).then(ok) } }; return b }
globalThis.__db = { from: q }
globalThis.fetch = async (url, o) => { AI = JSON.parse(o.body); return new Response(JSON.stringify({ content: [{ text: 'Here you go: ' + JSON.stringify(parsed) }] }), { status: 200 }) }
let handler
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'k', ANTHROPIC_API_KEY: 'a' })[k] ?? '' }, serve: (h) => { handler = h } }
let src = fs.readFileSync(path.join(FN, 'interview-review/index.ts'), 'utf8')
src = src.replace(/^import \{ createClient \} from .*$/m, 'const createClient = (..._a: any[]) => (globalThis as any).__db')
  .replace(/^import \{ requireStaff, OFFICE_ROLES \} from .*$/m, 'const OFFICE_ROLES: string[] = []; const requireStaff = async (..._a: any[]) => (globalThis as any).__staff')
  .replace(/'\.\.\/_shared\//g, "'" + path.join(FN, '_shared') + '/')
const tmp = path.join(os.tmpdir(), 'ir648_' + process.pid + '.ts'); fs.writeFileSync(tmp, src); try { await import(tmp) } finally { fs.unlinkSync(tmp) }
const call = async (body) => { const r = await handler(new Request('https://x/f', { method: 'POST', body: JSON.stringify(body) })); return [r.status, await r.json()] }
const ID = '11111111-1111-1111-1111-111111111111'
reset(); globalThis.__staff = { ok: false, status: 401, error: 'Sign in first.' }
let [s, j] = await call({ applicant_id: ID }); ck('someone without an office role is refused, nothing read or sent', s === 401 && !AI, [s, j])
globalThis.__staff = { ok: true, name: 'Samantha', email: 's@x' }
reset(); [s, j] = await call({ applicant_id: ID, kind: 'full' })
ck('Analyze: reads both parts, saves one review row (who, model, which recordings)', s === 200 && INS.length === 1 && INS[0].created_by === 'Samantha' && INS[0].recording_ids.join() === 'r1,r2' && INS[0].model === 'claude-sonnet-5-5', [s, j, INS[0]])
ck('...the saved review has the verified items, the counts, and no score', j.review.items.length === 5 && j.review.stats.overlap_count === 2 && !JSON.stringify(j.review).includes('recommendation'), j.review)
const sent = AI.messages[0].content
ck('...what went to the AI: first name only, never the last name or SSN', /Jordan/.test(sent) && !/Ellis|123-45/.test(sent))
reset(); T.recordings.forEach((r) => { r.consent_given = false }); AI = null; [s, j] = await call({ applicant_id: ID })
ck('no consent on the recordings: refused, nothing sent to the AI', s === 409 && /without consent/.test(j.error) && !AI, [s, j])
reset(); T.recordings[0].status = 'transcribing'; T.recordings.pop(); AI = null; [s, j] = await call({ applicant_id: ID })
ck('transcript not finished: says so, nothing sent', s === 409 && /not finished/.test(j.error) && !AI, j)
reset(); [s, j] = await call({ applicant_id: ID, kind: 'check' })
ck('Check before they leave: the short prompt, saved as kind check', s === 200 && INS[0].kind === 'check' && AI.max_tokens === 2000, [s, INS[0] && INS[0].kind])
globalThis.fetch = async () => new Response(JSON.stringify({ content: [{ text: 'sorry' }] }), { status: 200 })
reset(); [s, j] = await call({ applicant_id: ID }); ck('an unreadable AI answer saves nothing and says try again', s === 502 && INS.length === 0, j)
const sql = fs.readFileSync(path.join(ROOT, 'interview_reviews_648.sql'), 'utf8')
ck('the table: office only to read and to mark (hub_office_ok), only marks can be changed by the office, nothing for signed-out', /using \(public\.hub_office_ok\(\)\)/.test(sql) && /grant update \(marks\)/.test(sql) && /revoke all on public\.interview_reviews from public, anon, authenticated/.test(sql))
ck('no em dashes in anything new', ![sql, fs.readFileSync(path.join(FN, 'interview-review/index.ts'), 'utf8'), fs.readFileSync(path.join(FN, '_shared/interview-review.ts'), 'utf8')].some((x) => x.includes('—')))
for (const [n, ok, note] of res) console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok ? '' : '  ' + note))
console.log(res.filter((r) => r[1]).length + '/' + res.length + ' passed'); if (res.some((r) => !r[1])) process.exit(1)
