// =============================================================================
// cara-list.ts · CARA PHASE 1: the better list and the recommendation (Samantha, 2026-10-23: "proceed with your
// recommended Phase 1"; plan https://claude.ai/artifact/E9DRvcnsFLBhGdN2iAdQfJ).
// Her rules carried here:
//   • missing availability means Unknown, never Available (2026-10-17); Unknown is shown, ranked after a stated fit
//     and before "outside their availability", and never counted as a fit
//   • flag weekly hours, overtime risk and overlapping commitments; flags inform, they never text or assign anyone
//   • a YES is interest, never an assignment: only a confirm in the Hub that AxisCare reads back is "assigned"
//   • Cara recommends, a person confirms (assignment stays office-approved)
// Pure: everything comes in as arguments, nothing is read or written (Node tests: cara_p1_test.mjs).
// =============================================================================
// deno-lint-ignore-file no-explicit-any
type Any = any

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const S = (v: unknown, n = 120) => String(v ?? '').trim().slice(0, n)
const hhmm = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

/** The availability answer for one caregiver and one case. Same bands as the availability page. */
export type Avail = { state: 'fits' | 'unknown' | 'outside' | 'outside_ok' | 'no_shift'; why: string | null }
const BAND = (t: string) => { const h = Number(t.slice(0, 2)); return h >= 6 && h < 12 ? 'morning' : h >= 12 && h < 17 ? 'afternoon' : h >= 17 && h < 22 ? 'evening' : 'overnight' }
const DAY_WORD: Record<string, string> = { mon: 'Mondays', tue: 'Tuesdays', wed: 'Wednesdays', thu: 'Thursdays', fri: 'Fridays', sat: 'Saturdays', sun: 'Sundays' }
const BAND_WORD: Record<string, string> = { morning: 'mornings', afternoon: 'daytimes', evening: 'evenings', overnight: 'overnights' }
export const UNKNOWN_WHY = 'Availability unknown: nothing on file'

export function availStatus(c: Any, a: { windows?: Record<string, string[]> | null; outside_ok?: boolean | null } | null | undefined): Avail {
  const slots: [string, string][] = []
  const date = S(c?.shift_date), time = S(c?.shift_time)
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d\d:\d\d-\d\d:\d\d$/.test(time)) slots.push([DAYS[new Date(date + 'T12:00:00Z').getUTCDay()], BAND(time.slice(0, 5))])
  else if (Array.isArray(c?.interest_days) && /^\d\d:\d\d$/.test(S(c?.interest_start).slice(0, 5)))
    for (const d of c.interest_days) slots.push([String(d).toLowerCase().slice(0, 3), BAND(S(c.interest_start).slice(0, 5))])
  if (!slots.length) return { state: 'no_shift', why: null }
  const w = a?.windows
  if (!w || !Object.values(w).some((v) => Array.isArray(v) && v.length)) return { state: 'unknown', why: UNKNOWN_WHY }
  if (slots.some(([d, b]) => Array.isArray(w[d]) && w[d].includes(b))) return { state: 'fits', why: null }
  const [d0, b0] = slots[0]
  const why = slots.length === 1 ? 'outside their availability (' + (Array.isArray(w[d0]) && w[d0].length ? 'not ' + (DAY_WORD[d0] || d0) + ' ' + (BAND_WORD[b0] || b0) : 'not ' + (DAY_WORD[d0] || d0)) + ')'
    : 'outside their availability (none of the asked days at that time)'
  return a?.outside_ok === true ? { state: 'outside_ok', why: why + ', said OK to texts about those' } : { state: 'outside', why }
}
/** Sort weight: a stated fit first, then unknown, then outside (outside_ok counts as a fit: they asked to hear about those). */
export const availRank = (s: Avail['state'] | undefined | null) => s === 'fits' || s === 'outside_ok' || s === 'no_shift' ? 0 : s === 'unknown' ? 1 : s === 'outside' ? 2 : 1

