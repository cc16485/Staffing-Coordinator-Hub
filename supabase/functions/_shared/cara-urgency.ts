// =============================================================================
// cara-urgency.ts · CARA PHASE 1, step 2: HOW URGENT IS THIS OPEN SHIFT (Samantha, 2026-10-23: "For urgent situations,
// escalate immediately rather than waiting for an automated outreach sequence to finish"; "Urgent alerts to the person
// on duty should happen immediately").
//   critical   starts within 3 hours (or started less than an hour ago), or a "must be covered" client within 24 hours
//   today      starts within 24 hours
//   coming_up  later than that
//   planning   a regular opening or a new-client interest check (no single shift)
//   past       ended, or started over an hour ago (the loop-closing checks own it)
// A case that turns Critical while nobody has confirmed a caregiver texts the people on duty at once: the Staffing seat
// and whoever is In charge (the duty schedule, _shared/duty.ts onDuty); nobody on duty with a phone = everyone on the
// call-in alert list (never silent). Once per case. Pure here; coverage-run does the reading and the sending.
// =============================================================================
// deno-lint-ignore-file no-explicit-any
type Any = any
const S = (v: unknown, n = 120) => String(v ?? '').trim().slice(0, n)

export type Urgency = { level: 'critical' | 'today' | 'coming_up' | 'planning' | 'past' | 'unknown'; why: string; mins: number | null }

/** Minutes from now (Chicago wall clock, naive) to the shift start; null when the case has no date and start time. */
export function minsToStart(c: Any, chiNowNaive: string): number | null {
  const d = S(c?.shift_date), t = S(c?.shift_time).slice(0, 5)
  if (!/^\d{4}-\d\d-\d\d$/.test(d) || !/^\d\d:\d\d$/.test(t)) return null
  return Math.round((new Date(`${d}T${t}:00`).getTime() - new Date(chiNowNaive).getTime()) / 60000)
}
const span = (m: number) => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}` : `${m}m`

export function urgencyOf(c: Any, chiNowNaive: string, o: { must?: boolean } = {}): Urgency {
  if (S(c?.kind) === 'interest' || c?.open_hours === true || c?.shift_pattern?.kind === 'open_ongoing' || S(c?.reason) === 'open')
    return { level: 'planning', why: 'a regular opening, not one shift', mins: null }
  const m = minsToStart(c, chiNowNaive)
  if (m == null) return { level: 'unknown', why: 'no date and start time on the case yet', mins: null }
  if (m < -60) return { level: 'past', why: 'started over an hour ago', mins: m }
  if (m <= 180) return { level: 'critical', why: m >= 0 ? `starts in ${span(m)}` : `started ${span(-m)} ago`, mins: m }
  if (o.must && m <= 24 * 60) return { level: 'critical', why: `must be covered (the client's call-in plan), starts in ${span(m)}`, mins: m }
  if (m <= 24 * 60) return { level: 'today', why: `starts in ${span(m)}`, mins: m }
  return { level: 'coming_up', why: `starts in ${Math.round(m / 1440)} day${Math.round(m / 1440) === 1 ? '' : 's'}`, mins: m }
}

/** Is a caregiver confirmed for it? (then nothing is urgent about coverage) */
export const confirmed = (c: Any) => !!(c?.covered_by || c?.status !== 'open' || ['assigned', 'already'].includes(S(c?.axiscare_assignment?.status)))

/** The Critical text to the people on duty. Names the client and time, what has happened so far, and their link. */
export function criticalText(c: Any, u: Urgency, when: string): string {
  const asked = Array.isArray(c?.asked) ? c.asked : [], yes = asked.filter((a: Any) => a?.state === 'yes').length
  const so = !asked.length ? 'Nobody has been asked yet.' : yes ? `${yes} said yes, nobody confirmed yet.` : `${asked.length} asked, no yes yet.`
  return `CRITICAL open shift: ${S(c?.client, 60) || 'a client'} ${when}, ${u.why}. ${so} {link}`
}

/** Who gets it: the Staffing seat and In charge now, each once, with a phone; nobody like that = the whole alert list. */
export function criticalRecipients(seats: { staffing?: { person?: string }; in_charge?: { person?: string } }, admins: { email: string; phone: string | null }[], staffFor: (email: string) => { email: string; phone: string | null } | null) {
  const want = [S(seats?.staffing?.person).toLowerCase(), S(seats?.in_charge?.person).toLowerCase()].filter(Boolean)
  const picked = [...new Set(want)].map((e) => admins.find((a) => a.email === e) ?? staffFor(e)).filter((a): a is { email: string; phone: string | null } => !!a && !!a.phone)
  return picked.length ? { to: picked, why: 'on duty now' } : { to: admins.filter((a) => a.phone), why: 'nobody on duty with a phone on file, so everyone on the call-in alert list' }
}
