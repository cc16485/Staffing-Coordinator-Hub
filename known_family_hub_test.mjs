// 5b B + D · "Is this family already known?" · the hub's own code against fakes.
// node known_family_hub_test.mjs ../cc-hub-live/index.html
import fs from 'fs';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const hub = fs.readFileSync(process.argv[2] || '../cc-hub-live/index.html', 'utf8');
const cut = (a, b) => { const i = hub.indexOf(a), j = hub.indexOf(b, i); if (i < 0 || j < 0) throw new Error('missing ' + a); return hub.slice(i, j); };
const block = cut('/* ===================== 5b B + D · is this family already known?', 'let CK_BUSY=false, CK_SET=');
const save = cut('async function ckCheckNewInquiry(leave){', "  const id = document.getElementById('lead_id').value || uid();");
const ckpt = cut('async function ckptSave(book){', '/* ---------- Client rate card');
const conv = cut('async function lpConvertLead(){', '  const esc=escapeHtmlComms;\n  const ov=document.createElement');
ck('copy: no em dashes, no "plain language"', ![block, save, conv, ckpt].some((b) => /—|plain (language|english)/i.test(b)));
ck('the old caller-phone-only check (where Cancel saved anyway) is gone', !/This phone number already belongs to/.test(hub));

/* fakes */
const DATA = { leads: [
  { id: 'L1', first_name: 'Dana', last_name: 'Adams', phone: '(417) 555-0900', client_first_name: 'Ruth', client_last_name: 'Adams', client_dob: '1938-04-02', status: 'Converted', email: 'dana@x.com' },
  { id: 'L2', first_name: 'Joe', last_name: 'Cole', phone: '4175550111', client_first_name: 'Mary', client_last_name: 'Evans', client_dob: '1950-05-05', status: 'Lost' },
  { id: 'L3', first_name: 'Ann', last_name: 'Gray', phone: '4175550222', client_first_name: 'Mary', client_last_name: 'Evans', status: 'New' },
] };
let lookupAnswer, lookupBody, fetchStatus = 200, persisted, sideBySide, connected, alerts;
const fetch = async (url, o) => { lookupBody = JSON.parse(o.body); return { ok: fetchStatus === 200, status: fetchStatus, json: async () => lookupAnswer }; };
const sb = { auth: { getSession: async () => ({ data: { session: { access_token: 'T' } } }) } };
const ctx = { DATA, sb, fetch, CONFIG: { supabase_url: 'https://x', supabase_anon_key: 'A' }, ME: { email: 'kat@mo-care.com' }, escapeHtmlComms: (x) => String(x),
  document: null, persist: async (k, l) => { persisted.push({ ...l }); }, jcSideBySide: async () => sideBySide,
  jcConnect: async (...a) => { connected.push(a); return { ok: true, text: 'Connected.' }; }, socReadyCheck: async () => {}, renderLeadProfile: () => {}, renderLeads: () => {},
  alert: (m) => alerts.push(m) };
const H = new Function(...Object.keys(ctx), block + '\nreturn { ckQuery, ckLeadMatches, ckFind, ckUseExisting, CK_WHY };')(...Object.values(ctx));
const reset = () => { persisted = []; connected = []; alerts = []; fetchStatus = 200; lookupAnswer = { ok: true, matches: [], axiscare_ok: true }; };

reset();
let q = H.ckQuery({ phones: ['417-555-0900', '', '555'], first: 'Ruth ', last: 'ADAMS', dob: '1938-04-02', email: ' Dana@X.com ' });
ck('the query: phones compared on 10 digits, names and email normalised', JSON.stringify(q) === JSON.stringify({ phones: ['4175550900'], first: 'ruth', last: 'adams', dob: '1938-04-02', email: 'dana@x.com' }), q);
let m = H.ckLeadMatches(q, null);
ck('a past inquiry is found by phone, email and name + birth date together', m.length === 1 && m[0].lead.id === 'L1' && ['phone', 'email', 'name_dob'].every((w) => m[0].why.includes(w)), m);
ck('the inquiry being edited is never matched to itself', H.ckLeadMatches(q, 'L1').length === 0);
m = H.ckLeadMatches(H.ckQuery({ first: 'Mary', last: 'Evans', dob: '1960-01-01' }), null);
ck('same name, different birth date: a different person; a record with no birth date is a hint only', m.length === 1 && m[0].lead.id === 'L3' && m[0].why.join() === 'name_only' && m[0].strength === 1, m);
m = H.ckLeadMatches(H.ckQuery({ first: 'Mary', last: '' }), null);
ck('a first name alone matches nothing', m.length === 0);
ck('Lost inquiries are still found (a family that went elsewhere and came back)', H.ckLeadMatches(H.ckQuery({ phones: ['4175550111'] }), null)[0].lead.id === 'L2');

