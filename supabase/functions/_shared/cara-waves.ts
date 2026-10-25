// =============================================================================
// WHO CARA'S WAVES ASK, AND IN WHAT ORDER (Samantha, 2026-10-24, approved rules page FRN4VgsLTUU9CeHN7e3RVq)
// =============================================================================
// "Let Cara run it" used to text everyone the send gate allowed, in the coordinator list's group order, so people the
// coordinator screen leaves unticked (PRN members who don't fit, people already working then, outside their availability)
// could still be texted, and a PRN member who didn't fit came before caregivers who know the client. Her rules:
//   1. HARD EXCLUSIONS never reach a wave (the coordinator screen still lists them, with the reason): already scheduled at
//      an overlapping time; a yes standing on another open shift then; none of the shift inside their availability (unless
//      they asked to hear about those); over 40 hours this week with this shift (decision 1); PRN Team outside their days
//      and times, short of the notice they asked for, or a regular ongoing opening. The upstream list already cuts the
//      rest (Do-Not-Return, call-in plan, clearances, level, skills, driving, inactive, already asked, the caller).
//   2. PRN NOTICE IS RESPECTED (her decision 2): less notice than they asked for = not asked, unless they gave a separate
//      short-notice yes (prn.short_notice_ok). Ticking "Call-offs and same-day" while asking for 24 or 48 hours' notice is a
//      conflict to clarify with them, never silently overridden: they are left out and the reason says so.
//   3. AVAILABILITY COVERS THE WHOLE SHIFT, not just its start: every part of the day the shift touches (morning 6-12,
//      daytime 12-5, evening 5-10, overnight 10-6) is checked. All of them = whole shift; some = part of it; none = left
//      out; nothing on file = Unknown (her 10-17 rule: never counted as available, still asked after stated fits).
//   4. THE ORDER (each step only breaks a tie left by the one before): covers the whole shift, then Unknown, then part of
//      it; knows this client (the client's favorite, then most visits, then most recent); PRN Team members who fit (a
//      shift type they picked first); room in the week (not near 40 hours or past what they want); travel (a schedule
//      that chains, then distance); a new hire who needs hours; rated well by other clients; recently active; wants more
//      hours. A familiar caregiver who is free always comes before a PRN member who has never met the client.
//   4b. SAME TIME OF DAY (her ask 2026-10-24, Dan's overnight): among caregivers who know the client, those who have worked
//      this client at the same time of day (overnight, mornings, daytime, evenings) come first. Switch
//      ops_settings.cara_same_time_live (off): no change.
//   5. URGENT SAME-DAY PARTS: a shift starting within a day, when the whole-shift people left can't fill the waves left,
//      saves up to 2 places in each wave for people who can do part of it, instead of waiting through every wave.
// Only decisions here (no reads or writes), so every rule is tested. Switch ops_settings.cara_wave_rules_live (off): the
// waves work as before and each wave records who these rules would have asked instead.
// =============================================================================
// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n)

export const BAND_KEYS = ['morning', 'afternoon', 'evening', 'overnight'] as const
const BAND_WORDS: Record<string, string> = { morning: 'mornings', afternoon: 'daytime', evening: 'evenings', overnight: 'overnights' }
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const DAY_WORDS: Record<string, string> = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' }
const hm = (t: string) => { const m = /^(\d\d):(\d\d)/.exec(t); return m ? Number(m[1]) * 60 + Number(m[2]) : null }

/** The shift as minutes from midnight of its date ([start, end], an overnight end wraps), or null. */
export function spanOf(c: Any): [number, number] | null {
  const m = /^(\d\d:\d\d)-(\d\d:\d\d)$/.exec(S(c?.shift_time, 20))
  if (!m || !/^\d{4}-\d\d-\d\d$/.test(S(c?.shift_date))) return null
  const s = hm(m[1])!, e0 = hm(m[2])!
  return [s, e0 <= s ? e0 + 1440 : e0]
}

