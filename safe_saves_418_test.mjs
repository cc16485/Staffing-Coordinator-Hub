// 418 · safe saves part 1: change history for candidates/caregivers + sc.mo-care.com read-only for them.
//   node safe_saves_418_test.mjs                                   page checks + SQL scans
//   PGLITE=<path to @electric-sql/pglite> node safe_saves_418_test.mjs   also runs the SQL (twice) and the proof in a real Postgres
import fs from 'fs'; import vm from 'vm'; import { execFileSync } from 'child_process'; import os from 'os'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 700)])
const DASH = /[—―]/
const MSG = 'This page is read-only for candidates and caregivers. Use the Caring Companions Hub: cc.mo-care.com'
const html = fs.readFileSync('index.html', 'utf8')

// ── 1. every inline script parses ──
const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1])
let parsed = 0
for (const [i, src] of inline.entries()) {
  const f = path.join(os.tmpdir(), `sc418_${process.pid}_${i}.js`); fs.writeFileSync(f, src)
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); parsed++ } catch (e) { ck(`inline script ${i} parses`, false, String(e.stderr || e).slice(0, 300)) } finally { fs.unlinkSync(f) }
}
ck(`node --check: all ${inline.length} inline scripts parse`, parsed === inline.length && inline.length > 0)

// ── 2. the page's two saves, run with a fake database ──
const cut = (from, to) => { const a = html.indexOf(from), b = html.indexOf(to, a); if (a < 0 || b < 0) throw new Error('missing ' + from); return html.slice(a, b) }
const helpers = cut('// 418 (2026-10-02, Samantha)', '// ── DATA — localStorage-backed')
const sync = cut('async function syncToSupabase(key, data){', 'async function loadFromSupabase(){')
const saves = cut('function saveCandidates(){', '// ── TRAINING HUB LIVE SYNC')
const CALLS = []; const LS = []; const BODY = []; let SERVER = { candidates: [{ id: 1, first: 'Real', last: 'Person' }], caregivers: [{ id: 7, first: 'Real', last: 'Carer' }] }
const fakeSb = {
  auth: { getSession: async () => ({ data: { session: { user: { email: 'staff@example.test' } } } }) },
  from: (t) => {
    const q = { t, op: 'select' }; CALLS.push(q)
    const b = {
      select(c) { q.op = 'select'; q.cols = c; return b }, in(k, v) { q.in = [k, v]; return b },
      upsert(row) { q.op = 'upsert'; q.row = row; return Promise.resolve({ error: null }) },
      insert(row) { q.op = 'insert'; q.row = row; return Promise.resolve({ error: null }) },
      update(row) { q.op = 'update'; q.row = row; return b }, delete() { q.op = 'delete'; return b }, eq() { return b },
      then(ok) { return Promise.resolve({ data: Object.entries(SERVER).filter(([k]) => !q.in || q.in[1].includes(k)).map(([key, data]) => ({ key, data })), error: null }).then(ok) },
    }
    return b
  },
  rpc: (fn, args) => { CALLS.push({ t: 'rpc', fn, args }); return Promise.resolve({ error: null }) },
}
const RENDERED = []
const ctx = {
  sb: fakeSb, console: { warn() {}, log() {} },
  localStorage: { setItem: (k, v) => LS.push(k), getItem: () => null },
  document: { body: { appendChild: (el) => BODY.push(el) }, createElement: () => { const el = { setAttribute() {}, remove() { el.gone = true } }; return el },
    getElementById: (id) => BODY.find((el) => el.id === id && !el.gone) || null },
  setSyncStatus() {},
}
ctx.window = ctx
for (const f of ['renderOB', 'renderTR', 'renderAC', 'renderAlerts']) ctx[f] = () => RENDERED.push(f)
vm.createContext(ctx)
vm.runInContext(helpers + '\n' + sync + '\n' + saves + '\nvar candidates=[{id:1,first:"Real",last:"Person"},{id:2,first:"Stale",last:"Edit"}]; var caregivers=[]; var obId=3, cgId=8;', ctx)
const appDataWrites = () => CALLS.filter((c) => (c.t === 'app_data' && c.op !== 'select') || c.t === 'rpc')
await vm.runInContext('saveCandidates(); saveCaregivers();', ctx); await new Promise((r) => setTimeout(r, 20))
ck('saveCandidates / saveCaregivers never write app_data (no upsert, insert, update, delete or RPC)', appDataWrites().length === 0, CALLS)
ck('... and never write the browser copy either (cc_candidates / cc_caregivers / ids untouched)', LS.length === 0, LS)
ck('... they read the saved lists again (read only), so the edit made in this browser is undone',
  CALLS.some((c) => c.t === 'app_data' && c.op === 'select' && c.in && c.in[1].join() === 'candidates,caregivers') && vm.runInContext('candidates.length', ctx) === 1, [CALLS, vm.runInContext('candidates', ctx)])
