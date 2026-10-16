// =============================================================================
// family-fee: the month-end App fee check (her yes 2026-10-16: "Approve the App fee check plan as recommended").
// Her rules: the app is free any month the client has a visit; $15 (ops_settings family_app_fee) for a month with none,
// added by the office to the client's AxisCare invoice. The app does not go live without this check.
//   who:   clients marked "App plan" (care_circles.app_plan, on by default when their first family login is invited).
//          Set-shift clients who only add extra visits are left unticked.
//   visit: any visit on the AxisCare schedule that month that wasn't removed (cancelled visits are removed in AxisCare).
//   new:   no fee in the month they join (app_plan_since in that month); the first full month counts.
//   never: a client AxisCare can't be read for is "couldn't check", never "had visits". Nothing is charged by the Hub
//          and no family is contacted: the office ticks "Added to the AxisCare invoice" per client (who and when kept).
// Pure logic + injected dependencies so it runs under Node tests.
// =============================================================================
import { clientVisits, type Ax } from './family-app.ts'

// deno-lint-ignore no-explicit-any
type Any = any
export type AppClient = { circle_id: string; axiscare_client_id: string; client_name: string; app_plan_since: string | null }
export type FeeDeps = {
  ax: Ax
  now: () => Date
  settings: () => Promise<Any>
  appClients: () => Promise<AppClient[]>
  checks: (month: string) => Promise<Any[]>
  saveCheck: (row: Any) => Promise<boolean>
  officeItem: (item: Any) => Promise<boolean>
}
export const FEE_DEFAULT = 15
export const feeOf = (st: Any) => Number(st?.family_app_fee) > 0 ? Number(st.family_app_fee) : FEE_DEFAULT
const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const monthWords = (m: string) => `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`
/** "YYYY-MM" for the month before `now` (Central). */
export function lastMonth(now: Date): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit' }).format(now).slice(0, 7)
  const y = Number(p.slice(0, 4)), m = Number(p.slice(5, 7))
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}
export function monthRange(m: string): { from: string; to: string } {
  const y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7))
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  return { from: `${m}-01`, to: `${m}-${String(last).padStart(2, '0')}` }
}
export const validMonth = (m: unknown) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m ?? ''))

/** Check one month for every App plan client. Saves each row (keeping the office's "billed" ticks) and returns them. */
export async function runFeeCheck(d: FeeDeps, month: string, by: string) {
  const st = await d.settings(), fee = feeOf(st), r = monthRange(month), nowIso = d.now().toISOString()
  const before = new Map((await d.checks(month)).map((x) => [String(x.axiscare_client_id), x]))
  const rows: Any[] = []
  for (const c of await d.appClients()) {
    let result: 'fee' | 'free' | 'joined' | 'couldnt_check', visits: number | null = null, why: string | null = null
    if (c.app_plan_since && c.app_plan_since.slice(0, 7) >= month) { result = 'joined' }
    else {
      try { visits = (await clientVisits(d.ax, c.axiscare_client_id, r.from, r.to)).filter((v) => String(v?.scheduledStartDate ?? v?.startDate ?? r.from).slice(0, 7) <= month).length; result = visits > 0 ? 'free' : 'fee' }
      catch (e) { result = 'couldnt_check'; why = String((e as Error)?.message ?? e).slice(0, 160) }
    }
    const old = before.get(c.axiscare_client_id)
    const row = { month, axiscare_client_id: c.axiscare_client_id, circle_id: c.circle_id, client_name: c.client_name, visits, result, fee: result === 'fee' ? fee : 0,
      error: why, checked_at: nowIso, checked_by: by, billed_at: old?.billed_at ?? null, billed_by: old?.billed_by ?? null }
    await d.saveCheck(row); rows.push(row)
  }
  return { month, fee, rows }
}

/** The monthly run (cron, the 1st): last month's check and ONE office card when anyone owes the fee or couldn't be checked. */
export async function monthlyFeeRun(d: FeeDeps) {
  const month = lastMonth(d.now()), out = await runFeeCheck(d, month, 'month-end check')
  const owe = out.rows.filter((x) => x.result === 'fee'), cant = out.rows.filter((x) => x.result === 'couldnt_check')
  if (owe.length || cant.length) {
    const nowIso = d.now().toISOString(), mw = monthWords(month)
    const detail = (owe.length ? `No visits in ${mw}, so add the $${out.fee} app fee to their AxisCare invoice: ${owe.map((x) => x.client_name).join(', ')}.` : '') +
      (cant.length ? ` AxisCare couldn't be checked for: ${cant.map((x) => x.client_name).join(', ')} (open the list and press Check again).` : '')
    await d.officeItem({ id: `fam_fee_${month}`, kind: 'family_app_fee', domain: 'billing', status: 'open', urgency: 'soon',
      title: `App fee check: ${owe.length} client${owe.length === 1 ? '' : 's'} to bill $${out.fee} for ${mw}`, about: 'Family app', detail: detail.trim(),
      next_action: 'Add the fee on each AxisCare invoice, then tick "Added to the AxisCare invoice" (Scheduling, Family bookings, App fee check).',
      created_at: nowIso, first_at: nowIso, last_at: nowIso, last_activity_at: nowIso, created_by: 'month-end check', opened_by: 'month-end check',
      source: { kind: 'family_app_fee', month }, history: [{ at: nowIso, by: 'month-end check', text: detail.trim() }] })
  }
  return { ...out, owe: owe.length, couldnt_check: cant.length }
}
