// Change 2 · client-convert under Node: the field mapping, and the real function against a fake AxisCare + fake database.
// node client_convert_harness.mjs supabase/functions/client-convert/index.ts
import fs from 'fs'; import path from 'path';
const FN = process.argv[2];
const src = fs.readFileSync(FN, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient');
const tmp = path.join(process.cwd(), '_client_convert_under_test.ts'); fs.writeFileSync(tmp, src);
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note).slice(0, 800)]);
let handler = null; const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485' };
globalThis.Deno = { env: { get: k => env[k] }, serve: h => { handler = h; } };

// ── fake AxisCare ──
let AX, calls, cfg;
const reset = () => { AX = { next: 500, clients: { 290: { id: 290, firstName: 'Test', lastName: 'Client 5', priorityNote: 'keep me', rps: [] } } }; calls = []; cfg = {}; };
reset();
const R = (s, b) => new Response(JSON.stringify(b), { status: s });
globalThis.fetch = async (u, o = {}) => {
  const url = new URL(String(u)), m = (o.method || 'GET').toUpperCase(), body = o.body ? JSON.parse(o.body) : undefined;
  calls.push([m, url.pathname + url.search, body]);
  if (cfg.forbid && m !== 'GET') return R(403, { errors: ['forbidden'] });
  let x;
  if (m === 'GET' && url.pathname === '/api/clients') {
    const ext = url.searchParams.get('externalIds');
    const rows = Object.values(AX.clients).filter(c => c.externalId === ext);
    return rows.length || !cfg.empty404 ? R(200, { results: { clients: rows } }) : R(404, { errors: ['No clients found'] });
  }
  if (m === 'POST' && url.pathname === '/api/clients') {
    if (cfg.full400 && Object.keys(body).length > 3) return R(400, { errors: ['homePhone is invalid'] });
    const id = AX.next++; AX.clients[id] = { id, ...body, rps: [] }; return R(200, { results: { id } });
  }
  if ((x = /^\/api\/clients\/(\d+)$/.exec(url.pathname))) {
    const c = AX.clients[x[1]]; if (!c) return R(404, {});
    if (m === 'GET') { const { rps, ...rest } = c; return R(200, { results: rest }); }
    if (m === 'PATCH') {
      if (cfg.referral400 && body.referredBy) return R(400, { errors: ['referredBy not found'] });
      if (cfg.badPhone && (body.homePhone || body.mobilePhone)) return R(400, { errors: ['phone invalid'] });
      Object.assign(c, body); return R(200, { results: { id: c.id } });
    }
  }
  if ((x = /^\/api\/clients\/(\d+)\/responsibleParties(?:\/(\d))?$/.exec(url.pathname))) {
    const c = AX.clients[x[1]]; if (!c) return R(404, {});
    if (m === 'GET') return R(200, { results: c.rps });
    if (m === 'PUT') { c.rps = c.rps.filter(p => p.listNumber !== x[2]).concat([{ listNumber: x[2], ...body }]); return R(200, { results: c.rps }); }
  }
  if ((x = /^\/api\/notes\/client\/(\d+)$/.exec(url.pathname)) && m === 'POST') { (AX.clients[x[1]].notes ||= []).push(body.note); return R(200, { results: { id: 1 } }); }
  throw new Error('unexpected ' + m + ' ' + url);
};
// ── fake database ──
const LEADS = [
  { id: 'L1', first_name: 'Cathy', last_name: 'Jones', relationship: 'Daughter', phone: '417-555-0101', email: 'cathy@example.com',
    client_first_name: 'Ruth', client_last_name: 'Jones', client_dob: '1941-03-02', client_gender: 'Female', client_address: '12 Elm St', client_city: 'Springfield',
    client_state: 'mo', client_zip: '65802', client_phone: '417-555-0199', dcn: '12345678', assessment_at: '2026-09-24T02:30:00Z', referral_org_id: 'O1',
    client_attributes: { dementia: 'yes', cats: 'no' }, funding_source: 'Medicaid', interest_notes: 'Needs help mornings' },
  { id: 'L2', first_name: 'Pat', last_name: 'Doe', relationship: 'Case Manager', phone: '417-555-0102', client_first_name: 'Al', client_last_name: 'Ray' },
  { id: 'L3', first_name: 'Sam', last_name: 'Lee', relationship: 'Self', phone: '417-555-0103', email: 'sam@example.com', client_gender: 'Unknown' },
  { id: 'L4', first_name: 'Kim', last_name: 'Fox', relationship: 'Son', phone: '417-555-0104', client_name_not_provided: true },
  { id: 'L5', first_name: 'Jo', last_name: 'Ng', relationship: 'Niece', client_first_name: 'Bea', client_last_name: 'Ng', axiscare_client_id: '77' },
];
globalThis.__fakeCreateClient = () => ({ from: (t) => { const f = []; const p = { select() { return p; }, eq(k, v) { f.push([k, v]); return p; },
  maybeSingle() { const key = (f.find(x => x[0] === 'key') || [])[1];
    const data = key === 'leads' ? LEADS : key === 'referral_orgs' ? [{ id: 'O1', name: 'Mercy Hospital' }] : null;
    return Promise.resolve({ data: data ? { data } : null, error: null }); } }; return p; } });
