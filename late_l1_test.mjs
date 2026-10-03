// Running late · L1 · the job (late-watch), the page (late-alert), the missed clock-in hold and the 6am-9pm family
// hours, against a fake database, fake AxisCare, fake GoHighLevel and a fake AI.   node late_l1_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1400)]);
const FN = 'supabase/functions'
const MIN = 60e3, H = 60 * MIN
let HOUR = 10
const realTLS = Date.prototype.toLocaleString
Date.prototype.toLocaleString = function (loc, o) { if (HOUR != null && o && o.hour === '2-digit' && !o.minute && o.timeZone === 'America/Chicago') return String(HOUR); return realTLS.call(this, loc, o) }
const hhmm = (t) => realTLS.call(new Date(t), 'en-GB', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false })
const iso = (t) => new Date(t).toISOString()
let NOW, VISITS, MSGS, SENT, APP, T, AI, NEXT, SEQ, AIFAIL, CALLS, TRANSCRIPTS
const reset = () => {
  NOW = Date.now(); SEQ = 1; SENT = []; AI = []; AIFAIL = false; CALLS = []; TRANSCRIPTS = {}
  NEXT = { kind: 'late', eta: 20 }
  APP = { ops_settings: {}, caregivers: [{ first: 'Maria', last: 'Test', phone: '4175550101', axiscare_id: '1', active: true }, { first: 'Joe', last: 'Test', phone: '4175550102', axiscare_id: '2', active: true },
      { first: 'Ann', last: 'Test', phone: '', axiscare_id: '3', active: true }],
    coordinator_staff: [{ email: 'samantha@mo-care.com', name: 'Samantha Owner', phone: '4175559001' }, { email: 'krystal@mo-care.com', name: 'Krystal Office', phone: '4175559002' }],
    ops_items: [], coverage_cases: [], late_watch_state: [], automation_heartbeats: [] }
  T = { late_notices: [], phone_index: [], contact_optout_current: [], op_events: [],
    care_circles: [{ id: 'k1', axiscare_client_id: '100', active: true }],
    circle_contacts: [{ circle_id: 'k1', name: 'Linda Daughter', phone: '4175550200', sms_consent: true }, { circle_id: 'k1', name: 'Tom Son', phone: '4175550201', sms_consent: true, stopped_at: '2026-01-01' },
      { circle_id: 'k1', name: 'Sue Niece', phone: '4175550202', sms_consent: false }] }
  VISITS = [V('v1', 1, 100, NOW + 30 * MIN, null), V('v2', 2, 200, NOW + 60 * MIN, null), V('v3', 3, 300, NOW + 40 * MIN, null)]
  MSGS = {}
}
const V = (id, cg, cl, start, clockIn) => ({ id, caregiver: { id: cg, firstName: ['', 'Maria', 'Joe', 'Ann'][cg], lastName: 'Test' }, client: { id: cl, firstName: { 100: 'Ruth', 200: 'Joan', 300: 'Bea' }[cl] || 'X', lastName: 'Y' },
  scheduledStartDate: iso(start), scheduledEndDate: iso(start + 4 * H), clockIn: clockIn ? { time: iso(clockIn) } : null })
