// Change 7a · axiscare-read-probe under Node (fake AxisCare, fake database that refuses every write).
// node axiscare_read_probe_harness.mjs supabase/functions/axiscare-read-probe/index.ts
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note).slice(0, 900)]);
const FN = process.argv[2];
const src = fs.readFileSync(FN, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db');
const tmp = path.join(process.cwd(), '_probe_under_test.ts'); fs.writeFileSync(tmp, src);
let handler; const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_exact_key_123', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485' };
globalThis.Deno = { env: { get: k => env[k] }, serve: h => { handler = h; } };

/* ── the fake AxisCare: a visit store that honours startDate/endDate/updatedSinceDate (AND), 100 per page ── */
const NOW = Date.parse('2026-09-27T17:00:00Z');           // noon in Springfield (CDT)
const H = 36e5, D = 864e5;
const who = { client: { id: 7, firstName: 'Ruth', lastName: 'Secretname' } };
const cg = { caregiver: { id: 9, firstName: 'Cara', lastName: 'Hiddenname' } };
const V = [];
for (let i = 0; i < 250; i++) V.push({ id: `s=10${i}:d=2026-09-28`, scheduledStartDate: '2026-09-28T09:00:00', updated: NOW - 10 * D, ...who, ...cg, modifiedDate: 'x' });
V.push({ id: 'v=1:s=1:d=2026-09-27', scheduledStartDate: '2026-09-27T08:00:00', updated: NOW - 3 * H, ...who, ...cg,
  clockIn: { time: '2026-09-27T08:05:00', method: 'app' }, clockOut: { time: '2026-09-27T11:00:00', method: 'app' } });   // office clock, no offset
V.push({ id: 'v=2:s=2:d=2026-09-27', sinceId: 's=2:d=2026-09-27', scheduledStartDate: '2026-09-27T09:00:00', updated: NOW - 2 * H, ...who, ...cg,
  clockIn: { time: '2026-09-27T09:00:00-05:00', method: 'telephony' } });                                            // same slot, other id form
V.push({ id: 'v=3:s=3:d=2026-09-27', scheduledStartDate: '2026-09-27T10:00:00', updated: NOW - 20 * D, ...who, ...cg,
  clockIn: { time: '2026-09-27T10:00:00', method: 'app' } });                                                           // clocked, but NOT returned as changed
V.push({ id: 'v=4:s=4:d=2026-09-26', scheduledStartDate: '2026-09-26T07:00:00', updated: NOW - 30 * H, ...who, ...cg,
  clockIn: { time: '2026-09-26T07:00:00', method: 'app' } });                                                           // older than 24h: not tested