const M = await import(tmp); fs.unlinkSync(tmp);
const tok = (c) => 'Bearer x.' + Buffer.from(JSON.stringify(c)).toString('base64url') + '.y';
const STAFF = tok({ role: 'authenticated', email: 'Kat@CC.test' }), SVC = tok({ role: 'service_role' }), ANON = tok({ role: 'anon' });
const call = async (auth, body) => { const r = await handler(new Request('http://x', { method: 'POST', headers: { Authorization: auth }, body: JSON.stringify(body) })); return [r.status, await r.json()]; };
const writes = () => calls.filter(c => c[0] !== 'GET');

// ── mapping ──
let p = M.planConvert(LEADS[0], null, '2026-09-26', 'Mercy Hospital');
ck('family caller: the CLIENT gets her own name, birth date, M/F gender, full address, her own phone (home), DCN, dates and the lead tag',
  p.ok && p.client.firstName === 'Ruth' && p.client.dateOfBirth === '1941-03-02' && p.client.gender === 'F' && p.client.residentialAddress.state === 'MO'
  && p.client.homePhone === '417-555-0199' && !p.client.mobilePhone && p.client.medicaidNumber === '12345678' && p.client.conversionDate === '2026-09-26'
  && p.client.externalId === 'cchub-lead:L1', p);
ck('Gate 4b: the caller\'s email and phone never go on the client, and Convert plans no responsible party at all (the coordinator picks, in People going into care)',
  !p.client.personalEmail && !('rp1' in p) && !('rp1_candidate' in p) && !JSON.stringify(p.client).includes('417-555-0101'), p);
