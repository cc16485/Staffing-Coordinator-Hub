// call-learn (1050): the REAL function and the REAL rules files, against a fake database, a fake GoHighLevel and a fake AI.
// Each answered call the recorder put on a lead is read once into call_learned; no lead changes. node call_learn_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
const clone = (x) => JSON.parse(JSON.stringify(x))
const NOW = Date.now(), ago = (min) => new Date(NOW - min * 60e3).toISOString()
let T, G, SENT, AI, AIQ = []
const seenRow = (id, lead, min, status, o = {}) => ({ message_id: id, mode: 'live', kind: 'call', msg_at: ago(min), status, lead_id: lead, ev: status === 'recorded' ? { outcome: 'connected', by: 'krystal@mo-care.com' } : null, ...o })
const reset = () => {
  T = { app_data: [{ key: 'ops_settings', data: { call_learn_since: ago(3 * 24 * 60) } },
      { key: 'leads', data: [{ id: 'L1', first_name: 'Linda', status: 'Contacted' }, { id: 'L2', first_name: 'Greg', status: 'New' }, { id: 'L3', archived: true }] },
      { key: 'ghl_users', data: [{ id: 'people', people: { 'u-kr': { email: 'Krystal@mo-care.com', first: 'Krystal' } } }] }, { key: 'automation_heartbeats', data: [] }],
    lead_record_seen: [seenRow('c1', 'L1', 300, 'recorded'), seenRow('c2', 'L2', 200, 'already'), seenRow('c3', 'L1', 100, 'recorded', { ev: { outcome: 'voicemail' } }),
      seenRow('c4', 'L3', 90, 'recorded'), seenRow('c5', 'L1', 80, 'recorded'), seenRow('c6', 'L1', 70, 'recorded'), seenRow('cOld', 'L1', 5 * 24 * 60, 'recorded'),
      { ...seenRow('t1', 'L1', 60, 'recorded'), kind: 'sms' }, seenRow('cPr', 'L1', 50, 'recorded', { mode: 'practice' })],
    call_learned: [] }
  G = { msgs: { c1: { id: 'c1', direction: 'inbound', userId: 'u-kr', meta: { call: { duration: 720 } } }, c2: { id: 'c2', direction: 'outbound', userId: 'u-kr', meta: { call: { duration: 46 } } },
      c5: { id: 'c5', direction: 'inbound', meta: { call: { duration: 12 } } }, c6: { id: 'c6', direction: 'outbound', meta: { call: { duration: 300 } } } },
    tr: { c1: [{ sentenceIndex: 1, mediaChannel: 2, transcript: 'She fell in the shower. We want 20 hours, weekday mornings.' }, { sentenceIndex: 0, mediaChannel: 1, transcript: 'Caring Companions, this is Krystal.' }],
      c2: [{ sentenceIndex: 0, transcript: 'Hi Greg, it is Krystal. Yes my wife needs help after surgery.' }] } }
  SENT = []; AI = []
}
function q(t) {
  const st = { f: [], op: 'select', row: null, single: false }
  const match = (r) => st.f.every(([k, v, how]) => how === 'gte' ? String(r[k]) >= String(v) : how === 'in' ? v.includes(r[k]) : String(r[k]) === String(v))
  const run = () => {
    T[t] = T[t] || []
    if (st.op === 'upsert') { for (const r of [st.row].flat()) { const i = T[t].findIndex((x) => x.message_id === r.message_id); if (i >= 0) T[t][i] = { ...T[t][i], ...clone(r) }; else T[t].push(clone(r)) } return { data: null, error: null } }
    let rows = T[t].filter(match)
    if (st.order) rows = rows.slice().sort((a, b) => (st.order.asc ? 1 : -1) * String(a[st.order.k]).localeCompare(String(b[st.order.k])))
    return { data: st.single ? (rows[0] ? clone(rows[0]) : null) : clone(rows), error: null }
  }
  const b = { select() { return b }, eq(k, v) { st.f.push([k, v]); return b }, gte(k, v) { st.f.push([k, v, 'gte']); return b }, in(k, v) { st.f.push([k, v, 'in']); return b },
    order(k, o) { st.order = { k, asc: o?.ascending !== false }; return b }, limit() { return b }, upsert(row) { st.op = 'upsert'; st.row = row; return b },
    maybeSingle() { st.single = true; return Promise.resolve(run()) }, then(ok, ko) { return Promise.resolve(run()).then(ok, ko) } }
  return b
}
globalThis.__db = { from: q, rpc: async (fn, a) => {
  if (fn === 'upsert_app_data_item') { const row = T.app_data.find((r) => r.key === a.target_key); const i = row.data.findIndex((x) => x.id === a.item.id); if (i >= 0) row.data[i] = clone(a.item); else row.data.push(clone(a.item)); return { data: null, error: null } }
  return { data: null, error: { message: 'unknown rpc ' + fn } } } }
