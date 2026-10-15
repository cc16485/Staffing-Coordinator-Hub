// =============================================================================
// call-lead · what one call says, in the lead form's own fields (Make this a lead, 2026-10-14)
// =============================================================================
// Samantha 2026-10-14: "our number and phone transcripts need to be used to fill lead and have us easily mark call as
// a lead". Her decision on the mockup: the AI only TAGS likely new families; a person clicks "Make this a lead", the
// lead form opens filled from the call, everything heard on the call is yellow, and the person checks it and saves.
// This file is the pure part: the reading tool, the request, and the answer held to the form's fixed choices in code.
// Nothing here writes anything.
// =============================================================================
export const MODEL = 'claude-opus-5-5'

const NEEDS = ['personalCare', 'dementia', 'transportation', 'housekeeping', 'respite', 'overnight', 'va', 'privatePay'] as const
const SAFETY = ['fallRisk', 'livesAlone', 'recentHospitalization'] as const
const PERSONAL = ['bathing', 'dressing', 'toileting', 'transfers'] as const
const CONDS = ['dementia', 'alzheimers', 'parkinsons', 'stroke', 'diabetes', 'copd'] as const
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
const START = ['', 'asap', 'by_date', 'this_week', 'this_month', 'planning'] as const
const MOBILITY = ['', 'independent', 'walker', 'wheelchair', 'bedbound'] as const
const PAYER = ['', 'private', 'ltc', 'va', 'cds', 'medicaid'] as const
const SOURCE = ['Phone', 'Referral', 'Website', 'Other'] as const
const SUBTYPE = ['', 'hospital', 'snf_rehab', 'case_manager', 'community', 'apfm', 'other'] as const

const str = (description: string) => ({ type: 'string', description })
const one = (list: readonly string[], description: string) => ({ type: 'string', enum: [...list], description })
const many = (list: readonly string[], description: string) => ({ type: 'array', items: { type: 'string', enum: [...list] }, description })

export const TOOL = {
  name: 'fill_lead_form',
  description: 'Fill the Caring Companions new-lead form from one phone call. Use an empty string or an empty list for anything the call did not say. Never guess.',
  strict: true,
  input_schema: {
    type: 'object', additionalProperties: false,
    properties: {
      is_new_family: { type: 'boolean', description: 'True if someone is asking about home care for themselves or a loved one. False for a job applicant, caregiver, vendor, existing client, wrong number or spam.' },
      not_new_family_reason: str('If is_new_family is false, a few words why. Empty otherwise.'),
      caller_first_name: str('The caller\'s first name if they said it.'),
      caller_last_name: str('The caller\'s last name if they said it.'),
      email_heard: str('An email address the caller spelled out, exactly as heard.'),
      relationship: str('Who the caller is to the person needing care, one or two words, e.g. "Daughter", "Self", "Case manager".'),
      client_first_name: str('First name of the person who needs care.'),
      client_last_name: str('Last name of the person who needs care.'),
      client_city: str('Town where the person needing care lives.'),
      source: one(SOURCE, 'How this family reached us: Referral if a professional or organisation sent them, else Phone.'),
      referral_source_name: str('Name of the person or organisation who referred them, e.g. "Mercy discharge planner".'),
      referral_subtype: one(SUBTYPE, 'Kind of professional who referred them, if any.'),
      desired_start_kind: one(START, 'When they want care to start.'),
      desired_start_date: str('YYYY-MM-DD, only when desired_start_kind is by_date. Work it out from the call date given.'),
      needs: many(NEEDS, 'Kinds of help asked for. personalCare = bathing, dressing, toileting; housekeeping = meals, cleaning, laundry, errands at home.'),
      safety: many(SAFETY, 'Safety flags mentioned.'),
      mobility: one(MOBILITY, 'How they get around, if said.'),
      personal_care: many(PERSONAL, 'Hands-on help mentioned.'),
      medical_conditions: many(CONDS, 'Conditions mentioned that match this list.'),
      medical_notes: str('Other health details mentioned that the list does not cover, one short line.'),
      schedule_days: many(DAYS, 'Days of the week they want care.'),
      times_needed: str('Times of day they want care, e.g. "Mornings, 8 to 12".'),
      number_of_hours: str('Total hours a week as a number, e.g. "20". Empty if not said.'),
      funding_source: one(PAYER, 'How they plan to pay. ltc = long-term care insurance.'),
      why_called: str('Why they called, one line under 140 characters, e.g. "Daughter looking for morning help for her mom after a fall".'),
      summary: str('3 to 5 sentences for the coordinator: who called, who needs care, what they need, timeline, worries, and the next step agreed.'),
    },
    required: ['is_new_family', 'not_new_family_reason', 'caller_first_name', 'caller_last_name', 'email_heard', 'relationship', 'client_first_name',
      'client_last_name', 'client_city', 'source', 'referral_source_name', 'referral_subtype', 'desired_start_kind', 'desired_start_date', 'needs',
      'safety', 'mobility', 'personal_care', 'medical_conditions', 'medical_notes', 'schedule_days', 'times_needed', 'number_of_hours',
      'funding_source', 'why_called', 'summary'],
  },
}

