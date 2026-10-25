// CARA PHASE 2 PART A · "LET CARA RUN IT" (her approval 2026-10-24, plan HfjPEyR52KgAEtpcNFD99A)
// -----------------------------------------------------------------------------
// A coordinator hands ONE case to Cara. Cara asks in waves (5 people, 20 minutes apart, 10 on a shift starting within a
// day, 3 waves at most), using the same list, gates and wording as the coordinator's own send. Her adjustments:
//   · the first full-shift YES from an eligible caregiver PAUSES Cara and tells the office; the case stays open until the
//     office confirms (the same confirm as today: AxisCare assign and read-back)
//   · the office says "Not this one", or nobody answers in time: Cara resumes under the same rules, never drops the case
//   · part-shift offers stay on the board, and two that fit together are shown as a possible combination
//   · one run per case (cara_run.case_id is the key); every write checks the version it read, so two writers can't both win
//   · never a duplicate text: a wave is claimed (wave number written) BEFORE its texts go, and each ask is recorded under the
//     case lock before its text (coverage_case_add_ask refuses a person already asked)
// This file is only the decisions, no reads or writes, so every rule can be tested.
// Part B (after-hours Critical call-offs starting by themselves) is NOT here: separate, later, her approval only.
// -----------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n)

export type RunStatus = 'running' | 'paused' | 'needs_office' | 'stopped' | 'done'
export const LIVE_STATES: RunStatus[] = ['running', 'paused']

export type Rules = { size: number; gap: number; maxWaves: number; confirmWait: number; stopBefore: number; urgent: boolean }

/** The run's rules, from ops_settings (her recommended numbers are the defaults). Same-day = the shift starts within a day. */
export function runRules(st: Any, minsToStart: number | null): Rules {
  const n = (k: string, d: number, lo: number, hi: number) => { const v = Number(st?.[k]); return Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : d }
  const soon = minsToStart != null && minsToStart <= 24 * 60
  /* THE LAST 2 HOURS (Samantha 2026-10-24: "DO NOT STOP with 2 hours, that's when we need messages and calls going out the
     most!!"): Cara no longer hands the shift back at 2 hours. Inside them she asks faster and wider (10 a wave, 5 minutes
     apart), with no 3-wave limit, until someone says yes, the list runs out or the shift ends; the office is told once. */
  const urgentBefore = n('cara_run_stop_before_min', 120, 30, 360)
  const urgent = minsToStart != null && minsToStart < urgentBefore
  const gap = urgent ? n('cara_run_gap_urgent_min', 5, 3, 30) : soon ? n('cara_run_gap_sameday_min', 10, 5, 60) : n('cara_run_gap_min', 20, 5, 120)
  return { size: urgent ? n('cara_run_wave_size_urgent', 10, 1, 25) : n('cara_run_wave_size', 5, 1, 10), gap, maxWaves: n('cara_run_max_waves', 3, 1, 5),
    confirmWait: n('cara_run_confirm_wait_min', gap, 5, 120), stopBefore: urgentBefore, urgent }
}

export type Ctx = {
  now: Date
  caseOpen: boolean
  /** minutes until the shift ENDS (null = unknown): Cara keeps asking until then */
  minsToEnd?: number | null
  minsToStart: number | null
  /** eligible full-shift yeses on the board right now (board can_confirm), oldest answer first */
  fullYes: { ask_id: string; name: string }[]
  night: boolean
  rules: Rules
}
export type Step =
  | { do: 'wait'; why: string }
  | { do: 'finish' }
  | { do: 'pause'; ask_id: string; name: string }
  | { do: 'resume'; why: string; escalate: boolean }
  | { do: 'needs_office'; why: string }
  | { do: 'hold_night' }
  | { do: 'wave'; n: number }
  | { do: 'urgent' }

const declinedIds = (run: Any) => new Set((Array.isArray(run?.declined) ? run.declined : []).map((d: Any) => S(d?.ask_id, 80)))
const seenIds = (run: Any) => new Set((Array.isArray(run?.seen_yes) ? run.seen_yes : []).map((x: unknown) => S(x, 80)))

