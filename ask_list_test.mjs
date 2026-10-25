// THE THREE-GROUP ASK LIST (Samantha 2026-10-24, mockup PtLEzsAjvGybxXsTtXk926): every caregiver in Ready to ask /
// Possible with your review / Do not ask, contacted or not, and why; a Level 1 caregiver reviewed for a Level 2 shift by a
// person (never by Cara), recorded on the shift, then offered. The pure rules (_shared/ask-list.ts) and the real coverage-run.
// HUB=<care-coordinator-hub dir> node ask_list_test.mjs
import fs from 'fs'; import path from 'path'; import vm from 'vm'; import crypto from 'crypto'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions'), HUB = process.env.HUB || path.join(ROOT, '../cc-hub-cara-p1')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1500)])
const RULES = fs.readFileSync(path.join(HUB, 'match-rules.js'), 'utf8'); vm.runInThisContext(RULES); const MR = globalThis.CCMatch
const ELIG = "globalThis.CCElig = { eligibility: (r) => r.elig || { state: 'eligible', summary: 'ok' } };"
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex')
const R = await import(path.join(FN, '_shared/cara-run.ts'))

const A = await import(path.join(FN, '_shared/ask-list.ts'))
/* ── 1. the rules ── */
ck('reasons: a level or skill gap can be reviewed; a restriction, Do Not Return, a client requirement or missing training can\'t',
  A.skillCode('Approved level 1; this client needs Level 2') === 'level' && A.skillCode('A Hoyer or other mechanical lift: no experience on record') === 'skill' && A.skillCode('Not cleared to drive clients: x') === 'drive'
  && A.skillCode('Toileting and incontinence care: not at this time') === 'restriction' && A.skillCode('Do Not Return for this client') === 'dnr' && A.skillCode('The client requires a female caregiver') === 'client_requires' && A.skillCode('Dementia training not complete') === 'training')
const care = { cg_level: 1, tasks: [{ key: 'bathing', label: 'Bathing or showering', level: 2, verified: false }, { key: 'meals_housekeeping', label: 'Meals', level: 1, verified: true }] }
ck('blocking: a Level 2 task stands in the way of a Level 1 caregiver; moved or not needed tonight, it no longer does', A.blockingTasks(care, 1).map((t) => t.key).join() === 'bathing' && A.blockingTasks(care, 1, { bathing: 'moved' }).length === 0 && A.blockingTasks(care, 2).length === 0)
const care2 = { cg_level: 1, tasks: [...care.tasks, { key: 'toileting', label: 'Toileting and incontinence care', level: 2, verified: false }] }
const RV = { kind: 'care', care: care2, cg_level: 1 }
ck('approval: refused while any task still stands in the way, naming it', /Still in the way: Toileting/.test(A.checkApproval(RV, { adjust: { bathing: 'moved' }, moved_to: 'Sun 9am', checks: { skills: true, payer: true }, agreed_by: 'Lisa', why: 'x' }).why || ''))
const ok = { adjust: { bathing: 'moved', toileting: 'not_needed' }, moved_to: 'Sun 9am', checks: { skills: true, payer: true }, agreed_by: 'Lisa (daughter), phone', why: 'only shower is Level 2' }
ck('approval: needs both checks, who agreed, why, and when a moved task will be done', A.checkApproval(RV, ok).ok && !A.checkApproval(RV, { ...ok, checks: { skills: true } }).ok && !A.checkApproval(RV, { ...ok, agreed_by: '' }).ok
  && !A.checkApproval(RV, { ...ok, why: ' ' }).ok && !A.checkApproval(RV, { ...ok, moved_to: '' }).ok && !A.checkApproval({ kind: 'call' }, ok).ok)