V.push({ id: 's=50:d=2026-09-28', scheduledStartDate: '2026-09-28T13:00:00', updated: NOW - 2 * H, ...who, caregiver: null, modificationReason: { name: 'Call Off' } });
V.push({ id: 's=51:d=2026-09-25', scheduledStartDate: '2026-09-25T13:00:00', updated: NOW - 3 * D, ...who, ...cg });
V.push({ id: 's=52:d=2026-09-28', scheduledStartDate: '2026-09-28T15:00:00', updated: NOW - 30 * D, mod: null, ...who, caregiver: null, modificationReason: { name: 'Call Off' } });   // no last-changed time: a real miss as far as we can tell
V.push({ id: 's=53:d=2026-09-29', scheduledStartDate: '2026-09-29T15:00:00', updated: NOW - 20 * D, ...who, caregiver: null, modificationReason: { name: 'Call Off' } });              // called off 20 days ago: not a miss
V.push({ id: 'v=5:s=5:d=2026-09-27', scheduledStartDate: '2026-09-27T14:00:00', updated: NOW - 20 * D, mod: new Date(NOW - H).toISOString(), ...who, ...cg });                  // AxisCare says changed 1h ago, filter misses it
V.push({ id: 's=60:d=2026-09-29', scheduledStartDate: '2026-09-29T09:00:00', updated: NOW - 30 * D, ...who, caregiver: null });
const CASES = [
  { axiscare_visit_id: 's=50:d=2026-09-28', opened_by: 'axiscare-watch', status: 'open', opened_at: new Date(NOW - 2 * H).toISOString() },
  { axiscare_visit_id: 's=52:d=2026-09-28', opened_by: 'axiscare-watch', status: 'open', opened_at: new Date(NOW - 5 * D).toISOString() },
  { axiscare_visit_id: 's=53:d=2026-09-29', opened_by: 'axiscare-watch', status: 'open', opened_at: new Date(NOW - 4 * D).toISOString() },
  { axiscare_visit_id: 's=51:d=2026-09-25', opened_by: 'axiscare-watch', status: 'filled', opened_at: new Date(NOW - 3 * D).toISOString() },
  { axiscare_visit_id: 's=60:d=2026-09-29', opened_by: 'ongoing-sweep', status: 'open', opened_at: new Date(NOW - 2 * D).toISOString() },
  { axiscare_visit_id: 's=99:d=2026-09-10', opened_by: 'axiscare-watch', status: 'filled', opened_at: new Date(NOW - 17 * D).toISOString() },
];
const calls = [];
const Rs = (s, b) => new Response(JSON.stringify(b), { status: s });
const fakeAx = (opt = {}) => async (u, o = {}) => {
  const url = new URL(String(u)); calls.push({ m: (o.method || 'GET').toUpperCase(), url: String(u) });
  if (url.pathname !== '/api/visits') throw new Error('unexpected ' + url);
  if (opt.limitAt && calls.length >= opt.limitAt) return Rs(429, { errors: ['Too Many Requests'] });
  const q = url.searchParams, since = q.get('updatedSinceDate'), s = q.get('startDate'), e = q.get('endDate');
  const useSince = since && !(opt.ignoreSinceWithDates && s);
  let rows = V.filter(v => (!s || (v.scheduledStartDate.slice(0, 10) >= s && v.scheduledStartDate.slice(0, 10) <= e)) && (!useSince || v.updated >= Date.parse(since)));
  rows = rows.map(({ updated, sinceId, mod, ...v }) => ({ ...(since && sinceId ? { ...v, id: sinceId } : v), ...(mod === undefined ? (v.modifiedDate ? {} : { modifiedDate: new Date(updated).toISOString() }) : (mod ? { modifiedDate: mod } : {})) }));
  const page = Number(q.get('page') || 1), slice = rows.slice((page - 1) * 100, page * 100);
  if (!rows.length) return Rs(404, { errors: ['No visits found'] });
  const next = rows.length > page * 100 ? (q.set('page', page + 1), `https://16485.axiscare.com/api/visits?${q}`) : null;
  return Rs(200, { results: { visits: slice, nextPage: next } });
};

/* ── a database that can only read coverage_cases; any write throws ── */
const dbCalls = [];
globalThis.__db = { from: (t) => { dbCalls.push(t); const p = { select() { return p; }, eq(k, v) { dbCalls.push(v); return p; },
  maybeSingle() { return Promise.resolve({ data: t === 'app_data' ? { data: CASES } : null, error: null }); },
  insert() { throw new Error('write attempted'); }, update() { throw new Error('write attempted'); }, upsert() { throw new Error('write attempted'); }, delete() { throw new Error('write attempted'); } }; return p; },
  rpc() { throw new Error('rpc attempted'); } };

const M = await import(tmp); fs.unlinkSync(tmp);
const tok = (c) => 'Bearer x.' + Buffer.from(JSON.stringify(c)).toString('base64url') + '.y';

/* auth + CORS through the real handler */
globalThis.fetch = fakeAx();
const call = async (auth, method = 'POST') => { const r = await handler(new Request('http://x', { method, headers: auth ? { Authorization: auth } : {}, body: method === 'POST' ? '{}' : undefined })); return [r.status, r.status === 200 && method === 'POST' ? await r.json() : null, r]; };
const [so, , ro] = await call(null, 'OPTIONS');
ck('CORS: the preflight answers 200 with Allow-Origin', so === 200 && ro.headers.get('Access-Control-Allow-Origin') === '*');
const sts = [];
for (const a of [null, tok({ role: 'anon' }), tok({ role: 'authenticated', email: 'kat@cc.test' }), 'Bearer sb_secret_exact_key_124']) sts.push((await call(a))[0]);
ck('only the owner script: no token, anonymous, a signed-in person, and a near-miss secret are all refused (403); AxisCare never called',
  sts.every(s => s === 403) && calls.length === 0, sts);
