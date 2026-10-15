// =============================================================================
// axiscare-adls · AxisCare's own care task list, READ ONLY (2026-10-14, for the care plan draft from a call)
// =============================================================================
// The same read careplan-tasks makes (GET /api/adls?active=true, paged), kept apart so a reader can name real AxisCare
// tasks without being able to change anything. Never throws: no list means the draft has no task picks, nothing else.
// =============================================================================
const AC_VERSION = '2023-10-01'
export type Adl = { id: number; name: string; adlKey?: string }

function creds() {
  let token = ''
  for (const n of ['AXISCARE_API_KEY', 'AXISCARE_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site: /^\d+$/.test(site) ? site : '' }
}

/** The active task list, sorted by name. { list: [], error } when AxisCare can't be read. */
export async function adlCatalog(): Promise<{ list: Adl[]; error: string | null }> {
  const { token, site } = creds()
  if (!token || !site) return { list: [], error: 'AxisCare is not set up on the server' }
  // deno-lint-ignore no-explicit-any
  const raw: any[] = []; let path: string | null = '/api/adls?active=true&limit=500'
  try {
    for (let i = 0; path && i < 20; i++) {
      const r: Response = await fetch(`https://${site}.axiscare.com${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': AC_VERSION } })
      if (!r.ok) return { list: [], error: 'AxisCare answered ' + r.status }
      const j = await r.json().catch(() => ({}))
      const d = j?.results?.data ?? j?.results ?? []
      raw.push(...(Array.isArray(d) ? d : []))
      const next = j?.results?.nextPage ?? null
      path = typeof next === 'string' && next.startsWith(`https://${site}.axiscare.com/`) ? next.replace(`https://${site}.axiscare.com`, '') : null
    }
  } catch (e) { return { list: [], error: String((e as Error)?.message ?? e).slice(0, 120) } }
  const list = raw.filter((a) => a && a.id != null && a.active !== false)
    .map((a) => ({ id: Number(a.id), name: String(a.name ?? ''), ...(a.adlKey ? { adlKey: String(a.adlKey) } : {}) }))
    .filter((a) => Number.isFinite(a.id) && a.name).sort((x, y) => x.name.localeCompare(y.name))
  return { list, error: null }
}
