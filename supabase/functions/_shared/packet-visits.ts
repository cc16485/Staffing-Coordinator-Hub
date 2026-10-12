// Caregiver packets, Step 3 (Samantha "build step 3", 2026-10-12): who is coming up with a client, from AxisCare, read
// only. Used by care-packet ('upcoming', the card) and care-packet-watch (the twice-daily check). One read per client:
// /api/visits for that client from today to `days` ahead, paged. Never changes anything in AxisCare.
// deno-lint-ignore no-explicit-any
type Any = any
const AC_VERSION = '2023-10-01'
export const chiDay = (offsetDays = 0, now = Date.now()) => new Date(now + offsetDays * 86400000).toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)

export function axVisitsReader(fetchImpl: typeof fetch = fetch) {
  let token = ''
  for (const n of ['AXISCARE_VISITS_TOKEN', 'AXISCARE_API_KEY', 'AXISCARE_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  /** A client's visits from `from` to `to` (YYYY-MM-DD), or null when AxisCare could not be read (never "none"). */
  return async (ax: string, from: string, to: string): Promise<Any[] | null> => {
    if (!token || !/^\d+$/.test(site) || !/^\d+$/.test(ax)) return null
    const out: Any[] = []
    let path: string | null = `/api/visits?clientIds=${encodeURIComponent(ax)}&startDate=${from}&endDate=${to}`
    for (let page = 0; path && page < 8; page++) {
      let r: Response | null = null
      for (let i = 0; i < 2; i++) {
        try { r = await fetchImpl(`https://${site}.axiscare.com${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': AC_VERSION } }) }
        catch { r = null }
        if (r && r.status === 429 && i === 0) { await new Promise((ok) => setTimeout(ok, 1500)); continue }
        break
      }
      if (!r || r.status !== 200) return null
      const j: Any = await r.json().catch(() => ({}))
      const vs = j?.results?.visits ?? j?.visits ?? []
      out.push(...(Array.isArray(vs) ? vs : Object.values(vs)))
      const nx = j?.results?.nextPage ?? j?.nextPage ?? null
      path = nx ? String(nx).replace(/^https?:\/\/[^/]+/, '') : null
    }
    return out
  }
}

/** Each caregiver's NEXT visit with this client that has not started yet (removed visits and open shifts skipped). */
export function upcomingByCaregiver(visits: Any[], ax: string, now = Date.now()): Array<{ caregiver_axiscare_id: string; caregiver_name: string; next_start: string }> {
  const best = new Map<string, { caregiver_axiscare_id: string; caregiver_name: string; next_start: string }>()
  for (const v of visits ?? []) {
    if (!v || v.removed || String(v?.client?.id ?? '') !== String(ax)) continue
    const id = String(v?.caregiver?.id ?? '').trim()
    if (!id) continue
    const start = String(v?.scheduledStartDate ?? v?.startDate ?? '')
    const t = Date.parse(start)
    if (!t || t <= now) continue
    const name = [v?.caregiver?.firstName, v?.caregiver?.lastName].map((x: unknown) => String(x ?? '').trim()).filter(Boolean).join(' ') || 'Caregiver'
    const have = best.get(id)
    if (!have || t < Date.parse(have.next_start)) best.set(id, { caregiver_axiscare_id: id, caregiver_name: name, next_start: new Date(t).toISOString() })
  }
  return [...best.values()].sort((a, b) => a.next_start.localeCompare(b.next_start))
}

/** Where a caregiver stands on this packet: confirmed this version, texted (or linked) but not confirmed, or nothing yet. */
export function standing(rec: Any, version: number): 'confirmed' | 'older' | 'texted' | 'link_only' | 'none' {
  if (!rec) return 'none'
  if (rec.ack_version === version) return 'confirmed'
  if (rec.ack_version != null) return 'older'
  if (rec.last_sent_at) return 'texted'
  return 'link_only'
}
export const whenWords = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
