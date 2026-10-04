// 446 · background review ("Something came up"): _shared/bg-review.ts (rules + words) and the bg-review function run
// for real against a fake database and a fake GoHighLevel. Nothing real is touched. node bg_review_test.mjs
import fs from 'fs'; import path from 'path'; import os from 'os'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 700)])
const realTLS = Date.prototype.toLocaleString
Date.prototype.toLocaleString = function (loc, o) { if (o && o.hour === '2-digit' && !o.minute) return '10'; if (o && o.weekday === 'short' && !o.hour) return 'Tue'; return realTLS.call(this, loc, o) }
const B = await import(path.join(FN, '_shared/bg-review.ts'))

/* ═══ 1 · the rules ═══ */
ck('response due: 5 business days, weekends skipped (Mon Oct 5 → Mon Oct 12; Fri Oct 9 → Fri Oct 16; Sat → Fri)', B.addBusinessDays('2026-10-05', 5) === '2026-10-12' && B.addBusinessDays('2026-10-09', 5) === '2026-10-16' && B.addBusinessDays('2026-10-10', 5) === '2026-10-16')
ck('worked out in Central time (9pm Central Monday is still Monday)', B.responseDue(new Date('2026-10-06T02:00:00Z')) === '2026-10-12')
ck('the due date has passed only once its whole day is over', !B.duePassed('2026-10-12', new Date('2026-10-13T04:30:00Z')) && B.duePassed('2026-10-12', new Date('2026-10-13T05:30:00Z')))
const V = (c, r) => B.variantFor(c, r)
ck('which final notice: FCSR/fingerprints waiver → waiver; no waiver → our decision; FCSR showing EDL / EDL → EDL; OIG → OIG',
  V('fcsr', 'waiver_needed') === 'waiver' && V('fp', 'waiver_needed') === 'waiver' && V('fcsr', 'no_waiver') === 'decision' && V('fp', 'no_waiver') === 'decision'
  && V('fcsr', 'cannot_employ') === 'edl' && V('edl', 'cannot_employ') === 'edl' && V('oig', 'cannot_employ') === 'oig')
ck('...and nothing for a result that does not fit the check (EDL/OIG never have a waiver; fingerprints never "can\'t be employed"; Needs review never)',
  V('edl', 'waiver_needed') === null && V('oig', 'no_waiver') === null && V('fp', 'cannot_employ') === null && V('fcsr', 'review') === null)
