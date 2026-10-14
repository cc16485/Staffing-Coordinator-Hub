// onboard-goal-watch (Samantha, 2026-10-14): the onboarding goal on Team Builder plans; a Needs Attention card for the
// onboarding owner when the goal is 3 days away (or past) and someone on the plan isn't Approved to Work yet. Nothing texted.
// Real function, fake database. node onboard_goal_watch_test.mjs
import fs from 'fs'; import path from 'path';
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)]);
const FN = 'supabase/functions'
const ymd = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10) }
let APP, T
const reset = () => {
  APP = { ops_items: [], caregivers: [
      { id: 1, first: 'Lou', last: 'Locked', axiscare_id: '501', offer_id: 'off-lou', phone: '4175550001' },
      { id: 2, first: 'Rae', last: 'Ready', axiscare_id: '502', phone: '4175550002' },
      { id: 3, first: 'Ana', last: 'Hired', axiscare_id: '503', phone: '4175550003' }],
    staffing_plans: [
      { id: 'p1', client: 'Mary Example', status: 'open', cells: { 'mon|s1': { name: 'Pat New', applicant_id: 'ap1', status: 'yes' }, 'tue|s1': { name: 'Lou Locked', cg_ax_id: '501', status: 'penciled' } },
        options: { 'mon|s1': [{ id: 'o1', name: 'Rae Ready', cg_ax_id: '502', status: 'asked' }, { id: 'o2', name: 'Nic No', applicant_id: 'ap2', status: 'no' }, { id: 'o3', name: 'Ana Hired', applicant_id: 'ap3', status: 'maybe' }] } },
      { id: 'p2', client: 'Far Away', status: 'open', onboard_goal: ymd(20), cells: { 'mon|s1': { name: 'Pat New', applicant_id: 'ap1', status: 'penciled' } } },
      { id: 'p3', client: 'No Goal', status: 'open', cells: { 'mon|s1': { name: 'Pat New', applicant_id: 'ap1' } } },
      { id: 'p4', client: 'Old', status: 'archived', onboard_goal: ymd(1), cells: { 'mon|s1': { name: 'Pat New', applicant_id: 'ap1' } } }] }
  T = { team_build_link_current: [{ plan_id: 'p1', episode_id: 'ep1' }], start_contract_current: [{ episode_id: 'ep1', target_date: ymd(2) }],
    job_applicants: [{ id: 'ap1', first_name: 'Pat', last_name: 'New', phone: '4175550099' }, { id: 'ap2', first_name: 'Nic', last_name: 'No', phone: '4175550098' }, { id: 'ap3', first_name: 'Ana', last_name: 'Hired', phone: '(417) 555-0003' }],
    client_journey: [{ journey_id: 'j1', offer_id: 'off-lou', status: 'open', subject: 'caregiver' }], client_journey_step: [],
    domains: [{ entity: 'cc_ihs', code: 'recruiting_orientation', owner_person: 'pk' }], persons: [{ person_id: 'pk', primary_email: 'krystal@mo-care.com', full_name: 'Krystal' }] }
}
const q = (t) => { const st = { f: [], inF: null }; const b = { select() { return b }, limit() { return b }, eq(c, v) { st.f.push([c, v]); return b }, in(c, v) { st.inF = [c, v]; return b },
  rows() { if (t === 'app_data') { const k = (st.f.find(([c]) => c === 'key') || [])[1]; return k in APP ? [{ data: JSON.parse(JSON.stringify(APP[k])) }] : [] }
    let r = T[t] ?? []; for (const [c, v] of st.f) r = r.filter((x) => x[c] === v); if (st.inF) r = r.filter((x) => st.inF[1].includes(x[st.inF[0]])); return r },
  maybeSingle() { return Promise.resolve({ data: b.rows()[0] ?? null, error: null }) }, then(ok) { return Promise.resolve({ data: b.rows(), error: null }).then(ok) } }; return b }
