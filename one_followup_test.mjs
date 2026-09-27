// Change 8d · Care Match is the one first-shift follow-up · the hub's own code against fakes.
// node one_followup_test.mjs ../cc-hub-live/index.html
import fs from 'fs';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const hub = fs.readFileSync(process.argv[2] || '../cc-hub-live/index.html', 'utf8');
const cut = (a, b) => { const i = hub.indexOf(a), j = hub.indexOf(b, i); if (i < 0 || j < 0) throw new Error('missing ' + a); return hub.slice(i, j); };
const helpers = cut('/* ── ONE FIRST-SHIFT FOLLOW-UP (Change 8d', '/* ── Launch evidence (Change 1)');
const rowCode = cut("        if(s.f==='followup_client_done'||s.f==='followup_caregiver_done'){", '        if(leLive(c)&&LE_READOUT[s.f]){');
const saveCode = cut('  async function save(){', '  let HIST_Q=');
ck('copy: no em dashes in the new text', ![helpers, rowCode].some(b => (b.match(/'[^'\n]*'/g) || []).join(' ').includes('—'))
  && !/—/.test(saveCode.slice(saveCode.indexOf('Change 8d'), saveCode.indexOf('if(excl){'))));

/* fakes */
const LAUNCH = { id: 'Q1', client_name: 'Mary Smith', axiscare_client_id: '501', caregiver_assigned_name: 'Dixie Ray', created_at: '2026-09-20T10:00:00Z', status: 'pending', first_shift_done: true };
let QROWS, updates, stepCalls, calls;
const DATA = { client_checkins: [], dnr_log: [] };
const sb = { from: (t) => { const f = {}; const b = { select() { return b; }, eq(c, v) { f[c] = v; return b; },
    then(ok) { return Promise.resolve({ data: QROWS.filter(r => String(r.axiscare_client_id) === String(f.axiscare_client_id)).map(r => ({ ...r })), error: null }).then(ok); },
    update(u) { return { eq: (c, v) => { updates.push([v, u]); const r = QROWS.find(x => x.id === v); Object.assign(r, u); return Promise.resolve({ error: null }); } }; } }; return b; } };
const win = { __cqRows: null };
const ctx = { DATA, sb, window: win, switchTab: (t) => calls.push(['tab', t]), cmPrefill: (...a) => calls.push(['prefill', ...a]), setTimeout: (f) => f(),
  cqStep: async (id, f, v) => { stepCalls.push([id, f, v]); const r = QROWS.find(x => x.id === id); r[f] = v; } };
const H = new Function(...Object.keys(ctx), helpers + '\nreturn { cqFollowupMatches, cqFollowupEvidence, cqFollowupGo, cqFollowupFromCareMatch };')(...Object.values(ctx));
const call = (o) => ({ id: 'ci' + Math.random(), client: 'Mary Smith', axiscare_client_id: '501', caregiver: 'Dixie Ray', rating: 'good', cg_rating: 'fit', at: '2026-09-22T15:00:00Z', by: 'Angiel', spoke_with: 'daughter Dana', ...o });
const reset = () => { QROWS = [{ ...LAUNCH }]; updates = []; stepCalls = []; calls = []; win.__cqRows = null; };

reset();
ck('match: same client (AxisCare id), the launch\'s own caregiver, after the launch began', H.cqFollowupMatches(LAUNCH, call({})));
ck('no match: a different client with the same name (different AxisCare id)', !H.cqFollowupMatches(LAUNCH, call({ axiscare_client_id: '502' })));
ck('no match: a call about a fill-in caregiver, not the launch caregiver', !H.cqFollowupMatches(LAUNCH, call({ caregiver: 'Beth Cole' })));
ck('no match: a call from before this launch began (an earlier stay)', !H.cqFollowupMatches(LAUNCH, call({ at: '2026-08-01T00:00:00Z' })));
ck('no match: a launch with no caregiver name yet, or a call with no AxisCare id', !H.cqFollowupMatches({ ...LAUNCH, caregiver_assigned_name: '' }, call({})) && !H.cqFollowupMatches(LAUNCH, call({ axiscare_client_id: '' })));

let t = await H.cqFollowupFromCareMatch(call({}));
ck('logging the call ticks BOTH follow-ups on the launch (client side from the client\'s rating, caregiver side from theirs)',
  t.length === 2 && QROWS[0].followup_client_done === true && QROWS[0].followup_caregiver_done === true && !!QROWS[0].followup_client_done_at, { t, q: QROWS[0] });
reset(); t = await H.cqFollowupFromCareMatch(call({ cg_rating: '' }));
ck('a call with only the client\'s side ticks only the client follow-up', t.length === 1 && QROWS[0].followup_client_done === true && !QROWS[0].followup_caregiver_done, t);
reset(); QROWS[0].status = 'complete'; t = await H.cqFollowupFromCareMatch(call({}));
ck('a completed launch is never touched', t.length === 0 && updates.length === 0);
reset(); QROWS[0].followup_client_done = true; t = await H.cqFollowupFromCareMatch(call({}));
ck('an already-ticked follow-up is left as it is (nothing unticked, nothing re-stamped)', t.length === 1 && t[0].field === 'followup_caregiver_done');
reset(); win.__cqRows = [QROWS[0]]; t = await H.cqFollowupFromCareMatch(call({}));
ck('with New Clients open, the tick goes through its own save (the board updates at once)', stepCalls.length === 2 && updates.length === 0, stepCalls);
reset(); t = await H.cqFollowupFromCareMatch(call({ caregiver: 'Beth Cole' }));
ck('a fill-in\'s Care Match call ticks nothing on the launch', t.length === 0 && updates.length === 0);

reset(); win.__cqRows = [QROWS[0]]; H.cqFollowupGo('Q1');
ck('"Log the call in Care Match" opens Care Match filled in with the client, the launch caregiver and the AxisCare id',
  JSON.stringify(calls) === JSON.stringify([['tab', 'carematch'], ['prefill', 'Mary Smith', 'Dixie Ray', '501']]), calls);

/* the row on the New Clients card */
const E = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const fmtTs = (x) => 'TS(' + String(x).slice(0, 10) + ')';
const row = (c, f, gated) => new Function('c', 's', 'done', 'gated', 'ts', 'E', 'fmtTs', 'cqFollowupEvidence', rowCode.replace(/^\s*if\(s\.f===.*\)\{/, '').replace(/\}\s*$/, ''))
  (c, { f, label: f === 'followup_client_done' ? '24–72h follow-up (client)' : '24–72h follow-up (caregiver)', sub: 'sub' }, !!c[f], gated, c[f + '_at'], E, fmtTs, H.cqFollowupEvidence);
DATA.client_checkins = [];
let r = row({ ...LAUNCH }, 'followup_client_done', false);
ck('card: not done yet: no checkbox, a "Log the call in Care Match" button, marked "from Care Match"', !r.includes('type="checkbox"') && r.includes('📞 Log the call in Care Match') && r.includes('from Care Match'), r);
r = row({ ...LAUNCH, first_shift_done: false }, 'followup_client_done', true);
ck('card: before the first shift it just says "After the first shift."', r.includes('After the first shift.') && !r.includes('Log the call'));
DATA.client_checkins = [call({ at: '2026-09-22T15:00:00Z' })];
r = row({ ...LAUNCH, followup_client_done: true }, 'followup_client_done', false);
ck('card: done: shows the Care Match call, when, by whom, and who they spoke with', r.includes('✓ Care Match call TS(2026-09-22) by Angiel · spoke with daughter Dana'), r);
r = row({ ...LAUNCH }, 'followup_client_done', false);
ck('card: a matching call exists but the tick didn\'t land: one click "Use the Care Match call" saves exactly that follow-up',
  r.includes('✓ Use the Care Match call from TS(2026-09-22)') && r.includes(`onclick="event.stopPropagation();cqStep('Q1','followup_client_done',true)"`), r);
DATA.client_checkins = [];
r = row({ ...LAUNCH, followup_caregiver_done: true, followup_caregiver_done_at: '2026-09-21T09:00:00Z' }, 'followup_caregiver_done', false);
ck('card: an older box ticked by hand keeps showing, labelled as such', r.includes('✓ ticked by hand TS(2026-09-21) (before Care Match took this over)'), r);
r = row({ ...LAUNCH, caregiver_assigned_name: '' }, 'followup_client_done', false);
ck('card: with no caregiver name yet it says to add it, so the call can be matched', r.includes('Add the caregiver'), r);

console.log('\nCHANGE 8d · ONE FIRST-SHIFT FOLLOW-UP · TEST\n' + '='.repeat(60));
let ok = true;
for (const [nm, g, note] of res) { ok &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + nm + (note ? '\n   └─ ' + note : '')); }
console.log('='.repeat(60)); console.log(ok ? `ALL ${res.length} CHECKS PASS` : `${res.filter(r => !r[1]).length} FAILED`);
