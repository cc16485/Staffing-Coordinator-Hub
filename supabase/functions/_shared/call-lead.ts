// =============================================================================
// call-lead · what one call says, in the lead form's own fields (Make this a lead, 2026-10-14)
// =============================================================================
// Samantha 2026-10-14: "our number and phone transcripts need to be used to fill lead and have us easily mark call as
// a lead". Her decision on the mockup: the AI only TAGS likely new families; a person clicks "Make this a lead", the
// lead form opens filled from the call, everything heard on the call is yellow, and the person checks it and saves.
// v2 (same day): "I want everything that is given on the call to be filled, dont restrict... the more info we can get
// about a client the better" and "start drafting [the care plan]... we will add to it after the home visit". So the
// reader fills EVERY lead box the call mentions, keeps anything else said in the notes, and drafts the care plan
// (the plan's own fields, a narrative, and care tasks picked from AxisCare's own task list), marked as reported by the
// family on the phone, for the home visit to check and add to.
// Payers (her rule 2026-10-14): private pay, long-term care insurance, VA, Medicare GUIDE. CDS goes to the CDS
// sub-account. Medicaid is no longer accepted: a caller who mentions it is flagged, never filed as Medicaid.
// v3 (her yes to "fixes 1 to 5", 2026-10-15): also Home & Life (living situation, facility, preferred name, what changed,
// allergies, pets, smoking, caregiver preference, Spanish) and the other people involved, each held to the Hub's own
// choices. A lead that already exists can be filled from ALL its calls (call-to-lead read_lead).
// This file is the pure part: the reading tool, the request, and the answer held to the form's fixed choices in code.
// Nothing here writes anything.
// =============================================================================
import type { Adl } from './axiscare-adls.ts'
export const MODEL = 'claude-opus-5-5'

const NEEDS = ['personalCare', 'dementia', 'transportation', 'housekeeping', 'respite', 'overnight', 'va', 'privatePay'] as const
const SAFETY = ['fallRisk', 'livesAlone', 'recentHospitalization'] as const
const PERSONAL = ['bathing', 'dressing', 'toileting', 'transfers'] as const
const CONDS = ['dementia', 'alzheimers', 'parkinsons', 'stroke', 'diabetes', 'copd'] as const
const DEMENTIA = ['wandering', 'aggression', 'sundowning'] as const
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
const START = ['', 'asap', 'by_date', 'this_week', 'this_month', 'planning'] as const
const MOBILITY = ['', 'independent', 'walker', 'wheelchair', 'bedbound'] as const
const PAYER = ['', 'private', 'ltc', 'va', 'guide', 'cds'] as const
const SOURCE = ['Phone', 'Referral', 'Website', 'Other'] as const
const SUBTYPE = ['', 'hospital', 'snf_rehab', 'case_manager', 'community', 'apfm', 'other'] as const
const GENDER = ['', 'Male', 'Female'] as const
const MARITAL = ['', 'Single', 'Married', 'Widowed', 'Divorced', 'Separated'] as const
const YESNO = ['', 'yes', 'no', 'unsure'] as const
const LEVEL = ['', '1', '2', '3'] as const
const WHEN = ['any', 'morning', 'afternoon', 'evening', 'night'] as const
const LIVING = ['', 'alone', 'spouse_partner', 'family', 'paid_help', 'facility', 'other'] as const
const WHY_NOW = ['fall', 'discharge', 'caregiver_cant_continue', 'memory_worse', 'provider_cant_staff', 'new_diagnosis', 'other'] as const
const GENDER_PREF = ['', 'female_required', 'female_preferred', 'male_required', 'male_preferred', 'no_preference'] as const
const SMOKE = ['', 'yes', 'no'] as const

const str = (description: string) => ({ type: 'string', description })
const one = (list: readonly string[], description: string) => ({ type: 'string', enum: [...list], description })
const many = (list: readonly string[], description: string) => ({ type: 'array', items: { type: 'string', enum: [...list] }, description })
const obj = (properties: Record<string, unknown>, description: string) => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties), description })

