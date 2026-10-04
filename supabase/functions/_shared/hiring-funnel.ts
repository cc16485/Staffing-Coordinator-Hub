// =============================================================================
// THE HIRING FUNNEL, the counting (448). Samantha approved 2026-10-04 ("yes to all", idea 5 of
// https://claude.ai/artifact/6FdA6bE9aaobS5E6aY7E42). For people who applied in each of the last 3 months (Central),
// how far they got: applied, interviewed (and no-shows), offered, start form in, cleared, started. Plus the typical
// days between steps, and separately, of everyone AxisCare shows starting 90 to 365 days ago, how many are still active.
// Counts only: no names, phones or emails ever leave this file. Pure, so the tests run exactly what the server runs.
// A person is matched across lists by their phone (last 10 digits) or email only, never by name.
// =============================================================================
// deno-lint-ignore-file no-explicit-any
const TZ = 'America/Chicago'
export const last10 = (p: unknown) => { const d = String(p ?? '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : '' }
export const mail = (e: unknown) => { const s = String(e ?? '').trim().toLowerCase(); return /@/.test(s) ? s : '' }
export const ym = (d: Date | string) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).format(new Date(d)).slice(0, 7)
const day = (d: Date | string) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d))
const days = (a: string | Date, b: string | Date) => (Date.parse(String(b).length === 10 ? b + 'T12:00:00Z' : String(b)) - Date.parse(String(a).length === 10 ? a + 'T12:00:00Z' : String(a))) / 864e5
export function lastMonths(now: Date, n = 3): string[] {
  const [y, m] = ym(now).split('-').map(Number); const out: string[] = []
  for (let i = n - 1; i >= 0; i--) { const d = new Date(Date.UTC(y, m - 1 - i, 15)); out.push(d.toISOString().slice(0, 7)) }
  return out
}
const median = (xs: number[]) => { const a = xs.filter((x) => Number.isFinite(x) && x >= 0).sort((p, q) => p - q); if (!a.length) return null
  const k = Math.floor(a.length / 2); return Math.round((a.length % 2 ? a[k] : (a[k - 1] + a[k]) / 2) * 10) / 10 }
function index(rows: any[], phoneKey: string, emailKey: string) {
  const by = new Map<string, any[]>()
  for (const r of rows || []) for (const k of [last10(r?.[phoneKey]), mail(r?.[emailKey])].filter(Boolean)) { if (!by.has(k)) by.set(k, []); by.get(k)!.push(r) }
  return (p: unknown, e: unknown) => { const seen = new Set<any>(); for (const k of [last10(p), mail(e)].filter(Boolean)) for (const r of by.get(k) || []) seen.add(r); return [...seen] }
}
export type Inputs = { applicants: any[]; bookings: any[]; intakes: any[]; candidates: any[]; roster: any[]; census: any[] | null; now: Date }
export function funnel(I: Inputs) {
  const months = lastMonths(I.now)
  const books = new Map<string, any[]>(); for (const b of I.bookings || []) { const k = String(b.applicant_id); if (!books.has(k)) books.set(k, []); books.get(k)!.push(b) }
  const intakeOf = index(I.intakes, 'phone', 'email'), candOf = index(I.candidates, 'phone', 'email'), rosterOf = index(I.roster, 'phone', 'email')
  const censusOf = index(I.census || [], 'mobile', 'email')
  const M: Record<string, any> = Object.fromEntries(months.map((m) => [m, { month: m, applied: 0, interviewed: 0, noshow: 0, offered: 0, start_form: 0, cleared: 0, started: 0 }]))
  const gaps = { applied_to_interview: [] as number[], interview_to_offer: [] as number[], offer_to_start: [] as number[] }
  for (const a of I.applicants || []) {
    if (!a || a.status === 'partial' || !a.created_at) continue
    const m = ym(a.created_at); if (!M[m]) continue
    const row = M[m]; row.applied++
    const bs = (books.get(String(a.id)) || []).slice().sort((p, q) => String(p.starts_at).localeCompare(String(q.starts_at)))
    const attended = bs.find((b) => b.status === 'attended')
    const interviewed = !!attended || !!a.post_interview
    const noshow = a.status === 'noshow' || !!a.noshow_at || bs.some((b) => b.status === 'noshow')
    if (interviewed) row.interviewed++; else if (noshow) row.noshow++
    const offeredAt = a.hired_at || null
    const offered = !!offeredAt || a.status === 'offer' || a.status === 'hired'
    if (offered) row.offered++
    const since = day(a.created_at)
    const intake = intakeOf(a.phone, a.email).find((x) => x.created_at && day(x.created_at) >= since)
    if (intake) row.start_form++
    const started = (I.census ? censusOf(a.phone, a.email) : []).filter((g) => g.hire_date && String(g.hire_date).slice(0, 10) >= since)
      .concat(rosterOf(a.phone, a.email).filter((g) => g.hire_date && String(g.hire_date).slice(0, 10) >= since))
      .sort((p, q) => String(p.hire_date).localeCompare(String(q.hire_date)))[0]
    const cand = candOf(a.phone, a.email).find((c) => c.resolvedStatus === 'Ready for Orientation' && !c.not_hired)
    if (cand || started) row.cleared++
    if (started) row.started++
    const iAt = attended?.starts_at || null
    if (iAt) gaps.applied_to_interview.push(days(a.created_at, iAt))
    if (iAt && offeredAt) gaps.interview_to_offer.push(days(iAt, offeredAt))
    if (offeredAt && started) gaps.offer_to_start.push(days(day(offeredAt), String(started.hire_date).slice(0, 10)))
  }
  /* 90-day retention, from AxisCare alone: everyone hired 90 to 365 days ago */
  let retention: any = null
  if (I.census) {
    const today = day(I.now)
    const window = I.census.filter((g) => { const h = String(g.hire_date || '').slice(0, 10); if (!/^\d{4}-\d\d-\d\d$/.test(h)) return false
      const d = days(h, today); return d >= 90 && d <= 365 })
    retention = { hired: window.length, still_active: window.filter((g) => g.active === true).length }
  }
  const booked = months.reduce((s, m) => s + M[m].interviewed + M[m].noshow, 0), ns = months.reduce((s, m) => s + M[m].noshow, 0)
  return { months: months.map((m) => M[m]), medians: { applied_to_interview: median(gaps.applied_to_interview), interview_to_offer: median(gaps.interview_to_offer), offer_to_start: median(gaps.offer_to_start) },
    noshow_rate: booked ? Math.round(ns / booked * 100) : null, retention }
}
