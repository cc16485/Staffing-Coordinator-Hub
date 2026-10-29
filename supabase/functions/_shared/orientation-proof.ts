// =============================================================================
// orientation-proof.ts · "no caregiver is approved to work without verified orientation, while recognizing legitimate
// historical training records" (Samantha 2026-10-28). Only decisions here (no reads or writes), so every rule is tested.
// =============================================================================
// What counts as VERIFIED orientation, in this order:
//   certificate     the Training Platform holds the certificate PDF (finished on the platform, or made later from that
//                   completion record with its original date)
//   training_doc    the Training Platform has the completion entered after the fact WITH the document attached (an office
//                   admin entered it there, with the proof)
//   office_verified someone in the office looked at a historical completion document, uploaded it and confirmed it on
//                   the caregiver's record (who, when, the date it shows); no retraining needed
// Anything else is NOT verified, and says what would fix it:
//   needs_certificate  finished on the Training Platform, certificate never saved: make it from that completion record
//   needs_document     a completion date on the Hub record but no document behind it: verify a past record
//   in_progress        orientation started, not finished
//   missing            no orientation anywhere
// The audit looks at people AxisCare itself says are Active (so an Active set outside the Hub is caught). Nobody is ever
// deactivated by the Hub: the office decides. People on the excluded list (office staff, the "Canceled Shift" placeholder)
// are left out.
// =============================================================================
// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n)
const day = (v: unknown) => /^\d{4}-\d\d-\d\d/.test(S(v, 30)) ? S(v, 10) : ''
export const GENERIC_PROOF = 'https://training.mo-care.com'
/* her list (2026-10-28): Samantha Troutman, Zachary Troutman, Krystal Land, and the Canceled Shift placeholder */
export const DEFAULT_EXCLUDE = ['110', '604', '261', '618']

/* HER CONFIRMATION (2026-10-28): "all employees prior to start of axiscare completed their orientation". AxisCare started the
   week of 2026-08-17; anyone AxisCare shows hired before that counts as having completed orientation, on her word, with no
   document needed. The date and who confirmed it are settings (orientation_pre_axiscare_before / _by) so the office sees them. */
export const PRE_AXISCARE_BEFORE = '2026-08-17', PRE_AXISCARE_BY = 'Samantha Troutman, Oct 28, 2026'
export type Proof = { kind: 'certificate' | 'training_doc' | 'office_verified' | 'pre_axiscare'; ref: string | null; date: string; by: string | null; at: string | null }
export type Status = { state: 'verified' | 'needs_certificate' | 'needs_document' | 'in_progress' | 'missing'; date: string | null; proof: Proof | null; why: string; can_make_certificate: boolean }

/** One caregiver. roster: the Hub caregiver record (or null); t: their Training orientation { status, completed_at,
    completion_doc_path, certificate: boolean, training_id } (or null). */
