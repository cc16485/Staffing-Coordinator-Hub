// Lead turns (Care Coordinator Leads and Bonus, Stage 1, policy approved by Samantha 2026-10-18): the REAL lead-watch
// against a fake database and clock. Made-up people only; nothing leaves this machine. node lead_turns_stage1_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1400)]);
const FN = 'supabase/functions';
let NOW = Date.parse('2026-10-06T15:00:00Z')          // Tue Oct 6, 10:00am Central (CDT): lead response hours are open
const RealDate = Date
class FakeDate extends RealDate { constructor(...a) { if (!a.length) super(NOW); else super(...a) } static now() { return NOW } }
globalThis.Date = FakeDate
const at = (iso) => { NOW = RealDate.parse(iso) }
const K = 'kry@mo-care.com', S = 'sam@mo-care.com', A = 'ang@mo-care.com'

/* ── the fake world ── */
let APP, T, SENT
const reset = () => {
  APP = { ops_settings: { lead_rungs_live: true, coverage_alert_admins: [S, K] }, leads: [], ops_items: [], automation_heartbeats: [],
    coordinator_staff: [{ email: S, name: 'Samantha T', phone: '4175550901' }, { email: K, name: 'Krystal L', phone: '4175550902' }, { email: A, name: 'Angiel R', phone: '4175550903' }],
    duty_windows: [{ id: 'dw1', area: 'operations', person: K, backup_person: A, recur: { days: [0, 1, 2, 3, 4, 5, 6], from: '08:00', to: '18:00' }, active: true },
      { id: 'dw2', area: 'owner_escalation', person: S, recur: { days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '23:59' }, active: true }], positions: [] }
  T = { persons: [{ person_id: 'p_s', primary_email: S, full_name: 'Samantha Troutman' }, { person_id: 'p_k', primary_email: K, full_name: 'Krystal Land' }, { person_id: 'p_a', primary_email: A, full_name: 'Angiel Rose' }],
    op_events: [], contact_optout_current: [], contact_send_refusals: [], phone_index: [], circle_contacts: [], ghl_call_bridges: [] }
  SENT = []
}
const q = (t) => { const st = { f: [] }; const b = {
  select() { return b; }, order() { return b; }, limit() { return b; }, contains() { return b; }, in() { return b; }, is() { return b; }, gte() { return b; }, lte() { return b; }, ilike() { return b; }, not() { return b; }, or() { return b; }, neq() { return b; },
  eq(c, v) { st.f.push([c, v]); return b; },
  insert(row) { (T[t] ||= []).push(row); return Promise.resolve({ data: row, error: null }); },
  maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: null })); },
  then(ok) {
    if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]
      return Promise.resolve({ data: k in APP ? [{ key: k, data: JSON.parse(JSON.stringify(APP[k])) }] : [], error: null }).then(ok) }
    let rows = T[t] ?? []; for (const [c, v] of st.f) rows = rows.filter((r) => r[c] === v)
    return Promise.resolve({ data: rows, error: null }).then(ok);
  } }; return b; };
globalThis.__db = { from: q, auth: { getUser: async () => ({ data: { user: null }, error: { message: 'no' } }) },
  rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => x.id === a.item.id); const it = JSON.parse(JSON.stringify(a.item)); if (i >= 0) arr[i] = it; else arr.push(it) } return { data: null, error: null } } }
const PHONE_OF = {}
globalThis.fetch = async (url, o) => { url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}
  if (url.includes('/contacts/upsert')) { const id = 'C:' + (body.phone || body.email); PHONE_OF[id] = body.phone || body.email; return new Response(JSON.stringify({ contact: { id, dnd: false } }), { status: 200 }) }
  if (url.includes('/conversations/messages')) { SENT.push({ to: PHONE_OF[body.contactId] || body.contactId, message: body.message || '' }); return new Response('{}', { status: 200 }) }
  return new Response('{}', { status: 200 }) }
