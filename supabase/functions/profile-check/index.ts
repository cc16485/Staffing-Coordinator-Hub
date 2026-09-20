// =============================================================================
// profile-check — the profile-completeness evaluator (SHADOW MODE)
// =============================================================================
// Purpose-built and SEND-INCAPABLE by construction (her architectural rule,
// 2026-09-20): this function contains no messaging code, no GHL client, no
// AxisCare writes — its only outbound calls are AxisCare GETs and reads of
// our own database. It cannot text, email, schedule, or write to AxisCare,
// because the code to do so does not exist here.
//
// It evaluates the approved Client Profile Complete and Caregiver Ready to
// Schedule standards (PROFILE-STANDARD-V2 + her rulings) and reports:
//   - every item with severity (HARD / FIRST_SHIFT / WARN / COND),
//     status (pass / fail / unanswered / na) and evidence tier
//     (api = verified from AxisCare, hub = hub record, attested = staff
//     confirmed), plus where a miss is fixed (axiscare / hub / attested)
//   - what WOULD block if enforcement were on
//   - grandfathering: records that predate the standard can never block
//
// ENFORCEMENT IS OFF. The three switches (client_profile_enforcement,
// caregiver_assignment_enforcement, first_shift_profile_enforcement) are
// read from ops_settings and REPORTED, but this function only ever
// evaluates — blocking is the caller's decision, and the hub's callers
// are display-only until she flips a switch. Defaults are all false.
//
// UNANSWERED IS A TRUTH STATE. Blank never means "no". A required item
// that is unanswered reports status 'unanswered' — the display says
// "needs an answer", never "no".
//
// NO DOUBLE-STAFFING CONCEPTS EXIST HERE (her correction, 2026-09-20):
// there is no two_person_assist field, no staffing-count logic, and a
// single qualified caregiver is never treated as inadequate coverage.
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const sb = createClient(SUPABASE_URL, SERVICE_KEY)

/* Records whose SOC began before this moment are GRANDFATHERED: they may
   display completeness and cleanup items but can never be blocked. Set at
   first deploy of the standard and not moved. */
const PROFILE_STANDARD_LIVE_AT = '2026-09-21T00:00:00Z'

type Status = 'pass' | 'fail' | 'unanswered' | 'na'
type Severity = 'HARD' | 'FIRST_SHIFT' | 'WARN' | 'COND'
type Tier = 'api' | 'hub' | 'attested'
interface Item {
  code: string; label: string; severity: Severity; tier: Tier; status: Status
  detail: string; fix: 'axiscare' | 'hub' | 'attested' | 'exception' | 'none'
}

const item = (code: string, label: string, severity: Severity, tier: Tier,
              status: Status, detail: string, fix: Item['fix'] = 'none'): Item =>
  ({ code, label, severity, tier, status, detail, fix })

const S = (v: unknown) => String(v ?? '').trim()
const has = (v: unknown) => S(v).length > 0

