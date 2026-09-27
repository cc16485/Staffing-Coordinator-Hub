// Change 6a · identity-backfill ?circles=1 under Node: real function code, fake database, fake AxisCare.
// node circles_sync_harness.mjs supabase/functions/identity-backfill/index.ts
import fs from 'fs'; import path from 'path';
const src = fs.readFileSync(process.argv[2], 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__fakeDb');
const tmp = path.join(process.cwd(), '_ib_under_test.ts'); fs.writeFileSync(tmp, src);
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note).slice(0, 900)]);
let handler; const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485' };
globalThis.Deno = { env: { get: k => env[k] }, serve: h => { handler = h; } };
let DB, RP, rpcs, nextId;
const reset = () => {
  nextId = 100; rpcs = [];
  DB = { person_source_id: [{ person_id: 'P1', source_id: '501', system: 'axiscare', entity_type: 'client' }, { person_id: 'P2', source_id: '502', system: 'axiscare', entity_type: 'client' },
      { person_id: 'P3', source_id: '503', system: 'axiscare', entity_type: 'client' }, { person_id: 'P4', source_id: '504', system: 'axiscare', entity_type: 'client' }],
    person_identity: [{ id: 'P1', display_name: 'Ruth Jones' }, { id: 'P2', display_name: 'Ann Lee' }, { id: 'P3', display_name: 'Bo Park' }, { id: 'P4', display_name: 'Cy Dunn' }],
    care_circles: [{ id: 'C1', client_name: 'Ruth Jones', active: true, axiscare_client_id: '501' }, { id: 'C2', client_name: 'Ann Lee', active: true, axiscare_client_id: null },
      { id: 'C3', client_name: 'Bo Park', active: true, axiscare_client_id: null }],
    circle_contacts: [
      { id: 1, circle_id: 'C1', name: 'Cathy Jones', relationship: 'Daughter', phone: '111', email: null, axiscare_list_number: 1, hipaa_authorized: false, can_make_medical_decisions: false, source: 'axiscare', sms_consent: true },
      { id: 2, circle_id: 'C1', name: 'Old Neighbor', source: 'axiscare', axiscare_list_number: 3 },
      { id: 3, circle_id: 'C1', name: 'Pastor Tim', source: 'office', phone: '999' },
      { id: 4, circle_id: 'C1', name: 'Dave Jones', source: 'axiscare', axiscare_removed_at: '2026-09-01' },
      { id: 5, circle_id: 'C2', name: 'Someone', source: 'axiscare' }],
    family_circle_link_log: [] };
  RP = { '501': [{ listNumber: '1', name: 'Cathy Jones', relationship: 'Daughter', phones: [{ type: 'Mobile', number: '222' }], email: 'cathy@x', hipaaDisclosureAuthorization: '', canMakeMedicalDecisions: '1' },
      { listNumber: '2', name: 'Dave Jones', relationship: 'Son', phones: [] }, { listNumber: '3', name: 'Pastor Tim', relationship: 'Pastor', phones: [{ type: 'Home', number: '555' }] }],
    '502': [{ listNumber: '1', name: 'New Person', phones: [{ type: 'Mobile', number: '333' }] }], '503': [{ listNumber: '1', name: 'Bo Kid', phones: [] }],
    '504': [{ listNumber: '1', name: 'Cy Kid', phones: [{ type: 'Mobile', number: '444' }] }] };
};
reset();
globalThis.fetch = async (u) => { const m = /clients\/(\d+)\/responsibleParties/.exec(String(u)); if (m) return new Response(JSON.stringify({ results: RP[m[1]] || [] })); throw new Error('unexpected ' + u); };
globalThis.__fakeDb = {
  from: (t) => { const f = []; let op = 'select', payload = null, single = false; const p = {
      select() { return p; }, eq(k, v) { f.push(r => String(r[k]) === String(v)); return p; }, in(k, vs) { f.push(r => vs.map(String).includes(String(r[k]))); return p; },
      insert(row) { op = 'insert'; payload = row; return p; }, update(patch) { op = 'update'; payload = patch; return p; }, single() { single = true; return p; },
      then(ok, bad) { const T = DB[t];
        if (op === 'insert') { const row = { id: 'N' + (nextId++), active: true, ...payload }; T.push(row); return Promise.resolve({ data: single ? row : [row], error: null }).then(ok, bad); }
        if (op === 'update') { T.filter(r => f.every(g => g(r))).forEach(r => Object.assign(r, payload)); return Promise.resolve({ data: null, error: null }).then(ok, bad); }
        return Promise.resolve({ data: T.filter(r => f.every(g => g(r))), error: null }).then(ok, bad); } }; return p; },
  rpc: async (name, a) => { rpcs.push({ name, a }); if (name === 'family_circle_link') { const c = DB.care_circles.find(x => x.id === a.p_circle_id); c.axiscare_client_id = a.p_axiscare_client_id; return { data: { outcome: 'linked' }, error: null }; } return { data: null, error: null }; } };