ck('approval: records exactly which tasks changed and how', JSON.stringify(A.checkApproval(RV, ok).adjusted) === '[{"key":"bathing","label":"Bathing or showering","change":"moved"},{"key":"toileting","label":"Toileting and incontinence care","change":"not_needed"}]')
{ const kase = { shift_date: '2026-10-25', shift_time: '22:00-06:00', asked: [{ name: 'Maria L', axiscare_id: '1', state: 'no', cara_wave: 1, at: 't', auto: true }] }
  const g = A.threeGroups(kase, [{ row: { name: 'Maria L', axiscare_id: '1', history: { visits: 12 }, why: '12 visits' }, prn: false, note: null }],
    [{ name: 'Jody D', axiscare_id: '2', why: '50h', code: 'overtime' }, { name: 'Denise R', axiscare_id: '3', why: 'with Edward', code: 'working' }, { name: 'Mary E', axiscare_id: '4', why: 'TB', code: 'needs_verification' }],
    [{ name: 'Amy D', axiscare_id: '5', why: 'Level 1 caregiver; client needs Level 2', code: 'level', cg_level: 1, client_level: 2, care }, { name: 'Kim A', axiscare_id: '6', why: 'DNR', code: 'dnr' }, { name: 'Old', code: 'inactive', why: 'x' }, { name: 'Katie P', code: 'caller', why: 'called off' }])
  ck('three groups: ready (contacted, with the answer), review (care with what blocks; your call), do not ask; inactive only counted',
    g.ready[0].contacted?.state === 'no' && g.ready[0].contacted.how === 'Cara wave 1' && g.ready[0].label === 'Familiar'
    && g.review.find((x) => x.name === 'Amy D')?.kind === 'care' && g.review.find((x) => x.name === 'Amy D').blocking[0].key === 'bathing'
    && g.review.find((x) => x.name === 'Jody D')?.kind === 'call' && g.review.find((x) => x.name === 'Jody D').label === 'Overtime'
    && ['Denise R', 'Mary E', 'Kim A', 'Katie P'].every((n) => g.dont.some((x) => x.name === n)) && g.hidden === 1 && !g.dont.some((x) => x.name === 'Old'), g) }

