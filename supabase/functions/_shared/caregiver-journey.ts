// =============================================================================
// caregiver-journey.ts · SLICE 3b (Samantha approved Migrations A and B, 2026-10-10): the caregiver journey's shared core
// =============================================================================
// The offer-to-Approved-to-Work journey on the SAME tables and rules file as the client journey (section 29 of the plan):
// client_journey (subject = 'caregiver', offer_id), client_journey_step, client_journey_event (permanent), the cg.* rows of
// client_journey_step_def. Three things live here so offer-sign, welcome-call, reference-send and the caregiver-journey
// function all decide alike:
//   startCaregiverJourney  the journey row + 'started' event when both offer documents are signed (idempotent)
//   facts                  what the records already hold about this person (offer, Step 1, the Background & References row,
//                          welcome calls, the roster record, the profile): the sweep verifies rows from these
//   verifyRows             which 'verified' and 'proof' rows are satisfied by the facts, with their evidence (no value is
//                          ever an identity number)
//   caregiverGate          the server refusal: may this action happen for this person? (allow when no caregiver journey
//                          exists: the old path is untouched)
import '../_shared/journey-rules.js'
// deno-lint-ignore no-explicit-any
type Any = any
const S = (v: unknown, n = 160) => String(v ?? '').trim().slice(0, n)
export const R = (globalThis as Any).JourneyRules   // the rules file attaches itself as JourneyRules (the same object the client journey uses)

export async function startCaregiverJourney(db: Any, o: { id: string; first_name?: string; last_name?: string }, by: string): Promise<{ journey_id: string | null; created: boolean }> {
  const name = `${S(o.first_name, 60)} ${S(o.last_name, 60)}`.trim() || 'Caregiver'
  const { data: have } = await db.from('client_journey').select('journey_id').eq('offer_id', o.id).maybeSingle()
  if (have?.journey_id) return { journey_id: have.journey_id, created: false }
  const { data, error } = await db.from('client_journey').insert({ subject: 'caregiver', offer_id: o.id, client_name: name, status: 'open', created_by: by }).select('journey_id').maybeSingle()
  if (error || !data?.journey_id) { const again = await db.from('client_journey').select('journey_id').eq('offer_id', o.id).maybeSingle(); return { journey_id: again.data?.journey_id ?? null, created: false } }
  await db.from('client_journey_event').insert({ journey_id: data.journey_id, step_key: null, actor_email: by, actor_name: 'The Hub', kind: 'started', detail: { subject: 'caregiver', offer_id: o.id } })
  return { journey_id: data.journey_id, created: true }
}

/* the three Admin lists, as the function and the gate read them */
export type Facts = Record<string, Any>
const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '')
const positive = (s: unknown) => /^positive$/i.test(String(s ?? ''))
const clear = (s: unknown) => /^(clear|cleared)$/i.test(String(s ?? ''))
const flagged = (s: unknown) => /flagged|issues found/i.test(String(s ?? ''))

/** Everything the records already hold about the person behind this journey. Never an identity value. */
export async function facts(db: Any, j: Any, trn: { get(id: string): Promise<Any | null> } | null): Promise<Facts> {
  const f: Facts = { offer_id: j.offer_id }
  try { f.offer = trn ? await trn.get(j.offer_id) : null } catch { f.offer = null }
  const { data: s1 } = await db.from('step1_forms').select('answers, signatures, completed_at').eq('offer_id', j.offer_id).maybeSingle()
  f.step1 = s1 || null
  const a = (s1?.answers || {}) as Record<string, unknown>
  f.lived_outside_mo = a.lived_outside_mo === 'yes' ? true : a.lived_outside_mo === 'no' ? false : undefined
  f.claims_cna_or_hha = a.cna === 'yes' || a.hha === 'yes' ? true : (a.cna === 'no' && a.hha === 'no') ? false : undefined
  f.drives_clients = typeof a.driver_ack === 'string' ? /request approval to transport/i.test(a.driver_ack) : undefined
  const lists: Record<string, Any[]> = {}
  for (const key of ['candidates', 'caregivers']) { const { data } = await db.from('app_data').select('data').eq('key', key).maybeSingle(); lists[key] = Array.isArray(data?.data) ? data.data : [] }
  f.candidate = lists.candidates.find((c: Any) => String(c?.offer_id ?? '') === String(j.offer_id)) || null
  f.roster = lists.caregivers.find((c: Any) => String(c?.offer_id ?? '') === String(j.offer_id)) || null
  const person = f.candidate || f.roster
  if (person) {
    /* a moved person keeps their Background & References id on the roster record (candidate_id); look under both */
    const ids = [...new Set([String(person.id), person.candidate_id != null ? String(person.candidate_id) : ''].filter(Boolean))]
    const { data: wc } = await db.from('welcome_calls').select('id, status, done_at, candidate_id').in('candidate_id', ids).order('invited_at', { ascending: false }).limit(5)
    f.welcome_call_done_at = (wc || []).find((w: Any) => w.status === 'done')?.done_at ?? null
    const { data: prof } = await db.from('caregiver_profiles').select('id, published, published_at, updated_at, candidate_id, status').in('candidate_id', ids).neq('status', 'withdrawn').limit(2)
    const p = (prof || []).find((x: Any) => x.published) || prof?.[0]; f.profile_published_at = p?.published ? (p.published_at || p.updated_at) : null
  }
  if (f.roster?.hire_date) { const hire = String(f.roster.hire_date).slice(0, 10); f.after_first_year = (Date.now() - Date.parse(hire + 'T12:00:00Z')) > 365 * 86400000 }
  return f
}

