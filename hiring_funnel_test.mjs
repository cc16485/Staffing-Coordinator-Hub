// 448 · the hiring funnel (Owners Hub): _shared/hiring-funnel.ts and the hiring-funnel function, with made-up people.
// node hiring_funnel_test.mjs
import fs from 'fs'; import path from 'path'; import os from 'os'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 700)])
const F = await import(path.join(FN, '_shared/hiring-funnel.ts'))
const NOW = new Date('2026-10-04T17:00:00Z')
ck('the last 3 months, oldest first (Central)', JSON.stringify(F.lastMonths(NOW)) === '["2026-08","2026-09","2026-10"]' && JSON.stringify(F.lastMonths(new Date('2026-01-01T05:30:00Z'))) === '["2025-10","2025-11","2025-12"]')
const A = (id, created_at, o = {}) => ({ id, created_at, status: 'reviewing', phone: '', email: '', ...o })
const I = {
  applicants: [
    A('a1', '2026-09-02T15:00:00Z', { phone: '(417) 555-0001', status: 'hired', hired_at: '2026-09-10T15:00:00Z', post_interview: { x: 1 } }),
    A('a2', '2026-09-03T15:00:00Z', { email: 'Bo@Example.test', status: 'noshow', noshow_at: '2026-09-06T15:00:00Z' }),
    A('a3', '2026-09-05T15:00:00Z', { phone: '4175550003', status: 'pool', post_interview: { x: 1 } }),
    A('a4', '2026-09-06T15:00:00Z', { status: 'partial', phone: '4175550004' }),
    A('a5', '2026-10-01T15:00:00Z', { phone: '4175550005' }),
    A('a6', '2026-08-10T15:00:00Z', { phone: '4175550006', status: 'hired', hired_at: '2026-08-20T15:00:00Z', post_interview: {} }),
    A('a7', '2026-06-10T15:00:00Z', { phone: '4175550007' }),
  ],
  bookings: [{ applicant_id: 'a1', starts_at: '2026-09-05T15:00:00Z', status: 'attended' }, { applicant_id: 'a2', starts_at: '2026-09-06T15:00:00Z', status: 'noshow' },
    { applicant_id: 'a3', starts_at: '2026-09-09T15:00:00Z', status: 'attended' }, { applicant_id: 'a6', starts_at: '2026-08-12T15:00:00Z', status: 'attended' }],
  intakes: [{ phone: '417-555-0001', created_at: '2026-09-11T15:00:00Z' }, { phone: '4175550006', created_at: '2026-08-21T15:00:00Z' }, { phone: '4175550003', created_at: '2026-01-01T15:00:00Z' }],
  candidates: [{ first: 'Ava', phone: '4175550001', resolvedStatus: 'Ready for Orientation' }, { first: 'Cy', phone: '4175550003', resolvedStatus: 'Ready for Orientation', not_hired: true }],
  roster: [{ first: 'Dee', phone: '4175550006', hire_date: '2026-09-01' }],
  census: [{ id: '1', mobile: '4175550001', email: '', hire_date: '2026-09-20', active: true }, { id: '9', mobile: '9999999999', hire_date: '2026-05-01', active: true },
    { id: '10', mobile: '8888888888', hire_date: '2026-04-01', active: false }, { id: '11', mobile: '7777777777', hire_date: '2026-09-01', active: true }],
  now: NOW,
}
const out = F.funnel(I); const sep = out.months.find((m) => m.month === '2026-09'), aug = out.months.find((m) => m.month === '2026-08'), oct = out.months.find((m) => m.month === '2026-10')
ck('September: 3 applied (an unfinished application does not count)', sep.applied === 3, sep)
ck('...2 interviewed and 1 no-show, counted separately', sep.interviewed === 2 && sep.noshow === 1, sep)
ck('...1 offered, 1 start form (an older start form from before they applied does not count)', sep.offered === 1 && sep.start_form === 1, sep)
ck('...1 cleared (someone marked Not hired is not cleared), 1 started (AxisCare hire date after they applied)', sep.cleared === 1 && sep.started === 1, sep)
ck('matched by phone (any format) or email only, never by name', sep.started === 1 && aug.started === 1)
ck('August: started from the Hub roster when AxisCare does not have them', aug.applied === 1 && aug.started === 1 && aug.cleared === 1, aug)
ck('October so far: 1 applied, nothing else yet; June is outside the 3 months', oct.applied === 1 && oct.interviewed === 0 && out.months.length === 3)
ck('typical days: applied to interview, interview to offer, offer to start', out.medians.applied_to_interview === 3 && out.medians.interview_to_offer === 6.5 && out.medians.offer_to_start === 11, out.medians)
ck('no-show rate: no-shows out of everyone who had an interview booked (1 of 4)', out.noshow_rate === 25, out.noshow_rate)
ck('90-day retention from AxisCare: hired 90 to 365 days ago (2), still active (1); newer hires not counted', out.retention.hired === 2 && out.retention.still_active === 1, out.retention)
const noC = F.funnel({ ...I, census: null })
ck('AxisCare unreachable: still counts from the Hub roster, retention says unknown (not zero)', noC.retention === null && noC.months.find((m) => m.month === '2026-08').started === 1)
const txt = JSON.stringify(out)
ck('counts only: no name, phone or email in the answer', !/Ava|Dee|Cy|555|example|@/.test(txt), txt)

