// One PRN member's AxisCare visits for a window (familiar clients: prn-week's This week list and the PRN Team page). Never throws:
// no visits and why. Moved here from prn-week (PRN step 5a, 2026-10-29) so both use the same read.
// deno-lint-ignore no-explicit-any
type Any = any
const list = (v: Any): Any[] => Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : [])
const AC_VERSION = Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01'
/** One member's AxisCare visits for the last 6 months. Never throws: no visits and why. */
export async function visitsOf(ax: string, from: string, to: string): Promise<{ rows: Any[]; why: string | null }> {
  const token = Deno.env.get('AXISCARE_VISITS_TOKEN') || Deno.env.get('AXISCARE_API_KEY') || Deno.env.get('AXISCARE_TOKEN') || ''
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  if (!token || !/^\d+$/.test(site)) return { rows: [], why: 'AxisCare is not connected on this project' }
  const rows: Any[] = []
  try {
    let url: string | null = `https://${site}.axiscare.com/api/visits?startDate=${from}&endDate=${to}&caregiverIds=${encodeURIComponent(ax)}`
    for (let page = 0; url && page < 10; page++) {
      const r: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': AC_VERSION } })
      if (!r.ok) return { rows, why: `AxisCare answered ${r.status}` }
      const j: Any = await r.json().catch(() => ({}))
      for (const v of list(j?.results?.visits ?? j?.visits)) if (!v?.removed && String(v?.caregiver?.id ?? '') === ax) rows.push(v)
      url = j?.results?.nextPage ?? j?.nextPage ?? null
    }
    return { rows, why: null }
  } catch (e) { return { rows, why: 'could not reach AxisCare: ' + String((e as Error)?.message ?? e).slice(0, 100) } }
}

