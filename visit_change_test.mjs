// visit-change: the REAL function and the REAL staff check, against a fake database and a fake AxisCare.
// node visit_change_test.mjs
import fs from 'fs'; import path from 'path'
const res = []; const ck = (n, c, note) => res.push([n, !!c, c ? '' : String(JSON.stringify(note ?? null)).slice(0, 800)])
let T, AX, PATCHES, RPCS, EVENTS, AXFAIL, DRIFT
const today = new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
const reset = (live = true) => { PATCHES = []; RPCS = []; EVENTS = []; AXFAIL = 0; DRIFT = false
  AX = { 's=12:d=2026-10-20': { id: 's=12:d=2026-10-20', client: { id: 900, firstName: 'Ed', lastName: 'Anderson' }, caregiver: { id: 5, firstName: 'Kim', lastName: 'Aide' },
      scheduledStartDate: '2026-10-20T09:00:00', scheduledEndDate: '2026-10-20T14:00:00', verified: false },
    's=13:d=2026-10-06': { id: 's=13:d=2026-10-06', client: { id: 901, firstName: 'Ruth', lastName: 'B' }, caregiver: { id: 6, firstName: 'Di', lastName: 'Aide' },
      scheduledStartDate: '2026-10-06T08:00:00', scheduledEndDate: '2026-10-06T12:00:00', clockIn: { time: '2026-10-06T08:02:00' } } }
  T = { app_data: [{ key: 'ops_settings', data: { visit_change_live: live } }, { key: 'visit_changes', data: [] }],
    auth_identities: [{ auth_user_id: 'u-kr', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p-kr' }, { auth_user_id: 'u-cg', project_ref: 'zngsgedlsxinbygwmxwn', person_id: 'p-cg' }],
    persons: [{ person_id: 'p-kr', full_name: 'Krystal Office', active: true }, { person_id: 'p-cg', full_name: 'Cara Giver', active: true }],
    entity_memberships: [{ person_id: 'p-kr', entity: 'cc_ihs', active: true, ended_at: null }, { person_id: 'p-cg', entity: 'cc_ihs', active: true, ended_at: null }],
    staff_roles: [{ person_id: 'p-kr', entity: 'cc_ihs', role: 'care_coordinator' }, { person_id: 'p-cg', entity: 'cc_ihs', role: 'caregiver' }], op_events: [] } }
const q = (t) => { const st = { f: [] }; const b = { select() { return b }, order() { return b }, limit() { return b }, in() { return b }, not() { return b },
  eq(c, v) { st.f.push([c, v]); return b }, insert(row) { if (t === 'op_events') EVENTS.push(row); return Promise.resolve({ data: null, error: null }) },
  maybeSingle() { return b.then((x) => ({ data: x.data[0] ?? null, error: null })) },
  then(ok) { let rows = T[t] ?? []; for (const [c, v] of st.f) rows = rows.filter((r) => r[c] === v); return Promise.resolve({ data: JSON.parse(JSON.stringify(rows)), error: null }).then(ok) } }; return b }
globalThis.__db = { from: q, rpc: async (fn, a) => { RPCS.push([fn, a])
    if (fn === 'upsert_app_data_item') { const row = T.app_data.find((r) => r.key === a.target_key); const i = row.data.findIndex((x) => x.id === a.item.id); if (i >= 0) row.data[i] = JSON.parse(JSON.stringify(a.item)); else row.data.push(JSON.parse(JSON.stringify(a.item))) }
    return { data: { outcome: 'recorded' }, error: null } },
  auth: { getUser: async (jwt) => jwt === 'kr' ? { data: { user: { id: 'u-kr', email: 'krystal@mo-care.com', app_metadata: {} } }, error: null }
    : jwt === 'cg' ? { data: { user: { id: 'u-cg', email: 'cg@mo-care.com', app_metadata: {} } }, error: null } : { data: { user: null }, error: { message: 'bad' } } } }
globalThis.fetch = async (url, o = {}) => { url = String(url); const m = o.method || 'GET'
  if (url.endsWith('/api/visits/modification-reasons')) return new Response(JSON.stringify({ results: { modificationReasons: [{ id: 5, name: 'Staffing Change - Caregiver Change' }, { id: 6, name: 'Staffing Change - Caregiver Call Off' }, { id: 10, name: 'Schedule Change - Client Schedule Change' }, { id: 13, name: 'Administrative Correction - Office Error' }, { id: 99, name: 'Old', disabled: true }] } }), { status: 200 })
  const id = decodeURIComponent(url.split('/api/visits/')[1] || ''), v = AX[id]
  if (!v) return new Response('{}', { status: 404 })
  if (m === 'PATCH') { const body = JSON.parse(o.body); PATCHES.push({ id, body }); if (AXFAIL) return new Response(JSON.stringify({ errors: ['Unknown modificationReason: 5'] }), { status: 422 })
    if ('caregiverId' in body) v.caregiver = body.caregiverId === null ? null : { id: body.caregiverId, firstName: body.caregiverId === 7 ? 'Lia' : 'Kim', lastName: body.caregiverId === 7 ? 'Listed' : 'Aide' }
    const d = body.visitDate || v.scheduledStartDate.slice(0, 10)
    v.scheduledStartDate = d + 'T' + (body.startTime || v.scheduledStartDate.slice(11, 16)) + ':00'; v.scheduledEndDate = d + 'T' + (body.endTime || v.scheduledEndDate.slice(11, 16)) + ':00'
    return new Response(JSON.stringify({ results: { visit: v } }), { status: 200 }) }
  const out = JSON.parse(JSON.stringify(v)); if (DRIFT && PATCHES.length) out.scheduledStartDate = out.scheduledStartDate.slice(0, 11) + '09:30:00'
  return new Response(JSON.stringify({ results: { visit: out } }), { status: 200 }) }
const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', AXISCARE_API_KEY: 'a', AXISCARE_SITE: '16485' }
let handler; globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h } }
const F = 'supabase/functions', tmp = fs.mkdtempSync(path.join(process.cwd(), '_vc_'))
try {
  const src = fs.readFileSync(path.join(F, 'visit-change/index.ts'), 'utf8').replace(/^import \{ createClient \} from .*$/m, 'const createClient = () => globalThis.__db')
    .replace(/from '\.\.\/_shared\/(\w[\w-]*)\.ts'/g, (_, m) => "from '" + path.join(process.cwd(), F, '_shared', m + '.ts') + "'")
  fs.writeFileSync(path.join(tmp, 'vc.ts'), src); await import(path.join(tmp, 'vc.ts'))
  const call = async (body, jwt = 'kr') => { const r = await handler(new Request('https://x/f', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: 'Bearer ' + jwt } : {}) }, body: JSON.stringify(body) })); return { status: r.status, j: await r.json() } }
  const ED = 's=12:d=2026-10-20', seen = { caregiver_id: '5', date: '2026-10-20', start: '09:00', end: '14:00' }
  const change = (x = {}) => call({ action: 'change', visit_id: ED, expect: seen, set: { caregiver_id: '7' }, reason_id: 5, change_id: 'chg-0001-abcd', ...x })

  reset(); let r = await call({ action: 'get', visit_id: ED }, null); ck('no sign-in: refused', r.status === 401, r)
  reset(); r = await call({ action: 'change', visit_id: 's=12:d=2026-10-20', expect: { caregiver_id: '5', date: '2026-10-20', start: '09:00', end: '14:00' }, set: { caregiver_id: '7' }, reason_id: 5, change_id: 'chg-0009-abcd' }, 'cg'); ck('a caregiver account (no office role): refused, AxisCare never changed', r.status === 403 && !PATCHES.length, r)
  reset(); r = await call({ action: 'reasons' }); ck('reasons: the active list only (a switched-off one is left out)', r.j.reasons.length === 4 && !r.j.reasons.some((x) => x.id === 99) && r.j.live === true, r.j)
  reset(); r = await call({ action: 'get', visit_id: ED }); ck('get: the visit as AxisCare has it now', r.j.visit.caregiver === 'Kim Aide' && r.j.visit.start === '09:00' && r.j.visit.date === '2026-10-20' && r.j.visit.started === false && r.j.undo.length === 0, r.j)
  reset(false); r = await change(); ck('switch off: refused, nothing changed', r.j.outcome === 'off' && !PATCHES.length, r)
  reset(); r = await change()
  ck('change the caregiver: ONE PATCH of that visit with the caregiver and the reason', r.j.outcome === 'changed' && PATCHES.length === 1 && PATCHES[0].id === ED && JSON.stringify(PATCHES[0].body) === '{"caregiverId":7,"modificationReason":5}', { r, PATCHES })
  ck('...read back and confirmed, in words', r.j.confirmed === true && r.j.words === 'caregiver Kim Aide → Lia Listed' && r.j.reason === 'Staffing Change - Caregiver Change', r.j)
  const vc = () => T.app_data[1].data
  ck('...recorded: before and after, who, the reason; the AxisCare change history; op_events', vc().length === 1 && vc()[0].before.caregiver_id === '5' && vc()[0].after.caregiver_id === '7' && vc()[0].by === 'Krystal Office'
     && RPCS.some(([f, a]) => f === 'axiscare_change_record' && a.p_kind === 'visit_caregiver' && a.p_client === '900' && a.p_outcome === 'sent_confirmed') && EVENTS.some((e) => e.verb === 'visit_changed'), { ev: EVENTS, rp: RPCS.map((x) => [x[0], x[1].p_kind, x[1].p_client, x[1].p_outcome]) })
  r = await change(); ck('the same change sent twice (double click): no second PATCH', r.j.outcome === 'already_done' && PATCHES.length === 1, r)
  r = await call({ action: 'get', visit_id: ED }); ck('get offers it for undo today', r.j.undo.length === 1 && r.j.undo[0].change_id === 'chg-0001-abcd', r.j)
  r = await call({ action: 'undo', change_id: 'chg-0001-abcd' })
  ck('undo: puts Kim back with "Office Error", read back', r.j.outcome === 'changed' && JSON.stringify(PATCHES[1].body) === '{"caregiverId":5,"modificationReason":13}' && AX[ED].caregiver.id === 5 && vc().find((c) => c.id === 'chg-0001-abcd').undone_at, { r, PATCHES })
  r = await call({ action: 'undo', change_id: 'chg-0001-abcd' }); ck('...undo twice: nothing more', r.j.outcome === 'already_undone' && PATCHES.length === 2, r)
  reset(); r = await change({ set: { caregiver_id: null }, reason_id: 6, change_id: 'chg-0002-abcd' })
  ck('take the caregiver off: caregiverId null with the call-off reason', r.j.outcome === 'changed' && JSON.stringify(PATCHES[0].body) === '{"caregiverId":null,"modificationReason":6}' && AX[ED].caregiver === null && /taken off/.test(r.j.words), r.j)
  reset(); r = await change({ set: { start: '10:00', end: '15:00' }, reason_id: 10, change_id: 'chg-0003-abcd' })
  ck('change the time: start and end only, recorded as a schedule change', r.j.outcome === 'changed' && JSON.stringify(PATCHES[0].body) === '{"startTime":"10:00","endTime":"15:00","modificationReason":10}' && RPCS.some(([f, a]) => f === 'axiscare_change_record' && a.p_kind === 'schedule'), { PATCHES, RPCS })
  reset(); r = await change({ set: { date: '2026-10-21' }, reason_id: 10, change_id: 'chg-0004-abcd' })
  ck('move to another day: the date only, times kept', r.j.outcome === 'changed' && JSON.stringify(PATCHES[0].body) === '{"visitDate":"2026-10-21","modificationReason":10}' && r.j.after.start === '09:00', { PATCHES, r })
  reset(); r = await change({ set: { start: '20:00', end: '02:00' }, reason_id: 10 }); ck('an overnight time: refused (done in AxisCare)', r.j.outcome === 'refused' && /Overnight/.test(r.j.error) && !PATCHES.length, r)
  reset(); r = await change({ set: { caregiver_id: '5' } }); ck('nothing would change: refused', r.j.outcome === 'refused' && !PATCHES.length, r)
  reset(); r = await change({ reason_id: 99 }); ck('a switched-off reason: refused', r.j.outcome === 'refused' && !PATCHES.length, r)
  reset(); r = await change({ reason_id: undefined }); ck('no reason: refused', r.j.outcome === 'refused' && !PATCHES.length, r)
  reset(); r = await change({ visit_id: 's=13:d=2026-10-06', expect: { caregiver_id: '6', date: '2026-10-06', start: '08:00', end: '12:00' } })
  ck('a visit that has started: refused (an EVV correction is done in AxisCare)', r.j.outcome === 'refused' && /started/.test(r.j.error) && !PATCHES.length, r)
  reset(); AX[ED].verified = true; r = await change(); ck('a verified visit: refused', r.j.outcome === 'refused' && !PATCHES.length, r)
  reset(); r = await change({ expect: { ...seen, caregiver_id: '9' } }); ck('someone changed it since it was opened: refused, shows the visit now', r.j.outcome === 'changed_meanwhile' && r.j.visit.caregiver === 'Kim Aide' && !PATCHES.length, r)
  reset(); AXFAIL = 1; r = await change(); ck('AxisCare refuses: says so, nothing recorded as changed', r.j.outcome === 'axiscare_refused' && /Unknown modificationReason/.test(r.j.error) && !T.app_data[1].data.length && EVENTS.some((e) => e.verb === 'visit_change_refused'), r)
  reset(); DRIFT = true; r = await change()
  ck('read-back doesn\'t match: still recorded, with a plain warning to check AxisCare', r.j.outcome === 'changed' && r.j.confirmed === false && /Check the visit in AxisCare/.test(r.j.warning), r.j)
  reset(); T.app_data[1].data = [{ id: 'old-0001-abcd', visit_id: ED, at: '2026-01-01T15:00:00Z', before: seen, after: seen }]
  r = await call({ action: 'undo', change_id: 'old-0001-abcd' }); ck('undo on another day: refused (change it back in AxisCare)', r.j.outcome === 'too_late' && !PATCHES.length, r)
  reset(); r = await change(); r = await call({ action: 'change', visit_id: ED, expect: { caregiver_id: '7', date: '2026-10-20', start: '09:00', end: '14:00' }, set: { start: '10:00' }, reason_id: 10, change_id: 'chg-0005-abcd' })
  r = await call({ action: 'undo', change_id: 'chg-0001-abcd' }); ck('undo after a later change to the same visit: refused (it no longer matches)', r.j.outcome === 'changed_meanwhile' && PATCHES.length === 2, r)
} finally { fs.rmSync(tmp, { recursive: true, force: true }) }
let pass = 0; for (const [n, ok, note] of res) { console.log((ok ? '  ✓ ' : '  ✗ ') + n + (ok ? '' : '\n      ' + note)); if (ok) pass++ }
console.log(`\n${pass}/${res.length} passed`); process.exit(pass === res.length ? 0 : 1)
