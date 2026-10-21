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
//                          exists: the old path is untouched; fails CLOSED when the records cannot be read, 2026-10-13)
import { needsCountersign } from './step1-documents.ts'
import { offerSigned, offerSignedAt, letterOnly, isLicensedNurse } from './positions.ts'   /* LPN HIRING 2026-10-14 */
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
  const { data: s1 } = await db.from('step1_forms').select('answers, signatures, completed_at, countersignatures').eq('offer_id', j.offer_id).maybeSingle()
  f.step1 = s1 || null
  const a = (s1?.answers || {}) as Record<string, unknown>
  f.lived_outside_mo = a.lived_outside_mo === 'yes' ? true : a.lived_outside_mo === 'no' ? false : undefined
  f.claims_cna_or_hha = a.cna === 'yes' || a.hha === 'yes' ? true : (a.cna === 'no' && a.hha === 'no') ? false : undefined
  /* 2026-10-13: Step 1's deciding question; older records answered the vehicle form's acknowledgment instead */
  /* LPN HIRING (2026-10-14): an LPN or RN hire (the offer's position key, set once at Save Offer). Known from the offer; when
     the offer cannot be read, from the Step 1 record (its nursing license form was decided from the same key when it started).
     Unknown (neither readable) leaves the nurse rows hidden, never assumed. Every offer without an LPN or RN key is false. */
  f.licensed_nurse = f.offer ? isLicensedNurse(f.offer.position_key) : undefined
  if (f.licensed_nurse === undefined && s1) { try { const { data: nf, error: ne } = await db.from('step1_forms').select('nurse_form').eq('offer_id', j.offer_id).maybeSingle(); if (!ne && nf) f.licensed_nurse = nf.nurse_form === true } catch { /* stays unknown */ } }
  f.drives_clients = a.transport_willing === 'yes' ? true : a.transport_willing === 'no' ? false : typeof a.driver_ack === 'string' ? /request approval to transport/i.test(a.driver_ack) : undefined
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
    /* 2026-10-13 (her ruling, 19 CSR 15-7.021(24)(B)5): the office explains Client Rights, the Code of Ethics and the HIPAA
       policy at the Orientation Video Call and records it (who, when, their confirmation). Its own read, so a database
       without the columns yet leaves only this row open (never the Orientation Video Call row). */
    try {
      const { data: rx } = await db.from('welcome_calls').select('id, rights_explained_at, rights_explained_by, rights_explained_by_email, rights_ack_confirmed, candidate_id').in('candidate_id', ids).order('invited_at', { ascending: false }).limit(5)
      const x = (rx || []).find((w: Any) => w.rights_explained_at && w.rights_ack_confirmed === true)
      f.rights_explained = x ? { at: x.rights_explained_at, by: x.rights_explained_by || null, by_email: x.rights_explained_by_email || null, welcome_call_id: x.id } : null
    } catch { f.rights_explained = null }
    const { data: prof } = await db.from('caregiver_profiles').select('id, published, published_at, updated_at, candidate_id, status, photo_path').in('candidate_id', ids).neq('status', 'withdrawn').limit(2)
    const p = (prof || []).find((x: Any) => x.published) || prof?.[0]; f.profile_published_at = p?.published ? (p.published_at || p.updated_at) : null
    /* 2026-10-21 the badge task (stop 6): their profile photo is in */
    f.profile_photo = !!(p && p.photo_path)
  }
  if (f.roster?.hire_date) { const hire = String(f.roster.hire_date).slice(0, 10); f.after_first_year = (Date.now() - Date.parse(hire + 'T12:00:00Z')) > 365 * 86400000 }
  return f
}

/** 2026-10-13: where participant rights stands, for the row and the cards: signed in Step 1 (receipt and review), explained at
 *  the Orientation Video Call (date, who, their confirmation). Pure. */
