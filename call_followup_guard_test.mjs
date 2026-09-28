// Gate 0 guard: call-followup never writes what the AI heard onto a lead (2026-09-28). The REAL function against a
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
  reset([]); r = await call(CALL); const L = leads()[0]
  ck('a new client call still creates the lead', r.j.status === 'lead created' && leads().length === 1, r)
  ck('its name, phone and email come from GoHighLevel, not from what the AI heard', L.first_name === 'Susan' && L.last_name === 'Miller' && L.phone === '4175550101' && L.email === 'susan@x.test', L)
  ck('NONE of the AI-heard facts are written as lead fields', FACTS.every((k) => L[k] === undefined || (Array.isArray(L[k]) ? !L[k].length : !L[k])), FACTS.map((k) => [k, L[k]]))
  ck('they are kept as one "suggested, not reviewed" entry, with every field', L.ai_suggestions?.length === 1 && L.ai_suggestions[0].reviewed === false && L.ai_suggestions[0].source === 'call-followup'
     && L.ai_suggestions[0].fields.funding_source === 'Medicaid' && L.ai_suggestions[0].fields.needs[0] === 'bathing' && L.ai_suggestions[0].fields.phone_found === '4175559999', L.ai_suggestions)
  ck('the raw transcript is NOT stored on the lead', !('call_transcript' in L) && !JSON.stringify(L).includes('needs help bathing...'), Object.keys(L))
  ck('the call summary in the notes is labelled as unreviewed AI', /^AI call summary, not reviewed \(\d{4}-\d{2}-\d{2}\): Susan called/.test(L.interest_notes), L.interest_notes)
  ck('the drafted email and text still wait for approval, unchanged', T.app_data.find((x) => x.key === 'post_call_followups').data[0]?.status === 'pending_approval' && L.draft_sms === 'Text', T.app_data)
  ck('the GoHighLevel "lead" tag is still added, unchanged', CALLS.some((u) => u.includes('/contacts/C1/tags')), CALLS)

  const staff = { id: 'L9', first_name: 'Susan', last_name: 'Miller', phone: '4175550101', status: 'Contacted', relationship: 'Daughter (POA)', client_first_name: 'Elizabeth',
    needs: ['personalCare'], medical_conditions: [], mobility: 'independent', urgency: '7days', funding_source: 'private', follow_up_due: '2026-10-01', follow_up_branch: 'family-decision',
    interest_notes: 'Staff note.', created_at: '2026-09-01T00:00:00Z' }
  reset([staff]); r = await call(CALL); const E = leads()[0]
  ck('an existing lead is reused', r.j.status === 'lead updated' && leads().length === 1, r)
  ck("the office's own values are left exactly as they were", ['relationship', 'client_first_name', 'mobility', 'urgency', 'funding_source', 'status', 'follow_up_due', 'follow_up_branch'].every((k) => E[k] === staff[k])
     && E.needs.join() === 'personalCare' && E.medical_conditions.length === 0, E)
  ck('the staff note is kept and the AI summary is added below it, labelled', E.interest_notes.startsWith('Staff note.\n\nAI call summary, not reviewed'), E.interest_notes)
  r = await call(CALL); ck('a second call adds a second suggestion instead of overwriting the first', (leads()[0].ai_suggestions || []).length === 2, leads()[0].ai_suggestions?.length)
  reset([]); AI = { ...AI_OUT, is_client_lead: false, not_lead_reason: 'caregiver applicant' }; r = await call(CALL)
  ck('a call the AI judges not to be a client creates nothing (unchanged)', r.j.status === 'skipped' && !leads().length, r)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
