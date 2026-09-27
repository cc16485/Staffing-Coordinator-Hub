// Change 7b · held shifts: the shared rule + the REAL coverage-watch under Node (fake AxisCare, fake database).
// node held_shift_harness.mjs
import fs from 'fs'; import path from 'path';
process.env.TZ = 'UTC';   // Supabase's servers run in UTC; on a Central-time Mac the old time bug would hide
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const FNS = path.resolve('supabase/functions');
const H = await import(path.join(FNS, '_shared/held-shift.ts'));

/* ── the shared rule on its own ── */
ck('time: a wall-clock time with no offset is Springfield time (summer, CDT = UTC-5)', H.visitMs('2026-09-27T17:00:00') === Date.parse('2026-09-27T22:00:00Z'));
ck('time: winter (CST = UTC-6), and a time with an offset is taken as given', H.visitMs('2026-12-01T09:00:00', 'America/Chicago') === Date.parse('2026-12-01T15:00:00Z') && H.visitMs('2026-09-27T17:00:00Z') === Date.parse('2026-09-27T17:00:00Z'));
ck('time: the visit\'s own timezone is used when AxisCare gives one; a nonsense zone falls back to Springfield; nonsense is NaN',
  H.visitMs('2026-09-27T17:00:00', 'America/New_York') === Date.parse('2026-09-27T21:00:00Z') && H.visitMs('2026-09-27T17:00:00', 'Not/AZone') === Date.parse('2026-09-27T22:00:00Z') && Number.isNaN(H.visitMs('')));
ck('rule: changed → reopen; unchanged + covered → ask a person; unchanged + closed another way → hold; can\'t ask → ask a person',
  H.decideHeld(true, { resolved_how: 'covered' }) === 'reopen' && H.decideHeld(false, { resolved_how: 'covered' }) === 'ask_covered'
  && H.decideHeld(false, { resolved_how: 'uncovered' }) === 'hold' && H.decideHeld(null, { resolved_how: 'uncovered' }) === 'ask_unreadable');
const Rs = (s, b) => new Response(JSON.stringify(b), { status: s });
let seen = [];
const one = (status, body) => async (u) => { seen.push(String(u)); return Rs(status, body); };
let r = await H.changedSince(one(200, { results: { visits: [{ id: 'v=77:s=119:d=2026-09-28' }] } }), '16485', 't', '2023-10-01', 's=119:d=2026-09-28', '2026-09-27T02:40:00.123Z');
ck('changedSince: ONE read, that day only, changed since the close (to the second); the same slot under another id counts',
  r.changed === true && seen.length === 1 && seen[0].includes('updatedSinceDate=2026-09-27T02:40:00Z&startDate=2026-09-28&endDate=2026-09-28'), { r, seen });
seen = []; r = await H.changedSince(one(404, { errors: ['No visits found'] }), '16485', 't', 'v', 's=119:d=2026-09-28', '2026-09-27T02:40:00Z');
ck('changedSince: AxisCare\'s 404 "No visits found" = no change', r.changed === false);
r = await H.changedSince(one(200, { results: { visits: [{ id: 's=120:d=2026-09-28' }] } }), '16485', 't', 'v', 's=119:d=2026-09-28', '2026-09-27T02:40:00Z');
ck('changedSince: another shift that day changed, not this one = no change', r.changed === false);
const bad = [await H.changedSince(one(429, {}), '16485', 't', 'v', 's=119:d=2026-09-28', '2026-09-27T02:40:00Z'),
  await H.changedSince(one(500, {}), '16485', 't', 'v', 's=119:d=2026-09-28', '2026-09-27T02:40:00Z'),
  await H.changedSince(async () => { throw new Error('offline'); }, '16485', 't', 'v', 's=119:d=2026-09-28', '2026-09-27T02:40:00Z'),
  await H.changedSince(one(200, {}), '16485', 't', 'v', 's=119', '2026-09-27T02:40:00Z'),
  await H.changedSince(one(200, { results: { visits: [], nextPage: 'https://evil.example.com/x' } }), '16485', 't', 'v', 's=119:d=2026-09-28', '2026-09-27T02:40:00Z')];
ck('changedSince: slow-down, an error, no network and no date all read as "can\'t tell" (null), never as "no change"; a foreign next page is never followed',
  bad.slice(0, 4).every(x => x.changed === null) && bad[4].changed === false, bad);
