/**
 * THE HUB CLOSES ITS OWN LOOPS (Today cockpit, Phase 2; Samantha approved 2026-10-05,
 * plan https://claude.ai/artifact/DbCMKyppvK2mRVPnZr9TWN). Pure rules, shared by coverage-watch, coverage-run and
 * timekeeper-watch, so the three jobs agree and the rules can be tested on their own.
 *
 *   · a coverage case whose shift is over closes itself when AxisCare shows who worked it; otherwise a person is asked
 *     once "Was it covered?". Either way it sends NOTHING: a case closed after the fact skips the closure texts
 *     (caregivers and family) that a normal close sends.
 *   · a card that belongs to a coverage case closes when the case closes.
 *   · a case closed as uncovered asks a person to call the family. The Hub never contacts a family by itself.
 *   · a missed clock-in whose shift has ended becomes one "EVV fix needed" item; the admin texts stop.
 *   · EVV: one weekly Caregiver EVV Review (caregivers under the expectation, 90% unless Settings say otherwise),
 *     owned by whoever owns caregiver performance. No nightly EVV cards.
 *   · the nightly call-in / tardy cards keep a person's handling: a card someone closed reopens only when the count
 *     goes up, and an open card keeps its owner and history.
 *
 * Done and Resolved stay separate: everything here that closes on its own writes status 'resolved' with resolved_how;
 * a person's close stays 'done'.
 */

// deno-lint-ignore no-explicit-any
type Any = any

/** Chicago wall-clock "now" as a naive ISO string, for comparing with case dates/times (also naive Chicago). */
export function chiNowNaive(now: Date = new Date()): string {
  return now.toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).replace(' ', 'T').slice(0, 16)
}
const addDay = (ymd: string, n: number): string => {
  const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10)
}

/** When the case's shift ends, as naive Chicago 'YYYY-MM-DDTHH:MM'. A shift with no end time ends at 23:59; an end
 *  earlier than the start is the next morning. Null when the case has no date. */
export function caseShiftEnd(c: Any): string | null {
  const date = String(c?.shift_date ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const m = /^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/.exec(String(c?.shift_time ?? '').trim())
  if (!m) return `${date}T23:59`
  return m[2] <= m[1] ? `${addDay(date, 1)}T${m[2]}` : `${date}T${m[2]}`
}

/** Is the shift over (end + grace minutes)? */
export function caseEnded(c: Any, chiNow: string, graceMin = 30): boolean {
  const end = caseShiftEnd(c); if (!end) return false
  const endMs = Date.parse(end + ':00Z') + graceMin * 60000   // both sides read the same way, so 'Z' is only a parse aid
  return Date.parse(chiNow + ':00Z') >= endMs
}

/** What AxisCare says about a finished shift. outside(c, cg) is _shared/covered-outside.ts's outsideVerdict. */
export function pastCaseVerdict(c: Any, visit: Any | undefined,
  outside: (c: Any, cg: { id: unknown; name: string }) => string): { how: 'covered' | 'covered_other_way' | null; covered_by?: string; why: string } {
  if (!visit) return { how: null, why: 'AxisCare does not show this visit any more' }
  const cg = visit?.caregiver
  if (cg?.id == null) return { how: null, why: 'AxisCare shows nobody on the shift' }
  const name = [String(cg.firstName ?? '').trim(), String(cg.lastName ?? '').trim()].filter(Boolean).join(' ') || ('caregiver ' + cg.id)
  if (!visit?.clockIn?.time) return { how: null, why: `AxisCare shows ${name} on the shift but no clock-in` }
  const v = outside(c, { id: cg.id, name })
  if (v === 'covered') return { how: 'covered', covered_by: name, why: `${name} clocked in` }
  if (v === 'caller_still_on') return { how: 'covered_other_way', covered_by: name, why: `${name}, who called off, clocked in and worked it after all` }
  return { how: null, why: `${name} clocked in, but Cara can't tell whether they covered or are the caregiver who called off` }
}

/** Mark a case closed-after-the-fact so coverage-run's closure pass sends nothing (no confirmed, courtesy or family text). */
export function markNoClosureTexts(c: Any, nowIso: string, why: string): void {
  c.closure_notified = c.closure_notified || nowIso
  c.closure_courtesy_count = Number(c.closure_courtesy_count) || 0
  c.closure_skip_reason = why
  if (!c.family_notified) {
    c.family_notified = nowIso; c.family_notified_count = 0; c.family_no_recipients = true; c.family_skip_reason = why
  }
}

const CLOSED_CASE = new Set(['done', 'resolved', 'needs_outcome'])
/** Open cards tied to a coverage case (coverage_case_id) whose case is no longer open. */
export function itemsToCloseForCases(items: Any[], casesById: Map<string, Any>): Any[] {
  return (items || []).filter((i) => i && i.status === 'open' && i.coverage_case_id != null
    && CLOSED_CASE.has(String(casesById.get(String(i.coverage_case_id))?.status ?? '')))
}

/** A case closed as uncovered (after `sinceIso`, within `maxAgeDays`) with no family record yet needs a person to call. */
export function familyCallNeeded(c: Any, sinceIso: string, nowMs: number, maxAgeDays = 3): boolean {
  if (!c || !CLOSED_CASE.has(String(c.status)) || c.status === 'needs_outcome') return false
  if (c.resolved_how !== 'uncovered') return false
  if (c.family_call_item || c.family_contact) return false
  if (c.family_notified && !c.family_no_recipients) return false
  const at = Date.parse(String(c.resolved_at ?? '')); if (!Number.isFinite(at)) return false
  if (sinceIso && at < Date.parse(sinceIso)) return false
  return nowMs - at <= maxAgeDays * 864e5
}

/** Friendly "Tue Oct 7, 9am-1pm" for a case. */
export function caseWhen(c: Any): string {
  const d = String(c?.shift_date ?? '')
  const day = /^\d{4}-\d{2}-\d{2}$/.test(d)
    ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }) : ''
  const t12 = (x: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(x.trim()); if (!m) return x; let h = +m[1]; const ap = h < 12 ? 'am' : 'pm'; h = h % 12 || 12; return h + (m[2] === '00' ? '' : ':' + m[2]) + ap }
  const t = String(c?.shift_time ?? '').split('-').map((x) => t12(x)).filter(Boolean).join('-')
  return [day, t].filter(Boolean).join(', ')
}

