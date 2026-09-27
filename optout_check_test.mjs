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
reset(); v = await sms({ ghlContact: { dndSettings: { SMS: { status: 'active' } } } }); const v2 = await mail({ ghlContact: { dndSettings: { SMS: { status: 'active' } } } });
ck('GHL Do Not Disturb for texts stops a text but not an email', !v.allowed && v2.allowed, [v, v2]);
reset(); v = await mail({ ghlContact: { dndSettings: { Email: { status: 'permanent' } } } });
ck('"permanent" Do Not Disturb counts too', !v.allowed, v);
reset(); v = await sms({ ghlContact: 'unknown' }); const v3 = await sms({ ghlContact: undefined });
ck('a GHL send whose contact could not be checked is refused (fail closed)', !v.allowed && !v3.allowed && /could not check GHL/.test(v.reasons[0]), [v, v3]);
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
console.log('\n0b-1 · UNIVERSAL OPT-OUT CHECK · TEST\n' + '='.repeat(60)); let all = true;
for (const [n, g, note] of res) { all &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')); }
console.log('='.repeat(60)); console.log(all ? `ALL ${res.length} CHECKS PASS` : 'FAILED');
