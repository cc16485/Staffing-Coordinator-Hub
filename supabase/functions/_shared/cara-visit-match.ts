// =============================================================================
// cara-visit-match.ts · CARA PHASE 1, step 1: ONE CASE PER REAL SHIFT (Samantha, 2026-10-23).
// A caregiver who texts or calls to call off is named by their phone (identity layer), but until now the case carried no
// shift: "(from text, confirm the client)" and today's date. Here the caller's own AxisCare visits from 2 hours ago to
// 36 hours ahead are read; one visit = attached; several = the office picks from that short list (a client named in the
// message narrows it); none = said plainly. Read only. Behind ops_settings.cara_visit_match_live: off, the match is worked
// out and kept on the case as visit_match_practice for the office to compare, and nothing else changes.
// The same visit later unassigned in AxisCare (coverage-watch) joins THIS case instead of opening a second one
// (mergeFlagIntoWatch), carrying what the caregiver said. A caregiver's own words never change the not-a-call-in rule
// (attendance still needs the Attendance "Log it" button) and never prove anything about a shift: the visit is AxisCare's.
// =============================================================================
// deno-lint-ignore-file no-explicit-any
type Any = any
const S = (v: unknown, n = 120) => String(v ?? '').trim().slice(0, n)
const nk = (n: unknown) => S(n, 80).toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()

export type VisitOption = { visit_id: string; client: string; client_axiscare_id: string | null; shift_date: string; shift_time: string; starts_in_min: number }
export type VisitMatch = { state: 'one' | 'several' | 'none' | 'unreadable'; chosen: VisitOption | null; options: VisitOption[]; why: string; checked_at: string }

/** The caller's visits that a call-off could be about: not removed, not over more than an hour ago, starting within 36 hours. */
export function callerVisitOptions(visits: Any[], cgAxId: string, nowMs: number): VisitOption[] {
  const out: VisitOption[] = []
  for (const v of visits || []) {
    if (!v || v.removed || String(v?.caregiver?.id ?? '') !== String(cgAxId)) continue
    const s = S(v.scheduledStartDate ?? v.startDate, 30), e = S(v.scheduledEndDate ?? v.endDate, 30)
    /* AxisCare times are the agency's wall clock (Chicago); read them as such */
    const ms = (t: string) => { const d = new Date(t.slice(0, 19)); return d.getTime() }
    const sMs = ms(s), eMs = e ? ms(e) : sMs
    if (!Number.isFinite(sMs)) continue
    if (eMs < nowMs - 3600000 || sMs > nowMs + 36 * 3600000) continue
    out.push({ visit_id: S(v.id), client: [S(v?.client?.firstName, 40), S(v?.client?.lastName, 40)].filter(Boolean).join(' ') || '(client name missing)',
      client_axiscare_id: v?.client?.id != null ? S(v.client.id) : null, shift_date: s.slice(0, 10), shift_time: [s.slice(11, 16), e.slice(11, 16)].filter(Boolean).join('-'),
      starts_in_min: Math.round((sMs - nowMs) / 60000) })
  }
  return out.sort((a, b) => a.starts_in_min - b.starts_in_min)
}

/** Which of those visits the message is about. A client named by the caregiver narrows the list (first name or full name). */
export function pickVisit(options: VisitOption[], clientHint: string | null | undefined, nowIso: string): VisitMatch {
  const at = nowIso
  if (!options.length) return { state: 'none', chosen: null, options, why: 'no visits for this caregiver from 2 hours ago to 36 hours ahead in AxisCare', checked_at: at }
  if (options.length === 1) return { state: 'one', chosen: options[0], options, why: 'their only visit in the next 36 hours', checked_at: at }
  const h = nk(clientHint)
  if (h && !/confirm the client|from call|from text/.test(h)) {
    const hit = options.filter((o) => { const c = nk(o.client); return c === h || c.split(' ')[0] === h.split(' ')[0] })
    if (hit.length === 1) return { state: 'one', chosen: hit[0], options, why: `the message names ${S(clientHint, 40)}`, checked_at: at }
  }
  return { state: 'several', chosen: null, options, why: `${options.length} visits in the next 36 hours: the office picks which one`, checked_at: at }
}

/** The flagged case's fields once a visit is attached (live): the real client, date and time, and the visit id. */
export function attachFields(m: VisitMatch): Record<string, unknown> {
  if (m.state !== 'one' || !m.chosen) return { visit_match: m }
  const c = m.chosen
  return { visit_match: m, axiscare_visit_id: c.visit_id, client: c.client, client_axiscare_id: c.client_axiscare_id, shift_date: c.shift_date, shift_time: c.shift_time }
}

/** Is there already a case for this caller's visit? (a flagged or open case with the same AxisCare visit) */
export function caseForVisit(cases: Any[], visitId: string): Any | null {
  return (cases || []).find((k) => k && S(k.axiscare_visit_id) === S(visitId) && ['open', 'flagged'].includes(S(k.status))) ?? null
}

/** coverage-watch found the visit unassigned in AxisCare and a flagged case already holds it (the caregiver told us first):
    the new watch case carries the caregiver's words, and the flag is closed as merged into it. One shift, one case. */
export function mergeFlagIntoWatch(flag: Any, watchId: string, nowIso: string): { watchExtra: Record<string, unknown>; flagClosed: Any } {
  return {
    watchExtra: { caregiver_said: { text: S(flag.note, 1000), source: S(flag.flag_source, 40) || 'message', at: S(flag.opened_at, 40), evidence: S(flag.flag_evidence, 300) }, merged_flag: S(flag.id, 80),
      calling_off_said: S(flag.calling_off, 80) || null },
    flagClosed: { ...flag, status: 'merged', merged_into: watchId, resolved_at: nowIso, resolved_how: 'merged: AxisCare shows the same shift with no caregiver; one case continues' },
  }
}

/** Read the caller's visits from AxisCare (one call, filtered to them) and pick. Never throws. */
export async function matchCallerVisit(send: typeof fetch, p: { site: string; token: string; version: string; cgAxId: string; clientHint: string | null; now?: Date }): Promise<VisitMatch> {
  const now = p.now ?? new Date(), nowIso = now.toISOString()
  /* AxisCare wall-clock (Chicago) "now", to compare with its visit times */
  const chi = new Date(now.toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).replace(' ', 'T')).getTime()
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  if (!p.token || !p.site) return { state: 'unreadable', chosen: null, options: [], why: 'AxisCare credentials are not set', checked_at: nowIso }
  try {
    const url = `https://${p.site}.axiscare.com/api/visits?startDate=${day(chi - 86400000)}&endDate=${day(chi + 2 * 86400000)}&caregiverIds=${encodeURIComponent(p.cgAxId)}`
    const r = await send(url, { headers: { Authorization: `Bearer ${p.token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': p.version } })
    if (r.status === 404) return pickVisit([], p.clientHint, nowIso)   // AxisCare answers 404 for "no visits" (AXISCARE-CAPABILITY.md)
    if (!r.ok) return { state: 'unreadable', chosen: null, options: [], why: `AxisCare answered ${r.status}`, checked_at: nowIso }
    const j: Any = await r.json().catch(() => ({}))
    const rows = Array.isArray(j?.results?.visits ?? j?.visits) ? (j?.results?.visits ?? j?.visits) : Object.values(j?.results?.visits ?? {})
    return pickVisit(callerVisitOptions(rows, p.cgAxId, chi), p.clientHint, nowIso)
  } catch (e) { return { state: 'unreadable', chosen: null, options: [], why: 'AxisCare could not be read: ' + S(String(e), 100), checked_at: nowIso } }
}
