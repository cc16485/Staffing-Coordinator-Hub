// C2a · the two AxisCare writers with no suite of their own: coverage-assign (a caregiver put on a visit) and the call-summary
// share (_shared/axiscare-call-note.ts). Real code, a stand-in database and a fake AxisCare. Each change must add one record line.
import fs from 'fs'; import path from 'path';
const ROOT = path.dirname(new URL(import.meta.url).pathname);
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? '').slice(0, 400)]);
const REC = []; let CASES = [];
const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485', GHL_LOCATION_ID: 'loc' };
let handler; globalThis.Deno = { env: { get: k => env[k] }, serve: h => { handler = h; } };
const db = { rpc: async (n, a) => { if (n === 'axiscare_change_record') REC.push(a); if (n === 'upsert_app_data_item' && a.target_key === 'coverage_cases') CASES = CASES.map((c) => c.id === a.item.id ? a.item : c); return { data: { outcome: 'recorded' }, error: null }; },
  from: (t) => { const f = []; let single = false; const p = { select() { return p; }, eq(k, v) { f.push([k, v]); return p; }, in() { return p; }, maybeSingle() { single = true; return p; }, upsert() { return Promise.resolve({ error: null }); },
    then(ok, bad) { let data = null;
      const key = (f.find((x) => x[0] === 'key') || [])[1];
      if (t === 'app_data' && key === 'coverage_cases') data = { data: CASES };
      else if (t === 'app_data' && key === 'ops_settings') data = { data: { axiscare_call_notes_live: globalThis.__LIVE === true } };
      else if (t === 'app_data') data = { data: [] };
      else if (t === 'phone_index') data = [{ person_id: 'P1', phone: '+14175550100' }];
      else if (t === 'person_identity') data = single ? { id: 'P1', display_name: 'Ruth Ellis' } : [{ id: 'P1', display_name: 'Ruth Ellis' }];
      else if (t === 'person_source_id') data = [{ entity_type: 'client', source_id: '501' }];
      else if (t === 'person_relationship') data = [];
      else data = single ? null : [];
      return Promise.resolve({ data: single && Array.isArray(data) ? data[0] ?? null : data, error: null }).then(ok, bad); } }; return p; } };
globalThis.__db = db;
const AX = { assigned: '', patchStatus: 200, calls: [] };
globalThis.fetch = async (u, o = {}) => { const url = new URL(String(u)), m = (o.method || 'GET').toUpperCase(); AX.calls.push(m + ' ' + url.pathname);
  const R = (s, b) => new Response(JSON.stringify(b), { status: s });
  if (url.pathname === '/api/visits' && m === 'GET') return R(200, { results: { visits: [{ id: 77, caregiver: null }] } });
  if (url.pathname === '/api/visits/77' && m === 'PATCH') { if (AX.patchStatus !== 200) return R(AX.patchStatus, { errors: ['no'] }); AX.assigned = String(JSON.parse(o.body).caregiverId); return R(200, { success: true }); }
  if (url.pathname === '/api/visits/77' && m === 'GET') return R(200, { results: { visit: { id: 77, caregiver: AX.readback === false ? null : { id: Number(AX.assigned) } } } });
  if (url.pathname === '/api/call-logs' && m === 'POST') return R(AX.callStatus || 200, AX.callStatus ? { success: false, errors: ['no'] } : { success: true, results: { data: { id: 5 } } });
  throw new Error('unexpected ' + m + ' ' + url); };
// coverage-assign
{ const FN = path.join(ROOT, 'supabase/functions/coverage-assign/index.ts');
  const src = fs.readFileSync(FN, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db');
  const tmp = path.join(path.dirname(FN), '_under_test.ts'); fs.writeFileSync(tmp, src); await import(tmp); fs.unlinkSync(tmp); }
const tok = 'Bearer x.' + Buffer.from(JSON.stringify({ role: 'authenticated', email: 'kat@cc.test' })).toString('base64url') + '.y';
const assign = async () => { const r = await handler(new Request('http://x', { method: 'POST', headers: { authorization: tok }, body: JSON.stringify({ case_id: 'V1' }) })); return r.json(); };
const mkCase = () => { CASES = [{ id: 'V1', covered_by: 'Jane Doe', asked: [{ name: 'Jane Doe', axiscare_id: '1234' }], client_axiscare_id: '501', shift_date: '2026-09-29' }]; };
mkCase(); let b = await assign();
ck('coverage: a caregiver put on a visit and read back is recorded as confirmed, on the client, with the caregiver number', b.status === 'assigned' && REC.at(-1).p_kind === 'visit_caregiver' && REC.at(-1).p_outcome === 'sent_confirmed'
   && REC.at(-1).p_client === '501' && REC.at(-1).p_caregiver === '1234' && /caregiver #1234 put on visit 77/.test(REC.at(-1).p_summary), [b, REC.at(-1)]);
mkCase(); AX.readback = false; b = await assign(); AX.readback = undefined;
ck('coverage: AxisCare says OK but the read-back does not show them: recorded as sent, NOT confirmed, with why', REC.at(-1).p_outcome === 'sent' && /read-back/.test(REC.at(-1).p_detail), REC.at(-1));
mkCase(); AX.patchStatus = 403; b = await assign(); AX.patchStatus = 200;
ck('coverage: AxisCare refusing is recorded as refused', REC.at(-1).p_outcome === 'refused' && /403/.test(REC.at(-1).p_detail), REC.at(-1));
// the call-summary share
const CN = await import(path.join(ROOT, 'supabase/functions/_shared/axiscare-call-note.ts'));
const pc = (extra) => CN.pushCallNote(db, Object.assign({ phone: '+14175550100', summary: 'Asked about Tuesday visits.', direction: 'inbound', ghlContactId: 'g1', callId: 'c' + Math.random() }, extra || {}));
const n0 = REC.length; globalThis.__LIVE = false; let r = await pc();
const d0 = REC.slice(n0);
ck('call summary: a practice run (switch off) is recorded as a practice run, and nothing is posted', (d0.length === 0 || d0.every((x) => x.p_outcome === 'practice')) && !AX.calls.some((x) => /call-logs/.test(x)), [r, d0]);
globalThis.__LIVE = true; const n1 = REC.length; r = await pc();
const d1 = REC.slice(n1);
ck('call summary: a posted summary is recorded on the client, with its length, never its text', r.outcome !== 'posted' || (d1.at(-1).p_kind === 'call_summary' && d1.at(-1).p_client === '501' && d1.at(-1).p_outcome === 'sent' && !/Tuesday/.test(d1.at(-1).p_summary)), [r, d1]);
ck('call summary: the share reached the post (so the line above really ran)', r.outcome === 'posted', r);
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '\n     ' + note)); if (ok) pass++; }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1);
