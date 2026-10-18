/**
 * RIGHT PERSON FIRST, THEN ESCALATE (Today cockpit, Phase 3; Samantha decided 2026-10-05).
 * IN CHARGE + THE TEAM LADDER (Springfield structure, Samantha approved 2026-10-17, plan VWRK2aGB1WkRaxV2Xn9MJ9).
 *
 *   · Scheduling work goes to whoever holds the STAFFING seat now. When nobody is scheduled: the seat's "when nobody is
 *     scheduled" person, else whoever is IN CHARGE now.
 *   · IN CHARGE (new seat): the person with authority when the owner, their partner and leadership aren't available.
 *     Weekdays Krystal (Springfield lead), evenings and weekends Samantha for now. A seat, not a name.
 *   · Problems climb sideways through the team before they reach leadership. Escalating always keeps the owner.
 *       normal work, once overdue                      · In charge (never leadership; late work stays with the team)
 *       critical (uncovered shift within 60 minutes,   · In charge after 10 minutes nobody took it (5 for a shift that
 *       urgent staffing, no clock-in)                    starts within the hour), Leadership after 20, the leadership
 *                                                        backup (Zach) after 35. ops_settings.critical_ladder overrides.
 *   · Nobody is escalated to themselves, and nothing taken (claimed) or parked with a wake-up escalates.
 *   · Escalation decides who is TOLD. It never decides who may act: in an emergency anyone calls 911 first.
 *
 * Reads the same duty_windows the Hub reads (index.html dutyCoversAt / dutyHolder), in Chicago time.
 */
// deno-lint-ignore-file no-explicit-any
type Any = any

export const ESCALATE = { shiftSoonMin: 60, shiftSoonAfterMin: 5, urgentAfterMin: 10 }
/** The approved critical ladder, in minutes nobody has taken it (Samantha 2026-10-17: 10 / 20 / 35). */
export const LADDER = { in_charge: 10, leadership: 20, backup: 35 }
export type Stage = 'in_charge' | 'leadership' | 'backup'
export const STAGE_SEAT: Record<Stage, string> = { in_charge: 'in_charge', leadership: 'owner_escalation', backup: 'leadership_backup' }
export const STAGE_LABEL: Record<Stage, string> = { in_charge: 'In charge', leadership: 'Leadership', backup: 'Leadership backup' }
/** The ladder with any ops_settings.critical_ladder override (whole minutes, each later than the one before). */
export function ladder(settings: Any): { in_charge: number; leadership: number; backup: number } {
  const o = settings?.critical_ladder || {}
  const n = (v: unknown, d: number) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? Math.round(x) : d }
  const l = { in_charge: n(o.in_charge, LADDER.in_charge), leadership: n(o.leadership, LADDER.leadership), backup: n(o.backup, LADDER.backup) }
  if (!(l.in_charge < l.leadership && l.leadership < l.backup)) return { ...LADDER }
  return l
}
export const STAFFING_KINDS = new Set(['coverage', 'staffing_issue', 'coverage_outcome', 'family_call', 'evv_fix', 'confirm_times', 'staffing'])

/** Chicago wall clock: day of week (0 Sunday), minutes since midnight, and the ms of "now". */
export function chiClock(now: Date = new Date()): { dow: number; mins: number; ms: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short',
    hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now).map((x) => [x.type, x.value]))
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(String(p.weekday))
  return { dow, mins: (Number(p.hour) % 24) * 60 + Number(p.minute), ms: now.getTime() }
}

/** A window that points at a planned or unfilled position, or says planned, never holds duty (the Hub's rowPlanned). */
export function planned(w: Any, positions: Any[] = []): boolean {
  if (!w) return false
  if (w.status === 'planned') return true
  if (w.position) { const p = (positions || []).find((x: Any) => x?.id === w.position); if (!(p && p.status === 'filled' && p.person)) return true }
  return false
}
export function covers(w: Any, now: Date, positions: Any[] = []): boolean {
  if (!w || w.active === false || planned(w, positions)) return false
  if (w.start && w.end) { const t = now.getTime(); return t >= Date.parse(w.start) && t < Date.parse(w.end) }
  if (w.recur) {
    const c = chiClock(now), days: number[] = w.recur.days || []
    if (days.length && !days.includes(c.dow)) return false
    const [fh, fm] = String(w.recur.from || '00:00').split(':').map(Number)
    const [th, tm] = String(w.recur.to || '23:59').split(':').map(Number)
    const from = fh * 60 + (fm || 0), to = th * 60 + (tm || 0)
    return from <= to ? (c.mins >= from && c.mins < to) : (c.mins >= from || c.mins < to)
  }
  return false
}
/** Who holds a seat now. One-offs beat patterns (the Hub's rule). Falls back to the seat's "when nobody is scheduled"
 *  person (ops_settings.duty_default_<area>), then to `fallback`. */
export function seatHolder(windows: Any[], area: string, now: Date, settings: Any, fallback = '', positions: Any[] = []):
  { person: string; source: 'schedule' | 'default' | 'fallback' | 'none'; window?: Any } {
  const list = (windows || []).filter((w: Any) => w?.area === area && covers(w, now, positions))
  const oneOffs = list.filter((w: Any) => w.start && w.end)
  const w = (oneOffs.length ? oneOffs : list)[0]
  if (w?.person) return { person: String(w.person).toLowerCase(), source: 'schedule', window: w }
  const d = String(settings?.['duty_default_' + area] || '').trim().toLowerCase()
  if (d) return { person: d, source: 'default' }
  if (fallback) return { person: String(fallback).toLowerCase(), source: 'fallback' }
  return { person: '', source: 'none' }
}
/** The seats this check cares about. Nobody scheduled in a seat falls to the team before leadership: Staffing falls to
 *  whoever is In charge; In charge and Leadership fall to the first scheduling alert admin (the office is empty). The
 *  leadership backup is ops_settings.leadership_backup (Zach), never a default for anything else. */
