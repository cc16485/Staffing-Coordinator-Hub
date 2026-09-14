// Supabase Edge Function: coverage-shifts  (shared hub project)
// -----------------------------------------------------------------------------
// "Click the caregiver from a drop-down and choose which of their shifts they
// are calling in for" (Samantha, 2026-09-12). This serves that picker: the
// hub asks for a caregiver's REAL upcoming visits, live from AxisCare, so a
// call-off case is anchored to the exact visit from the moment it opens —
// client, id, date, times — instead of free text someone heard on the phone.
//
// Read-only. JWT-verified (deploy WITHOUT --no-verify-jwt); the hub calls it
// with the signed-in coordinator's session token.
// -----------------------------------------------------------------------------
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  } })

const AC_VERSION = Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01'
/* AxisCare sometimes returns entity lists keyed by id rather than as arrays
   (axiscare-probe's listOf() defends against exactly this; the caregivers
   census threw "object is not iterable" in production). Normalise. */
// deno-lint-ignore no-explicit-any
const rowsOf = (v: any): any[] => Array.isArray(v) ? v
  : (v && typeof v === 'object') ? Object.values(v) : []
function axisCreds() {
  const order = ['AXISCARE_VISITS_TOKEN', 'AXISCARE_API_KEY', 'AXISCARE_TOKEN']
  let token = ''
  for (const n of order) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site: /^\d+$/.test(site) ? site : '' }
}

