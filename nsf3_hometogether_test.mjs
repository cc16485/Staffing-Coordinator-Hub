// NO SILENT FAILURES · HomeTogether group (2026-10-01): node nsf3_hometogether_test.mjs
// HomeTogether Hire sign-ups (ht-local), the support form (ht-support), the support inbox forward (ht-inbound), the
// mail relay (resend-relay), the background-check payment webhook (stripe-webhook) and the AI interview webhook
// (vapi-interview): an email GoHighLevel or Resend refuses becomes a Needs Attention card ('send_problem') on the
// same Caring Companions list, never only a log. Each function runs for real against a fake database, a GoHighLevel
// and a Resend that say no; then once with both saying yes (no card).
import fs from 'fs'; import path from 'path'; import crypto from 'crypto';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)]);
const FN = 'supabase/functions';
const read = (f) => fs.readFileSync(path.join(FN, f), 'utf8');

/* ── fake database: app_data key/value arrays + plain tables ── */
let APP, TABLES;
const reset = () => { APP = { leads: [], ops_items: [], local_caregivers: [], local_families: [], ht_tickets: [] }; TABLES = {}; };
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

/* ── GoHighLevel and Resend: 'no' refuses every message, 'throw' cannot be reached, 'yes' accepts ── */
let MODE = 'no'; const GHL = []; const RESEND = [];
globalThis.fetch = async (url, o) => {
  url = String(url);
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'ct_1', dnd: false } }), { status: 200 });
  if (url.includes('/contacts/')) return new Response(JSON.stringify({ contact: { id: 'ct_1', dnd: false } }), { status: 200 });
  if (url.includes('/conversations/messages') && o?.method === 'POST') {
    GHL.push(JSON.parse(o.body));
    if (MODE === 'throw') throw new Error('network down');
    return MODE === 'yes' ? new Response('{"messageId":"m1"}', { status: 201 }) : new Response(JSON.stringify({ message: 'Contact is invalid' }), { status: 422 });
  }
  if (url.includes('api.resend.com/emails')) {
    RESEND.push(JSON.parse(o.body));
    if (MODE === 'throw') throw new Error('network down');
    return MODE === 'yes' ? new Response('{"id":"re_1"}', { status: 200 }) : new Response(JSON.stringify({ message: 'The domain is not verified' }), { status: 403 });
  }
  return new Response('{}', { status: 200 });
};
const RELAY_SECRET = 'r'.repeat(40);
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', HT_ORDER_TOKEN: 'T',
  RESEND_API_KEY: 're_key', RELAY_SECRET, STRIPE_WEBHOOK_SECRET: 'whsec_test', VAPI_SECRET: 'vapi' };
let handler;
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } };
const load = async (name) => {
  const src = read(`${name}/index.ts`).replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db');
  const tmp = path.join(process.cwd(), FN, name, '_nsf3h.ts'); fs.writeFileSync(tmp, src);
  try { await import(tmp + '?' + Math.random()); } finally { fs.unlinkSync(tmp); }
  return handler;
};
const post = async (h, url, body, headers = {}) => {
  const r = await h(new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }));
  let j = null; try { j = await r.json(); } catch { /* */ } return { status: r.status, j };
};
const cards = () => (APP.ops_items || []).filter((i) => i.kind === 'send_problem');
const run = (mode) => { reset(); MODE = mode; GHL.length = 0; RESEND.length = 0; };

/* ════ ht-local: a family sign-up (public form, nobody watching) ════ */
const local = await load('ht-local');
const fam = { kind: 'family', name: 'Ann Gray', email: 'ann@example.test', phone: '4175550303', zip: '65804' };
run('no');
let r = await post(local, 'https://x/ht-local?token=T', fam);
let c = cards();
ck('ht-local · the family request is still saved and answered ok when both emails are refused', r.j?.ok === true && APP.local_families.length === 1, r);
ck('ht-local · GoHighLevel was really asked (the office alert and the family confirmation)', GHL.length === 2 && GHL.every((p) => p.type === 'Email'), GHL);
ck('ht-local · the refused office alert raises a card (HomeTogether Hire alert to the office)', c.some((x) => x.sender === 'ht-local-alert' && x.problem === 'failed'
  && x.address === 'samantha@mo-care.com' && x.domain === 'office_ops' && /HomeTogether Hire alert/.test(x.title) && /error 422/.test(x.reasons[0])), c);
ck('ht-local · the refused family confirmation raises its own card (HomeTogether Hire message)', c.some((x) => x.sender === 'ht-local' && x.problem === 'failed'
  && x.address === 'ann@example.test' && /HomeTogether Hire message/.test(x.title)), c);
run('throw');
r = await post(local, 'https://x/ht-local?token=T', fam);
ck('ht-local · GoHighLevel unreachable: still a card, never a silent catch', cards().length === 2 && cards().every((x) => /could not be reached/.test(x.reasons[0])), cards());
run('yes');
r = await post(local, 'https://x/ht-local?token=T', fam);
ck('ht-local · when GoHighLevel accepts: both go, no card', GHL.length === 2 && cards().length === 0, cards());

