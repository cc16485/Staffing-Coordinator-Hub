// FIX 4 OF 4 (Samantha, 2026-10-08): the readiness check (profile-check) read skills from the old roster copy, so a skill
// the office recorded today (caregiver_overlay) never reached it. The real function under Node against a stand-in
// database and a fake AxisCare: the overlay wins per skill, Spanish comes from the overlay, the self-test passes.
// No network. node profile_check_overlay_525_test.mjs
import fs from 'fs'; import path from 'path';
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions');
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? '').slice(0, 900)]);
const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'svc', AXISCARE_SITE_NUMBER: '16485', AXISCARE_TOKEN: 't', AXISCARE_API_KEY: 't', AXISCARE_SITE: '16485' };
let handler = null; globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
let APP = {};
globalThis.__fakeCreateClient = () => ({ from: (table) => { const f = []; const b = {
  select() { return b; }, eq(c, v) { f.push([c, v]); return b; }, neq() { return b; }, limit() { return b; }, order() { return b; },
  maybeSingle() { if (table === 'app_data') { const key = (f.find(([c]) => c === 'key') || [])[1]; return Promise.resolve({ data: APP[key] ? { data: APP[key] } : null, error: null }); } return Promise.resolve({ data: null, error: null }); },
  then(ok) { return Promise.resolve({ data: [], error: null }).then(ok); } }; return b; } });
globalThis.fetch = async (u) => { const url = new URL(String(u)); const R = (b) => new Response(JSON.stringify(b), { status: 200 });
  if (url.hostname.endsWith('axiscare.com') && url.pathname.endsWith('/caregivers/9')) return R({ results: { caregiver: { id: 9, firstName: 'Cara', lastName: 'Giver', status: { active: true, label: 'Active' }, gender: 'F', mobilePhone: '417', mailingAddress: { city: 'Springfield', postalCode: '65802' }, classes: [{ label: 'Level 2 - Personal Care' }], personalEmail: 'c@x.y' } } });
  if (url.hostname.endsWith('axiscare.com') && url.pathname.endsWith('/clients/55')) return R({ results: { client: { id: 55, firstName: 'Cli', lastName: 'Ent', classes: [{ label: 'Level 2 - Personal Care' }] } } });
  throw new Error('unexpected ' + u); };
const src = fs.readFileSync(path.join(FN, 'profile-check/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient');
const tmp = path.join(FN, 'profile-check', '_t525.ts'); fs.writeFileSync(tmp, src);
let M; try { M = await import(tmp); } finally { fs.unlinkSync(tmp); }
const tok = 'x.' + Buffer.from(JSON.stringify({ role: 'authenticated' })).toString('base64') + '.y';
const call = async (body) => { const r = await handler(new Request('http://x/profile-check', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify(body) })); return [r.status, await r.json()]; };
const selftest = async () => { const r = await handler(new Request('http://x/profile-check?selftest=1', { method: 'GET' })); return r.json(); };
const seed = (overlay) => { APP = {
  caregivers: [{ axiscare_id: '9', first: 'Cara', last: 'Giver', orient_date: '2026-01-01', alz_date: '2026-01-02', oig_status: 'CLEAR', edl_status: 'Clear', fcsr_status: 'Clear', skills: { transfers_gait_belt: { have: 'no' }, ok_dogs: { have: 'no' } }, spanish_ability: 'basic' }],
  caregiver_overlay: overlay ? [{ id: 'cgov_9', axiscare_id: '9', skills: { transfers_gait_belt: { have: 'yes', evidence: 'observed', by: 'Krystal', at: '2026-10-01' }, hoyer_lift: { have: 'yes' } }, spanish_ability: 'fluent' }] : [],
  caregiver_availability: [{ axiscare_id: '9', updated_at: new Date().toISOString() }],
  leads: [{ id: 'L1', axiscare_client_id: '55', client_first_name: 'Cli', client_last_name: 'Ent', client_attributes: { gait_belt: 'yes', hoyer_lift: 'yes', dogs: 'yes', spanish_speaking: 'yes' }, gender_pref_normalized: true }],
  dnr_log: [], ops_settings: {} }; };
const find = (j, code) => (j.items || []).find((i) => i.code === code);
seed(true);
let [s, j] = await call({ caregiver_eval: { axiscare_id: '9', client_lead_id: 'L1' } });
ck('the check answers for a caregiver and a client', s === 200 && j.entity === 'caregiver' && Array.isArray(j.items), [s, j && j.error]);
ck('a skill the office recorded today (overlay yes) passes, although the old roster copy said no', find(j, 'skill_transfers_gait_belt') && find(j, 'skill_transfers_gait_belt').status === 'pass', find(j, 'skill_transfers_gait_belt'));
ck('a skill recorded only in the overlay is seen', find(j, 'skill_hoyer_lift') && find(j, 'skill_hoyer_lift').status === 'pass', find(j, 'skill_hoyer_lift'));
ck('a roster answer the overlay does not mention still counts (no dogs)', find(j, 'ok_dogs') && find(j, 'ok_dogs').status === 'fail', find(j, 'ok_dogs'));
ck('Spanish comes from the overlay (fluent passes; the roster said basic)', find(j, 'spanish') && find(j, 'spanish').status === 'pass', find(j, 'spanish'));
seed(false);
[s, j] = await call({ caregiver_eval: { axiscare_id: '9', client_lead_id: 'L1' } });
ck('with no overlay the roster copy is used as before', find(j, 'skill_transfers_gait_belt').status === 'fail' && find(j, 'spanish').status === 'fail', [find(j, 'skill_transfers_gait_belt'), find(j, 'spanish')]);
const st = await selftest();
ck('the self-test passes, including the six new overlay cases', Array.isArray(st.results || st) && (st.results || st).every((x) => x.pass) && (st.results || st).some((x) => /overlay skill wins/.test(x.fixture)), (st.results || st).filter((x) => !x.pass));
ck('the function still contains no messaging, no AxisCare writes', !/leadconnectorhq|method: 'POST'|method: 'PATCH'/.test(src));
ck('no em dash in the new lines', !/—/.test(src.slice(src.indexOf('fix 4 of 4 (Samantha'), src.indexOf('export function evalCaregiver'))));
for (const [n, ok, note] of res) console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  ' + note));
console.log(res.filter((x) => x[1]).length + '/' + res.length + ' passed'); process.exit(res.every((x) => x[1]) ? 0 : 1);
