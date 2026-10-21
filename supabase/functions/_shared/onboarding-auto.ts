// =============================================================================
// onboarding-auto.ts · two things the readiness sweep now does by itself (Samantha approved the onboarding design,
// 2026-10-21: "I approve the onboarding design with your recommended answers to decisions 2 to 6. Go ahead and build it.")
// =============================================================================
//   advanceDue   decision 3: Approve to Advance completes by itself when every row the catalog puts in front of it is done
//                and nothing on the card is blocked. A flagged check, a Negative or an undecided Conditional reference keeps
//                it for the owners, exactly as today. Switch: approve_advance_auto_live (off = practice: one event says what
//                it would have done, nothing is completed).
//   oigWanted    the OIG search runs the moment Step 1 lands a person in Background & References (new path only). The
//                result is EVIDENCE for the coordinator, never a verdict: CLEAR is still pressed by a person. Switch:
//                oig_auto_search_live (off = practice: the would-search is recorded, nothing is downloaded or stored).
// Pure: the sweep in caregiver-journey/index.ts reads and writes; these only decide.
// deno-lint-ignore-file no-explicit-any
type Any = any
export const ADV_KEY = 'cg.approve.advance'
const DONE = ['complete', 'not_needed', 'exception']

/** Is Approve to Advance due to complete by itself? view = JourneyRules.compute(...), dfs = the catalog. */
export function advanceDue(view: Any, dfs: Any[]): { due: boolean; waiting: string[]; blocked: string[]; evidence: Any[] } {
  const rows: Any[] = view?.rows || []
  const adv = rows.find((r) => r.key === ADV_KEY)
  if (!adv || (adv.st && DONE.includes(adv.st.state))) return { due: false, waiting: [], blocked: [], evidence: [] }
  const def = dfs.find((d) => d.key === ADV_KEY)
  const before: string[] = Array.isArray(def?.after) ? def.after : []
  const shown = new Map(rows.map((r) => [r.key, r]))
  /* a row in front that does not apply to this person is not on the card (rows only lists rows that apply) */
  const waiting = before.filter((k) => shown.has(k) && !(shown.get(k).st && DONE.includes(shown.get(k).st.state)))
  const blocked = rows.filter((r) => r.status === 'blocked').map((r) => r.key)
  const evidence = before.filter((k) => shown.has(k)).map((k) => ({ key: k, state: shown.get(k).st?.state ?? null, at: shown.get(k).st?.completed_at ?? null }))
  return { due: before.length > 0 && !waiting.length && !blocked.length, waiting, blocked, evidence }
}

/** Should the OIG search run for this Background & References row now? prev = its oig_auto_search item, if any. */
export function oigWanted(c: Any, prev: Any, live: boolean): boolean {
  if (!c || c.not_hired || c.onboarding_path !== 'new') return false
  if (c.oig === 'CLEAR' || c.oig === 'FLAGGED' || c.oig_date) return false            // a person already recorded it
  if (!(c.first && c.last)) return false
  if (!prev) return true
  return live && prev.practice === true                                               // practice recorded it; live runs it once
}
export const oigItemId = (candId: unknown) => 'oig_' + String(candId ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60)
