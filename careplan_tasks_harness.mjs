// Change 5 · careplan-tasks under Node: real function code, fake database, fake AxisCare (catalog + client ADLs per the spec).
// node careplan_tasks_harness.mjs supabase/functions/careplan-tasks/index.ts
import fs from 'fs'; import path from 'path';
const FN = process.argv[2];
const src = fs.readFileSync(FN, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient');
const tmp = path.join(process.cwd(), '_careplan_tasks_under_test.ts'); fs.writeFileSync(tmp, src);
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note).slice(0, 900)]);
let handler = null; const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485' };
globalThis.Deno = { env: { get: k => env[k] }, serve: h => { handler = h; } };
const T = (o) => Object.assign({ adl_id: 1, name: 'Bathing', days: ['M', 'W', 'F'], require: 1, when: 1, instructions: 'Shower chair; she prefers mornings' }, o || {});
let DB, AX, calls, cfg;
const reset = (tasks) => {
  DB = { app_data: { care_plans: [{ id: 'cp1', assessment_id: 'as1', axiscare_tasks: tasks ?? [T(), T({ adl_id: 2, name: 'Dressing', days: ['M', 'T', 'W', 'R', 'F'], when: 0, instructions: '' }), T({ adl_id: 3, name: 'Laundry', days: ['S'], require: 2, when: 3, instructions: 'Wash and fold' })] }],
    care_assessments: [{ id: 'as1', axiscare_client_id: '501' }] }, client_status_current: [{ axiscare_client_id: '501', label: 'Active' }] };
  AX = { catalog: [{ id: 1, name: 'Bathing', adlKey: 'bathing', active: true }, { id: 2, name: 'Dressing', adlKey: 'dressing', active: true }, { id: 3, name: 'Laundry', adlKey: 'laundry', active: true },
      { id: 4, name: 'Client Errands', adlKey: 'errands', active: true }, { id: 9, name: 'Old Task', adlKey: 'old', active: false }],
    client: { '501': [{ id: 70, key: 'dressing', name: 'Dressing', instructions: 'Button shirts', events: [{ require: 1, recur: 'M', when: 0 }] },
                      { id: 71, key: 'errands', name: 'Client Errands', instructions: null, events: [{ require: 2, recur: 'T', when: 0 }] }] }, next: 100, notes: [] };
  calls = []; cfg = {};
};
reset();
const R = (s, b) => new Response(JSON.stringify(b), { status: s });
globalThis.fetch = async (u, o = {}) => {
  const url = new URL(String(u)), m = (o.method || 'GET').toUpperCase(), body = o.body ? JSON.parse(o.body) : undefined;
  calls.push([m, url.pathname, body]);
  if (m === 'GET' && url.pathname === '/api/adls') return R(200, { results: { data: AX.catalog.filter(a => url.searchParams.get('active') !== 'true' || a.active), nextPage: null } });
  let x;
  if ((x = /^\/api\/clients\/(\d+)\/adls$/.exec(url.pathname))) {
    const list = AX.client[x[1]] ||= [];
    if (m === 'GET') return R(200, { results: { data: list, nextPage: null } });
    if (m === 'POST') {
      if (cfg.forbid) return R(403, { errors: ["You don't have permission"] });
      if (!body.id || !Array.isArray(body.events) || !body.events.length) return R(400, { errors: ['id and at least one event are required'] });
      const c = AX.catalog.find(a => a.id === body.id);
      if (body.events.some(e => e.require === 2 && e.when !== 0)) return R(400, { errors: ['as needed must be any time'] });
      list.push({ id: AX.next++, key: c.adlKey, name: c.name, instructions: body.instructions ?? null, events: body.events }); return R(201, { results: {} });
    }
  }
  if ((x = /^\/api\/clients\/(\d+)\/adls\/(\d+)$/.exec(url.pathname))) {
    const list = AX.client[x[1]]; const i = list.findIndex(a => String(a.id) === x[2]); if (i < 0) return R(404, {});
    if (m === 'PATCH') { Object.assign(list[i], body); return R(200, { results: {} }); }
    if (m === 'DELETE') { list.splice(i, 1); return new Response(null, { status: 204 }); }
  }
  if ((x = /^\/api\/notes\/client\/(\d+)$/.exec(url.pathname)) && m === 'POST') { AX.notes.push(body.note); return R(200, { results: {} }); }
  throw new Error('unexpected ' + m + ' ' + url);
};
globalThis.__fakeCreateClient = () => ({ from: (t) => { const f = []; let lim = null; const p = { select() { return p; }, eq(k, v) { f.push(r => String(r[k]) === String(v)); return p; }, limit(n) { lim = n; return p; },
  maybeSingle() { const rows = Object.entries(DB.app_data).map(([key, data]) => ({ key, data })).filter(r => f.every(g => g(r))); return Promise.resolve({ data: rows[0] || null, error: null }); },
  then(ok, bad) { let rows = (DB[t] || []).filter(r => f.every(g => g(r))); if (lim) rows = rows.slice(0, lim); return Promise.resolve({ data: rows, error: null }).then(ok, bad); } }; return p; } });
const M = await import(tmp); fs.unlinkSync(tmp);
const tok = (c) => 'Bearer x.' + Buffer.from(JSON.stringify(c)).toString('base64url') + '.y';
const KAT = tok({ role: 'authenticated', email: 'kat@cc.test' }), SVC = tok({ role: 'service_role' }), ANON = tok({ role: 'anon' });
const call = async (auth, body) => { const r = await handler(new Request('http://x', { method: 'POST', headers: { Authorization: auth }, body: JSON.stringify(body) })); return [r.status, await r.json()]; };
const writes = () => calls.filter(c => c[0] !== 'GET');