const SYSTEM = `You read the transcript of one phone call to Caring Companions, a small family-owned home care agency in Springfield, Missouri, and fill in its new-lead form for a care coordinator to check before saving. Only write what the call actually said; leave everything else empty. Speakers are labelled by channel, not by name: work out who is the office and who is the caller from what they say. Always answer by calling the fill_lead_form tool, never in plain text.`

export type CallIn = { transcript: string; callDay: string; direction: string; knownName: string }

/** The Messages API request (server-side refusal fallback on, as for the other call reader). */
export function request(c: CallIn) {
  return {
    model: MODEL, max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    output_config: { effort: 'low' },
    system: SYSTEM, tools: [TOOL], tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: `Call date (Central time): ${c.callDay}. ${c.direction === 'outbound' ? 'We called them.' : 'They called us.'} The phone system's name for this contact: ${c.knownName || '(none)'}.\n\nFill the lead form with the fill_lead_form tool.\n\n<transcript>\n${c.transcript.slice(0, 60000)}\n</transcript>` }],
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
const pick = (v: unknown, list: readonly string[]) => (list.includes(String(v)) ? String(v) : '')
const pickMany = (v: unknown, list: readonly string[]) => Array.from(new Set((Array.isArray(v) ? v : []).map(String).filter((x) => list.includes(x))))
const ymd = (v: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !isNaN(Date.parse(String(v))) ? String(v) : ''

export type Contact = { first_name: string; last_name: string; phone: string; email: string }
export type Prefill = { prefill: Record<string, unknown>; heard: string[]; is_new_family: boolean; not_new_family_reason: string }

/** The answer held to the form's fixed choices. Phone always comes from GoHighLevel's contact, never from what was
 *  heard; a caller name or email heard on the call fills only a box GoHighLevel left empty. `heard` lists every box
 *  filled from the call (the Hub shows them yellow). */
export function toPrefill(a: Record<string, unknown>, ct: Contact): Prefill {
  const p: Record<string, unknown> = {
    first_name: ct.first_name || '', last_name: ct.last_name || '', phone: ct.phone || '', email: ct.email || '', source: 'Phone',
  }
  const heard: string[] = []
  const put = (k: string, v: unknown) => {
    const empty = v === '' || v == null || (Array.isArray(v) && !v.length)
    if (empty) return
    p[k] = v; heard.push(k)
  }
  if (!p.first_name) put('first_name', clip(a.caller_first_name, 40))
  if (!p.last_name) put('last_name', clip(a.caller_last_name, 40))
  if (!p.email) { const e = clip(a.email_heard, 120); if (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e)) put('email', e.toLowerCase()) }
  put('relationship', clip(a.relationship, 40))
  put('client_first_name', clip(a.client_first_name, 40))
  put('client_last_name', clip(a.client_last_name, 40))
  put('client_city', clip(a.client_city, 60))
  const src = pick(a.source, SOURCE)
  if (src && src !== 'Phone') put('source', src)
  put('referral_source_name', clip(a.referral_source_name, 80))
  put('referral_subtype', pick(a.referral_subtype, SUBTYPE))
  const sk = pick(a.desired_start_kind, START), sd = ymd(a.desired_start_date)
  if (sk === 'by_date' && !sd) put('desired_start_kind', 'planning')
  else { put('desired_start_kind', sk); if (sk === 'by_date') put('desired_start_date', sd) }
  put('needs', pickMany(a.needs, NEEDS))
  put('safety', pickMany(a.safety, SAFETY))
  put('mobility', pick(a.mobility, MOBILITY))
  put('personal_care', pickMany(a.personal_care, PERSONAL))
  put('medical_conditions', pickMany(a.medical_conditions, CONDS))
  put('medical_notes', clip(a.medical_notes, 300))
  put('schedule_days', DAYS.filter((d) => pickMany(a.schedule_days, DAYS).includes(d)))
  put('times_needed', clip(a.times_needed, 80))
  const hrs = String(a.number_of_hours ?? '').match(/\d+(\.\d+)?/)
  if (hrs && Number(hrs[0]) > 0 && Number(hrs[0]) <= 168) put('number_of_hours', hrs[0])
  put('funding_source', pick(a.funding_source, PAYER))
  put('why_called', clip(a.why_called, 140))
  put('interest_notes', clip(a.summary, 1200))
  return { prefill: p, heard, is_new_family: a.is_new_family !== false, not_new_family_reason: clip(a.not_new_family_reason, 120) }
}
