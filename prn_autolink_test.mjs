// NO PRN HIRE LEFT UNLINKED (Samantha 2026-10-28): the daily auto-link. The matching rules (_shared/prn-autolink.ts) and the
// real prn-team against a fake database and a fake AxisCare; nothing real is reached. node prn_autolink_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const FN = 'supabase/functions'
let T, APP, AXCG, VOCAB, PATCHES, AXCHANGES, STAFF, PATCH_STATUS
const A1 = '11111111-1111-1111-1111-111111111111', A2 = '22222222-2222-2222-2222-222222222222', A3 = '33333333-3333-3333-3333-333333333333'
const reset = () => {
  STAFF = { ok: true, name: 'Krystal', email: 'k@mo-care.com', roles: ['staffing_coordinator'] }; PATCHES = []; AXCHANGES = []; PATCH_STATUS = 200
  T = { job_applicants: [
      { id: A1, first_name: 'Sarah', last_name: 'Test', phone: '(417) 555-0101', email: 'sarah@example.test', position: 'prn_cna', prn: { days: ['mon', 'sat'], times: ['daytime', 'overnight'] } },
      { id: A2, first_name: 'Mia', last_name: 'Test', phone: '4175550202', email: null, position: 'prn_cna', prn: { days: ['tue'], times: ['morning'] } },
      { id: A3, first_name: 'Ann', last_name: 'Test', phone: '4175550303', email: null, position: 'caregiver', prn: null }],
    job_positions: [{ key: 'prn_cna', track: 'prn', pay_min: 20 }, { key: 'caregiver', track: null, pay_min: 15 }],
    pay_tracks: [], pay_track_history: [], prn_shift_log: [] }
  APP = { pay_rates: [{ id: 'rates', rates: { prn_cna: { min: 20, max: 20 }, cna: { min: 18, max: 18 } } }], caregiver_availability: [] }
  AXCG = { 9001: { id: 9001, mobilePhone: '417-555-0101', personalEmail: 'SARAH@example.test', classes: [{ code: 'ALZ', label: 'ALZHEIMER CERTIFIED' }, { code: 'VAC', label: 'VACCINATED' }] },
           9002: { id: 9002, mobilePhone: '4175559999', personalEmail: null, classes: [] } }
  VOCAB = [{ code: 'ALZ', label: 'ALZHEIMER CERTIFIED' }, { code: 'CNA', label: 'CERTIFIED NURSES AIDE' }, { code: 'PRNT', label: 'PRN Team' }, { code: 'VAC', label: 'VACCINATED' }]
}
const q = (t) => { const st = { f: [], isNull: [], neq: [], inF: null, upd: null }; const b = {
  select() { return b }, order() { return b },
  eq(c, v) { st.f.push([c, v]); return st.upd ? b.run() && b : b }, is(c, v) { if (v === null) st.isNull.push(c); return b },
  neq(c, v) { st.neq.push([c, v]); return b }, in(c, v) { st.inF = [c, v]; return b },
  update(o) { st.upd = o; return b },
  insert(o) { const arr = (T[t] ||= []); if (t === 'prn_shift_log' && arr.some((x) => x.case_id === o.case_id && x.kind === o.kind && x.axiscare_caregiver_id === o.axiscare_caregiver_id))
      return Promise.resolve({ data: null, error: { message: 'duplicate key value violates unique constraint' } }); arr.push(o); return Promise.resolve({ data: null, error: null }) },
  rows() { if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]; return k in APP ? [{ key: k, data: APP[k] }] : [] }
    let r = T[t] ?? []; for (const [c, v] of st.f) r = r.filter((x) => x[c] === v); for (const c of st.isNull) r = r.filter((x) => x[c] == null)
    for (const [c, v] of st.neq) r = r.filter((x) => x[c] !== v); if (st.inF) r = r.filter((x) => st.inF[1].includes(x[st.inF[0]])); return r },
  run() { return true },
  maybeSingle() { return Promise.resolve({ data: b.rows()[0] ?? null, error: null }) },
  then(ok, bad) { if (st.upd) { for (const x of b.rows()) Object.assign(x, st.upd); return Promise.resolve({ data: null, error: null }).then(ok, bad) }
    return Promise.resolve({ data: b.rows(), error: null }).then(ok, bad) } }; return b }