const text = (phone, body, at, id) => { (MSGS[phone] ||= []).push({ id: id || 'm' + (SEQ++), direction: 'inbound', messageType: 'TYPE_SMS', body, dateAdded: iso(at) }) }
const visit = (id) => VISITS.find((v) => v.id === id)
/* the fake database */
const q = (t) => { const st = { f: [], inF: [], nn: [], gte: null, lt: null, op: null, val: null, sel: false }; const b = {
  select() { st.sel = true; return b }, order() { return b }, limit() { return b },
  eq(c, v) { st.f.push([c, v]); return b }, in(c, v) { st.inF.push([c, v]); return b }, not(c, op, v) { if (op === 'is' && v === null) st.nn.push(c); return b },
  gte(c, v) { st.gte = [c, v]; return b }, lt(c, v) { st.lt = [c, v]; return b },
  update(o) { st.op = 'update'; st.val = o; return b }, delete() { st.op = 'delete'; return b },
  insert(o) { st.op = 'insert'; st.val = o; return b },
  rows() { if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]; return k in APP ? [{ key: k, data: APP[k] }] : [] }
    let r = T[t] ?? []; for (const [c, v] of st.f) r = r.filter((x) => String(x[c]) === String(v)); for (const [c, v] of st.inF) r = r.filter((x) => v.includes(x[c]))
    for (const c of st.nn) r = r.filter((x) => x[c] != null)
    if (st.gte) r = r.filter((x) => String(x[st.gte[0]]) >= String(st.gte[1])); if (st.lt) r = r.filter((x) => String(x[st.lt[0]]) < String(st.lt[1])); return r },
  exec() {
    if (st.op === 'insert') { const row = { id: SEQ++, created_at: iso(Date.now()), updated_at: iso(Date.now()), said: [], family: [], admin_rounds: [], would: [], sure: true, ...st.val }; (T[t] ||= []).push(row); return [row] }
    if (st.op === 'update') { for (const x of b.rows()) Object.assign(x, JSON.parse(JSON.stringify(st.val))); return null }
    if (st.op === 'delete') { const kill = new Set(b.rows()); T[t] = (T[t] ?? []).filter((x) => !kill.has(x)); return null }
    return b.rows() },
  maybeSingle() { const r = b.exec(); return Promise.resolve({ data: (Array.isArray(r) ? r[0] : null) ?? null, error: null }) },
  then(ok, bad) { const r = b.exec(); return Promise.resolve({ data: r, error: null }).then(ok, bad) } }; return b }
globalThis.__db = { from: q, rpc: async (fn, a) => {
  if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => x.id === a.item.id); if (i >= 0) arr[i] = a.item; else arr.push(a.item) }
  return { data: null, error: null } }, auth: { getUser: async () => ({ data: { user: null }, error: 'no' }) } }
