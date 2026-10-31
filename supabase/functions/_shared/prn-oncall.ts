// =============================================================================
// PRN CNA ON-CALL CALENDAR (Samantha 2026-10-29: "Yes, build the on-call redo as recommended (decisions 22 to 27) and the
// expectations wording as drafted.")
// =============================================================================
//   22  The office calendar: every day, 4 weeks, two shifts a day: daytime and overnight (7am to 7pm and 7pm to 7am since T1) the next
//       morning. Each shift shows who is on call (confirmed), who asked (waiting for the office) or Open.
//   23  Members sign up one shift at a time on their PRN Team page, never as a standing pattern. Each one they tap lands on
//       the calendar as "asked" and the office confirms it with one tap.
//   24  Before their first sign-up they read and sign the On-Call Expectations (typed name + checkbox, kept with the time and
//       the exact words they signed). New wording = a new version = they sign again.
//   25  A miss ("Didn't answer our call" / "Didn't cover the shift"): that on-call shift is not paid, they can't sign up again,
//       and their other future on-call shifts and asks are taken back (the office calls to tell them). Only an owner lets
//       them sign up again, with a reason.
//   26  A shift that opens during someone's on-call time: the case shows "On call now", the office calls them first, and the
//       automatic texts wait until the office records how the call went, for at most HOLD_MIN minutes.
//   27  Giving a shift back: they call the office at least 24 hours ahead; the office takes it back on the calendar.
// EVERY WEEK (Samantha 2026-10-30, "Yes to all 7"): an open shift can be taken one time or every week (a series,
// prn_oncall_series; each week is still its own prn_oncall row with series_id, so payroll and decision 26 are unchanged).
//   W1  The office confirms an every-week shift once; each new week is added already confirmed, 4 weeks ahead (fillPlan;
//       the daily fill and every office look run it).
//   W2  A week someone else already holds is skipped, that week only; the series keeps going.
//   W3  No end date. Their 60-day check-in (My hours on their page) lists their every-week shifts.
//   W4  They stop it by calling the office at least 24 hours ahead; the office ends it, and a shift starting within 24 hours
//       stays theirs (endPlan). The page has no Stop button.
//   W5  A miss ends every series of theirs (with decision 25's take-back).
//   W6  Rule 6 of the expectations gains one sentence (a new version: they sign again).
//   W7  An every-week ask is one of the 10 waiting asks; no cap on how many every-week shifts someone holds.
// OUR CAREGIVERS (Samantha 2026-10-30, Krystal's idea, "Yes to all, we will only have caregivers who can do level 3 be on-call"):
//   C1  Only active caregivers AxisCare shows at Level 3 (Advanced Care) can be invited and sign up. PRN CNA Team members keep their
//       PRN Team page. Every on-call person can cover any open shift, so "the office calls them first" needs no level check.
//   C2  Pay: the same on-call pay as the PRN CNAs plus their own rate for a shift they cover, a separate payroll line, their pay
//       track unchanged (pay amounts are never on their page).
//   C3  Their own "My on-call" page (oncall.html, a sealed 30-day link by AxisCare id): what on call is, the expectations, the
//       calendar with Just this one / Every week, their shifts. The same rules as the PRN CNAs.
//   C4  The invite text, her approved draft, editable before it goes (INVITE_DEFAULT).
//   C5  A person presses Send for each invite, from the office line, through the caregiver text gates, never at night; or Copy link.
//   C6  The On call tab's Invite caregivers box: who is Level 3, with their status. Caregivers carry a "Caregiver" tag on the calendar.
//   C7  Switch ops_settings.prn_oncall_invite_live, off: owners can look and preview, nothing is texted, their page says not yet.
//   A person is a key: a PRN member's applicant id, or 'ax:' + an AxisCare caregiver id (personKey / personCols).
// 7AM TO 7PM (Samantha 2026-10-30, after the 1215 report: "can we build it set for 7am-7pm and 7pm-7am on call, and just show
// the open shifts being Friday, Saturday, and Sunday 7am-7pm. Allow owners to click to open on-call shifts right on the on-call
// tab"):
//   T1  The two shifts are daytime 7am to 7pm and overnight 7pm to 7am the next morning (were 7am to 5pm and 5pm to 7am).
//   T2  Which shifts are open for sign-up is a setting, ops_settings.prn_oncall_offered: { 'fri:day': true, ... } by weekday and
//       shift. Unset = Friday, Saturday and Sunday 7am to 7pm. Owners open and close them on the On call tab.
//   T3  Members see a shift that isn't offered as "Not offered" and can't ask for it (or start an every-week one there). Their own
//       shifts and asks always show. The office calendar counts open gaps only on offered shifts; the office can still put
//       someone on any shift by hand. An every-week shift already confirmed keeps filling if its shift is later closed.
//   T4  Rule 1 of the expectations names the new times (a new version: they sign again).
// Only decisions here (no reads or writes), so every rule is tested. Pay amounts are never here (her plan has them).
// =============================================================================
import { careLevelOf } from './care-level.ts'
// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n)
const DAY = 86_400_000
const YMD = /^\d{4}-\d\d-\d\d$/
export const DAYS_AHEAD = 28, MAX_OPEN_ASKS = 10, HOLD_MIN = 15, ASK_LEAD_MIN = 120, GIVE_BACK_HOURS = 24
export const SLOTS = ['day', 'overnight'] as const
export type Slot = typeof SLOTS[number]
export const SLOT_WORD: Record<string, string> = { day: 'Daytime, 7am to 7pm', overnight: 'Overnight, 7pm to 7am' }   // T1
export const MISS_KINDS: Record<string, string> = { no_answer: "Didn't answer our call", not_covered: "Didn't cover the shift" }
export const OUTCOMES: Record<string, string> = { covering: 'Covering it', ...MISS_KINDS }

