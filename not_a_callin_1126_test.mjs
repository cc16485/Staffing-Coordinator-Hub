// 1126 · NOT A CALL-IN (2026-10-26, Angiel Falig's 4pm call for Patsy: the running-late reader opened a call-off case
// from her retelling "I said, I'm already driving", a minute after Samantha had marked her there, and the text link had
// no way to say it was not a call-in). Against stand-ins only: a fake database, a fake AI, no GoHighLevel or AxisCare.
//   1. the reader: the call reader's model, the whole call, the never-a-call-off rules; no words of theirs = never sure
//   2. the hold: a phone call, or a missed clock-in a PERSON settled, never opens a case by itself; a text still does
//   3. "Not a call-in": the shared helper, the text link (open AND already-closed cases), the board's signed-in path
// node not_a_callin_1126_test.mjs
import fs from 'fs'; import path from 'path'
{ const RealDate = Date, FIXED = RealDate.parse('2026-10-25T21:30:00Z')
  globalThis.Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [FIXED])) } static now() { return FIXED } } }
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1200)])
const SECRET = 's'.repeat(48)
let AI = [], AI_ANSWER = null, SENT = [], EVENTS = [], APP, HR, AUTH_USER = null

globalThis.fetch = async (u, o = {}) => {
  const url = String(u); const body = o.body ? JSON.parse(o.body) : {}
  const R = (s, b) => new Response(JSON.stringify(b), { status: s })
  if (url.includes('api.anthropic.com')) { AI.push(body); return R(200, { content: [{ text: JSON.stringify(AI_ANSWER) }] }) }
  if (url.includes('/contacts/upsert')) return R(200, { contact: { id: 'c' + String(body.phone || '').replace(/\D/g, '').slice(-10), dnd: false } })
  if (url.endsWith('/conversations/messages')) { SENT.push({ to: body.contactId, msg: body.message }); return R(200, {}) }
  if (/\/contacts\/[^/]+$/.test(url)) return R(200, { contact: { dnd: false } })
  return R(404, {})
}
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', HUB_JOB_SECRET: SECRET, GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', ANTHROPIC_API_KEY: 'a' }
let handler; globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h } }

/* ── the stand-in database ── */
const db = {
  auth: { getUser: async (jwt) => AUTH_USER && jwt === 'good-jwt' ? { data: { user: AUTH_USER }, error: null } : { data: null, error: { message: 'bad' } } },
  rpc: async (n, a) => {
    if (n === 'coverage_case_patch') { const arr = APP.coverage_cases; const i = arr.findIndex((c) => c.id === a.p_id); if (i < 0) return { data: { outcome: 'not_found' }, error: null }
      for (const [k, v] of Object.entries(a.p_expect || {})) if ((arr[i][k] ?? null) !== v) return { data: { outcome: 'conflict', item: arr[i] }, error: null }
      arr[i] = { ...arr[i], ...a.p_patch }; return { data: { outcome: 'ok', item: arr[i] }, error: null } }
    if (n === 'delete_app_data_item') { APP[a.target_key] = (APP[a.target_key] || []).filter((x) => String(x.id) !== a.item_id); return { data: null, error: null } }
    if (n === 'upsert_app_data_item') { const arr = APP[a.target_key] = APP[a.target_key] || []; const i = arr.findIndex((x) => x.id === a.item.id); if (i < 0) arr.push(a.item); else arr[i] = a.item; return { data: null, error: null } }
    return { data: { outcome: 'recorded' }, error: null } },
  from: (t) => { const f = []; let upd = null
    const rows = () => {
      if (t === 'hr_cases') return HR.filter((h) => f.every(([k, v, op]) => op === 'contains' ? v.every((x) => (h[k] || []).includes(x)) : h[k] === v))
      if (t === 'auth_identities') return AUTH_USER ? [{ person_id: 'p1' }] : []
      if (t === 'persons') return [{ full_name: 'Samantha Troutman', active: true }]
      if (t === 'entity_memberships') return [{ active: true, ended_at: null }]
      if (t === 'staff_roles') return [{ role: 'owner_admin' }]
      return null }
    const p = { select() { return p }, eq(k, v) { f.push([k, v]); return p }, contains(k, v) { f.push([k, v, 'contains']); return p }, maybeSingle() { p._one = true; return p },
      limit() { return p }, order() { return p }, gte() { return p }, in() { return p },
      update(r) { upd = r; return p },
      insert(r) { if (t === 'op_events') EVENTS.push(r); return Promise.resolve({ error: null }) },
      then(ok, bad) {
        if (upd && t === 'hr_cases') { for (const h of rows()) Object.assign(h, upd); return Promise.resolve({ error: null }).then(ok, bad) }
        const key = (f.find((x) => x[0] === 'key') || [])[1]
        let data = t === 'app_data' ? (key in APP ? { data: APP[key] } : null) : rows()
        if (p._one && Array.isArray(data)) data = data[0] ?? null
        return Promise.resolve({ data, error: null }).then(ok, bad) } }
    return p } }
