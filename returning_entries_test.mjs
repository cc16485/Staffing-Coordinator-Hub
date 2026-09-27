// 5b C · the automatic front doors never rewrite a closed inquiry, and flag a returning family.
// Runs the REAL functions (assessment-intake, call-followup, lead-intake, call-disposition, cc-booking's
// lead seam) against a fake database, a fake AxisCare and a fake AI. node returning_entries_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const FN = 'supabase/functions';

/* ── fake database: app_data key/value arrays + plain tables ── */
let APP, TABLES;
const reset = (leads) => { APP = { leads: JSON.parse(JSON.stringify(leads || [])), ops_items: [] }; TABLES = { circle_contacts: [], care_circles: [] }; };
const q = (t) => {
  const st = { f: [], op: 'select', row: null };
  const rows = () => {
    if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]; return k != null ? [{ key: k[0], data: APP[k[0]] ?? null }] : []; }
    return (TABLES[t] || []).filter((r) => st.f.every(([c, v]) => v.map(String).includes(String(r[c]))));
  };
  const b = {
    select() { return b; }, order() { return b; }, range() { return b; }, limit() { return b; }, gte() { return b; }, lte() { return b; },
    lt() { return b; }, gt() { return b; }, neq() { return b; }, is() { return b; }, not() { return b; }, or() { return b; }, ilike() { return b; },
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
  if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => x.id === a.item.id); if (i >= 0) arr[i] = a.item; else arr.push(a.item); return { data: null, error: null }; }
  return { data: null, error: null };
} };
globalThis.__db = db;

/* ── fake AxisCare + AI + everything else ── */
let AX, axDown = false, AI = null;
globalThis.fetch = async (url, o) => {
  url = String(url);
  if (url.includes('.axiscare.com/api/clients')) return axDown ? new Response('{}', { status: 503 }) : new Response(JSON.stringify({ results: { clients: AX, nextPage: null } }), { status: 200 });
  if (url.includes('api.anthropic.com')) return new Response(JSON.stringify({ content: [{ type: 'tool_use', name: 'submit_call_analysis', input: AI }] }), { status: 200 });
  return new Response('{}', { status: 200 });
};
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485', ASSESSMENT_INTAKE_TOKEN: 'A',
  CALL_FOLLOWUP_TOKEN: 'F', LEAD_INTAKE_TOKEN: 'L', CALL_DISPOSITION_TOKEN: 'D', ANTHROPIC_API_KEY: 'x' };
