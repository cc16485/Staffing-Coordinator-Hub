// 808 · the office's buttons for a Caring Companions Oklahoma applicant: Text (and the cancel notice), not hiring / candidate
// pool, no-show. From the Oklahoma number, Oklahoma words, Missouri unchanged. Harness from applicant_text_test.mjs.
// node ok_office_msgs_808_test.mjs
import fs from 'fs'; import path from 'path'; import os from 'os'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 700)])
/* the shared messaging code reads the clock: 10am on a Tuesday unless a test says otherwise */
globalThis.__hour = '10'
const realTLS = Date.prototype.toLocaleString
Date.prototype.toLocaleString = function (loc, o) { if (o && o.hour === '2-digit' && !o.minute) return globalThis.__hour; if (o && o.weekday === 'short' && !o.hour) return 'Tue'; return realTLS.call(this, loc, o) }

/* ── a fake database: eq/lte filters, order, update, insert (select after), rpc ── */
let T, SENT, CARDS, RPC
const ID = '11111111-1111-1111-1111-111111111111'
const reset = (extra = {}) => { SENT = []; CARDS = []; RPC = []
  T = { job_applicants: [{ id: ID, first_name: 'Dana', last_name: 'Doe', phone: '(417) 555-0101', email: 'dana@x.com', sms_consent: true, status: 'new' }],
    interview_bookings: [], applicant_texts: [], contact_optout_current: [], circle_contacts: [], phone_index: [], app_data: [], ...extra } }
let nextId = 1
const q = (t) => { const f = []; let op = 'select', patch = null, rowsIn = null, sel = false
  const match = (r) => f.every(([c, v, k]) => k === 'lte' ? r[c] <= v : k === 'gte' ? r[c] >= v : r[c] === v)
  const b = { select() { sel = true; return b }, eq(c, v) { f.push([c, v]); return b }, lte(c, v) { f.push([c, v, 'lte']); return b }, gte(c, v) { f.push([c, v, 'gte']); return b },
    in() { return b }, or() { return b }, not() { return b }, is() { return b }, ilike() { return b }, limit() { return b }, order() { return b },
    update(p) { op = 'update'; patch = p; return b }, delete() { op = 'delete'; return b },
    insert(r) { op = 'insert'; rowsIn = Array.isArray(r) ? r : [r]; return b },
    maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: x.error })) }, single() { return b.maybeSingle() },
    then(ok, no) { let out
      if (globalThis.__dbFail === t) out = { data: null, error: { message: 'boom' } }
      else if (op === 'update') { const hit = (T[t] || []).filter(match); hit.forEach((r) => Object.assign(r, patch)); out = { data: sel ? hit : null, error: null } }
      else if (op === 'delete') { T[t] = (T[t] || []).filter((r) => !match(r)); out = { data: null, error: null } }
      else if (op === 'insert') { const ins = rowsIn.map((r) => ({ id: nextId++, ...r })); (T[t] ||= []).push(...ins); out = { data: sel ? ins : null, error: null } }
      else out = { data: (T[t] || []).filter(match), error: null }
      return Promise.resolve(out).then(ok, no) } }
  return b }
globalThis.__db = { from: q, rpc: async (fn, a) => { RPC.push([fn, a])
  if (fn === 'upsert_app_data_item') { CARDS.push(a.item); return { data: null, error: null } }
  if (fn === 'interview_cancel') { const live = T.interview_bookings.find((x) => x.applicant_id === a.p_applicant && x.status === 'booked')
    if (!live) return { data: { cancelled: false }, error: null }
    Object.assign(live, { status: 'cancelled', cancelled_at: new Date().toISOString(), cancelled_by: a.p_by, cancel_reason: a.p_reason }); return { data: { cancelled: true, was: live.starts_at }, error: null } }
  return { data: null, error: null } } }
globalThis.__ghlDown = false
globalThis.fetch = async (url, o) => { url = String(url); const body = o?.body ? JSON.parse(o.body) : {}
  if (url.includes('/contacts/search/duplicate')) return new Response('{}', { status: 200 })
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + (body.phone || body.email), dnd: false } }), { status: 200 })
  if (url.includes('/conversations/messages')) { if (globalThis.__ghlDown) return new Response('{"message":"down"}', { status: 503 }); SENT.push(body); return new Response('{}', { status: 200 }) }
  return new Response('{}', { status: 200 }) }