/** The work week holding `ymd`: [first day, last day]. Her payroll week is Monday to Sunday (Samantha, 2026-10-23), so 'mon'
    is the default; ops_settings.payroll_week_start overrides it. */
export function weekOf(ymd: string, start = 'mon'): [string, string] {
  const d = new Date(ymd + 'T12:00:00Z'), back = (d.getUTCDay() - Math.max(0, DAYS.indexOf(start)) + 7) % 7
  const a = new Date(d.getTime() - back * 86400000), z = new Date(a.getTime() + 6 * 86400000)
  return [a.toISOString().slice(0, 10), z.toISOString().slice(0, 10)]
}
const visitHours = (v: Any) => { const s = Date.parse(S(v?.scheduledStartDate ?? v?.startDate, 30)), e = Date.parse(S(v?.scheduledEndDate ?? v?.endDate, 30)); return Number.isFinite(s) && Number.isFinite(e) && e > s ? (e - s) / 3600000 : 0 }
export function shiftHours(time: string): number { const m = /^(\d\d:\d\d)-(\d\d:\d\d)$/.exec(S(time)); if (!m) return 0; let d = hhmm(m[2]) - hhmm(m[1]); if (d <= 0) d += 1440; return d / 60 }

/** Hours already on the AxisCare schedule in that work week, per caregiver id (visits already filtered to the week). */
export function weekHoursBy(visits: Any[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const v of visits || []) { const id = v?.caregiver?.id; if (id == null || v?.removed) continue; out.set(String(id), (out.get(String(id)) ?? 0) + visitHours(v)) }
  return out
}
/** The hours flag for one caregiver: overtime risk past 40, near 40 from 36, over the hours they told us they want. */
export function hoursFlag(scheduled: number, shift: number, target: number | null | undefined): { level: 'ot' | 'near' | 'over_target' | null; text: string | null; total: number } {
  const total = Math.round((scheduled + shift) * 10) / 10, sch = Math.round(scheduled * 10) / 10
  if (!shift) return { level: null, text: null, total }
  if (total > 40) return { level: 'ot', text: `Overtime risk: ${sch}h already this week + ${Math.round(shift * 10) / 10}h = ${total}h`, total }
  if (total >= 36) return { level: 'near', text: `Near 40 hours: ${total}h this week with this shift`, total }
  const t = Number(target); if (Number.isFinite(t) && t > 0 && total > t) return { level: 'over_target', text: `More than the ${t}h a week they want (${total}h with this shift)`, total }
  return { level: null, text: null, total }
}

/** Overlap of two same-day spans "HH:MM-HH:MM" (an overnight end wraps past midnight). */
export function spansOverlap(a: string, b: string): boolean {
  const p = (t: string) => { const m = /^(\d\d:\d\d)-(\d\d:\d\d)$/.exec(S(t)); if (!m) return null; const s = hhmm(m[1]); let e = hhmm(m[2]); if (e <= s) e += 1440; return [s, e] }
  const x = p(a), y = p(b); return !!(x && y && x[0] < y[1] && y[0] < x[1])
}

/** Other commitments that overlap this case for this caregiver, besides AxisCare visits (those are working_then):
    a YES still standing on another open coverage case at the same time, or a YES on a Caregiver Matching plan that
    hasn't been put in AxisCare yet, on the same weekday at overlapping hours. Each is interest, so it is a flag, not a block. */
