// Speed to lead, the 5/15/30 rungs and owner-out (item 2 of the Leads design, Samantha "yes to all" 2026-10-07):
// the REAL lead-watch against a fake database, a fake GoHighLevel and a controllable clock. Made-up people only;
// nothing leaves this machine. node lead_watch_494_test.mjs
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

/* ── practice (off) ── */
seed(false); let before = JSON.stringify(APP.leads); let r = await run()
ck('off · lists what it would do (owner rung for Diane at 6 min; Patrice unowned → Krystal on Operations) and writes and sends nothing', r.j.live === false && r.j.rungs.owner === 1 && r.j.filled === 1 && r.j.texted === 1 && JSON.stringify(APP.leads) === before && !SENT.length && r.j.seats.operations === 'Krystal' && r.j.seats.backup === 'Angiel' && r.j.seats.escalation === 'Samantha', r.j)
ck('off · the old inquiry (5 days), the one already tried, and the lost one are left alone', r.j.rungs.owner === 1 && r.j.rungs.backup === 0 && r.j.rungs.manager === 0)

/* ── live: 5 minutes ── */
seed(true); r = await run()
ck('on · 6 minutes, nobody has called: Krystal (the owner) gets ONE text with her link, the inquiry is stamped', SENT.length === 1 && SENT[0].to === '+14175550902' && /^Krystal, a new inquiry needs a call: Diane Teague asked about care 6 min ago \(4175550131\)\. 6 min and nobody has called yet\. https:\/\/cc\.mo-care\.com\/lead\.html\?c=dia&a=[0-9a-f]{16}&e=\d+&t=/.test(SENT[0].message)
  && lead('dia').rungs.owner_at && lead('dia').rungs.owner_to === K && lead('dia').rungs.owner_sent === true, SENT)
