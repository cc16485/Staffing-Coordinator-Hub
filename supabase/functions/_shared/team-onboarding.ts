// =============================================================================
// team-onboarding.ts · where someone still onboarding is, in Team Builder's words (Samantha, 2026-10-14)
// =============================================================================
// Her ask: "only include people who have completed step one in the team builder - and of course have them marked that
// they have completed step 1 or their orientation is scheduled, or completed need to do alz and dementia course".
// Her choices: these four labels; people already on a plan who haven't finished Step 1 stay where they are, marked.
//   step1_not_done   Step 1 not finished                       (never offered in Team Builder's onboarding list)
//   step1_done       Step 1 done (checks running)
//   orientation_set  Orientation scheduled for <day>           (the Orientation Video Call is booked)
//   needs_dementia   Orientation done, needs the Alzheimer's/dementia course
//   ready            Ready, waiting on Approve to Work
//   approved         Approved to Work                           (not onboarding any more)
// Facts only from records: a blank is never done.
// deno-lint-ignore-file no-explicit-any
type Any = any
export type TbFacts = { step1_done: boolean; ovc?: { status?: string; starts_at?: string | null; done_at?: string | null } | null; orientation_done: boolean; dementia_done: boolean; approved: boolean }
export const TB_LABEL: Record<string, string> = {
  step1_not_done: 'Step 1 not finished', step1_done: 'Step 1 done (checks running)', orientation_set: 'Orientation scheduled',
  needs_dementia: "Orientation done, needs the Alzheimer's/dementia course", ready: 'Ready, waiting on Approve to Work', approved: 'Approved to Work',
}
const dayWord = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Chicago' })

export function tbStage(f: TbFacts, now = Date.now()): { key: string; label: string } {
  const orientationDone = f.orientation_done || f.ovc?.status === 'done' || !!f.ovc?.done_at
  if (f.approved) return { key: 'approved', label: TB_LABEL.approved }
  if (!f.step1_done) return { key: 'step1_not_done', label: TB_LABEL.step1_not_done }
  /* 2026-10-21 orientation only (her rule 2026-10-15): the dementia course is optional, so orientation done is ready */
  if (orientationDone) return { key: 'ready', label: TB_LABEL.ready }
  if (f.ovc?.status === 'booked' && f.ovc.starts_at && Date.parse(f.ovc.starts_at) > now - 2 * 3600e3)
    return { key: 'orientation_set', label: TB_LABEL.orientation_set + ' for ' + dayWord(f.ovc.starts_at) }
  return { key: 'step1_done', label: TB_LABEL.step1_done }
}

/** The facts, read for one person (resolve() from hire-profile gives offer, cand, rec, journey). */
export async function tbFacts(db: Any, p: Any, step1: Any): Promise<TbFacts> {
  const newPath = p.offer ? p.offer.onboarding_path === 'new' : !!step1
  /* Step 1: the signed Step 1 (new path), or on the old path being in Background & References / on the roster (their start form) */
  const step1_done = newPath ? !!step1?.completed_at : !!(p.cand || p.rec)
  let ovc: Any = null
  const candId = p.cand?.id ?? p.rec?.candidate_id
  if (candId != null) {
    try { const { data } = await db.from('welcome_calls').select('status, starts_at, done_at, booked_at').eq('candidate_id', String(candId)).neq('status', 'cancelled').order('invited_at', { ascending: false }).limit(1)
      ovc = data?.[0] ?? null } catch { ovc = null }
  }
  const steps: Record<string, string> = {}
  if (p.journey?.journey_id) {
    try { const { data } = await db.from('client_journey_step').select('step_key, state').eq('journey_id', p.journey.journey_id).in('step_key', ['cg.training.orientation', 'cg.training.dementia', 'cg.approve.work'])
      for (const s of data ?? []) steps[s.step_key] = s.state } catch { /* facts stay blank, never done */ }
  }
  const done = (k: string) => ['complete', 'not_needed', 'exception'].includes(steps[k])
  return { step1_done, ovc, orientation_done: done('cg.training.orientation') || !!p.rec?.orient_date, dementia_done: done('cg.training.dementia') || !!p.rec?.alz_date,
    approved: done('cg.approve.work') || !!p.rec?.approved_to_work_at }
}
