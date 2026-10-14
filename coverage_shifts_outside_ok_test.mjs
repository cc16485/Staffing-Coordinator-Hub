// coverage-shifts MATCH mode (Team Builder "who fits"), 2026-10-14: a caregiver who ticked "also text me about open shifts
// outside my availability" stays on the list when the asked hours are outside their times, flagged, after everyone who fits.
// Without the box, outside their times = left off, as before. The REAL function against a fake AxisCare and a fake database.
// node coverage_shifts_outside_ok_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 900)])
const CGS = [
  { id: 1, firstName: 'Fits', lastName: 'Morning', status: { active: true }, classes: [] },
  { id: 2, firstName: 'Outside', lastName: 'Ok', status: { active: true }, classes: [] },
  { id: 3, firstName: 'Outside', lastName: 'No', status: { active: true }, classes: [] },
  { id: 4, firstName: 'Never', lastName: 'Filled', status: { active: true }, classes: [] },
]
const W = (days, times) => Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, days.includes(d) ? times : []]))
let AV = []
globalThis.fetch = async (url) => { url = String(url)
  if (url.includes('/api/caregivers')) return new Response(JSON.stringify({ results: { caregivers: CGS, nextPage: null } }), { status: 200 })
  return new Response(JSON.stringify({ results: { visits: [], nextPage: null } }), { status: 200 }) }
const ENV = { AXISCARE_API_KEY: 't', AXISCARE_SITE: '16485', SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_cso_'))
const jwt = (role) => 'x.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.y'
try {
  fs.writeFileSync(path.join(tmp, 'fake-sb.mjs'), `export const createClient = () => ({ from: (t) => ({ select: () => ({ eq: (c, k) => ({ maybeSingle: async () => ({ data: k === 'caregiver_availability' ? { data: globalThis.__AV } : null }) }) }) }) })`)
  const src = fs.readFileSync(path.join(F, 'coverage-shifts/index.ts'), 'utf8')
    .replace(/from '\.\.\/_shared\/(\w[\w-]*)\.ts'/g, (_, m) => "from '" + path.join(process.cwd(), F, '_shared', m + '.ts') + "'")
    .replaceAll("await import('https://esm.sh/@supabase/supabase-js@2')", "await import('" + path.join(tmp, 'fake-sb.mjs') + "')")
  fs.writeFileSync(path.join(tmp, 'cs.ts'), src); await import(path.join(tmp, 'cs.ts'))
  const call = async (body) => { const r = await handler(new Request('https://x/functions/v1/coverage-shifts', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt('authenticated') }, body: JSON.stringify(body) })); return { status: r.status, j: await r.json() } }
  globalThis.__AV = AV = [
    { id: '1', axiscare_id: '1', windows: W(['mon'], ['morning']), target_hours: 30 },
    { id: '2', axiscare_id: '2', windows: W(['sat'], ['evening']), target_hours: 20, outside_ok: true },
    { id: '3', axiscare_id: '3', windows: W(['sat'], ['evening']), target_hours: 20, outside_ok: false },
  ]
  const r = await call({ match: { days: ['mon'], windows: ['morning'] } })
  const names = (r.j.matches || []).map((m) => m.name)
  ck('the call works', r.status === 200, r)
  ck('fits their times: listed', names.includes('Fits Morning'), names)
  ck('outside their times WITHOUT the box: left off, as before', !names.includes('Outside No'), names)
  ck('outside their times WITH the box: listed, flagged outside_ok, covering none of the asked slots', (() => { const m = r.j.matches.find((x) => x.name === 'Outside Ok'); return m && m.outside_ok === true && m.covers_n === 0 && m.covers === '0/1' && m.hours_short === 20 })(), r.j.matches)
  ck('no availability on file: still assumed available (her 24-hour rule), unchanged', r.j.matches.some((x) => x.name === 'Never Filled' && x.assumed_available === true), r.j.matches)
  ck('outside-OK people come after everyone who fits (stated or assumed)', names.indexOf('Outside Ok') === names.length - 1, names)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
