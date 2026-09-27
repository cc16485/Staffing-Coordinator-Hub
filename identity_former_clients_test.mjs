// identity-backfill: who may call, and the former-clients mode (One client profile, step 5b-A).
// node identity_former_clients_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)]);
const src = fs.readFileSync('supabase/functions/identity-backfill/index.ts', 'utf8')
  .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db');
const tmp = path.join(process.cwd(), '_ifc.ts'); fs.writeFileSync(tmp, src);

/* ── a tiny in-memory database with the few query shapes the function uses ── */
let T, nextId, failLinkFor = null;
/* the real columns (identity-layer.sql + identity-provenance.sql + this step's migration, read from Postgres) */
const COLS = {"person_identity": ["id", "display_name", "first_name", "last_name", "primary_phone", "primary_email", "notes", "created_at", "updated_at", "birth_date"], "person_source_id": ["id", "person_id", "system", "entity_type", "source_id", "confidence", "needs_review", "created_at", "evidence", "imported_at"], "person_role": ["id", "person_id", "role", "status", "payer", "position", "coordinator", "started_at", "ended_at", "end_reason", "updated_at"], "phone_index": ["id", "phone", "person_id", "kind", "shared", "created_at", "source_system", "source_record_id", "confidence", "imported_at", "verification_status", "verified_by", "verified_at"]};
const badCols = [];
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
    insert(row) { st.op = 'insert'; st.row = row; if (COLS[table]) for (const k of Object.keys(row)) if (!COLS[table].includes(k)) badCols.push(table + '.' + k); return b; },
    update(row) { st.op = 'update'; st.row = row; if (COLS[table]) for (const k of Object.keys(row)) if (!COLS[table].includes(k)) badCols.push(table + '.' + k); return b; },
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

/* ── AxisCare, faked: two pages, the second reached by a relative link ── */
const AX = [
  { id: 10, firstName: 'Ruth', lastName: 'Adams', status: { active: false, label: 'Discharged' }, startDate: '2024-02-01', effectiveEndDate: '2026-03-15', ssn: '123-45-6789', mobilePhone: '(417) 555-0101', homePhone: '417-555-0102', dateOfBirth: '1938-04-02' },
  { id: 11, firstName: 'Earl', lastName: 'Baker', status: { active: false, label: 'Deceased' }, homePhone: '4175550200' },
  { id: 12, firstName: 'June', lastName: 'Cole', status: { active: true, label: 'Active' }, dateOfBirth: '1941-01-09' },     // linked active: birth date fill
  { id: 13, firstName: 'Nan', lastName: 'Dunn', status: { active: true, label: 'Active' } },                                // active, no person: report only
  { id: 14, firstName: 'Office', lastName: 'Staff', status: { active: false, label: 'Inactive' } },                          // not a person
  { id: 15, firstName: 'Mary', lastName: 'Evans', status: { active: false, label: 'Discharged' }, mobilePhone: '4175550300' }, // number on file only as probable
  { id: 16, firstName: 'Tom', lastName: 'Evans', status: { active: false, label: 'Discharged' }, mobilePhone: '4175550400' },  // number on file as confirmed
  { id: 17, firstName: 'Ann', lastName: 'Fox', status: { active: false, label: 'Discharged' }, dateOfBirth: '1950-07-07' },    // already linked former: birth date fill only
  { id: 18, firstName: 'Carol', lastName: 'Gray', status: { active: false, label: 'Discharged' } },                            // same name as someone in the hub
  { id: 19, firstName: '', lastName: '', status: { active: false } },
];
let axCalls = [];
const fakeAx = async (url) => {
  axCalls.push(url);
  const page2 = url.includes('page=2');
  const body = page2 ? { results: { clients: AX.slice(5), nextPage: null } } : { results: { clients: AX.slice(0, 5), nextPage: '/api/clients?page=2' } };
  return new Response(JSON.stringify(body), { status: 200 });
};
const seed = () => {
  reset();
  T.person_identity.push({ id: 'pJ', display_name: 'June Cole', birth_date: null }, { id: 'pA', display_name: 'Ann Fox', birth_date: '1950-07-08' },
    { id: 'pG', display_name: 'Carol Gray', birth_date: null }, { id: 'pX', display_name: 'Someone Else', birth_date: null }, { id: 'pY', display_name: 'Other One', birth_date: null });
  T.person_source_id.push({ person_id: 'pJ', system: 'axiscare', entity_type: 'client', source_id: '12' }, { person_id: 'pA', system: 'axiscare', entity_type: 'client', source_id: '17' });
  T.phone_index.push({ id: 900, phone: '+14175550300', person_id: 'pX', confidence: 'probable' }, { id: 901, phone: '+14175550400', person_id: 'pY', confidence: 'confirmed' });
};

