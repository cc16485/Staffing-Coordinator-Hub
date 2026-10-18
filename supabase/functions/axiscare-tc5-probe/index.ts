// =============================================================================
// axiscare-tc5-probe: two AxisCare questions answered on TEST CLIENT 5 only (Start of Care stage D; Samantha approved
// 2026-10-17: "I approve testing open shifts and preferred caregiver fields on Test Client 5, with appropriate cleanup
// and verification. Do not make untested assumptions about AxisCare API behavior.")
// =============================================================================
// Owner script only (the service key); never for browsers. Hard-locked to AxisCare client 290, and it refuses unless
// that client's name still reads "Test Client 5". Nothing is texted, no real client or caregiver schedule is touched.
//
//   A. OPEN SHIFT. Can the Hub create a schedule with NO caregiver (an open shift)?
//      1. POST /api/schedules for client 290: one weekday, one 2-hour shift, starting 35+ days out, ending 6 days later
//         (so at most one visit could ever exist), no caregiverId.
//      2. Read back: the schedule (GET /api/schedules) and the visit it made (GET /api/visits): does the visit exist,
//         and with no caregiver?
//      3. Clean up: DELETE /api/schedules/{id}?effectiveDate=<start>, then read back that the schedule and visit are gone.
//   B. PREFERRED CAREGIVER. Which field name does a client update accept: preferredCaregiver (the spec's POST name) or
//      referredCaregiver (the spec's PATCH name)? On client 290 only, with the placeholder caregiver "Canceled Shift"
//      (never a real person), then put back to what it was, read back each time.
//
// go:false (the default) reads only and says what it WOULD do. go:true runs A and B. Every AxisCare answer is
// returned (status + errors), so the result is evidence, not a guess.
// 2026-10-17 (914, after 913): AxisCare only takes schedules for an ACTIVE client, and Test Client 5 was inactive, so A
// was not answered. only:'open_shift' runs A alone; it refuses unless Samantha has set #290 Active, and
// set_status_after:'Inactive' puts it back afterwards (read back). A refusal names AxisCare's real reason.
// =============================================================================
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b, null, 1), { status: s, headers: { 'Content-Type': 'application/json' } })
const VER = Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01'
const TEST_CLIENT = 290
// deno-lint-ignore no-explicit-any
type Any = any
const rowsOf = (v: Any): Any[] => Array.isArray(v) ? v : (v && typeof v === 'object') ? Object.values(v) : []
export function roleOf(auth: string | null): string {
  try { const t = String(auth || '').replace(/^Bearer\s+/i, ''); return String(JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))?.role || '') } catch { return '' }
}
const chi = (n: number) => new Date(Date.now() + n * 864e5).toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
const DAYNAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
/** the first weekday (Mon-Fri) 35 or more days out, and its name */
export function probeDay(fromNow = 35): { date: string; day: string } {
  for (let i = fromNow; i < fromNow + 7; i++) { const d = chi(i), w = new Date(d + 'T12:00:00Z').getUTCDay(); if (w >= 1 && w <= 5) return { date: d, day: DAYNAME[w] } }
  return { date: chi(fromNow), day: DAYNAME[new Date(chi(fromNow) + 'T12:00:00Z').getUTCDay()] }
}
const addDays = (d: string, n: number) => { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10) }

