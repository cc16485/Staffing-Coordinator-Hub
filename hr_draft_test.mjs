// "Draft with AI" (HR Agent build step 6) · the prompt and the real function, with a fake Claude · node hr_draft_test.mjs
import fs from 'fs'; import path from 'path'; import os from 'os'
const res = []; const ck = (n, c, d) => res.push([n, !!c, c ? '' : String(JSON.stringify(d ?? null)).slice(0, 700)])
const FN = 'supabase/functions'
const tmpP = path.join(os.tmpdir(), 'hdp' + process.pid + '.ts'); fs.copyFileSync(`${FN}/_shared/hr-draft-prompt.ts`, tmpP)
let P; try { P = await import(tmpP) } finally { fs.unlinkSync(tmpP) }
const RULES = [{ t: 'rule', s: '2U Attendance & Dependability', q: 'Repeated tardiness may result in corrective action.' }, { t: 'rule', s: '2V Corrective Action', q: 'The company reserves the right to skip any step.' }, { t: 'rule', s: '2K Documentation & Daily Care Notes', q: 'Complete all required documentation before the end of the shift.' }, { t: 'watched', what: 'x' }]

// prompt
ck('the system prompt forbids invented facts, labels, client names and protected details, and em dashes', /Never invent/.test(P.SYSTEM) && /never what the person is/.test(P.SYSTEM) && /Do not name clients/.test(P.SYSTEM) && /health conditions, pregnancy/.test(P.SYSTEM) && /No em dashes/.test(P.SYSTEM) && !/—/.test(P.SYSTEM))
ck('...says the signature means receipt, not agreement', /confirms receipt, not agreement/.test(P.SYSTEM))
const item = { id: 'w1', caregiver: 'Pat Sample', axiscare_caregiver_id: '77', level: 'Verbal Warning', reason: 'Late arrivals', category: 'attendance', handbook: { section: '2U Attendance & Dependability' },
  facts: [{ date: '2026-10-03', what: 'Late 12 minutes' }], explanation: { asked_on: '2026-10-17', how: 'phone', text: 'My car broke down' } }
