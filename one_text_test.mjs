// One text per family (Speed to lead design, Samantha 2026-10-22: "maybe just one notification about the lead"):
// the REAL lead-watch with ops_settings.lead_one_text on, against the same fake world as lead_watch_494_test.mjs
// (made-up people only; nothing leaves this machine). node one_text_test.mjs
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
const seed = (live = true) => { reset(); at('2026-10-06T15:00:00Z'); APP.ops_settings.lead_rungs_live = live
  APP.leads = [
    { id: 'dia', first_name: 'Diane', last_name: 'Teague', client_first_name: 'Marjorie', phone: '4175550131', source: 'Website', status: 'New', assigned_coordinator: 'Krystal', created_at: ago(6), contact_events: [{ at: ago(6), channel: 'web', direction: 'in', outcome: 'inquiry', actor: 'family', note: 'Mom fell' }] },
    { id: 'pat', first_name: 'Patrice', last_name: 'Keller', phone: '4175550164', source: 'Website', status: 'New', assigned_coordinator: '', created_at: ago(2) },
    { id: 'har', first_name: 'Harold', last_name: 'Pruitt', phone: '4175550177', status: 'New', assigned_coordinator: 'Krystal', created_at: ago(40), first_human_attempt_at: ago(30), contact_events: [{ at: ago(30), channel: 'call', direction: 'out', outcome: 'voicemail', actor: 'human', by: K }] },
    { id: 'old', first_name: 'Olive', last_name: 'Sims', phone: '4175550199', status: 'New', assigned_coordinator: 'Krystal', created_at: '2026-10-01T15:00:00Z' },
    { id: 'lost', first_name: 'Lou', last_name: 'Reed', phone: '4175550100', status: 'Lost', assigned_coordinator: 'Krystal', created_at: ago(50) } ]
  APP.ops_items = [{ id: 'ops_lead_dia', kind: 'new_lead', source_id: 'dia', status: 'open', owner: K, owner_name: 'Krystal Land', created_at: ago(6), urgency: 'high', clock_urgent: true, title: 'New care inquiry: Diane Teague' }] }


/* ── one text per family: on ── */
seed(true); APP.ops_settings.lead_one_text = true; let r = await run()
ck('one text · 6 minutes: Krystal (the owner) still gets her ONE text', SENT.length === 1 && SENT[0].to === '+14175550902' && /^Krystal, a new inquiry needs a call: Diane Teague/.test(SENT[0].message) && r.j.one_text === true, SENT)
at('2026-10-06T15:10:00Z'); r = await run()
const dia = () => SENT.filter((x) => /Diane/.test(x.message))
ck('one text · 16 minutes: no text to the backup, but Diane is on Angiel\'s My Work and stamped quiet', dia().length === 1 && !SENT.some((x) => x.to === '+14175550903') && card('dia').also_for.includes(A)
  && lead('dia').rungs.backup_at && lead('dia').rungs.backup_quiet === true && lead('dia').rungs.backup_sent === false && r.j.quiet_rungs >= 1, [SENT, lead('dia').rungs, r.j])
at('2026-10-06T15:25:00Z'); r = await run()
ck('one text · 31 minutes: no text to Samantha, but the card is escalated and the MISS is still counted against Krystal', dia().length === 1 && !SENT.some((x) => x.to === '+14175550901')
  && card('dia').escalation?.to === S && lead('dia').speed_miss && lead('dia').speed_miss.owner === K && lead('dia').rungs.manager_quiet === true, [SENT, card('dia').escalation, lead('dia').speed_miss])
ck('one text · each family gets exactly one text (Patrice too)', SENT.filter((x) => /Patrice/.test(x.message)).length === 1 && SENT.every((x) => x.to === '+14175550902'), SENT)
ck('one text · the events say no text, never "text failed"', T.op_events.filter((e) => e.verb === 'lead_rung' && e.item_id === 'dia').length === 3
  && T.op_events.filter((e) => e.verb === 'lead_rung' && e.item_id === 'dia' && !/Owner told/.test(e.summary)).every((e) => /no text: one text per family/.test(e.summary) && !/text failed/.test(e.summary)), T.op_events.map((e) => e.summary))
ck('one text · run again later: nothing more is sent or stamped twice', (at('2026-10-06T15:45:00Z'), (r = await run()), dia().length === 1 && SENT.filter((x) => /Patrice/.test(x.message)).length === 1 && T.op_events.filter((e) => e.verb === 'lead_rung' && e.item_id === 'dia').length === 3))

/* ── owner out: the one text goes to whoever covers ── */
seed(true); APP.ops_settings.lead_one_text = true; APP.coordinator_staff[1].out_until = '2026-10-08'
APP.duty_windows[0].person = A; APP.duty_windows[0].backup_person = ''
r = await run()
ck('one text · Krystal is out: Diane\'s one 5-minute text goes to Angiel', SENT.some((s) => /^Angiel, a new inquiry needs a call: Diane/.test(s.message)) && !SENT.some((s) => s.to === '+14175550902'), SENT)

/* ── practice (speed to lead off): one text changes nothing about practice ── */
seed(false); APP.ops_settings.lead_one_text = true; let before = JSON.stringify(APP.leads); r = await run()
ck('one text · practice still writes and sends nothing', !SENT.length && JSON.stringify(APP.leads) === before && r.j.live === false)

/* ── off: the old three texts ── */
seed(true); r = await run(); at('2026-10-06T15:10:00Z'); r = await run(); at('2026-10-06T15:25:00Z'); r = await run()
ck('one text off · three texts about Diane, as before, none stamped quiet', SENT.filter((s) => /Diane/.test(s.message)).length === 3 && !lead('dia').rungs.backup_quiet && !lead('dia').rungs.manager_quiet && r.j.one_text === false, SENT)

for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n      ' + note))
const bad = res.filter((x) => !x[1]).length
console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
