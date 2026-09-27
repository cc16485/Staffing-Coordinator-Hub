// Call-in plan · the hub's own code (Client 360 section, case-board plan, save) run against fakes.
// node callin_plan_hub_test.mjs ../cc-hub-live/index.html
import fs from 'fs';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const hub = fs.readFileSync(process.argv[2] || '../cc-hub-live/index.html', 'utf8');
const block = hub.slice(hub.indexOf('/* ===================== "WHEN A CAREGIVER CALLS IN"'), hub.indexOf('/* ── SLIDE-OVER OPENERS'));
ck('the block is present', block.length > 2000);
const visible = block.match(/'[^'\n]*'/g).join(' ');
ck('copy: no em dashes in the new screen text', !visible.includes('—'));

/* fakes */
const els = {}; const el = (id) => (els[id] = els[id] || { id, innerHTML: '', value: '', dataset: {}, disabled: false, textContent: '' });
let radio = null, checked = [];
const document = { getElementById: (id) => el(id), querySelector: (q) => (q.includes('cipNeed') && radio != null ? { value: radio } : null),
  querySelectorAll: (q) => (q.includes('cipCgs') && q.includes(':checked') ? checked : []) };
let HIST = [], CUR = [], QERR = false, posts = [], renders = 0, events = [], queries = [];
const sb = { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
  from: (t) => { const f = {}; const b = { select() { return b; }, eq(c, v) { f[c] = v; return b; }, in(c, v) { f[c] = v; return b; }, order() { return b; },
    then(ok) { queries.push({ t, f }); return Promise.resolve(QERR ? { data: null, error: { message: 'x' } } : { data: t === 'client_callin_entries' ? HIST : CUR.filter(p => (f.axiscare_client_id || []).includes(p.axiscare_client_id)), error: null }).then(ok); } }; return b; } };
const fetchFake = async (u, o) => { posts.push({ u, body: JSON.parse(o.body), auth: o.headers.Authorization }); return { json: async () => ({ outcome: POST_OUT }) }; };
let POST_OUT = 'recorded';
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const ctx = { document, sb, fetch: fetchFake, esc, CONFIG: { supabase_url: 'https://x.supabase.co' }, CL360_CURRENT: { '': { client_name: 'LeeAnn Walker', axiscare_client_id: '501' } },
  covLoadCaregivers: async () => ({ roster: [{ id: '11', name: 'Dixie Ray' }, { id: '12', name: 'Autumn Reid' }, { id: '13', name: 'Beth Cole' }], fromFallback: false }),
  opEvent: (v, d) => events.push([v, d]), renderCoverage: () => renders++, DATA: { coverage_cases: [] }, CSS: { escape: (s) => s }, crypto: { randomUUID: () => '11111111-2222-4333-8444-555555555555' }, window: {} };
ctx.window.crypto = ctx.crypto;
const api = new Function(...Object.keys(ctx), block + '\nreturn { CIP, cipPlanLines, cipByline, cipProfileLoad, cipProfileRender, cipOpenForm, cipSave, cipEnsureForCases, cipCaseChip, cipCaseHtml };')(...Object.values(ctx));

const p1 = { id: 1, axiscare_client_id: '501', client_name: 'LeeAnn Walker', coverage_need: 'if_we_can', only_ask: [{ axiscare_id: '11', name: 'Dixie Ray' }, { axiscare_id: '12', name: 'Autumn Reid' }],
  backup_name: 'Jan Moss', backup_phone: '4175551212', backup_relationship: 'friend who covers', note: 'Only Dixie or Autumn. <script>alert(1)</script>',
  source_who: 'LeeAnn herself', source_how: 'phone', entered_by: 'krystal@mo-care.com', entered_by_name: 'Krystal', entered_at: '2026-09-27T15:00:00Z' };
const p0 = { ...p1, id: 0, coverage_need: null, only_ask: [], backup_name: null, backup_phone: null, backup_relationship: null, note: 'first call', source_who: 'daughter Dana', source_how: 'in_person', entered_at: '2026-09-20T15:00:00Z' };
HIST = [p1, p0];
await api.cipProfileLoad(ctx.CL360_CURRENT[''], '');
const prof = el('cl360Callin').innerHTML;
ck('Client 360: shows the plan in force, who entered it, when, and who told us how', prof.includes('<b>Cover it if we can</b>') && prof.includes('Only ask: <b>Dixie Ray or Autumn Reid</b>')
  && prof.includes('Outside backup: <b>Jan Moss</b> (friend who covers) · (417) 555-1212') && prof.includes('Entered by Krystal, Sep 27, 2026') && prof.includes('from LeeAnn herself by phone'), prof);
ck('Client 360: the full history is kept and shown (2 entries), including the first "not asked yet" entry and its note', prof.includes('History (2)') && prof.includes('Coverage preference: not asked yet') && prof.includes('from daughter Dana in person') && prof.includes('“first call”'), prof);
ck('a note with code in it is shown as text, never run', !prof.includes('<script>') && prof.includes('&lt;script&gt;'));
HIST = []; await api.cipProfileLoad(ctx.CL360_CURRENT[''], '');
ck('Client 360: nothing recorded yet says what to ask', el('cl360Callin').innerHTML.includes('when a caregiver calls in, what would you like us to do?'));
await api.cipProfileLoad({ client_name: 'New Person', axiscare_client_id: '' }, '');
ck("a client not linked to AxisCare can't hold a plan, and says so", el('cl360Callin').innerHTML.includes("isn't linked to AxisCare yet"));

