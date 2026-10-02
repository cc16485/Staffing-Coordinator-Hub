// NO SILENT FAILURES, slice 2 · families group (2026-10-01): node nsf2_families_test.mjs
// Family, lead, campaign, community and office-alert senders: a text or email GoHighLevel refuses becomes a Needs
// Attention card ('send_problem'), never only a log. Runs lead-intake and the family "caregiver changed" text for
// real against a fake database and a GoHighLevel that says no, then scans every converted sender.
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)]);
const FN = 'supabase/functions';
const read = (f) => fs.readFileSync(path.join(FN, f), 'utf8');

/* ── fake database: app_data key/value arrays + plain tables ── */
let APP, TABLES;
const reset = () => { APP = { leads: [], ops_items: [] }; TABLES = { applicant_alerts: [{ name: 'Krystal Office', phone: '4175550999', email: 'office@example.test', active: true, alert_on: ['lead'] }], circle_contacts: [], care_circles: [] }; };
const q = (t) => {
  const st = { f: [], op: 'select', row: null };
  const rows = () => {
    if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]; return k != null ? [{ key: k[0], data: APP[k[0]] ?? null }] : []; }
    return (TABLES[t] || []).filter((r) => st.f.every(([c, v]) => v.map(String).includes(String(r[c]))));
  };
  const b = {
    select() { return b; }, order() { return b; }, range() { return b; }, limit() { return b; }, gte() { return b; }, lte() { return b; },
    lt() { return b; }, gt() { return b; }, neq() { return b; }, is() { return b; }, not() { return b; }, or() { return b; }, ilike() { return b; },
    contains() { return b; },
    eq(c, v) { st.f.push([c, [v]]); return b; }, in(c, v) { st.f.push([c, v]); return b; },
    insert(r) { st.op = 'insert'; st.row = r; return b; }, upsert(r) { st.op = 'upsert'; st.row = r; return b; },
    update(r) { st.op = 'update'; st.row = r; return b; }, delete() { st.op = 'delete'; return b; },
    maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: null })); },
    single() { return b.maybeSingle(); },
    then(ok, bad) {
      let out;
      if (st.op === 'select') out = { data: rows(), error: null };
      else if (t === 'app_data' && st.op === 'upsert') { APP[st.row.key] = st.row.data; out = { data: null, error: null }; }
      else { (TABLES[t] ||= []).push(st.row); out = { data: null, error: null }; }
      return Promise.resolve(out).then(ok, bad);
    },
  };
  return b;
};
const db = { from: q, rpc: async (fn, a) => {
  if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => x.id === a.item.id); if (i >= 0) arr[i] = a.item; else arr.push(a.item); }
  return { data: null, error: null };
} };
globalThis.__db = db;

/* ── GoHighLevel finds every contact but refuses every message ── */
const POSTS = [];
globalThis.fetch = async (url, o) => {
  url = String(url);
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'ct_1', dnd: false } }), { status: 200 });
  if (url.includes('/contacts/')) return new Response(JSON.stringify({ contact: { id: 'ct_1', dnd: false } }), { status: 200 });
  if (url.includes('/conversations/messages') && o?.method === 'POST') { POSTS.push(JSON.parse(o.body)); return new Response(JSON.stringify({ message: 'Contact is invalid' }), { status: 422 }); }
  return new Response('{}', { status: 200 });
};
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', LEAD_INTAKE_TOKEN: 'L', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc' };
let handler;
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } };
const load = async (name) => {
  const src = read(`${name}/index.ts`).replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db');
  const tmp = path.join(process.cwd(), FN, name, '_nsf2f.ts'); fs.writeFileSync(tmp, src);
  try { await import(tmp + '?' + Math.random()); } finally { fs.unlinkSync(tmp); }
  return handler;
};
const cards = () => (APP.ops_items || []).filter((i) => i.kind === 'send_problem');

/* ════ lead-intake: the office "new lead" alert GoHighLevel refused ════ */
reset();
const h = await load('lead-intake');
const r = await (await h(new Request('https://x/fn?token=L', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ first_name: 'Ann', last_name: 'Gray', phone: '4175550303', message: 'need help for mom' }) }))).json();
const staffCards = cards().filter((c) => c.sender === 'staff-alert')
ck('lead-intake · the lead is still saved when every alert is refused', r.status === 'lead created' && APP.leads.length === 1, r);
ck('lead-intake · GoHighLevel was really asked (the office alert by email and by text)', POSTS.some((p) => p.type === 'Email') && POSTS.some((p) => p.type === 'SMS'), POSTS);
ck('lead-intake · a refused office alert raises a Needs Attention card per channel, naming who missed it', staffCards.length === 2
  && staffCards.every((c) => c.status === 'open' && c.problem === 'failed' && c.who === 'Krystal Office' && /error 422/.test(c.reasons[0])), cards());
ck('lead-intake · a refused alert is not counted as an alert that went', r.alerted === 0, r);