export function orientationStatus(roster: Any, t: Any, pre: { hire_date?: string | null; before?: string | null; by?: string | null } | null = null): Status {
  const v = roster?.orient_verified && typeof roster.orient_verified === 'object' ? roster.orient_verified : null
  const tDone = t && S(t.status, 20) === 'complete' && day(t.completed_at)
  const rCert = S(roster?.orient_proof, 400)
  if (!t && day(roster?.orient_date) && rCert.startsWith('training:certificates/')) return { state: 'verified', date: day(roster.orient_date), proof: { kind: 'certificate', ref: rCert, date: day(roster.orient_date), by: 'Training Platform', at: null }, why: 'Certificate on file', can_make_certificate: false }
  if (tDone && t.certificate) return { state: 'verified', date: day(t.completed_at), proof: { kind: 'certificate', ref: t.training_id ? `training:certificates/${t.training_id}/agency-orientation.pdf` : null, date: day(t.completed_at), by: 'Training Platform', at: null }, why: 'Certificate on file', can_make_certificate: false }
  if (tDone && S(t.completion_doc_path, 300)) return { state: 'verified', date: day(t.completed_at), proof: { kind: 'training_doc', ref: 'training:' + S(t.completion_doc_path, 300), date: day(t.completed_at), by: S(t.completed_by, 80) || 'Training Platform admin', at: null }, why: 'Completion document on file (entered on the Training Platform)', can_make_certificate: false }
  if (v && day(v.date) && S(v.document, 400) && S(v.by, 120)) return { state: 'verified', date: day(v.date), proof: { kind: 'office_verified', ref: S(v.document, 400), date: day(v.date), by: S(v.by, 120), at: S(v.at, 40) || null }, why: 'Historical record, verified by the office', can_make_certificate: false }
  const hd = day(pre?.hire_date), cut = day(pre?.before)
  if (hd && cut && hd < cut) return { state: 'verified', date: tDone ? day(t.completed_at) : null, proof: { kind: 'pre_axiscare', ref: null, date: hd, by: S(pre?.by, 120) || PRE_AXISCARE_BY, at: null },
    why: `Hired ${hd}, before AxisCare started; completed orientation then`, can_make_certificate: !!tDone }
  if (tDone) return { state: 'needs_certificate', date: day(t.completed_at), proof: null, why: 'Finished on the Training Platform, but the certificate was never saved', can_make_certificate: true }
  const rDate = day(roster?.orient_date), rProof = S(roster?.orient_proof, 400)
  if (rDate) return { state: 'needs_document', date: rDate, proof: null, why: rProof && rProof !== GENERIC_PROOF ? 'A completion date and a link on the Hub record, not yet verified by the office' : 'A completion date on the Hub record, but no document behind it', can_make_certificate: false }
  if (t && ['in_progress', 'not_started', 'assigned'].includes(S(t.status, 20))) return { state: 'in_progress', date: null, proof: null, why: S(t.status, 20) === 'in_progress' ? 'Orientation started, not finished' : 'Orientation assigned, not started', can_make_certificate: false }
  return { state: 'missing', date: null, proof: null, why: 'No orientation on record', can_make_certificate: false }
}

/** The audit: everyone AxisCare says is Active (status label Active, not In Training), minus the excluded, who isn't verified. */
export function auditList(ax: Any[], rosterByAx: Map<string, Any>, trainingByAx: Map<string, Any>, exclude: string[], pre: { before?: string | null; by?: string | null } | null = null): { flagged: Any[]; checked: number; verified: number; excluded: number } {
  const ex = new Set((exclude || []).map((x) => S(x, 20)))
  const active = (ax || []).filter((g) => g && g.active === true && /^active$/i.test(S(g.status_label, 30)))
  let verified = 0, excluded = 0
  const flagged: Any[] = []
  for (const g of active) {
    const id = S(g.id, 20)
    if (ex.has(id)) { excluded++; continue }
    const r = rosterByAx.get(id) || null
    const st = orientationStatus(r, trainingByAx.get(id) || null, pre ? { ...pre, hire_date: S(g.hire_date, 10) || S(r?.hire_date, 10) } : null)
    if (st.state === 'verified') { verified++; continue }
    flagged.push({ axiscare_id: id, name: [g.first, g.last].map((x: unknown) => S(x, 40)).filter(Boolean).join(' ') || 'Caregiver ' + id, ...st })
  }
  flagged.sort((a, b) => a.name.localeCompare(b.name))
  return { flagged, checked: active.length, verified, excluded }
}

/** THE GATE (switch ops_settings.orientation_gate_live): may the onboarding checklist count Orientation as done from this roster
    record? Only with the certificate or an office-verified record behind it; a bare date never counts. */
export function gateVerdict(roster: Any): { ok: boolean; why: string } {
  const st = orientationStatus(roster, null)
  if (st.state === 'verified') return { ok: true, why: st.why }
  return { ok: false, why: st.state === 'needs_document' ? 'Orientation has a date but no certificate or verified record yet. Make the certificate, or verify the completion document.'
    : 'Orientation is not finished yet.' }
}

/** A historical record the office verifies: what must be there before it is saved. */
export function checkVerify(b: Any, today: string): { ok: boolean; why: string | null } {
  const d = day(b?.date)
  if (!d) return { ok: false, why: 'Enter the date the document shows orientation was completed.' }
  if (d > today) return { ok: false, why: 'That date is in the future.' }
  if (!S(b?.document, 400)) return { ok: false, why: 'Upload the completion document first.' }
  if (b?.attest !== true) return { ok: false, why: 'Confirm you looked at this document and it shows orientation was completed.' }
  return { ok: true, why: null }
}
