// CI2 · the call-in page's server (callin-alert) against a stand-in database, fake GoHighLevel / AxisCare / the
// board's engine, and the call bridge stubbed (it has its own suite). Plus the shared link and wording helpers.
// node callin_test.mjs
import fs from 'fs'; import path from 'path';
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? '').slice(0, 900)])
const SECRET = 's'.repeat(48)
let APP, SENT, ENGINE, BRIDGE, AXV, EVENTS, PLAN
const reset = () => {
  APP = { ops_settings: { coverage_send_live: true, coverage_alert_admins: ['samantha@mo-care.com', 'krystal@mo-care.com', 'zach@mo-care.com'] },
    coordinator_staff: [{ email: 'samantha@mo-care.com', name: 'Samantha Owner', phone: '4175559001' }, { email: 'krystal@mo-care.com', name: 'Krystal Office', phone: '4175559002' },
      { email: 'zach@mo-care.com', name: 'Zach Boss', phone: '4175559003' }],
    caregivers: [{ first: 'Maria', last: 'Test', phone: '4175550111', axiscare_id: '11' }],
    coverage_cases: [{ id: 'cph_abc123', status: 'open', client: 'Ruth Adams', client_axiscare_id: '501', axiscare_visit_id: '900', shift_date: '2026-10-07', shift_time: '09:00-13:00',
      calling_off: 'Maria Test', calling_off_id: '11', opened_at: '2026-10-07T11:12:00Z', admin_links: ['samantha@mo-care.com', 'krystal@mo-care.com'],
      asked: [{ id: 'a1', name: 'Joe Smith', phone: '4175550201', axiscare_id: '22', state: 'yes', at: '2026-10-07T11:20:00Z', replied_at: '2026-10-07T11:31:00Z', reply: 'yes I can' },
              { id: 'a2', name: 'Ann Lee', phone: '4175550202', axiscare_id: '33', state: 'yes', at: '2026-10-07T11:20:00Z', replied_at: '2026-10-07T11:40:00Z' },
              { id: 'a3', name: 'Bo Gray', phone: '', state: 'waiting', at: '2026-10-07T11:20:00Z' }] }] }
  SENT = []; ENGINE = []; BRIDGE = []; EVENTS = []; PLAN = null
  AXV = { 900: { id: 900, caregiver: { id: 11 } } }
}
const db = { rpc: async (n, a) => {
    if (n === 'coverage_case_patch') { const arr = APP.coverage_cases; const i = arr.findIndex((c) => c.id === a.p_id); if (i < 0) return { data: { outcome: 'not_found' }, error: null }
      for (const [k, v] of Object.entries(a.p_expect || {})) if ((arr[i][k] ?? null) !== v) return { data: { outcome: 'conflict', item: arr[i] }, error: null }
      arr[i] = { ...arr[i], ...a.p_patch }; return { data: { outcome: 'ok', item: arr[i] }, error: null } }
    return { data: { outcome: 'recorded' }, error: null } },
  from: (t) => { const f = []; const p = { select() { return p }, eq(k, v) { f.push([k, v]); return p }, maybeSingle() { return p }, limit() { return p }, order() { return p }, gte() { return p },
    insert(r) { if (t === 'op_events') EVENTS.push(r); return Promise.resolve({ error: null }) },
    then(ok, bad) { const key = (f.find((x) => x[0] === 'key') || [])[1]
      const data = t === 'app_data' ? (key in APP ? { data: APP[key] } : null) : (t === 'phone_index' || t === 'contact_optout_current' || t === 'circle_contacts' ? [] : null)
      return Promise.resolve({ data, error: null }).then(ok, bad) } }; return p } }