export type Verdict = { key: string; state: 'complete' | 'blocked'; at: string; evidence: Record<string, unknown>; reason?: string }
const iso = (v: unknown) => { const t = typeof v === 'string' && v ? Date.parse(v.length === 10 ? v + 'T12:00:00Z' : v) : NaN; return Number.isFinite(t) ? new Date(t).toISOString() : null }
/** Which rows the facts satisfy right now. Pure. */
export function verifyRows(f: Facts, now = new Date().toISOString()): Verdict[] {
  const out: Verdict[] = []
  const o = f.offer, s1 = f.step1, c = f.candidate || f.roster || {}
  if (o?.offer_signed_at && o?.pd_signed_at) out.push({ key: 'cg.offer.signed', state: 'complete', at: iso(o.pd_signed_at) || now, evidence: { offer_signed_at: o.offer_signed_at, pd_signed_at: o.pd_signed_at, offer_version: o.offer_version ?? null } })
  const sigs = (s1?.signatures || {}) as Record<string, Any>
  for (const [k, form] of [['application', 'employee_application'], ['references', 'reference_consent'], ['fcra', 'fcra_disclosure'], ['edl_fcsr', 'edl_fcsr_consent'], ['availability', 'availability'], ['experience', 'experience'], ['vehicle', 'vehicle']]) {
    const s = sigs[form]; if (s?.at) out.push({ key: 'cg.step1.' + k, state: 'complete', at: iso(s.at) || now, evidence: { form, version: s.version, fingerprint: s.fingerprint, typed_name: s.typed_name } })
  }
  if (sigs.reference_consent?.at && sigs.fcra_disclosure?.at && sigs.edl_fcsr_consent?.at) { const at = [sigs.reference_consent.at, sigs.fcra_disclosure.at, sigs.edl_fcsr_consent.at].sort().pop(); out.push({ key: 'cg.consent.checks', state: 'complete', at: iso(at) || now, evidence: { forms: ['reference_consent', 'fcra_disclosure', 'edl_fcsr_consent'] } }) }
  /* the checks: a result with its date and document, recorded on the row (proof required since 2c) */
  const checks: [string, string, string][] = [['cg.check.oig', 'oig', 'oig'], ['cg.check.edl', 'edl', 'edl'], ['cg.check.fcsr', 'fcsr', 'fcsr'], ['cg.check.fingerprints', 'fp', 'fp']]
  for (const [key, field, _] of checks) {
    const res = c[field] ?? c[field + '_status'], date = c[field + '_date'], proof = c[field + '_proof']
    if (clear(res) && date) out.push({ key, state: 'complete', at: iso(date) || now, evidence: { result: res, date, document: proof || null, ...(field === 'oig' && c.oig_evidence ? { leie: c.oig_evidence } : {}), from: f.candidate ? 'background & references row' : 'roster record' } })
    else if (flagged(res)) out.push({ key, state: 'blocked', at: now, evidence: { result: res, date: date || null }, reason: 'Flagged: see the background review before anything else moves.' })
  }
  if (c.fcsr_reg_date) out.push({ key: 'cg.check.fcsr_registration', state: 'complete', at: iso(c.fcsr_reg_date) || now, evidence: { registered: c.fcsr_reg_date, document: c.fcsr_reg_proof || null } })
  /* references: two positive, at least one professional (decision 1) */
  const slots = [1, 2, 3, 4].map((n) => ({ name: c['r' + n + 'n'], status: c['r' + n + 's'], type: c['r' + n + '_type'] })).filter((r) => r.name)
  const pos = slots.filter((r) => positive(r.status)); const pro = pos.filter((r) => String(r.type || '').toLowerCase() === 'professional')
  if (pos.length >= 2 && pro.length >= 1) out.push({ key: 'cg.refs.cleared', state: 'complete', at: now, evidence: { positive: pos.map((r) => r.name), professional: pro.map((r) => r.name) } })
  if (f.welcome_call_done_at) out.push({ key: 'cg.welcome.call', state: 'complete', at: iso(f.welcome_call_done_at) || now, evidence: { done_at: f.welcome_call_done_at } })
  const r = f.roster || {}
  if (r.orient_date) out.push({ key: 'cg.training.orientation', state: 'complete', at: iso(r.orient_date) || now, evidence: { date: r.orient_date, document: r.orient_proof || null, note: 'employment start date (decision 7)' } })
  if (r.alz_date) out.push({ key: 'cg.training.dementia', state: 'complete', at: iso(r.alz_date) || now, evidence: { date: r.alz_date, document: r.alz_proof || null } })
  if (r.ojt_date && r.ojt_signed === 'yes' && r.ojt_online) out.push({ key: 'cg.training.ojt', state: 'complete', at: iso(r.ojt_date) || now, evidence: { date: r.ojt_date, online: r.ojt_online, signed: true, document: r.ojt_proof || null } })
  if (r.annual_date) out.push({ key: 'cg.training.annual', state: 'complete', at: iso(r.annual_date) || now, evidence: { date: r.annual_date, hours: r.annual_hrs ?? null } })
  if (f.profile_published_at) out.push({ key: 'cg.profile.published', state: 'complete', at: iso(f.profile_published_at) || now, evidence: { published_at: f.profile_published_at } })
  if (r.axiscare_id && r.axiscare_status_active === true) out.push({ key: 'cg.axiscare.active', state: 'complete', at: now, evidence: { axiscare_id: r.axiscare_id } })
  return out
}

