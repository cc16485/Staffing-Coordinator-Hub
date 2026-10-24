// =============================================================================
// CAREGIVER PREVIEW (Samantha, 2026-10-24): the friendly client profile caregivers see when they're offered a shift, kept on
// its own tab of every client profile. One record per client (client_caregiver_profile), replacing the About / What they
// enjoy / Share the care needs fields that sat on the Family Circle. Her rules:
//  - Two parts kept apart. The INTRODUCTION (About, What they enjoy) is written by the office. The CARE SUMMARY is never
//    typed: it is read from the care plan (the source of truth) and the office only chooses whether to share it and which
//    items to leave out. Cara's matching never reads this record; it always uses the current care plan.
//  - Draft and Approved. Every save is a draft. Only the approved version reaches caregivers (Cara's shift page and the
//    Booking App's visit offers). Editing an approved profile makes a new draft; the approved one keeps working.
//  - Who approves: an office user with the owner or care coordinator role (Samantha, Zach, Krystal, and Angiel once she has
//    the role). The introduction can be approved by the person who wrote it. A care change that SHOWS caregivers more
//    (turning the summary on, or adding an item back) needs a second person: nobody approves their own.
//  - The care plan changes after approval (an item added, removed or a different level): the approved care summary stops
//    showing at once and the profile says it needs review. Nothing outdated is shown.
//  - Incomplete is fine: with nothing approved, a shift offer shows only the shift.
//  - Carried over: until an introduction is approved here, the About and What they enjoy already on the Family Circle count
//    (they were in use), so nothing entered before is lost.
// Pure functions, and previewRecords (one read) for the readers; the record is written by caregiver-preview/index.ts.
// =============================================================================

// deno-lint-ignore no-explicit-any
type Any = any
export type CareItem = { key: string; group: 'help' | 'needs' | 'level' | 'home'; label: string }
export type Who = { name: string; email: string; roles?: string[] }

export const APPROVER_ROLES = ['owner_admin', 'care_coordinator']
export const ABOUT_MAX = 400, ENJOYS_MAX = 6, ENJOY_LEN = 30
const S = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim()
const arr = (v: unknown): string[] => (Array.isArray(v) ? v : []).map(S).filter(Boolean)
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/** The office's About, cleaned and checked. */
export function cleanAbout(v: unknown): { ok: true; text: string } | { ok: false; error: string } {
  const text = S(v)
  if (text.length > ABOUT_MAX) return { ok: false, error: `Please keep it under ${ABOUT_MAX} characters (a few sentences).` }
  if (/\b\d{2,6}\s+[A-Za-z0-9.\s]{2,30}\b(st|street|ave|avenue|rd|road|dr|drive|ln|lane|ct|court|blvd|way|pl|place|hwy)\b/i.test(text)) return { ok: false, error: 'Please leave out the address. Caregivers see it in AxisCare once they have the visit.' }
  return { ok: true, text }
}
/** What they enjoy: up to 6 short things, no numbers. */
export function cleanEnjoys(v: unknown): { ok: true; items: string[] } | { ok: false; error: string } {
  const raw = Array.isArray(v) ? v : String(v ?? '').split(',')
  const items = [...new Set(raw.map(S).filter(Boolean))]
  if (items.length > ENJOYS_MAX) return { ok: false, error: `Please keep it to ${ENJOYS_MAX} things.` }
  if (items.some((x) => x.length > ENJOY_LEN)) return { ok: false, error: 'Please keep each one short (a few words).' }
  if (items.some((x) => /\d{3}/.test(x))) return { ok: false, error: 'Please leave out numbers and addresses.' }
  return { ok: true, items }
}

/** THE CARE SUMMARY FROM THE CARE PLAN: what they'd help with (required or preferred skills), the required skills (plan or
    current), the care level (AxisCare), and pets or smoking. M = the match rules (CCMatch), ff = M.fromFacts(facts).
    Labels are the match rules' own. null facts = the care plan couldn't be read. */
