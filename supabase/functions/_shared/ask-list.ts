// =============================================================================
// THE THREE-GROUP ASK LIST (Samantha, 2026-10-24, mockup PtLEzsAjvGybxXsTtXk926: "Cara should show us every potential
// caregiver, including the ones she didn't contact, and explain exactly why.")
// =============================================================================
//   READY TO ASK        meets every requirement; Cara contacts them herself (familiar, PRN Team, everyone else).
//   POSSIBLE WITH REVIEW  Cara never contacts them. Two kinds:
//     care    a care-level or skill gap. A coordinator may approve THIS shift only after moving or dropping the tasks
//             that stand in the way, confirming what is left is within the caregiver's verified skills and allowed by
//             policy and the payer, and recording who agreed and why. Never changes the caregiver's level or the plan.
//     call    a scheduling preference (overtime, outside their stated times, a PRN member's notice, a yes elsewhere then).
//             The office may simply ask them; no form.
//   DO NOT ASK          safety, compliance, clearance, Do Not Return, working then, required care they can't do.
// Only decisions here (no reads or writes). Her rule: Cara never waives a care requirement herself.
// =============================================================================
// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown, n = 200) => String(v ?? '').trim().slice(0, n)

/** A skills-rule reason (match-rules evaluate) as a code: level and skill gaps can be reviewed, the rest can't. */
export function skillCode(reason: string): string {
  const r = S(reason, 300)
  if (/^Approved level \d+; this client needs Level/i.test(r)) return 'level'
  if (/^Not cleared to drive/i.test(r)) return 'drive'
  if (/: no experience on record$/i.test(r)) return 'skill'
  if (/Do Not Return/i.test(r)) return 'dnr'
  if (/training not complete/i.test(r)) return 'training'
  if (/: not at this time$|^Not at this time/i.test(r)) return 'restriction'
  if (/requires (a |Spanish)/i.test(r)) return 'client_requires'
  return 'skills_other'
}

export const CARE_CODES = ['level', 'drive', 'skill']
export const CALL_CODES = ['overtime', 'outside', 'prn_notice', 'prn_conflict', 'prn_ongoing', 'overlap']
export const HIDDEN_CODES = ['inactive', 'nurse', 'office', 'asked']
const DONT_WORDS: Record<string, string> = { dnr: 'Do Not Return', needs_verification: 'Clearance', working: 'Working then', working_now: 'Working right now', lock: 'Not approved to work yet',
  in_training: 'In Training', caller: 'Called off', plan_only: "Client's call-in plan", held: 'Could not be checked', no_phone: 'No phone on file',
  do_not_offer: 'Asked not to be offered shifts', on_break: 'On a break', training: 'Required care', restriction: 'Their own limit', client_requires: "Client's requirement", skills_other: 'Not a match', skipped: 'Not on the list', other: 'Not on the list' }
const CALL_WORDS: Record<string, string> = { overtime: 'Overtime', outside: 'Outside their times', prn_notice: 'PRN notice', prn_conflict: 'PRN preference to clarify', prn_ongoing: 'PRN, regular opening', overlap: 'Said yes elsewhere then' }
const CARE_WORDS: Record<string, string> = { level: 'Level', drive: 'Driving', skill: 'Skill' }

/** The tasks that stand in the way for this caregiver (a care-review row), given what the coordinator moved or dropped. */
export function blockingTasks(care: Any, cgLevel: number | null, adjust: Record<string, string> = {}): Any[] {
  const lv = Number(cgLevel ?? care?.cg_level) || 1
  const basic = ['bathing', 'dressing_grooming', 'toileting', 'feeding', 'walking_wheelchair', 'transfers_gait_belt']
  return (Array.isArray(care?.tasks) ? care.tasks : []).filter((t: Any) => {
    if (adjust[t.key] === 'moved' || adjust[t.key] === 'not_needed') return false
    const needsEvidence = (t.level >= 2 && !basic.includes(t.key)) || t.check_first
    return t.level > lv || t.restricted || (needsEvidence && !t.verified)
  })
}

const nk = (n: unknown) => S(n, 80).toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()
/** Who has been contacted on this case, and how they answered. */
export function contactOf(kase: Any, p: { name?: string; axiscare_id?: string | null }): Any {
  const a = (Array.isArray(kase?.asked) ? kase.asked : []).filter((x: Any) => x && ((p.axiscare_id && S(x.axiscare_id) === S(p.axiscare_id)) || nk(x.name) === nk(p.name))).at(-1)
  if (!a) return null
  return { at: a.at ?? null, state: a.state ?? 'waiting', how: a.from_prn_page ? 'their PRN Team page' : a.cara_wave ? `Cara wave ${a.cara_wave}` : a.picked_by_coordinator ? 'the office' : 'by phone',
    by_text: a.auto === true || a.picked_by_coordinator === true, ...(a.from_prn_page ? { interested_on_page: true } : {}) }   // PRN step 5b: "Interested (from their PRN page)"
}
export function approvalOf(kase: Any, p: { axiscare_id?: string | null; name?: string }): Any {
  const key = `${S(kase?.shift_date, 10)}|${S(kase?.shift_time, 20)}`
  return (Array.isArray(kase?.review_approvals) ? kase.review_approvals : []).filter((x: Any) => x && x.for === key && ((p.axiscare_id && S(x.axiscare_id) === S(p.axiscare_id)) || nk(x.name) === nk(p.name))).at(-1) ?? null
}