globalThis.__db = db
globalThis.fetch = async (u, o = {}) => { const url = String(u), m = (o.method || 'GET').toUpperCase(); const body = o.body ? JSON.parse(o.body) : {}
  const R = (s, b) => new Response(JSON.stringify(b), { status: s })
  if (url.includes('/functions/v1/coverage-run')) { ENGINE.push({ body, auth: (o.headers || {}).Authorization })
    if (body.action === 'candidates') return R(200, { group0: [], prn_other: [], group1: [{ name: 'Cy Dale', why: '3 visits with this client', city: 'Ozark', miles: 9 }], group2: [{ name: 'Di Fox', working_then: { detail: 'Tue 9am-1pm with Bea' } }] })
    if (body.action === 'send_selected') return R(200, { sent: body.recipients, failed: [], already_asked: [], refused_not_eligible: [] }) }
  if (url.includes('/contacts/upsert')) return R(200, { contact: { id: 'c' + String(body.phone || '').replace(/\D/g, '').slice(-10), dnd: false } })
  if (url.endsWith('/conversations/messages') && m === 'POST') { SENT.push({ to: body.contactId, msg: body.message }); return R(200, {}) }
  if (/\/contacts\/[^/]+$/.test(url)) return R(200, { contact: { dnd: false } })
  const vm = url.match(/axiscare\.com\/api\/visits\/(\d+)$/)
  if (vm && m === 'GET') return R(200, { results: { visit: AXV[vm[1]] } })
  if (vm && m === 'PATCH') { AXV[vm[1]].caregiver = { id: body.caregiverId }; return R(200, { success: true }) }
  if (url.includes('axiscare.com/api/clients')) return R(200, { results: { clients: [{ id: 501, homePhone: '4175558000' }] } })
  return R(404, {}) }