const PLAN = {
  adl_needs: str('Help with daily living the call described (bathing, dressing, toileting, transfers, walking, eating), in sentences, with how much help.'),
  iadl_needs: str('Help around the home the call described (meals, housekeeping, laundry, errands, rides, medication reminders, shopping).'),
  medical_conditions: str('Health conditions and diagnoses said on the call, as said. Never add one that was not said.'),
  medications: str('Medications named on the call, with doses only if said. Empty if none.'),
  safety_concerns: str('Falls, home hazards, wandering, living alone, stairs, pets, oxygen, anything risky said.'),
  client_goals: str('What the person and family hope for, in their own spirit.'),
  services_recommended: str('What Caring Companions would do for them, matched to the needs above.'),
  recommended_frequency: str('Days and times, e.g. "Mon to Fri mornings".'),
  recommended_hours_per_week: str('Whole hours a week, as a number, e.g. "20". Empty if not said.'),
  narrative: str('A care plan narrative in plain sentences, 1 to 3 short paragraphs: who the client is, their home and family, what they need help with and when, what matters to them, and anything a caregiver should know on day one. Say it is from the phone call, reported by the family, to be confirmed at the home visit. Never invent anything.'),
  tasks: { type: 'array', description: 'Care tasks for AxisCare, chosen ONLY from the task list given (by its number). One per task the call supports.', items: obj({
    adl_id: { type: 'integer', description: 'The number of the task from the AxisCare task list.' },
    days: many(DAYS, 'Days it is needed. Empty if not said.'),
    as_needed: { type: 'boolean', description: 'True if only sometimes needed rather than every visit.' },
    when: one(WHEN, 'Time of day.'),
    instructions: str('Short instructions for the caregiver for this task, from what was said.'),
  }, 'One care task') },
}

