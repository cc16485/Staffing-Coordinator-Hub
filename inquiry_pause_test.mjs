// Step 0 · 0a · the inquiry acknowledgment and day-1/day-3 follow-ups are paused. The REAL lead-followup and
// lead-intake functions against a fake database and a fake GoHighLevel. node inquiry_pause_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const FN = 'supabase/functions';
/* office hours, whatever the real clock says (both functions read the Chicago hour this way) */
const realTLS = Date.prototype.toLocaleString;
Date.prototype.toLocaleString = function (loc, o) { return (o && o.hour === '2-digit' && !o.minute) ? '10' : realTLS.call(this, loc, o); };

let APP, settingsBroken = false, sent;
const reset = (settings, leads) => { APP = { leads: JSON.parse(JSON.stringify(leads || [])), ops_items: [], ...(settings === undefined ? {} : { ops_settings: settings }) }; sent = []; settingsBroken = false; };
const q = (t) => { const st = { f: [], op: 'select' }; const b = {
  select() { return b; }, order() { return b; }, range() { return b; }, limit() { return b; }, in() { return b; },
  eq(c, v) { st.f.push([c, v]); return b; }, contains() { return b; }, not() { return b; },
  maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: x.error })); },
  then(ok) {
    if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1];
      if (k === 'ops_settings' && settingsBroken) return Promise.resolve({ data: null, error: { message: 'boom' } }).then(ok);
      return Promise.resolve({ data: k in APP ? [{ key: k, data: APP[k] }] : [], error: null }).then(ok); }
    if (t === 'applicant_alerts') return Promise.resolve({ data: [{ name: 'Office', phone: '+14170000000', alert_on: ['lead'], active: true }], error: null }).then(ok);
    return Promise.resolve({ data: [], error: null }).then(ok);
  } }; return b; };
globalThis.__db = { from: q, rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => x.id === a.item.id); if (i >= 0) arr[i] = a.item; else arr.push(a.item); } return { data: null, error: null }; } };
globalThis.fetch = async (url, o) => {
  url = String(url); const body = o && o.body ? JSON.parse(o.body) : {};
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C_' + (body.phone || body.email), dnd: false } }), { status: 200 });  /* real GHL answers with dnd (0b-2 proves it live) */
  if (url.includes('/conversations/messages')) { sent.push({ to: body.contactId, type: body.type, text: body.message || body.subject }); return new Response('{}', { status: 200 }); }
  if (url.includes('.axiscare.com')) return new Response(JSON.stringify({ results: { clients: [], nextPage: null } }), { status: 200 });
  return new Response('{}', { status: 200 });
};
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', LEAD_INTAKE_TOKEN: 'L', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485' };
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } };
const load = async (name) => { const src = fs.readFileSync(`${FN}/${name}/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db');
  const tmp = path.join(process.cwd(), FN, name, '_t.ts'); fs.writeFileSync(tmp, src); try { await import(tmp + '?' + Math.random()); } finally { fs.unlinkSync(tmp); } return handler; };
const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const web = [{ channel: 'web', direction: 'in', outcome: 'inquiry', actor: 'family' }];
const LEADS = [
  { id: 'fresh', first_name: 'Fay', phone: '4175550001', status: 'New', created_at: hoursAgo(1), contact_events: web },
  { id: 'day1', first_name: 'Dee', phone: '4175550002', status: 'New', created_at: hoursAgo(30), contact_events: web, ack_sent_at: hoursAgo(29) },
  { id: 'day3', first_name: 'Tia', phone: '4175550003', status: 'New', created_at: hoursAgo(80), contact_events: web, ack_sent_at: hoursAgo(79), nudge_1_at: hoursAgo(50) },
];
const familySends = () => sent.filter((m) => m.to !== 'C_+14170000000' && m.to !== 'C_4170000000');

/* ── lead-followup (the sweep) ── */
let h = await load('lead-followup');
const run = async (qs = '') => (await h(new Request('https://x/lead-followup' + qs, { method: 'POST' }))).json();
reset(undefined, LEADS); let r = await run();
ck('switches absent (as after deploy): no acknowledgment and no day-1/day-3 follow-up goes to any family',
  familySends().length === 0 && r.paused_ack === 1 && r.paused_followups === 2 && r.switches.inquiry_ack_live === false && r.switches.inquiry_followups_live === false, { r, sent });
ck('the office "lead waiting, nobody has called" alert still goes out', sent.some((m) => /nobody has called them yet/.test(m.text || '')), sent);
ck('nothing is stamped as sent while paused (so nothing is lost when it resumes)', !APP.leads.find((l) => l.id === 'fresh').ack_sent_at && !APP.leads.find((l) => l.id === 'day1').nudge_1_at);
reset({ inquiry_ack_live: false, inquiry_followups_live: false }, LEADS); r = await run('?dry=1');
ck('the dry run names what is being held back and shows both switches off', r.dry && r.would.paused_ack.length === 1 && r.would.paused_followups.length === 2 && r.would.acknowledge.length === 0 && r.would.nudge.length === 0, r);
reset({ inquiry_ack_live: true, inquiry_followups_live: false }, LEADS); r = await run();
ck('acknowledgment switched on, follow-ups off: only the fresh inquiry is greeted; no follow-ups', familySends().length === 1 && /We have your message/.test(familySends()[0].text) && r.paused_followups === 2, { r, sent });
reset({ inquiry_ack_live: true, inquiry_followups_live: true }, LEADS); r = await run();
ck('both switched on: behaves exactly as before (greeting plus both follow-ups)', familySends().length === 3 && r.acknowledged === 1 && r.nudged === 2, { r, sent });
reset({ inquiry_ack_live: 'true', inquiry_followups_live: 1 }, LEADS); r = await run();
ck('only a real true switches on (a text "true" or a 1 does not)', familySends().length === 0, sent);
reset({ inquiry_ack_live: true, inquiry_followups_live: true }, LEADS); settingsBroken = true; r = await run();
ck('settings unreadable: treated as off (fail closed)', familySends().length === 0 && r.switches.settings_read === false, { r, sent });

/* ── lead-intake (the web form) ── */
h = await load('lead-intake');
const form = async () => (await h(new Request('https://x/lead-intake?token=L', { method: 'POST', body: JSON.stringify({ first_name: 'Rae', last_name: 'Moss', phone: '4175550099', email: 'rae@x.com', message: 'help for mom' }), headers: { 'Content-Type': 'application/json' } }))).json();
reset(undefined, []); r = await form();
ck('web form, switch absent: the inquiry is saved and the office is told, but no greeting goes to the family',
  APP.leads.length === 1 && !APP.leads[0].ack_sent_at && !sent.some((m) => /We have your message/.test(m.text || '')), { r, sent, leads: APP.leads });
reset({ inquiry_ack_live: true }, []); r = await form();
ck('web form, switch on: the greeting goes out as before (text and email)', sent.filter((m) => /We have your message/.test(m.text || '')).length === 2 && !!APP.leads[0].ack_sent_at, sent);

Date.prototype.toLocaleString = realTLS;
console.log('\nSTEP 0 · 0a · INQUIRY MESSAGES PAUSED · TEST\n' + '='.repeat(60)); let all = true;
for (const [n, g, note] of res) { all &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')); }
console.log('='.repeat(60)); console.log(all ? `ALL ${res.length} CHECKS PASS` : 'FAILED');
