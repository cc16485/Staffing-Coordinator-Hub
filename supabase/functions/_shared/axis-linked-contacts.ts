// =============================================================================
// AxisCare Linked Contacts: the family members past the three responsible-party slots.
// Samantha 2026-10-26: "when a family has more than 3 contacts axiscare allows us to link contacts, in the case of Dan Probstfield he
// has 4 family members that need the access emails". AxisCare keeps at most three responsible parties per client; anyone else is
// added as a Contact and linked to the client in the web UI (Linked Contacts). The Customer API shows those links read-only, as the
// `clients` list on each contact (GET /api/contacts). This reads every active contact once and answers, per AxisCare client id,
// the emails linked to that client. Read only. null = AxisCare couldn't be read (callers treat that as "don't know", never "no").
// =============================================================================
import type { Ax } from './family-app.ts'

// deno-lint-ignore no-explicit-any
const rows = (x: any): any[] => Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : []   // the rowsOf lesson (circles-sync)

let cached: { at: number; map: Map<string, string[]> } | null = null   // read at most every 10 minutes per worker

export async function linkedEmailsByClient(ax: Ax, fresh = false): Promise<Map<string, string[]> | null> {
  if (!fresh && cached && Date.now() - cached.at < 600000) return cached.map
  const out = new Map<string, string[]>()
  let after = 0
  for (let page = 0; page < 40; page++) {
    const r = await ax('GET', `/api/contacts?statuses=Active&limit=500${after ? `&startAfterId=${after}` : ''}`)
    if (r.status !== 200 && r.status !== 207) return null
    const cs = rows(r.json?.results?.contacts)
    for (const c of cs) {
      const email = String(c?.email ?? '').trim().toLowerCase()
      if (!email) continue
      for (const k of rows(c?.clients)) {
        const id = String(k?.id ?? '').trim()
        if (!id) continue
        const list = out.get(id) ?? []
        if (!list.includes(email)) list.push(email)
        out.set(id, list)
      }
    }
    const last = Number(cs[cs.length - 1]?.id) || 0
    if (!r.json?.results?.nextPage || !last || last <= after) break
    after = last
  }
  cached = { at: Date.now(), map: out }
  return out
}
