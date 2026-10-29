// =============================================================================
// PRN STEP 5a · THE PRN TEAM PAGE (Samantha 2026-10-29: "Yes, build part 5a with its switch off"; the page sample she approved
// 2026-10-28; her picks the same day: short notice changeable on the page, a break-until date that texts respect, two parts)
// =============================================================================
// One phone page per PRN member, from their own sealed link (no login). Part 5a shows: their team, "I'm looking for hours",
// Offered to You (shifts we texted them about; answering opens the shift page they already know), their familiar clients,
// thank-yous and kind words the office already sent them, My hours (days and times, hours a week, outside-hours texts, short
// notice, a break), optional courses ("I'd like to take this"), and Talk to us. Part 5b adds open shifts with I'm Interested
// (_shared/prn-open.ts); a shift they said they were interested in then shows in Offered to You, marked from_page.
// The office sees it read-only from the Hub ("See what Grace sees"), and each look is recorded.
// Only decisions here (no reads or writes), so every rule is tested.
// =============================================================================
// deno-lint-ignore no-explicit-any
type Any = any
import { milestonesFor } from './prn-recognition.ts'
const S = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n)
const DAY = 86_400_000
export const LOOKING_DAYS = 7, BREAK_MAX_DAYS = 120
export const TEAM: Record<string, string> = { cna: 'PRN CNA Team', caregiver: 'PRN Caregiver Team' }
/* Optional courses on the Training Platform (her 791 rule: only Agency Orientation is required; the office assigns the rest) */
export const COURSES: { slug: string; title: string; hours: number; about: string }[] = [
  { slug: 'dementia-care', title: "Alzheimer's & Dementia Care", hours: 4, about: 'Understanding memory loss, communication, and calm, kind responses to hard moments.' },
  { slug: 'on-the-job-training', title: 'On-the-Job Skills Training', hours: 6, about: 'Hands-on care skills, from safe transfers to personal care, reviewed step by step.' },
]
export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], WINDOWS = ['morning', 'afternoon', 'evening', 'overnight']
const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10)
const ymdOf = (iso: unknown) => /^\d{4}-\d\d-\d\d/.test(S(iso, 10)) ? new Date(S(iso, 40)).toLocaleDateString('en-CA', { timeZone: 'America/Chicago' }) : ''

/** "I'm looking for hours": on for 7 days from the last tap, unless they turned it off. log: prn_page_log rows for one member. */
export function lookingState(log: Any[], today: string): { on: boolean; note: string | null; since: string | null; until: string | null } {
  const last = log.filter((r) => r?.kind === 'looking_on' || r?.kind === 'looking_off').sort((a, b) => S(a.at, 40).localeCompare(S(b.at, 40))).pop()
  if (!last || last.kind !== 'looking_on') return { on: false, note: null, since: null, until: null }
  const since = ymdOf(last.at), until = addDays(since, LOOKING_DAYS)
  return today <= until ? { on: true, note: S(last.note, 200) || null, since, until } : { on: false, note: null, since: null, until: null }
}

/** Their hours, checked: a day grid of known windows, 0 to 80 hours, a yes/no for outside-hours texts. */
export function readHours(b: Any): { ok: true; windows: Record<string, string[]>; target_hours: number | null; outside_ok: boolean } | { ok: false; error: string } {
  const windows: Record<string, string[]> = {}
  for (const d of DAYS) windows[d] = (Array.isArray(b?.windows?.[d]) ? b.windows[d] : []).map((w: unknown) => S(w, 20)).filter((w: string) => WINDOWS.includes(w))
  const t = b?.target_hours === '' || b?.target_hours == null ? null : Number(b.target_hours)
  if (t != null && (!Number.isFinite(t) || t < 0 || t > 80)) return { ok: false, error: 'Hours a week should be a number from 0 to 80.' }
  return { ok: true, windows, target_hours: t == null ? null : Math.round(t), outside_ok: b?.outside_ok === true }
}

