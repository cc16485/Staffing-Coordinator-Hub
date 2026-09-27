// callin-plan edge function under Node (fake database). node callin_plan_fn_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 600)]);
const src = fs.readFileSync('supabase/functions/callin-plan/index.ts', 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db');
const tmp = path.join(process.cwd(), '_cpf.ts'); fs.writeFileSync(tmp, src);
let handler, calls = [];
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'k' })[k] }, serve: (h) => { handler = h; } };
globalThis.__db = { from: () => { const b = { select() { return b; }, eq() { return b; }, maybeSingle: async () => ({ data: { data: [{ email: 'Krystal@mo-care.com', name: 'Krystal' }] } }) }; return b; },
  rpc: async (fn, a) => { calls.push([fn, a]); return { data: { outcome: 'recorded', id: 1 }, error: null }; } };
await import(tmp); fs.unlinkSync(tmp);
const tok = (c) => 'Bearer x.' + Buffer.from(JSON.stringify(c)).toString('base64url') + '.y';
const call = async (auth, body, method = 'POST') => { const r = await handler(new Request('http://x', { method, headers: auth ? { Authorization: auth } : {}, body: method === 'POST' ? JSON.stringify(body) : undefined })); return [r.status, r]; };
let [st, r] = await call(null, {}, 'OPTIONS');
ck('CORS preflight answers 200 with Allow-Origin', st === 200 && r.headers.get('Access-Control-Allow-Origin') === '*');
const s1 = (await call(null, { action: 'add' }))[0], s2 = (await call(tok({ role: 'anon' }), { action: 'add' }))[0], s3 = (await call(tok({ role: 'service_role' }), { action: 'add' }))[0];
ck('not signed in, anonymous, and the service key are all refused; nothing recorded', s1 === 401 && s2 === 401 && s3 === 401 && calls.length === 0);
[st, r] = await call(tok({ role: 'authenticated', email: 'krystal@mo-care.com' }), { action: 'add', axiscare_client_id: '501', client_name: 'LeeAnn Walker', source_who: 'LeeAnn',
  coverage_need: 'must_cover', entered_by: 'someone.else@x.com', p_staff: 'hacker', note: 'n' });
ck('any signed-in staff member can add; who entered it comes from their sign-in and their staff name, never the form',
  st === 200 && calls.length === 1 && calls[0][0] === 'client_callin_add' && calls[0][1].p_staff === 'krystal@mo-care.com' && calls[0][1].p_staff_name === 'Krystal'
  && !('entered_by' in calls[0][1].p) && !('p_staff' in calls[0][1].p) && calls[0][1].p.coverage_need === 'must_cover', calls);
[st] = await call(tok({ role: 'authenticated', email: 'krystal@mo-care.com' }), { action: 'delete' });
ck("only 'add' exists (nothing can edit or delete an entry)", st === 400);
console.log('\nCALLIN-PLAN FUNCTION · TEST\n' + '='.repeat(60)); let ok = true;
for (const [n, g, note] of res) { ok &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')); }
console.log('='.repeat(60)); console.log(ok ? `ALL ${res.length} CHECKS PASS` : 'FAILED');