const SVC = 'svc_' + 'k'.repeat(60), JOBSEC = 'j'.repeat(64)
const ENV = { HUB_JOB_SECRET: JOBSEC, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SVC, GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } }
globalThis.__dbFor = (key) => ({ from: (t) => { const bb = { select() { return bb; }, limit() { return Promise.resolve(t === 'identity_door_audit' && key !== SVC ? { data: null, error: { message: 'denied' } } : { data: [], error: null }); } }; return bb; } })
fs.writeFileSync(`${FN}/_shared/_job-auth_t.ts`, fs.readFileSync(`${FN}/_shared/job-auth.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = (u, key) => globalThis.__dbFor(key)'))
process.on('exit', () => { try { fs.unlinkSync(`${FN}/_shared/_job-auth_t.ts`) } catch { /* */ } })
const load = async (name) => { const src = fs.readFileSync(`${FN}/${name}/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db').replace("'../_shared/job-auth.ts'", "'../_shared/_job-auth_t.ts'")
  const tmp = path.join(process.cwd(), FN, name, '_t.ts'); fs.writeFileSync(tmp, src); try { await import(tmp + '?' + Math.random()); } finally { fs.unlinkSync(tmp); } return handler; };
const L = await import(path.join(process.cwd(), FN, '_shared/lead-links.ts'))
const LW = await load('lead-watch')
const run = async (qs = '') => { const r = await LW(new Request('https://x/fn' + qs, { method: 'POST', headers: { Authorization: 'Bearer eyJanon', 'x-cron-secret': JOBSEC, 'Content-Type': 'application/json' }, body: '{}' })); return { status: r.status, j: await r.json() } }
const page = async (leadId, email, body) => { const lk = await L.makeLink(JOBSEC, leadId, email, Math.floor(NOW / 1000) + 86400); const p = Object.fromEntries(new URL(lk).searchParams)
  const r = await LW(new Request('https://x/fn', { method: 'POST', headers: { Authorization: 'Bearer eyJanon', 'Content-Type': 'application/json' }, body: JSON.stringify({ ...p, e: Number(p.e), ...body }) })); return { status: r.status, j: await r.json() } }
const lead = (id) => APP.leads.find((l) => l.id === id)
const card = (id) => APP.ops_items.find((i) => i.id === 'ops_lead_' + id)
const ago = (m) => new Date(NOW - m * 60000).toISOString()
const seedT = ({ turns = true, rungs = false } = {}) => { reset(); at('2026-10-06T15:00:00Z')
  APP.ops_settings.lead_rungs_live = rungs
  APP.ops_settings.lead_rotation = { people: [{ name: 'Krystal', on: true }, { name: 'Angiel', on: true }] }
  APP.ops_settings.lead_rotation_live = turns
  APP.leads = [
    { id: 'k1', first_name: 'Kay', last_name: 'One', phone: '4175550111', status: 'New', assigned_coordinator: 'Krystal', created_at: ago(90), first_human_attempt_at: ago(80),
      owner_turn: { to: 'Krystal', how: 'turn', at: ago(90), by: 'cara' } },
    { id: 'a1', first_name: 'Ann', last_name: 'Able', phone: '4175550112', source: 'Website', status: 'New', assigned_coordinator: '', created_at: ago(3) },
    { id: 'a2', first_name: 'Bea', last_name: 'Baker', phone: '4175550113', source: 'Website', status: 'New', assigned_coordinator: '', created_at: ago(2) } ]
  APP.ops_items = []
}
const R = (globalThis.LeadRules)

/* ── off: nothing about turns happens ── */
seedT({ turns: false }); let r = await run()
ck('off · no lead gets a turn; the plan says turns are off', !lead('a1').owner_turn && !lead('a2').owner_turn && r.j.turns && r.j.turns.on === false, r.j)
ck('off · with speed to lead also off, nothing is written (as before)', lead('a1').assigned_coordinator === '' && r.j.written === 0, r.j)

/* ── dry run with turns on: lists, writes nothing ── */
seedT(); r = await run('?dry=1')
ck('dry · lists Ann to Angiel and Bea to Krystal, writes nothing', JSON.stringify(r.j.turns.given) === JSON.stringify(['Ann Able → Angiel', 'Bea Baker → Krystal']) && lead('a1').assigned_coordinator === '' && r.j.written === 0, r.j)

/* ── on: turns alternate after the last turn on file ── */
seedT(); r = await run()
ck('on · Kay was Krystal’s turn, so Ann goes to Angiel and Bea to Krystal', lead('a1').assigned_coordinator === 'Angiel' && lead('a2').assigned_coordinator === 'Krystal', APP.leads.map((l) => [l.id, l.assigned_coordinator]))
ck('on · each records its turn and its original owner', lead('a1').owner_turn.to === 'Angiel' && lead('a1').owner_turn.how === 'turn' && lead('a1').original_owner.name === 'Angiel' && lead('a2').original_owner.name === 'Krystal')
ck('on · a history line says whose lead it is', /Angiel’s lead \(next up by turn\)/.test(JSON.stringify(lead('a1').comm_log)))
ck('on · written even though speed to lead is off (its own switch); no texts', r.j.written === 2 && SENT.length === 0, { written: r.j.written, SENT })
ck('on · run again: nobody is reassigned', ((r = await run()), lead('a1').assigned_coordinator === 'Angiel' && lead('a2').assigned_coordinator === 'Krystal' && r.j.turns.given.length === 0), r.j)

/* ── someone out is skipped, with no makeup turn ── */
APP.coordinator_staff.find((s) => s.email === A).out_until = '2026-10-09'
APP.leads.push({ id: 'a3', first_name: 'Cal', last_name: 'Cole', phone: '4175550114', status: 'New', assigned_coordinator: '', created_at: ago(1) })
r = await run()
ck('out · Angiel is out, so Cal goes to Krystal (next after Krystal would be Angiel)', lead('a3').assigned_coordinator === 'Krystal', lead('a3'))
APP.coordinator_staff.find((s) => s.email === A).out_until = ''
APP.leads.push({ id: 'a4', first_name: 'Dee', last_name: 'Dunn', phone: '4175550115', status: 'New', assigned_coordinator: '', created_at: ago(1) })
r = await run()
ck('back · Angiel is back: Dee goes to Angiel (no makeup for the missed turn, no double turn for Krystal)', lead('a4').assigned_coordinator === 'Angiel', lead('a4'))

/* ── owner out keeps the lead; the person on Operations gets the card for first contact ── */
APP.coordinator_staff.find((s) => s.email === A).out_until = '2026-10-09'
APP.ops_items.push({ id: 'ops_lead_a4', kind: 'new_lead', source_id: 'a4', status: 'open', owner: A, owner_name: 'Angiel Rose', created_at: ago(1), title: 'New lead: Dee Dunn' })
r = await run()
ck('owner out · Dee stays Angiel’s (not moved)', lead('a4').assigned_coordinator === 'Angiel' && !lead('a4').moved_out_at && r.j.moved === 0, { lead: lead('a4'), moved: r.j.moved })
ck('owner out · Krystal (Operations) has the card on her desk and the history says so', card('a4').owner === A && (card('a4').also_for || []).includes(K) && /first contact: Angiel is out until 2026-10-09/.test(JSON.stringify(card('a4').history)), card('a4'))
ck('owner out · once only', ((r = await run()), r.j.turns.kept_while_out === 0), r.j.turns)
APP.coordinator_staff.find((s) => s.email === A).out_until = ''

/* ── Take it from the link page is helping while turns are on ── */
let p = await page('a4', K, { action: 'take' })
ck('take (on) · Krystal helps: Dee stays Angiel’s, Krystal is recorded as the helper', p.status === 200 && p.j.helping === true && lead('a4').assigned_coordinator === 'Angiel' && lead('a4').helpers.at(-1).name === 'Krystal', { p, l: lead('a4') })
ck('take (on) · the card stays Angiel’s with Krystal helping', card('a4').owner === A && card('a4').help_from === K && /stays Angiel's/.test(JSON.stringify(card('a4').history)), card('a4'))
ck('take (on) · the page gets the intro line', /Introduce Angiel as their Care Coordinator/.test(p.j.intro || ''), p.j)

/* ── Take it with turns off works as before ── */
seedT({ turns: false }); APP.leads[1].assigned_coordinator = 'Angiel'
APP.ops_items = [{ id: 'ops_lead_a1', kind: 'new_lead', source_id: 'a1', status: 'open', owner: A, owner_name: 'Angiel Rose', created_at: ago(3) }]
p = await page('a1', K, { action: 'take' })
ck('take (off) · as before: the inquiry becomes Krystal’s', p.status === 200 && lead('a1').assigned_coordinator === 'Krystal' && card('a1').owner === K, { p, l: lead('a1') })

for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n      ' + note))
const bad = res.filter((x) => !x[1]).length
console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
