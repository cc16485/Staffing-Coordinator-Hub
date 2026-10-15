// lead-readiness (770): the REAL function against a fake database and a fake AI. node lead_readiness_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
const clone = (x) => JSON.parse(JSON.stringify(x))
let T, AI, SENT
const reset = () => {
  T = { app_data: [{ key: 'ops_settings', data: {} }, { key: 'automation_heartbeats', data: [] }, { key: 'leads', data: [
      { id: 'A', status: 'Contacted', why_called: 'Mom comes home from Cox Friday', phone: '417-555-0101', email: 'carol@example.com', comm_log: [{ at: '2026-10-15T14:00:00Z', body: '☎ Krystal called them, 11 min' }, { at: '2026-10-15T14:30:00Z', body: '💬 Automatic text: "Reminder"' }], contact_events: [{ at: '2026-10-15T14:00:00Z' }] },
      { id: 'B', status: 'New', why_called: 'just pricing', created_at: '2026-10-14T10:00:00Z' },
      { id: 'L', status: 'Lost' }, { id: 'X', status: 'New', archived: true }, { id: 'S', status: 'New', spam: { at: 'x' } }, { id: 'C', status: 'Converted' }] }],
    lead_readiness: [], call_task_reading: [{ lead_id: 'A', call_at: '2026-10-15T14:00:00Z', detail: { summary: 'Daughter needs help 3 mornings a week, 4 hours each, starting Monday.' } }] }
  AI = { fail: false, level: { A: 'ready', B: 'looking' } }; SENT = []
}
function q(t) {
  const st = { f: [], op: 'select', row: null, single: false }
  const match = (r) => st.f.every(([k, v, how]) => how === 'in' ? v.includes(r[k]) : String(r[k]) === String(v))
  const run = () => {
    T[t] = T[t] || []
    if (st.op === 'upsert') { const r = st.row, i = T[t].findIndex((x) => x.lead_id === r.lead_id); if (i >= 0) T[t][i] = { ...T[t][i], ...clone(r) }; else T[t].push(clone(r)); return { data: null, error: null } }
    const rows = T[t].filter(match)
    return { data: st.single ? (rows[0] ? clone(rows[0]) : null) : clone(rows), error: null }
  }
  const b = { select() { return b }, eq(k, v) { st.f.push([k, v]); return b }, in(k, v) { st.f.push([k, v, 'in']); return b }, order() { return b }, limit() { return b },
    upsert(row) { st.op = 'upsert'; st.row = row; return b }, maybeSingle() { st.single = true; return Promise.resolve(run()) }, then(ok, ko) { return Promise.resolve(run()).then(ok, ko) } }
  return b
}
globalThis.__db = { from: q, rpc: async () => ({ data: null, error: null }) }
globalThis.fetch = async (url, o = {}) => {
  const body = JSON.parse(o.body); SENT.push(body)
  if (AI.fail) return new Response('{}', { status: 529 })
  const id = /Mom comes home/.test(body.messages[0].content) ? 'A' : 'B'
  return new Response(JSON.stringify({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'rate_readiness', input: { level: AI.level[id], why: id === 'A' ? '"Mom comes home from Cox Friday" — needs help that day' : '"Just getting prices"', hours_per_week: id === 'A' ? 12 : null } }] }), { status: 200 })
}
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k'.repeat(40), ANTHROPIC_API_KEY: 'a', HUB_JOB_SECRET: 'j'.repeat(40) }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_rd_'))
try {
  fs.writeFileSync(path.join(tmp, 'job-auth.ts'), fs.readFileSync(path.join(F, '_shared/job-auth.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => ({ from: () => ({ select: () => ({ limit: async () => ({ error: { message: "no" } }) }) }) })')
    .replace("'./staff-auth.ts'", "'" + path.join(process.cwd(), F, '_shared', 'staff-auth.ts') + "'"))
  const src = fs.readFileSync(path.join(F, 'lead-readiness/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace("'../_shared/job-auth.ts'", "'" + path.join(tmp, 'job-auth.ts') + "'")
    .replace(/from '\.\.\/_shared\/([\w-]+)\.ts'/g, (_, m) => "from '" + path.join(process.cwd(), F, '_shared', m + '.ts') + "'")
  fs.writeFileSync(path.join(tmp, 'f.ts'), src); await import(path.join(tmp, 'f.ts'))
  const run = async (hdr = { 'x-cron-secret': ENV.HUB_JOB_SECRET }, qs = '') => { const r = await handler(new Request('https://x/f' + qs, { method: 'POST', headers: hdr, body: '{}' })); return { status: r.status, j: await r.json() } }
  const row = (id) => T.lead_readiness.find((r) => r.lead_id === id)

  reset()
  ck('nobody without the schedule secret or the owner key gets in (401)', (await run({})).status === 401)
  T.app_data[0].data.lead_readiness_off = true
  let r = await run()
  ck('switched off: nothing read', r.j.off === true && !SENT.length)
  reset(); r = await run()
  ck('reads only open families (not Lost, Converted, archived or spam)', r.j.open === 2 && r.j.read === 2 && SENT.length === 2 && T.lead_readiness.length === 2, r.j)
  ck('A: ready, why in their words (dashes taken out), 12 hours heard, from a call', row('A').level === 'ready' && row('A').why === '"Mom comes home from Cox Friday", needs help that day' && row('A').hours_heard === 12 && row('A').source === 'call', row('A'))
  ck('B: just looking, no hours, from the form', row('B').level === 'looking' && row('B').hours_heard === null && row('B').source === 'form', row('B'))
  const ask = SENT.find((b) => /Mom comes home/.test(b.messages[0].content))
  ck('the AI sees the call reader\'s summary and the history, not phone numbers, emails or automatic texts', /3 mornings a week/.test(ask.messages[0].content) && /Krystal called them, 11 min/.test(ask.messages[0].content)
    && !/555-0101|carol@example/.test(ask.messages[0].content) && !/Automatic text/.test(ask.messages[0].content), ask.messages[0].content)
  ck('the AI is asked with the strict tool on Sonnet 5.5 (refusal fallback on)', ask.model === 'claude-sonnet-5-5' && ask.tools[0].strict === true && ask.tools[0].name === 'rate_readiness' && ask.fallbacks === 'default')
  SENT = []; r = await run()
  ck('nothing changed: nothing read again', r.j.read === 0 && !SENT.length, r.j)
  T.app_data.find((x) => x.key === 'leads').data[1].comm_log = [{ at: '2026-10-15T16:00:00Z', body: '💬 They texted: "Can you start Monday?"' }]
  AI.level.B = 'ready'; r = await run()
  ck('B\'s story changed (they texted): read again, now ready', r.j.read === 1 && row('B').level === 'ready', [r.j, row('B')])
  T.app_data.find((x) => x.key === 'leads').data[1].notes = 'more'; AI.fail = true
  r = await run(); r = await run(); r = await run()
  ck('the AI failing keeps the last good reading and says so', row('B').level === 'ready' && /529/.test(row('B').error) && row('B').tries === 3, row('B'))
  SENT = []; r = await run()
  ck('...after 3 tries on the same story it stops asking until the story changes', !SENT.length && r.j.skipped_failed === 1, r.j)
  AI.fail = false; T.app_data.find((x) => x.key === 'leads').data[1].notes = 'more again'; r = await run()
  ck('...and a new story is read again, clearing the error', row('B').error === null && row('B').tries === 0, row('B'))
  reset(); r = await run({ 'x-cron-secret': ENV.HUB_JOB_SECRET }, '?dry=1')
  ck('a dry run reads but saves nothing', r.j.read === 2 && T.lead_readiness.length === 0, r.j)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