/* ════ ht-support: the public support form's confirmation (Resend) ════ */
const support = await load('ht-support');
const ticketBody = { name: 'Bo Lee', email: 'bo@example.test', message: 'my TV will not connect' };
run('no');
r = await post(support, 'https://x/ht-support?token=T', ticketBody);
c = cards();
ck('ht-support · the ticket is saved and the form still says ok', r.j?.ok === true && /^HT-/.test(r.j?.ticket_no) && APP.ht_tickets.length === 1, r);
ck('ht-support · a confirmation Resend refuses raises a card (HomeTogether support email) naming the ticket', RESEND.length === 1 && c.length === 1
  && c[0].sender === 'ht-support' && c[0].address === 'bo@example.test' && /HomeTogether support email/.test(c[0].title) && /Resend error 403/.test(c[0].reasons[0])
  && c[0].detail.includes(r.j?.ticket_no), c);
run('yes');
r = await post(support, 'https://x/ht-support?token=T', ticketBody);
ck('ht-support · when Resend accepts: no card', RESEND.length === 1 && cards().length === 0, cards());

/* ════ ht-inbound: the forward of a customer's email to Samantha ════ */
const inbound = await load('ht-inbound');
const mail = { type: 'email.received', data: { from: 'Cy Day <cy@example.test>', subject: 'Help please', text: 'the screen is black' } };
run('no');
r = await post(inbound, 'https://x/ht-inbound?token=T', mail);
c = cards();
ck('ht-inbound · the ticket is still stored', r.j?.ok === true && APP.ht_tickets.length === 1, r);
ck('ht-inbound · a forward Resend refuses (a customer message nobody would see) raises a card naming the customer and ticket', RESEND.length === 1 && c.length === 1
  && c[0].sender === 'ht-inbound' && c[0].address === 'samantha@mo-care.com' && /HomeTogether support email forwarded/.test(c[0].title)
  && c[0].detail.includes('cy@example.test') && c[0].detail.includes(r.j?.ticket_no), c);
run('throw');
r = await post(inbound, 'https://x/ht-inbound?token=T', mail);
ck('ht-inbound · Resend unreachable: still a card', r.j?.ok === true && cards().length === 1 && /could not be reached/.test(cards()[0].reasons[0]), cards());
delete ENV.RESEND_API_KEY; run('yes');
r = await post(inbound, 'https://x/ht-inbound?token=T', mail);
ck('ht-inbound · no Resend key at all: nothing could be forwarded, so a card', RESEND.length === 0 && cards().length === 1 && /RESEND_API_KEY/.test(cards()[0].reasons[0]), cards());
ENV.RESEND_API_KEY = 're_key';
run('yes');
r = await post(inbound, 'https://x/ht-inbound?token=T', mail);
ck('ht-inbound · when Resend accepts: no card', RESEND.length === 1 && cards().length === 0, cards());

/* ════ resend-relay: called by jobs (htl-founding-emails) ════ */
const relay = await load('resend-relay');
const rmail = { to: 'friend@example.test', subject: 'Welcome, founding caregiver', html: '<p>hi</p>' };
run('no');
r = await post(relay, 'https://x/resend-relay', rmail, { 'x-relay-secret': RELAY_SECRET });
c = cards();
ck('resend-relay · a refused relay still answers the caller with its error (502, ok false, Resend status)', r.status === 502 && r.j?.ok === false && r.j?.status === 403, r);
ck('resend-relay · AND raises a card (HomeTogether email sent through the relay) with the subject', c.length === 1 && c[0].sender === 'resend-relay'
  && c[0].address === 'friend@example.test' && /HomeTogether email sent through the relay/.test(c[0].title) && /Welcome, founding caregiver/.test(c[0].detail), c);
run('throw');
r = await post(relay, 'https://x/resend-relay', rmail, { 'x-relay-secret': RELAY_SECRET });
ck('resend-relay · Resend unreachable: the caller still gets its 500 error, and a card is raised', r.status === 500 && /network down/.test(r.j?.error) && cards().length === 1, { r, c: cards() });
run('yes');
r = await post(relay, 'https://x/resend-relay', rmail, { 'x-relay-secret': RELAY_SECRET });
ck('resend-relay · when Resend accepts: ok, no card', r.j?.ok === true && cards().length === 0, { r, c: cards() });