export const addDays = (ymd: string, n: number) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10)
/** Monday of the week a date is in. */
export const mondayOf = (ymd: string) => addDays(ymd, -((new Date(ymd + 'T12:00:00Z').getUTCDay() + 6) % 7))
/** A shift's start and end as Central wall-clock strings ('YYYY-MM-DDTHH:MM'). */
export function slotWindow(date: string, slot: string): [string, string] {
  if (slot === 'day') return [date + 'T07:00', date + 'T19:00']   // T1: 7am to 7pm
  if (slot === 'overnight') return [date + 'T19:00', addDays(date, 1) + 'T07:00']   // T1: 7pm to 7am the next morning
  return [date + 'T07:00', addDays(date, 1) + 'T07:00']   // whole day
}

/* ── the words they sign (decision 24, her approved draft); Hub-editable as ops_settings.prn_oncall_terms ── */
export const TERMS_DEFAULT = [
  'PRN CNA On-Call Expectations',
  'When you sign up for an on-call shift, families are counting on you.',
  '1. On call comes in two shifts: daytime, 7am to 7pm, and overnight, 7pm to 7am.',
  '2. Keep your phone on and with you. Answer the office, or call back, within 15 minutes.',
  '3. Be ready to start a shift within 1 hour.',
  '4. If the office calls you about an open shift during your on-call time, you cover it.',
  "5. If you don't answer the office within 15 minutes, or you don't cover the shift, you won't be paid for that on-call shift, and you won't be able to sign up for on call again.",
  '6. If something comes up, call the office at least 24 hours before your on-call shift starts. To stop an every-week on-call shift, call the office at least 24 hours before the next one starts.',
].join('\n')
export const termsText = (st: Any) => S(st?.prn_oncall_terms, 4000) || TERMS_DEFAULT
/** A short fingerprint of the exact words: any change to them is a new version, signed again. */
export function termsVersion(text: string): string {
  let h = 0x811c9dc5
  for (const ch of text.replace(/\r\n/g, '\n').trim()) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 0x01000193) >>> 0 }
  return 'v' + h.toString(16).padStart(8, '0')
}
export const signedCurrent = (sigs: Any[], aid: string, version: string) => sigs.some((s) => s?.applicant_id === aid && s?.version === version)
export function readSign(b: Any, version: string, first: string, last: string): { ok: true; typed: string } | { ok: false; error: string } {
  if (b?.agree !== true) return { ok: false, error: 'Check the box to say you have read and agree.' }
  if (S(b?.version, 20) !== version) return { ok: false, error: 'The expectations changed while you were reading. Please read the new version.' }
  const typed = S(b?.typed_name, 80).replace(/\s+/g, ' ')
  if (typed.length < 3 || !/\s/.test(typed)) return { ok: false, error: 'Type your full name, first and last.' }
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z]/g, '')
  if (first && !norm(typed).startsWith(norm(first).slice(0, 2))) return { ok: false, error: `Type your own full name (${[first, last].filter(Boolean).join(' ')}).` }
  return { ok: true, typed }
}

/* ── the records → shifts ── */
const live = (rows: Any[]) => rows.filter((r) => r && !r.cancelled_at)
const missOf = (marks: Any[], id: unknown) => marks.find((m) => m && MISS_KINDS[m.kind] && m.oncall_id != null && Number(m.oncall_id) === Number(id)) || null
/** Each live row as the shifts it covers: a confirmed day/overnight row is one shift; whole, or an older row with no shift,
    is both shifts on every date in it; an ask is one shift. */
