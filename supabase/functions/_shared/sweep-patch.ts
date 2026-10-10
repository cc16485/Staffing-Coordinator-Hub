// Safe saves step 4 (2026-10-04, Samantha "yes to all"). The eligibility sweep saves ONLY the five fields it owns on a
// caregiver (caregiver_sweep_patch), and only if nobody changed that caregiver since it read them. If someone did, it
// takes the current record, works the fields out again on it (recompute), and tries again; it never saves a whole
// caregiver record from its own copy, so an office edit made during a run is never undone.
// deno-lint-ignore-file no-explicit-any
export const SWEEP_FIELDS = ['eligibility_history', 'eligibility_state', 'eligibility_reason', 'eligibility_at', 'axiscare_note_for',
  /* SLICE 5 (2026-10-10): the six fields the readiness server owns (Approve to Work, the AxisCare read-back, the scheduling lock) */
  'approved_to_work_at', 'approved_to_work_by', 'axiscare_status_active', 'axiscare_status_label', 'axiscare_status_at', 'work_lock']
export const rev = (x: any) => (/^[0-9]{1,15}$/.test(String(x?._rev ?? '')) ? Number(x._rev) : 0)
const pick = (r: any) => Object.fromEntries(SWEEP_FIELDS.filter((k) => k in r).map((k) => [k, r[k] === undefined ? null : r[k]]))

/** 'saved' | 'skipped' (no number, gone, two records share it, or still changing after 3 tries) | 'error' */
export async function saveSweepFields(db: any, c: any, recompute: (fresh: any) => void, tries = 3): Promise<'saved' | 'skipped' | 'error'> {
  if (c?.id == null || c.id === '') return 'skipped'
  let rec = c
  for (let i = 0; i < tries; i++) {
    const { data, error } = await db.rpc('caregiver_sweep_patch', { p_id: String(rec.id), p_base_rev: rev(rec), p_patch: pick(rec) })
    if (error) return 'error'
    if (data?.ok) return 'saved'
    if (data?.reason !== 'changed' || !data.current_record) return 'skipped'
    rec = data.current_record
    recompute(rec)
  }
  return 'skipped'
}

/* SLICE 6 (2026-10-10, "yes to all"): the nightly audit owns a second set of roster fields through its own door,
   caregiver_audit_patch (same rule: only these fields, only when nobody changed the record since it was read): the Training
   Platform's dates, hours and certificate references, and the monthly OIG result with its evidence. Never a typed office
   date: the sync fills blanks and newer facts only (training-sync.ts decides). */
export const AUDIT_FIELDS = ['orient_date', 'orient_proof', 'alz_date', 'alz_hrs', 'alz_proof', 'ojt_online', 'ojt_online_proof', 'annual_date', 'annual_hrs', 'annual_proof',
  'hire_date', 'first_contact', 'axiscare_id', 'th_synced', 'oig', 'oig_date', 'oig_proof', 'oig_evidence']
const pickOf = (fields: string[], r: any) => Object.fromEntries(fields.filter((k) => k in r).map((k) => [k, r[k] === undefined ? null : r[k]]))
export async function saveOwnedFields(db: any, rpcName: string, fields: string[], c: any, recompute: (fresh: any) => void, tries = 3): Promise<'saved' | 'skipped' | 'error'> {
  if (c?.id == null || c.id === '') return 'skipped'
  let rec = c
  for (let i = 0; i < tries; i++) {
    const { data, error } = await db.rpc(rpcName, { p_id: String(rec.id), p_base_rev: rev(rec), p_patch: pickOf(fields, rec) })
    if (error) return 'error'
    if (data?.ok) return 'saved'
    if (data?.reason !== 'changed' || !data.current_record) return 'skipped'
    rec = data.current_record
    recompute(rec)
  }
  return 'skipped'
}
export const saveAuditFields = (db: any, c: any, recompute: (fresh: any) => void) => saveOwnedFields(db, 'caregiver_audit_patch', AUDIT_FIELDS, c, recompute)
