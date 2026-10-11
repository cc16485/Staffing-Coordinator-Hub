// =============================================================================
// doc-log.ts · SLICE 8 (Samantha "yes to all", 2026-10-11): every staff open of a client document is a row in
// document_access_log (append-only), the same table that holds the offer, Step 1 and personnel-file opens. The subject goes
// in offer_id (the column's historical name): 'client:<AxisCare id>', 'client:L<lead id>' or 'client:J<journey id>'.
// Never throws; the caller decides whether a failed log blocks the open (the exports do; a single file open does not).
// deno-lint-ignore-file no-explicit-any
export type Opener = { person_id?: string; email?: string; name?: string }
export const clientSubject = (ax: unknown, lead: unknown, journey?: unknown) =>
  /^\d{1,12}$/.test(String(ax ?? '')) ? 'client:' + String(ax) : lead ? 'client:L' + String(lead) : 'client:J' + String(journey ?? '')
export async function logOpen(db: any, r: { subject: string; doc: string; path: string; who: Opener; reason?: string | null; ip?: string | null }): Promise<boolean> {
  try {
    const { error } = await db.from('document_access_log').insert({ offer_id: String(r.subject).slice(0, 120), doc: String(r.doc).slice(0, 60), path: String(r.path).slice(0, 500),
      by_person: r.who.person_id || null, by_email: r.who.email || null, by_name: r.who.name || null, ip: r.ip || null, reason: r.reason ? String(r.reason).slice(0, 200) : null })
    return !error
  } catch { return false }
}
export const ipOf = (req: Request) => req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || ''
