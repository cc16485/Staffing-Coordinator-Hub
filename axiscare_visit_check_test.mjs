// axiscare-visit-check: the REAL function against a fake AxisCare. node axiscare_visit_check_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 700)])
let CALLS = [], MODE = 'ok', V = { id: 's=12:d=2026-10-07', caregiver: { id: 5, firstName: 'Kim', lastName: 'Aide' }, client: { firstName: 'Ed' }, scheduledStartDate: '2026-10-07T09:00:00', scheduledEndDate: '2026-10-07T14:00:00', verified: false }
globalThis.fetch = async (url, o = {}) => { url = String(url); const m = o.method || 'GET'; CALLS.push(m + ' ' + url + ' ' + (o.body || '') + ' ' + (o.headers?.Authorization || ''))
  if (url.endsWith('/api/visits/modification-reasons')) return new Response(JSON.stringify({ results: { modificationReasons: [{ id: 1, name: 'Caregiver call-off', disabled: false }, { id: 2, name: 'Old', disabled: true }] } }), { status: 200 })
  if (url.includes('/api/visits?')) return new Response(JSON.stringify({ results: { visits: [{ id: 'x', removed: true }, V] } }), { status: 200 })
  if (url.includes('/api/visits/s%3D12')) {
    if (m === 'PATCH') { if (o.body !== '{}') return new Response('{}', { status: 500 })
      const ro = o.headers.Authorization === 'Bearer ro'
      return new Response(JSON.stringify(ro ? { errors: ['Forbidden'] } : { results: null, errors: [MODE === 'reason' ? 'A modification reason is required.' : 'At least one field must be provided for the update.'] }), { status: ro ? 403 : 400 }) }
    return new Response(JSON.stringify({ results: { visit: V } }), { status: 200 }) }
  return new Response('{}', { status: 404 }) }
const ENV = { AXISCARE_VISITS_TOKEN: 'ro', AXISCARE_API_KEY: 'rw', AXISCARE_SITE: '16485' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const tmp = fs.mkdtempSync(path.join(process.cwd(), '_avc_'))
const jwt = (role) => 'x.' + Buffer.from(JSON.stringify({ role })).toString('base64url') + '.y'
try {
  fs.copyFileSync('supabase/functions/axiscare-visit-check/index.ts', path.join(tmp, 'f.ts')); await import(path.join(tmp, 'f.ts'))
  const call = async (role) => { const r = await handler(new Request('https://x/f', { method: 'POST', headers: { Authorization: 'Bearer ' + jwt(role) } })); return { status: r.status, j: await r.json() } }
  let r = await call('authenticated'); ck('a signed-in browser is refused; AxisCare never asked', r.status === 403 && !CALLS.length, r)
  CALLS = []; r = await call('service_role')
  ck('reads the change reasons (names, ids, which are switched off)', r.j.reasons.list.length === 2 && r.j.reasons.list[0].name === 'Caregiver call-off' && r.j.reasons.list[1].disabled === true, r.j.reasons)
  ck('picks a real upcoming visit and reports field NAMES only (no client or caregiver names)', r.j.sample.has_caregiver && r.j.sample.id_shape === 's=N:d=N-N-N' && !JSON.stringify(r.j).includes('Kim') && !JSON.stringify(r.j).includes('"Ed"'), r.j.sample)
  const patches = CALLS.filter((c) => c.startsWith('PATCH'))
  ck('every PATCH has an EMPTY body (changes nothing), one per key', patches.length === 2 && patches.every((c) => c.includes(' {} ')), patches)
  ck('...the visits-only key is reported as unable to edit; the main key as able', r.j.edit.find((e) => e.key === 'AXISCARE_VISITS_TOKEN').meaning === 'this key cannot edit visits' && /can edit visits/.test(r.j.edit.find((e) => e.key === 'AXISCARE_API_KEY').meaning), r.j.edit)
  ck('...and the visit reads back unchanged', r.j.unchanged === true && r.j.changed_nothing === true, r.j)
  MODE = 'reason'; CALLS = []; r = await call('service_role')
  ck('when AxisCare requires a reason for changes, it says so', r.j.edit.some((e) => /every change needs a reason/.test(e.meaning)), r.j.edit)
  ck('never a POST or DELETE', !CALLS.some((c) => /^(POST|DELETE)/.test(c)), CALLS)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
