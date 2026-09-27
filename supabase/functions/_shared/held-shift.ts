// =============================================================================
// held-shift — a called-off shift whose earlier Cara case was closed (Change 7b, 2026-09-27)
// =============================================================================
// Her rule (2026-09-19) stays: a case a person closed HOLDS, unless the shift itself
// changed in AxisCare after the close. AxisCare visits carry no "last changed" date
// (Desktop 253 proved it), so the watcher could never see a change and every shift
// with a closed case was held forever, including a second call-off after a fill
// (Joel & Carol Wolverton, 2026-09-27). The change is now read from AxisCare's own
// "changed since" filter, which returned 10/10 clock-ins and 4/4 call-offs in 253.
//
//   changed since the close          -> reopen: a new call-off case (normal path)
//   unchanged, closed as "covered"   -> ask a person: Cara says covered, AxisCare shows nobody
//   AxisCare can't be asked          -> ask a person: never held without anyone knowing
//   unchanged, closed any other way  -> hold, as her rule says
// =============================================================================

export type HeldDecision = 'reopen' | 'ask_covered' | 'ask_unreadable' | 'hold'

/* "v=12:s=3:d=2026-09-27" and "s=3:d=2026-09-27" are the same slot on the calendar */
export const slotKey = (id: unknown) => String(id ?? '').replace(/^v=[^:]+:/, '')
const hasZone = (s: string) => /Z$|[+-]\d{2}:?\d{2}$/.test(s)

/* A visit time as a real instant. With an offset it is exact; without one it is the
   wall clock of the visit's own timezone (America/Chicago if AxisCare gives none). */
export function visitMs(stamp: unknown, tz = 'America/Chicago'): number {
  const s = String(stamp ?? '').trim().replace(' ', 'T')
  if (!s) return NaN
  if (hasZone(s)) return Date.parse(s)
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(s)
  if (!m) return NaN
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0))
  let zone = tz
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }) } catch { zone = 'America/Chicago' }
  /* the zone's offset at that moment, found by formatting the guess back in the zone */
  const off = (ms: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms
  }
  const first = asUtc - off(asUtc)
  return asUtc - off(first)
}

/* Has AxisCare changed this visit since `sinceIso`? true / false, or null when it can't be asked.
   One small read: that visit's own date, changed since the close (both filters together, proven AND). */
export async function changedSince(fetcher: typeof fetch, site: string, token: string, version: string,
  visitId: string, sinceIso: string): Promise<{ changed: boolean | null; detail: string }> {
  const day = /d=(\d{4}-\d{2}-\d{2})/.exec(visitId)?.[1]
  const since = Date.parse(sinceIso)
  if (!day || !Number.isFinite(since)) return { changed: null, detail: 'no date to ask about' }
  const iso = new Date(since).toISOString().replace(/\.\d{3}Z$/, 'Z')
  let url: string | null = `https://${site}.axiscare.com/api/visits?updatedSinceDate=${iso}&startDate=${day}&endDate=${day}`
  const want = slotKey(visitId)
  try {
    for (let page = 0; url && page < 5; page++) {
      const r = await fetcher(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': version } })
      if (r.status === 404) return { changed: false, detail: 'no change since the close' }   // AxisCare's empty result
      if (!r.ok) return { changed: null, detail: `AxisCare answered ${r.status}` }
      // deno-lint-ignore no-explicit-any
      const j: any = await r.json().catch(() => null)
      if (!j) return { changed: null, detail: 'AxisCare sent an unreadable answer' }
      const rows = j?.results?.visits ?? j?.visits
      // deno-lint-ignore no-explicit-any
      const list: any[] = Array.isArray(rows) ? rows : (rows && typeof rows === 'object' ? Object.values(rows) : [])
      if (list.some((v) => slotKey(v?.id) === want)) return { changed: true, detail: 'changed in AxisCare since the close' }
      const next = j?.results?.nextPage ?? j?.nextPage ?? j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
      url = typeof next === 'string' && next.startsWith(`https://${site}.axiscare.com/`) ? next : null
    }
    return url ? { changed: null, detail: 'too many pages to be sure' } : { changed: false, detail: 'no change since the close' }
  } catch (e) { return { changed: null, detail: 'could not reach AxisCare: ' + String((e as Error)?.message ?? e).slice(0, 80) } }
}

// deno-lint-ignore no-explicit-any
export function decideHeld(changed: boolean | null, lastCase: any): HeldDecision {
  if (changed === null) return 'ask_unreadable'
  if (changed) return 'reopen'
  return String(lastCase?.resolved_how ?? '') === 'covered' ? 'ask_covered' : 'hold'
}

const chiWhen = (ms: number) => Number.isFinite(ms)
  ? new Date(ms).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  : 'an unknown time'

/* The one item a person gets. Deterministic id per shift + closed case, so it is raised once. */
export function heldItem(decision: HeldDecision, x: {
  // deno-lint-ignore no-explicit-any
  visitId: string; client: string; startMs: number; reason: string; lastCase: any; detail: string; owner: string; nowIso: string
}) {
  if (decision !== 'ask_covered' && decision !== 'ask_unreadable') return null
  const c = x.lastCase ?? {}
  const who = String(c.covered_by ?? '').trim()
  const first = who.split(/\s+/)[0] || 'them'
  const when = chiWhen(x.startMs)
  const closed = chiWhen(Date.parse(String(c.resolved_at ?? '')))
  const soon = Number.isFinite(x.startMs) && x.startMs - Date.parse(x.nowIso) < 24 * 36e5
  const assign = c.axiscare_assignment?.status ? ` The AxisCare assignment at the time said: ${c.axiscare_assignment.status}${c.axiscare_assignment.detail ? ' (' + String(c.axiscare_assignment.detail).slice(0, 160) + ')' : ''}.` : ''
  const title = decision === 'ask_covered'
    ? `Check ${x.client}'s ${when} shift: marked covered by ${who || 'someone'}, but AxisCare shows no caregiver`
    : `Check ${x.client}'s ${when} shift: no caregiver in AxisCare, and Cara couldn't confirm it`
  const detail = decision === 'ask_covered'
    ? `Cara's case for this shift closed ${closed} as covered by ${who || 'someone'}.${assign} AxisCare now shows the shift with no caregiver and the reason "${x.reason}", and the shift hasn't changed since the case closed. Either ${first} was never put on the shift in AxisCare, or it was cleared again. Confirm with ${first}, then assign them in AxisCare, or open a new call-off on the Coverage board. Cara has not texted anyone about it.`
    : `AxisCare shows the shift with no caregiver and the reason "${x.reason}". An earlier Cara case for it closed ${closed}${who ? ` (covered by ${who})` : ''}. Cara tried to ask AxisCare whether the shift changed since then and couldn't (${x.detail}), so it has not opened a new case. Check the shift in AxisCare. If Cara opens a case for it on a later check, close this.`
  return {
    id: 'ops_cw_held_' + (x.visitId + '_' + String(c.id ?? '')).replace(/[^A-Za-z0-9]/g, '_'),
    kind: 'staffing_issue', title, about: x.client, detail,
    domain: 'scheduling_coverage', status: 'open', urgency: soon ? 'high' : 'normal',
    owner: x.owner, owner_name: x.owner ? x.owner.split('@')[0] : '',
    created_at: x.nowIso, due: Number.isFinite(x.startMs) ? new Date(x.startMs).toISOString() : x.nowIso,
    created_by: 'coverage-watch', opened_by: decision === 'ask_covered' ? 'held-covered-check' : 'held-unreadable-check',
    axiscare_visit_id: x.visitId, case_id: c.id ?? null,
  }
}