ck('... and the tabs are drawn again from the saved lists', ['renderOB', 'renderTR', 'renderAC'].every((f) => RENDERED.includes(f)), RENDERED)
ck('one notice at a time (one toast for both saves), with the exact words and a link to cc.mo-care.com',
  BODY.length === 1 && BODY[0].innerHTML.replace(/<a [^>]*>cc\.mo-care\.com<\/a>/, 'cc.mo-care.com').startsWith(MSG) && /href="https:\/\/cc\.mo-care\.com"/.test(BODY[0].innerHTML), BODY.map((b) => b.innerHTML))
BODY[0].remove(); vm.runInContext('scPeopleReadOnly()', ctx)
ck('closed, then another blocked click: the notice comes back (a blocked click is never silent)', BODY.length === 2 && !BODY[1].gone, BODY.length)
CALLS.length = 0
await vm.runInContext('syncToSupabase("candidates", []); syncToSupabase("caregivers", [])', ctx)
ck('the generic save refuses candidates and caregivers from any path (even an empty list): nothing written', appDataWrites().length === 0 && CALLS.length === 0, CALLS)
await vm.runInContext('syncToSupabase("settings", {a:1}); syncToSupabase("orient_sessions", []); syncToSupabase("eod_reports", []); syncToSupabase("evv_corrections", [])', ctx)
await new Promise((r) => setTimeout(r, 20))
const kept = CALLS.filter((c) => c.t === 'app_data' && c.op === 'upsert').map((c) => c.row.key)
ck('other keys this page saves still save exactly as before (settings, orient_sessions, eod_reports, evv_corrections)', kept.join() === 'settings,orient_sessions,eod_reports,evv_corrections', kept)
ck('scPeopleReadOnly() always says no (true = stop)', vm.runInContext('scPeopleReadOnly()', ctx) === true)

