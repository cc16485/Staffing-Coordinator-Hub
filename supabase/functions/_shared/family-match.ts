// =============================================================================
// family-match: Release 3, safe matching for app offers (Samantha 2026-10-17: "Start Release 3."; decisions 4 and 5,
// https://claude.ai/artifact/AS6GbybmUqC47WKPto44p8). Her principle: block only where a mistake is unsafe or breaks a promise;
// otherwise tell the caregiver on the offer link and let them decide.
// The Hub's ONE matching rulebook (match-rules.js, CCMatch, run on the server only when its fingerprint is approved) decides,
// fed only what matters on a companion visit:
//   hard  the approved level covers the client's level (AxisCare classes; caregiver unknown = Level 1, client unknown = 1),
//         caregiver gender when the client REQUIRES one, Spanish when REQUIRED, dementia training when dementia care is
//         REQUIRED, "not with cats / dogs / smoking" only when the caregiver said "not now", and the client's call-in plan
//         "only ask" list. (Cleared to work, Do Not Return, No shift texts, the new-hire lock, driving and "already working"
//         are checked before this by shiftAskBlock and the schedule read, as today.)
//   rank  gender or Spanish preferred (people who match go first, nobody is left out)
//   show  cats, dogs, smoking in the home: on the caregiver's offer link ("Dorothy has cats"), the caregiver decides
//   never personal-care skills: app visits are companion only.
// Client answers count only on the care plan (the Care tab's five quick answers); not answered = no rule.
// Pure: the rulebook and the records come in as arguments (Node tests).
// =============================================================================
// deno-lint-ignore-file no-explicit-any
type Any = any

export type MatchClient = { level: number; facts: Any[] | null; onlyAsk: { axiscare_id: string; name: string }[]; name: string }
export type MatchCaregiver = { axiscare_id: string; name: string; level: number | null; gender: string | null; dementia_trained: boolean; overlay: Any | null }

/** The client as the rulebook sees it on a companion visit: level, the five answers, dementia care. Nothing else. */
export function companionClient(M: Any, c: MatchClient) {
  const ff = M.fromFacts(c.facts || [])
  const needs: Record<string, Any> = {}
  if (ff.needs?.dementia_care) needs.dementia_care = ff.needs.dementia_care   // only dementia care is a companion-visit need
  return { name: c.name, payer: null, level: c.level || 1, plan_current: true, needs, facts: ff.facts || {}, lift_type: null, advanced_tasks: [], dnr_axiscare_ids: [] }
}

/** What the caregiver should know before saying yes (shown on their offer link). */
export function homeNotes(M: Any, c: MatchClient): string[] {
  const f = M.fromFacts(c.facts || []).facts || {}, first = String(c.name || '').split(' ')[0] || 'The client'
  const out: string[] = []
  if (f.cats === true) out.push(`${first} has cats`)
  if (f.dogs === true) out.push(`${first} has dogs`)
  if (f.smoking === true) out.push('Someone smokes in the home')
  return out
}

/** One caregiver for one app visit: null = may be asked, else the one reason they're not. Plus a rank (higher asks first). */
export function judge(M: Any, client: MatchClient, cg: MatchCaregiver, today: string): { cut: string | null; rank: number } {
  const ids = new Set((client.onlyAsk || []).map((x) => String(x.axiscare_id)))
  if (ids.size && !ids.has(String(cg.axiscare_id))) {
    const names = client.onlyAsk.map((o) => String(o.name).split(/\s+/)[0]).join(' or ')
    return { cut: `not on ${String(client.name).split(' ')[0]}'s call-in list (only ${names})`, rank: 0 }
  }
  const of = M.overlayFacts(cg.overlay)
  const person = { name: cg.name, axiscare_id: cg.axiscare_id, cleared: true, level: cg.level || 1, training: { dementia: !!cg.dementia_trained }, gender: cg.gender,
    skills: {}, willing: of.willing, spanish: of.spanish, restrictions: [], availability: { free: true }, strengths: [] }
  const r = M.evaluate(companionClient(M, client), person, { today, driveGate: false })
  return r.group === 'not_for_visit' ? { cut: r.reason || 'not a match for this client', rank: 0 } : { cut: null, rank: (r.ranks || []).length }
}
