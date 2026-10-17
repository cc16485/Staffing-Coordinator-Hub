// =============================================================================
// agreement-steps · Stage 4 (875, Samantha 2026-10-17: "continue to stage 4"; her answer "Yes, tick them"). When the office
// countersigns a Client Care Agreement in the Hub, the Hub ticks the agreement steps itself, the way it already ticks
// "Enter the care plan" after AxisCare reads the care tasks back:
//   * Start of Care (private pay, the client's lead): p1 "Care Agreement provided" and p2 "Signed Care Agreement received",
//     done_by "Automatic: ..." with a note. Saved with lead_put_if_same, so it never overwrites a change someone made at the
//     same moment (it reads again and retries once).
//   * Client journey: docs.agreement "Service agreement signed and on file", completed by "Client Care Agreement (signed in
//     the Hub)" with the agreement id as its evidence, plus a journey event (the same direct write Hepatitis B uses).
// "Uploaded to AxisCare" (SOC p3, journey ax.docs) stays a person's tick: AxisCare's API cannot take documents.
// A step already done is never touched. Paper agreements (her answer "Keep paper as a backup") are ticked by hand as before.
// Best effort: never throws, never blocks the countersign; returns what it did for the countersign screen.
// =============================================================================
// deno-lint-ignore no-explicit-any
type Any = any
const JOURNEY_KEY = 'docs.agreement'
const SOC_KEYS = ['p1', 'p2']

export type StepsResult = { soc: 'ticked' | 'already' | 'no_soc' | 'conflict' | 'error'; journey: 'ticked' | 'already' | 'no_journey' | 'error' }

export function tickSoc(lead: Any, p: { at: string; by: string; how: string; when: string }): Any | null {
  const soc = lead?.soc
  if (!soc || soc.pathway !== 'PP' || soc.abandoned || !Array.isArray(soc.steps)) return null
  let changed = false
  const steps = soc.steps.map((s: Any) => {
    if (!SOC_KEYS.includes(s?.id) || s.done_at) return s
    changed = true
    const note = `Client Care Agreement signed ${p.how} on ${p.when}, countersigned by ${p.by}. Open it from the Client Care Agreement card.`
    return { ...s, done_at: p.at, done_by: `Automatic: signed in the Hub, countersigned by ${p.by}`, note: s.note ? s.note + ' · ' + note : note }
  })
  return changed ? { ...lead, soc: { ...soc, steps } } : null
}

async function socPart(db: Any, ax: string, p: { at: string; by: string; how: string; when: string }): Promise<StepsResult['soc']> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data: row, error } = await db.from('app_data').select('data').eq('key', 'leads').maybeSingle()
    if (error) return 'error'
    const leads: Any[] = Array.isArray(row?.data) ? row.data : []
    const mine = leads.filter((l) => String(l?.axiscare_client_id ?? '') === ax && l?.soc && l.soc.pathway === 'PP' && !l.soc.abandoned)
    if (!mine.length) return 'no_soc'
    let any = false, conflict = false
    for (const lead of mine) {
      const after = tickSoc(lead, p)
      if (!after) continue
      const { data: ok, error: e2 } = await db.rpc('lead_put_if_same', { p_id: String(lead.id), p_before: lead, p_after: after })
      if (e2) return 'error'
      if (ok === true) any = true; else conflict = true
    }
    if (!conflict) return any ? 'ticked' : 'already'
  }
  return 'conflict'
}

async function journeyPart(db: Any, r: Any, p: { at: string; by: string; how: string }): Promise<StepsResult['journey']> {
  const { data: js, error } = await db.from('client_journey').select('journey_id, status, is_test, created_at').eq('subject', 'client').eq('axiscare_client_id', String(r.axiscare_client_id))
  if (error) return 'error'
  const list = (js ?? []).filter((j: Any) => j && j.status !== 'closed')
  const j = list.find((x: Any) => x.status === 'open') ?? [...list].sort((a: Any, b: Any) => String(b.created_at).localeCompare(String(a.created_at)))[0]
  if (!j) return 'no_journey'
  const { data: cur } = await db.from('client_journey_step').select('*').eq('journey_id', j.journey_id).eq('step_key', JOURNEY_KEY).maybeSingle()
  if (cur && ['complete', 'not_needed'].includes(cur.state)) return 'already'
  const evidence = { ...(cur?.evidence ?? {}), agreement: { id: r.id, countersigned_at: p.at, how: p.how, version: r.version } }
  const { error: e2 } = await db.from('client_journey_step').upsert({ journey_id: j.journey_id, step_key: JOURNEY_KEY, state: 'complete', evidence,
    completed_by: 'client-agreement', completed_by_name: 'Client Care Agreement (signed in the Hub)', completed_at: p.at, exception: null,
    version: (cur?.version ?? 0) + 1, updated_at: p.at }, { onConflict: 'journey_id,step_key' })
  if (e2) return 'error'
  await db.from('client_journey_event').insert({ journey_id: j.journey_id, step_key: JOURNEY_KEY, actor_email: 'client-agreement', actor_name: 'Client Care Agreement (signed in the Hub)',
    kind: 'verified', detail: { via: 'client agreement', agreement_id: r.id, countersigned_by: p.by, how: p.how }, reason: null, is_test: !!j.is_test })
  return 'ticked'
}

export async function tickAgreementSteps(db: Any, r: Any, p: { at: string; by: string; fromHome: boolean; when: string }): Promise<StepsResult> {
  const how = p.fromHome ? 'from home' : 'on the tablet'
  let soc: StepsResult['soc'] = 'error', journey: StepsResult['journey'] = 'error'
  try { soc = await socPart(db, String(r.axiscare_client_id), { at: p.at, by: p.by, how, when: p.when }) } catch { soc = 'error' }
  try { journey = await journeyPart(db, r, { at: p.at, by: p.by, how }) } catch { journey = 'error' }
  return { soc, journey }
}