/** What Cara does next for one run. Called every 3 minutes by coverage-run, under the run's lease. */
export function nextStep(run: Any, x: Ctx): Step {
  if (!x.caseOpen) return { do: 'finish' }
  const status = S(run?.status) as RunStatus
  const declined = declinedIds(run)
  const yes = x.fullYes.filter((y) => !declined.has(y.ask_id))
  if (status === 'paused') {
    if (!yes.some((y) => y.ask_id === S(run.paused_ask_id, 80)))
      return { do: 'resume', why: `${S(run.paused_name, 80) || 'The caregiver'} is no longer a full-shift yes that can be confirmed`, escalate: false }
    const by = Date.parse(S(run.confirm_by, 40))
    if (Number.isFinite(by) && x.now.getTime() >= by)
      return { do: 'resume', why: `No office answer about ${S(run.paused_name, 80) || 'the yes'} in ${x.rules.confirmWait} minutes`, escalate: true }
    return { do: 'wait', why: 'waiting for the office to confirm' }
  }
  if (status !== 'running') return { do: 'wait', why: `run is ${status || 'unknown'}` }
  /* a yes Cara already paused for once (and the office let the wait run out) doesn't pause her again; it stays on the board */
  const seen = seenIds(run)
  const fresh = yes.find((y) => !seen.has(y.ask_id))
  if (fresh) return { do: 'pause', ask_id: fresh.ask_id, name: fresh.name }
  if (x.minsToEnd != null && x.minsToEnd <= 0) return { do: 'needs_office', why: 'The shift has ended: handed to the office' }
  const urgent = x.minsToStart != null && x.minsToStart < x.rules.stopBefore
  /* the last 2 hours: the office is told once, then Cara keeps going (never handed back for the time alone) */
  if (urgent && !run.urgent_at) return { do: 'urgent' }
  const due = Date.parse(S(run.next_wave_at, 40))
  if (Number.isFinite(due) && x.now.getTime() < due) return { do: 'wait', why: 'next wave not due yet' }
  /* waves since this start ("Keep searching" after 3 waves gives 3 more; the numbering carries on); in the last 2 hours
     there is no wave limit: she keeps asking until the list runs out */
  const waves = Number(run.wave) || 0, since = waves - (Number(run.wave_base) || 0)
  if (!urgent && since >= x.rules.maxWaves) return { do: 'needs_office', why: `${since} wave${since === 1 ? '' : 's'} sent and no full-shift yes that can be confirmed` }
  if (x.night) return { do: 'hold_night' }
  return { do: 'wave', n: waves + 1 }
}

const nk = (n: unknown) => S(n, 80).toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()
const last10 = (p: unknown) => String(p ?? '').replace(/\D/g, '').slice(-10)

/** The next wave: in list order, people this case has not asked (by name, phone or AxisCare id), at most `size`. */
export function pickWave(ordered: Any[], asked: Any[], size: number): Any[] {
  const names = new Set(asked.map((a) => nk(a?.name)).filter(Boolean))
  const phones = new Set(asked.map((a) => last10(a?.phone)).filter((p) => p.length === 10))
  const ax = new Set(asked.map((a) => S(a?.axiscare_id, 40)).filter(Boolean))
  const out: Any[] = []
  for (const r of ordered) {
    if (out.length >= size) break
    if (names.has(nk(r?.name)) || (S(r?.axiscare_id, 40) && ax.has(S(r.axiscare_id, 40))) || (last10(r?.phone).length === 10 && phones.has(last10(r.phone)))) continue
    if (out.some((o) => nk(o.name) === nk(r.name))) continue
    out.push(r)
  }
  return out
}

/** Cara's list order (the better list when it's on), keeping only people the send gate allows. */
export function waveOrder(sendable: Any[], preferred: Any[] | null): Any[] {
  if (!preferred || !preferred.length) return sendable
  const idx = new Map<string, number>(); preferred.forEach((r, i) => { const k = nk(r?.name); if (k && !idx.has(k)) idx.set(k, i) })
  return sendable.filter((x) => idx.has(nk(x.name))).sort((a, b) => (idx.get(nk(a.name)) ?? 0) - (idx.get(nk(b.name)) ?? 0))
}

const mins = (t: unknown) => { const m = /^(\d{1,2}):(\d\d)/.exec(S(t, 8)); return m ? Number(m[1]) * 60 + Number(m[2]) : null }
const clock12 = (t: unknown) => { const v = mins(t); if (v == null) return S(t, 8); const h24 = Math.floor(v / 60) % 24, m = v % 60
  return `${h24 % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}${h24 >= 12 ? 'pm' : 'am'}` }

