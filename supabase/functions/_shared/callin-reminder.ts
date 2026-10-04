// =============================================================================
// CI3 (2026-10-04, her decision 1 on the call-ins plan): REMINDERS UNTIL SOMEONE HAS THE CALL-IN.
// If nobody taps "I've got it" (or confirms, or closes it), every admin who got the call-in text gets a reminder
// every 15 minutes, at most 4. At night (office quiet hours, 8pm to 7am) only for a MUST BE COVERED shift or one
// starting within 3 hours (the latter only while call-ins may text after hours). A switch, OFF until she turns it on (ops_settings.callin_reminders_live); while it is off
// the Hub records what WOULD have gone (practice), so she can look before turning it on.
// Settings: callin_reminder_every_min (default 15, 5 to 60), callin_reminder_max (default 4, 1 to 8).
// =============================================================================
import { officeQuiet } from './quiet-hours.ts'

export const REMIND_EVERY_DEFAULT = 15, REMIND_MAX_DEFAULT = 4
// deno-lint-ignore no-explicit-any
export function reminderSettings(st: any) {
  const n = (v: unknown, lo: number, hi: number, d: number) => { const x = Number(v); return Number.isInteger(x) && x >= lo && x <= hi ? x : d }
  return { live: st?.callin_reminders_live === true, every: n(st?.callin_reminder_every_min, 5, 60, REMIND_EVERY_DEFAULT), max: n(st?.callin_reminder_max, 1, 8, REMIND_MAX_DEFAULT) }
}

export type ReminderDecision = { due: false; why: string } | { due: true; n: number; max: number; emergency: boolean }
/**
 * Is a reminder due for this case now?
 * c: the case; must: the client's call-in plan says MUST BE COVERED; claimedElsewhere: the board's own claim on the
 * case's Needs Attention item; startsInMin: minutes to the shift start (null when unknown).
 */
export function reminderDue(
  // deno-lint-ignore no-explicit-any
  c: any, st: any, p: { must: boolean; claimedElsewhere: boolean; startsInMin: number | null; callinAnyHour?: boolean; now?: Date }): ReminderDecision {
  const now = p.now ?? new Date()
  const { every, max } = reminderSettings(st)
  if (!c || c.status !== 'open') return { due: false, why: 'not open' }
  if (c.kind === 'interest') return { due: false, why: 'an interest check, not a call-in' }
  /* 436 found: the ongoing sweep's standing open shifts (weeks ahead) are cases too, stamped "alerted" only so they
     never send a call-in text. They are not call-ins: never remind about them. */
  if (c.opened_by === 'ongoing-sweep' || c.reason === 'open' || String(c.id || '').startsWith('cwo_')) return { due: false, why: 'standing open shifts, not a call-in' }
  if (!c.admin_alerted) return { due: false, why: 'the call-in text has not gone yet' }
  if (c.claimed_by || p.claimedElsewhere) return { due: false, why: 'someone has it' }
  // deno-lint-ignore no-explicit-any
  const sent: any[] = (Array.isArray(c.callin_reminders) ? c.callin_reminders : []).filter((r) => r && r.practice !== true)
  // deno-lint-ignore no-explicit-any
  const practice: any[] = (Array.isArray(c.callin_reminders) ? c.callin_reminders : []).filter((r) => r && r.practice === true)
  const mine = st?.callin_reminders_live === true ? sent : practice
  if (mine.length >= max) return { due: false, why: 'all reminders sent' }
  if (p.startsInMin != null && p.startsInMin < -120) return { due: false, why: 'the shift started over 2 hours ago' }
  const last = Math.max(Date.parse(String(c.admin_alerted)) || 0, ...mine.map((r) => Date.parse(String(r.at)) || 0))
  if (!last || now.getTime() - last < every * 60_000 - 20_000) return { due: false, why: 'not yet' }
  const soon = p.startsInMin != null && p.startsInMin < 180
  const quiet = officeQuiet(now, st)
  /* at night: a MUST BE COVERED shift always (as the call-in text itself); a shift within 3 hours only while call-ins
     may text after hours (her 426 switch, callin_after_hours) */
  if (quiet && !(p.must || (soon && p.callinAnyHour !== false))) return { due: false, why: 'office quiet hours (not a MUST BE COVERED shift, and not within 3 hours)' }
  return { due: true, n: mine.length + 1, max, emergency: quiet }
}

// deno-lint-ignore no-explicit-any
export function reminderText(c: any, what: string, d: { n: number; max: number }, must: boolean): string {
  // deno-lint-ignore no-explicit-any
  const asked: any[] = Array.isArray(c?.asked) ? c.asked : []
  const yes = asked.filter((a) => a?.state === 'yes').length
  return `${must ? 'MUST BE COVERED. ' : ''}Reminder ${d.n} of ${d.max}: nobody has the call-in for ${what} yet (${yes} said yes, ${asked.length} asked). Tap "I've got it", or confirm someone: {link}`
}
