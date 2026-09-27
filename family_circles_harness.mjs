// Change 6a · family-circles under Node: real code, fake database, fake AxisCare responsible parties.
import fs from 'fs'; import path from 'path';
const src = fs.readFileSync(process.argv[2], 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db');
const tmp = path.join(process.cwd(), '_fcf_under_test.ts'); fs.writeFileSync(tmp, src);
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note).slice(0, 900)]);
let handler; const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485' };
globalThis.Deno = { env: { get: k => env[k] }, serve: h => { handler = h; } };
let DB, RP, puts, rpcs, cfg;
const reset = () => {
  puts = []; rpcs = []; cfg = {};
  DB = { care_circles: [{ id: 'C1', client_name: 'Ruth Jones', axiscare_client_id: '501', active: true }, { id: 'C2', client_name: 'Typed', axiscare_client_id: null, active: true }],
    circle_contacts: [{ id: 1, circle_id: 'C1', name: 'Cathy Jones', relationship: 'Daughter', phone: '111', email: null, source: 'axiscare', axiscare_list_number: 1 },
      { id: 2, circle_id: 'C1', name: 'Pastor Tim', relationship: 'Pastor', phone: '999', email: 'tim@x', source: 'office' },
      { id: 3, circle_id: 'C2', name: 'Someone', source: 'axiscare', axiscare_list_number: 1 }] };
  RP = { '501': { 1: { listNumber: '1', name: 'Cathy Jones', relationship: 'Daughter', email: '', dateOfBirth: '1970-01-01', address: { line1: '1 Elm', city: 'Springfield', state: 'MO', zip: '65802' },
      phones: [{ type: 'Home', number: '555' }, { type: 'Mobile', number: '111' }], hipaaDisclosureAuthorization: '1', canMakeMedicalDecisions: '0' } } };
};
reset();
const R = (s, b) => new Response(JSON.stringify(b), { status: s });
globalThis.fetch = async (u, o = {}) => { const url = new URL(String(u)), m = (o.method || 'GET').toUpperCase(); let x;
  if ((x = /\/api\/clients\/(\d+)\/responsibleParties$/.exec(url.pathname)) && m === 'GET') return R(200, { results: Object.values(RP[x[1]] || {}) });
  if ((x = /\/api\/clients\/(\d+)\/responsibleParties\/(\d)$/.exec(url.pathname))) {
    if (m === 'GET') { const p = (RP[x[1]] || {})[x[2]]; return p ? R(200, { results: p }) : R(404, {}); }
    if (m === 'PUT') { if (cfg.forbid) return R(403, { errors: ['forbidden'] }); const b = JSON.parse(o.body); puts.push({ slot: x[2], b });
      (RP[x[1]] ||= {})[x[2]] = { listNumber: x[2], ...b, hipaaDisclosureAuthorization: b.hipaaDisclosureAuthorization === true ? '1' : b.hipaaDisclosureAuthorization === false ? '0' : '',
        canMakeMedicalDecisions: b.canMakeMedicalDecisions === true ? '1' : b.canMakeMedicalDecisions === false ? '0' : '' }; return R(200, { results: Object.values(RP[x[1]]) }); } }
  throw new Error('unexpected ' + m + ' ' + url); };
globalThis.__db = { from: (t) => { const f = []; let op = 'select', payload; const p = { select() { return p; }, eq(k, v) { f.push(r => String(r[k]) === String(v)); return p; },
    update(pl) { op = 'update'; payload = pl; return p; }, maybeSingle() { return p.then(r => ({ data: (r.data || [])[0] || null, error: null })); },
    then(ok, bad) { const T = DB[t]; if (op === 'update') { T.filter(r => f.every(g => g(r))).forEach(r => Object.assign(r, payload)); return Promise.resolve({ data: null, error: null }).then(ok, bad); }
      return Promise.resolve({ data: T.filter(r => f.every(g => g(r))), error: null }).then(ok, bad); } }; return p; },
  rpc: async (n, a) => { rpcs.push({ n, a }); return { data: { outcome: n === 'family_circle_link' ? 'linked' : 'unlinked' }, error: null }; } };
await import(tmp); fs.unlinkSync(tmp);
const tok = (c) => 'Bearer x.' + Buffer.from(JSON.stringify(c)).toString('base64url') + '.y';
const KAT = tok({ role: 'authenticated', email: 'kat@cc.test' });
const call = async (auth, body) => { const r = await handler(new Request('http://x', { method: 'POST', headers: { Authorization: auth }, body: JSON.stringify(body) })); return [r.status, await r.json()]; };
const c = (id) => DB.circle_contacts.find(x => x.id === id);