export const TOOL = {
  name: 'fill_lead_form',
  description: 'Fill the Caring Companions new-lead form and start the care plan draft from one phone call. Fill every box the call gives an answer for. Use an empty string or an empty list only when the call did not say. Never guess.',
  /* not strict (Desktop 1058, 2026-10-22): the AI service refused this form in strict mode, "The compiled grammar is too
     large ... Simplify your tool schemas or reduce the number of strict tools" (a 400 on every call). toPrefill below holds
     every answer to the form's own choices in code, so a wrong type or an unknown choice is dropped, never saved. */
  input_schema: obj({
    is_new_family: { type: 'boolean', description: 'True if someone is asking about home care for themselves or a loved one. False for a job applicant, caregiver, vendor, existing client, wrong number or spam.' },
    not_new_family_reason: str('If is_new_family is false, a few words why. Empty otherwise.'),
    caller_first_name: str('The caller\'s first name if said.'), caller_last_name: str('The caller\'s last name if said.'),
    email_heard: str('An email address the caller spelled out, exactly as heard.'),
    relationship: str('Who the caller is to the person needing care, e.g. "Daughter", "Self", "Case manager".'),
    client_first_name: str('First name of the person who needs care.'), client_last_name: str('Their last name.'),
    client_dob: str('Their date of birth as YYYY-MM-DD, only if the full date was said.'),
    client_age: str('Their age in years if said, e.g. "84".'),
    client_gender: one(GENDER, 'Their gender if clear from the call.'),
    client_address: str('Street address of the home where care would happen.'), client_city: str('Town.'),
    client_state: str('Two-letter state, e.g. "MO".'), client_zip: str('ZIP code.'),
    client_phone: str('The care recipient\'s own phone number if a different one was given.'),
    marital_status: one(MARITAL, 'Their marital status if said.'),
    language: str('Their main language if said, e.g. "English", "Spanish".'),
    source: one(SOURCE, 'How this family reached us: Referral if a professional or organisation sent them, else Phone.'),
    referral_source_name: str('Who referred them, e.g. "Mercy discharge planner".'),
    referral_subtype: one(SUBTYPE, 'Kind of professional who referred them, if any.'),
    heard_about_us: str('How they heard about Caring Companions if said (Google, a friend, a flyer).'),
    desired_start_kind: one(START, 'When they want care to start.'),
    desired_start_date: str('YYYY-MM-DD, only when desired_start_kind is by_date. Work it out from the call date given.'),
    needs: many(NEEDS, 'Kinds of help asked for. personalCare = bathing, dressing, toileting; housekeeping = meals, cleaning, laundry, errands at home.'),
    weight_bearing: one(YESNO, 'Can they bear their own weight and pivot? Only if the call says.'),
    level_estimate: one(LEVEL, 'Likely care level by this rule, only if the call gives enough: 1 = no hands-on help; 2 = hands-on personal care and they can bear weight; 3 = cannot bear weight or pivot, lift transfers, or dementia care.'),
    safety: many(SAFETY, 'Safety flags mentioned.'),
    mobility: one(MOBILITY, 'How they get around, if said.'),
    personal_care: many(PERSONAL, 'Hands-on help mentioned.'),
    medical_conditions: many(CONDS, 'Conditions mentioned that match this list.'),
    dementia_follow_up: many(DEMENTIA, 'Dementia behaviours mentioned.'),
    medical_notes: str('Every other health detail said (other conditions, recent hospital stays, surgeries, medications, allergies, vision, hearing, diet, oxygen).'),
    physician_name: str('Their doctor\'s name if said.'), physician_phone: str('The doctor\'s phone if said.'),
    preferred_hospital: str('Their hospital if said.'),
    schedule_days: many(DAYS, 'Days of the week they want care.'),
    times_needed: str('Times of day they want care, with the days when they differ, e.g. "5:30 to 9:30 pm Mon to Fri; 8 am to 9:30 pm Sat and Sun".'),
    number_of_hours: str('Total hours a week as a number. If they gave days and times instead of a total, ADD THEM UP: e.g. 5:30 to 9:30 pm Mon to Fri is 4 h × 5 = 20, plus 8 am to 9:30 pm Sat and Sun is 13.5 h × 2 = 27, so "47". Leave it empty only when neither a total nor days and times were said.'),
    funding_source: one(PAYER, 'How they plan to pay. ltc = long-term care insurance; guide = the Medicare GUIDE dementia program; cds = Consumer Directed Services. Medicaid is not a choice: use medicaid_mentioned.'),
    medicaid_mentioned: { type: 'boolean', description: 'True if they said they have or want Medicaid to pay.' },
    rate_quoted: str('A rate the office quoted on the call, e.g. "$32 an hour". Empty if none.'),
    why_called: str('Why they called, one line under 140 characters.'),
    summary: str('3 to 6 sentences for the coordinator: who called, who needs care, what they need, timeline, worries, and the next step agreed.'),
    /* 2026-10-29 (Call notes, her ask "do the same for our leads" after the CDS hub): what this one call adds, for the office notes */
    short_note: str('One to three short sentences for the office notes about THIS call only: what it was about, what changed and what was agreed. Plain everyday words, first names, no em dashes. Internal only.'),
    call_back_day: str('YYYY-MM-DD: the day we said we would call them back, or the day they asked to be called, worked out from the call date given ("Monday" = the next Monday after the call). Never before the call date. Empty when no call back was talked about.'),
    call_back_why: str('What the call back is about, under 80 characters, e.g. "after she talks to her brother". Empty when no call back.'),
    other_details: str('Everything else useful the call said that no box above covers: home and family, who lives with them, pets, stairs, interests, routines, preferences, likes and dislikes, faith, personality, caregiver preferences, past agencies. As short sentences.'),
    care_plan: obj(PLAN, 'The start of the care plan, from this call. Reported by the family, to be checked and added to at the home visit.'),
    home_life: obj({
      preferred_name: str('What the client likes to be called, if said.'),
      living_situation: one(LIVING, 'Who they live with: alone, spouse_partner, family, paid_help, facility (assisted living, memory care, nursing home), other.'),
      facility_name: str('The facility or community name if they live in one, e.g. "Elfdale assisted living, Apex".'),
      why_now: many(WHY_NOW, 'What changed that made them call now.'),
      allergies: str('Allergies and sensitivities if said.'),
      cats: { type: 'boolean', description: 'True if a cat is in the home.' }, dogs: { type: 'boolean', description: 'True if a dog is in the home.' },
      smoking: one(SMOKE, 'Is there smoking in the home? Only if said.'),
      caregiver_gender: one(GENDER_PREF, 'A caregiver gender wish if said: required = must be, preferred = would like.'),
      spanish: { type: 'boolean', description: 'True if the client needs or prefers a Spanish-speaking caregiver.' },
    }, 'Home & Life, as said on the call'),
    people: { type: 'array', description: 'Everyone else involved that the call names, NOT the caller: family, friends, partners, POA, doctors, case managers, facility staff, a current caregiver.', items: obj({
      name: str('Their name, or a description if no name was said, e.g. "her boyfriend".'),
      relationship: str('Who they are to the client, e.g. "Son", "Boyfriend", "POA", "Current caregiver".'),
      note: str('What was said about them that matters, e.g. "can get in the way during care".'),
      phone: str('Their phone number, only if it was said on the call.'),
    }, 'One person') },
  }, 'The lead form and care plan draft'),
}

