// =============================================================================
// hr-agent-rules.ts · what the HR agent flags, and how it sorts it (HR Agent build step 4, Samantha 2026-10-18)
// =============================================================================
// The approved HR Agent Rulebook (2026-10-18, "Approve all of it, including 3 missed clock-ins in 30 days"):
//   w01 short-notice call-in      under notice_hours (4) before the shift, or after 5 PM the day before a 7 to 9 AM shift
//   w02 too many call-ins         callin_count (3) in callin_window (90) days
//   w03 late arrivals             more than tardy_grace (7) minutes late; tardy_count (3) in tardy_window (90) days
//   w04 no-call/no-show           any one: serious, straight to Zach
//   w05 missed shift notes        3 counted misses in 30 days (the missed-notes job's own count)
//   w06 missed clock-ins/outs     evv_count (3) in evv_window (30) days
//   kind words about a caregiver  recognition
// Sorting (decisions 3 and 8): the first time, a coaching opportunity for the Care Coordinator; the same rule again for
// the same caregiver after an earlier case in the last 90 days, a recurring concern for Zach; a no-call/no-show, serious.
// A threshold opens a review, never discipline. Events someone already reviewed (action_id set: a good reason, or a
// write-up that covers them) never count again.
// Pure: no clock, no database, no network. The caller passes everything, including `now`.
// =============================================================================
export type Settings = {
  notice_hours: number; callin_count: number; callin_window: number; tardy_grace: number; tardy_count: number; tardy_window: number
  evv_count: number; evv_window: number; notes_count: number; notes_window: number; repeat_window: number
}
export const DEFAULTS: Settings = { notice_hours: 4, callin_count: 3, callin_window: 90, tardy_grace: 7, tardy_count: 3, tardy_window: 90,
  evv_count: 3, evv_window: 30, notes_count: 3, notes_window: 30, repeat_window: 90 }
export type Kind = 'recognition' | 'coaching' | 'recurring' | 'serious'
export type Fact = { date: string; what: string }
export type Case = { id: string; axiscare_caregiver_id: string; caregiver: string; kind: Kind; rule: string; title: string; facts: Fact[]; handbook: string; source_ids: string[] }
// deno-lint-ignore no-explicit-any
type Any = any

export const HANDBOOK: Record<string, string> = {
  w01: '2A: "Whenever possible, notify the office at least four (4) hours before the beginning of your shift." "For shifts beginning between 7:00 AM and 9:00 AM, notify the office no later than 5:00 PM the previous day, whenever reasonably possible."',
  w02: '2A: excessive call-offs and late cancellations can lead to discipline',
  w03: '2U: "Repeated tardiness may result in corrective action."',
  w04: '2U: "No Call / No Show incidents are considered serious misconduct and may result in immediate termination."',
  w05: '2K: complete all required documentation before the end of the shift',
  w06: '2D: repeated missed punches can lead to coaching',
  kind: '3O: employee recognition',
}

export function settingsFrom(attendance: Any, ops: Any): Settings {
  const n = (v: unknown, d: number) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : d }
  const a = attendance || {}, o = ops || {}
  return { notice_hours: n(a.notice_hours, DEFAULTS.notice_hours), callin_count: n(a.callin_count, DEFAULTS.callin_count), callin_window: n(a.callin_window, DEFAULTS.callin_window),
    tardy_grace: n(a.tardy_grace, DEFAULTS.tardy_grace), tardy_count: n(a.tardy_count, DEFAULTS.tardy_count), tardy_window: n(a.tardy_window, DEFAULTS.tardy_window),
    evv_count: n(o.hr_evv_count, DEFAULTS.evv_count), evv_window: n(o.hr_evv_window, DEFAULTS.evv_window),
    notes_count: n(o.hr_notes_count, DEFAULTS.notes_count), notes_window: n(o.hr_notes_window, DEFAULTS.notes_window), repeat_window: n(o.hr_repeat_window, DEFAULTS.repeat_window) }
}