/** Every [weekday, part of day] the shift spends time in, in order. Overnight belongs to the evening it starts. */
export function slotsOf(c: Any): { day: string; band: string }[] {
  const sp = spanOf(c); if (!sp) return []
  const wd0 = new Date(S(c.shift_date) + 'T12:00:00Z').getUTCDay()
  const out: { day: string; band: string }[] = []
  for (const d of [-1, 0, 1]) {
    const b = d * 1440, day = DAYS[(wd0 + d + 7) % 7]
    const parts: [string, number, number][] = [['morning', b + 360, b + 720], ['afternoon', b + 720, b + 1020], ['evening', b + 1020, b + 1320], ['overnight', b + 1320, b + 1800]]
    for (const [band, a, z] of parts) if (sp[0] < z && a < sp[1]) out.push({ day, band })
  }
  return out
}

/** The parts of the day a visit from start to end (HH:MM, an end at or before the start wraps past midnight) spends time in. */
export function bandsOfTimes(start: string, end: string): string[] {
  const a = hm(S(start, 5)), z0 = hm(S(end, 5)); if (a == null || z0 == null) return []
  const z = z0 <= a ? z0 + 1440 : z0, out = new Set<string>()
  for (const d of [-1, 0, 1]) {
    const b = d * 1440
    const parts: [string, number, number][] = [['morning', b + 360, b + 720], ['afternoon', b + 720, b + 1020], ['evening', b + 1020, b + 1320], ['overnight', b + 1320, b + 1800]]
    for (const [band, x, y] of parts) if (a < y && x < z) out.add(band)
  }
  return BAND_KEYS.filter((k) => out.has(k))
}
/** The case's parts of the day (from its shift time), or [] with no time. */
export function caseBands(c: Any): string[] { const m = /^(\d\d:\d\d)-(\d\d:\d\d)$/.exec(S(c?.shift_time, 20)); return m ? bandsOfTimes(m[1], m[2]) : [] }
/** A visit counts as "the same time of day" when it shares the case's main part of the day: overnight when the case touches
    the overnight, otherwise any part they share. */
export function sameTimeOfDay(caseB: string[], visitB: string[]): boolean {
  if (!caseB.length || !visitB.length) return false
  if (caseB.includes('overnight')) return visitB.includes('overnight')
  return visitB.some((b) => caseB.includes(b))
}

export type ShiftAvail = { state: 'full' | 'partial' | 'none' | 'unknown' | 'no_shift'; outside_ok: boolean; missing: string[]; why: string | null }
/** Their stated availability against the WHOLE shift. windows: { mon: ['morning', ...] } (the availability page's keys). */
export function shiftAvail(c: Any, windows: Record<string, string[]> | null | undefined, outsideOk = false): ShiftAvail {
  const slots = slotsOf(c)
  if (!slots.length) return { state: 'no_shift', outside_ok: outsideOk, missing: [], why: null }
  const w = windows || {}
  if (!Object.values(w).some((v) => Array.isArray(v) && v.length)) return { state: 'unknown', outside_ok: outsideOk, missing: [], why: 'no availability on file (Unknown)' }
  const ok = (s: { day: string; band: string }) => Array.isArray(w[s.day]) && w[s.day].includes(s.band)
  const miss = slots.filter((s) => !ok(s)).map((s) => `${DAY_WORDS[s.day]} ${BAND_WORDS[s.band]}`)
  if (!miss.length) return { state: 'full', outside_ok: outsideOk, missing: [], why: null }
  if (miss.length < slots.length) return { state: 'partial', outside_ok: outsideOk, missing: miss, why: `available for part of it (not ${miss.join(', ')})` }
  return { state: 'none', outside_ok: outsideOk, missing: miss, why: `outside their availability (not ${miss.join(', ')})` }
}

/** PRN windows: the availability page when they filled it in, else the days and times on their PRN application. */
export function prnWindows(avail: Record<string, string[]> | null | undefined, prn: Any): Record<string, string[]> | null {
  if (avail && Object.values(avail).some((v) => Array.isArray(v) && v.length)) return avail
  const days: string[] = Array.isArray(prn?.days) ? prn.days : [], times: string[] = Array.isArray(prn?.times) ? prn.times : []
  if (!days.length || !times.length) return null
  const bands = times.map((t) => (t === 'daytime' ? 'afternoon' : t)).filter((t) => (BAND_KEYS as readonly string[]).includes(t))
  return Object.fromEntries(days.map((d) => [S(d).toLowerCase().slice(0, 3), bands]))
}

