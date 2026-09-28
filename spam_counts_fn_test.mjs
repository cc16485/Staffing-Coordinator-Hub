// Lead numbers S1 · reports-rollup under Node: the real function, a stand-in database. A spam lead never counts.
import fs from 'fs'; import path from 'path';
const DIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'supabase/functions/reports-rollup');
const src = fs.readFileSync(path.join(DIR, 'index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db');
const tmp = path.join(DIR, '_under_test.ts'); fs.writeFileSync(tmp, src);
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note).slice(0, 400)]);
let handler; const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k' };
globalThis.Deno = { env: { get: k => env[k] }, serve: h => { handler = h; } };
globalThis.fetch = async () => new Response('[]', { status: 200 });
const day = d => new Date(Date.now() - d * 864e5).toISOString();
const LEADS = [{ id: 'a', created_at: day(2) }, { id: 'b', created_at: day(10) }, { id: 'c', created_at: day(100) },
  { id: 's1', created_at: day(1), status: 'Lost', archived: true, spam: { at: day(0), by: 'kat@cc.test' } },
  { id: 's2', created_at: day(20), status: 'Lost', spam: { at: day(5) } },
  { id: 'x', created_at: day(3), spam: null }];
globalThis.__db = { auth: { getUser: async () => ({ data: { user: { email: 'samantha@mo-care.com' } } }) },
  from: () => { const p = { select() { return p; }, in() { return p; }, eq() { return p; },
    then(ok, bad) { return Promise.resolve({ data: [{ key: 'leads', data: LEADS }], error: null }).then(ok, bad); } }; return p; } };
await import(tmp); fs.unlinkSync(tmp);
const r = await handler(new Request('http://x', { method: 'POST', headers: { Authorization: 'Bearer t' } }));
const b = await r.json();
const a = b.agency || {};
ck('reports-rollup: the lead total leaves out the two spam leads (4 of 6)', a.leads_total === 4, a);
ck('reports-rollup: the last 30 days leaves out spam (3)', a.leads_30d === 3, a);
const wk = (b.trends || {}).leads || [];
const sum = wk.reduce((x, y) => x + y, 0);
ck('reports-rollup: the weekly trend leaves out spam (3 in the last 8 weeks)', sum === 3, { wk });
ck('a lead with an empty spam field still counts (only a real mark removes it)', a.leads_total === 4, a);
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '\n     ' + note)); if (ok) pass++; }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1);