ck('assessment date is read on Springfield\'s calendar (9:30pm Sep 23, not Sep 24 UTC)', p.client.assessmentDate === '2026-09-23', p.client.assessmentDate);
ck('referral source goes as "other" with the organisation\'s name', p.referral && p.referral.type === 'other' && p.referral.name === 'Mercy Hospital', p.referral);
p = M.planConvert(LEADS[0], { phone_type: 'mobile' }, '2026-09-26', null);
ck('the coordinator can say the client\'s phone is a mobile', p.client.mobilePhone === '417-555-0199' && !p.client.homePhone);
p = M.planConvert(LEADS[1], null, '2026-09-26', null);
ck('a professional caller (case manager): no client phone is invented, and the preview says the client\'s own phone is missing',
  p.ok && !p.client.homePhone && !p.client.mobilePhone && p.missing.some(x => /client's own phone/.test(x)), p);
ck('...and an old page asking for Responsible Party 1 gets no responsible party', !('rp1' in M.planConvert(LEADS[1], { rp1: true }, '2026-09-26', null)));
p = M.planConvert(LEADS[2], null, '2026-09-26', null);
ck('the caller is the client (Self): their name, phone and email go on the client; no responsible party; unknown gender left blank',
  p.ok && p.client.firstName === 'Sam' && p.client.homePhone === '417-555-0103' && p.client.personalEmail === 'sam@example.com' && !p.client.gender, p);
p = M.planConvert(LEADS[3], null, '2026-09-26', null);
ck('no client name and the caller is not the client: Convert is blocked (never the caller\'s name)', !p.ok && /own first and last name/.test(p.blockers[0]), p);
p = M.planConvert(Object.assign({}, LEADS[0], { client_state: 'Missouri' }), null, '2026-09-26', null);
ck('an incomplete or badly formed address is not sent at all, and the preview says what is missing', !p.client.residentialAddress && p.missing.some(x => /state/.test(x)), p.missing);
ck('professional wording is recognised', ['Social Worker', 'discharge planner', 'RN at Mercy', 'Hospice nurse'].every(M.isProfessional) && !['Daughter', 'Friend', 'Neighbor', 'Wife'].some(M.isProfessional));
ck('the intake note keeps the attributes checklist (live-in no longer listed)', /YES  Dementia/.test(M.intakeNote(LEADS[0])) && !/Live-In/.test(M.intakeNote(LEADS[0])));

// ── the function ──
let [st, b] = await call(ANON, { action: 'preview', lead_id: 'L1' });
let [st2] = await call(STAFF, { action: 'permission_check' });
ck('access: a signed-in person is required; the permission check is for the owner script only', st === 401 && st2 === 403);
[st, b] = await call(STAFF, { action: 'preview', lead_id: 'L1' });
ck('preview: shows the plan from the lead as saved, reads only', st === 200 && b.plan.client_name === 'Ruth Jones' && b.plan.referral.name === 'Mercy Hospital' && writes().length === 0 && b.existing.length === 0, b);
reset(); [st, b] = await call(STAFF, { action: 'convert', lead_id: 'L1' });
const cl = AX.clients[b.axiscare_client_id];
ck('convert: creates the whole client in one go, then the referral and the intake note; NO responsible party is written (Gate 4b)',
  b.outcome === 'created' && cl.homePhone === '417-555-0199' && cl.externalId === 'cchub-lead:L1' && cl.referredBy.name === 'Mercy Hospital'
  && cl.rps.length === 0 && !calls.some(c => /responsibleParties/.test(c[1])) && cl.notes.length === 1 && Object.values(b.steps).every(s => s.ok), b);
ck('convert: reads AxisCare back and reports what it now holds, plus the hand steps', b.readback.address && b.readback.phone && b.readback.medicaid_number
  && b.readback.referral && !b.readback.email && b.hand_steps.length === 3 && b.record.by === 'kat@cc.test' && b.record.rp1 === false, b);
const creates = () => calls.filter(c => c[0] === 'POST' && c[1] === '/api/clients').length;
[st, b] = await call(STAFF, { action: 'convert', lead_id: 'L1' });
ck('retry (the hub never saved the id): finds the client it already made; no second client, no second note', b.outcome === 'reused' && creates() === 1 && cl.notes.length === 1, b);
reset(); cfg.full400 = true; cfg.badPhone = true; [st, b] = await call(STAFF, { action: 'convert', lead_id: 'L1' });
const c2 = AX.clients[b.axiscare_client_id];
ck('AxisCare refuses the full record: the client is still created, each part added on its own, and the part it refused is named',
  b.outcome === 'created' && c2.externalId === 'cchub-lead:L1' && c2.medicaidNumber === '12345678' && c2.residentialAddress && !c2.homePhone
  && b.failed_fields.length === 1 && /^phone/.test(b.failed_fields[0]) && b.steps.full_record.ok === false, b);
reset(); cfg.referral400 = true; [st, b] = await call(STAFF, { action: 'convert', lead_id: 'L1' });
ck('a refused referral source doesn\'t block anything else', b.outcome === 'created' && b.steps.referral.ok === false && !b.steps.responsible_party && b.steps.intake_note.ok, b);
reset(); cfg.forbid = true; [st, b] = await call(STAFF, { action: 'convert', lead_id: 'L1' });
ck('no permission to change clients (403): stops and says so; nothing else attempted', b.outcome === 'error' && /may not change clients/.test(b.detail) && writes().length === 1, b);
reset(); cfg.empty404 = true; [st, b] = await call(STAFF, { action: 'convert', lead_id: 'L2' });
ck('AxisCare answering "none found" with a 404 is read as no existing client', b.outcome === 'created' && !AX.clients[b.axiscare_client_id].rps.length, b);
reset(); [st, b] = await call(STAFF, { action: 'convert', lead_id: 'L5' });
ck('a lead already linked to an AxisCare client is refused without calling AxisCare', b.outcome === 'already_linked' && calls.length === 0, b);
reset(); [st, b] = await call(STAFF, { action: 'convert', lead_id: 'L4' });
ck('a blocked plan (no client name) never reaches AxisCare', b.outcome === 'blocked' && calls.length === 0, b);
reset(); AX.clients[601] = { id: 601, externalId: 'cchub-lead:L1', rps: [] }; AX.clients[602] = { id: 602, externalId: 'cchub-lead:L1', rps: [] };
[st, b] = await call(STAFF, { action: 'convert', lead_id: 'L1' });
ck('two AxisCare clients already carry this lead: a person must choose; nothing is written', b.outcome === 'duplicate' && writes().length === 0, b);
reset(); [st, b] = await call(SVC, { action: 'permission_check' });
ck('permission check: writes Test Client 5\'s own priority note back unchanged and confirms it', b.ok === true && AX.clients[290].priorityNote === 'keep me'
  && writes().length === 1 && writes()[0][1] === '/api/clients/290' && JSON.stringify(writes()[0][2]) === '{"priorityNote":"keep me"}', b);
reset(); AX.clients[290].firstName = 'Real'; AX.clients[290].lastName = 'Person'; [st, b] = await call(SVC, { action: 'permission_check' });
ck('permission check: if #290 is not a test client it writes nothing', b.ok === false && writes().length === 0, b);
let r = await handler(new Request('http://x', { method: 'OPTIONS' }));
ck('CORS preflight answered from day one', r.status === 200 && r.headers.get('Access-Control-Allow-Origin') === '*');

let pass = 0;
for (const [name, ok, note] of res) { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n     ' + note)); if (ok) pass++; }
console.log(`\n${pass}/${res.length} passed`);
process.exit(pass === res.length ? 0 : 1);