const u = P.buildUser(item, [{ id: 'old', status: 'issued', level: 'Verbal Warning', reason: 'Call-ins', when: '2026-06-01' }, { id: 'c', kind: 'coaching', level: 'Coaching talk', reason: 'start times', when: '2026-09-20' }], P.pickHandbook(item, RULES), 'October 18, 2026')
ck('the user text carries the facts, their side, the history and the picked handbook words', /2026-10-03: Late 12 minutes/.test(u) && /They said: My car broke down/.test(u) && /2026-06-01: Verbal Warning \(Call-ins\)/.test(u) && /2026-09-20: Coaching talk/.test(u) && /2U Attendance & Dependability: "Repeated tardiness/.test(u), u)
ck('...only the picked section is quoted', !/2K Documentation/.test(u))
ck('a declined explanation is said fairly', /chose not to give their side/.test(P.buildUser({ ...item, explanation: { asked_on: '2026-10-17', how: 'in person', declined: true } }, [], [], 'x')))
ck('no explanation yet: says so', /\(not recorded yet\)/.test(P.buildUser({ ...item, explanation: null }, [], [], 'x')))
ck('handbook: sections named in the write-up are used when none is picked', P.pickHandbook({ body: 'Handbook 2K applies' }, RULES).map((r) => r.s.split(' ')[0]).join() === '2K')
ck('handbook: nothing named, the 2V ladder', P.pickHandbook({ body: 'nothing' }, RULES).map((r) => r.s.split(' ')[0]).join() === '2V')
ck('an em dash in the record is never passed on', !/—/.test(P.buildUser({ ...item, reason: 'late — again' }, [], [], 'x')))

// the function
let APP, WHO, CALLS, REPLY
const q = () => { const st = { f: [] }; const b = { select() { return b }, eq(c, v) { st.f.push([c, v]); return b },
  maybeSingle() { const k = (st.f.find(([c]) => c === 'key') || [])[1]; return Promise.resolve({ data: k in APP ? { data: APP[k] } : null, error: null }) },
  then(r) { return r({ data: [{ topic: 'start times', status: 'done', held_on: '2026-09-20' }], error: null }) } }; return b }
globalThis.__db = { from: q }
class FakeAnthropic { constructor(o) { this.o = o; this.beta = { messages: { create: async (p) => { CALLS.push(p); if (REPLY instanceof Error) throw REPLY; return REPLY } } } } }
FakeAnthropic.APIError = class extends Error { constructor(s) { super('api'); this.status = s } }
FakeAnthropic.RateLimitError = class extends FakeAnthropic.APIError {}
globalThis.__Anthropic = FakeAnthropic
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k', ANTHROPIC_API_KEY: 'sk-test' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
fs.writeFileSync(`${FN}/_shared/_staff-auth_hd.ts`, 'export const requireStaff = async (a, req, roles) => globalThis.__who(roles)\n')
process.on('exit', () => { try { fs.unlinkSync(`${FN}/_shared/_staff-auth_hd.ts`) } catch { /* */ } })
globalThis.__who = (roles) => WHO === 'owner' ? { ok: true, email: 'zach@mo-care.com', roles: ['owner_admin'] } : WHO === 'cc' ? { ok: false, status: 403, error: 'no' } : { ok: false, status: 401, error: 'Sign in first.' }
const src = fs.readFileSync(`${FN}/hr-draft/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace(/^import Anthropic from 'npm:@anthropic-ai\/sdk'$/m, 'const Anthropic = globalThis.__Anthropic').replace(/(['"])\.\.\/_shared\/staff-auth\.ts\1/, "'../_shared/_staff-auth_hd.ts'")
const tmp = path.join(process.cwd(), FN, 'hr-draft', '_t.ts'); fs.writeFileSync(tmp, src)
try { await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
const call = async (body) => { const r = await handler(new Request('https://x/functions/v1/hr-draft', { method: 'POST', body: JSON.stringify(body) })); return { s: r.status, j: await r.json() } }
const reset = () => { CALLS = []; WHO = 'owner'; APP = { discipline_actions: [item, { id: 'w0', caregiver: 'Pat Sample', axiscare_caregiver_id: '77', status: 'issued', level: 'Verbal Warning', issued_at: '2026-06-01T12:00:00Z' }], hr_handbook: RULES }
  REPLY = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'CARING COMPANIONS: CORRECTIVE ACTION NOTICE — draft' }] } }
reset(); WHO = 'none'; let r = await call({ id: 'w1' }); ck('signed out: refused, Claude not called', r.s === 401 && !CALLS.length, r)
reset(); WHO = 'cc'; r = await call({ id: 'w1' }); ck('a Care Coordinator: refused with who can draft', r.s === 403 && /Samantha or Zach/.test(r.j.error) && !CALLS.length, r)
reset(); r = await call({ id: 'w1' }); if (process.env.DBG) console.log(CALLS[0] && CALLS[0].messages[0].content)
ck('Zach: a draft comes back, with any em dash turned into a comma', r.s === 200 && r.j.draft === 'CARING COMPANIONS: CORRECTIVE ACTION NOTICE , draft', r)
ck('...asked of Claude Opus 5.5 at medium effort, with refusal fallbacks on', CALLS[0].model === 'claude-opus-5-5' && CALLS[0].output_config.effort === 'medium' && CALLS[0].fallbacks === 'default' && CALLS[0].betas.includes('server-side-fallback-2026-07-01'), CALLS[0])
ck('...with the history (the earlier warning and the coaching talk) and the picked handbook words', /2026-06-01: Verbal Warning/.test(CALLS[0].messages[0].content) && /Coaching talk \(start times\)/.test(CALLS[0].messages[0].content) && /Repeated tardiness/.test(CALLS[0].messages[0].content))
ck('...and nothing is saved by drafting', JSON.stringify(APP.discipline_actions[0]) === JSON.stringify(item))
reset(); r = await call({ id: 'nope' }); ck('an unknown write-up: 404, Claude not called', r.s === 404 && !CALLS.length)
reset(); r = await call({}); ck('no id: 400', r.s === 400)
reset(); REPLY = { stop_reason: 'refusal', content: [] }; r = await call({ id: 'w1' }); ck('a refusal: says to write it by hand', r.s === 422 && /by hand/.test(r.j.error))
reset(); REPLY = new FakeAnthropic.RateLimitError(429); r = await call({ id: 'w1' }); ck('busy: 429 with a plain message', r.s === 429 && /busy/.test(r.j.error))
reset(); REPLY = new FakeAnthropic.APIError(500); r = await call({ id: 'w1' }); ck('an API error: 502, plain message', r.s === 502 && /did not answer/.test(r.j.error))
reset(); delete ENV.ANTHROPIC_API_KEY; r = await call({ id: 'w1' }); ck('no key on the server: says so', r.s === 500 && /key/.test(r.j.error)); ENV.ANTHROPIC_API_KEY = 'sk-test'
const body = fs.readFileSync(`${FN}/hr-draft/index.ts`, 'utf8')
ck('drafting never writes app_data', !/\.(update|upsert|insert)\(|upsert_app_data_item/.test(body))
ck('no em dashes in the service', !/—/.test(body.replace(/\\u2014/g, '')))
let f = 0; for (const [n, ok, d] of res) { console.log((ok ? 'PASS' : 'FAIL') + ' · ' + n + (ok ? '' : '  ' + d)); if (!ok) f++ }
console.log((res.length - f) + '/' + res.length); process.exit(f ? 1 : 0)
