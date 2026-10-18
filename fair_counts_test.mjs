// fair_counts_test.mjs · time off and coverage never count against someone (audit step 2, Samantha 2026-10-18): the REAL
// lead-watch against a fake database and clock. Made-up people only; nothing leaves this machine. node fair_counts_test.mjs
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
const R = globalThis.LeadRules
const seedF = ({ fair = true, out = true, turns = true } = {}) => { reset(); at('2026-10-06T15:00:00Z')
  APP.ops_settings.lead_rungs_live = true; APP.ops_settings.fair_counts_live = fair
  APP.ops_settings.lead_rotation_live = turns; APP.ops_settings.lead_rotation = { people: [{ name: 'Krystal', on: true }, { name: 'Angiel', on: true }] }
  if (out) APP.coordinator_staff.find((s) => s.email === A).out_until = '2026-10-09'
  APP.duty_windows[0].backup_person = ''
  APP.leads = [{ id: 'q1', first_name: 'Quinn', last_name: 'Q', phone: '4175550188', source: 'Website', status: 'New', assigned_coordinator: 'Angiel', created_at: ago(31) }]
  APP.ops_items = [{ id: 'ops_lead_q1', kind: 'new_lead', source_id: 'q1', status: 'open', owner: A, owner_name: 'Angiel Rose', created_at: ago(31), title: 'New lead: Quinn Q' }]
}
/* ── off: as before ── */
seedF({ fair: false }); let r = await run()
const ql = () => lead('q1')
ck('off · Angiel (out) is still texted at 5 minutes and counted late and as a miss, as before', SENT.some((m) => m.to === '+14175550903') && ql().rungs.owner_at && !ql().rungs.owner_excused && ql().speed_miss && !ql().speed_miss.excused, { SENT, l: ql() })
let n = R.ownerNumbers(APP.leads, R.responseHours({}), { now: new Date().toISOString(), days: 30, names: { [A]: 'Angiel Rose', [K]: 'Krystal Land', [S]: 'Samantha T' } })
ck('off · the team table shows Angiel 1 late, 1 miss', (n.now.by_owner.find((o) => o.owner === 'Angiel') || {}).misses === 1 && (n.now.by_owner.find((o) => o.owner === 'Angiel') || {}).late === 1, n.now.by_owner)
/* ── on, Angiel out ── */
seedF(); r = await run()
ck('on · Angiel (out) gets no text; Krystal (on Operations) is told she is covering, and it stays Angiel’s lead', !SENT.some((m) => m.to === '+14175550903') && SENT.some((m) => m.to === '+14175550902' && /covering for Angiel \(out until 2026-10-09\)/.test(m.message) && /stays Angiel's lead/.test(m.message)) && ql().assigned_coordinator === 'Angiel', SENT)
ck('on · the stamps say excused (time off), the miss too', ql().rungs.owner_excused === 'out' && ql().rungs.manager_excused === 'out' && ql().speed_miss && ql().speed_miss.excused === 'out', ql())
n = R.ownerNumbers(APP.leads, R.responseHours({}), { now: new Date().toISOString(), days: 30, names: { [A]: 'Angiel Rose', [K]: 'Krystal Land', [S]: 'Samantha T' } })
const an = n.now.by_owner.find((o) => o.owner === 'Angiel') || {}
ck('on · the team table counts no late and no miss for Angiel, and shows 1 excused', an.late === 0 && !an.misses && an.excused === 1, n.now.by_owner)
/* ── on, Angiel not out: counted as usual ── */
seedF({ out: false }); r = await run()
ck('on · when the owner is NOT out, the usual text and the usual miss', SENT.some((m) => m.to === '+14175550903') && ql().speed_miss && !ql().speed_miss.excused, { SENT, l: ql() })

/* ── on, lead turns OFF: the lead moves to Krystal (on Operations); she is covering, so nothing counts against her ── */
seedF({ turns: false }); r = await run()
n = R.ownerNumbers(APP.leads, R.responseHours({}), { now: new Date().toISOString(), days: 30, names: { [A]: 'Angiel Rose', [K]: 'Krystal Land', [S]: 'Samantha T' } })
const kn = n.now.by_owner.find((o) => o.owner === 'Krystal') || {}
ck('on, turns off · the lead moved to Krystal; her late and miss are excused (covering), not counted', ql().assigned_coordinator === 'Krystal' && ql().speed_miss && ql().speed_miss.excused === 'covering' && kn.late === 0 && !kn.misses && kn.excused === 1, { l: ql(), kn })

for (const [n2, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n2 + (ok ? '' : '\n      ' + note))
const bad = res.filter((x) => !x[1]).length
console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
