// End-to-end test of the launch-evidence edge function under Node: real function code,
// real engine file, fake database, fake AxisCare. node launch_evidence_harness.mjs <index.ts> <launch-evidence.js>
import fs from 'fs'; import path from 'path';
const FN = process.argv[2], ENGINE = process.argv[3];
const src = fs.readFileSync(FN, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient');
const tmp = path.join(process.cwd(), '_launch_evidence_under_test.ts'); fs.writeFileSync(tmp, src);
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note).slice(0, 700)]);
let handler = null; const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485' };
globalThis.Deno = { env: { get: k => env[k] }, serve: h => { handler = h; } };
const realSetTimeout = globalThis.setTimeout; globalThis.setTimeout = (f) => realSetTimeout(f, 0);
const engineSrc = fs.readFileSync(ENGINE, 'utf8'); let engineOk = true;

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
const D = k => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };
const visit = (cid, day, clocked, extra) => Object.assign({ id: 'v=' + cid + day, client: { id: +cid }, caregiver: { id: 7, firstName: 'Jane', lastName: 'Doe' },
  scheduledStartDate: day + 'T09:00:00', scheduledEndDate: day + 'T12:00:00', removed: false, verified: clocked,
  clockIn: clocked ? { time: day + 'T09:02:00', method: 'Mobile' } : null, clockOut: clocked ? { time: day + 'T12:01:00' } : null }, extra || {});
const AX = { '295': [visit(295, D(-4), true), visit(295, D(3), false)], '300': [visit(300, D(2), false)], '310': [visit(310, D(-3), false)] };
let axCalls = [], ax429 = false, pageTwo = false;
globalThis.fetch = async (u) => {
  u = String(u);
  if (u.startsWith('https://cc.mo-care.com/launch-evidence.js')) return engineOk ? new Response(engineSrc) : new Response('nope', { status: 500 });
  if (u.startsWith('https://16485.axiscare.com/api/visits')) {
    axCalls.push(u);
    if (ax429) return new Response('{}', { status: 429 });
    const q = new URL(u).searchParams, cid = q.get('clientIds');
    if (pageTwo && !q.get('page')) return new Response(JSON.stringify({ results: { visits: [AX[cid][0]], nextPage: u + '&page=2' } }));
    if (pageTwo && q.get('page')) return new Response(JSON.stringify({ results: { visits: AX[cid].slice(1), nextPage: 'https://evil.example/api/visits' } }));
    return new Response(JSON.stringify({ results: { visits: AX[cid] || [] } }));
  }
  throw new Error('unexpected fetch ' + u);
};
const DB = { app_data: { ops_settings: {}, automation_log: [] }, launch_evidence: [],
  client_queue: [
    { id: '11111111-1111-4111-8111-111111111111', client_name: 'Peggy Thomason', axiscare_client_id: '295', status: 'pending', episode_n: 1, start_date: D(-4), added_at: D(-10) + 'T14:00:00Z' },
    { id: '22222222-2222-4222-8222-222222222222', client_name: 'Ann Lee', axiscare_client_id: '300', status: 'pending', episode_n: 2, start_date: D(2), added_at: D(-5) + 'T14:00:00Z' },
    { id: '33333333-3333-4333-8333-333333333333', client_name: 'Bo Park', axiscare_client_id: '310', status: 'pending', episode_n: 1, start_date: D(-3), added_at: D(-8) + 'T14:00:00Z' },
    { id: '44444444-4444-4444-8444-444444444444', client_name: 'No Id Yet', axiscare_client_id: '', status: 'pending', episode_n: 1, added_at: D(-2) + 'T14:00:00Z' },
    { id: '55555555-5555-4555-8555-555555555555', client_name: 'Old Launch', axiscare_client_id: '320', status: 'pending', episode_n: 1, added_at: D(-200) + 'T14:00:00Z' },
    { id: '66666666-6666-4666-8666-666666666666', client_name: 'Done', axiscare_client_id: '330', status: 'complete', episode_n: 1, added_at: D(-9) + 'T14:00:00Z' }] };
const rpcs = [];
globalThis.__fakeCreateClient = () => ({
  from: (t) => { const f = []; let single = false; const p = {
      select() { return p; }, eq(k, v) { f.push(r => String(r[k]) === String(v)); return p; }, neq(k, v) { f.push(r => String(r[k]) !== String(v)); return p; },
      in(k, vs) { f.push(r => vs.map(String).includes(String(r[k]))); return p; }, maybeSingle() { single = true; return p; },
      then(ok, bad) { let rows;
        if (t === 'app_data') { rows = Object.entries(DB.app_data).map(([key, data]) => ({ key, data })); }
        else rows = DB[t] || [];
        rows = rows.filter(r => f.every(g => g(r)));
        return Promise.resolve(single ? { data: rows[0] || null, error: null } : { data: rows, error: null }).then(ok, bad); } }; return p; },
  rpc: async (name, args) => {
    rpcs.push({ name, args });
    if (name === 'upsert_app_data_item') { DB.app_data[args.target_key].push(args.item); return { data: null, error: null }; }
    if (name === 'launch_evidence_record') {
      const got = [];
      for (const r of args.p_records) { if (!DB.launch_evidence.some(e => e.launch_id === args.p_launch_id && e.fact === r.fact && e.source === args.p_source)) {
        DB.launch_evidence.push({ launch_id: args.p_launch_id, fact: r.fact, source: args.p_source, recorded_by: args.p_staff, reason: args.p_reason, evidence: r.detail || {} }); got.push(r.fact); } }
      return { data: { outcome: got.length ? 'recorded' : 'nothing_new', recorded: got, ticked: got }, error: null };
    }
    return { data: null, error: { message: 'unknown rpc ' + name } };
  } });
