// Promise engine tests: node promise_engine_test.js <path to promise-engine.js>
require(require('path').resolve(process.argv[2]));
const P = globalThis.CCPromise;
const res = [];
const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note)]);
const base = { confidence: 'likely', target_date: '2026-10-05', commitment_owner: 'kat@cc.test', owed_by: 'kat@cc.test',
  promised_wording: null, promised_to: null, promised_on: null, last_update_at: null, last_update_to: null, last_update_summary: null };
const C = (id, o) => Object.assign({ episode_id: id }, base, o || {});
const T = '2026-09-26';

let r = P.evaluate({ today: T, contracts: [C('a', { next_update_owed_on: '2026-09-29' })] });
ck('upcoming update: shown as upcoming, no work item yet', r.promises[0].state === 'upcoming' && r.promises[0].days === 3 && r.items.length === 0, r);
r = P.evaluate({ today: T, contracts: [C('a', { next_update_owed_on: '2026-09-26' })], labels: { a: 'Linda Smith' } });
ck('due today: one item, titled with the family and the client, owned by whoever owes it',
  r.promises[0].state === 'due_today' && r.items.length === 1 && r.items[0].title === 'Update owed to the family about Linda Smith'
  && r.items[0].owner === 'kat@cc.test' && r.items[0].detail === 'Due today', r);
r = P.evaluate({ today: T, contracts: [C('a', { next_update_owed_on: '2026-09-24', last_update_to: 'Cathy (daughter)',
  last_update_at: '2026-09-20T15:00:00Z', last_update_summary: 'Still on for the 5th' })], labels: { a: 'Linda Smith' } });
ck('overdue: says by how many days; addressed to whoever we last updated; talking points quote the last update',
  r.promises[0].state === 'overdue' && r.promises[0].days === -2 && r.items[0].detail === 'Overdue by 2 days'
  && r.items[0].title === 'Update owed to Cathy (daughter) about Linda Smith' && r.items[0].draft.includes('"Still on for the 5th"'), r);
r = P.evaluate({ today: T, contracts: [C('a', { next_update_owed_on: '2026-09-25' })] });
ck('one day overdue reads "1 day", not "1 days"', r.items[0].detail === 'Overdue by 1 day', r.items[0]);
r = P.evaluate({ today: T, contracts: [C('a', { next_update_owed_on: null, none_owed_reason: 'Care has started' })] });
ck('nothing owed: shown with the reason, no item', r.promises[0].state === 'none_owed' && r.promises[0].reason === 'Care has started' && r.items.length === 0, r);
const W = 'Expect to begin October 5, contingent on authorization and staffing.';
r = P.evaluate({ today: '2026-10-07', contracts: [C('a', { confidence: 'committed', target_date: '2026-10-05', promised_wording: W,
  promised_to: 'Cathy (daughter)', promised_on: '2026-09-20', next_update_owed_on: '2026-10-09' })], labels: { a: 'Linda Smith' }, states: { a: 'converted' } });
ck('lapsed: a committed start date that passed before care started raises its own item, quoting the words promised',
  r.items.length === 1 && r.items[0].kind === 'promise_lapsed' && r.items[0].detail.includes('We told Cathy (daughter) Oct 5')
  && r.items[0].draft.includes(W), r);
r = P.evaluate({ today: '2026-10-07', contracts: [C('a', { confidence: 'committed', target_date: '2026-10-05', promised_wording: W,
  promised_to: 'Cathy', promised_on: '2026-09-20', next_update_owed_on: '2026-10-09' })], states: { a: 'established' } });
ck('lapsed does not fire once care has started (Journey established)', r.items.length === 0, r);
r = P.evaluate({ today: '2026-10-07', contracts: [C('a', { confidence: 'expected', target_date: '2026-10-05', next_update_owed_on: '2026-10-09' })] });
ck('lapsed only applies to a commitment, not an Expected date', r.items.length === 0, r);
r = P.evaluate({ today: T, contracts: [C('a', { next_update_owed_on: '2026-09-26' }), C('b', { next_update_owed_on: '2026-09-20' })] });
ck('items are ordered oldest due first and have stable ids (same input, same id)',
  r.items.map(i => i.episode_id).join() === 'b,a' && r.items[1].id === 'promise:update:a:2026-09-26'
  && P.evaluate({ today: T, contracts: [C('a', { next_update_owed_on: '2026-09-26' })] }).items[0].id === r.items[1].id, r.items);
ck('today is the office calendar: 04:30 UTC on Sep 27 is still Sep 26 in Springfield',
  P.todayChicago(new Date('2026-09-27T04:30:00Z')) === '2026-09-26' && P.todayChicago(new Date('2026-09-27T06:00:00Z')) === '2026-09-27');
const before = JSON.stringify(base);
P.evaluate({ today: T, contracts: [C('a', { next_update_owed_on: '2026-09-20' })] });
ck('the engine does not modify its input', JSON.stringify(base) === before);
ck('bad input yields nothing, never a throw', P.evaluate({ contracts: [null, {}, C('', {})] }).items.length === 0 && P.evaluate().items.length === 0);
let ok = true;
console.log('\nPROMISE ENGINE · TESTS\n' + '='.repeat(60));
for (const [n, g, note] of res) { ok = ok && g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note.slice(0, 600) : '')); }
console.log('='.repeat(60)); console.log(ok ? `ALL ${res.length} TESTS PASS` : `${res.filter(r => !r[1]).length} FAILED`);
process.exit(ok ? 0 : 1);
