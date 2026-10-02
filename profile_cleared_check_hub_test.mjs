// 2c-T Hub half (2026-10-01): outreach-check answers { profile_check, axiscare_id } -> { published, new_hire } on the
// server door only. The real function under Node with a stand-in database. node profile_cleared_check_hub_test.mjs
import fs from 'fs'; import path from 'path'
const FN = 'supabase/functions'; const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 600)])
let ROSTER = [], PROFILES = [], CALLS = [], FAIL = {}, READS = []
const q = (t) => {
  const f = []; let lim = Infinity
  const b = {
    select() { return b }, order() { return b }, limit(n) { lim = n; return b },
    eq(c, v) { f.push((r) => String(r[c] ?? '') === String(v)); return b },
    neq(c, v) { f.push((r) => r[c] != null && r[c] !== v); return b },   // PostgREST neq drops nulls too
    maybeSingle: async () => { READS.push(t); return FAIL[t] ? { data: null, error: { message: 'down' } } : { data: t === 'app_data' ? { data: ROSTER } : null, error: null } },
    then(ok) {
      READS.push(t)
      if (FAIL[t]) return Promise.resolve({ data: null, error: { message: 'down' } }).then(ok)
      const src = t === 'caregiver_profiles' ? PROFILES : t === 'welcome_calls' ? CALLS : []
      return Promise.resolve({ data: src.filter((r) => f.every((fn) => fn(r))).slice(0, lim), error: null }).then(ok)
    },
  }
  return b
}
globalThis.__db = { from: q, rpc: async () => ({ data: null, error: null }) }
let handler; globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'k', OUTREACH_SECRET: 's'.repeat(40), GHL_TOKEN: 'g', GHL_LOCATION_ID: 'loc' })[k] }, serve: (h) => { handler = h } }
const src = fs.readFileSync(`${FN}/outreach-check/index.ts`, 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
const tmp = path.join(process.cwd(), FN, 'outreach-check', '_t2ct.ts'); fs.writeFileSync(tmp, src); try { await import(tmp) } finally { fs.unlinkSync(tmp) }
const post = async (body, headers = { 'x-outreach-secret': 's'.repeat(40) }) => { const r = await handler(new Request('https://x/f', { method: 'POST', headers, body: JSON.stringify(body) })); return [r.status, await r.json().catch(() => ({}))] }
const P = (axiscare_id) => ({ profile_check: true, axiscare_id })

let [s, j] = await post(P('501'), { 'x-outreach-secret': 'wrong' })
ck('wrong server secret: refused, nothing read', s === 401 && !READS.length, [s, j, READS])
;[s, j] = await post(P('501'), { Authorization: 'Bearer some-anon-key' })
ck('no server secret (anon / staff door): profile_check is not answered there', s !== 200 || !('published' in j), [s, j])
for (const badId of ['', 'abc', '12 3', '1'.repeat(13), "1' or 1=1", null]) {
  READS = []; ;[s, j] = await post(P(badId))
  ck(`odd axiscare_id ${JSON.stringify(badId)}: 400, nothing read`, s === 400 && !READS.length && !('published' in j), [s, j, READS])
}
ROSTER = []; PROFILES = []; CALLS = []
;[s, j] = await post(P('999999999'))
ck('unknown AxisCare id: published false, new_hire false, nothing else in the answer', s === 200 && j.published === false && j.new_hire === false && Object.keys(j).sort().join() === 'new_hire,published', j)

ROSTER = [{ axiscare_id: '501', candidate_id: 'c-77', first: 'Nia', last: 'New', hire_date: '2026-10-05' }]
PROFILES = [{ axiscare_id: '501', candidate_id: null, published: true, status: 'published', updated_at: '2026-10-05', first_name: 'Nia' }]
;[s, j] = await post(P('501'))
ck('published profile by AxisCare id: published true; new hire by the Hub hire date', j.published === true && j.new_hire === true, j)
ck('the answer carries no names or ids', !/Nia|c-77|501/.test(JSON.stringify(j)), j)
PROFILES = [{ axiscare_id: '501', published: false, status: 'draft', updated_at: '2026-10-05' }]
;[s, j] = await post(P('501')); ck('draft profile: published false', j.published === false, j)
PROFILES = [{ axiscare_id: '501', published: true, status: 'withdrawn', updated_at: '2026-10-05' }]
;[s, j] = await post(P('501')); ck('withdrawn profile never counts', j.published === false, j)
PROFILES = [{ axiscare_id: null, candidate_id: 'c-77', published: true, status: 'published', updated_at: '2026-10-04' }]
;[s, j] = await post(P('501')); ck('profile built in onboarding (candidate id only) is found through the roster', j.published === true, j)
PROFILES = [{ axiscare_id: '501', published: false, status: 'draft', updated_at: '2026-10-05' }, { axiscare_id: null, candidate_id: 'c-77', published: true, status: 'published', updated_at: '2026-10-04' }]
;[s, j] = await post(P('501')); ck('same order as the Hub panel: the AxisCare-id profile wins over the candidate one', j.published === false, j)

PROFILES = []
ROSTER = [{ axiscare_id: '502', candidate_id: 'c-88', hire_date: '2026-09-20', promoted_at: '2026-10-02T05:30:00Z' }]
;[s, j] = await post(P('502')); ck('promoted_at on or after the line (Central date) makes a new hire', j.new_hire === true, j)
ROSTER = [{ axiscare_id: '502', candidate_id: 'c-88', hire_date: '2026-09-20', promoted_at: '2026-10-02T04:30:00Z' }]
;[s, j] = await post(P('502')); ck('promoted 11:30pm Oct 1 Central is NOT a new hire by that stamp', j.new_hire === false, j)
CALLS = [{ candidate_id: 'c-88', status: 'booked' }]
;[s, j] = await post(P('502')); ck('a welcome call on file makes a new hire', j.new_hire === true, j)
CALLS = [{ candidate_id: 'c-88', status: 'cancelled' }]
;[s, j] = await post(P('502')); ck('a cancelled welcome call does not', j.new_hire === false, j)
ROSTER = [{ axiscare_id: '503', hire_date: '2019-04-01' }]; CALLS = []
;[s, j] = await post(P('503')); ck('a current caregiver (hired 2019): new_hire false', j.new_hire === false && j.published === false, j)

for (const t of ['app_data', 'caregiver_profiles', 'welcome_calls']) {
  FAIL = { [t]: true }; ROSTER = [{ axiscare_id: '502', candidate_id: 'c-88', hire_date: '2026-09-20' }]
  ;[s, j] = await post(P('502'))
  ck(`${t} unreadable: 500 and no answer (Training holds and reports)`, s === 500 && !('published' in j), [s, j])
}
FAIL = {}

// the older answers are untouched
let CARDS = []; globalThis.__db.rpc = async (fn, a) => { if (fn === 'upsert_app_data_item') CARDS.push(a.item); return { data: null, error: null } }
;[s, j] = await post({ report: true, sender: 'notify-cleared', channel: 'sms', phone: '4175550102', who: 'Ana', why: 'error 500' })
ck('report still raises a card', s === 200 && j.reported === true && CARDS.length === 1, [s, j])

const code = fs.readFileSync(`${FN}/outreach-check/index.ts`, 'utf8')
ck('the line is the same as eligibility-rules.js (2026-10-02)', /const PROFILE_REQUIRED_FROM = '2026-10-02'/.test(code))
ck('no em dash added in this function', !/—/.test(code.split('PROFILE BEFORE "CLEARED"')[1] || ''))

let all = true; console.log('\n2c-T · HUB PROFILE CHECK · TEST\n' + '='.repeat(50)); for (const [n, g, note] of res) { all &&= g; console.log((g ? 'PASS  ' : 'FAIL  ') + n + (note ? '\n   └─ ' + note : '')) }
console.log(all ? `ALL ${res.length} CHECKS PASS` : 'FAILED'); process.exit(all ? 0 : 1)
