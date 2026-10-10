// SLICE 0 (Samantha approved 2026-10-08): per-person approval permissions. The pure rules, then the real function under
// Node against a stand-in database (no network): identity decides, a title never does, the body cannot claim owner, the
// Approve to Work list can only be changed by its own members and never emptied, every change is logged.
// node onboarding_permissions_531_test.mjs
import fs from 'fs'; import path from 'path';
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions');
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? '').slice(0, 400)]);
const P = await import(path.join(FN, '_shared/onboarding-permissions.ts'));
const SAM = { person_id: 'p-sam', roles: ['owner_admin'], email: 'samantha@mo-care.com', name: 'Samantha' };
const ZACH = { person_id: 'p-zach', roles: ['owner_admin'], email: 'zach@mo-care.com', name: 'Zach' };
const KRY = { person_id: 'p-kry', roles: ['staffing_coordinator'], email: 'krystal@mo-care.com', name: 'Krystal' };
const NEW = { person_id: 'p-new', roles: ['care_coordinator'], email: 'new@mo-care.com', name: 'New Person' };
const base = () => P.normalizePerms({ version: 3, work: [{ person_id: 'p-sam', email: 'samantha@mo-care.com', name: 'Samantha' }, { person_id: 'p-zach', email: 'zach@mo-care.com', name: 'Zach' }],
  advance: [{ person_id: 'p-kry', email: 'krystal@mo-care.com', name: 'Krystal' }], history: [] });
// pure rules
ck('normalizePerms drops junk and duplicates', P.normalizePerms({ work: [{ person_id: 'a' }, { person_id: 'a' }, 'x', null], advance: 'no' }).work.length === 1 && P.normalizePerms(null).version === 0);
ck('Approve to Work: only list members (an owner title alone is refused)', P.mayApprove(base(), 'work', SAM) && P.mayApprove(base(), 'work', ZACH) && !P.mayApprove(base(), 'work', { ...KRY, roles: ['owner_admin'] }) && !P.mayApprove(base(), 'work', KRY));
ck('Approve to Advance: owners and named people, not a title', P.mayApprove(base(), 'advance', SAM) && P.mayApprove(base(), 'advance', KRY) && !P.mayApprove(base(), 'advance', { person_id: 'p-x', roles: ['staffing_coordinator'] }));
ck('only a work-list member may change the work list; an owner not on it may not', P.mayChange(base(), 'work', SAM) && !P.mayChange(base(), 'work', { person_id: 'p-other', roles: ['owner_admin'] }) && !P.mayChange(base(), 'work', KRY));
ck('an owner may change the advance list; a coordinator may not', P.mayChange(base(), 'advance', ZACH) && !P.mayChange(base(), 'advance', KRY));
const add = P.applyChange(base(), 'advance', 'add', NEW, SAM, '2026-10-09T15:00:00Z');
ck('add writes the member, bumps the version and the history', add.ok && add.next.advance.length === 2 && add.next.version === 4 && add.next.history[0].action === 'add' && add.next.history[0].by_email === 'samantha@mo-care.com');
ck('adding twice is refused', !P.applyChange(add.next, 'advance', 'add', NEW, SAM, 'x').ok);
ck('removing someone not on the list is refused', !P.applyChange(base(), 'advance', 'remove', NEW, SAM, 'x').ok);
const rm1 = P.applyChange(base(), 'work', 'remove', { person_id: 'p-zach', email: 'zach@mo-care.com', name: 'Zach' }, SAM, 'x');
ck('the work list can lose one member but never its last', rm1.ok && rm1.next.work.length === 1 && !P.applyChange(rm1.next, 'work', 'remove', { person_id: 'p-sam', email: '', name: '' }, SAM, 'x').ok);
ck('the original record is never mutated', base().version === 3 && add.next !== base());