/* pay_track_change, as prn2.sql does it (the SQL itself is tested in Postgres separately) */
const change = (a) => {
  const cur = T.pay_tracks.find((x) => x.applicant_id === a.p_applicant)
  if (!cur) { if (a.p_from_expected !== null || a.p_to !== 'prn_team') return { error: { message: 'NO_TRACK_YET' } }
    T.pay_tracks.push({ applicant_id: a.p_applicant, track: a.p_to, rate: a.p_rate, since: a.p_effective, axiscare_caregiver_id: null }) }
  else { if (a.p_from_expected === null) return { data: { outcome: 'already' } }
    if (cur.track !== a.p_from_expected) return { error: { message: 'TRACK_CHANGED' } }
    Object.assign(cur, { track: a.p_to, rate: a.p_rate, since: a.p_effective }) }
  T.pay_track_history.push({ applicant_id: a.p_applicant, from_track: cur?.track === a.p_to ? null : (cur ? a.p_from_expected : null), to_track: a.p_to, to_rate: a.p_rate, effective_date: a.p_effective, changed_by: a.p_by, reason: a.p_reason })
  return { data: { outcome: 'changed', to: a.p_to, rate: a.p_rate } } }
/* 1037: pay_track_start and pay_team_change, as prn-caregiver-1037.sql does them */
const start = (a) => { if (T.pay_tracks.some((x) => x.applicant_id === a.p_applicant)) return { data: { outcome: 'already' } }
  T.pay_tracks.push({ applicant_id: a.p_applicant, track: 'prn_team', team: a.p_team, rate: a.p_rate, since: a.p_effective, axiscare_caregiver_id: null })
  T.pay_track_history.push({ applicant_id: a.p_applicant, from_track: null, to_track: 'prn_team', to_rate: a.p_rate, effective_date: a.p_effective, changed_by: a.p_by, reason: a.p_reason, from_team: null, to_team: a.p_team })
  return { data: { outcome: 'changed', team: a.p_team, rate: a.p_rate } } }
const teamChange = (a) => { const cur = T.pay_tracks.find((x) => x.applicant_id === a.p_applicant); if (!cur) return { error: { message: 'NO_TRACK_YET' } }
  if ((cur.team || 'cna') !== a.p_from_team) return { error: { message: 'TEAM_CHANGED' } }
  const from = cur.team; Object.assign(cur, { team: a.p_to_team, rate: cur.track === 'prn_team' ? a.p_rate : cur.rate, since: a.p_effective })
  T.pay_track_history.push({ applicant_id: a.p_applicant, from_track: cur.track, to_track: cur.track, to_rate: cur.rate, effective_date: a.p_effective, changed_by: a.p_by, reason: a.p_reason, from_team: from, to_team: a.p_to_team })
  return { data: { outcome: 'changed', from_team: from, to_team: a.p_to_team, rate: cur.rate } } }
globalThis.__db = { from: q, rpc: async (fn, a) => {
  if (fn === 'pay_track_change') return change(a)
  if (fn === 'pay_track_start') return start(a)
  if (fn === 'pay_team_change') return teamChange(a)
  if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => x.id === a.item.id); if (i >= 0) arr[i] = a.item; else arr.push(a.item); return { data: null, error: null } }
  if (fn === 'axiscare_change_record') { AXCHANGES.push(a); return { data: { outcome: 'recorded' }, error: null } }
  return { data: null, error: null } } }
