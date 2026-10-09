// SLICE 1a (Samantha approved 2026-10-08): the offer link kind. The real link helper (real HMAC with a test secret) and
// the real applicant-link function under Node against a stand-in database and a fake Training Platform. No network.
// node applicant_link_offer_537_test.mjs
import fs from 'fs'; import path from 'path';
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions');
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? '').slice(0, 400)]);
const L = await import(path.join(FN, '_shared/applicant-links.ts'));
const SECRET = 'test-secret-'.repeat(4); const NOW = Math.floor(Date.now() / 1000);
const OID = '0f1e2d3c-4b5a-4968-8777-66554433aabb';
// the helper
const exp7 = NOW + 7 * 86400;
const u = await L.makeOfferLink(SECRET, OID, exp7); const q = Object.fromEntries(new URL(u).searchParams);
ck('the offer link points at offer.html with id, expiry and code and nothing personal', u.startsWith('https://cc.mo-care.com/offer.html?') && q.o === OID && Number(q.e) === exp7 && /^[A-Za-z0-9_-]{43}$/.test(q.t) && !/name|phone|email/.test(u), u);
ck('the expiry is the offer\'s own, never past the 30-day cap', Number(new URL(await L.makeOfferLink(SECRET, OID, NOW + 90 * 86400)).searchParams.get('e')) <= L.expiry(NOW) + 5 && Number(new URL(await L.makeOfferLink(SECRET, OID, 0)).searchParams.get('e')) >= NOW + 29 * 86400);
ck('a good offer link checks; the same code is refused for a start link, an altered id, an altered expiry, or after expiry', await L.checkLink(SECRET, 'offer', OID, q.e, q.t) && !(await L.checkLink(SECRET, 'start', OID, q.e, q.t)) && !(await L.checkLink(SECRET, 'offer', OID.replace('0f', '1f'), q.e, q.t)) && !(await L.checkLink(SECRET, 'offer', OID, Number(q.e) + 1, q.t)) && !(await L.checkLink(SECRET, 'offer', OID, q.e, q.t, exp7 + 1)));
ck('start and orient links are unchanged', (await L.makeStartLink(SECRET, OID)).startsWith('https://cc.mo-care.com/start.html?o=') && (await L.makeOrientLink(SECRET, '123', 'abc')).startsWith('https://sc.mo-care.com/orientation-booking.html?'));
// the function
const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'svc', HUB_JOB_SECRET: SECRET, OFFERS_PROJECT_URL: 'https://train.test', OFFERS_SERVICE_ROLE_KEY: 'ok' };
let handler = null; globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
const OFFERS = { [OID]: { id: OID, first_name: 'Ava', last_name: 'Applicant', phone: '4175550199', email: 'ava@x.com', position: 'Caregiver', pay_rate: 16, hours_type: 'PRN', classification: 'prn', offer_status: 'sent', offer_version: 1, pd_version: 1, offer_sent_at: '2026-10-09T15:00:00Z', offer_expires_at: new Date((NOW + 5 * 86400) * 1000).toISOString(), offered_by: 'Krystal', created_at: '2026-10-09T15:00:00Z', notes: 'secret notes' } };
const ASKED = [];
globalThis.fetch = async (u2) => { const url = new URL(String(u2)); ASKED.push(url.search); const R = (s, b) => new Response(JSON.stringify(b), { status: s });
  if (url.hostname === 'train.test') { const id = decodeURIComponent((url.searchParams.get('id') || '').replace('eq.', '')); return R(200, OFFERS[id] ? [OFFERS[id]] : []); }
  throw new Error('unexpected ' + u2); };
const STAFF = { ok: true, person_id: 'p1', name: 'Krystal', email: 'krystal@mo-care.com', roles: ['staffing_coordinator'] };
globalThis.__fakeCreateClient = () => ({ from: () => { const b = { select() { return b; }, eq() { return b; }, maybeSingle: async () => ({ data: null, error: null }), insert: async () => ({ error: null }) }; return b; },
  auth: { getUser: async (jwt) => jwt === 'staff' ? { data: { user: { id: 'u1', email: 'krystal@mo-care.com', app_metadata: {} } } } : { data: null, error: { message: 'no' } } } });
let src = fs.readFileSync(path.join(FN, 'applicant-link/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient');
src = src.replace(/^import \{ requireStaff, OFFICE_ROLES \} from .*$/m, "const OFFICE_ROLES = ['owner_admin','care_coordinator','staffing_coordinator']; const requireStaff = async (db, req) => (req.headers.get('Authorization') === 'Bearer staff') ? globalThis.__STAFF : { ok: false, status: 401, error: 'Sign in first.' }");
globalThis.__STAFF = STAFF;
const tmp = path.join(FN, 'applicant-link', '_t537.ts'); fs.writeFileSync(tmp, src);
try { await import(tmp); } finally { fs.unlinkSync(tmp); }
const call = async (body, tok) => { const r = await handler(new Request('http://x/applicant-link', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(body) })); return { status: r.status, j: await r.json() }; };
let r = await call({ action: 'mint', kind: 'offer', offer_id: OID, exp: NOW + 5 * 86400 }); ck('minting an offer link needs a staff sign-in', r.status === 401, r);
r = await call({ action: 'mint', kind: 'offer', offer_id: OID, exp: NOW + 5 * 86400 }, 'staff'); ck('a staff member mints an offer link for a real offer', r.status === 200 && r.j.ok && r.j.url.startsWith('https://cc.mo-care.com/offer.html?o=' + OID), r);
const link = r.j && r.j.url ? Object.fromEntries(new URL(r.j.url).searchParams) : {};
r = await call({ action: 'mint', kind: 'offer', offer_id: 'not-an-id' }, 'staff'); ck('a bad offer id is refused', r.status === 400, r);
r = await call({ action: 'mint', kind: 'offer', offer_id: OID.replace('0f', '1f') }, 'staff'); ck('an unknown offer is refused', r.status === 404, r);
r = await call({ action: 'open', kind: 'offer', o: OID, e: link.e, t: link.t }); ck('opening with the minted link returns the letter fields and nothing personal', r.status === 200 && r.j.first === 'Ava' && r.j.position === 'Caregiver' && r.j.pay_rate === 16 && r.j.classification === 'prn' && r.j.status === 'sent' && !('phone' in r.j) && !('email' in r.j) && !('notes' in r.j), r.j);
ck('the letter read asks the Training Platform for the letter columns only (no phone, email or notes)', ASKED.some((s) => /select=id,first_name,last_name,position/.test(s) && !/phone|email|notes/.test(s)), ASKED);
r = await call({ action: 'open', kind: 'offer', o: OID, e: link.e, t: 'x'.repeat(43) }); ck('a forged code gets nothing', r.status === 401 && !r.j.first, r);
r = await call({ action: 'open', kind: 'start', o: OID, e: link.e, t: link.t }); ck('an offer code does not open the start form', r.status === 401, r);
OFFERS[OID].offer_withdrawn_at = '2026-10-10T00:00:00Z'; r = await call({ action: 'open', kind: 'offer', o: OID, e: link.e, t: link.t }); ck('a withdrawn offer answers like a dead link', r.status === 410 && !r.j.first, r); delete OFFERS[OID].offer_withdrawn_at;
OFFERS[OID].offer_expires_at = new Date((NOW - 10) * 1000).toISOString(); r = await call({ action: 'open', kind: 'offer', o: OID, e: link.e, t: link.t }); ck('an expired offer answers like a dead link even if the code is still in date', r.status === 410, r);
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note));
const bad = res.filter((x) => !x[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0);