const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc-key', HUB_JOB_SECRET: SECRET, GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485' }
let handler; globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h } }
fs.writeFileSync(path.join(FN, '_shared/_bridge_ci2.ts'), "export const ghlCallBridge = async (db, ghl, st, caller, who) => { globalThis.__bridge.push({ caller, who }); return { ok: true, ringing: 'you', name: who.label } }\n")
fs.writeFileSync(path.join(FN, '_shared/_plan_ci2.ts'), "export const readPlan = async () => ({ plan: globalThis.__plan() }); export const isMustCover = (p) => p?.coverage_need === 'must_cover'\n")
process.on('exit', () => { for (const f of ['_bridge_ci2.ts', '_plan_ci2.ts']) try { fs.unlinkSync(path.join(FN, '_shared', f)) } catch { /* */ } })
globalThis.__bridge = { push: (x) => BRIDGE.push(x) }; globalThis.__plan = () => PLAN
const src = fs.readFileSync(path.join(FN, 'callin-alert/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace("'../_shared/ghl-call-bridge.ts'", "'../_shared/_bridge_ci2.ts'").replace("'../_shared/callin-plan.ts'", "'../_shared/_plan_ci2.ts'")
const tmp = path.join(FN, 'callin-alert/_t.ts'); fs.writeFileSync(tmp, src); try { await import(tmp) } finally { fs.unlinkSync(tmp) }
const LK = await import(path.join(FN, '_shared/callin-links.ts'))
const NT = await import(path.join(FN, '_shared/callin-notify.ts'))
const link = async (email = 'krystal@mo-care.com', id = 'cph_abc123') => Object.fromEntries(new URL(await LK.makeLink(SECRET, id, email, LK.linkExpiry('2026-10-07'))).searchParams)
const post = async (body, method = 'POST') => { const r = await handler(new Request('https://x/f', { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined })); return { s: r.status, j: await r.json() } }
const k = () => APP.coverage_cases[0]
const toAdmin = (n) => SENT.filter((x) => x.to === 'c417555900' + n)

/* the door */
reset(); let L = await link(); let r
r = await post({ ...L, t: L.t.slice(0, -2) + 'AA', action: 'view' }); ck('a forged link: refused before anything is read', r.s === 401, r)
r = await post({ ...L, c: 'cph_other', action: 'view' }); ck('a link for another call-in: refused', r.s === 401, r)
r = await post({ c: 'cph_abc123', a: L.a, e: 1000, t: L.t, action: 'view' }); ck('an expired link: refused', r.s === 401, r)
const lateLinks = await import(path.join(FN, '_shared/late-links.ts'))
const LL = Object.fromEntries(new URL(await lateLinks.makeLink(SECRET, 'ln_5', 'krystal@mo-care.com', 9999999999)).searchParams)
r = await post({ ...LL, c: 'cph_abc123', action: 'view' }); ck('a running-late link can\'t open the call-in page (its own purpose label)', r.s === 401, r)
APP.ops_settings.coverage_alert_admins = ['samantha@mo-care.com']; r = await post({ ...L, action: 'view' }); ck('an admin taken off the call-in list: refused', r.s === 403, r)
reset(); r = await post({}, 'GET'); ck('a GET (a link preview) changes nothing', r.s === 405)

/* view */
reset(); PLAN = { coverage_need: 'must_cover' }; r = await post({ ...L, action: 'view' })
ck('view: the shift, who called off, MUST BE COVERED, who said yes, who was asked; no phone numbers on the page', r.j.ok && r.j.open && r.j.must_cover && r.j.calling_off === 'Maria Test'
  && r.j.yes.map((y) => y.name).join() === 'Joe Smith,Ann Lee' && r.j.asked.length === 3 && r.j.asked[2].can_call === false && r.j.can_call.caller && r.j.can_call.client
  && !/4175550|4175558/.test(JSON.stringify(r.j)) && /Ruth Adams Wed, Oct 7 9am-1pm/.test(r.j.what), r.j)

/* I've got it */
reset(); r = await post({ ...L, action: 'claim' })
ck('"I\'ve got it": the case shows Krystal; Samantha (who got the call-in text) hears it, Zach (who didn\'t) doesn\'t, Krystal isn\'t texted', k().claimed_by === 'krystal@mo-care.com' && k().claimed_by_name === 'Krystal'
  && toAdmin(1).length === 1 && /^Krystal has the call-in for Ruth Adams Wed, Oct 7 9am-1pm\.$/.test(toAdmin(1)[0].msg) && !toAdmin(3).length && !toAdmin(2).length, [k(), SENT])
const LS = await link('samantha@mo-care.com'); r = await post({ ...LS, action: 'claim' })
ck('someone else taps it: told Krystal has it, nothing changes', r.j.claimed_by_other && r.j.claimed_by_other.by === 'Krystal' && k().claimed_by === 'krystal@mo-care.com', r.j)
r = await post({ ...LS, action: 'claim', take_over: true })
ck('"Take it over": Samantha has it, Krystal hears it', k().claimed_by === 'samantha@mo-care.com' && /Samantha has the call-in .* \(taking it over from Krystal\)/.test(toAdmin(2).at(-1).msg), [k(), SENT])

/* confirm */
reset(); r = await post({ ...L, action: 'confirm', covered_by: 'Somebody Else' }); ck('confirm someone not on the list: refused', r.s === 400 && k().status === 'open', r)
r = await post({ ...L, action: 'confirm', covered_by: 'Joe Smith', not_chosen: { silent: true } })
ck('confirm Joe: filled (one winner, server side), AxisCare updated (the visit was Maria\'s), Ann told nothing (her choice)', r.j.filled && r.j.filled.covered_by === 'Joe Smith' && k().status === 'done'
  && k().covered_by === 'Joe Smith' && k().confirmed_by === 'Krystal Office' && AXV[900].caregiver.id === 22 && k().not_chosen_silent === true, [r.j, k()])
ck('"Filled by Krystal" goes to Samantha (alerted), not Zach (never alerted), not Krystal', toAdmin(1).length === 1 && /^Filled by Krystal: Joe Smith covers Ruth Adams Wed, Oct 7 9am-1pm\. No more texts/.test(toAdmin(1)[0].msg)
  && !toAdmin(2).length && !toAdmin(3).length, SENT)
ck('it is recorded who did it, from the link', EVENTS.some((e) => e.verb === 'coverage_closed' && e.actor_email === 'krystal@mo-care.com' && /from the call-in link/.test(e.summary)), EVENTS)
r = await post({ ...LS, action: 'confirm', covered_by: 'Ann Lee' }); ck('a second confirm (Samantha picks Ann): "already", nothing changes', r.j.already && r.j.already.covered_by === 'Joe Smith' && k().covered_by === 'Joe Smith', r.j)
r = await post({ ...LS, action: 'claim' }); ck('a filled call-in can\'t be claimed', r.j.already && !k().claimed_by, r.j)
reset(); r = await post({ ...L, action: 'confirm', covered_by: 'Joe Smith', not_chosen: { msg: 'Thank you {first_name}!' } })
ck('her own words for the others are kept', k().not_chosen_msg === 'Thank you {first_name}!', k())

/* close */
reset(); r = await post({ ...L, action: 'close', how: 'nonsense' }); ck('close: an unknown way is refused', r.s === 400 && k().status === 'open', r)
r = await post({ ...L, action: 'close', how: 'client_cancelled', note: 'family called' })
ck('close "client cancelled": closed, the note kept, Samantha told', k().status === 'done' && k().resolved_how === 'client_cancelled' && k().close_note === 'family called'
  && /^Krystal closed the call-in for Ruth Adams .*: the client cancelled\./.test(toAdmin(1).at(-1).msg), [k(), SENT])

/* ask more */
reset(); r = await post({ ...L, action: 'candidates' })
ck('the list comes from the board\'s own engine (server key, server to server), with why, town and "working then"', ENGINE[0].body.action === 'candidates' && ENGINE[0].body.case_id === 'cph_abc123' && ENGINE[0].auth === 'Bearer svc-key'
  && r.j.groups[0].people[0].name === 'Cy Dale' && r.j.groups[0].people[0].town === 'Ozark' && r.j.groups[1].people[0].working_then === 'Tue 9am-1pm with Bea', r.j)
r = await post({ ...L, action: 'ask', recipients: [] }); ck('ask with nobody ticked: refused', r.s === 400, r)
r = await post({ ...L, action: 'ask', recipients: ['Cy Dale'] })
ck('ask: the board\'s own send (its rules), with who asked', ENGINE.at(-1).body.action === 'send_selected' && ENGINE.at(-1).body.recipients[0] === 'Cy Dale' && ENGINE.at(-1).body.asked_by === 'Krystal Office' && r.j.sent[0] === 'Cy Dale', ENGINE.at(-1))

/* call */
reset(); r = await post({ ...L, action: 'bridge', target: 'a1' })
ck('Call Joe: rings Krystal\'s phone first, to Joe\'s number on the ask', BRIDGE[0].caller.email === 'krystal@mo-care.com' && /4175550201$/.test(BRIDGE[0].who.phone) && r.j.ok, BRIDGE)
r = await post({ ...L, action: 'bridge', target: 'caller' }); ck('Call Maria (who called off): her roster number', /4175550111$/.test(BRIDGE.at(-1).who.phone))
r = await post({ ...L, action: 'bridge', target: 'client' }); ck('Call Ruth\'s home: AxisCare\'s home number', /4175558000$/.test(BRIDGE.at(-1).who.phone))
r = await post({ ...L, action: 'bridge', target: 'zzz' }); ck('Call someone not on the case: refused', r.s === 400)

/* the shared helpers */
const lk = await NT.callinLink('cph_abc123', 'krystal@mo-care.com', '2026-10-07')
ck('the link: cc.mo-care.com/callin.html, the case id, a code for the admin (never the email), sealed', /^https:\/\/cc\.mo-care\.com\/callin\.html\?c=cph_abc123&a=[0-9a-f]{16}&e=\d+&t=[A-Za-z0-9_-]{43}$/.test(lk) && !/krystal/.test(lk), lk)
ck('a text without {link} gets it at the end; with {link}, in place; no link reads the board', NT.withLink('Hi {link} bye', 'L') === 'Hi L bye' && NT.withLink('Hi', 'L') === 'Hi L' && NT.withLink('Hi', '') === 'Hi cc.mo-care.com')
const cr = fs.readFileSync(path.join(FN, 'coverage-run/index.ts'), 'utf8'), rp = fs.readFileSync(path.join(FN, 'coverage-reply/index.ts'), 'utf8')
const lt = new Function(cr.match(/const linkTemplate = [^\n]+/)[0].replace('const linkTemplate =', 'return').replace('(t: string)', '(t)'))()
ck('coverage-run: a stored wording ending with the board address gets the admin\'s link instead', lt('New call-in: Ruth. Board: cc.mo-care.com') === 'New call-in: Ruth. Board: {link}' && lt('Open https://cc.mo-care.com/#x') === 'Open {link}' && lt('Keep {link} here') === 'Keep {link} here' && lt('No board') === 'No board')
ck('coverage-run: the call-in text, the "nobody yet" text and the "ran out" text each carry the admin\'s own link; who got the call-in text is remembered',
  /message: withLink\(smsMsg, linkA\)/.test(cr) && /withLink\(msgQ, await callinLink\(String\(c\.id\), a\.email, c\.shift_date\)\)/.test(cr) && /withLink\(linkTemplate\(String\(settings\.coverage_msg_escalation/.test(cr) && /rememberAlerted\(sb, String\(c\.id\), textedA\)/.test(cr))
ck('coverage-reply: "said yes" goes to the call-in list, each with their own link, once per admin per call-in', /adminRecipients\(sb, settings\)/.test(rp) && /withLink\(base, await callinLink\(String\(c\.id\), a\.email, c\.shift_date\)\)/.test(rp) && /const key = 'yes:' \+ a\.email/.test(rp) && !/\(settings as any\)\.coverage_alert_phones/.test(rp))

let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '\n     ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
