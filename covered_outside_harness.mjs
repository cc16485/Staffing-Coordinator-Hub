// Covered-outside fix (Elizabeth Kurtz, 2026-09-27) · the rule, the family-text guard, and the REAL coverage-watch.
// node covered_outside_harness.mjs
import fs from 'fs'; import path from 'path';
process.env.TZ = 'UTC';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const FNS = path.resolve('supabase/functions');
const C = await import(path.join(FNS, '_shared/covered-outside.ts'));
const V = C.outsideVerdict;
ck('rule: the SAME AxisCare caregiver id as the one who called off → still on (the Kurtz case), whatever the names say',
  V({ calling_off: 'Ashley Lloyd', calling_off_id: '55' }, { id: 55, name: 'Ashley Lloyd' }) === 'caller_still_on');
ck('rule: a DIFFERENT id → covered, even with the same first name ("another Ashley")', V({ calling_off: 'Ashley Lloyd', calling_off_id: '55' }, { id: 77, name: 'Ashley Smith' }) === 'covered');
ck('rule: no id, same full name (spacing and capitals aside) → still on', V({ calling_off: 'ashley  lloyd' }, { id: 77, name: 'Ashley Lloyd' }) === 'caller_still_on');
ck('rule: no id, only a first name recorded and it matches → unsure (never guessed as a cover)', V({ calling_off: 'Ashley' }, { id: 77, name: 'Ashley Lloyd' }) === 'unsure');
ck('rule: no id, names clearly differ → covered', V({ calling_off: 'Ashley Lloyd' }, { id: 77, name: 'Beth Cole' }) === 'covered' && V({ calling_off: 'Ashley' }, { id: 77, name: 'Beth Cole' }) === 'covered');
ck('rule: nobody recorded as calling off → covered only if the shift was seen empty first (or Cara opened it from an empty shift)',
  V({ opened_by: 'Samantha Troutman' }, { id: 1, name: 'X Y' }) === 'unsure' && V({ seen_unassigned_at: 't' }, { id: 1, name: 'X Y' }) === 'covered' && V({ opened_by: 'axiscare-watch' }, { id: 1, name: 'X Y' }) === 'covered');

/* the family text guard */
const famSrc = fs.readFileSync(path.join(FNS, '_shared/family-change-text.ts'), 'utf8')
  .replace("from './outreach.ts'", "from '" + path.join(FNS, '_shared/outreach.ts') + "'").replace("from './covered-outside.ts'", "from '" + path.join(FNS, '_shared/covered-outside.ts') + "'");
const famTmp = path.join(process.cwd(), '_fam_under_test.ts'); fs.writeFileSync(famTmp, famSrc);
globalThis.Deno = { env: { get: () => '' }, serve: () => {} };
const F = await import(famTmp); fs.unlinkSync(famTmp);
const fsb = { from: (t) => { const p = { select() { return p; }, eq() { return p; }, then(r) { return Promise.resolve({ data: t === 'care_circles' ? [{ id: 'c1', client_name: 'Elizabeth Kurtz' }] : t === 'circle_contacts' ? [{ name: 'Dana Kurtz', phone: '4175551212', sms_consent: true }] : [] }).then(r); } }; return p; } };
let sends = 0; const gate = async () => ({ contactId: 'g1' }); const send = async () => { sends++; return new Response('{}', { status: 200 }); };
const settings = { family_caregiver_change_text_approved: { by: 'Samantha' } };
let fr = await F.notifyFamilyOfChange(fsb, { token: 't', locationId: 'l' }, { client: 'Elizabeth Kurtz', client_axiscare_id: '9', calling_off: 'Ashley Lloyd', covered_by: 'Ashley Lloyd' }, settings, { whenText: 'today 10 AM' }, gate, send);
ck('family text: "Ashley called off, Ashley is coming" can never be sent; the case records why', fr.outcome === 'none' && fr.reason === 'covering_caregiver_is_the_one_who_called_off' && sends === 0, fr);
fr = await F.notifyFamilyOfChange(fsb, { token: 't', locationId: 'l' }, { client: 'Elizabeth Kurtz', client_axiscare_id: '9', calling_off: 'Ashley Lloyd', covered_by: 'Beth Cole' }, settings, { whenText: 'today 10 AM' }, gate, send);
ck('family text: a real cover still goes to the consenting, linked family (unchanged)', fr.outcome === 'sent' && sends === 1, fr);

