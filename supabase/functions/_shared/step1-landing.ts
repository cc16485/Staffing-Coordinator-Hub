// =============================================================================
// step1-landing.ts · SLICE 2e (Samantha "start slice 2e", 2026-10-10): the Step 1 answers keyed by the AxisCare id
// =============================================================================
// At the moment caregiver-connect moves a Background & References person onto the roster with their AxisCare id, their
// Step 1 availability becomes the availability record Team Builder reads, and their own willingness, specialties and
// matching answers become skills on the overlay, each marked as what they told us ("attested"), by Step 1, dated.
// Rules: a record or a skill the office or the caregiver already made is never overwritten; driving and Level 3 land
// nothing (cleared to drive is the office's call; complex care comes from the AxisCare class). No sends. No deletion.
const DAYS: Record<string, string> = { Monday: 'mon', Tuesday: 'tue', Wednesday: 'wed', Thursday: 'thu', Friday: 'fri', Saturday: 'sat', Sunday: 'sun' }
const WINDOWS: Record<string, string> = { Morning: 'morning', Afternoon: 'afternoon', Evening: 'evening', Overnight: 'overnight' }
export const STEP1_BY = 'Step 1 (their own answers)'
const S = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n)

export type AvailabilityItem = { id: string; name: string; axiscare_id: string; phone_digits: string | null; target_hours: number | null; windows: Record<string, string[]>; updated_at: string; source: 'step1'; step1: Record<string, unknown> }
/** The Step 1 grid as the availability record: windows by day, ideal hours as the target. Null when Step 1 holds no grid. */
export function availabilityItem(a: Record<string, unknown>, who: { id: string | number; name: string; axiscare_id: string | number; phone?: string | null }, at: string): AvailabilityItem | null {
  const grid = a.windows
  if (!grid || typeof grid !== 'object' || Array.isArray(grid)) return null
  const windows: Record<string, string[]> = { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] }; let any = false
  for (const [day, row] of Object.entries(grid as Record<string, Record<string, unknown>>)) {
    const d = DAYS[day]; if (!d || !row || typeof row !== 'object') continue
    if (row['Not available'] === true) { windows[d] = []; continue }
    windows[d] = Object.entries(WINDOWS).filter(([k]) => row[k] === true).map(([, v]) => v); if (windows[d].length) any = true
  }
  if (!any) return null
  const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : null }
  const hours: Record<string, string> = {}; for (const [day, row] of Object.entries(grid as Record<string, Record<string, unknown>>)) { const h = S(row?.['Hours (optional)'], 80); if (h && DAYS[day]) hours[DAYS[day]] = h }
  return { id: String(who.id), name: S(who.name, 120), axiscare_id: String(who.axiscare_id), phone_digits: who.phone ? String(who.phone).replace(/\D/g, '') || null : null,
    target_hours: n(a.hours_ideal), windows, updated_at: at, source: 'step1',
    step1: { at, hours_min: n(a.hours_min), hours_max: n(a.hours_max), hours_by_day: hours, shift_prefs: Array.isArray(a.shift_prefs) ? a.shift_prefs : [], overnight_nights: S(a.overnight_nights, 120) || null,
      max_miles: S(a.max_miles, 20) || null, open_shift_texts: a.open_shift_texts ?? null, text_consent: a.text_consent ?? null } }
}

type Skill = { have: 'yes' | 'no'; evidence: 'attested'; by: string; at: string; note: string }
/** Their own words as skills and fields on the overlay. Driving and Level 3 land nothing. */
export function overlayPatch(a: Record<string, unknown>, at: string): { skills: Record<string, Skill>; fields: Record<string, unknown> } {
  const skills: Record<string, Skill> = {}; const fields: Record<string, unknown> = {}
  const mk = (have: 'yes' | 'no', note: string): Skill => ({ have, evidence: 'attested', by: STEP1_BY, at, note })
  const yesOn = (m: unknown, ...keys: string[]) => { if (!m || typeof m !== 'object') return null; const vals = keys.map((k) => (m as Record<string, string>)[k]).filter(Boolean); if (!vals.length) return null; return vals.includes('Yes') ? 'yes' : vals.every((v) => v === 'Not at this time') ? 'no' : null }
  if (a.level2 === 'Yes') skills.personal_care = mk('yes', 'said willing to accept Level 2 clients on the Step 1 experience form')
  else if (a.level2 === 'Not at this time') skills.personal_care = mk('no', 'said not at this time for Level 2 clients on the Step 1 experience form')
  const sp = a.specialties, mf = a.matching_facts
  const map: [string, string, unknown, string[]][] = [
    ['dementia_care', 'specialties', sp, ["Alzheimer's disease", 'Other dementias', 'Behavioral symptoms associated with dementia']],
    ['parkinsons_care', 'specialties', sp, ["Parkinson's disease"]],
    ['hospice_support', 'specialties', sp, ['Hospice clients']],
    ['transfers_gait_belt', 'specialties or matching', { ...(sp as object || {}), ...(mf as object || {}) }, ['Clients requiring transfers', 'Clients who use a gait belt']],
    ['bedbound_care', 'specialties or matching', { ...(sp as object || {}), ...(mf as object || {}) }, ['Bedbound clients', 'Clients who are bedbound']],
    ['hoyer_lift', 'specialties or matching', { ...(sp as object || {}), ...(mf as object || {}) }, ['Clients requiring Hoyer lift assistance (if trained)', 'Clients who use a Hoyer lift (if trained)']],
    ['ok_cats', 'matching', mf, ['Homes with cats']], ['ok_dogs', 'matching', mf, ['Homes with dogs']], ['ok_smoking', 'matching', mf, ['Homes where someone smokes']],
  ]
  for (const [key, where, src, labels] of map) { const v = yesOn(src, ...labels); if (v) skills[key] = mk(v, `${v === 'yes' ? 'comfortable with' : 'not at this time:'} ${labels.join(' / ')} (Step 1 ${where})`) }
  if (Array.isArray(a.languages) && a.languages.length) fields.languages = [...a.languages, ...(S(a.languages_other) ? [S(a.languages_other, 60)] : [])]
  if (S(a.max_miles)) fields.max_miles = S(a.max_miles, 20)
  if (S(a.preferred_levels)) fields.preferred_levels_said = S(a.preferred_levels, 60)
  if (S(a.exclusions)) fields.exclusions_said = S(a.exclusions, 500)
  if (S(a.experience)) fields.experience_said = S(a.experience, 60)
  return { skills, fields }
}

