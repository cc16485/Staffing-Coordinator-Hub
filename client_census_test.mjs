// client-census-report · the Clients directory's AxisCare read (2026-10-12).
// node client_census_test.mjs
import fs from 'fs'; import path from 'path';
let src = fs.readFileSync('supabase/functions/client-census-report/index.ts', 'utf8')
  .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => ({})')
  .replace(/^import \{ OFFICE_ROLES, requireStaff \} from .*$/m,
    "const OFFICE_ROLES = ['owner_admin']; const requireStaff = async (_a, req) => req.headers.get('Authorization') === 'Bearer staff' ? { ok: true } : (req.headers.get('Authorization') ? { ok: false, status: 403, error: 'no' } : { ok: false, status: 401, error: 'Sign in first.' });");
const tmp = path.join(process.cwd(), '_census_under_test.ts'); fs.writeFileSync(tmp, src);
let handler; const env = { SUPABASE_URL: 'http://sb', SUPABASE_SERVICE_ROLE_KEY: 'k', AXISCARE_API_KEY: 'tok', AXISCARE_SITE: '16485' };
globalThis.Deno = { env: { get: k => env[k] }, serve: h => { handler = h; } };
const mod = await import(tmp); fs.unlinkSync(tmp);
const pages = {
  'https://16485.axiscare.com/api/clients': { results: { clients: [
    { id: 7, firstName: 'Dan', lastName: 'Example', status: { active: true, label: 'Active' }, mobilePhone: '4175550100', dateOfBirth: '1940-01-01',
      residentialAddress: { city: 'Joplin', street1: '1 Main' }, classes: { 0: { label: 'Level 2' }, 1: { code: 'PRIVATE' } } }],
    nextPage: 'https://16485.axiscare.com/api/clients?page=2' } },
  'https://16485.axiscare.com/api/clients?page=2': { results: { clients: { 0: { id: 8, firstName: 'Ann', lastName: 'Past', status: { active: false, label: 'Discharged' } } } } },
};
let calls = 0;
globalThis.fetch = async (url) => { calls++; const b = pages[url]; return { ok: !!b, status: b ? 200 : 500, json: async () => b }; };
const call = async (auth, method = 'POST') => {
  const r = await handler(new Request('http://x', { method, headers: auth ? { Authorization: auth } : {}, body: method === 'POST' ? '{}' : undefined }));
  return { s: r.status, h: r.headers, j: method === 'POST' ? await r.json() : null };
};
const pre = await call(null, 'OPTIONS'), none = await call(null), anon = await call('Bearer anon');
const n0 = calls; const ok = await call('Bearer staff');
const dan = ok.j.clients?.[0] || {};
env.AXISCARE_API_KEY = ''; const nocreds = await call('Bearer staff');
const res = [
  ['the Hub can reach it from the browser (preflight answers with CORS)', pre.s === 200 && pre.h.get('Access-Control-Allow-Origin') === '*'],
  ['nobody signed in is refused, before AxisCare is asked', none.s === 401 && n0 === 0],
  ['someone who is not office staff is refused', anon.s === 403 && n0 === 0],
  ['office staff get every client, both pages, current and past', ok.s === 200 && ok.j.total === 2 && ok.j.truncated === false],
  ['a row carries name, status, city and care classes', dan.id === '7' && dan.first === 'Dan' && dan.active === true && dan.city === 'Joplin' && dan.classes.join('|') === 'Level 2|PRIVATE'],
  ['no phone, street or birth date leaves the function', !JSON.stringify(ok.j).match(/4175550100|1 Main|1940/)],
  ['index-keyed AxisCare lists still read (the 172 lesson)', ok.j.clients?.[1]?.id === '8' && ok.j.clients[1].active === false],
  ['errors answer CORS too, so the page can show them', nocreds.s === 502 && nocreds.h.get('Access-Control-Allow-Origin') === '*'],
  ['the row helper is the only shape', typeof mod.clientRow === 'function'],
];
let pass = 0; for (const [n, good] of res) { console.log((good ? 'PASS ' : 'FAIL ') + n); if (good) pass++; }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1);
