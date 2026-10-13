// Driver Compliance in scheduling (2026-10-13). Her rule: "A caregiver who is Non-Driver, Pending Verification, or Suspended
// must not be treated as eligible for shifts that require transporting clients. Only Approved Drivers with current, verified
// documentation should qualify for transportation assignments." No driver record yet = not eligible (no assumption).
//   1. ONE RULE, TWO COPIES: the server's _shared/driver-eligibility.ts and the Hub's match-rules.js (HUB_ROOT) give the same
//      answer on one table of cases (the same table the Hub's tests/match-rules-test.js checks), and the same need levels.
//   2. shift-ask-gate blockReason: the needsTransport input.
//   3. profile-check: the HARD transportation competency reads the driver record, never the self-reported skill.
//   4. coverage-shifts team_pool: every row carries dl_status, cleared_to_drive and the two expiries from the roster.
// No network. node driver_scheduling_test.mjs   (HUB_ROOT = the Hub worktree; default ../../../launch/sched-hub)
import fs from 'fs'; import path from 'path'; import { createRequire } from 'module'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions')
const HUB = process.env.HUB_ROOT || process.env.HUB || path.join(ROOT, '../../../launch/sched-hub')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const D = await import(path.join(FN, '_shared/driver-eligibility.ts'))

/* 1. the two copies agree */
const H = createRequire(import.meta.url)(path.join(HUB, 'match-rules.js'))
const DRIVE_TABLE = [
  [{ dl_status: 'Approved Driver', cleared_to_drive: true, dl_expires: '2027-05-01', auto_ins_expires: '2027-02-01' }, null, true, 'Approved Driver'],
  [{ dl_status: 'Approved Driver', cleared_to_drive: true, dl_expires: '2027-05-01', auto_ins_expires: '2027-02-01' }, '2026-10-13', true, 'Approved Driver'],
  [{ dl_status: 'Approved Driver', cleared_to_drive: true, dl_expires: '2027-05-01', auto_ins_expires: '2026-10-13' }, '2026-10-13', false, 'License or insurance expired'],
  [{ dl_status: 'Approved Driver', cleared_to_drive: true, dl_expires: '2026-10-01', auto_ins_expires: '2027-02-01' }, '2026-10-13', false, 'License or insurance expired'],
  [{ dl_status: 'Approved Driver', cleared_to_drive: false, dl_expires: '2026-10-01', auto_ins_expires: '2027-02-01' }, null, false, 'License or insurance expired'],
  [{ dl_status: 'Approved Driver', cleared_to_drive: false }, null, false, 'License or insurance expiration not on file'],
  [{ dl_status: 'Approved Driver' }, null, false, 'License or insurance expiration not on file'],
  [{ dl_status: 'Pending Verification', cleared_to_drive: false }, null, false, 'Not an Approved Driver (Pending Verification)'],
  [{ dl_status: 'Pending Verification', cleared_to_drive: true }, null, false, 'Not an Approved Driver (Pending Verification)'],
  [{ dl_status: 'Non-Driver', cleared_to_drive: false }, null, false, 'Not an Approved Driver (Non-Driver)'],
  [{ dl_status: 'Suspended', cleared_to_drive: false, dl_expires: '2027-05-01' }, null, false, 'Driving suspended'],
  [{ dl_status: 'suspended' }, null, false, 'Driving suspended'],
  [{ dl_status: 'Not set up yet' }, null, false, 'No driver record yet'],
  [{}, null, false, 'No driver record yet'],
  [{ cleared_to_drive: true, dl_expires: '2027-05-01', auto_ins_expires: '2027-02-01' }, null, false, 'No driver record yet'],
  [null, null, false, 'No driver record yet'],
  [{ dl_status: 'Maybe' }, null, false, 'Not an Approved Driver (Maybe)'],
]
DRIVE_TABLE.forEach(([cg, today, ok, why], i) => {
  const a = D.transportEligible(cg, today || undefined), b = H.transportEligible(cg, today || undefined)
  ck('driver table ' + i + ' (' + why + '): server and Hub agree, and both are right', a.ok === ok && a.why === why && b.ok === a.ok && b.why === a.why, { server: a, hub: b })
})
const NEED_TABLE = [
  [{}, null], [{ planNeeds: ['hoyer_lift'] }, null], [{ planNeeds: ['transportation'] }, 'required'],
  [{ facts: [{ kind: 'need_transportation', layer: 'plan', value: 'required' }] }, 'required'],
  [{ facts: [{ kind: 'need_transportation', layer: 'intake', value: 'Required' }] }, 'required'],
  [{ facts: [{ kind: 'need_transportation', layer: 'intake', value: 'required' }, { kind: 'need_transportation', layer: 'plan', value: 'no' }] }, null],
  [{ facts: [{ kind: 'need_transportation', layer: 'plan', value: 'preferred' }] }, 'preferred'],
  [{ attrs: { transportation: 'yes' } }, 'required'], [{ attrs: { transportation: 'preferred' } }, 'preferred'], [{ attrs: { transportation: 'no' } }, null], [{ attrs: { transportation: '' } }, null],
  [{ attrs: { transportation: 'preferred' }, planNeeds: ['transportation'] }, 'required'],
]
NEED_TABLE.forEach(([x, lvl], i) => { const a = D.transportNeed(x), b = H.transportNeed(x)
  ck('need table ' + i + ' (' + lvl + '): server and Hub agree', a.level === lvl && JSON.stringify(a) === JSON.stringify(b), { server: a, hub: b }) })