globalThis.fetch = async (url, o) => {
  url = String(url); const m = o?.method || 'GET'
  if (url.endsWith('/api/classes/caregiver')) return new Response(JSON.stringify({ results: { classes: VOCAB } }), { status: 200 })
  const g = url.match(/\/api\/caregivers\/(\d+)$/)
  if (g && m === 'GET') { const c = AXCG[g[1]]; return new Response(JSON.stringify(c ? { results: { data: c } } : {}), { status: c ? 200 : 404 }) }
  if (g && m === 'PATCH') { const body = JSON.parse(o.body); PATCHES.push({ id: g[1], classes: body.classes }); if (PATCH_STATUS !== 200) return new Response('{"errors":["no"]}', { status: PATCH_STATUS })
    AXCG[g[1]].classes = body.classes.map((c) => VOCAB.find((v) => v.code === c.code || v.label === c.label) || c); return new Response('{}', { status: 200 }) }
  return new Response('{}', { status: 404 })
}
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
fs.writeFileSync(`${FN}/_shared/_staff-auth_al.ts`, "export const OFFICE_ROLES = ['owner_admin','care_coordinator','staffing_coordinator']\nexport const requireStaff = async () => globalThis.__staff()\n")
/* the owner's key, as job-auth's ownerCaller recognises it (its probe is tested with the jobs) */
fs.writeFileSync(`${FN}/_shared/_job-auth_al.ts`, "export const ownerCaller = async (req) => (req.headers.get('Authorization') || '') === 'Bearer ' + globalThis.__ownerKey\nexport const jobCaller = async (req) => (req.headers.get('x-cron-secret') || '') === 'cron-secret' ? 'cron' : ((req.headers.get('Authorization') || '') === 'Bearer ' + globalThis.__ownerKey ? 'owner' : null)\n")
process.on('exit', () => { for (const f of ['_staff-auth_al.ts', '_job-auth_al.ts']) { try { fs.unlinkSync(`${FN}/_shared/${f}`) } catch { /* */ } } })
globalThis.__staff = () => STAFF.ok ? STAFF : { ok: false, status: 401, error: 'Sign in first.' }
const src = fs.readFileSync(`${FN}/prn-team/index.ts`, 'utf8')
  .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace(/(['"])\.\.\/_shared\/staff-auth\.ts\1/, "'../_shared/_staff-auth_al.ts'")
  .replace(/(['"])\.\.\/_shared\/job-auth\.ts\1/, "'../_shared/_job-auth_al.ts'")
  .replace(/^import \{ readCensus \} from .*$/m, 'const readCensus = () => globalThis.__census()')
const tmp = path.join(process.cwd(), FN, 'prn-team', '_al.ts'); fs.writeFileSync(tmp, src)
let M; try { M = await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
const call = async (body) => { const r = await handler(new Request('https://x/functions/v1/prn-team', { method: 'POST', headers: { Authorization: 'Bearer x' }, body: JSON.stringify(body) })); return { status: r.status, j: await r.json() } }
const trk = (id) => T.pay_tracks.find((x) => x.applicant_id === id)
const labels = (id) => AXCG[id].classes.map((c) => c.label)
let r

/* ── 1. the rules ── */
const P = await import(path.join(process.cwd(), FN, '_shared/prn-autolink.ts'))
const H = (id, o = {}) => ({ applicant_id: id, first: 'Hire', last: id, phone: '', email: '', team: 'cna', since: '2026-10-25', ...o })
const G = (id, o = {}) => ({ id, first: 'Cg', last: id, active: true, mobile: '', phone: '', home: '', email: '', classes: [], ...o })
const TODAY = '2026-10-28'
let p = P.planLinks([H('a', { phone: '(417) 555-0101' })], [G('9001', { mobile: '417-555-0101' }), G('9002', { mobile: '4175559999' })], new Set(), TODAY)
ck('one active caregiver with the same phone: linked', p.link.length === 1 && p.link[0].axiscare_id === '9001' && p.link[0].how === 'phone' && !p.cards.length, p)
p = P.planLinks([H('a', { email: 'Sarah@Example.test' })], [G('9001', { email: 'sarah@example.test' })], new Set(), TODAY)
ck('same email (any capitals): linked', p.link.length === 1 && p.link[0].how === 'email', p)
p = P.planLinks([H('a', { phone: '4175550101' })], [G('9001', { home: '417.555.0101' })], new Set(), TODAY)
ck('their home phone in AxisCare counts too', p.link.length === 1, p)
p = P.planLinks([H('a', { first: 'Sarah', last: 'Test' })], [G('9001', { first: 'Sarah', last: 'Test' })], new Set(), TODAY)
ck('a name alone is never enough', !p.link.length, p)
p = P.planLinks([H('a', { phone: '4175550101' })], [G('9001', { mobile: '4175550101' }), G('9002', { mobile: '4175550101' })], new Set(), TODAY)
ck('two AxisCare caregivers match: not linked, a card names both', !p.link.length && p.cards.length === 1 && /2 AxisCare caregivers match/.test(p.cards[0].title), p)
p = P.planLinks([H('a', { phone: '4175550101' }), H('b', { email: 'x@y.test' })], [G('9001', { mobile: '4175550101', email: 'x@y.test' })], new Set(), TODAY)
ck('two PRN hires match one caregiver: neither linked, both carded', !p.link.length && p.cards.length === 2 && p.cards.every((c) => /another PRN hire/.test(c.title)), p)
p = P.planLinks([H('a', { phone: '4175550101' })], [G('9001', { mobile: '4175550101' })], new Set(['9001']), TODAY)
ck('the match is already linked to someone else: not linked, carded', !p.link.length && /linked to someone else/.test(p.cards[0]?.title), p)
p = P.planLinks([H('a', { phone: '4175550101' })], [G('9001', { mobile: '4175550101', active: false })], new Set(), TODAY)
ck('the match is inactive in AxisCare: not linked, carded (linked once Active)', !p.link.length && /inactive/.test(p.cards[0]?.title), p)
p = P.planLinks([H('a', { phone: '4175550101', since: '2026-10-25' })], [], new Set(), TODAY)
ck('not in AxisCare yet, 3 days on the team: no card yet (still onboarding)', !p.cards.length && p.waiting.length === 1, p)
p = P.planLinks([H('a', { first: 'Keisha', last: 'Lee', phone: '4175550101', since: '2026-10-20' })], [], new Set(), TODAY)
ck('not in AxisCare after 8 days: a card says so, with the next step', p.cards.length === 1 && /^Keisha Lee \(PRN CNA Team\) isn't in AxisCare yet$/.test(p.cards[0].title) && /8 days ago/.test(p.cards[0].detail), p)
p = P.planLinks([], [G('9005', { first: 'Tom', last: 'Ray', classes: ['L2 - PC', 'PRN TEAM - CNA'] }), G('9006', { classes: ['PRN TEAM - CNA'] })], new Set(['9006']), TODAY)
ck('tagged PRN TEAM in AxisCare but not on the Hub\'s list: carded; one on the list: not', p.cards.length === 1 && /^Tom Ray is tagged PRN TEAM - CNA in AxisCare but isn't on the Hub's PRN list$/.test(p.cards[0].title), p)
ck('no em dash in any card', !/—/.test(JSON.stringify(P.planLinks([H('a', { phone: '1', since: '2026-01-01' })], [G('9', { classes: ['PRN TEAM - CNA'] })], new Set(), TODAY))))

/* ── 2. the real prn-team: the daily run ── */
const fakeCensus = (rows) => async () => ({ ok: true, rows, total: rows.length, truncated: false })
const auto = async (headers, q = '') => { const r = await handler(new Request('https://x/functions/v1/prn-team?auto_link=1' + q, { method: 'POST', headers })); return { status: r.status, j: await r.json() } }
const CRON = { 'x-cron-secret': 'cron-secret' }
const setup = (live) => { reset(); APP.ops_settings = live ? { prn_autolink_live: true } : {}; APP.ops_items = []
  T.pay_tracks = [{ applicant_id: A1, track: 'prn_team', team: 'cna', rate: 20, since: '2026-10-01', axiscare_caregiver_id: null },
                  { applicant_id: A2, track: 'prn_team', team: 'cna', rate: 20, since: '2026-10-01', axiscare_caregiver_id: null }]
  VOCAB = [{ code: 'ALZ', label: 'ALZHEIMER CERTIFIED' }, { code: 'CNA', label: 'CERTIFIED NURSES AIDE' }, { code: 'PRNC', label: 'PRN TEAM - CNA' }, { code: 'VAC', label: 'VACCINATED' }] }
const CEN = [{ id: '9001', first: 'Sarah', last: 'Test', active: true, mobile: '417-555-0101', phone: '417-555-0101', email: 'sarah@example.test', classes: ['ALZHEIMER CERTIFIED'] },
             { id: '9002', first: 'Other', last: 'Person', active: true, mobile: '4175559999', phone: '4175559999', email: '', classes: [] }]
globalThis.__census = fakeCensus(CEN)
setup(false); r = await auto({})
ck('an outsider is refused', r.status === 401, r)
r = await auto(CRON, '&auth_check=1')
ck('the schedule\'s auth check answers who it is, and runs nothing', r.status === 200 && r.j.caller === 'cron' && !('seen' in r.j), r.j)
setup(false); r = await auto(CRON)
ck('switch off: worked out (1 to link, Mia carded) and nothing changed', r.status === 200 && r.j.live === false && r.j.would_link === 1 && r.j.cards === 1 && r.j.linked === 0
  && !trk(A1).axiscare_caregiver_id && !PATCHES.length && !APP.ops_items.length, r.j)
setup(true); r = await auto(CRON)
const card = (id) => APP.ops_items.find((x) => x.id === id)
ck('switch on: Sarah (one exact phone match) is linked, recorded as automatic', r.j.linked === 1 && trk(A1).axiscare_caregiver_id === '9001' && /automatically/.test(trk(A1).linked_by), [r.j, trk(A1)])
ck('switch on: and tagged PRN TEAM - CNA plus CNA in AxisCare, her other classes kept, read back and recorded', r.j.tagged === 1
  && JSON.stringify(labels(9001).sort()) === JSON.stringify(['ALZHEIMER CERTIFIED', 'CERTIFIED NURSES AIDE', 'PRN TEAM - CNA', 'VACCINATED'].sort())
  && AXCHANGES.some((x) => x.p_outcome === 'sent_confirmed' && /Tagged automatically/.test(x.p_by)), [labels(9001), AXCHANGES])
ck('switch on: her application\'s days and times become her starting availability', APP.caregiver_availability.some((x) => x.axiscare_id === '9001' && x.source === 'application'), APP.caregiver_availability)
ck('switch on: Mia (no AxisCare caregiver with her phone after 27 days) gets a Needs Attention card', !trk(A2).axiscare_caregiver_id && /isn't in AxisCare yet/.test(card('prn_link_' + A2)?.title || '') && card('prn_link_' + A2).status === 'open', APP.ops_items)
const before = APP.ops_items.length; r = await auto(CRON)
ck('the next day: nothing linked twice, no second card', r.j.linked === 0 && APP.ops_items.length === before && PATCHES.length === 1, [r.j, PATCHES.length])
setup(true); globalThis.__census = async () => ({ ok: false, error: 'AxisCare answered 503 on page 1' }); r = await auto(CRON)
ck('AxisCare can\'t be read: nobody linked, it says why', r.j.ok === false && /could not be read/.test(r.j.error) && !trk(A1).axiscare_caregiver_id, r.j)
globalThis.__census = fakeCensus(CEN)
setup(true); PATCH_STATUS = 403; r = await auto(CRON)
ck('AxisCare refuses the tag: still linked, and a card says to tag them by hand', trk(A1).axiscare_caregiver_id === '9001' && /wasn't added in AxisCare/.test(card('prn_tag_fail_' + A1)?.title || ''), [r.j, APP.ops_items])
setup(true); APP.ops_items = [{ id: 'prn_link_' + A1, status: 'open', title: 'old' }]; PATCH_STATUS = 200; r = await auto(CRON)
ck('an open card for someone who is now linked is closed', card('prn_link_' + A1).status === 'done', card('prn_link_' + A1))
ck('the run is logged with what it saw and did', (APP.automation_log || []).some((x) => x.automation === 'prn-team:auto_link' && x.rows_seen === 2 && x.created === 1), APP.automation_log)
r = await call({ action: 'link', applicant_id: A2, axiscare_caregiver_id: '9002' })
ck('the office\'s own Link them still refuses a caregiver whose phone and email don\'t match', r.j.outcome === 'no_match', r)

for (const [n, o, d] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n     ' + d))
console.log(`${res.filter((x) => x[1]).length}/${res.length}`)