const item = H.heldItem('ask_covered', { visitId: 's=119:d=2026-09-28', client: 'Joel & Carol Wolverton', startMs: Date.parse('2026-09-27T22:00:00Z'), reason: 'Staffing Change - Caregiver Call Off',
  lastCase: { id: 'cc_1', resolved_at: '2026-09-27T02:40:00Z', resolved_how: 'covered', covered_by: 'Grace Levering', axiscare_assignment: { status: 'failed', detail: 'AxisCare refused' } }, detail: 'no change', owner: 'samantha@mo-care.com', nowIso: '2026-09-27T14:20:00Z' });
ck('item (covered, no caregiver): names the client, the time in Springfield, who was marked covering, the assignment result; high urgency inside 24 hours; says nobody was texted',
  /Joel & Carol Wolverton's Sun, Sep 27, 5:00 PM shift: marked covered by Grace Levering, but AxisCare shows no caregiver/.test(item.title) && /assignment at the time said: failed \(AxisCare refused\)/.test(item.detail)
  && /Confirm with Grace/.test(item.detail) && /Cara has not texted anyone/.test(item.detail) && item.urgency === 'high' && item.owner === 'samantha@mo-care.com' && item.id === 'ops_cw_held_s_119_d_2026_09_28_cc_1', item);
