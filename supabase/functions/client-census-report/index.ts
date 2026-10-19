// =============================================================================
// client-census-report — the AxisCare client census for the Clients directory, read-only
// =============================================================================
// Samantha, 2026-10-12: "Clients need to have a directory just like caregivers". The Clients tab now lists who
// AxisCare says exists, the way the Caregivers directory does (caregiver-census-report), and the Hub enriches that.
// Past clients are READ here when the office looks, never copied into the Hub (her 2026-09-27 "lock only" ruling).
// SEND-INCAPABLE by construction: its only outbound calls are AxisCare GETs, it writes nothing anywhere, and it
// answers only signed-in office staff. No phone, address, birth date or note leaves this function: name, status,
// care classes, city and the start date of care (2026-10-18, for client anniversaries) are all it sends.
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { OFFICE_ROLES, requireStaff } from '../_shared/staff-auth.ts'

function axisCreds() {
  const order = ['AXISCARE_API_KEY', 'AXISCARE_TOKEN', 'AXISCARE_VISITS_TOKEN']
  let token = ''
  for (const n of order) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site }
}
// deno-lint-ignore no-explicit-any
export const rowsOf = (x: any): any[] => Array.isArray(x) ? x : (x && typeof x === 'object' ? Object.values(x) : [])
const S = (v: unknown) => String(v ?? '').trim()

/** One AxisCare client row -> the directory's row. Only these fields ever leave. */
// deno-lint-ignore no-explicit-any
export function clientRow(c: any) {
  return {
    id: String(c.id),
    first: S(c.firstName), last: S(c.lastName), goes_by: S(c.goesBy),
    active: c?.status?.active === true,
    status_label: S(c?.status?.label),
    city: S(c?.residentialAddress?.city) || S(c?.mailingAddress?.city),
    // deno-lint-ignore no-explicit-any
    classes: rowsOf(c?.classes).map((k: any) => S(k?.label ?? k?.code)).filter(Boolean),
    // 2026-10-18 (Samantha, client anniversaries + Friday wins): the date care started, as AxisCare has it (a date only)
    start_date: /^\d{4}-\d\d-\d\d/.test(S(c?.startDate)) ? S(c?.startDate).slice(0, 10) : null,
  }
}

const cors = { 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const who = await requireStaff(admin, req, OFFICE_ROLES)
  if (!who.ok) return json({ error: who.error }, who.status)

  const { token, site } = axisCreds()
  if (!token || !site) return json({ error: 'AxisCare credentials not set' }, 502)

  // deno-lint-ignore no-explicit-any
  const out: any[] = []
  let url: string | null = `https://${site}.axiscare.com/api/clients`
  let pages = 0
  while (url && pages < 20) {
    pages++
    const r: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json',
      'X-AxisCare-Api-Version': Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01' } })
    if (!r.ok) return json({ error: `AxisCare responded ${r.status} on page ${pages}` }, 502)
    // deno-lint-ignore no-explicit-any
    const j: any = await r.json().catch(() => ({}))
    for (const c of rowsOf(j?.results?.clients ?? j?.clients)) { if (c?.id != null) out.push(clientRow(c)) }
    url = j?.results?.nextPage ?? j?.nextPage ?? j?.results?.nextPageUrl ?? j?.nextPageUrl ?? null
  }
  return json({ total: out.length, truncated: !!url, clients: out })
})