export function slotsOf(r: Any): { date: string; slot: Slot }[] {
  const s = S(r?.start_date, 10), e = S(r?.end_date, 10) || s
  if (!YMD.test(s) || e < s) return []
  const sh = S(r?.shift, 10), out: { date: string; slot: Slot }[] = []
  for (let d = s; d <= e; d = addDays(d, 1)) {
    if (sh === 'day' || sh === 'overnight') out.push({ date: d, slot: sh })
    else { out.push({ date: d, slot: 'day' }); out.push({ date: d, slot: 'overnight' }) }
  }
  return out
}
const nameOf = (members: Any[], aid: string) => (members.find((m) => m.applicant_id === aid) || { name: 'Someone no longer on the team' }).name

/* ── T2: which on-call shifts are open for sign-up ── */
export const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
export const OFFERED_DEFAULT: Record<string, boolean> = { 'fri:day': true, 'sat:day': true, 'sun:day': true }
/** The offered grid: her setting when it is an object, else Friday, Saturday and Sunday 7am to 7pm. */
export function offeredOf(st: Any): Record<string, boolean> {
  const o = st?.prn_oncall_offered
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { ...OFFERED_DEFAULT }
  const out: Record<string, boolean> = {}
  for (const d of WEEKDAY_KEYS) for (const sl of SLOTS) if (o[`${d}:${sl}`] === true) out[`${d}:${sl}`] = true
  return out
}
/** Is this date's shift open for sign-up? (an overnight belongs to the date it starts on) */
export const isOffered = (offered: Record<string, boolean> | null | undefined, date: string, slot: string) =>
  !offered || offered[`${WEEKDAY_KEYS[new Date(date + 'T12:00:00Z').getUTCDay()]}:${slot}`] === true
/** "Friday, Saturday and Sunday 7am to 7pm" style words for the grid, for pages and the office. */
export function offeredWords(offered: Record<string, boolean>): string {
  const NAMES: Record<string, string> = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' }
  const order = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
  const list = (xs: string[]) => xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]
  const parts = SLOTS.map((sl) => { const ds = order.filter((d) => offered[`${d}:${sl}`]).map((d) => NAMES[d]); return ds.length ? `${list(ds)} ${sl === 'day' ? '7am to 7pm' : '7pm to 7am'}` : '' }).filter(Boolean)
  return parts.length ? parts.join('; ') : 'none right now'
}

/** Decision 22: the office calendar, 4 weeks from Monday of this week. */
export function calendar(x: { rows: Any[]; marks: Any[]; members: Any[]; today: string; days?: number; series?: Any[]; offered?: Record<string, boolean> }): Any[] {
  const start = mondayOf(x.today), n = x.days ?? DAYS_AHEAD, rows = live(x.rows)
  const days = Array.from({ length: n }, (_, i) => addDays(start, i))
  const cell = () => ({ confirmed: [] as Any[], asked: [] as Any[], skipped: [] as Any[] })
  const by: Record<string, Any> = {}
  for (const d of days) by[d] = { date: d, past: d < x.today, day: cell(), overnight: cell() }
  for (const r of rows) {
    if (r.kind !== 'confirmed' && r.kind !== 'asked') continue
    for (const sl of slotsOf(r)) {
      const c = by[sl.date]?.[sl.slot]; if (!c) continue
      const who = { id: r.id, applicant_id: r.applicant_id, name: nameOf(x.members, r.applicant_id), weekly: r.series_id != null, caregiver: isCaregiverKey(r.applicant_id) }
      if (r.kind === 'asked') c.asked.push({ ...who, at: r.at || null })
      else { const m = missOf(x.marks, r.id); c.confirmed.push({ ...who, whole: S(r.shift, 10) !== 'day' && S(r.shift, 10) !== 'overnight', shift_recorded: !!S(r.shift, 10), missed: m ? m.kind : null }) }
    }
  }
  /* W2: an every-week shift someone else holds that week */
  for (const k of fillPlan({ series: x.series || [], rows: x.rows, today: x.today, days: n }).skipped) {
    const c = by[k.date]?.[k.slot]; if (c) c.skipped.push({ series_id: k.series_id, applicant_id: k.applicant_id, name: nameOf(x.members, k.applicant_id) })
  }
  for (const d of days) for (const sl of SLOTS) { const c = by[d][sl]; c.offered = isOffered(x.offered, d, sl); c.gap = c.offered && !by[d].past && !c.confirmed.some((p: Any) => !p.missed) }   // T3
  return days.map((d) => by[d])
}