const SYSTEM = `You read the transcript of one phone call to Caring Companions, a small family-owned home care agency in Springfield, Missouri, fill in its new-lead form and start the care plan draft for a care coordinator to check before saving. Fill every box the call gives an answer for: the more the office knows about the client, the better. Only write what the call actually said; leave a box empty when it did not. Speakers are labelled by channel, not by name: work out who is the office and who is the caller from what they say. Always answer by calling the fill_lead_form tool, never in plain text.`

export type CallIn = { transcript: string; callDay: string; direction: string; knownName: string; adls?: Adl[]; several?: boolean }

/** The Messages API request (server-side refusal fallback on, as for the other call reader). */
export function request(c: CallIn) {
  const list = (c.adls || []).length ? '\n\nThe AxisCare task list (number: name). Choose care_plan.tasks only from these numbers:\n' + (c.adls || []).map((a) => `${a.id}: ${a.name}`).join('\n')
    : '\n\nThe AxisCare task list could not be read, so leave care_plan.tasks empty.'
  return {
    model: MODEL, max_tokens: 8000,
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    output_config: { effort: 'low' },
    system: SYSTEM, tools: [TOOL], tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: `${c.several ? 'These are every call we have had with this family, oldest first; use all of them, and where they disagree the newest wins. Newest call' : 'Call'} date (Central time): ${c.callDay}. ${c.direction === 'outbound' ? 'We called them.' : 'They called us.'} The phone system's name for this contact: ${c.knownName || '(none)'}.${list}\n\nFill the lead form and the care plan draft with the fill_lead_form tool.\n\n<transcript>\n${c.transcript.slice(0, 60000)}\n</transcript>` }],
  }
}

/** The tool answer from a Messages API response, or null (a refusal or a plain-text answer). */
// deno-lint-ignore no-explicit-any
export function toolAnswer(resp: any): Record<string, unknown> | null {
  if (!resp || resp.stop_reason === 'refusal') return null
  // deno-lint-ignore no-explicit-any
  const tu = (resp.content || []).find((b: any) => b && b.type === 'tool_use' && b.name === TOOL.name)
  return tu && tu.input && typeof tu.input === 'object' ? tu.input : null
}

const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)
const para = (v: unknown, n: number) => String(v ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, n)
const pick = (v: unknown, list: readonly string[]) => (list.includes(String(v)) ? String(v) : '')
const pickMany = (v: unknown, list: readonly string[]) => Array.from(new Set((Array.isArray(v) ? v : []).map(String).filter((x) => list.includes(x))))
const ordered = (v: unknown, list: readonly string[]) => list.filter((d) => pickMany(v, list).includes(d))
const ymd = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !isNaN(Date.parse(String(v))) ? String(v) : ''
const num = (v: unknown, max: number) => { const m = String(v ?? '').match(/\d+(\.\d+)?/); return m && Number(m[0]) > 0 && Number(m[0]) <= max ? m[0] : '' }
const AX_DAY: Record<string, string> = { Sun: 'N', Mon: 'M', Tue: 'T', Wed: 'W', Thu: 'R', Fri: 'F', Sat: 'S' }

export type Contact = { first_name: string; last_name: string; phone: string; email: string }
export type CarePlanDraft = { fields: Record<string, string>; narrative: string; axiscare_tasks: Record<string, unknown>[]; heard: string[] }
export type Profile = { facts: Record<string, unknown>; attributes: Record<string, string>; people: Record<string, string>[] }
export type CallNote = { note: string; call_back: { day: string; why: string } | null }
export type Prefill = { prefill: Record<string, unknown>; heard: string[]; is_new_family: boolean; not_new_family_reason: string; medicaid_mentioned: boolean; care_plan: CarePlanDraft; profile: Profile; call_note: CallNote }

/** The call note (2026-10-29): the short note, and a call back day on or after the call day (anything else is dropped). */
export function toCallNote(a: Record<string, unknown>, callDay = ''): CallNote {
  const note = para(String(a?.short_note ?? '').replace(/\s*[\u2014\u2013]\s*/g, ', '), 400)
  const day = ymd(a?.call_back_day), from = String(callDay || '').slice(0, 10)
  const ok = day && (!/^\d{4}-\d{2}-\d{2}$/.test(from) || day >= from)
  return { note, call_back: ok ? { day, why: clip(String(a?.call_back_why ?? '').replace(/\s*[\u2014\u2013]\s*/g, ', '), 80) } : null }
}