export function rightsState(f: Facts): { state: 'complete' | 'waiting_explanation' | 'waiting_signature'; signed_at: string | null; version: unknown; explained_at: string | null; explained_by: string | null } {
  const cr = ((f?.step1?.signatures || {}) as Record<string, Any>).client_rights, rx = f?.rights_explained
  const signed = !!cr?.at, explained = !!rx?.at
  return { state: signed && explained ? 'complete' : signed ? 'waiting_explanation' : 'waiting_signature', signed_at: cr?.at ?? null, version: cr?.version ?? null, explained_at: rx?.at ?? null, explained_by: rx?.by ?? null }
}
export type Verdict = { key: string; state: 'complete' | 'blocked'; at: string; evidence: Record<string, unknown>; reason?: string }
const iso = (v: unknown) => { const t = typeof v === 'string' && v ? Date.parse(v.length === 10 ? v + 'T12:00:00Z' : v) : NaN; return Number.isFinite(t) ? new Date(t).toISOString() : null }
/** The Hub's reference rule (eligibility-rules.js refDecisionCovers + refPolicy), word for word. Pure. The fixture test
 *  ref_policy_parity_test.mjs runs both on the same records. */
export function refTypeOfSlot(c: Any, n: number): string {
  const t = String((c?.['r' + n + '_manual'] && c['r' + n + '_manual'].type) || c?.['r' + n + '_type'] || '').trim().toLowerCase()
  return t === 'professional' ? 'professional' : t === 'personal' ? 'personal' : ''
}
export function refDecisionCoversOf(c: Any): boolean {
  const d = c?.ref_decision
  if (!d || d.outcome !== 'proceed') return false
  return String(d.refs || '') === [c.r1s, c.r2s, c.r3s, c.r4s].map((x) => x || '').join('|')
}
export function refPolicyOf(c: Any): { ok: boolean; blocked: boolean; why: string } {
  const refs = [c?.r1s, c?.r2s, c?.r3s, c?.r4s]
  const pos = refs.filter((r) => r === 'Positive').length
  if (refs.some((r) => r === 'Negative')) return { ok: false, blocked: true, why: 'A reference came back Negative. A supervisor has to resolve it.' }
  if (refs.some((r) => r === 'Conditional') && !refDecisionCoversOf(c)) return { ok: false, blocked: true, why: 'A reference is Conditional. A supervisor has to decide before this one moves on.' }
  if (pos < 2) return { ok: false, blocked: false, why: (2 - pos) + ' more positive reference' + (2 - pos === 1 ? '' : 's') + ' needed (at least one from a past job).' }
  const work = [1, 2, 3, 4].some((n) => c['r' + n + 's'] === 'Positive' && refTypeOfSlot(c, n) === 'professional')
  if (!work) return { ok: false, blocked: false, why: 'One of the positive references has to be from a past job. If one already is, mark it as a work reference.' }
  return { ok: true, blocked: false, why: '' }
}
/** Which rows the facts satisfy right now. Pure. */
export function verifyRows(f: Facts, now = new Date().toISOString()): Verdict[] {
  const out: Verdict[] = []
  const o = f.offer, s1 = f.step1, c = f.candidate || f.roster || {}
  /* LPN HIRING (2026-10-14): the one shared rule; a caregiver offer reads exactly as before, an LPN or RN offer is the letter alone */
  if (offerSigned(o)) out.push({ key: 'cg.offer.signed', state: 'complete', at: iso(offerSignedAt(o)) || now, evidence: letterOnly(o) && !o.pd_signed_at ? { offer_signed_at: o.offer_signed_at, letter_only: true, position_key: o.position_key, offer_version: o.offer_version ?? null } : { offer_signed_at: o.offer_signed_at, pd_signed_at: o.pd_signed_at, offer_version: o.offer_version ?? null } })
  const sigs = (s1?.signatures || {}) as Record<string, Any>
  for (const [k, form] of [['application', 'employee_application'], ['references', 'reference_consent'], ['fcra', 'fcra_disclosure'], ['edl_fcsr', 'edl_fcsr_consent'], ['availability', 'availability'], ['experience', 'experience'], ['vehicle', 'vehicle']]) {
    /* 2026-10-13: the driving screen is signed with the Driver Agreement OR the Non-Driver Agreement */
    const s = sigs[form] || (form === 'vehicle' ? sigs.non_driver : null); if (s?.at) out.push({ key: 'cg.step1.' + k, state: 'complete', at: iso(s.at) || now, evidence: { form: sigs[form] ? form : 'non_driver', version: s.version, fingerprint: s.fingerprint, typed_name: s.typed_name } })
  }
  /* 2026-10-13: Samantha moved these acknowledgments from Viventium into Step 1: their signature there completes the row
     (the Employee Handbook stays in Viventium: her call, 2026-10-13) */
  for (const [row, form] of [['cg.step2.code_of_ethics', 'code_of_ethics'], ['cg.step2.confidentiality', 'hipaa_privacy']]) {
    const s = sigs[form]; if (s?.at) out.push({ key: row, state: 'complete', at: iso(s.at) || now, evidence: { via: 'step1', form, version: s.version, fingerprint: s.fingerprint, typed_name: s.typed_name } })
  }
  /* 2026-10-13 (her ruling): participant rights needs BOTH the Step 1 Client Rights signature (receipt and review) AND the
     office's record that all three were explained at the Orientation Video Call and they confirmed they understood */
  const rs = rightsState(f)
  if (rs.state === 'complete') { const cr = sigs.client_rights, rx = f.rights_explained
    out.push({ key: 'cg.step2.participant_rights', state: 'complete', at: iso(Date.parse(cr.at) > Date.parse(rx.at) ? cr.at : rx.at) || now, evidence: { via: 'step1 + orientation video call', form: 'client_rights', version: cr.version, fingerprint: cr.fingerprint, typed_name: cr.typed_name, signed_at: cr.at, explained_at: rx.at, explained_by: rx.by, explained_by_email: rx.by_email, acknowledged: true, welcome_call_id: rx.welcome_call_id } }) }
  /* 2026-10-13: the company signature on the agreements that need it (none needs it = complete by itself once Step 1 is) */
  if (s1?.completed_at) { const left = needsCountersign(sigs, (s1?.countersignatures || {}) as Record<string, unknown>); if (!left.length) { const cs = Object.values((s1?.countersignatures || {}) as Record<string, Any>); out.push({ key: 'cg.company.countersign', state: 'complete', at: iso(cs.map((x) => x.at).sort().pop() || s1.completed_at) || now, evidence: cs.length ? { forms: Object.keys(s1.countersignatures), by: cs.map((x) => x.by_name) } : { none_required: true } }) } }
  if (sigs.reference_consent?.at && sigs.fcra_disclosure?.at && sigs.edl_fcsr_consent?.at) { const at = [sigs.reference_consent.at, sigs.fcra_disclosure.at, sigs.edl_fcsr_consent.at].sort().pop(); out.push({ key: 'cg.consent.checks', state: 'complete', at: iso(at) || now, evidence: { forms: ['reference_consent', 'fcra_disclosure', 'edl_fcsr_consent'] } }) }
  /* the checks: a result with its date and document, recorded on the row (proof required since 2c) */
  /* CASE.NET (Samantha 2026-10-11): the Missouri courts name search is one of the background checks, recorded the same way */
  /* NO FINGERPRINTS (Samantha 2026-10-21: "I don't need finger print anymore since we are stopping Medicaid IHS"): the row is
     switched off in the catalog (1031 SQL) and never verified or blocked from here. */
  const checks: [string, string, string][] = [['cg.check.oig', 'oig', 'oig'], ['cg.check.edl', 'edl', 'edl'], ['cg.check.fcsr', 'fcsr', 'fcsr'], ['cg.check.casenet', 'casenet', 'casenet']]
  /* GO-LIVE GATE (2026-10-13, Samantha's slice 2c rule "a result is never recorded without its evidence"): on the new path a
     check counts as done only with its result, its date AND its proof on the record (the OIG LEIE result kept on the record
     counts as its proof). A clear result with a date but no proof leaves the row open, so the card shows it still owed. */
  for (const [key, field, _] of checks) {
    const res = c[field] ?? c[field + '_status'], date = c[field + '_date'], proof = c[field + '_proof']
    const hasProof = !!S(proof, 400) || (field === 'oig' && !!c.oig_evidence && typeof c.oig_evidence === 'object')
    if (clear(res) && date && hasProof) out.push({ key, state: 'complete', at: iso(date) || now, evidence: { result: res, date, document: proof || null, ...(field === 'oig' && c.oig_evidence ? { leie: c.oig_evidence } : {}), from: f.candidate ? 'background & references row' : 'roster record' } })
    else if (flagged(res)) out.push({ key, state: 'blocked', at: now, evidence: { result: res, date: date || null }, reason: 'Flagged: see the background review before anything else moves.' })
  }
  if (c.fcsr_reg_date) out.push({ key: 'cg.check.fcsr_registration', state: 'complete', at: iso(c.fcsr_reg_date) || now, evidence: { registered: c.fcsr_reg_date, document: c.fcsr_reg_proof || null } })
  /* references: the Hub's one reference rule (eligibility-rules.js refPolicy, 2026-10-21 made identical): two Positive with at
     least one from work (the type on the slot or with the answers), any Negative blocks, a Conditional blocks unless an owner's
     decision covers exactly these answers */
  const rp = refPolicyOf(c)
  if (rp.ok) { const slots = [1, 2, 3, 4].map((n) => ({ name: c['r' + n + 'n'], status: c['r' + n + 's'], type: refTypeOfSlot(c, n) })).filter((r) => r.name)
    const pos = slots.filter((r) => positive(r.status)); out.push({ key: 'cg.refs.cleared', state: 'complete', at: now, evidence: { positive: pos.map((r) => r.name), professional: pos.filter((r) => r.type === 'professional').map((r) => r.name), ...(c.ref_decision ? { decision: c.ref_decision } : {}) } }) }
  else if (rp.blocked) out.push({ key: 'cg.refs.cleared', state: 'blocked', at: now, evidence: { refs: [c.r1s, c.r2s, c.r3s, c.r4s].map((x) => x || '') }, reason: rp.why })
  if (f.welcome_call_done_at) out.push({ key: 'cg.welcome.call', state: 'complete', at: iso(f.welcome_call_done_at) || now, evidence: { done_at: f.welcome_call_done_at } })
  const r = f.roster || {}
  if (r.orient_date) out.push({ key: 'cg.training.orientation', state: 'complete', at: iso(r.orient_date) || now, evidence: { date: r.orient_date, document: r.orient_proof || null, note: 'employment start date (decision 7)' } })
  if (r.alz_date) out.push({ key: 'cg.training.dementia', state: 'complete', at: iso(r.alz_date) || now, evidence: { date: r.alz_date, document: r.alz_proof || null } })
  if (r.ojt_date && r.ojt_signed === 'yes' && r.ojt_online) out.push({ key: 'cg.training.ojt', state: 'complete', at: iso(r.ojt_date) || now, evidence: { date: r.ojt_date, online: r.ojt_online, signed: true, document: r.ojt_proof || null } })
  if (r.annual_date) out.push({ key: 'cg.training.annual', state: 'complete', at: iso(r.annual_date) || now, evidence: { date: r.annual_date, hours: r.annual_hrs ?? null } })
  if (f.profile_published_at) out.push({ key: 'cg.profile.published', state: 'complete', at: iso(f.profile_published_at) || now, evidence: { published_at: f.profile_published_at } })
  if (r.axiscare_id && r.axiscare_status_active === true) out.push({ key: 'cg.axiscare.active', state: 'complete', at: now, evidence: { axiscare_id: r.axiscare_id } })
  /* SLICE 7: the caregiver record exists in AxisCare once the connect job linked it to the roster record (the office hired them by hand) */
  if (r.axiscare_id && (r.connected || r.axiscare_status_label)) out.push({ key: 'cg.axiscare.in_training', state: 'complete', at: iso(r.connected?.at || r.connected_at || r.promoted_at) || now, evidence: { axiscare_id: r.axiscare_id, status: r.axiscare_status_label || 'connected', connected: r.connected || null } })
  return out
}

