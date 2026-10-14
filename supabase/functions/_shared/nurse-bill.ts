// =============================================================================
// nurse-bill.ts · IS THIS NURSE VISIT READY TO BILL? (LPN nurse visit plan step 8, Samantha approved 2026-10-14; Desktop 707)
// =============================================================================
// Pure: no clock, no database, no network. nurse-visit-check reads AxisCare and the Hub's records and asks this file.
//
// THE RULES (Missouri T1001, the plan's "Bill only what is ready"; HCBS Manual 3.15; MO HealthNet Personal Care Manual 5.1):
//   (a) prior authorization: the state care plan in the Hub (app_data medicaid_plans, read by care-plan-rules.js) has a line
//       of ours that covers the visit: a 'ghe' line for a GHE, a 'nurse' line for every other nurse service. When the line
//       has authorized units for that stretch, the visits are counted against them in date order.
//   (b) at most one nurse visit a day per client (the second and later that day are not ready).
//   (c) at most 26 in the six-month period. THE PERIOD RULE (ours, written down so it can be checked): the care plan's
//       own dates. A plan of about a year (355 to 372 days) is two periods: its first six calendar months from plan_start,
//       then the rest to plan_end. A plan of about six months (175 to 190 days) is one period. Any other length, or no
//       plan, is UNCERTAIN: the visit is not ready with "check the count by hand", never a guess.
//   (d) documentation: a visit note in AxisCare (for services marked note) and any required AxisCare care tasks done.
//   (e) a GHE: the Hub's GHE form for that client and visit exists and is finished; when an LPN (or a nurse the list does
//       not know) completed it, the RN reviewed and signed it (status Ready for Fusion or Uploaded, Supervisory Nurse
//       signature, reviewing RN named). HCBS 8.00 Appendix 4.
// A visit is "ready" or "not ready" with reasons in plain words. Only completed visits (clocked in and out) are checked.
// No em dashes in any words a person reads.
// deno-lint-ignore-file no-explicit-any
import { centralYmd, addDaysYmd } from './business-days.ts'
import { matchService, isT1001, type NurseService } from './nurse-services.ts'