lookupAnswer = { ok: true, axiscare_ok: true, matches: [{ axiscare_client_id: '11', name: 'Earl Baker', active: false, status: 'Discharged', why: ['phone'], strength: 3 }] };
let f = await H.ckFind(H.ckQuery({ phones: ['4175550200'], first: 'Earl', last: 'Baker' }), null, true);
ck('AxisCare is asked with only phones, names and birth date (no email, nothing else)', JSON.stringify(Object.keys(lookupBody).sort()) === JSON.stringify(['action', 'dob', 'first', 'last', 'phones']) && lookupBody.action === 'find', lookupBody);
ck('a former AxisCare client comes back as a match', f.clients.length === 1 && f.clients[0].axiscare_client_id === '11' && !f.note, f);
lookupBody = null; f = await H.ckFind(H.ckQuery({ first: 'Earl' }), null, true);
ck('nothing to look for: AxisCare is not called', lookupBody === null && f.clients.length === 0);
lookupAnswer = { ok: true, axiscare_ok: false, axiscare_error: 'AxisCare answered 503', matches: [] };
f = await H.ckFind(H.ckQuery({ phones: ['4175550900'] }), null, true);
ck('AxisCare down: says so plainly, and past inquiries still count', /couldn't be checked/.test(f.note) && /503/.test(f.note) && f.leads.length === 1, f);
fetchStatus = 500; lookupAnswer = { error: 'boom' };
f = await H.ckFind(H.ckQuery({ phones: ['4175550900'] }), null, false);
ck('the lookup failing never blocks: it returns a note, not an error', /couldn't be checked/.test(f.note) && f.clients.length === 0);

/* D: using the existing AxisCare record */
reset(); sideBySide = { choice: 'connect', name: 'Earl Baker' };
const lead = { id: 'L9', status: 'Assessment Scheduled', client_first_name: 'Earl', client_last_name: 'Baker' };
let ok = await H.ckUseExisting(lead, '11', 'Earl Baker');
ck('use existing: after the side-by-side yes, the inquiry is linked to #11 and converted, and says so', ok && lead.axiscare_client_id === '11' && lead.status === 'Converted' && lead.axiscare_convert.reused_existing === true && persisted.length === 1, lead);
ck('use existing: the Journey is connected as a person-confirmed link', connected.length === 1 && connected[0][1] === '11' && connected[0][2] === 'typed', connected);
ck('use existing: the message says no second client was made and what to do in AxisCare', /No second client was made/.test(alerts[0]) && /set them back to active/.test(alerts[0]) && !/—/.test(alerts[0]), alerts);
reset(); sideBySide = { choice: 'cancel' };
const lead2 = { id: 'L8', status: 'New' };
ok = await H.ckUseExisting(lead2, '11', 'Earl Baker');
ck('use existing: "not the same person" changes nothing', ok === false && !lead2.axiscare_client_id && lead2.status === 'New' && persisted.length === 0 && connected.length === 0);
reset(); sideBySide = { choice: 'save_only' };
const lead3 = { id: 'L7', status: 'New' };
await H.ckUseExisting(lead3, '11', 'Earl Baker');
ck('use existing: "save the id only" links without connecting the Journey', lead3.axiscare_client_id === '11' && connected.length === 0 && persisted.length === 1);

/* the wiring */
ck('inquiry save: only a NEW inquiry is checked (one not yet saved), and every choice is handled (go back, open inquiry, open profile, link, new)',
  /!\(curId && \(DATA\.leads\|\|\[\]\)\.some\(x=>x\.id===curId\)\)/.test(save) && /ch\.kind==='cancel'\) return \{proceed:false\}/.test(save) && /openLeadProfile\(ch\.id\)/.test(save)
  && /openClient\(\{ax:ch\.ax\},'summary'\)/.test(save) && /axEl\.value=ch\.ax; CK_SET=ch\.ax/.test(save) && /if\(CK_SET&&axEl&&axEl\.value===CK_SET\) axEl\.value=''/.test(save), save.slice(0, 300));
ck('guided call: the same check runs while the call screen is up, and saveLead is told not to ask twice',
  /ckCheckNewInquiry\(\(\)=>ckptTeardown\(\)\)/.test(ckpt) && /saveLead\(\{ck_done:true/.test(ckpt) && !/already belongs to/.test(ckpt));
ck('inquiry save: a link goes through the existing "Is this the same person?" side-by-side (the typed-id path)', hub.indexOf("const r=await jcSideBySide(merged, newAx, 'save');") > hub.indexOf('async function saveLead(){'));
ck('Convert: AxisCare is checked BEFORE anything is created; a current client opens their profile; a former one reuses the record',
  conv.indexOf('ckFind(') > 0 && /ch\.kind==='link'\)\{ await ckUseExisting/.test(conv) && /openClient\(\{ax:ch\.ax\},'summary'\)/.test(conv));
ck('Convert: if AxisCare can\'t be checked, creating a new client needs a yes', /found\.note && !confirm\(/.test(conv));
ck('status review: a returning client whose inquiry already opened the Journey is told it carries on', /journey_already_open\?'They are an active client again/.test(hub));

console.log('\n5b B + D · IS THIS FAMILY ALREADY KNOWN? · HUB TEST\n' + '='.repeat(60)); let all = true;
for (const [n, g, note] of res) { all &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')); }
console.log('='.repeat(60)); console.log(all ? `ALL ${res.length} CHECKS PASS` : 'FAILED');
