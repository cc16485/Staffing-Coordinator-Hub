// Call-in plan · the shared rules + the REAL coverage-run (Cara's texting engine) under Node.
// Fakes only the outside world: the database, AxisCare, GHL, and the outbound identity gate.
// node callin_plan_harness.mjs
import fs from 'fs'; import path from 'path';
process.env.TZ = 'UTC';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const FNS = path.resolve('supabase/functions');
const P = await import(path.join(FNS, '_shared/callin-plan.ts'));

/* ── the rules on their own ── */
const plan = { axiscare_client_id: '501', client_name: 'LeeAnn Walker', coverage_need: 'if_we_can',
  only_ask: [{ axiscare_id: '11', name: 'Dixie Ray' }, { axiscare_id: '12', name: 'Autumn Reid' }],
  backup_name: 'Jan Moss', backup_phone: '4175551212', backup_relationship: 'friend who covers', note: 'call Jan if neither' };
ck('rule: an only-ask list lets Dixie and Autumn through and names why anyone else is left out',
  P.onlyAskCut(plan, { axiscare_id: '11' }, 'LeeAnn Walker') === null && P.onlyAskCut(plan, { axiscare_id: '12' }, 'LeeAnn Walker') === null
  && P.onlyAskCut(plan, { axiscare_id: '13' }, 'LeeAnn Walker') === "not on LeeAnn's call-in list (only Dixie or Autumn)"
  && P.onlyAskCut(plan, { axiscare_id: null }, 'LeeAnn Walker') !== null);
ck('rule: no plan, or a plan with no only-ask list, leaves out nobody', P.onlyAskCut(null, { axiscare_id: '13' }, 'X') === null && P.onlyAskCut({ only_ask: [] }, { axiscare_id: '13' }, 'X') === null);
ck('rule: "family covers" and "flexible" hold automatic texts; "must cover" and "if we can" don\'t',
  P.holdsAutoTexts({ coverage_need: 'family_covers' }) && P.holdsAutoTexts({ coverage_need: 'flexible' }) && !P.holdsAutoTexts({ coverage_need: 'must_cover' }) && !P.holdsAutoTexts(plan) && !P.holdsAutoTexts(null)
  && P.isMustCover({ coverage_need: 'must_cover' }) && !P.isMustCover(plan));
ck('rule: the one-line summary names the choice, the list and the backup with a readable phone, and leaves the note out',
  P.planLine(plan) === 'Cover it if we can · only ask Dixie Ray or Autumn Reid · backup: Jan Moss (friend who covers) (417) 555-1212', P.planLine(plan));
ck('copy: no em dashes in anything a person reads', ![...Object.values(P.NEED_LABEL), P.planLine(plan), P.onlyAskCut(plan, { axiscare_id: '9' }, 'LeeAnn')].some(t => t.includes('—')));

/* ── the REAL coverage-run ── */
const tmpDir = path.join(process.cwd(), '_cr_tmp'); fs.rmSync(tmpDir, { recursive: true, force: true }); fs.mkdirSync(tmpDir);
fs.writeFileSync(path.join(tmpDir, 'outreach.ts'), `export const normalisePhone = (p: unknown) => { const d = String(p ?? '').replace(/\\D/g, ''); return d.length === 10 ? d : (d.length === 11 && d[0] === '1' ? d.slice(1) : null) }
export async function maySendTo() { return { allowed: true, confidence: 'verified', reason: null } }
export async function contactForOutbound(_s: unknown, _g: unknown, who: any) { return { contactId: 'ct_' + (who.phone || who.email) } }`);
fs.writeFileSync(path.join(tmpDir, 'stubs.ts'), `export async function shadowRoute() {}
export async function opEvent() {}
export async function notifyFamilyOfChange() { return { outcome: 'none', count: 0, reason: 'harness', circle: null } }`);
const src = fs.readFileSync(path.join(FNS, 'coverage-run/index.ts'), 'utf8')
  .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace("from '../_shared/outreach.ts'", "from '" + path.join(tmpDir, 'outreach.ts') + "'")
  .replace("from '../_shared/routing.ts'", "from '" + path.join(tmpDir, 'stubs.ts') + "'")
  .replace("from '../_shared/events.ts'", "from '" + path.join(tmpDir, 'stubs.ts') + "'")
  .replace("from '../_shared/family-change-text.ts'", "from '" + path.join(tmpDir, 'stubs.ts') + "'")
  .replace("from '../_shared/zip-centroids.ts'", "from '" + path.join(FNS, '_shared/zip-centroids.ts') + "'")
  .replace("from '../_shared/care-level.ts'", "from '" + path.join(FNS, '_shared/care-level.ts') + "'")
  .replace("from '../_shared/callin-plan.ts'", "from '" + path.join(FNS, '_shared/callin-plan.ts') + "'")
  .replace("from '../_shared/optout.ts'", "from '" + path.join(FNS, '_shared/optout.ts') + "'")   // 0b-3
  /* J1: the lock is tested in j1_job_locks_test.mjs; here the tick is the schedule and the picker is let in as the owner */
  .replace("from '../_shared/job-auth.ts'", "from 'data:text/javascript,export const jobCaller=async()=>\\'cron\\';export const ownerCaller=async()=>true'")
  .replace("from '../_shared/staff-auth.ts'", "from '" + path.join(FNS, '_shared/staff-auth.ts') + "'");
