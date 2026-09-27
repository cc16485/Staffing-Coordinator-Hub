// Change 8c · one family, one row of links · the hub's own code against a fake database.
// node family_links_hub_test.mjs ../cc-hub-live/index.html
import fs from 'fs';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const hub = fs.readFileSync(process.argv[2] || '../cc-hub-live/index.html', 'utf8');
const cut = (a, b) => { const i = hub.indexOf(a), j = hub.indexOf(b, i); if (i < 0 || j < 0) throw new Error('missing ' + a); return hub.slice(i, j); };
const famBlock = cut('/* ===================== ONE FAMILY, ONE ROW OF LINKS', '/* ── SLIDE-OVER OPENERS');
const nameBlock = cut('let CL360_ROSTER = [];', 'async function cl360Roster');
const openerBlock = cut('async function openClientProfile(ref, tab){', 'function pdClose(');
const rosterBlock = cut('function getClientRoster(){', 'async function renderClients(');
const schedBlock = cut('function scheduleAssessmentFromLead(leadId){', '/* ---------------- GUIDED CALL COCKPIT');
ck('copy: no em dashes in the new screen text', ![famBlock, openerBlock].some(b => (b.match(/'[^'\n]*'/g) || []).join(' ').includes('—')));

/* the fake world: the Smith family (confirmed), a second Mary Smith, and loose records */
const T = {
  lead_journey_connection: [{ episode_id: 'E1', lead_id: 'L1', axiscare_client_id: '501', person_id: 'P1', confirmed_at: '2026-09-01' }],
  person_source_id: [{ person_id: 'P1', source_id: '501', system: 'axiscare', entity_type: 'client' }, { person_id: 'P2', source_id: '502', system: 'axiscare', entity_type: 'client' }],
  journey_episode: [{ episode_id: 'E1', person_id: 'P1' }, { episode_id: 'E2', person_id: 'P1' }, { episode_id: 'E9', person_id: 'P2' }],
  team_build_link_current: [{ plan_id: 'tb1', episode_id: 'E2' }, { plan_id: 'tb9', episode_id: 'E9' }],
  client_queue: [{ id: 'Q1', client_name: 'Mary Smith', axiscare_client_id: '501', status: 'pending', created_at: '2026-09-02' }, { id: 'Q0', axiscare_client_id: '501', status: 'complete', created_at: '2026-01-01' }],
  care_circles: [{ id: 'C1', client_name: 'Mary Smith', axiscare_client_id: '501', active: true }, { id: 'C7', client_name: 'Somebody', axiscare_client_id: null, active: true }],
};
let queries = 0;
const sb = { from: (t) => { const f = []; const b = { select() { return b; }, eq(c, v) { f.push(r => String(r[c]) === String(v)); return b; }, in(c, a) { f.push(r => a.map(String).includes(String(r[c]))); return b; },
  then(ok) { queries++; return Promise.resolve({ data: (T[t] || []).filter(r => f.every(fn => fn(r))), error: null }).then(ok); } }; return b; } };
const DATA = {
  leads: [{ id: 'L1', first_name: 'Dana', last_name: 'Smith', client_first_name: 'Mary', client_last_name: 'Smith', status: 'Converted', axiscare_client_id: '501' },
          { id: 'L2', first_name: 'Bob', last_name: 'Jones', client_first_name: 'Ann', client_last_name: 'Jones', axiscare_client_id: '777' },
          { id: 'L3', first_name: 'Sue', last_name: 'Other', client_first_name: 'Mary', client_last_name: 'Smith' }],
  care_assessments: [{ id: 'A1', lead_id: 'L1', client_name: 'Mary Smith', created_at: '2026-08-20', visit_date: '2026-08-21' },
                     { id: 'A3', client_name: 'Mary Smith', created_at: '2026-08-25' },
                     { id: 'A4', lead_id: 'L2', client_name: 'Ann Jones', created_at: '2026-08-26' }],
  staffing_plans: [{ id: 'tb1', client: 'Mary S', status: 'building', created_at: '2026-09-03' }, { id: 'tb2', client: 'Mary Smith', status: 'building' }, { id: 'tb9', client: 'Other Mary' }],
  care_plans: [], client_checkins: [], coverage_cases: [],
};
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const calls = [];
const els = {}; const el = (id) => (els[id] = els[id] || { id, innerHTML: '', dataset: {}, style: {}, scrollIntoView() { calls.push(['scroll', id]); } });
const document = { getElementById: (id) => el(id), querySelector: (q) => (q.includes('data-fc') ? { open: false, scrollIntoView() { calls.push(['scroll', q]); } } : null) };
let confirmAnswer = true; const persisted = [];
const ctx = { sb, DATA, esc, escapeHtmlComms: esc, document, CSS: { escape: (s) => s }, setTimeout: (f) => f(),
  openLeadProfile: (id) => calls.push(['lead', id]), openClientProfile0: null, pdClose: () => {}, switchTab: (t) => calls.push(['tab', t]),
  openAssessmentModal: (id, l) => calls.push(['assessment', id, l && l.id]), cqToggle: (id) => calls.push(['cqToggle', id]), swSubGo: (s) => calls.push(['sub', s]),
  tbOpen: (id) => calls.push(['plan', id]), confirm: () => confirmAnswer, persist: (k, v) => persisted.push([k, v.id, v.status]),
  cl360Roster: async () => ctx.__roster, cl360RenderInto: async (r) => calls.push(['render360', r.client_name, r.axiscare_client_id]), __roster: [],
  /* One profile (step 1): a client name opens the full-page profile for that roster row */
  openClient: async (seed, tab) => seed.launch_id ? calls.push(['launch-profile', seed.launch_id, tab]) : calls.push(['render360', seed.r.client_name, seed.r.axiscare_client_id]) };
el('cq-body-Q1').style.display = 'none';
const api = new Function(...Object.keys(ctx), famBlock + nameBlock + openerBlock + rosterBlock + schedBlock
  + '\nreturn { famResolve, famStripHtml, famGo, famMount, cl360NameKey, cl360UniqueName, cl360SameClient, openClientProfile, getClientRoster, scheduleAssessmentFromLead, setRoster:(r)=>{ CL360_ROSTER=r; }, FAM };')(...Object.values(ctx));
ctx.openClientProfile0 = api.openClientProfile;

/* family finder */
let f = await api.famResolve({ lead_id: 'L1' });
ck('from the inquiry: the confirmed client, the assessment (by lead id), the open launch, the team plan (by its Journey link), the Family Circle',
  f.lead.id === 'L1' && f.lead_confirmed && f.ax === '501' && f.assessment.id === 'A1' && f.launch.id === 'Q1' && f.plan.id === 'tb1' && f.circle.id === 'C1', f);
f = await api.famResolve({ ax: '501' });
ck('from Client 360 (AxisCare id): the same family, and the confirmed inquiry', f.lead.id === 'L1' && f.lead_confirmed && f.plan.id === 'tb1' && f.circle.id === 'C1' && f.launch.id === 'Q1', f);
f = await api.famResolve({ plan_id: 'tb1' });
ck('from the Team Builder plan: through its Journey link to the inquiry, the client and the circle', f.plan.id === 'tb1' && f.lead.id === 'L1' && f.ax === '501' && f.circle.id === 'C1', f);
f = await api.famResolve({ circle_id: 'C1' });
ck('from the Family Circle: through its AxisCare id to everything else', f.circle.id === 'C1' && f.lead.id === 'L1' && f.plan.id === 'tb1', f);
f = await api.famResolve({ launch_id: 'Q1' });
ck('from the New Clients launch: the whole family', f.launch.id === 'Q1' && f.lead.id === 'L1' && f.assessment.id === 'A1' && f.plan.id === 'tb1' && f.circle.id === 'C1', f);
f = await api.famResolve({ assessment_id: 'A3' });
ck('NEVER BY NAME: an assessment typed as "Mary Smith" with no lead or AxisCare id links to nothing, even though a Mary Smith family exists',
  f.assessment.id === 'A3' && !f.lead && !f.ax && !f.plan && !f.circle && !f.launch, f);
f = await api.famResolve({ plan_id: 'tb2' });
ck('NEVER BY NAME: a plan named "Mary Smith" with no Journey link links to nothing else', f.plan.id === 'tb2' && !f.lead && !f.ax && !f.circle, f);
f = await api.famResolve({ lead_id: 'L2' });
ck('a lead that only CARRIES an AxisCare id (never confirmed) keeps its own assessment; its "client" comes from the carried id only through a confirmed link, so none here', f.lead.id === 'L2' && !f.lead_confirmed && f.assessment.id === 'A4', f);
f = await api.famResolve({ ax: '777' });
ck('from an AxisCare id that one lead carries unconfirmed: the inquiry shows, marked not confirmed', f.lead.id === 'L2' && f.lead_confirmed === false, f);
T.person_source_id.push({ person_id: 'P3', source_id: '888', system: 'axiscare', entity_type: 'client' }); DATA.leads.push({ id: 'L4', axiscare_client_id: '888' }, { id: 'L5', axiscare_client_id: '888' });
f = await api.famResolve({ ax: '888' });
ck('two leads carrying the same unconfirmed AxisCare id: neither is guessed', !f.lead, f);
const q0 = queries; await api.famResolve({ ax: '501' });
ck('a second look within a minute is served from memory (no new queries)', queries === q0);

/* the row */
f = await api.famResolve({ lead_id: 'L1' });
const row = api.famStripHtml(f, 'lead');
ck('the row: this screen is marked "you are here"; the others are links; nothing missing', row.includes('title="You are here">📞 Inquiry') && row.includes("famGo('assessment',&quot;A1&quot;)")
  && row.includes("famGo('launch',&quot;Q1&quot;)") && row.includes("famGo('client',&quot;501&quot;)") && row.includes("famGo('plan',&quot;tb1&quot;)") && row.includes("famGo('family',&quot;C1&quot;)"), row);
const row2 = api.famStripHtml(await api.famResolve({ assessment_id: 'A3' }), 'assessment');
ck('the row: missing pieces say what is missing instead of guessing', row2.includes('no inquiry linked') && row2.includes('not an AxisCare client yet') && row2.includes('no team plan linked') && row2.includes('no Family Circle linked') && row2.includes('no launch yet'), row2);
await api.famMount('famX', { lead_id: 'L1' }, 'lead');
ck('mounting fills the screen\'s slot', el('famX').innerHTML.includes('Client 360'));

/* the links go to the right place */
calls.length = 0;
api.famGo('lead', 'L1'); api.famGo('client', '501'); api.famGo('assessment', 'A1'); api.famGo('launch', 'Q1'); api.famGo('plan', 'tb1'); api.famGo('family', 'C1');
const k = (c) => JSON.stringify(c);
ck('each link opens its screen on that family\'s record', [['lead', 'L1'], ['tab', 'assessments'], ['assessment', 'A1', undefined], ['launch-profile', 'Q1', 'start'], ['tab', 'hourswatch'], ['sub', 'builder'], ['plan', 'tb1'], ['tab', 'circles']].every(c => calls.some(x => k(x) === k(c))), calls);

/* Client 360 never by first name */
const R = [{ client_name: 'Mary Smith', axiscare_client_id: '501' }, { client_name: 'Mary Jones', axiscare_client_id: '503' }, { client_name: 'Ann Jones', axiscare_client_id: '' }];
api.setRoster(R); ctx.__roster = R;
calls.length = 0; await api.openClientProfile('Mary');
ck('Client 360: "Mary" alone opens nobody (it used to open the first Mary)', !calls.some(c => c[0] === 'render360') && el('pdBody').innerHTML.includes('No profile found'), el('pdBody').innerHTML);
calls.length = 0; await api.openClientProfile('mary  SMITH');
ck('Client 360: a full name held by exactly one client opens them', calls.some(c => k(c) === k(['render360', 'Mary Smith', '501'])));
calls.length = 0; await api.openClientProfile('501');
ck('Client 360: an AxisCare id opens them', calls.some(c => k(c) === k(['render360', 'Mary Smith', '501'])));
const R2 = R.concat([{ client_name: 'Mary Smith', axiscare_client_id: '502' }]); api.setRoster(R2); ctx.__roster = R2;
calls.length = 0; await api.openClientProfile('Mary Smith');
ck('Client 360: two clients with the same full name: it asks which one (by AxisCare id), never guesses', !calls.some(c => c[0] === 'render360') && el('pdBody').innerHTML.includes('More than one client is named') && el('pdBody').innerHTML.includes('data-open-client="501"') && el('pdBody').innerHTML.includes('data-open-client="502"'));
api.setRoster(R);
ck('history matching: a record with an AxisCare id matches only that id; one without matches only a full name held by one client; a first name never',
  api.cl360SameClient('Mary Smith', '503', 'Mary Smith', '501') === false && api.cl360SameClient('Mary Smith', '', 'Mary Smith', '501') === true
  && api.cl360SameClient('Mary', '', 'Mary Smith', '501') === false && api.cl360SameClient('Mary Jones', '', 'Mary Smith', '501') === false);
api.setRoster(R2);
ck('history matching: with two Mary Smiths, a nameless-id record matches neither', api.cl360SameClient('Mary Smith', '', 'Mary Smith', '501') === false);

/* the client roster files a converted lead under the CLIENT, not the caller */
DATA.leads = [{ id: 'L9', first_name: 'Dana', last_name: 'Smith', client_first_name: 'Mary', client_last_name: 'Smith', status: 'Converted' }];
DATA.care_assessments = [{ id: 'A9', client_name: 'Mary Smith', created_at: '2026-08-20' }];
const rows = api.getClientRoster();
ck('client list: the converted lead and Mary\'s assessment are ONE row under Mary Smith (they used to be two, one under the daughter)', rows.length === 1 && rows[0].client_name === 'Mary Smith' && rows[0].lead.id === 'L9' && rows[0].assessment.id === 'A9', rows);

/* schedule assessment */
DATA.leads = [{ id: 'L1', status: 'Assessment Scheduled', axiscare_client_id: '501' }, { id: 'L6', status: 'New' }];
DATA.care_assessments = [{ id: 'A1', lead_id: 'L1', visit_date: '2026-08-21', created_at: '2026-08-20' }];
calls.length = 0; persisted.length = 0; confirmAnswer = true; api.scheduleAssessmentFromLead('L1');
ck('"Schedule assessment" on a lead that has one: opens the existing assessment; the lead is not changed', calls.some(c => k(c) === k(['assessment', 'A1', undefined])) && persisted.length === 0);
calls.length = 0; confirmAnswer = false; api.scheduleAssessmentFromLead('L1');
ck('...and "Cancel" still starts a new one (a reassessment)', calls.some(c => c[0] === 'assessment' && c[1] === null && c[2] === 'L1') && persisted.length === 1);
calls.length = 0; persisted.length = 0; api.scheduleAssessmentFromLead('L6');
ck('a lead with no assessment starts one as before, with no question', calls.some(c => c[0] === 'assessment' && c[1] === null && c[2] === 'L6') && persisted[0][2] === 'Assessment Scheduled');

console.log('\nCHANGE 8c · ONE FAMILY, ONE ROW OF LINKS · HUB TEST\n' + '='.repeat(60));
let ok = true;
for (const [nm, g, note] of res) { ok &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + nm + (note ? '\n   └─ ' + note : '')); }
console.log('='.repeat(60)); console.log(ok ? `ALL ${res.length} CHECKS PASS` : `${res.filter(r => !r[1]).length} FAILED`);