/** A break until a date: today at the earliest, at most 120 days out; empty = no break. */
export function readBreak(v: unknown, today: string): { ok: true; until: string | null } | { ok: false; error: string } {
  const u = S(v, 10)
  if (!u) return { ok: true, until: null }
  if (!/^\d{4}-\d\d-\d\d$/.test(u) || Number.isNaN(Date.parse(u + 'T12:00:00Z'))) return { ok: false, error: 'Pick the date your break ends.' }
  if (u < today) return { ok: false, error: 'That date has passed.' }
  if (u > addDays(today, BREAK_MAX_DAYS)) return { ok: false, error: `A break can be up to ${BREAK_MAX_DAYS} days. Text us if you need longer.` }
  return { ok: true, until: u }
}

/** Offered to You: open shifts we asked them about that haven't passed, newest shift first. cases: coverage_cases. */
export function offeredTo(cases: Any[], ax: string | null, today: string): Any[] {
  if (!ax) return []
  const out: Any[] = []
  for (const c of cases || []) {
    if (!c || !['open', 'flagged'].includes(S(c.status, 20))) continue
    const d = S(c.shift_date, 10); if (!/^\d{4}-\d\d-\d\d$/.test(d) || d < today) continue
    const ask = (Array.isArray(c.asked) ? c.asked : []).find((a: Any) => S(a?.axiscare_id, 20) === ax && a?.id)
    if (!ask || ['closed_notified', 'closed_silent'].includes(S(ask.state, 30))) continue
    out.push({ case_id: S(c.id, 100), ask_id: S(ask.id, 100), client_first: S(c.client, 80).split(/\s+/)[0] || 'A client', town: S(c.client_city, 60) || null,
      shift_date: d, shift_time: S(c.shift_time, 11) || null, answered: ['yes', 'no', 'inquiry'].includes(S(ask.state, 20)) ? S(ask.state, 20) : null,
      from_page: ask.from_prn_page === true })
  }
  return out.sort((a, b) => a.shift_date.localeCompare(b.shift_date) || S(a.shift_time).localeCompare(S(b.shift_time)))
}

/** Thank-yous: the exact texts the office sent them (thank-yous and kind words), and their milestones. Newest first, at most 12. */
export function thanksFor(x: { touches: Any[]; kindTells: Any[]; ax: string | null; covered: number; since: string; today: string; shifts?: Any[] }): Any[] {
  const out: Any[] = []
  for (const t of x.touches) if (t?.kind === 'thanks_sent' && S(t.message, 700)) out.push({ kind: 'thanks', at: S(t.at, 40), text: S(t.message, 700), from: S(t.by_name, 60).split(/\s+/)[0] || null })
  if (x.ax) for (const k of x.kindTells) for (const t of (Array.isArray(k?.tells) ? k.tells : [])) if (S(t?.caregiver_ax, 20) === x.ax && S(t?.text, 700)) out.push({ kind: 'kind_words', at: S(t.at, 40), text: S(t.text, 700), from: S(t.by, 60).split(/\s+/)[0] || null })
  /* step 7: first shift, 5, 10, 25, 50; a year; kept every yes this season (_shared/prn-recognition.ts) */
  out.push(...milestonesFor({ covered: x.covered, shifts: x.shifts ?? [], since: x.since, today: x.today }))
  return out.sort((a, b) => S(b.at, 40).localeCompare(S(a.at, 40))).slice(0, 12)
}

/** The This week lines step 5a adds: looking for hours, a course they asked for, an idea they shared. members: { applicant_id,
    name, first, team }; log: prn_page_log rows; touches: prn_touches (a line done is a touch with its ref). */
