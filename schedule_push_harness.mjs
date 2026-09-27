// Change 4 · schedule-push under Node: real function code, fake database, fake AxisCare (one record per day,
// caregiver by name, inactive clients hidden). node schedule_push_harness.mjs supabase/functions/schedule-push/index.ts
import fs from 'fs'; import path from 'path';
const FN = process.argv[2];
const src = fs.readFileSync(FN, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient');
const tmp = path.join(process.cwd(), '_schedule_push_under_test.ts'); fs.writeFileSync(tmp, src);
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note).slice(0, 900)]);
let handler = null; const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485' };
globalThis.Deno = { env: { get: k => env[k] }, serve: h => { handler = h; } };
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
const D = k => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };
const plan = (o) => Object.assign({ id: 'tb1', client: 'Ruth Jones', status: 'building', days: ['mon', 'wed', 'fri'],
  slots: [{ k: 'am', label: 'Morning', start: '09:00', end: '13:00' }, { k: 'pm', label: 'Evening', start: '17:00', end: '21:00' }],
  cells: { 'mon|am': { name: 'Jane Doe', status: 'yes', cg_ax_id: '77' }, 'wed|am': { name: 'Jane Doe', status: 'yes' }, 'fri|am': { name: 'Jane Doe', status: 'yes' },
           'mon|pm': { name: 'Bo Smith', status: 'yes' }, 'wed|pm': { name: 'Bo Smith', status: 'yes' }, 'fri|pm': { name: 'Al Twin', status: 'yes' } } }, o || {});
let DB, AX, calls, cfg;
const reset = (p) => {
  DB = { app_data: { staffing_plans: [p || plan()] }, team_build_link_current: [{ plan_id: 'tb1', episode_id: 'E1' }], journey_episode: [{ episode_id: 'E1', person_id: 'P1' }],
    person_source_id: [{ person_id: 'P1', source_id: '501', system: 'axiscare', entity_type: 'client' }], person_identity: [{ id: 'P1', display_name: 'Ruth Jones' }],
    start_contract_current: [{ episode_id: 'E1', target_date: D(7) }] };
  AX = { caregivers: [{ id: 77, firstName: 'Jane', lastName: 'Doe', status: { active: true } }, { id: 88, firstName: 'Bo', lastName: 'Smith', status: { active: true } },
      { id: 91, firstName: 'Al', lastName: 'Twin', status: { active: true } }, { id: 92, firstName: 'Al', lastName: 'Twin', status: { active: true } },
      { id: 93, firstName: 'Old', lastName: 'Timer', status: { active: false } }],
    visits: [{ client: { id: 501 }, service: { code: 'PC-PRIV', description: 'Personal Care' } }, { client: { id: 600 }, service: { code: 'S5130', description: 'Homemaker' } },
      { client: { id: 601 }, service: { code: 'S5130', description: 'Homemaker' } }],
    schedules: [], next: 1000, inactive: new Set(['290']) };
  calls = []; cfg = {};
};
reset();
const R = (s, b) => new Response(JSON.stringify(b), { status: s });
globalThis.fetch = async (u, o = {}) => {
  const url = new URL(String(u)), m = (o.method || 'GET').toUpperCase(), body = o.body ? JSON.parse(o.body) : undefined, q = url.searchParams;
  calls.push([m, url.pathname + url.search, body]);
  if (m === 'GET' && url.pathname === '/api/caregivers') return R(200, { results: { caregivers: AX.caregivers } });
  if (m === 'GET' && url.pathname === '/api/visits') { const c = q.get('clientIds'); const v = AX.visits.filter(x => !c || String(x.client.id) === c); return v.length ? R(200, { results: { visits: v } }) : R(404, {}); }
  if (m === 'GET' && url.pathname === '/api/schedules') { const c = q.get('clientIds'); const v = AX.schedules.filter(x => x.clientId === c && !x.ended && !AX.inactive.has(c)); return v.length ? R(200, { results: { schedules: v } }) : R(404, {}); }
  if (m === 'POST' && url.pathname === '/api/schedules') {
    if (cfg.forbid) return R(403, { errors: ['forbidden'] });
    if (!body.days || !body.startDate || !body.startTime) return R(400, { errors: ['days, startDate and startTime are required'] });
    if (cfg.badService && body.serviceCode === cfg.badService) return R(400, { errors: ['Service not available for this client'] });
    if (body.endTime <= body.startTime) return R(400, { errors: ['endTime must be after startTime'] });
    const cg = AX.caregivers.find(x => x.id === body.caregiverId);
    const out = body.days.map(day => { const rec = { scheduleId: AX.next++, clientId: String(body.clientId), day, startTime: body.startTime, endTime: body.endTime, startDate: body.startDate,
      caregiver: cg ? { firstName: cg.firstName, lastName: cg.lastName, externalId: 0 } : null, service: { code: body.serviceCode } }; AX.schedules.push(rec); return rec; });
    return R(201, { schedules: out });
  }
  let x;
  if (m === 'DELETE' && (x = /^\/api\/schedules\/(\d+)$/.exec(url.pathname))) { const s = AX.schedules.find(z => String(z.scheduleId) === x[1]); if (!s) return R(404, {}); s.ended = q.get('effectiveDate'); return new Response(null, { status: 204 }); }
  throw new Error('unexpected ' + m + ' ' + url);
};
globalThis.__fakeCreateClient = () => ({ from: (t) => { const f = []; const p = { select() { return p; }, eq(k, v) { f.push(r => String(r[k]) === String(v)); return p; },
  maybeSingle() { let rows = t === 'app_data' ? Object.entries(DB.app_data).map(([key, data]) => ({ key, data })) : (DB[t] || []); rows = rows.filter(r => f.every(g => g(r)));
    return Promise.resolve({ data: rows[0] || null, error: null }); } }; return p; } });