const NAMES = /Registry|FCSR|Disqualification|EDL|OIG|exclusion|fingerprint/i
const s1 = B.step1Words('Ava', 'fcsr', '2026-10-12')
ck('Step 1 text: the approved words, private (no check named), STOP', s1.text === "Hi Ava, this is Caring Companions. Something came up in your background screening that we'd like to go over with you before we continue your application. Please call us at (417) 234-8494 within 5 business days. Reply STOP to opt out.", s1.text)
ck('Step 1 text never names any check, for every check', ['fcsr', 'edl', 'oig', 'fp'].every((c) => !NAMES.test(B.step1Words('Ava', c, '2026-10-12').text)))
ck('Step 1 email: names the check and the due date, "No decision has been made", mentions a Good Cause Waiver', s1.subject === 'About your background screening' && /Something came up on your Missouri Family Care Safety Registry screening/.test(s1.html) && /by Monday, October 12/.test(s1.html) && /No decision has been made/.test(s1.html) && /Good Cause Waiver/.test(s1.html), s1.html)
ck('...for each check its own name', /Missouri Employee Disqualification List check/.test(B.step1Words('A', 'edl', '2026-10-12').html) && /federal OIG exclusion list check/.test(B.step1Words('A', 'oig', '2026-10-12').html) && /your fingerprint background check that/.test(B.step1Words('A', 'fp', '2026-10-12').html))
const F = (c, v, sp) => B.finalWords('Ava', c, v, sp)
ck('final text: the same for every result, never names the check', ['waiver', 'decision', 'edl', 'oig'].every((v) => F('fcsr', v, false).text === "Hi Ava, thank you for your time. After reviewing your background screening, we're not able to move forward with your application for a caregiving position. We've emailed you more information. Reply STOP to opt out."))
ck('final email (waiver): the check, Missouri rules, how to apply for a waiver, welcome back', /Missouri Family Care Safety Registry results/.test(F('fcsr', 'waiver').html) && /unless the state grants a Good Cause Waiver/.test(F('fcsr', 'waiver').html) && /1-866-422-6872/.test(F('fcsr', 'waiver').html) && /welcome to apply with us again/.test(F('fp', 'waiver').html) && /fingerprint background check results/.test(F('fp', 'waiver').html))
ck('final email (our decision): no "Missouri rules" claim; "and talking with you" only when we spoke', !/Missouri rules|Good Cause/.test(F('fcsr', 'decision', true).html) && /results and talking with you, we've decided/.test(F('fcsr', 'decision', true).html) && /results, we've decided/.test(F('fcsr', 'decision', false).html))
ck('final email (EDL): Missouri law, no waiver, contact DHSS', /Missouri law does not allow in-home care providers to employ anyone listed on the Missouri Employee Disqualification List/.test(F('edl', 'edl').html) && /Department of Health and Senior Services/.test(F('edl', 'edl').html) && !/Good Cause/.test(F('edl', 'edl').html))
ck('final email (OIG): federal list, reinstatement information', /federal OIG exclusion list in a role paid by Medicare or Medicaid/.test(F('oig', 'oig').html) && /oig\.hhs\.gov\/exclusions/.test(F('oig', 'oig').html))
ck('a name with < or & in it is escaped in the email', /Ava &lt;b&gt;/.test(B.step1Words('Ava <b>', 'fcsr', '2026-10-12').html))
const T0 = new Date('2026-10-07T15:00:00Z')
const base = { status: 'open', check_key: 'fcsr', result: 'waiver_needed', step1_at: '2026-10-05T15:00:00Z', due_date: '2026-10-12', spoke_at: null, decision_reason: null }
const G = (o, now = new Date('2026-10-13T15:00:00Z')) => B.finalGate({ ...base, ...o }, now)
ck('final notice: available after Step 1 + a result + the due date passed', G({}).ok && G({}).variant === 'waiver')
ck('...not before the due date, unless we spoke with them', !G({}, T0).ok && /Available after Monday, October 12/.test(G({}, T0).why) && G({ spoke_at: '2026-10-06T15:00:00Z' }, T0).ok)
ck('...not without Step 1 (but "told them by phone or in person" counts)', !G({ step1_at: null }).ok && G({ step1_at: null, step1_told_at: '2026-10-05T15:00:00Z' }).ok)
ck('...not while Needs review', !G({ result: 'review' }).ok)
ck('..."No waiver needed" only with a written reason', !G({ result: 'no_waiver' }).ok && G({ result: 'no_waiver', decision_reason: 'not a fit' }).ok)
ck('...not while waiting on a waiver; not once closed', !G({ status: 'waiting_waiver' }).ok && !G({ status: 'cleared' }).ok && !G({ status: 'not_hired' }).ok)

/* ═══ 2 · the function, against fakes ═══ */
let T, SENT, CARDS, nextId = 1
const CAND = () => ({ id: 31, first: 'Ava', last: 'Smith', phone: '(417) 555-0111', email: 'ava@x.com', fcsr: 'Issues Found', edl: 'Clear', oig: 'FLAGGED', fp: 'N/A' })
const reset = (o = {}) => { SENT = []; CARDS = []
  T = { app_data: [{ key: 'candidates', data: [CAND()] }, { key: 'ops_items', data: [] }], bg_reviews: [], job_applicants: [{ phone: '4175550111', sms_consent: true, created_at: '2026-09-01' }],
    contact_optout_current: [], circle_contacts: [], phone_index: [], domains: [], persons: [], ...o } }