/** Home & Life and the people involved, held to the Hub's own choices: facts use the fact kinds' own values (Gate 3);
 *  the AxisCare checklist uses yes / preferred. Nothing empty is kept. */
// deno-lint-ignore no-explicit-any
export function toProfile(h: any, people: any): Profile {
  const x = h && typeof h === 'object' ? h : {}
  const facts: Record<string, unknown> = {}
  const pn = clip(x.preferred_name, 40); if (pn) facts.preferred_name = pn
  const ls = pick(x.living_situation, LIVING); if (ls) facts.living_situation = ls
  const fn = clip(x.facility_name, 120); if (fn) facts.facility_name = fn
  const wn = pickMany(x.why_now, WHY_NOW); if (wn.length) facts.why_now = wn
  const al = clip(x.allergies, 300); if (al) facts.allergies = al
  const attributes: Record<string, string> = {}
  if (x.cats === true) attributes.cats = 'yes'
  if (x.dogs === true) attributes.dogs = 'yes'
  const sm = pick(x.smoking, SMOKE); if (sm) attributes.smoking = sm
  const g = pick(x.caregiver_gender, GENDER_PREF)
  if (g === 'female_required') attributes.female_caregiver = 'yes'
  if (g === 'female_preferred') attributes.female_caregiver = 'preferred'
  if (g === 'male_required') attributes.male_caregiver = 'yes'
  if (g === 'male_preferred') attributes.male_caregiver = 'preferred'
  if (x.spanish === true) attributes.spanish_speaking = 'yes'
  const seen = new Set<string>()
  const ppl = (Array.isArray(people) ? people : []).map((p: Record<string, unknown>) => {
    const ph = String(p?.phone ?? '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')
    return { name: clip(p?.name, 60), relationship: clip(p?.relationship, 40), note: clip(p?.note, 200), ...(ph.length === 10 ? { phone: ph } : {}) }
  })
    .filter((p: Record<string, string>) => p.name && !seen.has(p.name.toLowerCase()) && seen.add(p.name.toLowerCase())).slice(0, 8)
  return { facts, attributes, people: ppl }
}

/** The care plan part, held to the plan form and to AxisCare's task list (only real task numbers survive). */
// deno-lint-ignore no-explicit-any
export function toPlan(cp: any, adls: Adl[], scheduleDays: string[]): CarePlanDraft {
  const c = cp && typeof cp === 'object' ? cp : {}
  const fields: Record<string, string> = {}
  for (const k of ['adl_needs', 'iadl_needs', 'medical_conditions', 'medications', 'safety_concerns', 'client_goals', 'services_recommended']) { const v = para(c[k], 2000); if (v) fields[k] = v }
  const fq = clip(c.recommended_frequency, 120); if (fq) fields.recommended_frequency = fq
  const hw = num(c.recommended_hours_per_week, 168); if (hw) fields.recommended_hours_per_week = hw
  const byId = new Map(adls.map((a) => [a.id, a]))
  const seen = new Set<number>()
  const tasks = (Array.isArray(c.tasks) ? c.tasks : []).map((t: Record<string, unknown>) => {
    const a = byId.get(Number(t?.adl_id)); if (!a || seen.has(a.id)) return null
    seen.add(a.id)
    const asNeeded = t.as_needed === true
    const days = ordered(t.days, DAYS); const use = days.length ? days : scheduleDays.length ? scheduleDays : [...DAYS]
    return { adl_id: a.id, name: a.name, key: a.adlKey || null, days: use.map((d) => AX_DAY[d]), require: asNeeded ? 2 : 1,
      when: asNeeded ? 0 : Math.max(0, WHEN.indexOf(pick(t.when, WHEN) as typeof WHEN[number])), instructions: clip(t.instructions, 300) }
  }).filter(Boolean) as Record<string, unknown>[]
  const narrative = para(c.narrative, 3000)
  const heard = Object.keys(fields).concat(narrative ? ['narrative'] : [], tasks.length ? ['axiscare_tasks'] : [])
  return { fields, narrative, axiscare_tasks: tasks, heard }
}

/** The answer held to the form's fixed choices. Phone always comes from GoHighLevel's contact, never from what was
 *  heard; a caller name or email heard on the call fills only a box GoHighLevel left empty. `heard` lists every box
 *  filled from the call (the Hub shows them yellow). */