HIST = [p1, p0]; await api.cipProfileLoad(ctx.CL360_CURRENT[''], '');
await api.cipOpenForm('');
const form = el('cipForm').innerHTML, cgs = el('cipCgs').innerHTML;
ck('the form starts from the plan in force: the choice ticked, Dixie and Autumn ticked, Beth not, the backup filled, the note empty',
  /value="if_we_can" style="width:auto;" checked/.test(form) && /value="11"[^>]*checked/.test(cgs) && /value="12"[^>]*checked/.test(cgs) && !/value="13"[^>]*checked/.test(cgs)
  && form.includes('value="Jan Moss"') && form.includes('value="(417) 555-1212"') && form.includes('<textarea id="cipNote" rows="3" maxlength="2000" style="width:100%;font-size:13px;"></textarea>'), { form: form.slice(0, 400), cgs });
posts = []; el('cipWho').value = ' '; await api.cipSave('');
ck('save: "who told us" is required, nothing is sent without it', posts.length === 0 && el('cipMsg').textContent.startsWith('Who told us?'));
radio = 'must_cover'; checked = [{ value: '11', dataset: { name: 'Dixie Ray' } }]; el('cipWho').value = 'daughter Dana'; el('cipHow').value = 'phone'; el('cipNote').value = 'Weekends are a must.';
el('cipBName').value = 'Jan Moss'; el('cipBPhone').value = '(417) 555-1212'; el('cipBRel').value = 'friend';
HIST = [{ ...p1, id: 2, coverage_need: 'must_cover' }, p1, p0];
await api.cipSave('');
const b = posts[0]?.body || {};
ck('save: sends one entry to the call-in service with the sign-in, a request id (so a double click records once), and every field',
  posts.length === 1 && posts[0].u === 'https://x.supabase.co/functions/v1/callin-plan' && posts[0].auth === 'Bearer tok' && b.action === 'add' && b.request_id === '11111111-2222-4333-8444-555555555555'
  && b.axiscare_client_id === '501' && b.coverage_need === 'must_cover' && JSON.stringify(b.only_ask) === '[{"axiscare_id":"11","name":"Dixie Ray"}]'
  && b.source_who === 'daughter Dana' && b.source_how === 'phone' && b.note === 'Weekends are a must.' && b.backup_phone === '(417) 555-1212', b);
ck('save: it never sends who entered it (the server takes that from the sign-in)', !('entered_by' in b) && !('staff' in b));
ck('save: after recording, the form closes, the history reloads (3 entries) and the board refreshes its copy', el('cipForm').innerHTML === '' && el('cl360Callin').innerHTML.includes('History (3)') && api.CIP.at === 0 && events.length === 1);
posts = []; POST_OUT = 'backup_phone_invalid'; el('cipForm').innerHTML = 'x'; await api.cipSave('');
ck('save: a refusal is explained and the form stays open', el('cipMsg').textContent.includes("doesn't look like 10 digits") && el('cipForm').innerHTML === 'x');

/* the case board */
CUR = [{ ...p1, coverage_need: 'family_covers' }];
ctx.DATA.coverage_cases.push({ id: 'c1', status: 'open', client: 'LeeAnn Walker', client_axiscare_id: '501' }, { id: 'c2', status: 'done', client: 'X', client_axiscare_id: '777' }, { id: 'c3', status: 'open', client: 'Y' });
queries = []; renders = 0; api.CIP.at = 0; await api.cipEnsureForCases();
ck('board: plans are loaded for OPEN cases with an AxisCare id only, in one query, and the board redraws once', queries.length === 1 && JSON.stringify(queries[0].f.axiscare_client_id) === '["501"]' && renders === 1, queries);
await api.cipEnsureForCases();
ck('board: not reloaded again within a minute', queries.length === 1);
const kase = ctx.DATA.coverage_cases[0];
ck('board: "family covers" shows its chip and the first step, and that Cara won\'t text on her own', api.cipCaseChip(kase).includes('call the family first') && api.cipCaseHtml(kase).includes("First step: call the family. They would rather cover it themselves, so Cara won't text caregivers on her own."));
api.CIP.cur['501'] = { ...p1, coverage_need: 'must_cover' };
ck('board: "must be covered" is red, and the plan shows the list, the backup, the note (as text) and a link to the full history',
  api.cipCaseChip(kase).includes('must be covered') && api.cipCaseChip(kase).includes('var(--red)') && api.cipCaseHtml(kase).includes('This shift must be covered, no matter what.')
  && api.cipCaseHtml(kase).includes('Only ask: <b>Dixie Ray or Autumn Reid</b>') && api.cipCaseHtml(kase).includes('&lt;script&gt;') && api.cipCaseHtml(kase).includes('data-open-client="501"'));
ck('board: a closed case, or a client with no plan, shows nothing extra', api.cipCaseChip({ ...kase, status: 'done' }) === '' && api.cipCaseHtml({ id: 'z', client_axiscare_id: '999' }) === '');

console.log('\nCALL-IN PLAN · HUB SCREENS · TEST\n' + '='.repeat(60));
let ok = true;
for (const [nm, g, note] of res) { ok &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + nm + (note ? '\n   └─ ' + note : '')); }
console.log('='.repeat(60)); console.log(ok ? `ALL ${res.length} CHECKS PASS` : `${res.filter(r => !r[1]).length} FAILED`);