export const NOTICE_H: Record<string, number> = { same_day: 0, few_hours: 3, '24h': 24, '48h': 48 }
const NOTICE_WORDS: Record<string, string> = { few_hours: 'a few hours', '24h': '24 hours', '48h': '48 hours' }

/** The shift types a PRN member can pick ("Interested in"), as this shift matches them. */
export function shiftTypes(c: Any, minsToStart: number | null): string[] {
  const sp = spanOf(c); if (!sp) return []
  const out: string[] = [], len = (sp[1] - sp[0]) / 60, slots = slotsOf(c)
  if (minsToStart != null && minsToStart <= 1440) out.push('calloffs')
  if (slots.some((s) => s.band === 'evening')) out.push('evenings')
  if (slots.some((s) => s.band === 'overnight')) out.push('overnights')
  const wd = new Date(S(c.shift_date) + 'T12:00:00Z').getUTCDay(); if (wd === 0 || wd === 6) out.push('weekends')
  if (len <= 4) out.push('short'); if (len >= 8) out.push('long')
  return out
}

/** A PRN member and this shift: may Cara ask them, and why not. */
export function prnRule(c: Any, p: Any, minsToStart: number | null, ongoing: boolean): { ok: boolean; why: string | null; conflict: string | null } {
  if (ongoing) return { ok: false, why: 'PRN Team: a regular ongoing opening (taking it means moving to ongoing; the office asks)', conflict: null }
  const need = NOTICE_H[S(p?.notice)] ?? 0
  const picks: string[] = Array.isArray(p?.interests) ? p.interests : []
  const conflict = need > 0 && picks.includes('calloffs') && p?.short_notice_ok !== true
    ? `PRN preference to clarify: picked "Call-offs and same-day" but asked for ${NOTICE_WORDS[S(p.notice)]}' notice` : null
  if (need > 0 && p?.short_notice_ok !== true && minsToStart != null && minsToStart < need * 60)
    return { ok: false, why: conflict || `PRN Team: asked for ${NOTICE_WORDS[S(p.notice)]}' notice`, conflict }
  return { ok: true, why: null, conflict }
}

export type Judged = { row: Any; avail: ShiftAvail; prn: boolean; prn_match: boolean; familiar: number; note: string | null }
export type Out = { name: string; axiscare_id: string | null; why: string }

/** Hard exclusions and the order, for one case. rows: the list's people (any group); each may carry windows/outside_ok
    (their availability) and prn_pref (PRN Team: notice, interests, days, times, short_notice_ok). */