/* the fake outside world */
globalThis.fetch = async (url, o) => {
  url = String(url); const m = o?.method || 'GET'; const body = o && o.body ? JSON.parse(o.body) : {}; CALLS.push({ m, url })
  if (url.includes('api.anthropic.com')) { AI.push(body.messages[0].content); if (AIFAIL) return new Response('{}', { status: 529 })
    const start = Date.parse(body.messages[0].content.match(/@@(\S+)/)?.[1] || '') // unused
    const a = { kind: NEXT.kind, eta: NEXT.eta == null ? '' : hhmm(NEXT.base + NEXT.eta * MIN), sure: NEXT.sure !== false }
    return new Response(JSON.stringify({ content: [{ text: JSON.stringify(a) }] }), { status: 200 }) }
  if (/axiscare\.com\/api\/visits\?/.test(url)) return new Response(JSON.stringify({ results: { visits: VISITS, nextPage: null } }), { status: 200 })
  if (/axiscare\.com\/api\/visits\//.test(url)) return new Response(JSON.stringify({ results: visit(url.split('/').pop()) || {} }), { status: 200 })
  if (/axiscare\.com\/api\/clients/.test(url)) return new Response(JSON.stringify({ results: { clients: [{ id: 100, homePhone: '4175558000' }] } }), { status: 200 })
  if (url.includes('/contacts/lookup')) return new Response('{}', { status: 404 })
  if (url.includes('/contacts/?')) { const qq = decodeURIComponent(url.match(/query=([^&]+)/)[1]); return new Response(JSON.stringify({ contacts: MSGS[qq] !== undefined || ['4175550101', '4175550102'].includes(qq) ? [{ id: 'c' + qq, phone: '+1' + qq }] : [] }), { status: 200 }) }
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'c' + String(body.phone).replace(/\D/g, '').slice(-10), dnd: false } }), { status: 200 })
  if (url.includes('/conversations/search')) { const cid = decodeURIComponent(url.match(/contactId=([^&]+)/)[1]); return new Response(JSON.stringify({ conversations: MSGS[cid.slice(1)] ? [{ id: 'cv' + cid.slice(1) }] : [] }), { status: 200 }) }
  const tm = url.match(/\/messages\/([^/]+)\/transcription/); if (tm) return new Response(JSON.stringify(TRANSCRIPTS[tm[1]] ? [{ transcript: TRANSCRIPTS[tm[1]] }] : []), { status: TRANSCRIPTS[tm[1]] ? 200 : 404 })
  const cm = url.match(/\/conversations\/cv(\d+)\/messages/); if (cm) { const arr = (MSGS[cm[1]] || []).slice().sort((a, b) => Date.parse(b.dateAdded) - Date.parse(a.dateAdded)); return new Response(JSON.stringify({ messages: { messages: arr, nextPage: false } }), { status: 200 }) }
  if (url.endsWith('/conversations/messages') && m === 'POST') { SENT.push({ to: body.contactId, msg: body.message }); return new Response('{}', { status: 200 }) }
  if (/\/contacts\/[^/]+$/.test(url)) return new Response(JSON.stringify({ contact: { dnd: false } }), { status: 200 })
  return new Response('{}', { status: 200 })
}
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485', ANTHROPIC_API_KEY: 'a',
  HUB_JOB_SECRET: 'x'.repeat(40), LATE_WATCH_PAUSE_MS: '0' }
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { globalThis.__h = h } }
let STAFF = null
fs.writeFileSync(`${FN}/_shared/_job-auth_l1.ts`, "export const jobCaller = async (req, cron = true) => req.headers.get('x-test') === 'owner' ? 'owner' : (cron && req.headers.get('x-test') === 'cron' ? 'cron' : null)\n")
fs.writeFileSync(`${FN}/_shared/_staff-auth_l1.ts`, "export const OFFICE_ROLES = ['owner_admin']\nexport const requireStaff = async () => globalThis.__staff()\nexport const serverSecretOk = () => false\n")
process.on('exit', () => { for (const f of ['_job-auth_l1.ts', '_staff-auth_l1.ts']) try { fs.unlinkSync(`${FN}/_shared/${f}`) } catch { /* */ } })
globalThis.__staff = () => STAFF ?? { ok: false, status: 401, error: 'Sign in first.' }
const load = async (name) => {
  const src = fs.readFileSync(`${FN}/${name}/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/(['"])\.\.\/_shared\/job-auth\.ts\1/, "'../_shared/_job-auth_l1.ts'").replace(/(['"])\.\.\/_shared\/staff-auth\.ts\1/, "'../_shared/_staff-auth_l1.ts'")
  const tmp = path.join(process.cwd(), FN, name, '_t.ts'); fs.writeFileSync(tmp, src)
  try { const M = await import(tmp + '?' + Math.random()); return { M, h: globalThis.__h } } finally { fs.unlinkSync(tmp) }
}
const W = await load('late-watch'), A = await load('late-alert')
const LN = await import(path.join(process.cwd(), FN, '_shared/late-links.ts'))
const HOLD = await import(path.join(process.cwd(), FN, '_shared/late-notice.ts'))
const OUT = await import(path.join(process.cwd(), FN, '_shared/outreach.ts'))
const job = async (qs = '', hdr = { 'x-test': 'cron' }) => { const r = await W.h(new Request('https://x/functions/v1/late-watch' + qs, { method: 'POST', headers: hdr, body: '{}' })); return { s: r.status, j: await r.json() } }
const page = async (body) => { const r = await A.h(new Request('https://x/functions/v1/late-alert', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })); return { s: r.status, j: await r.json() } }
const linkFor = async (id, email = 'samantha@mo-care.com') => { const u = new URL(await LN.makeLink(ENV.HUB_JOB_SECRET, 'ln_' + id, email, LN.linkExpiry(new Date().toISOString().slice(0, 10)))); return Object.fromEntries(u.searchParams) }
const notice = (vid) => T.late_notices.find((x) => x.visit_id === vid)
const toMaria = () => SENT.filter((x) => x.to === 'c4175550101'), toAdmins = () => SENT.filter((x) => /^c417555900/.test(x.to)), toFamily = () => SENT.filter((x) => /^c41755502/.test(x.to))
const live = (x = {}) => Object.assign(APP.ops_settings, { late_watch_live: true, ...x })

/* ── the door ── */
reset(); let r = await job('', {}); ck('no key: refused, nothing read', r.s === 401 && CALLS.length === 0, r)
reset(); r = await job('?l0=1'); ck('the schedule may run the job but not the L0 looks', r.s === 401, r)
reset(); r = await job('?auth_check=1'); ck('the schedule gets in (auth check)', r.s === 200 && r.j.caller === 'cron', r)

/* ── practice ── */
reset(); NEXT = { kind: 'late', eta: 20, base: NOW + 30 * MIN }
text('4175550101', 'running about 20 min late, so sorry', NOW - 5 * MIN)
r = await job(); let n = notice('v1')
ck('practice: the notice is recorded with their words and the time (start + 20)', r.j.ok && n && n.status === 'practice' && n.kind === 'late' && n.said[0].text.includes('20 min late')
  && Math.abs(Date.parse(n.eta) - (NOW + 50 * MIN)) < 61e3 && n.eta_by === 'ai', [r.j, n])
ck('practice: nothing is texted and no card opens', SENT.length === 0 && !APP.ops_items.length, [SENT, APP.ops_items])
ck('practice: what WOULD have gone is listed (caregiver thank-you, admins, family to 1 member)', n.would.some((w) => w.to === 'caregiver' && /We'll plan on you getting to Ruth's around/.test(w.text))
  && n.would.some((w) => w.to === 'admins' && /Running late: Maria Test for Ruth's/.test(w.text) && /Expected about/.test(w.text)) && n.would.some((w) => w.to === 'family' && w.count === 1 && /Maria is running a little late for Ruth's/.test(w.text)), n.would)
ck('the caregiver texts never mention the office', !n.would.filter((w) => w.to === 'caregiver').some((w) => /office/i.test(w.text)), n.would)
const aiCalls = AI.length; r = await job()
ck('a message is read once: the next run asks the AI nothing and lists nothing twice', AI.length === aiCalls && notice('v1').would.length === n.would.length, [AI.length, aiCalls])

/* ── live, texts off ── */
reset(); live(); NEXT = { kind: 'late', eta: 20, base: NOW + 30 * MIN }
text('4175550101', 'running about 20 min late', NOW - 5 * MIN); r = await job(); n = notice('v1')
ck('live, texts off: the notice is open and a "Running late" card opens in Needs Attention; still nothing texted', n.status === 'open' && SENT.length === 0
  && APP.ops_items.some((i) => i.id === 'ops_late_' + n.id && i.kind === 'late_notice' && /Running late: Maria Test for Ruth's/.test(i.title) && /running about 20 min late/.test(i.detail)), [n, APP.ops_items])

/* ── live, caregiver replies on ── */
reset(); live({ late_cg_reply_live: true }); NEXT = { kind: 'late', eta: null, base: NOW + 30 * MIN }
text('4175550101', 'gonna be late sorry', NOW - 5 * MIN); await job(); n = notice('v1')
ck('no time given: ONE question to the caregiver, and no family text is possible', toMaria().length === 1 && /About what time do you think you'll get to Ruth's\?/.test(toMaria()[0].msg) && n.asked_time_at && !n.eta, [SENT, n])
await job(); ck('...asked only once', toMaria().length === 1, SENT)
NEXT = { kind: 'late', eta: 25, base: NOW + 30 * MIN }; text('4175550101', 'like 9:25', NOW - 1 * MIN); await job(); n = notice('v1')
ck('they answer with a time: it is saved and they get one thank-you with it', n.eta && toMaria().length === 2 && /We'll plan on you getting to Ruth's around/.test(toMaria()[1].msg) && n.thanked_at, [SENT, n])
await job(); ck('...thanked only once', toMaria().length === 2, SENT)

/* ── live, admin texts on ── */
reset(); live({ late_admin_live: true }); NEXT = { kind: 'late', eta: 20, base: NOW + 30 * MIN }
text('4175550101', 'running 20 late', NOW - 5 * MIN); await job(); n = notice('v1')
ck('admins: both texted now, each with their own link to the page', toAdmins().length === 2 && toAdmins().every((x) => /cc\.mo-care\.com\/late\.html\?c=ln_\d+&a=[0-9a-f]{16}&e=\d+&t=/.test(x.msg))
  && new Set(toAdmins().map((x) => x.msg.match(/a=([0-9a-f]+)/)[1])).size === 2 && /Maria texted at .*: "running 20 late"/.test(toAdmins()[0].msg), toAdmins())
await job(); ck('...not again within 5 minutes', toAdmins().length === 2, toAdmins().length)
T.late_notices[0].admin_last_at = iso(Date.now() - 6 * MIN); await job()
ck('...again after 5 minutes, "Still not seen"', toAdmins().length === 4 && /^Still not seen\. Running late/.test(toAdmins()[3].msg), toAdmins().map((x) => x.msg))
let L = await linkFor(n.id, 'krystal@mo-care.com'); r = await page({ ...L, action: 'seen' })
ck('Krystal taps Seen on her link: recorded, and Samantha gets "Seen by Krystal"', r.j.ok && notice('v1').seen_by === 'Krystal' && notice('v1').status === 'seen'
  && toAdmins().at(-1).to === 'c4175559001' && /^Seen by Krystal/.test(toAdmins().at(-1).msg), [r, toAdmins().at(-1)])
const before = toAdmins().length; T.late_notices[0].admin_last_at = iso(Date.now() - 20 * MIN); await job()
ck('seen: no more reminders', toAdmins().length === before, toAdmins().length)
visit('v1').clockIn = { time: iso(NOW + 48 * MIN) }; await job(); n = notice('v1')
ck('they clock in: closed, one last text to the admins, card resolved', n.status === 'closed' && n.closed_how === 'clocked_in' && /Maria clocked in at Ruth's at/.test(toAdmins().at(-1).msg)
  && APP.ops_items.find((i) => i.id === 'ops_late_' + n.id).status === 'resolved', [n, toAdmins().at(-1)])

/* ── can't make it ── */
reset(); live({ late_admin_live: true, late_cg_reply_live: true }); NEXT = { kind: 'cant_make_it', eta: null, base: NOW + 60 * MIN }
text('4175550102', "can't make it today, sick", NOW - 5 * MIN); await job(); n = notice('v2')
ck("can't make it: no automatic reply to the caregiver; the admins' text says so, with the link", n.kind === 'cant_make_it' && !SENT.some((x) => x.to === 'c4175550102')
  && toAdmins().length === 2 && /^Can't make it: Joe Test for Joan's .* shift\. .*Tap to see it and open a coverage case:/.test(toAdmins()[0].msg), [n, SENT])
L = await linkFor(n.id); r = await page({ ...L, action: 'coverage' })
const cc = APP.coverage_cases.find((c) => c.id === r.j.coverage_case)
ck('"Open a coverage case" (a tap): the case opens for that visit and the notice closes', r.j.ok && cc && cc.axiscare_visit_id === 'v2' && cc.calling_off === 'Joe Test' && notice('v2').closed_how === 'coverage_case', [r, APP.coverage_cases])

/* ── the page: the family ── */
reset(); live(); NEXT = { kind: 'late', eta: 20, base: NOW + 30 * MIN }
text('4175550101', 'running 20 late', NOW - 5 * MIN); await job(); n = notice('v1'); L = await linkFor(n.id)
r = await page({ ...L, action: 'view' })
ck('view: their words, the time, one family member who can be told (STOP and "no consent" left out), the draft', r.j.ok && r.j.said[0].text === 'running 20 late' && r.j.eta && r.j.family.can === true
  && r.j.family.members === 1 && r.j.family.first_names[0] === 'Linda' && /Maria is running a little late for Ruth's .* visit today and expects to arrive around/.test(r.j.family.draft) && /4175558000$/.test(r.j.client_phone), r.j)
r = await page({ ...L, action: 'family', text: r.j.family.draft })
ck('"Send to the family" (a tap): Linda only, greeted by name; recorded; counts as seen', r.j.ok && r.j.count === 1 && toFamily().length === 1 && toFamily()[0].to === 'c4175550200'
  && /^Hi Linda, A quick update from Caring Companions\. Maria is running a little late/.test(toFamily()[0].msg) && notice('v1').family[0].what === 'late' && notice('v1').seen_at, [r, SENT])
NEXT = { kind: 'late', eta: 35, base: NOW + 30 * MIN }; text('4175550101', 'traffic, more like 35', NOW - 1 * MIN); await job()
r = await page({ ...L, action: 'view' })
ck('a new time from them: the page offers the UPDATE wording', r.j.family.is_update && /now expects to get to Ruth's around/.test(r.j.family.draft), r.j.family)
r = await page({ ...L, action: 'family', text: r.j.family.draft }); ck('...sent as an update', r.j.ok && notice('v1').family.at(-1).what === 'update', notice('v1').family)
r = await page({ ...L, action: 'arrived' }); ck('"arrived" is refused before they clock in', r.s === 409, r)
visit('v1').clockIn = { time: iso(NOW + 62 * MIN) }; await job()
const card = APP.ops_items.find((i) => i.id === 'ops_late_' + n.id)
ck('they clock in after the family was told: the card stays open, "Tell the family: Maria arrived"', card.status === 'open' && /^Tell the family: Maria arrived at Ruth's/.test(card.title), card)
r = await page({ ...L, action: 'arrived' })
ck('"Tell the family she arrived" (a tap): sent to Linda, card resolved', r.j.ok && /^Hi Linda, An update from Caring Companions: Maria has arrived at Ruth's\./.test(toFamily().at(-1).msg)
  && APP.ops_items.find((i) => i.id === 'ops_late_' + n.id).status === 'resolved', [r, toFamily()])
r = await page({ ...L, action: 'arrived' }); ck('...once', r.j.already === true && toFamily().filter((x) => /has arrived/.test(x.msg)).length === 1, r)

/* ── the family is held back ── */
reset(); live(); NEXT = { kind: 'late', eta: 5, base: NOW + 30 * MIN }
text('4175550101', 'few min late', NOW - 5 * MIN); await job(); n = notice('v1'); L = await linkFor(n.id)
r = await page({ ...L, action: 'view' }); ck('under 10 minutes late: the family can\'t be told, and says why', r.j.family.can === false && /under 10 minutes late/.test(r.j.family.why), r.j.family)
r = await page({ ...L, action: 'family', text: 'x' }); ck('...and a forced send is refused', r.s === 409 && !toFamily().length, r)
reset(); NEXT = { kind: 'late', eta: 20, base: NOW + 30 * MIN }; text('4175550101', 'running 20 late', NOW - 5 * MIN); await job(); n = notice('v1'); L = await linkFor(n.id)
r = await page({ ...L, action: 'family', text: 'x' }); ck('practice: the family send is refused', r.s === 409 && /Practice run/.test(r.j.error) && !toFamily().length, r)
r = await page({ ...L, action: 'coverage' }); ck('practice: "open a coverage case" is refused (it would start real coverage texts)', r.s === 409 && !APP.coverage_cases.length, r)
reset(); live(); HOUR = 22; NEXT = { kind: 'late', eta: 20, base: NOW + 30 * MIN }; text('4175550101', 'running 20 late', NOW - 5 * MIN); await job(); n = notice('v1'); L = await linkFor(n.id)
r = await page({ ...L, action: 'family', text: 'A quick update.' }); ck('10pm: the texting door holds the family text (6am to 9pm)', r.s === 409 && !toFamily().length, r); HOUR = 10
reset(); live(); T.circle_contacts = []; NEXT = { kind: 'late', eta: 20, base: NOW + 30 * MIN }; text('4175550101', 'running 20 late', NOW - 5 * MIN); await job(); n = notice('v1'); L = await linkFor(n.id)
r = await page({ ...L, action: 'view' }); ck('nobody agreed to texts: no button, and it says so', r.j.family.can === false && /nobody in the Family Circle has agreed/.test(r.j.family.why), r.j.family)

/* ── which shift, and the AI failing ── */
reset(); live(); VISITS = [V('v1', 1, 100, NOW + 30 * MIN, null), V('v4', 1, 400, NOW + 70 * MIN, null)]; NEXT = { kind: 'late', eta: 20, base: NOW + 30 * MIN }
text('4175550101', 'running late', NOW - 5 * MIN); await job(); n = notice('v1')
ck('a message inside two shifts\' windows: the nearer shift, marked unsure (the family can\'t be told)', n && n.sure === false && !notice('v4') && HOLD.familyEligible(n).ok === false, n)
reset(); live(); AIFAIL = true; text('4175550101', 'running late', NOW - 5 * MIN); await job()
ck('the AI unavailable: nothing is recorded, and the message is read again next run', !T.late_notices.length && !(APP.late_watch_state[0]?.read || {})['m1'], APP.late_watch_state)
AIFAIL = false; NEXT = { kind: 'late', eta: 20, base: NOW + 30 * MIN }; await job(); ck('...and is, next run', !!notice('v1'), T.late_notices)
reset(); live(); NEXT = { kind: 'other', eta: null, base: NOW }; text('4175550101', 'what is the door code again?', NOW - 5 * MIN); await job()
ck('something else ("door code?"): no notice', !T.late_notices.length, T.late_notices)
reset(); live(); NEXT = { kind: 'late', eta: 20, base: NOW + 30 * MIN }
MSGS['4175550101'] = [{ id: 'call1', direction: 'inbound', messageType: 'TYPE_CALL', dateAdded: iso(NOW - 5 * MIN) }]; TRANSCRIPTS.call1 = "hi it's Maria, I'm running about twenty minutes late"
await job(); n = notice('v1'); ck('a call with a transcript is read like a text (marked as a call)', n && n.said[0].channel === 'call' && /twenty minutes late/.test(n.said[0].text) && AI.at(-1).includes('(phone call)'), [n, AI.at(-1)])
reset(); live(); MSGS['4175550101'] = [{ id: 'call2', direction: 'inbound', messageType: 'TYPE_CALL', dateAdded: iso(NOW - 5 * MIN) }]; await job()
ck('a call with no transcript: nothing to read, nothing recorded', !T.late_notices.length && AI.length === 0, AI)
reset(); live(); text('4175550101', 'running late', NOW - 3 * H); await job(); ck('a text from before the 2-hour window is not theirs for this shift', !T.late_notices.length && AI.length === 0, AI)

/* ── the door to the page ── */
reset(); live(); NEXT = { kind: 'late', eta: 20, base: NOW + 30 * MIN }; text('4175550101', 'running 20 late', NOW - 5 * MIN); await job(); n = notice('v1'); L = await linkFor(n.id)
r = await page({ ...L, t: L.t.slice(0, -2) + 'AA', action: 'view' }); ck('a forged link: refused', r.s === 401, r)
r = await page({ ...L, c: 'ln_' + (n.id + 1), action: 'view' }); ck('a link for another notice: refused', r.s === 401, r)
r = await page({ c: 'tk_' + n.id, a: L.a, e: L.e, t: L.t, action: 'view' }); ck('a missed clock-in link shape: refused', r.s === 401, r)
APP.coordinator_staff = APP.coordinator_staff.slice(1); APP.ops_settings.coverage_alert_admins = ['krystal@mo-care.com']
r = await page({ ...L, action: 'view' }); ck('an admin taken off the alert list: refused', r.s === 403, r)
r = await page({ id: n.id, action: 'view' }); ck('no link and not signed in: refused', r.s === 401, r)
STAFF = { ok: true, name: 'Krystal Office', email: 'krystal@mo-care.com', roles: ['owner_admin'] }
const startHour = Number(hhmm(NOW + 30 * MIN).slice(0, 2)); const far = startHour >= 3 ? '00:00' : '23:59'
r = await page({ id: n.id, action: 'eta', hhmm: far }); const r2 = await page({ id: n.id, action: 'eta', hhmm: '25:61' })
ck('signed-in staff: a time far from the shift, or not a time, is refused', r.s === 400 && r2.s === 400, [r, r2])
const hm = hhmm(NOW + 45 * MIN); r = await page({ id: n.id, action: 'eta', hhmm: hm })
ck('signed-in staff set the time: saved as theirs, counts as seen', r.j.ok && notice('v1').eta_by === 'Krystal' && notice('v1').seen_at, [r, notice('v1')])
NEXT = { kind: 'late', eta: 20, base: NOW + 30 * MIN }; await job()
ck('the job doesn\'t overwrite a person\'s time with the AI\'s old reading', notice('v1').eta_by === 'Krystal', notice('v1'))
STAFF = null

/* ── the missed clock-in hold ── */
const S = NOW
ck('hold: late with a time holds until 5 minutes after it, then lets the missed clock-in go', HOLD.lateHold({ kind: 'late', status: 'open', eta: iso(S + 20 * MIN) }, S, S + 24 * MIN) === 'hold'
  && HOLD.lateHold({ kind: 'late', status: 'open', eta: iso(S + 20 * MIN) }, S, S + 26 * MIN) === 'none')
ck('hold: no time holds until 20 minutes past the start', HOLD.lateHold({ kind: 'late', status: 'seen', eta: null }, S, S + 19 * MIN) === 'hold' && HOLD.lateHold({ kind: 'late', status: 'seen', eta: null }, S, S + 21 * MIN) === 'none')
ck("hold: can't make it skips the missed clock-in; practice and closed notices change nothing", HOLD.lateHold({ kind: 'cant_make_it', status: 'open' }, S, S) === 'skip'
  && HOLD.lateHold({ kind: 'late', status: 'practice', eta: iso(S + 60 * MIN) }, S, S + MIN) === 'none' && HOLD.lateHold({ kind: 'late', status: 'closed', eta: iso(S + 60 * MIN) }, S, S + MIN) === 'none' && HOLD.lateHold(null, S, S) === 'none')

/* ── 425 · office quiet hours (2026-10-03): no admin text 8pm to 7am; the card is kept; from 7am one round ── */
reset(); live({ late_admin_live: true, late_cg_reply_live: true }); HOUR = 3; NEXT = { kind: 'late', eta: 20, base: NOW + 30 * MIN }
text('4175550101', 'running 20 late', NOW - 5 * MIN); let jq = await job(); n = notice('v1')
ck('425 · 3am: no admin text; the caregiver still gets her thank-you; the Needs Attention card is up; the run says why',
  toAdmins().length === 0 && toMaria().length === 1 && APP.ops_items.some((i) => i.id === 'ops_late_' + n.id) && jq.j.admin_held_quiet >= 1 && jq.j.office_quiet === '8pm to 7am',
  { admins: toAdmins(), maria: toMaria(), j: jq.j })
HOUR = 5; T.late_notices[0].admin_last_at = undefined; await job()
ck('425 · 5am: still nothing, and no admin rounds recorded (nothing queued)', toAdmins().length === 0 && !(notice('v1').admin_rounds || []).length, notice('v1').admin_rounds)
HOUR = 7; await job()
ck('425 · 7am: one text to each admin (not a backlog)', toAdmins().length === 2, toAdmins())
await job(); ck('425 · 7am: not again within 5 minutes', toAdmins().length === 2, toAdmins().length)
HOUR = 23; L = await linkFor(n.id, 'krystal@mo-care.com'); r = await page({ ...L, action: 'seen' })
ck('425 · 11pm: Krystal taps Seen; Samantha is not texted "Seen by Krystal" at night', r.j?.ok && notice('v1').seen_by === 'Krystal' && toAdmins().length === 2, [r.j, toAdmins()])
HOUR = 10

/* ── the family hours ── */
const at = (h) => { HOUR = h; const v = OUT.maySend('timely_external'); return v.allowed }
ck('family hours: 5am no, 6am yes, 8pm yes, 9pm no', !at(5) && at(6) && at(20) && !at(21)); HOUR = 10
ck('the register names both senders, and the page is timely_external', OUT.SENDER_REGISTER['late-watch']?.class === 'urgent_internal' && OUT.SENDER_REGISTER['late-alert']?.class === 'timely_external')
ck('the family audience needs a person\'s tap', OUT.audienceGate('family', {}).allowed === false && OUT.audienceGate('family', { humanInitiated: true }).allowed === true)
ck('no em dashes in any wording', ![HOLD.DEFAULT_THANKS, HOLD.DEFAULT_ASK, HOLD.DEFAULT_FAMILY, HOLD.DEFAULT_FAMILY_UPDATE, HOLD.DEFAULT_ARRIVED].some((t) => /—/.test(t)))

for (const [nm, ok, note] of res) console.log((ok ? 'PASS' : 'FAIL') + ' · ' + nm + (ok ? '' : '\n       ' + note))
const pass = res.filter((x) => x[1]).length; console.log(`${pass}/${res.length}`); process.exit(pass === res.length ? 0 : 1)
