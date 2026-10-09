// coverage-run action follow_up (her ask 2026-10-09): text ONLY the people already asked on a case, in the office's
// words, so nobody has to remember who was asked. The real function against a fake database and a fake GoHighLevel.
// node followup_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const FN = 'supabase/functions'
let APP, SENT, T, STAFF, OWNER, PATCHES, LOG
const SVC = 'svc_' + 'k'.repeat(60)
const ymd = (d) => d.toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d) }
const kase = (o) => ({ id: 'cwo_s1', status: 'open', reason: 'open', client: 'Dan Probstfield', client_axiscare_id: '500', shift_date: inDays(5), shift_time: '08:00-12:00',
  shift_pattern: { v: 2, kind: 'open_ongoing', weekday: 'Saturday' }, asked: [
    { id: 'a1', name: 'Elizabeth Johns', state: 'waiting', auto: true, phone: '4175550001', at: '2026-10-09T20:00:00Z' },
    { id: 'a2', name: 'Katie Parker', state: 'no', picked_by_coordinator: true, phone: '4175550002', at: '2026-10-09T20:01:00Z' },
    { id: 'a3', name: 'Angela Muse', state: 'yes', picked_by_coordinator: true, phone: '4175550003', at: '2026-10-09T20:02:00Z' },
    { id: 'a4', name: 'Rhonda Blakemore', state: 'waiting', channel: 'phone', at: '2026-10-09T20:03:00Z' },
    { id: 'a5', name: 'Emma Daum', state: 'waiting', picked_by_coordinator: true, phone: '4175550005', at: '2026-10-09T20:04:00Z' }], ...o })
const reset = (k, settings) => {
  SENT = []; PATCHES = []; LOG = []; STAFF = { ok: true, name: 'Krystal Office' }; OWNER = false
  APP = { caregivers: [], coverage_cases: [k], ops_settings: { coverage_send_live: true, coverage_quiet_from: 0, coverage_quiet_until: 0, ...(settings || {}) } }
  T = { domains: [], persons: [], contact_optout_current: [], circle_contacts: [], phone_index: [], client_callin_current: [], person_identity: [], person_source_id: [], pay_tracks: [], job_applicants: [] }
}
const q = (t) => { const st = { f: [], inF: null, nn: [] }; const b = {
  select() { return b }, order() { return b }, limit() { return b }, gte() { return b }, lte() { return b }, lt() { return b }, gt() { return b }, ilike() { return b }, or() { return b }, contains() { return b },
  eq(c, v) { st.f.push([c, v]); return b }, in(c, v) { st.inF = [c, v]; return b }, is() { return b }, not(c, op, v) { if (op === 'is' && v === null) st.nn.push(c); return b },
  update() { return { eq: () => Promise.resolve({ data: null, error: null }) } }, upsert() { return Promise.resolve({ data: null, error: null }) }, insert() { return Promise.resolve({ data: null, error: null }) },
  maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: null })) }, single() { return b.maybeSingle() },
  then(ok, bad) {
    if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]; return Promise.resolve({ data: k in APP ? [{ key: k, data: APP[k] }] : [], error: null }).then(ok, bad) }
    let r = T[t] ?? []; for (const [c, v] of st.f) r = r.filter((x) => x[c] === v); for (const c of st.nn) r = r.filter((x) => x[c] != null)
    if (st.inF) r = r.filter((x) => st.inF[1].includes(x[st.inF[0]])); return Promise.resolve({ data: r, error: null }).then(ok, bad) } }; return b }
globalThis.__db = { from: q, rpc: async (fn, a) => {
  if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => x.id === a.item.id); if (i >= 0) arr[i] = a.item; else arr.push(a.item); if (a.target_key === 'automation_log') LOG.push(a.item) }
  if (fn === 'coverage_case_patch') { PATCHES.push(a); const c = (APP.coverage_cases || []).find((x) => x.id === a.p_id); if (!c) return { data: { outcome: 'not_found' }, error: null }
    for (const k of Object.keys(a.p_expect || {})) if (c[k] !== a.p_expect[k]) return { data: { outcome: 'conflict', item: c }, error: null }
    Object.assign(c, a.p_patch); return { data: { outcome: 'ok', item: c }, error: null } }
  return { data: null, error: null } }, auth: { getUser: async () => ({ data: { user: null }, error: { message: 'no' } }) } }