let r = await handler(new Request('http://x', { method: 'OPTIONS' }));
ck('CORS preflight answered from day one', r.status === 200 && r.headers.get('Access-Control-Allow-Origin') === '*');
let [st] = await call(ANON, { action: 'catalog' }); let [st2] = await call(KAT, { action: 'permission_check' });
ck('access: a signed-in person for catalog/preview/push; the permission check is for the owner script only', st === 401 && st2 === 403);
let [s0, b] = await call(KAT, { action: 'catalog' });
ck('catalog: AxisCare\'s own ACTIVE task list, alphabetical', b.catalog.map(x => x.name).join() === 'Bathing,Client Errands,Dressing,Laundry', b);
ck('rules: "as needed" is always "any time"; days sorted Sunday first; no days is refused',
  M.cleanTask(T({ require: 2, when: 3 })).task.when === 0 && M.cleanTask(T({ days: ['F', 'N', 'M'] })).task.days.join('') === 'NMF' && /at least one day/.test(M.cleanTask(T({ days: [] })).error));
ck('rules: one event per chosen day with the same "always / as needed" and time', JSON.stringify(M.events(M.cleanTask(T()).task)) === JSON.stringify([{ require: 1, recur: 'M', when: 1 }, { require: 1, recur: 'W', when: 1 }, { require: 1, recur: 'F', when: 1 }]));
[s0, b] = await call(KAT, { action: 'preview', plan_id: 'cp1' });
const st_ = n => b.tasks.find(t => t.name === n).state;
ck('preview: side by side; Bathing and Laundry are new, Dressing differs from AxisCare\'s version; Client Errands (AxisCare only) is listed; reads only',
  st_('Bathing') === 'new' && st_('Laundry') === 'new' && st_('Dressing') === 'different' && b.tasks.find(t => t.name === 'Dressing').axiscare.instructions === 'Button shirts'
  && b.others.length === 1 && b.others[0].name === 'Client Errands' && writes().length === 0, b);
[s0, b] = await call(KAT, { action: 'push', plan_id: 'cp1', note_text: 'CARE PLAN — Ruth' });
const cl = AX.client['501'];
ck('push: the note goes on the client; new tasks are ADDED with instructions and one event per day', AX.notes[0] === 'CARE PLAN — Ruth'
  && cl.some(a => a.name === 'Bathing' && a.instructions === 'Shower chair; she prefers mornings' && a.events.length === 3 && a.events[0].when === 1)
  && cl.some(a => a.name === 'Laundry' && a.events[0].require === 2 && a.events[0].when === 0), cl);
ck('push: a task AxisCare already has, differently, is LEFT ALONE without "update"; the AxisCare-only task is NOT removed',
  cl.find(a => a.name === 'Dressing').instructions === 'Button shirts' && cl.some(a => a.name === 'Client Errands') && !writes().some(c => c[0] === 'PATCH' || c[0] === 'DELETE'), cl);
ck('push: read back; a task the coordinator chose to leave as AxisCare has it still counts as confirmed',
  b.record.readback.every(x => x.in_axiscare) && b.all_confirmed === true && b.record.by === 'kat@cc.test', b);
reset();
[s0, b] = await call(KAT, { action: 'push', plan_id: 'cp1', update: [2], remove: ['71'] });
ck('push with "update" on Dressing and remove on Client Errands: exactly those change', AX.client['501'].find(a => a.name === 'Dressing').instructions === null
  && AX.client['501'].find(a => a.name === 'Dressing').events.length === 5 && !AX.client['501'].some(a => a.name === 'Client Errands') && b.all_confirmed === true, { cl: AX.client['501'], b });
ck('push without note text sends no note', AX.notes.length === 0);
reset([T({ adl_id: 9, name: 'Old Task' })]);
[s0, b] = await call(KAT, { action: 'push', plan_id: 'cp1' });
ck('a task no longer active in AxisCare\'s list is refused before sending, with a plain reason', b.outcome === 'partly_pushed' && /no longer an active task/.test(b.record.steps[0].detail) && !writes().some(c => c[0] === 'POST'), b);
reset([T({ days: [] })]);
[s0, b] = await call(KAT, { action: 'push', plan_id: 'cp1' });
ck('a task with no days blocks the push until fixed; nothing is sent', b.outcome === 'fix_tasks' && writes().length === 0, b);
reset(); cfg.forbid = true;
[s0, b] = await call(KAT, { action: 'push', plan_id: 'cp1' });
ck('no permission (403): each added task says so; the push is not "all confirmed"', b.all_confirmed === false && b.record.steps.filter(x => x.action === 'added').every(x => /may not change care tasks/.test(x.detail)), b);
reset(); DB.app_data.care_assessments[0].axiscare_client_id = '';
[s0, b] = await call(KAT, { action: 'push', plan_id: 'cp1' });
ck('no AxisCare client id on the assessment: says so; nothing sent', b.outcome === 'no_axiscare_id' && writes().length === 0, b);
reset();
[s0, b] = await call(SVC, { action: 'permission_check' });
ck('permission check: an empty task request on an Active client is refused as invalid, proving permission; nothing created', b.ok === true && b.status === 400 && AX.client['501'].length === 2, b);
reset(); cfg.forbid = true; [s0, b] = await call(SVC, { action: 'permission_check' });
ck('permission check: "not allowed" is reported as no permission', b.ok === false && b.status === 403, b);

let pass = 0;
for (const [name, ok, note] of res) { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n     ' + note)); if (ok) pass++; }
console.log(`\n${pass}/${res.length} passed`);
process.exit(pass === res.length ? 0 : 1);