const M = await import(tmp); fs.unlinkSync(tmp);
const tok = (c) => 'Bearer x.' + Buffer.from(JSON.stringify(c)).toString('base64url') + '.y';
const KAT = tok({ role: 'authenticated', email: 'kat@cc.test' }), SVC = tok({ role: 'service_role' }), ANON = tok({ role: 'anon' });
const call = async (auth, body) => { const r = await handler(new Request('http://x', { method: 'POST', headers: { Authorization: auth }, body: JSON.stringify(body) })); return [r.status, await r.json()]; };
const writes = () => calls.filter(c => c[0] !== 'GET');

let r = await handler(new Request('http://x', { method: 'OPTIONS' }));
ck('CORS preflight answered from day one', r.status === 200 && r.headers.get('Access-Control-Allow-Origin') === '*');
let [st] = await call(ANON, { action: 'preview', plan_id: 'tb1' }); let [st2] = await call(KAT, { action: 'permission_check' });
ck('access: a signed-in person for preview/create/undo; the permission check is for the owner script only', st === 401 && st2 === 403);
let [s0, b] = await call(KAT, { action: 'preview', plan_id: 'tb1' });
const jane = b.schedules.find(x => x.caregiver === 'Jane Doe'), bo = b.schedules.find(x => x.caregiver === 'Bo Smith');
ck('preview: one schedule per caregiver and shift, days grouped (Jane Mon/Wed/Fri mornings, Bo Mon/Wed evenings)',
  b.schedules.length === 2 && jane.days.join() === 'Monday,Wednesday,Friday' && jane.start === '09:00' && jane.end === '13:00' && jane.caregiver_id === '77'
  && bo.days.join() === 'Monday,Wednesday' && bo.caregiver_id === '88', b.schedules);
ck('preview: a name that matches two AxisCare caregivers is blocked, never guessed', b.blocked.length === 1 && b.blocked[0].name === 'Al Twin' && /2 caregivers/.test(b.blocked[0].why), b.blocked);
ck('preview: the client comes from the plan\'s Journey; start date defaults to the Start Contract target; reads only',
  b.client.axiscare_client_id === '501' && b.start_default === D(7) && !b.problems.length && writes().length === 0, b);
ck('preview: services in use, the client\'s own first', b.services[0].code === 'PC-PRIV' && b.services[0].client === true && b.services.some(x => x.code === 'S5130'), b.services);
ck('grouping: a cell\'s stored AxisCare id wins over the name', M.groupSchedules(plan({ cells: { 'mon|am': { name: 'Janie', status: 'yes', cg_ax_id: '77' } } }), new Map()).schedules[0].caregiver_id === '77');
ck('grouping: unconfirmed and declined cells are never sent', M.groupSchedules(plan({ cells: { 'mon|am': { name: 'Jane Doe', status: 'asked', cg_ax_id: '77' }, 'wed|am': { name: 'Jane Doe', status: 'no', cg_ax_id: '77' } } }), new Map()).schedules.length === 0);

[s0, b] = await call(KAT, { action: 'create', plan_id: 'tb1', start_date: D(7) });
ck('create: refused without a service (nothing sent)', b.outcome === 'service_required' && writes().length === 0, b);
[s0, b] = await call(KAT, { action: 'create', plan_id: 'tb1', start_date: D(-1), service_code: 'PC-PRIV' });
ck('create: refused with a start date in the past', b.outcome === 'start_date_required' && writes().length === 0, b);
[s0, b] = await call(KAT, { action: 'create', plan_id: 'tb1', start_date: D(7), service_code: 'PC-PRIV' });
const posts = writes().filter(c => c[0] === 'POST');
ck('create: each schedule is created on its own with client, days, start date, times, service, caregiver and weekly frequency',
  b.outcome === 'created' && posts.length === 2 && JSON.stringify(posts[0][2]) === JSON.stringify({ clientId: 501, days: ['Monday', 'Wednesday', 'Friday'], startDate: D(7), startTime: '09:00', endTime: '13:00', serviceCode: 'PC-PRIV', caregiverId: 77, frequency: 1 }), posts);
