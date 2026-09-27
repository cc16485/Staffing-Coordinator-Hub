// 5b E + F · changes the family asked for, and folding inquiries · the hub's own code against fakes.
// node fold_changes_hub_test.mjs ../cc-hub-live/index.html
import fs from 'fs';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const hub = fs.readFileSync(process.argv[2] || '../cc-hub-live/index.html', 'utf8');
const cut = (a, b) => { const i = hub.indexOf(a), j = hub.indexOf(b, i); if (i < 0 || j < 0) throw new Error('missing ' + a); return hub.slice(i, j); };
const changes = cut('/* ── 5b E (2026-09-27)', 'function cpRenderPayer(){');
const ret = cut('/* 5b C: an automatic front door', 'let CK_BUSY=false, CK_SET=');
const panel = cut('function ckPanel(found, mode){', '/* D: Convert used an existing AxisCare record');
ck('copy: no em dashes, no "plain language"', ![changes, ret, panel].some((b) => /—|plain (language|english)/i.test(b)));

/* E */
const E = new Function('DATA', 'CP', changes + '\nreturn { CPCH_KINDS, cpChangesFor, cpIsMedicaid };');
const DATA = { staffing_tasks: [{ id: 1, axiscare_client_id: '10', created_at: '2026-09-01' }, { id: 2, axiscare_client_id: '11', created_at: '2026-09-02' }, { id: 3, axiscare_client_id: '10', created_at: '2026-09-03' }, { id: 4, about: 'Ruth Adams', created_at: '2026-09-04' }] };
let e = E(DATA, { r: { payer: 'Medicaid (DSDS)' } });
ck('E · every kind maps to a request type the Staffing Hub already shows (hours, schedule, todo)', e.CPCH_KINDS.every((k) => ['hours', 'schedule', 'todo'].includes(k[2])) && e.CPCH_KINDS.length === 5);
ck('E · a client\'s requests are found by their AxisCare id only (never by name), newest first', e.cpChangesFor('10').map((t) => t.id).join() === '3,1', e.cpChangesFor('10'));
ck('E · the Medicaid reminder knows a Medicaid client', e.cpIsMedicaid() && !E(DATA, { r: { payer: 'Private pay' } }).cpIsMedicaid());
ck('E · a request carries the AxisCare id, who asked and how, and goes to Staffing', /axiscare_client_id:String\(CP\.ax\)/.test(changes) && /source_who:who, source_how:how/.test(changes) && /direction:'to_staffing'/.test(changes));
ck('E · the card shows on a client profile (AxisCare id) and not on an inquiry alone', /if\(!CP\.ax\)\{ box\.innerHTML=''; return; \}/.test(changes) && /cpRenderTeam\(\); cpRenderChanges\(\);/.test(hub) && /<div id="cp_changes"><\/div>/.test(hub));
ck('E · "Open their profile" from the inquiry check carries what was typed into the request', /CP\.changePrefill=\{message:v\('lead_interest_notes'\)/.test(hub));

/* F */
let persisted = [];
const ctx = { DATA: { leads: [{ id: 'K', status: 'Contacted' }], ops_items: [{ id: 'ops_returning_N', status: 'open' }] }, ME: { email: 'kat@mo-care.com' }, escapeHtmlComms: String,
  document: { getElementById: () => null }, persist: async (k, x) => persisted.push([k, JSON.parse(JSON.stringify(x))]), ccToast: () => {}, renderLeadProfile: () => {}, myWorkRefresh: () => {},
  lpLead: null, ckPanel: null, jcSideBySide: null, jcConnect: null, openLeadProfile: null, openClient: null, CP: {} };
const F = new Function(...Object.keys(ctx), ret + '\nreturn { ckFold, ckLeadOpen };')(...Object.values(ctx));
ck('F · only an open inquiry can be folded into (not Converted, Lost or archived)', F.ckLeadOpen({ status: 'New' }) && !F.ckLeadOpen({ status: 'Converted' }) && !F.ckLeadOpen({ status: 'Lost' }) && !F.ckLeadOpen({ status: 'New', archived: true }));
const N = { id: 'N', status: 'New', interest_notes: 'Mom wants more help', created_at: '2026-09-27T10:00:00Z', possibly_returning: { by: 'AI phone call', matches: [{ kind: 'inquiry', lead_id: 'K' }] } };
const kept = await F.ckFold(N, { kind: 'lead', lead_id: 'K' });
ck('F · folding into an inquiry: archived as Duplicate of it, with who and when (the mirror reads exactly these)', N.archived && N.archive_reason === 'Duplicate' && N.duplicate_of === 'K' && N.folded_into.kind === 'lead' && N.folded_into.by === 'kat@mo-care.com', N);
ck('F · the kept inquiry gets its notes; the question is answered and the My Work item closes', kept && /folded into this one \(AI phone call, 2026-09-27\): Mom wants more help/.test(kept.comm_log.at(-1).body) && N.possibly_returning.decision === 'same_family' && ctx.DATA.ops_items[0].status === 'done', { kept, N });
const N2 = { id: 'N2', status: 'New' };
await F.ckFold(N2, { kind: 'client', axiscare_client_id: '10' });
ck('F · folding into a client: archived "Folded into client", pointing at the AxisCare id (no duplicate_of)', N2.archived && N2.archive_reason === 'Folded into client' && N2.folded_into.axiscare_client_id === '10' && !N2.duplicate_of && persisted.at(-1)[1].id === 'N2', N2);
ck('F · the review offers Fold into it (open inquiries only) and Fold into the client (current clients only)',
  /ckLeadOpen\(l\)\?b\('fold_lead',i,'Fold into it',true\):''/.test(panel) && /b\('client',i,'Open their profile'\)\+\(mode==='review'\?b\('fold_client',i,'Fold into the client',true\):''\)/.test(panel));
ck('F · Mark as duplicate says what happens to its Journey', /Its Journey closes by itself and points at the kept one, unless a client was already confirmed on it\./.test(hub));

console.log('\n5b E + F · CHANGES AND FOLDING · HUB TEST\n' + '='.repeat(60)); let all = true;
for (const [n, g, note] of res) { all &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')); }
console.log('='.repeat(60)); console.log(all ? `ALL ${res.length} CHECKS PASS` : 'FAILED');