let handler;
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } };
const load = async (name) => {
  const src = fs.readFileSync(`${FN}/${name}/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db');
  const tmp = path.join(process.cwd(), FN, name, '_t.ts'); fs.writeFileSync(tmp, src);
  try { await import(tmp + '?' + Math.random()); } finally { fs.unlinkSync(tmp); }
  return handler;
};
const post = async (h, qs, body) => { const r = await h(new Request('https://x/fn?' + qs, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })); return r.json(); };

const CONV = { id: 'Lc', first_name: 'Dana', last_name: 'Adams', phone: '(417) 555-0101', client_first_name: 'Ruth', client_last_name: 'Adams', status: 'Converted', interest_notes: 'old notes', follow_up_due: '2026-01-01', axiscare_client_id: '10' };
const LOST = { id: 'Ll', first_name: 'Joe', last_name: 'Cole', phone: '4175550202', status: 'Lost', contact_attempts: 1, interest_notes: 'lost notes' };
const OPEN = { id: 'Lo', first_name: 'Ann', last_name: 'Gray', phone: '4175550303', status: 'Contacted', interest_notes: 'first call notes' };
const byId = (id) => APP.leads.find((l) => l.id === id);
const fresh = (known) => APP.leads.filter((l) => !known.includes(l.id));
const KNOWN = ['Lc', 'Ll', 'Lo'];
AX = [{ id: 11, firstName: 'Earl', lastName: 'Baker', status: { active: false, label: 'Discharged' }, homePhone: '4175550404' },
      { id: 12, firstName: 'Mary', lastName: 'Evans', status: { active: false, label: 'Discharged' } }];

/* ════ assessment-intake (the booking calendar) ════ */
let h = await load('assessment-intake');
reset([CONV, LOST, OPEN]); let before = JSON.stringify(byId('Lc'));
let r = await post(h, 'token=A', { first_name: 'Dana', last_name: 'Adams', phone: '417-555-0101', start_time: '2026-10-02T15:00:00Z' });
let n = fresh(KNOWN);
ck('booking calendar · a Converted inquiry is NOT rewritten; the family gets a new inquiry', JSON.stringify(byId('Lc')) === before && n.length === 1 && n[0].status === 'Assessment Scheduled', { r, n });
ck('booking calendar · the new inquiry is flagged possibly returning, naming the earlier inquiry', n[0].possibly_returning && n[0].possibly_returning.matches.some((m) => m.kind === 'inquiry' && m.lead_id === 'Lc' && m.status === 'Converted'), n[0]);
let it = APP.ops_items.find((i) => i.id === 'ops_returning_' + n[0].id);
ck('booking calendar · one "is this the same family?" item on My Work that opens the new inquiry', it && it.source.type === 'returning' && it.source.lead_id === n[0].id && it.domain === 'family_enquiries' && it.status === 'open' && !/—/.test(it.title + it.detail + it.next_action), it);
reset([CONV, LOST, OPEN]);
r = await post(h, 'token=A', { first_name: 'Ann', last_name: 'Gray', phone: '4175550303', start_time: '2026-10-02T15:00:00Z' });
ck('booking calendar · an OPEN inquiry is still reused (no new one, no flag)', fresh(KNOWN).length === 0 && byId('Lo').status === 'Assessment Scheduled' && !byId('Lo').possibly_returning && !APP.ops_items.some((i) => /returning/.test(i.id)), r);
reset([]);
r = await post(h, 'token=A', { first_name: 'Sue', last_name: 'Baker', phone: '417 555 0404', start_time: '2026-10-02T15:00:00Z' });
n = fresh([]);
ck('booking calendar · a former AxisCare client\'s number flags the new inquiry', n[0].possibly_returning && n[0].possibly_returning.matches[0].kind === 'axiscare' && n[0].possibly_returning.matches[0].axiscare_client_id === '11', n[0]);
reset([]);
r = await post(h, 'token=A', { first_name: 'Mary', last_name: 'Evans', phone: '4175559999', start_time: '2026-10-02T15:00:00Z' });
ck('booking calendar · a name alone never raises work (no flag, no item)', !fresh([])[0].possibly_returning && APP.ops_items.every((i) => !/returning/.test(i.id)), fresh([])[0]);
reset([]);
r = await post(h, 'token=A', { first_name: 'New', last_name: 'Family', phone: '4175558888', start_time: '2026-10-02T15:00:00Z' });
ck('booking calendar · a brand-new family: a plain new inquiry, as before', fresh([]).length === 1 && !fresh([])[0].possibly_returning && r.routed === 'lead created', r);
reset([CONV]); axDown = true;
r = await post(h, 'token=A', { first_name: 'Dana', phone: '4175550101', start_time: '2026-10-02T15:00:00Z' });
axDown = false; n = fresh(['Lc']);
ck('booking calendar · AxisCare down: the inquiry is still made and flagged from the earlier inquiry, and says AxisCare wasn\'t checked',
  n.length === 1 && n[0].possibly_returning.axiscare_checked === false && /couldn't be checked/.test(APP.ops_items[1] ? APP.ops_items.find((i) => /returning/.test(i.id)).detail : ''), { n, ops: APP.ops_items });

/* ════ call-followup (the AI phone call) ════ */
h = await load('call-followup');
AI = { is_client_lead: true, contact_first_name: 'Dana', interest_notes: 'Wants help again for mom', branch: 'soft-check-in', needs: [] };
reset([CONV, LOST, OPEN]); before = JSON.stringify(byId('Lc'));
r = await post(h, 'token=F', { first_name: 'Dana', phone: '4175550101', transcript: 'hello' });
n = fresh(KNOWN);
ck('AI call · a Converted inquiry is NOT rewritten (notes, follow-up, drafts untouched); a new flagged inquiry instead',
  JSON.stringify(byId('Lc')) === before && n.length === 1 && n[0].possibly_returning && APP.ops_items.some((i) => i.id === 'ops_returning_' + n[0].id) && r.possibly_returning === true, { r, n });
reset([CONV, LOST, OPEN]); before = JSON.stringify(byId('Ll'));
r = await post(h, 'token=F', { first_name: 'Joe', phone: '4175550202', transcript: 'hello' });
ck('AI call · a Lost inquiry is not rewritten either', JSON.stringify(byId('Ll')) === before && fresh(KNOWN).length === 1, r);
reset([CONV, LOST, OPEN]);
r = await post(h, 'token=F', { first_name: 'Ann', phone: '4175550303', transcript: 'hello' });
ck('AI call · an OPEN inquiry is reused, and a second call ADDS to the notes instead of wiping them',
  fresh(KNOWN).length === 0 && /^first call notes\n\nCall \d{4}-\d{2}-\d{2}: Wants help again for mom$/.test(byId('Lo').interest_notes), byId('Lo').interest_notes);
AI = { is_client_lead: false, not_lead_reason: 'existing client' };
reset([CONV]); r = await post(h, 'token=F', { phone: '4175550101', transcript: 'hi' });
ck('AI call · a call the AI says is not a new client still creates nothing', r.status === 'skipped' && APP.leads.length === 1, r);

/* ════ lead-intake (the website form) ════ */
h = await load('lead-intake');
reset([CONV, LOST, OPEN]); before = JSON.stringify(APP.leads);
r = await post(h, 'token=L', { first_name: 'Ann', last_name: 'Gray', phone: '4175550303', message: 'need help' });
n = fresh(KNOWN);
ck('web form · always a new inquiry (never rewrites one); an open inquiry with the same number flags it',
  JSON.stringify(APP.leads.filter((l) => KNOWN.includes(l.id))) === before && n.length === 1 && n[0].possibly_returning.matches.some((m) => m.lead_id === 'Lo'), n);
reset([]); r = await post(h, 'token=L', { first_name: 'Mary', last_name: 'Evans', phone: '4175557777', message: 'x' });
ck('web form · a name alone doesn\'t flag', fresh([]).length === 1 && !fresh([])[0].possibly_returning && !APP.ops_items.some((i) => /returning/.test(i.id)), fresh([]));

/* ════ call-disposition (the post-call screen) ════ */
h = await load('call-disposition');
const disp = (d, phone) => post(h, 'token=D', { name: 'Dana Adams', phone, disposition: d, direction: 'outbound', note: 'spoke with them' });
reset([CONV, LOST, OPEN]); before = JSON.stringify(byId('Lc'));
r = await disp('Booked Assessment', '4175550101'); n = fresh(KNOWN);
ck('disposition · "booked assessment" on a Converted inquiry does NOT push it back; a new flagged inquiry is booked instead',
  JSON.stringify(byId('Lc')) === before && n.length === 1 && n[0].status === 'Assessment Scheduled' && n[0].possibly_returning && APP.ops_items.some((i) => i.id === 'ops_returning_' + n[0].id), { r, n });
reset([CONV, LOST, OPEN]);
r = await disp('Not Interested', '4175550101');
ck('disposition · "not interested" can no longer mark a Converted inquiry Lost; the call is only logged', byId('Lc').status === 'Converted' && fresh(KNOWN).length === 0 && /logged only; this inquiry is closed/.test(byId('Lc').comm_log.at(-1).body) && !/—/.test(byId('Lc').comm_log.at(-1).body), { r, l: byId('Lc') });
reset([CONV, LOST, OPEN]);
r = await disp('No Answer', '4175550101');
ck('disposition · "no answer" on a Converted inquiry: logged, follow-up and attempts untouched', byId('Lc').follow_up_due === '2026-01-01' && !byId('Lc').contact_attempts && fresh(KNOWN).length === 0, byId('Lc'));
reset([CONV, LOST, OPEN]);
r = await disp('Voicemail', '4175550202');
ck('disposition · the Lost follow-up calls keep working (voicemail counts an attempt on the Lost inquiry)', byId('Ll').contact_attempts === 2 && byId('Ll').status === 'Lost' && fresh(KNOWN).length === 0, byId('Ll'));
reset([CONV, LOST, OPEN]);
r = await disp('Ready to Start', '4175550202'); n = fresh(KNOWN);
ck('disposition · a Lost family ready to start gets a NEW flagged inquiry (the Lost one\'s Journey is closed)', byId('Ll').status === 'Lost' && n.length === 1 && n[0].possibly_returning.matches.some((m) => m.lead_id === 'Ll'), { r, n });
const SHARED = { ...OPEN, id: 'Lo2', phone: '4175550101' };
reset([CONV, SHARED]);
r = await disp('Follow Up', '4175550101');
ck('disposition · when an open and a Converted inquiry share a number, the OPEN one takes the call', byId('Lo2').follow_up_branch === 'call-back-next-week' && byId('Lc').status === 'Converted' && APP.leads.length === 2, r);
reset([]);
r = await disp('Referral Call', '4175550404'); n = fresh([]);
ck('disposition · a referral call from a former client\'s number starts a flagged inquiry', n.length === 1 && n[0].source === 'Referral' && n[0].possibly_returning && n[0].possibly_returning.matches[0].axiscare_client_id === '11', n);

/* ════ cc-booking's lead seam (the website scheduler), read from source: the booking needs live calendars ════ */
const ccb = fs.readFileSync(`${FN}/cc-booking/index.ts`, 'utf8');
ck('website booking · only OPEN inquiries take a booking; a closed one is never touched',
  /const split = leadHits\(leadsB, \[phone\], emailB\)\n\s+const hits = split\.open/.test(ccb) && !/if \(l\.status !== 'Converted' && l\.status !== 'Lost'\)/.test(ccb));
ck('website booking · a new inquiry is checked and flagged, with the one item', /returningCheck\(supabase, 'website booking', \{ phones: \[phone\], email: emailB \}, split\.closed\)/.test(ccb) && /returningItem\(fresh, flag, 'website booking'\)/.test(ccb));

/* ════ the shared rule ════ */
const lib = await import(path.join(process.cwd(), FN, '_shared/returning.ts'));
ck('closed means Converted, Lost or archived', lib.isClosedLead({ status: 'Converted' }) && lib.isClosedLead({ status: 'Lost' }) && lib.isClosedLead({ status: 'New', archived: true }) && !lib.isClosedLead({ status: 'Assessment Scheduled' }));
const sp = lib.leadHits([CONV, OPEN, { id: 'x', email: 'A@B.com', status: 'New' }], ['+1 417 555 0101'], 'a@b.com');
ck('matching by either phone or email, split open / closed', sp.closed.map((l) => l.id).join() === 'Lc' && sp.open.map((l) => l.id).join() === 'x', sp);
ck('nothing contacted: no function in this change sends a text or email because of the check', !/sendSms|ghlEmail\(|conversations\/messages/.test(fs.readFileSync(`${FN}/_shared/returning.ts`, 'utf8')));

console.log('\n5b C · AUTOMATIC FRONT DOORS · TEST\n' + '='.repeat(60)); let all = true;
for (const [nm, g, note] of res) { all &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + nm + (note ? '\n   └─ ' + note : '')); }
console.log('='.repeat(60)); console.log(all ? `ALL ${res.length} CHECKS PASS` : 'FAILED');
