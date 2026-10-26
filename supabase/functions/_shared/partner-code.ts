// =============================================================================
// Partner links (Referral Partner Program, step 1 of the tracking build, 2026-10-26)
// =============================================================================
// Her approved workflow (v2, 2026-10-26): every partner has a short code (mo-care.com/r/?p=JANE-K7). The website keeps
// the code in the family's browser for 90 days (first link wins) and sends it with any form. Here the server decides
// what the code may do to the new inquiry:
//   - the code must match exactly ONE saved partner (referral_orgs item, partner_code), not archived, not paused;
//     anything else (unknown, paused, two partners with the same code) links nobody and is noted for the owner
//   - a link NEVER overwrites a family's referral source: the partner is attached only when the family is
//     new to us, which means the "is this the same family?" check ran, found nobody, and AxisCare could be read.
//     Otherwise the inquiry keeps its normal source and carries partner_link_seen, plus a line in the notes, so the
//     history says "also came through Jane Smith's link" and the owner decides (Sources to check, in the Hub)
// Tracking only. Nothing here is about money, and nothing contacts the partner or the family.
// =============================================================================

// deno-lint-ignore no-explicit-any
type Org = Record<string, any>
export type PartnerMatch =
  | { status: 'linked'; code: string; org: Org }
  | { status: 'paused' | 'unknown' | 'ambiguous'; code: string; org?: Org }

/* letters, digits and dashes, 3 to 20 long, upper case; anything else is not a code */
export function normalCode(raw: unknown): string {
  const s = String(raw ?? '').trim().toUpperCase()
  return /^[A-Z0-9-]{3,20}$/.test(s) ? s : ''
}

export function matchPartner(orgs: Org[], code: string): PartnerMatch | null {
  if (!code) return null
  const hits = (orgs || []).filter((o) => o && !o.archived && normalCode(o.partner_code) === code)
  if (hits.length > 1) return { status: 'ambiguous', code }
  if (!hits.length) return { status: 'unknown', code }
  const org = hits[0]
  if (String(org.program_status || '').toLowerCase() === 'paused') return { status: 'paused', code, org }
  return { status: 'linked', code, org }
}

/* What the family inquiry gets. knownFamily: the returning check flagged it, threw, or couldn't read AxisCare. */
export function partnerFields(m: PartnerMatch | null, knownFamily: boolean, at: string): { fields: Record<string, unknown>; note: string } {
  if (!m) return { fields: {}, note: '' }
  const name = m.org ? String(m.org.name || 'a partner') : ''
  if (m.status === 'linked' && !knownFamily) {
    return { fields: { source: 'Referral', referral_org_id: String(m.org.id), referral_source_name: name, referral_via: 'link', partner_code: m.code },
      note: `Came through ${name}'s partner link (${m.code}).` }
  }
  const seen = { code: m.code, status: m.status, ...(m.org ? { org_id: String(m.org.id), org_name: name } : {}), at }
  const note = m.status === 'linked'
    ? `Also came through ${name}'s partner link (${m.code}). This may be a family we already know, so the referral source was not changed.`
    : m.status === 'paused'
      ? `Came through ${name}'s partner link (${m.code}), but that partner is paused, so no partner was attached.`
      : m.status === 'ambiguous'
        ? `The partner code on the form (${m.code}) belongs to more than one saved partner, so no partner was attached.`
        : `The partner code on the form (${m.code}) doesn't match a saved partner, so no partner was attached.`
  return { fields: { partner_link_seen: seen }, note }
}