/* ---------- time ---------- */
const YMD = /^\d{4}-\d{2}-\d{2}$/
const FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
/** A typed local time 'YYYY-MM-DDTHH:MM' as is; a full timestamp read in Central time. '' when unreadable. */
export function centralLocal(ts: unknown): string {
  const t = String(ts ?? '').trim(); if (!t) return ''
  if (!/(Z|[+-]\d\d:?\d\d)$/.test(t)) return t.replace(' ', 'T').slice(0, 16)
  const d = new Date(t); if (isNaN(d.getTime())) return ''
  const p: Record<string, string> = {}; for (const x of FMT.formatToParts(d)) p[x.type] = x.value
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`
}
export const chiDay = (t: number) => centralLocal(new Date(t).toISOString()).slice(0, 10)
const dayBefore = (ymd: string) => new Date(Date.parse(ymd + 'T12:00:00Z') - 864e5).toISOString().slice(0, 10)
const daysAgo = (now: number, n: number) => chiDay(now - n * 864e5)

/** Same rule as the Hub's writeup-rules.js shortNotice (SOP ruling 5; handbook 2A and 2U). */
export function shortNotice(ev: Any, noticeHours: number): { short: boolean; why: string } {
  if (!ev || ev.type !== 'callin') return { short: false, why: '' }
  if (ev.notice_hours != null && ev.notice_hours !== '' && Number(ev.notice_hours) < noticeHours)
    return { short: true, why: `Call-in with only ${ev.notice_hours}h notice (handbook: ${noticeHours}h)` }
  const st = String(ev.shift_time || '').slice(0, 5)
  if (/^\d\d:\d\d$/.test(st) && st >= '07:00' && st <= '09:00' && YMD.test(String(ev.shift_date || ''))) {
    const said = centralLocal(ev.reported_at), prev = dayBefore(ev.shift_date)
    if (said && said > prev + 'T17:00') return { short: true, why: `Call-in after 5 PM the day before a ${st} shift (handbook: by 5 PM the day before a 7 to 9 AM shift)` }
  }
  return { short: false, why: '' }
}

/* ---------- who ---------- */
const cgKey = (e: Any) => String(e?.axiscare_caregiver_id || e?.ax_caregiver_id || '').trim()
const factOf = (e: Any): Fact => ({ date: String(e.shift_date || ''), what:
  e.type === 'callin' ? 'Call-in' + (e.notice_hours != null && e.notice_hours !== '' ? ` with ${e.notice_hours}h notice` : '')
  : e.type === 'tardy' ? `Late${e.minutes_late ? ' ' + e.minutes_late + ' minutes' : ''}`
  : e.type === 'ncns' ? 'No-call/no-show'
  : e.type === 'evv_missing_in' ? 'No clock-in' : e.type === 'evv_missing_out' ? 'No clock-out' : String(e.type || '') })
const shortHash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return (h >>> 0).toString(36) }

export type Input = {
  now: number
  events: Any[]            // app_data attendance_events
  missedNotes: Any[]       // missed_notes rows (counts = true, not practice)
  kindWords: Any[]         // kind_words rows (status 'kind', about_role 'caregiver', link to a caregiver)
  prior: Any[]             // hr_cases already on file (any status)
  names: Record<string, string> // AxisCare caregiver id -> name, when known
  settings: Settings
}

/** Every case the agent would open today that is not already on file. Deterministic for the same input. */
export function findCases(inp: Input): Case[] {
  const S = inp.settings, now = inp.now, out: Case[] = []
  const priorIds = new Set((inp.prior || []).map((p: Any) => String(p.id)))
  const name = (cg: string, fallback?: string) => inp.names[cg] || String(fallback || '').trim() || 'Caregiver ' + cg
  /* an earlier case on the same rule for the same caregiver, opened inside the window: a new one would be the same episode */
  const openedSince = (cg: string, rule: string, sinceDay: string) => (inp.prior || []).some((p: Any) =>
    String(p.axiscare_caregiver_id) === cg && p.rule === rule && String(p.created_at || '').slice(0, 10) >= sinceDay && p.status !== 'withdrawn')
  /* any earlier case on this rule for this caregiver inside the repeat window (that wasn't judged wrong): the next is recurring */
  const repeats = (cg: string, rule: string) => (inp.prior || []).some((p: Any) =>
    String(p.axiscare_caregiver_id) === cg && p.rule === rule && p.review !== 'disagree' && p.status !== 'withdrawn'
    && String(p.created_at || '').slice(0, 10) >= daysAgo(now, S.repeat_window))
  const push = (cg: string, rule: string, kind: Kind, title: string, facts: Fact[], srcs: string[], who?: string) => {
    const id = 'hr_' + rule + '_' + cg + '_' + shortHash(srcs.slice().sort().join('|'))
    if (priorIds.has(id)) return
    out.push({ id, axiscare_caregiver_id: cg, caregiver: name(cg, who), kind, rule, title, facts, handbook: HANDBOOK[rule === 'kind' ? 'kind' : rule] || '', source_ids: srcs })
    priorIds.add(id)
  }
  const sorted = (rule: string, cg: string): Kind => (repeats(cg, rule) ? 'recurring' : 'coaching')

  /* attendance, by caregiver; only events with an AxisCare number (name-only records are left to a person) and not yet reviewed */
  const by: Record<string, Any[]> = {}
  for (const e of inp.events || []) {
    const cg = cgKey(e); if (!cg || !e || !YMD.test(String(e.shift_date || ''))) continue
    if (e.action_id) continue
    ;(by[cg] ||= []).push(e)
  }
  for (const cg of Object.keys(by)) {
    const evs = by[cg], who = evs.find((e) => e.caregiver)?.caregiver
    const inWin = (n: number) => evs.filter((e) => e.shift_date >= daysAgo(now, n))
    // w04 no-call/no-show: each one, serious
    for (const e of inWin(30).filter((e) => e.type === 'ncns'))
      push(cg, 'w04', 'serious', 'No-call/no-show on ' + e.shift_date, [factOf(e)], [String(e.id)], who)
    // w01 short notice: each one in the last 30 days
    for (const e of inWin(30).filter((e) => e.type === 'callin')) {
      const sn = shortNotice(e, S.notice_hours)
      if (sn.short && !openedSince(cg, 'w01', e.shift_date)) push(cg, 'w01', sorted('w01', cg), sn.why + ' on ' + e.shift_date, [factOf(e)], [String(e.id)], who)
    }
    // w02 call-ins, w03 late arrivals, w06 missed clock-ins/outs: a count in a window
    const counted: [string, (e: Any) => boolean, number, number, string][] = [
      ['w02', (e) => e.type === 'callin', S.callin_count, S.callin_window, 'call-ins'],
      ['w03', (e) => e.type === 'tardy' && !(Number(e.minutes_late) > 0 && Number(e.minutes_late) <= S.tardy_grace), S.tardy_count, S.tardy_window, 'late arrivals'],
      ['w06', (e) => e.type === 'evv_missing_in' || e.type === 'evv_missing_out', S.evv_count, S.evv_window, 'missed clock-ins or clock-outs'],
    ]
    for (const [rule, f, count, win, words] of counted) {
      const hits = inWin(win).filter(f).sort((a, b) => String(a.shift_date).localeCompare(String(b.shift_date)))
      if (hits.length < count || openedSince(cg, rule, daysAgo(now, win))) continue
      push(cg, rule, sorted(rule, cg), `${hits.length} ${words} in ${win} days`, hits.map(factOf), hits.map((e) => String(e.id)), who)
    }
  }
  // w05 missed shift notes (the missed-notes job's counted misses)
  const notes: Record<string, Any[]> = {}
  for (const m of inp.missedNotes || []) { const cg = String(m?.axiscare_caregiver_id || ''); if (cg && m.counts && m.status !== 'practice' && String(m.shift_date) >= daysAgo(now, S.notes_window)) (notes[cg] ||= []).push(m) }
  for (const cg of Object.keys(notes)) {
    const hits = notes[cg].sort((a, b) => String(a.shift_date).localeCompare(String(b.shift_date)))
    if (hits.length < S.notes_count || openedSince(cg, 'w05', daysAgo(now, S.notes_window))) continue
    push(cg, 'w05', sorted('w05', cg), `${hits.length} missed shift notes in ${S.notes_window} days`,
      hits.map((m) => ({ date: String(m.shift_date), what: 'No shift note' + (m.status === 'recovered' ? ' (texted in later)' : '') })), hits.map((m) => 'mn' + m.id), hits[0].caregiver_name)
  }
  // recognition: kind words linked to a caregiver in the last 30 days
  for (const k of inp.kindWords || []) {
    const cg = k?.link?.type === 'caregiver' ? String(k.link.id || '') : ''
    if (!cg || k.status !== 'kind' || String(k.created_at || '').slice(0, 10) < daysAgo(now, 30)) continue
    push(cg, 'kind', 'recognition', 'Kind words from ' + (k.who || 'someone'), [{ date: String(k.said_on || k.created_at || '').slice(0, 10), what: '"' + String(k.quote || '').slice(0, 280) + '"' }], ['kw' + k.id])
  }
  return out
}