export function careItemsOf(M: Any, ff: Any, level: number | null): CareItem[] {
  const out: CareItem[] = []
  for (const sk of (M?.SKILLS || [])) {
    const n = ff?.needs?.[sk.key]; const v = n && typeof n === 'object' ? n.value : n
    if (v === 'required' || v === 'preferred') out.push({ key: 'help:' + sk.key, group: 'help', label: String(sk.label) })
    if (v === 'required' && ['plan', 'current'].includes(n?.stage)) out.push({ key: 'needs:' + sk.key, group: 'needs', label: String(sk.label) })
  }
  if (level) out.push({ key: 'level:' + level, group: 'level', label: `Level ${level}` })
  const f = ff?.facts || {}
  if (f.cats === true) out.push({ key: 'home:cats', group: 'home', label: 'Cats in the home' })
  if (f.dogs === true) out.push({ key: 'home:dogs', group: 'home', label: 'Dogs in the home' })
  if (f.smoking === true) out.push({ key: 'home:smoking', group: 'home', label: 'Someone smokes in the home' })
  return out
}
/** The care plan's fingerprint: the item keys, sorted. Any item added or removed, or a new level, changes it. */
export const careSig = (items: CareItem[]) => items.map((x) => x.key).sort().join('|')
const shownOf = (items: CareItem[], hidden: string[]) => items.filter((x) => !hidden.includes(x.key))
const groupsOf = (items: CareItem[]) => ({
  help: items.filter((x) => x.group === 'help').map((x) => x.label),
  needs: items.filter((x) => x.group === 'needs').map((x) => x.label),
  home: items.filter((x) => x.group === 'home').map((x) => x.label),
  level: (() => { const l = items.find((x) => x.group === 'level'); return l ? Number(l.key.split(':')[1]) || null : null })(),
})

/** The introduction in force: what was approved here, or (never approved here yet) what was on the Family Circle. */
export function approvedIntro(row: Any | null, circle: Any | null): { about: string | null; enjoys: string[]; carried: boolean } {
  if (row?.intro_approved_at) return { about: S(row.approved_about) || null, enjoys: arr(row.approved_enjoys).slice(0, ENJOYS_MAX), carried: false }
  const about = S(circle?.caregiver_about) || null, enjoys = arr(circle?.caregiver_enjoys).slice(0, ENJOYS_MAX)
  return { about, enjoys, carried: !!(about || enjoys.length) }
}
/** The draft introduction: the draft here, or the carried-over one until somebody saves. */
export function draftIntro(row: Any | null, circle: Any | null): { about: string | null; enjoys: string[] } {
  if (row?.intro_changed_at || row?.intro_approved_at) return { about: S(row.draft_about) || null, enjoys: arr(row.draft_enjoys) }
  const a = approvedIntro(row, circle); return { about: a.about, enjoys: a.enjoys }
}

/** WHAT A CAREGIVER SEES (the approved version), given the care plan now. current = null: the care plan or AxisCare
    couldn't be read, so no care items are shown (and no review is flagged). */
export function approvedView(row: Any | null, circle: Any | null, current: CareItem[] | null) {
  const intro = approvedIntro(row, circle)
  let care = { help: [] as string[], needs: [] as string[], home: [] as string[], level: null as number | null }
  let careState: 'off' | 'shown' | 'review' | 'unread' = 'off'
  if (row?.approved_share_care === true) {
    if (!current) careState = 'unread'
    else if (careSig(current) !== String(row.approved_care_sig ?? '')) careState = 'review'
    else { care = groupsOf(shownOf(current, arr(row.approved_hidden))); careState = 'shown' }
  }
  return { about: intro.about, enjoys: intro.enjoys, ...care, care_state: careState }
}
/** The draft as a caregiver would see it once approved. */
export function draftView(row: Any | null, circle: Any | null, current: CareItem[] | null) {
  const intro = draftIntro(row, circle)
  const care = row?.draft_share_care === true && current ? groupsOf(shownOf(current, arr(row.draft_hidden))) : { help: [], needs: [], home: [], level: null }
  return { about: intro.about, enjoys: intro.enjoys, ...care }
}