await import(tmp); fs.unlinkSync(tmp);
const run = async (commit) => { const r = await handler(new Request('http://x/functions/v1/identity-backfill?circles=1' + (commit ? '&commit=1' : ''))); return r.json(); };
const ct = (id) => DB.circle_contacts.find(x => x.id === id);

let snap = JSON.stringify(DB); let b = await run(false);
ck('dry run: counts only, nothing written', JSON.stringify(DB) === snap && rpcs.length === 0 && b.mode === 'DRY RUN', b);
b = await run(true);
ck('an AxisCare family member FOLLOWS AxisCare in full: new phone, email, and the old wrongly-false HIPAA flag becomes "unanswered"',
  ct(1).phone === '222' && ct(1).email === 'cathy@x' && ct(1).hipaa_authorized === null && ct(1).can_make_medical_decisions === true && ct(1).sms_consent === true, ct(1));
ck('someone AxisCare no longer lists is MARKED, not deleted (Ruth\'s old neighbor, Ann\'s old contact); someone who reappears is unmarked', !!ct(2).axiscare_removed_at && !!ct(5).axiscare_removed_at && ct(4).axiscare_removed_at === null && b.contacts_marked_removed === 2 && b.contacts_back_on_axiscare === 1, { c2: ct(2), c4: ct(4), b });
ck('a family member typed in the office is never touched, even when AxisCare has the same name', ct(3).phone === '999' && ct(3).source === 'office' && b.manual_untouched === 1, ct(3));
ck('an unlinked circle the sync itself fed, with an exact unique name, is linked through the door (Ann)', rpcs.some(r => r.name === 'family_circle_link' && r.a.p_circle_id === 'C2' && r.a.p_how === 'sync_exact')
  && DB.circle_contacts.some(x => x.circle_id === 'C2' && x.name === 'New Person'), rpcs);
ck('an unlinked circle typed in the office is NOT fed or linked by name; it waits for a person (Bo)', !DB.circle_contacts.some(x => x.circle_id === 'C3') && b.waiting_for_person_link === 1
  && !DB.care_circles.some(x => x.client_name === 'Bo Park' && x.id !== 'C3'), b);
const cy = DB.care_circles.find(x => x.client_name === 'Cy Dunn');
ck('a client with no circle gets one created already linked, and logged', cy && cy.axiscare_client_id === '504' && cy.link_how === 'sync_created'
  && DB.family_circle_link_log.some(l => l.axiscare_client_id === '504') && DB.circle_contacts.some(x => x.circle_id === cy.id && x.name === 'Cy Kid' && x.sms_consent === false), cy);
snap = JSON.stringify(DB.circle_contacts); b = await run(true);
ck('a second run changes nothing', JSON.stringify(DB.circle_contacts) === snap && b.contacts_updated === 0 && b.contacts_added === 0 && b.circles_created === 0, b);
RP['501'] = []; b = await run(true);
ck('AxisCare answering with no responsible parties marks the AxisCare-sourced ones removed (office-typed untouched)',
  !!ct(1).axiscare_removed_at && !ct(3).axiscare_removed_at, { c1: ct(1), c3: ct(3) });

let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '\n     ' + note)); if (ok) pass++; }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1);
