// NOT CLIENTS · "nothing should happen for office staff" (Samantha 2026-10-12). AxisCare's "Office Staff" (#293) holds
// office time; every background job leaves it out. node not_clients_test.mjs
import fs from 'fs'; import path from 'path';
const F = 'supabase/functions';
globalThis.Deno = { env: { get: () => '' } };
const Q = await import(path.resolve(F, '_shared/client-quiet.ts'));
const db = (opts) => ({ from: (t) => { const c = { select() { return c; }, eq() { return c; }, in() { return c; },
  maybeSingle: async () => t === 'app_data' ? (opts.err ? { data: null, error: { message: 'down' } } : { data: opts.settings === undefined ? null : { data: opts.settings }, error: null }) : { data: null, error: null },
  then(r) { return Promise.resolve({ data: t === 'client_pause' ? [{ axiscare_client_id: '777' }] : [], error: null }).then(r); } }; return c; } });
const R = [];
const ck = (n, c, d) => R.push([c, n, d]);
await Q.loadNotClients(db({}));
ck('no setting yet: Office Staff (#293) is the default, as on the Hub', Q.isNotClient('293') && !Q.isNotClient('101'));
await Q.loadNotClients(db({ err: true }));
ck('the setting cannot be read: the default still applies (a misread never starts texting about office time)', Q.isNotClient('293'));
await Q.loadNotClients(db({ settings: { not_client_ax: [{ ax: '293', name: 'Office Staff' }, { ax: '300', name: 'Training' }] } }));
ck('the Hub setting decides: every AxisCare number on it', Q.isNotClient('293') && Q.isNotClient(300) && !Q.isNotClient('101'));
await Q.loadNotClients(db({ settings: { not_client_ax: [] } }));
ck('an owner put everyone back: nobody is left out', !Q.isNotClient('293'));
await Q.loadNotClients(db({}));
ck('a visit is matched by its client id', Q.isNotClient({ client: { id: 293, firstName: 'Office' } }) && !Q.isNotClient({ client: { id: 101 } }));
const quiet = await Q.loadQuiet(db({}));
ck('the quiet list every shift job checks now holds Office Staff, beside paused clients', quiet.has('293') && quiet.has('777') && Q.isQuiet({ client: { id: 293 } }));
/* every job that reads visits or clients leaves them out (by the source) */
const src = (f) => fs.readFileSync(path.join(F, f), 'utf8');
const jobs = {
  /* shift-confirm retired 2026-10-23 */
  'care-notes/index.ts': /!v\.removed && !isNotClient\(v\)\) list\.push/,
  'eligibility-sweep/index.ts': /if \(isNotClient\(v\)\) continue/,
  'lead-digest/index.ts': /!v\?\.removed && !isNotClient\(v\)\) visits\.push/,
  'circles-sync/index.ts': /if \(isNotClient\(ax\)\) continue/,
  'client-sync/index.ts': /active === true && !isNotClient\(c\?\.id\)/,
  'client-status-review/index.ts': /if \(isNotClient\(t\.axiscare_client_id\)\)/,
  'client-admission-scan/index.ts': /!linked\.has\(id\) && !isNotClient\(id\)/,
  'review-moments/index.ts': /links\.filter\(\(l: Any\) => !isNotClient\(l\.source_id\)\)/,
  '_shared/audience-guard.ts': /axClients\.filter\(\(c: Any\) => keep\(c\?\.id\)\)/,
};
for (const [f, re] of Object.entries(jobs)) ck(f.split('/')[0] + ' leaves not-clients out (and loads the setting first)', re.test(src(f)) && /loadNotClients\(/.test(src(f)));
for (const f of ['timekeeper-watch', 'late-watch', 'missed-notes', 'carematch-watch', 'coverage-watch', 'obligations-run', 'client-journey'])
  ck(f + ' already checks the quiet list, which now holds Office Staff', /loadQuiet|quietSet/.test(src(f + '/index.ts')));
/* campaigns: nobody is tied to an active client through Office Staff */
const G = await import(path.resolve(F, '_shared/audience-guard.ts'));
const m = G.classify({ axClients: [{ id: 101, status: { active: true, label: 'Active' } }], links: [], roles: [], circles: [{ id: 'c1', axiscare_client_id: '101' }],
  contacts: [{ circle_id: 'c1', email: 'tess@x.com' }], leads: [], journeys: [] });
ck('a real client\'s family still counts as active for campaigns', m.get('tess@x.com') === 'active');
ck('audience-guard filters Office Staff out of AxisCare clients, links, circles and journeys before deciding', /links\.filter\(\(l: Any\) => keep\(l\.source_id\)\)/.test(src('_shared/audience-guard.ts')) && /circles\.filter\(\(c: Any\) => keep\(c\.axiscare_client_id\)\)/.test(src('_shared/audience-guard.ts')) && /journeys\.filter\(\(j: Any\) => keep\(j\.axiscare_client_id\)\)/.test(src('_shared/audience-guard.ts')));
let pass = 0; for (const [ok, n, d] of R) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : ' ' + JSON.stringify(d ?? ''))); if (ok) pass++; }
console.log(`\n${pass}/${R.length} passed`); process.exit(pass === R.length ? 0 : 1);
