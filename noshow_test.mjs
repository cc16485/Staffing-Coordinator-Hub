// Interview no-shows (Desktop 400, 2026-10-01): applicant-noshow run for real against a fake database and a fake
// GoHighLevel, plus scans of interview-messages and the database change. node noshow_test.mjs
import fs from 'fs'; import path from 'path'
const FN = 'supabase/functions'; const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 700)])
/* The shared messaging code also holds applicant messages outside 8am–6pm Central, so the clock is pinned to 10am on a
   Tuesday (the function's own hours check is stubbed separately through __hours). */
const realTLS = Date.prototype.toLocaleString;
Date.prototype.toLocaleString = function (loc, o) { if (o && o.hour === '2-digit' && !o.minute) return '10'; if (o && o.weekday === 'short' && !o.hour) return 'Tue'; return realTLS.call(this, loc, o); };
let T, SENT, CARDS, UPD
const reset = (a = {}) => { SENT = []; CARDS = []; UPD = []
  T = { job_applicants: [{ id: '11111111-1111-1111-1111-111111111111', first_name: 'Dana', last_name: 'Doe', phone: '(417) 555-0101', email: 'dana@x.com', sms_consent: true, status: 'reviewing', noshow_at: null, noshow_msg_at: null, ...a }],
    interview_bookings: [{ id: 'b1', applicant_id: '11111111-1111-1111-1111-111111111111', status: 'booked' }], coordinator_busy: [{ source: 'interview', source_id: '11111111-1111-1111-1111-111111111111' }],
    contact_optout_current: [], circle_contacts: [], phone_index: [], app_data: [] } }
const q = (t) => { const f = []; let op = 'select', patch = null; const rows = () => (T[t] || []).filter((r) => f.every(([c, v]) => r[c] === v))
  const b = { select() { return b }, eq(c, v) { f.push([c, v]); return b }, in() { return b }, or() { return b }, not() { return b }, is() { return b }, limit() { return b }, order() { return b },
    update(p) { op = 'update'; patch = p; return b }, delete() { op = 'delete'; return b }, insert(r) { (T[t] ||= []).push(r); return Promise.resolve({ data: r, error: null }) },
    maybeSingle() { return b.then((x) => ({ data: (x.data || [])[0] ?? null, error: null })) }, single() { return b.maybeSingle() },
    then(ok) { let out
      if (op === 'update') { const rs = rows(); rs.forEach((r) => Object.assign(r, patch)); UPD.push([t, patch, rs.length]); out = { data: null, error: null } }
      else if (op === 'delete') { T[t] = (T[t] || []).filter((r) => !f.every(([c, v]) => r[c] === v)); out = { data: null, error: null } }
      else out = { data: t === 'app_data' ? [] : rows(), error: null }
      return Promise.resolve(out).then(ok) } }; return b }
globalThis.__db = { from: q, rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') CARDS.push(a.item); return { data: null, error: null } } }
globalThis.__staff = { ok: true, email: 'krystal@mo-care.com', name: 'Krystal' }; globalThis.__hours = { allowed: true, reason: 'ok' }; globalThis.__ghlDown = false
globalThis.fetch = async (url, o) => { url = String(url); const body = o?.body ? JSON.parse(o.body) : {}
  if (url.includes('/contacts/search/duplicate')) return new Response('{}', { status: 200 })
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + (body.phone || body.email), dnd: false } }), { status: 200 })
  if (url.includes('/conversations/messages')) { if (globalThis.__ghlDown) return new Response('{"message":"down"}', { status: 503 }); SENT.push(body); return new Response('{}', { status: 200 }) }
  return new Response('{}', { status: 200 }) }
let handler; globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'k', GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc' })[k] }, serve: (h) => { handler = h } }
const src = fs.readFileSync(`${FN}/applicant-noshow/index.ts`, 'utf8')
  .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace(/^import \{ contactForOutbound, maySend \} from (.*)$/m, "import { contactForOutbound } from $1\nconst maySend = () => globalThis.__hours")
  .replace(/^import \{ requireStaff, OFFICE_ROLES \} from .*$/m, 'const OFFICE_ROLES = []; const requireStaff = async () => globalThis.__staff')
const tmp = path.join(process.cwd(), FN, 'applicant-noshow', '_t.ts'); fs.writeFileSync(tmp, src); try { await import(tmp) } finally { fs.unlinkSync(tmp) }
const ID = '11111111-1111-1111-1111-111111111111'
const call = async (body) => { const r = await handler(new Request('https://x/f', { method: 'POST', body: JSON.stringify(body) })); return [r.status, await r.json()] }
const A = () => T.job_applicants[0]

