// SLICE 1b: the real offer-sign function under Node against a fake Training Platform (REST), a fake private bucket and
// a real link code with a test secret. Her rules: new path only, order of signing, one signature per document (a race
// cannot sign twice), withdrawn/expired/declined answer like a dead link, the link dies with the offer, PDFs written
// once and never overwritten, every event recorded, staff opens logged. No network. node offer_sign_540_test.mjs
import fs from 'fs'; import path from 'path';
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions');
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? '').slice(0, 400)]);
const L = await import(path.join(FN, '_shared/applicant-links.ts'));
const SECRET = 'test-secret-'.repeat(4), NOW = Math.floor(Date.now() / 1000), OID = '0f1e2d3c-4b5a-4968-8777-66554433aabb', OID2 = '1f1e2d3c-4b5a-4968-8777-66554433aabb';
const env = { OUTREACH_SECRET: 'o'.repeat(40), SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'svc', HUB_JOB_SECRET: SECRET, OFFERS_PROJECT_URL: 'https://train.test', OFFERS_SERVICE_ROLE_KEY: 'ok' };
let handler = null; globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
const mk = (over = {}) => ({ id: OID, first_name: 'Test', last_name: 'Applicant', position: 'Caregiver', pay_rate: 16, hours_type: 'PRN', classification: 'prn', onboarding_path: 'new', offer_status: 'sent', offer_version: null, pd_version: null,
  offer_sent_at: '2026-10-09T15:00:00Z', offer_sent_by: 'Krystal Land', offer_expires_at: new Date((NOW + 5 * 86400) * 1000).toISOString(), offer_viewed_at: null, offer_signed_at: null, offer_signer_name: null, pd_signed_at: null, offer_declined_at: null, offer_withdrawn_at: null, offer_pdf_path: null, pd_pdf_path: null, offered_by: 'Krystal', created_at: '2026-10-09T15:00:00Z', phone: '4175550199', email: 'x@y', notes: 'secret', ...over });
let OFFERS = { [OID]: mk() }; let EVENTS = []; let FILES = {}; let LOG = []; let PATCHES = []; let OPS = {};
const guardOk = (row, guard) => {
  if (!guard) return true;
  for (const [k, v] of new URLSearchParams(guard.replace(/^&/, ''))) { if (v === 'is.null' && row[k] != null) return false; const m = /^not\.in\.\((.*)\)$/.exec(v); if (m && m[1].split(',').includes(String(row[k]))) return false; }
  return true; };
const KICKS = [];
globalThis.fetch = async (u, o = {}) => { const url = new URL(String(u)), m = (o.method || 'GET').toUpperCase(); const R = (s, b) => new Response(JSON.stringify(b), { status: s });
  /* SLICE 1d: the kick to the Training Platform's job-offer server door once both documents are signed */
  if (url.hostname === 'rdqujxiycycwhskyvrwa.supabase.co' && url.pathname === '/functions/v1/job-offer') { KICKS.push({ body: JSON.parse(o.body), secret: o.headers['x-outreach-secret'], auth: o.headers.Authorization || null }); return R(200, { ok: true, status: 'practice' }); }
  if (url.hostname !== 'train.test') throw new Error('unexpected ' + u);
  if (url.pathname === '/rest/v1/job_offers') { const id = (url.searchParams.get('id') || '').replace('eq.', ''); const row = OFFERS[id];
    if (m === 'GET') return R(200, row ? [row] : []);
    if (m === 'PATCH') { const guard = url.search.replace(/^\?id=eq\.[^&]*/, ''); const body = JSON.parse(o.body); PATCHES.push({ guard, body }); if (!row || !guardOk(row, guard)) return R(200, []); Object.assign(row, body); return R(200, [row]); } }
  if (url.pathname === '/rest/v1/offer_events' && m === 'POST') { EVENTS.push(JSON.parse(o.body)); return R(201, null); }
  throw new Error('unexpected ' + m + ' ' + u); };
