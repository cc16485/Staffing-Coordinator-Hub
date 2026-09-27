// =============================================================================
// axiscare-read-probe — Change 7a: measure our AxisCare visit reads, and test "changed since"
// =============================================================================
// READ ONLY. Owner script (service role) only; never for browsers. It makes GET
// requests to AxisCare's visits endpoint and reads two hub records (coverage_cases,
// read only). It writes nothing anywhere and sends nothing.
//
// It answers three questions (CHANGE7-LIGHTER-AXISCARE-READS.md):
//   1. How big is each window our timed jobs read (pages, visits, time taken)?
//   2. Does AxisCare's updatedSinceDate return the changes that matter?
//        A. every clock-in and clock-out recorded in the last 24 hours
//        B. every call-off case Cara opened in the last 7 days
//        C. every visit that is unassigned right now in the next 72 hours
//        D. every visit whose own "last changed" time (if AxisCare gives one) is in the last 24 hours
//      and does it return visits generated from recurring schedules (ids s=…:d=…)?
//   3. Which fields does a visit carry (names only), e.g. a "last modified" date?
// Output is counts and visit ids only, never names.
// If AxisCare answers 429 (slow down) the probe stops at once and says so.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
const AC_VERSION = '2023-10-01'
const PAGE_CAP = 30
const PAUSE_MS = 250
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

export function jwtRole(authHeader: string | null): string | null {
  const m = /^Bearer\s+(.+)$/.exec(authHeader ?? '')
  if (!m) return null
  const parts = m[1].split('.')
  if (parts.length !== 3) return null
  try { const p = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))); return typeof p.role === 'string' ? p.role : null }
  catch { return null }
}
export function isServerSecret(authHeader: string | null, secret = SERVICE_KEY): boolean {
  const m = /^Bearer\s+(.+)$/.exec(authHeader ?? '')
  const a = new TextEncoder().encode(m ? m[1] : ''), b = new TextEncoder().encode(secret || '')
  if (!a.length || !b.length || a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]
  return d === 0
}
function axisCreds() {
  let token = ''
  for (const n of ['AXISCARE_VISITS_TOKEN', 'AXISCARE_API_KEY', 'AXISCARE_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site: /^\d+$/.test(site) ? site : '' }
}
// deno-lint-ignore no-explicit-any
const rowsOf = (v: any): any[] => Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : [])
/* "v=12:s=3:d=2026-09-27" and "s=3:d=2026-09-27" are the same slot on the calendar */
export const slotKey = (id: unknown) => String(id ?? '').replace(/^v=[^:]+:/, '')
export const prefixOf = (id: unknown) => { const s = String(id ?? ''); return s.startsWith('s=') ? 's' : s.startsWith('v=') ? 'v' : 'other' }
const chiDate = (ms: number) => new Date(ms).toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)
const utcDate = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const isoSec = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
/* A clock time with no offset is on the office clock (America/Chicago). */
export function clockMs(c: unknown, now = Date.now()): number | null {
  // deno-lint-ignore no-explicit-any
  const t = c && typeof c === 'object' ? String((c as any).time ?? '') : (typeof c === 'string' ? c : '')
  if (!t) return null
  let s = t.replace(' ', 'T')
  if (!/Z$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const off = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', timeZoneName: 'longOffset' })
      .formatToParts(new Date(now)).find((p) => p.type === 'timeZoneName')?.value?.replace('GMT', '') || '-06:00'
    s += off
  }
  const ms = new Date(s).getTime()
  return Number.isFinite(ms) ? ms : null
}
// deno-lint-ignore no-explicit-any
export const visitDate = (v: any) => String(v?.scheduledStartDate ?? v?.startDate ?? '').slice(0, 10) || (String(v?.id ?? '').match(/d=(\d{4}-\d{2}-\d{2})/)?.[1] ?? '')