export function judgeForWaves(rows: Any[], c: Any, x: { minsToStart: number | null; ongoing: boolean; sameTime?: boolean }): { ordered: Judged[]; excluded: Out[]; conflicts: Out[] } {
  const ordered: Judged[] = [], excluded: Out[] = [], conflicts: Out[] = []
  const types = shiftTypes(c, x.minsToStart)
  const out = (r: Any, why: string) => excluded.push({ name: S(r?.name, 80), axiscare_id: r?.axiscare_id != null ? S(r.axiscare_id, 20) : null, why })
  for (const r of rows) {
    if (!r || !r.name) continue
    if (r.needs_verification) { out(r, S(r.needs_verification)); continue }
    if (r.working_then) { out(r, `already scheduled in AxisCare then (${S(r.working_then.detail, 160)})`); continue }
    if (Array.isArray(r.overlaps) && r.overlaps.length) { out(r, S(r.overlaps[0], 160)); continue }
    if (r.hours?.level === 'ot') { out(r, S(r.hours.text) || 'this shift would take them over 40 hours this week'); continue }
    const isPrn = !!r.prn_pref
    const av = shiftAvail(c, isPrn ? prnWindows(r.windows, r.prn_pref) : r.windows, r.outside_ok === true)
    if (av.state === 'none' && !av.outside_ok) { out(r, (isPrn ? 'PRN Team: ' : '') + av.why); continue }
    let prnMatch = false
    if (isPrn) {
      const pr = prnRule(c, r.prn_pref, x.minsToStart, x.ongoing)
      if (pr.conflict) conflicts.push({ name: S(r.name, 80), axiscare_id: r.axiscare_id != null ? S(r.axiscare_id, 20) : null, why: pr.conflict })
      if (!pr.ok) { out(r, pr.why || 'PRN Team: not for this shift'); continue }
      const picks: string[] = Array.isArray(r.prn_pref.interests) ? r.prn_pref.interests : []
      prnMatch = picks.some((p) => types.includes(p))
    }
    const visits = Number(r.history?.visits) || 0
    const same = x.sameTime ? (Number(r.history?.same_time) || 0) : 0
    /* her ask (2026-10-24): same time of day first, then the client's favorite, then visits at that time, then all visits */
    const familiar = (same > 0 ? 1e12 : 0) + (r.this_client?.favorite ? 1e9 : 0) + same * 1e5 + visits * 10
    ordered.push({ row: r, avail: av, prn: isPrn, prn_match: prnMatch, familiar,
      note: av.state === 'none' ? av.why + ', said OK to texts about those' : av.state === 'partial' ? av.why : av.state === 'unknown' ? av.why : null })
  }
  const availRank = (j: Judged) => j.avail.state === 'full' || j.avail.state === 'no_shift' || (j.avail.state === 'none' && j.avail.outside_ok) ? 0 : j.avail.state === 'unknown' ? 1 : 2
  const lastVisit = (j: Judged) => S(j.row.history?.last)
  const roomRank = (j: Judged) => (j.row.hours?.level === 'near' || j.row.hours?.level === 'over_target') ? 1 : 0
  const miles = (j: Judged) => (typeof j.row.miles === 'number' ? j.row.miles : 9999)
  ordered.sort((a, b) => (availRank(a) - availRank(b))
    || (b.familiar - a.familiar) || lastVisit(b).localeCompare(lastVisit(a))
    || ((a.prn ? (a.prn_match ? 0 : 1) : 2) - (b.prn ? (b.prn_match ? 0 : 1) : 2))
    || (roomRank(a) - roomRank(b))
    || ((b.row.chain ? 1 : 0) - (a.row.chain ? 1 : 0)) || (miles(a) - miles(b))
    || ((b.row.new_hire ? 1 : 0) - (a.row.new_hire ? 1 : 0))
    || ((b.row.rep?.favorites ?? 0) - (a.row.rep?.favorites ?? 0))
    || (Number(!!b.row.recently_active) - Number(!!a.row.recently_active))
    || ((b.row.wants_more_hours ?? -999) - (a.row.wants_more_hours ?? -999)))
  return { ordered, excluded, conflicts }
}

const nk = (n: unknown) => S(n, 80).toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()
const last10 = (p: unknown) => String(p ?? '').replace(/\D/g, '').slice(-10)

/** The next wave. Whole-shift and Unknown people first; an URGENT same-day shift whose whole-shift people left can't fill
    the waves left keeps up to `partSlots` places for people who can do part of it. */
export function pickWaveV2(ordered: Judged[], asked: Any[], o: { size: number; wavesLeft: number; urgent: boolean; partSlots?: number }): Judged[] {
  const names = new Set(asked.map((a) => nk(a?.name)).filter(Boolean))
  const phones = new Set(asked.map((a) => last10(a?.phone)).filter((p) => p.length === 10))
  const ax = new Set(asked.map((a) => S(a?.axiscare_id, 40)).filter(Boolean))
  const seen = new Set<string>()
  const left = ordered.filter((j) => {
    const r = j.row, k = nk(r.name)
    if (!k || seen.has(k) || names.has(k) || (S(r.axiscare_id, 40) && ax.has(S(r.axiscare_id, 40))) || (last10(r.phone).length === 10 && phones.has(last10(r.phone)))) return false
    seen.add(k); return true
  })
  const whole = left.filter((j) => j.avail.state !== 'partial'), part = left.filter((j) => j.avail.state === 'partial')
  const size = Math.max(1, o.size)
  let nPart = 0
  if (o.urgent && whole.length < size * Math.max(1, o.wavesLeft)) nPart = Math.min(part.length, Math.max(0, o.partSlots ?? 2))
  const w = whole.slice(0, size - nPart)
  const p = part.slice(0, size - w.length)
  return [...w, ...p]
}
