// axiscare-tc5-probe against a FAKE AxisCare: node axiscare_tc5_probe_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : JSON.stringify(note ?? null).slice(0, 900)])
let handler; globalThis.Deno = { env: { get: (k) => ({ AXISCARE_API_KEY: 'k', AXISCARE_SITE: '16485' })[k] }, serve: (h) => { handler = h } }
let AX, CALLS
const reset = (o = {}) => { CALLS = []; AX = Object.assign({ id: 290, name: ['Test', 'Client 5'], status: 'Active', pref: null, schedules: [], visits: [], acceptsOpen: true, prefField: 'referredCaregiver', nullOk: true,
  caregivers: [{ id: 50, firstName: 'Canceled', lastName: 'Shift' }, { id: 9, firstName: 'Maria', lastName: 'V' }], recent: [{ service: { code: 'PP-PC' } }] }, o) }
globalThis.fetch = async (url, o = {}) => { const u = new URL(String(url)), p = u.pathname, m = o.method || 'GET', body = o.body ? JSON.parse(o.body) : null; CALLS.push([m, p + u.search, body])
  const R = (s, j) => new Response(JSON.stringify(j), { status: s })
  if (p === '/api/clients/' + AX.id && m === 'GET') return R(200, { results: { client: { firstName: AX.name[0], lastName: AX.name[1], status: AX.statusObj ? { active: AX.status === 'Active', label: AX.status } : AX.status, preferredCaregiver: AX.pref == null ? null : { id: AX.pref } } } })
  if (p === '/api/clients/' + AX.id && m === 'PATCH' && 'status' in body) { AX.status = body.status; return R(200, {}) }
  if (p === '/api/clients/' + AX.id && m === 'PATCH') { const k = Object.keys(body)[0]; if (k !== AX.prefField) return R(400, { errors: ['unknown field ' + k] }); if (body[k] === null && !AX.nullOk) return R(400, { errors: ['null not allowed'] }); AX.pref = body[k] ? body[k].id : null; return R(200, {}) }
  if (p === '/api/clients' && m === 'GET') return R(200, { results: { clients: AX.list ?? [{ id: AX.id, firstName: AX.name[0], lastName: AX.name[1] }] } })
  if (p === '/api/caregivers') return R(200, { results: { caregivers: AX.caregivers } })
  if (p === '/api/schedules' && m === 'POST') { if (AX.clientServices && !AX.clientServices.includes(body.serviceCode)) return R(400, { errors: ['Invalid service code or description. Provide only either serviceCode or serviceDescription, and ensure it is available for the client.'] }); if (AX.status !== 'Active') return R(400, { errors: ['The provided clientId is inactive or does not exist.'] }); if (!AX.acceptsOpen && !body.caregiverId) return R(400, { errors: ['caregiverId is required'] }); const id = 700 + AX.schedules.length; AX.schedules.push({ scheduleId: id, startTime: body.startTime, endTime: body.endTime, caregiver: null }); AX.visits.push({ id: 'v' + id, scheduledStartDate: body.startDate + 'T' + body.startTime + ':00', caregiver: null }); return R(201, { results: { schedules: [{ scheduleId: id }] } }) }
  if (p === '/api/schedules' && m === 'GET') return R(200, { results: { schedules: AX.schedules } })
  if (p.startsWith('/api/schedules/') && m === 'DELETE') { const id = Number(p.split('/').pop()); AX.schedules = AX.schedules.filter((s) => s.scheduleId !== id); AX.visits = AX.visits.filter((v) => v.id !== 'v' + id); return R(200, {}) }
  if (p === '/api/visits') return R(200, { results: { visits: u.searchParams.get('clientIds') ? AX.visits : AX.recent } })
  return R(404, {}) }
