// SLICE 1c (Samantha "start slice 1c", 2026-10-09): the Hub door's onboarding_path answer now also carries the offer's expiry
// (seven business days, 5pm Central, company calendar), the offer_send_live switch and may_reoffer (Approve to Advance list
// plus owners, by identity). The real outreach-check under Node, stand-in database, no network, nothing written.
// node outreach_offer_1c_test.mjs
import fs from 'fs'; import path from 'path';
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions');
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? '').slice(0, 400)]);
const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'svc', OUTREACH_SECRET: 'x'.repeat(40) };
let handler = null; globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
let OPS = {}, PERMS = null, ROLES = ['staffing_coordinator'], PID = 'p1'; let writes = 0;
globalThis.__fakeCreateClient = () => ({
  auth: { getUser: async (jwt) => jwt === 'staff' ? { data: { user: { id: 'u1', email: 'krystal@mo-care.com', app_metadata: {} } } } : { data: null, error: { message: 'bad' } } },
  from: (table) => { const f = []; const b = {
    select() { return b; }, eq(c, v) { f.push([c, v]); return b; }, insert() { writes++; return Promise.resolve({ error: null }); }, update() { writes++; return b; }, upsert() { writes++; return Promise.resolve({ error: null }); },
    maybeSingle() {
      if (table === 'app_data') { const key = (f.find((x) => x[0] === 'key') || [])[1]; return Promise.resolve({ data: key === 'ops_settings' ? { data: OPS } : key === 'onboarding_permissions' ? (PERMS ? { data: PERMS } : null) : null, error: null }); }
      if (table === 'persons') return Promise.resolve({ data: { full_name: 'Krystal', active: true }, error: null });
      if (table === 'entity_memberships') return Promise.resolve({ data: { active: true, ended_at: null }, error: null });
      return Promise.resolve({ data: null, error: null }); },
    then(ok) { if (table === 'auth_identities') return Promise.resolve({ data: [{ person_id: PID }], error: null }).then(ok);
      if (table === 'staff_roles') return Promise.resolve({ data: ROLES.map((role) => ({ role })), error: null }).then(ok);
      return Promise.resolve({ data: [], error: null }).then(ok); } }; return b; },
  rpc: async () => { writes++; return { data: null, error: null }; },
});
const src = fs.readFileSync(path.join(FN, 'outreach-check/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient');
const tmp = path.join(FN, 'outreach-check', '_t1c.ts'); fs.writeFileSync(tmp, src);
try { await import(tmp); } finally { fs.unlinkSync(tmp); }
const ask = async (body, tok = 'staff', hdr = {}) => { const r = await handler(new Request('http://x/outreach-check', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok, ...hdr }, body: JSON.stringify(body) })); return { status: r.status, j: await r.json() }; };
OPS = {}; let r = await ask({ onboarding_path: true, offer_date: '2026-10-09' });
ck('the old answer is unchanged: path old, blank switch date, the offer date', r.status === 200 && r.j.onboarding_path === 'old' && r.j.switch_date === null && r.j.offer_date === '2026-10-09', r.j);
ck('the expiry: seven business days after a Friday offer with no holidays is the Tuesday after next, 5pm Central (22:00Z in October)', r.j.offer_expires_at === '2026-10-20T22:00:00.000Z' && r.j.offer_link_business_days === 7, r.j);
OPS = { company_holidays: [{ date: '2026-10-12', name: 'Columbus Day' }] }; r = await ask({ onboarding_path: true, offer_date: '2026-10-09' });
ck('a company holiday on the calendar pushes the expiry one business day (matches the 539 test offers: Oct 21)', r.j.offer_expires_at === '2026-10-21T22:00:00.000Z', r.j);
ck('offer sending is practice until the switch is on', r.j.offer_send_live === false);
OPS = { offer_send_live: true }; r = await ask({ onboarding_path: true, offer_date: '2026-10-09' }); ck('the switch on: offer_send_live true', r.j.offer_send_live === true);
OPS = { offer_send_live: 'yes' }; r = await ask({ onboarding_path: true, offer_date: '2026-10-09' }); ck('anything but true is off', r.j.offer_send_live === false);
OPS = {}; PERMS = null; r = await ask({ onboarding_path: true }); ck('no permission record yet and a coordinator: may not re-offer', r.j.may_reoffer === false, r.j);
PERMS = { version: 1, advance: [{ person_id: 'p1', email: 'krystal@mo-care.com', name: 'Krystal', added_by: 's', added_at: 'x' }], work: [], history: [] };
r = await ask({ onboarding_path: true }); ck('on the Approve to Advance list, by identity: may re-offer', r.j.may_reoffer === true, r.j);
PID = 'p9'; r = await ask({ onboarding_path: true }); ck('a different person with the same role: may not', r.j.may_reoffer === false);
ROLES = ['owner_admin']; r = await ask({ onboarding_path: true }); ck('an owner may re-offer without being listed', r.j.may_reoffer === true);
ROLES = ['staffing_coordinator']; PID = 'p1';
r = await ask({ onboarding_path: true, offer_date: '2026-10-09' }, 'nobody', { 'x-outreach-secret': 'x'.repeat(40) });
ck('the server door gets the expiry and the switch but never may_reoffer', r.status === 200 && r.j.offer_expires_at === '2026-10-20T22:00:00.000Z' && r.j.offer_send_live === false && r.j.may_reoffer === false, r.j);
r = await ask({ onboarding_path: true }, 'nobody'); ck('no sign-in and no secret: refused', r.status === 401 || r.status === 403);
/* SLICE 1e: reminder days from the Admin page, the reminders switch */
OPS = {}; r = await ask({ onboarding_path: true }); ck('reminder days default to 2 and 5; reminders are practice until the switch is on', JSON.stringify(r.j.offer_reminder_days) === '[2,5]' && r.j.offer_reminders_live === false, r.j);
OPS = { onboarding: { offer_days: [3, 6] }, offer_reminders_live: true }; r = await ask({ onboarding_path: true }); ck('the Admin page days are used, the switch on', JSON.stringify(r.j.offer_reminder_days) === '[3,6]' && r.j.offer_reminders_live === true, r.j);
OPS = { onboarding: { offer_days: [5, 2] } }; r = await ask({ onboarding_path: true }); ck('days out of order fall back to the approved 2 and 5', JSON.stringify(r.j.offer_reminder_days) === '[2,5]', r.j);
OPS = { onboarding: { offer_days: ['x', 40] } }; r = await ask({ onboarding_path: true }); ck('junk days fall back to the approved 2 and 5', JSON.stringify(r.j.offer_reminder_days) === '[2,5]', r.j);
OPS = {};
ck('nothing was written', writes === 0, writes);
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note));
const bad = res.filter((x) => !x[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0);
