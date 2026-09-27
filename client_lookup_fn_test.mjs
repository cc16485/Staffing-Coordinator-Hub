// client-lookup ("Is this family already known?") under Node. node client_lookup_fn_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)]);
const dir = 'supabase/functions/client-lookup';
const src = fs.readFileSync(dir + '/index.ts', 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db');
const tmp = path.join(process.cwd(), dir, '_t.ts'); fs.writeFileSync(tmp, src);
let handler;
const ENV = { SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'k', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485' };
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } };
/* the database: Family Circle contacts and circles; any write fails the test */
let writes = 0;
const TABLES = {
  circle_contacts: [{ id: 1, circle_id: 'c1', name: 'Dana Adams', relationship: 'Daughter', phone: '(417) 555-0900' },
                    { id: 2, circle_id: 'c2', name: 'Sam Old', relationship: 'Son', phone: '+14175550950' }],
  care_circles: [{ id: 'c1', client_name: 'Ruth Adams', axiscare_client_id: '10', active: true },
                 { id: 'c2', client_name: 'Walt Old', axiscare_client_id: null, active: false }],
};
globalThis.__db = { from: (t) => { const st = { f: [] }; const b = {
  select() { return b; }, order() { return b; }, range() { return b; },
  in(k, v) { st.f.push([k, v]); return b; }, eq(k, v) { st.f.push([k, [v]]); return b; },
  insert() { writes++; return b; }, update() { writes++; return b; }, upsert() { writes++; return b; }, delete() { writes++; return b; },
  then(ok) { return Promise.resolve({ data: (TABLES[t] || []).filter((r) => st.f.every(([k, v]) => v.map(String).includes(String(r[k])))), error: null }).then(ok); } }; return b; } };
const mod = await import(tmp); fs.unlinkSync(tmp);
const lib = await import(path.join(process.cwd(), 'supabase/functions/_shared/client-lookup.ts'));

const AX = [
  { id: 10, firstName: 'Ruth', lastName: 'Adams', dateOfBirth: '1938-04-02', status: { active: true, label: 'Active' }, homePhone: '417-555-0101' },
  { id: 11, firstName: 'Earl', lastName: 'Baker', dateOfBirth: '1930-01-01', status: { active: false, label: 'Discharged' }, mobilePhone: '4175550200', ssn: '123-45-6789' },
  { id: 12, firstName: 'William', goesBy: 'Bill', lastName: 'Cole', dateOfBirth: '1941-01-09', status: { active: false, label: 'Deceased' } },
  { id: 13, firstName: 'Mary', lastName: 'Evans', dateOfBirth: '1950-05-05', status: { active: false, label: 'Discharged' } },
  { id: 14, firstName: 'Mary', lastName: 'Evans', status: { active: false, label: 'Discharged' } },
];
let axCalls = [];
const fakeAx = async (url) => { axCalls.push(url);
  const p2 = url.includes('startAfterId');
  return new Response(JSON.stringify({ results: { clients: p2 ? AX.slice(3) : AX.slice(0, 3), nextPage: p2 ? null : 'https://16485.axiscare.com/api/clients?startAfterId=12' } }), { status: 200 }); };
const find = (b, f = fakeAx) => mod.find(b, globalThis.__db, f);
const byId = (d, id) => d.matches.find((m) => m.axiscare_client_id === id);

let d = await find({ phones: ['(417) 555-0200'], first: 'Joan', last: 'Smith' });
ck('a former client\'s own phone finds them, with their AxisCare status', byId(d, '11') && byId(d, '11').why.includes('phone') && byId(d, '11').active === false && byId(d, '11').status === 'Discharged', d);
ck('reads every AxisCare page (current and inactive clients)', axCalls.length === 2 && d.axiscare_ok, axCalls);
d = await find({ phones: ['4175550900'] });
ck('a relative\'s phone in the Family Circle finds the client, saying who it is', byId(d, '10') && byId(d, '10').why.includes('family_phone') && byId(d, '10').family[0] === 'Dana Adams, Daughter' && byId(d, '10').active === true, d);
d = await find({ phones: ['417.555.0950'] });
ck('a closed circle with no AxisCare number still shows, by the client\'s name', d.matches.length === 1 && d.matches[0].axiscare_client_id === null && d.matches[0].name === 'Walt Old' && d.matches[0].status === 'circle closed', d);
d = await find({ first: 'Ruth', last: 'adams', dob: '1938-04-02' });
ck('same name and birth date matches', byId(d, '10') && byId(d, '10').why.join() === 'name_dob' && byId(d, '10').strength === 3, d);
d = await find({ first: 'Bill', last: 'Cole', dob: '1941-01-09' });
ck('"goes by" counts as the first name', byId(d, '12') && byId(d, '12').why.join() === 'name_dob', d);
d = await find({ first: 'Billy', last: 'Cole', dob: '1941-01-09' });
ck('same last name and birth date, different first name: a weaker match', byId(d, '12') && byId(d, '12').why.join() === 'dob_last' && byId(d, '12').strength === 2, d);
d = await find({ first: 'Mary', last: 'Evans', dob: '1960-01-01' });
ck('same name with a DIFFERENT birth date is a different person (not shown); a record with no birth date is a hint only',
  !byId(d, '13') && byId(d, '14') && byId(d, '14').why.join() === 'name_only' && byId(d, '14').strength === 1, d);
