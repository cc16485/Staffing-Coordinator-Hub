// Care plan Stage 1 · the draft from the whole home visit (_shared/careplan-draft.ts and ai-draft-careplan mode 'visit'),
// run for real against a fake database, a fake AxisCare and a fake drafting service. Made-up family. node careplan_draft_test.mjs
import fs from 'fs'; import path from 'path'; import os from 'os'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 700)])
const L = await import(path.join(FN, '_shared/careplan-draft.ts'))

const parts = [{ rec: 'r1', part: 1, offset: 0, turns: [
  { name: 'Speaker A', start: 40, text: 'I like to shower after breakfast, not first thing, and I keep a towel over my lap.' },
  { name: 'Speaker B', start: 80, text: 'The towels are in the hall closet on the top shelf.' },
] }, { rec: 'r2', part: 2, offset: 598, turns: [
  { name: 'Speaker B', start: 12, text: 'If she gets dizzy standing up she needs to sit right down.' },
] }]
const facts = L.cleanFacts([
  { path: 'visit.acts.bathing.level', label: 'Bathing and showering: level of need', section: 'Daily activities', value: 'Stand-by' },
  { path: 'visit.equipment', label: 'Equipment', section: 'Health', value: 'Shower chair, Grab bars, Walker' },
  { path: 'visit.safety.falls', label: 'Falls in the last 6 months', section: 'Safety', value: 'Yes' },
  { path: 'visit.safety.falls_note', label: 'The fall', section: 'Safety', value: 'Fell in the shower Oct 12' },
  { path: 'visit.acts.meals.level', label: 'Meal preparation', section: 'Daily activities', value: 'Full help' },
  { path: 'bad path!', label: 'x', value: 'y' }, { path: 'visit.empty', label: 'blank', value: '' },
])
ck('visit answers: odd paths and blank answers are thrown out', facts.length === 5, facts)
ck('the schedule becomes AxisCare days (Tue, Thu)', L.scheduleDays({ tue: { from: '09:00', to: '13:00' }, thu: { from: '09:00', to: '13:00' }, sat: { from: '' } }).join() === 'T,R')
const adls = [{ id: 11, name: 'Bathing - Shower', adlKey: 'shower' }, { id: 12, name: 'Meal Preparation' }, { id: 13, name: 'Medication Reminder' }]
const parsed = {
  fields: { adl_needs: { text: 'Stand-by help in the shower.', src: [{ path: 'visit.acts.bathing.level' }] },
            medications: { text: 'Takes warfarin daily.', src: [{ path: 'visit.made.up' }] },
            safety_concerns: { text: 'Fell in the shower Oct 12.', src: [{ path: 'visit.safety.falls_note' }] },
            narrative: { text: 'Betty likes her shower after breakfast.', src: [{ quote: 'I like to shower after breakfast, not first thing' }] } },
  tasks: [
    { adl_id: 11, days: ['T', 'R', 'S'], require: 1, when: 1,
      when_text: { text: 'Tuesdays and Thursdays, after breakfast', src: [{ quote: 'shower after breakfast' }, { path: 'visit.acts.bathing.level' }] },
      how: [{ text: 'Ask before starting; she showers after breakfast.', src: [{ quote: 'I like to shower after breakfast, not first thing' }] },
            { text: 'Stay within arm’s reach while she sits on the shower chair.', src: [{ path: 'visit.equipment' }, { path: 'visit.acts.bathing.level' }] },
            { text: 'Use the lavender soap she loves.', src: [] }],
      equipment: { text: 'Shower chair and grab bars. Towels in the hall closet, top shelf.', src: [{ path: 'visit.equipment' }, { quote: 'The towels are in the hall closet on the top shelf.' }] },
      preferences: { text: 'She keeps a towel over her lap.', src: [{ quote: 'I keep a towel over my lap' }] },
      safety: { text: 'If she is dizzy standing, sit her down.', src: [{ quote: 'If she gets dizzy standing up she needs to sit right down.' }] },
      report_if: { text: 'A new bruise.', src: [{ quote: 'she bruises so easily these days' }] } },
    { adl_id: 99, days: ['M'], how: [{ text: 'x', src: [{ path: 'visit.equipment' }] }] },
    { adl_id: 11, days: ['T'] },
    { adl_id: 12, days: [], require: 2, when: 3, how: [{ text: 'Make lunch.', src: [{ path: 'visit.acts.meals.level' }] }] },
  ],
  ask: ['What should the caregiver report about meals?', ''],
}
const ctx = { paths: new Set(facts.map((f) => f.path)), call: new Set(['adl_needs']), earlier: false, parts, adls, days: ['T', 'R'] }
const v = L.verify(parsed, ctx)
ck('a field whose source is a real visit answer is kept, with its source', v.fields.adl_needs.text === 'Stand-by help in the shower.' && !v.fields.adl_needs.ask && v.fields.adl_needs.src[0].path === 'visit.acts.bathing.level')
ck('a field citing an answer that does not exist (a made-up medicine) comes back empty and marked Ask before approving', v.fields.medications.text === '' && v.fields.medications.ask, v.fields.medications)
ck('a field quoting the recording gets the time from the transcript (part 1 at 0:40)', v.fields.narrative.src[0].at === 40 && v.fields.narrative.src[0].rec === 'r1')
ck('fields the draft left out are marked Ask before approving', v.fields.client_goals.ask && v.fields.recommended_frequency.ask)
const sh = v.tasks.find((t) => t.adl_id === 11)
ck('tasks only from AxisCare\'s list, each once (an unknown task number and a repeat are dropped)', v.tasks.map((t) => t.adl_id).join() === '11,12' && sh.name === 'Bathing - Shower' && sh.key === 'shower', v.tasks.map((t) => t.adl_id))
ck('days only from the visit\'s schedule (Saturday dropped); none given = every scheduled day', sh.days.join() === 'T,R' && v.tasks[1].days.join() === 'T,R')
ck('as needed is always any time', v.tasks[1].require === 2 && v.tasks[1].when === 0)
ck('how to help: sourced steps kept in order, a step with no source (the soap) dropped', sh.parts.how.steps.length === 2 && /Ask before starting/.test(sh.parts.how.steps[0].text) && !/lavender/.test(JSON.stringify(sh)), sh.parts.how)
ck('equipment, preferences, safety and when, each with sources that check out', !sh.parts.equipment.ask && sh.parts.equipment.src.length === 2 && !sh.parts.preferences.ask && sh.parts.safety.src[0].rec === 'r2' && sh.parts.safety.src[0].at === 610 && !sh.parts.when.ask)
ck('report if: words that were never said are not a source, so it is empty and Ask before approving', sh.parts.report_if.ask && sh.parts.report_if.text === '')
ck('a task with no parts at all: every part marked Ask', ['when', 'equipment', 'preferences', 'safety', 'report_if'].every((k) => v.tasks[1].parts[k].ask) && !v.tasks[1].parts.how.ask)
ck('everything thrown out is counted (medicine field, task 99, the repeat, the soap step, the bruise line)', v.dropped === 5, v.dropped)
ck('questions for the coordinator are kept (blanks dropped)', v.ask.length === 1)
ck('no em dashes kept', !JSON.stringify(v).includes('—'))
const pr = L.buildPrompt({ client: 'Betty', facts, call: { adl_needs: 'Help in the shower' }, earlier: '', transcript: L.transcriptText(parts), adls, days: ['T', 'R'] })
ck('the prompt: only the sources, never invent, a source on every line, six parts, no scope decisions, tasks only from the list', /Never invent/.test(pr) && /Every line names its sources/.test(pr) && /Each task has six parts/.test(pr) && /Do not decide whether a task is allowed/.test(pr) && /11: Bathing - Shower/.test(pr) && /call:adl_needs \| Help in the shower/.test(pr))
ck('...the transcript runs on visit time across parts (part 2 at 0:10:10)', /\[0:10:10\] P2 Speaker B: If she gets dizzy/.test(pr))

