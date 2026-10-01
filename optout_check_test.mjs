// 0b-1 · the universal opt-out check (_shared/optout.ts) against a fake database. node optout_check_test.mjs
import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)]);
const lib = await import(path.join(process.cwd(), 'supabase/functions/_shared/optout.ts'));
let T, broken, logged;
const reset = () => { T = { contact_optout_current: [], leads: [], circle_contacts: [] }; broken = new Set(); logged = []; };
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
  rpc: async (fn, a) => { logged.push([fn, a]); return { data: null, error: null }; } };
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
const fakeGhl = (upsertContact, getContact) => { const calls = []; const f = async (url, init) => { calls.push([init?.method, url, init?.body ? JSON.parse(init.body) : null]);
  const body = url.endsWith('/contacts/upsert') ? { contact: upsertContact } : { contact: getContact };
  return { ok: true, json: async () => body }; }; f.calls = calls; return f; };
reset(); let f = fakeGhl({ id: 'c1', dnd: false }); let id = await lib.ghlContactIfAllowed(db, ghl, 'lead-intake', { channel: 'sms', phone: '417-555-0101', email: 'x@y.com', firstName: 'Dana' }, f);
ck('door: a clean contact returns its id, and a TEXT contact is found by the phone alone (never the email)', id === 'c1' && f.calls.length === 1 && f.calls[0][2].phone === '+14175550101' && !('email' in f.calls[0][2]), f.calls);
reset(); f = fakeGhl({ id: 'c2', dnd: false }); id = await lib.ghlContactIfAllowed(db, ghl, 'lead-intake', { channel: 'email', phone: '4175550101', email: ' Dana@X.com ' }, f);
ck('door: an EMAIL contact is found by the email alone', id === 'c2' && f.calls[0][2].email === 'dana@x.com' && !('phone' in f.calls[0][2]), f.calls);
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
console.log('\n0b-1 · UNIVERSAL OPT-OUT CHECK · TEST\n' + '='.repeat(60)); let all = true;
for (const [n, g, note] of res) { all &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')); }
console.log('='.repeat(60)); console.log(all ? `ALL ${res.length} CHECKS PASS` : 'FAILED');
