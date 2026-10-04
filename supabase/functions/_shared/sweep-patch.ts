// Safe saves step 4 (2026-10-04, Samantha "yes to all"). The eligibility sweep saves ONLY the five fields it owns on a
// caregiver (caregiver_sweep_patch), and only if nobody changed that caregiver since it read them. If someone did, it
// takes the current record, works the fields out again on it (recompute), and tries again; it never saves a whole
// caregiver record from its own copy, so an office edit made during a run is never undone.
// deno-lint-ignore-file no-explicit-any
export const SWEEP_FIELDS = ['eligibility_history', 'eligibility_state', 'eligibility_reason', 'eligibility_at', 'axiscare_note_for']
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