globalThis.__fakeCreateClient = () => ({
  storage: { from: (bucket) => ({ upload: async (p, bytes, opts) => { if (FILES[p] && !opts.upsert) return { error: { message: 'The resource already exists' } }; FILES[p] = { bucket, bytes, opts }; return { data: { path: p }, error: null }; },
    createSignedUrl: async (p, secs) => FILES[p] ? { data: { signedUrl: 'https://signed.test/' + p + '?exp=' + secs }, error: null } : { data: null, error: { message: 'not found' } } }) },
  from: (t) => { const b = { select() { return b; }, eq() { return b; }, maybeSingle: async () => ({ data: t === 'app_data' ? { data: OPS } : null, error: null }), insert: async (r) => { if (t === 'document_access_log') LOG.push(r); return { error: null }; } }; return b; },
  auth: { getUser: async (jwt) => jwt === 'staff' ? { data: { user: { id: 'u1', email: 'krystal@mo-care.com', app_metadata: {} } } } : { data: null, error: { message: 'no' } } } });
let src = fs.readFileSync(path.join(FN, 'offer-sign/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient');
src = src.replace(/^import \{ requireStaff, OFFICE_ROLES \} from .*$/m, "const OFFICE_ROLES = ['owner_admin','care_coordinator','staffing_coordinator']; const requireStaff = async (db, req) => (req.headers.get('Authorization') === 'Bearer staff') ? { ok: true, person_id: 'p1', name: 'Krystal Land', email: 'krystal@mo-care.com', roles: ['staffing_coordinator'] } : { ok: false, status: 401, error: 'Sign in first.' }");
const tmp = path.join(FN, 'offer-sign', '_t540.ts'); fs.writeFileSync(tmp, src);
try { await import(tmp); } finally { fs.unlinkSync(tmp); }
const call = async (body, tok, headers = {}) => { const r = await handler(new Request('http://x/offer-sign', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.9', 'user-agent': 'TestPhone/1.0', ...(tok ? { Authorization: 'Bearer ' + tok } : {}), ...headers }, body: JSON.stringify(body) })); return { status: r.status, j: await r.json() }; };
const linkFor = async (id, expSec) => { const u = await L.makeOfferLink(SECRET, id, expSec); return Object.fromEntries(new URL(u).searchParams); };
const lk = await linkFor(OID, NOW + 5 * 86400);
let r = await call({ action: 'view', o: OID, e: lk.e, t: 'x'.repeat(43) }); ck('a forged link gets nothing', r.status === 401 && !r.j.offer, r);
r = await call({ action: 'view', o: OID, e: lk.e, t: lk.t });
ck('view: both documents rendered, the state, versions and fingerprints, no phone/email/notes', r.status === 200 && r.j.ok && r.j.first === 'Test' && r.j.offer.length > 30 && r.j.pd.length > 25 && r.j.versions.offer === 1 && /^[0-9a-f]{64}$/.test(r.j.fingerprints.pd) && !JSON.stringify(r.j).includes('4175550199') && !JSON.stringify(r.j).includes('secret'), r.j && Object.keys(r.j));
ck('view says the Step 1 automation is NOT live (test mode) while the switch is off, and live only when it is on', r.j.automation_live === false && r.j.test_mode === true && (OPS = { step1_auto_live: true }, (await call({ action: 'view', o: OID, e: lk.e, t: lk.t })).j.automation_live === true) && (OPS = {}, true));
ck('view marks viewed once with one event; a second view adds none', OFFERS[OID].offer_viewed_at && OFFERS[OID].offer_status === 'viewed' && EVENTS.filter((e) => e.kind === 'viewed').length === 1 && (await call({ action: 'view', o: OID, e: lk.e, t: lk.t }), EVENTS.filter((e) => e.kind === 'viewed').length === 1), EVENTS);
r = await call({ action: 'sign', o: OID, e: lk.e, t: lk.t, doc: 'pd', typed_name: 'Test Applicant', consent: true }); ck('the position description cannot be signed before the offer', r.status === 409 && /offer letter first/.test(r.j.error), r);
r = await call({ action: 'sign', o: OID, e: lk.e, t: lk.t, doc: 'offer', typed_name: 'Test Applicant' }); ck('no consent, no signature', r.status === 400 && /agree to sign/.test(r.j.error), r);
r = await call({ action: 'sign', o: OID, e: lk.e, t: lk.t, doc: 'offer', typed_name: 'Test', consent: true }); ck('a single name is refused', r.status === 400, r);
r = await call({ action: 'sign', o: OID, e: lk.e, t: lk.t, doc: 'offer', typed_name: 'Test Applicant', consent: true });
ck('the offer alone does not kick Step 1 (not both signed yet)', KICKS.length === 0 && r.j.step1 && r.j.step1.kicked === false, [KICKS, r.j.step1]);
ck('the offer signs: time, name, device, version 1, event with fingerprint, PDF stored, copy link, not yet accepted', r.status === 200 && r.j.ok && r.j.doc === 'offer' && r.j.version === 1 && !r.j.accepted && /signed\.test/.test(r.j.copy_url) && OFFERS[OID].offer_signed_at && OFFERS[OID].offer_signer_name === 'Test Applicant' && OFFERS[OID].offer_signer_ip === '203.0.113.9' && OFFERS[OID].offer_version === 1 && EVENTS.some((e) => e.kind === 'signed' && e.fingerprint === r.j.fingerprint && e.detail.typed_name === 'Test Applicant') && Object.keys(FILES).length === 1 && OFFERS[OID].offer_pdf_path && OFFERS[OID].offer_status === 'viewed', [r, OFFERS[OID]]);
const pdfRaw = Buffer.from(Object.values(FILES)[0].bytes).toString('latin1'); const pdf = [...pdfRaw.matchAll(/\((.*?)\) Tj/g)].map((m) => m[1].replace(/\\([()\\])/g, '$1')).join(' ');
ck('the stored PDF is the branded letter: exact terms, letterhead fonts and logo, the signature record, no signature for Samantha', /no minimum number of hours per week is guaranteed/.test(pdf) && /\$16\.00 per hour/.test(pdf) && /drug screening required by Caring Companions' screening policy/.test(pdf) && /ELECTRONIC SIGNATURE/.test(pdf) && /Test Applicant/.test(pdf) && /Signed electronically with consent given on the signing page/.test(pdf) && /Fingerprint [0-9a-f]{64}/.test(pdf) && /Poppins-Regular/.test(pdfRaw) && /DCTDecode/.test(pdfRaw) && !/Signature:|signature image/i.test(pdf) && Object.values(FILES)[0].opts.upsert === false && Object.values(FILES)[0].opts.contentType === 'application/pdf');
r = await call({ action: 'sign', o: OID, e: lk.e, t: lk.t, doc: 'offer', typed_name: 'Test Applicant', consent: true }); ck('a second signature on the offer is refused and nothing is overwritten', r.status === 409 && r.j.already && Object.keys(FILES).length === 1 && EVENTS.filter((e) => e.kind === 'signed').length === 1, r);
OFFERS[OID].offer_signed_at = null; PATCHES.length = 0; // simulate a race: the record read says unsigned but the guarded save finds it signed
const realRow = OFFERS[OID]; const origGet = globalThis.fetch; globalThis.fetch = async (u, o = {}) => { const url = new URL(String(u)); if (url.pathname === '/rest/v1/job_offers' && (o.method || 'GET') === 'GET') { const row = { ...realRow, offer_signed_at: null }; return new Response(JSON.stringify([row]), { status: 200 }); } return origGet(u, o); };
realRow.offer_signed_at = '2026-10-09T16:00:00Z';
r = await call({ action: 'sign', o: OID, e: lk.e, t: lk.t, doc: 'offer', typed_name: 'Test Applicant', consent: true }); globalThis.fetch = origGet;
ck('a race (signed between read and save) is refused by the guarded save, no second event or PDF', r.status === 409 && EVENTS.filter((e) => e.kind === 'signed').length === 1 && Object.keys(FILES).length === 1, r);
r = await call({ action: 'sign', o: OID, e: lk.e, t: lk.t, doc: 'pd', typed_name: 'Test Applicant', consent: true });
ck('both signed: the Training Platform is kicked once with the shared secret, offer id only (no page data, no key), and the page is told', KICKS.length === 1 && KICKS[0].secret === 'o'.repeat(40) && KICKS[0].body.action === 'step1_send' && KICKS[0].body.offer_id === OID && Object.keys(KICKS[0].body).length === 2 && KICKS[0].auth === null && r.j.step1 && r.j.step1.kicked === true, [KICKS, r.j.step1]);
ck('the position description signs second: its own event, version, PDF; the offer becomes accepted', r.status === 200 && r.j.doc === 'pd' && r.j.accepted === true && OFFERS[OID].pd_signed_at && OFFERS[OID].pd_version === 1 && OFFERS[OID].offer_status === 'accepted' && EVENTS.some((e) => e.kind === 'pd_signed') && Object.keys(FILES).length === 2 && OFFERS[OID].pd_pdf_path, [r, OFFERS[OID]]);
r = await call({ action: 'copies', o: OID, e: lk.e, t: lk.t }); ck('the caregiver gets short-lived links to both signed copies', r.status === 200 && r.j.copies.offer && r.j.copies.pd && r.j.expires_in === 600, r);
r = await call({ action: 'view', o: OID, e: lk.e, t: lk.t }); ck('view after both signatures shows both signed (resume shows the finished state)', r.j.state.offer_signed_at && r.j.state.pd_signed_at && r.j.state.status === 'accepted');
ck('no text or email path exists in this function', !/ghlMessage|sendEmail|resend\.com|leadconnectorhq|SMS/.test(src));
// gates
OFFERS[OID2] = mk({ id: OID2, onboarding_path: 'old' }); const lk2 = await linkFor(OID2, NOW + 5 * 86400);
r = await call({ action: 'view', o: OID2, e: lk2.e, t: lk2.t }); ck('an old-path offer is never served (the test gate): the real hiring process is out of reach', r.status === 404 && !r.j.offer, r);
OFFERS[OID2] = mk({ id: OID2, offer_withdrawn_at: '2026-10-09T17:00:00Z', offer_status: 'withdrawn' }); r = await call({ action: 'view', o: OID2, e: lk2.e, t: lk2.t }); ck('a withdrawn offer answers like a dead link', r.status === 410, r);
OFFERS[OID2] = mk({ id: OID2, offer_declined_at: '2026-10-09T17:00:00Z', offer_status: 'declined' }); r = await call({ action: 'sign', o: OID2, e: lk2.e, t: lk2.t, doc: 'offer', typed_name: 'Test Two', consent: true }); ck('a declined offer cannot be signed', r.status === 410, r);
OFFERS[OID2] = mk({ id: OID2, offer_expires_at: new Date((NOW - 10) * 1000).toISOString() }); r = await call({ action: 'view', o: OID2, e: lk2.e, t: lk2.t }); ck('an expired offer is dead even when the link code is still in date', r.status === 410 && r.j.expired, r);
OFFERS[OID2] = mk({ id: OID2, offer_expires_at: null }); r = await call({ action: 'view', o: OID2, e: lk2.e, t: lk2.t }); ck('an offer with no expiry on record is refused rather than served forever', r.status === 409, r);
OFFERS[OID2] = mk({ id: OID2, classification: 'lead', hours_type: null }); r = await call({ action: 'view', o: OID2, e: lk2.e, t: lk2.t }); ck('a position without approved terms is refused', r.status === 409 && /not been approved/.test(r.j.error), r);
// staff open
r = await call({ action: 'open', offer_id: OID, doc: 'offer' }); ck('a staff open needs a sign-in', r.status === 401, r);
r = await call({ action: 'open', offer_id: OID, doc: 'offer' }, 'staff'); ck('a signed-in staff member gets a 5-minute link and the open is logged with who, what and where from', r.status === 200 && /signed\.test/.test(r.j.url) && r.j.expires_in === 300 && LOG.length === 1 && LOG[0].by_email === 'krystal@mo-care.com' && LOG[0].doc === 'offer' && LOG[0].ip === '203.0.113.9', [r, LOG]);
r = await call({ action: 'open', offer_id: OID2, doc: 'pd' }, 'staff'); ck('an unsigned document cannot be opened', r.status === 404, r);
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note));
const bad = res.filter((x) => !x[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0);
