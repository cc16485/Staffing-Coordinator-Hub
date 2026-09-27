// 5b C · the hub answers "is this the same family?" on a flagged inquiry. node returning_hub_test.mjs ../cc-hub-live/index.html
import fs from 'fs';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const hub = fs.readFileSync(process.argv[2] || '../cc-hub-live/index.html', 'utf8');
const cut = (a, b) => { const i = hub.indexOf(a), j = hub.indexOf(b, i); if (i < 0 || j < 0) throw new Error('missing ' + a); return hub.slice(i, j); };
const block = cut('/* 5b C: an automatic front door', 'let CK_BUSY=false, CK_SET=');
const card = cut("    /* 5b C: \"is this the same family?\" opens the new inquiry", "    if(it && it.source && it.source.type==='journey'){");
ck('copy: no em dashes, no "plain language"', ![block, card].some((b) => /—|plain (language|english)/i.test(b)));

let persisted, toasts;
const DATA = { leads: [{ id: 'Lc', client_first_name: 'Ruth', client_last_name: 'Adams', status: 'Converted' }], ops_items: [] };
const ctx = { DATA, ME: { email: 'kat@mo-care.com' }, escapeHtmlComms: (x) => String(x), document: { getElementById: () => null },
  persist: async (k, x) => persisted.push([k, JSON.parse(JSON.stringify(x))]), ccToast: (m) => toasts.push(m), renderLeadProfile: () => {}, myWorkRefresh: () => {},
  lpLead: null, ckPanel: null, jcSideBySide: null, jcConnect: null, openLeadProfile: null, openClient: null };
const H = new Function(...Object.keys(ctx), block + '\nreturn { ckReturningOpen, ckFoundFromFlag, ckAnswerReturning };')(...Object.values(ctx));
const flag = () => ({ at: 'x', by: 'AI phone call', axiscare_checked: false, matches: [
  { kind: 'inquiry', lead_id: 'Lc', name: 'Ruth Adams', status: 'Converted', why: ['phone'] },
  { kind: 'axiscare', axiscare_client_id: '11', name: 'Earl Baker', active: false, status: 'Discharged', why: ['phone'] },
  { kind: 'axiscare', axiscare_client_id: null, name: 'Walt Old', active: null, status: 'circle closed', why: ['family_phone'], family: ['Sam Old, Son'] }] });

const L = { id: 'Ln', possibly_returning: flag() };
ck('a flagged, unanswered inquiry shows the question; an answered or unflagged one does not',
  H.ckReturningOpen(L) && !H.ckReturningOpen({ possibly_returning: { ...flag(), decision: 'different_family' } }) && !H.ckReturningOpen({}) && !H.ckReturningOpen({ possibly_returning: { matches: [] } }));
const f = H.ckFoundFromFlag(L);
ck('the stored matches become the same panel rows as at inquiry save (the earlier inquiry from the hub, AxisCare, the Family Circle)',
  f.leads.length === 1 && f.leads[0].lead.client_first_name === 'Ruth' && f.clients.length === 2 && f.clients[0].axiscare_client_id === '11' && f.clients[1].family[0] === 'Sam Old, Son' && /couldn't be checked/.test(f.note), f);

persisted = []; toasts = []; DATA.ops_items = [{ id: 'ops_returning_Ln', status: 'open' }];
await H.ckAnswerReturning(L, 'different_family', {});
ck('"a different family": recorded with who and when; the My Work item closes with the answer as its note',
  L.possibly_returning.decision === 'different_family' && L.possibly_returning.decided_by === 'kat@mo-care.com' && !!L.possibly_returning.decided_at
  && DATA.ops_items[0].status === 'done' && /a different family/.test(DATA.ops_items[0].close_note) && persisted.map((p) => p[0]).join() === 'leads,ops_items', { L, ops: DATA.ops_items });
ck('the matches are kept (the answer is added, nothing is erased)', L.possibly_returning.matches.length === 3);
const L2 = { id: 'Lm', possibly_returning: flag() }; persisted = []; DATA.ops_items = [];
await H.ckAnswerReturning(L2, 'same_family', { same_as_lead: 'Lc' });
ck('"the same family": recorded with which inquiry; no item to close is fine', L2.possibly_returning.decision === 'same_family' && L2.possibly_returning.same_as_lead === 'Lc' && persisted.length === 1);
ck('answering never changes the earlier inquiry', DATA.leads[0].status === 'Converted' && !('possibly_returning' in DATA.leads[0]));

ck('My Work: the item opens the new inquiry and says answering closes it', /openLeadProfile\(/.test(card) && /Answering there/.test(card) && /it\.source\.type==='returning'/.test(card));
ck('the profile shows the question (slot + render call)', /<div id="lp_returning"><\/div>/.test(hub) && /  ckRenderReturning\(\);\n  famMount\('famLead'/.test(hub));
ck('link to a former client goes through the side-by-side "Is this the same person?" first', /const r=await jcSideBySide\(l, ch\.ax, 'save'\); if\(r\.choice==='cancel'\) return;/.test(block));

console.log('\n5b C · SAME FAMILY? ON THE INQUIRY · HUB TEST\n' + '='.repeat(60)); let all = true;
for (const [n, g, note] of res) { all &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')); }
console.log('='.repeat(60)); console.log(all ? `ALL ${res.length} CHECKS PASS` : 'FAILED');
