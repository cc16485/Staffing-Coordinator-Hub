// 0b-1 · the universal opt-out check (_shared/optout.ts) against a fake database. node optout_check_test.mjs
import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)]);
const lib = await import(path.join(process.cwd(), 'supabase/functions/_shared/optout.ts'));
let T, broken, logged, cards = [];
const reset = () => { T = { contact_optout_current: [], leads: [], circle_contacts: [] }; broken = new Set(); logged = []; cards = []; };
const db = { from: (t) => { const st = { f: [], notNull: null }; const b = {
  select() { return b; }, eq(c, v) { st.f.push([c, v]); return b; }, not(c) { st.notNull = c; return b; },
  maybeSingle() { return b.then((x) => ({ data: x.data?.[0] ?? null, error: x.error })); },
  then(ok) {
    if (broken.has(t) || (t === 'app_data' && broken.has('leads'))) return Promise.resolve({ data: null, error: { message: 'down' } }).then(ok);
    if (t === 'app_data') return Promise.resolve({ data: [{ data: T.leads }], error: null }).then(ok);
    let rows = T[t] || []; for (const [c, v] of st.f) rows = rows.filter((r) => r[c] === v);
    if (st.notNull) rows = rows.filter((r) => r[st.notNull] != null);
    return Promise.resolve({ data: rows, error: null }).then(ok);
  } }; return b; },
  rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') { cards.push(a.item); return { data: null, error: null }; } logged.push([fn, a]); return { data: null, error: null }; } };
const clean = { id: 'c1', dnd: false, dndSettings: { SMS: { status: 'inactive' }, Email: { status: 'inactive' } } };
const sms = (x = {}) => lib.optOutCheck(db, { channel: 'sms', phone: '(417) 555-0101', ghlContact: clean, ...x });
const mail = (x = {}) => lib.optOutCheck(db, { channel: 'email', email: 'Dana@X.com', ghlContact: clean, ...x });

reset(); let v = await sms();
ck('nothing says stop: allowed, no reasons', v.allowed && v.reasons.length === 0, v);
reset(); v = await sms({ ghlContact: { dnd: true } });
ck('GHL Do Not Disturb (all channels) stops it', !v.allowed && /GHL Do Not Disturb/.test(v.reasons[0]), v);
reset(); v = await sms({ ghlContact: { dnd: false, dndSettings: { SMS: { status: 'active' } } } }); const v2 = await mail({ ghlContact: { dnd: false, dndSettings: { SMS: { status: 'active' } } } });
ck('GHL Do Not Disturb for texts stops a text but not an email', !v.allowed && v2.allowed, [v, v2]);
reset(); v = await mail({ ghlContact: { dnd: false, dndSettings: { Email: { status: 'permanent' } } } });
ck('"permanent" Do Not Disturb counts too', !v.allowed, v);
reset(); v = await sms({ ghlContact: 'unknown' }); const v3 = await sms({ ghlContact: undefined });
ck('a GHL send whose contact could not be checked is refused (fail closed)', !v.allowed && !v3.allowed && /could not check GHL/.test(v.reasons[0]), [v, v3]);
reset(); v = await sms({ ghlContact: { id: 'c9', dndSettings: {} } });
ck('a GHL answer that does not say whether Do Not Disturb is on is treated as unknown and refused', !v.allowed && /could not check GHL/.test(v.reasons[0]), v);
reset(); v = await sms({ ghlContact: undefined, viaGhl: false });
ck('a send that does not go through GHL skips only the GHL check', v.allowed, v);
reset(); T.contact_optout_current = [{ address: '+14175550101', channel: 'sms', opted_out: true, source: 'stop_text' }]; v = await sms(); const v4 = await mail();
ck("the Hub's own record stops that channel only", !v.allowed && /opted out \(stop_text, sms\)/.test(v.reasons[0]) && v4.allowed, [v, v4]);
reset(); T.contact_optout_current = [{ address: 'dana@x.com', channel: 'all', opted_out: true, source: 'staff' }]; v = await mail();
ck("'all' in the Hub's record stops every channel for that address", !v.allowed, v);
reset(); T.contact_optout_current = [{ address: '+14175550101', channel: 'sms', opted_out: false, source: 'staff' }]; v = await sms();
ck('after a person records an opt-back-in, the Hub record no longer stops it (other sources still apply)', v.allowed, v);
reset(); T.leads = [{ id: 'L1', client_phone: '417.555.0101', do_not_contact: true }]; v = await sms();
ck('an inquiry marked do-not-contact stops texts to its client phone too', !v.allowed && /inquiry/.test(v.reasons[0]), v);
reset(); T.leads = [{ id: 'L1', email: 'dana@x.com', do_not_contact: true }]; v = await mail(); const v5 = await sms();
ck('an inquiry marked do-not-contact by email stops email; its absence of a phone does not stop texts', !v.allowed && v5.allowed, [v, v5]);
reset(); T.circle_contacts = [{ phone: '+1 417 555 0101', stopped_at: '2026-09-01' }, { phone: '4175550202', stopped_at: null }]; v = await sms();
ck('a Family Circle contact marked stopped stops texts to that number', !v.allowed && /Family Circle/.test(v.reasons[0]), v);
for (const src of ['contact_optout_current', 'leads', 'circle_contacts']) {
  reset(); broken.add(src); v = await sms();
  ck(`if ${src} cannot be read, the send is refused (fail closed)`, !v.allowed && v.reasons.some((r) => /could not check/.test(r)), v);
}
reset(); v = await lib.optOutCheck(db, { channel: 'sms', phone: '555', ghlContact: clean });
ck('an unusable address is refused', !v.allowed && /no usable phone/.test(v.reasons[0]), v);
reset(); T.contact_optout_current = [{ address: '+14175550101', channel: 'sms', opted_out: true, source: 'staff' }];
const ok1 = await lib.mayContact(db, 'lead-intake', { channel: 'sms', phone: '4175550101', ghlContact: { dnd: true } });
ck('mayContact refuses and logs every reason once, with the sender', ok1 === false && logged.length === 1 && logged[0][0] === 'contact_send_refusal_log'
  && logged[0][1].p_sender === 'lead-intake' && logged[0][1].p_reasons.length === 2, logged);
reset(); const ok2 = await lib.mayContact(db, 'lead-intake', { channel: 'sms', phone: '4175550101', ghlContact: clean });
ck('mayContact allows a clean send and logs nothing', ok2 === true && logged.length === 0);
const dbLogBroken = { ...db, rpc: async () => { throw new Error('down'); } };
reset(); const ok3 = await lib.mayContact(dbLogBroken, 'x', { channel: 'sms', phone: '4175550101', ghlContact: { dnd: true } });
ck('a refusal whose log fails is still a refusal', ok3 === false);

// ── ghlContactIfAllowed: the GHL senders' door ──
const ghl = { token: 't', locationId: 'loc' };
/* dup: the one-person-one-contact lookups, { 'number=+1…' | 'email=…': contactId } (none by default); byId: GET /contacts/{id} answers */
const fakeGhl = (upsertContact, getContact, dup = {}, byId = {}) => { const calls = []; const f = async (url, init) => { calls.push([init?.method, url, init?.body ? JSON.parse(init.body) : null]);
  let body
  if (url.includes('/contacts/search/duplicate')) { const q = decodeURIComponent(url.split('&').slice(1).join('&')); body = dup[q] ? { contact: { id: dup[q] } } : {} }
  else if (url.endsWith('/contacts/upsert')) body = { contact: upsertContact }
  else { const id = decodeURIComponent(url.split('/contacts/')[1] || ''); body = init?.method === 'PUT' ? { contact: { id } } : { contact: byId[id] ?? getContact } }
  return { ok: true, json: async () => body }; }; f.calls = calls; return f; };
const upsertOf = (f) => (f.calls.find((c) => c[1].endsWith('/contacts/upsert')) || [])[2];
reset(); let f = fakeGhl({ id: 'c1', dnd: false }); let id = await lib.ghlContactIfAllowed(db, ghl, 'lead-intake', { channel: 'sms', phone: '417-555-0101', email: 'x@y.com', firstName: 'Dana' }, f);
ck('door: a clean contact returns its id, and a TEXT contact is found by the phone alone (never the email)', id === 'c1' && upsertOf(f).phone === '+14175550101' && !('email' in upsertOf(f)) && !f.calls.some((c) => c[0] === 'PUT'), f.calls);
reset(); f = fakeGhl({ id: 'c2', dnd: false }); id = await lib.ghlContactIfAllowed(db, ghl, 'lead-intake', { channel: 'email', phone: '4175550101', email: ' Dana@X.com ' }, f);
ck('door: an EMAIL contact is found by the email alone', id === 'c2' && upsertOf(f).email === 'dana@x.com' && !('phone' in upsertOf(f)), f.calls);
reset(); f = fakeGhl({ id: 'c3', dnd: true }); id = await lib.ghlContactIfAllowed(db, ghl, 'lead-intake', { channel: 'sms', phone: '4175550101' }, f);
ck('door: GHL Do Not Disturb on the contact: no id, refusal logged', id === null && logged.length === 1 && /Do Not Disturb is on/.test(JSON.stringify(logged[0][1].p_reasons)), logged);
reset(); f = fakeGhl({ id: 'c4' }, { id: 'c4', dnd: false }); id = await lib.ghlContactIfAllowed(db, ghl, 'lead-intake', { channel: 'sms', phone: '4175550101' }, f);
ck('door: when the upsert answer leaves DND out, it asks GHL for the contact and uses that answer', id === 'c4' && f.calls.length === 2 && f.calls[1][0] === 'GET' && f.calls[1][1].endsWith('/contacts/c4'), f.calls);
reset(); f = fakeGhl({ id: 'c5' }, { id: 'c5', dnd: true }); id = await lib.ghlContactIfAllowed(db, ghl, 'lead-intake', { channel: 'sms', phone: '4175550101' }, f);
ck('door: ...and a DND found that way still refuses', id === null && logged.length === 1, logged);
reset(); f = fakeGhl({ id: 'c6' }, null); id = await lib.ghlContactIfAllowed(db, ghl, 'lead-intake', { channel: 'sms', phone: '4175550101' }, f);
ck('door: if GHL never says whether DND is on, it refuses (fail closed)', id === null && /could not check GHL/.test(JSON.stringify(logged)), logged);
reset(); id = await lib.ghlContactIfAllowed(db, ghl, 'lead-intake', { channel: 'sms', phone: '4175550101' }, async () => { throw new Error('GHL down'); });
ck('door: GHL unreachable: refused and logged', id === null && /GHL returned no contact/.test(JSON.stringify(logged)), logged);
reset(); T.contact_optout_current = [{ address: '+14175550101', channel: 'sms', opted_out: true, source: 'staff' }]; f = fakeGhl({ id: 'c7', dnd: false });
id = await lib.ghlContactIfAllowed(db, ghl, 'lead-followup', { channel: 'sms', phone: '4175550101' }, f);
ck("door: the Hub's own record refuses even when GHL says DND is off", id === null && logged[0][1].p_sender === 'lead-followup', logged);
reset(); f = fakeGhl({ id: 'c8', dnd: false }); id = await lib.ghlContactIfAllowed(db, ghl, 'x', { channel: 'sms', phone: '12' }, f);
ck('door: an unusable number never reaches GHL', id === null && f.calls.length === 0 && logged.length === 1);
// ── 2026-10-01 (Desktop 382): GHL's real answer has NO dnd key unless DND is on ──
reset(); f = fakeGhl({ id: 'r1' }, { id: 'r1', phone: '+14175550101', dndSettings: {} }); id = await lib.ghlContactIfAllowed(db, ghl, 'send-invite', { channel: 'sms', phone: '4175550101' }, f);
ck("door: GHL's normal answer (no dnd key at all) read back by a successful GET counts as DND off: allowed", id === 'r1' && logged.length === 0, logged);
reset(); f = fakeGhl({ id: 'r2' }, { id: 'r2' }); id = await lib.ghlContactIfAllowed(db, ghl, 'send-invite', { channel: 'email', email: 'a@b.com' }, f);
ck('door: ...even with no dndSettings either', id === 'r2' && logged.length === 0, logged);
reset(); f = fakeGhl({ id: 'r3' }, { id: 'r3', dndSettings: { SMS: { status: 'active' } } }); id = await lib.ghlContactIfAllowed(db, ghl, 'send-invite', { channel: 'sms', phone: '4175550101' }, f);
ck('door: no dnd key but texts DND active: a text is still refused', id === null && /Do Not Disturb is on/.test(JSON.stringify(logged)), logged);
reset(); f = fakeGhl({ id: 'r4' }, { id: 'someone-else' }); id = await lib.ghlContactIfAllowed(db, ghl, 'send-invite', { channel: 'sms', phone: '4175550101' }, f);
ck('door: a GET that returns a different contact is not trusted: refused', id === null && /could not check GHL/.test(JSON.stringify(logged)), logged);
reset(); f = fakeGhl({ id: 'r5', __dnd_read: true }, null); id = await lib.ghlContactIfAllowed(db, ghl, 'send-invite', { channel: 'sms', phone: '4175550101' }, f);
ck('door: the read-back mark only counts when the Hub set it, not when GHL sends it', id === null && /could not check GHL/.test(JSON.stringify(logged)) && f.calls.length === 2, [logged, f.calls]);
reset(); v = await sms({ ghlContact: { id: 'c9' } });
ck('a contact handed in without a read-back and without dnd is still unknown: refused', !v.allowed && /could not check GHL/.test(v.reasons[0]), v);
// ── ONE PERSON, ONE CONTACT (2026-10-01, her "yes, let the hub add the missing phone and email") ──
const J = { 'number=+14175550101': '', 'email=dana@x.com': 'cE' };
reset(); f = fakeGhl({ id: 'NEW' }, null, J, { cE: { id: 'cE', firstName: 'Dana', email: 'dana@x.com', phone: '' } });
id = await lib.ghlContactIfAllowed(db, ghl, 'interview-messages', { channel: 'sms', phone: '417-555-0101', email: 'Dana@X.com', firstName: 'Dana' }, f);
const put = f.calls.find((c) => c[0] === 'PUT');
ck('join: nobody has the number, her email contact has no phone: the number is ADDED to that contact and the text goes there (no second contact)',
  id === 'cE' && put && put[1].endsWith('/contacts/cE') && put[2].phone === '+14175550101' && Object.keys(put[2]).length === 1 && !upsertOf(f), f.calls);
reset(); f = fakeGhl({ id: 'NEW', dnd: false }, null, J, { cE: { id: 'cE', firstName: 'Dana', email: 'dana@x.com', phone: '+14175559999', dnd: false } });
id = await lib.ghlContactIfAllowed(db, ghl, 'interview-messages', { channel: 'sms', phone: '4175550101', email: 'dana@x.com', firstName: 'Dana' }, f);
ck('join: that contact already holds a DIFFERENT number: never overwritten, a separate contact as before', id === 'NEW' && !f.calls.some((c) => c[0] === 'PUT') && upsertOf(f), f.calls);
reset(); f = fakeGhl({ id: 'NEW', dnd: false }, null, J, { cE: { id: 'cE', firstName: 'Margaret', email: 'dana@x.com' } });
id = await lib.ghlContactIfAllowed(db, ghl, 'interview-messages', { channel: 'sms', phone: '4175550101', email: 'dana@x.com', firstName: 'Dana' }, f);
ck("join: the email's contact has a different first name (e.g. a parent's): left alone", id === 'NEW' && !f.calls.some((c) => c[0] === 'PUT'), f.calls);
reset(); f = fakeGhl({ id: 'NEW', dnd: false }, null, { 'number=+14175550101': 'cP', 'email=dana@x.com': 'cE' });
id = await lib.ghlContactIfAllowed(db, ghl, 'interview-messages', { channel: 'sms', phone: '4175550101', email: 'dana@x.com', firstName: 'Dana' }, f);
ck('join: someone already has this number: the usual path, nothing added anywhere', !f.calls.some((c) => c[0] === 'PUT') && upsertOf(f), f.calls);
reset(); f = fakeGhl({ id: 'NEW' }, null, J, { cE: { id: 'cE', firstName: 'Dana', email: 'dana@x.com', dndSettings: { SMS: { status: 'active' } } } });
id = await lib.ghlContactIfAllowed(db, ghl, 'interview-messages', { channel: 'sms', phone: '4175550101', email: 'dana@x.com', firstName: 'Dana' }, f);
ck('join: Do Not Disturb for texts on the joined contact still refuses the text', id === null && /Do Not Disturb is on/.test(JSON.stringify(logged)), logged);
reset(); f = fakeGhl({ id: 'NEW', dnd: false }, null, J); const bad = async (u, i) => (String(u).includes('duplicate') ? { ok: false, json: async () => ({}) } : f(u, i));
bad.calls = f.calls; id = await lib.ghlContactIfAllowed(db, ghl, 'interview-messages', { channel: 'sms', phone: '4175550101', email: 'dana@x.com' }, bad);
ck('join: a lookup GHL refuses falls back to the usual path (the send is not lost)', id === 'NEW' && !f.calls.some((c) => c[0] === 'PUT'), f.calls);
reset(); f = fakeGhl({ id: 'c1', dnd: false }, null, J); id = await lib.ghlContactIfAllowed(db, ghl, 'x', { channel: 'sms', phone: '4175550101' }, f);
ck('join: without the other address nothing extra is looked up', id === 'c1' && f.calls.every((c) => !c[1].includes('duplicate')), f.calls);
// ── NO SILENT FAILURES (2026-10-01): every refusal raises one Needs Attention card ──
reset(); f = fakeGhl({ id: 'n1' }, { id: 'n1', firstName: 'Cythenia', lastName: 'T', dndSettings: { SMS: { status: 'active' } } }); id = await lib.ghlContactIfAllowed(db, ghl, 'send-invite', { channel: 'sms', phone: '4175550101' }, f);
ck('card: a refused training invite raises one card, named, in office words, with a next step', id === null && cards.length === 1 && cards[0].kind === 'send_problem' && cards[0].status === 'open'
  && /Text didn't go through: orientation \/ training invite to Cythenia T/.test(cards[0].title) && /Do Not Disturb/.test(cards[0].detail) && /Next: Call them/.test(cards[0].detail) && cards[0].phone === '+14175550101' && cards[0].domain === 'caregivers', cards);
reset(); f = fakeGhl({ id: 'n2' }, null); id = await lib.ghlContactIfAllowed(db, ghl, 'reference-chase', { channel: 'email', email: 'Ref@X.com', firstName: 'Pat' }, f);
ck('card: "could not check" says it was held back to be safe, and shows the email', cards.length === 1 && /held the message back/.test(cards[0].detail) && /Email: ref@x.com/.test(cards[0].detail) && cards[0].urgency === 'today', cards);
// the card reads the list first: an open card is bumped, not duplicated
let OPS = []; const dbOps = { ...db, from: (t) => t === 'app_data' ? { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { data: OPS }, error: null }) } : db.from(t),
  rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') { const i = OPS.findIndex((x) => x.id === a.item.id); if (i >= 0) OPS[i] = a.item; else OPS.push(a.item); } return { data: null, error: null }; } };
const P = await import(path.join(process.cwd(), 'supabase/functions/_shared/send-problems.ts'));
await P.reportSendProblem(dbOps, { sender: 'interview-messages', channel: 'sms', address: '417-555-0102', who: 'Ana', reasons: ['could not check GHL Do Not Disturb'] });
await P.reportSendProblem(dbOps, { sender: 'interview-messages', channel: 'sms', address: '(417) 555-0102', who: 'Ana', reasons: ['could not check GHL Do Not Disturb'] });
ck('card: the same person + message twice is ONE card, counted twice', OPS.length === 1 && OPS[0].count === 2 && /Tried 2 times/.test(OPS[0].detail), OPS);
OPS[0].status = 'done'; OPS[0].closed_at = new Date().toISOString(); OPS[0].problem = 'opted_out';
await P.reportSendProblem(dbOps, { sender: 'interview-messages', channel: 'sms', address: '4175550102', reasons: ['opted out (stop_text, sms)'] });
ck('card: an opt-out a person already closed stays closed', OPS.length === 1 && OPS[0].status === 'done', OPS);
await P.reportSendProblem(dbOps, { sender: 'interview-messages', channel: 'sms', address: '4175550102', reasons: ['error 400: bad number'], failed: true });
ck('card: a NEW kind of failure reopens it as a fresh card', OPS.length === 1 && OPS[0].status === 'open' && OPS[0].count === 1 && OPS[0].problem === 'failed' && OPS[0].closed_at === null, OPS);
OPS = []; for (let k = 0; k < 45; k++) await P.reportSendProblem(dbOps, { sender: 'coverage-run', channel: 'sms', address: '41755' + String(10000 + k), reasons: ['error 503'], failed: true });
const many = OPS.find((x) => x.id === 'ops_send_many');
ck('card: an outage is one "many messages are not going out" card after 40, not hundreds', OPS.length === 41 && many && many.count === 5 && many.urgency === 'urgent', [OPS.length, many]);
ck('card: the overflow card says WHO each counted message was for (newest first, max 15)', many.recent.length === 5 && /\(417\) 551-0044/.test(many.recent[0].address) && /• .* · text · open shift text · \(417\) 551-0044 · GoHighLevel did not accept/.test(many.detail) && /close this one with Done/.test(many.detail), many);
ck('card: why-words: STOP beside a "could not check" reads as the opt-out', P.explain(['could not check Family Circle stops', 'opted out (staff, sms)'], false, 'sms').code === 'opted_out'
  && P.explain(['could not check Family Circle stops'], false, 'sms').code === 'unchecked', null);
// the checked send: true only on a 2xx, and a refusal raises a card
OPS = []; let ok = await P.ghlSendChecked(dbOps, {}, 'reference-chase', { channel: 'email', contactId: 'c1', address: 'a@b.com', who: 'Pat' }, { subject: 's', html: 'h' }, async () => new Response('{"message":"Email is invalid"}', { status: 422 }));
ck('checked send: GoHighLevel saying no returns false and raises a card with its words', ok === false && OPS.length === 1 && /error 422: Email is invalid/.test(OPS[0].detail) && OPS[0].problem === 'failed', OPS);
OPS = []; ok = await P.ghlSendChecked(dbOps, {}, 'reference-chase', { channel: 'sms', contactId: 'c1', address: '4175550101' }, { message: 'm' }, async (u, i) => new Response(JSON.parse(i.body).type === 'SMS' ? '{}' : 'x', { status: 200 }));
ck('checked send: a 2xx is true, no card', ok === true && OPS.length === 0, OPS);
OPS = []; ok = await P.ghlSendChecked(dbOps, {}, 'x', { channel: 'sms', contactId: 'c1', address: '4175550101' }, { message: 'm' }, async () => { throw new Error('ECONNRESET'); });
ck('checked send: GoHighLevel unreachable is false + a card', ok === false && /could not be reached/.test(OPS[0]?.detail), OPS);
ok = await P.reportSendProblem({ rpc: async () => { throw new Error('x'); }, from: () => { throw new Error('y'); } }, { sender: 'x', channel: 'sms', reasons: ['r'] });
ck('card: a broken database never throws out of the report', ok === undefined);
console.log('\n0b-1 · UNIVERSAL OPT-OUT CHECK · TEST\n' + '='.repeat(60)); let all = true;
for (const [n, g, note] of res) { all &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')); }
console.log('='.repeat(60)); console.log(all ? `ALL ${res.length} CHECKS PASS` : 'FAILED');
