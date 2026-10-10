// =============================================================================
// work-lock.ts · SLICE 5 (Samantha, 2026-10-10: "scheduling stays locked until the stamp", new path only). The one answer to
// "may this caregiver be offered or scheduled shifts yet?" for people with a readiness card: locked until BOTH Approved to
// Work (an owner's press) and AxisCare status Active (read back) are complete on the card. People without a card (the old
// path, every current caregiver) are never locked here. Read by coverage-run (fills), coverage-shifts (the Team Builder
// pool and the Staffing Sheet) and the readiness sweep (the roster's work_lock field, for the Hub page).
// FAIL CLOSED: if the journey tables cannot be read, the caller holds everyone it would otherwise ask (it says so).
// deno-lint-ignore-file no-explicit-any
const DONE = ['complete', 'not_needed', 'exception']
export const LOCK_WHY = 'awaiting Approve to Work (new hire readiness card not complete)'
export type Lock = { ok: true; axis: Set<string>; offers: Set<string>; open: number } | { ok: false; why: string }
const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '')

/** Which caregivers are locked right now: AxisCare numbers (via the journey or the roster record) and offer ids. */
export async function workLock(db: any, roster?: any[] | null): Promise<Lock> {
  try {
    const { data: js, error } = await db.from('client_journey').select('journey_id, offer_id, axiscare_caregiver_id, status').eq('subject', 'caregiver').eq('status', 'open').limit(500)
    if (error) return { ok: false, why: 'the readiness cards could not be read: ' + (error.message || 'error') }
    const axis = new Set<string>(), offers = new Set<string>()
    if (!js || !js.length) return { ok: true, axis, offers, open: 0 }
    const ids = js.map((j: any) => j.journey_id)
    const { data: steps, error: e2 } = await db.from('client_journey_step').select('journey_id, step_key, state').in('journey_id', ids).in('step_key', ['cg.approve.work', 'cg.axiscare.active'])
    if (e2) return { ok: false, why: 'the readiness rows could not be read: ' + (e2.message || 'error') }
    const done = new Map<string, Set<string>>()
    for (const s of steps ?? []) if (DONE.includes(s.state)) { if (!done.has(s.journey_id)) done.set(s.journey_id, new Set()); done.get(s.journey_id)!.add(s.step_key) }
    let list = roster
    if (!Array.isArray(list)) { const { data } = await db.from('app_data').select('data').eq('key', 'caregivers').maybeSingle(); list = Array.isArray(data?.data) ? data.data : [] }
    const byOffer = new Map<string, string>()
    for (const r of list!) if (r?.offer_id && digits(r.axiscare_id)) byOffer.set(String(r.offer_id), digits(r.axiscare_id))
    for (const j of js) {
      const d = done.get(j.journey_id)
      if (d && d.has('cg.approve.work') && d.has('cg.axiscare.active')) continue   // unlocked: the stamp and the read-back
      if (j.offer_id) offers.add(String(j.offer_id))
      const ax = digits(j.axiscare_caregiver_id) || (j.offer_id ? byOffer.get(String(j.offer_id)) : '') || ''
      if (ax) axis.add(ax)
    }
    return { ok: true, axis, offers, open: js.length }
  } catch (e) { return { ok: false, why: 'the readiness lock could not be read: ' + String((e as Error)?.message ?? e).slice(0, 120) } }
}
