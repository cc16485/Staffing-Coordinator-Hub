// PRN · "WOULD YOU LIKE MORE HOURS?" (2026-10-29, plan section 3: the 60-day check-in plus "Would you like more hours?"; the
// check-in text already opens their PRN Team page at My hours, so the question sits there). The real prn-page against a fake
// database, the This week line, and the SQL on a throwaway Postgres when PGLITE is set. node prn_more_hours_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const FN = 'supabase/functions'
const SECRET = 'S'.repeat(48)
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString()
let CLOCK = { wd: 'Tue', hour: '11' }
const realTLS = Date.prototype.toLocaleString, realTLDS = Date.prototype.toLocaleDateString
Date.prototype.toLocaleString = function (loc, o) { if (o && o.hour === '2-digit' && !o.minute && o.timeZone === 'America/Chicago') return CLOCK.hour; return realTLS.call(this, loc, o) }
Date.prototype.toLocaleDateString = function (loc, o) { if (o && o.weekday === 'short' && o.timeZone === 'America/Chicago' && !o.month) return CLOCK.wd; if (loc === 'en-CA' && o && o.timeZone === 'America/Chicago' && !o.weekday && globalThis.__today && Math.abs(this.getTime() - Date.now()) < 5000) return globalThis.__today; return realTLDS.call(this, loc, o) }
let T, APP, SENT, OPTED
const q = (t) => { const st = { f: [], isNull: [], nn: [], gte: null, upd: null }; const b = {
  select() { return b }, order() { return b }, limit() { return b },
  eq(c, v) { st.f.push([c, v]); return b }, is(c, v) { if (v === null) st.isNull.push(c); return st.upd ? b.run() : b }, not(c, op, v) { if (op === 'is' && v === null) st.nn.push(c); return b },
  gte(c, v) { st.gte = [c, v]; return b }, in() { return b },
  update(o) { st.upd = o; return b }, insert(o) { (T[t] ||= []).push({ ...o }); return Promise.resolve({ data: null, error: null }) },
  rows() { if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]; return k in APP ? [{ key: k, data: APP[k] }] : [] }
    let r = T[t] ?? []; for (const [c, v] of st.f) r = r.filter((x) => x[c] === v); for (const c of st.isNull) r = r.filter((x) => x[c] == null)
    for (const c of st.nn) r = r.filter((x) => x[c] != null); if (st.gte) r = r.filter((x) => String(x[st.gte[0]]) >= st.gte[1]); return r },
  run() { for (const x of b.rows()) Object.assign(x, st.upd); return Promise.resolve({ data: null, error: null }) },
  maybeSingle() { return Promise.resolve({ data: b.rows()[0] ?? null, error: null }) },
  then(ok, bad) { if (st.upd) return b.run().then(ok, bad); return Promise.resolve({ data: b.rows(), error: null }).then(ok, bad) } }; return b }
globalThis.__db = { from: q, rpc: async (fn, a) => {
  if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => String(x.id) === String(a.item.id)); if (i >= 0) arr[i] = a.item; else arr.push(a.item) }
  return { data: null, error: null } } }
