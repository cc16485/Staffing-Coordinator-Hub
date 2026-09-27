// Change 8b · stalled starts become owned work · the shared rules (client-start.js), the hub's wiring,
// and the REAL client-start-run under Node (fake database, fake fetch).
// node client_start_test.mjs ../cc-hub-live [path-to-the-hub-page-before-8b]
import fs from 'fs'; import path from 'path';
process.env.TZ = 'UTC';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const HUB = process.argv[2] || '../cc-hub-live';
const ENGINE_SRC = fs.readFileSync(path.join(HUB, 'client-start.js'), 'utf8');
const root = {}; new Function('globalThis', ENGINE_SRC)(root); const C = root.CCStart;

const NOW = '2026-09-27T15:00:00Z', NOWMS = Date.parse(NOW), D = 864e5;
const ago = (d) => new Date(NOWMS - d * D).toISOString();
const soc = (pathway, steps, started) => ({ pathway, started_at: started, steps });
const lead = (id, s, extra = {}) => ({ id, first_name: 'Dana', last_name: 'Caller', client_first_name: 'Mary', client_last_name: 'Smith' + id, soc: s, ...extra });

/* the rules */
const famStep = (d) => soc('PP', [{ id: 'p0', label: 'In-home assessment', role: 'day', done_at: ago(d) }, { id: 'p1', label: 'Care Agreement provided', role: 'day', done_at: ago(d) },
  { id: 'p2', label: 'Signed Care Agreement received', role: 'family' }], ago(d + 5));
ck('rule: a FAMILY-owned step is not stuck at 10 days, is stuck at 15 (her ruling: 14 days)', !C.socIsStuck(famStep(10), NOWMS) && C.socIsStuck(famStep(15), NOWMS) && C.csWindowFor({ role: 'family' }) === 14);
const stateStep = (d) => soc('A1', [{ id: 'p0', label: 'x', role: 'day', done_at: ago(d) }, { id: 'p1', label: 'DSDS assessment', role: 'state' }], ago(d + 1));
ck('rule: a DSDS-owned step also gets 14 days', !C.socIsStuck(stateStep(14), NOWMS) && C.socIsStuck(stateStep(15), NOWMS));
const officeStep = (d) => soc('PP', [{ id: 'p0', label: 'In-home assessment', role: 'day' }], ago(d));
ck('rule: an office-owned step is stuck after 3 days', !C.socIsStuck(officeStep(3), NOWMS) && C.socIsStuck(officeStep(4), NOWMS));
const launchOnly = soc('PP', [{ id: 'p0', role: 'day', done_at: ago(9) }, { id: 'm3', label: 'caregiver match', role: 'day' }], ago(20));
ck('rule: launch steps (now New Clients\' work) never make a start stuck', C.socCurrentStep(launchOnly) === null && !C.socIsStuck(launchOnly, NOWMS));
ck('rule: escalation is 2 BUSINESS days after the due date (Friday -> Tuesday)', C.csEscalationDate('2026-09-25') === '2026-09-29');
ck('scope: archived, Lost and no-start leads are left out', C.csLeadsInScope([lead('1', officeStep(5)), lead('2', officeStep(5), { archived: true }), lead('3', officeStep(5), { status: 'Lost' }), { id: '4' }]).map(l => l.id).join() === '1');

/* the badge didn't move: the page's old rule vs the shared file, over many starts */
const before = process.argv[3];
if (before && fs.existsSync(before)) {
  const old = fs.readFileSync(before, 'utf8');
  const cutOld = (a, b) => old.slice(old.indexOf(a), old.indexOf(b, old.indexOf(a)));
  const oldSrc = cutOld('function socIsLaunchStep(pathway, id){', '/* Business readiness') + cutOld('function socCurrentStep(soc){', '/* ---- SOC card on the lead profile');
  const realNow = Date.now; Date.now = () => NOWMS;
  const O = new Function(oldSrc + '\nreturn { socIsStuck, socWaitingDays, socCurrentStep };')();
  const fixtures = [];
  for (const d of [0, 2, 3, 4, 10, 14, 15, 30, 90]) for (const mk of [famStep, stateStep, officeStep]) fixtures.push(mk(d));
  fixtures.push(launchOnly, soc('A2', [{ id: 'p0', label: 'x', role: 'evening' }], ago(5)));
  const diffs = fixtures.filter(f => O.socIsStuck(f) !== C.socIsStuck(f, NOWMS) || O.socWaitingDays(f) !== C.socWaitingDays(f, NOWMS));
  Date.now = realNow;
  ck('the Start of Care "Stuck" badge shows exactly what it did before, on every sample start (' + fixtures.length + ')', diffs.length === 0, diffs);
}