/* ── 2. the real coverage-run ── */
let T, APP, SENT
const SVC = 'svc_' + 'k'.repeat(60)
const ymd = (d) => d.toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
const nextSat = (() => { const d = new Date(); d.setDate(d.getDate() + 3); while (d.getDay() !== 6) d.setDate(d.getDate() + 1); return ymd(d) })()
const facts = () => MR.SKILLS.map((s) => ({ episode_id: 'e1', kind: 'need_' + s.key, layer: 'plan', value: 'no' }))
/* 16 caregivers who can all be asked; Pat is on the PRN team list order is the server's own */
const NAMES = ['Amy', 'Ben', 'Cal', 'Dee', 'Eve', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jon', 'Kim', 'Lee', 'Max', 'Ned', 'Oli', 'Pam']
const CG = NAMES.map((f, i) => [String(9001 + i), f, 'Test'])
const reset = (kase, settings = {}) => {
  SENT = []
  APP = {
    caregivers: CG.map(([id, f, l]) => ({ first: f, last: l, phone: '41755501' + id.slice(-2), axiscare_id: id, active: true, alz_date: '2025-01-01' })),
    caregiver_availability: [], coverage_cases: [kase], staffing_plans: [], caregiver_overlay: [], dnr_log: [], ops_items: [],
    ops_settings: { coverage_send_live: true, coverage_quiet_from: 0, coverage_quiet_until: 0, office_quiet_start: 0, office_quiet_end: 0, coverage_alert_admins: ['sam@x.com'], ...settings },   /* no quiet hours, so the result never depends on the hour the test runs */
    coordinator_staff: [{ email: 'sam@x.com', name: 'Sam Owner', phone: '4175550900' }],
    responsibilities: [], nurse_staff: [], coverage_do_not_offer: [], client_checkins: [],
  }
  T = { domains: [], persons: [], contact_optout_current: [], circle_contacts: [], phone_index: [], client_callin_current: [], person_identity: [], pay_tracks: [], job_applicants: [],
    person_source_id: [{ person_id: 'p1', system: 'axiscare', entity_type: 'client', source_id: '500' }], journey_episode: [{ episode_id: 'e1', person_id: 'p1', state: 'established', created_at: '2026-01-01' }],
    client_fact_current: facts(), step1_forms: [], reference_requests: [], cara_run: [], cara_run_event: [], op_events: [],
    rules_approved: [{ file: 'match-rules.js', sha256: sha(RULES) }, { file: 'eligibility-rules.js', sha256: sha(ELIG) }] }
}
/* a small table fake: eq / in / or(lease) filters, update and insert that return the changed rows (one at a time, like Postgres) */
const q = (t) => { const st = { f: [], inF: [], or: null, op: 'select', patch: null, row: null, ret: false }; const b = {
  select() { if (st.op !== 'select') st.ret = true; return b }, order() { return b }, limit() { return b }, gte() { return b }, lte() { return b }, lt() { return b }, gt() { return b }, ilike() { return b }, contains() { return b }, range() { return b }, neq() { return b }, is() { return b }, not() { return b },
  or(s) { st.or = s; return b }, eq(c, v) { st.f.push([c, v]); return b }, in(c, v) { st.inF.push([c, v]); return b },
  update(p) { st.op = 'update'; st.patch = p; return b }, insert(r) { st.op = 'insert'; st.row = r; return b }, upsert() { st.op = 'noop'; return b },
  maybeSingle() { return b.then((x) => ({ data: Array.isArray(x.data) ? (x.data[0] ?? null) : x.data, error: x.error ?? null })) }, single() { return b.maybeSingle() },
  then(ok, bad) {
    if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]; return Promise.resolve({ data: st.op === 'select' && k in APP ? [{ key: k, data: APP[k] }] : [], error: null }).then(ok, bad) }
    const tbl = (T[t] ||= [])
    if (st.op === 'insert') {
      if (t === 'cara_run' && tbl.some((x) => x.case_id === st.row.case_id)) return Promise.resolve({ data: null, error: { message: 'duplicate key' } }).then(ok, bad)
      const row = { version: 1, seen_yes: [], declined: [], wave: 0, wave_base: 0, run_no: 1, at: new Date().toISOString(), ...structuredClone(st.row) }; tbl.push(row)
      return Promise.resolve({ data: st.ret ? [structuredClone(row)] : null, error: null }).then(ok, bad)
    }
    const match = (x) => st.f.every(([c, v]) => x[c] === v) && st.inF.every(([c, v]) => v.includes(x[c]))
      && (!st.or || (x.lease_until == null || x.lease_until < st.or.split('lease_until.lt.')[1]))
    if (st.op === 'update') { const hit = tbl.filter(match); for (const x of hit) Object.assign(x, structuredClone(st.patch)); return Promise.resolve({ data: st.ret ? structuredClone(hit) : null, error: null }).then(ok, bad) }
    if (st.op === 'noop') return Promise.resolve({ data: null, error: null }).then(ok, bad)
    return Promise.resolve({ data: structuredClone(tbl.filter(match)), error: null }).then(ok, bad) } }; return b }
globalThis.__db = { from: q, rpc: async (fn, a) => {
  if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => x.id === a.item.id); if (i >= 0) arr[i] = a.item; else arr.push(a.item) }
  if (fn === 'coverage_case_add_ask') { const c = (APP.coverage_cases || []).find((x) => x.id === a.p_id); if (!c) return { data: 'not_found', error: null }; if (c.status !== 'open') return { data: 'not_open', error: null }; c.asked = c.asked || []
    const ph = (p) => String(p || '').replace(/\D/g, '').slice(-10)
    if (c.asked.some((x) => (x.axiscare_id && x.axiscare_id === a.p_ask.axiscare_id) || (ph(x.phone).length === 10 && ph(x.phone) === ph(a.p_ask.phone)))) return { data: 'already_asked', error: null }; c.asked.push(a.p_ask); return { data: 'added', error: null } }
  if (fn === 'coverage_case_remove_ask') { const c = (APP.coverage_cases || []).find((x) => x.id === a.p_id); if (c) c.asked = (c.asked || []).filter((x) => x.id !== a.p_ask_id); return { data: true, error: null } }
  if (fn === 'coverage_case_patch') { const c = (APP.coverage_cases || []).find((x) => x.id === a.p_id); if (c) Object.assign(c, a.p_patch); return { data: { outcome: 'ok', item: c }, error: null } }
  return { data: null, error: null } }, auth: { getUser: async () => ({ data: { user: null }, error: { message: 'no' } }) } }
