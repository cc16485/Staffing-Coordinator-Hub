// Change 3 · client-status-review under Node: real function code, fake database, fake admission scan.
// node client_status_harness.mjs supabase/functions/client-status-review/index.ts
import fs from 'fs'; import path from 'path';
const FN = process.argv[2];
const src = fs.readFileSync(FN, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient')
  /* J2: the lock and the staff check are stand-ins that follow the test token (the real ones: j2_job_locks_test.mjs) */
  .replace("'../_shared/job-auth.ts'", "'" + path.resolve('test_stubs/job-auth-by-role.mjs') + "'").replace("'../_shared/staff-auth.ts'", "'" + path.resolve('test_stubs/staff-auth-by-claim.mjs') + "'");
const tmp = path.join(process.cwd(), '_client_status_under_test.ts'); fs.writeFileSync(tmp, src);
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note).slice(0, 800)]);
let handler = null; const env = { SUPABASE_URL: 'http://sb', SUPABASE_SERVICE_ROLE_KEY: 'svc-key' };
globalThis.Deno = { env: { get: k => env[k] }, serve: h => { handler = h; } };
const recent = new Date(Date.now() - 2 * 86400000).toISOString(), old = new Date(Date.now() - 90 * 86400000).toISOString();
const DB = {
  app_data: { ops_settings: { promises_live: true }, ops_items: [{ id: 'other', status: 'open' }], automation_log: [],
    client_status_log: [{ id: 'latest', map: { 501: 'Inactive', 502: 'Deceased', 503: 'Active', 600: 'Active', 700: 'Inactive' } },
      { id: 'tr_501_a', axiscare_client_id: '501', old_status_label: 'Active', new_status_label: 'Inactive', observed_at: recent },
      { id: 'tr_502_a', axiscare_client_id: '502', old_status_label: 'Active', new_status_label: 'Deceased', observed_at: recent },
      { id: 'tr_700_a', axiscare_client_id: '700', old_status_label: 'Inactive', new_status_label: 'Deceased', observed_at: recent },
      { id: 'tr_503_old', axiscare_client_id: '503', old_status_label: 'Inactive', new_status_label: 'Active', observed_at: old }] },
  client_status_review: [], person_source_id: [{ person_id: 'P1', source_id: '501', system: 'axiscare', entity_type: 'client' },
    { person_id: 'P2', source_id: '502', system: 'axiscare', entity_type: 'client' }, { person_id: 'P3', source_id: '503', system: 'axiscare', entity_type: 'client' }],
  person_identity: [{ id: 'P1', display_name: 'Ruth Jones' }, { id: 'P2', display_name: 'Ann Lee' }],
  persons: [{ person_id: 'pp1', primary_email: 'Care@CC.test' }], domains: [{ code: 'client_care', owner_person: 'pp1', entity: 'cc_ihs' }],
  journey_seat_member: [{ email: 'kat@cc.test', seat: 'client_intake' }, { email: 'owner@cc.test', seat: 'owner_decision' }],
};
const rpcs = [], scans = [];
globalThis.fetch = async (u, o) => { if (String(u) === 'http://sb/functions/v1/client-admission-scan') { scans.push(o.headers.Authorization);
  return new Response(JSON.stringify({ ok: true, active: 2, unlinked: 1, results: [{ axiscare_client_id: '600', outcome: 'opened' }] })); } throw new Error('unexpected ' + u); };