/** After a successful move: land availability (if none yet) and skills/fields (blanks only) through the one item door. */
// deno-lint-ignore no-explicit-any
export async function landAtConnect(db: any, cand: any, caregiverId: string | number, ax: any, at: string): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { availability: 'none', skills: [], fields: [] }
  try {
    const offerId = S(cand?.offer_id, 64); if (!offerId) return { ...out, why: 'no offer on the record' }
    const { data: f } = await db.from('step1_forms').select('answers, signatures').eq('offer_id', offerId).maybeSingle()
    const a = f?.answers; if (!a || typeof a !== 'object') return { ...out, why: 'no Step 1 record' }
    const sigs = (f?.signatures || {}) as Record<string, unknown>
    const name = `${cand?.first ?? ''} ${cand?.last ?? ''}`.trim() || `${ax?.first ?? ''} ${ax?.last ?? ''}`.trim()
    /* availability: only from a signed availability form, only when none exists */
    if (sigs.availability) {
      const item = availabilityItem(a as Record<string, unknown>, { id: caregiverId, name, axiscare_id: String(ax?.id ?? ''), phone: cand?.phone || ax?.mobile || null }, at)
      if (item) {
        const { data: row } = await db.from('app_data').select('data').eq('key', 'caregiver_availability').maybeSingle()
        const list = Array.isArray(row?.data) ? row.data : []
        // deno-lint-ignore no-explicit-any
        const exists = list.some((x: any) => String(x?.id) === String(caregiverId) || (x?.axiscare_id && String(x.axiscare_id) === String(ax?.id ?? '')))
        if (exists) out.availability = 'kept (a record already exists)'
        else { const { error } = await db.rpc('upsert_app_data_item', { target_key: 'caregiver_availability', item }); out.availability = error ? 'failed: ' + String(error.message || error).slice(0, 100) : 'landed' }
      }
    }
    /* skills and fields: only from a signed experience form, blanks only */
    if (sigs.experience) {
      const patch = overlayPatch(a as Record<string, unknown>, at)
      const { data: row } = await db.from('app_data').select('data').eq('key', 'caregiver_overlay').maybeSingle()
      const list = Array.isArray(row?.data) ? row.data : []
      // deno-lint-ignore no-explicit-any
      const ov = list.find((x: any) => String(x?.axiscare_id ?? '') === String(ax?.id ?? '')) || { id: 'cgov_' + String(ax?.id ?? ''), axiscare_id: String(ax?.id ?? '') }
      const item = { ...ov, skills: { ...(ov.skills || {}) } }; const landedSkills: string[] = [], landedFields: string[] = []
      for (const [k, v] of Object.entries(patch.skills)) if (!item.skills[k]) { item.skills[k] = v; landedSkills.push(k) }
      for (const [k, v] of Object.entries(patch.fields)) if (item[k] == null || item[k] === '' || (Array.isArray(item[k]) && !item[k].length)) { item[k] = v; landedFields.push(k) }
      if (landedSkills.length || landedFields.length) {
        item.step1_landed_at = at; item.updated_at = at; item.updated_by = STEP1_BY
        const { error } = await db.rpc('upsert_app_data_item', { target_key: 'caregiver_overlay', item })
        if (error) out.skills_error = String(error.message || error).slice(0, 100); else { out.skills = landedSkills; out.fields = landedFields }
      }
    }
    return out
  } catch (e) { return { ...out, error: String((e as Error).message || e).slice(0, 120) } }
}
