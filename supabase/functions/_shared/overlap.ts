// =============================================================================
// ALREADY WORKING THEN? (Samantha, 2026-10-25: "I do NOT want us texting caregivers to cover an open shift if they're already
// working or scheduled to work an overlapping shift with Caring Companions in AxisCare.")
// =============================================================================
// The one check every send uses (Cara's waves, Ask everyone now, the coordinator's own send, a follow-up, a care-review
// offer), read from AxisCare at the moment of sending:
//   · the WHOLE shift against the WHOLE visit, overnights included (a 10pm to 6am shift against a 9pm to 1am visit, or a
//     visit the evening before that runs past midnight). Visits from the day before to the day after are read.
//   · scheduled visits, AND anyone clocked in right now: a visit clocked in and not out counts until now even past its
//     scheduled end (a caregiver still with a client when the open shift starts is not free).
//   · back to back is fine: a visit ending exactly when the shift starts is no conflict.
//   · the visit being covered, removed visits and the "Canceled Shift" placeholder never count.
//   · AxisCare can't be read = nobody is texted (fail closed), and the office is told why.
// Only decisions here; coverage-run reads AxisCare. Times are AxisCare's wall-clock times in Central time (the date and
// hour as written), compared as plain minutes.
// =============================================================================
// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n)

/** "2026-10-24T22:00:00-05:00" or "2026-10-24T22:00" as minutes on one shared wall clock (the offset is ignored on purpose:
    AxisCare writes Central wall time, and the shift is Central wall time). null when unreadable. */