export function toPrefill(a: Record<string, unknown>, ct: Contact, adls: Adl[] = [], callDay = ''): Prefill {
  const p: Record<string, unknown> = {
    first_name: ct.first_name || '', last_name: ct.last_name || '', phone: ct.phone || '', email: ct.email || '', source: 'Phone',
  }
  const heard: string[] = []
  const put = (k: string, v: unknown) => {
    const empty = v === '' || v == null || v === false || (Array.isArray(v) && !v.length)
    if (empty) return
    p[k] = v; heard.push(k)
  }
  if (!p.first_name) put('first_name', clip(a.caller_first_name, 40))
  if (!p.last_name) put('last_name', clip(a.caller_last_name, 40))
  if (!p.email) { const e = clip(a.email_heard, 120); if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e)) put('email', e.toLowerCase()) }
  put('relationship', clip(a.relationship, 40))
  put('client_first_name', clip(a.client_first_name, 40))
  put('client_last_name', clip(a.client_last_name, 40))
  put('client_dob', ymd(a.client_dob))
  put('client_gender', pick(a.client_gender, GENDER))
  put('client_address', clip(a.client_address, 120))
  put('client_city', clip(a.client_city, 60))
  const st = clip(a.client_state, 10).toUpperCase(); put('client_state', /^[A-Z]{2}$/.test(st) ? st : '')   /* "Missouri" was cut to "MI" (1058 test) */
  const zip = clip(a.client_zip, 10); put('client_zip', /^\d{5}(-\d{4})?$/.test(zip) ? zip : '')
  put('client_phone', clip(a.client_phone, 30))
  put('marital_status', pick(a.marital_status, MARITAL))
  put('language', clip(a.language, 40))
  const src = pick(a.source, SOURCE)
  if (src && src !== 'Phone') put('source', src)
  put('referral_source_name', clip(a.referral_source_name, 80))
  put('referral_subtype', pick(a.referral_subtype, SUBTYPE))
  const sk = pick(a.desired_start_kind, START), sd = ymd(a.desired_start_date)
  if (sk === 'by_date' && !sd) put('desired_start_kind', 'planning')
  else { put('desired_start_kind', sk); if (sk === 'by_date') put('desired_start_date', sd) }
  put('needs', pickMany(a.needs, NEEDS))
  put('weight_bearing', pick(a.weight_bearing, YESNO))
  put('level_estimate', pick(a.level_estimate, LEVEL))
  put('safety', pickMany(a.safety, SAFETY))
  put('mobility', pick(a.mobility, MOBILITY))
  put('personal_care', pickMany(a.personal_care, PERSONAL))
  put('medical_conditions', pickMany(a.medical_conditions, CONDS))
  put('dementia_follow_up', pickMany(a.dementia_follow_up, DEMENTIA))
  put('medical_notes', para(a.medical_notes, 1200))
  put('physician_name', clip(a.physician_name, 80))
  put('physician_phone', clip(a.physician_phone, 30))
  put('preferred_hospital', clip(a.preferred_hospital, 80))
  const days = ordered(a.schedule_days, DAYS)
  put('schedule_days', days)
  put('times_needed', clip(a.times_needed, 80))
  put('number_of_hours', num(a.number_of_hours, 168))
  put('funding_source', pick(a.funding_source, PAYER))
  const rate = clip(a.rate_quoted, 40)
  if (rate) { put('price_quoted', true); put('quoted_price_amount', rate) }
  put('why_called', clip(a.why_called, 140))
  /* the notes: the summary, then everything else heard that has no box of its own */
  const extra = [a.client_age ? 'Age: ' + clip(a.client_age, 10) + '.' : '', a.heard_about_us ? 'Heard about us: ' + clip(a.heard_about_us, 120) + '.' : '', para(a.other_details, 2000)].filter(Boolean).join(' ')
  put('interest_notes', [para(a.summary, 1500), extra ? 'Also said on the call: ' + extra : ''].filter(Boolean).join('\n\n'))
  return { prefill: p, heard, is_new_family: a.is_new_family !== false, not_new_family_reason: clip(a.not_new_family_reason, 120),
    medicaid_mentioned: a.medicaid_mentioned === true, care_plan: toPlan(a.care_plan, adls, days), profile: toProfile(a.home_life, a.people), call_note: toCallNote(a, callDay) }
}
