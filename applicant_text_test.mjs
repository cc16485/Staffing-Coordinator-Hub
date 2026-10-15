// 574 · Text an applicant from the Hub (applicant-text): drafts, sends, holds after hours, releases at 8am, cancels an
// interview with the office's own words. Run for real against a fake database and a fake GoHighLevel.
// node applicant_text_test.mjs
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
  const tmp = path.join(os.tmpdir(), 'at574_' + process.pid + '.ts'); fs.writeFileSync(tmp, src); try { await import(tmp) } finally { fs.unlinkSync(tmp) }
  return handler }

globalThis.__staff = { ok: true, email: 'krystal@mo-care.com', name: 'Krystal Smith' }; globalThis.__hours = { allowed: true, reason: 'ok' }; globalThis.__job = null
const F = await load('applicant-text/index.ts', [
  [/^import \{ createClient \} from .*$/m, 'const createClient = (..._a: any[]) => (globalThis as any).__db'],
  [/^import \{ contactForOutbound, maySend \} from (.*)$/m, "import { contactForOutbound } from $1\nconst maySend = (..._a: any[]) => (globalThis as any).__hours"],
  [/^import \{ requireStaff, OFFICE_ROLES \} from .*$/m, 'const OFFICE_ROLES: string[] = []; const requireStaff = async (..._a: any[]) => (globalThis as any).__staff'],
  [/^import \{ jobCaller \} from .*$/m, 'const jobCaller = async (..._a: any[]) => (globalThis as any).__job'],
])
const call = async (body, qs = '') => { const r = await F(new Request('https://x/f' + qs, { method: 'POST', body: JSON.stringify(body) })); return [r.status, await r.json()] }
const A = () => T.job_applicants[0]
const book = () => { T.interview_bookings.push({ id: 'B1', applicant_id: ID, status: 'booked', starts_at: '2026-10-15T15:00:00.000Z', cancel_notified_at: null }) }

/* ── who may ── */
reset(); globalThis.__staff = { ok: false, status: 401, error: 'Sign in first.' }
let [s, j] = await call({ action: 'send', id: ID, message: 'hello' })
ck('someone not signed in as office staff is refused and nothing goes', s === 401 && SENT.length === 0, [s, j])
;[s, j] = await call({ action: 'draft', id: ID })
ck('...nor can they see the draft', s === 401, [s, j])
;[s, j] = await call({ action: 'release' })
ck('the schedule needs the jobs secret: the public key is refused', s === 401, [s, j])
globalThis.__staff = { ok: true, email: 'krystal@mo-care.com', name: 'Krystal Smith' }

/* ── draft ── */
reset(); [s, j] = await call({ action: 'draft', id: ID })
ck('draft: who they are, we may text them, in hours, the sender first name', s === 200 && j.first === 'Dana' && j.can_text === true && j.in_hours === true && j.me === 'Krystal' && j.waits === null, j)
ck('...her example is the first quick pick, with the names filled in', j.picks[0].key === 'fit' && j.picks[0].text.startsWith('Hi Dana, this is Krystal from Caring Companions. We saw you started an application with us, and we have a client right now who may be a good fit'), j.picks[0])
ck('...the picks: a client who may fit, still interested, please call, we tried to reach you, FCSR registration (2026-10-14), write my own', j.picks.map((p) => p.key).join() === 'fit,interested,call,tried,fcsr,own', j.picks.map((p) => p.key))
ck('...no em dash in any pick', j.picks.every((p) => !/—/.test(p.text)))
ck('...draft sends nothing and writes nothing', SENT.length === 0 && T.applicant_texts.length === 0)
reset(); A().status = 'partial'; book(); [s, j] = await call({ action: 'draft', id: ID })
ck('an unfinished application adds "finish it"; a booked interview adds the interview pick with the day and time', j.picks.some((p) => p.key === 'finish') && j.picks.some((p) => p.key === 'interview' && /Thursday, October 15 at 10:00 AM/.test(p.text)) && j.booked && j.booked.day === 'Thursday, October 15', j.picks.map((p) => p.key + ':' + p.text))
reset(); A().sms_consent = false; [s, j] = await call({ action: 'draft', id: ID })
ck('their latest application said no to texts: the draft says so', j.can_text === false && /did not agree to texts/.test(j.why_not), j)
reset(); A().phone = null; [s, j] = await call({ action: 'draft', id: ID })
ck('no phone: the draft says so', j.can_text === false && /no phone/.test(j.why_not), j)