export const CAP_PER_PERIOD = 26
const S = (v: unknown, n = 160) => String(v ?? '').trim().slice(0, n)
const norm = (v: unknown) => S(v, 200).toLowerCase().replace(/\s+/g, ' ')
const ymd = (v: unknown) => { const x = S(v, 10); return /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : '' }
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5)
/** the same day of the month n months later (the 31st becomes the month's last day) */
export function addMonthsYmd(d: string, n: number): string {
  let y = +d.slice(0, 4), m = +d.slice(5, 7) + n; y += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(+d.slice(8, 10), last)).padStart(2, '0')}`
}
export const longDate = (d: string) => (ymd(d) ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }) : S(d))
const shortDate = (d: string) => (ymd(d) ? new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }) : S(d))

/** when the visit happened, as a Central date, and the instant it started */
export const visitStart = (v: any) => S(v?.clockIn?.time || v?.startDate || v?.scheduledStartDate, 40)
export const visitDay = (v: any) => { const t = S(v?.scheduledStartDate || v?.startDate || v?.clockIn?.time, 40); return t ? (ymd(t) && t.length === 10 ? t : centralYmd(t)) : '' }
/** clocked in and out (the GHE watch's own test) */
export const completed = (v: any) => !!(v && !v.removed && v.clockIn && v.clockOut && (v.clockIn.time || v.clockIn === true) && (v.clockOut.time || v.clockOut === true))
export const nurseName = (v: any) => [v?.caregiver?.firstName, v?.caregiver?.lastName].map((x: unknown) => S(x, 60)).filter(Boolean).join(' ')

/** the state care plans of one AxisCare client (kind 'plan'), the latest generated first */
export function plansOf(plans: any[], ax: string): any[] {
  return (plans || []).filter((p) => p && p.kind === 'plan' && String(p.axiscare_client_id) === String(ax) && ymd(p.plan_start) && ymd(p.plan_end))
    .sort((a, b) => S(b.generated).localeCompare(S(a.generated)) || S(b.plan_end).localeCompare(S(a.plan_end)))
}
/** the plan covering a date */
export const planFor = (plans: any[], ax: string, d: string) => plansOf(plans, ax).find((p) => p.plan_start <= d && d <= p.plan_end) || null

/** the six-month period a date falls in, from the plan's own dates (see THE PERIOD RULE above) */
export function periodOf(plan: any, d: string): { certain: true; from: string; to: string } | { certain: false; why: string } {
  if (!plan) return { certain: false, why: 'no state care plan in the Hub covers this date' }
  const a = ymd(plan.plan_start), b = ymd(plan.plan_end)
  if (!a || !b) return { certain: false, why: 'the care plan has no dates' }
  const span = daysBetween(a, b) + 1
  if (span >= 175 && span <= 190) return { certain: true, from: a, to: b }
  if (span >= 355 && span <= 372) {
    const mid = addMonthsYmd(a, 6)
    return d < mid ? { certain: true, from: a, to: addDaysYmd(mid, -1) } : { certain: true, from: mid, to: b }
  }
  return { certain: false, why: `the care plan runs ${shortDate(a)} to ${shortDate(b)} (${span} days), which is neither six months nor a year` }
}

/** our authorized lines of a kind ('ghe' or 'nurse') on a plan */
const linesOf = (plan: any, kind: string) => ((plan && plan.services) || []).filter((s: any) => s && s.ours !== false && s.kind === kind)
/** the line that authorizes a visit on day d: covering the date, or (a GHE) its month */
function lineFor(plan: any, kind: string, d: string): any {
  return linesOf(plan, kind).find((s: any) => ymd(s.start) && ymd(s.end) && s.start <= d && d <= s.end)
    || (kind === 'ghe' ? linesOf(plan, kind).find((s: any) => S(s.start).slice(0, 7) === d.slice(0, 7) || s.ghe1 === d.slice(0, 7) || s.ghe2 === d.slice(0, 7)) : null) || null
}
const unitsRow = (line: any, d: string) => ((line && line.units) || []).find((u: any) => ymd(u.start) && ymd(u.end) && u.start <= d && d <= u.end) || null

const credOf = (name: string, staff: any[]) => { const n = (staff || []).find((s) => s && norm(s.name) === norm(name)); return n ? S(n.cred, 4).toUpperCase() : '' }

export type VisitResult = {
  visit_id: string; ax: string; client: string; client_id: string; date: string; start: string; service_key: string; service: string
  nurse: string; cred: string; ready: boolean; reasons: string[]; plan_id: string; period: { from: string; to: string } | null
}
export type ClientSummary = {
  ax: string; client: string; client_id: string; plan_id: string; plan_start: string; plan_end: string
  period: { from: string; to: string } | null; period_note: string; authorized: number | null; used: number; cap: number; not_ready: number
}

/**
 * One client's nurse visits checked.
 * ctx: { ax, client (name), clientRec (nurse_clients row or null), visits (AxisCare, every visit read), plans (medicaid_plans),
 *        forms (ghe_forms), staff (nurse_staff), watch (ghe_watch), services (nurseServices().list), today, checkFrom,
 *        medicaid ('yes' | 'no' | 'unknown') }
 */
export function checkClient(ctx: any): { results: VisitResult[]; summary: ClientSummary } {
  const ax = String(ctx.ax), services: NurseService[] = ctx.services || [], today = ctx.today, rec = ctx.clientRec || null
  const clientName = S(ctx.client || rec?.name, 120), clientId = S(rec?.id, 60)
  /* which visits are nurse visits: a client marked private pay is never ours to check; a client whose payer is unknown is
     checked only on visits that carry T1001 itself (a private-pay nurse visit must never be held from billing) */
  const nv = (ctx.visits || []).filter((v: any) => v && !v.removed).map((v: any) => ({ v, svc: matchService(v, services) }))
    .filter((x: any) => x.svc && ctx.medicaid !== 'no' && (ctx.medicaid === 'yes' || isT1001(x.v)))
    .map((x: any) => ({ ...x, day: visitDay(x.v), at: visitStart(x.v) }))
    .filter((x: any) => x.day)
    .sort((a: any, b: any) => a.day.localeCompare(b.day) || a.at.localeCompare(b.at) || S(a.v.id).localeCompare(S(b.v.id)))
  const done = nv.filter((x: any) => completed(x.v))
  /* GHE months: Nurse Scheduling's board (from the plan, or set by hand) and the plan's GHE lines */
  const gheMonths = new Set<string>([rec?.ghe1, rec?.ghe2, rec?.ghe_makeup].map((m) => S(m).slice(0, 7)).filter(Boolean))
  for (const p of plansOf(ctx.plans, ax)) for (const s of linesOf(p, 'ghe')) if (ymd(s.start)) gheMonths.add(s.start.slice(0, 7))
  const gheKey = services.find((s) => s.key === 'ghe') ? 'ghe' : ''
  /* a generic T1001 visit in a GHE month is the GHE: the one the GHE watch already named, else the first one done that month */
  const named = new Set<string>()
  if (gheKey) for (const m of gheMonths) {
    const w = (ctx.watch || []).find((x: any) => x && x.id === `gw_${clientId}_${m}`)
    const inMonth = done.filter((x: any) => x.day.slice(0, 7) === m && (x.svc.key === 'ghe' || x.svc.generic))
    if (inMonth.some((x: any) => x.svc.key === 'ghe')) continue
    const pick = (w && w.visit && inMonth.find((x: any) => String(x.v.id) === String(w.visit.id))) || inMonth[0]
    if (pick) named.add(String(pick.v.id))
  }
  const svcOf = (x: any): NurseService => (x.svc.generic && named.has(String(x.v.id)) ? services.find((s) => s.key === 'ghe')! : x.svc)

  const results: VisitResult[] = []
  const lineCount: Record<string, number> = {}, dayCount: Record<string, number> = {}, periodCount: Record<string, number> = {}
  for (const x of done) {
    const svc = svcOf(x), d = x.day, v = x.v, reasons: string[] = []
    const plan = planFor(ctx.plans, ax, d), isGhe = svc.key === 'ghe'
    /* counts run over every completed visit read (also the ones before checkFrom), so the limits are right */
    dayCount[d] = (dayCount[d] || 0) + 1
    const per = periodOf(plan, d)
    let pk = ''
    if (per.certain) { pk = per.from; periodCount[pk] = (periodCount[pk] || 0) + 1 }
    const lineKind = isGhe ? 'ghe' : 'nurse', line = plan ? lineFor(plan, lineKind, d) : null, row = unitsRow(line, d)
    const lk = line && row ? `${lineKind}:${line.start}:${row.start}` : ''
    if (lk) lineCount[lk] = (lineCount[lk] || 0) + 1
    if (d < ctx.checkFrom || d > today) continue
    /* (a) authorization */
    if (svc.auth) {
      if (!plan) reasons.push(`No state care plan in the Hub covers ${shortDate(d)}. Upload the current plan from Fusion on Nurse Scheduling.`)
      else if (!line) {
        if (isGhe && S(rec?.ghe_makeup).slice(0, 7) === d.slice(0, 7)) reasons.push('This is a make-up GHE (done the month after it was missed). A late GHE is not billed or paid unless the PCCP team set a new month (MAN 3.15).')
        else reasons.push(isGhe ? `The care plan has no GHE authorized for ${longDate(d).replace(/ \d+,/, '')}.` : `The care plan has no authorized nurse visits on ${shortDate(d)}.`)
      } else if ((line.units || []).length && !row) reasons.push(`The care plan's ${isGhe ? 'GHE' : 'nurse visit'} line has no authorized units for ${shortDate(d)}.`)
      else if (row && typeof row.units === 'number' && lineCount[lk] > row.units) reasons.push(`Over the authorization: ${row.units} ${isGhe ? 'GHE' : 'nurse'} visit${row.units === 1 ? '' : 's'} authorized from ${shortDate(row.start)} to ${shortDate(row.end)}, and this is visit ${lineCount[lk]}.`)
    }
    /* (b) one a day */
    if (dayCount[d] > 1) reasons.push(`A second nurse visit for this client on ${shortDate(d)}. Missouri pays one nurse visit a day.`)
    /* (c) 26 in six months */
    if (!per.certain) { if (plan || !svc.auth) reasons.push(`The six-month period is not known (${per.why}), so the 26-visit limit was not checked. Check the count by hand.`) }
    else if (periodCount[pk] > CAP_PER_PERIOD) reasons.push(`This is nurse visit ${periodCount[pk]} in the six-month period ${shortDate(per.from)} to ${shortDate(per.to)}. Missouri pays at most ${CAP_PER_PERIOD}.`)
    /* (d) documentation */
    if (svc.note && !S(v.careNote, 4000)) reasons.push('No visit note in AxisCare. The nurse adds what was done to the visit note.')
    for (const t of svc.tasks || []) {
      const a = (Array.isArray(v.adls) ? v.adls : []).find((y: any) => y && norm(y.name).includes(norm(t)))
      if (!a || a.completed !== true) reasons.push(`The care task "${t}" is not marked done on the AxisCare visit.`)
    }
    /* (e) the GHE form, and the RN's signature when an LPN completed it */
    const nurse = nurseName(v)
    let cred = credOf(nurse, ctx.staff)
    if (isGhe || svc.rn_sign) {
      const forms = (ctx.forms || []).filter((f: any) => f && !f.superseded_by && (clientId && f.client_id ? String(f.client_id) === clientId : norm(f.client) === norm(clientName)))
      const f = forms.find((y: any) => ymd(y.visit_date) === d) || (isGhe ? forms.find((y: any) => S(y.visit_date).slice(0, 7) === d.slice(0, 7)) : null)
      if (isGhe && !f) reasons.push('No GHE form in the Hub for this visit. The nurse fills it in on Nurse Scheduling.')
      if (f) {
        const fc = credOf(f.nurse, ctx.staff) || cred; cred = fc || cred
        const needsRn = svc.rn_sign || (svc.rn_sign_if_lpn && fc !== 'RN')
        const finished = f.status === 'ready' || f.status === 'uploaded'
        if (!f.sig_nurse || (f.status || 'draft') === 'draft') reasons.push('The GHE form is not finished and signed by the nurse yet.')
        else if (needsRn && !(finished && f.sig_sup && S(f.rn_reviewer))) reasons.push(fc === 'LPN' ? 'The LPN\'s GHE form is waiting for the RN\'s review and signature.' : 'The GHE form needs an RN\'s review and signature (the nurse who wrote it is not on the nurse list as an RN).')
        else if (!needsRn && !finished) reasons.push('The GHE form is not marked Ready for Fusion yet.')
      }
    }
    results.push({ visit_id: String(v.id), ax, client: clientName, client_id: clientId, date: d, start: x.at, service_key: svc.key, service: svc.name,
      nurse, cred, ready: !reasons.length, reasons, plan_id: S(plan?.id, 120), period: per.certain ? { from: per.from, to: per.to } : null })
  }

  /* this period, for the panel: authorized nurse visits (the units on our nurse and GHE lines that start in it) against used */
  const cur = planFor(ctx.plans, ax, today) || plansOf(ctx.plans, ax)[0] || null
  const per = periodOf(cur, today)
  let authorized: number | null = null, used = 0
  if (per.certain) {
    let any = false, sum = 0
    for (const k of ['nurse', 'ghe']) for (const l of linesOf(cur, k)) for (const u of l.units || []) if (ymd(u.start) && u.start >= per.from && u.start <= per.to && typeof u.units === 'number') { any = true; sum += u.units }
    authorized = any ? sum : null
    used = done.filter((x: any) => x.day >= per.from && x.day <= per.to).length
  }
  return { results, summary: { ax, client: clientName, client_id: clientId, plan_id: S(cur?.id, 120), plan_start: S(cur?.plan_start), plan_end: S(cur?.plan_end),
    period: per.certain ? { from: per.from, to: per.to } : null, period_note: per.certain ? '' : per.why, authorized, used, cap: CAP_PER_PERIOD, not_ready: results.filter((r) => !r.ready).length } }
}

