// N3 · circle-send to chosen family members about a flagged shift note: only people with permission to discuss;
// anyone without it is refused (nothing sent); STOP / removed members never reached; the ordinary whole-circle send unchanged.
import fs from 'fs'; import path from 'path';
const src = fs.readFileSync('supabase/functions/circle-send/index.ts', 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace(/^import \{ contactForOutbound \} from .*$/m, 'const contactForOutbound = async (db, ghl, to, cfg) => ({ contactId: "C:" + (cfg.channel === "sms" ? to.phone : to.email) })')
  .replace(/^import \{ requireStaff, OFFICE_ROLES \} from .*$/m, "const requireStaff = async () => ({ ok: true, roles: ['owner_admin'], name: 'Katie Staff', email: 'k@x' }); const OFFICE_ROLES = []")
  /* NO SILENT FAILURES (2026-10-01): the copy runs from the repo root, so the shared send checker is imported by its real path */
  .replace("from '../_shared/send-problems.ts'", "from '" + path.resolve('supabase/functions/_shared/send-problems.ts') + "'");
const tmp = path.join(process.cwd(), '_n3_under_test.ts'); fs.writeFileSync(tmp, src);
let handler; globalThis.Deno = { env: { get: () => 'x' }, serve: h => { handler = h; } };
const DB = { care_circles: [{ id: 'C1', client_name: 'Ruth Jones', axiscare_client_id: '501' }],
  circle_contacts: [
    { id: 1, circle_id: 'C1', name: 'Dana Jones', phone: '4175550110', sms_consent: true, email: 'dana@example.test', hipaa_authorized: true, wants_general: false },
    { id: 2, circle_id: 'C1', name: 'Pat Neighbor', phone: '4175550120', sms_consent: true, hipaa_authorized: null },
    { id: 3, circle_id: 'C1', name: 'Sam Jones', phone: '4175550130', sms_consent: true, hipaa_authorized: true, stopped_at: 'x' },
    { id: 4, circle_id: 'C1', name: 'Lee Jones', phone: '4175550140', sms_consent: true, hipaa_authorized: true } ],
  circle_messages: [] };
globalThis.__db = { from: (t) => { const f = []; let single = false; const p = { select() { return p; }, eq(k, v) { f.push(r => String(r[k]) === String(v)); return p; }, maybeSingle() { single = true; return p; },
  insert(row) { DB[t].push(row); return Promise.resolve({ error: null }); },
  then(ok, bad) { const rows = DB[t].filter(r => f.every(g => g(r))); return Promise.resolve({ data: single ? rows[0] || null : rows, error: null }).then(ok, bad); } }; return p; } };
const SENT = []; globalThis.fetch = async (url, o) => { if (String(url).includes('conversations/messages')) { const b = JSON.parse(o.body); SENT.push([b.type, b.contactId]); } return new Response('{}', { status: 200 }) };
await import(tmp); fs.unlinkSync(tmp);
const call = async (b) => { const r = await handler(new Request('http://x', { method: 'POST', body: JSON.stringify(b) })); return [r.status, await r.json()]; };
const res = []; const ck = (n, c, d) => res.push([n, !!c, c ? '' : JSON.stringify(d ?? null).slice(0, 500)]);
let [s, b] = await call({ circle_id: 'C1', purpose: 'care_note', body: 'Hi', contact_ids: [] });
ck('N3 · nobody chosen: refused', s === 400, b)
;[s, b] = await call({ circle_id: 'C1', purpose: 'care_note', body: 'Ruth had a small fall.', contact_ids: [1, 2] });
ck('N3 · someone without permission to discuss chosen: the whole send is refused, nothing sent', s === 409 && b.outcome === 'no_permission' && /Pat Neighbor/.test(b.error) && SENT.length === 0, [s, b, SENT])
;[s, b] = await call({ circle_id: 'C1', purpose: 'care_note', body: 'Ruth had a small fall.', contact_ids: [1], item_id: 'ops_carenote_x' });
ck('N3 · a permitted member: reached by text and email, even though they turned off general updates (a person chose them)', s === 200 && b.reached === 1 && JSON.stringify(b.reached_names) === '["Dana Jones"]' && SENT.length === 2 && b.item_id === 'ops_carenote_x', [b, SENT])
ck('N3 · recorded as a care-note message with the sender from the sign-in', DB.circle_messages.some(m => m.kind === 'care_note' && m.sent_by === 'Katie Staff' && m.reached === 1))
SENT.length = 0;[s, b] = await call({ circle_id: 'C1', purpose: 'care_note', body: 'x', contact_ids: [3] });
ck('N3 · a member who replied STOP is never reached, even if chosen', s === 200 && b.reached === 0 && SENT.length === 0, [b, SENT])
SENT.length = 0;[s, b] = await call({ circle_id: 'C1', kind: 'update', body: 'Schedule note' });
ck('the ordinary whole-circle update is unchanged (everyone who wants updates, not STOP)', s === 200 && b.of === 2 && b.reached === 2 && !('reached_names' in b), [b, SENT])
for (const [n, o, d] of res) console.log((o ? 'PASS ' : 'FAIL ') + n + (o ? '' : '\n   ' + d)); console.log(res.filter(x => x[1]).length + '/' + res.length)