const q = (t) => { const f = []; let op = 'select', patch = null, rowsIn = null, sel = false, orf = null
  const match = (r) => f.every(([k, c, v]) => k === 'eq' ? String(r[c]) === String(v) : k === 'in' ? v.includes(r[c]) : k === 'is' ? (r[c] ?? null) === v : true) && (!orf || orf(r))
  const b = { select() { sel = true; return b }, eq(c, v) { f.push(['eq', c, v]); return b }, in(c, v) { f.push(['in', c, v]); return b }, is(c, v) { f.push(['is', c, v]); return b },
    ilike() { return b }, limit() { return b }, order() { return b }, gte() { return b }, not() { return b },
    or(s) { const m = s.match(/^(\w+)\.is\.null,\1\.lt\."(.+)"$/); orf = (r) => r[m[1]] == null || r[m[1]] < m[2]; return b },
    update(p) { op = 'update'; patch = p; return b }, insert(r) { op = 'insert'; rowsIn = Array.isArray(r) ? r : [r]; return b },
    maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: x.error })) },
    then(ok, no) { let out
      if (op === 'update') { const rs = (T[t] || []).filter(match); rs.forEach((r) => Object.assign(r, patch)); out = { data: sel ? rs.map((r) => ({ id: r.id })) : null, error: null } }
      else if (op === 'insert') { if (t === 'bg_reviews' && rowsIn.some((r) => T.bg_reviews.some((x) => x.candidate_id === r.candidate_id && x.check_key === r.check_key && ['open', 'waiting_waiver'].includes(x.status)))) out = { data: null, error: { message: 'duplicate key' } }
        else { const ins = rowsIn.map((r) => ({ id: '00000000-0000-4000-8000-' + String(nextId++).padStart(12, '0'), history: [], ...r })); (T[t] ||= []).push(...ins); out = { data: sel ? ins : null, error: null } } }
      else out = { data: (T[t] || []).filter(match), error: null }
      return Promise.resolve(out).then(ok, no) } }
  return b }
globalThis.__db = { from: q, rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') { CARDS.push(a.item); const ops = T.app_data.find((x) => x.key === 'ops_items'); ops.data = ops.data.filter((x) => x.id !== a.item.id).concat([a.item]) } return { data: null, error: null } } }
globalThis.__ghlDown = false; globalThis.__hours = { allowed: true }
globalThis.fetch = async (url, o) => { url = String(url); const body = o?.body ? JSON.parse(o.body) : {}
  if (url.includes('/contacts/search/duplicate')) return new Response('{}', { status: 200 })
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + (body.phone || body.email), dnd: false } }), { status: 200 })
  if (url.includes('/conversations/messages')) { if (globalThis.__ghlDown) return new Response('{"message":"down"}', { status: 503 }); SENT.push(body); return new Response('{}', { status: 200 }) }
  return new Response('{}', { status: 200 }) }
let handler
const SECRET = 's'.repeat(40)
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', HUB_JOB_SECRET: SECRET })[k] ?? '' }, serve: (h) => { handler = h } }
globalThis.__staff = { ok: true, email: 'krystal@mo-care.com', name: 'Krystal' }
let src = fs.readFileSync(path.join(FN, 'bg-review/index.ts'), 'utf8')
for (const [a, b2] of [[/^import \{ createClient \} from .*$/m, 'const createClient = (..._a: any[]) => (globalThis as any).__db'],
  [/^import \{ contactForOutbound, maySend \} from (.*)$/m, "import { contactForOutbound } from $1\nconst maySend = (..._a: any[]) => (globalThis as any).__hours"],
  [/^import \{ requireStaff, OFFICE_ROLES, serverSecretOk \} from (.*)$/m, "import { serverSecretOk } from $1\nconst OFFICE_ROLES: string[] = []; const requireStaff = async (..._a: any[]) => (globalThis as any).__staff"]]) {
  const s0 = src; src = src.replace(a, b2); if (s0 === src) throw new Error('test setup: no match ' + a) }
