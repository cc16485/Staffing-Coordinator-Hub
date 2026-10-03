// =============================================================================
// 431 · "Call in LeadConnector": find a client's EXISTING GoHighLevel contact so the office can call from the
// business number in the LeadConnector app. GHL has no API to start a call, so the page opens the contact and a
// person taps Call there.
// =============================================================================
// READ ONLY. This never creates, updates or tags a GHL contact and never sends anything (GET requests only).
//   1. A link the Hub already holds: person_source_id axiscare/client -> the same person's ghl/client link,
//      confirmed and not waiting for review. Exactly one such contact id, or it is not used.
//   2. Otherwise a GHL search by the client's phone (last 10 digits must match the contact's phone) and email
//      (exact match). Exactly ONE distinct contact across both, or nothing: no match, or a shared line with several
//      contacts, gives no GHL button (the page offers the cell phone instead). Software never picks between people.
// Returns only the contact id and the two links (the app's domain, which the LeadConnector app may open, and the
// white-label browser domain). Used for every staff click-to-call in the Hub (Samantha 2026-10-03: "it should call
// from leadconnector app, or just have it say call from office line").
// =============================================================================
const GHL = 'https://services.leadconnectorhq.com'
export const GHL_APP_HOST = 'https://app.leadconnectorhq.com'
export const GHL_WEB_HOST = 'https://app.hirecara.com'
export type GhlLink = { contact_id: string; app_url: string; web_url: string }

const ten = (raw: unknown) => String(raw ?? '').replace(/\D/g, '').slice(-10)
const mail = (raw: unknown) => { const s = String(raw ?? '').trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : '' }
const safeId = (s: unknown) => /^[A-Za-z0-9_-]{1,64}$/.test(String(s ?? '')) ? String(s) : ''

export function ghlContactUrls(locationId: string, contactId: string): GhlLink | null {
  const loc = safeId(locationId), id = safeId(contactId)
  if (!loc || !id) return null
  const p = `/v2/location/${loc}/contacts/detail/${id}`
  return { contact_id: id, app_url: GHL_APP_HOST + p, web_url: GHL_WEB_HOST + p }
}

// deno-lint-ignore no-explicit-any
async function storedLink(db: any, axiscareClientId: string): Promise<string> {
  if (!axiscareClientId) return ''
  try {
    const { data: ax } = await db.from('person_source_id').select('person_id')
      .eq('system', 'axiscare').eq('entity_type', 'client').eq('source_id', axiscareClientId)
    const pids = [...new Set((ax ?? []).map((r: { person_id: string }) => String(r.person_id)))]
    if (pids.length !== 1) return ''
    const { data: g } = await db.from('person_source_id').select('source_id, confidence, needs_review')
      .eq('person_id', pids[0]).eq('system', 'ghl').eq('entity_type', 'client')
    const ids = [...new Set((g ?? []).filter((r: { confidence: string; needs_review: boolean }) => r.confidence === 'confirmed' && !r.needs_review)
      .map((r: { source_id: string }) => String(r.source_id)))]
    return ids.length === 1 ? ids[0] : ''
  } catch { return '' }
}

export type GhlFind = ({ found: true } & GhlLink) | { found: false; why: 'no_number' | 'not_found' | 'several' | 'error' | 'not_set_up' }
const WHY = (why: 'no_number' | 'not_found' | 'several' | 'error' | 'not_set_up'): GhlFind => ({ found: false, why })

/** Find ONE existing GHL contact for a person (read only). Used by clockin-alert, late-alert and ghl-call-link. */
export async function ghlFindContact(
  // deno-lint-ignore no-explicit-any
  db: any, ghl: { token: string; locationId: string },
  who: { axiscareClientId?: unknown; phone?: unknown; email?: unknown }, send: typeof fetch = fetch): Promise<GhlFind> {
  if (!safeId(ghl.locationId)) return WHY('not_set_up')
  const stored = db ? await storedLink(db, String(who.axiscareClientId ?? '').trim()) : ''
  if (stored) { const u = ghlContactUrls(ghl.locationId, stored); if (u) return { found: true, ...u } }
  if (!ghl.token) return WHY('not_set_up')
  const phone = ten(who.phone), email = mail(who.email)
  if (phone.length !== 10 && !email) return WHY('no_number')
  const h = { Authorization: `Bearer ${ghl.token}`, Version: '2021-07-28', Accept: 'application/json' }
  const found = new Set<string>()
  // deno-lint-ignore no-explicit-any
  const search = async (query: string, keep: (c: any) => boolean): Promise<boolean> => {
    try {
      const r = await send(`${GHL}/contacts/?` + new URLSearchParams({ locationId: ghl.locationId, query, limit: '20' }), { method: 'GET', headers: h })
      if (!r.ok) return false
      const j = await r.json().catch(() => ({}))
      // deno-lint-ignore no-explicit-any
      for (const c of (j?.contacts ?? []) as any[]) if (c?.id && keep(c)) found.add(String(c.id))
      return true
    } catch { return false }
  }
  if (phone.length === 10 && !(await search(phone, (c) => ten(c.phone) === phone))) return WHY('error')
  if (email && !(await search(email, (c) => mail(c.email) === email))) return WHY('error')
  if (found.size > 1) return WHY('several')
  const u = found.size === 1 ? ghlContactUrls(ghl.locationId, [...found][0]) : null
  return u ? { found: true, ...u } : WHY('not_found')
}

/** For a link page's view: the contact id and both links, or null (no button; the page offers the cell phone). */
export async function ghlClientLink(
  // deno-lint-ignore no-explicit-any
  db: any, ghl: { token: string; locationId: string },
  client: { axiscareClientId?: unknown; phone?: unknown; email?: unknown }, send: typeof fetch = fetch): Promise<GhlLink | null> {
  const f = await ghlFindContact(db, ghl, client, send)
  return f.found ? { contact_id: f.contact_id, app_url: f.app_url, web_url: f.web_url } : null
}
