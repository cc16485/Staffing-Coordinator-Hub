// =============================================================================
// caregiver-hiring-history — READ-ONLY: the historical hiring story
// =============================================================================
// Her phase order (2026-09-20): Hiring & Experience = what happened during
// recruiting and what CC learned AT THE TIME, preserved with source context
// and gaps — distinct from Skills (the operational present). This endpoint
// follows the caregiver-knowledge pattern: browser gets ONLY the one
// caregiver's history; exact numeric AxisCare id required; approved
// DETERMINISTIC identity linkage only (candidate_id / axiscare_id /
// axiscare_applicant_id equality — NO name/phone/email matching exists in
// this file); ambiguity → an honest review state, never a chosen record.
// READ-ONLY BY CONSTRUCTION: no mutation call of any kind exists here.
// spanish_speaking stays in the unresolved technical block ONLY — its boolean
// semantics are not established, so it is never rendered as an assertion.
// =============================================================================
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' }

function callerRole(req: Request): string {
  try {
    const tok = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    return String(JSON.parse(atob(tok.split('.')[1] ?? ''))?.role ?? '')
  } catch { return '' }
}

/* Interview experience fields as the SOURCE recorded them — both Alzheimer's
   and dementia are preserved as the two questions that actually existed. */
const INTERVIEW_FIELDS: [string, string, string][] = [
  ['alzheimers', "Alzheimer's care", 'dementia_care.experience'],
  ['dementia', 'Dementia care', 'dementia_care.experience'],
  ['bed_bound', 'Bedbound care', 'bedbound_care.experience'],
  ['gait_belt', 'Transfers / gait belt', 'transfers_gait_belt.experience'],
  ['hoyer_lift', 'Hoyer lift', 'hoyer_lift.experience'],
  ['hospice', 'Hospice', 'hospice_support.experience'],
  ['parkinsons', "Parkinson's", 'parkinsons_care.experience'],
  ['personal_care', 'Personal care', 'personal_care.experience'],
  ['transportation', 'Transportation (own vehicle)', 'transportation.experience'],
]
const ENV_FIELDS: [string, string, string][] = [
  ['cats', 'Cats', 'cats.willingness'],
  ['dogs', 'Dogs', 'dogs.willingness'],
  ['smoking', 'Smoking in the home', 'smoking.willingness'],
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200, headers: cors })
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })
  const r = callerRole(req)
  if (r !== 'authenticated' && r !== 'service_role') return json({ error: 'a signed-in session is required' }, 403)
  // deno-lint-ignore no-explicit-any
  let body: any = {}
  try { body = await req.json() } catch { /* GET */ }
  const axid = String(body?.axiscare_id ?? new URL(req.url).searchParams.get('axiscare_id') ?? '')
  if (!/^\d+$/.test(axid)) return json({ error: 'axiscare_id must be the numeric AxisCare caregiver id' }, 400)

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const ambiguities: string[] = []

  // — application (hub project, deterministic ids only) —
  const { data: apps } = await sb.from('job_applicants')
    .select('id, created_at, completed_at, status, experience_years, experience_kinds, work_history')
    .or(`axiscare_id.eq.${axid},candidate_id.eq.${axid}`)
  let application: Record<string, unknown> = { found: false,
    honest: 'No online application record — no deterministically connected /apply record exists. This does not imply an application was required in their hiring path.' }
  if (apps && apps.length === 1) {
    const a = apps[0]
    application = { found: true, record_id: a.id, created: String(a.created_at).slice(0, 10),
      completed: a.completed_at ? String(a.completed_at).slice(0, 10) : null, status: a.status,
      experience_years: a.experience_years, experience_kinds: a.experience_kinds,
      work_history_entries: Array.isArray(a.work_history) ? a.work_history.length : 0 }
  } else if (apps && apps.length > 1) { ambiguities.push(`multiple application records (${apps.length}) carry this id — needs review`) }

  // — intake (hub project, candidate_id equality) —
  const { data: intakes } = await sb.from('hire_intake')
    .select('id, created_at, signed_at, refs, candidate_id')
    .eq('candidate_id', Number(axid))
  // deno-lint-ignore no-explicit-any
  let intake: any = { found: false }
  if (intakes && intakes.length >= 1) {
    // Multiple approved intake rows CAN legitimately belong to one person
    // (Ariel's redo case) — all are shown; that is history, not ambiguity.
    intake = { found: true, records: intakes.map((h) => ({ record_id: h.id,
      signed: String(h.signed_at ?? h.created_at).slice(0, 10),
      references: (Array.isArray(h.refs) ? h.refs : []).map((x: { name?: string; relationship?: string }) => ({
        name: String(x?.name ?? ''), relationship: String(x?.relationship ?? ''),
        state: 'contact_provided', honest: 'Contact provided · no connected response recorded' })) })) }
  }

  // — offer/interview (OFFERS project via configured service connection) —
  // deno-lint-ignore no-explicit-any
  let offer: any = { found: false }
  const OF_URL = Deno.env.get('OFFERS_PROJECT_URL') ?? ''
  const OF_KEY = Deno.env.get('OFFERS_SERVICE_ROLE_KEY') ?? ''
  if (!OF_URL || !OF_KEY) offer = { found: false, error: 'offers-project connection not configured — run the deploy script' }
  else {
    const resp = await fetch(`${OF_URL}/rest/v1/job_offers?axiscare_applicant_id=eq.${axid}`
      + `&select=id,created_at,offered_by,interview_date,position,level_suggested,level_confirmed,availability,experience,personality,notes,attributes,attributes_entered_by`,
      { headers: { apikey: OF_KEY, Authorization: `Bearer ${OF_KEY}` } })
    // deno-lint-ignore no-explicit-any
    const rows: any[] = resp.ok ? await resp.json() : []
    if (!resp.ok) offer = { found: false, error: `offers project answered ${resp.status}` }
    else if (rows.length === 1) {
      const o = rows[0]
      const attrs = (typeof o.attributes === 'string' ? JSON.parse(o.attributes || '{}') : o.attributes) || {}
      offer = { found: true, record_id: o.id,
        interview_date: o.interview_date, interviewer: o.offered_by,
        position: o.position, level_suggested: o.level_suggested,
        level_confirmed: o.level_confirmed ?? null,   // preserved honestly, even when unset
        background_freetext: String(o.experience ?? ''),
        availability_at_hiring: String(o.availability ?? ''),
        personality: String(o.personality ?? ''), notes: String(o.notes ?? ''),
        interview_answers: INTERVIEW_FIELDS.map(([k, label, claim]) =>
          ({ field: k, label, claim, answer: attrs[k] === true ? 'yes' : attrs[k] === false ? 'no' : 'unanswered' })),
        environment_answers: ENV_FIELDS.map(([k, label, claim]) =>
          ({ field: k, label, claim, answer: attrs[k] === true ? 'yes' : attrs[k] === false ? 'no' : 'unanswered' })),
        attribute_typist: o.attributes_entered_by || null,   // null = unknown, permanently honest
        unresolved_source_fields: { spanish_speaking: attrs.spanish_speaking ?? null,
          note: 'boolean semantics not established (explicit answer vs default) — never rendered as an assertion' } }
    } else if (rows.length > 1) ambiguities.push(`multiple offer records (${rows.length}) carry this applicant id — needs review`)
  }

  // — the Foundation bridge (derived live, never hard-coded) —
  const { data: clrow } = await sb.from('app_data').select('data').eq('key', 'caregiver_claims').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const claims: any[] = (Array.isArray(clrow?.data) ? clrow!.data : []).filter((c: { axiscare_id?: unknown }) => String(c?.axiscare_id) === axid)
  const inFoundation = new Set(claims.map((c) => String(c.claim)))
  const bridge = [...INTERVIEW_FIELDS.filter(([k]) => k !== 'alzheimers'), ...ENV_FIELDS].map(([k, label, claim]) => ({
    field: k, label, claim,
    eligible_to_support: claim.endsWith('.experience') ? 'Self-reported experience' : 'Self-reported willingness',
    evidence_status: inFoundation.has(claim) ? 'in_foundation' : 'not_added' }))

  const found = (application as { found: boolean }).found || intake.found || offer.found
  const gaps: string[] = []
  if (!(application as { found: boolean }).found) gaps.push('No connected online application record.')
  if (offer.found) {
    gaps.push('No per-question interview script, scores, or interviewer notes exist — the interviewer is known; the questions are not.')
    gaps.push('No interview recording or transcript exists.')
    if (!offer.attribute_typist) gaps.push('The original typist of the structured interview answers is unknown — permanently represented as such.')
    gaps.push('Structured experience answers are yes/no only — depth, years, and settings were not captured outside the free text.')
  }
  if (intake.found) gaps.push('Reference answers do not exist in any connected system — only the contacts provided. Whether outreach occurred is not recorded.')

  return json({ ok: true, axiscare_id: axid, found,
    honest_empty: found ? null : 'No connected hiring history found in the current recruiting records. This does not mean they were never interviewed or references were never checked — it means no defensibly connected records exist today.',
    ambiguities, application, intake, offer, bridge, gaps })
})