/* ── send ── */
reset(); [s, j] = await call({ action: 'send', id: ID, message: 'Hi Dana, this is Krystal from Caring Companions. Could you give us a call at 417-234-8494 when you have a moment? Thank you.' })
ck('send (in hours): one text through GoHighLevel, the office words, STOP added', s === 200 && j.sent === true && j.texted === true && SENT.length === 1 && SENT[0].type === 'SMS' && SENT[0].message.endsWith('Thank you. Reply STOP to opt out.'), [j, SENT])
ck('...recorded: sent, by whom, the exact words', T.applicant_texts.length === 1 && T.applicant_texts[0].status === 'sent' && T.applicant_texts[0].created_by === 'Krystal Smith' && T.applicant_texts[0].message === SENT[0].message && T.applicant_texts[0].kind === 'text', T.applicant_texts[0])
reset(); [s, j] = await call({ action: 'send', id: ID, message: ' ' })
ck('an empty message is refused', s === 400 && SENT.length === 0, [s, j])
reset(); A().sms_consent = false; [s, j] = await call({ action: 'send', id: ID, message: 'hello there' })
ck('no yes to texts: refused, says why, nothing recorded as sent', s === 409 && /did not agree to texts/.test(j.error) && SENT.length === 0 && T.applicant_texts.length === 0, [s, j])
reset(); T.contact_optout_current.push({ address: '+14175550101', channel: 'sms', opted_out: true, source: 'STOP' })
;[s, j] = await call({ action: 'send', id: ID, message: 'hello there' })
ck('opted out (universal door): nothing goes, the row says failed and why', SENT.length === 0 && j.sent === false && T.applicant_texts[0].status === 'failed' && /opted out|safe to text/.test(T.applicant_texts[0].error), [j, T.applicant_texts[0]])
reset(); globalThis.__ghlDown = true; [s, j] = await call({ action: 'send', id: ID, message: 'hello there' })
globalThis.__ghlDown = false
ck('GoHighLevel refuses it: not sent, a card is raised, the row says failed (no silent failure)', j.sent === false && CARDS.length >= 1 && T.applicant_texts[0].status === 'failed', [j, CARDS.length])
reset(); [s, j] = await call({ action: 'send', id: ID, message: 'Thanks for getting back to us', kind: 'reply' })
ck('a reply from the thread box is the same send, kept as a reply', j.sent === true && T.applicant_texts[0].kind === 'reply', T.applicant_texts[0])

/* ── after hours: held, then released at 8am ── */
reset(); globalThis.__hours = { allowed: false, reason: 'outside' }
;[s, j] = await call({ action: 'draft', id: ID })
ck('draft after 6pm says the text will wait for 8am', j.in_hours === false && /held and sent at/.test(j.waits) && j.send_after, j)
;[s, j] = await call({ action: 'send', id: ID, message: 'Hi Dana, are you still interested?' })
ck('send after 6pm: held, nothing goes yet, the row waits with its 8am time', j.held === true && SENT.length === 0 && T.applicant_texts[0].status === 'held' && T.applicant_texts[0].send_after > new Date().toISOString(), [j, T.applicant_texts[0]])
const heldId = T.applicant_texts[0].id
globalThis.__job = 'cron'; [s, j] = await call({ action: 'release' })
ck('the schedule outside hours sends nothing', j.released === 0 && SENT.length === 0, j)
globalThis.__hours = { allowed: true, reason: 'ok' }; [s, j] = await call({ action: 'release' })
ck('...still nothing: 8am has not come for that row yet', j.due === 0 && SENT.length === 0, j)
T.applicant_texts[0].send_after = new Date(Date.now() - 1000).toISOString()
;[s, j] = await call({ action: 'release' })
ck('at 8am the schedule sends it: one text, the row is sent', j.released === 1 && SENT.length === 1 && T.applicant_texts[0].status === 'sent' && T.applicant_texts[0].sent_at, [j, T.applicant_texts[0]])
;[s, j] = await call({ action: 'release' })
ck('...and not twice', j.due === 0 && SENT.length === 1, j)
globalThis.__job = null
reset(); globalThis.__hours = { allowed: false, reason: 'outside' }
;[s, j] = await call({ action: 'send', id: ID, message: 'Hi Dana' }); const rid = j.row_id
globalThis.__hours = { allowed: true, reason: 'ok' }
;[s, j] = await call({ action: 'unhold', row_id: rid })
ck('a held text can be taken back before 8am', j.unheld === 1 && T.applicant_texts[0].status === 'cancelled', [j, T.applicant_texts[0]])
globalThis.__job = 'cron'; T.applicant_texts[0].send_after = new Date(Date.now() - 1000).toISOString(); [s, j] = await call({ action: 'release' }); globalThis.__job = null
ck('...and the schedule leaves it alone', SENT.length === 0 && j.due === 0, j)
globalThis.__job = 'cron'; [s, j] = await call({}, '?auth_check=1'); globalThis.__job = null
ck('auth_check only says who is calling', j.ok === true && j.caller === 'cron', j)

