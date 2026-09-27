// =============================================================================
// client-lookup matching (One client profile, step 5b B + D, 2026-09-27)
// =============================================================================
// "Is this family already known?" Pure functions, so the rules are tested apart from AxisCare.
// Software suggests; a person decides. Nothing here merges, links or writes.
//
//   phone        the caller's or client's number is the client's own AxisCare number
//   family_phone the number belongs to someone in that client's Family Circle
//   name_dob     same first name, last name and birth date
//   dob_last     same last name and birth date, different first name (Bill / William)
//   name_only    same first and last name, a birth date missing on one side: a HINT only
// Same name with two different birth dates is two different people, and is not shown.
// =============================================================================
export type Why = 'phone' | 'family_phone' | 'name_dob' | 'dob_last' | 'name_only'
export const STRENGTH: Record<Why, number> = { phone: 3, family_phone: 3, name_dob: 3, dob_last: 2, name_only: 1 }
export type Match = { axiscare_client_id: string | null; name: string; active: boolean | null; status: string;
  why: Why[]; family?: string[]; strength: number }

export const last10 = (raw: unknown): string => {
  const d = String(raw ?? '').replace(/\D/g, '')
  return d.length >= 10 ? d.slice(-10) : ''
}
export const nameKey = (raw: unknown): string => String(raw ?? '').trim().toLowerCase().replace(/[^a-z]/g, '')
export const dateKey = (raw: unknown): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw ?? '').trim())
  return m ? `${m[1]}-${m[2]}-${m[3]}` : ''
}

export type Query = { phones: string[]; first: string; last: string; dob: string }
export function cleanQuery(b: Record<string, unknown>): Query {
  const phones = (Array.isArray(b.phones) ? b.phones : []).map(last10).filter(Boolean)
  return { phones: [...new Set(phones)].slice(0, 4), first: nameKey(b.first), last: nameKey(b.last), dob: dateKey(b.dob) }
}

// deno-lint-ignore no-explicit-any
export function matchClient(q: Query, c: any): Why[] {
  const why: Why[] = []
  const own = [c?.homePhone, c?.mobilePhone, c?.otherPhone].map(last10).filter(Boolean)
  if (q.phones.some((p) => own.includes(p))) why.push('phone')
  const f = nameKey(c?.firstName), l = nameKey(c?.lastName), g = nameKey(c?.goesBy), d = dateKey(c?.dateOfBirth)
  const sameLast = !!q.last && q.last === l
  const sameFirst = !!q.first && (q.first === f || (!!g && q.first === g))
  if (sameLast && sameFirst) {
    if (q.dob && d) { if (q.dob === d) why.push('name_dob') }   // two different birth dates: two people
    else why.push('name_only')
  } else if (sameLast && q.dob && d && q.dob === d) why.push('dob_last')
  return why
}

export function rank(list: Match[], max = 10): Match[] {
  return list.sort((a, b) => b.strength - a.strength || Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)).slice(0, max)
}

/* ── the lookup itself (moved here 5b C so the automatic entries use the same rules) ── */
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