/* SLICE 2a: the screening staff list (who may reveal a Social Security number, date of birth or license number) */
ck('an older saved record without a screening list reads as an empty one', Array.isArray(base().screening) && base().screening.length === 0);
ck('nobody may reveal identity details until named: not an owner by title, not a coordinator', !P.mayApprove(base(), 'screening', SAM) && !P.mayApprove(base(), 'screening', KRY));
ck('only an owner changes the screening list', P.mayChange(base(), 'screening', SAM) && !P.mayChange(base(), 'screening', KRY));
const scr = P.applyChange(base(), 'screening', 'add', KRY, SAM, '2026-10-09T15:00:00Z');
ck('adding Krystal to screening staff touches that list only and writes a history line of kind screening', scr.ok && scr.next.screening.length === 1 && scr.next.advance.length === 1 && scr.next.work.length === 2 && scr.next.history[0].kind === 'screening');
ck('once named, Krystal may reveal; Samantha still may not by title', P.mayApprove(scr.next, 'screening', KRY) && !P.mayApprove(scr.next, 'screening', SAM));
ck('the screening list may be emptied again (unlike Approve to Work)', P.applyChange(scr.next, 'screening', 'remove', KRY, SAM, 'x').ok && P.applyChange(scr.next, 'screening', 'remove', KRY, SAM, 'x').next.screening.length === 0);

// the function itself
const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'svc' };
let handler = null; globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h; } };
let DB = { row: null, version: 0, events: [], saves: 0, raceOnce: false };
const PEOPLE = { 'p-sam': { person_id: 'p-sam', full_name: 'Samantha', primary_email: 'samantha@mo-care.com', active: true },
  'p-zach': { person_id: 'p-zach', full_name: 'Zach', primary_email: 'zach@mo-care.com', active: true },
  'p-kry': { person_id: 'p-kry', full_name: 'Krystal', primary_email: 'krystal@mo-care.com', active: true },
  'p-gone': { person_id: 'p-gone', full_name: 'Left Already', primary_email: 'gone@mo-care.com', active: false } };