/** where the read must start for one client: the check window, back to the start of the period it falls in, and any held visit */
export function readFrom(plans: any[], ax: string, checkFrom: string, heldDays: string[] = []): string {
  let from = checkFrom
  const p = periodOf(planFor(plans, ax, checkFrom), checkFrom)
  if (p.certain && p.from < from) from = p.from
  for (const d of heldDays) if (ymd(d) && d < from) from = d
  return from
}

/** is the client Medicaid? 'yes' with a state care plan or a Medicaid payer mark, 'no' when marked another payer */
export function medicaidOf(plans: any[], ax: string): 'yes' | 'no' | 'unknown' {
  if (plansOf(plans, ax).length) return 'yes'
  const m = (plans || []).find((p) => p && p.kind === 'payer_mark' && String(p.axiscare_client_id) === String(ax))
  return m && m.payer ? (m.payer === 'medicaid' ? 'yes' : 'no') : 'unknown'
}

/** the card for a visit that is not ready (one per visit; it closes itself once the visit is ready) */
export function notReadyCard(r: VisitResult): { title: string; detail: string } {
  return { title: `Nurse visit not ready to bill: ${r.client || 'a client'}, ${shortDate(r.date)}`,
    detail: `${r.service}${r.nurse ? ' by ' + r.nurse + (r.cred ? ' (' + r.cred + ')' : '') : ''} on ${longDate(r.date)}. Not ready to bill because: ${r.reasons.join(' ')} ` +
      'Fix it in AxisCare or the Hub, and tell the AxisCare billing team not to bill it until then. This card closes itself once the visit is ready.' }
}