let handler
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc' })[k] ?? '' }, serve: (h) => { handler = h } }
const load = async (rel, edits) => {
  let src = fs.readFileSync(path.join(FN, rel), 'utf8'); for (const [a, b] of edits) { const s = src; src = src.replace(a, b); if (s === src) throw new Error('test setup: no match for ' + a) }
  src = src.replace(/'\.\.\/_shared\//g, "'" + path.join(FN, '_shared') + '/')
  const tmp = path.join(os.tmpdir(), 'at808_' + rel.replace(/\W/g, '') + process.pid + '.ts'); fs.writeFileSync(tmp, src); try { await import(tmp) } finally { fs.unlinkSync(tmp) }
  return handler }

globalThis.__staff = { ok: true, email: 'krystal@mo-care.com', name: 'Krystal Smith' }; globalThis.__hours = { allowed: true, reason: 'ok' }; globalThis.__job = null

const COMMON = [
  [/^import \{ createClient \} from .*$/m, 'const createClient = (..._a: any[]) => (globalThis as any).__db'],
  [/^import \{ contactForOutbound, maySend \} from (.*)$/m, "import { contactForOutbound } from $1\nconst maySend = (..._a: any[]) => (globalThis as any).__hours"],
  [/^import \{ requireStaff, OFFICE_ROLES \} from .*$/m, 'const OFFICE_ROLES: string[] = []; const requireStaff = async (..._a: any[]) => (globalThis as any).__staff'],
]
const JOB = [/^import \{ jobCaller \} from .*$/m, 'const jobCaller = async (..._a: any[]) => (globalThis as any).__job']
const TEXT = await load('applicant-text/index.ts', [...COMMON, JOB])
const DEC = await load('applicant-decision-msg/index.ts', [...COMMON, JOB])
const NOS = await load('applicant-noshow/index.ts', COMMON)
const call = async (F, body) => { const r = await F(new Request('https://x/f', { method: 'POST', body: JSON.stringify(body) })); return [r.status, await r.json()] }
const LINK = 'https://meet.google.com/abc-defg-hij'
const OPS = (o = {}) => [{ key: 'ops_settings', data: { ok_from_number: '+14055001758', ok_interview_link: LINK, ...o } }]
const okRow = (o = {}) => ({ id: ID, first_name: 'Okla', last_name: 'Test', phone: '(405) 555-0101', email: 'okla@x.com', sms_consent: true, status: 'new', office: 'OK', ...o })
const moRow = (o = {}) => ({ id: ID, first_name: 'Dana', last_name: 'Doe', phone: '(417) 555-0101', email: 'dana@x.com', sms_consent: true, status: 'new', ...o })
const bad = (s) => /Springfield|Stewart|mo-care\.com|417|FCSR|Family Care Safety|in-person|—/.test(s)
let s, j

/* ── the Text composer ── */
reset({ job_applicants: [okRow()], app_data: OPS() }); ;[s, j] = await call(TEXT, { action: 'draft', id: ID })
ck('draft for an Oklahoma applicant: says it goes from (405) 500-1758, Oklahoma picks, no FCSR', s === 200 && j.office === 'OK' && j.from === '(405) 500-1758' && !j.fcsr_email
  && !j.picks.some((p) => p.key === 'fcsr') && j.picks.every((p) => !bad(p.text)) && j.picks.some((p) => /\(405\) 500-1758/.test(p.text)), j)
T.interview_bookings.push({ id: 'B1', applicant_id: ID, status: 'booked', starts_at: '2026-10-20T15:00:00.000Z', cancel_notified_at: null })
;[s, j] = await call(TEXT, { action: 'draft', id: ID })
const iv = (j.picks || []).find((p) => p.key === 'interview')
ck('...the interview pick: a video interview with the link', !!iv && /video interview/.test(iv.text) && iv.text.includes(LINK) && !bad(iv.text), iv)
;[s, j] = await call(TEXT, { action: 'send', id: ID, message: 'Hi Okla, this is Krystal from Caring Companions. Could you call us at (405) 500-1758?' })
ck('send: the text goes FROM the Oklahoma number', s === 200 && j.sent && SENT.length === 1 && SENT[0].fromNumber === '+14055001758', [j, SENT])
SENT = []; ;[s, j] = await call(TEXT, { action: 'send', id: ID, message: 'steps', pick: 'fcsr' })
ck('the FCSR pick is refused for Oklahoma', s === 400 && !SENT.length, j)
;[s, j] = await call(TEXT, { action: 'cancel_draft', id: ID })
ck('cancel drafts: video interview, call or text the 405 number, no booking link', s === 200 && !bad(j.drafts.applicant + j.drafts.office) && /\(405\) 500-1758/.test(j.drafts.office) && /video interview/.test(j.drafts.applicant), j)
;[s, j] = await call(TEXT, { action: 'cancel_interview', id: ID, by: 'office', message: j.drafts.office })
const cm = SENT.find((x) => x.type === 'Email')
ck('cancelling: the text from 405 and the email with the Oklahoma footer', SENT.some((x) => x.type === 'SMS' && x.fromNumber === '+14055001758') && cm && /Caring Companions Oklahoma<br>\(405\) 500-1758/.test(cm.html) && !/417/.test(cm.html), SENT)
reset({ job_applicants: [okRow()], app_data: OPS({ ok_from_number: '' }) }); ;[s, j] = await call(TEXT, { action: 'send', id: ID, message: 'hello there' })
ck('no Oklahoma number set: not sent (never from 417), and a card says why', !SENT.length && CARDS.some((c) => /Oklahoma sending number/.test(JSON.stringify(c))) && /not sent/.test(JSON.stringify(j)), [j, CARDS])
reset({ job_applicants: [moRow()], app_data: OPS() }); ;[s, j] = await call(TEXT, { action: 'send', id: ID, message: 'hello there' })
ck('Missouri: from the office line (417) 234-8494 (887)', SENT.length === 1 && SENT[0].fromNumber === '+14172348494', SENT)
;[s, j] = await call(TEXT, { action: 'draft', id: ID })
ck('...and the Missouri draft keeps the FCSR pick', j.picks.some((p) => p.key === 'fcsr') && j.from === null, j)

/* ── not hiring / candidate pool ── */
reset({ job_applicants: [okRow({ status: 'pool', sms_consent: true })], app_data: OPS() }); ;[s, j] = await call(DEC, { action: 'send', id: ID, kind: 'pool' })
ck('candidate pool message to an Oklahoma applicant goes from 405', SENT.length === 1 && SENT[0].type === 'SMS' && SENT[0].fromNumber === '+14055001758', [s, j, SENT])
reset({ job_applicants: [okRow({ status: 'pool', sms_consent: false })], app_data: OPS() }); ;[s, j] = await call(DEC, { action: 'send', id: ID, kind: 'pool' })
ck('...by email (no text consent): the Oklahoma footer, no 417', SENT.length === 1 && SENT[0].type === 'Email' && /Caring Companions Oklahoma<br>\(405\) 500-1758/.test(SENT[0].html) && !/417/.test(SENT[0].html), [s, j, SENT])
reset({ job_applicants: [moRow({ status: 'pool' })], app_data: OPS() }); ;[s, j] = await call(DEC, { action: 'send', id: ID, kind: 'pool' })
ck('...Missouri from the office line (887)', SENT.length === 1 && SENT[0].fromNumber === '+14172348494', SENT)

/* ── no-show ── */
reset({ job_applicants: [okRow({ status: 'reviewing' })], interview_bookings: [], coordinator_busy: [], app_data: OPS() }); ;[s, j] = await call(NOS, { action: 'preview', id: ID })
ck('no-show preview: her words for a video interview, the 405 number, Caring Companions Oklahoma, nothing Missouri', /video interview/.test(j.text) && /\(405\) 500-1758/.test(j.text) && /Caring Companions Oklahoma/.test(j.text) && !bad(j.text)
  && /Missed video interview/.test(j.email.subject) && !/417|in-person/.test(j.email.html), j)
;[s, j] = await call(NOS, { action: 'mark', id: ID })
ck('marking sends from 405', SENT.some((x) => x.type === 'SMS' && x.fromNumber === '+14055001758'), [j, SENT])

let fails = 0
for (const [n, ok, note] of res) { console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note)); if (!ok) fails++ }
console.log(`\n${res.length - fails}/${res.length} passed`)
process.exit(fails ? 1 : 0)