/* ════ stripe-webhook: the $45 background-check payment (Stripe webhook) ════ */
const stripe = await load('stripe-webhook');
const stripeEvent = () => {
  const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', metadata: { hl_caregiver_id: 'cg1' } } } });
  const t = Math.floor(Date.now() / 1000);
  const v1 = crypto.createHmac('sha256', ENV.STRIPE_WEBHOOK_SECRET).update(`${t}.${payload}`).digest('hex');
  return [payload, { 'stripe-signature': `t=${t},v1=${v1}` }];
};
run('no'); APP.local_caregivers = [{ id: 'cg1', name: 'Dee Fox', email: 'dee@example.test', status: 'background check' }];
let [pl, hd] = stripeEvent();
r = await post(stripe, 'https://x/stripe-webhook', pl, hd);
c = cards();
ck('stripe-webhook · the payment is still recorded', r.j?.local === true && !!APP.local_caregivers[0].paid_at, r);
ck('stripe-webhook · the refused office note raises a card (HomeTogether payment alert to the office)', c.some((x) => x.sender === 'stripe-webhook-alert'
  && x.address === 'samantha@mo-care.com' && /HomeTogether payment alert/.test(x.title) && /error 422/.test(x.reasons[0])), c);
ck('stripe-webhook · the refused caregiver receipt raises its own card (HomeTogether payment email) naming her', c.some((x) => x.sender === 'stripe-webhook'
  && x.address === 'dee@example.test' && x.who === 'Dee' && /HomeTogether payment email/.test(x.title)), c);
run('throw'); APP.local_caregivers = [{ id: 'cg1', name: 'Dee Fox', email: 'dee@example.test' }];
[pl, hd] = stripeEvent();
r = await post(stripe, 'https://x/stripe-webhook', pl, hd);
ck('stripe-webhook · GoHighLevel unreachable: the office note failing no longer skips the caregiver\'s email; both raise cards', GHL.length === 2 && cards().length === 2, cards());
run('yes'); APP.local_caregivers = [{ id: 'cg1', name: 'Dee Fox', email: 'dee@example.test' }];
[pl, hd] = stripeEvent();
r = await post(stripe, 'https://x/stripe-webhook', pl, hd);
ck('stripe-webhook · when GoHighLevel accepts: both go, no card', GHL.length === 2 && cards().length === 0, cards());

/* ════ vapi-interview: the end-of-call webhook's alert to Samantha ════ */
const vapi = await load('vapi-interview');
const report = { message: { type: 'end-of-call-report', customer: { number: '+14175550404' }, summary: 'warm, experienced', durationSeconds: 300 } };
run('no'); APP.local_caregivers = [{ id: 'cg2', name: 'Eve Ray', phone: '(417) 555-0404' }];
r = await post(vapi, 'https://x/vapi-interview?src=vapi', report, { 'x-vapi-secret': 'vapi' });
c = cards();
ck('vapi-interview · the interview is still saved on the caregiver', r.j?.matched === true && APP.local_caregivers[0].interview_done === true, r);
ck('vapi-interview · a refused alert raises a card (HomeTogether AI interview alert to the office)', c.length === 1 && c[0].sender === 'vapi-interview'
  && c[0].address === 'samantha@mo-care.com' && /HomeTogether AI interview alert/.test(c[0].title), c);
run('yes'); APP.local_caregivers = [{ id: 'cg2', name: 'Eve Ray', phone: '(417) 555-0404' }];
r = await post(vapi, 'https://x/vapi-interview?src=vapi', report, { 'x-vapi-secret': 'vapi' });
ck('vapi-interview · when GoHighLevel accepts: no card', GHL.length === 1 && cards().length === 0, cards());

/* ════ scans ════ */
for (const f of ['ht-local', 'stripe-webhook', 'vapi-interview']) {
  const s = read(`${f}/index.ts`);
  ck(`scan · ${f}: every GoHighLevel email goes through ghlSendChecked (no raw POST to conversations/messages left)`,
    !/conversations\/messages/.test(s) && /ghlSendChecked\(/.test(s) && /NO SILENT FAILURES \(2026-10-01\)/.test(s));
}
for (const f of ['ht-support', 'ht-inbound', 'resend-relay']) {
  const s = read(`${f}/index.ts`);
  ck(`scan · ${f}: the Resend answer is checked and a refusal reports a failed send`,
    /api\.resend\.com\/emails/.test(s) && /\.ok\)/.test(s) && /failed: true/.test(s) && /NO SILENT FAILURES \(2026-10-01\)/.test(s));
}
{
  const sp = read('_shared/send-problems.ts');
  const names = ['ht-local', 'ht-local-alert', 'ht-support', 'ht-inbound', 'resend-relay', 'stripe-webhook', 'stripe-webhook-alert', 'vapi-interview'];
  ck('send-problems · every HomeTogether sender name reads "HomeTogether ..." and goes to office_ops',
    names.every((k) => new RegExp(`'${k}': \\['HomeTogether [^']+', 'office_ops'\\]`).test(sp)), names.filter((k) => !new RegExp(`'${k}': \\['HomeTogether`).test(sp)));
}

console.log('\nNO SILENT FAILURES · HomeTogether\n' + '='.repeat(60)); let all = true;
for (const [n, g, note] of res) { all &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')); }
console.log('='.repeat(60)); console.log(all ? `ALL ${res.length} CHECKS PASS` : 'FAILED');
process.exit(all ? 0 : 1);
