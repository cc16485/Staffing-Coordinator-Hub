// =============================================================================
// AUDIENCE GUARD (Samantha 2026-10-07: "Deceased clients and their family contacts must never accidentally enter a
// campaign because of an AxisCare status, old lead status, email address, or any other audience rule.")
// =============================================================================
// One decision for every campaign email, used by campaign-send (every Hub send, any list, a pasted list too) and by
// campaign-auto (its audiences). For each email address it works out whose it is and that client's care state:
//   active · starting (said yes, start of care under way) · paused · past · deceased
// from AxisCare (each client's own status), the Hub's client records (person_role: an ended role, end_reason deceased),
// Family Circles (a family contact belongs to its client), and inquiries (the family who called, through the AxisCare
// number on the inquiry or its client journey). The strictest answer wins: anything deceased anywhere = deceased.
// Her rules:
//   · client and family campaigns ('client', 'client-contact'): only people tied to an ACTIVE or STARTING client.
//     Anyone we can't tie to one is left out (fail closed).
//   · every campaign, any audience: never anyone tied to a DECEASED, PAST or PAUSED client.
// Former-client outreach, if ever wanted, is a separate audience to be designed on purpose (not built).
// =============================================================================
// deno-lint-ignore no-explicit-any
type Any = any
export type CareState = 'active' | 'starting' | 'paused' | 'past' | 'deceased'
const RANK: Record<CareState, number> = { active: 0, starting: 1, paused: 2, past: 3, deceased: 4 }
const lc = (s: unknown) => String(s ?? '').trim().toLowerCase()
const stricter = (a: CareState | null, b: CareState | null): CareState | null => !a ? b : !b ? a : (RANK[a] >= RANK[b] ? a : b)

/** AxisCare's own status for a client (an object {active, label} or a word) -> a care state */
export function axState(c: Any): CareState | null {
  const s = c?.status, label = lc(typeof s === 'object' && s ? (s.label ?? s.name ?? '') : (s ?? c?.statusLabel ?? c?.status_label ?? ''))
  if (/deceas|passed|died|death/.test(label)) return 'deceased'
  if (/lead|prospect|inquir|pending/.test(label)) return null   // not a client yet
  if (/hold|pause|hospital|suspend/.test(label)) return 'paused'
  const active = typeof s === 'object' && s && typeof s.active === 'boolean' ? s.active : /^(active|current)$/.test(label)
  return active ? 'active' : 'past'
}
/** the Hub's client roles for one person -> a care state (null when the Hub has no client role for them) */
export function roleState(roles: Any[]): CareState | null {
  const mine = (roles || []).filter((r: Any) => r && r.role === 'client'); if (!mine.length) return null
  if (mine.some((r: Any) => /deceas/.test(lc(r.end_reason)))) return 'deceased'
  if (mine.some((r: Any) => lc(r.status) === 'paused')) return 'paused'
  if (mine.some((r: Any) => lc(r.status) === 'active')) return 'active'
  return 'past'
}
const isEmail = (e: unknown) => /@/.test(String(e ?? ''))
const emailsOf = (x: Any) => [x?.personalEmail, x?.email, x?.workEmail, x?.otherEmail].filter(isEmail).map(lc)

