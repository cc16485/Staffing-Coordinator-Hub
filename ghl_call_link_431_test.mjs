// 431 · ghl-call-link under Node: the real function, the real staff check and the real GHL lookup, a stand-in database
// and a FAKE GoHighLevel that records every call. node ghl_call_link_431_test.mjs
import fs from 'fs'; import path from 'path';
const DIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'supabase/functions/ghl-call-link');
const src = fs.readFileSync(path.join(DIR, 'index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient')
  .replace(/^import \{ ownerCaller \} from .*$/m, "const ownerCaller = async (req) => (req.headers.get('Authorization') || '').replace(/^Bearer\\s+/i, '') === globalThis.Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')");
const tmp = path.join(DIR, '_under_test.ts'); fs.writeFileSync(tmp, src);
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? '').slice(0, 600)]);
let handler = null; const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'Recp0AhyMh8lrtKJ9kaj' };
globalThis.Deno = { env: { get: k => env[k] }, serve: h => { handler = h; } };
const USERS = { good: { id: 'u1', email: 'kat@cc.test', app_metadata: { hub_access: ['care_coordinator'] } }, caregiver: { id: 'u5', email: 'z@cc.test', app_metadata: { hub_access: ['care_coordinator'] } } };
const DB = { auth_identities: [{ auth_user_id: 'u1', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p1' }, { auth_user_id: 'u5', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p5' }],
  persons: [{ person_id: 'p1', full_name: 'Kat', active: true }, { person_id: 'p5', full_name: 'Cg', active: true }],
  entity_memberships: [{ person_id: 'p1', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p5', entity: 'cc_ihs', active: true, ended_at: null }],
  staff_roles: [{ person_id: 'p1', entity: 'cc_ihs', role: 'care_coordinator' }, { person_id: 'p5', entity: 'cc_ihs', role: 'caregiver' }],
  person_source_id: [] };
globalThis.__fakeCreateClient = () => ({
  auth: { getUser: async (jwt) => USERS[jwt] ? { data: { user: USERS[jwt] }, error: null } : { data: null, error: { message: 'bad jwt' } } },
  from: (tb) => { const f = []; let single = false; const p = { select() { return p; }, eq(k, v) { f.push(r => String(r[k]) === String(v)); return p; },
      maybeSingle() { single = true; return p; }, then(ok, bad) { const rows = (DB[tb] || []).filter(r => f.every(fn => fn(r))); return Promise.resolve({ data: single ? (rows[0] || null) : rows, error: null }).then(ok, bad); } }; return p; },
  rpc: async () => { throw new Error('no rpc expected') } });
let GHLC = [], CALLS = [], FAIL = false
globalThis.fetch = async (url, o) => { url = String(url); CALLS.push({ method: (o && o.method) || 'GET', url })
  if (FAIL) return new Response('{"message":"down"}', { status: 503 })
  if (/leadconnectorhq\.com\/contacts\/\?/.test(url)) { const q = new URL(url).searchParams.get('query') || ''
    return new Response(JSON.stringify({ contacts: GHLC.filter((c) => (c.phone && c.phone.replace(/\D/g, '').endsWith(q)) || (c.email && c.email.toLowerCase() === q.toLowerCase())) }), { status: 200 }) }
  return new Response('{}', { status: 404 }) }
await import(tmp); fs.unlinkSync(tmp);
const call = async (who, body) => { const r = await handler(new Request('http://x', { method: 'POST', headers: who ? { Authorization: 'Bearer ' + who } : {}, body: JSON.stringify(body) })); return [r.status, await r.json()]; };
const onlyGets = () => CALLS.every((c) => c.method === 'GET' && /\/contacts\/\?/.test(c.url))
const L = 'Recp0AhyMh8lrtKJ9kaj'

let r = await handler(new Request('http://x', { method: 'OPTIONS' })); ck('a browser preflight answers, with CORS', r.status === 200 && r.headers.get('Access-Control-Allow-Origin') === '*');
r = await handler(new Request('http://x', { method: 'GET' })); ck('GET is refused', r.status === 405);
let [s, b] = await call(null, { phone: '4175550777' }); ck('no sign-in: refused and GHL is never asked', s === 401 && !CALLS.length, [s, b]);
[s, b] = await call('anon-key-jwt', { phone: '4175550777' }); ck('the public key (not a staff sign-in): refused, GHL never asked', s === 401 && !CALLS.length, [s, b]);
[s, b] = await call('caregiver', { phone: '4175550777' }); ck('a signed-in person without an office role: refused, GHL never asked', s === 403 && !CALLS.length, [s, b]);

GHLC = [{ id: 'gRuth', phone: '+1 (417) 555-0777' }]; CALLS = [];
[s, b] = await call('good', { phone: '(417) 555-0777' })
ck('one contact: found, contact id and both links', s === 200 && b.found === true && b.contact_id === 'gRuth'
   && b.app_url === `https://app.leadconnectorhq.com/v2/location/${L}/contacts/detail/gRuth`
   && b.web_url === `https://app.hirecara.com/v2/location/${L}/contacts/detail/gRuth`, b)
ck('only the id and the two links come back (no name, phone, tags or notes from GHL)', Object.keys(b).sort().join() === 'app_url,contact_id,found,web_url', b)
ck('a GET search by the last 10 digits, nothing else', CALLS.length === 1 && onlyGets() && /query=4175550777/.test(CALLS[0].url), CALLS)
GHLC = []; CALLS = []; [s, b] = await call('good', { phone: '4175550777' })
ck('no contact: found false, why not_found, and nothing is created', s === 200 && b.found === false && b.why === 'not_found' && onlyGets(), [b, CALLS])
GHLC = [{ id: 'a', phone: '4175550777' }, { id: 'b', phone: '+14175550777' }]; CALLS = []; [s, b] = await call('good', { phone: '4175550777' })
ck('several contacts share the line: found false, why several (software never picks)', b.found === false && b.why === 'several' && onlyGets(), b)
GHLC = [{ id: 'x', phone: '4175559999' }, { id: 'y', phone: '9994175550777' }]; [s, b] = await call('good', { phone: '4175550777' })
ck('a loose search result with another number is not used; same last 10 digits counts as the same number', b.found === true && b.contact_id === 'y', b)
GHLC = [{ id: 'a', phone: '4175550777' }, { id: 'm', email: 'ann@example.com' }]; [s, b] = await call('good', { phone: '4175550777', email: 'Ann@Example.com' })
ck('phone finds one person, email another: several, no link', b.found === false && b.why === 'several', b)
GHLC = [{ id: 'a', phone: '4175550777', email: 'ann@example.com' }]; [s, b] = await call('good', { phone: '4175550777', email: 'ann@example.com' })
ck('phone and email agree: found', b.found === true && b.contact_id === 'a', b)
GHLC = [{ id: 'm', email: 'ann@example.com' }]; [s, b] = await call('good', { email: 'ann@example.com' })
ck('email alone can find one contact', b.found === true && b.contact_id === 'm', b)
CALLS = []; [s, b] = await call('good', { phone: '555' }); ck('no usable number or email: why no_number, GHL never asked', b.found === false && b.why === 'no_number' && !CALLS.length, b)
FAIL = true; GHLC = [{ id: 'a', phone: '4175550777' }]; [s, b] = await call('good', { phone: '4175550777' }); FAIL = false
ck('GHL is down: found false, why error (the page says so and offers the cell)', s === 200 && b.found === false && b.why === 'error', b)
DB.person_source_id = [{ person_id: 'P1', system: 'axiscare', entity_type: 'client', source_id: '701', confidence: 'confirmed', needs_review: false },
                       { person_id: 'P1', system: 'ghl', entity_type: 'client', source_id: 'gStored', confidence: 'confirmed', needs_review: false }]
CALLS = []; [s, b] = await call('good', { phone: '4175550777', axiscare_client_id: '701' })
ck('a confirmed GHL link the Hub already holds for that client is used, with no search', b.found === true && b.contact_id === 'gStored' && !CALLS.length, [b, CALLS])
DB.person_source_id[1].confidence = 'probable'; [s, b] = await call('good', { phone: '4175550777', axiscare_client_id: '701' })
ck('a probable (unreviewed) link is not trusted: the search decides', b.found === true && b.contact_id === 'a', b)
env.GHL_LOCATION_ID = ''; [s, b] = await call('good', { phone: '4175550777' }); env.GHL_LOCATION_ID = L
ck('no GHL location configured: why not_set_up', b.found === false && b.why === 'not_set_up', b)
env.GHL_LOCATION_ID = 'bad/../id'; [s, b] = await call('good', { phone: '4175550777' }); env.GHL_LOCATION_ID = L
ck('a location id that is not a plain id never goes into a link', b.found === false && b.why === 'not_set_up', b)
ck('across every call: GET searches only; never a create, update, tag or message', CALLS.every((c) => c.method === 'GET') && !CALLS.some((c) => /upsert|conversations|tags/.test(c.url)), CALLS)
{ const lib = fs.readFileSync(path.join(DIR, '../_shared/ghl-contact-link.ts'), 'utf8').replace(/^\s*\/\/.*$/gm, '')
  ck('source · the shared lookup has no POST/PUT/DELETE, no upsert, no send', !/method: '(POST|PUT|DELETE)'|upsert|conversations\/messages|contactForOutbound/.test(lib))
  const fn = fs.readFileSync(path.join(DIR, 'index.ts'), 'utf8')
  ck('source · the function checks the staff sign-in before anything else', fn.indexOf('requireStaff(sb, req') > 0 && fn.indexOf('requireStaff(sb, req') < fn.indexOf('ghlFindContact(sb'))
  ck('source · no em dash', !/\u2014/.test(fn + lib)) }
let pass = 0; for (const [nm, ok, note] of res) { console.log((ok ? 'PASS ' : 'FAIL ') + nm + (ok ? '' : '\n     ' + note)); if (ok) pass++; }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1);