let r = await handler(new Request('http://x', { method: 'OPTIONS' }));
ck('CORS preflight answered from day one', r.status === 200 && r.headers.get('Access-Control-Allow-Origin') === '*');
let [st] = await call(tok({ role: 'anon' }), { action: 'link' });
ck('a signed-in person is required', st === 401);
let [s0, b] = await call(KAT, { action: 'link', circle_id: 'C2', axiscare_client_id: '777' });
ck('link goes through the door as that person', b.outcome === 'linked' && rpcs[0].n === 'family_circle_link' && rpcs[0].a.p_staff === 'kat@cc.test' && rpcs[0].a.p_how === 'person', rpcs);
[s0, b] = await call(KAT, { action: 'unlink', circle_id: 'C1', reason: 'wrong Ruth' });
ck('unlink passes the reason to the door', b.outcome === 'unlinked' && rpcs[1].a.p_reason === 'wrong Ruth', rpcs);
[s0, b] = await call(KAT, { action: 'rp_view', contact_id: 1 });
ck('view: AxisCare\'s slot side by side with the hub\'s copy (HIPAA yes, medical no, mobile phone)', b.axiscare.hipaa_authorized === true && b.axiscare.can_make_medical_decisions === false && b.axiscare.phone === '111' && b.hub.name === 'Cathy Jones', b);
[s0, b] = await call(KAT, { action: 'rp_write', contact_id: 1, name: 'Cathy Jones', relationship: 'Daughter', phone: '222', email: 'cathy@x' });
const put = puts[0].b;
ck('write: AxisCare\'s slot keeps everything else (address, birth date, home phone, HIPAA yes, medical no); only the four fields change',
  put.address.line1 === '1 Elm' && put.dateOfBirth === '1970-01-01' && put.hipaaDisclosureAuthorization === true && put.canMakeMedicalDecisions === false
  && put.phones.find(p => p.type === 'Home').number === '555' && put.phones.find(p => p.type === 'Mobile').number === '222' && put.email === 'cathy@x', put);
ck('write: read back, and the hub copy updated from what AxisCare now holds', b.outcome === 'saved' && c(1).phone === '222' && c(1).email === 'cathy@x' && c(1).hipaa_authorized === true, { b, c1: c(1) });
[s0, b] = await call(KAT, { action: 'rp_write', contact_id: 2, name: 'x' });
ck('write: an office-typed member is not written through "edit"; use Add to AxisCare', b.outcome === 'not_axiscare_member', b);
[s0, b] = await call(KAT, { action: 'rp_write', contact_id: 3, name: 'x' });
ck('a circle not linked to a client: nothing is written', b.outcome === 'circle_not_linked' && puts.length === 1, b);
[s0, b] = await call(KAT, { action: 'rp_add', contact_id: 2 });
ck('add: an office-typed member goes into the first FREE slot (2), is read back, and becomes AxisCare-owned',
  b.outcome === 'added' && b.list_number === 2 && puts[1].slot === '2' && c(2).source === 'axiscare' && c(2).axiscare_list_number === 2 && puts[1].b.hipaaDisclosureAuthorization === undefined, { b, put: puts[1] });
reset(); RP['501'][2] = { listNumber: '2', name: 'B' }; RP['501'][3] = { listNumber: '3', name: 'C' };
[s0, b] = await call(KAT, { action: 'rp_add', contact_id: 2 });
ck('add: no free slot (AxisCare holds three) says so; nothing written', b.outcome === 'no_free_slot' && puts.length === 0, b);
reset(); RP['501'][2] = { listNumber: '2', name: 'Pastor Tim' };
[s0, b] = await call(KAT, { action: 'rp_add', contact_id: 2 });
ck('add: AxisCare already lists that name; nothing written', b.outcome === 'already_listed' && puts.length === 0, b);
reset(); cfg.forbid = true;
[s0, b] = await call(KAT, { action: 'rp_write', contact_id: 1, name: 'Cathy Jones', phone: '222' });
ck('AxisCare refusing (403) is shown; the hub copy is not changed', b.outcome === 'refused' && /may not change responsible parties/.test(b.detail) && c(1).phone === '111', b);

let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '\n     ' + note)); if (ok) pass++; }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1);