export function overlapsFor(kase: Any, cg: { axiscare_id?: string | null; name?: string | null }, cases: Any[], plans: Any[]): string[] {
  const out: string[] = []
  const date = S(kase?.shift_date), time = S(kase?.shift_time)
  if (!/^\d{4}-\d\d-\d\d$/.test(date) || !/^\d\d:\d\d-\d\d:\d\d$/.test(time)) return out
  const nk = (n: unknown) => S(n, 80).toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()
  const me = (a: Any) => (cg.axiscare_id && S(a?.axiscare_id) === S(cg.axiscare_id)) || (cg.name && nk(a?.name) === nk(cg.name))
  for (const k of cases || []) {
    if (!k || k.id === kase.id || k.status !== 'open' || S(k.shift_date) !== date || !spansOverlap(time, S(k.shift_time))) continue
    if ((Array.isArray(k.asked) ? k.asked : []).some((a: Any) => me(a) && a.state === 'yes'))
      out.push(`Said yes to another open shift then: ${S(k.client, 60).split(' ')[0] || 'another client'} ${S(k.shift_time)}`)
  }
  const wd = DAYS[new Date(date + 'T12:00:00Z').getUTCDay()]
  /* Caregiver Matching plans (app_data staffing_plans): the 1st choice in cells[key], 2nd and later in options[key]
     (team-builder-2.js people()). A plan already sent to AxisCare (axiscare_push) is on the real schedule, which the
     AxisCare read covers, so it is skipped here; done and archived plans too. */
  for (const p of plans || []) {
    if (!p || p.status === 'done' || p.status === 'archived' || p.axiscare_push) continue
    const slots = new Map((Array.isArray(p.slots) ? p.slots : []).map((s: Any) => [S(s?.k), `${S(s?.start)}-${S(s?.end)}`]))
    const keys = new Set([...Object.keys(p.cells || {}), ...Object.keys(p.options || {})])
    for (const key of keys) {
      const [d, slot] = String(key).split('|')
      if (String(d).toLowerCase().slice(0, 3) !== wd) continue
      const span = slots.get(S(slot)); if (!span || !spansOverlap(time, span as string)) continue
      const people: Any[] = [...(p.cells?.[key] ? [p.cells[key]] : []), ...(Array.isArray(p.options?.[key]) ? p.options[key] : [])]
      if (people.some((x) => x && x.status === 'yes' && ((cg.axiscare_id && S(x.cg_ax_id ?? x.axiscare_id) === S(cg.axiscare_id)) || (cg.name && nk(x.name) === nk(cg.name)))))
        out.push(`Said yes to a planned regular shift then (${S(p.client, 60) || 'a new client'}, ${span}), not in AxisCare yet`)
    }
  }
  return [...new Set(out)]
}

/** The skills rule's answer for the list: cut only on "not for this visit"; one more step and likely fit are notes. */
export function skillsNote(r: Any): { cut: string | null; note: string | null; group: string | null; cleared_note?: string | null } {
  if (!r) return { cut: null, note: null, group: null }
  /* a lapsed eligibility check is shown, never a cut (her rule 2026-10-23) */
  if (r.cleared_note) { const inner = skillsNote({ ...r, cleared_note: null }); return { ...inner, cleared_note: S(r.cleared_note, 200) } }
  if (r.group === 'not_for_visit') return { cut: S(r.reason, 200) || 'not a match for this client (skills rules)', note: null, group: r.group }
  if (r.group === 'one_more_step') return { cut: null, note: 'One more step: ' + S(r.reason, 160), group: r.group }
  if (r.group === 'likely_fit') return { cut: null, note: 'Likely fit: the client\'s care plan is not fully confirmed', group: r.group }
  return { cut: null, note: null, group: r.group }
}

/** CARA RECOMMENDS: of the people who said YES (interest), the one to confirm, with the reasons and anything to check.
    rows = the candidate rows (coverage-run buildCandidatesForCase), matched to the yes-asks by AxisCare id or name.
    A yes from someone no longer on the list (now excluded) is never recommended and is named in `not_eligible`. */
