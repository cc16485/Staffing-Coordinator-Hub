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
globalThis.__db = { from: q, rpc: async (fn, a) => {
  if (fn === 'pay_track_change') return change(a)
  if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => x.id === a.item.id); if (i >= 0) arr[i] = a.item; else arr.push(a.item); return { data: null, error: null } }
  if (fn === 'axiscare_change_record') { AXCHANGES.push(a); return { data: { outcome: 'recorded' }, error: null } }
  return { data: null, error: null } } }
globalThis.fetch = async (url, o) => {
  url = String(url); const m = o?.method || 'GET'
  if (url.endsWith('/api/classes/caregiver')) return new Response(JSON.stringify({ results: { classes: VOCAB } }), { status: 200 })
  const g = url.match(/\/api\/caregivers\/(\d+)$/)
  if (g && m === 'GET') { const c = AXCG[g[1]]; return new Response(JSON.stringify(c ? { results: { caregiver: c } } : {}), { status: c ? 200 : 404 }) }
  if (g && m === 'PATCH') { const body = JSON.parse(o.body); PATCHES.push({ id: g[1], classes: body.classes }); if (PATCH_STATUS !== 200) return new Response('{"errors":["no"]}', { status: PATCH_STATUS })
    AXCG[g[1]].classes = body.classes.map((c) => VOCAB.find((v) => v.code === c.code || v.label === c.label) || c); return new Response('{}', { status: 200 }) }
  return new Response('{}', { status: 404 })
}
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
fs.writeFileSync(`${FN}/_shared/_staff-auth_stub.ts`, "export const OFFICE_ROLES = ['owner_admin','care_coordinator','staffing_coordinator']\nexport const requireStaff = async () => globalThis.__staff()\n")
process.on('exit', () => { try { fs.unlinkSync(`${FN}/_shared/_staff-auth_stub.ts`) } catch { /* */ } })
globalThis.__staff = () => STAFF.ok ? STAFF : { ok: false, status: 401, error: 'Sign in first.' }
const src = fs.readFileSync(`${FN}/prn-team/index.ts`, 'utf8')
  .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace(/(['"])\.\.\/_shared\/staff-auth\.ts\1/, "'../_shared/_staff-auth_stub.ts'")
const tmp = path.join(process.cwd(), FN, 'prn-team', '_t.ts'); fs.writeFileSync(tmp, src)
let M; try { M = await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
const call = async (body) => { const r = await handler(new Request('https://x/functions/v1/prn-team', { method: 'POST', headers: { Authorization: 'Bearer x' }, body: JSON.stringify(body) })); return { status: r.status, j: await r.json() } }
const trk = (id) => T.pay_tracks.find((x) => x.applicant_id === id)
const labels = (id) => AXCG[id].classes.map((c) => c.label)

reset(); STAFF.ok = false; let r = await call({ action: 'list' })
ck('not signed-in office staff: refused before anything is read', r.status === 401, r)
reset(); r = await call({ action: 'start', applicant_id: A3 })
ck('start: a caregiver applicant is not put on the PRN Team', r.j.outcome === 'not_prn' && !T.pay_tracks.length, r)
r = await call({ action: 'start', applicant_id: A1 })
ck('start: a PRN hire joins the PRN CNA Team at the approved $20, one history line with who and why', r.j.outcome === 'started' && trk(A1).track === 'prn_team' && trk(A1).rate === 20
   && T.pay_track_history.length === 1 && T.pay_track_history[0].changed_by === 'Krystal' && /Joined the PRN CNA Team/.test(T.pay_track_history[0].reason), [r, T])
r = await call({ action: 'start', applicant_id: A1 }); ck('start twice: nothing new', r.j.outcome === 'already' && T.pay_track_history.length === 1, r)
r = await call({ action: 'mark', applicant_id: A1 }); ck('mark before linking: refused, says to link first', r.j.outcome === 'not_linked' && !PATCHES.length, r)
// linking
r = await call({ action: 'link', applicant_id: A1, axiscare_caregiver_id: '9002' }); ck('link: phone and email don\'t match, not linked', r.j.outcome === 'no_match' && !trk(A1).axiscare_caregiver_id, r)
await call({ action: 'start', applicant_id: A2 }); T.job_applicants[1].phone = '417.555.0101'
r = await call({ action: 'link', applicant_id: A1, axiscare_caregiver_id: '9001' }); ck('link: two PRN hires match the same caregiver, nothing linked', r.j.outcome === 'two_match' && !trk(A1).axiscare_caregiver_id, r)
T.job_applicants[1].phone = '4175550202'
r = await call({ action: 'link', applicant_id: A1, axiscare_caregiver_id: '9001' })
const av = APP.caregiver_availability.find((x) => x.id === '9001')
ck('link: one exact match (phone digits, email any case), linked by who; application days/times become availability ("Daytime" stored as afternoon)',
   r.j.outcome === 'linked' && trk(A1).axiscare_caregiver_id === '9001' && trk(A1).linked_by === 'Krystal' && r.j.availability === 'from_application'
   && JSON.stringify(av.windows) === JSON.stringify({ mon: ['afternoon', 'overnight'], tue: [], wed: [], thu: [], fri: [], sat: ['afternoon', 'overnight'], sun: [] }) && av.source === 'application', [r, av])
r = await call({ action: 'link', applicant_id: A2, axiscare_caregiver_id: '9001' }); ck('the same caregiver can\'t be linked to a second hire', r.j.outcome === 'caregiver_taken', r)
reset(); await call({ action: 'start', applicant_id: A1 }); APP.caregiver_availability = [{ id: '9001', axiscare_id: '9001', windows: { mon: ['morning'] }, source: 'self' }]
r = await call({ action: 'link', applicant_id: A1, axiscare_caregiver_id: '9001' })
ck('link: availability they set themselves is kept, never overwritten', r.j.availability === 'kept' && APP.caregiver_availability[0].source === 'self' && APP.caregiver_availability.length === 1, r)
// AxisCare classes
VOCAB = VOCAB.filter((v) => v.code !== 'PRNT')
r = await call({ action: 'classes', applicant_id: A1 }); ck('classes: says PRN Team doesn\'t exist in AxisCare yet (read only)', r.j.ready === false && /no PRN Team caregiver class/.test(r.j.why.join()) && !PATCHES.length, r)
r = await call({ action: 'mark', applicant_id: A1 }); ck('mark with the class missing: refused, says to create it, nothing changed', r.j.outcome === 'classes_missing' && /Create them in AxisCare/.test(r.j.detail) && !PATCHES.length, r)
VOCAB.push({ code: 'PRNT', label: 'PRN Team' })
r = await call({ action: 'mark', applicant_id: A1 })
ck('mark: PRN Team and CNA added, every other class kept, read back, logged, marked by who', r.j.outcome === 'updated' && labels(9001).sort().join('|') === ['ALZHEIMER CERTIFIED', 'CERTIFIED NURSES AIDE', 'PRN Team', 'VACCINATED'].sort().join('|')
   && AXCHANGES.length === 1 && AXCHANGES[0].p_outcome === 'sent_confirmed' && AXCHANGES[0].p_subject === 'caregiver' && trk(A1).axiscare_marked_by === 'Krystal', [r, labels(9001)])
r = await call({ action: 'mark', applicant_id: A1 }); ck('mark again: nothing sent', r.j.outcome === 'already' && PATCHES.length === 1, r)
// Move to ongoing
r = await call({ action: 'move', applicant_id: A1, to: 'ongoing', effective_date: '2026-10-05', from: 'prn_team', reason: '' })
ck('move without a reason: refused, nothing changed', r.j.outcome === 'incomplete' && trk(A1).track === 'prn_team', r)
r = await call({ action: 'move', applicant_id: A1, to: 'ongoing', effective_date: '2027-06-01', from: 'prn_team', reason: 'x' })
ck('move with a date months away: refused', r.j.outcome === 'incomplete', r)
r = await call({ action: 'move', applicant_id: A1, to: 'ongoing', effective_date: '2026-10-05', from: 'ongoing', reason: 'x' })
ck('move from a stale page: refused', r.j.outcome === 'changed_meanwhile' && trk(A1).track === 'prn_team', r)
const eff = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
r = await call({ action: 'move', applicant_id: A1, to: 'ongoing', effective_date: eff, from: 'prn_team', reason: 'Transitioned to ongoing scheduled shifts' })
const last = T.pay_track_history[T.pay_track_history.length - 1]
ck('Move to ongoing: ongoing at the approved CNA rate ($18), history line with the date, who and why', r.j.outcome === 'moved' && trk(A1).track === 'ongoing' && trk(A1).rate === 18
   && last.to_track === 'ongoing' && last.to_rate === 18 && last.effective_date === eff && last.changed_by === 'Krystal' && last.reason === 'Transitioned to ongoing scheduled shifts', [r, last])
ck('... and in AxisCare: PRN Team off, CNA and everything else kept, read back, logged', r.j.axiscare.outcome === 'updated' && !labels(9001).includes('PRN Team')
   && labels(9001).includes('CERTIFIED NURSES AIDE') && labels(9001).includes('VACCINATED') && AXCHANGES.at(-1).p_summary === 'PRN Team removed (moved to ongoing)', [r, labels(9001)])
r = await call({ action: 'mark', applicant_id: A1 }); ck('an ongoing caregiver can\'t be marked PRN Team', r.j.outcome === 'not_prn', r)
r = await call({ action: 'move', applicant_id: A1, to: 'prn_team', effective_date: eff, from: 'ongoing', reason: 'Asked to come back to PRN' })
ck('Back on the PRN Team: $20 again, the same kind of recorded step, PRN Team back in AxisCare', r.j.outcome === 'moved' && trk(A1).track === 'prn_team' && trk(A1).rate === 20
   && T.pay_track_history.length === 3 && labels(9001).includes('PRN Team') && labels(9001).includes('CERTIFIED NURSES AIDE'), [r, labels(9001)])
PATCH_STATUS = 403
r = await call({ action: 'move', applicant_id: A1, to: 'ongoing', effective_date: eff, from: 'prn_team', reason: 'Transitioned to ongoing scheduled shifts' })
ck('AxisCare refuses: the track change still stands (the Hub is the record), the refusal is shown and logged', r.j.outcome === 'moved' && trk(A1).track === 'ongoing'
   && r.j.axiscare.outcome === 'refused' && AXCHANGES.at(-1).p_outcome === 'refused', r)
// the rule, in the source
const code = fs.readFileSync(`${FN}/prn-team/index.ts`, 'utf8')
ck('no visit, shift or payroll writes anywhere in it (one rate per person, nothing per shift)', !/\/api\/visits|\/api\/shifts|payroll|visit.*rate|payRate/i.test(code.replace(/\/\/.*$/gm, '')))
ck('rates come from the approved Pay rates: PRN CNA Team and CNA', M.windowsFrom && /rec\?\.prn_cna\?\.min/.test(code) && /rec\?\.cna\?\.min/.test(code))
ck('the class rules: "PRN Team" reads as PRN Team; "CERTIFIED NURSES AIDE" and code CNA read as CNA; others don\'t', M.isPrnClass({ label: 'PRN Team' }) && M.isCnaClass({ label: 'CERTIFIED NURSES AIDE' })
   && M.isCnaClass({ code: 'CNA' }) && !M.isPrnClass({ label: 'VACCINATED' }) && !M.isCnaClass({ label: 'CAREGIVER' }))
reset(); ENV.SUPABASE_SERVICE_ROLE_KEY = 'svc-key'
const callKey = async (body, key) => { const r = await handler(new Request('https://x/functions/v1/prn-team', { method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: JSON.stringify(body) })); return { status: r.status, j: await r.json() } }
r = await callKey({ action: 'vocab' }, 'svc-key'); ck('the server key can ask which classes exist (read only)', r.status === 200 && r.j.prn === 'PRN Team' && r.j.cna === 'CERTIFIED NURSES AIDE' && !PATCHES.length, r)
r = await callKey({ action: 'move', applicant_id: A1, to: 'ongoing' }, 'svc-key'); ck('... and nothing else', r.status === 403 && !T.pay_track_history.length, r)
STAFF.ok = false; r = await callKey({ action: 'vocab' }, 'not-the-key'); ck('any other key is treated as a person and refused without a staff sign-in', r.status === 401, r)
/* PRN3: the shift record */
reset(); ENV.SUPABASE_SERVICE_ROLE_KEY = 'k'
await call({ action: 'start', applicant_id: A1 }); trk(A1).axiscare_caregiver_id = '9001'
r = await call({ action: 'shift', axiscare_caregiver_id: '9001', case_id: 'cv1', kind: 'confirmed', shift_date: '2026-10-04' })
ck('PRN3 shift: a PRN member confirmed on a shift is recorded, by who', r.j.outcome === 'recorded' && T.prn_shift_log.length === 1 && T.prn_shift_log[0].recorded_by === 'Krystal' && T.prn_shift_log[0].applicant_id === A1, [r, T.prn_shift_log])
r = await call({ action: 'shift', axiscare_caregiver_id: '9001', case_id: 'cv1', kind: 'confirmed', shift_date: '2026-10-04' })
ck('... the same shift twice is recorded once', r.j.outcome === 'already' && T.prn_shift_log.length === 1, r)
r = await call({ action: 'shift', axiscare_caregiver_id: '9001', case_id: 'cv1', kind: 'backed_out', shift_date: '2026-10-04' })
ck('... backing out after confirming is its own line', r.j.outcome === 'recorded' && T.prn_shift_log.length === 2 && T.prn_shift_log[1].kind === 'backed_out', r)
trk(A1).track = 'ongoing'
r = await call({ action: 'shift', axiscare_caregiver_id: '9001', case_id: 'cv2', kind: 'confirmed' })
ck('... not recorded for someone who is an ongoing caregiver now', r.j.outcome === 'not_prn' && T.prn_shift_log.length === 2, r)
r = await call({ action: 'shift', axiscare_caregiver_id: 'x', case_id: '', kind: 'maybe' }); ck('... a malformed request is refused', r.status === 400, r)
r = await call({ action: 'list' }); ck('... and the list carries the shift record', r.j.shifts?.length === 2, r)
for (const [n, o, d] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n     ' + d))
console.log(`${res.filter((x) => x[1]).length}/${res.length}`)