/** Decision 23: what a member sees, today plus 4 weeks. Never another person's name. */
export function memberSlots(x: { rows: Any[]; aid: string; today: string; nowNaive: string; days?: number; series?: Any[]; offered?: Record<string, boolean> }): Any[] {
  const rows = live(x.rows), n = x.days ?? DAYS_AHEAD, out: Any[] = []
  const skip = new Set(fillPlan({ series: (x.series || []).filter((s) => s?.applicant_id === x.aid), rows: x.rows, today: x.today, days: n }).skipped.map((k) => k.date + k.slot))
  const soon = new Date(Date.parse(x.nowNaive + ':00Z') + ASK_LEAD_MIN * 60000).toISOString().slice(0, 16)
  for (let i = 0; i < n; i++) {
    const d = addDays(x.today, i), row: Any = { date: d }
    for (const sl of SLOTS) {
      const here = rows.filter((r) => (r.kind === 'confirmed' || r.kind === 'asked') && slotsOf(r).some((s) => s.date === d && s.slot === sl))
      const mine = here.find((r) => r.kind === 'confirmed' && r.applicant_id === x.aid), ask = here.find((r) => r.kind === 'asked' && r.applicant_id === x.aid)
      const [st] = slotWindow(d, sl)
      row[sl] = mine ? { state: 'mine', weekly: mine.series_id != null, can_give_back: Date.parse(st + ':00Z') - Date.parse(x.nowNaive + ':00Z') >= GIVE_BACK_HOURS * 3600000 }
        : ask ? { state: 'asked', id: ask.id, weekly: ask.series_id != null }
        : st <= soon ? { state: 'past' }
        : !isOffered(x.offered, d, sl) ? { state: 'closed' }   // T3: not open for sign-up
        : here.some((r) => r.kind === 'confirmed') ? { state: 'taken', ...(skip.has(d + sl) ? { skip: true } : {}) } : { state: 'open' }
    }
    out.push(row)
  }
  return out
}

/** Decision 25: they can't sign up while their latest miss is newer than any owner's "let them sign up again". */
export function blockOf(marks: Any[], aid: string): { blocked: boolean; miss: Any | null } {
  const mine = marks.filter((m) => m?.applicant_id === aid && (MISS_KINDS[m.kind] || m.kind === 'lifted')).sort((a, b) => S(a.at, 40).localeCompare(S(b.at, 40)))
  const last = mine[mine.length - 1]
  return last && MISS_KINDS[last.kind] ? { blocked: true, miss: { kind: last.kind, word: MISS_KINDS[last.kind], at: last.at, by: last.by_name || null } } : { blocked: false, miss: null }
}

/** A member's asks, checked: real dates and shifts, open, far enough ahead, within 4 weeks, not too many waiting. */
export function readAsks(b: Any, x: { rows: Any[]; aid: string; today: string; nowNaive: string; series?: Any[]; offered?: Record<string, boolean> }): { ok: true; slots: { date: string; slot: Slot; weekly: boolean }[] } | { ok: false; error: string } {
  const want = Array.isArray(b?.slots) ? b.slots.slice(0, 40) : []
  if (!want.length) return { ok: false, error: 'Tap the shifts you would like first.' }
  const view = memberSlots({ rows: x.rows, aid: x.aid, today: x.today, nowNaive: x.nowNaive, offered: x.offered })
  const seen = new Set<string>(), out: { date: string; slot: Slot; weekly: boolean }[] = []
  const mineLive = liveSeries(x.series || []).filter((s) => s.applicant_id === x.aid)
  for (const w of want) {
    const d = S(w?.date, 10), sl = S(w?.slot, 12)
    if (!YMD.test(d) || (sl !== 'day' && sl !== 'overnight')) return { ok: false, error: 'One of those shifts could not be read. Please try again.' }
    const k = d + sl; if (seen.has(k)) continue; seen.add(k)
    const v = view.find((r) => r.date === d)?.[sl]
    if (!v) return { ok: false, error: 'You can sign up for the next 4 weeks.' }
    if (v.state !== 'open') return { ok: false, error: v.state === 'closed' ? "One of those shifts isn't open for on-call sign-up. Please look again." : v.state === 'taken' ? 'Someone just took one of those shifts. Please look again.' : v.state === 'past' ? 'One of those shifts starts too soon to sign up for. Call the office instead.' : 'You already have one of those shifts.' }
    const weekly = w?.weekly === true
    if (weekly && mineLive.some((s) => s.slot === sl && weekdayOf(S(s.first_date, 10)) === weekdayOf(d))) return { ok: false, error: `You already have this shift every week, or asked for it (${seriesWord({ first_date: d, slot: sl })}).` }
    if (weekly && out.some((o) => o.weekly && o.slot === sl && weekdayOf(o.date) === weekdayOf(d))) return { ok: false, error: 'Pick each every-week shift once. It repeats on its own.' }
    out.push({ date: d, slot: sl, weekly })
  }
  const waiting = live(x.rows).filter((r) => r.kind === 'asked' && r.applicant_id === x.aid).length
  if (waiting + out.length > MAX_OPEN_ASKS) return { ok: false, error: `You can have up to ${MAX_OPEN_ASKS} shifts waiting for the office at a time.` }
  return { ok: true, slots: out }
}

