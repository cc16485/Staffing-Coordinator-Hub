// K3 · call-place under Node: the real function and the real staff check, a stand-in database. node call_place_fn_test.mjs
import fs from 'fs'; import path from 'path';
const DIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'supabase/functions/call-place');
const src = fs.readFileSync(path.join(DIR, 'index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient');
const tmp = path.join(DIR, '_under_test.ts'); fs.writeFileSync(tmp, src);
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? '').slice(0, 400)]);
let handler = null; const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k' };
globalThis.Deno = { env: { get: k => env[k] }, serve: h => { handler = h; } };
const USERS = { good: { id: 'u1', email: 'Kat@CC.test', app_metadata: { hub_access: ['care_coordinator'] } }, caregiver: { id: 'u5', email: 'z@cc.test', app_metadata: { hub_access: ['care_coordinator'] } } };
const DB = { auth_identities: [{ auth_user_id: 'u1', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p1' }, { auth_user_id: 'u5', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p5' }],
  persons: [{ person_id: 'p1', full_name: 'Kat', active: true }, { person_id: 'p5', full_name: 'Cg', active: true }],
  entity_memberships: [{ person_id: 'p1', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p5', entity: 'cc_ihs', active: true, ended_at: null }],
  staff_roles: [{ person_id: 'p1', entity: 'cc_ihs', role: 'care_coordinator' }, { person_id: 'p5', entity: 'cc_ihs', role: 'caregiver' }] };
const RPC = [];
globalThis.__fakeCreateClient = () => ({
  auth: { getUser: async (jwt) => USERS[jwt] ? { data: { user: USERS[jwt] }, error: null } : { data: null, error: { message: 'bad jwt' } } },
  from: (tb) => { const f = []; let single = false; const p = { select() { return p; }, eq(k, v) { f.push(r => String(r[k]) === String(v)); return p; },
      maybeSingle() { single = true; return p; }, then(ok, bad) { const rows = (DB[tb] || []).filter(r => f.every(fn => fn(r))); return Promise.resolve({ data: single ? (rows[0] || null) : rows, error: null }).then(ok, bad); } }; return p; },
  rpc: async (n, a) => { RPC.push({ n, a }); return { data: a.p_decision === 'lead' && a.p_lead === 'NOPE' ? { outcome: 'refused', reason: 'that inquiry is not on file' } : { outcome: 'placed', lines: a.p_ids.length }, error: null }; } });
await import(tmp); fs.unlinkSync(tmp);
const call = async (who, body) => { const r = await handler(new Request('http://x', { method: 'POST', headers: who ? { Authorization: 'Bearer ' + who } : {}, body: JSON.stringify(body) })); return [r.status, await r.json()]; };
let r = await handler(new Request('http://x', { method: 'OPTIONS' })); ck('a browser preflight answers, with CORS', r.status === 200 && r.headers.get('Access-Control-Allow-Origin') === '*');
let [s, b] = await call(null, { call_ids: [1], decision: 'not_ours' }); ck('no sign-in: refused, nothing placed', s === 401 && !RPC.length, [s, b]);
[s, b] = await call('caregiver', { call_ids: [1], decision: 'not_ours' }); ck('a signed-in person without an office role: refused', s === 403 && !RPC.length, [s, b]);
[s, b] = await call('good', { call_ids: [3, 4], decision: 'client', person_id: '11111111-2222-3333-4444-555555555555', axiscare_client_id: '501', lead_id: 'IGNORED', placed_by: 'someone else' });
ck('office staff place a call; who placed it is their sign-in, never the page', s === 200 && b.outcome === 'placed' && RPC[0].a.p_by === 'kat@cc.test' && RPC[0].a.p_lead === null && RPC[0].a.p_axiscare_client === '501', [s, b, RPC[0]]);
[s, b] = await call('good', { call_ids: [5], decision: 'lead', lead_id: 'NOPE' }); ck('a refusal from the door comes back as a refusal', s === 400 && b.outcome === 'refused', [s, b]);
const n = RPC.length; [s, b] = await call('good', { call_ids: [], decision: 'not_ours' }); ck('no call lines: refused before the door', s === 400 && RPC.length === n, b);
[s, b] = await call('good', { call_ids: [1], decision: 'merge' }); ck('an unknown decision: refused before the door', s === 400 && RPC.length === n, b);
[s, b] = await call('good', { call_ids: Array.from({ length: 21 }, (_, i) => i + 1), decision: 'not_ours' }); ck('more than 20 lines at once: refused', s === 400 && RPC.length === n, b);
let pass = 0; for (const [nm, ok, note] of res) { console.log((ok ? 'PASS ' : 'FAIL ') + nm + (ok ? '' : '\n     ' + note)); if (ok) pass++; }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1);