export function onDuty(windows: Any[], settings: Any, now: Date, positions: Any[] = []) {
  const first = Array.isArray(settings?.coverage_alert_admins) && settings.coverage_alert_admins.length
    ? String(settings.coverage_alert_admins[0]) : 'samantha@mo-care.com'
  const inCharge = seatHolder(windows, 'in_charge', now, settings, first, positions)
  const backup = String(settings?.leadership_backup || '').trim().toLowerCase()
  return { staffing: seatHolder(windows, 'staffing', now, settings, inCharge.person || first, positions),
           in_charge: inCharge,
           escalation: seatHolder(windows, 'owner_escalation', now, settings, first, positions),
           backup: { person: backup, source: backup ? 'default' as const : 'none' as const } }
}
/** Who a stage of the ladder reaches now. */
export function stagePerson(seats: ReturnType<typeof onDuty>, stage: Stage): string {
  return stage === 'in_charge' ? seats.in_charge.person : stage === 'leadership' ? seats.escalation.person : seats.backup.person
}

export const isStaffingItem = (i: Any): boolean => !!i && (i.domain === 'scheduling_coverage' || STAFFING_KINDS.has(String(i.kind)))
const parked = (i: Any, now: Date): boolean => {
  if (i?.sub_state !== 'waiting' || !i?.check_back) return false
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(i.check_back)); if (!m) return false
  return Date.parse(`${m[1]}-${m[2]}-${m[3]}T12:00:00-05:00`) > now.getTime()
}

/** Should a NEW scheduling item be routed to the staffing seat? Only robot-made work that no person has placed. */
export function routable(i: Any, sinceIso: string): boolean {
  if (!i || i.status !== 'open' || !isStaffingItem(i) || i.routed) return false
  if (i.claimed_by) return false
  if ((i.owner_history || []).some((h: Any) => h && h.how !== 'routed')) return false   // a person assigned or took it
  const at = Date.parse(String(i.created_at || '')); if (!Number.isFinite(at)) return false
  if (sinceIso && at < Date.parse(sinceIso)) return false
  const by = String(i.created_by || '')
  return !by.includes('@')                                                            // made by a job, not a person
}

/** Minutes until the case's shift starts (negative once started), from naive Chicago date + 'HH:MM'. */
export function minsToShift(c: Any, now: Date): number | null {
  if (!c?.shift_date) return null
  const m = /^(\d{1,2}):(\d{2})/.exec(String(c.shift_time || '')); if (!m) return null
  const start = Date.parse(`${c.shift_date}T${m[1].padStart(2, '0')}:${m[2]}:00Z`)
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now).map((x) => [x.type, x.value]))
  const chiNow = Date.parse(`${p.year}-${p.month}-${p.day}T${String(Number(p.hour) % 24).padStart(2, '0')}:${p.minute}:00Z`)
  return Math.round((start - chiNow) / 60000)
}

/** Is this item due to escalate now? Returns the level, the ladder stage it has reached and the reason in the office's
 *  words, or null. Critical work climbs In charge -> Leadership -> Leadership backup; overdue work only reaches In charge. */
export function escalationDue(i: Any, now: Date, ctx: { minsToShift?: number | null; ownerFirst?: string; ladder?: { in_charge: number; leadership: number; backup: number } } = {}):
  { level: 'urgent' | 'overdue'; stage: Stage; why: string } | null {
  if (!i || i.status !== 'open' || i.claimed_by || parked(i, now)) return null
  const L = ctx.ladder || LADDER
  const who = ctx.ownerFirst || (i.owner ? 'The owner' : 'Nobody')
  const since = Date.parse(String(i.created_at || ''))            // the clock starts when the problem appeared, not when it was routed
  const age = Number.isFinite(since) ? (now.getTime() - since) / 60000 : 0
  const m = ctx.minsToShift
  const shiftSoon = isStaffingItem(i) && i.kind === 'coverage' && m != null && m <= ESCALATE.shiftSoonMin
  const urgent = isStaffingItem(i) && (/timekeeper/.test(String(i.opened_by || '')) || i.urgency === 'urgent')
  if (shiftSoon || urgent) {
    const first = shiftSoon ? Math.min(ESCALATE.shiftSoonAfterMin, L.in_charge) : L.in_charge
    const stage: Stage | null = age >= L.backup ? 'backup' : age >= L.leadership ? 'leadership' : age >= first ? 'in_charge' : null
    if (stage) {
      const mins = stage === 'backup' ? L.backup : stage === 'leadership' ? L.leadership : first
      return { level: 'urgent', stage, why: `${who} hasn't taken it in ${mins} minutes` + (shiftSoon ? `, and the shift starts ${m! <= 0 ? 'now' : 'in ' + m + ' minutes'}` : '') }
    }
  }
  const due = Date.parse(String(i.due || ''))
  if (Number.isFinite(due) && due < now.getTime()) return { level: 'overdue', stage: 'in_charge', why: `it's overdue (it was due ${new Date(due).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })})` }
  return null
}