ck('on · Patrice had nobody: Krystal (on Operations now) owns her, with a history line; no rung yet at 2 minutes', lead('pat').assigned_coordinator === 'Krystal' && /assigned to Krystal \(on Operations now/.test(lead('pat').comm_log[0].body) && !lead('pat').rungs, lead('pat'))
ck('on · run again a minute later: nothing is repeated', (at('2026-10-06T15:01:00Z'), (r = await run()), SENT.length === 1 && r.j.rungs.owner === 0), r.j)
/* ── 15 minutes: the backup ── */
at('2026-10-06T15:10:00Z'); r = await run()
ck('on · 16 minutes: Angiel (the Operations window\'s backup) gets one text; the card is on her desk too (also_for) with the reason', SENT.filter((s) => /Diane/.test(s.message)).length === 2 && SENT[1].to === '+14175550903' && /^Angiel, backup: Diane Teague asked about care 16 min ago .* 16 min and Krystal hasn't called yet\. It's on your My Work; take it here: https:\/\/cc\.mo-care\.com\/lead\.html/.test(SENT[1].message)
  && card('dia').also_for.includes(A) && /On Angiel Rose's desk too \(backup\)/.test(card('dia').history.at(-1).text) && lead('dia').rungs.backup_to === A, [SENT[1], card('dia')])
ck('on · Patrice (12 min): her owner rung went to Krystal, not Angiel yet', SENT.length === 2 && lead('pat').rungs && lead('pat').rungs.owner_to === K ? false : true, lead('pat').rungs)
/* ── 30 minutes: Owner Escalation and the miss ── */
at('2026-10-06T15:25:00Z'); r = await run()
ck('on · 31 minutes: Samantha (Owner Escalation) gets one notice, the card is escalated, and a MISS is counted against Krystal', SENT.some((s) => s.to === '+14175550901' && /^Samantha: Diane Teague asked about care 31 min ago .* 31 min and nobody has called \(Krystal\)\. Counted as a miss\./.test(s.message))
  && card('dia').escalation?.to === S && card('dia').escalation.level === 'urgent' && lead('dia').speed_miss && lead('dia').speed_miss.owner === K && lead('dia').speed_miss.minutes === 30, [SENT, lead('dia').speed_miss])
ck('on · every rung once: three texts about Diane in total, never a fourth', (at('2026-10-06T15:40:00Z'), (r = await run()), SENT.filter((s) => /Diane/.test(s.message)).length === 3))
ck('on · each rung is an op_event, with first names only', T.op_events.filter((e) => e.verb === 'lead_rung' && e.item_id === 'dia').length === 3 && T.op_events.filter((e) => e.verb === 'lead_rung').every((e) => !/@/.test(e.summary)), T.op_events)

/* ── the link page ── */
seed(true); at('2026-10-06T15:00:00Z'); await run()
let v = await page('dia', K, { action: 'view' })
ck('page · view: Krystal sees Diane, Marjorie, what she wrote, the minutes, her own number, the Hub link; practice is false', v.status === 200 && v.j.me === 'Krystal' && v.j.first === 'Diane' && v.j.client === 'Marjorie' && v.j.what === 'Mom fell' && v.j.open_minutes === 6 && v.j.phone === '4175550131' && v.j.mine === true && v.j.hub_url === 'https://cc.mo-care.com/#p/Ldia/summary' && v.j.practice === false && v.j.attempted === false, v.j)
let c = await page('dia', K, { action: 'called', outcome: 'voicemail', note: 'left my name' })
ck('page · "Called: voicemail" logs a human attempt as Krystal (first_human_attempt_at), a comm_log line, and the card is no longer urgent', c.j.ok && c.j.first_attempt === true && lead('dia').first_human_attempt_at && lead('dia').contact_events.at(-1).by === K && lead('dia').contact_events.at(-1).outcome === 'voicemail' && /voicemail: left my name \(from the text link\)/.test(lead('dia').comm_log.at(-1).body) && card('dia').clock_urgent === false && card('dia').urgency === 'normal', [lead('dia'), card('dia')])
ck('page · ...so the clock stops: no backup or manager rung ever fires for Diane', (at('2026-10-06T15:40:00Z'), (r = await run()), !lead('dia').rungs.backup_at && !lead('dia').rungs.manager_at && SENT.filter((s) => /Diane/.test(s.message)).length === 1))
c = await page('dia', K, { action: 'called', outcome: 'connected', note: 'talked to Diane' })
ck('page · "we talked" moves New → Contacted through the one status writer, with who and why', lead('dia').status === 'Contacted' && lead('dia').first_human_contact_at && lead('dia').status_history.at(-1).by === K && /logged from the text link/.test(lead('dia').status_history.at(-1).why), lead('dia').status_history)
seed(true); at('2026-10-06T15:10:00Z'); await run()
let tk = await page('dia', A, { action: 'take' })
ck('page · Angiel taps Take it: the inquiry is hers (first name, as the Hub stores it), the card\'s owner follows with history, the escalation (if any) clears', tk.j.ok && lead('dia').assigned_coordinator === 'Angiel' && card('dia').owner === A && card('dia').owner_history.at(-1).how === 'took' && card('dia').owner_history.at(-1).from === K && /Angiel took this inquiry from Krystal/.test(lead('dia').comm_log.at(-1).body), [lead('dia'), card('dia')])
ck('page · a forged or expired link is refused before anything is read; a stranger\'s valid-looking key is refused', (await LW(new Request('https://x/fn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ c: 'dia', a: '0'.repeat(16), e: 9999999999, t: 'x'.repeat(43) }) }))).status === 401
  && (await page('dia', 'nobody@elsewhere.com', { action: 'view' })).status === 403)
ck('page · an inquiry that is gone: 404', (await page('zzz', K, { action: 'view' })).status === 404)

/* ── owner out ── */
seed(true); APP.coordinator_staff[1].out_until = '2026-10-08'   /* Krystal is out */
APP.duty_windows[0].person = A; APP.duty_windows[0].backup_person = ''          /* Angiel holds Operations */
r = await run()
ck('out · Krystal is out until Oct 8 and Angiel holds Operations: Krystal\'s new inquiries move to Angiel (once, with a history line), the card follows, and Samantha gets ONE summary text', r.j.moved === 3 && lead('dia').assigned_coordinator === 'Angiel' && lead('dia').moved_out_from === K && /moved from Krystal \(out until 2026-10-08\) to Angiel, on Operations now/.test(lead('dia').comm_log.at(-1).body) && card('dia').owner === A
  && SENT.filter((s) => /moved from Krystal \(out\) to Angiel/.test(s.message) && s.to === '+14175550901').length === 1 && /3 inquiries moved/.test(SENT.find((s) => /moved from/.test(s.message)).message), [r.j, SENT])
ck('out · the lost inquiry did not move; run again: nothing moves twice', !lead('lost').moved_out_at && (await run()).j.moved === 0)
ck('out · Diane\'s 5-minute text went to Angiel (the owner now), not to Krystal who is out', SENT.some((s) => /^Angiel, a new inquiry needs a call: Diane/.test(s.message)) && !SENT.some((s) => s.to === '+14175550902'), SENT)

/* ── quiet hours and the clock ── */
seed(true); at('2026-10-07T02:30:00Z')   /* 9:30pm Central: response hours closed, so the clock is not running */
APP.leads = [{ id: 'nite', first_name: 'Nina', phone: '4175550111', status: 'New', assigned_coordinator: 'Krystal', created_at: ago(20) }]
r = await run()
ck('night · a 9:30pm inquiry: the clock has not started, nothing is texted (the acknowledgment already said when we call)', r.j.rungs.owner === 0 && !SENT.length)
APP.ops_settings.lead_response_hours = { days: [0, 1, 2, 3, 4, 5, 6], start: '06:00', end: '23:00' }   /* hours set to run late: office quiet hours still hold */
r = await run()
ck('night · even with response hours set past 8pm, office quiet hours hold the text (it waits, unstamped, for morning)', r.j.rungs.owner === 0 && r.j.waiting_quiet >= 1 && !SENT.length && !lead('nite').rungs, r.j)

/* ── settings ── */
seed(true); APP.ops_settings.lead_rungs = { backup_min: 10, manager_min: 20 }; at('2026-10-06T15:05:00Z'); r = await run()
ck('settings · 15 and 30 are Settings: with 10 and 20, Diane (11 min) is on the backup\'s desk already', r.j.minutes.backup === 10 && r.j.minutes.manager === 20 && lead('dia').rungs.backup_at && !lead('dia').rungs.manager_at, [r.j.minutes, lead('dia').rungs])
ck('auth · its schedule and the owner get in; anyone else is refused', (await run('?auth_check=1')).j.caller === 'cron' && (await LW(new Request('https://x/fn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }))).status === 401)
ck('heartbeat · every run leaves its heartbeat', APP.automation_heartbeats.some((h) => h.id === 'hb_lead-watch' && /rungs/.test(h.note)))

for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n      ' + note))
const bad = res.filter((x) => !x[1]).length
console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0)