/** EVV daily stats from one day's AxisCare visits: per caregiver, visits worked and visits with BOTH clock-in and out. */
export function evvDayStats(visits: Any[]): Record<string, [number, number]> {
  const by: Record<string, [number, number]> = {}
  for (const v of visits || []) {
    if (v?.caregiver?.id == null) continue
    const name = [String(v.caregiver.firstName ?? '').trim(), String(v.caregiver.lastName ?? '').trim()].filter(Boolean).join(' ') || ('caregiver ' + v.caregiver.id)
    const row = by[name] ||= [0, 0]
    row[0]++
    if (v?.clockIn?.time && v?.clockOut?.time) row[1]++
  }
  return by
}

/** The week's EVV review: days = the stats items for the week. Caregivers under `pct` (whole visits, rounded down). */
export function evvWeek(days: Any[], pct = 90): { days: number; below: { name: string; visits: number; complete: number; pct: number }[]; checked: number } {
  const tot: Record<string, [number, number]> = {}
  for (const d of days || []) for (const [name, [n, c]] of Object.entries(d?.by ?? {}) as [string, [number, number]][]) {
    const t = tot[name] ||= [0, 0]; t[0] += Number(n) || 0; t[1] += Number(c) || 0
  }
  const rows = Object.entries(tot).filter(([, [n]]) => n > 0)
    .map(([name, [n, c]]) => ({ name, visits: n, complete: c, pct: Math.floor((c / n) * 100) }))
  return { days: (days || []).length, checked: rows.length,
    below: rows.filter((r) => r.pct < pct).sort((a, b) => a.pct - b.pct || a.name.localeCompare(b.name)) }
}

/** The weekly review's Monday-to-Sunday window ending on `sunday` (YYYY-MM-DD). */
export function weekOf(sunday: string): { start: string; end: string; dates: string[] } {
  const dates = Array.from({ length: 7 }, (_, i) => addDay(sunday, i - 6))
  return { start: dates[0], end: sunday, dates }
}

/** Nightly attendance card (call-ins / tardies): keep a person's handling. Returns the item to write, or null. */
export function attendanceCard(existing: Any | undefined, fresh: Any, n: number): Any | null {
  if (existing && existing.status === 'open') {
    // keep owner, claim, history and created_at; refresh the words and the count only
    return { ...existing, title: fresh.title, detail: fresh.detail, count: n, updated_at: fresh.created_at }
  }
  if (existing && existing.status !== 'open') {
    const before = Number(existing.count) || Number((/: (\d+) /.exec(String(existing.title ?? '')) || [])[1]) || 0
    if (n <= before) return null                        // handled already, and nothing new since
    return { ...fresh, count: n, reopened_from: existing.status, owner: existing.owner || fresh.owner, owner_name: existing.owner_name || fresh.owner_name,
      history: existing.history || [], detail: fresh.detail + `\n\nReopened: the count went up from ${before} to ${n} after it was closed.` }
  }
  return { ...fresh, count: n }
}

/** A missed clock-in alert whose shift is over (the visit's end has passed, or it is from an earlier day). */
export function tkShiftEnded(l: Any, visit: Any | undefined, day: string, nowMs: number, endMsOf: (stamp: string) => number): boolean {
  if (!l || l.kind === 'clock_out' || l.resolved_at || !l.office_alerted_at) return false
  if (String(l.shift_date) !== day) return true
  const end = visit ? String(visit?.scheduledEndDate ?? visit?.endDate ?? '') : ''
  if (!end) return false
  const ms = endMsOf(end)
  return Number.isFinite(ms) && nowMs > ms
}
