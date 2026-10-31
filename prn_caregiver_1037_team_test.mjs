// 1037 · prn-team for the PRN CAREGIVER TEAM (two teams, decision 5 and 6), on the prn2_team_test.mjs harness.
// PRN2 · prn-team: start, link, AxisCare classes and Move to ongoing. The real function against a fake database and a
// fake AxisCare; nothing real is reached. One pay track at a time is the rule under test. node prn2_team_test.mjs
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
fs.writeFileSync(`${FN}/_shared/_staff-auth_stub.ts`, "export const OFFICE_ROLES = ['owner_admin','care_coordinator','staffing_coordinator']\nexport const requireStaff = async () => globalThis.__staff()\n")
/* the owner's key, as job-auth's ownerCaller recognises it (its probe is tested with the jobs) */
fs.writeFileSync(`${FN}/_shared/_job-auth_prn.ts`, "export const ownerCaller = async (req) => (req.headers.get('Authorization') || '') === 'Bearer ' + globalThis.__ownerKey\nexport const jobCaller = async (req) => (req.headers.get('x-cron-secret') || '') === 'cron-secret' ? 'cron' : ((req.headers.get('Authorization') || '') === 'Bearer ' + globalThis.__ownerKey ? 'owner' : null)\n")
process.on('exit', () => { for (const f of ['_staff-auth_stub.ts', '_job-auth_prn.ts']) { try { fs.unlinkSync(`${FN}/_shared/${f}`) } catch { /* */ } } })
globalThis.__staff = () => STAFF.ok ? STAFF : { ok: false, status: 401, error: 'Sign in first.' }
const src = fs.readFileSync(`${FN}/prn-team/index.ts`, 'utf8')
  .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace(/(['"])\.\.\/_shared\/staff-auth\.ts\1/, "'../_shared/_staff-auth_stub.ts'")
  .replace(/(['"])\.\.\/_shared\/job-auth\.ts\1/, "'../_shared/_job-auth_prn.ts'")
const tmp = path.join(process.cwd(), FN, 'prn-team', '_t1037.ts'); fs.writeFileSync(tmp, src)
let M; try { M = await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
const call = async (body) => { const r = await handler(new Request('https://x/functions/v1/prn-team', { method: 'POST', headers: { Authorization: 'Bearer x' }, body: JSON.stringify(body) })); return { status: r.status, j: await r.json() } }

const C1 = '44444444-4444-4444-4444-444444444444'
const setup = () => { reset()
  T.job_applicants.push({ id: C1, first_name: 'Cara', last_name: 'Test', phone: '4175550404', email: 'cara@example.test', position: 'prn_caregiver', prn: { days: ['wed'], times: ['evening'] } })
  T.job_positions.push({ key: 'prn_caregiver', track: 'prn', pay_min: 18, requires_cna: false, label: 'PRN Caregiver Team' })
  T.job_positions[0].requires_cna = true
  APP.pay_rates[0].rates = { prn_cna: { min: 20 }, cna: { min: 18 }, prn_caregiver: { min: 18 }, caregiver: { min: 16 } }
  AXCG[9004] = { id: 9004, mobilePhone: '4175550404', personalEmail: 'cara@example.test', classes: [{ code: 'VAC', label: 'VACCINATED' }] }
  VOCAB = [{ code: 'CNA', label: 'CERTIFIED NURSES AIDE' }, { code: 'PRNC', label: 'PRN TEAM - CNA' }, { code: 'PRNG', label: 'PRN TEAM - CAREGIVER' }, { code: 'VAC', label: 'VACCINATED' }] }
setup()
let r = await call({ action: 'start', applicant_id: C1 })
const tr = () => T.pay_tracks.find((x) => x.applicant_id === C1)
ck('start: the role’s own key decides the team: PRN Caregiver Team at $18 (pay_rates prn_caregiver), history says so', r.j.outcome === 'started' && r.j.team === 'caregiver' && r.j.rate === 18 && tr().team === 'caregiver' && T.pay_track_history.some((h) => h.to_team === 'caregiver' && /PRN Caregiver Team/.test(h.reason)), r.j)
r = await call({ action: 'start', applicant_id: A1 })
ck('a PRN CNA applicant still starts on the CNA team at $20', r.j.team === 'cna' && r.j.rate === 20)
r = await call({ action: 'link', applicant_id: C1, axiscare_caregiver_id: '9004' })
r = await call({ action: 'classes', applicant_id: C1 })
ck('classes: two PRN classes in AxisCare (one per team) never make it refuse; the caregiver team’s is found', r.j.ready === true && r.j.team === 'caregiver' && !r.j.why.length, r.j)
r = await call({ action: 'mark', applicant_id: C1 })
ck('mark: adds PRN TEAM - CAREGIVER only, never CNA; every other class kept; read back and logged', r.j.outcome === 'updated' && AXCG[9004].classes.map((c) => c.label).sort().join() === 'PRN TEAM - CAREGIVER,VACCINATED' && AXCHANGES.length === 1, { j: r.j, cl: AXCG[9004].classes })
VOCAB = VOCAB.filter((c) => c.code !== 'PRNG')
r = await call({ action: 'classes', applicant_id: C1 })
ck('if PRN TEAM - CAREGIVER is missing in AxisCare it says so by name (Samantha adds it once)', r.j.ready === false && /no PRN TEAM - CAREGIVER caregiver class/.test(r.j.why.join()), r.j)
VOCAB.push({ code: 'PRNG', label: 'PRN TEAM - CAREGIVER' })
r = await call({ action: 'to_cna_team', applicant_id: C1 })
ck('to_cna_team needs a reason', r.j.outcome === 'incomplete')
r = await call({ action: 'to_cna_team', applicant_id: C1, reason: 'CNA certificate earned, registry checked Oct 21' })
ck('to_cna_team: on the PRN CNA Team at the prn_cna rate ($20), the history names who, when and why', r.j.outcome === 'moved' && tr().team === 'cna' && tr().rate === 20 && T.pay_track_history.some((h) => h.from_team === 'caregiver' && h.to_team === 'cna' && h.changed_by === 'Krystal' && /registry/.test(h.reason)), { j: r.j, h: T.pay_track_history })
ck('...AxisCare: PRN TEAM - CAREGIVER off, PRN TEAM - CNA and CNA on, everything else kept, read back', AXCG[9004].classes.map((c) => c.label).sort().join() === 'CERTIFIED NURSES AIDE,PRN TEAM - CNA,VACCINATED' && r.j.axiscare.outcome === 'updated', { ax: r.j.axiscare, cl: AXCG[9004].classes })
r = await call({ action: 'to_cna_team', applicant_id: C1, reason: 'again' })
ck('to_cna_team twice: already on the PRN CNA Team, nothing changed', r.j.outcome === 'already')
/* move to ongoing on the caregiver team: $16 */
setup(); await call({ action: 'start', applicant_id: C1 })
r = await call({ action: 'move', applicant_id: C1, to: 'ongoing', from: 'prn_team', effective_date: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }), reason: 'took a regular client' })
ck('move to ongoing on the caregiver team: the ongoing caregiver rate, $16 (pay_rates caregiver)', r.j.outcome === 'moved' && tr().track === 'ongoing' && tr().rate === 16, r.j)
ck('prnTeamOf: "PRN TEAM - CAREGIVER" is the caregiver team, "PRN TEAM - CNA" and an older plain "PRN Team" the CNA team, CNA alone neither', M.prnTeamOf({ label: 'PRN TEAM - CAREGIVER' }) === 'caregiver' && M.prnTeamOf({ label: 'PRN TEAM - CNA' }) === 'cna' && M.prnTeamOf({ label: 'PRN Team' }) === 'cna' && M.prnTeamOf({ label: 'CERTIFIED NURSES AIDE' }) === null)
for (const [n, o, note] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n   ' + note))
console.log(res.filter((x) => x[1]).length + '/' + res.length); process.exit(res.every((x) => x[1]) ? 0 : 1)
