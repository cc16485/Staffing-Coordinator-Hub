// ONE CONTACT for office alerts (2026-10-01, Samantha: "change the office alerts to the one contact rule"):
// node staff_alerts_one_contact_test.mjs
// Office alerts used to find a staff member's GoHighLevel contact with phone AND email in one upsert. When the two sat
// on different contacts GHL matched the phone one, which had no email, and the alert email failed ("Contact has no
// email"). Every converted sender now finds the contact per channel through _shared/staff-contact.ts ghlStaffContact.
// 1) scans every converted file; 2) runs lead-intake's office "new lead" alert for real against a fake GoHighLevel
// where the staff member's phone and email are on two different contacts, and where the email is on no contact.
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)]);
const FN = 'supabase/functions';
const read = (f) => fs.readFileSync(path.join(FN, f), 'utf8');

/* ════ scans ════ */
const CONVERTED = ['automation-watchdog', 'campaign-auto', 'cc-417', 'carematch-watch', 'cc-corner', 'cc-feedback', 'cc-booking',
  'cc-story', 'coverage-run', 'coverage-reply', 'ghe-reminders', 'lead-digest', 'interview-messages', 'lead-intake', 'ops-escalate',
  'lead-followup', 'timekeeper-watch', 'shared-backup']
for (const f of CONVERTED) {
  const s = read(`${f}/index.ts`)
  ck(`scan · ${f}: imports ghlStaffContact and calls it`,
    /import \{ ghlStaffContact \} from '\.\.\/_shared\/staff-contact\.ts'/.test(s) && /ghlStaffContact\(/.test(s) && /ONE CONTACT \(2026-10-01\)/.test(s))
  /* any upsert left must not carry phone and email together (a single-address upsert, like lead-followup's DND
     probe by phone, is fine) */
  const both = []
  for (const m of s.matchAll(/contacts\/upsert/g)) {
    const body = s.slice(m.index, m.index + 600).split(/\n\s*\}\)\n/)[0]
    if (/\bphone\b/.test(body) && /\bemail\b/.test(body)) both.push(body.slice(0, 200))
  }
  ck(`scan · ${f}: no upsert sends phone and email together`, both.length === 0, both)
  ck(`scan · ${f}: no local contactFor helper left`, !/contactFor\s*=|contactFor\(/.test(s))
}

/* ════ a real run: lead-intake's office alert ════ */
let APP, TABLES;
const reset = (staff) => { APP = { leads: [], ops_items: [] }; TABLES = { applicant_alerts: [staff], circle_contacts: [], care_circles: [] }; };
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

/* ── a realistic GoHighLevel: contacts keyed by id; upsert matches the PHONE first (the bug), then the email;
      an email to a contact with no email is refused, as the real one does ── */
const digits = (p) => String(p ?? '').replace(/\D/g, '').slice(-10);
let CONTACTS, POSTS, UPSERTS, PUTS, nextId;
globalThis.fetch = async (url, o = {}) => {
  url = String(url); const method = o.method || 'GET';
  const ok = (j) => new Response(JSON.stringify(j), { status: 200 });
  if (url.includes('/contacts/search/duplicate')) {
    const u = new URL(url); const num = u.searchParams.get('number'); const em = u.searchParams.get('email');
    const c = Object.values(CONTACTS).find((x) => (num && x.phone && digits(x.phone) === digits(num)) || (em && x.email && x.email.toLowerCase() === em.toLowerCase()));
    return ok({ contact: c ? { id: c.id } : null });
  }
  if (url.includes('/contacts/upsert')) {
    const b = JSON.parse(o.body); UPSERTS.push(b);
    let c = Object.values(CONTACTS).find((x) => b.phone && x.phone && digits(x.phone) === digits(b.phone))
      || Object.values(CONTACTS).find((x) => b.email && x.email && x.email.toLowerCase() === String(b.email).toLowerCase())
    if (!c) { c = { id: 'ct_new' + (nextId++), firstName: b.firstName, phone: b.phone || '', email: b.email || '', dnd: false }; CONTACTS[c.id] = c }
    return ok({ contact: { ...c } });
  }
  const m = url.match(/\/contacts\/([^/?]+)$/);
  if (m && method === 'GET') { const c = CONTACTS[decodeURIComponent(m[1])]; return c ? ok({ contact: { ...c } }) : new Response('{}', { status: 404 }); }
  if (m && method === 'PUT') { const c = CONTACTS[decodeURIComponent(m[1])]; PUTS.push({ id: m[1], ...JSON.parse(o.body) }); Object.assign(c, JSON.parse(o.body)); return ok({ contact: { ...c } }); }
  if (url.includes('/conversations/messages') && method === 'POST') {
    const b = JSON.parse(o.body); POSTS.push(b);
    const c = CONTACTS[b.contactId];
    if (b.type === 'Email' && !c?.email) return new Response(JSON.stringify({ message: 'Contact has no email' }), { status: 422 });
    if (b.type === 'SMS' && !c?.phone) return new Response(JSON.stringify({ message: 'Contact has no phone' }), { status: 422 });
    return ok({ messageId: 'm' + POSTS.length });
  }
  return ok({});
};
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', LEAD_INTAKE_TOKEN: 'L', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc' };
let handler;
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } };
const load = async (name) => {
  const src = read(`${name}/index.ts`).replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db');
  const tmp = path.join(process.cwd(), FN, name, '_onec.ts'); fs.writeFileSync(tmp, src);
  try { await import(tmp + '?' + Math.random()); } finally { fs.unlinkSync(tmp); }
  return handler;
};
const STAFF = { name: 'Krystal Office', phone: '4175550999', email: 'krystal@example.test', active: true, alert_on: ['lead'] };
const post = (h) => h(new Request('https://x/fn?token=L', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ first_name: 'Ann', last_name: 'Gray', phone: '4175550303', message: 'need help for mom' }) })).then((r) => r.json());
const staffCards = () => (APP.ops_items || []).filter((i) => i.kind === 'send_problem' && i.sender === 'staff-alert');
const h = await load('lead-intake');