globalThis.__dbFor = (key) => ({ from: () => { const b = { select() { return b }, limit() { return Promise.resolve(key === SVC ? { data: [], error: null } : { data: null, error: { message: 'denied' } }) } }; return b } })
/* the office staff check: "Bearer staff:<name>:<role>" is a signed-in coordinator for this test */
globalThis.__staff = (req) => { const m = /^Bearer staff:([^:]+):(\w+)$/.exec(req.headers.get('authorization') || ''); return m ? { ok: true, person_id: 'x', name: m[1], email: m[1].toLowerCase().replace(/ /g, '') + '@x.com', roles: [m[2]] } : { ok: false, status: 401, error: 'sign in' } }
globalThis.fetch = async (url, o) => {
  url = String(url); const body = o && o.body ? JSON.parse(o.body) : {}
  if (url.startsWith('https://cc.mo-care.com/match-rules.js')) return new Response(RULES, { status: 200 })
  if (url.startsWith('https://cc.mo-care.com/eligibility-rules.js')) return new Response(ELIG, { status: 200 })
  if (url.includes('/contacts/upsert')) return new Response(JSON.stringify({ contact: { id: 'C:' + (body.phone || body.email), dnd: false } }), { status: 200 })
  if (url.includes('/conversations/messages')) { SENT.push({ to: body.contactId, msg: String(body.message ?? body.body ?? JSON.stringify(body)) }); return new Response('{}', { status: 200 }) }
  if (/axiscare\.com\/api\/caregivers(\?|$)/.test(url)) return new Response(JSON.stringify({ results: { caregivers: APP.caregivers.map((c) => ({ id: Number(c.axiscare_id), firstName: c.first, lastName: c.last, status: { active: true }, classes: [], mailingAddress: { city: 'Nixa', postalCode: '65714' } })) } }), { status: 200 })
  if (/axiscare\.com\/api\/clients\//.test(url)) return new Response(JSON.stringify({ results: { client: { firstName: 'Ruth', lastName: 'Kay', classes: [{ label: 'Private Pay' }], residentialAddress: { city: 'Nixa', postalCode: '65714' } } } }), { status: 200 })
  if (url.includes('axiscare.com')) return new Response(JSON.stringify({ results: { visits: [] }, nextPage: null }), { status: 200 })
  return new Response('{}', { status: 200 })
}
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: SVC, GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485', HUB_JOB_SECRET: 'j'.repeat(64) }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
{ const ja = fs.readFileSync(`${FN}/_shared/job-auth.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = (u, key) => globalThis.__dbFor(key)')
  fs.writeFileSync(`${FN}/_shared/_job-auth_cr.ts`, ja)
  fs.writeFileSync(`${FN}/_shared/_staff-auth_cr.ts`, "export const OFFICE_ROLES = ['owner_admin', 'care_coordinator', 'staffing_coordinator']\nexport async function requireStaff(_sb: unknown, req: Request) { return (globalThis as any).__staff(req) }\n") }
process.on('exit', () => { for (const f of ['_job-auth_cr.ts', '_staff-auth_cr.ts']) try { fs.unlinkSync(`${FN}/_shared/${f}`) } catch { /* */ } })
const src = fs.readFileSync(`${FN}/coverage-run/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace(/(['"])\.\.\/_shared\/job-auth\.ts\1/, "'../_shared/_job-auth_cr.ts'").replace(/(['"])\.\.\/_shared\/staff-auth\.ts\1/, "'../_shared/_staff-auth_cr.ts'")
const tmp = path.join(FN, 'coverage-run', '_cr.ts'); fs.writeFileSync(tmp, src)
try { await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
const act = async (body, who = null) => { const r = await handler(new Request('https://x/functions/v1/coverage-run', { method: 'POST', headers: { Authorization: 'Bearer ' + (who ? `staff:${who}` : SVC), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })); return { status: r.status, ...(await r.json()) } }
const tick = async () => { const r = await handler(new Request('https://x/functions/v1/coverage-run?commit=1', { method: 'POST', headers: { Authorization: 'Bearer ' + SVC } })); return r.json() }
const K = (o) => ({ id: 'cv1', status: 'open', reason: 'calloff', client: 'Ruth Kay', client_axiscare_id: '500', client_city: 'Nixa', shift_date: nextSat, shift_time: '08:00-17:00', asked: [], ...o })
const run = () => T.cara_run.find((x) => x.case_id === 'cv1')
const ev = (kind) => T.cara_run_event.filter((e) => e.kind === kind)
const due = () => { run().next_wave_at = new Date(Date.now() - 60000).toISOString() }
const KAY = 'Kay Coord:care_coordinator', SAM = 'Sam Owner:owner_admin'
const caseOf = () => APP.coverage_cases[0]
/* texts to caregivers only (the office's own call-in alert texts go to 4175550900) */
const CG_SENT = () => SENT.filter((x) => /^C:\+?1?41755501/.test(String(x.to)))
const yes = (name, o = {}) => { const a = caseOf().asked.find((x) => x.name === name); Object.assign(a, { state: 'yes', replied_at: new Date().toISOString(), reply: 'yes', ...o }); return a }

/* ── 2. the real coverage-run ── */
const realFetch2 = globalThis.fetch
const LEVEL = { '9001': 'Level 1', '9002': 'Level 2', '9003': 'Level 2' }
globalThis.fetch = async (url, o) => { const u = String(url)
  if (/axiscare\.com\/api\/caregivers(\?|$)/.test(u)) return new Response(JSON.stringify({ results: { caregivers: APP.caregivers.map((c) => ({ id: Number(c.axiscare_id), firstName: c.first, lastName: c.last, status: { active: true },
    classes: LEVEL[c.axiscare_id] ? [{ label: LEVEL[c.axiscare_id] }] : [{ label: 'Level 2' }], mailingAddress: { city: 'Nixa', postalCode: '65714' } })), nextPage: null } }), { status: 200 })
  if (/axiscare\.com\/api\/clients\//.test(u)) return new Response(JSON.stringify({ results: { client: { firstName: 'Ruth', lastName: 'Kay', classes: [{ label: 'Private Pay' }, { label: 'Level 2' }], residentialAddress: { city: 'Nixa', postalCode: '65714' } } } }), { status: 200 })
  if (/axiscare\.com\/api\/caregivers\/\d+/.test(u) && o && o.method && o.method !== 'GET') { AXIS_WRITES.push(u); return new Response('{}', { status: 200 }) }
  return realFetch2(url, o) }
const AXIS_WRITES = []
const setup = (settings = {}) => { reset(K({ shift_time: '22:00-06:00' }), { cara_run_live: true, cara_list_live: true, ...settings })
  T.client_fact_current = facts().map((f) => f.kind === 'need_bathing' ? { ...f, value: 'required' } : f)
  APP.dnr_log = [{ client: 'Ruth Kay', caregiver: 'Eve Test', active: true }] }
setup()
let L = await act({ action: 'ask_list', case_id: 'cv1' }, KAY)
const amy = (L.review || []).find((x) => x.name === 'Amy Test')
ck('server: Amy (Level 1) is under Possible with your review, as a care review, with Bathing as what stands in the way', amy?.kind === 'care' && (amy.blocking || []).some((t) => t.key === 'bathing') && amy.cg_level === 1, [amy, L.review?.map((x) => x.name + ':' + x.code)])
ck('server: everyone else is ready or not asked, never dropped; none contacted yet; the switch reads off', (L.ready || []).length > 5 && L.ready.every((x) => !x.contacted) && L.live === false, [L.ready?.length, L.live])
let ap = await act({ action: 'review_approve', case_id: 'cv1', axiscare_id: '9001', adjust: { bathing: 'moved' }, moved_to: 'Sun 9am visit', checks: { skills: true, payer: true }, agreed_by: 'Lisa (daughter), phone', why: 'only the shower is Level 2' }, KAY)
ck('switch off: an approval is refused; nothing recorded, nobody texted', ap.status === 409 && !caseOf().review_approvals && !CG_SENT().length, ap)
setup({ ask_list_live: true })
ap = await act({ action: 'review_approve', case_id: 'cv1', axiscare_id: '9001', checks: { skills: true, payer: true }, agreed_by: 'x', why: 'x' }, KAY)
ck('switch on: nothing adjusted = refused, naming the shower', ap.status === 409 && /Still in the way: Bathing or showering/.test(ap.error), ap)
ap = await act({ action: 'review_approve', case_id: 'cv1', axiscare_id: '9001', adjust: { bathing: 'moved' }, moved_to: 'Sun 9am visit', checks: { skills: true }, agreed_by: 'Lisa', why: 'x' }, KAY)
ck('switch on: the payer check not ticked = refused', ap.status === 409 && /payer/.test(ap.error), ap)
ap = await act({ action: 'review_approve', case_id: 'cv1', axiscare_id: '9001', adjust: { bathing: 'moved' }, moved_to: 'Sun 9am visit', checks: { skills: true, payer: true }, agreed_by: 'Lisa (daughter), phone', why: 'only the shower is Level 2' }, KAY)
const rec = caseOf().review_approvals?.[0]
ck('approved: recorded on the shift with who, the task moved and to when, who agreed, why and both checks', ap.ok && rec?.by === 'Kay Coord' && rec.adjusted[0].key === 'bathing' && rec.adjusted[0].change === 'moved' && rec.moved_to === 'Sun 9am visit'
  && rec.agreed_by === 'Lisa (daughter), phone' && rec.why === 'only the shower is Level 2' && rec.checks.skills && rec.checks.payer && rec.cg_level === 1, rec)
ck('approved: a card to put the shower on the new visit; then the offer goes to Amy only', APP.ops_items.some((i) => /^Put bathing or showering for Ruth on Sun 9am visit in AxisCare/.test(i.title)) && CG_SENT().length === 1 && caseOf().asked[0]?.name === 'Amy Test', [APP.ops_items.map((i) => i.title), CG_SENT()])
ck('approved: Amy\'s level is never changed (no write to her AxisCare record); she still reads Level 1', !AXIS_WRITES.length && LEVEL['9001'] === 'Level 1')
L = await act({ action: 'ask_list', case_id: 'cv1' }, KAY)
const amy2 = L.review.find((x) => x.name === 'Amy Test')
ck('the list now shows Amy approved for this shift and contacted', amy2?.approval?.by === 'Kay Coord' && amy2.contacted?.how === 'the office', amy2)
caseOf().asked[0].state = 'yes'; caseOf().asked[0].replied_at = new Date().toISOString()
const B = await act({ action: 'board', case_id: 'cv1' }, KAY)
const amyB = (B.people || []).find((p) => p.name === 'Amy Test')
ck('her yes can be confirmed by the office (approved for this shift), never by Cara alone', amyB?.can_confirm === true && /Approved for this shift after a care review by Kay Coord/.test(amyB.eligibility?.why || ''), amyB)
caseOf().shift_time = '21:00-05:00'
const B2 = await act({ action: 'board', case_id: 'cv1' }, KAY)
ck('the approval is for those hours only: the shift changed, it no longer counts', (B2.people || []).find((p) => p.name === 'Amy Test')?.can_confirm !== true)
setup({ ask_list_live: true })
ap = await act({ action: 'review_approve', case_id: 'cv1', axiscare_id: '9002', adjust: {}, checks: { skills: true, payer: true }, agreed_by: 'x', why: 'x' }, KAY)
ck('someone not waiting on a care review (Ben, Level 2) can\'t be "approved" this way', ap.status === 409 && /not waiting on a care review/.test(ap.error), ap)
L = await act({ action: 'ask_list', case_id: 'cv1' }, KAY)
ck('Do Not Return (Eve) is under Do not ask, with the reason', (L.dont || []).some((x) => x.name === 'Eve Test' && x.code === 'dnr'), L.dont)
globalThis.fetch = realFetch2

for (const [n, o, d] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n     ' + d))
console.log(`${res.filter((x) => x[1]).length}/${res.length}`)