/** pure: every input already loaded -> email -> state (strictest) */
export function classify(inp: { axClients: Any[]; links: Any[]; roles: Any[]; circles: Any[]; contacts: Any[]; leads: Any[]; journeys: Any[]; pauses?: Any[] }) {
  const byAx = new Map<string, CareState>()
  for (const c of inp.axClients || []) { const id = String(c?.id ?? ''), st = axState(c); if (id && st) byAx.set(id, st) }
  /* the Hub's own record of a client: an ended or deceased role overrides an AxisCare "Active" */
  const rolesByPerson = new Map<string, Any[]>(); for (const r of inp.roles || []) { const k = String(r.person_id); rolesByPerson.set(k, [...(rolesByPerson.get(k) || []), r]) }
  for (const l of inp.links || []) {
    const ax = String(l.source_id ?? ''), rs = roleState(rolesByPerson.get(String(l.person_id)) || [])
    if (!ax || !rs) continue
    const cur = byAx.get(ax) ?? null
    byAx.set(ax, rs === 'active' && cur && cur !== 'active' ? cur : (rs === 'active' ? (cur ?? 'active') : stricter(cur, rs)!))
  }
  /* Pause care (2026-10-07): an open pause is the state Paused, whatever AxisCare says */
  for (const p of inp.pauses || []) { const ax = String(p.axiscare_client_id ?? ''); if (ax) byAx.set(ax, stricter(byAx.get(ax) ?? null, 'paused')!) }
  /* a start of care under way (said yes, journey open) counts as starting, unless anything else is stricter */
  const journeyByLead = new Map<string, Any>(); for (const j of inp.journeys || []) { if (j.lead_id) journeyByLead.set(String(j.lead_id), j) }
  /* a returning client has an older, closed journey and a new one: the new (not closed) one is what counts */
  const openAx = new Set((inp.journeys || []).filter((j: Any) => !j.is_test && j.axiscare_client_id && j.status !== 'closed').map((j: Any) => String(j.axiscare_client_id)))
  for (const j of inp.journeys || []) {
    if (j.is_test || !j.axiscare_client_id) continue
    if (j.status === 'closed' && openAx.has(String(j.axiscare_client_id))) continue
    const ax = String(j.axiscare_client_id), cur = byAx.get(ax) ?? null
    /* only a journey closed because CARE ENDED makes a past client; one closed because the inquiry was lost never started care */
    if (j.status === 'closed') { if (/^Care ended/.test(j.closed_reason || '')) byAx.set(ax, stricter(cur, /deceas/i.test(j.closed_reason || '') ? 'deceased' : 'past')!) }
    else if (!cur) byAx.set(ax, 'starting')
  }
  const out = new Map<string, CareState>()
  const put = (e: string, st: CareState | null) => { if (st) out.set(e, stricter(out.get(e) ?? null, st)!) }
  for (const c of inp.axClients || []) for (const e of emailsOf(c)) put(e, byAx.get(String(c.id)) ?? null)
  const circleAx = new Map<string, string>(); for (const c of inp.circles || []) circleAx.set(String(c.id), String(c.axiscare_client_id ?? ''))
  for (const k of inp.contacts || []) { const ax = circleAx.get(String(k.circle_id)); if (!ax) continue; for (const e of emailsOf(k)) put(e, byAx.get(ax) ?? null) }
  for (const l of inp.leads || []) {
    const es = emailsOf(l); if (!es.length) continue
    const j = journeyByLead.get(String(l.id))
    const ax = String(l.axiscare_client_id || j?.axiscare_client_id || '').trim()
    let st: CareState | null = ax ? byAx.get(ax) ?? null : null
    if (j && !j.is_test) {
      if (j.status === 'closed') { if (/^Care ended/.test(j.closed_reason || '')) st = stricter(st, /deceas/i.test(j.closed_reason || '') ? 'deceased' : 'past') }
      else if (j.status === 'active') st = stricter(st, 'active')
      else if (l.said_yes_at || lc(l.status) === 'converted') st = stricter(st, 'starting')
    }
    /* an inquiry marked won long ago with nothing we can tie it to is not a current client */
    if (!st && lc(l.status) === 'converted') st = 'past'
    for (const e of es) put(e, st)
  }
  return out
}
/** may this email get a campaign with this tag? */
export function verdict(state: CareState | null, tag: string): { ok: boolean; why?: string } {
  if (state === 'deceased') return { ok: false, why: 'tied to a client who has died' }
  /* our own caregivers' emails (staff news) only ever drop out for a death in the family they cared for */
  if (tag === 'caregiver') return { ok: true }
  if (state === 'past') return { ok: false, why: 'tied to a past client' }
  if (state === 'paused') return { ok: false, why: 'tied to a client whose care is paused' }
  const clientish = tag === 'client' || tag === 'client-contact'
  if (clientish && state !== 'active' && state !== 'starting') return { ok: false, why: 'not tied to a current client' }
  return { ok: true }
}
/** load everything the guard needs (service role). AxisCare is read live; if it can't be read, client and family sends stop. */
export async function loadGuard(db: Any): Promise<{ stateOf: (email: string) => CareState | null; axOk: boolean }> {
  const token = Deno.env.get('AXISCARE_API_KEY') ?? Deno.env.get('AXISCARE_TOKEN') ?? ''
  const site = Deno.env.get('AXISCARE_SITE') ?? Deno.env.get('AXISCARE_SITE_NUMBER') ?? ''
  const axClients: Any[] = []; let axOk = false
  if (token && /^\d+$/.test(site)) {
    try {
      let url: string | null = `https://${site}.axiscare.com/api/clients`
      for (let page = 0; url && page < 25; page++) {
        const r: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'X-AxisCare-Api-Version': '2023-10-01' } })
        if (!r.ok) throw new Error('AxisCare ' + r.status)
        const j: Any = await r.json().catch(() => ({}))
        const list = j?.results?.clients ?? j?.clients ?? []
        axClients.push(...(Array.isArray(list) ? list : Object.values(list)))
        url = j?.results?.nextPage ?? j?.nextPage ?? null
      }
      axOk = true
    } catch { axOk = false }
  }
  const sel = async (t: string, cols: string, f?: (q: Any) => Any) => { try { let q = db.from(t).select(cols); if (f) q = f(q); const { data } = await q; return data ?? [] } catch { return [] } }
  const [links, roles, circles, contacts, journeys, pauses, leadRow] = await Promise.all([
    sel('person_source_id', 'person_id, source_id', (q) => q.eq('system', 'axiscare').eq('entity_type', 'client')),
    sel('person_role', 'person_id, role, status, end_reason', (q) => q.eq('role', 'client')),
    sel('care_circles', 'id, axiscare_client_id'), sel('circle_contacts', 'circle_id, email'),
    sel('client_journey', 'lead_id, axiscare_client_id, status, closed_reason, is_test'),
    sel('client_pause', 'axiscare_client_id', (q) => q.eq('status', 'open')),
    (async () => { try { const { data } = await db.from('app_data').select('data').eq('key', 'leads').maybeSingle(); return Array.isArray(data?.data) ? data.data : [] } catch { return [] } })()])
  const map = classify({ axClients, links, roles, circles, contacts, leads: leadRow, journeys, pauses })
  return { stateOf: (e: string) => map.get(lc(e)) ?? null, axOk }
}