calls.length = 0; dbCalls.length = 0;
const [s1, out1] = await call(tok({ role: 'service_role' }));
const [s2] = await call('Bearer sb_secret_exact_key_123');
ck('the service role (legacy key or the exact new-style secret) may run it', s1 === 200 && s2 === 200, [s1, s2]);
ck('read only: every AxisCare request was a GET to /api/visits; the database was only read (coverage_cases), never written',
  calls.every(c => c.m === 'GET' && c.url.includes('/api/visits?')) && dbCalls.every(x => x === 'app_data' || x === 'coverage_cases'), { calls: calls.slice(0, 3), dbCalls });
const txt = JSON.stringify(out1);
ck('the report never carries a client or caregiver name', !/Secretname|Hiddenname|Ruth|Cara/.test(txt), txt.match(/.{30}(Secretname|Hiddenname).{30}/));

/* the measurements and the tests, on a fixed clock */
calls.length = 0;
const r = await M.runProbe('16485', 't', CASES, NOW, fakeAx(), 0);
const W = Object.fromEntries(r.windows.map(w => [w.name.split(' (')[0], w]));
ck('windows: the next 72 hours pages through (258 visits → 3 pages), same formula as coverage-watch',
  W['next 72 hours'].pages === 3 && W['next 72 hours'].visits === 258 && W['next 72 hours'].query === 'startDate=2026-09-27&endDate=2026-09-30', W['next 72 hours']);
ck('windows: today on the office clock (4 visits), and the id kinds are counted', W['today'].visits === 4 && W['today'].id_kinds.v === 4, W['today']);
ck('windows: AxisCare\'s 404 "No visits found" reads as zero, not an error', W['last 21 days'].visits === 2 && r.windows.every(w => !w.stopped), r.windows.map(w => [w.name, w.visits, w.stopped]));
const T = r.tests;
ck('A · clock-ins in the last 24h: one returned exactly, one returned as the same slot under the other id form, one MISSING and listed; the 30-hour-old one is not tested; an office-clock time with no offset reads as Springfield time',
  T.clock_ins_last_24h.checked === 3 && T.clock_ins_last_24h.found_exact === 1 && T.clock_ins_last_24h.found_same_slot === 1 && T.clock_ins_last_24h.missing === 1
  && T.clock_ins_last_24h.missing_ids[0] === 'v=3:s=3:d=2026-09-27', T.clock_ins_last_24h);
ck('A · clock-outs in the last 24h are tested too', T.clock_outs_last_24h.checked === 1 && T.clock_outs_last_24h.found_exact === 1, T.clock_outs_last_24h);
ck('B · call-off cases in the last 7 days, split by where they stand: still open (one found; one called off 20 days ago, so NOT a miss; one with no last-changed time, a miss), closed (found); a 17-day-old case is left out',
  T.calloff_cases_last_7d_still_open.checked === 3 && T.calloff_cases_last_7d_still_open.found_exact === 1 && T.calloff_cases_last_7d_still_open.changed_before_period === 1 && T.calloff_cases_last_7d_still_open.missing === 1 && T.calloff_cases_last_7d_still_open.missing_ids[0] === 's=52:d=2026-09-28'
  && T.calloff_cases_last_7d_closed.checked === 1 && T.calloff_cases_last_7d_closed.found_exact === 1, [T.calloff_cases_last_7d_still_open, T.calloff_cases_last_7d_closed]);
ck('B · an ongoing-sweep case (a shift left open long ago) is checked separately', T.ongoing_sweep_cases_last_7d.checked === 1 && T.ongoing_sweep_cases_last_7d.changed_before_period === 1 && T.ongoing_sweep_cases_last_7d.missing === 0, T.ongoing_sweep_cases_last_7d);
ck('C · unassigned in the next 72h: with a reason (3) and without (1), each checked against changed-in-7-days; old changes are not counted as misses',
  T.unassigned_next_72h_with_reason.checked === 3 && T.unassigned_next_72h_with_reason.found_exact === 1 && T.unassigned_next_72h_with_reason.missing === 1
  && T.unassigned_next_72h_no_reason.checked === 1 && T.unassigned_next_72h_no_reason.changed_before_period === 1 && T.unassigned_next_72h_no_reason.missing === 0,
  [T.unassigned_next_72h_with_reason, T.unassigned_next_72h_no_reason]);
