// Deleted-and-replaced call-off visits (Newton-Donati, 2026-10-31) · the rule on the real AxisCare rows, and the wiring.
// node replacement_cover_test.mjs
import fs from 'fs'; import path from 'path';
process.env.TZ = 'UTC';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 600)]);
const FNS = path.resolve('supabase/functions');
const C = await import(path.join(FNS, '_shared/covered-outside.ts'));
const ms = (s) => Date.parse(String(s));
const usable = (v) => !v.cancelled;
const cg = (id, first, last) => ({ id, firstName: first, lastName: last });
const V = (id, s, e, c, extra = {}) => ({ id, client: { id: 55 }, scheduledStartDate: s, scheduledEndDate: e, caregiver: c, ...extra });
/* the real rows from visit_history, client 55 */
const gone168 = V('s=168:d=2026-10-31', '2026-10-31T19:00:00-05:00', '2026-11-01T07:00:00-06:00', null, { removed: true });
const gone167 = V('s=167:d=2026-10-30', '2026-10-30T07:00:00-05:00', '2026-10-30T13:00:00-05:00', null, { removed: true });
const visits = [
  V('v=2896:s=0:d=2026-10-30', '2026-10-30T19:00:00-05:00', '2026-10-31T07:00:00-05:00', cg(119, 'Rhonda', 'Blakemore')),
  V('v=2898:s=0:d=2026-10-30', '2026-10-30T07:00:00-05:00', '2026-10-30T13:00:00-05:00', cg(619, 'Kyra', 'Linde')),
  V('v=2894:s=0:d=2026-10-31', '2026-10-31T07:00:00-05:00', '2026-10-31T13:00:00-05:00', cg(619, 'Kyra', 'Linde')),
  V('v=2897:s=0:d=2026-10-31', '2026-10-31T19:00:00-05:00', '2026-11-01T07:00:00-06:00', cg(119, 'Rhonda', 'Blakemore')),
  V('s=163:d=2026-11-01', '2026-11-01T19:00:00-06:00', '2026-11-02T19:00:00-06:00', cg(119, 'Rhonda', 'Blakemore')),
];
const cc = { id: 'cw_s_168_d_2026_10_31_g1', client_axiscare_id: '55', calling_off: 'Sheryelle Dunniehigh', opened_by: 'axiscare-watch' };
let r = C.replacementCover(cc, gone168, visits, { ms, usable });
ck('Saturday 7pm: deleted s=168, Rhonda on new visit v=2897 for the same hours → covered by Rhonda Blakemore',
  r && r.names.join() === 'Rhonda Blakemore' && r.visits.length === 1 && r.visits[0].id === 'v=2897:s=0:d=2026-10-31', r);
r = C.replacementCover({ ...cc, id: 'cw_s_167_d_2026_10_30_g1' }, gone167, visits, { ms, usable });
ck('Friday 7am: deleted s=167, Kyra on v=2898 7am to 1pm → covered by Kyra Linde', r && r.names.join() === 'Kyra Linde', r);
ck('the caregiver who called off on the new visit is never a cover',
  C.replacementCover(cc, gone168, [V('n1', '2026-10-31T19:00:00-05:00', '2026-11-01T07:00:00-06:00', cg(81, 'Sheryelle', 'Dunniehigh'))], { ms, usable }) === null);
ck('the same caregiver id as the one who called off is never a cover, whatever the name',
  C.replacementCover({ ...cc, calling_off_id: '81' }, gone168, [V('n1', '2026-10-31T19:00:00-05:00', '2026-11-01T07:00:00-06:00', cg(81, 'Other', 'Name'))], { ms, usable }) === null);
ck('only part of the hours covered (7pm to 1am of 7pm to 7am) → not covered, a person decides',
  C.replacementCover(cc, gone168, [V('n1', '2026-10-31T19:00:00-05:00', '2026-11-01T01:00:00-06:00', cg(5, 'Ann', 'Lee'))], { ms, usable }) === null);
r = C.replacementCover(cc, gone168, [V('n2', '2026-11-01T01:00:00-06:00', '2026-11-01T07:00:00-06:00', cg(6, 'Bo', 'Ray')), V('n1', '2026-10-31T19:00:00-05:00', '2026-11-01T01:00:00-06:00', cg(5, 'Ann', 'Lee'))], { ms, usable });
ck('two new visits that share the hours with no gap → covered by both, in time order', r && r.names.join() === 'Ann Lee,Bo Ray' && r.start.startsWith('2026-10-31T19') && r.end.startsWith('2026-11-01T07'), r);
ck('a gap of an hour between two new visits → not covered',
  C.replacementCover(cc, gone168, [V('n1', '2026-10-31T19:00:00-05:00', '2026-11-01T00:00:00-06:00', cg(5, 'Ann', 'Lee')), V('n2', '2026-11-01T01:00:00-06:00', '2026-11-01T07:00:00-06:00', cg(6, 'Bo', 'Ray'))], { ms, usable }) === null);
ck('15 minutes either way still counts',
  !!C.replacementCover(cc, gone168, [V('n1', '2026-10-31T19:15:00-05:00', '2026-11-01T06:45:00-06:00', cg(5, 'Ann', 'Lee'))], { ms, usable }));
ck('another client\'s visit is never a cover',
  C.replacementCover(cc, gone168, [{ ...visits[3], client: { id: 99 } }], { ms, usable }) === null);
ck('an empty new visit (nobody on it) is not a cover', C.replacementCover(cc, gone168, [{ ...visits[3], caregiver: null }], { ms, usable }) === null);
ck('a cancelled or placeholder new visit is not a cover', C.replacementCover(cc, gone168, [{ ...visits[3], cancelled: true }], { ms, usable }) === null);
ck('the deleted visit itself is never its own cover', C.replacementCover(cc, gone168, [{ ...gone168, removed: false, caregiver: cg(5, 'Ann', 'Lee') }], { ms, usable }) === null);
ck('no client id → never guessed', C.replacementCover({ ...cc, client_axiscare_id: '' }, { ...gone168, client: null }, visits, { ms, usable }) === null);

/* the wiring */
const watch = fs.readFileSync(path.join(FNS, 'coverage-watch/index.ts'), 'utf8');
const iRep = watch.indexOf('replacementCover(cc, gone, visits'), iHold = watch.indexOf('deleted WITHOUT a cancel reason'), iCancel = watch.indexOf('if (rg.cancelled) {');
ck('coverage-watch: a cancel reason still wins first, then the replacement check, then the "does it still need someone?" hold',
  iCancel > 0 && iRep > iCancel && iHold > iRep);
ck('coverage-watch: a replaced visit closes as covered by the new caregiver, only when the watch is live',
  /if \(!live\) \{ outsideLeftOpen\.push\([^)]*verdict: 'replaced'/.test(watch) && /resolved_how = 'covered'; cc\.covered_by = who/.test(watch));
const run = fs.readFileSync(path.join(FNS, 'coverage-run/index.ts'), 'utf8');
ck('coverage-run: no CRITICAL open shift text for a case held on a deleted visit',
  /u\.level === 'critical' && !confirmed\(c\) && !c\[doneKey\] && !c\.removed_hold/.test(run));

const bad = res.filter((x) => !x[1]);
for (const [n, ok, note] of res) console.log((ok ? 'PASS ' : 'FAIL ') + n + (note ? '  ' + note : ''));
console.log(`\n${res.length - bad.length}/${res.length} passed`);
process.exit(bad.length ? 1 : 0);