globalThis.fetch = async (url, o) => {
  url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + body.phone, dnd: OPTED.has(body.phone) } }), { status: 200 })
  if (url.includes('/conversations/messages')) { SENT.push({ to: body.contactId, msg: body.message }); return new Response('{}', { status: 200 }) }
  return new Response('{}', { status: 200 })
}
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', HUB_JOB_SECRET: SECRET }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
fs.writeFileSync(`${FN}/_shared/_job-auth_t9.ts`, "export const jobCaller = async (req) => req.headers.get('x-test') === 'cron' ? 'cron' : null\n")
process.on('exit', () => { try { fs.unlinkSync(`${FN}/_shared/_job-auth_t9.ts`) } catch { /* */ } })
const load = async (name) => {
  const src = fs.readFileSync(`${FN}/${name}/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/(['"])\.\.\/_shared\/job-auth\.ts\1/, "'../_shared/_job-auth_t9.ts'")
  const tmp = path.join(process.cwd(), FN, name, '_t.ts'); fs.writeFileSync(tmp, src)
  let m; try { m = await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) } return { h: handler, m }
}
const P = await import(path.join(process.cwd(), FN, '_shared/prn-page.ts'))
const PL = await import(path.join(process.cwd(), FN, '_shared/prn-page-links.ts'))

/* ── 1. This week ── */
const M = [{ applicant_id: 'g', name: 'Grace Hill', first: 'Grace', team: 'cna' }]
let l = P.pageLines({ members: M, today: '2026-11-04', touches: [], log: [{ id: 7, applicant_id: 'g', kind: 'more_hours', note: 'yes', at: '2026-11-04T15:00:00Z' }] })
ck('a yes on their page: "Grace would like more hours" on This week', l.length === 1 && l[0].kind === 'hours' && l[0].title === 'Grace would like more hours' && /their PRN Team page/.test(l[0].detail), l)
l = P.pageLines({ members: M, today: '2026-11-04', touches: [], log: [{ id: 7, applicant_id: 'g', kind: 'more_hours', note: 'yes', at: '2026-11-03T15:00:00Z' }, { id: 8, applicant_id: 'g', kind: 'more_hours', note: 'no', at: '2026-11-04T15:00:00Z' }] })
ck('...they changed it to "not right now": no line', l.length === 0, l)
ck('...called: gone', P.pageLines({ members: M, today: '2026-11-04', touches: [{ applicant_id: 'g', kind: 'called', ref: 'morehours:7' }], log: [{ id: 7, applicant_id: 'g', kind: 'more_hours', note: 'yes', at: '2026-11-04T15:00:00Z' }] }).length === 0)

/* ── 2. the real prn-page ── */
const G = '00000000-0000-4000-8000-000000000001'
const { h: page } = await load('prn-page')
const link = Object.fromEntries(new URL(await PL.makePageLink(SECRET, G, PL.pageExpiry())).searchParams)
const resetP = (st = {}) => { APP = { ops_settings: { prn_page_live: true, ...st } }
  T = { pay_tracks: [{ applicant_id: G, track: 'prn_team', team: 'cna', since: '2026-03-01', axiscare_caregiver_id: '11' }], job_applicants: [{ id: G, first_name: 'Grace', last_name: 'Hill', prn: {} }],
    prn_page_log: [], prn_oncall: [], prn_touches: [], prn_shift_log: [], prn_oncall_marks: [], prn_oncall_signatures: [] } }
const call = async (b) => { const x = await page(new Request('https://x/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...link, ...b }) })); return { s: x.status, j: await x.json() } }
resetP(); let r = await call({ action: 'view' })
ck('switch off: the question is not on their page', r.j.ok && r.j.hours.more_hours === null, r.j.hours)
r = await call({ action: 'more_hours', answer: 'yes' }); ck('...answering is refused, nothing saved', r.s === 409 && !T.prn_page_log.some((x) => x.kind === 'more_hours') && !T.job_applicants[0].prn.more_hours, [r, T.prn_page_log])
resetP({ prn_more_hours_live: true }); r = await call({ action: 'view' })
ck('switch on: the question shows, not answered yet', r.j.hours.more_hours && r.j.hours.more_hours.answer === null && r.j.hours.more_hours.waiting === false, r.j.hours)
r = await call({ action: 'more_hours', answer: 'yes' })
ck('yes: kept on their PRN answers (by them, on the page) and on their page record; thanks them', r.j.ok && /office will be in touch about more hours/.test(r.j.message) && T.job_applicants[0].prn.more_hours.answer === 'yes' && T.job_applicants[0].prn.more_hours.how === 'page'
  && T.job_applicants[0].prn.more_hours_history.length === 1 && T.prn_page_log.some((x) => x.kind === 'more_hours' && x.note === 'yes'), [r.j, T.job_applicants[0].prn])
r = await call({ action: 'view' }); ck('...their page shows their answer', r.j.hours.more_hours.answer === 'yes')
r = await call({ action: 'more_hours', answer: 'no' }); ck('"not right now": kept too, with the history', r.j.ok && T.job_applicants[0].prn.more_hours.answer === 'no' && T.job_applicants[0].prn.more_hours_history.length === 2)
r = await call({ action: 'more_hours', answer: 'lots' }); ck('...anything else refused', r.s === 400)
ck('no em dash in what they read', !/—/.test(fs.readFileSync(`${FN}/prn-page/index.ts`, 'utf8').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')))

/* ── 3. the SQL ── */
const sql = fs.readFileSync('prn_more_hours.sql', 'utf8')
if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE); const db = new PGlite()
  await db.exec(`create table public.job_applicants (id uuid primary key); create table public.app_data (key text primary key, data jsonb); create table public.job_postings (slug text primary key, description text);
    insert into public.job_applicants values ('00000000-0000-0000-0000-000000000001');`)
  try { await db.exec(`do $$ begin create role anon; create role authenticated; create role service_role; exception when others then null; end $$;`) } catch {}
  for (const f of ['prn_week.sql', 'prn_familiar.sql', 'prn_welcome.sql', 'prn_page.sql']) await db.exec(fs.readFileSync(f, 'utf8'))
  await db.exec('begin;' + sql + 'commit;'); await db.exec('begin;' + sql + 'commit;')
  const A = "'00000000-0000-0000-0000-000000000001'"
  let okAll = true; try { await db.query(`insert into public.prn_page_log (applicant_id, kind, note) values (${A}, 'more_hours', 'yes'), (${A}, 'oncall_signed', 'v1'), (${A}, 'oncall_ask', 'x'), (${A}, 'feedback', 'x'), (${A}, 'interested', 'c')`) } catch (e) { okAll = String(e.message) }
  let bad = false; try { await db.query(`insert into public.prn_page_log (applicant_id, kind) values (${A}, 'nonsense')`) } catch { bad = true }
  ck('SQL: runs twice; "more_hours" kept, and every earlier kind (the on-call calendar\'s too); anything else refused', okAll === true && bad, okAll)
} else ck('SQL on a throwaway Postgres (skipped: PGLITE not set)', true)

const fails = res.filter((r) => !r[1])
for (const [n, okk, note] of res) console.log((okk ? 'PASS ' : 'FAIL ') + n + (okk ? '' : '  ' + note))
console.log(`\n${res.length - fails.length}/${res.length} passed`)
process.exit(fails.length ? 1 : 0)
