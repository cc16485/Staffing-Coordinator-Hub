// C2b · axiscare-note under Node: the real function and the real staff check, a stand-in database and a fake AxisCare.
import fs from 'fs'; import path from 'path';
const DIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'supabase/functions/axiscare-note');
const src = fs.readFileSync(path.join(DIR, 'index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient');
const tmp = path.join(DIR, '_under_test.ts'); fs.writeFileSync(tmp, src);
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? '').slice(0, 400)]);
let handler = null; const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485' };
globalThis.Deno = { env: { get: k => env[k] }, serve: h => { handler = h; } };
const USERS = { good: { id: 'u1', email: 'kat@cc.test', app_metadata: { hub_access: ['care_coordinator'] } }, caregiver: { id: 'u5', email: 'z@cc.test', app_metadata: { hub_access: ['care_coordinator'] } } };
const DB = { auth_identities: [{ auth_user_id: 'u1', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p1' }, { auth_user_id: 'u5', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p5' }],
  persons: [{ person_id: 'p1', full_name: 'Kat', active: true }, { person_id: 'p5', full_name: 'Cg', active: true }],
  entity_memberships: [{ person_id: 'p1', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p5', entity: 'cc_ihs', active: true, ended_at: null }],
  staff_roles: [{ person_id: 'p1', entity: 'cc_ihs', role: 'care_coordinator' }, { person_id: 'p5', entity: 'cc_ihs', role: 'caregiver' }] };
const LOG = [];
globalThis.__fakeCreateClient = () => ({
  auth: { getUser: async (jwt) => USERS[jwt] ? { data: { user: USERS[jwt] }, error: null } : { data: null, error: { message: 'bad jwt' } } },
  from: (tb) => { const f = []; let single = false; const p = { select() { return p; }, eq(k, v) { f.push(r => String(r[k]) === String(v)); return p; },
      maybeSingle() { single = true; return p; }, then(ok, bad) { const rows = (DB[tb] || []).filter(r => f.every(fn => fn(r))); return Promise.resolve({ data: single ? (rows[0] || null) : rows, error: null }).then(ok, bad); } }; return p; },
  rpc: async (n, a) => { LOG.push({ n, a }); return { data: { outcome: 'recorded', id: LOG.length }, error: null }; } });
const AX = { posts: [], cfg: {} };
globalThis.fetch = async (u, o = {}) => { const url = new URL(String(u)), m = (o.method || 'GET').toUpperCase(); let x;
  const R = (s, b) => new Response(JSON.stringify(b), { status: s });
  if ((x = /^\/api\/caregivers\/(\d+)$/.exec(url.pathname)) && m === 'GET') return x[1] === '1234' ? R(200, { results: { caregiver: { id: 1234, firstName: 'Jane', lastName: 'Doe' } } }) : R(404, {});
  if ((x = /^\/api\/notes\/(client|caregiver)\/(\d+)$/.exec(url.pathname)) && m === 'POST') { if (AX.cfg.forbid) return R(403, { errors: ['forbidden'] }); AX.posts.push({ to: x[1], id: x[2], body: JSON.parse(o.body) }); return R(200, { results: { id: 9 } }); }
  throw new Error('unexpected ' + m + ' ' + url); };
await import(tmp); fs.unlinkSync(tmp);
const call = async (who, body) => { const r = await handler(new Request('http://x', { method: 'POST', headers: who ? { Authorization: 'Bearer ' + who } : {}, body: JSON.stringify(body) })); return [r.status, await r.json()]; };
let r = await handler(new Request('http://x', { method: 'OPTIONS' })); ck('a browser preflight answers, with CORS', r.status === 200 && r.headers.get('Access-Control-Allow-Origin') === '*');
let [s, b] = await call(null, { action: 'client_note', axiscare_client_id: '501', note: 'x' }); ck('no sign-in: refused, nothing sent', s === 401 && AX.posts.length === 0, [s, b]);
[s, b] = await call('caregiver', { action: 'client_note', axiscare_client_id: '501', note: 'x' }); ck('a signed-in person without an office role: refused, nothing sent', s === 403 && AX.posts.length === 0, [s, b]);
[s, b] = await call('good', { action: 'client_note', axiscare_client_id: '501', note: 'Level 3; more help with bathing', kind: 'care_plan_note' });
ck('a care plan review note goes to that client in AxisCare, marked important', s === 200 && b.outcome === 'sent' && AX.posts[0].to === 'client' && AX.posts[0].id === '501' && AX.posts[0].body.important === true, [b, AX.posts]);
ck('…and is recorded: who, which client, the kind, the length; never the text', LOG[0] && LOG[0].a.p_kind === 'care_plan_note' && LOG[0].a.p_client === '501' && LOG[0].a.p_by === 'kat@cc.test' && LOG[0].a.p_outcome === 'sent'
   && /31 characters/.test(LOG[0].a.p_summary) && !JSON.stringify(LOG[0].a).includes('bathing'), LOG[0]);
[s, b] = await call('good', { action: 'caregiver_note', caregiver_name: 'Jane Doe', note: 'coaching' });
ck('a caregiver note by NAME is refused; only the AxisCare number is accepted', s === 400 && /never a name/.test(b.error), b);
[s, b] = await call('good', { action: 'caregiver_note', axiscare_caregiver_id: '1234', note: 'Friendly coaching' });
ck('a caregiver note by AxisCare number is sent, and the answer says who it went to', b.outcome === 'sent' && b.caregiver.name === 'Jane Doe' && AX.posts[1].to === 'caregiver' && AX.posts[1].id === '1234', [b, AX.posts[1]]);
const before = AX.posts.length; [s, b] = await call('good', { action: 'caregiver_note', axiscare_caregiver_id: '9999', note: 'x' });
ck('a caregiver number AxisCare doesn\'t know: refused before any note is written, and recorded as refused', b.outcome === 'no_such_caregiver' && AX.posts.length === before && LOG[LOG.length - 1].a.p_outcome === 'refused', [b, LOG[LOG.length - 1]]);
AX.cfg.forbid = true; [s, b] = await call('good', { action: 'client_note', axiscare_client_id: '501', note: 'x' }); AX.cfg.forbid = false;
ck('AxisCare refusing (403) is shown and recorded as refused, with the reason', b.outcome === 'refused' && /may not write notes/.test(b.detail) && LOG[LOG.length - 1].a.p_outcome === 'refused' && /may not/.test(LOG[LOG.length - 1].a.p_detail), [b, LOG[LOG.length - 1]]);
[s, b] = await call('good', { action: 'client_note', axiscare_client_id: 'Ruth', note: 'x' }); ck('a client that is not an AxisCare number: refused', s === 400, b);
[s, b] = await call('good', { action: 'client_note', axiscare_client_id: '501', note: ' ' }); ck('an empty note: refused', s === 400, b);
[s, b] = await call('good', { action: 'create_client', lead: {} }); ck('it cannot create clients or do anything else', s === 400 && /client_note/.test(b.error), b);
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '\n     ' + note)); if (ok) pass++; }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1);
