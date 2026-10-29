// PRN STEP 5b (Samantha 2026-10-29: "Yes, build part 5b with its switch off"): open shifts on the PRN Team page with I'm
// Interested. The rules (_shared/prn-open.ts), the ask list's tag, the real prn-page against a fake database and a fake
// coverage-run, coverage-run's two new actions (read from its source), and the SQL on a throwaway Postgres when PGLITE is set.
// Nothing real is reached. node prn_open_shifts_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const FN = 'supabase/functions'
const SECRET = 'S'.repeat(48)
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString()
let T, APP, SENT, OPTED, ENGINE = [], ENGINE_ANSWER = () => ({}), ENGINE_STATUS = 200
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
  then(ok, bad) { return Promise.resolve({ data: b.rows(), error: null }).then(ok, bad) } }; return b }
globalThis.__db = { from: q, rpc: async (fn, a) => {
  if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => String(x.id) === String(a.item.id)); if (i >= 0) arr[i] = a.item; else arr.push(a.item) }
  return { data: null, error: null } } }
globalThis.fetch = async (url, o) => {
  url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}
  if (url.includes('/functions/v1/coverage-run')) { ENGINE.push({ body, auth: o.headers.Authorization }); return new Response(JSON.stringify(ENGINE_ANSWER(body)), { status: ENGINE_STATUS }) }
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + body.phone, dnd: OPTED.has(body.phone) } }), { status: 200 })
  if (url.includes('/conversations/messages')) { SENT.push({ to: body.contactId, msg: body.message }); return new Response('{}', { status: 200 }) }
  return new Response('{}', { status: 200 })
}
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', HUB_JOB_SECRET: SECRET }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
fs.writeFileSync(`${FN}/_shared/_job-auth_t6.ts`, "export const jobCaller = async (req) => req.headers.get('x-test') === 'cron' ? 'cron' : null\n")
process.on('exit', () => { try { fs.unlinkSync(`${FN}/_shared/_job-auth_t6.ts`) } catch { /* */ } })
const load = async (name) => {
  const src = fs.readFileSync(`${FN}/${name}/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/(['"])\.\.\/_shared\/job-auth\.ts\1/, "'../_shared/_job-auth_t6.ts'")
  const tmp = path.join(process.cwd(), FN, name, '_t.ts'); fs.writeFileSync(tmp, src)
  let m; try { m = await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) } return { h: handler, m }
}
const O = await import(path.join(process.cwd(), FN, '_shared/prn-open.ts'))
const AL = await import(path.join(process.cwd(), FN, '_shared/ask-list.ts'))
const PP = await import(path.join(process.cwd(), FN, '_shared/prn-page.ts'))
const PL = await import(path.join(process.cwd(), FN, '_shared/prn-page-links.ts'))
const TODAY = '2026-10-29', NOW = '2026-10-29T10:30'

/* ── which shifts are worth checking ── */
const K = (id, o = {}) => ({ id, status: 'open', client: 'Ruth Lane', shift_date: '2026-11-02', shift_time: '09:00-13:00', asked: [], ...o })
const cands = O.openCandidates([K('a'), K('closed', { status: 'filled' }), K('weekly', { kind: 'interest' }), K('weekly2', { shift_pattern: { kind: 'open_ongoing' } }), K('weekly3', { reason: 'open' }),
  K('noclient', { no_client: true }), K('past', { shift_date: '2026-10-28' }), K('far', { shift_date: '2026-11-13' }), K('edge', { shift_date: '2026-11-12' }), K('started', { shift_date: TODAY, shift_time: '10:00-14:00' }),
  K('later', { shift_date: TODAY, shift_time: '13:00-17:00' }), K('asked', { asked: [{ id: 'x', axiscare_id: '11' }] }), K('askedOther', { asked: [{ id: 'y', axiscare_id: '99' }] }), K('notime', { shift_time: '' })], '11', TODAY, NOW).map((c) => c.id)
ck('open shifts: open, one-time, today to 14 days out, not started, not asked of them yet, soonest first', cands.join() === 'later,a,askedOther,edge', cands)
ck('...a regular weekly opening is never on the page (all three kinds)', !cands.some((c) => c.startsWith('weekly')))
ck('...not on the schedule yet: none', O.openCandidates([K('a')], null, TODAY, NOW).length === 0)
ck('...at most 8 checked', O.openCandidates(Array.from({ length: 12 }, (_, i) => K('m' + i)), '11', TODAY, NOW).length === 8)

/* ── who sees one: the office's own ask list ── */
const G = (o) => ({ ready: [], review: [], dont: [], hidden: 0, ...o })
ck('on Ready to ask: shown', JSON.stringify(O.eligibleOn(G({ ready: [{ axiscare_id: '11', label: 'PRN CNA Team' }] }), '11')) === '{"familiar":false,"outside":false}')
ck('...Familiar on the list: shown as a client they know', O.eligibleOn(G({ ready: [{ axiscare_id: '11', label: 'Familiar' }] }), '11').familiar === true)
ck('...only their own days and times in the way: shown (her default), marked outside their usual times', JSON.stringify(O.eligibleOn(G({ review: [{ axiscare_id: '11', kind: 'call', code: 'outside' }] }), '11')) === '{"familiar":false,"outside":true}')
for (const [what, row] of [['a care-level exception', { kind: 'care', code: 'level' }], ['a skill gap', { kind: 'care', code: 'skill' }], ['overtime', { kind: 'call', code: 'overtime' }],
  ['short notice they said no to', { kind: 'call', code: 'prn_notice' }], ['a regular opening', { kind: 'call', code: 'prn_ongoing' }], ['a yes elsewhere then', { kind: 'call', code: 'overlap' }]])
  ck(`...${what} (Possible with your review): never shown`, O.eligibleOn(G({ review: [{ axiscare_id: '11', ...row }] }), '11') === null)
for (const code of ['dnr', 'working', 'working_now', 'on_break', 'needs_verification', 'lock'])
  ck(`...Do not ask (${code}): never shown`, O.eligibleOn(G({ dont: [{ axiscare_id: '11', kind: 'dont', code }] }), '11') === null)
ck('...not on the list at all: not shown', O.eligibleOn(G({ ready: [{ axiscare_id: '12' }] }), '11') === null)

/* ── what it shows ── */
const v1 = O.openView(K('a', { client: 'Ruth Ann Lane', client_city: 'Ozark' }), { familiar: true, outside: false }, 'Ozark')
ck('a client they know: first name and town, the day and hours', v1.client_first === 'Ruth' && v1.town === 'Ozark' && v1.hours === 4 && v1.shift_key === '2026-11-02|09:00-13:00' && !JSON.stringify(v1).includes('Lane'), v1)
const v2 = O.openView(K('b', { client: 'Ruth Lane', shift_time: '22:00-06:00', address: '1 Main St', care_note: 'falls' }), { familiar: false, outside: true }, 'Nixa')
ck("a client they don't know: no name at all, just the town", v2.client_first === null && !/Ruth|Lane|Main|falls/.test(JSON.stringify(v2)) && v2.outside_my_times === true, v2)
ck('...an overnight shift counts its hours across midnight', v2.hours === 8)

/* ── the switch ── */
ck('switch: off by default', O.openLive({}) === false)
ck('...on, but the page closed: off', O.openLive({ prn_open_shifts_live: true }) === false)
ck('...both on: on', O.openLive({ prn_page_live: true, prn_open_shifts_live: true }) === true)

/* ── I'm Interested is a Yes ── */
const ia = O.interestAsk({ id: 'ask_1', name: 'Grace Hill', phone: '4175550100', ax: '11', contactId: 'C1', key: '2026-11-02|09:00-13:00', now: '2026-10-29T15:00:00Z' })
ck("I'm Interested: a Yes on the case, answered on their PRN Team page", ia.state === 'yes' && ia.reply === "I'm interested (from my PRN Team page)" && ia.from_prn_page === true && ia.answer_channel === 'prn_page' && ia.replied_at === ia.at, ia)
ck('...not a coordinator pick and not a Cara wave (nobody texted them)', ia.picked_by_coordinator === false && ia.auto === false && !ia.cara_wave)
ck('...for the hours they saw', ia.offered_for === '2026-11-02|09:00-13:00' && ia.answered_for === '2026-11-02|09:00-13:00')
ck('the ask list tags it "Interested (from their PRN page)"', (() => { const c = AL.contactOf({ asked: [ia] }, { axiscare_id: '11', name: 'Grace Hill' }); return c.how === 'their PRN Team page' && c.interested_on_page === true && c.state === 'yes' })())
ck('...a texted ask is unchanged', (() => { const c = AL.contactOf({ asked: [{ axiscare_id: '11', picked_by_coordinator: true, state: 'waiting' }] }, { axiscare_id: '11' }); return c.how === 'the office' && !('interested_on_page' in c) })())
ck('afterwards it shows in Offered to You, marked as from their page', (() => { const o = PP.offeredTo([K('a', { asked: [ia] })], '11', TODAY); return o.length === 1 && o[0].from_page === true && o[0].answered === 'yes' })())
ck('the office lines: who, the client\'s first name, the shift; nothing is assigned yet', O.interestOfficeText('Grace', 'Ruth', '2026-11-02', '09:00-13:00') === 'Grace is interested in the Ruth shift (2026-11-02 09:00-13:00) from their PRN Team page. Nothing is assigned yet. Pick on the board: {link}')
ck('no em dash and no "AI" in anything the member or office reads', ![O.INTERESTED_WORDS, O.interestOfficeText('a', 'b', 'c', 'd'), O.interestCardLine('a', 'b', 'c', 'd')].some((t) => /—|\bAI\b/.test(t))
  && !/—/.test(fs.readFileSync(`${FN}/_shared/prn-open.ts`, 'utf8') + fs.readFileSync(`${FN}/prn-page/index.ts`, 'utf8').replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '')))

/* ── coverage-run: the two actions (its source; it needs AxisCare to run) ── */
const cr = fs.readFileSync(`${FN}/coverage-run/index.ts`, 'utf8')
const blk = (a) => { const i = cr.indexOf(`if (body.action === '${a}') {`); return i < 0 ? '' : cr.slice(i, cr.indexOf('\n    }\n', i)) }
const po = blk('prn_open'), pi = blk('prn_interest')
ck('coverage-run prn_open: the owner\'s server key only (prn-page calls it)', /if \(!ownerCall\) return jr\(\{ error: 'owner key only' \}, 403\)/.test(po))
ck('...each shift judged by its own ask list, exactly as the office sees it', /askListFor\(k, setO\?\.data \?\? \{\}\)/.test(po) && /eligibleOn\(lists\.groups, ax\)/.test(po))
ck("...AxisCare can't be read for any of them: none shown", /if \(lists\.meta\?\.schedule\?\.held \|\| lists\.meta\?\.schedule\?\.checked === false\) return jr\(\{ shifts: \[\]/.test(po))
ck('...clients they know first', /a\.familiar === b\.familiar \? 0 : a\.familiar \? -1 : 1/.test(po))
ck('...read only: no write, no text', !/upsert_app_data_item|coverage_case_add_ask|conversations\/messages|textCaseAdmins|sendOne|ghlSend/.test(po))
ck('...it runs before a case is read (no case id needed)', cr.indexOf("body.action === 'prn_open'") < cr.indexOf("const kase = await readCaseFresh(String(body.case_id || ''))"))
ck("coverage-run prn_interest: the owner's key only, and only on a case that is still open", /if \(!ownerCall\) return jr/.test(pi) && cr.indexOf("if (kase.status !== 'open') return jr({ error: 'this coverage case is no longer open") < cr.indexOf("body.action === 'prn_interest'"))
ck('...checked again at the tap: a one-time shift, the hours they saw, not started, not already on it', /prnOngoingCase\(kase\)/.test(pi) && /String\(body\.shift_key \|\| ''\) !== key/.test(pi) && /<= chiNowNaive\(\)/.test(pi) && /already: true/.test(pi))
ck("...AxisCare's visit as it is now: changed or gone refused; can't be read = not saved", /visitMatches\(kase/.test(pi) && /vn === 'unchecked'\) return jr\([^\n]*503/.test(pi))
ck('...still on the ask list in a way their page may show (else refused)', /askListFor\(kase, stI\)/.test(pi) && /if \(!eligibleOn\(lists\.groups, ax\)\) return jr/.test(pi))
ck('...the Yes goes on under the case\'s lock, only if they aren\'t on it already', /sb\.rpc\('coverage_case_add_ask', \{ p_id: String\(kase\.id\), p_ask: ask \}\)/.test(pi))
ck('...the office gets the Yes card and, on the first yes, the text (as the shift page does)', /id: `ops_covfill_\$\{kase\.id\}`/.test(pi) && /if \(!hadYes && ghlI\.token/.test(pi) && /textCaseAdmins\(sb, ghlI, stI, kase/.test(pi) && /onlyAlerted: true, allIfNoneRecorded: true/.test(pi))
ck('...nothing is texted to the member and nobody is assigned', !/conversations\/messages|confirmFill|assign/i.test(pi.replace(/\/\*[\s\S]*?\*\//g, '').replace(/nobody is assigned|Nothing is assigned/gi, '')))
ck('...their contact goes through the do-not-text door (for "covered this time" later)', /contactForOutbound\(sb, ghlI, \{ phone, firstName: name\.split\(' '\)\[0\] \}, 'urgent_internal', \{ audience: 'caregiver'/.test(pi))
ck('"covered this time" reaches a Yes from their page too', /const eligibleAsk = \(a: any\) => \(a\.auto === true \|\| a\.picked_by_coordinator === true \|\| a\.from_prn_page === true\) && a\.ghl_contact_id/.test(cr))

/* ── the real prn-page ── */
const ID = '00000000-0000-4000-8000-000000000001'
const link = Object.fromEntries(new URL(await PL.makePageLink(SECRET, ID, PL.pageExpiry())).searchParams)
const reset = (st = {}) => {
  ENGINE = []; ENGINE_STATUS = 200; ENGINE_ANSWER = (b) => b.action === 'prn_open' ? { shifts: [O.openView(K('a'), { familiar: true, outside: false }, 'Ozark')], held: null } : { ok: true, added: true }
  APP = { ops_settings: st }
  T = { pay_tracks: [{ applicant_id: ID, track: 'prn_team', team: 'cna', since: '2026-03-14', axiscare_caregiver_id: '11', linked_at: daysAgo(30) }],
    job_applicants: [{ id: ID, first_name: 'Grace', last_name: 'Hill', phone: '4175550100', prn: {} }], prn_page_log: [] }
}
const { h } = await load('prn-page')
const call = async (b) => { const r = await h(new Request('https://x/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...link, ...b }) })); return { s: r.status, j: await r.json() } }
reset({ prn_page_live: true })
let r = await call({ action: 'open' })
ck('prn-page, switch off: no open shifts, and coverage-run is never asked', r.s === 200 && r.j.shifts.length === 0 && r.j.open_live === false && ENGINE.length === 0, r)
r = await call({ action: 'interested', case_id: 'a', shift_key: '2026-11-02|09:00-13:00' })
ck("...I'm Interested refused, nothing recorded", r.s === 409 && ENGINE.length === 0 && T.prn_page_log.length === 0, r)
reset({ prn_open_shifts_live: true })
r = await call({ action: 'open' })
ck('...open shifts on but the page closed: "isn\'t open yet"', r.j.closed === true && ENGINE.length === 0, r)
reset({ prn_page_live: true, prn_open_shifts_live: true })
r = await call({ action: 'view' })
ck('switches on: the page says open shifts are on', r.j.ok && r.j.open_live === true)
r = await call({ action: 'open' })
ck('...open shifts come from coverage-run prn_open, for their own AxisCare id, with the server key', r.j.shifts.length === 1 && r.j.shifts[0].client_first === 'Ruth' && ENGINE[0].body.action === 'prn_open' && ENGINE[0].body.axiscare_id === '11' && ENGINE[0].auth === 'Bearer k', [r, ENGINE])
ENGINE_ANSWER = () => ({ shifts: [], held: "We can't check the schedule right now, so open shifts aren't shown. Check back soon." })
r = await call({ action: 'open' })
ck("...AxisCare can't be read: none, and the reason", r.j.shifts.length === 0 && /can't check the schedule/.test(r.j.why), r)
ENGINE_STATUS = 500; ENGINE_ANSWER = () => ({ error: 'boom' })
r = await call({ action: 'open' })
ck('...coverage-run fails: none, and a kind line', r.j.shifts.length === 0 && /couldn't load open shifts/.test(r.j.why), r)
reset({ prn_page_live: true, prn_open_shifts_live: true })
r = await call({ action: 'interested', case_id: 'a', shift_key: '2026-11-02|09:00-13:00' })
const ib = ENGINE.at(-1)?.body
ck("I'm Interested: coverage-run prn_interest with that shift, the hours they saw, their id, phone and name", r.s === 200 && ib.action === 'prn_interest' && ib.case_id === 'a' && ib.shift_key === '2026-11-02|09:00-13:00' && ib.axiscare_id === '11' && ib.phone === '4175550100' && ib.name === 'Grace Hill', [r, ib])
ck('...thanks them; nothing is set until the office confirms', r.j.message === 'Thank you, Grace! The office will look at it and let you know. Nothing is set until they confirm it with you.')
ck('...kept on their page record', T.prn_page_log.some((x) => x.kind === 'interested' && x.note === 'a'))
ENGINE_STATUS = 409; ENGINE_ANSWER = () => ({ error: 'This shift changed while you were looking. Please look at the new details.', changed: true })
r = await call({ action: 'interested', case_id: 'a', shift_key: 'old' })
ck('...refused by coverage-run (changed): says so, nothing recorded', r.s === 409 && r.j.changed === true && /changed/.test(r.j.error) && T.prn_page_log.filter((x) => x.kind === 'interested').length === 1, r)
ENGINE_STATUS = 503; ENGINE_ANSWER = () => ({ error: "We can't check the schedule right now, so this wasn't saved." })
r = await call({ action: 'interested', case_id: 'a', shift_key: '2026-11-02|09:00-13:00' })
ck("...AxisCare can't be read: not saved, says so", r.s === 503 && /wasn't saved/.test(r.j.error))
reset({ prn_page_live: true, prn_open_shifts_live: true }); T.pay_tracks[0].axiscare_caregiver_id = null
r = await call({ action: 'interested', case_id: 'a', shift_key: 'x' })
ck('...not on the schedule yet: refused before coverage-run is asked', r.s === 409 && ENGINE.length === 0, r)
reset({ prn_page_live: true, prn_open_shifts_live: true })
r = await h(new Request('https://x/', { method: 'POST', body: JSON.stringify({ ...link, t: 'A'.repeat(43), action: 'interested', case_id: 'a', shift_key: 'x' }) }))
ck('...a forged link: refused, nothing asked', r.status === 401 && ENGINE.length === 0)
const pg = fs.readFileSync(`${FN}/prn-page/index.ts`, 'utf8')
ck('the office preview may look at open shifts (sign-in checked) but never say interested', /action === 'preview' \|\| action === 'open_preview'\) \{\n    who = await requireStaff/.test(pg) && !/open_preview[^\n]*interested|interested[^\n]*open_preview/.test(pg))

/* ── the SQL ── */
const sql = fs.readFileSync('prn_open_shifts.sql', 'utf8')
ck('SQL: the page record may keep "interested", every earlier kind still', ["'viewed'", "'office_preview'", "'looking_on'", "'looking_off'", "'hours_saved'", "'short_notice'", "'break_set'", "'course_request'", "'idea'", "'interested'"].every((k) => sql.includes(k)))
if (process.env.PGLITE) {
  const { PGlite } = await import(process.env.PGLITE); const db = new PGlite()
  await db.exec(`create table public.job_applicants (id uuid primary key); create table public.app_data (key text primary key, data jsonb);
    create table public.job_postings (slug text primary key, description text);
    insert into public.job_applicants values ('00000000-0000-0000-0000-000000000001');`)
  try { await db.exec(`do $$ begin create role anon; create role authenticated; create role service_role; exception when others then null; end $$;`) } catch {}
  for (const f of ['prn_week.sql', 'prn_familiar.sql', 'prn_welcome.sql', 'prn_page.sql']) await db.exec(fs.readFileSync(f, 'utf8'))
  await db.exec('begin;' + sql + 'commit;'); await db.exec('begin;' + sql + 'commit;')
  const aid = '00000000-0000-0000-0000-000000000001'
  let okIns = true; try { await db.query("insert into public.prn_page_log (applicant_id, kind, note) values ($1, 'interested', 'c1')", [aid]) } catch (e) { okIns = String(e.message) }
  let bad = false; try { await db.query("insert into public.prn_page_log (applicant_id, kind) values ($1, 'nonsense')", [aid]) } catch { bad = true }
  ck('SQL on a throwaway Postgres: runs twice; "interested" kept, anything else refused', okIns === true && bad, okIns)
} else ck('SQL on a throwaway Postgres (skipped: PGLITE not set)', true)

const fails = res.filter((r) => !r[1])
for (const [n, okk, note] of res) console.log((okk ? 'PASS ' : 'FAIL ') + n + (okk ? '' : '  ' + note))
console.log(`\n${res.length - fails.length}/${res.length} passed`)
process.exit(fails.length ? 1 : 0)