ck('D · every visit AxisCare itself says changed in the last 24h: 4 checked, 3 returned (one as the same slot), the one the filter dropped is listed',
  T.modified_last_24h.checked === 4 && T.modified_last_24h.found_exact === 2 && T.modified_last_24h.found_same_slot === 1 && T.modified_last_24h.missing_ids[0] === 'v=5:s=5:d=2026-09-27', T.modified_last_24h);
ck('A stays strict: a clocked-in visit is a miss even if its own last-changed time is old', T.clock_ins_last_24h.changed_before_period === 0 && T.clock_ins_last_24h.missing === 1, T.clock_ins_last_24h);
ck('recurring-schedule visits (s=…) returned by the 24-hour changed read are counted', T.recurring_schedule_visits_in_changed_24h === 2, T.recurring_schedule_visits_in_changed_24h);
ck('combined filter: changed-since plus a date range returns exactly "both" when AxisCare applies AND', T.combined_filter.extra === 0 && T.combined_filter.missing === 0 && T.combined_filter.visits === 3, T.combined_filter);
if (process.env.PROBE_SAMPLE) fs.writeFileSync(process.env.PROBE_SAMPLE, JSON.stringify(r));
const r2 = await M.runProbe('16485', 't', CASES, NOW, fakeAx({ ignoreSinceWithDates: true }), 0);
ck('combined filter: if AxisCare ignored "changed since" when dates are given, the probe shows the extra visits', r2.tests.combined_filter.extra > 0, r2.tests.combined_filter);
ck('fields: visit field names are listed (names only, from every visit, so clock-in fields on visit 251 still count) and a "modified" field is spotted', r.visit_fields.includes('modifiedDate') && r.modified_date_fields.includes('modifiedDate') && r.clock_in_fields.includes('method'), r.modified_date_fields);

/* safety of the walker */
calls.length = 0;
const r3 = await M.runProbe('16485', 't', CASES, NOW, fakeAx({ limitAt: 2 }), 0);
if (process.env.PROBE_SAMPLE) fs.writeFileSync(process.env.PROBE_SAMPLE.replace('.json', '_429.json'), JSON.stringify(r3));
ck('429: the probe stops at once; every later read is skipped; it says so', r3.rate_limited === true && calls.length === 2 && r3.axiscare_calls === 2
  && r3.windows.slice(2).every(w => /skipped/.test(w.stopped)) && r3.changed_since.every(w => /skipped/.test(w.stopped)), { calls: calls.length, w: r3.windows.map(w => w.stopped) });
let n = 0;
const endless = async (u) => { n++; return Rs(200, { results: { visits: [{ id: 's=1:d=2026-09-27' }], nextPage: 'https://16485.axiscare.com/api/visits?page=' + (n + 1) } }); };
const wk = M.makeWalker('16485', 't', endless, 0); const w30 = await wk.walk('x', 'startDate=2026-09-27&endDate=2026-09-27');
ck('page cap: a read never goes past 30 pages', w30.pages === 30 && /30 pages/.test(w30.stopped), w30.stopped);
const foreign = async () => Rs(200, { results: { visits: [{ id: 's=1:d=2026-09-27' }], nextPage: 'https://evil.example.com/api/visits?page=2' } });
const wf = await M.makeWalker('16485', 't', foreign, 0).walk('x', 'startDate=2026-09-27&endDate=2026-09-27');
ck('a "next page" pointing anywhere but our AxisCare site is never followed (the token stays home)', wf.pages === 1 && wf.visits.length === 1, wf);
ck('helpers: v= and s= ids for the same slot match; an office-clock time converts with the Springfield offset',
  M.slotKey('v=9:s=3:d=2026-09-27') === 's=3:d=2026-09-27' && M.clockMs({ time: '2026-09-27T08:05:00' }, NOW) === Date.parse('2026-09-27T13:05:00Z') && M.clockMs('nonsense') === null);

console.log('\nCHANGE 7a · AXISCARE READ PROBE · HARNESS\n' + '='.repeat(60));
let ok = true;
for (const [nm, g, note] of res) { ok &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + nm + (note ? '\n   └─ ' + note : '')); }
console.log('='.repeat(60)); console.log(ok ? `ALL ${res.length} CHECKS PASS` : `${res.filter(r => !r[1]).length} FAILED`);
