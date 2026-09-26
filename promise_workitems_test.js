// Promise engine · work items (Step 6): node promise_workitems_test.js <path to promise-engine.js>
require(require('path').resolve(process.argv[2]));
const P = globalThis.CCPromise;
const res = [];
const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note).slice(0, 700)]);
const T = '2026-09-26';
const C = (ep, o) => Object.assign({ episode_id: ep, confidence: 'expected', target_date: '2026-10-05', commitment_owner: 'Kat@CC.test', owed_by: 'kat@cc.test',
  promised_wording: 'Expect to begin October 5.', promised_to: 'Cathy (daughter)', promised_on: '2026-09-20', last_update_at: null }, o || {});
const base = { today: T, labels: { e1: 'Ruth Jones', e2: 'Ann Lee', e3: 'Bo Park' }, states: { e1: 'provisional', e2: 'established', e3: 'converted' },
  leads: { e1: 'L1' }, axiscare: { e2: '502' }, domainOwner: code => code === 'client_care' ? 'care@cc.test' : 'intake@cc.test' };

const chiHour = iso => +new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hourCycle: 'h23', hour: '2-digit' }).format(new Date(iso));
const chiDay = iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(iso));
let r0 = P.workItems(Object.assign({}, base, { contracts: [C('e1', { next_update_owed_on: '2026-09-25' })], existing: [] }));
ck('two days late is normal urgency; due at 11:59pm Springfield time that day, whatever the machine clock',
  r0.create[0].urgency === 'normal' && chiHour(r0.create[0].due) === 23 && chiDay(r0.create[0].due) === '2026-09-25', r0.create[0]);
let r = P.workItems(Object.assign({}, base, { contracts: [C('e1', { next_update_owed_on: '2026-09-24' }), C('e2', { next_update_owed_on: '2026-09-30' })], existing: [] }));
const it = r.create[0];
ck('an overdue update becomes one My Work item; an upcoming one does not', r.create.length === 1 && it.id === 'prom_upd_e1_2026-09-24' && r.counts.contracts_seen === 2, r);
ck('the item is a prompt with a next action, owned by whoever owes the update, in the inquiry domain, linking to the lead',
  it.kind === 'promise_update' && it.owner === 'kat@cc.test' && it.domain === 'family_enquiries' && it.source.type === 'journey'
  && it.source.lead_id === 'L1' && /Logging it closes this/.test(it.next_action) && /"Expect to begin October 5\."/.test(it.detail)
  && it.created_by === 'automation:promises' && it.status === 'open', it);
r = P.workItems(Object.assign({}, base, { contracts: [C('e1', { next_update_owed_on: '2026-09-22' })], existing: [] }));
ck('overdue by more than two days is high urgency', r.create[0].urgency === 'high', r.create[0]);
r = P.workItems(Object.assign({}, base, { contracts: [C('e1', { next_update_owed_on: '2026-09-24' })], existing: [it] }));
ck('a rerun never duplicates: the same id already exists', r.create.length === 0 && r.counts.skipped_existing === 1 && r.close.length === 0, r.counts);
r = P.workItems(Object.assign({}, base, { contracts: [C('e1', { next_update_owed_on: '2026-09-24' })], existing: [Object.assign({}, it, { status: 'done' })] }));
ck('an id that was closed is never created again', r.create.length === 0, r.counts);
r = P.workItems(Object.assign({}, base, { contracts: [C('e1', { next_update_owed_on: '2026-10-03', last_update_at: '2026-09-26T15:00:00Z' })], existing: [it] }));
ck('logging the update (next one moved later) closes the open item as satisfied', r.close.length === 1 && r.close[0].why === 'promise_satisfied' && r.create.length === 0, r);
r = P.workItems(Object.assign({}, base, { contracts: [C('e1', { next_update_owed_on: null, none_owed_reason: 'Care has started' })], existing: [it] }));
ck('"nothing more owed" also closes it', r.close.length === 1, r);
r = P.workItems(Object.assign({}, base, { contracts: [], existing: [it, { id: 'obl_x', created_by: 'automation:obligations', status: 'open' }, { id: 'manual', status: 'open' }] }));
ck('it only ever closes its own items, never other automations\' or people\'s', r.close.length === 1 && r.close[0].item.id === it.id, r.close.map(x => x.item.id));
r = P.workItems(Object.assign({}, base, { contracts: [C('e1', { next_update_owed_on: '2026-06-01' })], existing: [] }));
ck('age guard: an update owed more than 60 days ago is counted, not created', r.create.length === 0 && r.counts.too_old === 1, r.counts);
r = P.workItems(Object.assign({}, base, { contracts: [C('e2', { confidence: 'committed', target_date: '2026-09-20', next_update_owed_on: '2026-09-30' })],
  states: { e2: 'converted' }, existing: [] }));
ck('a committed start date that passed before care began is its own high-urgency item', r.create.length === 1 && r.create[0].kind === 'promise_lapsed'
  && r.create[0].id === 'prom_lapse_e2_2026-09-20' && r.create[0].urgency === 'high', r.create);
r = P.workItems(Object.assign({}, base, { contracts: [C('e2', { next_update_owed_on: '2026-09-26', owed_by: null, commitment_owner: '' })], existing: [] }));
ck('no owner on the contract: routed to the domain owner (client care for someone receiving care)', r.create[0].owner === 'care@cc.test' && r.create[0].domain === 'client_care', r.create[0]);
const reviews = [{ review_id: 'rv1', kind: 'boundary', seat: 'owner_decision', episode_id: 'e2', created_at: '2026-09-25T10:00:00Z' }];
r = P.workItems(Object.assign({}, base, { contracts: [], reviews, existing: [] }));
ck('an open Journey review becomes one item for the seat (no single owner), saying what needs deciding',
  r.create.length === 1 && r.create[0].id === 'jrev_rv1' && r.create[0].owner === '' && /Owner \/ Decision/.test(r.create[0].title)
  && /no recorded end/.test(r.create[0].title) && r.create[0].source.axiscare_client_id === '502' && r.counts.reviews_seen === 1, r.create[0]);
r = P.workItems(Object.assign({}, base, { contracts: [], reviews: [], existing: [Object.assign({}, r.create[0])] }));
ck('a decided review closes its item', r.close.length === 1 && r.close[0].why === 'review_decided', r.close);
const many = []; for (let i = 0; i < 25; i++) many.push(C('m' + i, { next_update_owed_on: i < 5 ? '2026-09-20' : '2026-09-26' }));
r = P.workItems(Object.assign({}, base, { contracts: many, existing: [] }));
ck('ceiling: at most 20 per run, the most overdue first, the rest deferred (not dropped)',
  r.create.length === 20 && r.counts.deferred === 5 && r.create.slice(0, 5).every(x => x.urgency === 'high'), r.counts);
ck('bad input yields nothing, never a throw', P.workItems().create.length === 0 && P.workItems({ contracts: [null, {}], reviews: [null, {}] }).create.length === 0);
let ok = true;
console.log('\nPROMISE ENGINE · WORK ITEMS\n' + '='.repeat(60));
for (const [n, g, note] of res) { ok = ok && g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')); }
console.log('='.repeat(60)); console.log(ok ? `ALL ${res.length} TESTS PASS` : `${res.filter(r => !r[1]).length} FAILED`);
process.exit(ok ? 0 : 1);
