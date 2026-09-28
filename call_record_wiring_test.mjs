// K1 · call record wiring: the REAL call-disposition and call-followup against a stand-in database (in memory), a fake
// AI and no network. Each call path must add exactly one call-record line, and what the functions did before is unchanged.
// node call_record_wiring_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 600)])
const F = 'supabase/functions'
let T, REC, AI
const clone = (x) => JSON.parse(JSON.stringify(x))
const reset = (appData) => { REC = []; T = { app_data: Object.entries(appData).map(([key, data]) => ({ key, data: clone(data) })) } }
const q = (t) => { const st = { f: [] }; let single = false; const b = {
  select() { return b }, in() { return b }, not() { return b }, order() { return b }, limit() { return b }, ilike() { return b }, or() { return b }, gte() { return b }, lte() { return b },
  eq(c, v) { st.f.push([c, v]); return b }, maybeSingle() { single = true; return b }, single() { single = true; return b },
  upsert(row) { const r = T.app_data.find((x) => x.key === row.key); if (r) r.data = clone(row.data); else T.app_data.push(clone(row)); return Promise.resolve({ error: null }) },
  insert() { return Promise.resolve({ error: null }) }, update() { return b },
  then(ok, bad) { let rows = t === 'app_data' ? T.app_data : []; for (const [c, v] of st.f) rows = rows.filter((r) => r[c] === v)
    return Promise.resolve({ data: single ? (rows[0] ? clone(rows[0]) : null) : clone(rows), error: null }).then(ok, bad) } }; return b }
globalThis.__db = { from: q, rpc: async (fn, a) => {
  if (fn === 'call_record_add') { REC.push(a); return { data: { outcome: 'recorded', id: REC.length, match: 'one' }, error: null } }
  if (fn === 'upsert_app_data_item') { let row = T.app_data.find((r) => r.key === a.target_key); if (!row) { row = { key: a.target_key, data: [] }; T.app_data.push(row) }
    const i = row.data.findIndex((x) => x.id === a.item.id); if (i >= 0) row.data[i] = clone(a.item); else row.data.push(clone(a.item)) }
  return { data: null, error: null } } }
const AI_OUT = { is_client_lead: true, contact_first_name: 'Suzy', relationship: 'daughter', needs: ['bathing'], interest_notes: 'Susan called about her mom.',
  branch: 'ready-to-start', email_subject: 'Hi', email_body: 'Body', sms_draft: 'Text', needs_summary: 'Needs bathing help.', care_flags: [] }
globalThis.fetch = async (url) => { url = String(url)
  if (url.includes('api.anthropic.com')) return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'submit_call_analysis', input: AI }] }), { status: 200 })
  return new Response('{}', { status: 200 }) }
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k', CALL_FOLLOWUP_TOKEN: 'f'.repeat(40), CALL_DISPOSITION_TOKEN: 'd'.repeat(40), GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const tmp = fs.mkdtempSync(path.join(process.cwd(), '_crw_'))
const load = async (name) => { handler = null
  const src = fs.readFileSync(path.join(F, name, 'index.ts'), 'utf8')
    .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/from '\.\.\/_shared\/(\w[\w-]*)\.ts'/g, (_, m) => "from '" + path.resolve(F, '_shared', m + '.ts') + "'")
  const f = path.join(tmp, name + '.ts'); fs.writeFileSync(f, src); await import(f); return handler }
