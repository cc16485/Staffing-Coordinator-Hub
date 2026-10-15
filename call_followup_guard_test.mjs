// Gate 0 guard: call-followup never writes what the AI heard onto a lead (2026-09-28). Since 2026-10-14 it is retired: it writes nothing at all. The REAL function against a
// fake database, a fake AI (fixed tool answer) and a fake GoHighLevel. node call_followup_guard_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
const TOKEN = 't'.repeat(40)
let T, CALLS, AI
const AI_OUT = { is_client_lead: true, contact_first_name: 'Suzy', contact_last_name: 'Heard', relationship: 'daughter', client_first_name: 'Betty',
  email_found: 'heard@x.test', phone_found: '4175559999', needs: ['bathing'], urgency: 'ASAP', medical_conditions: ['dementia'], mobility: 'walker',
  funding_source: 'Medicaid', rate_discussed: '$30/hr', interest_notes: 'Susan called about her mom Betty.', branch: 'ready-to-start',
  confidence_note: 'wants to start', intent_tags: ['ready this week'], email_subject: 'Hi', email_body: 'Body', sms_draft: 'Text',
  needs_summary: 'Needs bathing help.', care_flags: ['Fall Risk'] }
const reset = (leads) => { CALLS = []; AI = { ...AI_OUT }; T = { app_data: [{ key: 'leads', data: leads }, { key: 'post_call_followups', data: [] }, { key: 'call_followup_log', data: [] }, { key: 'ops_items', data: [] }] } }
const q = (t) => { const st = { f: [] }; const b = { select() { return b }, in() { return b }, not() { return b }, order() { return b }, limit() { return b }, ilike() { return b }, or() { return b },
  eq(c, v) { st.f.push([c, v]); return b }, upsert(row) { const r = T.app_data.find((x) => x.key === row.key); if (r) r.data = row.data; else T.app_data.push(row); return Promise.resolve({ error: null }) },
  maybeSingle() { return b.then((x) => ({ data: x.data[0] ?? null, error: null })) },
  then(ok) { let rows = T[t] ?? []; for (const [c, v] of st.f) rows = rows.filter((r) => r[c] === v); return Promise.resolve({ data: JSON.parse(JSON.stringify(rows)), error: null }).then(ok) } }; return b }
globalThis.__db = { from: q, rpc: async (fn, a) => {
  if (fn === 'upsert_app_data_item') { const row = T.app_data.find((r) => r.key === a.target_key); const i = row.data.findIndex((x) => x.id === a.item.id); if (i >= 0) row.data[i] = JSON.parse(JSON.stringify(a.item)); else row.data.push(JSON.parse(JSON.stringify(a.item))) }
  return { data: null, error: null } } }
globalThis.fetch = async (url, o) => { url = String(url); CALLS.push(url)
  if (url.includes('api.anthropic.com')) return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'submit_call_analysis', input: AI }] }), { status: 200 })
  return new Response('{}', { status: 200 }) }
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k', CALL_FOLLOWUP_TOKEN: TOKEN, ANTHROPIC_API_KEY: 'a', GHL_TOKEN: 'g' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_cfg_'))
try {
  const src = fs.readFileSync(path.join(F, 'call-followup/index.ts'), 'utf8')
    .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/from '\.\.\/_shared\/(\w[\w-]*)\.ts'/g, (_, m) => "from '" + path.resolve(F, '_shared', m + '.ts') + "'")
  fs.writeFileSync(path.join(tmp, 'cf.ts'), src); await import(path.join(tmp, 'cf.ts'))
  const call = async (body, tok = TOKEN) => { const r = await handler(new Request('https://x/functions/v1/call-followup?token=' + tok, { method: 'POST', body: JSON.stringify(body) })); return { status: r.status, j: await r.json() } }
  const leads = () => T.app_data.find((x) => x.key === 'leads').data
  const CALL = { contactId: 'C1', first_name: 'Susan', last_name: 'Miller', phone: '4175550101', email: 'susan@x.test', transcript: 'Hi, my mom Betty needs help bathing...' }
  const FACTS = ['relationship', 'client_first_name', 'needs', 'medical_conditions', 'mobility', 'urgency', 'funding_source', 'rate_discussed', 'ai_needs_summary', 'ai_care_flags']

  reset([]); let r = await call(CALL, 'wrong-token'); ck('a wrong token is refused (401) before anything is read or written', r.status === 401 && !CALLS.length && !leads().length, r)
  reset([]); r = await call(CALL)
  ck('2026-10-14: a new client call creates NOTHING (no lead, draft, tag or AI reading): a person presses Make this a lead', r.status === 200 && r.j.status === 'retired' && r.j.created === false
     && !leads().length && !T.app_data.find((x) => x.key === 'post_call_followups').data.length && !CALLS.length, { r, CALLS })
  const staff = { id: 'L9', first_name: 'Susan', last_name: 'Miller', phone: '4175550101', status: 'Contacted', interest_notes: 'Staff note.' }
  reset([staff]); const before = JSON.stringify(leads()); r = await call(CALL)
  ck('an existing lead is left exactly as it was', JSON.stringify(leads()) === before, leads())
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