/* ── cancel an interview ── */
reset(); book(); [s, j] = await call({ action: 'cancel_draft', id: ID })
ck('cancel draft: both messages, the booked time, the email subject', s === 200 && j.drafts && /is cancelled as you asked/.test(j.drafts.applicant) && /We are sorry, we need to cancel your interview for Thursday, October 15 at 10:00 AM/.test(j.drafts.office) && j.subject === 'Your interview on Thursday, October 15 is cancelled', j)
ck('...both carry the booking link and no em dash', /apply\?book=/.test(j.drafts.applicant) && /apply\?book=/.test(j.drafts.office) && !/—/.test(j.drafts.applicant + j.drafts.office), j.drafts)
ck('...nothing is cancelled by a draft', T.interview_bookings[0].status === 'booked')
reset(); [s, j] = await call({ action: 'cancel_draft', id: ID })
ck('no booking: the cancel draft says so', s === 409, [s, j])

reset(); book(); [s, j] = await call({ action: 'cancel_interview', id: ID, by: 'office', reason: 'coordinator out sick', message: 'Hi Dana, this is Krystal from Caring Companions. We are sorry, we need to cancel your interview for Thursday. Please pick a new time here: https://mo-care.com/apply?book=' + ID + ' or call us at 417-234-8494.' })
ck('we cancel: the booking is cancelled by the office with the reason kept', s === 200 && j.cancelled === true && T.interview_bookings[0].status === 'cancelled' && T.interview_bookings[0].cancelled_by === 'office' && T.interview_bookings[0].cancel_reason === 'coordinator out sick', [j, T.interview_bookings[0]])
ck('...the interview messages job is told it need not send its own notice', !!T.interview_bookings[0].cancel_notified_at)
ck('748: ...and who in the office did it is kept for their interview history', T.interview_bookings[0].office_user === 'Krystal Smith', T.interview_bookings[0])
ck('...the edited words go as a text (STOP added) and as an email (the link clickable, no STOP), one row', j.texted === true && j.emailed === true && SENT.length === 2 && SENT[0].type === 'SMS' && /Reply STOP/.test(SENT[0].message) && SENT[1].type === 'Email' && SENT[1].subject === 'Your interview on Thursday, October 15 is cancelled' && /<a href="https:\/\/mo-care.com\/apply\?book=/.test(SENT[1].html) && !/STOP/.test(SENT[1].html) && T.applicant_texts.length === 1 && T.applicant_texts[0].kind === 'cancel', [j, SENT])
ck('...the reason we wrote is never in the message', !JSON.stringify(SENT).includes('out sick'))
reset(); book(); [s, j] = await call({ action: 'cancel_interview', id: ID, by: 'applicant', message: 'Hi Dana, your interview is cancelled as you asked.' })
ck('they cancel: cancelled_by applicant (their count goes up like a self-serve cancel)', j.cancelled === true && T.interview_bookings[0].cancelled_by === 'applicant' && SENT.length === 2, [j, T.interview_bookings[0]])
reset(); book(); [s, j] = await call({ action: 'cancel_interview', id: ID, by: 'office', send: false })
ck('cancel with no message: cancelled, nothing sent, still marked told', j.cancelled === true && j.sent === false && SENT.length === 0 && T.interview_bookings[0].status === 'cancelled' && !!T.interview_bookings[0].cancel_notified_at, [j, T.interview_bookings[0]])
reset(); book(); [s, j] = await call({ action: 'cancel_interview', id: ID, by: 'office', message: '' })
ck('cancel with an empty message (and send not turned off) is refused before anything changes', s === 400 && T.interview_bookings[0].status === 'booked', [s, j])
reset(); book(); [s, j] = await call({ action: 'cancel_interview', id: ID, by: 'nobody', message: 'x' })
ck('"who is cancelling" must be said', s === 400 && T.interview_bookings[0].status === 'booked', [s, j])
reset(); [s, j] = await call({ action: 'cancel_interview', id: ID, by: 'office', message: 'Hi Dana' })
ck('no live booking: nothing to cancel', s === 409 && SENT.length === 0, [s, j])
reset(); book(); A().sms_consent = false; [s, j] = await call({ action: 'cancel_interview', id: ID, by: 'office', message: 'Hi Dana, we need to cancel.' })
ck('no yes to texts: the cancellation still goes by email', j.cancelled === true && j.texted === false && j.emailed === true && SENT.length === 1 && SENT[0].type === 'Email', [j, SENT])
reset(); book(); A().sms_consent = false; A().email = null; [s, j] = await call({ action: 'cancel_interview', id: ID, by: 'office', message: 'Hi Dana, we need to cancel.' })
ck('no text allowed and no email: cancelled, and it says the message could not go', j.cancelled === true && j.sent === false && SENT.length === 0 && /Call them/.test(j.not_sent.join(' ')), j)
reset(); book(); globalThis.__hours = { allowed: false, reason: 'outside' }
;[s, j] = await call({ action: 'cancel_interview', id: ID, by: 'office', message: 'Hi Dana, we need to cancel your interview.' })
globalThis.__hours = { allowed: true, reason: 'ok' }
ck('cancel after 6pm: cancelled now, the message (text and email) waits for 8am', j.cancelled === true && j.held === true && T.interview_bookings[0].status === 'cancelled' && SENT.length === 0 && T.applicant_texts[0].status === 'held' && T.applicant_texts[0].email === 'dana@x.com' && T.applicant_texts[0].email_subject, [j, T.applicant_texts[0]])
T.applicant_texts[0].send_after = new Date(Date.now() - 1000).toISOString(); globalThis.__job = 'cron'; [s, j] = await call({ action: 'release' }); globalThis.__job = null
ck('...and at 8am both go', j.released === 1 && SENT.length === 2 && SENT[0].type === 'SMS' && SENT[1].type === 'Email', [j, SENT.map((x) => x.type)])

/* ── 2026-10-14 FCSR registration: the quick pick and its email (Samantha "ok great, approved!", 5b wording page
   https://claude.ai/artifact/Gj2NFJSbr2DFVR6m6K7LFf). Word for word as approved; Maria and Krystal there, Dana and Krystal here. ── */
const FCSR_TEXT = 'Hi Dana, this is Krystal from Caring Companions. Next step: please register with the Missouri Family Care Safety Registry (FCSR). You only register once, and after that any employer can run your screening without you registering again. The state fee is $16 (plus $0.57 to pay online). Register here: https://healthapps.dhss.mo.gov/BSEES/Main.aspx You will need your Social Security number, your email and a debit or credit card. We also emailed you the steps. Questions? Call us at (417) 234-8494.'
const FCSR_SUBJ = 'Your next step: register with the Missouri Family Care Safety Registry'
const FCSR_PARAS = ['Hi Dana,', 'Your next step is to register with the Missouri Family Care Safety Registry (FCSR). Missouri requires it for caregivers, and you only do it once. After that, any employer can run your screening without you registering again.',
  'What you need: your Social Security number, your email address, and a debit or credit card. The state fee is $16, plus $0.57 to pay online.',
  'How to register (about 10 minutes, easiest on a computer in Google Chrome):',
  'Go to https://healthapps.dhss.mo.gov/BSEES/Main.aspx and click Registration, then Register Online.',
  'Enter your Social Security number twice and search. If it says you are already registered, you are done. Just let us know.',
  'When it asks for the employer who asked you to register, choose Caring Companions (Troutman Enterprises, LLC).',
  'For the registration type, choose Long Term Care/Personal Care, then Personal Care, In-Home Services.',
  'Enter your information, including any other names you have used, and an email address that is yours.',
  'Accept the agreement, pay the fee, and save your confirmation.',
  'When you are done, reply to this email or text us, and we will request your screening.',
  'Thank you, Krystal Caring Companions In-Home Senior Care (417) 234-8494']
const plain = (h) => h.replace(/<br>/g, ' ').replace(/<\/(p|li)>/g, '\n').replace(/<[^>]+>/g, '').split('\n').map((x) => x.trim()).filter(Boolean)
reset(); [s, j] = await call({ action: 'draft', id: ID })
{ const p = j.picks.find((x) => x.key === 'fcsr')
  ck('FCSR: the quick pick "FCSR registration", her approved words exactly, the office number as (417) 234-8494, no period right after the link', p && p.label === 'FCSR registration' && p.text === FCSR_TEXT && p.email_subject === FCSR_SUBJ && /Main\.aspx You will need/.test(p.text), p)
  ck('FCSR: the draft carries the email (subject and words) for the composer to show; not editable', j.fcsr_email && j.fcsr_email.subject === FCSR_SUBJ && JSON.stringify(plain(j.fcsr_email.html)) === JSON.stringify(FCSR_PARAS), j.fcsr_email && plain(j.fcsr_email.html))
  ck('FCSR: bold "What you need:" and "How to register", a numbered list, the link clickable, the look of the cancellation email, no em dash', /<b>What you need:<\/b>/.test(j.fcsr_email.html) && /<b>How to register<\/b>/.test(j.fcsr_email.html) && (j.fcsr_email.html.match(/<li>/g) || []).length === 6 && /<ol>/.test(j.fcsr_email.html) && /<a href="https:\/\/healthapps\.dhss\.mo\.gov\/BSEES\/Main\.aspx">/.test(j.fcsr_email.html) && /font-family:Arial,sans-serif;font-size:15px/.test(j.fcsr_email.html) && !/—/.test(j.fcsr_email.html + p.text)) }
reset(); A().email = null; [s, j] = await call({ action: 'draft', id: ID })
ck('FCSR: no email on file: the draft says no email goes', j.fcsr_email === null && j.picks.some((x) => x.key === 'fcsr'), j.fcsr_email)
reset(); [s, j] = await call({ action: 'send', id: ID, pick: 'fcsr', message: FCSR_TEXT })
ck('FCSR send (in hours): the text (STOP added) and the email go, one row with both, through GoHighLevel', s === 200 && j.texted === true && j.emailed === true && SENT.length === 2 && SENT[0].type === 'SMS' && SENT[0].message === FCSR_TEXT + ' Reply STOP to opt out.' && SENT[1].type === 'Email' && SENT[1].subject === FCSR_SUBJ && JSON.stringify(plain(SENT[1].html)) === JSON.stringify(FCSR_PARAS) && !/STOP/.test(SENT[1].html) && T.applicant_texts.length === 1 && T.applicant_texts[0].emailed === true && T.applicant_texts[0].email_subject === FCSR_SUBJ && T.applicant_texts[0].kind === 'text', [j, SENT.map((x) => x.type)])
reset(); [s, j] = await call({ action: 'send', id: ID, pick: 'fcsr', message: 'Hi Dana, please register with the FCSR. We emailed you the steps.' })
ck('FCSR: the office edited the text: their words go by text, the email keeps the approved words', j.texted === true && j.emailed === true && SENT[0].message === 'Hi Dana, please register with the FCSR. We emailed you the steps. Reply STOP to opt out.' && JSON.stringify(plain(SENT[1].html)) === JSON.stringify(FCSR_PARAS), SENT)
reset(); [s, j] = await call({ action: 'send', id: ID, message: FCSR_TEXT })
ck('FCSR: the same words without the pick: a text only (the email goes only with the pick)', j.texted === true && j.emailed === false && SENT.length === 1 && !T.applicant_texts[0].email_subject, [j, SENT.length])
reset(); A().email = null; [s, j] = await call({ action: 'send', id: ID, pick: 'fcsr', message: FCSR_TEXT })
ck('FCSR: no email on file: the text alone', j.texted === true && j.emailed === false && SENT.length === 1 && T.applicant_texts[0].email === null, [j, T.applicant_texts[0]])
reset(); A().sms_consent = false; [s, j] = await call({ action: 'send', id: ID, pick: 'fcsr', message: FCSR_TEXT })
ck('FCSR: no yes to texts: the email alone goes (the text is never sent without their yes)', j.texted === false && j.emailed === true && SENT.length === 1 && SENT[0].type === 'Email' && /did not agree to texts/.test(j.not_text), [j, SENT])
reset(); T.contact_optout_current.push({ address: 'dana@x.com', channel: 'email', opted_out: true, source: 'unsubscribe' }); [s, j] = await call({ action: 'send', id: ID, pick: 'fcsr', message: FCSR_TEXT })
ck('FCSR: opted out of email (universal door): no email, the text goes, the row says why', j.texted === true && j.emailed === false && SENT.length === 1 && /email: they opted out|email: could not/.test(T.applicant_texts[0].error || ''), [j, T.applicant_texts[0]])
reset(); A().sms_consent = false; A().email = null; [s, j] = await call({ action: 'send', id: ID, pick: 'fcsr', message: FCSR_TEXT })
ck('FCSR: no yes to texts and no email: refused, says why, nothing sent', s === 409 && /no email/.test(j.error) && SENT.length === 0 && T.applicant_texts.length === 0, [s, j])
reset(); globalThis.__hours = { allowed: false, reason: 'outside' }
;[s, j] = await call({ action: 'send', id: ID, pick: 'fcsr', message: FCSR_TEXT })
globalThis.__hours = { allowed: true, reason: 'ok' }
ck('FCSR after 6pm: held, text and email together, nothing goes yet', j.held === true && SENT.length === 0 && T.applicant_texts[0].status === 'held' && T.applicant_texts[0].email === 'dana@x.com' && T.applicant_texts[0].email_subject === FCSR_SUBJ && T.applicant_texts[0].created_by === 'Krystal Smith', [j, T.applicant_texts[0]])
T.applicant_texts[0].send_after = new Date(Date.now() - 1000).toISOString(); globalThis.__job = 'cron'; [s, j] = await call({ action: 'release' }); globalThis.__job = null
ck('...at 8am both go, the email signed by the person who pressed Send', j.released === 1 && SENT.length === 2 && SENT[0].message === FCSR_TEXT + ' Reply STOP to opt out.' && SENT[1].subject === FCSR_SUBJ && JSON.stringify(plain(SENT[1].html)) === JSON.stringify(FCSR_PARAS) && T.applicant_texts[0].emailed === true, [j, SENT.map((x) => x.type)])
reset(); globalThis.__staff = { ok: true, email: 'office@mo-care.com', name: '' }; globalThis.__hours = { allowed: false, reason: 'outside' }
;[s, j] = await call({ action: 'send', id: ID, pick: 'fcsr', message: 'Hi Dana, this is the office from Caring Companions. Please register with the FCSR.' })
globalThis.__hours = { allowed: true, reason: 'ok' }; T.applicant_texts[0].send_after = new Date(Date.now() - 1000).toISOString(); globalThis.__job = 'cron'; await call({ action: 'release' }); globalThis.__job = null
globalThis.__staff = { ok: true, email: 'krystal@mo-care.com', name: 'Krystal Smith' }
ck('...a sender with no name on file: the released email is signed "the office", as the composer would', SENT.length === 2 && /Thank you,<br>the office<br>/.test(SENT[1].html), SENT[1] && SENT[1].html)

/* ── the file itself ── */
const src = fs.readFileSync(path.join(FN, 'applicant-text/index.ts'), 'utf8')
ck('no em dash in the function', !/—/.test(src))
ck('the Hub can call it from the browser (CORS and OPTIONS on day one)', /Access-Control-Allow-Origin/.test(src) && /req\.method === 'OPTIONS'/.test(src))
ck('the sql only adds', !/drop table|delete from|truncate|alter table .* drop/i.test(fs.readFileSync(path.join(ROOT, 'applicant_texts_574.sql'), 'utf8')))

let fails = 0
for (const [n, ok, note] of res) { console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '  ' + note)); if (!ok) fails++ }
console.log(`\n${res.length - fails}/${res.length} passed`)
process.exit(fails ? 1 : 0)
