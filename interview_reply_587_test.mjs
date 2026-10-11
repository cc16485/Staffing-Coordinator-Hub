// 587 · interview-reply: a clear NO frees the interview; anything else goes to a person. The real function against a
// fake database; nothing real is reached.   node interview_reply_587_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
const FN = 'supabase/functions'
let T, RPC
const soon = (h) => new Date(Date.now() + h * 3600e3).toISOString()
const reset = (o = {}) => {
  RPC = []
  T = { app_data: [{ key: 'ops_settings', data: { applicant_msgs_v2_live: o.off ? false : true } }],
    job_applicants: [{ id: 'a1', first_name: 'Maria', last_name: 'Lopez', phone: '(417) 555-0101' }, { id: 'a2', first_name: 'Ann', last_name: 'Bee', phone: '4175550202' }],
    interview_bookings: [
      { id: 'b1', applicant_id: 'a1', status: 'booked', starts_at: soon(16), reminded_day_at: soon(-2) },
      { id: 'b2', applicant_id: 'a2', status: 'booked', starts_at: soon(16), reminded_day_at: null },
      ...(o.extra || [])] }
}
const q = (t) => { const st = { f: [], inF: null, gte: null, lte: null, like: null }; const b = {
  select() { return b }, eq(c, v) { st.f.push([c, v]); return b }, in(c, v) { st.inF = [c, v]; return b },
  gte(c, v) { st.gte = [c, v]; return b }, lte(c, v) { st.lte = [c, v]; return b }, ilike(c, p) { st.like = [c, String(p).replace(/%/g, '')]; return b },
  maybeSingle() { return b.then((x) => ({ data: x.data[0] ?? null, error: null })) },
  then(ok) { let r = T[t] ?? []
    for (const [c, v] of st.f) r = r.filter((x) => x[c] === v)
    if (st.inF) r = r.filter((x) => st.inF[1].includes(x[st.inF[0]]))
    if (st.gte) r = r.filter((x) => x[st.gte[0]] >= st.gte[1]); if (st.lte) r = r.filter((x) => x[st.lte[0]] <= st.lte[1])
    if (st.like) r = r.filter((x) => String(x[st.like[0]] ?? '').includes(st.like[1]))
    return Promise.resolve({ data: r, error: null }).then(ok) } }; return b }
globalThis.__db = { from: q, rpc: async (fn, a) => { RPC.push([fn, a])
  if (fn === 'interview_cancel_by_reply') { const bk = T.interview_bookings.find((x) => x.id === a.p_booking); if (bk && bk.status === 'booked') { bk.status = 'cancelled'; return { data: { cancelled: true }, error: null } } return { data: { cancelled: false }, error: null } }
  return { data: null, error: null } } }
const ENV = { SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'k', INTERVIEW_REPLY_TOKEN: 'secret-token-1234' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const src = fs.readFileSync(`${FN}/interview-reply/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
const tmp = path.join(process.cwd(), FN, 'interview-reply', '_t.ts'); fs.writeFileSync(tmp, src)
try { await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
const post = async (body, token = 'secret-token-1234') => (await handler(new Request('https://x/f?token=' + token, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }))).json()
const items = () => RPC.filter(([f, a]) => f === 'upsert_app_data_item' && a.target_key === 'ops_items').map(([, a]) => a.item)

reset(); ck('wrong token: refused', (await post({ phone: '4175550101', message: 'No' }, 'nope')).error === 'unauthorized')
reset(); let r = await post({ id: 'c1', phone: '+1 417-555-0101', name: 'Maria', message: "No, I can't make it" })
ck('a clear NO: that interview is cancelled and its time freed', r.outcome === 'cancelled' && T.interview_bookings[0].status === 'cancelled' && RPC.some(([f, a]) => f === 'interview_cancel_by_reply' && a.p_booking === 'b1'), [r, RPC])
ck('...nothing for the office to do (the usual cancellation text and heads-up follow from the message job)', items().length === 0)
reset(); r = await post('{"id":"c1","phone":"4175550101","name":"Maria","message":"No problem, see you then"}')
ck('"No problem, see you then": nothing cancelled, office asked to read it', r.outcome === 'other' && T.interview_bookings[0].status === 'booked' && items().length === 1 && /No problem, see you then/.test(items()[0].detail), [r, items()])
reset(); r = await post({ phone: '4175550101', message: 'Yes!' })
ck('YES: kept on the booking, nothing else changes, no office item', r.outcome === 'yes' && T.interview_bookings[0].status === 'booked' && RPC.some(([f, a]) => f === 'interview_record_reply' && a.p_kind === 'yes') && items().length === 0, RPC)
reset(); r = await post({ phone: '4175550101', message: 'running late, 10 min' })
ck('"running late": nothing cancelled, office asked to answer', r.outcome === 'other' && T.interview_bookings[0].status === 'booked' && items().length === 1)
reset(); r = await post({ phone: '4175550202', message: 'No' })
ck('a NO about an interview that was never asked (no reminder yet): nothing cancelled, the office reads it (urgent)', r.outcome === 'to the office' && T.interview_bookings[1].status === 'booked' && items()[0]?.urgency === 'high', [r, items()])
reset(); r = await post({ phone: '4175559999', message: 'No' })
ck('a number with no application: nothing cancelled, the office reads it', r.outcome === 'to the office' && T.interview_bookings.every((b) => b.status === 'booked') && items().length === 1)
reset({ extra: [{ id: 'b3', applicant_id: 'a1', status: 'booked', starts_at: soon(20), reminded_day_at: soon(-1) }] }); r = await post({ phone: '4175550101', message: 'No' })
ck('two upcoming interviews for one number: nothing cancelled, the office decides', r.outcome === 'to the office' && T.interview_bookings.every((b) => b.status === 'booked'), r)
reset({ extra: [] }); T.interview_bookings[0].starts_at = soon(60); r = await post({ phone: '4175550101', message: 'No' })
ck('an interview days away (not the one we asked about): nothing cancelled', r.outcome === 'to the office' && T.interview_bookings[0].status === 'booked')
reset({ off: true }); r = await post({ phone: '4175550101', message: 'No' })
ck('switch off: nothing changes', r.outcome === 'switch off' && T.interview_bookings[0].status === 'booked')
reset(); r = await post({ phone: '4175550101', message: '' })
ck('an empty message: ignored', r.outcome === 'ignored' && T.interview_bookings[0].status === 'booked')
reset(); await post({ phone: '4175550101', message: 'No' })
const logs = RPC.filter(([f, a]) => f === 'upsert_app_data_item' && a.target_key === 'interview_reply_log').map(([, a]) => JSON.stringify(a.item))
ck('its log keeps no words and no number', logs.length === 1 && !/4175550101|No"/.test(logs[0]), logs)
const s = fs.readFileSync(`${FN}/interview-reply/index.ts`, 'utf8')
ck('it never sends anything itself', !/conversations\/messages|ghlSendChecked|fetch\(/.test(s))
ck('no em dash', !s.includes('—'))

let pass = 0; for (const [nm, ok, note] of res) { console.log((ok ? 'PASS  ' : 'FAIL  ') + nm + (ok ? '' : '  ' + note)); if (ok) pass++ }
console.log(pass === res.length ? `ALL ${res.length} CHECKS PASS` : `${res.length - pass} OF ${res.length} FAILED`); process.exit(pass === res.length ? 0 : 1)