globalThis.__fakeCreateClient = () => ({
  from: (t) => { const f = []; let single = false; const p = { select() { return p; }, eq(k, v) { f.push(r => String(r[k]) === String(v)); return p; },
      in(k, vs) { f.push(r => vs.map(String).includes(String(r[k]))); return p; }, maybeSingle() { single = true; return p; },
      then(ok, bad) { let rows = t === 'app_data' ? Object.entries(DB.app_data).map(([key, data]) => ({ key, data })) : (DB[t] || []);
        rows = rows.filter(r => f.every(g => g(r))); return Promise.resolve(single ? { data: rows[0] || null, error: null } : { data: rows, error: null }).then(ok, bad); } }; return p; },
  rpc: async (name, a) => { rpcs.push({ name, a });
    if (name === 'upsert_app_data_item') { const L = DB.app_data[a.target_key]; const i = L.findIndex(x => x.id === a.item.id); if (i >= 0) L[i] = a.item; else L.push(a.item); return { data: null, error: null }; }
    if (name === 'client_status_current_refresh') return { data: { outcome: 'refreshed', rows: Object.keys(a.p_map).length }, error: null };
    if (name === 'client_status_review_open') { const t = a.p_transition; if (DB.client_status_review.some(r => r.transition_ref === t.id)) return { data: { outcome: 'already_open' }, error: null };
      const l = DB.person_source_id.find(x => x.source_id === String(t.axiscare_client_id)); if (!l) return { data: { outcome: 'no_hub_person' }, error: null };
      DB.client_status_review.push({ review_id: '00000000-0000-4000-8000-00000000000' + DB.client_status_review.length, transition_ref: t.id, axiscare_client_id: String(t.axiscare_client_id),
        person_id: l.person_id, old_label: t.old_status_label, new_label: t.new_status_label, observed_at: t.observed_at, status: 'open' }); return { data: { outcome: 'opened' }, error: null }; }
    if (name === 'client_status_decide') { const r = DB.client_status_review.find(x => x.review_id === a.p_review_id); r.status = 'decided'; return { data: { outcome: 'decided', decision: a.p_decision }, error: null }; }
    return { data: null, error: { message: 'unknown ' + name } }; } });
const M = await import(tmp); fs.unlinkSync(tmp);
const tok = (c) => 'Bearer x.' + Buffer.from(JSON.stringify(c)).toString('base64url') + '.y';
const ANON = tok({ role: 'anon' }), SVC = tok({ role: 'service_role' }), KAT = tok({ role: 'authenticated', email: 'Kat@cc.test' }), OWN = tok({ role: 'authenticated', email: 'owner@cc.test' }), NOBODY = tok({ role: 'authenticated', email: 'x@cc.test' });
const call = async (auth, body) => { const r = await handler(new Request('http://x', { method: 'POST', headers: { Authorization: auth }, body: JSON.stringify(body) })); return [r.status, await r.json()]; };
const writes = () => rpcs.filter(r => r.name !== 'upsert_app_data_item' || r.a.target_key !== 'automation_log');
const items = () => DB.app_data.ops_items.filter(i => i.id.startsWith('csr_'));

let r = await handler(new Request('http://x', { method: 'OPTIONS' }));
ck('CORS preflight answered from day one', r.status === 200 && r.headers.get('Access-Control-Allow-Origin') === '*');
let [st, b] = await call(ANON, { action: 'decide', review_id: 'x', decision: 'on_hold' }); let [st2] = await call(KAT, { action: 'run' });
ck('access: answers need a signed-in person; the scheduled run refuses a signed-in person (J2: 401, not allowed)', st === 401 && st2 === 401);
[st, b] = await call(ANON, {});
ck('dry run (switch off): counts only; nothing refreshed, scanned, opened or added to My Work',
  b.dry === true && b.would_open === 2 && b.no_hub_person === 1 && b.too_old === 1 && b.admission_scan.would_check === 1 && writes().length === 0 && scans.length === 0 && b.preview === undefined
  && DB.app_data.automation_log.at(-1).automation === 'client_status', b);