const DEC = [[{ dl_status: 'Pending Verification' }, 'required', true], [{ dl_status: 'Pending Verification' }, 'required', false], [{ dl_status: 'Suspended' }, 'preferred', true], [{ dl_status: 'Suspended' }, 'preferred', false],
  [{}, null, true], [{}, 'required', false], [{ dl_status: 'Approved Driver', cleared_to_drive: true }, 'required', true], [{ dl_status: 'Non-Driver' }, 'bogus', true]]
DEC.forEach(([cg, lvl, live], i) => { const a = D.transportDecision(cg, lvl, live), b = H.transportDecision(cg, lvl, live)
  ck('decision table ' + i + ': server and Hub agree', JSON.stringify(a) === JSON.stringify(b), { server: a, hub: b }) })
ck('the rollout switch: on only when ops_settings.driver_schedule_gate_live === true (server and Hub)', [[{ driver_schedule_gate_live: true }, true], [{ driver_schedule_gate_live: 'true' }, false], [{}, false], [null, false]].every(([st, v]) => D.driveGateOn(st) === v && H.driveGateOn(st) === v))
ck('switch off: required + not cleared is never excluded, only the note', (() => { const d = D.transportDecision({ dl_status: 'Suspended' }, 'required', false); return !d.exclude && !d.rankLower && d.note === 'Driver check (not enforced yet): Driving suspended' })())
/* the function bodies themselves: the same statements in the same order (types and semicolons aside) */
const body = (src, name) => { const i = src.indexOf('function ' + name + '('); let d = 0, j = src.lastIndexOf('{', src.indexOf('\n', i)); const s = j
  for (; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}' && --d === 0) break } return src.slice(s, j + 1) }
const norm = (t) => t.replace(/: \{ ok: boolean; why: string \}|: 'required' \| 'preferred' \| null|: string\[\]|: any/g, '').replace(/\(v\)/g, 'v').replace(/\(l\)/g, 'l').replace(/;\s*$/gm, '').replace(/;(?=\s*\})/g, '').replace(/\s+/g, ' ').replace(/; /g, ' ').trim()
const tsSrc = fs.readFileSync(path.join(FN, '_shared/driver-eligibility.ts'), 'utf8'), hubSrc = fs.readFileSync(path.join(HUB, 'match-rules.js'), 'utf8')
for (const f of ['transportEligible', 'transportNeed', 'driveGateOn', 'transportDecision']) ck('the two copies of ' + f + ' are the same code', norm(body(tsSrc, f)) === norm(body(hubSrc, f)), [norm(body(tsSrc, f)), norm(body(hubSrc, f))])

/* 2. shift-ask-gate */
const G = await import(path.join(FN, '_shared/shift-ask-gate.ts'))
const base = { name: 'Ann Lee', axId: '7', client: 'Mary Example', dno: [], dnr: [], locked: new Set() }
ck('gate: a shift that does not need transportation is unaffected for a Non-Driver', G.blockReason({ ...base, cg: { dl_status: 'Non-Driver' } }) === null)
ck('gate: needs transportation + Pending Verification: blocked, the why in words', G.blockReason({ ...base, cg: { dl_status: 'Pending Verification' }, needsTransport: true }) === 'Ann Lee is not cleared to drive clients, and this shift needs transportation (Not an Approved Driver (Pending Verification))')
ck('gate: needs transportation + no driver record yet: blocked', /No driver record yet/.test(G.blockReason({ ...base, cg: {}, needsTransport: true }) || ''))
ck('gate: needs transportation + Approved Driver with current documents: may text', G.blockReason({ ...base, cg: { dl_status: 'Approved Driver', cleared_to_drive: true, dl_expires: '2099-01-01', auto_ins_expires: '2099-01-01' }, needsTransport: true }) === null)
ck('gate: an insurance date already passed blocks even before the nightly suspend', /License or insurance expired/.test(G.blockReason({ ...base, cg: { dl_status: 'Approved Driver', cleared_to_drive: true, dl_expires: '2099-01-01', auto_ins_expires: '2026-10-01' }, needsTransport: true, today: '2026-10-13' }) || ''))
ck('gate: Do Not Return still comes first', /Do Not Return/.test(G.blockReason({ ...base, cg: {}, dnr: [{ caregiver: 'Ann Lee', client: 'Mary Example' }], needsTransport: true })))