/** PART-SHIFT OFFERS THAT FIT TOGETHER (her example: 8a to 1p + 1p to 5p). From the board's people: eligible part-shift yeses
    with hours. Two fit when the first starts by the shift's start, the second ends by its end, and there's no gap between them.
    Shown for the office to consider; nothing is offered or confirmed from here. hand-off allowed or not comes from the case. */
export function combosOf(kase: Any, people: Any[]): Any[] {
  const m = /^(\d\d:\d\d)-(\d\d:\d\d)$/.exec(S(kase?.shift_time, 20)); if (!m) return []
  const start = mins(m[1])!, end0 = mins(m[2])!; const end = end0 <= start ? end0 + 1440 : end0
  const span = (p: Any) => { const f = mins(p.offer_from), t0 = mins(p.offer_to); if (f == null || t0 == null) return null
    let a = f, b = t0; if (a < start - 720) a += 1440; if (b <= a) b += 1440; return { a, b } }
  const parts = people.filter((p) => p && p.column === 'partial' && p.answer_kind === 'part' && p.eligibility?.ok && !p.stale)
    .map((p) => ({ p, s: span(p) })).filter((x) => x.s) as { p: Any; s: { a: number; b: number } }[]
  const out: Any[] = []
  for (const x of parts) for (const y of parts) {
    if (x === y || nk(x.p.name) === nk(y.p.name)) continue
    if (x.s.a <= start && y.s.b >= end && y.s.a <= x.s.b && x.s.b < end) {
      const at = Math.max(y.s.a, Math.min(x.s.b, y.s.b))
      out.push({ first: { ask_id: x.p.ask_id, name: x.p.name, from: clock12(x.p.offer_from), to: clock12(x.p.offer_to) },
        second: { ask_id: y.p.ask_id, name: y.p.name, from: clock12(y.p.offer_from), to: clock12(y.p.offer_to) },
        handoff_at: clock12(`${String(Math.floor((at % 1440) / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`),
        handoff_ok: kase?.handoff_ok === true,
        note: kase?.handoff_ok === true ? 'Could cover the whole shift together' : 'Could cover it together, but this shift is set to one caregiver (no hand-off)' })
    }
  }
  return out.slice(0, 6)
}

/** Part-shift yeses without usable hours (a text like "I can do the morning"): listed so they're not lost. */
export function partsWithoutHours(people: Any[]): Any[] {
  return people.filter((p) => p && p.column === 'partial' && !(mins(p.offer_from) != null && mins(p.offer_to) != null))
    .map((p) => ({ ask_id: p.ask_id, name: p.name, said: S(p.condition || p.reply, 160) }))
}

/** The next 8am in Chicago (or the quiet-hours end), as an ISO time: when a night-held wave may go. */
export function nextMorning(now: Date, untilHour = 8): string {
  const naive = (d: Date) => new Date(d.toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).replace(' ', 'T') + 'Z').getTime()
  const off = naive(now) - now.getTime()   // Chicago wall clock minus UTC
  const wall = new Date(naive(now))
  const target = new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate(), untilHour, 0, 0))
  if (target.getTime() <= wall.getTime()) target.setUTCDate(target.getUTCDate() + 1)
  return new Date(target.getTime() - off).toISOString()
}

/** What still needs attention, in her words, for the panel and Today. */
export function needsLine(run: Any, kase: Any): string | null {
  if (!run) return null
  const st = S(run.status)
  if (st === 'paused') return `Confirm ${S(run.paused_name, 80) || 'the yes'} in AxisCare, or tap "Not this one" so Cara keeps asking`
  if (st === 'needs_office') return S(run.needs, 200) || 'Cara stopped: the office needs to take this one'
  if (st === 'done') {
    const ax = kase?.axiscare_assignment
    if (S(kase?.resolved_how) === 'covered' && !['assigned', 'already'].includes(S(ax?.status)))
      return `Confirmed ${S(kase?.covered_by, 80)}, but not checked on AxisCare: ${S(ax?.detail, 160) || 'put them on the visit by hand'}`
  }
  return null
}
