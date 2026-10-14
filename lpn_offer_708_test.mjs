// 708 LPN HIRING (Samantha approved the LPN nurse visit plan, 2026-10-14): the online offer for an LPN or RN is the LETTER ONLY
// (the licensed nurse letter, proposed); every caregiver offer is byte-identical to before. The real offer-sign function against
// the fake Training Platform of offer_sign_540_test.mjs, and the caregiver documents of the reviewed base (LPN_BASE) for the
// fingerprint comparison. No network. node lpn_offer_708_test.mjs
import fs from 'fs'; import path from 'path';
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions');
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? '').slice(0, 400)]);
const L = await import(path.join(FN, '_shared/applicant-links.ts'));
const SECRET = 'test-secret-'.repeat(4), NOW = Math.floor(Date.now() / 1000), OID = '0f1e2d3c-4b5a-4968-8777-66554433aabb', OID2 = '1f1e2d3c-4b5a-4968-8777-66554433aabb';
const env = { OUTREACH_SECRET: 'o'.repeat(40), SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'svc', HUB_JOB_SECRET: SECRET, OFFERS_PROJECT_URL: 'https://train.test', OFFERS_SERVICE_ROLE_KEY: 'ok' };
let handler = null; globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
const mk = (over = {}) => ({ id: OID, first_name: 'Test', last_name: 'Applicant', position: 'Caregiver', pay_rate: 16, hours_type: 'PRN', classification: 'prn', onboarding_path: 'new', offer_status: 'sent', offer_version: 1, pd_version: 1,
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
const CARDS = [];
globalThis.__fakeCreateClient = () => ({
  rpc: async (name, args) => { if (name === 'upsert_app_data_item') CARDS.push(args.item); return { data: null, error: null }; },
  storage: { from: (bucket) => ({ upload: async (p, bytes, opts) => { if (FILES[p] && !opts.upsert) return { error: { message: 'The resource already exists' } }; FILES[p] = { bucket, bytes, opts }; return { data: { path: p }, error: null }; },
    createSignedUrl: async (p, secs) => FILES[p] ? { data: { signedUrl: 'https://signed.test/' + p + '?exp=' + secs }, error: null } : { data: null, error: { message: 'not found' } } }) },
  from: (t) => { const b = { select() { return b; }, eq() { return b; }, maybeSingle: async () => ({ data: t === 'app_data' ? { data: OPS } : null, error: null }), insert: async (r) => { if (t === 'document_access_log') LOG.push(r); return { error: null }; } }; return b; },
  auth: { getUser: async (jwt) => jwt === 'staff' ? { data: { user: { id: 'u1', email: 'krystal@mo-care.com', app_metadata: {} } } } : { data: null, error: { message: 'no' } } } });
let src = fs.readFileSync(path.join(FN, 'offer-sign/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient');
src = src.replace(/^import \{ requireStaff, OFFICE_ROLES \} from .*$/m, "const OFFICE_ROLES = ['owner_admin','care_coordinator','staffing_coordinator']; const requireStaff = async (db, req) => (req.headers.get('Authorization') === 'Bearer staff') ? { ok: true, person_id: 'p1', name: 'Krystal Land', email: 'krystal@mo-care.com', roles: ['staffing_coordinator'] } : { ok: false, status: 401, error: 'Sign in first.' }");
const tmp = path.join(FN, 'offer-sign', '_t708.ts'); fs.writeFileSync(tmp, src);
let M; try { M = await import(tmp); } finally { fs.unlinkSync(tmp); }
const D = await import(path.join(FN, "_shared/offer-documents.ts"));
const call = async (body, tok, headers = {}) => { const r = await handler(new Request('http://x/offer-sign', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.9', 'user-agent': 'TestPhone/1.0', ...(tok ? { Authorization: 'Bearer ' + tok } : {}), ...headers }, body: JSON.stringify(body) })); return { status: r.status, j: await r.json() }; };
const linkFor = async (id, expSec) => { const u = await L.makeOfferLink(SECRET, id, expSec); return Object.fromEntries(new URL(u).searchParams); };

import { execFileSync } from 'child_process'
const LPN_BASE = process.env.LPN_BASE || '7fcf815c2d26aa84c7c34841ecb290713a11cad0'   /* origin/main when this was built (2026-10-14) */
const baseDir = fs.mkdtempSync(path.join(ROOT, '.lpn708-base-'))
let B; try { fs.writeFileSync(path.join(baseDir, 'offer-documents.ts'), execFileSync('git', ['-C', ROOT, 'show', LPN_BASE + ':supabase/functions/_shared/offer-documents.ts'])); B = await import(path.join(baseDir, 'offer-documents.ts')) } finally { fs.rmSync(baseDir, { recursive: true, force: true }) }
/* ═══ 1. caregiver offers: byte-identical letter and position description ═══ */
const FIELDS = [{ first: 'Test', last: 'Applicant', position: 'Caregiver', pay_rate: 16, classification: 'prn', date: 'October 9, 2026', expires: 'October 20, 2026', issued_by: 'Krystal Land', issued_at: 'October 9, 2026 at 2:14 PM Central' },
  { first: 'Ann', last: 'Other', position: 'CNA', pay_rate: 18.5, classification: 'part_time', date: 'October 14, 2026', expires: 'October 23, 2026', issued_by: 'Kat', issued_at: 'October 14, 2026 at 9:00 AM Central' },
  { first: 'Bo', last: 'Third', position: 'Care Coordinator', pay_rate: 20, classification: 'full_time', date: 'October 14, 2026', expires: 'October 23, 2026', issued_by: 'Kat', issued_at: 'October 14, 2026 at 9:00 AM Central' }]
let same = true; for (const f of FIELDS) { if (D.canonical(D.offerLetter(f)) !== B.canonical(B.offerLetter(f)) || D.canonical(D.positionDescription(f)) !== B.canonical(B.positionDescription(f))) same = false }
ck('the caregiver offer letter and position description render byte-identical to the reviewed base for every classification', same && D.OFFER_DOC_VERSION === B.OFFER_DOC_VERSION && D.PD_DOC_VERSION === B.PD_DOC_VERSION)
const lk = await linkFor(OID, NOW + 5 * 86400)
let r = await call({ action: 'view', o: OID, e: lk.e, t: lk.t })
const f0 = { first: 'Test', last: 'Applicant', position: 'Caregiver', pay_rate: 16, classification: 'prn', date: B.longDate('2026-10-09T15:00:00Z'), expires: B.longDate(OFFERS[OID].offer_expires_at), issued_by: 'Krystal Land', issued_at: B.longDateTime('2026-10-09T15:00:00Z') }
ck('a caregiver offer from before (no key) views exactly as before: both documents, versions 2 and 2, the base fingerprints', r.status === 200 && r.j.pd && !r.j.letter_only && r.j.versions.offer === 2 && r.j.versions.pd === 2 && r.j.fingerprints.offer === await B.fingerprint(B.canonical(B.offerLetter(f0))) && r.j.fingerprints.pd === await B.fingerprint(B.canonical(B.positionDescription(f0))), r.j && { v: r.j.versions, lo: r.j.letter_only })
OFFERS[OID2] = mk({ id: OID2, position_key: 'caregiver' }); const lk2 = await linkFor(OID2, NOW + 5 * 86400)
r = await call({ action: 'view', o: OID2, e: lk2.e, t: lk2.t })
ck('a new caregiver offer (key caregiver) is the same: both documents, the base fingerprints', r.status === 200 && r.j.pd && r.j.fingerprints.offer === await B.fingerprint(B.canonical(B.offerLetter(f0))) && r.j.fingerprints.pd === await B.fingerprint(B.canonical(B.positionDescription(f0))))
r = await call({ action: 'sign', o: OID2, e: lk2.e, t: lk2.t, doc: 'offer', typed_name: 'Test Applicant', consent: true })
ck('a caregiver offer is NOT accepted on the letter alone; no Step 1 kick (the position description is still owed)', r.status === 200 && r.j.accepted === false && KICKS.length === 0, r.j)
r = await call({ action: 'sign', o: OID2, e: lk2.e, t: lk2.t, doc: 'pd', typed_name: 'Test Applicant', consent: true })
ck('the position description completes it, as before: accepted, Step 1 kicked once', r.status === 200 && r.j.accepted === true && KICKS.length === 1 && KICKS[0].body.action === 'step1_send', r.j)
/* ═══ 2. an LPN or RN offer: the licensed nurse letter alone ═══ */
const N1 = '2f1e2d3c-4b5a-4968-8777-66554433aabb', N2 = '3f1e2d3c-4b5a-4968-8777-66554433aabb'
OFFERS[N1] = mk({ id: N1, first_name: 'Lee', last_name: 'Nurse', position: 'LPN', position_key: 'lpn', offer_version: 1, pd_version: null })
const ln1 = await linkFor(N1, NOW + 5 * 86400)
r = await call({ action: 'view', o: N1, e: ln1.e, t: ln1.t })
ck('a REAL LPN offer: the letter is waiting for her approval, nothing shown or signable', r.status === 409 && r.j.not_approved === true && !r.j.offer, r.j)
r = await call({ action: 'sign', o: N1, e: ln1.e, t: ln1.t, doc: 'offer', typed_name: 'Lee Nurse', consent: true })
ck('a REAL LPN offer cannot be signed either', r.status === 409 && !OFFERS[N1].offer_signed_at, r.j)
OFFERS[N2] = mk({ id: N2, first_name: 'Pat', last_name: 'Practice', position: 'LPN', position_key: 'lpn', offered_by: 'Training walkthrough', offer_version: 1, pd_version: null })
const ln2 = await linkFor(N2, NOW + 5 * 86400)
r = await call({ action: 'view', o: N2, e: ln2.e, t: ln2.t })
const txt = (r.j.offer || []).map((b) => b.t).join('\n')
ck('a PRACTICE LPN offer: the licensed nurse letter alone, version 1, no position description', r.status === 200 && r.j.letter_only === true && r.j.pd === null && r.j.versions.offer === 1 && r.j.versions.pd === null && /^[0-9a-f]{64}$/.test(r.j.fingerprints.offer), r.j && { lo: r.j.letter_only, v: r.j.versions })
ck('the nurse letter names the license: Position: Licensed Practical Nurse (LPN), classification PRN (as-needed) licensed practical nurse, and never "field caregiver"', /Position: Licensed Practical Nurse \(LPN\)/.test(txt) && /Employment classification: PRN \(as-needed\) licensed practical nurse/.test(txt) && !/field caregiver/i.test(txt) && !/Caregiver position description/i.test(txt))
ck('the nurse letter: the Nursys check is a condition, the Step 2 packet (job description and RN supervision acknowledgment), the nurse orientation and Section 2', /Nursys QuickConfirm/.test(txt) && /LPN job description, the RN supervision acknowledgment and our nursing documentation expectations/.test(txt) && /nurse orientation/.test(txt) && /Section 2 of the Missouri Personal Care Provider Manual/.test(txt) && /under the direction of our registered nurse/.test(txt))
ck('the nurse letter keeps the approved terms word for word (pay, hours paragraph, at will, seven business days, drug screening)', /Starting Pay: \$16\.00 per hour, paid weekly on Fridays/.test(txt) && /no minimum number of hours per week is guaranteed/.test(txt) && /Employment with Caring Companions is at will/.test(txt) && /seven \(7\) business days/.test(txt) && /drug screening required by Caring Companions' screening policy/.test(txt))
ck('no em dash and no "plain language" anywhere in the nurse letter', !/—/.test(txt) && !/plain (language|english)/i.test(txt))
r = await call({ action: 'sign', o: N2, e: ln2.e, t: ln2.t, doc: 'pd', typed_name: 'Pat Practice', consent: true })
ck('there is no position description to sign on a nurse offer', r.status === 409 && /only the offer letter/.test(r.j.error), r.j)
const kicks0 = KICKS.length
r = await call({ action: 'sign', o: N2, e: ln2.e, t: ln2.t, doc: 'offer', typed_name: 'Pat Practice', consent: true })
ck('signing the nurse letter completes the offer: accepted, version 1 recorded, PDF stored, Step 1 kicked once', r.status === 200 && r.j.accepted === true && r.j.version === 1 && OFFERS[N2].offer_status === 'accepted' && OFFERS[N2].offer_version === 1 && OFFERS[N2].offer_pdf_path && !OFFERS[N2].pd_signed_at && KICKS.length === kicks0 + 1 && KICKS.at(-1).body.offer_id === N2, r.j)
ck('the signed event carries the nurse letter version and its fingerprint', EVENTS.some((e) => e.offer_id === N2 && e.kind === 'signed' && e.doc_version === 1 && e.fingerprint === r.j.fingerprint))
/* ═══ 3. the previews ═══ */
let p = await call({ action: 'preview' })
ck('the default preview is the caregiver offer as before (both documents, versions 2 and 2)', p.status === 200 && p.j.pd && p.j.versions.offer === 2 && p.j.versions.pd === 2 && !p.j.letter_only)
p = await call({ action: 'preview', position: 'rn' })
const rt = (p.j.offer || []).map((b) => b.t).join('\n')
ck('the RN preview: the letter alone, Registered Nurse (RN), no RN supervision acknowledgment line (that is for an LPN), marked not approved yet', p.status === 200 && p.j.letter_only === true && p.j.pd === null && /Position: Registered Nurse \(RN\)/.test(rt) && !/RN supervision acknowledgment/.test(rt) && /RN job description and our nursing documentation expectations/.test(rt) && p.j.approved === false)
ck('the nurse letter is version 1 and NOT approved (NURSE_LETTER_APPROVED 0)', D.NURSE_OFFER_DOC_VERSION === 1 && D.NURSE_LETTER_APPROVED === 0 && D.nurseLetterApproved() === false)
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note));
const bad = res.filter((x) => !x[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0);