/* ════ the family "caregiver changed" text (coverage job, nobody watching) ════ */
{
  const p = path.join(FN, '_shared/family-change-text.ts');
  const src = fs.readFileSync(p, 'utf8')
    .replace("from './covered-outside.ts'", "from '" + path.resolve(FN, '_shared/covered-outside.ts') + "'")
    .replace("from './outreach.ts'", "from '" + path.resolve(FN, '_shared/outreach.ts') + "'")
    .replace("from './send-problems.ts'", "from '" + path.resolve(FN, '_shared/send-problems.ts') + "'")
    .replace("from './caregiver-card-link.ts'", "from '" + path.resolve(FN, '_shared/caregiver-card-link.ts') + "'");
  const tmp = path.join(process.cwd(), '_nsf2f_fct.ts'); fs.writeFileSync(tmp, src);
  const M = await import(tmp); fs.unlinkSync(tmp);
  reset();
  TABLES.care_circles = [{ id: 'C1', client_name: 'Mary Smith', active: true, axiscare_client_id: '501' }];
  TABLES.circle_contacts = [{ circle_id: 'C1', name: 'Sue Smith', phone: '(417) 555-0101', sms_consent: true }];
  TABLES.caregiver_profiles = [];
  const gate = async () => ({ contactId: 'ct_sue' });
  const refuse = async () => new Response(JSON.stringify({ message: 'Carrier rejected' }), { status: 400 });
  const out = await M.notifyFamilyOfChange(db, { token: 't', locationId: 'l' },
    { client: 'Mary Smith', client_axiscare_id: '501', covered_by: 'Jane Doe', calling_off: 'Bo Smith' },
    { family_caregiver_change_text_approved: { by: 'samantha' } }, { whenText: 'Wed 9am' }, gate, refuse);
  const c = cards();
  ck('family change text · a refused text is still left to retry (never faked as sent)', out.outcome === 'retry' && out.count === 0, out);
  ck('family change text · and it raises a card naming the family member and the number', c.length === 1 && c[0].sender === 'family-change-text'
    && c[0].who === 'Sue Smith' && c[0].phone === '+14175550101' && c[0].domain === 'client_care' && /caregiver-change text/.test(c[0].title), c);
}

/* ════ scans: no automatic family/office send posts to GoHighLevel unchecked ════ */
const CONVERTED = ['lead-intake', 'lead-nurture', 'lead-followup', 'campaign-auto', 'cc-417', 'circle-send', 'cc-corner', 'cc-memories',
  'cc-story', 'cc-feedback', 'ghe-reminders', 'shared-backup', 'automation-watchdog']
for (const f of CONVERTED) {
  const s = read(`${f}/index.ts`)
  ck(`scan · ${f}: every message goes through ghlSendChecked (no raw POST to conversations/messages left)`,
    !/conversations\/messages/.test(s) && /ghlSendChecked\(/.test(s) && /NO SILENT FAILURES \(2026-10-01\)/.test(s))
}
ck('scan · family-change-text: the family text goes through ghlSendChecked', !/conversations\/messages/.test(read('_shared/family-change-text.ts')) && /ghlSendChecked\(sb,/.test(read('_shared/family-change-text.ts')))
{
  const s = read('cc-booking/index.ts')
  ck('scan · cc-booking: both the office notice and the family confirmation pass a report (so a refusal is a card)',
    (s.match(/\{ db: supabase, sender: 'staff-alert', who: 'Samantha' \}/g) || []).length === 1 && (s.match(/\{ db: supabase, sender: 'cc-booking', who: name \}/g) || []).length === 1
    && /if \(report\) return await ghlSendChecked\(/.test(s))
}
{
  const s = read('lead-digest/index.ts')
  ck('scan · lead-digest: a scheduled brief that fails (refused, no contact, unreachable) raises a card; a staff test brief does not',
    (s.match(/await briefFailed\(/g) || []).length === 3 && /const briefFailed = \(why: string\) => testTo \? Promise\.resolve\(\)/.test(s))
}
{
  const s = read('ops-escalate/index.ts')
  ck('scan · ops-escalate: a failed missed-call escalation text raises a card (and is still not stamped, so the next sweep retries)',
    /catch \(err\) \{[\s\S]{0,400}reportSendProblem\(admin, \{ sender: 'staff-alert', channel: 'sms'/.test(s) && /await sendSms\(tok, locationId, e164\(phone\), msg\)\n\s+it\.escalations\.push/.test(s))
}
{
  const s = read('automation-watchdog/index.ts')
  ck('scan · automation-watchdog: a person nobody reached is not counted as alerted, so the 6-hour suppression is not stamped',
    /if \(!went\) continue\n\s+alerted\+\+/.test(s) && /await unreachable\(t, 'no GoHighLevel contact/.test(s))
}
{
  const sp = read('_shared/send-problems.ts')
  ck('send-problems · the new sender names read in the office\'s words', ["'family-change-text'", "'lead-digest'", "'shared-backup'"].every((k) => sp.includes(k + ': [')))
}

console.log('\nNO SILENT FAILURES · slice 2 · families\n' + '='.repeat(60)); let all = true
for (const [n, g, note] of res) { all &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')) }
console.log('='.repeat(60)); console.log(all ? `ALL ${res.length} CHECKS PASS` : 'FAILED')
process.exit(all ? 0 : 1)
