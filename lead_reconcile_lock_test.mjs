// lead-reconcile under Node: the real function, a stand-in database. Only the private server key gets an answer.
import fs from 'fs'; import path from 'path';
const DIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'supabase/functions/lead-reconcile');
const src = fs.readFileSync(path.join(DIR, 'index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db');
const tmp = path.join(DIR, '_under_test.ts'); fs.writeFileSync(tmp, src);
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? '').slice(0, 300)]);
const SVC = 'svc.' + 'x'.repeat(40) + '.sig', ANON = 'anon.' + 'y'.repeat(40) + '.sig';
let handler; const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: SVC };
globalThis.Deno = { env: { get: k => env[k] }, serve: h => { handler = h; } };
let reads = 0;
globalThis.__db = { from: (t) => { const p = { select() { return p; }, in() { return p; }, range() { return p; },
  then(ok, bad) { reads++; const data = t === 'app_data' ? [{ key: 'leads', data: [{ id: 'a', phone: '4175550100' }] }, { key: 'ops_items', data: [] }]
    : t === 'identity_scan_cache' ? [{ ghl_contact_id: 'g1', first_name: 'Made', last_name: 'Up', phone: '+14175550199', tags: ['cc website lead'] }] : [];
    return Promise.resolve({ data, error: null }).then(ok, bad); } }; return p; } };
await import(tmp); fs.unlinkSync(tmp);
const call = async (auth) => { reads = 0; const r = await handler(new Request('http://x', { method: 'POST', headers: auth ? { Authorization: auth } : {}, body: '{}' })); return [r.status, await r.text(), reads]; };
let [s, b, n] = await call(null); ck('no sign-in: refused, nothing read', s === 403 && n === 0 && !/Made/.test(b), [s, b]);
[s, b, n] = await call('Bearer ' + ANON); ck("the Hub's public key: refused, nothing read, no names", s === 403 && n === 0 && !/Made/.test(b), [s, b]);
[s, b, n] = await call('Bearer eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.forged'); ck('a token that merely CLAIMS the service role: refused', s === 403 && n === 0, [s]);
[s, b, n] = await call('Bearer ' + SVC.slice(0, -1) + 'X'); ck('a near-miss of the private key: refused', s === 403 && n === 0, [s]);
[s, b, n] = await call('Bearer ' + SVC); ck("the owner's Desktop script (the private server key): answered as before", s === 200 && /the_gap/.test(b) && n > 0, [s, b.slice(0, 120)]);
const r = await handler(new Request('http://x', { method: 'OPTIONS' })); ck('a browser preflight still answers', r.status === 200);
let pass = 0; for (const [nm, ok, note] of res) { console.log((ok ? 'PASS ' : 'FAIL ') + nm + (ok ? '' : '\n     ' + note)); if (ok) pass++; }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1);
