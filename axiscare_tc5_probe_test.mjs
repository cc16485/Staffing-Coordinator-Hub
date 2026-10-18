// axiscare-tc5-probe against a FAKE AxisCare: node axiscare_tc5_probe_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 900)])
let handler; globalThis.Deno = { env: { get: (k) => ({ AXISCARE_API_KEY: 'k', AXISCARE_SITE: '16485' })[k] }, serve: (h) => { handler = h } }
let AX, CALLS
const reset = (o = {}) => { CALLS = []; AX = Object.assign({ name: ['Test', 'Client 5'], pref: null, schedules: [], visits: [], acceptsOpen: true, prefField: 'referredCaregiver', nullOk: true,
  caregivers: [{ id: 50, firstName: 'Canceled', lastName: 'Shift' }, { id: 9, firstName: 'Maria', lastName: 'V' }], recent: [{ service: { code: 'PP-PC' } }] }, o) }
globalThis.fetch = async (url, o = {}) => { const u = new URL(String(url)), p = u.pathname, m = o.method || 'GET', body = o.body ? JSON.parse(o.body) : null; CALLS.push([m, p + u.search, body])
  const R = (s, j) => new Response(JSON.stringify(j), { status: s })
  if (p === '/api/clients/290' && m === 'GET') return R(200, { results: { client: { firstName: AX.name[0], lastName: AX.name[1], preferredCaregiver: AX.pref == null ? null : { id: AX.pref } } } })
  if (p === '/api/clients/290' && m === 'PATCH') { const k = Object.keys(body)[0]; if (k !== AX.prefField) return R(400, { errors: ['unknown field ' + k] }); if (body[k] === null && !AX.nullOk) return R(400, { errors: ['null not allowed'] }); AX.pref = body[k] ? body[k].id : null; return R(200, {}) }
  if (p === '/api/caregivers') return R(200, { results: { caregivers: AX.caregivers } })
  if (p === '/api/schedules' && m === 'POST') { if (!AX.acceptsOpen && !body.caregiverId) return R(400, { errors: ['caregiverId is required'] }); const id = 700 + AX.schedules.length; AX.schedules.push({ scheduleId: id, startTime: body.startTime, endTime: body.endTime, caregiver: null }); AX.visits.push({ id: 'v' + id, scheduledStartDate: body.startDate + 'T' + body.startTime + ':00', caregiver: null }); return R(201, { results: { schedules: [{ scheduleId: id }] } }) }
  if (p === '/api/schedules' && m === 'GET') return R(200, { results: { schedules: AX.schedules } })
  if (p.startsWith('/api/schedules/') && m === 'DELETE') { const id = Number(p.split('/').pop()); AX.schedules = AX.schedules.filter((s) => s.scheduleId !== id); AX.visits = AX.visits.filter((v) => v.id !== 'v' + id); return R(200, {}) }
  if (p === '/api/visits') return R(200, { results: { visits: u.searchParams.get('clientIds') ? AX.visits : AX.recent } })
  return R(404, {}) }
const tmp = path.join(process.cwd(), '_tc5_under_test.ts'); fs.writeFileSync(tmp, fs.readFileSync('supabase/functions/axiscare-tc5-probe/index.ts', 'utf8'))
const M = await import(tmp); fs.unlinkSync(tmp)
const tok = (role) => 'x.' + Buffer.from(JSON.stringify({ role })).toString('base64') + '.y'
const call = async (body, role = 'service_role') => { const r = await handler(new Request('https://x/f', { method: 'POST', headers: { authorization: 'Bearer ' + tok(role) }, body: JSON.stringify(body) })); return { status: r.status, j: await r.json() } }
const writes = () => CALLS.filter(([m]) => m !== 'GET')

reset(); let r = await call({}, 'authenticated'); ck('a signed-in user (not the owner script) is refused', r.status === 403 && !CALLS.length)
reset({ name: ['Real', 'Person'] }); r = await call({ go: true }); ck('if client 290 is not "Test Client 5", it refuses and writes nothing', r.status === 409 && !writes().length, r.j)
reset(); r = await call({}); ck('go:false only reads and says what it would do', r.status === 200 && /create one open-shift schedule/.test(r.j.would) && !writes().length, r.j)
ck('the shift is a weekday at least 35 days out, ending 6 days later', r.j.plan.start >= new Date(Date.now() + 34 * 864e5).toISOString().slice(0, 10) && /day$/.test(r.j.plan.day) && r.j.plan.service_code === 'PP-PC', r.j.plan)
reset(); r = await call({ go: true })
const A = r.j.open_shift, B = r.j.preferred
ck('A: the open-shift schedule is sent with NO caregiver, client 290 only, and ends', (() => { const post = CALLS.find(([m, p]) => m === 'POST' && p === '/api/schedules'); return post && post[2].clientId === 290 && !('caregiverId' in post[2]) && post[2].endDate })(), CALLS)
ck('A: AxisCare accepted it; read back: the schedule and one unassigned visit', A.accepted_without_caregiver && A.readback_schedule.found === 1 && A.readback_visits.unassigned === 1, A)
ck('A: cleaned up and proven: no schedule or visit left', A.clean === true && A.cleanup.length === 1, A)
ck('B: the placeholder "Canceled Shift" (never a real caregiver) is used', r.j.placeholder.id === 50 && CALLS.filter(([m, p, b]) => m === 'PATCH').every(([, , b]) => { const v = Object.values(b)[0]; return v === null || v.id === 50 }), CALLS.filter(([m]) => m === 'PATCH'))
ck('B: preferredCaregiver refused, referredCaregiver took (the spec\'s PATCH name), read back', B.preferredCaregiver.took === false && B.works_with === 'referredCaregiver' && B.referredCaregiver.read_back === 50, B)
ck('B: put back to what it was (nothing) and read back', B.restore.restored === true && AX.pref === null, B)
reset({ acceptsOpen: false }); r = await call({ go: true })
ck('A: if AxisCare refuses a schedule with no caregiver, that is reported and nothing is left behind', r.j.open_shift.accepted_without_caregiver === false && /caregiverId is required/.test(JSON.stringify(r.j.open_shift.create.errors)) && !AX.schedules.length, r.j.open_shift)
reset({ nullOk: false }); r = await call({ go: true })
ck('B: if AxisCare will not clear the field, the report says it was not restored (no silent leftovers)', r.j.preferred.restore.restored === false, r.j.preferred)
reset({ caregivers: [{ id: 9, firstName: 'Maria', lastName: 'V' }] }); r = await call({ go: true })
ck('B: no placeholder caregiver: the preference test is skipped (never a real person)', /never a real caregiver|no real caregiver/.test(r.j.preferred.skipped || '') && !CALLS.some(([m, p]) => m === 'PATCH'), r.j.preferred)
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