/* the REAL coverage-watch */
const src = fs.readFileSync(path.join(FNS, 'coverage-watch/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace("from '../_shared/events.ts'", "from '" + path.join(FNS, '_shared/events.ts') + "'")
  .replace("from '../_shared/held-shift.ts'", "from '" + path.join(FNS, '_shared/held-shift.ts') + "'")
  .replace("from '../_shared/covered-outside.ts'", "from '" + path.join(FNS, '_shared/covered-outside.ts') + "'");
const tmp = path.join(process.cwd(), '_cw2_under_test.ts'); fs.writeFileSync(tmp, src);
let handler; const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485' };
globalThis.Deno = { env: { get: k => env[k] }, serve: h => { handler = h; } };
const NOW = Date.now(), HR = 36e5;
const wall = (ms) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms)).map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00-05:00`; };
const T = NOW + 6 * HR;
const vid = (s) => `s=${s}:d=${wall(T).slice(0, 10)}`;
let DB, AX;
const cg = (id, first, last) => ({ id, firstName: first, lastName: last });
function world() {
  AX = { [vid(1)]: cg(55, 'Ashley', 'Lloyd'), [vid(2)]: cg(55, 'Ashley', 'Lloyd'), [vid(3)]: cg(77, 'Ashley', 'Smith'), [vid(4)]: cg(88, 'Xan', 'Ro'), [vid(5)]: cg(88, 'Xan', 'Ro') };
  const open = (id, v, extra) => ({ id, axiscare_visit_id: v, status: 'open', opened_at: new Date(NOW - HR).toISOString(), client: 'Elizabeth Kurtz', shift_date: wall(T).slice(0, 10), shift_time: '', note: 'Opened by hand.', resolved_at: null, ...extra });
  DB = { ops_settings: { coverage_watch_live: true, coverage_watch_7b_live: true },
    coverage_cases: [open('k1', vid(1), { opened_by: 'Samantha Troutman', calling_off: 'Ashley Lloyd', calling_off_id: '55' }),   // the Kurtz case
      open('k2', vid(2), { opened_by: 'call-disposition', calling_off: 'Ashley' }),                                                  // first name only, no id
      open('k3', vid(3), { opened_by: 'Samantha Troutman', calling_off: 'Ashley Lloyd', calling_off_id: '55' }),                    // another Ashley is on it
      open('k4', vid(4), { opened_by: 'Samantha Troutman' }),                                                                        // nobody recorded, never seen empty
      open('k5', vid(5), { opened_by: 'axiscare-watch' })],                                                                          // Cara's own (opened from an empty shift)
    ops_items: [], visit_memory: [], attendance_watch_state: [{ id: 'state', last_date: wall(NOW - 864e5).slice(0, 10) }],
    notes_watch_state: [{ id: 'state', last_hour: new Date().toISOString().slice(0, 13) }] };
}
globalThis.__db = {
  from: (t) => { const p = { _k: null, select() { return p; }, eq(k, v) { p._k = v; return p; },
    maybeSingle() { return Promise.resolve({ data: DB[p._k] !== undefined ? { data: JSON.parse(JSON.stringify(DB[p._k])) } : null, error: null }); },
    insert() { return Promise.resolve({ error: null }); } }; return p; },
  rpc(fn, a) { if (fn === 'upsert_app_data_item') { const arr = DB[a.target_key] = Array.isArray(DB[a.target_key]) ? DB[a.target_key] : []; const i = arr.findIndex(x => x.id === a.item.id); if (i >= 0) arr[i] = a.item; else arr.push(a.item); }
    return Promise.resolve({ error: null }); } };
globalThis.fetch = async (u) => { const url = new URL(String(u)); if (url.pathname !== '/api/visits' || url.searchParams.get('updatedSinceDate')) return new Response('{}', { status: 404 });
  const rows = Object.entries(AX).map(([id, c]) => ({ id, scheduledStartDate: wall(T), scheduledEndDate: wall(T + 2 * HR), client: { id: 9, firstName: 'Elizabeth', lastName: 'Kurtz' },
    caregiver: c, modificationReason: c ? null : { name: 'Staffing Change - Caregiver Call Off' }, removed: false }));
  return new Response(JSON.stringify({ results: { visits: rows } }), { status: 200 }); };
await import(tmp); fs.unlinkSync(tmp);
const run = async (q = '') => (await handler(new Request('http://x/coverage-watch' + q, { method: 'POST' }))).json();
const K = (id) => DB.coverage_cases.find(c => c.id === id);

world(); let out = await run('?dry=1');
ck('DRY RUN closes nothing, not even a real cover (it used to); it lists what it left', DB.coverage_cases.every(c => c.status === 'open') && out.covered_outside_left_open.length === 5 && out.cases_created === 0, out.covered_outside_left_open);
world(); out = await run();
ck('KURTZ: the caregiver who called off is still on the schedule → the case stays OPEN, no "covered", a note says to take her off',
  K('k1').status === 'open' && !K('k1').covered_by && /AxisCare still shows Ashley Lloyd on this shift, the caregiver who called off/.test(K('k1').note) && /Take Ashley off the shift in AxisCare/.test(K('k1').note), K('k1'));
ck('first name only and it matches → stays open, a note asks a person to confirm', K('k2').status === 'open' && /can't tell whether they are covering/.test(K('k2').note), K('k2'));
ck('another Ashley (different AxisCare id) → closed as covered by Ashley Smith (a real cover still closes)', K('k3').status === 'resolved' && K('k3').covered_by === 'Ashley Smith', K('k3'));
ck('nobody recorded as calling off, shift never seen empty → stays open for a person', K('k4').status === 'open' && !K('k4').covered_by);
ck('Cara\'s own case (opened from an empty shift) → a later caregiver is a real cover', K('k5').status === 'resolved' && K('k5').covered_by === 'Xan Ro');
const noteLen = K('k1').note.length; out = await run();
ck('the note is added once, not every five minutes', K('k1').note.length === noteLen);
AX[vid(1)] = null; out = await run();
ck('the office takes Ashley off → Cara sees the shift empty and remembers it', K('k1').status === 'open' && !!K('k1').seen_unassigned_at, K('k1'));
AX[vid(1)] = cg(99, 'Beth', 'Cole'); out = await run();
ck('then assigns Beth → closed as covered by Beth (the family text will name the right people)', K('k1').status === 'resolved' && K('k1').covered_by === 'Beth Cole' && K('k1').calling_off === 'Ashley Lloyd', K('k1'));
AX[vid(4)] = null; await run(); AX[vid(4)] = cg(88, 'Xan', 'Ro'); await run();
ck('nobody recorded: once the shift was seen empty, the next caregiver closes it as covered', K('k4').status === 'resolved' && K('k4').covered_by === 'Xan Ro', K('k4'));

console.log('\nCOVERED-OUTSIDE FIX · HARNESS\n' + '='.repeat(60));
let ok = true;
for (const [nm, g, note] of res) { ok &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + nm + (note ? '\n   └─ ' + note : '')); }
console.log('='.repeat(60)); console.log(ok ? `ALL ${res.length} CHECKS PASS` : `${res.filter(r => !r[1]).length} FAILED`);