/* ── EVERY WEEK (W1 to W7, 2026-10-30) ── */
export const WEEKDAY_PL = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']
export const weekdayOf = (ymd: string) => new Date(ymd + 'T12:00:00Z').getUTCDay()
/** "Saturdays, daytime" */
export const seriesWord = (s: Any) => `${WEEKDAY_PL[weekdayOf(S(s?.first_date, 10))] || 'Every week'}, ${S(s?.slot, 10) === 'day' ? 'daytime' : 'overnight'}`
export const liveSeries = (series: Any[]) => series.filter((s) => s && (s.status === 'asked' || s.status === 'confirmed'))
/** The dates an every-week shift falls on, from today for `days` days (never before it started). */
export function seriesDates(s: Any, today: string, days = DAYS_AHEAD): string[] {
  let d = S(s?.first_date, 10); if (!YMD.test(d)) return []
  const end = addDays(today, days - 1), out: string[] = []
  while (d < today) d = addDays(d, 7)
  for (; d <= end; d = addDays(d, 7)) out.push(d)
  return out
}
/** W1/W2: the weeks to add to each confirmed every-week shift, and the weeks someone else holds. A week the series already has a
    row for (even one taken back or given back) is never added again; a week they hold some other way is left as it is. With
    nowNaive, a week that has already started is not added. */
export function fillPlan(x: { series: Any[]; rows: Any[]; today: string; nowNaive?: string; days?: number }): { add: Any[]; skipped: Any[] } {
  const add: Any[] = [], skipped: Any[] = [], rows = x.rows.filter(Boolean)
  for (const s of x.series.filter((s) => s?.status === 'confirmed' && (s.slot === 'day' || s.slot === 'overnight'))) {
    for (const d of seriesDates(s, x.today, x.days)) {
      if (x.nowNaive && slotWindow(d, s.slot)[0] <= x.nowNaive) continue
      if (rows.some((r) => r.series_id != null && Number(r.series_id) === Number(s.id) && S(r.start_date, 10) === d)) continue
      const here = live(rows).filter((r) => r.kind === 'confirmed' && slotsOf(r).some((z) => z.date === d && z.slot === s.slot))
      if (here.some((r) => r.applicant_id === s.applicant_id)) continue
      const k = { series_id: s.id, applicant_id: s.applicant_id, date: d, slot: s.slot as Slot }
      if (here.length) skipped.push({ ...k, held_by: here[0].applicant_id }); else add.push(k)
    }
  }
  return { add, skipped }
}
/** W4: ending an every-week shift takes back its weeks that start at least 24 hours from now; sooner ones stay theirs. */
export function endPlan(x: { seriesId: unknown; rows: Any[]; nowNaive: string }): { cancel: Any[]; kept: Any[] } {
  const mine = live(x.rows).filter((r) => r.kind === 'confirmed' && r.series_id != null && Number(r.series_id) === Number(x.seriesId))
  const late = (r: Any) => Date.parse(slotWindow(S(r.start_date, 10), S(r.shift, 10))[0] + ':00Z') - Date.parse(x.nowNaive + ':00Z') >= GIVE_BACK_HOURS * 3600000
  return { cancel: mine.filter(late), kept: mine.filter((r) => !late(r) && slotWindow(S(r.start_date, 10), S(r.shift, 10))[1] > x.nowNaive) }
}
/** A person's live every-week shifts, for their page, their check-in and the office. */
export const seriesView = (series: Any[], members: Any[] = []) => liveSeries(series).sort((a, b) => weekdayOf(S(a.first_date, 10)) - weekdayOf(S(b.first_date, 10)) || S(a.slot).localeCompare(S(b.slot)))
  .map((s) => ({ id: s.id, applicant_id: s.applicant_id, name: members.length ? nameOf(members, s.applicant_id) : undefined, word: seriesWord(s), slot: s.slot, weekday: weekdayOf(S(s.first_date, 10)),
    status: s.status, since: S(s.first_date, 10), confirmed_by: s.confirmed_by || null }))

