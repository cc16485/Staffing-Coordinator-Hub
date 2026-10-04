// The full AxisCare caregiver list (active and inactive), read only. The same read caregiver-census-report makes for
// the Hub's Caregivers directory, as a shared piece for server jobs (2026-10-03: the hourly caregiver connect job).
// Only AxisCare GETs; never throws. Every row list goes through rowsOf(): AxisCare arrays sometimes arrive as
// index-keyed objects.

export type CensusRow = {
  id: string; first: string; last: string; goes_by: string; active: boolean; status_label: string
  hire_date: string; mobile: string; email: string
}
export type Census = { ok: true; rows: CensusRow[]; total: number; truncated: boolean } | { ok: false; error: string }

function axisCreds() {
  const order = ['AXISCARE_API_KEY', 'AXISCARE_TOKEN', 'AXISCARE_VISITS_TOKEN']
  let token = ''
  for (const n of order) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site }
}
// deno-lint-ignore no-explicit-any
const rowsOf = (x: any): any[] => Array.isArray(x) ? x : (x && typeof x === 'object' ? Object.values(x) : [])
const S = (v: unknown) => String(v ?? '').trim()

export async function readCensus(send: typeof fetch = fetch): Promise<Census> {
  const { token, site } = axisCreds()
  if (!token || !site) return { ok: false, error: 'AxisCare credentials are not set' }
  const rows: CensusRow[] = []
  let url: string | null = `https://${site}.axiscare.com/api/caregivers`
  let pages = 0
  try {
    while (url && pages < 20) {
      pages++
      const r: Response = await send(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json',
        'X-AxisCare-Api-Version': Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01' } })
      if (!r.ok) return { ok: false, error: `AxisCare answered ${r.status} on page ${pages}` }
      // deno-lint-ignore no-explicit-any
      const j: any = await r.json().catch(() => ({}))
      for (const g of rowsOf(j?.results?.caregivers ?? j?.caregivers)) {
        if (g?.id == null) continue
        rows.push({
          id: String(g.id), first: S(g.firstName), last: S(g.lastName), goes_by: S(g.goesBy),
          active: g?.status?.active === true, status_label: S(g?.status?.label),
          hire_date: S(g.hireDate) || S(g.startDate), mobile: S(g.mobilePhone), email: S(g.personalEmail),
        })
      }
      url = j?.results?.nextPage ?? j?.nextPage ?? j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
    }
  } catch (e) { return { ok: false, error: 'AxisCare could not be reached: ' + String(e).slice(0, 120) } }
  if (!rows.length) return { ok: false, error: 'AxisCare returned no caregivers' }
  return { ok: true, rows, total: rows.length, truncated: !!url }
}