/** Does the draft care summary show caregivers anything the approved one doesn't? (That needs a second person.) */
export function careWidens(row: Any | null, current: CareItem[] | null): boolean {
  if (row?.draft_share_care !== true) return false
  if (row?.approved_share_care !== true) return true
  const was = new Set(arr(row.approved_care_items))
  return shownOf(current ?? [], arr(row.draft_hidden)).some((x) => !was.has(x.key))
}
const introPending = (row: Any | null, circle: Any | null) => {
  const d = draftIntro(row, circle), a = approvedIntro(row, circle)
  return (d.about ?? '') !== (a.about ?? '') || !same(d.enjoys, a.enjoys)
}
const carePending = (row: Any | null, current: CareItem[] | null) => {
  if (!row) return false
  const dOn = row.draft_share_care === true, aOn = row.approved_share_care === true
  if (dOn !== aOn) return true
  if (!dOn) return false
  if (current && careSig(current) !== String(row.approved_care_sig ?? '')) return true
  return !same(arr(row.draft_hidden).sort(), arr(row.approved_hidden).sort())
}

/** THE STATE the tab and the Cara board show. */
export function stateOf(row: Any | null, circle: Any | null, current: CareItem[] | null) {
  const a = approvedView(row, circle, current)
  const hasIntro = !!(a.about || a.enjoys.length)
  const iP = introPending(row, circle), cP = carePending(row, current)
  const review = a.care_state === 'review'
  const anything = hasIntro || row?.approved_share_care === true
  const label = review ? 'Care plan changed: review' : (iP || cP) ? (anything ? 'Changes waiting for approval' : 'Draft') : anything ? 'Approved' : 'Not started'
  const tone = review ? 'review' : (iP || cP) ? 'draft' : anything ? 'approved' : 'none'
  const last = [row?.intro_approved_at ? { at: row.intro_approved_at, by: row.intro_approved_by } : null, row?.care_approved_at ? { at: row.care_approved_at, by: row.care_approved_by } : null]
    .filter(Boolean).sort((x: Any, y: Any) => String(y.at).localeCompare(String(x.at)))[0] ?? null
  return { label, tone, intro_pending: iP, care_pending: cP, care_review: review, carried: approvedIntro(row, circle).carried, has_intro: hasIntro, last_approved: last }
}

/** WHO MAY APPROVE WHAT. intro: an approver, their own words included. care: an approver; if the draft shows caregivers more
    than the approved summary, not the person who made that change. */
export function canApprove(row: Any | null, circle: Any | null, current: CareItem[] | null, who: Who) {
  const isApprover = (who.roles ?? []).some((r) => APPROVER_ROLES.includes(r))
  const st = stateOf(row, circle, current)
  if (!isApprover) return { intro: false, care: false, why: 'Samantha, Zach, Krystal or another care coordinator approves Caregiver Previews.' }
  const intro = st.intro_pending
  let care = st.care_pending, why = ''
  if (care && !current) { care = false; why = 'The care plan can\'t be read right now, so the care summary can\'t be approved. Try again in a minute.' }
  else if (care && careWidens(row, current) && String(row?.care_changed_by ?? '').toLowerCase() === who.email.toLowerCase()) {
    care = false; why = 'You changed the care summary, so someone else approves it (a second look for care details).'
  }
  return { intro, care, why }
}

const hist = (row: Any | null, entry: Any) => [...(Array.isArray(row?.history) ? row.history : []), entry].slice(-30)