/* ── OUR CAREGIVERS (C1 to C7, 2026-10-30) ── */
/** The one key for a person on call: a PRN member's applicant id, or 'ax:<AxisCare id>' for a caregiver. */
export const personKey = (r: Any) => r?.applicant_id ? String(r.applicant_id) : (r?.caregiver_ax ? 'ax:' + String(r.caregiver_ax) : '')
/** The columns a record gets for a person key. */
export const personCols = (key: string): Any => key.startsWith('ax:') ? { applicant_id: null, caregiver_ax: key.slice(3) } : { applicant_id: key, caregiver_ax: null }
export const isCaregiverKey = (key: unknown) => String(key ?? '').startsWith('ax:')
/** Records as the rules read them: applicant_id is the person key, whoever they are. */
export const withKeys = (rows: Any[]) => (rows || []).filter(Boolean).map((r) => ({ ...r, applicant_id: personKey(r) }))
/** C1: AxisCare shows them at Level 3 (the highest level class they hold). */
export const isLevel3 = (classes: unknown) => careLevelOf(classes).level === 3
export const INVITE_DEFAULT = "Hi {first_name}! We're inviting a few of our caregivers to sign up for on-call shifts. On call means keeping your phone close during a daytime (7am to 7pm) or overnight (7pm to 7am) shift, so if a caregiver can't make it, we call you first. You're paid for each on-call shift, plus your pay for any shift you cover. Read more and sign up here: {link}"
/** C4: the invite with their first name and link. The link always goes in, even if {link} was edited out. */
export function inviteText(tmpl: unknown, first: string, link: string): string {
  const t = S(tmpl, 1000) || INVITE_DEFAULT
  const out = t.replace(/\{first_name\}/g, first || 'there').replace(/\{link\}/g, link)
  return out.includes(link) ? out : out.replace(/\s*$/, ' ') + link
}
/** C6: the Invite caregivers list. Active Level 3 caregivers from AxisCare, never someone on the PRN CNA Team (their PRN Team
    page has on call), each with their status: invited when, signed, has on-call shifts, can't sign up after a miss. */
export function inviteList(x: { census: Any[]; prnAx: string[]; invites: Any[]; terms: Any[]; rows: Any[]; marks: Any[]; version: string; today: string }): Any[] {
  const out: Any[] = []
  for (const g of x.census) {
    const ax = S(g?.id, 12)
    if (!ax || g?.active !== true || !isLevel3(g?.classes) || x.prnAx.includes(ax)) continue
    const key = 'ax:' + ax, inv = x.invites.filter((i) => S(i?.caregiver_ax, 12) === ax).sort((a, b) => S(a.at, 40).localeCompare(S(b.at, 40))).pop() || null
    const sigs = x.terms.filter((t) => personKey(t) === key), mine = withKeys(x.rows).filter((r) => r.applicant_id === key && !r.cancelled_at && r.kind === 'confirmed' && S(r.end_date, 10) >= x.today)
    out.push({ caregiver_ax: ax, key, name: [S(g.first), S(g.last)].filter(Boolean).join(' ') || 'A caregiver', first: S(g.goes_by) || S(g.first), has_phone: !!S(g.phone),
      invited_at: inv?.at || null, invited_via: inv?.via || null, invited_by: inv?.by_name || null,
      signed: sigs.some((t) => t.version === x.version), signed_old: sigs.length > 0 && !sigs.some((t) => t.version === x.version),
      upcoming: mine.length, blocked: blockOf(withKeys(x.marks), key).blocked })
  }
  return out.sort((a, b) => Number(!!a.invited_at) - Number(!!b.invited_at) || a.name.localeCompare(b.name))
}

/* ── decision 26: on call when a shift opens ── */
/* 2026-10-31 (Samantha: "when there is a call in we need to send it to the on-call person if there is on-call signed up for that
   day"; her picks the same day: text them at once and the office calls; at 15 minutes with no answer the Hub asks the office to
   record it with one tap; saying no is a miss; then caregivers who know the client, the PRN teams by care level, everyone else).
   A shift is theirs when any part of it falls in their on-call time (it used to be only when it started then). */