DB.app_data.ops_settings.client_status_live = true;
[st, b] = await call(SVC, {});
ck('live: AxisCare\'s current status is copied for Active Clients', b.current_refreshed === 5 && rpcs.some(x => x.name === 'client_status_current_refresh'), b);
ck('live: the admission scan runs server to server with the server key (never in the schedule)', scans.length === 1 && scans[0] === 'Bearer svc-key' && b.admission_scan.opened === 1, b.admission_scan);
ck('live: one review per change on a known client; unknown clients and old changes are only counted', b.opened === 2 && DB.client_status_review.length === 2 && b.no_hub_person === 1 && b.too_old === 1, b);
const it1 = items().find(i => i.about === 'Ruth Jones'), it2 = items().find(i => i.about === 'Ann Lee');
ck('My Work: one item per open review, owned by the Client Care owner, asking the question',
  items().length === 2 && it1.title === 'AxisCare changed Ruth Jones from Active to Inactive' && it1.owner === 'care@cc.test' && it1.source.type === 'status_review'
  && it1.urgency === 'normal' && /Nothing in the hub changes until someone answers/.test(it1.detail), items());
ck('My Work: a change to "Deceased" is high priority and says nothing contacts the family automatically', it2.urgency === 'high' && /Nothing contacts the family automatically/.test(it2.detail), it2);
const n0 = DB.client_status_review.length, i0 = items().length;
[st, b] = await call(ANON, {});
ck('rerun: no second review and no second item', DB.client_status_review.length === n0 && items().length === i0 && b.already_reviewed === 2 && b.opened === 0 && b.preview === undefined, b);
[st, b] = await call(NOBODY, { action: 'decide', review_id: it1.source.review_id, decision: 'on_hold' });
ck('answer: someone without a Journey seat is told so; nothing saved', st === 403 && b.outcome === 'no_seat' && DB.client_status_review[0].status === 'open', b);
[st, b] = await call(KAT, { action: 'decide', review_id: it1.source.review_id, decision: 'returning', date: '2026-09-30' });
ck('answer: "returning client" from Client Intake needs Owner / Decision', st === 403 && b.outcome === 'seat_required', b);
[st, b] = await call(KAT, { action: 'decide', review_id: it1.source.review_id, decision: 'care_ended', date: '2026-09-28', reason: 'facility', note: 'Mercy Village' });
const dc = rpcs.filter(x => x.name === 'client_status_decide').at(-1).a;
ck('answer: goes through the door as that person and seat, and closes the My Work item', b.outcome === 'decided' && dc.p_staff === 'kat@cc.test' && dc.p_seat === 'client_intake'
  && dc.p_date === '2026-09-28' && dc.p_reason === 'facility' && items().find(i => i.about === 'Ruth Jones').status === 'done', { b, dc });
[st, b] = await call(OWN, { action: 'decide', review_id: it2.source.review_id, decision: 'returning', date: '2026-09-30' });
ck('answer: Owner / Decision can record a returning client', b.outcome === 'decided' && rpcs.filter(x => x.name === 'client_status_decide').at(-1).a.p_seat === 'owner_decision', b);
DB.client_status_review.push({ review_id: '00000000-0000-4000-8000-000000000099', transition_ref: 'tr_x', axiscare_client_id: '503', person_id: 'P3', old_label: 'A', new_label: 'B', observed_at: recent, status: 'decided' });
DB.app_data.ops_items.push({ id: 'csr_00000000-0000-4000-8000-000000000099', status: 'open', history: [] });
[st, b] = await call(ANON, {});
ck('a review answered some other way: the next run closes its item', b.items_closed === 1 && DB.app_data.ops_items.find(i => i.id === 'csr_00000000-0000-4000-8000-000000000099').status === 'done', b);
ck('the day an item is due is Springfield\'s end of day', new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hourCycle: 'h23', hour: '2-digit' }).format(new Date(M.endOfDayChicago('2026-09-30'))) === '23');

let pass = 0;
for (const [name, ok, note] of res) { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '\n     ' + note)); if (ok) pass++; }
console.log(`\n${pass}/${res.length} passed`);
process.exit(pass === res.length ? 0 : 1);