// ── 3. the page itself (static) ──
ck('no code path names candidates or caregivers in a whole-key save any more', !/syncToSupabase\(\s*['"](candidates|caregivers)['"]/.test(html) && !/target_key\s*:\s*['"](candidates|caregivers)['"]/.test(html))
ck('the only direct app_data write is the generic save, which refuses the two keys first',
  (html.match(/from\('app_data'\)\.(upsert|insert|update|delete)\(/g) || []).length === 1 && /async function syncToSupabase\(key, data\)\{\n  if\(SC_READONLY_KEYS\.includes\(key\)\)/.test(html))
ck('the variable-key RPC (attPersist) is only ever called with attendance keys', [...html.matchAll(/attPersist\('([a-z_]+)'/g)].every((m) => ['attendance_events', 'discipline_actions'].includes(m[1])))
for (const pid of ['onboarding', 'training', 'compliance']) {
  const m = html.match(new RegExp(`<div class="panel" id="panel-${pid}">\\s*<div class="sc-ro-banner"[^>]*>([\\s\\S]*?)</div>`))
  ck(`banner at the top of the ${pid} tab with the exact words and the link`, m && m[1].replace(/<[^>]+>/g, '').includes(MSG) && m[1].includes('href="https://cc.mo-care.com"') && m[1].includes('Nothing you change on this page is saved'), m && m[1])
}
const GUARDED = ['openOBModal', 'saveOB', 'openInviteModal', 'openNotHireModal', 'confirmNotHire', 'reactivateOB', 'openManualRef', 'saveManualRef', 'openCGModal', 'saveCG',
  'promoteToCaregiver', 'closeOutCandidate', 'reopenCandidate', 'bulkMarkCheck', 'openImportModal', 'confirmCSVImport', 'batchOIGCheck', 'syncFromTrainingHub']
const unguarded = GUARDED.filter((f) => !new RegExp(`function ${f}\\([^)]*\\)\\{\\s*(?:\\n\\s*)?if\\(scPeopleReadOnly\\(\\)\\) return;`).test(html))
ck(`every way in to adding or changing a person stops first (${GUARDED.length} entry points)`, unguarded.length === 0, unguarded)
const hidden = ['syncFromTrainingHub(this)', "openCGModal('training')", 'batchOIGCheck()', 'openImportModal()', "openCGModal('compliance')"]
  .filter((on) => !new RegExp(`<button class="[^"]*\\bsc-ro-hide\\b[^"]*" onclick="${on.replace(/[()]/g, '\\$&')}"`).test(html))
ck('the add / import / batch OIG / Training sync buttons are hidden; Export CSV and the CSV template stay', hidden.length === 0
  && /<button class="add-btn" onclick="exportComplianceCSV\(\)"/.test(html) && /<button class="add-btn" onclick="downloadCSVTemplate\(\)"/.test(html), hidden)
ck('row buttons, row tick boxes and the bulk bar are hidden in the three tabs (CSS)', /#panel-onboarding tbody button,#panel-training tbody button,#panel-compliance tbody button,\s*#panel-compliance tbody input\[type=checkbox\],#ac-chk-all,#ac-bulk-bar,\.sc-ro-hide\{display:none !important\}/.test(html))
ck('the helpers are defined before the start-up code that could save (clearSeedPeople runs at load)', html.indexOf('const SC_READONLY_KEYS') > 0 && html.indexOf('const SC_READONLY_KEYS') < html.indexOf('\nclearSeedPeople();'))
// what this change added to the page, measured from the commit it was built on (stays true after the merge)
const BASE418 = process.env.BASE418 || '4d64211e51625c621e6e983ddf8e9a1b3ef1bb3a'
const added = (() => { try { return execFileSync('git', ['diff', BASE418, '--', 'index.html'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')) } catch { return null } })()
if (added === null) console.log('(git history not available here: the em dash check on the added lines is skipped)')
else ck('no em dash in anything this change adds to the page', added.length > 0 && !added.some((l) => DASH.test(l)), added.filter((l) => DASH.test(l)))
ck('the marker the installer looks for on the live site is there', html.includes('data-sc-readonly="418"'))

// ── 4. the SQL (scans) ──
const sq = fs.readFileSync('app_data_history.sql', 'utf8'); const pf = fs.readFileSync('app_data_history_proof.sql', 'utf8')
ck('SQL: one transaction', /^begin;/m.test(sq) && /^commit;\s*$/m.test(sq))
ck('SQL: watches only candidates and caregivers', (sq.match(/in \('candidates', 'caregivers'\)/g) || []).length === 3)
ck('SQL: nothing dropped but its own triggers and policy; no blanket grant, no truncate', !/drop (table|function)/i.test(sq) && !/grant all/i.test(sq) && !/truncate/i.test(sq)
  && (sq.match(/drop (trigger|policy) if exists/g) || []).length === 3)
ck('SQL: never reads ssn, phone or email', !/ssn|phone|email'/i.test(sq.replace(/^--.*$/gm, '').replace(/claims->>'email'/g, '')))
ck('SQL: the watcher is wrapped so a failure can never fail the save, and records trigger_error', /exception when others then\s*begin\s*insert into public\.app_data_item_change \(key, change/.test(sq))
ck('SQL: anon gets nothing; authenticated read only; RLS on', /revoke all on public\.app_data_item_change from public, anon, authenticated;/.test(sq) && /grant select on public\.app_data_item_change to authenticated;/.test(sq) && /enable row level security/.test(sq))
ck('SQL: indexes on (key, at desc) and (record_id); retention note', /\(key, at desc\)/.test(sq) && /\(record_id\)/.test(sq) && /RETENTION/.test(sq))
ck('proof: a single DO block that always ends by raising PROBE_RESULT (so it is rolled back)', /^do \$proof\$/m.test(pf) && (pf.match(/raise exception 'PROBE_RESULT/g) || []).length === 2 && !/commit/i.test(pf.replace(/^--.*$/gm, '')))
ck('no em dash in the SQL', !DASH.test(sq) && !DASH.test(pf))

// ── 5. the SQL in a real Postgres ──
if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE)
  const db = new PGlite()
  const P = (i, o = {}) => ({ id: i, first: 'First' + i, last: 'Last' + i, phone: '41755500' + String(i).padStart(2, '0'), email: `p${i}@example.test`, ssn: '123-45-67' + String(i).padStart(2, '0'), status: 'new', ...o })
  const list = (n) => Array.from({ length: n }, (_, i) => P(i + 1))
  await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create table public.app_data (key text primary key, data jsonb, updated_at timestamptz default now());
create function public.can_access_data_key(k text) returns boolean language sql stable as $$ select true $$;
alter table public.app_data enable row level security;
create policy app_data_rw on public.app_data for all to authenticated using (public.can_access_data_key(key)) with check (public.can_access_data_key(key));
grant select, insert, update, delete on public.app_data to authenticated;
insert into public.app_data (key, data) values ('candidates', '${JSON.stringify(list(60))}'), ('caregivers', '${JSON.stringify(list(5))}'), ('settings', '{"a":1}'), ('leads', '[{"id":"L1"}]');`)
  await db.exec(sq); await db.exec(sq)
  ck('PGLITE: the SQL installs, and installs again (safe to re-run)', true)
  const hist = async (w = 'true') => (await db.query(`select key, record_id, change, fields_changed, bulk_removed, actor, role, origin, names, error from public.app_data_item_change where ${w} order by id`)).rows
  const save = async (key, data, claims = null, headers = null) => {
    await db.exec('begin')
    if (claims) await db.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
    if (headers) await db.query(`select set_config('request.headers', $1, true)`, [JSON.stringify(headers)])
    if (claims) await db.exec('set local role authenticated')
    const r = await db.query('update public.app_data set data = $1, updated_at = now() where key = $2', [JSON.stringify(data), key])
    await db.exec('commit'); return r.affectedRows
  }
  const SIGNED = { role: 'authenticated', sub: 'u-1', email: 'krystal@example.test' }
  // one changed, one added, three removed
  let cur = list(60); let next = cur.filter((x) => x.id < 58).map((x) => x.id === 5 ? { ...x, status: 'ready', phone: '4170000000' } : x).concat([P(61, { first: 'Aimee', last: 'Newperson' })])
  let n = await save('candidates', next, SIGNED, { origin: 'https://sc.mo-care.com' })
  let h = await hist()
  ck('PGLITE: the save went through', n === 1)
  const ch = h.filter((x) => x.change === 'changed'), ad = h.filter((x) => x.change === 'added'), rm = h.filter((x) => x.change === 'removed')
  ck('PGLITE: changed: one line, record id + field NAMES only (phone, status), no values, no name', ch.length === 1 && ch[0].record_id === '5' && ch[0].fields_changed.join() === 'phone,status' && ch[0].names === null, ch)
  ck('PGLITE: added: one line with first + last only', ad.length === 1 && ad[0].record_id === '61' && ad[0].names === 'Aimee Newperson' && ad[0].bulk_removed === false, ad)
  ck('PGLITE: removed: three lines, bulk_removed true (more than 2 in one save), names kept', rm.length === 3 && rm.every((x) => x.bulk_removed) && rm.map((x) => x.record_id).sort().join() === '58,59,60' && rm[0].names === 'First58 Last58', rm)
  ck('PGLITE: who / role / where: the signed-in email, authenticated, the page origin', h.every((x) => x.actor === 'krystal@example.test' && x.role === 'authenticated' && x.origin === 'https://sc.mo-care.com' && x.key === 'candidates'), h)
  ck('PGLITE: no phone, email, SSN or value of any field is ever in the history', !/41755500|4170000000|example\.test"|@example|123-45|ready/.test(JSON.stringify(h.map(({ actor, ...x }) => x))), h)
  // two removed: not bulk
  await db.exec('delete from public.app_data_item_change')
  cur = next; next = cur.filter((x) => x.id !== 1 && x.id !== 2)
  await save('candidates', next, SIGNED)
  h = await hist()
  ck('PGLITE: two removed in one save: not bulk', h.length === 2 && h.every((x) => x.change === 'removed' && !x.bulk_removed), h)
  // server save: no claims
  await db.exec('delete from public.app_data_item_change')
  await save('caregivers', list(5).map((x) => x.id === 3 ? { ...x, oig_date: '2026-10-02' } : x), { role: 'service_role' })
  h = await hist()
  ck('PGLITE: a server save is recorded as actor "server", role service_role; caregivers are watched too', h.length === 1 && h[0].key === 'caregivers' && h[0].actor === 'server' && h[0].role === 'service_role' && h[0].fields_changed?.join() === 'oig_date', h)
  await db.exec('delete from public.app_data_item_change')
  await db.exec(`update public.app_data set data = data || '[{"id":"x9","name":"Only Name"}]'::jsonb where key = 'caregivers'`)
  h = await hist()
  ck('PGLITE: a direct database save: actor server, role database; a record with only "name" keeps that name', h.length === 1 && h[0].actor === 'server' && h[0].role === 'database' && h[0].names === 'Only Name', h)
  // referer: site only
  await db.exec('delete from public.app_data_item_change')
  await save('caregivers', list(5), SIGNED, { referer: 'https://cc.mo-care.com/index.html?token=abc#x' })
  h = await hist()
  ck('PGLITE: only the site part of a referer is kept (never its path or query)', h.length > 0 && h.every((x) => x.origin === 'https://cc.mo-care.com'), h)
  // other keys ignored, same list ignored
  await db.exec('delete from public.app_data_item_change')
  await save('settings', { a: 2 }, SIGNED); await save('leads', [{ id: 'L2' }], SIGNED)
  await save('caregivers', list(5), SIGNED)
  ck('PGLITE: other keys are ignored, and a save that changes nothing records nothing', (await hist()).length === 0)
  // bad header: still recorded
  await save('caregivers', list(4), SIGNED, null); await db.exec('delete from public.app_data_item_change')
  await db.exec('begin'); await db.query(`select set_config('request.headers', 'not json', true)`)
  await db.query('update public.app_data set data = $1 where key = $2', [JSON.stringify(list(5)), 'caregivers']); await db.exec('commit')
  h = await hist()
  ck('PGLITE: an unreadable request header never stops the record (origin just empty)', h.length === 1 && h[0].change === 'added' && h[0].origin === null, h)
  // forced error: the save still goes through
  await db.exec('delete from public.app_data_item_change')
  await db.exec(`alter table public.app_data_item_change add constraint t_force check (change = 'trigger_error') not valid`)
  n = await save('candidates', list(10), SIGNED)
  const kept10 = (await db.query(`select jsonb_array_length(data) as n from public.app_data where key = 'candidates'`)).rows[0].n
  h = await hist()
  ck('PGLITE: the watcher failing never fails the save; one trigger_error line instead', n === 1 && kept10 === 10 && h.length === 1 && h[0].change === 'trigger_error' && h[0].actor === 'krystal@example.test' && h[0].error, [n, kept10, h])
  await db.exec(`alter table public.app_data_item_change drop constraint t_force; alter table public.app_data_item_change add constraint t_force2 check (false) not valid`)
  n = await save('candidates', list(12), SIGNED)
  ck('PGLITE: even if the error line cannot be written, the save still goes through', n === 1 && (await db.query(`select jsonb_array_length(data) as n from public.app_data where key = 'candidates'`)).rows[0].n === 12)
  await db.exec('alter table public.app_data_item_change drop constraint t_force2')
  // row deleted
  await db.exec('delete from public.app_data_item_change')
  await db.exec(`insert into public.app_data (key, data) values ('caregivers_tmp', '[]')`)
  await db.exec(`delete from public.app_data where key = 'caregivers'`)
  h = await hist()
  ck('PGLITE: the whole caregivers row deleted: every person recorded as removed, in bulk', h.length === 5 && h.every((x) => x.change === 'removed' && x.bulk_removed), h)
  await db.exec(`insert into public.app_data (key, data) values ('caregivers', '${JSON.stringify(list(3))}')`)
  ck('PGLITE: the row created again: each person recorded as added', (await hist(`change = 'added'`)).length === 3)
  // reading rules
  await db.exec(`insert into public.app_data_item_change (key, change) values ('candidates', 'added')`)
  const as = async (role, q) => { await db.exec('begin'); await db.exec(`set local role ${role}`); try { const r = await db.query(q); return r.rows } catch (e) { return 'refused: ' + e.message } finally { await db.exec('rollback') } }
  ck('PGLITE: a signed-in browser can read the history', Array.isArray(await as('authenticated', 'select count(*) from public.app_data_item_change')))
  ck('PGLITE: a signed-in browser cannot write, change or delete it', String(await as('authenticated', `insert into public.app_data_item_change (key, change) values ('candidates', 'added')`)).startsWith('refused')
    && String(await as('authenticated', `update public.app_data_item_change set names = 'x'`)).startsWith('refused') && String(await as('authenticated', 'delete from public.app_data_item_change')).startsWith('refused'))
  ck('PGLITE: anon cannot read it', String(await as('anon', 'select count(*) from public.app_data_item_change')).startsWith('refused'))
  ck('PGLITE: the server (service_role) can tidy it later', Array.isArray(await as('service_role', 'delete from public.app_data_item_change where false')))
  // 50 more rounds on 60 people: cheap enough
  await db.exec(`update public.app_data set data = '${JSON.stringify(list(60))}' where key = 'candidates'`)
  const t0 = Date.now()
  for (let i = 0; i < 50; i++) await db.query('update public.app_data set data = $1 where key = $2', [JSON.stringify(list(60).map((x) => x.id === 1 ? { ...x, n: i } : x)), 'candidates'])
  const ms = (Date.now() - t0) / 50
  ck(`PGLITE: a save of 60 people costs little (${ms.toFixed(1)} ms each here, in WebAssembly)`, ms < 100, ms)
  // the installer's proof, run here: everything rolled back
  await db.exec(`update public.app_data set data = '${JSON.stringify(list(20))}' where key = 'candidates'`)
  const before = (await db.query(`select (select count(*) from public.app_data_item_change)::int as n, (select md5(data::text) from public.app_data where key = 'candidates') as m, (select updated_at from public.app_data where key = 'candidates') as u`)).rows[0]
  let probe = null
  try { await db.exec(pf) } catch (e) { probe = e.message }
  const after = (await db.query(`select (select count(*) from public.app_data_item_change)::int as n, (select md5(data::text) from public.app_data where key = 'candidates') as m, (select updated_at from public.app_data where key = 'candidates') as u`)).rows[0]
  const J = probe && probe.includes('PROBE_RESULT: ') ? JSON.parse(probe.split('PROBE_RESULT: ')[1]) : null
  const kinds = J ? J.rows.map((r) => r.change).sort().join() : ''
  ck('PGLITE proof: one changed, one added, three removed (bulk), read back as the signed-in browser', J && J.saved === 1 && kinds === 'added,changed,removed,removed,removed'
    && J.rows.filter((r) => r.change === 'removed').every((r) => r.bulk_removed && r.names === 'true') && J.rows.find((r) => r.change === 'added').names === 'Proof Added'
    && J.rows.find((r) => r.change === 'changed').fields_changed.join() === '_proof_418' && J.rows.every((r) => r.actor === 'proof-418@invalid.test' && r.role === 'authenticated' && r.origin === 'https://proof-418.invalid'), J || probe)
  ck('PGLITE proof: no phone / email / SSN / referer path leaked; the real names of removed people are not in the result', J && J.leak === false && !/First1[89]|First20/.test(probe), J)
  ck('PGLITE proof: the forced watcher failure still saved, with one trigger_error line', J && J.error_saved === 1 && J.error_save_kept === true && J.error_rows.length === 1 && J.error_rows[0].has_error_text, J)
  ck('PGLITE proof: nothing stayed (history count, list and updated_at unchanged; the temporary rule is gone)', before.n === after.n && before.m === after.m && String(before.u) === String(after.u)
    && (await db.query(`select count(*)::int as n from pg_constraint where conname = 'proof_418_force_error'`)).rows[0].n === 0, [before, after])
  await db.exec(`update public.app_data set data = '[{"id":1},{"id":2}]' where key = 'candidates'`)
  try { await db.exec(pf) } catch (e) { probe = e.message }
  ck('PGLITE proof: with fewer than 4 people it skips (and still changes nothing)', /skipped/.test(probe), probe)
} else console.log('(PGLITE not set: the real-Postgres run of the SQL is skipped)')

const failed = res.filter((r) => !r[1])
for (const [n, ok, note] of res) console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '\n      ' + note}`)
console.log(`\n${res.length - failed.length}/${res.length} passed${failed.length ? ' · FAIL' : ''}`)
process.exit(failed.length ? 1 : 0)
