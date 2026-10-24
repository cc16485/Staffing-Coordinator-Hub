// axiscare-cancel-probe (1107): read only, owner key only, no names out. node axiscare_cancel_probe_test.mjs
import fs from 'fs'; import path from 'path'
const ROOT = path.dirname(new URL(import.meta.url).pathname), FN = path.join(ROOT, 'supabase/functions/axiscare-cancel-probe')
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 1200)])
const CALLS = []
const V = (id, o) => ({ id, client: { id: 500, firstName: 'Ruth', lastName: 'Secret' }, caregiver: { id: 7, firstName: 'Amy', lastName: 'Private' }, scheduledStartDate: '2026-10-20T13:00:00Z', removed: false, verified: false, chargeRate: 30, ...o })
const PAGE1 = [V('s=1:d=2026-10-20', { modificationReason: { name: 'Staffing Change - Caregiver Call Off' } }),
  V('s=2:d=2026-10-21', { caregiver: { id: 299, firstName: 'Canceled', lastName: 'Shift' }, modificationReason: { name: 'Schedule Change - Client Cancellation' }, verified: true }),
  V('s=3:d=2026-10-22', { caregiver: null, modificationReason: { name: 'Staffing Change - Caregiver Change' } })]
const PAGE2 = [V('v=9:s=0:d=2026-10-26', { removed: true, client: { id: 290, firstName: 'Test', lastName: 'Client 5' }, modificationReason: { name: 'Schedule Change - Client Cancellation' } }),
  V('s=4:d=2026-10-23', { doNotBill: true })]
globalThis.fetch = async (url, o) => {
  url = String(url); CALLS.push({ url, method: (o && o.method) || 'GET', body: o && o.body })
  const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s })
  if (url.includes('/modification-reasons')) return J({ results: { modificationReasons: [{ id: 6, name: 'Staffing Change - Caregiver Call Off', disabled: false }, { id: 12, name: 'Schedule Change - Client Unavailable', disabled: true }] } })
  if (/\/api\/visits\/v%3D9/.test(url)) return J({ results: { visit: PAGE2[0] } })
  if (url.includes('visitIds=')) return J({ results: { visits: [PAGE2[0]] } })
  if (url.includes('/api/visits?') && !url.includes('page=2')) return J({ results: { visits: PAGE1, nextPage: 'https://16485.axiscare.com/api/visits?page=2' } })
  if (url.includes('page=2')) return J({ results: { visits: PAGE2, nextPage: null } })
  if (url.includes('/api/clients')) return J({ results: { clients: [{ id: 290, firstName: 'Test', lastName: 'Client 5', status: { label: 'Active', active: true } }] } })
  if (url.includes('/api/caregivers')) return J({ results: { caregivers: [{ id: 7, firstName: 'Amy', lastName: 'Private' }, { id: 299, firstName: 'Canceled', lastName: 'Shift', status: { label: 'Active' } }] } })
  return J({}, 404)
}
const ENV = { AXISCARE_SITE: '16485', AXISCARE_API_KEY: 'k' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const tmp = path.join(FN, '_t.ts'); fs.writeFileSync(tmp, fs.readFileSync(path.join(FN, 'index.ts'), 'utf8'))
let M; try { M = await import(tmp + '?' + Math.random()) } finally { fs.unlinkSync(tmp) }
const jwt = (role) => 'x.' + Buffer.from(JSON.stringify({ role })).toString('base64') + '.y'
const call = async (role, body = {}) => { const r = await handler(new Request('https://x/', { method: 'POST', headers: { Authorization: 'Bearer ' + jwt(role) }, body: JSON.stringify(body) })); return [r.status, await r.json()] }

let [s, j] = await call('anon')
ck('a public or signed-in caller is refused, and AxisCare is not asked', s === 403 && CALLS.length === 0)
;[s, j] = await call('service_role', { deleted_visit_ids: ['v=9:s=0:d=2026-10-26'] })
ck('owner key: answers', s === 200 && j.read_only === true, j)
ck('READ ONLY: every AxisCare call is a GET with no body', CALLS.length > 0 && CALLS.every((c) => c.method === 'GET' && !c.body), CALLS.filter((c) => c.method !== 'GET'))
ck('the change reasons, with which are switched off', j.reasons.list.length === 2 && j.reasons.list[1].disabled === true && j.reasons.list[1].id === 12)
ck('the deleted visit: found by id and in the list, marked removed', j.deleted[0].by_id.found && j.deleted[0].by_id.removed === true && j.deleted[0].in_list.found && j.deleted[0].in_list.removed === true, j.deleted)
ck('the window: both pages read, complete', j.window.pages === 2 && j.window.complete === true && j.window.visits === 5, j.window)
ck('per reason, removed counted apart', j.window.by_reason['Staffing Change - Caregiver Call Off'] === 1 && j.window.removed === 1 && j.window.removed_by_reason['Schedule Change - Client Cancellation'] === 1, j.window)
ck('field names counted; "doNotBill" is caught when any visit carries it', j.window.fields.doNotBill === 1 && j.window.billing_fields_seen.includes('doNotBill') && j.window.billing_fields_seen.includes('chargeRate'), j.window.billing_fields_seen)
ck('the placeholder\'s visits: counted, verified and with a rate, its reasons', j.window.placeholder.visits === 1 && j.window.placeholder.verified === 1 && j.window.placeholder.with_rate === 1 && j.window.placeholder.by_reason['Schedule Change - Client Cancellation'] === 1)
ck('empty visits by reason', j.window.empty.visits === 1 && j.window.empty.by_reason['Staffing Change - Caregiver Change'] === 1)
ck('the Test Client: status and its visits', j.test_client.name === 'Test Client 5' && j.test_client.active === true && j.window.test_client.visits === 1 && j.window.test_client.removed === 1)
ck('the placeholder caregiver\'s id', j.placeholder_caregiver.id === 299)
const text = JSON.stringify(j)
ck('no real names leave it (only the Test Client and the placeholder)', !/Secret|Private|Ruth|Amy/.test(text), text.match(/Secret|Private|Ruth|Amy/g))
ck('placeholder spellings', M.isPlaceholder({ firstName: 'Cancelled', lastName: 'Shift' }) && M.isPlaceholder({ firstName: 'Canceled' }) && !M.isPlaceholder({ firstName: 'Shift', lastName: 'Canceled' }))
for (const [n, o, d] of res) console.log((o ? 'PASS' : 'FAIL') + ' · ' + n + (o ? '' : '\n     ' + d))
console.log(`${res.filter((x) => x[1]).length}/${res.length}`)