const tmp = path.join(tmpDir, 'coverage-run.ts'); fs.writeFileSync(tmp, src);
let handler; const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'L' };
globalThis.Deno = { env: { get: k => env[k] }, serve: h => { handler = h; } };

let T, ERR, SENT;
const clone = (x) => JSON.parse(JSON.stringify(x));
const CGS = [['Dixie', 'Ray', '11', '4175550011'], ['Autumn', 'Reid', '12', '4175550012'], ['Beth', 'Cole', '13', '4175550013'], ['Carl', 'Dunn', '14', '4175550014']];
function world(planRow, caseExtra = {}) {
  const kase = { id: 'cw_lw_g1', kind: 'callout', status: 'open', client: 'LeeAnn Walker', client_axiscare_id: '501', shift_date: '2026-09-29', shift_time: '10:00-14:00',
    calling_off: 'Someone Else', opened_at: '2026-09-28T07:00:00Z', opened_by: 'axiscare-watch', asked: [], admin_alerted: '2026-09-28T07:01:00Z', ...caseExtra };
  T = { app_data: [
      { key: 'ops_settings', data: { coverage_send_live: true, coverage_manual_select: false, coverage_quiet_from: 0, coverage_quiet_until: 0,
        coverage_alert_admins: ['sam@cc.test'] } },
      { key: 'coverage_cases', data: [kase] },
      { key: 'caregivers', data: CGS.map(([f, l, id, ph]) => ({ first: f, last: l, axiscare_id: id, phone: ph, active: true })) },
      { key: 'coordinator_staff', data: [{ email: 'sam@cc.test', name: 'Sam', phone: '4175550099' }] },
      { key: 'ops_items', data: [] }, { key: 'dnr_log', data: [] }],
    client_callin_current: planRow ? [planRow] : [], person_identity: [], person_source_id: [] };
  ERR = {}; SENT = [];
}
const q = (table) => { const f = []; const b = {
  select() { return b; }, eq(c, v) { f.push(r => String(r?.[c]) === String(v)); return b; }, neq(c, v) { f.push(r => String(r?.[c]) !== String(v)); return b; },
  ilike(c, v) { f.push(r => String(r?.[c] ?? '').toLowerCase() === String(v).toLowerCase()); return b; }, in(c, a) { f.push(r => a.map(String).includes(String(r?.[c]))); return b; },
  is() { return b; }, not() { return b; }, order() { return b; }, limit() { return b; }, gte() { return b; }, lte() { return b; }, gt() { return b; }, lt() { return b; }, or() { return b; },
  _rows() { return (T[table] || []).filter(r => f.every(fn => fn(r))); },
  maybeSingle() { if (ERR[table]) return Promise.resolve({ data: null, error: { message: 'boom' } }); const r = b._rows(); return Promise.resolve({ data: r[0] ? clone(r[0]) : null, error: null }); },
  single() { return b.maybeSingle(); },
  then(ok, no) { return (ERR[table] ? Promise.resolve({ data: null, error: { message: 'boom' } }) : Promise.resolve({ data: clone(b._rows()), error: null })).then(ok, no); },
  insert() { return Promise.resolve({ error: null }); }, upsert(x) { if (table === 'app_data') { const row = T.app_data.find(r => r.key === x.key); if (row) row.data = x.data; else T.app_data.push(x); } return Promise.resolve({ error: null }); },
  update() { return b; }, delete() { return b; } }; return b; };
globalThis.__db = { from: q, rpc(fn, a) {
  if (fn === 'upsert_app_data_item') { let row = T.app_data.find(r => r.key === a.target_key); if (!row) T.app_data.push(row = { key: a.target_key, data: [] });
    const i = row.data.findIndex(x => x.id === a.item.id); if (i >= 0) row.data[i] = clone(a.item); else row.data.push(clone(a.item)); }
  return Promise.resolve({ data: null, error: null }); } };
const J = (s, b) => new Response(JSON.stringify(b), { status: s });
globalThis.fetch = async (u, o = {}) => {
  const url = new URL(String(u));
  if (url.hostname === 'services.leadconnectorhq.com') {
    const body = JSON.parse(o.body || '{}');
    if (url.pathname === '/contacts/upsert') return J(200, { contact: { id: 'em_' + body.email } });
    if (url.pathname === '/conversations/messages') { SENT.push(body); return J(200, { messageId: 'm' }); }
    return J(200, {});
  }
  if (url.pathname === '/api/caregivers') return J(200, { results: { caregivers: CGS.map(([f, l, id]) => ({ id: Number(id), firstName: f, lastName: l, status: { active: true }, classes: [] })) } });
  if (url.pathname.startsWith('/api/clients/')) return J(200, { results: { client: { id: 501, classes: [], residentialAddress: { city: 'Ozark', postalCode: '65721' } } } });
  if (url.pathname === '/api/visits') return J(404, { errors: ['No visits found'] });
  return J(404, {});
};
await import(tmp);
const tok = (c) => 'Bearer x.' + Buffer.from(JSON.stringify(c)).toString('base64url') + '.y';
const picker = async () => (await handler(new Request('http://x/coverage-run', { method: 'POST', headers: { Authorization: tok({ role: 'authenticated', email: 'kat@cc.test' }) },
  body: JSON.stringify({ action: 'candidates', case_id: 'cw_lw_g1' }) }))).json();