/** The start of a coverage case's shift ('YYYY-MM-DDTHH:MM'), or null. */
export function caseStart(c: Any): string | null {
  const d = S(c?.shift_date, 10), t = S(c?.shift_time, 20).split('-')[0]
  return YMD.test(d) && /^\d\d:\d\d$/.test(t) ? `${d}T${t}` : null
}
/** The whole shift as [start, end) ('YYYY-MM-DDTHH:MM'); an end at or before the start is the next morning; no end = 1 hour. */
export function caseWindow(c: Any): [string, string] | null {
  const st = caseStart(c); if (!st) return null
  const e = S(c?.shift_time, 20).split('-')[1] || ''
  if (!/^\d\d:\d\d$/.test(e)) { const h = Number(st.slice(11, 13)) + 1; return [st, h >= 24 ? `${addDays(st.slice(0, 10), 1)}T00:00` : `${st.slice(0, 11)}${String(h).padStart(2, '0')}${st.slice(13)}`] }
  const end = e <= st.slice(11) ? `${addDays(st.slice(0, 10), 1)}T${e}` : `${st.slice(0, 10)}T${e}`
  return [st, end]
}
const nameKey = (n: unknown) => S(n, 80).toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()
/** The person who called off, however the case was opened: by AxisCare id (calling_off_id or calling_off_axiscare_id) or name. */
export function isCaller(c: Any, m: Any): boolean {
  const ids = [S(c?.calling_off_id, 20), S(c?.calling_off_axiscare_id, 20)].filter(Boolean)
  if (m?.axiscare_id && ids.includes(String(m.axiscare_id))) return true
  const off = nameKey(c?.calling_off)
  return !!off && !!nameKey(m?.name) && off === nameKey(m.name)
}
/** Who is on call for this shift: the confirmed, live, not-missed row whose on-call time covers any part of it. The person who
    called off is never their own cover. */
export function onCallNow(x: { c: Any; rows: Any[]; marks: Any[]; members: Any[] }): Any | null {
  const w = caseWindow(x.c); if (!w) return null
  for (const r of live(x.rows).filter((r) => r.kind === 'confirmed').sort((a, b) => Number(a.id) - Number(b.id))) {
    if (missOf(x.marks, r.id)) continue
    const m = x.members.find((mm) => mm.applicant_id === r.applicant_id && (mm.team === 'cna' || mm.team === 'oncall')); if (!m) continue   // C1: Level 3 caregivers too
    if (isCaller(x.c, m)) continue
    const hit = slotsOf(r).find((s) => { const [a, b] = slotWindow(s.date, s.slot); return w[0] < b && w[1] > a })
    if (hit) return { oncall_id: r.id, applicant_id: r.applicant_id, name: m.name, first: m.first || S(m.name).split(' ')[0], axiscare_id: m.axiscare_id || null, date: hit.date, slot: hit.slot, slot_word: SLOT_WORD[hit.slot] }
  }
  return null
}
/** The outcome the office recorded for this case's on-call call, if any. */
export const outcomeFor = (marks: Any[], caseId: string) => marks.filter((m) => m && caseId && S(m.case_id, 80) === caseId && OUTCOMES[m.kind]).sort((a, b) => S(a.at, 40).localeCompare(S(b.at, 40))).pop() || null
/** The ask the on-call text put on the case (coverage-run oncallDispatch), and how they answered it: 'yes', 'no' or null. */
export function oncallAskOf(c: Any, oncallId: unknown): Any | null {
  return (Array.isArray(c?.asked) ? c.asked : []).find((a: Any) => a && a.from_oncall === true && String(a.oncall_id ?? '') === String(oncallId ?? '')) || null
}
export const askAnswer = (a: Any): 'yes' | 'no' | null => !a ? null : a.state === 'yes' ? 'yes' : (a.state === 'no' || a.state === 'declined') ? 'no' : null
/** When the 15 minutes start: when they were texted; else when the case was confirmed open (a flagged text or call becomes
    open later than it was first seen); else when it opened. */
export function holdStart(c: Any): number | null {
  for (const k of [c?.oncall_dispatch?.texted_at, c?.oncall_dispatch?.at, c?.flag_confirmed_at, c?.opened_at]) { const t = Date.parse(S(k, 40)); if (Number.isFinite(t)) return t }
  return null
}
/** Hold the automatic texts while the on-call person is reached: until how it went is recorded (or they answered the text), at
    most HOLD_MIN minutes. Someone AxisCare has working then was never texted: no hold. */
