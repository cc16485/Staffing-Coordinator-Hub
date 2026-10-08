// Past families look (Desktop 504a): the REAL past-families-look against a fake AxisCare and a fake Hub database.
// node past_families_look_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_pf_'))
const D = (n) => new Date(Date.now() + n * 864e5).toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
const P = [ // ax, name, role status, ended, reason
  ['1', 'Cora Current', 'active', null, null], ['2', 'Pam Past', 'former', D(-200), null], ['3', 'Dee Gone', 'former', D(-200), 'deceased'], ['4', 'Rita Recent', 'former', D(-10), null],
  ['5', 'Olga Old', 'former', D(-1500), null], ['6', 'Nell Nofam', 'former', D(-100), null], ['7', 'Sal Self', 'former', D(-90), null], ['8', 'Eve Email', 'former', D(-60), null]]
const T = { person_role: P.map(([ax, , st, e, r]) => ({ person_id: 'p' + ax, role: 'client', status: st, ended_at: e, end_reason: r, ended_date_basis: 'exact' })),
  person_source_id: P.map(([ax]) => ({ person_id: 'p' + ax, system: 'axiscare', entity_type: 'client', source_id: ax })), person_identity: P.map(([ax, n]) => ({ id: 'p' + ax, display_name: n })) }
const WRITES = []
const q = (t) => { const f = []; const b = { select: () => b, eq: (k, v) => { f.push([k, v, 'eq']); return b }, in: (k, v) => { f.push([k, v, 'in']); return b },
  insert: () => { WRITES.push(t); return b }, update: () => { WRITES.push(t); return b }, delete: () => { WRITES.push(t); return b },
  then: (ok) => ok({ data: (T[t] || []).filter((r) => f.every(([k, v, h]) => h === 'in' ? v.includes(r[k]) : String(r[k]) === String(v))), error: null }) }; return b }
globalThis.__db = { from: q }
const PARTIES = { '2': [{ name: 'Paul (son)', phones: [{ type: 'Mobile', number: '417-555-0102' }], email: 'paul@x.com' }], '6': [], '7': [], '8': [{ name: 'Ed', phones: [{ type: 'Home', number: '4175550108' }], email: 'ed@x.com' }],
  '3': [{ name: 'Dan', phones: [{ type: 'Mobile', number: '4175550103' }] }] }
const CLIENTS = [{ id: 7, mobilePhone: '4175550107' }, { id: 6 }, { id: 2 }, { id: 8 }]
let AXDOWN = false; const CALLS = []
globalThis.fetch = async (url) => { url = String(url); CALLS.push(url)
  if (AXDOWN) return new Response('no', { status: 503 })
  const m = /\/api\/clients\/(\d+)\/responsibleParties/.exec(url); if (m) return new Response(JSON.stringify({ results: { responsibleParties: PARTIES[m[1]] || [] } }), { status: 200 })
  if (/\/api\/clients$/.test(url)) return new Response(JSON.stringify({ results: { clients: CLIENTS, nextPage: null } }), { status: 200 })
  return new Response('{}', { status: 404 }) }
let handler; globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'svc', AXISCARE_TOKEN: 't', AXISCARE_SITE: '16485' })[k] }, serve: (h) => { handler = h } }
try {
  const ja = path.join(tmp, 'job-auth.ts'); fs.writeFileSync(ja, "export async function ownerCaller(req){ return req.headers.get('Authorization') === 'Bearer svc' }")
  const src = fs.readFileSync(path.join(F, 'past-families-look/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db').replace("'../_shared/job-auth.ts'", JSON.stringify(ja))
  fs.writeFileSync(path.join(tmp, 'pf.ts'), src); await import(path.join(tmp, 'pf.ts'))
  const call = async (auth = 'Bearer svc') => { const r = await handler(new Request('http://x/f', { headers: { Authorization: auth } })); return { s: r.status, j: await r.json() } }
  let r = await call('Bearer anon')
  ck('only the owner\'s Desktop script can call it', r.s === 401)
  r = await call()
  ck('counts the past clients (current and never-clients left out)', r.s === 200 && r.j.past_total === 7, r.j)
  ck('never a deceased client\'s family; not ended in the last 30 days; not over 3 years ago', r.j.deceased === 1 && r.j.ended_last_30_days === 1 && r.j.ended_over_3_years === 1 && !r.j.list.some((x) => /Dee|Rita|Olga/.test(x.name)), r.j)
  ck('eligible: Pam, Nell, Sal, Eve', r.j.eligible === 4 && ['Pam Past', 'Nell Nofam', 'Sal Self', 'Eve Email'].every((n) => r.j.list.some((x) => x.name === n)), r.j.list)
  const by = (n) => r.j.list.find((x) => x.name === n)
  ck('Pam: her son has a mobile and an email (reachable by text or email)', by('Pam Past').family_mobile === 1 && by('Pam Past').family_email === 1 && by('Pam Past').reachable)
  ck('Eve: a home phone only (no text) but an email', by('Eve Email').family_mobile === 0 && by('Eve Email').family_email === 1 && by('Eve Email').reachable)
  ck('Sal: no family listed, but her own mobile', by('Sal Self').family === 0 && by('Sal Self').own_mobile && r.j.family_contact_only_self === 1)
  ck('Nell: nobody to reach', !by('Nell Nofam').reachable && r.j.unreachable === 1)
  ck('totals: 3 reachable, 2 by text, 2 by email', r.j.reachable === 3 && r.j.by_text === 2 && r.j.by_email === 2, r.j)
  ck('the answer has no phone number or email address in it', !/555|@x\.com|0102/.test(JSON.stringify(r.j)), JSON.stringify(r.j).slice(0, 300))
  ck('it writes nothing', WRITES.length === 0, WRITES)
  ck('AxisCare is only asked by client number (never by name or phone)', CALLS.every((u) => /\/api\/clients(\/\d+\/responsibleParties)?$/.test(u)) && !CALLS.some((u) => /Dee|\/3\/responsibleParties/.test(u)), CALLS)
  AXDOWN = true; r = await call()
  ck('AxisCare unreadable: the families count as unknown and it says so (errors counted)', r.s === 200 && r.j.axiscare_errors === 4, r.j)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