/* ── the function, mode 'visit', with fakes ── */
let AI = null, RECS, USER = { app_metadata: { hub_access: ['care_coordinator'] } }, AXOK = true, REPLY = parsed
const reset = () => { AI = null; AXOK = true; REPLY = parsed; RECS = [
  { id: 'r2', kind: 'assessment', subject_id: 'id_abc123', status: 'done', consent_given: true, turns: parts[1].turns, session_id: 's', part: 2, offset_seconds: 598, created_at: '2' },
  { id: 'r1', kind: 'assessment', subject_id: 'id_abc123', status: 'done', consent_given: true, turns: parts[0].turns, session_id: 's', part: 1, offset_seconds: 0, created_at: '1' },
  { id: 'r3', kind: 'assessment', subject_id: 'id_abc123', status: 'transcribing', consent_given: true, turns: null, session_id: 's', part: 3, offset_seconds: 1196, created_at: '3' },
  { id: 'rX', kind: 'assessment', subject_id: 'id_abc123', status: 'done', consent_given: false, turns: [{ text: 'no consent here' }], created_at: '0' }] }
const q = () => { const f = []; const b = { select() { return b }, eq(c, v) { f.push([c, v]); return b }, order() { return b },
  then(ok) { return Promise.resolve({ data: RECS.filter((r) => f.every(([c, v]) => r[c] === v)), error: null }).then(ok) } }; return b }