await import(tmp); fs.unlinkSync(tmp);
const tok = (claims) => 'Bearer x.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.y';
const STAFF = tok({ role: 'authenticated', email: 'Kat@CC.test' }), ANON = tok({ role: 'anon' }), SVC = tok({ role: 'service_role' });
const call = async (auth, body) => { const r = await handler(new Request('http://x/functions/v1/launch-evidence', { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })); return [r.status, await r.json()]; };
const doorCalls = () => rpcs.filter(r => r.name === 'launch_evidence_record');
const logs = () => DB.app_data.automation_log.filter(l => l.automation === 'launch_evidence');

let r = await handler(new Request('http://x', { method: 'OPTIONS' }));
ck('CORS · the browser preflight is answered from day one', r.status === 200 && r.headers.get('Access-Control-Allow-Origin') === '*');
let [st, b] = await call(ANON, { action: 'refresh', launch_id: DB.client_queue[0].id });
let [st2] = await call(STAFF, { action: 'run' });
ck('access · a card refresh needs a signed-in person; the scheduled run refuses a signed-in person', st === 401 && st2 === 403, [st, st2]);

engineOk = false; [st, b] = await call(ANON, { action: 'run' }); engineOk = true;
ck('stops · if the hub\'s rules file cannot be fetched it refuses to decide, and the failed run is logged', st === 502 && logs().at(-1)?.ok === false && doorCalls().length === 0, b);

[st, b] = await call(STAFF, { action: 'refresh', launch_id: DB.client_queue[0].id });
ck('refresh (switch off) · shows what AxisCare says, records nothing',
  st === 200 && b.ok && b.live === false && b.evaluation.actual_soc.date === D(-4) && b.evaluation.caregiver.primary === 'Jane Doe' && b.recorded === null && doorCalls().length === 0, b);
ck('refresh · a first launch is read from AxisCare go-live, through six weeks ahead', /startDate=2026-08-17/.test(axCalls.at(-1)) && axCalls.at(-1).includes('endDate=' + D(42)), axCalls.at(-1));
axCalls = []; await call(STAFF, { action: 'refresh', launch_id: DB.client_queue[1].id });
ck('refresh · a returning client (episode 2) is read only from the day this launch opened', axCalls[0].includes('startDate=' + D(-5)), axCalls);

[st, b] = await call(STAFF, { action: 'record', launch_id: DB.client_queue[2].id, fact: 'first_shift', reason: 'no', date: D(-3) });
ck('by hand · a reason is required before anything is sent to the door', b.outcome === 'reason_required' && doorCalls().length === 0, b);
[st, b] = await call(STAFF, { action: 'record', launch_id: DB.client_queue[2].id, fact: 'first_shift', reason: 'Forgot to clock in; family confirmed', date: D(-3) });
let dc = doorCalls().at(-1);
ck('by hand · goes through the door as that person, with the reason and the day care began (not behind the switch)',
  b.outcome === 'recorded' && dc.args.p_source === 'person' && dc.args.p_staff === 'kat@cc.test' && dc.args.p_records[0].detail.date === D(-3), dc);

pageTwo = true; axCalls = [];
[st, b] = await call(ANON, { action: 'run' });
ck('run (switch off) · reads each open launch with an AxisCare id, records nothing, logs counts',
  st === 200 && b.dry === true && b.read === 3 && b.no_axiscare_id === 1 && b.too_old === 1 && b.recorded === 0 && doorCalls().length === 1
  && logs().at(-1)?.dry === true && logs().at(-1)?.rows_seen === 3, b);
ck('run · the scheduler (public key) gets counts only, no names', b.preview === undefined && !JSON.stringify(b).includes('Peggy'), b);
ck('paging · follows AxisCare\'s next page, never a link to another host', axCalls.some(u => u.includes('page=2')) && !axCalls.some(u => u.includes('evil')), axCalls);
ck('completed launches are not read', !axCalls.some(u => u.includes('clientIds=330')), axCalls);
pageTwo = false;

DB.app_data.ops_settings = { launch_evidence_live: true };
[st, b] = await call(SVC, { action: 'run' });
const peg = doorCalls().filter(c => c.args.p_launch_id === DB.client_queue[0].id);
ck('run (switch on) · records Peggy\'s four facts through the door as the automation', b.dry === false && peg.length === 1
  && peg[0].args.p_source === 'axiscare' && peg[0].args.p_staff === 'automation:launch-evidence'
  && peg[0].args.p_records.map(x => x.fact).join() === 'schedule,caregiver,first_shift,evv', peg.map(p => p.args));
ck('run · the owner\'s report (service role) sees each launch and its open questions', b.preview.length === 3
  && b.preview.find(p => p.client === 'Bo Park').questions.length === 0 && b.preview.find(p => p.client === 'Peggy Thomason').actual_soc === D(-4), b.preview);
const n0 = doorCalls().length; [st, b] = await call(ANON, { action: 'run' });
ck('rerun · facts already recorded are not sent again', b.would_record === 0 && doorCalls().length === n0, b);

ax429 = true; [st, b] = await call(ANON, { action: 'run' }); ax429 = false;
ck('AxisCare busy (429) · the run stops early and says so in the log', b.rate_limited === true && logs().at(-1)?.rate_limited === true, b);
[st, b] = await call(STAFF, { action: 'refresh', launch_id: DB.client_queue[3].id });
ck('no AxisCare id yet · says so, reads nothing', b.ok === false && b.reason === 'no_axiscare_id', b);

let pass = 0;
for (const [name, ok, note] of res) { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n     ' + note)); if (ok) pass++; }
console.log(`\n${pass}/${res.length} passed`);
process.exit(pass === res.length ? 0 : 1);