const tmp = path.join(process.cwd(), 'supabase/functions/axiscare-tc5-probe/_under_test.ts'); fs.writeFileSync(tmp, fs.readFileSync('supabase/functions/axiscare-tc5-probe/index.ts', 'utf8'))
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
/* 914: the open-shift retest on an Active Test Client 5, put back to Inactive afterwards */
reset({ status: 'Inactive' }); r = await call({ go: true, only: 'open_shift', set_status_after: 'Inactive' })
ck('914: Test Client 5 still Inactive: refuses before writing anything, saying to set it Active first', r.status === 409 && /set it to Active first/.test(r.j.not_active) && !writes().length, r.j)
reset({ status: 'Active', statusObj: true }); r = await call({ go: true, only: 'open_shift', set_status_after: 'Inactive' })
ck('914: Active ({active,label} form): the open shift is tried, read back, cleaned up', r.status === 200 && r.j.open_shift.accepted_without_caregiver && r.j.open_shift.clean, r.j)
ck('914: put back to Inactive and read back; the preference test is not repeated', r.j.status_after.restored === true && AX.status === 'Inactive' && !r.j.preferred && !CALLS.some(([m, p, b]) => m === 'PATCH' && b && !('status' in b)), r.j)
reset({ status: 'Active', acceptsOpen: false }); r = await call({ go: true, only: 'open_shift', set_status_after: 'Inactive' })
ck('914: a refusal about the caregiver is named as that (not mixed up with an inactive client)', r.j.open_shift.reason === 'caregiver_required' && AX.status === 'Inactive', r.j.open_shift)
ck('914: refusalReason reads AxisCare\'s inactive-client words as client_inactive', M.refusalReason(['The provided clientId is inactive or does not exist.']) === 'client_inactive' && M.refusalReason(['caregiverId is required']) === 'caregiver_required' && M.refusalReason(['bad time']) === 'other')
/* 915: the service has to be one set up on Test Client 5 */
reset({ status: 'Active', recent: [{ service: { code: 'PP - WC' } }, { service: { code: 'PP - PC' } }], clientServices: ['PP - PC'] }); r = await call({ go: true, only: 'open_shift', set_status_after: 'Inactive' })
ck('915: tries each service the agency uses until AxisCare takes one set up on Test Client 5; nothing made by the refused tries', r.j.open_shift.service_code === 'PP - PC' && r.j.open_shift.tried.length === 2 && r.j.open_shift.accepted_without_caregiver && r.j.open_shift.clean && AX.status === 'Inactive', r.j.open_shift)
reset({ status: 'Active', recent: [{ service: { code: 'PP - WC' } }], clientServices: [] }); r = await call({ go: true, only: 'open_shift', set_status_after: 'Inactive' })
ck('915: no service set up on Test Client 5: named as that (not an open-shift answer), and back to Inactive', r.j.open_shift.reason === 'service_not_on_client' && !r.j.open_shift.accepted_without_caregiver && AX.status === 'Inactive', r.j.open_shift)
/* 916: the open-shift test on the AxisCare Practice client (Test Client 5 stayed Inactive through 915) */
const PR = (o = {}) => reset(Object.assign({ id: 401, name: ['Practice', 'Client'], status: 'Active', list: [{ id: 290, firstName: 'Test', lastName: 'Client 5' }, { id: 401, firstName: 'Practice', lastName: 'Client' }, { id: 77, firstName: 'Practice', lastName: 'Smith' }],
  schedules: [{ scheduleId: 650, startTime: '09:00', endTime: '11:00', caregiver: { id: 9 } }], visits: [{ id: 'v650', scheduledStartDate: '2026-12-01T09:00:00', caregiver: { id: 9 } }] }, o))
PR(); r = await call({ client: 'practice', only: 'open_shift' })
ck('916: finds the Practice client by its exact name (not "Practice Smith", not Test Client 5); go:false writes nothing', r.status === 200 && r.j.test_client === 401 && r.j.target === 'practice' && !writes().length, r.j)
PR(); r = await call({ go: true, client: 'practice', only: 'open_shift' })
const PA = r.j.open_shift, post = CALLS.find(([m, p]) => m === 'POST' && p === '/api/schedules')
ck('916: the open shift goes to the Practice client with no caregiver, is read back and cleaned up', r.status === 200 && post && post[2].clientId === 401 && !('caregiverId' in post[2]) && PA.accepted_without_caregiver && PA.readback_visits.unassigned === 1 && PA.clean, PA)
ck('916: the Practice client\'s own 9-11am schedule and visit are never deleted, and the report proves it', AX.schedules.some((x) => x.scheduleId === 650) && AX.visits.some((v) => v.id === 'v650') && PA.after_cleanup.untouched === true && !CALLS.some(([m, p]) => m === 'DELETE' && p.includes('/650')), CALLS.filter(([m]) => m === 'DELETE'))
ck('916: no status change and no preferred-caregiver test on the Practice client', !CALLS.some(([m]) => m === 'PATCH') && !r.j.preferred && !r.j.status_after && AX.status === 'Active', r.j)
PR(); r = await call({ go: true, client: 'practice' })
ck('916: the Practice client refuses anything but the open-shift test', r.status === 400 && !writes().length, r.j)
PR(); r = await call({ go: true, client: 'practice', only: 'open_shift', set_status_after: 'Inactive' })
ck('916: the Practice client refuses a status change', r.status === 400 && !writes().length, r.j)
PR({ list: [{ id: 401, firstName: 'Practice', lastName: '' }, { id: 402, firstName: 'Practice', lastName: 'Client' }] }); r = await call({ go: true, client: 'practice', only: 'open_shift' })
ck('916: two Practice clients: refuses, names both, writes nothing', r.status === 409 && /#401, #402/.test(r.j.refused) && !writes().length, r.j)
PR({ list: [] }); r = await call({ go: true, client: 'practice', only: 'open_shift' })
ck('916: no Practice client: refuses, writes nothing', r.status === 409 && /0 clients/.test(r.j.refused) && !writes().length, r.j)
PR({ status: 'Inactive' }); r = await call({ go: true, client: 'practice', only: 'open_shift' })
ck('916: an Inactive Practice client is named as such and nothing is written', r.status === 409 && /^The Practice client is Inactive/.test(r.j.not_active) && !writes().length, r.j)
PR({ acceptsOpen: false }); r = await call({ go: true, client: 'practice', only: 'open_shift' })
ck('916: if AxisCare refuses no-caregiver schedules on the Practice client, that is the answer and nothing is left', r.j.open_shift.reason === 'caregiver_required' && AX.schedules.length === 1, r.j.open_shift)
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
