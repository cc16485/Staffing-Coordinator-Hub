// =============================================================================
// CI1 · CALL-INS: THE SAFE FILL (2026-10-03, her "yes to all" on the call-ins plan)
// =============================================================================
// Confirming who covers a call-in, and closing a case, happen HERE on the server, never by saving a page's whole copy:
//   confirmFill  the case must still be open; exactly one confirm wins (coverage_case_patch, under the row lock, with
//                expect {status:'open'}); only the fill fields change, so a YES that just arrived is never lost.
//                Then AxisCare: the visit gets the caregiver only if it is still the caller-off's, or nobody's. If
//                AxisCare shows someone else there, it stops and says so instead of overwriting (assignInAxis).
//   closeCase    "Close uncovered" (and the link page's other closes): same one-winner rule.
// Who may call these is decided by the function that calls them (coverage-assign: office staff; callin-alert in CI2:
// an admin's sealed link). Every text that follows a fill (the winner's confirmation, the others' courtesy texts, the
// family's caregiver-changed text) stays exactly where it is: coverage-run's next tick, unchanged.
// =============================================================================

const AC_VERSION = Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01'
function axisCreds() {
  let token = ''
  for (const n of ['AXISCARE_VISITS_TOKEN', 'AXISCARE_API_KEY', 'AXISCARE_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site: /^\d+$/.test(site) ? site : '' }
}
// deno-lint-ignore no-explicit-any
const rowsOf = (v: any): any[] => Array.isArray(v) ? v : (v && typeof v === 'object') ? Object.values(v) : []
// deno-lint-ignore no-explicit-any
async function ac(method: string, path: string, body?: unknown, send: typeof fetch = fetch): Promise<{ ok: boolean; status: number; j: any }> {
  const { token, site } = axisCreds()
  if (!token || !site) return { ok: false, status: 0, j: { errors: ['AxisCare credentials not set'] } }
  try {
    const r = await send(`https://${site}.axiscare.com${path}`, { method, signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': AC_VERSION, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) })
    const j = await r.json().catch(() => ({}))
    return { ok: r.ok && j?.success !== false, status: r.status, j }
  } catch (err) { return { ok: false, status: 0, j: { errors: ['network: ' + String(err)] } } }
}
// deno-lint-ignore no-explicit-any
async function recordAxisChange(db: any, c: { client: string | null; caregiver: string | null; outcome: 'sent_confirmed' | 'sent' | 'refused'; summary: string; detail?: string | null; by: string }) {
  if (!c.client) return
  try {
    await db.rpc('axiscare_change_record', { p_kind: 'visit_caregiver', p_subject: 'client', p_client: c.client, p_caregiver: c.caregiver,
      p_outcome: c.outcome, p_summary: String(c.summary).slice(0, 200), p_detail: c.detail ? String(c.detail).slice(0, 300) : null, p_by: c.by, p_via: 'coverage-assign' })
  } catch { /* recording never blocks the change */ }
}
const nameKey = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
const now = () => new Date().toISOString()

// deno-lint-ignore no-explicit-any
export async function readCase(db: any, id: string): Promise<any | null> {
  const { data } = await db.from('app_data').select('data').eq('key', 'coverage_cases').maybeSingle()
  // deno-lint-ignore no-explicit-any
  return (Array.isArray(data?.data) ? data!.data : []).find((x: any) => x?.id === id) ?? null
}
// deno-lint-ignore no-explicit-any
export async function patchCase(db: any, id: string, patch: Record<string, unknown>, expect: Record<string, unknown> = {}): Promise<{ outcome: string; item?: any }> {
  const { data, error } = await db.rpc('coverage_case_patch', { p_id: id, p_patch: patch, p_expect: expect })
  if (error) return { outcome: 'error' }
  return data ?? { outcome: 'error' }
}

export type AxisResult = { status: 'assigned' | 'already' | 'by_hand' | 'failed'; detail: string; visit_id?: string; caregiver_id?: string; verified?: boolean }
/** Put the confirmed caregiver on the AxisCare visit, only where nobody else is. Never guesses a visit. */
// deno-lint-ignore no-explicit-any
export async function assignInAxis(db: any, c: any, by: string, send: typeof fetch = fetch): Promise<AxisResult> {
  // WHO: the winner's AxisCare id from their ask, else one exact roster name match
  const asked = Array.isArray(c.asked) ? c.asked : []
  // deno-lint-ignore no-explicit-any
  const hits = asked.filter((a: any) => nameKey(a.name) === nameKey(c.covered_by))
  // deno-lint-ignore no-explicit-any
  const ids = [...new Set(hits.map((a: any) => String(a.axiscare_id || '')).filter(Boolean))]
  if (ids.length > 1) return { status: 'by_hand', detail: `"${c.covered_by}" matches ${ids.length} different asked caregivers: assign by hand in AxisCare` }
  let cgId = String(ids[0] || '')
  if (!cgId) {
    const { data: cgRow } = await db.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
    // deno-lint-ignore no-explicit-any
    const roster: any[] = Array.isArray(cgRow?.data) ? cgRow!.data : []
    const r = roster.filter((g) => nameKey(`${g.first || ''} ${g.last || ''}`) === nameKey(c.covered_by) && g.axiscare_id)
    if (r.length !== 1) return { status: 'by_hand', detail: r.length ? `"${c.covered_by}" matches ${r.length} roster rows: assign by hand in AxisCare` : `no AxisCare id found for "${c.covered_by}": assign the visit by hand in AxisCare` }
    cgId = String(r[0].axiscare_id)
  }
  if (!/^\d+$/.test(cgId)) return { status: 'by_hand', detail: `caregiver id "${cgId}" is not a number: assign by hand in AxisCare` }

  // WHICH VISIT: the case's own, or the client's only unassigned visit that day
  let visitId = String(c.axiscare_visit_id || '')
  if (!visitId) {
    if (!c.client_axiscare_id || !c.shift_date) return { status: 'by_hand', detail: 'this case has no exact AxisCare visit attached: attach the real shift on the case, or assign by hand in AxisCare' }
    const list = await ac('GET', `/api/visits?clientIds=${encodeURIComponent(String(c.client_axiscare_id))}&startDate=${c.shift_date}&endDate=${c.shift_date}`, undefined, send)
    if (!list.ok) return { status: 'by_hand', detail: `could not read the client's visits (AxisCare ${list.status}): assign by hand` }
    // deno-lint-ignore no-explicit-any
    const un = rowsOf(list.j?.results?.visits ?? list.j?.visits).filter((v: any) => !v?.removed && v?.caregiver?.id == null)
    if (un.length !== 1) return { status: 'by_hand', detail: un.length ? `${un.length} unassigned visits for that client that day: pick the right one by hand in AxisCare` : 'no unassigned visit found for that client on that date: it may already be assigned; check AxisCare' }
    visitId = String(un[0].id)
  } else {
    /* CI1: only where nobody else is. The visit must still be the caller-off's, or nobody's. */
    const cur = await ac('GET', `/api/visits/${encodeURIComponent(visitId)}`, undefined, send)
    const row = cur.j?.results?.visit ?? cur.j?.results ?? {}
    if (!cur.ok) return { status: 'by_hand', detail: `could not read the visit in AxisCare (${cur.status}): check it and assign by hand`, visit_id: visitId }
    const on = row?.caregiver?.id != null ? String(row.caregiver.id) : ''
    if (on === cgId) return { status: 'already', detail: `${c.covered_by} is already on this visit in AxisCare`, visit_id: visitId, caregiver_id: cgId, verified: true }
    if (on && on !== String(c.calling_off_id || '')) {
      const nm = [row?.caregiver?.firstName, row?.caregiver?.lastName].map((x: unknown) => String(x ?? '').trim()).filter(Boolean).join(' ')
      return { status: 'by_hand', detail: `AxisCare already shows ${nm || 'another caregiver'} on this visit, so it was NOT changed. Check AxisCare before moving anyone.`, visit_id: visitId }
    }
  }

  const patch = await ac('PATCH', `/api/visits/${encodeURIComponent(visitId)}`, { caregiverId: Number(cgId) }, send)
  const cax = /^\d+$/.test(String(c.client_axiscare_id ?? '')) ? String(c.client_axiscare_id) : null
  const what = 'caregiver #' + cgId + ' put on visit ' + visitId + (c.shift_date ? ' (' + c.shift_date + ')' : '')
  if (!patch.ok) {
    await recordAxisChange(db, { client: cax, caregiver: cgId, outcome: 'refused', summary: what, detail: 'AxisCare refused (' + patch.status + ')', by })
    return { status: 'failed', detail: `AxisCare refused the assignment (${patch.status}): assign by hand`, visit_id: visitId, caregiver_id: cgId }
  }
  const back = await ac('GET', `/api/visits/${encodeURIComponent(visitId)}`, undefined, send)
  const brow = back.j?.results?.visit ?? back.j?.results ?? {}
  const onNow = String(brow?.caregiver?.id ?? '')
  if (!back.ok || onNow !== cgId) {
    await recordAxisChange(db, { client: cax, caregiver: cgId, outcome: 'sent', summary: what, detail: 'AxisCare said OK but the read-back did not show them on the visit', by })
    return { status: 'failed', detail: `AxisCare said OK but the read-back shows "${onNow || 'nobody'}" on the visit: treat as NOT assigned, do it by hand`, visit_id: visitId, caregiver_id: cgId }
  }
  await recordAxisChange(db, { client: cax, caregiver: cgId, outcome: 'sent_confirmed', summary: what, by })
  return { status: 'assigned', detail: `${c.covered_by} is on the AxisCare schedule (checked)`, visit_id: visitId, caregiver_id: cgId, verified: true }
}

export type FillOut =
  | { outcome: 'filled'; covered_by: string; axiscare: AxisResult }
  | { outcome: 'already'; status: string; covered_by: string | null; confirmed_by: string | null; resolved_how: string | null; at: string | null }
  | { outcome: 'not_found' | 'error' | 'bad_request'; detail?: string }

/** One confirm wins. `notChosen`: what the OTHER yeses hear (her rule): {silent:true}, or {msg}, or undefined (default). */
export async function confirmFill(
  // deno-lint-ignore no-explicit-any
  db: any, p: { caseId: string; coveredBy: string; byName: string; notChosen?: { silent?: boolean; msg?: string } }, send: typeof fetch = fetch): Promise<FillOut> {
  const who = String(p.coveredBy || '').trim().slice(0, 80)
  if (!p.caseId || !who) return { outcome: 'bad_request', detail: 'which case, and who covers it?' }
  const t = now()
  const patch: Record<string, unknown> = { status: 'done', resolved_how: 'covered', covered_by: who, resolved_at: t,
    confirmed_by: p.byName || null, confirmed_at: t, reopened_from: null }
  if (p.notChosen?.silent) { patch.not_chosen_silent = true; patch.not_chosen_msg = null }
  else if (p.notChosen?.msg) { patch.not_chosen_msg = String(p.notChosen.msg).slice(0, 400); patch.not_chosen_silent = null }
  const r = await patchCase(db, p.caseId, patch, { status: 'open' })
  if (r.outcome === 'not_found') return { outcome: 'not_found' }
  if (r.outcome === 'conflict') {
    const c = r.item ?? {}
    return { outcome: 'already', status: String(c.status || ''), covered_by: c.covered_by ?? null, confirmed_by: c.confirmed_by ?? null, resolved_how: c.resolved_how ?? null, at: c.resolved_at ?? null }
  }
  if (r.outcome !== 'ok' || !r.item) return { outcome: 'error', detail: 'the case could not be saved; nothing changed' }
  const axis = await assignInAxis(db, r.item, p.byName || 'office', send)
  await patchCase(db, p.caseId, { axiscare_assignment: { ...axis, at: now(), by: 'coverage-assign' } })
  return { outcome: 'filled', covered_by: who, axiscare: axis }
}

export const CLOSE_HOW = { uncovered: 'uncovered', other_way: 'covered_other_way', client_cancelled: 'client_cancelled' } as const
/** Close without a fill (one close wins, same as confirm). */
export async function closeCase(
  // deno-lint-ignore no-explicit-any
  db: any, p: { caseId: string; how: keyof typeof CLOSE_HOW; note?: string; byName: string }) {
  if (!p.caseId || !(p.how in CLOSE_HOW)) return { outcome: 'bad_request' as const }
  const t = now()
  const r = await patchCase(db, p.caseId, { status: 'done', resolved_how: CLOSE_HOW[p.how], covered_by: null, resolved_at: t,
    confirmed_by: p.byName || null, confirmed_at: t, close_note: p.note ? String(p.note).slice(0, 300) : null, reopened_from: null }, { status: 'open' })
  if (r.outcome === 'conflict') { const c = r.item ?? {}; return { outcome: 'already' as const, status: c.status, covered_by: c.covered_by ?? null, confirmed_by: c.confirmed_by ?? null, resolved_how: c.resolved_how ?? null } }
  return { outcome: r.outcome === 'ok' ? 'closed' as const : r.outcome as 'not_found' | 'error' }
}