reset(); globalThis.__staff = { ok: false, status: 401, error: 'Sign in first.' }
let [s, j] = await call({ action: 'mark', id: ID }); ck('not signed-in office staff: refused, nothing changed', s === 401 && A().status === 'reviewing' && !SENT.length, j)
globalThis.__staff = { ok: true, email: 'krystal@mo-care.com', name: 'Krystal' }
reset(); [s, j] = await call({ action: 'preview', id: ID })
ck('preview: her exact text (first name filled in) and the email with her subject', j.text.startsWith('Hi Dana, this is Caring Companions In-Home Senior Care. You were scheduled for an in-person interview') && /marked as a No-Show/.test(j.text) && /417-234-8494/.test(j.text) && j.email.subject === 'Missed Interview – Caring Companions' && /<b>No-Show<\/b>/.test(j.email.html) && !SENT.length && A().status === 'reviewing', j)
reset(); [s, j] = await call({ action: 'mark', id: ID })
ck('mark: status noshow with who and when; the booked interview becomes a no-show; the slot is freed', A().status === 'noshow' && A().noshow_by === 'Krystal' && A().noshow_at && T.interview_bookings[0].status === 'noshow' && T.interview_bookings[0].noshow_notified_at && !T.coordinator_busy.length, [A(), T.interview_bookings])
ck('mark: the text AND the email go through GoHighLevel (so they show in Conversations), once', j.texted && j.emailed && SENT.length === 2 && SENT.some((m) => m.type === 'SMS') && SENT.some((m) => m.type === 'Email' && m.subject === 'Missed Interview – Caring Companions') && A().noshow_msg_at, [j, SENT])
const before = SENT.length; [s, j] = await call({ action: 'mark', id: ID }); ck('pressing it again never sends twice', SENT.length === before && j.already_sent, j)
reset({ sms_consent: false }); [s, j] = await call({ action: 'mark', id: ID })
ck('no yes to texts: email only, and the office is told why no text', !j.texted && j.emailed && SENT.length === 1 && /did not agree to texts/.test(j.not_sent.join(' ')), j)
reset(); globalThis.__hours = { allowed: false, reason: 'after hours' }; [s, j] = await call({ action: 'mark', id: ID })
ck('after hours: marked now, message held (nothing sent), profile can send it later', A().status === 'noshow' && !SENT.length && /after 8am/.test(j.held) && !A().noshow_msg_at, j)
globalThis.__hours = { allowed: true, reason: 'ok' }; [s, j] = await call({ action: 'send', id: ID })
ck('"Send the no-show message" later: goes once', j.texted && j.emailed && SENT.length === 2, j)
reset(); globalThis.__ghlDown = true; [s, j] = await call({ action: 'mark', id: ID })
ck('GoHighLevel refuses: still marked, not stamped sent, a "Didn\'t go through" card for each', A().status === 'noshow' && !A().noshow_msg_at && CARDS.length >= 2 && CARDS.every((c) => c.kind === 'send_problem'), [j, CARDS.map((c) => c.title)])
globalThis.__ghlDown = false
reset({ status: 'noshow' }); [s, j] = await call({ action: 'excuse', id: ID })
ck('excuse needs the reason they gave', s === 400 && A().status === 'noshow', j)
;[s, j] = await call({ action: 'excuse', id: ID, reason: 'Car broke down, called next morning' })
ck('excuse: back to reviewing (can be booked) with who, when and the reason', A().status === 'reviewing' && A().noshow_excused_by === 'Krystal' && A().noshow_excuse_reason === 'Car broke down, called next morning' && A().noshow_excused_at, A())
reset({ status: 'hired' }); [s, j] = await call({ action: 'mark', id: ID }); ck('someone already hired cannot be marked a no-show by mistake', s === 409 && A().status === 'hired', j)

const im = fs.readFileSync(`${FN}/interview-messages/index.ts`, 'utf8'), sq = fs.readFileSync('noshow_policy.sql', 'utf8')
ck('the old "we missed you, pick a new time" message and the reset to reviewing are gone', !/we missed you/i.test(im) && !/update\(\{ status: 'reviewing'/.test(im))
ck('database: applying again with a no-show phone/email is refused with NOSHOW_BEFORE', /if public\.applicant_noshow_match\(p_data->>'phone', p_data->>'email', null\) then\s+raise exception 'NOSHOW_BEFORE/.test(sq))
ck('database: a no-show cannot book (old link included); the link says so', /status = 'noshow'\)\s+or exists[\s\S]*?raise exception 'NOSHOW_BEFORE/.test(sq) && /return json_build_object\('status', 'noshow'\)/.test(sq))
ck('database: excused no-shows (status back to reviewing) are not matched', /where a\.status = 'noshow'/.test(sq))
let all = true; console.log('\nNO-SHOWS · TEST\n' + '='.repeat(50)); for (const [n, g, note] of res) { all &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')) }
console.log(all ? `ALL ${res.length} CHECKS PASS` : 'FAILED')