ck('create: AxisCare is read back and each schedule confirmed, with its ids kept for undo',
  b.record.confirmed.every(c => c.in_axiscare) && b.record.created[0].schedule_ids.length === 3 && b.record.by === 'kat@cc.test', b.record);
DB.app_data.staffing_plans[0].axiscare_push = b.record;
[s0, b] = await call(KAT, { action: 'create', plan_id: 'tb1', start_date: D(7), service_code: 'PC-PRIV' });
ck('a second send of the same plan is refused (double click, second person)', b.outcome === 'already_pushed' && writes().filter(c => c[0] === 'POST').length === 2, b);
const n1 = AX.schedules.length;
[s0, b] = await call(KAT, { action: 'create', plan_id: 'tb1', start_date: D(7), service_code: 'PC-PRIV', again: true });
ck('sent again deliberately: identical schedules already in AxisCare are skipped, never duplicated', b.outcome === 'created' && b.record.skipped.length === 2 && AX.schedules.length === n1, b.record);
const ids = DB.app_data.staffing_plans[0].axiscare_push.created.flatMap(c => c.schedule_ids);
[s0, b] = await call(KAT, { action: 'undo', plan_id: 'tb1', schedule_ids: ['4242'] });
ck('undo: refuses a schedule this plan did not create', b.outcome === 'not_this_plans', b);
[s0, b] = await call(KAT, { action: 'undo', plan_id: 'tb1', schedule_ids: ids });
ck('undo (same day): ends every schedule the plan created from its start date, so no visits remain', b.outcome === 'removed' && b.effective === D(7) && AX.schedules.filter(s => ids.includes(String(s.scheduleId))).every(s => s.ended === D(7)), b);
DB.app_data.staffing_plans[0].axiscare_push.at = new Date(Date.now() - 2 * 86400000).toISOString();
[s0, b] = await call(KAT, { action: 'undo', plan_id: 'tb1', schedule_ids: ids });
ck('undo: not offered after the day of creation', b.outcome === 'too_late', b);

reset(); cfg.badService = 'S5130';
[s0, b] = await call(KAT, { action: 'create', plan_id: 'tb1', start_date: D(7), service_code: 'S5130' });
ck('a service not set up for the client (billing first): AxisCare\'s refusal is shown for each schedule; nothing created', b.outcome === 'none_created' && b.record.refused.length === 2 && /not available/.test(b.record.refused[0].detail), b);
reset(plan({ slots: [{ k: 'on', label: 'Overnight', start: '22:00', end: '06:00' }, { k: 'am', label: 'Morning', start: '09:00', end: '13:00' }],
  cells: { 'mon|on': { name: 'Bo Smith', status: 'yes' }, 'mon|am': { name: 'Jane Doe', status: 'yes' } } }));
[s0, b] = await call(KAT, { action: 'create', plan_id: 'tb1', start_date: D(7), service_code: 'PC-PRIV' });
ck('an overnight shift AxisCare refuses is reported (enter by hand) and does not stop the others', b.outcome === 'partly_created' && b.record.refused[0].overnight === true && b.record.created.length === 1, b.record);
reset(); cfg.forbid = true;
[s0, b] = await call(KAT, { action: 'create', plan_id: 'tb1', start_date: D(7), service_code: 'PC-PRIV' });
ck('no permission (403): every schedule says so; nothing created', b.outcome === 'none_created' && /may not create schedules/.test(b.record.refused[0].detail), b);
reset(); DB.team_build_link_current = [];
[s0, b] = await call(KAT, { action: 'create', plan_id: 'tb1', start_date: D(7), service_code: 'PC-PRIV' });
ck('a plan with no Journey link is blocked and says how to fix it', b.outcome === 'blocked' && /Link to a Journey/.test(b.problems[0]) && writes().length === 0, b);
reset(); DB.person_source_id = [];
[s0, b] = await call(KAT, { action: 'preview', plan_id: 'tb1' });
ck('a person with no AxisCare client yet: the preview says so', /no AxisCare client yet/.test(b.problems[0]), b.problems);
reset();
[s0, b] = await call(SVC, { action: 'permission_check' });
ck('permission check: a deliberately incomplete request is refused as incomplete, proving permission without creating anything', b.ok === true && b.status === 400 && AX.schedules.length === 0, b);
reset(); cfg.forbid = true; [s0, b] = await call(SVC, { action: 'permission_check' });
ck('permission check: a "not allowed" refusal is reported as no permission', b.ok === false && b.status === 403, b);

let pass = 0;
for (const [name, ok, note] of res) { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n     ' + note)); if (ok) pass++; }
console.log(`\n${pass}/${res.length} passed`);
process.exit(pass === res.length ? 0 : 1);