async function ax(method: string, path: string, body?: unknown): Promise<{ status: number; json: Any }> {
  let token = ''; for (const n of ['AXISCARE_API_KEY', 'AXISCARE_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  if (!token || !/^\d+$/.test(site)) return { status: 0, json: { errors: ['AxisCare credentials not set'] } }
  try {
    const r = await fetch(`https://${site}.axiscare.com${path}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json', 'X-AxisCare-Api-Version': VER },
      body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: r.status, json: await r.json().catch(() => ({})) }
  } catch (e) { return { status: 0, json: { errors: [String((e as Error).message ?? e)] } } }
}
const errs = (r: { json: Any }) => r?.json?.errors ?? null
const ok2 = (s: number) => s >= 200 && s < 300
const cgOf = (v: Any) => v?.preferredCaregiver ?? v?.referredCaregiver ?? null
/** the client's status as AxisCare gives it (a word, or { active, label }) */
export function statusOf(rec: Any): { label: string; active: boolean | null } {
  const v = rec?.status
  if (v && typeof v === 'object') return { label: String(v.label ?? ''), active: typeof v.active === 'boolean' ? v.active : /^active$/i.test(String(v.label ?? '')) }
  return { label: String(v ?? ''), active: v == null ? null : /^active$/i.test(String(v)) }
}
/** why AxisCare refused a schedule, in words: the client, the caregiver, or something else */
export function refusalReason(errors: Any): 'client_inactive' | 'caregiver_required' | 'service_not_on_client' | 'other' {
  const t = JSON.stringify(errors ?? '').toLowerCase()
  if (/service code|service description|servicecode|available for the client/.test(t)) return 'service_not_on_client'
  if (/client\w*\s*(id)?\s*is inactive|inactive or does not exist|client.*inactive/.test(t)) return 'client_inactive'
  if (/caregiver/.test(t)) return 'caregiver_required'
  return 'other'
}
const cgId = (x: Any) => (x && typeof x === 'object' ? (x.id ?? null) : x ?? null)

async function clientRec(): Promise<Any> {
  const r = await ax('GET', `/api/clients/${TEST_CLIENT}`)
  return { status: r.status, rec: r.json?.results?.client ?? r.json?.results ?? r.json?.client ?? null }
}
async function schedulesFor(from: string, to: string) {
  const r = await ax('GET', `/api/schedules?clientIds=${TEST_CLIENT}&startDate=${from}&endDate=${to}`)
  return { status: r.status, list: rowsOf(r.json?.results?.schedules ?? r.json?.schedules ?? r.json?.results) }
}
async function visitsFor(from: string, to: string) {
  const r = await ax('GET', `/api/visits?clientIds=${TEST_CLIENT}&startDate=${from}&endDate=${to}`)
  return { status: r.status, list: rowsOf(r.json?.results?.visits ?? r.json?.visits).filter((v: Any) => v && !v.removed) }
}

Deno.serve(async (req) => {
  if (roleOf(req.headers.get('authorization')) !== 'service_role') return json({ error: 'owner script only' }, 403)
  const b: Any = await req.json().catch(() => ({}))
  const go = b.go === true, out: Any = { test_client: TEST_CLIENT, go }

  // the lock: client 290 must still be Test Client 5
  const c0 = await clientRec()
  const nm = [c0.rec?.firstName, c0.rec?.lastName].filter(Boolean).join(' ')
  out.client = { status: c0.status, name: nm, preferred_before: cgId(cgOf(c0.rec)), field_names: c0.rec ? Object.keys(c0.rec).filter((k) => /caregiver/i.test(k)) : [], client_status: statusOf(c0.rec) }
  if (c0.status !== 200 || !/test client 5/i.test(nm)) return json({ ...out, refused: 'AxisCare client 290 is not "Test Client 5" (or could not be read): nothing was done' }, 409)

  // a service code this agency uses (from a recent visit), for the schedule
  const recent = await ax('GET', `/api/visits?startDate=${chi(-14)}&endDate=${chi(0)}`)
  /* 915: AxisCare only takes a service set up on that client's Billing tab, so every code the agency uses is a candidate */
  const codes = [...new Set([...(typeof b.service_code === 'string' && b.service_code ? [b.service_code] : []),
    ...rowsOf(recent.json?.results?.visits ?? recent.json?.visits).map((v: Any) => v?.service?.code ?? v?.serviceCode ?? null).filter(Boolean).map(String)])]
  const svc = codes[0] || ''
  const pd = probeDay(Number(b.days_out) >= 21 ? Number(b.days_out) : 35), end = addDays(pd.date, 6)
  out.plan = { service_code: svc || null, service_codes: codes, start: pd.date, end, day: pd.day, time: '09:00-11:00' }
  // the placeholder caregiver for the preference test: "Canceled Shift", never a real person
  let ph: Any = null
  for (let page = 1, url: string | null = '/api/caregivers?statuses=Active&limit=500'; url && page <= 5; page++) {
    const r = await ax('GET', url); const list = rowsOf(r.json?.results?.caregivers ?? r.json?.caregivers)
    ph = list.find((g: Any) => /^cancel+ed$/i.test(String(g?.firstName || '').trim()) && /^shift$/i.test(String(g?.lastName || '').trim())) ?? ph
    if (ph) break
    const nx = r.json?.results?.nextPage ?? r.json?.nextPage ?? null; url = nx ? String(nx).replace(/^https?:\/\/[^/]+/, '') : null
  }
  out.placeholder = ph ? { id: ph.id, name: 'Canceled Shift' } : null
  const onlyA = b.only === 'open_shift'
  if (onlyA && out.client.client_status.active !== true) return json({ ...out, not_active: 'Test Client 5 is ' + (out.client.client_status.label || 'not Active') + ' in AxisCare. AxisCare only takes schedules for an Active client: set it to Active first. Nothing was done.' }, 409)
  if (!go) return json({ ...out, would: 'A: create one open-shift schedule on ' + pd.day + ' ' + pd.date + ' to ' + end + ' 9-11am, read it back, delete it, read back. B: set the preferred caregiver to the placeholder, read back, put it back, read back.' })

  /* ── A. OPEN SHIFT ── */
  const A: Any = {}; out.open_shift = A
  if (!svc) A.skipped = 'no service code found to use'
  else {
    const before = await schedulesFor(pd.date, end)
    A.schedules_before = before.list.length
    let r: Any = null; A.tried = []
    for (const code of codes.slice(0, 12)) {
      r = await ax('POST', '/api/schedules', { clientId: TEST_CLIENT, days: [pd.day], startDate: pd.date, endDate: end, startTime: '09:00', endTime: '11:00', serviceCode: code, frequency: 1 })
      A.tried.push({ code, status: r.status, errors: errs(r) })
      if (ok2(r.status) || !/service/i.test(JSON.stringify(errs(r) ?? ''))) { A.service_code = code; break }
    }
    A.create = { status: r.status, errors: errs(r), body_keys: Object.keys(r.json || {}) }
    const ids = rowsOf(r.json?.schedules ?? r.json?.results?.schedules ?? r.json?.results).map((x: Any) => x?.scheduleId ?? x?.id).filter((x: Any) => x != null).map(String)
    A.created_ids = ids
    A.accepted_without_caregiver = ok2(r.status)
    if (!ok2(r.status)) A.reason = refusalReason(errs(r))
    if (ok2(r.status)) {
      const sb = await schedulesFor(pd.date, end)
      const mine = sb.list.filter((s: Any) => ids.includes(String(s?.scheduleId ?? s?.id)) || (String(s?.startTime || '').startsWith('09:00') && String(s?.endTime || '').startsWith('11:00')))
      A.readback_schedule = { status: sb.status, found: mine.length, caregiver_on_it: mine.map((s: Any) => s?.caregiver?.id ?? null) }
      const vb = await visitsFor(pd.date, end)
      const vmine = vb.list.filter((v: Any) => String(v?.scheduledStartDate ?? v?.startDate ?? '').slice(11, 16) === '09:00')
      A.readback_visits = { status: vb.status, found: vmine.length, unassigned: vmine.filter((v: Any) => v?.caregiver?.id == null).length, ids: vmine.map((v: Any) => String(v.id)) }
      A.cleanup = []
      const delIds = ids.length ? ids : mine.map((s: Any) => String(s?.scheduleId ?? s?.id)).filter(Boolean)
      for (const id of delIds) { const d = await ax('DELETE', `/api/schedules/${encodeURIComponent(id)}?effectiveDate=${pd.date}`); A.cleanup.push({ id, status: d.status, errors: errs(d) }) }
      const sa = await schedulesFor(pd.date, end), va = await visitsFor(pd.date, end)
      A.after_cleanup = { schedules_left: sa.list.filter((s: Any) => delIds.includes(String(s?.scheduleId ?? s?.id))).length,
        visits_left: va.list.filter((v: Any) => String(v?.scheduledStartDate ?? v?.startDate ?? '').slice(11, 16) === '09:00').length }
      A.clean = A.after_cleanup.schedules_left === 0 && A.after_cleanup.visits_left === 0
    }
  }

  /* put the client's status back when asked (914): read back */
  if (typeof b.set_status_after === 'string' && /^(Inactive|Active)$/.test(b.set_status_after)) {
    const r2 = await ax('PATCH', `/api/clients/${TEST_CLIENT}`, { status: b.set_status_after })
    const back = await clientRec()
    out.status_after = { to: b.set_status_after, status: r2.status, errors: errs(r2), read_back: statusOf(back.rec).label, restored: statusOf(back.rec).label.toLowerCase() === b.set_status_after.toLowerCase() }
  }
  if (onlyA) return json(out)
  /* ── B. PREFERRED CAREGIVER ── */
  const B: Any = {}; out.preferred = B
  if (!ph) B.skipped = 'the placeholder caregiver "Canceled Shift" was not found among active caregivers; no real caregiver is used for this test'
  else {
    const was = cgId(cgOf(c0.rec))
    for (const field of ['preferredCaregiver', 'referredCaregiver']) {
      const r = await ax('PATCH', `/api/clients/${TEST_CLIENT}`, { [field]: { id: Number(ph.id) } })
      const back = await clientRec()
      B[field] = { status: r.status, errors: errs(r), read_back: cgId(cgOf(back.rec)), took: String(cgId(cgOf(back.rec))) === String(ph.id) }
      if (B[field].took) { B.works_with = field; break }
    }
    if (B.works_with) {
      const restoreBody = { [B.works_with]: was == null ? null : { id: Number(was) } }
      const r = await ax('PATCH', `/api/clients/${TEST_CLIENT}`, restoreBody)
      const back = await clientRec()
      B.restore = { to: was, status: r.status, errors: errs(r), read_back: cgId(cgOf(back.rec)), restored: String(cgId(cgOf(back.rec)) ?? '') === String(was ?? '') }
    }
  }
  return json(out)
})
