// Open shifts with no coverage case become My Work cards (2026-10-18, the Today page map, her yes). The shared rule
// (_shared/open-shift.ts) and the REAL coverage-watch under Node (fake AxisCare, fake database). Nothing is sent.
// node open_shift_cards_test.mjs
import fs from 'fs'; import path from 'path';
process.env.TZ = 'UTC';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const FNS = path.resolve('supabase/functions');
const O = await import(path.join(FNS, '_shared/open-shift.ts'));
const Rs = (s, b) => new Response(JSON.stringify(b), { status: s });

/* ── the rule on its own ── */
{
  const now = Date.parse('2026-10-19T14:00:00Z'), v = (id, h) => ({ visitId: id, client: 'Ann Able', clientId: '7', startMs: now + h * 36e5, endMs: now + (h + 2) * 36e5, start: '2026-10-19T09:00:00', end: '2026-10-19T11:00:00', reason: '' });
  const ctx = { now, openCaseVisits: new Set(['s=5:d=2026-10-19']), openCaseSchedules: new Set(['9']) };
  ck('rule: a shift inside 36 hours with no case gets a card', O.openShiftSkip(v('s=1:d=2026-10-19', 8), ctx) === '');
  ck('rule: started, more than 36 hours away, an open case, or an open ongoing-shifts case on its schedule: no card',
    O.openShiftSkip(v('s=1:d=x', -1), ctx) === 'already started' && O.openShiftSkip(v('s=1:d=x', 40), ctx) === 'more than 36 hours away'
    && O.openShiftSkip(v('s=5:d=2026-10-19', 8), ctx) === 'has an open coverage case' && O.openShiftSkip(v('s=9:d=2026-10-20', 8), ctx) === 'its schedule has an open ongoing-shifts case');
  const it = O.openShiftItem(v('s=1:d=2026-10-19', 8), 'samantha@mo-care.com', new Date(now).toISOString());
  ck('card: one id per visit, kind open_shift, urgent within 12 hours, names the client and time, says the inactive-caregiver trap and that nobody was texted',
    it.id === 'ops_open_s_1_d_2026_10_19' && it.kind === 'open_shift' && it.urgency === 'urgent' && /Open shift, nobody assigned: Ann Able/.test(it.title)
    && /no longer active/.test(it.detail) && /Nobody has been texted/.test(it.detail) && it.owner === 'samantha@mo-care.com', it);
  ck('card: high inside 24 hours, normal beyond', O.openShiftItem(v('a', 20), 'x', new Date(now).toISOString()).urgency === 'high' && O.openShiftItem(v('a', 30), 'x', new Date(now).toISOString()).urgency === 'normal');
  ck('copy: no em dashes', !/[—―]/.test(JSON.stringify(it)));
  const cctx = { now, unassigned: new Map(), assigned: new Set(['s=2:d=x']), openCaseVisits: new Set(['s=3:d=x']), openCaseSchedules: new Set(), fetched: true, startMsOf: new Map([['s=2:d=x', now + 9e6], ['s=3:d=x', now + 9e6], ['s=4:d=x', now - 1]]) };
  ck('close: a caregiver now, a case now, started, or gone from the schedule; never on a failed read',
    /caregiver/.test(O.openShiftCloseWhy({ axiscare_visit_id: 's=2:d=x' }, cctx)) && /coverage case/.test(O.openShiftCloseWhy({ axiscare_visit_id: 's=3:d=x' }, cctx))
    && /started/.test(O.openShiftCloseWhy({ axiscare_visit_id: 's=4:d=x' }, cctx)) && /no longer on/.test(O.openShiftCloseWhy({ axiscare_visit_id: 's=6:d=x' }, cctx))
    && O.openShiftCloseWhy({ axiscare_visit_id: 's=6:d=x' }, { ...cctx, fetched: false }) === '');
}

/* ── the REAL coverage-watch ── */
const src0 = fs.readFileSync(path.join(FNS, 'coverage-watch/index.ts'), 'utf8');
const src = src0.replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace("from '../_shared/events.ts'", "from '" + path.join(FNS, '_shared/events.ts') + "'")
  .replace("from '../_shared/held-shift.ts'", "from '" + path.join(FNS, '_shared/held-shift.ts') + "'")
  .replace("from '../_shared/covered-outside.ts'", "from '" + path.join(FNS, '_shared/covered-outside.ts') + "'")
  .replace("from '../_shared/job-auth.ts'", "from '" + path.resolve('test_stubs/job-auth-by-role.mjs') + "'")   // J2: lock stand-in (no token = the schedule)
  .replace(/from '\.\.\/_shared\/([\w.-]+\.(?:ts|js))'/g, (_, m) => "from '" + path.join(FNS, '_shared', m) + "'")   /* every other shared import, so a new one never breaks this harness */;