export function pageLines(x: { members: Any[]; log: Any[]; touches: Any[]; today: string }): Any[] {
  const out: Any[] = []
  const done = (aid: string, ref: string) => x.touches.some((t) => t?.applicant_id === aid && t?.ref === ref && ['called', 'handled', 'not_this_one'].includes(t.kind))
  for (const m of x.members) {
    const mine = x.log.filter((r) => r?.applicant_id === m.applicant_id)
    const lk = lookingState(mine, x.today)
    if (lk.on && !done(m.applicant_id, 'looking:' + lk.since))
      out.push({ id: `looking:${m.applicant_id}:${lk.since}`, kind: 'looking', applicant_id: m.applicant_id, name: m.name, team: TEAM[m.team] || TEAM.cna, ref: 'looking:' + lk.since,
        title: `${m.first || m.name} is looking for hours`, detail: (lk.note ? `"${lk.note}". ` : '') + 'From their PRN Team page. Worth a call, or keep them in mind for the next opening.' })
    for (const r of mine.filter((r) => r.kind === 'course_request')) {
      const c = COURSES.find((k) => k.slug === S(r.note, 40)); if (!c || done(m.applicant_id, 'course:' + c.slug)) continue
      out.push({ id: `course:${m.applicant_id}:${c.slug}`, kind: 'course', applicant_id: m.applicant_id, name: m.name, team: TEAM[m.team] || TEAM.cna, ref: 'course:' + c.slug,
        title: `${m.first || m.name} would like to take ${c.title}`, detail: 'Assign it on the Training Platform (Admin, Assign training), then mark it done here.' })
    }
    for (const r of mine.filter((r) => r.kind === 'idea')) {
      const ref = 'idea:' + S(r.id, 20); if (done(m.applicant_id, ref)) continue
      out.push({ id: `idea:${m.applicant_id}:${S(r.id, 20)}`, kind: 'idea', applicant_id: m.applicant_id, name: m.name, team: TEAM[m.team] || TEAM.cna, ref,
        title: `${m.first || m.name} shared an idea`, detail: `"${S(r.note, 500)}"` })
    }
    /* 2026-10-29: "Would you like more hours?" answered yes on their page (the latest answer; once per answer) */
    const mh = mine.filter((r) => r.kind === 'more_hours').sort((a, b) => S(a.at, 40).localeCompare(S(b.at, 40))).pop()
    if (mh && S(mh.note, 5) === 'yes' && !done(m.applicant_id, 'morehours:' + S(mh.id, 20)))
      out.push({ id: `morehours:${m.applicant_id}:${S(mh.id, 20)}`, kind: 'hours', applicant_id: m.applicant_id, name: m.name, team: TEAM[m.team] || TEAM.cna, ref: 'morehours:' + S(mh.id, 20),
        title: `${m.first || m.name} would like more hours`, detail: 'They said so on their PRN Team page. Worth a call about what is open, or keep them in mind for the next opening.' })
    /* step 7: their answers to the twice-yearly questions, and an on-call offer from their page */
    for (const r of mine.filter((r) => r.kind === 'feedback')) {
      const ref = 'feedback:' + S(r.id, 20); if (done(m.applicant_id, ref)) continue
      out.push({ id: `feedback:${m.applicant_id}:${S(r.id, 20)}`, kind: 'feedback', applicant_id: m.applicant_id, name: m.name, team: TEAM[m.team] || TEAM.cna, ref,
        title: `${m.first || m.name} answered "What would make PRN better?"`, detail: S(r.note, 600).replace(/^\[\d{4}-\d\d\]\n/, '').replace(/\n/g, ' · ') })
    }
    for (const r of mine.filter((r) => r.kind === 'oncall_offer')) {
      const ref = 'oncall:' + S(r.id, 20); if (done(m.applicant_id, ref)) continue
      out.push({ id: `oncall:${m.applicant_id}:${S(r.id, 20)}`, kind: 'oncall', applicant_id: m.applicant_id, name: m.name, team: TEAM[m.team] || TEAM.cna, ref,
        title: `${m.first || m.name} would like to be on call: ${S(r.note, 60).toLowerCase()}`, detail: 'From their PRN Team page. Confirm dates with them in On call, then mark it done here.' })
    }
    /* the on-call calendar (2026-10-29): shifts they asked for on their page wait on the calendar for the office's OK */
    for (const r of mine.filter((r) => r.kind === 'oncall_ask')) {
      const ref = 'oncall:' + S(r.id, 20); if (done(m.applicant_id, ref)) continue
      const n = S(r.note, 600).split(',').filter((x) => x.trim()).length
      out.push({ id: `oncall:${m.applicant_id}:${S(r.id, 20)}`, kind: 'oncall', applicant_id: m.applicant_id, name: m.name, team: TEAM[m.team] || TEAM.cna, ref,
        title: `${m.first || m.name} asked for ${n === 1 ? 'an on-call shift' : n + ' on-call shifts'}`, detail: 'From their PRN Team page. Confirm or say "Not this one" on the On call calendar, then mark it done here.' })
    }
  }
  return out
}