globalThis.__db = db

const reset = (status = 'open') => {
  AI = []; SENT = []; EVENTS = []; AUTH_USER = null
  APP = { ops_settings: { coverage_alert_admins: ['samantha@mo-care.com', 'krystal@mo-care.com'] },
    coordinator_staff: [{ email: 'samantha@mo-care.com', name: 'Samantha Troutman', phone: '4175559001' }, { email: 'krystal@mo-care.com', name: 'Krystal Land', phone: '4175559002' }],
    caregivers: [{ first: 'Angiel', last: 'Falig', phone: '4175550109', axiscare_id: '109' }],
    coverage_cases: [{ id: 'cwc_s_109_d_2026_10_25', status, client: 'Patsy', shift_date: '2026-10-25', shift_time: '16:00-20:00', reason: 'call_off',
      calling_off: 'Angiel Falig', calling_off_id: '109', opened_by: 'caregiver-words', attendance_confirm: true, asked: [], opened_at: '2026-10-25T21:10:17Z',
      admin_alerted: { to: ['samantha@mo-care.com', 'krystal@mo-care.com'] }, admin_links: ['samantha@mo-care.com', 'krystal@mo-care.com'],
      said: "I was like, I I don't think I can do it this early before four. Yeah. And I was like, oh, and I said, I'm already driving.",
      note: "Opened by Cara from Angiel Falig's own words (read by the running-late watcher)." }],
    attendance_events: [{ id: 'att_cov_cwc_s_109_d_2026_10_25', caregiver: 'Angiel Falig', type: 'callin' }, { id: 'att_cov_other', caregiver: 'Someone Else', type: 'callin' }],
    ops_items: [{ id: 'ops_attc_cwc_s_109_d_2026_10_25', status: 'open', title: 'Confirm: did Angiel Falig call off Patsy?' }] }
  HR = [{ id: 'hr1', status: 'open', source_ids: ['att_cov_cwc_s_109_d_2026_10_25'] }, { id: 'hr2', status: 'open', source_ids: ['att_cov_other'] }]
}
const k = () => APP.coverage_cases[0]