src = src.replace(/'\.\.\/_shared\//g, "'" + path.join(FN, '_shared') + '/')
const tmp = path.join(os.tmpdir(), 'bgr446_' + process.pid + '.ts'); fs.writeFileSync(tmp, src); const MOD = await import(tmp); fs.unlinkSync(tmp)
const call = async (body, hdr = {}) => { const r = await handler(new Request('https://x/f', { method: 'POST', headers: hdr, body: JSON.stringify(body) })); return [r.status, await r.json()] }
const RV = () => T.bg_reviews[0]

reset(); globalThis.__staff = { ok: false, status: 401, error: 'Sign in first.' }
let [s, j] = await call({ action: 'open', candidate_id: 31, check: 'fcsr' })
ck('someone not signed in as office staff gets nothing', s === 401 && !T.bg_reviews.length && !SENT.length, [s, j])
globalThis.__staff = { ok: true, email: 'krystal@mo-care.com', name: 'Krystal' }
reset(); [s, j] = await call({ action: 'open', candidate_id: 31, check: 'edl' })
ck('"Something came up" only for a check recorded as flagged (EDL is Clear here)', s === 409 && /not recorded as flagged/.test(j.error) && !T.bg_reviews.length, j)
;[s, j] = await call({ action: 'preview', candidate_id: 31, check: 'fcsr' })
ck('preview before opening: the exact Step 1 words, nothing saved or sent', s === 200 && j.words.text === B.step1Words('Ava', 'fcsr', B.responseDue(new Date())).text && !T.bg_reviews.length && !SENT.length, j)
;[s, j] = await call({ action: 'open', candidate_id: 31, check: 'fcsr' })
const ID = j.id
ck('open: a review in "Needs review", with who and when; NOTHING is sent', s === 200 && RV().status === 'open' && RV().result === 'review' && RV().opened_by === 'Krystal' && RV().who === 'Ava S' && !SENT.length && /Opened the review: FCSR recorded as Issues Found/.test(RV().history[0].what), [j, RV()])
;[s, j] = await call({ action: 'open', candidate_id: 31, check: 'fcsr' })
ck('opening again just returns the open review (one open review per check)', j.already_open === true && j.id === ID && T.bg_reviews.length === 1)
;[s, j] = await call({ action: 'final', id: ID })
ck('final notice before Step 1: refused, nothing sent', s === 409 && /Something came up" first/.test(j.error) && !SENT.length, j)
globalThis.__hours = { allowed: false }; [s, j] = await call({ action: 'step1', id: ID }); globalThis.__hours = { allowed: true }
ck('Step 1 outside 8am to 6pm: nothing goes, it says so, no due date yet', /8am to 6pm/.test(j.held) && !SENT.length && !RV().step1_at && !!RV().step1_held_at && !RV().due_date, j)
;[s, j] = await call({ action: 'step1', id: ID })
ck('Step 1 in hours: the text (private) and the email (names the check) through GoHighLevel', s === 200 && j.texted && j.emailed && SENT.length === 2 && SENT[0].type === 'SMS' && !NAMES.test(SENT[0].message) && SENT[1].type === 'Email' && /Missouri Family Care Safety Registry screening/.test(SENT[1].html), [j, SENT])
ck('...recorded: when, by whom, how, and the Applicant response due date (5 business days)', !!RV().step1_at && RV().step1_by === 'Krystal' && RV().step1_how === 'text and email' && RV().due_date === B.responseDue(new Date()) && !RV().step1_held_at && !RV().step1_claim_at)
;[s, j] = await call({ action: 'step1', id: ID })
ck('pressing it again sends nothing more', j.already_sent === true && SENT.length === 2)
;[s, j] = await call({ action: 'final', id: ID })
ck('final notice while still "Needs review": refused (a finding is never an automatic not hired)', s === 409 && /Pick the review result first/.test(j.error) && SENT.length === 2, j)
;[s, j] = await call({ action: 'result', id: ID, result: 'cannot_employ' })
ck('FCSR results allowed: waiver needed, no waiver needed, can\'t be employed', s === 200 && RV().result === 'cannot_employ')
;[s, j] = await call({ action: 'result', id: ID, result: 'no_waiver' })
;[s, j] = await call({ action: 'final', id: ID })
ck('"No waiver needed" + final notice without a written reason: refused', s === 409 && /write down why/.test(j.error), j)
;[s, j] = await call({ action: 'result', id: ID, result: 'waiver_needed' })
;[s, j] = await call({ action: 'final', id: ID })
ck('before the response due date (no call recorded): refused, says when it becomes available', s === 409 && /Available after/.test(j.error) && SENT.length === 2, j)
;[s, j] = await call({ action: 'waiver', id: ID, step: 'wait' })
ck('"Waiting on their waiver": they are held', RV().status === 'waiting_waiver' && !!RV().waiver_wait_at)
RV().due_date = '2026-01-05'; [s, j] = await call({ action: 'final', id: ID })
ck('...no final notice while waiting on a waiver, even after the due date', s === 409 && /waiting on their Good Cause Waiver/.test(j.error), j)
;[s, j] = await call({ action: 'waiver', id: ID, step: 'approved' })
ck('"Waiver approved" needs the approval letter attached', s === 400 && /letter/.test(j.error) && RV().status === 'waiting_waiver')
;[s, j] = await call({ action: 'waiver', id: ID, step: 'denied' })
ck('"Waiver denied": the review is open again with the waiver result', RV().status === 'open' && RV().waiver_outcome === 'denied')
;[s, j] = await call({ action: 'preview', id: ID, step: 'final' })
ck('final preview: the waiver notice words, nothing sent', j.variant === 'waiver' && /Good Cause Waiver/.test(j.words.html) && SENT.length === 2, j)
;[s, j] = await call({ action: 'final', id: ID })
ck('final notice (due date passed): text + email; the review closes as not hired with which notice and who', j.texted && j.emailed && SENT.length === 4 && !NAMES.test(SENT[2].message) && /unless the state grants a Good Cause Waiver/.test(SENT[3].html) && RV().status === 'not_hired' && RV().final_variant === 'waiver' && RV().final_by === 'Krystal', [j, RV()])
;[s, j] = await call({ action: 'final', id: ID })
ck('...a closed review refuses everything after', s === 409 && SENT.length === 4)
ck('every step is in the history', RV().history.length >= 9 && RV().history.every((h) => h.at && h.by && h.what), RV().history)

/* clearing */
reset(); [s, j] = await call({ action: 'open', candidate_id: 31, check: 'oig' }); const ID2 = j.id
;[s, j] = await call({ action: 'clear', id: ID2, why: 'no_waiver' })
ck('OIG: "no waiver needed" is not a reason (no waiver applies)', s === 400)
;[s, j] = await call({ action: 'result', id: ID2, result: 'waiver_needed' })
ck('OIG: only "can\'t be employed"', s === 400 && RV().result === 'review')
;[s, j] = await call({ action: 'clear', id: ID2, why: 'not_them' })
ck('"They\'re cleared" (not this person): closed, nothing sent; the Hub is told to record OIG as CLEAR', j.cleared && j.set_to === 'CLEAR' && RV().status === 'cleared' && RV().cleared_why === 'not_them' && !SENT.length && /Nothing was sent/.test(RV().history.at(-1).what), j)
reset(); [s, j] = await call({ action: 'open', candidate_id: 31, check: 'fcsr' }); const ID3 = j.id
;[s, j] = await call({ action: 'result', id: ID3, result: 'waiver_needed' }); [s, j] = await call({ action: 'waiver', id: ID3, step: 'wait' })
;[s, j] = await call({ action: 'waiver', id: ID3, step: 'approved', proof: 'bgcheck/31/gcw-1.pdf' })
ck('"Waiver approved" with the letter: cleared, letter kept, nothing sent', j.cleared && RV().status === 'cleared' && RV().cleared_why === 'waiver_approved' && RV().waiver_proof === 'bgcheck/31/gcw-1.pdf' && !SENT.length, j)

/* told / spoke / consent / GHL down */
reset(); [s, j] = await call({ action: 'open', candidate_id: 31, check: 'fcsr' }); const ID4 = j.id
;[s, j] = await call({ action: 'told', id: ID4, note: 'called her' })
ck('"Told them by phone or in person": no message, due date set, counts as Step 1', !SENT.length && !!RV().step1_told_at && !!RV().due_date && !RV().step1_at)
;[s, j] = await call({ action: 'spoke', id: ID4 }); [s, j] = await call({ action: 'result', id: ID4, result: 'no_waiver', reason: 'Did not want weekend hours' })
;[s, j] = await call({ action: 'preview', id: ID4, step: 'final' })
ck('spoke with them + "No waiver needed" with a reason: the final notice is available right away (our decision wording, "and talking with you")', j.variant === 'decision' && /and talking with you/.test(j.words.html) && !/Missouri rules/.test(j.words.html), j)
reset({ job_applicants: [{ phone: '4175550111', sms_consent: false, created_at: '2026-09-01' }] }); [s, j] = await call({ action: 'open', candidate_id: 31, check: 'fcsr' })
;[s, j] = await call({ action: 'step1', id: j.id })
ck('their application said no to texts: only the email goes, and it says why', j.emailed && !j.texted && SENT.length === 1 && SENT[0].type === 'Email' && /did not agree to texts/.test(j.not_sent.join()) && RV().step1_how === 'email', j)
reset(); globalThis.__ghlDown = true; [s, j] = await call({ action: 'open', candidate_id: 31, check: 'fcsr' }); [s, j] = await call({ action: 'step1', id: j.id }); globalThis.__ghlDown = false
ck('GoHighLevel refuses both: not recorded as sent, it says why, a "Didn\'t go through" card, no due date', !j.texted && !j.emailed && !RV().step1_at && !RV().due_date && !RV().step1_claim_at && CARDS.length >= 1 && /did not accept/.test(j.not_sent.join()), [j, CARDS.length])
reset(); [s, j] = await call({ action: 'open', candidate_id: 31, check: 'fcsr' }); RV().step1_claim_at = new Date().toISOString()
;[s, j] = await call({ action: 'step1', id: RV().id })
ck('a second press while the first is still sending sends nothing', s === 409 && !SENT.length, j)

/* the response due cards */
reset(); [s, j] = await call({ action: 'due_check' })
ck('the due check refuses anyone without its schedule\'s secret', s === 401)
const rv0 = { id: 'aaaaaaaa-0000-4000-8000-000000000001', candidate_id: '31', check_key: 'fcsr', who: 'Ava S', status: 'open', result: 'review', step1_at: '2026-10-05T15:00:00Z', due_date: '2026-10-12', spoke_at: null, due_card_at: null, history: [] }
reset({ bg_reviews: [{ ...rv0 }, { ...rv0, id: 'aaaaaaaa-0000-4000-8000-000000000002', who: 'Bo N', spoke_at: '2026-10-08T15:00:00Z' }, { ...rv0, id: 'aaaaaaaa-0000-4000-8000-000000000003', who: 'Cy D', due_date: '2026-10-20' }] })
let d = await MOD.dueCheck(globalThis.__db, new Date('2026-10-13T15:00:00Z'))
ck('due check (weekday 10am): one Needs Attention card for a review whose due date passed with no call; not for one we spoke with, not before the date', d.cards === 1 && CARDS.length === 1 && /response due passed for Ava S/.test(CARDS[0].title) && CARDS[0].domain === 'caregivers' && !!T.bg_reviews[0].due_card_at && !SENT.length, [d, CARDS])
d = await MOD.dueCheck(globalThis.__db, new Date('2026-10-13T16:00:00Z'))
ck('...the next run adds no second card', d.cards === 0 && CARDS.length === 1)
d = await MOD.dueCheck(globalThis.__db, new Date('2026-10-17T15:00:00Z'))
ck('...weekends and nights: no cards', d.waiting && (await MOD.dueCheck(globalThis.__db, new Date('2026-10-14T03:00:00Z'))).waiting)
const [sC, jC] = await call({ action: 'due_check', auth_check: true }, { 'x-cron-secret': SECRET })
ck('its schedule gets in with the secret', sC === 200 && jC.caller === 'cron')
reset({ bg_reviews: [{ ...rv0, due_card_at: '2026-10-13T15:00:00Z' }], app_data: [{ key: 'candidates', data: [CAND()] }, { key: 'ops_items', data: [{ id: 'ops_bgreview_' + rv0.id, status: 'open', log: [] }] }] })
;[s, j] = await call({ action: 'spoke', id: rv0.id })
ck('recording "spoke with them" closes that card', T.app_data.find((x) => x.key === 'ops_items').data[0].status === 'done')

/* source checks */
const idx = fs.readFileSync(path.join(FN, 'bg-review/index.ts'), 'utf8'), lib = fs.readFileSync(path.join(FN, '_shared/bg-review.ts'), 'utf8'), sqlT = fs.readFileSync(path.join(ROOT, 'bg_review_446.sql'), 'utf8')
ck('no Checkr anywhere in it', !/checkr/i.test(idx + lib + sqlT))
ck('never calls the 5 days an FCRA or adverse-action period', !/FCRA|adverse/i.test(idx + lib))
ck('the database change adds only, staff read, server writes, one open review per check', !/drop table|delete from|update public\./i.test(sqlT) && /revoke all on public\.bg_reviews from public, anon, authenticated/.test(sqlT) && /bg_reviews_one_open/.test(sqlT))
ck('no em dashes in anything new', !/—/.test(idx + lib + sqlT))

Date.prototype.toLocaleString = realTLS
const failed = res.filter((r) => !r[1])
for (const [n, ok, note] of res) console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok ? '' : '  ' + note))
console.log(`${res.length - failed.length}/${res.length} passed`)
process.exit(failed.length ? 1 : 0)