export function wallMin(iso: unknown): number | null {
  const m = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)/.exec(S(iso, 40))
  if (!m) return null
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) / 60000
}
/** The open shift as [start, end) wall minutes; an end at or before the start is the next morning. */
export function shiftWindow(c: Any): [number, number] | null {
  const t = /^(\d\d:\d\d)-(\d\d:\d\d)$/.exec(S(c?.shift_time, 20)), d = S(c?.shift_date, 10)
  if (!t || !/^\d{4}-\d\d-\d\d$/.test(d)) return null
  const a = wallMin(`${d}T${t[1]}`)!, b0 = wallMin(`${d}T${t[2]}`)!
  return [a, b0 <= a ? b0 + 1440 : b0]
}
/** The dates to read from AxisCare for this shift: the day before (an overnight running into it) to the day after. */
export function readRange(c: Any): [string, string] | null {
  const d = S(c?.shift_date, 10); if (!/^\d{4}-\d\d-\d\d$/.test(d)) return null
  const t = Date.parse(d + 'T12:00:00Z')
  return [new Date(t - 86400000).toISOString().slice(0, 10), new Date(t + 86400000).toISOString().slice(0, 10)]
}
const clock = (min: number) => { const h = Math.floor((((min % 1440) + 1440) % 1440) / 60), m = (((min % 60) + 60) % 60)
  return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}${h >= 12 ? 'pm' : 'am'}` }
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const dayOf = (min: number) => DAY[new Date(min * 60000).getUTCDay()]

export type Conflict = { visit_id: string; client: string; start: number; end: number; clocked_in: boolean; line: string }
/** One visit as [start, end) wall minutes and whether the caregiver is on it now (clocked in, not out). */
export function visitWindow(v: Any, nowMin: number): { start: number; end: number; clockedIn: boolean } | null {
  const s = wallMin(v?.scheduledStartDate ?? v?.startDate), e0 = wallMin(v?.scheduledEndDate ?? v?.endDate)
  if (s == null || e0 == null) return null
  let e = e0 <= s ? e0 + 1440 : e0
  const ci = wallMin(v?.clockIn?.time ?? v?.clockInTime), co = wallMin(v?.clockOut?.time ?? v?.clockOutTime)
  let start = s
  if (ci != null) start = Math.min(start, ci)
  if (co != null) e = Math.max(e, co)
  /* clocked in, not out, and the visit was due to end less than 6 hours ago: still working. Longer than that is a forgotten
     clock-out (the missed clock-out card handles it), not someone still at a client's house */
  const clockedIn = ci != null && co == null && ci <= nowMin && nowMin - e < 360
  if (clockedIn) e = Math.max(e, nowMin + 1)   /* still with the client: busy at least until now */
  return { start, end: e, clockedIn }
}
/** Everyone already working during this shift: caregiver id -> the visits that overlap, each with a line for the office. */
export function conflictsFor(rows: Any[], c: Any, nowMin: number, o: { ownVisitId?: string | null; placeholderId?: string } = {}): Map<string, Conflict[]> {
  const out = new Map<string, Conflict[]>()
  const w = shiftWindow(c); if (!w) return out
  const own = S(o.ownVisitId ?? c?.axiscare_visit_id), ph = S(o.placeholderId || '618')
  for (const v of rows || []) {
    if (!v || v.removed === true) continue
    const cg = v?.caregiver?.id; if (cg == null) continue
    const cgId = S(cg, 20)
    if (cgId === ph || /^cancel+ed( shifts?)?$/i.test([v.caregiver.firstName, v.caregiver.lastName].filter(Boolean).join(' '))) continue
    if (own && S(v.id) === own) continue
    const vw = visitWindow(v, nowMin); if (!vw) continue
    if (!(vw.start < w[1] && vw.end > w[0])) continue
    const client = S(v?.client?.firstName, 40) || 'another client'
    const sameDay = dayOf(vw.start) === dayOf(w[0])
    const line = vw.clockedIn
      ? `Clocked in now with ${client} (scheduled ${clock(wallMin(v.scheduledStartDate ?? v.startDate) ?? vw.start)} to ${clock(wallMin(v.scheduledEndDate ?? v.endDate) ?? vw.end)})`
      : `Scheduled ${sameDay ? '' : dayOf(vw.start) + ' '}${clock(vw.start)} to ${clock(vw.end)} with ${client}`
    const list = out.get(cgId) ?? []
    list.push({ visit_id: S(v.id, 30), client, start: vw.start, end: vw.end, clocked_in: vw.clockedIn, line })
    out.set(cgId, list)
  }
  return out
}

/** WORKING RIGHT NOW (PRN step 1, Samantha 2026-10-28: "Avoid contacting caregivers who are currently working, even if the shift
    doesn't overlap"): everyone clocked in on a visit at this moment, whatever the open shift's time. Nobody is texted mid-visit;
    once they clock out they are back in their normal place. Switch ops_settings.working_now_live (off: no change). */
export function workingNow(rows: Any[], nowMin: number, o: { placeholderId?: string } = {}): Map<string, Conflict[]> {
  const out = new Map<string, Conflict[]>()
  const ph = S(o.placeholderId || '618')
  for (const v of rows || []) {
    if (!v || v.removed === true) continue
    const cg = v?.caregiver?.id; if (cg == null) continue
    const cgId = S(cg, 20)
    if (cgId === ph || /^cancel+ed( shifts?)?$/i.test([v.caregiver.firstName, v.caregiver.lastName].filter(Boolean).join(' '))) continue
    const vw = visitWindow(v, nowMin); if (!vw || !vw.clockedIn) continue
    if (out.has(cgId)) continue
    const client = S(v?.client?.firstName, 40) || 'another client'
    const end = wallMin(v.scheduledEndDate ?? v.endDate)
    const line = `Working right now with ${client}` + (end != null && end > nowMin ? ` until ${clock(end)}` : '')
    out.set(cgId, [{ visit_id: S(v.id, 30), client, start: vw.start, end: vw.end, clocked_in: true, line }])
  }
  return out
}
/** The open shift's conflicts plus everyone working right now (only those not already conflicting), each marked now_only. */
export function withWorkingNow(by: Map<string, Conflict[]>, now: Map<string, Conflict[]>): Map<string, (Conflict & { now_only?: boolean })[]> {
  const out = new Map<string, (Conflict & { now_only?: boolean })[]>(by)
  for (const [id, list] of now) if (!out.has(id)) out.set(id, list.map((k) => ({ ...k, now_only: true })))
  return out
}
