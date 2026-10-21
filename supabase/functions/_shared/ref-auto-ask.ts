// =============================================================================
// ref-auto-ask.ts · the reference rows made by the server (Samantha 2026-10-21: "the Hub texts each reference automatically
// from the office line (with STOP to opt out), and the office calls when needed"; the approved design: "the Hub emails and
// texts each reference by itself"). Until now a row was made only when the office pressed Ask refs, so nothing started by
// itself. The readiness sweep now makes them for a new-path person whose Step 1 is complete (their signed permission is
// in), exactly as the Hub's createRefRequests does: one row per reference on file with a name and a phone or email whose
// answer is Pending, slot numbers 1 to 4, never a slot that already has a row. References they asked us not to contact
// never landed on the record (step1-sign landingPatch). ops_settings.refs_auto_ask_live (off = what it would make is
// recorded and counted, nothing is made). Pure: which rows, and their columns.
// deno-lint-ignore-file no-explicit-any
const refType = (v: unknown) => { const t = String(v ?? '').trim().toLowerCase(); return t === 'professional' ? 'professional' : t === 'personal' ? 'personal' : '' }
/** The Hub's obRefRequestRow, column for column. */
export function requestRow(c: any, n: number) {
  return { candidate_id: c.id, slot: n, candidate_name: `${c.first || ''} ${c.last || ''}`.trim(), candidate_phone: c.phone || null, candidate_email: c.email || null,
    ref_name: c['r' + n + 'n'] || null, ref_phone: c['r' + n + '_phone'] || null, ref_email: c['r' + n + '_email'] || null,
    ref_relationship: c['r' + n + '_rel'] || null, sent_at: null, ref_type: refType(c['r' + n + '_type']) || null, ref_company: c['r' + n + '_company'] || null }
}
/** Should the server ask this person's references, and which slots? existing = slot numbers that already have a row. */
export function autoAskSlots(c: any, step1Complete: boolean, existing: number[]): number[] {
  if (!c || c.not_hired || c.onboarding_path !== 'new' || !step1Complete || !/^\d{1,12}$/.test(String(c.id ?? ''))) return []
  return [1, 2, 3, 4].filter((n) => String(c['r' + n + 'n'] ?? '').trim() && (c['r' + n + '_phone'] || c['r' + n + '_email']) && (c['r' + n + 's'] || 'Pending') === 'Pending' && !existing.includes(n))
}