globalThis.__staff = async () => STAFF; globalThis.__owner = async () => OWNER
let REFUSE = new Set()
globalThis.fetch = async (url, o) => {
  url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + (body.phone || body.email), dnd: false } }), { status: 200 })
  if (url.includes('/conversations/messages')) { if (REFUSE.has(body.contactId)) return new Response('{"message":"bad number"}', { status: 422 }); SENT.push({ to: body.contactId, msg: body.message }); return new Response('{}', { status: 200 }) }
  return new Response('{}', { status: 200 })
}
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SVC, GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485', HUB_JOB_SECRET: 'j'.repeat(64) }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const src = fs.readFileSync(`${FN}/coverage-run/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace(/^import \{ jobCaller, ownerCaller \} from .*$/m, 'const jobCaller = async () => null; const ownerCaller = async () => globalThis.__owner()')
  .replace(/^import \{ requireStaff, OFFICE_ROLES \} from .*$/m, 'const OFFICE_ROLES = []; const requireStaff = async () => globalThis.__staff()')
const tmp = path.join(process.cwd(), FN, 'coverage-run', '_t_fu.ts'); fs.writeFileSync(tmp, src)
try { await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
const act = async (body) => { const r = await handler(new Request('https://x/functions/v1/coverage-run', { method: 'POST', headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })); return { status: r.status, out: await r.json() } }
const MSG = "Hi {first_name}, it's Caring Companions. Dan Sat 8am-12pm is still open, and there is a $50 bonus for whoever takes it. Reply YES or NO."

/* 1. the happy path: the two waiting + the no who was ticked; the yes and the phone ask are skipped; an unknown id reported */
reset(kase()); let r = await act({ action: 'follow_up', case_id: 'cwo_s1', ask_ids: ['a1', 'a2', 'a3', 'a4', 'a5', 'zzz'], message: MSG, by: 'Samantha' })
ck('200 with sent / skipped / unknown spelled out', r.status === 200 && JSON.stringify(r.out.sent) === '["Elizabeth Johns","Katie Parker","Emma Daum"]' && r.out.failed.length === 0 && r.out.unknown.includes('zzz'), r.out)
ck('the yes is skipped (confirm them instead) and the phone ask is skipped (never texted)', r.out.skipped.some((s) => /Angela Muse \(said yes/.test(s)) && r.out.skipped.some((s) => /Rhonda Blakemore \(asked by phone/.test(s)), r.out.skipped)
ck('three texts went, {first_name} filled per person, nothing else changed', SENT.length === 3 && SENT[0].msg.startsWith("Hi Elizabeth, it's Caring Companions. Dan Sat 8am-12pm is still open") && SENT[1].msg.startsWith('Hi Katie,') && SENT[2].msg.startsWith('Hi Emma,'), SENT)
ck('recorded on the case as followups[] (not in asked[]), with who, when, the exact text and the ask ids', PATCHES.length === 1 && PATCHES[0].p_id === 'cwo_s1' && Array.isArray(PATCHES[0].p_patch.followups) && PATCHES[0].p_patch.followups.length === 1
  && JSON.stringify(PATCHES[0].p_patch.followups[0].ask_ids) === '["a1","a2","a5"]' && PATCHES[0].p_patch.followups[0].text === MSG && PATCHES[0].p_patch.followups[0].by === 'Samantha' && !('asked' in PATCHES[0].p_patch), PATCHES)
ck('asked[] untouched: still 5, states as they were', APP.coverage_cases[0].asked.length === 5 && APP.coverage_cases[0].asked[1].state === 'no', APP.coverage_cases[0].asked)
ck('automation log line', LOG.some((l) => l.automation === 'coverage-run:follow_up' && l.created === 3 && l.ok === true), LOG)

/* 2. a second follow-up appends, never replaces */
r = await act({ action: 'follow_up', case_id: 'cwo_s1', ask_ids: ['a1'], message: 'Hi {first_name}, one more nudge. Reply YES or NO.', by: 'Samantha' })
ck('second follow-up appends to followups[]', r.status === 200 && APP.coverage_cases[0].followups.length === 2 && APP.coverage_cases[0].followups[1].ask_ids.join() === 'a1', APP.coverage_cases[0].followups)

/* 3. a refused text is reported, not recorded, not silent (ghlSendChecked raises the card) */
reset(kase()); REFUSE = new Set(['C:+14175550005'])
r = await act({ action: 'follow_up', case_id: 'cwo_s1', ask_ids: ['a1', 'a5'], message: MSG, by: 'Samantha' })
ck('a refused send lands in failed, the other goes, only the sent one is recorded', r.out.sent.join() === 'Elizabeth Johns' && r.out.failed.some((f) => /Emma Daum/.test(f)) && PATCHES[0].p_patch.followups[0].ask_ids.join() === 'a1', r.out)
ck('the refusal raised a Send problems card (no silent failures)', (APP.ops_items || []).some((i) => /coverage-run/.test(JSON.stringify(i))), APP.ops_items)
REFUSE = new Set()

/* 4. the gates */
reset(kase()); r = await act({ action: 'follow_up', case_id: 'cwo_s1', ask_ids: ['a1'], message: 'Still open — $50 bonus.', by: 'S' })
ck('em dash refused, nothing sent', r.status === 400 && /em dash/.test(r.out.error) && SENT.length === 0, r.out)
r = await act({ action: 'follow_up', case_id: 'cwo_s1', ask_ids: [], message: MSG }); ck('nobody selected: 400', r.status === 400, r.out)
r = await act({ action: 'follow_up', case_id: 'cwo_s1', ask_ids: ['a1'], message: '   ' }); ck('empty text: 400', r.status === 400, r.out)
r = await act({ action: 'follow_up', case_id: 'cwo_s1', ask_ids: ['a1'], message: 'x'.repeat(601) }); ck('over 600 characters: 400', r.status === 400, r.out)
reset(kase({ status: 'covered' })); r = await act({ action: 'follow_up', case_id: 'cwo_s1', ask_ids: ['a1'], message: MSG }); ck('a closed case: 409, nothing sent', r.status === 409 && SENT.length === 0, r.out)
reset(kase(), { coverage_send_live: false }); r = await act({ action: 'follow_up', case_id: 'cwo_s1', ask_ids: ['a1'], message: MSG }); ck('sending switched off: 409', r.status === 409 && /switched off/.test(r.out.error) && SENT.length === 0, r.out)
reset(kase(), { coverage_quiet_from: 0, coverage_quiet_until: 24 }); r = await act({ action: 'follow_up', case_id: 'cwo_s1', ask_ids: ['a1'], message: MSG }); ck('night hold (shift days away): 409 held_night, nothing sent', r.status === 409 && r.out.held_night === true && SENT.length === 0, r.out)
reset(kase()); STAFF = { ok: false, status: 403, error: 'not office staff' }; r = await act({ action: 'follow_up', case_id: 'cwo_s1', ask_ids: ['a1'], message: MSG }); ck('not office staff: refused', r.status === 403 && SENT.length === 0, r.out)
reset(kase()); r = await act({ action: 'follow_up', case_id: 'nope', ask_ids: ['a1'], message: MSG }); ck('no such case: 404', r.status === 404, r.out)

/* 5. an opted-out caregiver is skipped by the outbound gate, said plainly */
reset(kase()); T.contact_optout_current = [{ address: '+14175550001', channel: 'sms', opted_out: true, source: 'STOP' }]
r = await act({ action: 'follow_up', case_id: 'cwo_s1', ask_ids: ['a1', 'a5'], message: MSG })
ck('opted out: not texted, named in failed, the other still goes', !r.out.sent.includes('Elizabeth Johns') && r.out.sent.includes('Emma Daum') && (r.out.failed.some((f) => /Elizabeth Johns/.test(f))), r.out)

for (const [n, ok, note] of res) console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok ? '' : '  <- ' + note))
const bad = res.filter((x) => !x[1]).length; console.log(bad ? bad + ' FAILED' : res.length + '/' + res.length + ' passed'); process.exit(bad ? 1 : 0)
