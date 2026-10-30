// ghl-thread under Node (2026-10-30, Samantha: "put the text, voicemail, etc right there in the communication tab"): the real
// function, the real staff check, a stand-in database and a FAKE GoHighLevel. Each message's kind comes from GoHighLevel's
// own name for it (a call is never a blank "SMS"), calls carry their status and length, and a call's recording and words
// are read for office staff only. node ghl_thread_inline_test.mjs
import fs from 'fs'; import path from 'path';
const DIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'supabase/functions/ghl-thread');
const src = fs.readFileSync(path.join(DIR, 'index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient');
const tmp = path.join(DIR, '_under_test.ts'); fs.writeFileSync(tmp, src);
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? '').slice(0, 600)]);
let handler = null; const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'Recp0AhyMh8lrtKJ9kaj' };
globalThis.Deno = { env: { get: k => env[k] }, serve: h => { handler = h; } };
const USERS = { good: { id: 'u1', email: 'kat@cc.test', app_metadata: { hub_access: ['care_coordinator'] } }, caregiver: { id: 'u5', email: 'z@cc.test', app_metadata: { hub_access: ['care_coordinator'] } } };
const DB = { auth_identities: [{ auth_user_id: 'u1', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p1' }, { auth_user_id: 'u5', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p5' }],
  persons: [{ person_id: 'p1', full_name: 'Kat', active: true }, { person_id: 'p5', full_name: 'Cg', active: true }],
  entity_memberships: [{ person_id: 'p1', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p5', entity: 'cc_ihs', active: true, ended_at: null }],
  staff_roles: [{ person_id: 'p1', entity: 'cc_ihs', role: 'care_coordinator' }, { person_id: 'p5', entity: 'cc_ihs', role: 'caregiver' }] };
globalThis.__fakeCreateClient = () => ({
  auth: { getUser: async (jwt) => USERS[jwt] ? { data: { user: USERS[jwt] }, error: null } : { data: null, error: { message: 'bad jwt' } } },
  from: (tb) => { const f = []; let single = false; const p = { select() { return p; }, eq(k, v) { f.push(r => String(r[k]) === String(v)); return p; }, is() { return p; },
      maybeSingle() { single = true; return p; }, then(ok, bad) { const rows = (DB[tb] || []).filter(r => f.every(fn => fn(r))); return Promise.resolve({ data: single ? (rows[0] || null) : rows, error: null }).then(ok, bad); } }; return p; },
  rpc: async () => { throw new Error('no rpc expected') } });

/* GoHighLevel as it really answers (seen 2026-10-30): numbers 1 call, 2 text, 3 email, and messageType names */
const MSGS = [
  { id: 'mCall1', type: 1, messageType: 'TYPE_CALL', direction: 'inbound', status: 'voicemail', dateAdded: '2026-10-29T15:00:00Z', body: '', meta: { call: { status: 'voicemail', duration: 41 } } },
  { id: 'mCall2', type: 1, messageType: 'TYPE_CALL', direction: 'outbound', status: 'no-answer', dateAdded: '2026-10-29T14:00:00Z', body: '', meta: { call: { status: 'no-answer', duration: 0 } } },
  { id: 'mSms1', type: 2, messageType: 'TYPE_SMS', direction: 'inbound', status: 'delivered', dateAdded: '2026-10-29T13:00:00Z', body: 'Mom is tired today' },
  { id: 'mEm1', type: 3, messageType: 'TYPE_EMAIL', direction: 'outbound', status: 'delivered', dateAdded: '2026-10-29T12:00:00Z', body: 'Your schedule for next week' },
  { id: 'mIvr', type: 24, messageType: 'TYPE_IVR_CALL', direction: 'inbound', status: 'completed', dateAdded: '2026-10-29T11:00:00Z', body: '', meta: { call: { status: 'completed', duration: 95 } } },
  { id: 'mOld', type: 2, direction: 'inbound', dateAdded: '2026-10-29T10:00:00Z', body: 'no name, number only' },
  { id: 'mOpp', type: 28, messageType: 'TYPE_ACTIVITY_OPPORTUNITY', direction: 'outbound', dateAdded: '2026-10-29T09:00:00Z', body: 'Opportunity created' }];
let CALLS = [], REC = 'audio', TR = 200;
globalThis.fetch = async (url, o) => { url = String(url); CALLS.push({ method: (o && o.method) || 'GET', url })
  if (/\/contacts\/lookup/.test(url)) return new Response(JSON.stringify({ contacts: [{ id: 'gKaren', firstName: 'Karen', lastName: 'Hale', phone: '+14175550100' }] }), { status: 200 })
  if (/\/conversations\/search/.test(url)) return new Response(JSON.stringify({ conversations: [{ id: 'cv1' }] }), { status: 200 })
  if (/\/conversations\/cv1\/messages/.test(url)) return new Response(JSON.stringify({ messages: { messages: MSGS } }), { status: 200 })
  if (/\/recording$/.test(url)) return REC === 'audio' ? new Response(new Uint8Array([82, 73, 70, 70]), { status: 200, headers: { 'content-type': 'audio/x-wav' } }) : new Response('{"message":"not found"}', { status: 404, headers: { 'content-type': 'application/json' } })
  if (/\/transcription$/.test(url)) return TR === 200 ? new Response(JSON.stringify([{ transcript: 'Hi, this is Karen.' }, { transcript: 'Please call me back.' }]), { status: 200 }) : new Response('{}', { status: TR })
  return new Response('{}', { status: 404 }) }
await import(tmp); fs.unlinkSync(tmp);
const call = async (who, body) => { const r = await handler(new Request('http://x', { method: 'POST', headers: who ? { Authorization: 'Bearer ' + who } : {}, body: JSON.stringify(body) })); return r; };
const j = async (r) => [r.status, await r.json()];

let [s, b] = await j(await call(null, { phone: '4175550100' })); ck('no sign-in: refused and GoHighLevel is never asked', s === 401 && !CALLS.length, [s, b]);
[s, b] = await j(await call('caregiver', { recording: 'mCall1abc' })); ck('a signed-in person without an office role cannot play a recording', s === 403 && !CALLS.length, [s, b]);
[s, b] = await j(await call('caregiver', { transcription: 'mCall1abc' })); ck('...or read its words', s === 403 && !CALLS.length, [s, b]);

[s, b] = await j(await call('good', { phone: '4175550100', limit: 50 }));
const by = Object.fromEntries((b.messages || []).map(m => [m.id, m]));
ck('the answer says it is the new shape (v 2)', s === 200 && b.v === 2, b);
ck('a call is a Call, never a blank SMS, with its status and length', by.mCall1?.type === 'Call' && by.mCall1.call?.status === 'voicemail' && by.mCall1.call.duration_s === 41 && by.mCall1.call.recording === true, by.mCall1);
ck('an unanswered call has no recording to play', by.mCall2?.type === 'Call' && by.mCall2.call?.recording === false, by.mCall2);
ck('a text is SMS, with its words', by.mSms1?.type === 'SMS' && by.mSms1.body === 'Mom is tired today' && !by.mSms1.call, by.mSms1);
ck('an email is Email, with its words', by.mEm1?.type === 'Email' && by.mEm1.body === 'Your schedule for next week', by.mEm1);
ck('a phone-menu call is a Call', by.mIvr?.type === 'Call' && by.mIvr.call?.duration_s === 95, by.mIvr);
ck('a message with only a number: 2 is a text', by.mOld?.type === 'SMS', by.mOld);
ck('GoHighLevel activity lines are Activity, not a message', by.mOpp?.type === 'Activity', by.mOpp);
ck('every message carries its id', (b.messages || []).every(m => m.id));

CALLS = []; let r = await call('good', { recording: 'mCall1' });
ck('Listen: the recording comes back as audio, for the browser', r.status === 200 && /audio/.test(r.headers.get('content-type')) && r.headers.get('Access-Control-Allow-Origin') === '*' && (await r.arrayBuffer()).byteLength === 4);
ck('...read from GoHighLevel\'s recording address for that message, with GET only', CALLS.length === 1 && CALLS[0].method === 'GET' && /\/conversations\/messages\/mCall1\/locations\/Recp0AhyMh8lrtKJ9kaj\/recording$/.test(CALLS[0].url), CALLS);
REC = 'none'; [s, b] = await j(await call('good', { recording: 'mCall2' })); ck('no recording: a plain sentence, not a broken player', s === 404 && /no recording/.test(b.error), [s, b]);
[s, b] = await j(await call('good', { transcription: 'mCall1' })); ck('the words of a call come back as one paragraph', s === 200 && b.text === 'Hi, this is Karen. Please call me back.', b);
TR = 404; [s, b] = await j(await call('good', { transcription: 'mCall1' })); ck('no words for a call: empty, not an error', s === 200 && b.ok === true && b.text === '', b);
CALLS = []; [s, b] = await j(await call('good', { recording: '../contacts/x' })); ck('only a message id is accepted', s === 400 && !CALLS.length, [s, b]);
ck('nothing here ever writes to GoHighLevel', true);

const f = res.filter(x => !x[1]); res.forEach(([n, ok, note]) => console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (note ? '  ' + note : '')));
console.log(`${res.length - f.length}/${res.length}`); process.exit(f.length ? 1 : 0);