/* A: Krystal's phone is on one contact (no email), her email on another */
reset(STAFF); POSTS = []; UPSERTS = []; PUTS = []; nextId = 1;
CONTACTS = { ct_phone: { id: 'ct_phone', firstName: 'Krystal', phone: '+14175550999', email: '', dnd: false },
             ct_email: { id: 'ct_email', firstName: 'Krystal', phone: '', email: 'krystal@example.test', dnd: false } };
const rA = await post(h);
const emA = POSTS.filter((p) => p.type === 'Email'); const smA = POSTS.filter((p) => p.type === 'SMS' && /New lead/.test(p.message || ''));
ck('two contacts · the lead is saved and the office counts as alerted', rA.status === 'lead created' && rA.alerted === 1, rA);
ck('two contacts · the alert EMAIL goes to the contact that holds the email (not the phone contact)',
  emA.length === 1 && emA[0].contactId === 'ct_email', emA);
ck('two contacts · the alert TEXT goes to the contact that holds the phone', smA.length === 1 && smA[0].contactId === 'ct_phone', smA);
ck('two contacts · no staff upsert carried phone and email together, and nothing was merged or overwritten',
  !UPSERTS.some((u) => u.phone && u.email && digits(u.phone) === '4175550999') && PUTS.length === 0 && !CONTACTS.ct_phone.email, { UPSERTS, PUTS });
ck('two contacts · no Needs Attention card (nothing failed)', staffCards().length === 0, staffCards());

/* B: her email is on no contact yet, her phone contact has no email: the email is added to that one contact */
reset(STAFF); POSTS = []; UPSERTS = []; PUTS = []; nextId = 1;
CONTACTS = { ct_phone: { id: 'ct_phone', firstName: 'Krystal', phone: '+14175550999', email: '', dnd: false } };
const rB = await post(h);
const emB = POSTS.filter((p) => p.type === 'Email');
ck('one contact · the email is added to her existing phone contact (one person, one contact) and the alert email lands there',
  emB.length === 1 && emB[0].contactId === 'ct_phone' && PUTS.some((p) => p.id === 'ct_phone' && p.email === 'krystal@example.test') && rB.alerted === 1, { emB, PUTS, rB });
ck('one contact · no second contact was created for her', !Object.values(CONTACTS).some((c) => c.id !== 'ct_phone' && digits(c.phone) !== '4175550303' && /krystal/i.test(c.email || '')), CONTACTS);

/* C: under the OLD single upsert (phone+email) the same GoHighLevel matched the phone contact and the email failed:
      proves the fake reproduces the real bug, so A is a real proof */
reset(STAFF); POSTS = []; UPSERTS = []; nextId = 1;
CONTACTS = { ct_phone: { id: 'ct_phone', firstName: 'Krystal', phone: '+14175550999', email: '', dnd: false },
             ct_email: { id: 'ct_email', firstName: 'Krystal', phone: '', email: 'krystal@example.test', dnd: false } };
{
  const up = await (await fetch('https://services.leadconnectorhq.com/contacts/upsert', { method: 'POST', body: JSON.stringify({ locationId: 'loc', phone: STAFF.phone, email: STAFF.email }) })).json();
  const sr = await fetch('https://services.leadconnectorhq.com/conversations/messages', { method: 'POST', body: JSON.stringify({ type: 'Email', contactId: up.contact.id, subject: 's', html: 'h' }) });
  ck('control · the old phone+email upsert matched the phone contact and GoHighLevel refused the email ("Contact has no email")',
    up.contact.id === 'ct_phone' && sr.status === 422, { up, status: sr.status });
}

let pass = 0
for (const [n, ok, note] of res) { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n      ' + note}`); if (ok) pass++ }
console.log('='.repeat(60))
console.log(pass === res.length ? `ALL ${res.length} CHECKS PASS` : `FAILED ${res.length - pass} of ${res.length}`)
process.exit(pass === res.length ? 0 : 1)
