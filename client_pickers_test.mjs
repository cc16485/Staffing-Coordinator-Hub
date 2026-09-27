// Change 8a · client pickers + one live check-in reminder per client · the hub's own code and the REAL obligations engine.
// node client_pickers_test.mjs ../cc-hub-live
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const DIR = process.argv[2] || '../cc-hub-live';
const hub = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
const cut = (a, b) => { const i = hub.indexOf(a), j = hub.indexOf(b, i); if (i < 0 || j < 0) throw new Error('missing ' + a); return hub.slice(i, j); };

/* ── the reminder engine (the same file the server's obligations-run fetches) ── */
const root = {}; new Function('globalThis', fs.readFileSync(path.join(DIR, 'obligations.js'), 'utf8'))(root);
const O = root.CCOblig;
const run = (checkins, items, today = '2026-09-27') => O.evaluate({ data: { client_checkins: checkins }, items, today, resolveOwner: () => 'angiel@mo-care.com', domainOwner: () => 'angiel@mo-care.com' });
const item = (id, due) => ({ id: 'ops_ci_' + id + '_' + due, status: 'open', source: { type: 'client_checkin', id, due } });
const oldR = { id: 'r1', client_name: 'Mary Smith', axiscare_client_id: '501', checkin_date: '2026-08-01', next_checkin_due: '2026-09-01', created_at: '2026-08-01' };
const newR = { id: 'r2', client_name: 'Mary Smith', axiscare_client_id: '501', checkin_date: '2026-09-05', next_checkin_due: '2026-10-05', created_at: '2026-09-05' };
let out = run([oldR], [item('r1', '2026-09-01')]);
ck('reminders: one record, due and not done: its reminder stays open (as before)', out.stale.length === 0, out.stale);
out = run([oldR, newR], [item('r1', '2026-09-01')]);
ck('reminders: a NEW check-in logged as a new record closes the older record\'s reminder, as "done"', out.stale.length === 1 && out.stale[0].item.id === 'ops_ci_r1_2026-09-01' && out.stale[0].why === 'done_at_source', out.stale);
ck('reminders: the replaced record raises no new reminder; the newer one isn\'t due yet', out.create.length === 0, out.create.map(x => x.id));
out = run([oldR, newR], [], '2026-10-06');
ck('reminders: when the newer one falls due, only it raises a reminder', out.create.length === 1 && out.create[0].id === 'ops_ci_r2_2026-10-05', out.create.map(x => x.id));
const legacy = { id: 'r0', client_name: 'mary smith', checkin_date: '2026-07-01', next_checkin_due: '2026-08-01', created_at: '2026-07-01' };
out = run([legacy, newR], [item('r0', '2026-08-01')]);
ck('reminders: an older record with no AxisCare id joins the client by full name (only one AxisCare id has that name) and closes as done', out.stale.length === 1 && out.stale[0].why === 'done_at_source', out.stale);
const otherMary = { id: 'r3', client_name: 'Mary Smith', axiscare_client_id: '502', checkin_date: '2026-09-10', next_checkin_due: '2026-10-10', created_at: '2026-09-10' };
out = run([legacy, newR, otherMary], [item('r0', '2026-08-01')]);
ck('reminders: with TWO Mary Smiths in AxisCare, a record with no id is never guessed into either; its reminder stays', out.stale.length === 0, out.stale);
out = run([oldR, otherMary], [item('r1', '2026-09-01')]);
ck('reminders: a different client with the same name never closes Mary #501\'s reminder', out.stale.length === 0, out.stale);
const early = { ...oldR, checkin_date: '2026-09-02', next_checkin_due: '2026-10-02' };   // an edit moves the next due date on
out = run([early], [item('r1', '2026-09-01')]);
ck('reminders: editing the record itself still closes it (as before)', out.stale.length === 1 && out.stale[0].why === 'done_at_source', out.stale);
const careMatch = { id: 'ci1', client: 'Mary Smith', caregiver: 'Dixie Ray', axiscare_client_id: '501', at: '2026-09-20' };
out = run([oldR, careMatch], [item('r1', '2026-09-01')]);
ck('reminders: a Care Match call (with its new AxisCare id) is still NOT a monthly check-in', out.stale.length === 0 && out.bySource.client_checkin.rows === 1, out);
const data = [oldR, newR]; run(data, []);
ck('reminders: the records themselves are never changed by the engine (it works on copies)', !('_superseded' in oldR) && !('_client_latest' in newR));