globalThis.__db = { from: q, rpc: async (fn, a) => { if (fn === 'upsert_app_data_item') { const arr = (APP[a.target_key] ||= []); const i = arr.findIndex((x) => x.id === a.item.id); if (i >= 0) arr[i] = a.item; else arr.push(a.item) } return { data: null, error: null } } }
const ENV = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
fs.writeFileSync(`${FN}/_shared/_job-auth_ogw.ts`, "export const jobCaller = async (req) => req.headers.get('x-test') === 'cron' ? 'cron' : null\n")
process.on('exit', () => { try { fs.unlinkSync(`${FN}/_shared/_job-auth_ogw.ts`) } catch { /* */ } })
const src = fs.readFileSync(`${FN}/onboard-goal-watch/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace(/(['"])\.\.\/_shared\/job-auth\.ts\1/, "'../_shared/_job-auth_ogw.ts'")
const tmp = path.join(process.cwd(), FN, 'onboard-goal-watch', '_t.ts'); fs.writeFileSync(tmp, src)
let M; try { M = await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
const run = async (qs = '', hdr = { 'x-test': 'cron' }) => { const r = await handler(new Request('https://x/functions/v1/onboard-goal-watch' + qs, { method: 'POST', headers: hdr, body: '{}' })); return { s: r.status, j: await r.json() } }
const cards = () => APP.ops_items.filter((x) => x.kind === 'onboarding_goal' && x.status === 'open')
reset(); let r = await run('', {})
ck('no schedule secret and no owner key: refused', r.s === 401, r)
reset(); r = await run()
ck('the client start date (Start Contract, 2 days away) is the goal: cards for Pat (applicant, not hired) and Lou (locked by the readiness card); not Rae (ready), not Nic (said no), not Ana (now a caregiver on the roster)',
   r.j.ok && cards().map((c) => c.about).sort().join() === 'Lou Locked,Pat New' && r.j.cards_open === 2, [r.j, cards().map((c) => c.about)])
const pat = cards().find((c) => c.about === 'Pat New')
ck('the card: for the onboarding owner, says the client, the goal date and where it came from, what to do; nothing is texted', pat.owner === 'krystal@mo-care.com' && /Mary Example is in 2 days/.test(pat.title) && /client's start date/.test(pat.detail) && /Team Builder/.test(pat.next_action) && pat.domain === 'recruiting_orientation', pat)
ck('a goal 20 days out (set on the plan), a plan with no goal, an archived plan: no card', !cards().some((c) => c.plan_id !== 'p1'), cards().map((c) => c.plan_id))
r = await run()
ck('run again: no duplicate cards', cards().length === 2 && r.j.cards_open === 0, r.j)
APP.caregivers.push({ id: 9, first: 'Pat', last: 'New', axiscare_id: '509', phone: '417-555-0099' }); r = await run()
ck('Pat is now a caregiver on the roster with an AxisCare number (not locked): their card closes itself, saying why', cards().map((c) => c.about).join() === 'Lou Locked' && r.j.cards_closed === 1 && APP.ops_items.find((x) => x.about === 'Pat New').status === 'done', r.j)
APP.staffing_plans[0].onboard_goal = ymd(10); r = await run()
ck('the office moves the goal 10 days out on the plan: Lou\'s card closes too', !cards().length, cards())
reset(); T.start_contract_current[0].target_date = ymd(-1); r = await run()
ck('goal already passed: card says past, high urgency', cards().every((c) => /is past/.test(c.title) && c.urgency === 'high') && cards().length === 2, cards())
reset(); r = await run('?dry=1')
ck('?dry=1: counts, writes nothing', r.j.behind === 2 && !APP.ops_items.length, r.j)
reset(); T.client_journey = null; const qq = globalThis.__db.from; globalThis.__db.from = (t) => t === 'client_journey' ? { select() { return this }, eq() { return this }, limit() { return Promise.resolve({ data: null, error: { message: 'down' } }) } } : qq(t)
r = await run(); globalThis.__db.from = qq
ck('readiness cards unreadable: holds, nothing changed', r.j.ok === false && /could not be read/.test(r.j.held) && !APP.ops_items.length, r.j)
const code = fs.readFileSync(`${FN}/onboard-goal-watch/index.ts`, 'utf8')
ck('never texts or emails anyone', !/conversations\/messages|resend|sendEmail|ghl/i.test(code.replace(/\/\/.*$/gm, '')))
for (const [n, o, d] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n     ' + d))
console.log(`${res.filter((x) => x[1]).length}/${res.length}`); process.exit(res.every((x) => x[1]) ? 0 : 1)