/** Server refusal: may this action happen for this person? Allowed when no caregiver journey exists (the old path).
 *  GO-LIVE GATE (2026-10-13, her rule "no silent failures"): the gate FAILS CLOSED. When the Hub cannot read the records
 *  to confirm (a database error), the action is refused with "could not confirm, try again" (unconfirmed: true), never
 *  waved through; when the same person and requirement fail twice within ten minutes a Needs Attention card is raised.
 *  Callers: step2-handoff 'sent' (cg.approve.advance), welcome-call 'invite' and the Step 2 server's 'invite_auto'
 *  (cg.approve.advance), reference-send (cg.step1.references). A person moved to the roster is found by candidate_id there. */
export const GATE_UNCONFIRMED = 'The Hub could not confirm their readiness card just now, so nothing was sent or changed. Please try again in a minute.'
const gateErrors = new Map<string, number[]>()
async function gateErrorCard(db: Any, who: { candidate_id?: unknown; offer_id?: unknown }, needKey: string, detail: string) {
  const k = `${S(who.offer_id, 64) || 'c' + S(who.candidate_id, 40)}|${needKey}`, now = Date.now()
  const seen = (gateErrors.get(k) || []).filter((t) => now - t < 10 * 60_000); seen.push(now); gateErrors.set(k, seen)
  if (seen.length < 2) return
  try {
    const at = new Date(now).toISOString(), id = 'cj_gate_' + k.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 120)
    await db.rpc('upsert_app_data_item', { target_key: 'ops_items', item: { id, kind: 'readiness_unconfirmed', domain: 'caregivers', status: 'open', urgency: 'today',
      title: 'The Hub could not check a readiness card', detail: `An onboarding action for ${who.offer_id ? 'offer ' + S(who.offer_id, 64) : 'Background & References #' + S(who.candidate_id, 40)} was refused twice because the Hub could not read their readiness card (${S(detail, 160)}). Nothing was sent. Try again; if it keeps happening, tell Samantha.`,
      who: '', offer_id: S(who.offer_id, 64) || null, candidate_id: who.candidate_id ?? null, owner: '', created_at: at, first_at: at, last_at: at, due: new Date(now + 24 * 3_600_000).toISOString(), created_by: 'caregiver-journey gate', opened_by: 'caregiver-journey gate' } })
  } catch (e) { console.warn('[caregiver-journey gate] could not raise a card: ' + String(e).slice(0, 160)) }
}
export async function caregiverGate(db: Any, who: { candidate_id?: unknown; offer_id?: unknown }, needKey: string, dfsIn?: Any[]): Promise<{ allowed: boolean; why?: string; journey_id?: string; unconfirmed?: boolean }> {
  const refuse = async (detail: string) => { await gateErrorCard(db, who, needKey, detail); return { allowed: false, unconfirmed: true, why: GATE_UNCONFIRMED } }
  try {
    let offerId = S(who.offer_id, 64)
    if (!offerId && who.candidate_id != null) {
      const cid = String(who.candidate_id)
      const { data, error } = await db.from('app_data').select('data').eq('key', 'candidates').maybeSingle()
      if (error) return await refuse('the Background & References list could not be read')
      const c = (Array.isArray(data?.data) ? data.data : []).find((x: Any) => String(x?.id) === cid); offerId = S(c?.offer_id, 64)
      if (!c) {   /* moved to the roster: the roster record keeps candidate_id */
        const { data: r, error: e2 } = await db.from('app_data').select('data').eq('key', 'caregivers').maybeSingle()
        if (e2) return await refuse('the caregiver list could not be read')
        const g = (Array.isArray(r?.data) ? r.data : []).find((x: Any) => x?.candidate_id != null && String(x.candidate_id) === cid); offerId = S(g?.offer_id, 64)
      }
    }
    if (!offerId) return { allowed: true }
    const { data: j, error: ej } = await db.from('client_journey').select('journey_id, subject, status').eq('offer_id', offerId).maybeSingle()
    if (ej) return await refuse('the readiness card could not be read')
    if (!j || j.subject !== 'caregiver') return { allowed: true }
    const { data: st, error: es } = await db.from('client_journey_step').select('step_key, state').eq('journey_id', j.journey_id).eq('step_key', needKey).maybeSingle()
    if (es) return await refuse('the readiness row could not be read')
    if (st && ['complete', 'not_needed', 'exception'].includes(st.state)) return { allowed: true, journey_id: j.journey_id }
    const { data: d } = dfsIn ? { data: null } : await db.from('client_journey_step_def').select('def').eq('key', needKey).maybeSingle()
    const title = (dfsIn?.find((x: Any) => x.key === needKey)?.def?.title) || d?.def?.title || needKey
    return { allowed: false, journey_id: j.journey_id, why: `Not yet: "${title}" is not complete on their readiness card. The server refuses this until it is.` }
  } catch (e) { return await refuse(String((e as Error)?.message ?? e)) }   // fail CLOSED: a broken gate refuses, and says so
}