/* the outreach gate's rule, exactly (supabase/functions/_shared/outreach.ts maySendTo) */
const gate = (phone) => {
  const rows = T.phone_index.filter((r) => r.phone === phone);
  if (!rows.length) return 'allowed';
  if (rows.some((r) => r.verification_status === 'rejected')) return 'blocked';
  return rows.some((r) => (r.confidence ?? 'probable') === 'confirmed') ? 'allowed' : 'blocked';
};
const NUMS = ['+14175550101', '+14175550102', '+14175550200', '+14175550300', '+14175550400'];

/* ── 1. dry run writes nothing and counts correctly ── */
seed(); const before = JSON.stringify(T);
let d = await mod.backfillFormerClients(false, fakeAx);
ck('dry run: reads both AxisCare pages (the second from a relative link)', axCalls.length === 2 && axCalls[1] === 'https://16485.axiscare.com/api/clients?page=2' && d.axiscare_clients_total === 10, [axCalls, d]);
ck('dry run changes nothing at all', JSON.stringify(T) === before);
ck('dry run: 5 former clients to add (Ruth, Earl, Mary, Tom, Carol); Ann is already in the hub', d.former_added === 5 && d.former_already_in_hub === 1 && d.former_total === 6, d);
ck('dry run: Office Staff is skipped as not a person; a nameless record is skipped', d.skipped_not_a_person.length === 1 && d.skipped_not_a_person[0].axiscare_id === '14' && d.skipped_no_name === 1, d);
ck('dry run: an active client with no hub person is reported, not created', d.active_without_person.length === 1 && d.active_without_person[0].name === 'Nan Dunn', d);
ck('dry run: the same-name person is reported as a coincidence, never merged', d.name_coincidences.length === 1 && d.name_coincidences[0].name === 'Carol Gray', d);
ck('dry run: one birth date to fill (June); Ann keeps the one already on file', d.birth_dates_filled === 1, d);
ck('dry run: one end date from AxisCare, four without', d.end_date_from_axiscare === 1 && d.end_date_unknown === 4, d);
ck('dry run: status labels and the deceased count come from AxisCare', d.status_labels.Discharged === 4 && d.status_labels.Deceased === 1 && d.deceased === 1, d);
ck('dry run: two numbers already on file, one of them only as probable', d.phones_shared === 2 && d.phones_left_probable === 1, d);

