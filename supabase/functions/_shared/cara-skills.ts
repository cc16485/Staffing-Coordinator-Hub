// =============================================================================
// cara-skills.ts · CARA PHASE 1: the verified-skills rules on a call-off list (Samantha, 2026-10-23: "Use our existing
// verified-skills rules"). The same rulebook the dark report, Caregiver Matching and the family app run (match-rules.js,
// CCMatch, and eligibility-rules.js, CCElig, downloaded from cc.mo-care.com and run only when they are GitHub main's copy:
// _shared/approved-rules.ts), fed through the same builder as the dark report (_shared/match-dark.ts makePeople), for ONE
// client and the caregivers on the list. Reads only; writes nothing but the rules_approved line approvedRules keeps.
// Unreadable rules or records = the judge is null and the list says "skills not checked" (nobody is cut by a check that
// could not run; every other gate on the list still holds).
// =============================================================================
// deno-lint-ignore-file no-explicit-any
import { approvedRules } from './approved-rules.ts'
import { careLevelOf } from './care-level.ts'
import { resolvePayer } from './client-events.ts'
import { experienceSummary } from './step1-experience.ts'
import { makePeople } from './match-dark.ts'

const rowsOf = (v: any): any[] => Array.isArray(v) ? v : (v && typeof v === 'object') ? Object.values(v) : []
const PAYER: Record<string, string> = { 'medicaid': 'medicaid', 'private pay': 'private', 'private': 'private', 'va': 'va', 'veterans affairs': 'va', 'ltc': 'ltc', 'long term care': 'ltc', 'long-term care': 'ltc', 'medicare guide': 'guide', 'guide': 'guide', 'cds': 'cds' }
const payerOf = (classes: any) => { const p = resolvePayer(rowsOf(classes)).payer; return p ? (PAYER[p.toLowerCase()] || p.toLowerCase()) : null }

export type SkillJudge = { judge: ((axId: string) => any) | null; why: string | null; client_state: string | null; rule_version: string | null }

/** clientAxId + the AxisCare client record; axCaregivers = the census rows already read; roster = app_data caregivers. */
export async function loadSkillJudge(db: any, p: { clientAxId: string | null; axClient: any | null; axCaregivers: any[]; roster: any[]; lock: any; driveGate: boolean; today: string }): Promise<SkillJudge> {
  if (!p.clientAxId) return { judge: null, why: 'skills not checked: the client is not identified in AxisCare', client_state: null, rule_version: null }
  try {
    const rules: Record<string, any> = {}
    for (const [f, g] of [['match-rules.js', 'CCMatch'], ['eligibility-rules.js', 'CCElig']]) {
      const a = await approvedRules(db, f); if (!a.ok) return { judge: null, why: 'skills not checked: ' + a.error, client_state: null, rule_version: null }
      ;(0, eval)(a.src); rules[g] = (globalThis as any)[g]
      if (!rules[g]) return { judge: null, why: 'skills not checked: ' + f + ' did not load', client_state: null, rule_version: null }
    }
    const key = async (k: string) => { const { data } = await db.from('app_data').select('data').eq('key', k).maybeSingle(); return data?.data ?? null }
    const [overlay, dnr, availability] = await Promise.all(['caregiver_overlay', 'dnr_log', 'caregiver_availability'].map(key))
    /* the client's care needs: AxisCare client → person → active Journey → the fact record (none = no Journey, an incomplete client) */
    let facts: any[] | null = null
    const { data: ps } = await db.from('person_source_id').select('person_id').eq('system', 'axiscare').eq('entity_type', 'client').eq('source_id', p.clientAxId)
    const persons = (ps ?? []).map((r: any) => r.person_id)
    if (persons.length) {
      const { data: eps } = await db.from('journey_episode').select('episode_id, state, created_at').in('person_id', persons)
      const ep = (eps ?? []).filter((e: any) => ['provisional', 'open', 'converted', 'established'].includes(e.state)).sort((a: any, z: any) => String(z.created_at).localeCompare(String(a.created_at)))[0]
      if (ep) { const { data: fs } = await db.from('client_fact_current').select('episode_id, kind, layer, value').eq('episode_id', ep.episode_id).in('layer', ['plan', 'current']); facts = fs ?? [] }
    }
    /* Step 1 skills pictures, for roster caregivers who came through the new Step 1 */
    const step1ByAx: Record<string, any> = {}
    const withOffer = rowsOf(p.roster).filter((r: any) => r?.offer_id && r?.axiscare_id)
    if (withOffer.length) {
      const { data: f1 } = await db.from('step1_forms').select('offer_id, answers').in('offer_id', withOffer.map((r: any) => r.offer_id))
      const { data: rr } = await db.from('reference_requests').select('*').in('candidate_id', withOffer.map((r: any) => String(r.candidate_id ?? '')).filter(Boolean))
      for (const r of withOffer) { const f = (f1 ?? []).find((x: any) => x.offer_id === r.offer_id); if (f?.answers) step1ByAx[String(r.axiscare_id).replace(/\D/g, '')] = experienceSummary(f.answers, (rr ?? []).filter((q: any) => String(q.candidate_id) === String(r.candidate_id))) }
    }
    const P = makePeople({ M: rules.CCMatch, E: rules.CCElig, levelOf: (c: any) => careLevelOf(c).level, payerOf,
      axCaregivers: p.axCaregivers, axClients: p.axClient ? [{ ...p.axClient, id: p.clientAxId }] : [], roster: rowsOf(p.roster),
      overlay: rowsOf(overlay), availability: rowsOf(availability), dnr: rowsOf(dnr), factsByClient: { [p.clientAxId]: facts }, step1ByAx, lock: p.lock })
    const client = P.clientOf(p.clientAxId), cs = rules.CCMatch.clientState(client)
    /* availability is judged on its own (Unknown is never a fit) and the schedule read is the list's own, so the rule
       is asked only about the person: cleared, level, skills, Do Not Return, the home, gender and Spanish */
    /* a client flagged as a whole ("needs a lift before we staff", a Medicaid review) would rule out every caregiver; on a
       call-off for someone already in care that would empty the list, so the flag is shown on the case instead and each
       person is judged on their own record */
    const csPeople = cs.status === 'flagged' || cs.status === 'not_matched' ? { status: 'ok', message: '' } : cs
    /* "cleared to work" (OIG, licenses and the other eligibility checks): the rule is asked as if they were cleared, so it still
       judges skills, level and the home, and an expired or missing clearance comes back as cleared_note. coverage-run lists those
       people apart as "Needs Verification", never offerable (Samantha, 2026-10-23: shown so the office knows why, but no shift
       offers until verified). The new-hire lock is still cut by coverage-run. */
    const judge = (axId: string) => { const cg = P.cgOf(String(axId))
      const r = rules.CCMatch.evaluate(client, { ...cg, cleared: true, availability: { free: true } }, { today: p.today, driveGate: p.driveGate, clientState: csPeople })
      return { ...r, cleared_note: cg.cleared ? null : 'Not cleared to work: ' + String(cg.cleared_reason || 'a required check is not complete') } }
    return { judge, why: null, client_state: cs.status === 'ok' ? 'ok' : cs.status + ': ' + cs.message, rule_version: rules.CCMatch.VERSION ?? null }
  } catch (e) { return { judge: null, why: 'skills not checked: ' + String((e as Error)?.message || e).slice(0, 160), client_state: null, rule_version: null } }
}