/* 3. profile-check */
{ const env = { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'svc', AXISCARE_SITE_NUMBER: '16485', AXISCARE_TOKEN: 't', AXISCARE_API_KEY: 't', AXISCARE_SITE: '16485' }
  let handler = null; globalThis.Deno = { env: { get: (k) => env[k] }, serve: (h) => { handler = h } }
  let APP = {}
  globalThis.__fakeCreateClient = () => ({ from: (table) => { const f = []; const b = {
    select() { return b }, eq(c, v) { f.push([c, v]); return b }, neq() { return b }, limit() { return b }, order() { return b },
    maybeSingle() { if (table === 'app_data') { const key = (f.find(([c]) => c === 'key') || [])[1]; return Promise.resolve({ data: APP[key] ? { data: APP[key] } : null, error: null }) } return Promise.resolve({ data: null, error: null }) },
    then(ok) { return Promise.resolve({ data: [], error: null }).then(ok) } }; return b } })
  globalThis.fetch = async (u) => { const url = new URL(String(u)); const R = (b) => new Response(JSON.stringify(b), { status: 200 })
    if (url.pathname.endsWith('/caregivers/9')) return R({ results: { caregiver: { id: 9, firstName: 'Cara', lastName: 'Giver', status: { active: true, label: 'Active' }, gender: 'F', classes: [{ label: 'Level 2 - Personal Care' }] } } })
    if (url.pathname.endsWith('/clients/55')) return R({ results: { client: { id: 55, firstName: 'Cli', lastName: 'Ent', classes: [{ label: 'Level 2 - Personal Care' }] } } })
    throw new Error('unexpected ' + u) }
  const src = fs.readFileSync(path.join(FN, 'profile-check/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = globalThis.__fakeCreateClient')
  const tmp = path.join(FN, 'profile-check', '_tdrv.ts'); fs.writeFileSync(tmp, src)
  try { await import(tmp) } finally { fs.unlinkSync(tmp) }
  const tok = 'x.' + Buffer.from(JSON.stringify({ role: 'authenticated' })).toString('base64') + '.y'
  const call = async (body) => { const r = await handler(new Request('http://x/profile-check', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify(body) })); return r.json() }
  const seed = (drv, attrs = { transportation: 'yes' }, gate = true) => { APP = {
    caregivers: [{ axiscare_id: '9', first: 'Cara', last: 'Giver', orient_date: '2026-01-01', alz_date: '2026-01-02', oig_status: 'CLEAR', edl_status: 'Clear', fcsr_status: 'Clear', skills: { transportation: { have: 'yes' } }, ...drv }],
    caregiver_overlay: [{ id: 'cgov_9', axiscare_id: '9', skills: { transportation: { have: 'yes', evidence: 'attested' } } }], caregiver_availability: [],
    leads: [{ id: 'L1', axiscare_client_id: '55', client_attributes: attrs }], dnr_log: [], ops_settings: { driver_schedule_gate_live: gate } } }
  const tr = (j) => (j.items || []).find((i) => i.code === 'skill_transportation')
  seed({ dl_status: 'Pending Verification', cleared_to_drive: false }); let j = await call({ caregiver_eval: { axiscare_id: '9', client_lead_id: 'L1' } })
  ck('profile-check: client needs transportation, says yes to driving but Pending Verification: HARD fail with the why', tr(j)?.status === 'fail' && tr(j).severity === 'HARD' && /Not an Approved Driver \(Pending Verification\)/.test(tr(j).detail), tr(j) || j)
  seed({}); j = await call({ caregiver_eval: { axiscare_id: '9', client_lead_id: 'L1' } })
  ck('profile-check: no driver record yet: fail (self-reported yes does not count)', tr(j)?.status === 'fail' && /No driver record yet/.test(tr(j).detail), tr(j))
  seed({ dl_status: 'Approved Driver', cleared_to_drive: true, dl_expires: '2099-01-01', auto_ins_expires: '2099-01-01' }); j = await call({ caregiver_eval: { axiscare_id: '9', client_lead_id: 'L1' } })
  ck('profile-check: an Approved Driver with current documents passes', tr(j)?.status === 'pass', tr(j))
  seed({ dl_status: 'Suspended' }, { transportation: '' }); j = await call({ caregiver_eval: { axiscare_id: '9', client_lead_id: 'L1' } })
  ck('profile-check: a client who does not need transportation: no driving line at all', !tr(j), tr(j))
  seed({ dl_status: 'Pending Verification', cleared_to_drive: false }, { transportation: 'yes' }, false); j = await call({ caregiver_eval: { axiscare_id: '9', client_lead_id: 'L1' } })
  const dc = (j.items || []).find((i) => i.code === 'driver_check')
  ck('profile-check, switch off: the HARD transportation line is as before (the skills record says yes: pass), and the driver check is a WARN beside it', tr(j)?.status === 'pass' && tr(j).severity === 'HARD' && dc && dc.severity === 'WARN' && dc.detail === 'Driver check (not enforced yet): Not an Approved Driver (Pending Verification)', { tr: tr(j), dc })
  const st = await (await handler(new Request('http://x/profile-check?selftest=1', { method: 'GET' }))).json()
  ck('profile-check: the self-test still passes', (st.results || st).every((x) => x.pass), (st.results || st).filter((x) => !x.pass)) }