/* the evaluator */
let out = C.csEvaluate([lead('a', famStep(15)), lead('b', officeStep(2)), lead('c', officeStep(20)), lead('d', launchOnly)], [], NOW);
const ca = out.create.find(i => i.id === 'cstart_a'), cc = out.create.find(i => i.id === 'cstart_c');
ck('evaluate: stuck starts become one item each; a start moving normally creates nothing', out.create.map(i => i.id).sort().join() === 'cstart_a,cstart_c' && out.quiet === 2, out);
ck('evaluate: the item names the CLIENT, the step, the wait, and a family-specific next step; no em dashes',
  ca.title === 'Mary Smitha: start of care stuck 15 days' && ca.detail === 'Waiting on: Signed Care Agreement received' && /Check in with the family/.test(ca.next_action)
  && ca.domain === 'family_enquiries' && !JSON.stringify(out).includes('—'), ca);
ck('evaluate: long waits are high priority (over 3x the window)', cc.priority === 'high' && ca.priority === 'normal');
out = C.csEvaluate([lead('a', famStep(16))], [{ ...ca, status: 'open' }], NOW);
ck('evaluate: the same stuck start next day updates its one item (never a second)', out.update.length === 1 && out.create.length === 0 && out.update[0].history.at(-1).what.includes('Still waiting'), out);
out = C.csEvaluate([lead('a', famStep(2))], [{ ...ca, status: 'open' }], NOW);
ck('evaluate: moving again closes it', out.resolve.length === 1 && /Moving again/.test(out.resolve[0].close_reason), out);
out = C.csEvaluate([lead('x', soc('PP', [{ id: 'zz9', label: 'mystery step', role: 'day' }], ago(9)))], [], NOW);
ck('evaluate: a step with no owner in the table is reported, never guessed', out.create.length === 0 && out.unrouted.length === 1, out);

