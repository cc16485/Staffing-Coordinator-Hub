// Change 6a · circle-send refuses unlinked circles and leaves out STOP / removed members (dry mode).
import fs from 'fs'; import path from 'path';
const src = fs.readFileSync(process.argv[2], 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace(/^import \{ contactForOutbound \} from .*$/m, 'const contactForOutbound = async () => null')
  /* the caller check (security slice) is proven in security_slice_test.mjs; here a signed-in office member is assumed */
  .replace(/^import \{ requireStaff, OFFICE_ROLES \} from .*$/m, "const requireStaff = async () => ({ ok: true, roles: ['owner_admin'], name: 'Test Staff', email: 't@x' }); const OFFICE_ROLES = []")
  /* NO SILENT FAILURES (2026-10-01): the copy runs from the repo root, so the shared send checker is imported by its real path */
  .replace("from '../_shared/send-problems.ts'", "from '" + path.resolve('supabase/functions/_shared/send-problems.ts') + "'");
const tmp = path.join(process.cwd(), '_cs_under_test.ts'); fs.writeFileSync(tmp, src);
let handler; globalThis.Deno = { env: { get: () => 'x' }, serve: h => { handler = h; } };
const DB = { care_circles: [{ id: 'C1', client_name: 'Ruth Jones', axiscare_client_id: '501' }, { id: 'C2', client_name: 'Typed Name', axiscare_client_id: null }],
  circle_contacts: [{ circle_id: 'C1', name: 'Sue', phone: '1', sms_consent: true }, { circle_id: 'C1', name: 'Stopped', phone: '2', sms_consent: true, stopped_at: 'x' },
    { circle_id: 'C1', name: 'Gone', phone: '3', sms_consent: true, axiscare_removed_at: 'x' }] };
globalThis.__db = { from: (t) => { const f = []; let single = false; const p = { select() { return p; }, eq(k, v) { f.push(r => String(r[k]) === String(v)); return p; }, maybeSingle() { single = true; return p; },
  then(ok, bad) { const rows = DB[t].filter(r => f.every(g => g(r))); return Promise.resolve({ data: single ? rows[0] || null : rows, error: null }).then(ok, bad); } }; return p; } };
await import(tmp); fs.unlinkSync(tmp);
const call = async (b) => { const r = await handler(new Request('http://x', { method: 'POST', body: JSON.stringify(b) })); return [r.status, await r.json()]; };
const res = [];
let [s1, b1] = await call({ circle_id: 'C2', kind: 'change', body: 'hi', dry: true });
res.push(['an unlinked circle is refused', s1 === 409 && b1.outcome === 'not_linked']);
let [s2, b2] = await call({ circle_id: 'C1', kind: 'change', body: 'hi', dry: true });
res.push(['a linked circle reaches only Sue (not the STOP member, not the one AxisCare no longer lists)', s2 === 200 && JSON.stringify(b2.would_reach) === JSON.stringify(['Sue'])]);
let pass = 0; for (const [n, ok] of res) { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (ok) pass++; }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1);