/* ── 2. commit ── */
const gateBefore = NUMS.map(gate);
seed(); axCalls = [];
d = await mod.backfillFormerClients(true, fakeAx);
const ruth = T.person_identity.find((p) => p.display_name === 'Ruth Adams');
ck('commit: Ruth becomes one person with her name, main phone and birth date', ruth && ruth.primary_phone === '+14175550101' && ruth.birth_date === '1938-04-02' && ruth.first_name === 'Ruth' && ruth.last_name === 'Adams', ruth);
ck('commit: linked to her AxisCare client record, confirmed', T.person_source_id.some((l) => l.person_id === ruth.id && l.source_id === '10' && l.confidence === 'confirmed' && l.system === 'axiscare' && l.entity_type === 'client'));
ck('commit: her role is client, FORMER, with AxisCare\'s reason, start and end dates', T.person_role.some((r) => r.person_id === ruth.id && r.role === 'client' && r.status === 'former' && r.end_reason === 'Discharged' && r.started_at === '2024-02-01' && r.ended_at === '2026-03-15'), T.person_role);
const earl = T.person_role.find((r) => /^Deceased/.test(r.end_reason || ''));
ck('commit: with no end date in AxisCare, the end is today and the reason says so plainly', earl && earl.ended_at === new Date().toISOString().slice(0, 10) && /had no end date/.test(earl.end_reason) && !earl.end_reason.includes('\u2014'), earl);
ck('commit: nothing like a social security number is ever stored', !JSON.stringify(T).includes('123-45-6789'));
ck('commit: Earl\'s role records Deceased', T.person_role.some((r) => r.status === 'former' && /^Deceased/.test(r.end_reason)));
ck('commit: no active role is created for anyone', !T.person_role.some((r) => r.status === 'active'));
ck('commit: both of Ruth\'s numbers are on file, marked as from AxisCare', T.phone_index.filter((p) => p.person_id === ruth.id && p.source_system === 'axiscare' && p.source_record_id === '10' && p.confidence === 'confirmed').length === 2);
const gateAfter = NUMS.map(gate);
ck('commit: who can be texted does not change for any number (the outreach gate gives the same answer)', JSON.stringify(gateBefore) === JSON.stringify(gateAfter), [gateBefore, gateAfter]);
const mary = T.phone_index.find((p) => p.phone === '+14175550300' && p.person_id !== 'pX');
ck('commit: Mary\'s number, on file only as probable, goes in as probable and shared (still blocked)', mary && mary.confidence === 'probable' && mary.shared === true, mary);
ck('commit: June\'s birth date is filled; Ann\'s different one is never overwritten', T.person_identity.find((p) => p.id === 'pJ').birth_date === '1941-01-09' && T.person_identity.find((p) => p.id === 'pA').birth_date === '1950-07-08');
ck('commit: Carol Gray is a second, separate person (the existing one is untouched)', T.person_identity.filter((p) => p.display_name === 'Carol Gray').length === 2 && T.person_source_id.filter((l) => l.person_id === 'pG').length === 0);
ck('commit: Nan Dunn (active, no person) and Office Staff are not created', !T.person_identity.some((p) => /Nan Dunn|Office Staff/.test(p.display_name)));
ck('commit: no Journey or lead of any kind is written (nothing outside the four identity tables)', Object.keys(T).every((t) => ['person_identity', 'person_source_id', 'person_role', 'phone_index'].includes(t) || !T[t].length), Object.keys(T));
ck('commit: counts match what was written', d.former_added === 5 && d.roles_added === 5 && d.birth_dates_filled === 1 && d.errors.length === 0, d);

ck('every column written exists in the real tables', badCols.length === 0, badCols);

/* ── 3. rerun creates nothing ── */
const snap = JSON.stringify(T);
d = await mod.backfillFormerClients(true, fakeAx);
ck('rerun: nothing new is written', JSON.stringify(T) === snap && d.former_added === 0 && d.former_already_in_hub === 6 && d.birth_dates_filled === 0, d);

/* ── 4. a failed link takes the new person back out, so a rerun can't double it ── */
seed(); failLinkFor = '11';
d = await mod.backfillFormerClients(true, fakeAx); failLinkFor = null;
ck('a failed AxisCare link removes the person it just made (no orphan, no double on rerun)', !T.person_identity.some((p) => p.display_name === 'Earl Baker') && d.errors.some((e) => /Earl Baker link/.test(e)) && d.former_added === 4, d);