/* ── 1 · the reader (late-watch's readLate, loaded without starting its server) ── */
const lwSrc = fs.readFileSync(path.join(FN, 'late-watch/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace("from '../_shared/job-auth.ts'", "from '" + path.resolve(ROOT, 'test_stubs/job-auth-by-role.mjs') + "'")
  .replace(/from '\.\.\/_shared\/([\w.-]+\.(?:ts|js))'/g, (_, m) => "from '" + path.join(FN, '_shared', m) + "'")
const lwTmp = path.join(FN, 'late-watch', '_t1126.ts'); fs.writeFileSync(lwTmp, lwSrc)
let LW; try { LW = await import(lwTmp + '?' + Math.random()) } finally { fs.unlinkSync(lwTmp) }
handler = null
const start = Date.parse('2026-10-25T21:00:00Z')   // 4pm Central
const call = "(phone call) Speaker 1: Hi this is Angiel. Speaker 2: Hi Angiel. Speaker 1: " + "I was at Patsy's birthday party, I couldn't clock in, no range. ".repeat(60)
  + "I was like, I I don't think I can do it this early before four. Yeah. And I was like, oh, and I said, I'm already driving."
AI_ANSWER = { kind: 'cant_make_it', eta: '', sure: true, quote: "I don't think I can do it this early before four", why: 'x' }
let rd = await LW.readLate(start, [{ at: start + 6 * 60e3, body: call }])
const sys = String(AI[0]?.system || ''), userTxt = String(AI[0]?.messages?.[0]?.content || '')
ck('the reader uses the call reader\'s model (not the small one)', AI[0]?.model === 'claude-sonnet-5-5' && AI[0]?.model === LW.LATE_MODEL, AI[0]?.model)
ck('the reader is told retelling an earlier talk, being on the way or driving, and clock-in trouble are never a call-off',
  /retelling an earlier conversation/.test(sys) && /"I said\.\.\."/.test(sys) && /on the way, driving, already there/.test(sys) && /asking to be clocked in/.test(sys) && /read the whole call/.test(sys), sys.slice(0, 400))
ck('the whole call goes to the reader, not the first 2,500 characters (her words were at the end)', userTxt.includes("I said, I'm already driving") && call.length > 2500, userTxt.length)
ck('a real quote of theirs keeps a sure "can\'t make it" sure', rd.kind === 'cant_make_it' && rd.sure === true && /four/.test(rd.quote) && rd.why === 'x', rd)
AI = []; AI_ANSWER = { kind: 'cant_make_it', eta: '', sure: true, quote: 'I am not coming today' }
rd = await LW.readLate(start, [{ at: start, body: 'running a bit behind, be there soon' }])
ck('a "can\'t make it" with no words of theirs to show for it is never sure', rd.kind === 'cant_make_it' && rd.sure === false && rd.quote === null, rd)
AI_ANSWER = { kind: 'other', eta: '', sure: true, quote: '' }
rd = await LW.readLate(start, [{ at: start, body: call }]); ck('"other" stays other', rd.kind === 'other' && rd.quote === null, rd)

/* ── 2 · the hold ── */
const byText = { kind: 'cant_make_it', sure: true, source: 'text', said: [{ channel: 'text', text: "can't make it, sick" }] }
const byCall = { kind: 'cant_make_it', sure: true, source: 'call', said: [{ channel: 'call', text: call }] }
const mixed = { kind: 'cant_make_it', sure: true, source: 'text', said: [{ channel: 'text', text: 'hi' }, { channel: 'call', text: call }] }
const byPerson = { resolved_at: '2026-10-25T21:09:31Z', resolved_by: 'samantha@mo-care.com', resolved_by_name: 'Samantha', resolved_reason: 'forgot_clock_in', resolved_how: 'admin' }
const byWatcher = { resolved_at: '2026-10-25T21:09:31Z', resolved_how: 'visit_changed' }
ck('a text that says they can\'t come still opens a case (unchanged)', LW.cantCaseHold(byText, null) === null)
ck('Angiel\'s case: a phone call never opens a case by itself; the office person on the call decides', /phone call/.test(LW.cantCaseHold(byCall, null) || ''))
ck('a text plus a call about the same shift: held too (the office was on the phone)', /phone call/.test(LW.cantCaseHold(mixed, null) || ''))
ck('a missed clock-in a PERSON settled holds even a text, and says who and how', /Samantha: forgot clock in/.test(LW.cantCaseHold(byText, byPerson) || ''), LW.cantCaseHold(byText, byPerson))
ck('a missed clock-in the watcher closed by itself (no person) does not count', LW.cantCaseHold(byText, byWatcher) === null)
ck('settled as "she was there" or "no visit" ends the running-late notice; "on her way" does not; the watcher\'s own close does not',
  LW.settledWorking(byPerson) && LW.settledWorking({ ...byPerson, resolved_reason: 'not_happening' }) && !LW.settledWorking({ ...byPerson, resolved_reason: 'on_the_way' }) && !LW.settledWorking(byWatcher) && !LW.settledWorking(null))
ck('late-watch: the hold runs before a case can open, and is recorded on the notice (never silent)',
  /const hold = n\.kind === 'cant_make_it'[^\n]+cantCaseHold\(n, settled\)/.test(lwSrc) && /cant_case_would: 'held: ' \+ hold/.test(lwSrc)
  && lwSrc.indexOf('cantCaseHold(n, settled)') < lwSrc.indexOf('const c = cantComeCase('))
ck('late-watch: only a missed clock-in with a person\'s name on it counts as settled', /l\.resolved_at && l\.resolved_by && l\.resolved_how !== 'coverage_case'/.test(lwSrc))

/* ── 3 · Not a call-in ── */
const NC = await import(path.join(FN, '_shared/not-a-callin.ts'))
reset('done')
let m = await NC.markNotACallin(db, 'cwc_s_109_d_2026_10_25', { name: 'Samantha Troutman', email: 'samantha@mo-care.com' }, 'She was at Patsy\'s and forgot to clock in')
ck('helper on an already-closed case (Angiel\'s): marked, who/when/why kept, not reopened or re-closed', m.outcome === 'marked' && !m.closed && k().status === 'done' && k().not_a_callin === true
  && k().not_a_callin_by === 'Samantha Troutman' && /forgot to clock in/.test(k().not_a_callin_note) && /Not a call-in: marked by Samantha Troutman/.test(k().note), { m, c: k() })
ck('helper: the call-in comes off her attendance (a copy kept on the case); nobody else\'s is touched', m.attendance === 'removed' && !APP.attendance_events.some((e) => e.id === 'att_cov_cwc_s_109_d_2026_10_25')
  && APP.attendance_events.some((e) => e.id === 'att_cov_other') && k().removed_attendance_event?.id === 'att_cov_cwc_s_109_d_2026_10_25', APP.attendance_events)
ck('helper: the HR suggestion built from it is dismissed; the other one stays open', m.hr_dismissed === 1 && HR[0].status === 'dismissed' && HR[1].status === 'open', HR)
ck('helper: the "Confirm: did she call off?" card closes', m.card_closed && APP.ops_items[0].status === 'done' && APP.ops_items[0].closed_by === 'Samantha Troutman', APP.ops_items)
ck('the case now reads "not a call-in" everywhere the old rule is used (no "called off", never on attendance)', NC.takenOffNotCalledIn(k()) === true)
reset('open'); APP.attendance_events[0].action_id = 'act9'
m = await NC.markNotACallin(db, 'cwc_s_109_d_2026_10_25', { name: 'Krystal Land' })
ck('helper on an open case: closed as not a call-in, nobody covering', m.closed && k().status === 'done' && k().resolved_how === 'not_a_callin' && k().covered_by === null && k().confirmed_by === 'Krystal Land', k())
ck('helper: an attendance record a person already acted on is left for them, and says so', m.attendance === 'kept_acted_on' && APP.attendance_events.some((e) => e.id === 'att_cov_cwc_s_109_d_2026_10_25'), m)
ck('helper: a case that isn\'t on file changes nothing', (await NC.markNotACallin(db, 'nope', { name: 'x' })).outcome === 'not_found')

/* the server: callin-alert */
const caSrc = fs.readFileSync(path.join(FN, 'callin-alert/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
const caTmp = path.join(FN, 'callin-alert', '_t1126.ts'); fs.writeFileSync(caTmp, caSrc)
try { await import(caTmp + '?' + Math.random()) } finally { fs.unlinkSync(caTmp) }
const LK = await import(path.join(FN, '_shared/callin-links.ts'))
const link = async (email = 'samantha@mo-care.com') => Object.fromEntries(new URL(await LK.makeLink(SECRET, 'cwc_s_109_d_2026_10_25', email, LK.linkExpiry('2026-10-25'))).searchParams)
const post = async (body, auth) => { const r = await handler(new Request('https://x/f', { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { Authorization: 'Bearer ' + auth } : {}) }, body: JSON.stringify(body) })); return { s: r.status, j: await r.json() } }
reset('done'); let L = await link(); let r
r = await post({ ...L, action: 'view' })
ck('the link on Angiel\'s closed case still opens, and says it is not marked yet', r.s === 200 && r.j.open === false && r.j.calling_off === 'Angiel Falig' && r.j.not_a_callin === null, r)
r = await post({ ...L, action: 'not_callin', note: 'She was there' })
ck('the text link: "Not a call-in" works on a case that is already closed (it used to say "Already closed")', r.s === 200 && r.j.ok && r.j.outcome === 'marked' && r.j.attendance === 'removed' && k().not_a_callin === true && k().not_a_callin_by === 'Samantha Troutman', r)
ck('...recorded on the activity log, and nobody is texted for a case that was already closed', EVENTS.some((e) => /not a call-in/.test(e.summary)) && SENT.length === 0, { EVENTS, SENT })
r = await post({ ...L, action: 'view' }); ck('...and the page then shows who marked it', r.j.not_a_callin?.by === 'Samantha Troutman', r.j)
reset('open'); L = await link('krystal@mo-care.com')
r = await post({ ...L, action: 'not_callin' })
ck('the text link on an open case: closes it as not a call-in; the other admin who got the call-in text hears it', r.j.ok && r.j.closed && k().resolved_how === 'not_a_callin' && r.j.others_told === 1
  && SENT.length === 1 && /not a call-in, Angiel did not call off/.test(SENT[0].msg), { r, SENT })
reset('done')
r = await post({ case_id: 'cwc_s_109_d_2026_10_25', action: 'not_callin' }, 'forged')
ck('the board\'s signed-in path: a bad sign-in is refused and nothing changes', r.s === 401 && !k().not_a_callin, r)
r = await post({ case_id: 'cwc_s_109_d_2026_10_25', action: 'not_callin' })
ck('the board\'s path with no sign-in at all falls to the link check and is refused', r.s === 401 && !k().not_a_callin, r)
AUTH_USER = { id: 'u1', email: 'samantha@mo-care.com', app_metadata: {} }
r = await post({ case_id: 'cwc_s_109_d_2026_10_25', action: 'not_callin', note: 'from the board' }, 'good-jwt')
ck('the board\'s signed-in path: an office person marks it (the name comes from their staff record, never the request)', r.s === 200 && r.j.outcome === 'marked' && k().not_a_callin_by === 'Samantha Troutman' && k().not_a_callin_by_email === 'samantha@mo-care.com', r)
r = await post({ case_id: 'cwc_s_109_d_2026_10_25', action: 'close', how: 'uncovered' }, 'good-jwt')
ck('a sign-in only opens "Not a call-in", never the other link actions', r.s === 401, r)

/* the pages */
const HUB = process.env.HUB_ROOT || path.join(ROOT, '../hub')
if (fs.existsSync(path.join(HUB, 'callin.html'))) {
  const ci = fs.readFileSync(path.join(HUB, 'callin.html'), 'utf8'), ix = fs.readFileSync(path.join(HUB, 'index.html'), 'utf8')
  ck('the text-link page has a "Not a call-in" button, shown open OR closed, never for a shift taken off in AxisCare', /id="bNotCallin"/.test(ci) && /if\(D\.calling_off&&!D\.not_a_callin&&!D\.taken_off\)/.test(ci) && /act\('not_callin'/.test(ci))
  ck('the board has "Not a call-in" on open and closed cases, sent signed in to callin-alert', (ix.match(/covNotCallin\(\\''\+esc\(c\.id\)\+'\\'\)">Not a call-in</g) || []).length === 2 && /functions\/v1\/callin-alert`/.test(ix) && /action:'not_callin', case_id:id/.test(ix))
  ck('no em dashes in the new page wording', !/—/.test(ci.slice(ci.indexOf('NOT A CALL-IN'), ci.indexOf('NOT A CALL-IN') + 900)) && !/—/.test(ix.slice(ix.indexOf('async function covNotCallin'), ix.indexOf('async function covFlagDismiss'))))
} else ck('the Hub checkout is here for the page checks (set HUB_ROOT)', false, HUB)
const nc = fs.readFileSync(path.join(FN, '_shared/not-a-callin.ts'), 'utf8'), lwNew = lwSrc.slice(lwSrc.indexOf('/* THE READER'), lwSrc.indexOf('export async function readLate'))
ck('no em dashes in the new server wording', !/—/.test(nc.slice(nc.indexOf('"NOT A CALL-IN"'))) && !/—/.test(lwNew) && !/—/.test(lwSrc.slice(lwSrc.indexOf('WHEN "CAN\'T MAKE IT"'), lwSrc.indexOf('/* ── GoHighLevel, read only'))))

for (const [n, o, d] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n     ' + d))
const pass = res.filter((x) => x[1]).length
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