/** A SAVE: the draft only. Records who changed which part. patch = { about?, enjoys?, share_care?, hidden? } (already clean). */
export function applySave(row: Any | null, circle: Any | null, patch: Any, who: Who, now: string, key: { client_key: string; axiscare_client_id: string | null; lead_id: string | null; client_name: string | null }) {
  const r: Any = { ...(row ?? {}), ...key }
  if (!row) {   /* first save: start from what was on the Family Circle, so nothing is lost */
    const c = approvedIntro(null, circle)
    r.draft_about = c.about; r.draft_enjoys = c.enjoys
    if (c.carried) { r.approved_about = c.about; r.approved_enjoys = c.enjoys; r.intro_approved_at = now; r.intro_approved_by = 'Carried over from the Family Circle'; r.carried_at = now }
    r.draft_share_care = false; r.draft_hidden = []; r.created_at = now
  } else if (!row.intro_changed_at && !row.intro_approved_at) {
    const c = approvedIntro(null, circle); r.draft_about = c.about; r.draft_enjoys = c.enjoys
  }
  const did: string[] = []
  if ('about' in patch && (S(patch.about) || null) !== (S(r.draft_about) || null)) { r.draft_about = S(patch.about) || null; did.push('About') }
  if ('enjoys' in patch && !same(arr(patch.enjoys), arr(r.draft_enjoys))) { r.draft_enjoys = arr(patch.enjoys); did.push('What they enjoy') }
  if (did.length) { r.intro_changed_at = now; r.intro_changed_by = who.email }
  const careDid: string[] = []
  if ('share_care' in patch && (patch.share_care === true) !== (r.draft_share_care === true)) { r.draft_share_care = patch.share_care === true; careDid.push(r.draft_share_care ? 'turned on the care summary' : 'turned off the care summary') }
  if ('hidden' in patch && !same(arr(patch.hidden).sort(), arr(r.draft_hidden).sort())) { r.draft_hidden = arr(patch.hidden); careDid.push('changed which care items show') }
  if (careDid.length) { r.care_changed_at = now; r.care_changed_by = who.email }
  const all = [...did.map((x) => 'changed ' + x), ...careDid]
  if (all.length) r.history = hist(row, { at: now, by: who.name || who.email, what: all.join(', ') + (patch.ai === true && did.length ? ' (from an AI draft)' : ''), kind: 'draft' })
  r.updated_at = now
  return { row: r, changed: all }
}

/** AN APPROVAL: copies the parts this person may approve from the draft. current = the care plan now (its fingerprint is
    stored, so a later change is noticed). */
export function applyApprove(row: Any, circle: Any | null, current: CareItem[] | null, who: Who, now: string) {
  const can = canApprove(row, circle, current, who)
  const r: Any = { ...row }, did: string[] = []
  if (can.intro) {
    const d = draftIntro(row, circle)
    r.approved_about = d.about; r.approved_enjoys = d.enjoys; r.draft_about = d.about; r.draft_enjoys = d.enjoys
    r.intro_approved_at = now; r.intro_approved_by = who.name || who.email; r.intro_changed_by = null; did.push('the introduction')
  }
  if (can.care) {
    r.approved_share_care = row.draft_share_care === true
    r.approved_hidden = arr(row.draft_hidden)
    r.approved_care_items = r.approved_share_care ? shownOf(current ?? [], r.approved_hidden).map((x) => x.key) : []
    r.approved_care_sig = r.approved_share_care ? careSig(current ?? []) : null
    r.care_approved_at = now; r.care_approved_by = who.name || who.email; r.care_changed_by = null; did.push(r.approved_share_care ? 'the care summary' : 'care summary off')
  }
  if (did.length) { r.history = hist(row, { at: now, by: who.name || who.email, what: 'approved ' + did.join(' and '), kind: 'approved' }); r.updated_at = now }
  return { row: r, approved: did, why: can.why }
}

/** A sample shift for Preview as Caregiver when there is no open shift: next Saturday, 8am to 12pm, clearly marked. */
export function sampleShift(today: string) {
  const d = new Date(today + 'T12:00:00Z'); const add = (6 - d.getUTCDay() + 7) % 7 || 7; d.setUTCDate(d.getUTCDate() + add)
  return { shift_date: d.toISOString().slice(0, 10), shift_time: '08:00-12:00', sample: true }
}

/** The Caregiver Preview record and the Family Circle's carried-over fields for one AxisCare client. */
export async function previewRecords(db: Any, clientAxId: string): Promise<{ row: Any | null; circle: Any | null }> {
  const [{ data: row }, { data: circle }] = await Promise.all([
    db.from('client_caregiver_profile').select('*').eq('axiscare_client_id', clientAxId).limit(1).maybeSingle(),
    db.from('care_circles').select('caregiver_about, caregiver_enjoys, caregiver_share_care').eq('axiscare_client_id', clientAxId).eq('active', true).limit(1).maybeSingle(),
  ])
  return { row: row ?? null, circle: circle ?? null }
}