/* AxisCare's own "last changed" time on a visit, if it carries one */
const MOD_FIELDS = ['modifiedDate', 'lastModified', 'updatedDate', 'updatedAt', 'dateModified']
// deno-lint-ignore no-explicit-any
export function modMs(v: any, now = Date.now()): number | null {
  for (const k of MOD_FIELDS) { const t = v?.[k]; if (typeof t === 'string' && t) { const ms = clockMs(t, now); if (ms != null) return ms } }
  return null
}

// deno-lint-ignore no-explicit-any
type Walk = { name: string; query: string; pages: number; visits: any[]; statuses: Record<string, number>; ms: number; stopped: string | null }

export function makeWalker(site: string, token: string, fetcher: typeof fetch = fetch, pause = PAUSE_MS) {
  const state = { limited: false, calls: 0 }
  async function walk(name: string, query: string): Promise<Walk> {
    const w: Walk = { name, query, pages: 0, visits: [], statuses: {}, ms: 0, stopped: null }
    if (state.limited) { w.stopped = 'skipped: AxisCare asked us to slow down'; return w }
    const t0 = Date.now()
    let url: string | null = `https://${site}.axiscare.com/api/visits?${query}`
    while (url) {
      if (w.pages >= PAGE_CAP) { w.stopped = `stopped at ${PAGE_CAP} pages`; break }
      if (state.calls) await new Promise((r) => setTimeout(r, pause))
      state.calls++
      let r: Response
      try {
        r = await fetcher(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': AC_VERSION } })
      } catch (e) { w.stopped = 'network: ' + String((e as Error).message ?? e).slice(0, 120); break }
      w.pages++
      w.statuses[String(r.status)] = (w.statuses[String(r.status)] ?? 0) + 1
      if (r.status === 429) { state.limited = true; w.stopped = 'AxisCare answered 429 (slow down)'; break }
      if (r.status === 404) break          // AxisCare's visits answer 404 for an empty result
      if (!r.ok) { w.stopped = 'AxisCare answered ' + r.status; break }
      // deno-lint-ignore no-explicit-any
      const j: any = await r.json().catch(() => ({}))
      w.visits.push(...rowsOf(j?.results?.visits ?? j?.visits))
      const next = j?.results?.nextPage ?? j?.nextPage ?? j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
      url = typeof next === 'string' && next.startsWith(`https://${site}.axiscare.com/`) ? next : null
    }
    w.ms = Date.now() - t0
    return w
  }
  return { walk, state }
}

/* The summary of one read: sizes and id kinds only, never names. */
export function summarize(w: Walk) {
  const pre = { s: 0, v: 0, other: 0 }
  let removed = 0, min = '', max = ''
  for (const v of w.visits) {
    pre[prefixOf(v?.id)]++
    if (v?.removed) removed++
    const d = visitDate(v)
    if (d) { if (!min || d < min) min = d; if (!max || d > max) max = d }
  }
  return { name: w.name, query: w.query, pages: w.pages, visits: w.visits.length, removed, id_kinds: pre,
    visit_dates: min ? `${min} to ${max}` : null, statuses: w.statuses, seconds: Math.round(w.ms / 100) / 10, stopped: w.stopped }
}

/* Did the "changed since" read return these visits? exact id, or the same calendar slot.
   A visit not returned whose own "last changed" time is before the period is not a miss:
   it simply didn't change in that period. */
// deno-lint-ignore no-explicit-any
export function coverage(ids: string[], since: Walk, fromMs = 0, known: Map<string, any> = new Map(), now = Date.now()) {
  const exact = new Set(since.visits.map((v) => String(v?.id ?? '')))
  const slots = new Set(since.visits.map((v) => slotKey(v?.id)))
  const notReturned = ids.filter((id) => !exact.has(id) && !slots.has(slotKey(id)))
  const before = notReturned.filter((id) => { const m = modMs(known.get(slotKey(id)), now); return m != null && m < fromMs })
  const missing = notReturned.filter((id) => !before.includes(id))
  return { checked: ids.length, found_exact: ids.filter((id) => exact.has(id)).length,
    found_same_slot: ids.filter((id) => !exact.has(id) && slots.has(slotKey(id))).length,
    changed_before_period: before.length, missing: missing.length, missing_ids: missing.slice(0, 25) }
}

export async function runProbe(site: string, token: string, cases: unknown[], now = Date.now(), fetcher: typeof fetch = fetch, pause = PAUSE_MS) {
  const { walk, state } = makeWalker(site, token, fetcher, pause)
  const today = chiDate(now), yday = chiDate(now - 864e5)
  // 1. the windows our timed jobs read, same formulas as the jobs
  const wToday = await walk('today (timekeeper-watch, every 2 min)', `startDate=${today}&endDate=${today}`)
  const w72 = await walk('next 72 hours (coverage-watch, every 5 min)', `startDate=${utcDate(now)}&endDate=${utcDate(now + 72 * 36e5)}`)
  const wYT = await walk('yesterday and today (coverage-watch notes, hourly)', `startDate=${yday}&endDate=${today}`)
  const w14 = await walk('next 14 days (coverage-watch sweep, hourly)', `startDate=${utcDate(now)}&endDate=${utcDate(now + 14 * 864e5)}`)
  const w21 = await walk('last 21 days (coverage-watch history, hourly when needed)', `startDate=${utcDate(now - 21 * 864e5)}&endDate=${utcDate(now - 864e5)}`)
  const w28 = await walk('next 28 days (coverage-watch pattern, when a case needs it)', `startDate=${today}&endDate=${utcDate(now + 28 * 864e5)}`)
  // 2. "changed since" reads, AFTER the windows, so anything seen above had already happened
  const t10m = now - 10 * 6e4, t1h = now - 36e5, t24 = now - 864e5, t7d = now - 7 * 864e5
  const s10m = await walk('changed in the last 10 minutes', `updatedSinceDate=${isoSec(t10m)}`)
  const s1h = await walk('changed in the last hour', `updatedSinceDate=${isoSec(t1h)}`)
  const s24 = await walk('changed in the last 24 hours', `updatedSinceDate=${isoSec(t24)}`)
  const s7d = await walk('changed in the last 7 days', `updatedSinceDate=${isoSec(t7d)}`)
  const s24in72 = await walk('changed in the last 24 hours, next 72 hours only', `updatedSinceDate=${isoSec(t24)}&startDate=${utcDate(now)}&endDate=${utcDate(now + 72 * 36e5)}`)

  // deno-lint-ignore no-explicit-any
  const known = new Map<string, any>()
  for (const w of [wToday, w72, wYT, w14, w21, w28]) for (const v of w.visits) known.set(slotKey(v?.id), v)
  const cov = (ids: string[], since: Walk, fromMs: number) => coverage(ids, since, fromMs, known, now)
  // D. every visit we read whose own "last changed" time is in the last 24 hours (30-minute margin)
  const modified24 = [...known.values()].filter((v) => { const m = modMs(v, now); return m != null && m >= t24 + 30 * 6e4 && m <= now }).map((v) => String(v.id))
  // A. clock-ins and clock-outs recorded in the last 24 hours (30-minute margin at the far edge)
  const edge = t24 + 30 * 6e4
  const clockedIn = wYT.visits.filter((v) => { const t = clockMs(v?.clockIn, now); return t != null && t >= edge && t <= now }).map((v) => String(v.id))
  const clockedOut = wYT.visits.filter((v) => { const t = clockMs(v?.clockOut, now); return t != null && t >= edge && t <= now }).map((v) => String(v.id))
  // B. call-off cases Cara opened in the last 7 days (6-hour margin), split by where they stand now
  // deno-lint-ignore no-explicit-any
  const recent = (cases as any[]).filter((c) => c && c.axiscare_visit_id && Date.parse(String(c.opened_at ?? '')) >= t7d + 6 * 36e5)
  const callOffs = recent.filter((c) => c.opened_by === 'axiscare-watch')
  const sweep = recent.filter((c) => c.opened_by === 'ongoing-sweep')
  // C. unassigned right now in the next 72 hours
  const open72 = w72.visits.filter((v) => !v?.removed && v?.caregiver?.id == null)
  const withReason = open72.filter((v) => String(v?.modificationReason?.name ?? '').trim()).map((v) => String(v.id))
  const noReason = open72.filter((v) => !String(v?.modificationReason?.name ?? '').trim()).map((v) => String(v.id))

  // 3. field names on a visit (names only, from every visit read)
  const keys = new Set<string>(), clockKeys = new Set<string>()
  for (const v of [...w72.visits, ...wYT.visits]) {
    Object.keys(v ?? {}).forEach((k) => keys.add(k))
    if (v?.clockIn && typeof v.clockIn === 'object') Object.keys(v.clockIn).forEach((k) => clockKeys.add(k))
  }
  const modifiedFields = [...keys].filter((k) => /modif|updat|changed/i.test(k))

  /* startDate/endDate together with updatedSinceDate should be "both", nothing more, nothing less */
  const combined = (() => {
    const inWin = new Set(w72.visits.map((v) => slotKey(v?.id)))
    const expected = new Set(s24.visits.map((v) => slotKey(v?.id)).filter((k) => inWin.has(k)))
    const got = new Set(s24in72.visits.map((v) => slotKey(v?.id)))
    return { visits: got.size, expected_from_the_two_separate_reads: expected.size,
      extra: [...got].filter((k) => !expected.has(k)).length, missing: [...expected].filter((k) => !got.has(k)).length }
  })()

  return {
    at: new Date(now).toISOString(), axiscare_calls: state.calls, rate_limited: state.limited,
    windows: [wToday, w72, wYT, w14, w21, w28].map(summarize),
    changed_since: [s10m, s1h, s24, s7d, s24in72].map(summarize),
    tests: {
      /* strict: a clock-in inside the period IS a change, whatever the visit's own timestamp says */
      clock_ins_last_24h: coverage(clockedIn, s24),
      clock_outs_last_24h: coverage(clockedOut, s24),
      calloff_cases_last_7d_still_open: cov(callOffs.filter((c) => c.status === 'open').map((c) => String(c.axiscare_visit_id)), s7d, t7d),
      calloff_cases_last_7d_closed: cov(callOffs.filter((c) => c.status !== 'open').map((c) => String(c.axiscare_visit_id)), s7d, t7d),
      ongoing_sweep_cases_last_7d: cov(sweep.map((c) => String(c.axiscare_visit_id)), s7d, t7d),
      unassigned_next_72h_with_reason: cov(withReason, s7d, t7d),
      unassigned_next_72h_no_reason: cov(noReason, s7d, t7d),
      modified_last_24h: cov(modified24, s24, t24),
      recurring_schedule_visits_in_changed_24h: s24.visits.filter((v) => prefixOf(v?.id) === 's').length,
      combined_filter: combined,
    },
    visit_fields: [...keys].sort(), clock_in_fields: [...clockKeys].sort(), modified_date_fields: modifiedFields,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const auth = req.headers.get('Authorization')
  if (jwtRole(auth) !== 'service_role' && !isServerSecret(auth)) return json({ error: 'service_role required; this endpoint is never for browsers' }, 403)
  const { token, site } = axisCreds()
  if (!token || !site) return json({ error: 'AxisCare credentials not set' }, 502)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY)
  const { data: row, error } = await sb.from('app_data').select('data').eq('key', 'coverage_cases').maybeSingle()
  if (error) return json({ error: 'could not read coverage_cases: ' + error.message }, 500)
  return json(await runProbe(site, token, Array.isArray(row?.data) ? row!.data : []))
})
