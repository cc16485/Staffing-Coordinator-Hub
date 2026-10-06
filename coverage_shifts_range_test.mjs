// coverage-shifts live_schedule with a date range (calendar views, 2026-10-06). The REAL function against a fake AxisCare.
// node coverage_shifts_range_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
let CALLS = [], PAGES = 2
const visit = (id, day, t, cg) => ({ id, scheduledStartDate: `${day}T${t}:00`, scheduledEndDate: `${day}T14:00:00`,
  client: { id: 9, firstName: 'Ed', lastName: 'Anderson' }, ...(cg ? { caregiver: { id: 5, firstName: 'Kim', lastName: 'Aide' } } : {}) })
globalThis.fetch = async (url) => { url = String(url); CALLS.push(url)
  const u = new URL(url), p = Number(u.searchParams.get('page') || 1)
  const rows = [visit('v' + p + 'a', u.searchParams.get('startDate') || '2026-10-06', '09:00', true), visit('v' + p + 'b', u.searchParams.get('endDate') || '2026-10-06', '16:00', false), { id: 'gone', removed: true }]
  const next = p < PAGES ? `https://16485.axiscare.com/api/visits?startDate=${u.searchParams.get('startDate')}&endDate=${u.searchParams.get('endDate')}&page=${p + 1}` : null
  return new Response(JSON.stringify({ results: { visits: rows, nextPage: next } }), { status: 200 }) }
const ENV = { AXISCARE_API_KEY: 't', AXISCARE_SITE: '16485' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_cs_'))
const jwt = (role) => 'x.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.y'
try {
  const src = fs.readFileSync(path.join(F, 'coverage-shifts/index.ts'), 'utf8')
    .replace(/from '\.\.\/_shared\/(\w[\w-]*)\.ts'/g, (_, m) => "from '" + path.join(process.cwd(), F, '_shared', m + '.ts') + "'")
  fs.writeFileSync(path.join(tmp, 'cs.ts'), src); await import(path.join(tmp, 'cs.ts'))
  const call = async (body, role = 'authenticated') => { const r = await handler(new Request('https://x/functions/v1/coverage-shifts', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + jwt(role) }, body: JSON.stringify(body) })); return { status: r.status, j: await r.json() } }
  let r = await call({ live_schedule: true, start: '2026-10-05', end: '2026-10-11' }, 'anon')
  ck('the public key: refused, AxisCare never asked', r.status === 403 && !CALLS.length, r)
  CALLS = []; r = await call({ live_schedule: true, date: '2026-10-06' })
  ck('one day, as before: that day asked of AxisCare, removed visits left out', CALLS[0].includes('startDate=2026-10-06&endDate=2026-10-06') && r.j.total === 4 && r.j.date === '2026-10-06' && !r.j.rows.some((x) => x.visit_id === 'gone'), r.j)
  CALLS = []; r = await call({ live_schedule: true, start: '2026-10-05', end: '2026-10-11' })
  ck('a week: one range asked of AxisCare, every page read', CALLS[0].includes('startDate=2026-10-05&endDate=2026-10-11') && CALLS.length === 2 && r.j.total === 4 && r.j.start === '2026-10-05' && r.j.end === '2026-10-11', { CALLS, j: r.j })
  ck('...each visit carries its own date, sorted by date then time', r.j.rows.map((x) => x.date + ' ' + x.time).join(',') === '2026-10-05 09:00,2026-10-05 09:00,2026-10-11 16:00,2026-10-11 16:00', r.j.rows)
  ck('...unassigned counted, caregiver names kept', r.j.unassigned === 2 && r.j.rows.filter((x) => x.caregiver === 'Kim Aide').length === 2, r.j)
  CALLS = []; r = await call({ live_schedule: true, start: '2026-10-01', end: '2026-11-11' })
  ck('a 42-day month grid is allowed', r.status === 200 && CALLS.length === 2, r)
  CALLS = []; r = await call({ live_schedule: true, start: '2026-10-01', end: '2026-11-12' })
  ck('more than 42 days: refused, AxisCare never asked', r.status === 400 && /at most 42 days/.test(r.j.error) && !CALLS.length, r)
  CALLS = []; r = await call({ live_schedule: true, start: '2026-10-11', end: '2026-10-05' })
  ck('end before start: refused', r.status === 400 && !CALLS.length, r)
  PAGES = 99; CALLS = []; r = await call({ live_schedule: true, start: '2026-10-01', end: '2026-10-31' })
  ck('a range with more pages than one read holds: stops at 60 pages and says the list is partial', CALLS.length === 60 && /shorter range/.test(r.j.partial || ''), { n: CALLS.length, p: r.j.partial })
  PAGES = 99; CALLS = []; r = await call({ live_schedule: true, date: '2026-10-06' })
  ck('one day keeps its old 8-page limit', CALLS.length === 8, CALLS.length)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
