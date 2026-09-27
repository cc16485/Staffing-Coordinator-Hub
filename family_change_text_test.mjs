// Change 6a · the approved family "caregiver changed" text: node family_change_text_test.mjs supabase/functions/_shared/family-change-text.ts
import fs from 'fs'; import path from 'path';
const src = fs.readFileSync(process.argv[2], 'utf8').replace(/^import \{ contactForOutbound \} from .*$/m, 'const contactForOutbound = async () => null')
  .replace("from './covered-outside.ts'", "from '" + path.resolve(path.dirname(process.argv[2]), 'covered-outside.ts') + "'");
const tmp = path.join(process.cwd(), '_fct_under_test.ts'); fs.writeFileSync(tmp, src);
const M = await import(tmp); fs.unlinkSync(tmp);
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note).slice(0, 700)]);
let DB;
const reset = () => { DB = {
  care_circles: [{ id: 'C1', client_name: 'Mary Smith', active: true, axiscare_client_id: '501' }, { id: 'C2', client_name: 'Mary Jones', active: true, axiscare_client_id: '502' },
                 { id: 'C3', client_name: 'Mary Brown', active: true, axiscare_client_id: null }],
  circle_contacts: [
    { circle_id: 'C1', name: 'Sue Smith', phone: '(417) 555-0101', sms_consent: true },
    { circle_id: 'C1', name: 'Stopped Sam', phone: '4175550102', sms_consent: true, stopped_at: '2026-09-01' },
    { circle_id: 'C1', name: 'Gone Gail', phone: '4175550103', sms_consent: true, axiscare_removed_at: '2026-09-20' },
    { circle_id: 'C1', name: 'No Consent', phone: '4175550104', sms_consent: false },
    { circle_id: 'C1', name: 'No Changes', phone: '4175550105', sms_consent: true, wants_changes: false },
    { circle_id: 'C1', name: 'Mary Smith', phone: '4175550106', sms_consent: true },
    { circle_id: 'C2', name: 'Tom Jones', phone: '4175550107', sms_consent: true }],
  caregiver_intros: [{ id: 'g1', name: 'Jane Doe' }] }; };
const sb = { from: (t) => { const f = []; const p = { select() { return p; }, eq(k, v) { f.push(r => String(r[k]) === String(v)); return p; },
  then(ok, bad) { return Promise.resolve({ data: (DB[t] || []).filter(r => f.every(g => g(r))), error: null }).then(ok, bad); } }; return p; } };
let gates, sends;
const gate = async (_sb, _ghl, person, kind, opts) => { gates.push({ person, kind, opts }); return { contactId: 'ct_' + person.phone.replace(/\D/g, '') }; };
const send = async (u, o) => { sends.push(JSON.parse(o.body)); return { ok: true }; };
const CASE = { client: 'Mary Smith', client_axiscare_id: '501', covered_by: 'Jane Doe', calling_off: 'Bo Smith', shift_date: '2026-09-30' };
const APPROVED = { family_caregiver_change_text_approved: { by: 'samantha', at: '2026-09-27' } };
const run = async (c, settings) => { gates = []; sends = []; return M.notifyFamilyOfChange(sb, { token: 't', locationId: 'l' }, c, settings, { whenText: 'Wed, Sep 30 9am-1pm' }, gate, send); };

reset(); let r = await run(CASE, {});
ck('without the recorded approval nothing is sent (complete, reason not_enabled)', r.outcome === 'none' && r.reason === 'not_enabled' && gates.length === 0, r);
r = await run(CASE, APPROVED);
ck('the circle is the one tied to the case\'s AxisCare id: Mary Smith\'s family, never the other Marys', r.outcome === 'sent' && r.circle === 'Mary Smith' && !gates.some(g => g.person.phone === '4175550107'), r);
ck('only consenting members who want changes, have not replied STOP, and are still on AxisCare\'s contacts',
  JSON.stringify(gates.map(g => g.person.firstName).sort()) === JSON.stringify(['Mary', 'Sue']), gates.map(g => g.person.firstName));
ck('every send goes through the shared gate as audience family, explicitly enabled', gates.every(g => g.opts.audience === 'family' && g.opts.explicitlyEnabled === true && g.kind === 'reactive_external'), gates);
const toSue = sends.find(x => x.contactId === 'ct_4175550101').message, toMary = sends.find(x => x.contactId === 'ct_4175550106').message;
ck('wording: names who called off, who is coming, when, the meet link; the client herself is spoken to as "you"',
  /Bo is unable to make Mary Smith's visit Wed, Sep 30 9am-1pm, so Jane from our team/.test(toSue) && /meet\.html\?cg=g1/.test(toSue) && /make your visit/.test(toMary), { toSue, toMary });
r = await run({ ...CASE, client_axiscare_id: '' }, APPROVED);
ck('a case with no AxisCare client id texts nobody', r.outcome === 'none' && r.reason === 'case_has_no_axiscare_id' && gates.length === 0, r);
r = await run({ ...CASE, client: 'Mary Brown', client_axiscare_id: '503' }, APPROVED);
ck('a circle nobody has linked is never texted (even when the name matches exactly)', r.outcome === 'none' && r.reason === 'no_linked_circle' && gates.length === 0, r);
DB.care_circles.push({ id: 'C9', client_name: 'Mary Smith (old)', active: true, axiscare_client_id: '501' });
r = await run(CASE, APPROVED);
ck('two circles linked to the same client: nobody is texted until a person fixes it', r.outcome === 'none' && r.reason === 'two_linked_circles' && gates.length === 0, r);
reset(); DB.circle_contacts = DB.circle_contacts.filter(m => m.circle_id !== 'C1' || m.name === 'No Consent');
r = await run(CASE, APPROVED);
ck('no consenting member: complete with nobody to tell', r.outcome === 'none' && r.reason === 'no_consenting_member', r);
reset(); gates = []; sends = [];
r = await M.notifyFamilyOfChange(sb, { token: 't', locationId: 'l' }, CASE, APPROVED, { whenText: 'x' }, async () => null, send);
ck('if the gate refuses every member, the case is left to retry (never faked as sent)', r.outcome === 'retry' && r.count === 0, r);

let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '\n     ' + note)); if (ok) pass++; }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1);
