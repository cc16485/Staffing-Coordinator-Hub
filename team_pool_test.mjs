// coverage-shifts team_pool (the Team Builder list, the staffing sheet and the new-hires card read it). It threw since
// Slice 5 (workLock used, never imported). The REAL function against fake AxisCare and a fake database. node team_pool_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
const today = new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
const ago = (n) => { const d = new Date(Date.now() - n * 86400000); return d.toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10) }
let JOURNEYS = [], STEPS = []
const CGS = [{ id: 1, firstName: 'Nina', lastName: 'Newhire', status: { active: true }, classes: [], hireDate: ago(10), mailingAddress: { city: 'Nixa' } },
  { id: 2, firstName: 'Oscar', lastName: 'Old', status: { active: true }, classes: [], hireDate: '2023-01-01' },
  { id: 3, firstName: 'Rae', lastName: 'Nurse', status: { active: true }, classes: [{ label: 'RN' }] },
  { id: 4, firstName: 'Lou', lastName: 'Locked', status: { active: true }, classes: [], hireDate: ago(2) }]
globalThis.fetch = async (url) => { url = String(url)
  if (url.includes('/api/caregivers')) return new Response(JSON.stringify({ results: { caregivers: CGS } }), { status: 200 })
  if (url.includes('/api/visits')) return new Response(JSON.stringify({ results: { visits: [{ caregiver: { id: 2 }, client: { firstName: 'Ed' }, scheduledStartDate: today + 'T09:00:00', scheduledEndDate: today + 'T13:00:00' }] } }), { status: 200 })
  return new Response('{}', { status: 404 }) }
const q = (t) => { const st = { f: [], inF: null }; const b = { select() { return b }, eq(c, v) { st.f.push([c, v]); return b }, in(c, v) { st.inF = [c, v]; return b }, limit() { return b },
  maybeSingle() { return b.then((x) => ({ data: x.data[0] ?? null, error: null })) },
  then(ok) { let rows = t === 'app_data' ? [{ key: 'caregiver_availability', data: [{ axiscare_id: '1', windows: { mon: ['morning'] }, target_hours: 30 }] }]
      : t === 'client_journey' ? JOURNEYS : t === 'client_journey_step' ? STEPS : []
    for (const [c, v] of st.f) rows = rows.filter((r) => r[c] === v); if (st.inF) rows = rows.filter((r) => st.inF[1].includes(r[st.inF[0]]))
    return Promise.resolve({ data: JSON.parse(JSON.stringify(rows)), error: null }).then(ok) } }; return b }
globalThis.__db = { from: q }
const ENV = { AXISCARE_API_KEY: 't', AXISCARE_SITE: '16485', SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_tp_'))
const jwt = (role) => 'x.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.y'
try {
  const src = fs.readFileSync(path.join(F, 'coverage-shifts/index.ts'), 'utf8')
    .replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replaceAll("await import('https://esm.sh/@supabase/supabase-js@2')", "({ createClient: () => globalThis.__db })")
    .replace(/from '\.\.\/_shared\/([\w.-]+\.(?:ts|js))'/g, (_, m) => "from '" + path.join(process.cwd(), F, '_shared', m) + "'")
  fs.writeFileSync(path.join(tmp, 'cs.ts'), src); await import(path.join(tmp, 'cs.ts'))
  const call = async (body) => { const r = await handler(new Request('https://x/functions/v1/coverage-shifts', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt('authenticated') }, body: JSON.stringify(body) })); return { status: r.status, j: await r.json().catch(() => null) } }
  JOURNEYS = [{ journey_id: 'j4', subject: 'caregiver', status: 'open', axiscare_caregiver_id: '4' }]
  const r = await call({ team_pool: true })
  ck('the Team Builder list answers (it threw before the import was added)', r.status === 200 && Array.isArray(r.j?.caregivers), r)
  const by = (n) => (r.j?.caregivers || []).find((x) => x.name === n)
  ck('nurses left out, three caregivers, sorted by name', (r.j?.caregivers || []).map((x) => x.name).join() === 'Lou Locked,Nina Newhire,Oscar Old', r.j)
  ck('the new-hire lock shows on Lou (Approve to Work not done), with its reason', by('Lou Locked')?.work_locked === true && /Approve to Work/.test(by('Lou Locked')?.work_lock_why || ''), by('Lou Locked'))
  ck('Nina: hired 10 days ago, nothing scheduled, wants 30: a new hire who needs hours, with her availability', by('Nina Newhire')?.new_hire?.days === 10 && by('Nina Newhire')?.new_hire?.target_week === 30 && by('Nina Newhire')?.windows?.mon?.[0] === 'morning', by('Nina Newhire'))
  ck('Oscar (hired 2023, 4 h today): not a new hire', by('Oscar Old')?.new_hire === null && by('Oscar Old')?.visits?.length === 1, by('Oscar Old'))
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let p = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) p++ }
console.log(`\n${p}/${res.length} passed`); process.exit(p === res.length ? 0 : 1)
