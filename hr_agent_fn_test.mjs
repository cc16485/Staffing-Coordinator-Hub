// The hr-agent job (HR Agent build step 4) · the real function against a fake database · node hr_agent_fn_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, d) => res.push([n, !!c, c ? '' : String(JSON.stringify(d ?? null)).slice(0, 800)])
const FN = 'supabase/functions'
let APP, T, FAIL_READ
const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10)
const ev = (id, cg, type, ago) => ({ id, axiscare_caregiver_id: String(cg), caregiver: 'CG ' + cg, type, shift_date: day(ago) })
const reset = (ops = {}) => {
  FAIL_READ = false
  APP = { ops_settings: ops, settings: { attendance: { callin_count: 3, callin_window: 90, tardy_grace: 7, tardy_count: 3, tardy_window: 90, notice_hours: 4 } },
    attendance_events: [ev('a', 1, 'evv_missing_out', 1), ev('b', 1, 'evv_missing_out', 3), ev('c', 1, 'evv_missing_in', 9), ev('d', 2, 'ncns', 2)],
    caregivers: [{ first: 'Jordan', last: 'Miller', axiscare_id: '1' }], automation_heartbeats: [] }
  T = { missed_notes: [], kind_words: [{ id: 9, status: 'kind', about_role: 'caregiver', quote: 'Wonderful', who: 'A daughter', link: { type: 'caregiver', id: '3' }, created_at: day(2) + 'T10:00:00Z' }], hr_cases: [] }
}
const q = (t) => { const st = { f: [] }; const b = {
  select() { return b }, eq(c, v) { st.f.push([c, v]); return b }, gte() { return b },
  maybeSingle() { const k = (st.f.find(([c]) => c === 'key') || [])[1]; return Promise.resolve({ data: k in APP ? { data: APP[k] } : null, error: null }) },
  upsert(rows, o) { const have = new Set(T.hr_cases.map((x) => x.id)); let n = 0; for (const r of rows) if (!have.has(r.id)) { T.hr_cases.push({ ...r, created_at: new Date().toISOString() }); n++ }
    return Promise.resolve({ error: null, count: n }) },
  then(res_) { if (FAIL_READ && t === 'kind_words') return res_({ data: null, error: { message: 'boom' } })
    let r = T[t] || []; for (const [c, v] of st.f) r = r.filter((x) => x[c] === v); return res_({ data: r, error: null }) } }; return b }
globalThis.__db = { from: q, rpc: (fn, a) => { if (a.target_key === 'automation_heartbeats') APP.automation_heartbeats.push(a.item); return Promise.resolve({ error: null }) } }
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
fs.writeFileSync(`${FN}/_shared/_job-auth_hr.ts`, "export const jobCaller = async (req) => req.headers.get('x-test') || null\n")
process.on('exit', () => { try { fs.unlinkSync(`${FN}/_shared/_job-auth_hr.ts`) } catch { /* */ } })
const src = fs.readFileSync(`${FN}/hr-agent/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
  .replace(/(['"])\.\.\/_shared\/job-auth\.ts\1/, "'../_shared/_job-auth_hr.ts'")
const tmp = path.join(process.cwd(), FN, 'hr-agent', '_t.ts'); fs.writeFileSync(tmp, src)
try { await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
const run = async (qs = '', who = 'cron') => { const r = await handler(new Request('https://x/functions/v1/hr-agent' + qs, { method: 'POST', headers: who ? { 'x-test': who } : {}, body: '{}' })); return { s: r.status, j: await r.json() } }

reset(); let r = await run('', null)
ck('no schedule secret and no owner key: refused, nothing saved', r.s === 401 && T.hr_cases.length === 0, r)
r = await run('?auth_check=1'); ck('auth check names the caller', r.s === 200 && r.j.caller === 'cron')
reset(); r = await run('?dry=1')
ck('a dry run counts and saves nothing', r.s === 200 && r.j.found === 3 && r.j.saved === 0 && T.hr_cases.length === 0 && !APP.automation_heartbeats.length, r)
reset(); r = await run()
ck('practice run: 3 cases saved (missed clock-outs, a no-show, kind words)', r.s === 200 && r.j.live === false && r.j.saved === 3 && T.hr_cases.length === 3, r)
ck('...every one is practice and open', T.hr_cases.every((c) => c.practice === true && c.status === 'open'))
ck('...sorted: coaching, serious, recognition', JSON.stringify(r.j.by_kind) === JSON.stringify({ coaching: 1, serious: 1, recognition: 1 }), r.j.by_kind)
ck('...the roster name is used', T.hr_cases.find((c) => c.rule === 'w06').caregiver === 'Jordan Miller')
ck('...a heartbeat is written', APP.automation_heartbeats.length === 1 && APP.automation_heartbeats[0].ok === true)
r = await run(); ck('run again the same day: nothing new', r.j.found === 0 && T.hr_cases.length === 3, r)
reset({ hr_agent_live: true }); r = await run()
ck('with the switch on, cases are saved as live (still nothing sent: no sender in this job)', r.j.live === true && T.hr_cases.every((c) => c.practice === false), r)
reset({ hr_agent_live: 'yes' }); r = await run(); ck('only exactly true turns it on', r.j.live === false)
reset(); FAIL_READ = true; r = await run()
ck('a failed read: an error, nothing saved, a failed heartbeat', r.s === 500 && T.hr_cases.length === 0 && APP.automation_heartbeats[0]?.ok === false, r)
const body = fs.readFileSync(`${FN}/hr-agent/index.ts`, 'utf8')
ck('the job imports no sender (no texts, no email, no AxisCare writes)', !/outreach|ghl|send-problems|resend|axiscare/i.test(body.split('\n').filter((l) => l.startsWith('import')).join('\n')))
ck('no em dashes in the job', !/—/.test(body))

let f = 0; for (const [n, ok, d] of res) { console.log((ok ? 'PASS' : 'FAIL') + ' · ' + n + (ok ? '' : '  ' + d)); if (!ok) f++ }
console.log((res.length - f) + '/' + res.length); process.exit(f ? 1 : 0)