/* the function */
let handler
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'k' })[k] ?? '' }, serve: (h) => { handler = h } }
const tab = { job_applicants: I.applicants, interview_bookings: I.bookings, hire_intake: I.intakes, app_data: [{ key: 'candidates', data: I.candidates }, { key: 'caregivers', data: I.roster }] }
globalThis.__db = { from: (t) => { const b = { select() { return b }, gte() { return b }, limit() { return b }, in() { return b }, then(ok) { return Promise.resolve({ data: tab[t], error: null }).then(ok) } }; return b } }
globalThis.__census = { ok: true, rows: I.census, total: 4, truncated: false }
let src = fs.readFileSync(path.join(FN, 'hiring-funnel/index.ts'), 'utf8')
  .replace(/^import \{ createClient \}.*$/m, 'const createClient = (..._a: any[]) => (globalThis as any).__db')
  .replace(/^import \{ requireStaff \}.*$/m, 'const requireStaff = async (_d: any, _r: any, roles: string[]) => { (globalThis as any).__roles = roles; return (globalThis as any).__staff }')
  .replace(/^import \{ readCensus \}.*$/m, 'const readCensus = async () => (globalThis as any).__census')
  .replace("'../_shared/hiring-funnel.ts'", "'" + path.join(FN, '_shared/hiring-funnel.ts') + "'")
const tmp = path.join(os.tmpdir(), 'hf448_' + process.pid + '.ts'); fs.writeFileSync(tmp, src); await import(tmp); fs.unlinkSync(tmp)
const call = async () => { const r = await handler(new Request('https://x/f', { method: 'POST', body: '{}' })); return [r.status, await r.json()] }
globalThis.__staff = { ok: false, status: 403, error: 'Owners only.' }; let [s, j] = await call()
ck('owners only: anyone else is refused', s === 403 && JSON.stringify(globalThis.__roles) === '["owner_admin"]', [s, j])
globalThis.__staff = { ok: true, name: 'Samantha', email: 'samantha@mo-care.com' }; [s, j] = await call()
ck('an owner gets the three months, the typical days, the no-show rate and retention', s === 200 && j.ok && j.months.length === 3 && j.retention && j.census_ok === true, j)
ck('...and no name, phone or email', !/Ava|Dee|555|@/.test(JSON.stringify(j)))
const srcs = fs.readFileSync(path.join(FN, 'hiring-funnel/index.ts'), 'utf8') + fs.readFileSync(path.join(FN, '_shared/hiring-funnel.ts'), 'utf8')
ck('it only reads: no insert, update, delete, upsert, rpc or message', !/\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(|sendSms|ghlSend|contactForOutbound/.test(srcs))
ck('no em dashes', !/—/.test(srcs))
const failed = res.filter((r) => !r[1]); for (const [n, ok, note] of res) console.log((ok ? 'ok   ' : 'FAIL ') + n + (ok ? '' : '  ' + note))
console.log(`${res.length - failed.length}/${res.length} passed`); process.exit(failed.length ? 1 : 0)
