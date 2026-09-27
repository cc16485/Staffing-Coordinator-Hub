// =============================================================================
// client-lookup · "Is this family already known?" (One client profile, 5b B + D, 2026-09-27)
// =============================================================================
// Read only. Signed-in staff. Checks AxisCare live (current AND inactive clients) and the Family
// Circle contacts, so a returning family is recognised without copying AxisCare's clients into the
// hub (AxisCare owns client identity). Returns names, AxisCare numbers, status and WHY it matched;
// never a phone number or a birth date. A person decides; nothing is linked or written here.
//
//   POST {action:'find', phones:[caller, client], first, last, dob}
//   → {ok, matches:[{axiscare_client_id, name, active, status, why[], family[]}], axiscare_ok, axiscare_error?}
// =============================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { cleanQuery, last10, matchClient, rank, STRENGTH, type Match, type Why } from '../_shared/client-lookup.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

export function jwtClaims(authHeader: string | null): { role: string | null; email: string | null } {
  const m = /^Bearer\s+(.+)$/.exec(authHeader ?? '')
  if (!m) return { role: null, email: null }
  const parts = m[1].split('.')
  if (parts.length !== 3) return { role: null, email: null }
  try {
    const p = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')))
    return { role: typeof p.role === 'string' ? p.role : null,
             email: typeof p.email === 'string' ? p.email.trim().toLowerCase() : null }
  } catch { return { role: null, email: null } }
}

/* every AxisCare client, current and inactive; stops (and says so) rather than return half a list */
// deno-lint-ignore no-explicit-any
export async function axClients(fetcher: typeof fetch = fetch): Promise<{ clients: any[]; error?: string }> {
  let token = ''
  for (const n of ['AXISCARE_API_KEY', 'AXISCARE_TOKEN', 'AXISCARE_VISITS_TOKEN']) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  if (!token || !/^\d+$/.test(site)) return { clients: [], error: 'AxisCare is not set up on this project' }
  const host = `https://${site}.axiscare.com`
  // deno-lint-ignore no-explicit-any
  const all: any[] = []
  let url: string | null = `${host}/api/clients`
  try {
    for (let page = 0; url && page < 20; page++) {
      const r: Response = await fetcher(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json',
        'X-AxisCare-Api-Version': Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01' } })
      if (!r.ok) return { clients: [], error: `AxisCare answered ${r.status}` }
      // deno-lint-ignore no-explicit-any
      const j: any = await r.json().catch(() => ({}))
      const rows = j?.results?.clients ?? j?.clients ?? []
      for (const c of (Array.isArray(rows) ? rows : Object.values(rows))) all.push(c)
      const next = j?.results?.nextPage ?? j?.nextPage ?? null
      if (next == null || next === '') url = null
      else if (typeof next === 'string' && next.startsWith(host + '/')) url = next
      else if (typeof next === 'string' && next.startsWith('/')) url = host + next
      else return { clients: [], error: 'AxisCare gave an unexpected next page' }
    }
  } catch (e) { return { clients: [], error: 'AxisCare could not be reached (' + String(e).slice(0, 80) + ')' } }
  if (url) return { clients: [], error: 'AxisCare has more clients than expected' }
  return { clients: all }
}

// deno-lint-ignore no-explicit-any
export async function find(body: Record<string, unknown>, db: any, fetcher: typeof fetch = fetch) {
  const q = cleanQuery(body)
  if (!q.phones.length && !(q.last && (q.first || q.dob))) return { ok: true, matches: [], axiscare_ok: true, note: 'nothing to look for' }
  const byAx = new Map<string, Match>()
  const add = (id: string | null, name: string, active: boolean | null, status: string, why: Why, family?: string) => {
    const key = id ?? 'circle:' + name.toLowerCase()
    const m = byAx.get(key) ?? { axiscare_client_id: id, name, active, status, why: [], family: [], strength: 0 }
    if (!m.why.includes(why)) m.why.push(why)
    if (family && !m.family!.includes(family)) m.family!.push(family)
    m.strength = Math.max(...m.why.map((w) => STRENGTH[w]))
    if (m.active == null && active != null) { m.active = active; m.status = status }
    byAx.set(key, m)
  }
  const ax = await axClients(fetcher)
  for (const c of ax.clients) {
    const id = String(c?.id ?? '').trim()
    const name = [c?.firstName, c?.lastName].map((x: unknown) => String(x ?? '').trim()).filter(Boolean).join(' ')
    if (!id || !name) continue
    const status = String(c?.status?.label ?? (c?.status?.active ? 'Active' : 'Inactive'))
    for (const w of matchClient(q, c)) add(id, name, c?.status?.active === true, status, w)
  }
  /* relatives: the Family Circle contacts (from AxisCare's responsible parties and staff), any circle */
  let circlesError: string | undefined
  if (q.phones.length) {
    /* every contact, a page at a time (numbers are stored in more than one format, so they are compared here) */
    // deno-lint-ignore no-explicit-any
    const contacts: any[] = []
    let error: { message: string } | null = null
    for (let from = 0; from < 50000; from += 1000) {
      const r = await db.from('circle_contacts').select('circle_id, name, relationship, phone').order('id').range(from, from + 999)
      if (r.error) { error = r.error; break }
      contacts.push(...(r.data ?? []))
      if (!r.data || r.data.length < 1000) break
    }
    if (error) circlesError = error.message
    else {
      // deno-lint-ignore no-explicit-any
      const hits = (contacts ?? []).filter((ct: any) => q.phones.includes(last10(ct.phone)))
      if (hits.length) {
        // deno-lint-ignore no-explicit-any
        const ids = [...new Set(hits.map((h: any) => h.circle_id))]
        const { data: circles, error: e2 } = await db.from('care_circles').select('id, client_name, axiscare_client_id, active').in('id', ids)
        if (e2) circlesError = e2.message
        // deno-lint-ignore no-explicit-any
        const cmap = new Map((circles ?? []).map((c: any) => [String(c.id), c]))
        for (const h of hits) {
          // deno-lint-ignore no-explicit-any
          const c: any = cmap.get(String(h.circle_id)); if (!c) continue
          const axId = String(c.axiscare_client_id ?? '').trim() || null
          // deno-lint-ignore no-explicit-any
          const known = axId ? ax.clients.find((x: any) => String(x?.id) === axId) : null
          const who = [String(h.name ?? '').trim(), String(h.relationship ?? '').trim()].filter(Boolean).join(', ')
          add(axId, String(c.client_name ?? known?.firstName ?? 'a Family Circle').trim(),
            known ? known?.status?.active === true : null, known ? String(known?.status?.label ?? '') : (c.active === false ? 'circle closed' : ''),
            'family_phone', who || undefined)
        }
      }
    }
  }
  const matches = rank([...byAx.values()])
  return { ok: true, matches, axiscare_ok: !ax.error, ...(ax.error ? { axiscare_error: ax.error } : {}),
    ...(circlesError ? { circles_error: circlesError } : {}) }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)
  const { role, email } = jwtClaims(req.headers.get('Authorization'))
  if (role !== 'authenticated' || !email) return json({ error: 'sign in to the hub first' }, 401)
  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  if (b.action !== 'find') return json({ error: "action must be 'find'" }, 400)
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  return json(await find(b, sb))
})