/** Server refusal: may this action happen for this person? Allowed when no caregiver journey exists (the old path). */
export async function caregiverGate(db: Any, who: { candidate_id?: unknown; offer_id?: unknown }, needKey: string, dfsIn?: Any[]): Promise<{ allowed: boolean; why?: string; journey_id?: string }> {
  try {
    let offerId = S(who.offer_id, 64)
    if (!offerId && who.candidate_id != null) {
      const { data } = await db.from('app_data').select('data').eq('key', 'candidates').maybeSingle()
      const c = (Array.isArray(data?.data) ? data.data : []).find((x: Any) => String(x?.id) === String(who.candidate_id)); offerId = S(c?.offer_id, 64)
    }
    if (!offerId) return { allowed: true }
    const { data: j } = await db.from('client_journey').select('journey_id, subject, status').eq('offer_id', offerId).maybeSingle()
    if (!j || j.subject !== 'caregiver') return { allowed: true }
    const { data: st } = await db.from('client_journey_step').select('step_key, state').eq('journey_id', j.journey_id).eq('step_key', needKey).maybeSingle()
    if (st && ['complete', 'not_needed', 'exception'].includes(st.state)) return { allowed: true, journey_id: j.journey_id }
    const { data: d } = dfsIn ? { data: null } : await db.from('client_journey_step_def').select('def').eq('key', needKey).maybeSingle()
    const title = (dfsIn?.find((x: Any) => x.key === needKey)?.def?.title) || d?.def?.title || needKey
    return { allowed: false, journey_id: j.journey_id, why: `Not yet: "${title}" is not complete on their readiness card. The server refuses this until it is.` }
  } catch { return { allowed: true } }   // a broken gate must not lock the office out; the sweep's cards show a broken journey
}