const answer = (o) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'fill_lead_form', input: { is_new_family: true, client_first_name: 'Dorothy', relationship: 'Daughter', safety: ['fallRisk'],
  schedule_days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], number_of_hours: '20', why_called: 'Mom fell', summary: 'Linda called about her mom.', caller_first_name: 'Linda',
  care_plan: { narrative: 'From the call.' }, home_life: { dogs: true }, people: [{ name: 'Mark Hayes', relationship: 'Son', note: 'pays the bills' }], ...o } }] })
globalThis.fetch = async (url, o = {}) => { url = String(url); SENT.push([o.method || 'GET', url])
  const ok = (b) => new Response(JSON.stringify(b), { status: 200 })
  if (url.includes('api.anthropic.com')) { const b = JSON.parse(o.body); AI.push(b); const q = AIQ.shift(); if (q && q.status) return new Response(JSON.stringify(q.body || {}), { status: q.status }); return ok(q || answer({})) }
  if (url.includes('axiscare.com')) return ok({ results: [] })
  let m = /\/messages\/([\w-]+)\/transcription/.exec(url)
  if (m) return G.tr[m[1]] ? ok(G.tr[m[1]]) : new Response('{}', { status: 404 })
  m = /\/conversations\/messages\/([\w-]+)$/.exec(url)
  if (m) return G.msgs[m[1]] ? ok({ message: G.msgs[m[1]] }) : new Response('{}', { status: 404 })
  return new Response('{}', { status: 404 }) }
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k'.repeat(40), GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', HUB_JOB_SECRET: 'j'.repeat(40), ANTHROPIC_API_KEY: 'a', AXISCARE_API_KEY: 'x', AXISCARE_SITE: '16485' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_cl_'))
try {
  fs.writeFileSync(path.join(tmp, 'job-auth.ts'), fs.readFileSync(path.join(F, '_shared/job-auth.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => ({ from: () => ({ select: () => ({ limit: async () => ({ error: { message: "no" } }) }) }) })')
    .replace("'./staff-auth.ts'", "'" + path.join(process.cwd(), F, '_shared', 'staff-auth.ts') + "'"))
  const src = fs.readFileSync(path.join(F, 'call-learn/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace("'../_shared/job-auth.ts'", "'" + path.join(tmp, 'job-auth.ts') + "'")
    .replace(/from '\.\.\/_shared\/([\w-]+)\.ts'/g, (_, m) => "from '" + path.join(process.cwd(), F, '_shared', m + '.ts') + "'")
  fs.writeFileSync(path.join(tmp, 'f.ts'), src); await import(path.join(tmp, 'f.ts'))
  const L = await import(path.join(process.cwd(), F, '_shared', 'call-learn.ts'))
  const run = async (qs = '', hdr = { 'x-cron-secret': ENV.HUB_JOB_SECRET }) => { const r = await handler(new Request('https://x/f' + qs, { method: 'POST', headers: hdr, body: '{}' })); return { status: r.status, j: await r.json() } }
  const row = (id) => T.call_learned.find((r) => r.message_id === id)

  ck('rules: the transcript reads in order, with the speaker', L.transcriptText(G?.tr?.c1 || [{ sentenceIndex: 1, mediaChannel: 2, transcript: 'b' }, { sentenceIndex: 0, mediaChannel: 1, transcript: 'a' }]) === 'Speaker 1: a\nSpeaker 2: b')
  reset()
  ck('nobody without the schedule secret or the owner key gets in (401)', (await run('', {})).status === 401)
  T.app_data[0].data.call_learn_since = ''
  ck('with no start time it stops and says so (500), reading nothing', (await run()).status === 500 && !T.call_learned.length && !AI.length)

  reset()
  const leadsBefore = clone(T.app_data.find((r) => r.key === 'leads').data)
  let r = await run()
  ck('a run answers ok and reads at most 3 calls', r.status === 200 && r.j.looked_at === 3, r.j)
  ck('oldest first: the 12-minute conversation and the hand-logged call are read', row('c1')?.status === 'read' && row('c2')?.status === 'read', T.call_learned)
  ck('a call under 30 seconds is skipped, never sent to the AI', row('c5')?.status === 'skipped' && AI.length === 2, [row('c5'), AI.length])
  ck('voicemails, texts, archived leads, practice rows and calls before the start are left alone', !row('c3') && !row('t1') && !row('c4') && !row('cPr') && !row('cOld'))
  const k1 = row('c1').reading
  ck('what was heard is kept in the form\'s own boxes (safety, days, hours, why)', k1 && k1.prefill.safety[0] === 'fallRisk' && k1.prefill.number_of_hours === '20' && k1.prefill.schedule_days.length === 5 && k1.prefill.why_called === 'Mom fell', k1)
  ck('...with the people, Home & Life and the care plan draft', k1.profile.people[0].name === 'Mark Hayes' && k1.profile.attributes.dogs === 'yes' && /From the call/.test(k1.care_plan.narrative), k1)
  ck('the phone and email boxes are never kept from a call; the caller\'s heard name is', !('phone' in k1.prefill) && !('email' in k1.prefill) && k1.prefill.first_name === 'Linda', k1.prefill)
  ck('the transcript itself is never kept', !JSON.stringify(T.call_learned).includes('fell in the shower'))
  ck('who took it: the recorder\'s answer, else the GoHighLevel user', row('c1').staff === 'krystal@mo-care.com' && row('c2').staff === 'krystal@mo-care.com', [row('c1').staff, row('c2').staff])
  ck('direction and length are kept', row('c1').direction === 'inbound' && row('c1').seconds === 720 && row('c2').direction === 'outbound')
  ck('no lead changed', JSON.stringify(T.app_data.find((r) => r.key === 'leads').data) === JSON.stringify(leadsBefore))
  ck('only reads from GoHighLevel (GET); the AI gets the transcript', SENT.filter(([, u]) => !u.includes('anthropic')).every(([m]) => m === 'GET') && AI[0].messages[0].content.includes('fell in the shower'))
  ck('the heartbeat says how it went', /"read":2/.test(T.app_data.find((x) => x.key === 'automation_heartbeats').data[0].note))

  r = await run()
  ck('next run: the next call (no transcript yet) waits, and nothing read is read again', row('c6')?.status === 'waiting' && row('c6').tries === 1 && AI.length === 2 && r.j.looked_at === 1, [r.j, row('c6')])
  await run(); await run(); r = await run()
  ck('after 4 tries with no transcript it says so and stops trying', row('c6').status === 'no_transcript' && row('c6').tries === 4, row('c6'))
  r = await run()
  ck('...then there is nothing left to do', r.j.looked_at === 0, r.j)
  G.tr.c6 = [{ transcript: 'late transcript' }]; r = await run()
  ck('...even if a transcript turns up later (no endless retries)', r.j.looked_at === 0)

  /* the AI answers in words instead of the form (1050's proof call) */
  const words = { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: 'This call does not seem to be about care.' }] }
  reset(); AIQ = [words]; r = await run('?limit=1')
  const nudge = AI[1] && AI[1].messages
  ck('words instead of the form: its own answer goes back unchanged and it is asked once more; the form then counts', row('c1')?.status === 'read' && AI.length === 2
    && nudge.length === 3 && nudge[1].role === 'assistant' && JSON.stringify(nudge[1].content) === JSON.stringify(words.content) && /Answer only by calling fill_lead_form/.test(nudge[2].content) && !AI[1].tool_choice?.name, [row('c1'), AI.length])
  reset(); AIQ = [words, words]; r = await run('?limit=1')
  ck('words twice: nothing to fill in (skipped, not an error, not tried again)', row('c1')?.status === 'skipped' && /found nothing it could fill in/.test(row('c1').note) && r.j.errors === 0 && AI.length === 2, [row('c1'), r.j])
  reset(); AIQ = [{ stop_reason: 'refusal', content: [] }]; r = await run('?limit=1')
  ck('a refusal: said so, not asked again', row('c1')?.status === 'skipped' && /would not read this call/.test(row('c1').note) && AI.length === 1, row('c1'))
  reset(); AIQ = [{ status: 529, body: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } }, { status: 529, body: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } }]; r = await run('?limit=1')
  ck('the AI service fails twice: an error that says why, tried again on a later run', row('c1')?.status === 'error' && row('c1').note === 'the AI service answered 529 (overloaded_error): Overloaded' && AI.length === 2 && row('c1').tries === 1, row('c1'))
  r = await run('?limit=1')
  ck('...and the next run reads it', row('c1')?.status === 'read' && row('c1').tries === 2, row('c1'))
  reset(); AIQ = []; r = await run('?limit=1')
  ck('?limit=1 reads one call (the installer\'s proof)', r.j.looked_at === 1 && T.call_learned.length === 1, r.j)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