/* ── AxisCare read-only access ─────────────────────────────────────────── */
function axisCreds() {
  const order = ['AXISCARE_API_KEY', 'AXISCARE_TOKEN', 'AXISCARE_VISITS_TOKEN']
  let token = ''
  for (const n of order) { const v = Deno.env.get(n); if (v) { token = v; break } }
  const site = Deno.env.get('AXISCARE_SITE') || Deno.env.get('AXISCARE_SITE_NUMBER') || ''
  return { token, site }
}
async function axGet(path: string): Promise<unknown> {
  const { token, site } = axisCreds()
  if (!token || !site) throw new Error('AxisCare credentials not set')
  const r = await fetch(`https://${site}.axiscare.com/api/${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json',
      'X-AxisCare-Api-Version': Deno.env.get('AXISCARE_API_VERSION') || '2023-10-01' } })
  if (!r.ok) throw new Error(`AxisCare GET ${path}: HTTP ${r.status}`)
  const j = await r.json().catch(() => ({}))
  // single-record envelopes vary; take .results.<entity> ?? .results ?? body
  // deno-lint-ignore no-explicit-any
  const res = (j as any)?.results
  return res?.client ?? res?.caregiver ?? res ?? j
}

/* ── app_data reads ────────────────────────────────────────────────────── */
async function appData(key: string): Promise<unknown[]> {
  const { data } = await sb.from('app_data').select('data').eq('key', key).maybeSingle()
  const d = data?.data
  return Array.isArray(d) ? d : []
}
async function opsSettings(): Promise<Record<string, unknown>> {
  const { data } = await sb.from('app_data').select('data').eq('key', 'ops_settings').maybeSingle()
  const d = data?.data
  if (Array.isArray(d)) return (d[0] as Record<string, unknown>) ?? {}
  return (d as Record<string, unknown>) ?? {}
}

/* ── shared helpers ────────────────────────────────────────────────────── */
// deno-lint-ignore no-explicit-any
const rowsOf = (x: any): any[] => Array.isArray(x) ? x : (x && typeof x === 'object' ? Object.values(x) : [])
// deno-lint-ignore no-explicit-any
function careLevelOf(classes: any): number | null {
  let best: number | null = null
  for (const c of rowsOf(classes)) {
    const t = S(c?.label ?? c?.code).toLowerCase()
    const m = t.match(/level\s*([123])/)
    const lv = m ? Number(m[1]) : /complex/.test(t) ? 3 : /personal\s*care/.test(t) ? 2 : /wellness/.test(t) ? 1 : null
    if (lv != null && (best == null || lv > best)) best = lv
  }
  return best
}
const isMedicaidLead = (lead: Record<string, unknown>) =>
  /medicaid|ihs|pace/i.test(S(lead?.funding_source))
const isPrivatePayLead = (lead: Record<string, unknown>) =>
  /private/i.test(S(lead?.funding_source)) || S(lead?.funding_source) === 'ltc'
// deno-lint-ignore no-explicit-any
const socStep = (soc: any, id: string) =>
  (soc?.steps ?? []).find((s: Record<string, unknown>) => s.id === id)
// deno-lint-ignore no-explicit-any
const socStepDone = (soc: any, id: string) => !!(socStep(soc, id)?.done_at)
// deno-lint-ignore no-explicit-any
function socIsGrandfathered(soc: any): boolean {
  if (!soc) return true                                   // no SOC at all = existing client
  if (S(soc.started_at) < PROFILE_STANDARD_LIVE_AT) return true
  const launchIds = soc.pathway === 'PP' ? ['m3', 'm4', 'm5', 'm6'] : ['m6', 'm7', 'm8', 'm9', 'm10']
  // deno-lint-ignore no-explicit-any
  return (soc.steps ?? []).some((s: any) => launchIds.includes(String(s.id)))  // pre-split record
}

/* ═══ CLIENT EVALUATOR (pure — selftest runs it on synthetic inputs) ═════ */
export function evalClient(input: {
  // deno-lint-ignore no-explicit-any
  facts: any                      // AxisCare client record (or null if unreachable)
  // deno-lint-ignore no-explicit-any
  parties: any[]                  // responsibleParties rows
  lead: Record<string, unknown> | null
  prof: Record<string, unknown> | null   // client_profiles item
  queueRow: Record<string, unknown> | null
}): { items: Item[]; grandfathered: boolean } {
  const { facts, parties, lead, prof, queueRow } = input
  // deno-lint-ignore no-explicit-any
  const soc: any = (lead as any)?.soc ?? null
  const grandfathered = socIsGrandfathered(soc)
  const attrs = ((lead?.client_attributes ?? {}) as Record<string, string>)
  const medicaid = lead ? isMedicaidLead(lead) : false
  const pp = lead ? (isPrivatePayLead(lead) || soc?.pathway === 'PP') : false
  const items: Item[] = []
  const F = facts ?? {}

  // ---- HARD (would gate Ready for Staffing) ----
  items.push(item('name', 'Client name in AxisCare', 'HARD', 'api',
    facts == null ? 'unanswered' : (has(F.firstName) && has(F.lastName)) ? 'pass' : 'fail',
    facts == null ? 'AxisCare record not readable' : `${S(F.firstName)} ${S(F.lastName)}`.trim() || 'first or last name missing', 'axiscare'))
  items.push(item('phone', 'At least one phone', 'HARD', 'api',
    facts == null ? 'unanswered' : (has(F.homePhone) || has(F.mobilePhone)) ? 'pass' : 'fail',
    facts == null ? 'AxisCare record not readable' : (has(F.mobilePhone) ? 'mobile on file' : has(F.homePhone) ? 'home phone on file' : 'no phone on the AxisCare record'), 'axiscare'))
  items.push(item('payer', 'Payer recorded (Hub is the source of truth)', 'HARD', 'hub',
    lead == null ? 'na' : has(lead.funding_source) ? 'pass' : 'unanswered',
    lead == null ? 'no lead record linked' : S(lead.funding_source) || 'funding source not chosen on the lead', 'hub'))
  if (pp) {
    const agr = soc && soc.pathway === 'PP' && !grandfathered
      ? (socStepDone(soc, 'p1') && socStepDone(soc, 'p2') && socStepDone(soc, 'p3') ? 'pass' : 'fail')
      : 'na'
    items.push(item('pp_agreement', 'Care Agreement provided, received, and filed', 'HARD', 'attested',
      agr as Status, agr === 'na' ? 'read from SOC steps (new private-pay starts only)' : agr === 'pass' ? 'all three agreement steps attested' : 'agreement chain incomplete on the SOC checklist', 'attested'))
    const bil = soc && soc.pathway === 'PP' && !grandfathered
      ? (socStepDone(soc, 'p4') ? 'pass' : 'fail') : 'na'
    items.push(item('pp_billing', 'Billing setup completed in AxisCare', 'HARD', 'attested',
      bil as Status, bil === 'na' ? 'read from the SOC step' : bil === 'pass' ? 'attested on the SOC checklist' : 'billing-setup step unchecked', 'attested'))
  }
  if (medicaid) {
    const auth = soc && soc.pathway !== 'PP' && !grandfathered
      ? (socStepDone(soc, 'm0') && socStepDone(soc, 'm1') ? 'pass' : 'fail') : 'na'
    items.push(item('medicaid_auth', 'Authorization reviewed and entered in AxisCare', 'HARD', 'attested',
      auth as Status, auth === 'na' ? 'read from SOC steps (new Medicaid starts only)' : auth === 'pass' ? 'attested on the SOC checklist' : 'authorization steps unchecked', 'attested'))
  }

  // ---- FIRST_SHIFT ----
  items.push(item('dob', 'Date of birth (all clients)', 'FIRST_SHIFT', 'api',
    facts == null ? 'unanswered' : has(F.dateOfBirth) ? 'pass' : 'unanswered',
    has(F.dateOfBirth) ? S(F.dateOfBirth) : 'not on the AxisCare record — enter it there', 'axiscare'))
  const addr = F?.residentialAddress ?? {}
  items.push(item('address', 'Service address with ZIP', 'FIRST_SHIFT', 'api',
    facts == null ? 'unanswered' : (has(addr.streetAddress1) && has(addr.city) && has(addr.postalCode)) ? 'pass' : 'fail',
    (has(addr.streetAddress1) && has(addr.city) && has(addr.postalCode)) ? `${S(addr.city)} ${S(addr.postalCode)}` : 'street, city or ZIP missing on the AxisCare record', 'axiscare'))
  const partiesWithPhone = (parties ?? []).filter(p => has(p?.name) &&
    rowsOf(p?.phones).some(ph => has(ph?.number)))
  const rpException = (prof?.no_responsible_party ?? null) as Record<string, unknown> | null
  items.push(item('responsible_party', 'Responsible party / emergency contact with a phone', 'FIRST_SHIFT', 'api',
    partiesWithPhone.length > 0 ? 'pass' : rpException ? 'pass' : 'fail',
    partiesWithPhone.length > 0 ? `${partiesWithPhone.length} on file in AxisCare`
      : rpException ? `documented exception: ${S(rpException.reason)} (${S(rpException.by)})`
      : 'none in AxisCare — add one, or document the no-responsible-party exception', partiesWithPhone.length > 0 ? 'none' : rpException ? 'none' : 'exception'))
  const entOk = has(prof?.entrance) || prof?.entrance_none === true
  items.push(item('entrance', 'Entrance / access instructions', 'FIRST_SHIFT', 'hub',
    entOk ? 'pass' : 'unanswered',
    has(prof?.entrance) ? 'instructions on the profile' : prof?.entrance_none === true ? 'explicitly “no special instructions”' : 'unanswered — instructions or an explicit “none” required; blank is not an answer', 'hub'))
  const petsOk = has(prof?.pets) || prof?.pets_none === true
  items.push(item('pets', 'Pets in the home', 'FIRST_SHIFT', 'hub',
    petsOk ? 'pass' : 'unanswered',
    has(prof?.pets) ? S(prof?.pets) : prof?.pets_none === true ? 'explicitly “no pets”' : 'unanswered — pet details or an explicit “no pets” required', 'hub'))
  items.push(item('allergies', 'Allergies / sensitivities', 'FIRST_SHIFT', 'api',
    facts == null ? 'unanswered' : has(F.allergies) ? 'pass' : 'unanswered',
    has(F.allergies) ? S(F.allergies)
      : 'unanswered — enter the allergies (or exactly “None known”) on their AxisCare profile. This must be corrected in AxisCare; the Hub cannot write it.', 'axiscare'))
  const lvl = careLevelOf(F?.classes)
  items.push(item('care_level', 'Care level set in AxisCare', 'FIRST_SHIFT', 'api',
    facts == null ? 'unanswered' : lvl != null ? 'pass' : 'unanswered',
    lvl != null ? `Level ${lvl}` : 'no care-level class on the AxisCare record', 'axiscare'))
  items.push(item('attributes', 'Care-needs attributes entered', 'FIRST_SHIFT', 'hub',
    lead == null ? 'na' : has(lead.attributes_entered_at) ? 'pass' : 'unanswered',
    has(lead?.attributes_entered_at) ? 'checklist completed and marked entered in AxisCare' : 'the attributes checklist has not been marked entered', 'hub'))
  const cp = soc && !grandfathered
    ? (socStepDone(soc, soc.pathway === 'PP' ? 'm0' : 'm2') ? 'pass' : 'fail') : 'na'
  items.push(item('care_plan', 'Care plan & caregiver instructions in AxisCare', 'FIRST_SHIFT', 'attested',
    cp as Status, cp === 'na' ? 'read from the SOC step (new starts only)' : cp === 'pass' ? 'attested on the SOC checklist' : 'care-plan step unchecked', 'attested'))
  items.push(item('start_date', 'AxisCare Start Date set (verified before first shift, never an SOC gate)', 'FIRST_SHIFT', 'api',
    facts == null ? 'unanswered' : has(F.startDate) ? 'pass' : 'unanswered',
    has(F.startDate) ? S(F.startDate) : 'not set — set Start Date on their AxisCare profile (reminded at schedule entry)', 'axiscare'))
  if (medicaid) items.push(item('dcn', 'Medicaid number (DCN) in AxisCare', 'FIRST_SHIFT', 'api',
    facts == null ? 'unanswered' : has(F.medicaidNumber) ? 'pass' : 'unanswered',
    has(F.medicaidNumber) ? 'on file' : 'not on the AxisCare record', 'axiscare'))

  // ---- COND / WARN ----
  items.push(item('telephony', 'Telephony EVV number', 'COND', 'api',
    has(F?.telephonyPhone) ? 'pass' : 'na',
    has(F?.telephonyPhone) ? 'telephony configured' : 'no telephony configuration (applies only to telephony-EVV homes)', 'axiscare'))
  const unansweredFlags = (parties ?? []).filter(p => has(p?.name) &&
    (p?.hipaaDisclosureAuthorization === '' || p?.hipaaDisclosureAuthorization == null)).length
  items.push(item('contact_permissions', 'Family-contact permission answers', 'WARN', 'api',
    (parties ?? []).length === 0 ? 'na' : unansweredFlags === 0 ? 'pass' : 'unanswered',
    unansweredFlags ? `${unansweredFlags} contact(s) have unanswered HIPAA/medical-decision questions in AxisCare — cleanup, never a block` : 'all contacts answered', 'axiscare'))
  items.push(item('email', 'Client email', 'WARN', 'api',
    facts == null ? 'na' : has(F.personalEmail) ? 'pass' : 'unanswered', has(F.personalEmail) ? 'on file' : 'none recorded', 'axiscare'))
  items.push(item('billing_contact', 'Billing address / email', 'WARN', 'api',
    facts == null ? 'na' : (has(F?.billingEmail) || has(F?.billingAddress?.streetAddress1)) ? 'pass' : 'unanswered',
    'record quality only', 'axiscare'))

  return { items, grandfathered }
}

/* ═══ CAREGIVER EVALUATOR (pure) ═════════════════════════════════════════ */
export function evalCaregiver(input: {
  // deno-lint-ignore no-explicit-any
  facts: any                      // AxisCare caregiver record (null if not found)
  cg: Record<string, unknown> | null      // hub caregivers item (compliance record)
  avail: Record<string, unknown> | null   // caregiver_availability item
  clientCtx: {
    lead: Record<string, unknown> | null
    // deno-lint-ignore no-explicit-any
    clientFacts: any
    dnrHit: boolean
    queueRow: Record<string, unknown> | null
  } | null
}): { items: Item[] } {
  const { facts, cg, avail, clientCtx } = input
  const F = facts ?? {}
  const items: Item[] = []
  // deno-lint-ignore no-explicit-any
  const skills = ((cg as any)?.skills ?? {}) as Record<string, Record<string, unknown>>
  const skillState = (k: string): 'yes' | 'no' | 'unanswered' => {
    if (k === 'dementia_care' && has(cg?.alz_date)) return 'yes'          // derived: ALZ training
    if (k === 'complex_care' && careLevelOf(F?.classes) === 3) return 'yes' // derived: Level 3 class
    const v = S(skills[k]?.have)
    return v === 'yes' ? 'yes' : v === 'no' ? 'no' : 'unanswered'
  }

  // ---- HARD (would gate assignment) ----
  items.push(item('axis_link', 'AxisCare identity linked', 'HARD', 'hub',
    (cg && has(cg.axiscare_id) && facts != null) ? 'pass' : 'fail',
    cg == null ? 'no hub caregiver record found' : !has(cg.axiscare_id) ? 'hub record has no AxisCare ID' : facts == null ? 'AxisCare ID does not resolve in the census' : 'linked', 'hub'))
  items.push(item('active', 'Active in AxisCare', 'HARD', 'api',
    facts == null ? 'unanswered' : F?.status?.active === true ? 'pass' : 'fail',
    facts == null ? 'census unreadable' : S(F?.status?.label) || (F?.status?.active === true ? 'Active' : 'not active'), 'axiscare'))
  const oig = S(cg?.oig_status), edl = S(cg?.edl_status), fcsr = S(cg?.fcsr_status)
  const bgBad = oig === 'FLAGGED' || /issues/i.test(edl) || /issues/i.test(fcsr)
  const bgUnknown = !oig && !edl && !fcsr
  items.push(item('background', 'Background chain clear (OIG / EDL / FCSR)', 'HARD', 'hub',
    bgBad ? 'fail' : bgUnknown ? 'unanswered' : 'pass',
    bgBad ? [oig === 'FLAGGED' ? 'OIG FLAGGED' : '', /issues/i.test(edl) ? 'EDL issues' : '', /issues/i.test(fcsr) ? 'FCSR issues' : ''].filter(Boolean).join(', ')
      : bgUnknown ? 'no background statuses recorded in the hub' : 'clear', 'hub'))

  if (clientCtx) {
    const lead = clientCtx.lead
    const attrs = ((lead?.client_attributes ?? {}) as Record<string, string>)
    items.push(item('dnr', 'Do-Not-Return for this client', 'HARD', 'hub',
      clientCtx.dnrHit ? 'fail' : 'pass',
      clientCtx.dnrHit ? 'this caregiver is on the permanent Do-Not-Return log for this client' : 'not on the DNR log for this client', 'none'))
    const cgLvl = careLevelOf(F?.classes), clLvl = careLevelOf(clientCtx.clientFacts?.classes)
    items.push(item('level', 'Care level covers the client', 'HARD', 'api',
      clLvl == null ? 'na' : cgLvl == null ? 'unanswered' : cgLvl >= clLvl ? 'pass' : 'fail',
      clLvl == null ? 'client has no level set' : cgLvl == null ? 'caregiver has no level class' : `caregiver Level ${cgLvl} vs client Level ${clLvl}`, 'axiscare'))
    const NEED: Array<[string, string, string]> = [
      ['alzheimers', 'dementia_care', 'dementia/Alzheimer’s care'],
      ['dementia', 'dementia_care', 'dementia care'],
      ['gait_belt', 'transfers_gait_belt', 'transfers / gait belt'],
      ['hoyer_lift', 'hoyer_lift', 'Hoyer lift'],
      ['bed_bound', 'bedbound_care', 'bedbound care'],
      ['hospice', 'hospice_support', 'hospice support'],
      ['parkinsons', 'parkinsons_care', 'Parkinson’s care'],
      ['personal_care', 'personal_care', 'personal care'],
      ['transportation', 'transportation', 'transportation'],
    ]
    const needed = NEED.filter(([a]) => attrs[a] === 'yes')
    const seen = new Set<string>()
    for (const [, skill, label] of needed) {
      if (seen.has(skill)) continue
      seen.add(skill)
      const st = skillState(skill)
      items.push(item('skill_' + skill, `Required competency: ${label}`, 'HARD', 'hub',
        st === 'yes' ? 'pass' : st === 'no' ? 'fail' : 'unanswered',
        st === 'yes' ? (skill === 'dementia_care' && has(cg?.alz_date) ? 'derived from ALZ training on file' : 'recorded in the hub skills record')
          : st === 'no' ? 'recorded as not having this competency'
          : 'no answer recorded — unanswered is not a no, but a required competency needs an answer', 'hub'))
    }
    if (attrs['spanish_speaking'] === 'yes') {
      const sa = S(cg?.spanish_ability)
      items.push(item('spanish', 'Spanish communication (conversational or fluent required)', 'HARD', 'hub',
        sa === 'conversational' || sa === 'fluent' ? 'pass' : sa === 'basic' ? 'fail' : sa === 'none' ? 'fail' : 'unanswered',
        sa === 'basic' ? 'basic Spanish only — greetings and simple task words are not enough to conduct a care visit safely'
          : sa === 'none' ? 'staff recorded no Spanish ability'
          : sa ? sa : 'spanish_ability unanswered (unknown is not none)', 'hub'))
    }
    const wantF = attrs['female_caregiver'], wantM = attrs['male_caregiver']
    const normalized = lead?.gender_pref_normalized === true
    const gender = S(F?.gender).toUpperCase()
    for (const [want, g, label] of [[wantF, 'F', 'female'], [wantM, 'M', 'male']] as const) {
      if (want !== 'yes' && want !== 'preferred') continue
      const required = want === 'yes' && normalized
      const match = gender === g
      items.push(item('gender_' + g, required ? `Client requires a ${label} caregiver` : `Client prefers a ${label} caregiver`,
        required ? 'HARD' : 'WARN', 'api',
        !gender ? 'unanswered' : match ? 'pass' : required ? 'fail' : 'unanswered',
        !gender ? 'caregiver gender not on the AxisCare record'
          : match ? 'matches'
          : required ? 'does not match a REQUIRED gender'
          : (want === 'yes' && !normalized) ? 'legacy preference (pre-standard) — treated as PREFER until staff confirms; ranking only'
          : 'does not match the preference — ranking only, never a block', 'axiscare'))
    }
    for (const [attr, skill, label] of [['cats', 'ok_cats', 'cats'], ['dogs', 'ok_dogs', 'dogs'], ['smoking', 'ok_smoking', 'smoking']] as const) {
      if (attrs[attr] !== 'yes') continue
      const st = skillState(skill)
      items.push(item(skill, `Comfortable with ${label} in the home`, st === 'no' ? 'HARD' : 'WARN', 'hub',
        st === 'yes' ? 'pass' : st === 'no' ? 'fail' : 'unanswered',
        st === 'no' ? `explicit no — conflicts with this home (${label})` : st === 'yes' ? 'yes on record' : 'unanswered — warning only, never inferred either way', 'hub'))
    }
    const evv = clientCtx.queueRow
    items.push(item('evv_setup', 'EVV / clock-in verified for this launch', 'FIRST_SHIFT', 'attested',
      evv == null ? 'na' : evv.evv_verified === true ? 'pass' : 'fail',
      evv == null ? 'no open launch for this client' : evv.evv_verified === true ? 'attested on the launch card' : 'launch step 5 unchecked', 'attested'))
  }

  // ---- FIRST_SHIFT (universal) ----
  items.push(item('orientation', 'Agency Orientation completed', 'FIRST_SHIFT', 'hub',
    cg == null ? 'na' : has(cg.orient_date) ? 'pass' : 'unanswered',
    has(cg?.orient_date) ? S(cg?.orient_date) : 'no orientation date in the hub record', 'hub'))
  items.push(item('alz_training', 'Pre-contact ALZ training completed', 'FIRST_SHIFT', 'hub',
    cg == null ? 'na' : has(cg.alz_date) ? 'pass' : 'unanswered',
    has(cg?.alz_date) ? S(cg?.alz_date) : 'no ALZ training date in the hub record', 'hub'))

  // ---- WARN ----
  const mobile = has(F?.mobilePhone) || has(cg?.mobile_phone)
  items.push(item('mobile', 'Mobile phone', 'WARN', 'api',
    mobile ? 'pass' : 'unanswered',
    mobile ? 'on file' : 'Cannot receive automated coverage offers — mobile number missing. Manual assignment may proceed.', 'axiscare'))
  const availAge = avail?.updated_at ? (Date.now() - Date.parse(S(avail.updated_at))) / 86400000 : null
  items.push(item('availability', 'Availability on record', 'WARN', 'hub',
    avail == null ? 'unanswered' : (availAge != null && availAge > 90) ? 'unanswered' : 'pass',
    avail == null ? 'no availability recorded — confidence warning only; an explicit conflict with a proposed shift is what blocks a match'
      : (availAge != null && availAge > 90) ? `availability is ${Math.round(availAge)} days old — stale, warning only` : 'current', 'hub'))
  items.push(item('mailing_address', 'Mailing address (proximity ranking)', 'WARN', 'api',
    facts == null ? 'na' : (has(F?.mailingAddress?.city) || has(F?.mailingAddress?.postalCode)) ? 'pass' : 'unanswered',
    (has(F?.mailingAddress?.city)) ? S(F?.mailingAddress?.city) : 'no mailing address in AxisCare — proximity ranking degrades', 'axiscare'))
  items.push(item('email', 'Email', 'WARN', 'api',
    (has(F?.personalEmail) || has(cg?.email)) ? 'pass' : 'unanswered', 'record quality only', 'axiscare'))

  return { items }
}

/* ── would-block computation (shared shape for both entities) ──────────── */
function wouldBlock(items: Item[], grandfathered: boolean) {
  const blockers = (sev: Severity) => items
    .filter(i => i.severity === sev && (i.status === 'fail' || i.status === 'unanswered'))
    .map(i => ({ code: i.code, label: i.label, status: i.status, detail: i.detail }))
  return {
    grandfathered,
    ready_for_staffing: grandfathered ? [] : blockers('HARD'),
    first_shift: grandfathered ? [] : blockers('HARD').concat(blockers('FIRST_SHIFT')),
    display_only_cleanup: grandfathered ? blockers('HARD').concat(blockers('FIRST_SHIFT')) : [],
  }
}

/* ═══ SELFTEST FIXTURES — every branch, run with GET ?selftest=1 ═════════ */
function runSelfTest() {
  const results: Array<{ fixture: string; pass: boolean; got?: string }> = []
  const T = (fixture: string, pass: boolean, got = '') => results.push({ fixture, pass, got })
  const find = (r: { items: Item[] }, code: string) => r.items.find(i => i.code === code)

  const fullFacts = { firstName: 'Test', lastName: 'Client', mobilePhone: '417', dateOfBirth: '1940-01-01',
    residentialAddress: { streetAddress1: '1 Main', city: 'Springfield', postalCode: '65802' },
    allergies: 'None known', classes: [{ label: 'Level 2 - Personal Care' }], startDate: '2026-10-01',
    medicaidNumber: 'DCN1', personalEmail: 'x@y.z' }
  const parties = [{ name: 'Daughter', phones: [{ number: '417' }], hipaaDisclosureAuthorization: '1' }]
  const newSoc = (pathway: string, done: string[]) => ({ pathway, started_at: '2026-09-22T00:00:00Z',
    steps: done.map(id => ({ id, done_at: 'x' })) })
  const ppLead = { funding_source: 'private', attributes_entered_at: 'x',
    soc: newSoc('PP', ['p0', 'p1', 'p2', 'p3', 'p4', 'm0', 'm1', 'm2']), client_attributes: {} }
  const prof = { entrance: 'side door', pets: 'one cat', }

  // 1 complete PP client passes every required item
  let r = evalClient({ facts: fullFacts, parties, lead: ppLead, prof, queueRow: null })
  let wb = wouldBlock(r.items, r.grandfathered)
  T('PP complete: nothing would block', wb.ready_for_staffing.length === 0 && wb.first_shift.length === 0,
    JSON.stringify(wb.first_shift.map(b => b.code)))
  // 2 unchecked billing = HARD would-block
  const ppNoBill = { ...ppLead, soc: newSoc('PP', ['p0', 'p1', 'p2', 'p3', 'm0', 'm1', 'm2']) }
  r = evalClient({ facts: fullFacts, parties, lead: ppNoBill, prof, queueRow: null })
  wb = wouldBlock(r.items, r.grandfathered)
  T('PP billing unchecked -> HARD would-block', wb.ready_for_staffing.some(b => b.code === 'pp_billing'))
  // 3 blank allergies = unanswered, never 'no allergies'
  r = evalClient({ facts: { ...fullFacts, allergies: '' }, parties, lead: ppLead, prof, queueRow: null })
  const alg = find(r, 'allergies')!
  T('blank allergies = unanswered (not none)', alg.status === 'unanswered' && /AxisCare/.test(alg.detail))
  // 4 explicit None known passes
  T('allergies "None known" passes', find(evalClient({ facts: fullFacts, parties, lead: ppLead, prof, queueRow: null }), 'allergies')!.status === 'pass')
  // 5 entrance blank = unanswered; explicit none passes
  r = evalClient({ facts: fullFacts, parties, lead: ppLead, prof: {}, queueRow: null })
  T('blank entrance = unanswered', find(r, 'entrance')!.status === 'unanswered')
  r = evalClient({ facts: fullFacts, parties, lead: ppLead, prof: { entrance_none: true, pets_none: true }, queueRow: null })
  T('explicit "no special instructions"/"no pets" pass', find(r, 'entrance')!.status === 'pass' && find(r, 'pets')!.status === 'pass')
  // 6 no responsible party fails; documented exception passes
  r = evalClient({ facts: fullFacts, parties: [], lead: ppLead, prof, queueRow: null })
  T('no responsible party -> fail with exception offer', find(r, 'responsible_party')!.status === 'fail' && find(r, 'responsible_party')!.fix === 'exception')
  r = evalClient({ facts: fullFacts, parties: [], lead: ppLead, prof: { ...prof, no_responsible_party: { reason: 'lives alone, no family', by: 'S', at: 'x' } }, queueRow: null })
  T('documented no-RP exception passes', find(r, 'responsible_party')!.status === 'pass')
  // 7 conditional: DCN absent for private pay, present for Medicaid
  T('no DCN item for private pay', find(evalClient({ facts: fullFacts, parties, lead: ppLead, prof, queueRow: null }), 'dcn') == null)
  const medLead = { funding_source: 'medicaid', attributes_entered_at: 'x', soc: newSoc('A1', ['m0', 'm1', 'm2']), client_attributes: {} }
  T('DCN item appears for Medicaid', find(evalClient({ facts: fullFacts, parties, lead: medLead, prof, queueRow: null }), 'dcn') != null)
  // 8 grandfathering: pre-standard SOC can never block
  const oldLead = { funding_source: 'private', client_attributes: {}, soc: { pathway: 'PP', started_at: '2026-09-01T00:00:00Z', steps: [{ id: 'p0' }] } }
  r = evalClient({ facts: { firstName: 'Old' }, parties: [], lead: oldLead, prof: {}, queueRow: null })
  wb = wouldBlock(r.items, r.grandfathered)
  T('grandfathered record: zero blocks, cleanup listed', r.grandfathered && wb.ready_for_staffing.length === 0 && wb.first_shift.length === 0 && wb.display_only_cleanup.length > 0)
  // 9 existing client with no SOC = grandfathered
  r = evalClient({ facts: fullFacts, parties, lead: null, prof: {}, queueRow: null })
  T('no SOC at all = grandfathered', r.grandfathered)
  // 10 DOB required for private pay too
  r = evalClient({ facts: { ...fullFacts, dateOfBirth: '' }, parties, lead: ppLead, prof, queueRow: null })
  T('missing DOB flags on PRIVATE PAY (first-shift)', find(r, 'dob')!.status === 'unanswered' && wouldBlock(r.items, r.grandfathered).first_shift.some(b => b.code === 'dob'))
  // 11 startDate never in the HARD list
  T('startDate absent from ready-for-staffing blockers', !wouldBlock(r.items, r.grandfathered).ready_for_staffing.some(b => b.code === 'start_date'))

  // caregiver fixtures
  const cgFacts = { status: { active: true, label: 'Active' }, gender: 'F', mobilePhone: '417',
    mailingAddress: { city: 'Springfield', postalCode: '65802' }, classes: [{ label: 'Level 2 - Personal Care' }], personalEmail: 'c@x.y' }
  const cgRec = { axiscare_id: '9', orient_date: '2026-01-01', alz_date: '2026-01-02',
    oig_status: 'CLEAR', edl_status: 'Clear', fcsr_status: 'Clear', skills: { transfers_gait_belt: { have: 'yes' }, ok_dogs: { have: 'no' } }, spanish_ability: 'basic' }
  const clLead = { client_attributes: { gait_belt: 'yes', dogs: 'yes', spanish_speaking: 'yes', alzheimers: 'yes', female_caregiver: 'yes' }, gender_pref_normalized: true }
  const ctx = { lead: clLead, clientFacts: { classes: [{ label: 'Level 2 - Personal Care' }] }, dnrHit: false, queueRow: { evv_verified: true } }
  let c = evalCaregiver({ facts: cgFacts, cg: cgRec, avail: { updated_at: new Date().toISOString() }, clientCtx: ctx })
  T('gait belt skill passes', find(c, 'skill_transfers_gait_belt')!.status === 'pass')
  T('dementia_care DERIVED from ALZ date (no manual box)', find(c, 'skill_dementia_care')!.status === 'pass' && /derived/i.test(find(c, 'skill_dementia_care')!.detail))
  T('explicit no-dogs vs dog home = HARD conflict', find(c, 'ok_dogs')!.severity === 'HARD' && find(c, 'ok_dogs')!.status === 'fail')
  T('basic Spanish fails WITH explanation', find(c, 'spanish')!.status === 'fail' && /not enough/.test(find(c, 'spanish')!.detail))
  T('gender REQUIRED + match passes', find(c, 'gender_F')!.status === 'pass' && find(c, 'gender_F')!.severity === 'HARD')
  // legacy gender yes without normalization = prefer/warn only
  c = evalCaregiver({ facts: { ...cgFacts, gender: 'M' }, cg: cgRec, avail: null, clientCtx: { ...ctx, lead: { ...clLead, gender_pref_normalized: undefined } } })
  T('legacy gender "yes" treated as PREFER (warn, not block)', find(c, 'gender_F')!.severity === 'WARN')
  // required gender mismatch blocks when normalized
  c = evalCaregiver({ facts: { ...cgFacts, gender: 'M' }, cg: cgRec, avail: null, clientCtx: ctx })
  T('gender REQUIRED + mismatch = HARD fail', find(c, 'gender_F')!.status === 'fail' && find(c, 'gender_F')!.severity === 'HARD')
  // unanswered willingness warns
  c = evalCaregiver({ facts: cgFacts, cg: { ...cgRec, skills: {} }, avail: null, clientCtx: { ...ctx, lead: { client_attributes: { cats: 'yes' } } } })
  T('unanswered willingness = WARN, never inferred', find(c, 'ok_cats')!.severity === 'WARN' && find(c, 'ok_cats')!.status === 'unanswered')
  // dnr blocks
  c = evalCaregiver({ facts: cgFacts, cg: cgRec, avail: null, clientCtx: { ...ctx, dnrHit: true } })
  T('DNR for this client = HARD fail', find(c, 'dnr')!.status === 'fail')
  // inactive blocks
  c = evalCaregiver({ facts: { ...cgFacts, status: { active: false, label: 'Inactive' } }, cg: cgRec, avail: null, clientCtx: null })
  T('inactive in AxisCare = HARD fail', find(c, 'active')!.status === 'fail')
  // missing mobile: WARN with the exact capability wording
  c = evalCaregiver({ facts: { ...cgFacts, mobilePhone: '' }, cg: { ...cgRec, mobile_phone: '' }, avail: null, clientCtx: null })
  T('missing mobile = WARN with exact capability text', find(c, 'mobile')!.severity === 'WARN' && /Cannot receive automated coverage offers — mobile number missing/.test(find(c, 'mobile')!.detail))
  // stale availability warns only
  c = evalCaregiver({ facts: cgFacts, cg: cgRec, avail: { updated_at: '2026-01-01T00:00:00Z' }, clientCtx: null })
  T('stale availability = WARN only', find(c, 'availability')!.severity === 'WARN' && find(c, 'availability')!.status === 'unanswered')
  // level below client blocks
  c = evalCaregiver({ facts: { ...cgFacts, classes: [{ label: 'Level 1 - Wellness Care' }] }, cg: cgRec, avail: null,
    clientCtx: { ...ctx, clientFacts: { classes: [{ label: 'Level 3 - Complex Care' }] } } })
  T('level 1 caregiver vs level 3 client = HARD fail', find(c, 'level')!.status === 'fail')

  const failed = results.filter(x => !x.pass)
  return { pass: failed.length === 0, total: results.length, failed, results }
}

/* ── auth: signed-in staff or the server, never anonymous ──────────────── */
function callerRole(req: Request): string {
  try {
    const tok = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const payload = JSON.parse(atob(tok.split('.')[1] ?? ''))
    return String(payload?.role ?? '')
  } catch { return '' }
}

Deno.serve(async (req) => {
  const cors = { 'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' }
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b, null, 2), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

  const url = new URL(req.url)
  if (req.method === 'GET' && url.searchParams.get('selftest') === '1') return json(runSelfTest())

  const role = callerRole(req)
  if (role !== 'authenticated' && role !== 'service_role')
    return json({ error: 'a signed-in coordinator session is required' }, 403)

  // deno-lint-ignore no-explicit-any
  let b: any = {}
  try { b = await req.json() } catch { /* empty body fine */ }

  const settings = await opsSettings()
  const enforcement = {
    client_profile_enforcement: settings.client_profile_enforcement === true,
    caregiver_assignment_enforcement: settings.caregiver_assignment_enforcement === true,
    first_shift_profile_enforcement: settings.first_shift_profile_enforcement === true,
  }

  try {
    if (b.client_eval) {
      const leads = await appData('leads')
      // deno-lint-ignore no-explicit-any
      const lead = (leads as any[]).find(l =>
        (b.client_eval.lead_id && l.id === b.client_eval.lead_id) ||
        (b.client_eval.axiscare_client_id && S(l.axiscare_client_id) === S(b.client_eval.axiscare_client_id))) ?? null
      const ax = S(b.client_eval.axiscare_client_id) || S(lead?.axiscare_client_id)
      // deno-lint-ignore no-explicit-any
      let facts: any = null, parties: any[] = []
      if (ax) {
        try { facts = await axGet(`clients/${ax}`) } catch { facts = null }
        try { parties = rowsOf(await axGet(`clients/${ax}/responsibleParties`)) } catch { parties = [] }
      }
      const profs = await appData('client_profiles')
      // deno-lint-ignore no-explicit-any
      const prof = (profs as any[]).find(p => p.id === 'cp_ax' + ax) ?? null
      const { data: qr } = ax ? await sb.from('client_queue').select('*')
        .eq('axiscare_client_id', ax).neq('status', 'complete').limit(1).maybeSingle() : { data: null }
      const { items, grandfathered } = evalClient({ facts, parties, lead, prof, queueRow: qr })
      return json({ shadow: true, entity: 'client', axiscare_client_id: ax || null,
        lead_id: lead?.id ?? null, enforcement, items,
        would_block: wouldBlock(items, grandfathered),
        summary: summarize(items) })
    }

    if (b.caregiver_eval) {
      const axId = S(b.caregiver_eval.axiscare_id)
      const cgs = await appData('caregivers')
      // deno-lint-ignore no-explicit-any
      const cg = (cgs as any[]).find(c => S(c.axiscare_id) === axId) ??
        // deno-lint-ignore no-explicit-any
        (b.caregiver_eval.name ? (cgs as any[]).find(c =>
          `${S(c.first)} ${S(c.last)}`.toLowerCase() === S(b.caregiver_eval.name).toLowerCase()) : null) ?? null
      // deno-lint-ignore no-explicit-any
      let facts: any = null
      const useId = axId || S(cg?.axiscare_id)
      if (useId) { try { facts = await axGet(`caregivers/${useId}`) } catch { facts = null } }
      const avails = await appData('caregiver_availability')
      // deno-lint-ignore no-explicit-any
      const avail = (avails as any[]).find(a => S(a.axiscare_id) === useId) ?? null

      let clientCtx = null
      if (b.caregiver_eval.client_lead_id || b.caregiver_eval.client_axiscare_id) {
        const leads = await appData('leads')
        // deno-lint-ignore no-explicit-any
        const lead = (leads as any[]).find(l =>
          l.id === b.caregiver_eval.client_lead_id ||
          (b.caregiver_eval.client_axiscare_id && S(l.axiscare_client_id) === S(b.caregiver_eval.client_axiscare_id))) ?? null
        const cax = S(b.caregiver_eval.client_axiscare_id) || S(lead?.axiscare_client_id)
        // deno-lint-ignore no-explicit-any
        let clientFacts: any = null
        if (cax) { try { clientFacts = await axGet(`clients/${cax}`) } catch { clientFacts = null } }
        const dnr = await appData('dnr_log')
        const cgName = facts ? `${S(facts.firstName)} ${S(facts.lastName)}`.toLowerCase()
          : cg ? `${S(cg.first)} ${S(cg.last)}`.toLowerCase() : ''
        const clName = clientFacts ? `${S(clientFacts.firstName)} ${S(clientFacts.lastName)}`.toLowerCase()
          : lead ? `${S(lead.client_first_name || lead.first_name)} ${S(lead.client_last_name || lead.last_name)}`.toLowerCase() : ''
        // deno-lint-ignore no-explicit-any
        const dnrHit = !!(cgName && clName && (dnr as any[]).some(d =>
          S(d.caregiver).toLowerCase() === cgName && S(d.client).toLowerCase() === clName))
        const { data: qr } = cax ? await sb.from('client_queue').select('*')
          .eq('axiscare_client_id', cax).neq('status', 'complete').limit(1).maybeSingle() : { data: null }
        clientCtx = { lead, clientFacts, dnrHit, queueRow: qr }
      }
      const { items } = evalCaregiver({ facts, cg, avail, clientCtx })
      const wb = wouldBlock(items, false)
      return json({ shadow: true, entity: 'caregiver', axiscare_id: useId || null, enforcement, items,
        would_block: { assignment: wb.ready_for_staffing, first_shift: wb.first_shift, grandfathered: false },
        summary: summarize(items) })
    }
  } catch (err) { return json({ error: String(err) }, 502) }

  return json({ error: 'pass client_eval or caregiver_eval, or GET ?selftest=1' }, 400)
})

function summarize(items: Item[]) {
  const req = items.filter(i => i.severity === 'HARD' || i.severity === 'FIRST_SHIFT')
  const done = req.filter(i => i.status === 'pass' || i.status === 'na')
  return {
    required_total: req.length, required_complete: done.length,
    missing: req.filter(i => i.status !== 'pass' && i.status !== 'na')
      .map(i => `${i.label}${i.status === 'unanswered' ? ' (needs an answer)' : ''}`),
    warnings: items.filter(i => i.severity === 'WARN' && i.status !== 'pass' && i.status !== 'na').length,
  }
}
