// N0 · care-notes probe: owner key only, reads visits one at a time, returns counts only (never a note's words).
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const FN = 'supabase/functions', SVC = 'svc_' + 'k'.repeat(60)
globalThis.__dbFor = (key) => ({ from: (t) => { const b = { select() { return b }, limit() { return Promise.resolve(t === 'identity_door_audit' && key !== SVC ? { data: null, error: { message: 'no' } } : { data: [], error: null }) } }; return b } })
{ const ja = fs.readFileSync(`${FN}/_shared/job-auth.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = (u, key) => globalThis.__dbFor(key)'); fs.writeFileSync(`${FN}/_shared/_job-auth_t.ts`, ja) }
const past = (h) => new Date(Date.now() - h * 3600e3).toISOString(), fut = new Date(Date.now() + 5 * 3600e3).toISOString()
const V = {
  's=1:d=a': { id: 's=1:d=a', client: { id: 1 }, caregiver: { id: 9 }, startDate: past(30), careNote: 'Ruth fell in the bathroom but said she was fine', adls: [{ status: 1, completed: true, note: 'did well' }, { status: 0, completed: false, note: 'refused shower' }, { status: -1, completed: false, note: null }] },
  's=2:d=b': { id: 's=2:d=b', client: { id: 1 }, caregiver: { id: 9 }, startDate: past(29), careNote: 'Ruth fell in the bathroom but said she was fine', adls: [] },
  's=3:d=c': { id: 's=3:d=c', client: { id: 2 }, caregiver: { id: 8 }, startDate: past(5), careNote: null, adls: [{ status: 1, completed: true, note: '' }] },
  's=4:d=d': { id: 's=4:d=d', client: { id: 3 }, caregiver: { id: 8 }, startDate: fut, careNote: null, adls: [] } }
let CALLS = []
globalThis.fetch = async (url) => { url = String(url); CALLS.push(url)
  if (url.includes('/api/visits?')) return new Response(JSON.stringify({ results: { visits: Object.values(V).map(({ careNote, adls, ...rest }) => rest), nextPage: null } }), { status: 200 })
  const m = url.match(/\/api\/visits\/(.+)$/)
  if (m) { if (!m[1].includes('%')) return new Response('{}', { status: 404 }); const id = decodeURIComponent(m[1]); return new Response(JSON.stringify({ results: V[id] }), { status: V[id] ? 200 : 404 }) }
  return new Response('{}', { status: 404 }) }
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: SVC, AXISCARE_TOKEN: 'axc_x', AXISCARE_SITE: '16485' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const src = fs.readFileSync(`${FN}/care-notes/index.ts`, 'utf8').replace("'../_shared/job-auth.ts'", "'../_shared/_job-auth_t.ts'").replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => ({})')
const tmp = path.join(process.cwd(), FN, 'care-notes', '_t.ts'); fs.writeFileSync(tmp, src)
try { await import(tmp) } finally { fs.unlinkSync(tmp); fs.unlinkSync(`${FN}/_shared/_job-auth_t.ts`) }
const call = async (auth) => { const r = await handler(new Request('https://x/functions/v1/care-notes?probe=1', { method: 'POST', headers: auth ? { Authorization: 'Bearer ' + auth } : {} })); return { s: r.status, j: await r.json() } }
let r = await call(null); ck('no key: refused, AxisCare never asked', r.s === 401 && CALLS.length === 0, r)
r = await call('eyJanon' + 'a'.repeat(60)); ck('the public key: refused', r.s === 401 && CALLS.length === 0, r)
CALLS = []; r = await call(SVC); const j = r.j
ck('the owner key: counts come back', r.s === 200 && j.visits_listed === 4 && j.visits_started === 3 && j.visits_read === 3, j)
ck('the visit list has no care notes; each visit read one at a time does (the id needed encoding)', j.list_has_care_note_field === false && j.id_form === 'encoded', j)
ck('the same care note on two visits the same day counts once; an empty one not at all', j.with_care_note === 1 && j.care_note_avg_chars === 47, j)
ck('tasks: done, not done, no response, with a note', j.tasks === 4 && j.tasks_done === 2 && j.tasks_not_done === 1 && j.tasks_no_response === 1 && j.tasks_with_note === 2 && j.not_done_with_note === 1, j)
ck('never a note\'s words or a name in the answer', !JSON.stringify(j).includes('fell') && !JSON.stringify(j).includes('shower') && !JSON.stringify(j).includes('Ruth'), j)
ck('only reads: every AxisCare call is a plain GET', CALLS.every((u) => u.includes('/api/visits')))
for (const [n, o, note] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n   ' + note))
console.log(res.filter((x) => x[1]).length + '/' + res.length)