const item2 = H.heldItem('ask_unreadable', { visitId: 's=1:d=2026-10-09', client: 'A B', startMs: Date.parse('2026-10-09T15:00:00Z'), reason: 'Call Off', lastCase: { id: 'x', resolved_at: '2026-10-01T00:00:00Z', resolved_how: 'uncovered' }, detail: 'AxisCare answered 500', owner: '', nowIso: '2026-09-27T14:20:00Z' });
ck('item (can\'t ask): says why and what to check; normal urgency when the shift is days away; hold and reopen raise no item',
  /couldn't \(AxisCare answered 500\)/.test(item2.detail) && item2.urgency === 'normal' && H.heldItem('hold', {}) === null && H.heldItem('reopen', {}) === null, item2);
ck('copy: no em dashes in anything a person reads', ![item.title, item.detail, item2.title, item2.detail].some(t => t.includes('—')));

/* ── the REAL coverage-watch ── */
const src0 = fs.readFileSync(path.join(FNS, 'coverage-watch/index.ts'), 'utf8');
const src = src0.replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace("from '../_shared/events.ts'", "from '" + path.join(FNS, '_shared/events.ts') + "'")
  .replace("from '../_shared/held-shift.ts'", "from '" + path.join(FNS, '_shared/held-shift.ts') + "'");
const tmp = path.join(process.cwd(), '_cw_under_test.ts'); fs.writeFileSync(tmp, src);
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
const verdict = (out, v) => out.unassigned_detail.find(d => d.visit === v)?.verdict;

world(); DB.ops_settings.coverage_watch_7b_live = false;
let out = await run(); const out0 = out, newCases0 = newCases();
ck('switched off (reopen not yet on): behaves exactly as before for held shifts: no new case, no item; the report shows what it WOULD do',
  newCases().every(c => c.axiscare_visit_id === AX[4].id) && DB.ops_items.length === 0 && out.held_checks.reopen_live === false
  && out.held_checks.shifts.find(x => x.visit === AX[0].id).decision === 'reopen' && out.held_checks.shifts.every(x => x.acted === false)
  && verdict(out, AX[0].id) === 'held: changed since the last case closed (reopening is switched off)', out.held_checks);

world(); out = await run();
const again = newCases().find(c => c.axiscare_visit_id === AX[0].id);
ck('REOPEN: the held shift that changed in AxisCare after its case closed gets a fresh call-off case (generation 2), saying why',
  again && again.id.endsWith('_g2') && /^Opened again: the shift changed in AxisCare after the last case closed/.test(again.note) && again.reopened_after === 'cw_a_g1'
  && events.some(e => e.verb === 'coverage_opened' && /opened a call-off case again/.test(e.summary)), { again, ev: events.map(e => e.summary) });
const itemB = DB.ops_items.find(i => i.axiscare_visit_id === AX[1].id);
ck('ASK (covered, no caregiver, unchanged): no case, one high-urgency item for a person naming who was marked covering',
  !newCases().some(c => c.axiscare_visit_id === AX[1].id) && itemB && itemB.urgency === 'high' && /marked covered by Eve Adams, but AxisCare shows no caregiver/.test(itemB.title), itemB);
ck('HOLD (closed uncovered by a person, unchanged): no case, no item, as her rule says',
  !newCases().some(c => c.axiscare_visit_id === AX[2].id) && !DB.ops_items.some(i => i.axiscare_visit_id === AX[2].id) && verdict(out, AX[2].id) === "held: a person closed the last case and the shift hasn't changed since", { v: verdict(out, AX[2].id), i: DB.ops_items.map(i => i.axiscare_visit_id), h: out.held_checks.shifts });
const itemD = DB.ops_items.find(i => i.axiscare_visit_id === AX[3].id);
ck('ASK (AxisCare errored on the check): no case, an item saying Cara couldn\'t confirm; never a silent hold',
  !newCases().some(c => c.axiscare_visit_id === AX[3].id) && itemD && /Cara couldn't confirm it/.test(itemD.title) && /AxisCare answered 500/.test(itemD.detail), itemD);
ck('switched off: the time reading is unchanged from before, and the report lists the shifts it reads differently (the 3-hours-from-now call-off) and that AxisCare sent no offset',
  out0.time_check.fix_live === false && out0.time_check.has_offset === false && out0.time_check.differs.some(d => d.visit === AX[4].id && d.old_reading === 'already started' && d.correct_reading === 'upcoming')
  && !newCases0.some(c => c.axiscare_visit_id === AX[4].id), { t: out0.time_check });
ck('TIME FIX: a call-off 3 hours from now (Springfield wall clock, no offset) opens a case; one that started an hour ago does not',
  newCases().some(c => c.axiscare_visit_id === AX[4].id) && !newCases().some(c => c.axiscare_visit_id === AX[5].id) && verdict(out, AX[5].id) === 'ignored — already started', { v4: verdict(out, AX[4].id), v5: verdict(out, AX[5].id) });
ck('untouched: a shift with an open case, and a shift with no reason, cause no new case and no AxisCare check',
  !newCases().some(c => c.axiscare_visit_id === AX[6].id) && DB.coverage_cases.filter(c => c.axiscare_visit_id === AX[6].id).length === 1 && !newCases().some(c => c.axiscare_visit_id === AX[7].id)
  && !sinceCalls().some(c => c.includes(AX[6].id.slice(-10)) && c.includes('s=140')));
ck('cost: exactly ONE small AxisCare check per held shift (4), none for anything else', sinceCalls().length === 4, sinceCalls());
ck('report: held_checks counts what was done (4 checked, 1 reopened, 2 people asked)', out.held_checks.checked === 4 && out.held_checks.reopened === 1 && out.held_checks.people_asked === 2, out.held_checks);

const itemsBefore = DB.ops_items.length; DB.ops_items.find(i => i.axiscare_visit_id === AX[1].id).status = 'done';
out = await run();
ck('second run: the reopened shift now has an open case, so it is left alone; items are never raised twice, and one a person closed stays closed',
  DB.ops_items.length === itemsBefore && DB.ops_items.find(i => i.axiscare_visit_id === AX[1].id).status === 'done'
  && DB.coverage_cases.filter(c => c.axiscare_visit_id === AX[0].id).length === 2 && out.held_checks.reopened === 0, { n: DB.ops_items.length, h: out.held_checks });

world(); DB.ops_settings.coverage_watch_live = false; out = await run();
ck('the watcher in dry mode writes nothing at all, even with reopening switched on', newCases().length === 0 && DB.ops_items.length === 0, { c: newCases(), i: DB.ops_items });
world(); out = await run('?dry=1');
ck('?dry=1 writes nothing either, and still reports each held decision', newCases().length === 0 && DB.ops_items.length === 0 && out.held_checks.checked === 4, out.held_checks);

console.log('\nCHANGE 7b · HELD SHIFTS · HARNESS\n' + '='.repeat(60));
let ok = true;
for (const [nm, g, note] of res) { ok &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + nm + (note ? '\n   └─ ' + note : '')); }
console.log('='.repeat(60)); console.log(ok ? `ALL ${res.length} CHECKS PASS` : `${res.filter(r => !r[1]).length} FAILED`);