export function recommend(kase: Any, rows: Any[], excluded: { name: string; why: string }[] = []): Any {
  const nk = (n: unknown) => S(n, 80).toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()
  const yes = (Array.isArray(kase?.asked) ? kase.asked : []).filter((a: Any) => a && a.state === 'yes')
  if (!yes.length) return { pick: null, others: [], not_eligible: [], note: 'Nobody has said yes yet.' }
  const scored: Any[] = [], notEligible: Any[] = []
  for (const a of yes) {
    const r = rows.find((x) => (a.axiscare_id && S(x.axiscare_id) === S(a.axiscare_id)) || nk(x.name) === nk(a.name))
    if (!r) { const ex = excluded.find((e) => nk(e.name) === nk(a.name)); notEligible.push({ name: S(a.name, 80), why: ex ? S(ex.why, 160) : 'no longer on the list' }); continue }
    const reasons: string[] = [], concerns: string[] = []
    let score = 0
    if (r.this_client?.favorite) { score += 50; reasons.push(`${S(kase.client, 40).split(' ')[0] || 'The client'}'s favorite`) }
    if (r.history?.visits) { score += Math.min(30, 10 + r.history.visits); reasons.push(`${r.history.visits} visit${r.history.visits === 1 ? '' : 's'} with this client`) }
    if (r.prn?.fit) { score += 8; reasons.push('PRN Team, fits their days and times') }
    if (r.avail_state === 'fits') { score += 10; reasons.push('the shift is inside their availability') }
    else if (r.avail_state === 'unknown') concerns.push(UNKNOWN_WHY)
    else if (r.avail_state === 'outside') { score -= 15; concerns.push(S(r.outside_avail) || 'outside their availability') }
    if (r.chain) { score += 6; reasons.push(S(r.chain.detail, 120)) }
    if (typeof r.miles === 'number') { score += Math.max(0, 12 - Math.floor(r.miles / 3)); reasons.push(`about ${r.miles} mi away (straight line)`) }
    if (r.working_then) { score -= 60; concerns.push('Already working then: ' + S(r.working_then.detail, 120)) }
    for (const o of r.overlaps || []) { score -= 25; concerns.push(o) }
    if (r.hours?.level === 'ot') { score -= 30; concerns.push(r.hours.text) }
    else if (r.hours?.level === 'near' || r.hours?.level === 'over_target') { score -= 8; concerns.push(r.hours.text) }
    if (r.skills_note) { score -= 10; concerns.push(r.skills_note) }
    if (r.cleared_note) { score -= 20; concerns.push(r.cleared_note) }
    if (r.this_client?.rating === 'concern' || (r.rep?.concerns ?? 0) > 1) { score -= 20; concerns.push('Concern calls on record' + (r.rep?.concerns ? ` (${r.rep.concerns})` : '')) }
    const cond = S(a.condition, 160); if (cond) { score -= 5; concerns.push('Said yes with a condition: ' + cond) }
    scored.push({ name: S(a.name, 80), axiscare_id: a.axiscare_id ?? r.axiscare_id ?? null, ask_id: a.id ?? null, replied_at: a.replied_at ?? null, score, reasons, concerns })
  }
  /* a tie goes to whoever said yes first */
  scored.sort((x, y) => y.score - x.score || S(x.replied_at).localeCompare(S(y.replied_at)))
  const pick = scored[0] ?? null
  return { pick, others: scored.slice(1), not_eligible: notEligible,
    note: pick ? 'A yes is interest only. Nothing is assigned until you confirm and AxisCare shows them on the visit.' : 'Everyone who said yes is no longer eligible.' }
}

/** INTEREST vs ASSIGNED, one word for the Hub and the texts: */
export function fillState(kase: Any): 'assigned' | 'confirmed_not_in_axiscare' | 'interest' | 'asking' | 'no_asks' {
  const ax = kase?.axiscare_assignment
  /* coverage-fill's AxisResult: assigned and already both mean AxisCare read back the caregiver on the visit */
  if (ax && (ax.status === 'assigned' || ax.status === 'already') && ax.verified === true) return 'assigned'
  if (kase?.covered_by || kase?.status === 'resolved') return 'confirmed_not_in_axiscare'
  const asked = Array.isArray(kase?.asked) ? kase.asked : []
  if (asked.some((a: Any) => a?.state === 'yes')) return 'interest'
  return asked.length ? 'asking' : 'no_asks'
}