const WHO = {}; // token -> caller
globalThis.__fakeCreateClient = () => ({
  auth: { getUser: async (jwt) => WHO[jwt] ? { data: { user: { id: 'u-' + WHO[jwt].person_id, email: WHO[jwt].email, app_metadata: {} } } } : { data: null, error: { message: 'bad' } } },
  from: (table) => { const f = []; const b = {
    select() { return b; }, eq(c, v) { f.push([c, v]); return b; }, maybeSingle() {
      if (table === 'app_data') return Promise.resolve({ data: DB.row ? { data: JSON.parse(JSON.stringify(DB.row)), version: DB.version } : null, error: null });
      if (table === 'persons') { const pid = (f.find(([c]) => c === 'person_id') || [])[1]; return Promise.resolve({ data: PEOPLE[pid] ? { ...PEOPLE[pid] } : null, error: null }); }
      if (table === 'entity_memberships') return Promise.resolve({ data: { active: true, ended_at: null }, error: null });
      return Promise.resolve({ data: null, error: null }); },
    insert(r) { if (table === 'op_events') DB.events.push(r); return Promise.resolve({ error: null }); },
    then(ok) { // list reads: auth_identities, staff_roles
      if (table === 'auth_identities') { const uid = (f.find(([c]) => c === 'auth_user_id') || [])[1]; const pid = String(uid).replace(/^u-/, ''); return Promise.resolve({ data: PEOPLE[pid] ? [{ person_id: pid }] : [], error: null }).then(ok); }
      if (table === 'staff_roles') { const pid = (f.find(([c]) => c === 'person_id') || [])[1]; const c = Object.values(WHO).find((w) => w.person_id === pid); return Promise.resolve({ data: (c?.roles || []).map((role) => ({ role })), error: null }).then(ok); }
      return Promise.resolve({ data: [], error: null }).then(ok); } }; return b; },
  rpc: async (name, a) => { if (name !== 'app_data_save') return { error: { message: 'unexpected ' + name } };
    DB.saves++; if (DB.raceOnce) { DB.raceOnce = false; DB.version++; return { data: { ok: false }, error: null }; }
    if (Number(a.p_expected_version) !== DB.version) return { data: { ok: false }, error: null };
    DB.row = JSON.parse(JSON.stringify(a.p_data)); DB.version++; return { data: { ok: true }, error: null }; },
});
const src = fs.readFileSync(path.join(FN, 'onboarding-permissions/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient');
const tmp = path.join(FN, 'onboarding-permissions', '_t531.ts'); fs.writeFileSync(tmp, src);
try { await import(tmp); } finally { fs.unlinkSync(tmp); }
const call = async (tok, body) => { const r = await handler(new Request('http://x/onboarding-permissions', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(body) })); return { status: r.status, j: await r.json() }; };
WHO.sam = SAM; WHO.zach = ZACH; WHO.kry = KRY; WHO.stranger = { person_id: 'p-x', roles: [], email: 'x@mo-care.com', name: 'X' };
DB = { row: { version: 1, work: [{ person_id: 'p-sam', email: 'samantha@mo-care.com', name: 'Samantha' }], advance: [], history: [] }, version: 1, events: [], saves: 0 };
let r = await call(null, { action: 'get' }); ck('no sign-in: 401', r.status === 401, r);
r = await call('stranger', { action: 'get' }); ck('a person with no office role is refused', r.status === 403, r);
r = await call('kry', { action: 'get' }); ck('a coordinator may read the lists but sees no history and may change nothing', r.status === 200 && r.j.work.length === 1 && r.j.history.length === 0 && !r.j.me.may_change_work && !r.j.me.may_change_advance && !r.j.me.may_approve_work && !r.j.me.may_approve_advance, r.j);
r = await call('kry', { action: 'add', kind: 'advance', person_id: 'p-kry', is_owner: true, roles: ['owner_admin'] }); ck('a body claiming owner is ignored: coordinator cannot add to the advance list', r.status === 403 && DB.saves === 0, r);
r = await call('zach', { action: 'add', kind: 'work', person_id: 'p-zach' }); ck('an owner NOT on the work list cannot add himself to it', r.status === 403, r);
r = await call('sam', { action: 'add', kind: 'work', person_id: 'p-zach' }); ck('Samantha (on the list) adds Zach: saved, logged, version 2', r.status === 200 && r.j.work.length === 2 && DB.row.version === 2 && DB.events.length === 1 && /added Zach to Approve to Work/.test(DB.events[0].summary), r.j);
r = await call('zach', { action: 'add', kind: 'advance', person_id: 'p-kry' }); ck('Zach (owner) adds Krystal to the advance list', r.status === 200 && r.j.advance[0].person_id === 'p-kry' && r.j.advance[0].added_by === 'zach@mo-care.com', r.j);
r = await call('kry', { action: 'get' }); ck('Krystal now may approve to advance, still not to work, and sees the history', r.j.me.may_approve_advance && !r.j.me.may_approve_work && r.j.history.length === 2, r.j.me);
r = await call('sam', { action: 'add', kind: 'advance', person_id: 'p-gone' }); ck('an inactive person cannot be added', r.status === 400, r);
r = await call('sam', { action: 'add', kind: 'advance', person_id: 'p-nobody' }); ck('an unknown person id: 404', r.status === 404, r);
r = await call('sam', { action: 'remove', kind: 'work', person_id: 'p-zach' }); r = await call('sam', { action: 'remove', kind: 'work', person_id: 'p-sam' }); ck('the work list cannot be emptied', r.status === 400 && /cannot be emptied/.test(r.j.error) && DB.row.work.length === 1, r);
DB.raceOnce = true; const before = DB.saves; r = await call('sam', { action: 'add', kind: 'work', person_id: 'p-zach' }); ck('a save that loses the race is retried from a fresh read', r.status === 200 && DB.saves === before + 2 && DB.row.work.length === 2, r);
r = await call('sam', { action: 'add', kind: 'nope', person_id: 'p-zach' }); ck('an unknown list is refused', r.status === 400, r);
r = await call('kry', { action: 'add', kind: 'screening', person_id: 'p-kry' }); ck('a coordinator cannot put herself on the screening list', r.status === 403 && /screening staff/.test(r.j.error || ''), r);
r = await call('sam', { action: 'add', kind: 'screening', person_id: 'p-kry' }); ck('an owner adds Krystal to screening staff: saved, logged, the answer carries the list', r.status === 200 && r.j.screening.length === 1 && /screening staff/.test(DB.events.at(-1).summary || ''), r.j);
r = await call('kry', { action: 'get' }); ck('Krystal now sees may_reveal_identity true and may_change_screening false; Samantha the reverse', r.status === 200 && r.j.me.may_reveal_identity === true && r.j.me.may_change_screening === false, r.j);
r = await call('sam', { action: 'get' }); ck('an owner by title may change the screening list but not reveal', r.j.me.may_reveal_identity === false && r.j.me.may_change_screening === true, r.j);
r = await call('sam', { action: 'add', kind: 'nope', person_id: 'p-kry' }); ck('the kind error names all three lists', r.status === 400 && /'screening'/.test(r.j.error), r);
for (const [n, ok, note] of res) console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note));
const bad = res.filter((x) => !x[1]).length; console.log(`${res.length - bad}/${res.length} passed`); process.exit(bad ? 1 : 0);