const tmp = path.join(process.cwd(), '_cw_open_under_test.ts'); fs.writeFileSync(tmp, src);
let handler; const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485' };
globalThis.Deno = { env: { get: k => env[k] }, serve: h => { handler = h; } };

const NOW = Date.now(), HR = 36e5;
const wall = (ms) => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms)).map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00`; };
const vid = (s, ms) => `s=${s}:d=${wall(ms).slice(0, 10)}`;
const CO = { name: 'Staffing Change - Caregiver Call Off' };
let DB, AX, calls, events;
function world() {
  const t8 = NOW + 8 * HR, t3 = NOW + 3 * HR, t1ago = NOW - 1 * HR, t30 = NOW + 30 * HR;
  AX = [   // `updated` = when AxisCare last changed it (the fake's own record; never sent)
    { id: vid(119, t8), start: t8, updated: NOW - 2 * HR, reason: CO },            // held: covered case closed 10h ago, CHANGED 2h ago
    { id: vid(120, t8), start: t8, updated: NOW - 20 * HR, reason: CO },           // held: covered case closed 10h ago, unchanged
    { id: vid(121, t8), start: t8, updated: NOW - 20 * HR, reason: CO },           // held: closed uncovered, unchanged
    { id: vid(122, NOW + 54 * HR), start: NOW + 54 * HR, updated: NOW - 20 * HR, reason: CO, fail: true }, // held: AxisCare errors on the since read (its own day)
    { id: vid(130, t3), start: t3, updated: NOW - 1 * HR, reason: CO },            // fresh call-off, 3 hours from now (wall clock)
    { id: vid(131, t1ago), start: t1ago, updated: NOW - 3 * HR, reason: CO },       // started an hour ago
    { id: vid(140, t30), start: t30, updated: NOW - 1 * HR, reason: CO },           // has an OPEN case already
    { id: vid(150, t8), start: t8, updated: NOW - 50 * HR, reason: null },          // no reason: ignored
  ];
  const closed = (v, how, by, id) => ({ id, axiscare_visit_id: v, status: 'done', opened_at: new Date(NOW - 11 * HR).toISOString(), opened_by: 'Samantha Troutman',
    resolved_at: new Date(NOW - 10 * HR).toISOString(), resolved_how: how, covered_by: by, client: 'X' });
  DB = { ops_settings: { coverage_watch_live: true, coverage_watch_7b_live: true, coverage_alert_admins: ['samantha@mo-care.com'] },
    coverage_cases: [closed(AX[0].id, 'covered', 'Grace Levering', 'cw_a_g1'), closed(AX[1].id, 'covered', 'Eve Adams', 'cw_b_g1'),
      closed(AX[2].id, 'uncovered', null, 'cw_c_g1'), closed(AX[3].id, 'covered', 'Ann Lee', 'cw_d_g1'),
      { id: 'cw_open', axiscare_visit_id: AX[6].id, status: 'open', opened_at: new Date(NOW - HR).toISOString(), opened_by: 'axiscare-watch', resolved_at: null }],
    ops_items: [], visit_memory: [],
    attendance_watch_state: [{ id: 'state', last_date: wall(NOW - 864e5).slice(0, 10) }],
    notes_watch_state: [{ id: 'state', last_hour: new Date().toISOString().slice(0, 13) }] };
  calls = []; events = [];
}
globalThis.__db = {
  from: (t) => { const p = { _k: null, select() { return p; }, eq(k, v) { p._k = v; return p; },
    maybeSingle() { return Promise.resolve({ data: DB[p._k] !== undefined ? { data: JSON.parse(JSON.stringify(DB[p._k])) } : null, error: null }); },
    insert(row) { if (t === 'op_events') events.push(row); return Promise.resolve({ error: null }); } }; return p; },
  rpc(fn, a) { if (fn === 'upsert_app_data_item') { const arr = DB[a.target_key] = Array.isArray(DB[a.target_key]) ? DB[a.target_key] : []; const i = arr.findIndex(x => x.id === a.item.id); if (i >= 0) arr[i] = a.item; else arr.push(a.item); }
    if (fn === 'delete_app_data_item') DB[a.target_key] = (DB[a.target_key] || []).filter(x => x.id !== a.item_id);
    return Promise.resolve({ error: null }); },
};
globalThis.fetch = async (u, o = {}) => {
  const url = new URL(String(u)); calls.push(String(u));
  if (url.pathname !== '/api/visits') return Rs(404, { errors: ['not here'] });
  const q = url.searchParams, s = q.get('startDate'), e = q.get('endDate'), since = q.get('updatedSinceDate');
  if (since) { const hit = AX.filter(v => v.id.endsWith(s)); if (hit.some(v => v.fail)) return Rs(500, { errors: ['boom'] }); }
  const rows = AX.filter(v => { const d = wall(v.start).slice(0, 10); return (!s || (d >= s && d <= e)) && (!since || v.updated >= Date.parse(since)); })
    .map(v => ({ id: v.id, scheduledStartDate: wall(v.start), scheduledEndDate: wall(v.start + 2 * HR), timezone: 'America/Chicago',
      client: { id: 7, firstName: 'Joel', lastName: 'Wolverton' }, caregiver: null, modificationReason: v.reason, removed: false }));
  return rows.length ? Rs(200, { results: { visits: rows } }) : Rs(404, { errors: ['No visits found'] });
};
await import(tmp); fs.unlinkSync(tmp);
const run = async (q = '') => { const r = await handler(new Request('http://x/coverage-watch' + q, { method: 'POST' })); return r.json(); };
const sinceCalls = () => calls.filter(c => c.includes('updatedSinceDate='));
const newCases = () => DB.coverage_cases.filter(c => c.status === 'open' && c.id !== 'cw_open');

const opens = () => DB.ops_items.filter(i => i.kind === 'open_shift');

/* the harness world: AX[7] is a shift 8 hours away with no reason (the watcher opens no case), AX[5] started an hour ago,
   AX[6] has an open case. Practice first. */
world(); DB.ops_settings.coverage_watch_7b_live = false;
let out = await run();
ck('practice: the answer lists the uncased open shift it would make a card for, and nothing is written', out.open_shift_cards && out.open_shift_cards.live === false
  && out.open_shift_cards.would.some(w => w.visit === AX[7].id) && opens().length === 0, out.open_shift_cards);
ck('practice: a started shift and one with an open case are not listed', !out.open_shift_cards.would.some(w => w.visit === AX[5].id || w.visit === AX[6].id), out.open_shift_cards);

world(); DB.ops_settings.coverage_watch_7b_live = false; DB.ops_settings.open_shift_cards_live = true;
out = await run();
const card = opens().find(i => i.axiscare_visit_id === AX[7].id);
ck('live: one card for the uncased open shift, for the scheduling owner, saying no reason was recorded', card && card.status === 'open' && card.owner === 'samantha@mo-care.com' && /no reason was recorded/.test(card.detail)
  && events.some(e => e.verb === 'open_shift_card'), { card, oc: out.open_shift_cards });
ck('live: no card for a shift with an open case, or one already started', !opens().some(i => i.axiscare_visit_id === AX[6].id || i.axiscare_visit_id === AX[5].id));
const n1 = opens().length; out = await run();
ck('live: a second run makes nothing again', opens().length === n1 && out.open_shift_cards.made === 0, out.open_shift_cards);
/* the shift gets a caregiver in AxisCare: the card closes */
AX[7].assigned = true;
const fetch0 = globalThis.fetch;
globalThis.fetch = async (u, o) => { const r = await fetch0(u, o); if (!String(u).includes('/api/visits')) return r; const j = await r.clone().json().catch(() => null);
  if (j?.results?.visits) j.results.visits = j.results.visits.map(v => v.id === AX[7].id ? { ...v, caregiver: { id: 99, firstName: 'Bea', lastName: 'B' } } : v); return Rs(r.status, j || {}); };
out = await run();
ck('live: AxisCare now shows a caregiver, so the card closes saying so', card && opens().find(i => i.id === card.id).status === 'done' && /caregiver/.test(opens().find(i => i.id === card.id).auto_closed_reason), opens().find(i => i.id === card?.id));
globalThis.fetch = fetch0;
ck('nothing is ever sent: every AxisCare request is a read', calls.every(c => !/\/(assign|messages|sms)/.test(c)));

for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n      ' + note : ''));
const passed = res.filter(r => r[1]).length;
console.log(`\n${passed}/${res.length} passed · ${passed === res.length ? 'ALL GREEN' : 'FAIL'}`);
process.exit(passed === res.length ? 0 : 1);
