// A shift taken off a caregiver in AxisCare is NOT a call-in (Samantha, 2026-10-22: "it could be that the client
// canceled the shift, or that we approved the caregiver asking off ... i dont want that to mark against the caregiver").
// coverage-watch opens a case when it sees an unassigned shift, and remembers who was on it, but AxisCare never says WHY
// they came off. So those cases name the person as "taken off the shift", never "called off", and never land on their
// attendance record. A real call-in (a phone call, a clock-in reply, the office's call-off form) is unchanged.
// not_a_callin: a person marked the case as not a call-in (her clean-up of Kyra Linde's April Davidson shift, Desktop 1045).
// 2026-10-24 (reasons by id, visit-reasons.ts): when the office picked "Caregiver Call Off" in AxisCare, the reason says
// why, so that case IS a call-off (on attendance, Undo by changing the reason). A no-show is never logged automatically
// (it starts a termination review): a person confirms it. Only cases opened while visit_reasons_live is on carry this.
// deno-lint-ignore no-explicit-any
export function takenOffNotCalledIn(c: any): boolean {
  if (c?.not_a_callin === true) return true
  if (c?.reason_by_id === true && c?.reason_meaning === 'call_off') return false
  return c?.opened_by === 'axiscare-watch' || c?.opened_by === 'axiscare-reason'
}

/** How a message names the person who was on the shift. */
// deno-lint-ignore no-explicit-any
export function offWords(c: any): string {
  if (c?.not_a_callin !== true && c?.reason_by_id === true && c?.reason_meaning === 'no_show') return 'didn\'t show up (AxisCare reason: No Show)'
  return takenOffNotCalledIn(c) ? 'was taken off the shift in AxisCare' : 'called off'
}

/* "NOT A CALL-IN" (Samantha, 2026-10-26, Angiel Falig's 4pm call for Patsy: "there was no way to say that this was not a
   call in from the text link"). A person says a case was never a call-in, open or already closed: the case is marked
   (who, when, why, kept on the case), an open one is closed as not_a_callin, the call-in comes off the caregiver's
   attendance when nobody has acted on it yet (a copy stays on the case), any open HR suggestion built from it is
   dismissed, and the "Confirm: did they call off?" card closes. Sends nothing. Safe to repeat. */
export const NOT_A_CALLIN_HOW = 'not_a_callin'
// deno-lint-ignore no-explicit-any
export async function markNotACallin(db: any, caseId: string, by: { name: string; email?: string }, note = ''):
  Promise<{ outcome: 'marked' | 'not_found' | 'error'; closed: boolean; attendance: 'removed' | 'kept_acted_on' | 'none'; hr_dismissed: number; card_closed: boolean }> {
  const res = { outcome: 'error' as 'marked' | 'not_found' | 'error', closed: false, attendance: 'none' as 'removed' | 'kept_acted_on' | 'none', hr_dismissed: 0, card_closed: false }
  const rd = async (k: string) => { const { data } = await db.from('app_data').select('data').eq('key', k).maybeSingle(); return Array.isArray(data?.data) ? data!.data : [] }
  // deno-lint-ignore no-explicit-any
  const c = (await rd('coverage_cases')).find((x: any) => String(x?.id) === caseId)
  if (!c) { res.outcome = 'not_found'; return res }
  const t = new Date().toISOString()
  const why = String(note || '').trim().slice(0, 300)
  const line = `Not a call-in: marked by ${by.name} ${t.slice(0, 10)}${why ? '. ' + why : ''}.`
  const aid = 'att_cov_' + caseId
  // deno-lint-ignore no-explicit-any
  const ev = (await rd('attendance_events')).find((e: any) => String(e?.id) === aid)
  const patch: Record<string, unknown> = { not_a_callin: true, not_a_callin_by: by.name, not_a_callin_by_email: by.email || null, not_a_callin_at: t,
    not_a_callin_note: why || null, note: [String(c.note || '').trim(), line].filter(Boolean).join('\n') }
  if (ev) patch.removed_attendance_event = ev
  const p1 = await db.rpc('coverage_case_patch', { p_id: caseId, p_patch: patch, p_expect: {} })
  if (p1.error || p1.data?.outcome !== 'ok') return res
  if (c.status === 'open' || c.status === 'flagged') {
    const p2 = await db.rpc('coverage_case_patch', { p_id: caseId, p_patch: { status: 'done', resolved_how: NOT_A_CALLIN_HOW, covered_by: null, resolved_at: t,
      confirmed_by: by.name, confirmed_at: t, close_note: line, reopened_from: null }, p_expect: { status: c.status } })
    res.closed = !p2.error && p2.data?.outcome === 'ok'
  }
  if (ev && !ev.action_id) {
    const { error } = await db.rpc('delete_app_data_item', { target_key: 'attendance_events', item_id: aid })
    res.attendance = error ? 'none' : 'removed'
  } else if (ev) res.attendance = 'kept_acted_on'
  try {
    const { data: hr } = await db.from('hr_cases').select('id,status').contains('source_ids', [aid]).eq('status', 'open')
    for (const h of hr ?? []) {
      const { error } = await db.from('hr_cases').update({ status: 'dismissed', review_note: line, updated_at: t }).eq('id', h.id)
      if (!error) res.hr_dismissed++
    }
  } catch { /* an HR suggestion is left for a person */ }
  const cid = `ops_attc_${caseId.replace(/[^A-Za-z0-9]/g, '_').slice(-80)}`
  // deno-lint-ignore no-explicit-any
  const card = (await rd('ops_items')).find((x: any) => String(x?.id) === cid)
  if (card && card.status === 'open') {
    const { error } = await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { ...card, status: 'done', closed_at: t, closed_by: by.name, close_note: line } })
    res.card_closed = !error
  }
  res.outcome = 'marked'
  return res
}
