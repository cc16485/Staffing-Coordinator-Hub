// SLICE 0 (Samantha approved 2026-10-08): the Hub door's onboarding-path answer. The real outreach-check under Node
// against a stand-in database, no network: blank switch date = old for everyone; a set date = new on and after it,
// old before; the Chicago date decides; nothing is written. node outreach_path_531_test.mjs
import fs from 'fs'; import path from 'path';
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions');
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? '').slice(0, 400)]);
const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'svc', OUTREACH_SECRET: 'x'.repeat(40) };
let handler = null; globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
let OPS = {}; let writes = 0;
globalThis.__fakeCreateClient = () => ({
  auth: { getUser: async (jwt) => jwt === 'staff' ? { data: { user: { id: 'u1', email: 'krystal@mo-care.com', app_metadata: {} } } } : { data: null, error: { message: 'bad' } } },
  from: (table) => { const f = []; const b = {
    select() { return b; }, eq(c, v) { f.push([c, v]); return b; }, insert() { writes++; return Promise.resolve({ error: null }); }, update() { writes++; return b; }, upsert() { writes++; return Promise.resolve({ error: null }); },
    maybeSingle() {
      if (table === 'app_data') return Promise.resolve({ data: { data: OPS }, error: null });
      if (table === 'persons') return Promise.resolve({ data: { full_name: 'Krystal', active: true }, error: null });
      if (table === 'entity_memberships') return Promise.resolve({ data: { active: true, ended_at: null }, error: null });
      return Promise.resolve({ data: null, error: null }); },
    then(ok) { if (table === 'auth_identities') return Promise.resolve({ data: [{ person_id: 'p1' }], error: null }).then(ok);
      if (table === 'staff_roles') return Promise.resolve({ data: [{ role: 'staffing_coordinator' }], error: null }).then(ok);
      return Promise.resolve({ data: [], error: null }).then(ok); } }; return b; },
  rpc: async () => { writes++; return { data: null, error: null }; },
});
const src = fs.readFileSync(path.join(FN, 'outreach-check/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient');
const tmp = path.join(FN, 'outreach-check', '_t531.ts'); fs.writeFileSync(tmp, src);
try { await import(tmp); } finally { fs.unlinkSync(tmp); }
const ask = async (body, tok = 'staff') => { const r = await handler(new Request('http://x/outreach-check', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify(body) })); return { status: r.status, j: await r.json() }; };
let r = await ask({ onboarding_path: true, offer_date: '2026-10-09' }, 'nobody'); ck('no staff sign-in: refused', r.status === 401 || r.status === 403, r);
OPS = {}; r = await ask({ onboarding_path: true, offer_date: '2026-10-09' }); ck('switch date blank: old', r.status === 200 && r.j.onboarding_path === 'old' && r.j.switch_date === null, r.j);
OPS = { onboarding_switch_date: '' }; r = await ask({ onboarding_path: true, offer_date: '2027-01-01' }); ck('an empty string switch date counts as blank: old', r.j.onboarding_path === 'old');
OPS = { onboarding_switch_date: 'soon' }; r = await ask({ onboarding_path: true, offer_date: '2027-01-01' }); ck('junk in the setting counts as blank: old', r.j.onboarding_path === 'old' && r.j.switch_date === null);
OPS = { onboarding_switch_date: '2026-11-02' };
r = await ask({ onboarding_path: true, offer_date: '2026-11-01' }); ck('the day before the switch: old', r.j.onboarding_path === 'old' && r.j.switch_date === '2026-11-02', r.j);
r = await ask({ onboarding_path: true, offer_date: '2026-11-02' }); ck('on the switch date: new', r.j.onboarding_path === 'new');
r = await ask({ onboarding_path: true, offer_date: '2026-12-25' }); ck('after the switch date: new', r.j.onboarding_path === 'new');
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
r = await ask({ onboarding_path: true }); ck('no offer_date: the Chicago date of today is used', r.j.offer_date === today, r.j);
r = await ask({ onboarding_path: true, offer_date: '10/09/2026' }); ck('a malformed offer_date is ignored (today is used)', r.j.offer_date === today);
ck('nothing was written', writes === 0, writes);
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note));
const bad = res.filter((x) => !x[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0);
