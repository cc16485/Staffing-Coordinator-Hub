// identity-backfill: who may call (2026-09-27). node identity_backfill_lock_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)]);
const src = fs.readFileSync('supabase/functions/identity-backfill/index.ts', 'utf8')
  .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db');
const tmp = path.join(process.cwd(), '_ibl.ts'); fs.writeFileSync(tmp, src);

/* ── a tiny in-memory database with the few query shapes the function uses ── */
let T, nextId, failLinkFor = null;
const reset = () => { nextId = 1; T = { person_identity: [], person_source_id: [], person_role: [], phone_index: [] }; };
const q = (table) => {
  const st = { filters: [], from: 0, to: Infinity, op: 'select', row: null };
  T[table] ??= [];
  const rows = () => T[table].filter((r) => st.filters.every(([k, v]) => Array.isArray(v) ? v.map(String).includes(String(r[k])) : String(r[k]) === String(v)));
  const b = {
    select() { return b; }, order() { return b; },
    eq(k, v) { st.filters.push([k, v]); return b; },
    in(k, v) { st.filters.push([k, v]); return b; },
    neq() { return b; }, is() { return b; }, not() { return b; }, limit() { return b; }, gte() { return b; }, lte() { return b; },
    upsert(row) { st.op = 'insert'; st.row = row; return b; },
    maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: x.error })); },
    range(a, z) { st.from = a; st.to = z; return b; },
    insert(row) { st.op = 'insert'; st.row = row; return b; },
    update(row) { st.op = 'update'; st.row = row; return b; },
    delete() { st.op = 'delete'; return b; },
    single() { return b.then((x) => x); },
    then(ok, bad) {
      let out;
      if (st.op === 'select') out = { data: rows().slice(st.from, st.to + 1), error: null };
      else if (st.op === 'insert') {
        if (table === 'person_source_id' && failLinkFor && st.row.source_id === failLinkFor) out = { data: null, error: { message: 'duplicate key' } };
        else if (table === 'person_role' && st.row.status === 'former' && !st.row.ended_at) out = { data: null, error: { message: 'violates check constraint "person_role_check"' } };
        else { const r = { id: table === 'person_identity' ? 'p' + (nextId++) : nextId++, ...st.row }; T[table].push(r); out = { data: { id: r.id }, error: null }; }
      } else if (st.op === 'update') { rows().forEach((r) => Object.assign(r, st.row)); out = { data: null, error: null }; }
      else { const kill = new Set(rows()); T[table] = T[table].filter((r) => !kill.has(r));
        if (table === 'person_identity') for (const t of ['person_source_id', 'person_role', 'phone_index']) T[t] = T[t].filter((r) => ![...kill].some((k) => k.id === r.person_id));
        out = { data: null, error: null }; }
      return Promise.resolve(out).then(ok, bad);
    },
  };
  return b;
};
globalThis.__db = { from: q, rpc: async () => ({ data: null, error: null }) };
const ENV = { SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_REALKEY', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485' };
let handler;
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } };
const mod = await import(tmp); fs.unlinkSync(tmp);

/* AxisCare, faked (the circles sync reads the client list) */
const fakeAx = async () => new Response(JSON.stringify({ results: { clients: [
  { id: 10, firstName: 'Ruth', lastName: 'Adams', status: { active: true, label: 'Active' } },
  { id: 11, firstName: 'Earl', lastName: 'Baker', status: { active: true, label: 'Active' } }], nextPage: null } }), { status: 200 });
const seed = () => { reset(); T.person_identity.push({ id: 'pX', display_name: 'Someone Else' }); };

/* ── 6. who may call ── */
const tok = (c) => 'Bearer x.' + Buffer.from(JSON.stringify(c)).toString('base64url') + '.y';
const call = async (qs, auth, method = 'GET') => {
  const r = await handler(new Request('http://x/identity-backfill' + qs, { method, headers: auth ? { Authorization: auth } : {} }));
  return [r.status, method === 'OPTIONS' ? null : await r.json().catch(() => null)];
};
seed(); globalThis.fetch = fakeAx;
ck('CORS preflight still answers', (await call('', null, 'OPTIONS'))[0] === 200);
const anon = tok({ role: 'anon' }), user = tok({ role: 'authenticated', email: 'a@mo-care.com' });
for (const qs of ['?clients=1&commit=1', '?clients=1', '?ghl_clients=1', '?grade=1', '?roster_roles=1', '?apply_phones=1', '?recover=1', '', '?commit=1']) {
  const a = await call(qs, anon), u = await call(qs, user), n = await call(qs, null), w = await call(qs, 'Bearer sb_secret_WRONG');
  ck(`"${qs || '(default)'}" is refused for the public key, a signed-in user, no key and a wrong secret`, [a, u, n, w].every(([s]) => s === 403), [a[0], u[0], n[0], w[0]]);
}
ck('nothing was written by any refused call', T.person_identity.length === 1 && T.person_role.length === 0 && T.phone_index.length === 0);
let [s1, b1] = await call('?grade=1', tok({ role: 'service_role' }));
ck('the service role (legacy key) gets past the lock', s1 !== 403, [s1, b1]);
[s1, b1] = await call('?grade=1', 'Bearer sb_secret_REALKEY');
ck('the exact server secret (new-style key) gets past the lock', s1 !== 403, [s1, b1]);
[s1, b1] = await call('?circles=1', tok({ role: 'service_role' }));
ck('the service key still gets the full circles report', s1 === 200 && b1.mode === 'DRY RUN', b1);
const [sc, bc] = await call('?circles=1', anon);
ck('the nightly circles sync still runs for the public key, and gets counts only', sc === 200 && Object.entries(bc).every(([k, v]) => typeof v !== 'string' || k === 'mode' || k === 'error'), bc);
ck('jwtRole reads a role; garbage reads none', mod.jwtRole(anon) === 'anon' && mod.jwtRole('Bearer nope') === null && mod.jwtRole(null) === null && mod.jwtRole('Bearer a.!!!.c') === null);
ck('secret compare needs an exact match', mod.isServerSecret('Bearer abc', 'abc') && !mod.isServerSecret('Bearer abcd', 'abc') && !mod.isServerSecret('Bearer abc', '') && !mod.isServerSecret(null, 'abc'));
const c = mod.countsOnly({ circles_created: 2, contacts_added: 3, mode: 'COMMIT', waiting: [{ name: 'Ruth Adams' }], note: 'Ruth Adams', flag: true, error: undefined });
ck('counts only: numbers stay, name lists become a count, text is dropped', c.circles_created === 2 && c.contacts_added === 3 && c.waiting === 1 && !('note' in c) && c.mode === 'COMMIT' && c.flag === true && !JSON.stringify(c).includes('Ruth'), c);

console.log('\nIDENTITY-BACKFILL · WHO MAY CALL · TEST\n' + '='.repeat(60)); let ok = true;
for (const [n, g, note] of res) { ok &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')); }
console.log('='.repeat(60)); console.log(ok ? `ALL ${res.length} CHECKS PASS` : 'FAILED');