/* ── the hub's pickers ── */
const pickBlock = cut('/* ── THE CLIENT PICKER (Change 8a', 'async function cl360Roster(){');
const ckBlock = cut('function openCheckinModal(id){', '/* Escalated check-in');
const nvAddBlock = cut('async function nvAdd(){', 'async function nvDeactivate(');
const nvLinkBlock = cut('function nvToggleAdd(){', '\nfunction ', ) + '';
const nvLinkAll = hub.slice(hub.indexOf('function nvToggleAdd(){'), hub.indexOf('renderNurseVisits();\n}', hub.indexOf('async function nvLinkSave(')) + 'renderNurseVisits();\n}'.length);
const cmBlock = cut('  function prefill(client,caregiver,clientAx){', '  let HIST_Q=');
/* only the NEW text: the older Care Match and check-in messages around it are unchanged */
const NEW_TEXT = ['Pick the client from the list first.', 'This older check-in has no AxisCare id. Pick the client to add it.', 'Pick the client from the list (start typing their name).',
  'is already on the nurse board.', 'Pick the client from the list, so the call is kept with the right person.', 'is already linked to another client on the nurse board.'];
ck('copy: no em dashes in the new text (the picker, the nurse link, and every new message)', ![pickBlock, nvLinkAll].some(b => (b.match(/'[^'\n]*'/g) || []).join(' ').includes('—'))
  && NEW_TEXT.every(t => hub.includes(t) && !t.includes('—')));

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const els = {}; const el = (id) => (els[id] = els[id] || { id, value: '', textContent: '', innerHTML: '', checked: false, dataset: {}, style: {}, classList: { add() {}, remove() {} }, focus() {}, scrollIntoView() {} });
const document = { getElementById: (id) => el(id) };
const IDENT = [{ client_name: 'Mary Smith', axiscare_client_id: '501', role_status: 'active' }, { client_name: 'Mary Smith', axiscare_client_id: '502', role_status: 'active' },
  { client_name: 'Ann Old', axiscare_client_id: '600', role_status: 'ended' }, { client_name: 'No Id', axiscare_client_id: '', role_status: 'active' }];
const DATA = { client_checkins: [], nurse_clients: [{ id: 'n1', name: 'Mary Smith', active: true }], dnr_log: [] };
const saved = [], alerts = []; let confirmAns = true;
const ctx = { document, DATA, esc, escapeHtmlComms: esc, cl360Identity: async () => IDENT, uid: () => 'u' + saved.length, today: () => '2026-09-27', addDays: () => '2026-10-27',
  CONFIG: { checkin_cadence: 30 }, persist: async (k, v) => saved.push([k, JSON.parse(JSON.stringify(v))]), closeModal: () => {}, renderCheckins: () => {}, renderStars: () => {},
  notifyEscalation: () => {}, renderNurseVisits: () => {}, alert: (m) => alerts.push(m), confirm: () => confirmAns, ME: { name: 'Angiel' }, me: () => 'Angiel', renderDnr: () => {}, renderHistory: () => {}, renderPairs: () => {} };
const api = new Function(...Object.keys(ctx), pickBlock + ckBlock + nvAddBlock + nvLinkAll + cmBlock.replace(/^  /gm, '')
  + '\nreturn { ccPickOptions, ccPickFill, ccPickParse, ccPickLabelFor, openCheckinModal, ckPickChanged, saveCheckin, nvAdd, nvLinkBtn, nvLinkOpen, nvLinkSave, prefill, save };')(...Object.values(ctx));

await api.ccPickFill('lst');
ck('picker: every client with an AxisCare id, shown with their number; two Mary Smiths are told apart; past clients marked; no-id clients left out',
  el('lst').innerHTML.includes('value="Mary Smith · #501"') && el('lst').innerHTML.includes('value="Mary Smith · #502"') && el('lst').innerHTML.includes('Ann Old · #600 (past client)') && !el('lst').innerHTML.includes('No Id'), el('lst').innerHTML);
ck('picker: "Mary Smith · #502" means AxisCare #502; a typed name alone means nobody', api.ccPickParse('Mary Smith · #502').ax === '502' && api.ccPickParse('Mary Smith') === null && api.ccPickParse('#999') === null);

/* Client Check-ins */
api.openCheckinModal(null); await new Promise(r => setTimeout(r, 0));
el('checkin_client_pick').value = 'Mary Smith'; api.ckPickChanged(); saved.length = 0; await api.saveCheckin();
ck('check-in: a typed name is refused ("pick from the list"); nothing saved', saved.length === 0 && el('checkin_client_msg').textContent.includes('Pick the client'));
el('checkin_client_pick').value = 'Mary Smith · #502'; api.ckPickChanged(); await api.saveCheckin();
ck('check-in: a picked client saves with their name AND AxisCare id', saved.length === 1 && saved[0][1].client_name === 'Mary Smith' && saved[0][1].axiscare_client_id === '502', saved);
DATA.client_checkins = [{ id: 'old1', client_name: 'Mary Smith', checkin_date: '2026-06-01' }]; saved.length = 0;
api.openCheckinModal('old1'); await new Promise(r => setTimeout(r, 0));
ck('check-in: an older record with no AxisCare id opens with a note to pick the client', el('checkin_client_msg').textContent.includes('no AxisCare id'));
await api.saveCheckin();
ck('check-in: ...but it can still be saved as it was (nothing is lost)', saved.length === 1 && saved[0][1].client_name === 'Mary Smith' && saved[0][1].axiscare_client_id === '');

/* Nurse visits */
el('nvName').value = 'Mary Smith'; alerts.length = 0; saved.length = 0; await api.nvAdd();
ck('nurse: adding a client needs a pick from the list', saved.length === 0 && alerts[0].includes('Pick the client'));
el('nvName').value = 'Mary Smith · #501'; ['nvPhone', 'nvGhe1', 'nvGhe2', 'nvNotes'].forEach(i => el(i).value = ''); el('nvWeekly').checked = true; await api.nvAdd();
ck('nurse: a picked client is added with their AxisCare id', saved.length === 1 && saved[0][1].axiscare_client_id === '501' && saved[0][1].name === 'Mary Smith', saved);
alerts.length = 0; el('nvName').value = 'Mary Smith · #501'; await api.nvAdd();
ck('nurse: the same AxisCare client can\'t be added twice', alerts[0] && alerts[0].includes('already on the nurse board'));
const n1 = DATA.nurse_clients.find(x => x.id === 'n1');
ck('nurse: a client added before the picker shows "link to their AxisCare record"; a linked one doesn\'t', api.nvLinkBtn(n1, 'G').includes('link to their AxisCare record') && api.nvLinkBtn({ id: 'x', axiscare_client_id: '1' }, 'G') === '');
await api.nvLinkOpen('n1', 'G'); el('nvLinkInG-n1').value = 'Mary Smith · #501'; alerts.length = 0; saved.length = 0; await api.nvLinkSave('n1', 'G');
ck('nurse: linking to an AxisCare client already on the board is refused', saved.length === 0 && alerts[0] && alerts[0].includes('already linked'));
el('nvLinkInG-n1').value = 'Ann Old · #600'; confirmAns = false; await api.nvLinkSave('n1', 'G');
ck('nurse: a name that differs from AxisCare\'s asks first; "no" links nothing', saved.length === 0 && !n1.axiscare_client_id);
el('nvLinkInG-n1').value = 'Mary Smith · #502'; await api.nvLinkSave('n1', 'G');
ck('nurse: the right client links, with who linked it and when', saved.length === 1 && n1.axiscare_client_id === '502' && n1.linked_by === 'Angiel' && n1.linked_at, n1);

/* Care Match */
const fillCm = () => { el('ci-rating').value = 'good'; el('ci-notes').value = ''; el('ci-caregiver').value = 'Dixie Ray'; el('ci-fav').checked = false; el('ci-excl').checked = false; };
api.prefill('Mary Smith', 'Dixie Ray', '502'); fillCm(); saved.length = 0; await api.save();
const cm = saved.find(x => x[0] === 'client_checkins');
ck('Care Match: logging from a pair keeps the pair\'s AxisCare client with the call, and the name exactly as the pair has it', cm && cm[1].client === 'Mary Smith' && cm[1].axiscare_client_id === '502' && !('client_name' in cm[1]), cm);
el('ci-client').value = 'Mary Smith'; delete el('ci-client').dataset.prefilled; el('ci-client-ax').value = ''; fillCm(); alerts.length = 0; saved.length = 0; await api.save();
ck('Care Match: an off-board call with a typed name is refused', saved.length === 0 && alerts[0].includes('Pick the client'));
el('ci-client').value = 'Mary Smith · #501'; fillCm(); el('ci-excl').checked = true; el('ci-notes').value = 'Asked not to send her again.'; saved.length = 0; await api.save();
const dnr = saved.find(x => x[0] === 'dnr_log'), cm2 = saved.find(x => x[0] === 'client_checkins');
ck('Care Match: an off-board call picked from the list saves the name and AxisCare id, and a do-not-return carries the id too',
  cm2 && cm2[1].client === 'Mary Smith' && cm2[1].axiscare_client_id === '501' && dnr && dnr[1].axiscare_client_id === '501' && dnr[1].client === 'Mary Smith', saved);
el('ci-client').value = 'Mary Smith'; el('ci-client').dataset.prefilled = 'Ann Old'; el('ci-client-ax').value = '600'; fillCm(); alerts.length = 0; saved.length = 0; await api.save();
ck('Care Match: a pair\'s id is only used when the client name still matches the pair (edited names must be picked)', saved.length === 0 && alerts[0].includes('Pick the client'));

console.log('\nCHANGE 8a · CLIENT PICKERS + ONE LIVE CHECK-IN REMINDER · TEST\n' + '='.repeat(60));
let ok = true;
for (const [nm, g, note] of res) { ok &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + nm + (note ? '\n   └─ ' + note : '')); }
console.log('='.repeat(60)); console.log(ok ? `ALL ${res.length} CHECKS PASS` : `${res.filter(r => !r[1]).length} FAILED`);