try {
  /* ---- call-followup ---- */
  ENV.ANTHROPIC_API_KEY = 'a'
  const cf = await load('call-followup')
  reset({ leads: [], post_call_followups: [], call_followup_log: [], ops_items: [] }); AI = { ...AI_OUT }
  let r = await cf(new Request('https://x/functions/v1/call-followup?token=' + ENV.CALL_FOLLOWUP_TOKEN, { method: 'POST',
    body: JSON.stringify({ contactId: 'C1', first_name: 'Susan', last_name: 'Smith', phone: '4175550100', direction: 'inbound', transcript: 'x'.repeat(200) }) }))
  const lead = T.app_data.find((x) => x.key === 'leads').data[0]
  ck('call reader: one call-record line, our AI\'s reading, where it was written, from the number (not a name)', REC.length === 1 && REC[0].p_kind === 'ai_reading'
     && REC[0].p_source === 'our_ai' && REC[0].p_summary === 'Susan called about her mom.' && REC[0].p_written_to === 'lead:' + lead.id && REC[0].p_phone === '4175550100'
     && REC[0].p_via === 'call-followup' && REC[0].p_direction === 'inbound', REC)
  ck('call reader: still writes the lead and the draft as before (Gate 0 guard intact)', lead && lead.ai_suggestions?.length === 1 && !('needs' in lead && lead.needs?.length)
     && T.app_data.find((x) => x.key === 'post_call_followups').data.length === 1)
  /* ---- call-disposition ---- */
  delete ENV.ANTHROPIC_API_KEY
  const cd = await load('call-disposition')
  const post = (body) => cd(new Request('https://x/functions/v1/call-disposition?token=' + ENV.CALL_DISPOSITION_TOKEN, { method: 'POST', body: JSON.stringify(body) })).then((x) => x.json())
  const base = () => ({ leads: [], ops_items: [], coverage_cases: [], call_disposition_log: [], ops_settings: { axiscare_call_notes_live: false }, axiscare_call_note_log: [], automation_log: [] })
  const now = new Date().toISOString()
  reset(base()); let j = await post({ id: 'C2', phone: '4175550200', disposition: 'Follow Up', direction: 'inbound', name: 'Pat Q' })
  ck('an outcome tapped after a call: one outcome line, before routing', REC.length >= 1 && REC[0].p_kind === 'outcome' && REC[0].p_outcome === 'Follow Up' && REC[0].p_phone === '4175550200'
     && REC[0].p_via === 'call-disposition' && !REC[0].p_summary, [REC, j])
  const summary = 'Caller asked about adding Tuesday mornings to the schedule.'
  reset({ ...base(), ops_items: [{ id: 'O1', title: 'Issue', caller_phone: '4175550300', created_at: now }] })
  j = await post({ attach: true, id: 'C3', phone: '4175550300', summary })
  ck('a summary for a recent Needs Attention item: attached as before, and one line saying so', /Needs Attention/.test(j.routed) && REC.length === 1 && REC[0].p_kind === 'summary'
     && REC[0].p_written_to === 'needs_attention' && REC[0].p_source === 'ghl' && REC[0].p_summary === summary && REC[0].p_axiscare, [j, REC])
  reset({ ...base(), leads: [{ id: 'L1', phone: '(417) 555-0400' }] })
  j = await post({ attach: true, id: 'C4', phone: '4175550400', summary })
  ck('a summary for a number on exactly one lead: added to that lead\'s log, and one line naming the lead', /lead/.test(j.routed) && T.app_data.find((x) => x.key === 'leads').data[0].comm_log?.length === 1
     && REC.length === 1 && REC[0].p_written_to === 'lead:L1', [j, REC])
  reset({ ...base(), leads: [{ id: 'L1', phone: '4175550500' }, { id: 'L2', client_phone: '417-555-0500' }] })
  j = await post({ attach: true, id: 'C5', phone: '4175550500', summary })
  const L = T.app_data.find((x) => x.key === 'leads').data
  ck('two leads share the number: the summary goes on neither (her rule), and is still recorded', !/lead/.test(j.routed) && !L[0].comm_log && !L[1].comm_log && REC.length === 1 && REC[0].p_written_to === null, [j, REC, L])
  reset({ ...base(), leads: [{ id: 'L1', phone: '4175550600', archived: true }] })
  j = await post({ attach: true, id: 'C6', phone: '4175550600', summary })
  ck('an archived lead is never written to', !T.app_data.find((x) => x.key === 'leads').data[0].comm_log && REC.length === 1, [j, REC])
  reset(base()); j = await post({ id: 'C7', phone: '4175550700' })
  ck('a test request with no outcome and no summary records nothing (as before, it creates nothing)', REC.length === 0, [j, REC])
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '\n     ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