/* 4. coverage-shifts team_pool */
{ const T = { app_data: [{ key: 'caregivers', data: [
      { axiscare_id: '11', first: 'Ann', dl_status: 'Approved Driver', cleared_to_drive: true, dl_expires: '2027-01-01', auto_ins_expires: '2027-02-01' },
      { axiscare_id: '12', first: 'Bo', dl_status: 'Pending Verification', cleared_to_drive: false }, { axiscare_id: '13', first: 'Cy' }] },
    { key: 'caregiver_availability', data: [] }], client_journey: [], client_journey_step: [] }
  globalThis.__db = { from: (t) => { const f = []; const b = { select() { return b }, eq(c, v) { f.push([c, v]); return b }, in() { return b }, limit() { return b },
    maybeSingle() { return b.then((x) => ({ data: x.data[0] ?? null, error: null })) },
    then(ok) { let r = T[t] ?? []; for (const [c, v] of f) r = r.filter((x) => x[c] === v); return Promise.resolve({ data: r, error: null }).then(ok) } }; return b } }
  const ENV = { AXISCARE_API_KEY: 't', AXISCARE_SITE: '16485', SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k' }
  let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
  globalThis.fetch = async (url) => { url = String(url)
    if (/\/api\/caregivers/.test(url)) return new Response(JSON.stringify({ results: { caregivers: [11, 12, 13, 14].map((id) => ({ id, firstName: 'G' + id, lastName: 'X', status: { active: true }, classes: [] })) } }), { status: 200 })
    return new Response(JSON.stringify({ results: { visits: [] } }), { status: 200 }) }
  const tmp = fs.mkdtempSync(path.join(ROOT, '_tdp_'))
  try {
    const src = fs.readFileSync(path.join(FN, 'coverage-shifts/index.ts'), 'utf8')
      .replace(/const \{ createClient: cc6 \} = await import\('https:\/\/esm\.sh\/@supabase\/supabase-js@2'\)/, 'const cc6 = () => globalThis.__db')
      .replace(/from '\.\.\/_shared\/(\w[\w-]*)\.ts'/g, (_, m) => "from '" + path.join(FN, '_shared', m + '.ts') + "'")
    fs.writeFileSync(path.join(tmp, 'cs.ts'), src); await import(path.join(tmp, 'cs.ts'))
    const jwt = 'x.' + Buffer.from(JSON.stringify({ role: 'authenticated' })).toString('base64url') + '.y'
    const r = await handler(new Request('https://x/functions/v1/coverage-shifts', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt }, body: JSON.stringify({ team_pool: true }) }))
    const j = await r.json(), by = Object.fromEntries((j.caregivers || []).map((p) => [p.axiscare_id, p]))
    ck('team_pool: the Approved Driver row carries the roster\'s driver fields', by['11']?.dl_status === 'Approved Driver' && by['11'].cleared_to_drive === true && by['11'].dl_expires === '2027-01-01' && by['11'].auto_ins_expires === '2027-02-01', j)
    ck('team_pool: Pending Verification carried as is', by['12']?.dl_status === 'Pending Verification' && by['12'].cleared_to_drive === false, by['12'])
    ck('team_pool: no driver record (or no roster row) = nulls, which the one rule reads as not cleared', by['13']?.dl_status === null && by['13'].cleared_to_drive === null && by['14']?.dl_status === null && !H.transportEligible(by['14']).ok, [by['13'], by['14']])
    ck('team_pool: nothing else changed on the row (new hire flags still there)', 'new_hire' in by['11'] && 'work_locked' in by['11'], by['11'])
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) } }

/* no em dashes in the words this change added */
for (const f of ['_shared/driver-eligibility.ts']) ck('no em dash in ' + f, !/\u2014/.test(fs.readFileSync(path.join(FN, f), 'utf8')))
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
