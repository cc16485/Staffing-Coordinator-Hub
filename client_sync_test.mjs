// client-sync · the 6-hourly AxisCare client sync (2026-10-12, "dan has not been pulled over"). identity-backfill stays down (441).
// node client_sync_test.mjs
import fs from 'fs'; import path from 'path';
const src = fs.readFileSync('supabase/functions/client-sync/index.ts', 'utf8')
  .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__sb')
  .replace(/^import \{ jobCaller \} from .*$/m, "const jobCaller = async (req) => req.headers.get('x-cron-secret') === 'good' ? 'cron' : null");
/* a tiny in-memory database: enough of the query chain for this mode */
const db = {
  person_source_id: [{ person_id: 'p-old', system: 'axiscare', entity_type: 'client', source_id: '1' },
                     { person_id: 'p-past', system: 'axiscare', entity_type: 'client', source_id: '3' }],
  person_identity: [{ id: 'p-old', display_name: 'Old Client' }, { id: 'p-past', display_name: 'Past Person' }, { id: 'p-cg', display_name: 'Sam Twin' }],
  person_role: [{ id: 'r1', person_id: 'p-old', role: 'client', status: 'active' }, { id: 'r2', person_id: 'p-past', role: 'client', status: 'ended' }],
  phone_index: [], hb: [],
};
let n = 0;
function q(table) {
  const f = []; let ins = null, lim = null;
  const rows = () => db[table].filter(r => f.every(([k, v, neg]) => neg ? r[k] !== v : r[k] === v));
  const c = {
    select() { return c; }, eq(k, v) { f.push([k, v]); return c; }, neq(k, v) { f.push([k, v, true]); return c; },
    in() { return c; }, limit(x) { lim = x; return c; },
    insert(o) { ins = { ...o, id: o.id || ('new' + (++n)) }; db[table].push(ins); return c; },
    single: async () => ({ data: ins, error: null }),
    maybeSingle: async () => ({ data: (lim ? rows().slice(0, lim) : rows())[0] || null, error: null }),
    then(res) { return Promise.resolve(ins ? { error: null } : { data: rows(), error: null }).then(res); },
  };
  return c;
}
globalThis.__sb = { from: q, rpc: async (_n, a) => { db.hb.push(a.item); return { error: null }; } };
const tmp = path.join(process.cwd(), '_sync_under_test.ts'); fs.writeFileSync(tmp, src);
let handler; const env = { SUPABASE_URL: 'http://sb', SUPABASE_SERVICE_ROLE_KEY: 'svc-key-long-enough-000000', AXISCARE_API_KEY: 'tok', AXISCARE_SITE: '16485' };
globalThis.Deno = { env: { get: k => env[k] }, serve: h => { handler = h; } };
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ results: { clients: [
  { id: 1, firstName: 'Old', lastName: 'Client', status: { active: true } },
  { id: 2, firstName: 'Dan', lastName: 'New', status: { active: true }, mobilePhone: '4175550100' },
  { id: 3, firstName: 'Past', lastName: 'Person', status: { active: true } },
  { id: 4, firstName: 'Sam', lastName: 'Twin', status: { active: true } },
  { id: 5, firstName: 'Gone', lastName: 'Away', status: { active: false } } ] } }) });
await import(tmp); fs.unlinkSync(tmp);
const call = async (qs, hdr = {}) => { const r = await handler(new Request('http://x/client-sync?' + qs, { method: 'POST', headers: hdr, body: '{}' })); return { s: r.status, t: await r.text() }; };
const out1 = await call('', { Authorization: 'Bearer anon' });
const ac = await call('auth_check=1', { 'x-cron-secret': 'good' });
const people0 = db.person_identity.length;
const dry = await call('dry=1', { 'x-cron-secret': 'good' });
const people1 = db.person_identity.length;
const run = await call('', { 'x-cron-secret': 'good' }); const j = JSON.parse(run.t);
const dan = db.person_source_id.find(x => x.source_id === '2');
const again = await call('', { 'x-cron-secret': 'good' }); const j2 = JSON.parse(again.t);
const res = [
  ['the public key alone is refused', out1.s === 401],
  ['its schedule gets in', ac.s === 200 && JSON.parse(ac.t).caller === 'cron'],
  ['a dry look writes nothing', dry.s === 200 && people1 === people0],
  ['Dan (active in AxisCare, new to the Hub) is added and connected', !!dan && db.person_role.some(r => r.person_id === dan.person_id && r.role === 'client' && r.status === 'active')],
  ['his AxisCare number is indexed as confirmed', db.phone_index.some(p => p.phone === '+14175550100' && p.confidence === 'confirmed')],
  ['a same-name person is left for a person to connect, not duplicated', !db.person_source_id.some(x => x.source_id === '4') && db.person_identity.filter(p => p.display_name === 'Sam Twin').length === 1],
  ['a past client is never made active again', !db.person_role.some(r => r.person_id === 'p-past' && r.status === 'active') && j.past_left_for_a_person === 1],
  ['an inactive AxisCare client is never copied in', !db.person_source_id.some(x => x.source_id === '5')],
  ['the answer is counts only, no names', j.created === 1 && j.name_coincidences === 1 && !/Dan|Twin|4175550100/.test(run.t) && j.ok === true],
  ['identity-backfill (taken down by 441) is untouched and nothing imports it', !fs.readFileSync('supabase/functions/identity-backfill/index.ts', 'utf8').includes('client_sync') && !src.includes('identity-backfill/')],
  ['it never touches the caregiver or candidate lists', !/'caregivers'|'candidates'|app_data_items_apply|app_data_save/.test(src)],
  ['it leaves a heartbeat for the watchdog', db.hb.some(h => h.id === 'hb_client-sync' && h.ok === true && /1 new client added, 1 left/.test(h.note))],
  ['a second run adds nobody', j2.created === 0 && db.person_source_id.filter(x => x.source_id === '2').length === 1],
];
let pass = 0; for (const [name, good] of res) { console.log((good ? 'PASS ' : 'FAIL ') + name); if (good) pass++; }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1);