/* the hub page loads the shared file and keeps its old names */
const page = fs.readFileSync(path.join(HUB, 'index.html'), 'utf8');
const alias = page.slice(page.indexOf('/* Change 8b: the Start of Care rules'), page.indexOf('</script>', page.indexOf('/* Change 8b: the Start of Care rules')));
const win = {}; const g2 = { CCStart: C };
new Function('window', 'globalThis', 'console', 'CCStart', alias.replace(/^[\s\S]*?\*\//, ''))(win, g2, console, C);   // in a browser CCStart is a global
ck('hub: the page gets every name it has always used from the shared file', ['socIsLaunchStep', 'socPreSteps', 'socCurrentStep', 'socWaitingDays', 'socIsStuck', 'csWindowFor', 'CS_STEP_DOMAIN', 'csDomainForStep', 'csEscalationDate', 'csItemId', 'csEvaluate'].every(n => win[n] === C[n]));
ck('hub: the page has no second copy of the rules', !/function socIsStuck\(|function csEvaluate\(|const CS_STEP_DOMAIN/.test(page) && page.includes('<script src="client-start.js"></script>'));

/* the REAL client-start-run */
const FN = path.resolve('supabase/functions/client-start-run/index.ts');
const src = fs.readFileSync(FN, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db');
const tmp = path.join(process.cwd(), '_csr.ts'); fs.writeFileSync(tmp, src);
let handler; const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k' };
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
let DB, ENG = ENGINE_SRC, ENG_STATUS = 200;
const clone = (x) => JSON.parse(JSON.stringify(x));
globalThis.__db = {
  from: (t) => { const f = []; const b = { select() { return b; }, eq(c, v) { f.push(r => String(r[c]) === String(v)); return b; },
    maybeSingle: () => { const row = (DB.app_data || []).find(r => f.every(fn => fn(r))); return Promise.resolve({ data: row ? { data: clone(row.data) } : null, error: null }); },
    then(ok) { return Promise.resolve({ data: (DB[t] || []).filter(r => f.every(fn => fn(r))), error: null }).then(ok); } }; return b; },
  rpc: (fn, a) => { let row = DB.app_data.find(r => r.key === a.target_key); if (!row) DB.app_data.push(row = { key: a.target_key, data: [] });
    const i = row.data.findIndex(x => x.id === a.item.id); if (i >= 0) row.data[i] = clone(a.item); else row.data.push(clone(a.item)); return Promise.resolve({ error: null }); } };
globalThis.fetch = async (u) => { if (String(u).startsWith('https://cc.mo-care.com/client-start.js')) return new Response(ENG, { status: ENG_STATUS }); throw new Error('unexpected ' + u); };
await import(tmp); fs.unlinkSync(tmp);
const tok = (c) => 'Bearer x.' + Buffer.from(JSON.stringify(c)).toString('base64url') + '.y';
const call = async (q = '', role = 'service_role') => (await handler(new Request('http://x/client-start-run' + q, { method: 'POST', headers: { Authorization: tok({ role }) } }))).json();
const realNow = Date.now; const RealDate = Date;
class FixDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(NOWMS); } static now() { return NOWMS; } }
globalThis.Date = FixDate;
const items = () => DB.app_data.find(r => r.key === 'ops_items').data;
const logs = () => (DB.app_data.find(r => r.key === 'automation_log') || { data: [] }).data;
function world(live, extraLeads = [], extraItems = []) {
  DB = { app_data: [{ key: 'ops_settings', data: { client_start_live: live } },
      { key: 'leads', data: [lead('a', famStep(15)), lead('b', officeStep(2)), lead('c', officeStep(20)), lead('old', officeStep(200)), lead('lost', officeStep(9), { status: 'Lost' }), ...extraLeads] },
      { key: 'ops_items', data: [{ id: 'other', status: 'open', title: 'not ours' }, ...extraItems] }],
    persons: [{ person_id: 'P1', primary_email: 'Krystal@mo-care.com' }, { person_id: 'P2', primary_email: 'angiel@mo-care.com' }],
    domains: [{ code: 'family_enquiries', owner_person: 'P1', entity: 'cc_ihs' }, { code: 'client_care', owner_person: 'P2', entity: 'cc_ihs' }] };
}
world(false); let r = await call();
ck('server: DRY BY DEFAULT: nothing written to My Work; the run is logged; counts and previews for the owner\'s script',
  items().length === 1 && logs().length === 1 && logs()[0].dry === true && r.dry === true && r.would_create === 2 && r.held_too_old === 1
  && r.create_preview.map(x => x.about).sort().join() === 'Mary Smitha,Mary Smithc' && r.held_preview[0].waited_days === 200, r);
r = await call('', 'anon');
ck('server: the scheduler (public key) gets counts only, no names', r.would_create === 2 && !('create_preview' in r) && !JSON.stringify(r).includes('Mary'), r);
world(true); r = await call('?dry=1');
ck('server: ?dry=1 writes nothing even when switched on', items().length === 1 && r.dry === true);
world(true); r = await call();
const A = items().find(i => i.id === 'cstart_a'), Cc = items().find(i => i.id === 'cstart_c');
ck('server LIVE: each stuck start becomes one My Work item, owned by whoever owns that step\'s area', r.created === 2 && A.owner === 'krystal@mo-care.com' && Cc.owner === 'angiel@mo-care.com' && A.urgency === 'normal' && Cc.urgency === 'high' && A.created_by === 'client-start', { A, Cc });
ck('server LIVE: a start stuck 200 days is NOT raised (listed for a person to decide); a Lost lead is left out', !items().some(i => i.id === 'cstart_old' || i.id === 'cstart_lost'));
const n0 = items().length; r = await call();
ck('server: a second run adds nothing (one item per start, ever)', items().length === n0 && r.created === 0);
world(true, [], [{ id: 'cstart_a', source_id: 'a', status: 'open', opened_by: 'client-start', domain: 'family_enquiries', owner: 'sam@mo-care.com', note: 'called Tuesday', client_start: { step: 'Signed Care Agreement received', waited_days: 14 }, history: [] }]);
r = await call(); const A2 = items().find(i => i.id === 'cstart_a');
ck('server: an update keeps what a person set on the item (their owner, their note) and refreshes the wait', A2.owner === 'sam@mo-care.com' && A2.note === 'called Tuesday' && A2.client_start.waited_days === 15 && r.updated === 1, A2);
world(true, [], [{ id: 'cstart_lost', source_id: 'lost', status: 'open', opened_by: 'client-start', about: 'x', history: [] }, { id: 'cstart_b', source_id: 'b', status: 'open', opened_by: 'client-start', history: [] }]);
r = await call();
const L = items().find(i => i.id === 'cstart_lost'), B = items().find(i => i.id === 'cstart_b');
ck('server: an open item closes by itself when the start moves again, and when the lead is marked Lost', L.status === 'done' && /archived, lost/.test(L.close_note) && B.status === 'done' && /Moving again/.test(B.close_note) && r.closed === 2, { L, B });
world(true, Array.from({ length: 14 }, (_, i) => lead('n' + i, officeStep(5))));
r = await call('?max=5');
ck('server: a per-run ceiling: the rest wait for the next run (counted, never dropped)', r.created === 5 && r.deferred === 11, r);
world(true); ENG_STATUS = 500; r = await call();
ck('server: if the shared rules can\'t be fetched it STOPS (no second copy of the rules), and says so in the log', r.error && items().length === 1 && logs()[0].ok === false, r);
ENG_STATUS = 200; ENG = 'globalThis.Something = 1'; world(true); r = await call();
ck('server: a fetched file that isn\'t the rules is refused', r.error && items().length === 1);
globalThis.Date = RealDate;

console.log('\nCHANGE 8b · STALLED STARTS · TEST\n' + '='.repeat(60));
let ok = true;
for (const [nm, g, note] of res) { ok &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + nm + (note ? '\n   └─ ' + note : '')); }
console.log('='.repeat(60)); console.log(ok ? `ALL ${res.length} CHECKS PASS` : `${res.filter(r => !r[1]).length} FAILED`);