d = await find({ first: 'Mary', last: 'Evans' });
ck('a name with no birth date is only ever a hint', d.matches.every((m) => m.why.join() === 'name_only'), d);
d = await find({ first: 'Ruth', last: '' });
ck('a first name alone looks for nothing (and doesn\'t call AxisCare)', d.matches.length === 0 && d.note === 'nothing to look for', d);
d = await find({ phones: ['4175550101', '4175550900'], first: 'Ruth', last: 'Adams', dob: '1938-04-02' });
ck('several reasons for one client become one row', d.matches.length === 1 && ['phone', 'family_phone', 'name_dob'].every((w) => byId(d, '10').why.includes(w)), d);
ck('the answer never carries a phone number, birth date or SSN', !/555|1938|123-45/.test(JSON.stringify(d)), d);
d = await find({ first: 'Mary', last: 'Evans', phones: ['4175550200'] });
ck('strongest first: a phone match ranks above a name-only hint', d.matches[0].axiscare_client_id === '11', d.matches.map((m) => m.axiscare_client_id));
d = await find({ phones: ['4175550900'] }, async () => new Response('{}', { status: 503 }));
ck('AxisCare down: says so, and the Family Circle still answers', d.axiscare_ok === false && /503/.test(d.axiscare_error) && byId(d, '10') && byId(d, '10').why.join() === 'family_phone', d);
d = await find({ phones: ['4175550200'] }, async () => new Response(JSON.stringify({ results: { clients: AX.slice(0, 2), nextPage: 'https://evil.example/x' } }), { status: 200 }));
ck('a next page on another site is refused, not followed', d.axiscare_ok === false && d.matches.length === 0, d);
ck('lookups never write anything', writes === 0);
ck('phone numbers compare on the last 10 digits', lib.last10('+1 (417) 555-0101') === '4175550101' && lib.last10('555-0101') === '');

/* who may call */
const tok = (c) => 'Bearer x.' + Buffer.from(JSON.stringify(c)).toString('base64url') + '.y';
globalThis.fetch = fakeAx;
const call = async (auth, body, method = 'POST') => { const r = await handler(new Request('http://x', { method, headers: auth ? { Authorization: auth } : {}, body: method === 'POST' ? JSON.stringify(body) : undefined })); return [r.status, r]; };
let [st, r] = await call(null, {}, 'OPTIONS');
ck('CORS preflight answers 200 with Allow-Origin', st === 200 && r.headers.get('Access-Control-Allow-Origin') === '*');
const s1 = (await call(null, { action: 'find' }))[0], s2 = (await call(tok({ role: 'anon' }), { action: 'find' }))[0], s3 = (await call(tok({ role: 'service_role' }), { action: 'find' }))[0];
ck('not signed in, the public key and the service key are refused', s1 === 401 && s2 === 401 && s3 === 401);
[st, r] = await call(tok({ role: 'authenticated', email: 'k@mo-care.com' }), { action: 'find', phones: ['4175550200'] });
const body = await r.json();
ck('signed-in staff get matches (with CORS on the answer)', st === 200 && body.matches[0].axiscare_client_id === '11' && r.headers.get('Access-Control-Allow-Origin') === '*', body);
[st] = await call(tok({ role: 'authenticated', email: 'k@mo-care.com' }), { action: 'link' });
ck("only 'find' exists", st === 400);

console.log('\nCLIENT-LOOKUP · TEST\n' + '='.repeat(60)); let ok = true;
for (const [n, g, note] of res) { ok &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')); }
console.log('='.repeat(60)); console.log(ok ? `ALL ${res.length} CHECKS PASS` : 'FAILED');