function callerRole(req: Request): string {
  try {
    const tok = String(req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    const payload = JSON.parse(atob(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return String(payload?.role || '')
  } catch { return '' }
}
const chiToday = () => new Date().toLocaleString('sv-SE', { timeZone: 'America/Chicago' }).slice(0, 10)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS' } })

  /* The census and client notes are sensitive: only a signed-in coordinator
     (or the service role), never the public anon key (review finding). */
  const role = callerRole(req)
  if (role !== 'authenticated' && role !== 'service_role')
    return json({ error: 'a signed-in coordinator session is required' }, 403)

  // deno-lint-ignore no-explicit-any
  const b: any = await req.json().catch(() => ({}))

  /* Mode 0: TODAY'S BOARD for the hub dashboard (Samantha, 2026-09-14: "a
     really good page for our dashboard/today"). One light pull of today's
     visits: how many, which are still unassigned, and the first start time.
     Read-only, coordinator-session only, same as everything else here. */
  if (b.today_board === true) {
    const { token, site } = axisCreds()
    if (!token || !site) return json({ error: 'AxisCare credentials not set on this project' }, 502)
    const day = chiToday()
    // deno-lint-ignore no-explicit-any
    const visits: any[] = []
    let vurl: string | null = `https://${site}.axiscare.com/api/visits?startDate=${day}&endDate=${day}`
    try {
      for (let page = 0; vurl && page < 6; page++) {
        const r: Response = await fetch(vurl, { headers: {
          Authorization: `Bearer ${token}`, Accept: 'application/json',
          'X-AxisCare-Api-Version': AC_VERSION } })
        if (!r.ok) return json({ error: `AxisCare responded ${r.status}` }, 502)
        // deno-lint-ignore no-explicit-any
        const j: any = await r.json().catch(() => ({}))
        for (const v of rowsOf(j?.results?.visits ?? j?.visits)) { if (!v?.removed) visits.push(v) }
        vurl = j?.results?.nextPage ?? j?.nextPage ?? j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
      }
    } catch (err) { return json({ error: String(err) }, 502) }
    const open = visits.filter((v) => v?.caregiver?.id == null)
      .map((v) => ({
        visit_id: v?.id != null ? String(v.id) : '',
        time: String(v?.scheduledStartDate ?? v?.startDate ?? '').slice(11, 16),
        end: String(v?.scheduledEndDate ?? v?.endDate ?? '').slice(11, 16),
        client: [v?.client?.firstName, v?.client?.lastName].filter(Boolean).join(' ') || '?',
      }))
      .sort((a, b2) => a.time.localeCompare(b2.time))
    return json({ date: day, total: visits.length, open })
  }

  /* Mode 2: the ACTIVE caregiver census, live from AxisCare, for the
     "Who's calling off?" dropdown. The hub roster's active flag drifts from
     AxisCare's, and Samantha only wants people who are actually active.
     Filtered on the per-row status.active boolean — never a query param the
     endpoint might silently ignore (the clients backfill taught that). */
  if (b.list_caregivers === true) {
    const { token, site } = axisCreds()
    if (!token || !site) return json({ error: 'AxisCare credentials not set on this project' }, 502)
    // deno-lint-ignore no-explicit-any
    const out: any[] = []
    let total = 0
    let url: string | null = `https://${site}.axiscare.com/api/caregivers`
    try {
      for (let page = 0; url && page < 12; page++) {
        const r: Response = await fetch(url, { headers: {
          Authorization: `Bearer ${token}`, Accept: 'application/json',
          'X-AxisCare-Api-Version': AC_VERSION } })
        if (!r.ok) return json({ error: `AxisCare responded ${r.status}` }, 502)
        // deno-lint-ignore no-explicit-any
        const j: any = await r.json().catch(() => ({}))
        for (const g of rowsOf(j?.results?.caregivers ?? j?.caregivers)) {
          total++
          if (g?.status?.active !== true) continue
          const name = [String(g?.firstName ?? '').trim(), String(g?.lastName ?? '').trim()]
            .filter(Boolean).join(' ')
          if (g?.id != null && name) out.push({ id: String(g.id), name })
        }
        url = j?.results?.nextPage ?? j?.nextPage ?? j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
      }
    } catch (err) { return json({ error: String(err) }, 502) }
    out.sort((a, b2) => a.name.localeCompare(b2.name))
    return json({ caregivers_total: total, active: out.length, caregivers: out,
      ...(url ? { truncated: true, note: 'more pages existed than the cap — list is PARTIAL' } : {}) })
  }

  /* Mode 3: one client's profile note, to prefill the {care} synopsis from
     what's already maintained in AxisCare (Samantha: the client's Open Visit
     Note is exactly this text). The API exposes `priorityNote` on the client
     record — believed to be that field; the first prefill against a client
     with a known note (Steve, id 13) confirms or corrects the mapping. */
  if (b.client_lookup != null) {
    const clId = String(b.client_lookup).trim()
    if (!/^\d+$/.test(clId)) return json({ error: 'client_lookup must be a numeric client id' }, 400)
    const { token, site } = axisCreds()
    if (!token || !site) return json({ error: 'AxisCare credentials not set on this project' }, 502)
    try {
      const r = await fetch(`https://${site}.axiscare.com/api/clients/${encodeURIComponent(clId)}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json',
                   'X-AxisCare-Api-Version': AC_VERSION } })
      // deno-lint-ignore no-explicit-any
      const j: any = await r.json().catch(() => ({}))
      if (!r.ok || j?.success === false) return json({ error: `AxisCare responded ${r.status}` }, 502)
      const cl = j?.results?.client ?? j?.results ?? {}
      return json({
        id: clId,
        name: [String(cl?.firstName ?? '').trim(), String(cl?.lastName ?? '').trim()].filter(Boolean).join(' '),
        city: String(cl?.residentialAddress?.city ?? '') || null,
        priority_note: String(cl?.priorityNote ?? '') || null,
      })
    } catch (err) { return json({ error: String(err) }, 502) }
  }

  /* Mode 5: THE INTAKE MATCHER — "who could staff Mon/Wed/Fri mornings?"
     answered while the lead is still on the phone. Composes the live active
     census (level classes, nurses excluded), each caregiver's self-declared
     availability windows, their hunger for hours, and — when a client id is
     given — their visit history with that client. Ranking: how much of the
     asked schedule they cover, then how many hours short of target they
     are. Caregivers with no availability on file are listed separately as
     "worth asking" — absence of data is not a no. */
  if (b.match && typeof b.match === 'object') {
    const wantDays: string[] = (Array.isArray(b.match.days) ? b.match.days : [])
      .map((d: unknown) => String(d).toLowerCase()).filter((d: string) =>
        ['mon','tue','wed','thu','fri','sat','sun'].includes(d))
    const wantWins: string[] = (Array.isArray(b.match.windows) ? b.match.windows : [])
      .map((w: unknown) => String(w).toLowerCase()).filter((w: string) =>
        ['morning','afternoon','evening','overnight'].includes(w))
    if (!wantDays.length || !wantWins.length)
      return json({ error: 'pick at least one day and one time window' }, 400)
    const needLevel = [1, 2, 3].includes(Number(b.match.level)) ? Number(b.match.level) : null
    const combos = wantDays.flatMap(d => wantWins.map(w => d + ':' + w))

    const { token, site } = axisCreds()
    if (!token || !site) return json({ error: 'AxisCare credentials not set on this project' }, 502)

    // Active census with levels; nurses out.
    const levelOf = (classes: any): number | null => {
      let best: number | null = null
      for (const c of rowsOf(classes)) {
        const t = String((c as any)?.label ?? (c as any)?.code ?? '').toLowerCase()
        const m = t.match(/level\s*([123])/)
        const lv = m ? Number(m[1]) : /complex/.test(t) ? 3 : /personal\s*care/.test(t) ? 2 : /wellness/.test(t) ? 1 : null
        if (lv != null && (best == null || lv > best)) best = lv
      }
      return best
    }
    const active = new Map<string, { name: string; level: number | null }>()
    let url: string | null = `https://${site}.axiscare.com/api/caregivers`
    try {
      for (let page = 0; url && page < 12; page++) {
        const r: Response = await fetch(url, { headers: {
          Authorization: `Bearer ${token}`, Accept: 'application/json',
          'X-AxisCare-Api-Version': AC_VERSION } })
        if (!r.ok) return json({ error: `AxisCare responded ${r.status}` }, 502)
        // deno-lint-ignore no-explicit-any
        const j: any = await r.json().catch(() => ({}))
        for (const g of rowsOf(j?.results?.caregivers ?? j?.caregivers)) {
          if (g?.status?.active !== true || g?.id == null) continue
          const isNurse = rowsOf(g?.classes).some((k: any) =>
            /nurse|\bRN\b|\bLPN\b/i.test(String(k?.label ?? k?.code ?? '')))
          if (isNurse) continue
          const nm = [String(g?.firstName ?? '').trim(), String(g?.lastName ?? '').trim()].filter(Boolean).join(' ')
          if (nm) active.set(String(g.id), { name: nm, level: levelOf(g?.classes) })
        }
        url = j?.results?.nextPage ?? j?.nextPage ?? j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
      }
    } catch (err) { return json({ error: String(err) }, 502) }

    // Availability + scheduled next 7d + optional client history, via the DB
    // and one visits sweep each.
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2')
    const sb2 = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: avRow } = await sb2.from('app_data').select('data').eq('key', 'caregiver_availability').maybeSingle()
    // deno-lint-ignore no-explicit-any
    const av: any[] = Array.isArray(avRow?.data) ? avRow!.data : []
    const avById = new Map(av.map((a: any) => [String(a.axiscare_id ?? a.id), a]))

    const fetchVisitRows = async (params: string): Promise<any[]> => {
      const rows: any[] = []
      let u: string | null = `https://${site}.axiscare.com/api/visits?${params}`
      for (let page = 0; u && page < 12; page++) {
        const r: Response = await fetch(u, { headers: {
          Authorization: `Bearer ${token}`, Accept: 'application/json',
          'X-AxisCare-Api-Version': AC_VERSION } })
        if (!r.ok) break
        // deno-lint-ignore no-explicit-any
        const j: any = await r.json().catch(() => ({}))
        for (const v of rowsOf(j?.results?.visits ?? j?.visits)) if (!v?.removed) rows.push(v)
        u = j?.results?.nextPage ?? j?.nextPage ?? j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
      }
      return rows
    }
    const start = chiToday()
    const end7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
    const sched = new Map<string, number>()
    for (const v of await fetchVisitRows(`startDate=${start}&endDate=${end7}`)) {
      const id = v?.caregiver?.id; if (id == null) continue
      const s = new Date(String(v?.scheduledStartDate ?? v?.startDate ?? '')).getTime()
      const e = new Date(String(v?.scheduledEndDate ?? v?.endDate ?? '')).getTime()
      if (Number.isFinite(s) && Number.isFinite(e) && e > s)
        sched.set(String(id), (sched.get(String(id)) ?? 0) + (e - s) / 3600000)
    }
    const knowsClient = new Map<string, number>()
    const clientId = String(b.match.client_axiscare_id ?? '').trim()
    if (/^\d+$/.test(clientId)) {
      const back = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10)
      for (const v of await fetchVisitRows(`clientIds=${clientId}&startDate=${back}&endDate=${start}`)) {
        const id = v?.caregiver?.id; if (id == null) continue
        knowsClient.set(String(id), (knowsClient.get(String(id)) ?? 0) + 1)
      }
    }

    const matches: any[] = []
    const worthAsking: any[] = []
    for (const [id, g] of active) {
      if (needLevel != null && g.level != null && g.level < needLevel) continue
      const a = avById.get(id)
      const schedH = Math.round((sched.get(id) ?? 0) * 10) / 10
      const base = {
        name: g.name, axiscare_id: id, level: g.level,
        level_unknown: g.level == null,
        scheduled_next_week: schedH,
        knows_client_visits: knowsClient.get(id) ?? 0,
      }
      if (!a || !a.windows) { worthAsking.push(base); continue }
      const have = new Set<string>()
      for (const [d, ws] of Object.entries(a.windows as Record<string, string[]>))
        for (const w of (ws || [])) have.add(d + ':' + w)
      const covered = combos.filter(cb => have.has(cb))
      if (!covered.length) continue
      const target = Number(a.target_hours)
      matches.push({ ...base,
        covers: `${covered.length}/${combos.length}`,
        covers_n: covered.length,
        covered_slots: covered,
        target_hours: Number.isFinite(target) ? target : null,
        hours_short: Number.isFinite(target) ? Math.round((target - schedH) * 10) / 10 : null,
      })
    }
    matches.sort((x, y) => (y.knows_client_visits - x.knows_client_visits)
      || (y.covers_n - x.covers_n) || ((y.hours_short ?? -999) - (x.hours_short ?? -999)))
    worthAsking.sort((x, y) => y.knows_client_visits - x.knows_client_visits)
    return json({ asked_for: { days: wantDays, windows: wantWins, level: needLevel },
      matches, worth_asking_no_availability: worthAsking.slice(0, 20) })
  }

  /* Mode 4: Hours Watch — scheduled hours in the next 7 days per caregiver,
     summed from the visit windows. The board pairs this with what each
     caregiver SAYS they want (caregiver_availability) to show the gap. */
  if (b.hours_watch === true) {
    const { token, site } = axisCreds()
    if (!token || !site) return json({ error: 'AxisCare credentials not set on this project' }, 502)
    const startDate = chiToday()
    const endDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
    const hours = new Map<string, number>()
    let url: string | null = `https://${site}.axiscare.com/api/visits?startDate=${startDate}&endDate=${endDate}`
    try {
      for (let page = 0; url && page < 12; page++) {
        const r: Response = await fetch(url, { headers: {
          Authorization: `Bearer ${token}`, Accept: 'application/json',
          'X-AxisCare-Api-Version': AC_VERSION } })
        if (!r.ok) return json({ error: `AxisCare responded ${r.status}` }, 502)
        // deno-lint-ignore no-explicit-any
        const j: any = await r.json().catch(() => ({}))
        for (const v of rowsOf(j?.results?.visits ?? j?.visits)) {
          if (v?.removed || v?.caregiver?.id == null) continue
          const s = new Date(String(v?.scheduledStartDate ?? v?.startDate ?? '')).getTime()
          const e = new Date(String(v?.scheduledEndDate ?? v?.endDate ?? '')).getTime()
          if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue
          const id = String(v.caregiver.id)
          hours.set(id, (hours.get(id) ?? 0) + (e - s) / 3600000)
        }
        url = j?.results?.nextPage ?? j?.nextPage ?? j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
      }
    } catch (err) { return json({ error: String(err) }, 502) }
    return json({ window: `${startDate} → ${endDate}`,
      scheduled_hours: Object.fromEntries([...hours.entries()].map(([k, v]) => [k, Math.round(v * 10) / 10])),
      ...(url ? { truncated: true } : {}) })
  }

  const cgId = String(b.caregiver_axiscare_id || '').trim()
  if (!/^\d+$/.test(cgId)) return json({ error: 'caregiver_axiscare_id (numeric) required' }, 400)
  const days = Number(b.days) > 0 && Number(b.days) <= 30 ? Number(b.days) : 14

  const { token, site } = axisCreds()
  if (!token || !site) return json({ error: 'AxisCare credentials not set on this project' }, 502)

  const startDate = chiToday()   // Chicago, not UTC: at 8pm the UTC date is tomorrow
  const endDate = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
  // deno-lint-ignore no-explicit-any
  const out: any[] = []
  let url: string | null =
    `https://${site}.axiscare.com/api/visits?caregiverIds=${encodeURIComponent(cgId)}&startDate=${startDate}&endDate=${endDate}`
  try {
    for (let page = 0; url && page < 6; page++) {
      const r: Response = await fetch(url, { headers: {
        Authorization: `Bearer ${token}`, Accept: 'application/json',
        'X-AxisCare-Api-Version': AC_VERSION } })
      if (!r.ok) return json({ error: `AxisCare responded ${r.status}` }, 502)
      // deno-lint-ignore no-explicit-any
      const j: any = await r.json().catch(() => ({}))
      for (const v of rowsOf(j?.results?.visits ?? j?.visits)) {
        if (v?.removed) continue
        const start = String(v?.scheduledStartDate ?? v?.startDate ?? '')
        const end = String(v?.scheduledEndDate ?? v?.endDate ?? '')
        out.push({
          visit_id: String(v?.id ?? ''),
          client_axiscare_id: v?.client?.id != null ? String(v.client.id) : null,
          client: [String(v?.client?.firstName ?? '').trim(), String(v?.client?.lastName ?? '').trim()]
            .filter(Boolean).join(' ') || '(no client name on the visit)',
          date: start.slice(0, 10),
          time: [start.slice(11, 16), end.slice(11, 16)].filter(Boolean).join('-'),
        })
      }
      url = j?.results?.nextPage ?? j?.nextPage ?? j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
    }
  } catch (err) { return json({ error: String(err) }, 502) }

  out.sort((a, b2) => (a.date + a.time).localeCompare(b2.date + b2.time))
  return json({ caregiver_axiscare_id: cgId, window: `${startDate} → ${endDate}`, shifts: out,
    ...(url ? { truncated: true, note: 'more pages existed than the cap — list is PARTIAL' } : {}) })
})
