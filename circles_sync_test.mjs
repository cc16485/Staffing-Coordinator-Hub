// circles-sync · the nightly Family Circle sync from AxisCare, on its own (2026-10-12). identity-backfill stays down (441).
// node circles_sync_test.mjs
import fs from 'fs'; import path from 'path';
const src = fs.readFileSync('supabase/functions/circles-sync/index.ts', 'utf8')
  .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__sb')
  .replace(/^import \{ jobCaller \} from .*$/m, "const jobCaller = async (req) => req.headers.get('x-cron-secret') === 'good' ? 'cron' : null")
  .replace(/^import \{ OFFICE_ROLES, requireStaff \} from .*$/m, "const OFFICE_ROLES = ['owner_admin']; const requireStaff = async (_a, req) => req.headers.get('Authorization') === 'Bearer staff' ? { ok: true } : (req.headers.get('Authorization') ? { ok: false, status: 403, error: 'Your role does not allow this.' } : { ok: false, status: 401, error: 'Sign in first.' });");
const db = {
  person_source_id: [{ person_id: 'p1', system: 'axiscare', entity_type: 'client', source_id: '11' },
                     { person_id: 'p2', system: 'axiscare', entity_type: 'client', source_id: '12' },
                     { person_id: 'p3', system: 'axiscare', entity_type: 'client', source_id: '13' }],
  person_identity: [{ id: 'p1', display_name: 'Dan Testnew' }, { id: 'p2', display_name: 'Tess Current' }, { id: 'p3', display_name: 'Olga Past' }],
  person_role: [{ person_id: 'p1', role: 'client', status: 'active' }, { person_id: 'p2', role: 'client', status: 'active' }, { person_id: 'p3', role: 'client', status: 'ended' }],
  care_circles: [{ id: 'c2', client_name: 'Tess Current', active: true, axiscare_client_id: '12' }],
  circle_contacts: [{ id: 'k1', circle_id: 'c2', name: 'Mary Manual', source: 'office', phone: '+14170000001' },
                    { id: 'k2', circle_id: 'c2', name: 'Gone Person', source: 'axiscare' },
                    { id: 'k3', circle_id: 'c2', name: 'Sue Sync', source: 'axiscare', relationship: 'Daughter', phone: null, email: null, axiscare_list_number: 1, hipaa_authorized: null, can_make_medical_decisions: null }],
  family_circle_link_log: [], hb: [],
};
let n = 0, writes = 0;
function q(table) {
  const f = []; let ins = null, upd = null;
  const rows = () => db[table].filter(r => f.every(([k, v, op]) => op === 'in' ? v.includes(r[k]) : r[k] === v));
  const c = {
    select() { return c; }, eq(k, v) { f.push([k, v]); if (upd) { rows().forEach(r => Object.assign(r, upd)); } return c; },
    in(k, v) { f.push([k, v, 'in']); return c; },
    insert(o) { writes++; ins = { id: 'new' + (++n), ...o }; db[table].push(ins); return c; },
    update(o) { writes++; upd = o; return c; },
    single: async () => ({ data: ins, error: null }),
    then(res) { return Promise.resolve(ins || upd ? { error: null } : { data: rows(), error: null }).then(res); },
  };
  return c;
}
globalThis.__sb = { from: q, rpc: async (name, a) => { if (name === 'upsert_app_data_item') db.hb.push(a.item); return { data: { outcome: 'linked' }, error: null }; } };
const parties = {
  '11': [{ name: 'Danny Son', relationship: 'Son', listNumber: 1, phones: { 0: { number: '4175550111', type: 'Mobile' } }, hipaaDisclosureAuthorization: '1', canMakeMedicalDecisions: '' }],
  '12': [{ name: 'Mary Manual', relationship: 'Neighbor', listNumber: 2 }, { name: 'Sue Sync', relationship: 'Daughter', listNumber: 1, email: 'sue@example.com' }],
  '13': [{ name: 'Past Family', listNumber: 1 }],
};
let axCalls = 0;
globalThis.fetch = async (url) => { axCalls++; const ax = String(url).match(/clients\/(\d+)\//)[1]; return { ok: true, status: 200, json: async () => ({ results: { responsibleParties: parties[ax] } }) }; };
const tmp = path.join(process.cwd(), '_circles_under_test.ts'); fs.writeFileSync(tmp, src);
let handler; const env = { SUPABASE_URL: 'http://sb', SUPABASE_SERVICE_ROLE_KEY: 'svc', AXISCARE_API_KEY: 'tok', AXISCARE_SITE: '16485' };
globalThis.Deno = { env: { get: k => env[k] }, serve: h => { handler = h; } };
await import(tmp); fs.unlinkSync(tmp);
const call = async (qs, hdr = {}, method = 'POST') => { const r = await handler(new Request('http://x/circles-sync?' + qs, { method, headers: hdr, body: method === 'POST' ? '{}' : undefined })); return { s: r.status, h: r.headers, t: method === 'POST' ? await r.text() : '' }; };
const pre = await call('', {}, 'OPTIONS');
const none = await call(''), anon = await call('', { Authorization: 'Bearer anon' });
const a0 = axCalls;
const ac = await call('auth_check=1', { 'x-cron-secret': 'good' }), acs = await call('auth_check=1', { Authorization: 'Bearer staff' });
const w0 = writes; const dry = await call('dry=1', { Authorization: 'Bearer staff' }); const w1 = writes;
const run = await call('', { 'x-cron-secret': 'good' }); const j = JSON.parse(run.t);
const danC = db.care_circles.find(c => c.axiscare_client_id === '11');
const danK = danC && db.circle_contacts.find(k => k.circle_id === danC.id);
const res = [
  ['the Family Circles page can reach it (CORS)', pre.s === 200 && pre.h.get('Access-Control-Allow-Origin') === '*'],
  ['nobody signed in, or not office staff, is refused before AxisCare is asked', none.s === 401 && anon.s === 403 && a0 === 0],
  ['its nightly schedule gets in, and so does office staff (the Sync button)', JSON.parse(ac.t).caller === 'cron' && JSON.parse(acs.t).caller === 'staff'],
  ['a dry look writes nothing', dry.s === 200 && w1 === w0 && JSON.parse(dry.t).mode === 'DRY RUN'],
  ['a new circle is made for a current client, already linked', !!danC && danC.linked_by === 'automation:circles-sync' && db.family_circle_link_log.length === 1],
  ['the family member arrives with tier, phone and flags', !!danK && danK.name === 'Danny Son' && danK.axiscare_list_number === 1 && danK.phone === '4175550111' && danK.hipaa_authorized === true && danK.can_make_medical_decisions === null],
  ['texting consent is never set by the sync', !!danK && danK.sms_consent === false],
  ['a contact typed in the office is never changed', db.circle_contacts.find(k => k.id === 'k1').relationship === undefined && j.manual_untouched === 1],
  ['an AxisCare contact follows AxisCare', db.circle_contacts.find(k => k.id === 'k3').email === 'sue@example.com'],
  ['someone AxisCare no longer lists is marked, never deleted', !!db.circle_contacts.find(k => k.id === 'k2').axiscare_removed_at],
  ['a past client gets no new circle', !db.care_circles.some(c => c.axiscare_client_id === '13') && j.skipped_past === 1],
  ['the answer is counts only (no names, numbers or sample)', !/Danny|Sue|4175550111|sample/.test(run.t) && j.contacts_added === 1 && j.ok === true],
  ['it leaves the same heartbeat the Hub and the watchdog read', db.hb.some(h => h.id === 'hb_circles-sync' && h.automation === 'circles-sync' && h.ok === true)],
  ['identity-backfill (taken down by 441) is not touched or imported', !src.includes('identity-backfill/') && !/'caregivers'|'candidates'|app_data_items_apply|app_data_save/.test(src)],
];
let pass = 0; for (const [name, good] of res) { console.log((good ? 'PASS ' : 'FAIL ') + name); if (good) pass++; }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1);
