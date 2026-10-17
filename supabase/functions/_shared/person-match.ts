// =============================================================================
// person-match: who in a list is the same person (Samantha 2026-10-17: "match Family Circle people by email first, then name").
// A name alone mismatched people ("Bob" vs "Robert", a typo, a married name) and made second copies. Now:
//   1. the same email (any capitals, spaces trimmed): if exactly one person has it, that's them; if several share it (a couple
//      with one inbox), the one whose name also matches, otherwise none of them by email;
//   2. otherwise the same name (letters only, any capitals), as before.
// Pure, so the nightly AxisCare sync, the agreement's contact approval and the Hub screen all decide alike (Node tests).
// =============================================================================
// deno-lint-ignore no-explicit-any
type Any = any
export const emailKey = (v: unknown) => String(v ?? '').trim().toLowerCase()
export const nameKey = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/[^a-z]/g, '')

export function findPerson<T extends Any>(list: T[], who: { name?: unknown; email?: unknown }, get: { name?: (x: T) => unknown; email?: (x: T) => unknown } = {}): T | null {
  const nm = get.name ?? ((x: T) => (x as Any)?.name), em = get.email ?? ((x: T) => (x as Any)?.email)
  const e = emailKey(who.email), n = nameKey(who.name)
  if (e) {
    const byEmail = (list ?? []).filter((x) => emailKey(em(x)) === e)
    if (byEmail.length === 1) return byEmail[0]
    if (byEmail.length > 1) { const both = byEmail.filter((x) => n && nameKey(nm(x)) === n); if (both.length === 1) return both[0] }
  }
  if (!n) return null
  return (list ?? []).find((x) => nameKey(nm(x)) === n) ?? null
}