/** Every caregiver for one case, in three groups. ready: the wave order (judged.ordered); judgedOut: the wave rules' exclusions;
    listOut: the list's own cuts (with codes). */
export function threeGroups(kase: Any, ready: Any[], judgedOut: Any[], listOut: Any[]): Any {
  const row = (r: Any, group: string, kind: string, label: string, why: string, extra: Any = {}) => ({ name: S(r.name, 80), axiscare_id: r.axiscare_id != null ? S(r.axiscare_id, 20) : null,
    group, kind, label, why: S(why, 300), contacted: contactOf(kase, r), approval: approvalOf(kase, r), ...extra })
  const out: Any = { ready: [], review: [], dont: [], hidden: 0 }
  const seen = new Set<string>()
  const add = (g: string, x: Any) => { const k = x.axiscare_id || nk(x.name); if (seen.has(k)) return; seen.add(k); out[g].push(x) }
  for (const j of ready) {
    const r = j.row
    const label = r.history?.visits ? 'Familiar' : j.prn ? (r.prn_pref?.team === 'caregiver' ? 'PRN Caregiver Team' : 'PRN CNA Team') : ''
    add('ready', row(r, 'ready', 'ready', label, j.note ? `${r.why || ''}. ${j.note}` : (r.why || ''), { prn: !!j.prn }))
  }
  for (const e of judgedOut) {
    if (CALL_CODES.includes(e.code)) add('review', row(e, 'review', 'call', CALL_WORDS[e.code] || 'Your call', e.why, { code: e.code }))
    else add('dont', row(e, 'dont', 'dont', DONT_WORDS[e.code] || 'Not asked', e.why, { code: e.code }))
  }
  for (const e of listOut) {
    /* inactive in AxisCare (whatever cut them first), retired roster records, nurses and office staff: counted, never listed */
    /* the "Canceled Shift" placeholder is not a person (her screenshots, 2026-10-24): never listed or counted */
    if (/^cancel+ed( shifts?)?$/i.test(S(e.name, 40))) continue
    if (HIDDEN_CODES.includes(e.code) || e.ax_active === false) { if (e.code !== 'asked') out.hidden++; continue }
    if (CARE_CODES.includes(e.code)) {
      const blocking = blockingTasks(e.care, e.cg_level ?? e.care?.cg_level)
      add('review', row(e, 'review', 'care', CARE_WORDS[e.code] || 'Care review', e.why, { code: e.code, care: e.care ?? null, cg_level: e.cg_level ?? e.care?.cg_level ?? null,
        client_level: e.client_level ?? e.care?.client_level ?? null, blocking: blocking.map((t: Any) => ({ key: t.key, label: t.label, level: t.level })) }))
    } else add('dont', row(e, 'dont', 'dont', DONT_WORDS[e.code] || 'Not asked', e.why, { code: e.code }))
  }
  return out
}

/** A coordinator's approval of a care-review caregiver for THIS shift: what must be true before it is recorded and sent. */
export function checkApproval(row: Any, b: Any): { ok: boolean; why: string | null; adjusted: Any[]; still: Any[] } {
  if (!row || row.kind !== 'care') return { ok: false, why: 'This caregiver is not waiting on a care review for this shift.', adjusted: [], still: [] }
  const adjust: Record<string, string> = {}
  for (const [k, v] of Object.entries((b && typeof b.adjust === 'object' && b.adjust) || {})) if (v === 'moved' || v === 'not_needed') adjust[k] = String(v)
  const still = blockingTasks(row.care, row.cg_level, adjust)
  if (still.length) return { ok: false, why: 'Still in the way: ' + still.map((t: Any) => t.label).join(', ') + '. Move it or mark it not needed tonight, or this caregiver can\'t take the shift.', adjusted: [], still }
  if (b?.checks?.skills !== true) return { ok: false, why: 'Confirm the remaining tasks are within their verified skills.', adjusted: [], still }
  if (b?.checks?.payer !== true) return { ok: false, why: 'Confirm this is allowed by our policy and the client\'s payer.', adjusted: [], still }
  const tasks = Array.isArray(row.care?.tasks) ? row.care.tasks : []
  const adjusted = Object.entries(adjust).map(([k, v]) => ({ key: k, label: (tasks.find((t: Any) => t.key === k) || { label: k }).label, change: v }))
  if (adjusted.length && !S(b?.agreed_by)) return { ok: false, why: 'Say who agreed to the change (the client or family, and how).', adjusted, still }
  if (!S(b?.why)) return { ok: false, why: 'Say why this coverage is appropriate.', adjusted, still }
  if (adjusted.some((a) => a.change === 'moved') && !S(b?.moved_to)) return { ok: false, why: 'Say when the moved task will be done.', adjusted, still }
  return { ok: true, why: null, adjusted, still }
}
