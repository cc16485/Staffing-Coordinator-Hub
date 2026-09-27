// Change 3 follow-up · client-admission-scan accepts a service-role JWT OR the project's exact server secret; nothing else.
// node admission_scan_auth_test.mjs supabase/functions/client-admission-scan/index.ts
import fs from 'fs'; import path from 'path';
const src = fs.readFileSync(process.argv[2], 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => ({})');
const tmp = path.join(process.cwd(), '_scan_under_test.ts'); fs.writeFileSync(tmp, src);
let handler; const env = { SUPABASE_URL: 'http://sb', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_abc123XYZ' };   // newer non-JWT format; no AxisCare creds
globalThis.Deno = { env: { get: k => env[k] }, serve: h => { handler = h; } };
await import(tmp); fs.unlinkSync(tmp);
const tok = (c) => 'Bearer x.' + Buffer.from(JSON.stringify(c)).toString('base64url') + '.y';
const st = async (auth) => (await handler(new Request('http://x', { method: 'POST', headers: auth ? { Authorization: auth } : {}, body: '{}' }))).status;
const res = [[ 'the exact server secret passes the door (then stops at missing AxisCare creds: 502)', await st('Bearer sb_secret_abc123XYZ') === 502 ],
  [ 'a service-role JWT still passes', await st(tok({ role: 'service_role' })) === 502 ],
  [ 'the public key is refused', await st(tok({ role: 'anon' })) === 403 ],
  [ 'a signed-in person is refused', await st(tok({ role: 'authenticated' })) === 403 ],
  [ 'a near-miss secret is refused', await st('Bearer sb_secret_abc123XYz') === 403 ],
  [ 'a longer string starting with the secret is refused', await st('Bearer sb_secret_abc123XYZ0') === 403 ],
  [ 'no header is refused', await st(null) === 403 ]];
let pass = 0; for (const [n, ok] of res) { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (ok) pass++; }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1);