const tick = async () => (await handler(new Request('http://x/coverage-run?commit=1', { method: 'POST' }))).json().catch(() => ({}));
const names = (g) => g.map(x => x.name).sort();
const textedNames = () => SENT.filter(m => m.type === 'SMS').map(m => CGS.find(c => 'ct_' + c[3] === m.contactId)).filter(Boolean).map(c => c[0]).sort();

world(null); let out = await picker();
ck('no plan: the picker offers everyone, as today', names([...out.group1, ...out.group2]).join(',') === 'Autumn Reid,Beth Cole,Carl Dunn,Dixie Ray' && out.meta.callin_plan === null, out);
world(plan); out = await picker();
ck("LeeAnn's only-ask list: the picker offers ONLY Dixie and Autumn; Beth and Carl are shown as not on her list",
  names([...out.group1, ...out.group2]).join(',') === 'Autumn Reid,Dixie Ray'
  && out.excluded.filter(e => /not on LeeAnn's call-in list \(only Dixie or Autumn\)/.test(e.why)).map(e => e.name).sort().join(',') === 'Beth Cole,Carl Dunn', out);
ck('the picker carries the plan line and the note for the coordinator', out.meta.callin_plan === P.planLine(plan) && out.meta.callin_plan_note === 'call Jan if neither', out.meta);
world(plan); ERR.client_callin_current = true; out = await picker();
ck('a plan that can\'t be read holds everyone (fail closed) and says why', [...out.group1, ...out.group2].length === 0 && out.excluded.every(e => /call-in plan could not be read/.test(e.why) || /Do-Not-Return|called off|active/.test(e.why)) && out.meta.callin_plan_unreadable === true, out);

world(plan); await tick();
ck("automatic texts follow the only-ask list: Dixie and Autumn are texted, Beth and Carl never", textedNames().join(',') === 'Autumn,Dixie', { sent: SENT.map(m => m.contactId) });
world({ ...plan, coverage_need: 'family_covers', only_ask: [] }); await tick();
ck('"family would rather cover it": Cara starts NO automatic caregiver texts', textedNames().length === 0, SENT);
world({ ...plan, coverage_need: 'flexible', only_ask: [] }); await tick();
ck('"flexible": Cara starts NO automatic caregiver texts either', textedNames().length === 0, SENT);
world(null); await tick();
ck('no plan: automatic texts go out as today', textedNames().length >= 2, SENT.map(m => m.contactId));
world(plan); ERR.client_callin_current = true; await tick();
ck('automatic texts hold when the plan can\'t be read', textedNames().length === 0, SENT);

/* the admin alert at 3 AM Springfield time */
const RealDate = Date; const FIX = RealDate.parse('2026-09-28T08:00:00Z');
class NightDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(FIX); } static now() { return FIX; } }
globalThis.Date = NightDate;
world(null, { admin_alerted: null }); T.app_data.find(r => r.key === 'ops_settings').data.coverage_send_live = false; await tick();
const smsNo = SENT.filter(m => m.type === 'SMS' && m.contactId === 'ct_4175550099'), mailNo = SENT.filter(m => m.type === 'Email');
world({ ...plan, coverage_need: 'must_cover' }, { admin_alerted: null }); T.app_data.find(r => r.key === 'ops_settings').data.coverage_send_live = false; await tick();
const smsMust = SENT.filter(m => m.type === 'SMS' && m.contactId === 'ct_4175550099'), mailMust = SENT.filter(m => m.type === 'Email');
globalThis.Date = RealDate;
ck('3 AM, no plan: the admin gets the email only (the text waits for morning), as today', smsNo.length === 0 && mailNo.length === 1, { smsNo, mailNo: mailNo.length });
ck('3 AM, "must be covered": the admin is texted right away, marked MUST BE COVERED, and the email says so with the plan',
  smsMust.length === 1 && /^MUST BE COVERED \(call-in plan\)\. /.test(smsMust[0].message) && mailMust.length === 1 && /^MUST COVER · Call-in: LeeAnn Walker/.test(mailMust[0].subject)
  && mailMust[0].html.includes('Call-in plan: <b>Must be covered, no matter what · only ask Dixie Ray or Autumn Reid'), { smsMust, subj: mailMust[0]?.subject });

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log('\nCALL-IN PLAN · RULES + CARA · HARNESS\n' + '='.repeat(60));
let ok = true;
for (const [nm, g, note] of res) { ok &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + nm + (note ? '\n   └─ ' + note : '')); }
console.log('='.repeat(60)); console.log(ok ? `ALL ${res.length} CHECKS PASS` : `${res.filter(r => !r[1]).length} FAILED`);