/* ── 5. the pagination is strict ── */
seed();
d = await mod.backfillFormerClients(true, async () => new Response(JSON.stringify({ results: { clients: AX.slice(0, 2), nextPage: 'https://evil.example/api/clients' } }), { status: 200 }));
ck('a next page on another site stops the run before anything is written', d.error && T.person_identity.length === 5, d);
d = await mod.backfillFormerClients(true, async () => new Response('{}', { status: 500 }));
ck('AxisCare failing stops the run before anything is written', d.error && T.person_identity.length === 5, d);

/* ── 6. who may call ── */
const tok = (c) => 'Bearer x.' + Buffer.from(JSON.stringify(c)).toString('base64url') + '.y';
const call = async (qs, auth, method = 'GET') => {
  const r = await handler(new Request('http://x/identity-backfill' + qs, { method, headers: auth ? { Authorization: auth } : {} }));
  return [r.status, method === 'OPTIONS' ? null : await r.json().catch(() => null)];
};
seed(); globalThis.fetch = fakeAx;
ck('CORS preflight still answers', (await call('', null, 'OPTIONS'))[0] === 200);
const anon = tok({ role: 'anon' }), user = tok({ role: 'authenticated', email: 'a@mo-care.com' });
for (const qs of ['?former_clients=1&commit=1', '?clients=1', '?ghl_clients=1', '?grade=1', '?roster_roles=1', '?apply_phones=1', '?recover=1', '', '?commit=1']) {
  const a = await call(qs, anon), u = await call(qs, user), n = await call(qs, null), w = await call(qs, 'Bearer sb_secret_WRONG');
  ck(`"${qs || '(default)'}" is refused for the public key, a signed-in user, no key and a wrong secret`, [a, u, n, w].every(([s]) => s === 403), [a[0], u[0], n[0], w[0]]);
}
ck('nothing was written by any refused call', T.person_identity.length === 5 && T.person_role.length === 0);
let [s1, b1] = await call('?former_clients=1', tok({ role: 'service_role' }));
ck('the service role (legacy key) may run it', s1 === 200 && b1.mode === 'DRY RUN', b1);
[s1, b1] = await call('?former_clients=1', 'Bearer sb_secret_REALKEY');
ck('the exact server secret (new-style key) may run it', s1 === 200 && b1.mode === 'DRY RUN', b1);
const [sc, bc] = await call('?circles=1', anon);
ck('the nightly circles sync still runs for the public key, and gets counts only', sc === 200 && Object.entries(bc).every(([k, v]) => typeof v !== 'string' || k === 'mode' || k === 'error'), bc);
ck('jwtRole reads a role; garbage reads none', mod.jwtRole(anon) === 'anon' && mod.jwtRole('Bearer nope') === null && mod.jwtRole(null) === null && mod.jwtRole('Bearer a.!!!.c') === null);
ck('secret compare needs an exact match', mod.isServerSecret('Bearer abc', 'abc') && !mod.isServerSecret('Bearer abcd', 'abc') && !mod.isServerSecret('Bearer abc', '') && !mod.isServerSecret(null, 'abc'));
const c = mod.countsOnly({ circles_created: 2, contacts_added: 3, mode: 'COMMIT', waiting: [{ name: 'Ruth Adams' }], note: 'Ruth Adams', flag: true, error: undefined });
ck('counts only: numbers stay, name lists become a count, text is dropped', c.circles_created === 2 && c.contacts_added === 3 && c.waiting === 1 && !('note' in c) && c.mode === 'COMMIT' && c.flag === true && !JSON.stringify(c).includes('Ruth'), c);

console.log('\nIDENTITY-BACKFILL · FORMER CLIENTS + WHO MAY CALL · TEST\n' + '='.repeat(60)); let ok = true;
for (const [n, g, note] of res) { ok &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')); }
console.log('='.repeat(60)); console.log(ok ? `ALL ${res.length} CHECKS PASS` : 'FAILED');
