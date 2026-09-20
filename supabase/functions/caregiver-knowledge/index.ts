// =============================================================================
// caregiver-knowledge — READ-ONLY projection of the Evidence Foundation
// =============================================================================
// Her phase order (2026-09-20): the browser never touches the three protected
// namespaces; this endpoint reads them SERVER-SIDE and returns only the one
// caregiver's knowledge, shaped for the profile UI. READ-ONLY BY
// CONSTRUCTION: this file contains no insert, no update, no upsert, no rpc
// write, no delete — there is nothing here that can mutate anything.
// Exact numeric AxisCare id required (fail closed); no list mode (cannot
// enumerate); a caregiver with no evidence gets a valid empty state.
// AUTHORIZATION INVARIANT (her explicit decision, 2026-09-20):
//   Every valid authenticated CC Hub staff account is authorized to view
//   internal caregiver operational knowledge. There is intentionally NO
//   category of "authenticated Hub staff but unauthorized for caregiver
//   knowledge."
//   On this project, authenticated session ⇔ Hub staff account, because
//   public signup is DISABLED (the adversarial-audit containment) and
//   accounts are admin-created — no intermediate principal can exist.
//   Authorization derives ONLY from the platform-verified JWT's role claim.
//   Nothing in the body, query string, or any other header is consulted:
//   staff=true / role=staff / hub_access=true in a request body are inert.
// =============================================================================
import { createClient } from 'npm:@supabase/supabase-js@2'

const LABELS: Record<string, string> = {
  'dementia_care': "Dementia / Alzheimer's care", 'parkinsons_care': "Parkinson's care",
  'hospice_support': 'Hospice support', 'personal_care': 'Personal care',
  'transfers_gait_belt': 'Transfers / gait belt', 'hoyer_lift': 'Hoyer lift',
  'bedbound_care': 'Bedbound care', 'complex_care': 'Complex care',
  'transportation': 'Transportation (own vehicle)',
  'cats': 'Cats', 'dogs': 'Dogs', 'smoking': 'Smoking in the home', 'spanish': 'Spanish',
}
const FAMILY: Record<string, string> = { experience: 'experience', competency: 'competency',
  willingness: 'tolerance', ability: 'proficiency' }
const CATEGORY: Record<string, [string, string]> = {
  caregiver_update: ['self_reported', 'Self-reported'],
  interview_answer: ['self_reported', 'Self-reported'],
  reference_response: ['reference_verified', 'Reference-verified'],
  supervisory_observation: ['observed', 'Observed by Caring Companions'],
  competency_check: ['observed', 'Demonstrated to Caring Companions'],
  training_completion: ['training_supported', 'Training-supported'],
  staff_resolution: ['staff_resolution', 'Staff resolution'],
  legacy_unspecified: ['legacy_unspecified', 'Legacy — source unknown'],
}

function callerRole(req: Request): string {
  try {
    const tok = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    return String(JSON.parse(atob(tok.split('.')[1] ?? ''))?.role ?? '')
  } catch { return '' }
}

Deno.serve(async (req) => {
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
  const r = callerRole(req)
  if (r !== 'authenticated' && r !== 'service_role') return json({ error: 'a signed-in session is required' }, 403)

  // deno-lint-ignore no-explicit-any
  let body: any = {}
  try { body = await req.json() } catch { /* GET or empty */ }
  const axid = String(body?.axiscare_id ?? new URL(req.url).searchParams.get('axiscare_id') ?? '')
  if (!/^\d+$/.test(axid)) return json({ error: 'axiscare_id must be the numeric AxisCare caregiver id' }, 400)

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  // deno-lint-ignore no-explicit-any
  const read = async (key: string): Promise<any[]> => {
    const { data } = await sb.from('app_data').select('data').eq('key', key).maybeSingle()
    return (Array.isArray(data?.data) ? data!.data : []).filter((x: { axiscare_id?: unknown }) => String(x?.axiscare_id) === axid)
  }
  const evs = await read('caregiver_evidence_events')
  const lns = await read('caregiver_claim_links')
  const cls = await read('caregiver_claims')

  const facts = cls.map((c) => {
    const claim = String(c.claim)
    const [domain, suffix] = [claim.split('.')[0], claim.split('.')[1] ?? '']
    const myLinks = lns.filter((l) => l.claim === claim)
    const evidence = myLinks.map((l) => {
      const e = evs.find((x) => x.id === l.event_id)
      if (!e) return null
      const [cat, catLabel] = CATEGORY[String(e.type)] ?? ['unknown', 'Unknown basis']
      return { category: cat, category_label: catLabel, type: e.type,
        source_person: e.source_person, occurred_at: e.occurred_at,
        occurred_precision: e.occurred_precision, recorded_at: e.recorded_at,
        recorded_by: e.recorded_by, recorded_via: e.recorded_via ?? null,
        source_record: e.source_record, note: e.note, event_id: e.id,
        asserts: l.asserts }
    }).filter(Boolean)
    return { claim, family: FAMILY[suffix] ?? suffix, label: LABELS[domain] ?? domain,
      value: c.value, state: c.state, registry_version: c.registry_version, evidence }
  })
  return json({ ok: true, axiscare_id: axid, empty: facts.length === 0, facts })
})