export function holdFor(x: { c: Any; now: Any | null; marks: Any[]; nowMs: number }): { hold: boolean; until: string | null } {
  if (!x.now || outcomeFor(x.marks, S(x.c?.id, 80))) return { hold: false, until: null }
  if (x.c?.oncall_dispatch?.skipped) return { hold: false, until: null }
  if (askAnswer(oncallAskOf(x.c, x.now.oncall_id))) return { hold: false, until: null }
  const from = holdStart(x.c); if (from == null) return { hold: false, until: null }
  const until = from + HOLD_MIN * 60000
  return until > x.nowMs ? { hold: true, until: new Date(until).toISOString() } : { hold: false, until: null }
}
/** The 15-minute question for the office: texted (or the case opened), nothing recorded, no answer to the text, time is up. */
export function noAnswerDue(x: { c: Any; now: Any | null; marks: Any[]; nowMs: number }): boolean {
  if (!x.now || outcomeFor(x.marks, S(x.c?.id, 80)) || x.c?.oncall_dispatch?.skipped) return false
  if (askAnswer(oncallAskOf(x.c, x.now.oncall_id))) return false
  const from = holdStart(x.c); return from != null && x.nowMs >= from + HOLD_MIN * 60000
}
/* the text to the on-call person (her pick 2026-10-31; ops_settings.prn_oncall_text_msg to change it) */
export const ONCALL_TEXT_DEFAULT = "Hi {first_name}, it's Caring Companions. You're on call, and {client} in {town} needs someone {when}. Please call the office now at (417) 234-8494, or reply YES if you can cover it."
export function oncallText(tmpl: unknown, x: { first: string; client: string; town: string; when: string }): string {
  return (S(tmpl, 700) || ONCALL_TEXT_DEFAULT).replace(/\{first_name\}/g, x.first || 'there').replace(/\{client\}/g, x.client || 'a client')
    .replace(/ in \{town\}/g, x.town ? ` in ${x.town}` : '').replace(/\{town\}/g, x.town || '').replace(/\{when\}/g, x.when || 'today').replace(/\s{2,}/g, ' ').trim()
}
/* the admins' text at 15 minutes */
export function noAnswerText(x: { name: string; client: string; when: string }): string {
  return `${x.name} (on call) hasn't answered about ${x.client || 'the open shift'} ${x.when} in 15 minutes. Record it with one tap, then ask the PRN teams: {link}`.replace(/\s{2,}/g, ' ')
}
/** What a miss takes back: their other live confirmed shifts and asks from today on (never the missed one itself). */
export function takeBackOnMiss(rows: Any[], aid: string, missedId: unknown, today: string): Any[] {
  return live(rows).filter((r) => r.applicant_id === aid && Number(r.id) !== Number(missedId) && (r.kind === 'confirmed' || r.kind === 'asked') && S(r.end_date, 10) >= today)
}
/** The Yes a "Covering it" puts on the case, so the board shows it and the office confirms it the usual way. */
export function onCallAsk(x: { id: string; name: string; phone: string | null; ax: string | null; key: string; now: string; by: string }): Any {
  return { id: x.id, name: S(x.name, 80), phone: x.phone || null, channel: 'phone', at: x.now, state: 'yes', replied_at: x.now, answered_at: x.now,
    reply: 'On call: said yes on the phone', answer_channel: 'phone', answer_kind: 'on_call', read_by: S(x.by, 80) || 'the office', from_oncall: true, prn: true,
    auto: false, picked_by_coordinator: true, tier: 0.5, ghl_contact_id: null, axiscare_id: x.ax || null, offered_for: x.key, answered_for: x.key }
}

/* ── payroll (counts only, never dollars) ── */
/** Each member's on-call shifts in a month: daytime, overnight, whole days (both on one date), older rows with no shift, and
    missed ones (not paid). Taken-back shifts don't count. */
export function payMonth(rows: Any[], marks: Any[], members: Any[], month: string): Any[] {
  const per = new Map<string, Map<string, { day: boolean; overnight: boolean; legacy: boolean; missed: number }>>()
  for (const r of live(rows).filter((r) => r.kind === 'confirmed')) {
    const missed = !!missOf(marks, r.id), legacy = !S(r.shift, 10)
    for (const s of slotsOf(r)) {
      if (s.date.slice(0, 7) !== month) continue
      const dm = per.get(r.applicant_id) || new Map(); per.set(r.applicant_id, dm)
      const cur = dm.get(s.date) || { day: false, overnight: false, legacy: false, missed: 0 }; dm.set(s.date, cur)
      if (missed) { if (!legacy || s.slot === 'day') cur.missed++ ; continue }
      if (legacy) cur.legacy = true; else cur[s.slot] = true
    }
  }
  const out: Any[] = []
  for (const [aid, dm] of per) {
    const t = { applicant_id: aid, name: nameOf(members, aid), day: 0, overnight: 0, whole: 0, not_recorded: 0, missed: 0 }
    for (const v of dm.values()) {
      t.missed += v.missed
      if (v.legacy) t.not_recorded++
      else if (v.day && v.overnight) t.whole++
      else if (v.day) t.day++
      else if (v.overnight) t.overnight++
    }
    out.push(t)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}
