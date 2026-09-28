// Gate 2a · the client-fact function under Node: the real function and the real staff check, a stand-in database.
import fs from 'fs'; import path from 'path'; import { pathToFileURL } from 'url';
const DIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'supabase/functions/client-fact');
const src = fs.readFileSync(path.join(DIR, 'index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient');
const tmp = path.join(DIR, '_under_test.ts'); fs.writeFileSync(tmp, src);
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note).slice(0, 400)]);
let handler = null; const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k' };
globalThis.Deno = { env: { get: k => env[k] }, serve: h => { handler = h; } };
globalThis.fetch = async (u) => { throw new Error('no network in this test: ' + u); };
const USERS = {
  good: { id: 'u1', email: 'Kat@CC.test', app_metadata: { hub_access: ['care_coordinator'] } },
  otherhub: { id: 'u2', email: 'sam@cc.test', app_metadata: { hub_access: ['staffing'] } },
  nolink: { id: 'u3', email: 'x@cc.test', app_metadata: { hub_access: ['care_coordinator'] } },
  inactive: { id: 'u4', email: 'y@cc.test', app_metadata: { hub_access: ['care_coordinator'] } },
  caregiver: { id: 'u5', email: 'z@cc.test', app_metadata: { hub_access: ['care_coordinator'] } },
};
const DB = {
  auth_identities: [{ auth_user_id: 'u1', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p1' }, { auth_user_id: 'u4', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p4' },
                    { auth_user_id: 'u5', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p5' }],
  persons: [{ person_id: 'p1', full_name: 'Kat', active: true }, { person_id: 'p4', full_name: 'Old', active: false }, { person_id: 'p5', full_name: 'Cg', active: true }],
  entity_memberships: [{ person_id: 'p1', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p4', entity: 'cc_ihs', active: true, ended_at: null },
                       { person_id: 'p5', entity: 'cc_ihs', active: true, ended_at: null }],
  staff_roles: [{ person_id: 'p1', entity: 'cc_ihs', role: 'care_coordinator' }, { person_id: 'p5', entity: 'cc_ihs', role: 'caregiver' }],
};
const calls = []; let rpcAnswer = { data: { outcome: 'recorded', fact_id: 'f1' }, error: null };
globalThis.__fakeCreateClient = () => ({
  auth: { getUser: async (jwt) => USERS[jwt] ? { data: { user: USERS[jwt] }, error: null } : { data: null, error: { message: 'bad jwt' } } },
  from: (t) => { const f = []; let single = false; const p = { select() { return p; }, eq(k, v) { f.push(r => String(r[k]) === String(v)); return p; },
      maybeSingle() { single = true; return p; }, insert() { calls.push('WRITE ' + t); return p; }, update() { calls.push('WRITE ' + t); return p; },
      then(ok, bad) { const rows = (DB[t] || []).filter(r => f.every(fn => fn(r))); return Promise.resolve({ data: single ? (rows[0] || null) : rows, error: null }).then(ok, bad); } }; return p; },
  rpc: async (name, args) => { calls.push({ name, args }); return rpcAnswer; },
});
await import(pathToFileURL(tmp).href);
const call = async (who, body, method = 'POST') => {
  const r = await handler(new Request('http://x/client-fact', { method, headers: who ? { Authorization: 'Bearer ' + who, 'Content-Type': 'application/json' } : {}, body: method === 'POST' ? JSON.stringify(body || {}) : undefined }));
  return { status: r.status, body: await r.json().catch(() => null), cors: r.headers.get('access-control-allow-origin') };
};
const EP = '0e6e7a1c-2f3d-4b5a-9c8d-7e6f5a4b3c2d';
const GOOD = { action: 'record', episode_id: EP, kind: 'why_now', layer: 'intake', value: 'Two falls', certainty: 'reported', change_kind: 'first',
  said_by: 'Susan', said_by_relationship: 'daughter', said_how: 'call', said_at: '2026-09-27T15:00:00Z', words: 'she fell twice', recorded_by: 'someone-else@evil.test' };

const pre = await handler(new Request('http://x/client-fact', { method: 'OPTIONS' }));
ck('the browser\'s preflight check is answered, with CORS headers (day one)', pre.status === 200 && pre.headers.get('access-control-allow-origin') === '*');
let r = await call('good', null, 'GET'); ck('anything but POST is refused', r.status === 405);
r = await call(null, GOOD); ck('no sign-in: refused (401), and the door is never called', r.status === 401 && calls.length === 0 && r.cors === '*', r);
r = await call('forged', GOOD); ck('an unreadable or expired sign-in: refused (401)', r.status === 401 && calls.length === 0, r);
r = await call('otherhub', GOOD); ck('a user without Care Coordinator Hub access: refused (403)', r.status === 403 && calls.length === 0, r);
r = await call('nolink', GOOD); ck('a sign-in not linked to a staff record: refused (403)', r.status === 403 && calls.length === 0, r);
r = await call('inactive', GOOD); ck('an inactive staff record: refused (403)', r.status === 403 && calls.length === 0, r);
r = await call('caregiver', GOOD); ck('a staff member without an office role: refused (403)', r.status === 403 && calls.length === 0, r);
r = await call('good', { ...GOOD, action: 'delete' }); ck('an action other than record: refused (400)', r.status === 400 && calls.length === 0);
r = await call('good', { ...GOOD, episode_id: 'nope' }); ck('a missing or malformed Journey id: refused (400)', r.status === 400 && calls.length === 0);
r = await call('good', { ...GOOD, supersedes_fact_id: 'x' }); ck('a malformed "replaces" id: refused (400)', r.status === 400 && calls.length === 0);
r = await call('good', { ...GOOD, said_at: 'yesterday-ish' }); ck('a "when" that isn\'t a date and time: refused (400)', r.status === 400 && calls.length === 0);
r = await call('good', GOOD);
const a = calls[0] && calls[0].args;
ck('office staff: the door is called once, and its answer comes back unchanged', r.status === 200 && r.body.outcome === 'recorded' && calls.length === 1 && calls[0].name === 'client_fact_record', r);
ck('the recorder is the signed-in staff member (lower-cased), never a name sent in the request', a && a.p_recorded_by === 'kat@cc.test', a);
ck('every field reaches the door as sent', a && a.p_episode_id === EP && a.p_kind === 'why_now' && a.p_value === 'Two falls' && a.p_said_by === 'Susan' && a.p_said_at === '2026-09-27T15:00:00.000Z' && a.p_supersedes_fact_id === null, a);
calls.length = 0; rpcAnswer = { data: { outcome: 'refused', reason: 'stale', message: 'someone changed this after you opened it' }, error: null };
r = await call('good', { ...GOOD, change_kind: 'update', supersedes_fact_id: EP });
ck('a refusal from the door (a stale save) comes back as it is, so the screen can say why', r.status === 200 && r.body.reason === 'stale', r);
rpcAnswer = { data: null, error: { message: 'connection lost' } };
r = await call('good', GOOD); ck('if the database fails, the answer says it was not recorded (500)', r.status === 500 && /not recorded/.test(r.body.error), r);
ck('the function never writes a table directly: only the door', !calls.some(c => typeof c === 'string'));
// Gate 3: the read-only "has care begun" answer
calls.length = 0; rpcAnswer = { data: { began: true, on: '2026-09-20', basis: 'AxisCare\'s first clock-in' }, error: null };
r = await call(null, { action: 'care_began', episode_id: EP }); ck('care_began: no sign-in is refused (401)', r.status === 401 && calls.length === 0);
r = await call('caregiver', { action: 'care_began', episode_id: EP }); ck('care_began: a non-office staff member is refused (403)', r.status === 403 && calls.length === 0);
r = await call('good', { action: 'care_began', episode_id: 'x' }); ck('care_began: a malformed Journey id is refused (400)', r.status === 400 && calls.length === 0);
r = await call('good', { action: 'care_began', episode_id: EP });
ck('care_began: office staff get the one rule\'s answer, unchanged', r.status === 200 && r.body.began === true && r.body.basis && calls[0].name === 'care_began_for_episode' && calls[0].args.p_episode_id === EP, r);
rpcAnswer = { data: null, error: { message: 'boom' } };
r = await call('good', { action: 'care_began', episode_id: EP }); ck('care_began: if the check fails, the answer says it could not check (never a guess)', r.status === 200 && r.body.began === null && r.body.reason === 'could_not_check', r);
// Gate 4a: a person on the Journey
calls.length = 0; rpcAnswer = { data: { outcome: 'recorded', person_key: EP, row_id: EP }, error: null };
const P = { action: 'record_person', episode_id: EP, name: 'Tom Miller', relationship: 'son', roles: ['emergency', 7, 'billing'], phone: '417-555-0100',
  permission: 'yes', permission_asked_by: 'Kat', permission_asked_at: '2026-09-28T15:00:00Z', change_kind: 'first', recorded_by: 'evil@x.test' };
r = await call(null, P); ck('record_person: no sign-in is refused (401)', r.status === 401 && calls.length === 0);
r = await call('caregiver', P); ck('record_person: a non-office staff member is refused (403)', r.status === 403 && calls.length === 0);
r = await call('good', { ...P, person_key: 'nope' }); ck('record_person: a malformed person id is refused (400)', r.status === 400 && calls.length === 0);
r = await call('good', P); const pa = calls[0] && calls[0].args;
ck('record_person: office staff reach the people door once; the recorder is the sign-in, never the request', r.status === 200 && calls[0].name === 'people_on_journey_record' && pa.p_recorded_by === 'kat@cc.test', pa);
ck('record_person: roles pass through as a list of words (anything else dropped), details as sent', pa && JSON.stringify(pa.p_roles) === '["emergency","billing"]' && pa.p_name === 'Tom Miller' && pa.p_is_caller === false && pa.p_permission_asked_at === '2026-09-28T15:00:00.000Z', pa);
fs.unlinkSync(tmp);
for (const [n, ok, note] of res) console.log((ok ? 'PASS' : 'FAIL') + ' · ' + n + (ok ? '' : '  ::  ' + note));
console.log(res.filter(x => x[1]).length + '/' + res.length);