globalThis.__sb = { auth: { getUser: async () => ({ data: { user: USER }, error: null }) }, from: q }
globalThis.fetch = async (url, o) => {
  if (/axiscare\.com\/api\/adls/.test(url)) return AXOK ? new Response(JSON.stringify({ results: { data: adls.map((a) => ({ ...a, active: true })) } }), { status: 200 }) : new Response('{}', { status: 500 })
  AI = JSON.parse(o.body); return new Response(JSON.stringify({ content: [{ text: 'Here:\n' + JSON.stringify(REPLY) }] }), { status: 200 })
}
let handler
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'x', SUPABASE_ANON_KEY: 'k', ANTHROPIC_API_KEY: 'a', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485' })[k] ?? '' }, serve: (h) => { handler = h } }
let src = fs.readFileSync(path.join(FN, 'ai-draft-careplan/index.ts'), 'utf8')
src = src.replace(/^import \{ createClient \} from .*$/m, 'const createClient = (..._a: any[]) => (globalThis as any).__sb')
  .replace(/'\.\.\/_shared\//g, "'" + path.join(FN, '_shared') + '/')
const tmp = path.join(os.tmpdir(), 'cpd_' + process.pid + '.ts'); fs.writeFileSync(tmp, src); try { await import(tmp) } finally { fs.unlinkSync(tmp) }
const call = async (body) => { const r = await handler(new Request('https://x/f', { method: 'POST', headers: { Authorization: 'Bearer t' }, body: JSON.stringify(body) })); return [r.status, await r.json()] }
const BODY = { mode: 'visit', assessment_id: 'id_abc123', client: 'Betty', facts, call: { adl_needs: 'Help in the shower' }, earlier: '', week: { tue: { from: '09:00', to: '13:00' }, thu: { from: '09:00', to: '13:00' } } }
reset(); let [s, j] = await call(BODY)
ck('visit mode: the stronger model, the finished parts with consent only, the draft verified', s === 200 && AI.model === 'claude-opus-5-5' && j.model === 'claude-opus-5-5' && j.parts.map((p) => p.rec).join() === 'r1,r2' && j.parts_waiting === 1 && !/no consent here/.test(AI.messages[0].content), [s, j.error, j.parts])
ck('...returns the six-part tasks and the Ask before approving marks, saves nothing', j.tasks.length === 2 && j.tasks[0].parts.report_if.ask && j.fields.medications.ask && j.dropped === 5)
USER = { app_metadata: { hub_access: ['staffing'] } }; reset(); [s, j] = await call(BODY)
ck('someone without Care Coordinator Hub access is refused, nothing read or sent', s === 403 && !AI)
USER = { app_metadata: { hub_access: ['care_coordinator'] } }
reset(); [s, j] = await call({ ...BODY, facts: facts.slice(0, 2) })
ck('a visit with almost nothing filled in: says so, nothing sent', s === 400 && /almost nothing/.test(j.error) && !AI)
reset(); AXOK = false; [s, j] = await call(BODY)
ck("AxisCare's task list can't be read: says so, nothing sent", s === 502 && /task list/.test(j.error) && !AI)
reset(); REPLY = 'not json'; globalThis.fetch = (f => async (u, o) => /axiscare/.test(u) ? f(u, o) : new Response(JSON.stringify({ content: [{ text: 'sorry' }] }), { status: 200 }))(globalThis.fetch); [s, j] = await call(BODY)
ck('an unreadable answer: says try again, nothing changed', s === 502 && /try again/.test(j.error))
reset(); [s, j] = await call({ ...BODY, assessment_id: "x' or 1=1" }); ck('a strange visit id is refused', s === 400)
reset(); [s, j] = await call({ transcript_text: '' }); ck('the old pasted-transcript path is unchanged (still asks for a transcript)', s === 400 && /Paste the assessment transcript/.test(j.error))
ck('no em dashes in anything new', ![fs.readFileSync(path.join(FN, '_shared/careplan-draft.ts'), 'utf8')].some((x) => x.includes('—')))
for (const [n, ok, note] of res) console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok ? '' : '  ' + note))
console.log(res.filter((r) => r[1]).length + '/' + res.length + ' passed'); if (res.some((r) => !r[1])) process.exit(1)
