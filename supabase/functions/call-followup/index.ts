// Supabase Edge Function: call-followup  (shared hub project)
// -----------------------------------------------------------------------------
// The bridge that turns a completed GoHighLevel phone call into a ready-to-send
// follow-up, so no lead falls through the cracks.
//
// A GHL Workflow fires when a call ends and POSTs the transcript here (gated by
// ?token=CALL_FOLLOWUP_TOKEN). This function then:
//   1. Sends the transcript to Claude, which (a) decides if this is even a
//      prospective-CLIENT call, and if so (b) extracts the lead + care needs,
//      (c) writes a clean call summary, (d) picks the follow-up branch, and
//      (e) drafts a warm recap email + SMS in Caring Companions' voice.
//   2. If it's NOT a client lead (caregiver applicant, vendor, wrong number,
//      existing client...) it stops — nothing is created. This keeps AxisCare
//      and the pipeline clean.
//   3. Otherwise it creates/updates the lead in the CC Hub (app_data 'leads'),
//      stores the drafted recap for the coordinator to APPROVE (draft-first —
//      nothing is auto-sent here), and tags the GHL contact "lead" (which is
//      the signal the GHL->AxisCare sync watches for).
//
// Draft-first by design: this NEVER sends an email/SMS. The coordinator reviews
// and sends from the hub's Post-Call Follow-Up queue. Flip to auto later.
//
// Secrets (already on shared project zngsgedlsxinbygwmxwn): ANTHROPIC_API_KEY,
//   GHL_TOKEN, plus SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. New: CALL_FOLLOWUP_TOKEN.
// Deploy: supabase functions deploy call-followup --project-ref zngsgedlsxinbygwmxwn --no-verify-jwt
//
// PHI NOTE: call transcripts can contain health info about care recipients.
// Sending them to Anthropic means Anthropic processes that content — confirm a
// BAA / scrubbing posture before pointing this at live client calls.
// -----------------------------------------------------------------------------
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

const AI_MODEL = 'claude-haiku-4-5-20251001'
const BRANCH_KEYS = ['call-back-next-week', 'family-decision', 'ready-to-start', 'cold-lead', 'soft-check-in']
// Mirrors the hub's BRANCH_CONFIG wait windows; the coordinator can adjust.
const BRANCH_WAIT_DAYS: Record<string, number> = {
  'ready-to-start': 1, 'family-decision': 3, 'call-back-next-week': 7, 'soft-check-in': 5, 'cold-lead': 30,
}
const BRANCH_GUIDE = `
- call-back-next-week: caller asked to be reached at a specific future time, or gave a clear "not now, but later".
- family-decision: the decision involves other family members who haven't weighed in, or the caller said they must discuss it with someone.
- ready-to-start: strong immediate intent (today/48h), or language like "let's move forward", "when can we start", asked about paperwork/next steps.
- cold-lead: disinterest, chose another agency, clear budget mismatch, or a dead end.
- soft-check-in: none of the above clearly applies — general interest / just researching.
`.trim()

const TOOL = {
  name: 'submit_call_analysis',
  description: 'Analyze a prospective-client phone call for Caring Companions and return the extracted lead, follow-up branch, and drafted recap messages.',
  input_schema: {
    type: 'object',
    properties: {
      is_client_lead: { type: 'boolean', description: 'TRUE only if this call is a prospective CLIENT inquiring about home care for themselves or a loved one. FALSE for caregiver/job applicants, vendors, referral partners, existing clients, wrong numbers, robocalls/spam, or internal calls.' },
      not_lead_reason: { type: 'string', description: 'If is_client_lead is false, one short phrase why (e.g. "caregiver applicant", "wrong number"). Empty otherwise.' },
      contact_first_name: { type: 'string', description: 'Caller first name if stated on the call, else empty.' },
      contact_last_name: { type: 'string', description: 'Caller last name if stated, else empty.' },
      relationship: { type: 'string', description: 'Caller relationship to the care recipient, e.g. "daughter", "spouse", "self". Empty if unclear.' },
      client_first_name: { type: 'string', description: 'First name of the person needing care, if stated. Empty otherwise.' },
      email_found: { type: 'string', description: 'Email address if spoken/spelled on the call, else empty.' },
      phone_found: { type: 'string', description: 'Callback phone number if given on the call, else empty.' },
      needs: { type: 'array', items: { type: 'string' }, maxItems: 8, description: 'Care needs mentioned, e.g. "bathing", "meal prep", "companionship", "transportation".' },
      urgency: { type: 'string', description: 'Timeline/urgency in a few words, e.g. "starting next week", "exploring", "ASAP". Empty if unclear.' },
      medical_conditions: { type: 'array', items: { type: 'string' }, maxItems: 8, description: 'Conditions mentioned, e.g. "dementia", "post-surgery", "Parkinson\'s". Empty if none.' },
      mobility: { type: 'string', description: 'Mobility notes if mentioned, e.g. "uses a walker", "fall risk". Empty otherwise.' },
      funding_source: { type: 'string', description: 'How they plan to pay if mentioned, e.g. "private pay", "VA", "long-term care insurance", "Medicaid". Empty otherwise.' },
      rate_discussed: { type: 'string', description: 'Any rate quoted/discussed, e.g. "$30/hr". Empty if none.' },
      interest_notes: { type: 'string', description: 'A clean 3-6 sentence plain-language summary of the call for the coordinator: who called, who needs care, what they need, timeline, key concerns/objections, and the agreed next step.' },
      branch: { type: 'string', enum: BRANCH_KEYS, description: 'Best-fit follow-up branch based on the call.' },
      confidence_note: { type: 'string', description: 'One short sentence on why this branch fits.' },
      intent_tags: { type: 'array', items: { type: 'string' }, maxItems: 5, description: 'Up to 5 short signal phrases, e.g. "ready this week", "comparing agencies", "price sensitive".' },
      email_subject: { type: 'string', description: 'Warm, personal subject line for the recap email.' },
      email_body: { type: 'string', description: "Full recap email in Caring Companions' warm, personal, non-salesy voice: recap what was discussed (who needs care, care type, schedule, rate if known), invite the next step (a complimentary in-home assessment), sign off warmly as 'Caring Companions'. If no email was captured, gently ask for one." },
      sms_draft: { type: 'string', description: 'Short warm SMS (under 320 chars) recapping the call and next step.' },
      needs_summary: { type: 'string', description: "2-3 sentences summarizing the client's likely care needs for the profile page." },
      care_flags: { type: 'array', items: { type: 'string' }, maxItems: 6, description: 'Short care-risk flags, e.g. "Fall Risk", "Dementia", "Lives Alone".' },
    },
    required: ['is_client_lead', 'interest_notes', 'branch', 'email_subject', 'email_body', 'sms_draft', 'intent_tags'],
  },
}

function addDaysISO(days: number): string {
  const d = new Date(); d.setDate(d.getDate() + (days || 0))
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const url = new URL(req.url)
  if (url.searchParams.get('token') !== Deno.env.get('CALL_FOLLOWUP_TOKEN')) return json({ error: 'unauthorized' }, 401)

  // GHL's custom webhook may substitute the raw transcript into the JSON body
  // WITHOUT escaping quotes/newlines, which breaks JSON.parse. So parse
  // defensively: try JSON first, then fall back to pulling fields out of the raw
  // text. (The transcript must be the LAST field in the webhook body for this.)
  const raw = await req.text()
  // deno-lint-ignore no-explicit-any
  let b: Record<string, any> = {}
  try { b = JSON.parse(raw) } catch { b = {} }
  const field = (name: string): string => {
    if (b && typeof b[name] === 'string') return b[name].trim()
    const m = raw.match(new RegExp('"' + name + '"\\s*:\\s*"([\\s\\S]*?)"\\s*[},]'))
    return m ? m[1].trim() : ''
  }
  let transcript = typeof b.transcript === 'string' ? b.transcript.trim() : ''
  if (!transcript) {
    // Transcript is the LAST field; GHL substitutes it raw and UNQUOTED, so pull
    // everything from "transcript": to the final closing brace, then strip any
    // surrounding quotes/whitespace. Tolerates internal quotes and newlines.
    const tm = raw.match(/"transcript"\s*:\s*([\s\S]*)\}\s*$/)
    if (tm) transcript = tm[1].trim().replace(/^"/, '').replace(/"$/, '').trim()
  }
  if (!transcript) return json({ error: 'no transcript' }, 400)
  const contactId = field('contactId') || field('contact_id') || field('id')
  let inFirst = field('first_name') || field('firstName')
  let inLast = field('last_name') || field('lastName')
  const nameFull = field('name') || field('full_name')
  if (!inFirst && nameFull) { const p = nameFull.split(/\s+/); inFirst = p[0]; inLast = inLast || p.slice(1).join(' ') }
  const inEmail = field('email')
  const inPhone = field('phone') || field('phone_number')
  const direction = field('direction') || 'inbound'

  // Debug trail so we can tell "webhook never arrived" from "arrived but skipped".
  // Metadata only — no transcript text is logged (PHI-safe). Capped to 50 entries.
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const logDbg = async (entry: Record<string, unknown>) => {
    try {
      const { data } = await supabase.from('app_data').select('data').eq('key', 'call_followup_log').maybeSingle()
      // deno-lint-ignore no-explicit-any
      const arr: any[] = Array.isArray(data?.data) ? data!.data : []
      arr.push({ id: crypto.randomUUID(), at: new Date().toISOString(), ...entry })
      await supabase.from('app_data').upsert({ key: 'call_followup_log', data: arr.slice(-50), updated_at: new Date().toISOString() })
    } catch (_e) { /* logging must never block the pipeline */ }
  }
  await logDbg({ stage: 'received', contact_id: contactId, name: [inFirst, inLast].filter(Boolean).join(' '), phone_present: !!inPhone, email_present: !!inEmail, transcript_len: transcript.length, direction })

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY not set' }, 500)

  const system = `You are an assistant for Caring Companions In-Home Senior Care. You read the transcript of a phone call and produce a structured follow-up for a care coordinator. Drafted messages are warm, empathetic, personal — never generic or salesy — the voice of a small family-owned home care agency, not a call center. Always call the submit_call_analysis tool; never reply in plain text.

Follow-up branch definitions:
${BRANCH_GUIDE}`
  const user = `Known contact (from the phone system): ${[inFirst, inLast].filter(Boolean).join(' ') || '(unknown)'}${inPhone ? ' · ' + inPhone : ''}${inEmail ? ' · ' + inEmail : ''}. Call direction: ${direction}.

First decide is_client_lead. Only a prospective CLIENT inquiring about home care counts. If it is clearly a caregiver/job applicant, vendor, referral partner, existing client, wrong number, or robocall, set is_client_lead=false with a short not_lead_reason and you may leave other fields minimal.

Call transcript:
"""
${transcript.slice(0, 20000)}
"""

Sign follow-up messages as "Caring Companions" unless a specific coordinator name is clearly given in the call.`

  let out: Record<string, unknown>
  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: AI_MODEL, max_tokens: 2000, system,
        messages: [{ role: 'user', content: user }],
        tools: [TOOL], tool_choice: { type: 'tool', name: 'submit_call_analysis' },
      }),
    })
    if (!aiRes.ok) { console.error('anthropic', aiRes.status, await aiRes.text().catch(() => '')); return json({ error: 'ai error' }, 502) }
    const aiJson = await aiRes.json()
    // deno-lint-ignore no-explicit-any
    const tu = (aiJson.content || []).find((x: any) => x.type === 'tool_use' && x.name === 'submit_call_analysis')
    if (!tu) return json({ error: 'no structured answer' }, 502)
    out = tu.input
  } catch (e) { console.error('ai call failed', e); return json({ error: 'ai failed' }, 502) }

  await logDbg({ stage: 'analyzed', is_client_lead: out.is_client_lead === true, not_lead_reason: String(out.not_lead_reason || ''), branch: String(out.branch || '') })

  // Guardrail: only prospective CLIENT calls become leads.
  if (out.is_client_lead === false) {
    return json({ status: 'skipped', reason: 'not a client lead', detail: String(out.not_lead_reason || '') })
  }

  // Dedup: reuse an existing lead if this caller is already one (match phone/email).
  const email = (String(out.email_found || '') || inEmail).trim()
  const phone = (inPhone || String(out.phone_found || '')).trim()
  const { data: row } = await supabase.from('app_data').select('data').eq('key', 'leads').maybeSingle()
  // deno-lint-ignore no-explicit-any
  const leads: any[] = Array.isArray(row?.data) ? row!.data : []
  const norm = (p: string) => p.replace(/\D/g, '').slice(-10)
  const existing = leads.find((l) =>
    (email && l.email && l.email.toLowerCase() === email.toLowerCase()) ||
    (phone && l.phone && norm(l.phone) === norm(phone)))

  const branch = BRANCH_KEYS.includes(String(out.branch)) ? String(out.branch) : 'soft-check-in'
  const nowIso = new Date().toISOString()
  const lead = {
    ...(existing || {}),
    id: existing?.id || crypto.randomUUID(),
    first_name: existing?.first_name || String(out.contact_first_name || '') || inFirst || '(phone lead)',
    last_name: existing?.last_name || String(out.contact_last_name || '') || inLast,
    phone: phone || existing?.phone || '',
    email: email || existing?.email || '',
    relationship: String(out.relationship || '') || existing?.relationship || '',
    client_first_name: String(out.client_first_name || '') || existing?.client_first_name || '',
    source: existing?.source || 'Inbound Call',
    status: existing?.status && existing.status !== 'New' ? existing.status : 'New',
    interest_notes: String(out.interest_notes || ''),
    needs: Array.isArray(out.needs) ? out.needs : (existing?.needs || []),
    medical_conditions: Array.isArray(out.medical_conditions) ? out.medical_conditions : (existing?.medical_conditions || []),
    mobility: String(out.mobility || '') || existing?.mobility || '',
    urgency: String(out.urgency || '') || existing?.urgency || '',
    funding_source: String(out.funding_source || '') || existing?.funding_source || '',
    rate_discussed: String(out.rate_discussed || ''),
    follow_up_branch: branch,
    follow_up_due: addDaysISO(BRANCH_WAIT_DAYS[branch] ?? 3),
    intent_tags: Array.from(new Set([...(existing?.intent_tags || []), ...((out.intent_tags as string[]) || [])])),
    ai_needs_summary: String(out.needs_summary || ''),
    ai_care_flags: Array.isArray(out.care_flags) ? out.care_flags : [],
    ghl_contact_id: contactId || existing?.ghl_contact_id || '',
    // --- draft-first: the recap sits here for the coordinator to approve/send ---
    draft_email_subject: String(out.email_subject || ''),
    draft_email_body: String(out.email_body || ''),
    draft_sms: String(out.sms_draft || ''),
    awaiting_followup_review: true,
    call_transcript: transcript.slice(0, 20000),
    last_call_at: nowIso,
    created_at: existing?.created_at || nowIso,
    updated_at: nowIso,
  }

  const { error } = await supabase.rpc('upsert_app_data_item', { target_key: 'leads', item: lead })
  if (error) { console.error('lead upsert', error); return json({ error: error.message }, 500) }

  // Drop the drafted recap into the hub's existing Post-Call Follow-Ups queue as
  // "pending_approval" so the coordinator reviews + sends it (draft-first). Reuse
  // an open draft for this lead if one already exists (e.g. a second call).
  try {
    const { data: fRow } = await supabase.from('app_data').select('data').eq('key', 'post_call_followups').maybeSingle()
    // deno-lint-ignore no-explicit-any
    const fups: any[] = Array.isArray(fRow?.data) ? fRow!.data : []
    const openF = fups.find((f) => f.lead_id === lead.id && f.status === 'pending_approval')
    const followup = {
      id: openF?.id || crypto.randomUUID(),
      lead_id: lead.id,
      status: 'pending_approval',
      call_summary: String(out.interest_notes || ''),
      email_subject: String(out.email_subject || ''),
      email_body: String(out.email_body || ''),
      sms_draft: String(out.sms_draft || ''),
      rate_discussed: String(out.rate_discussed || ''),
      email_collected_on_call: !!email,
      attach_service_guide: branch !== 'cold-lead',
      include_website: true,
      ai_generated: true,
      created_at: openF?.created_at || nowIso,
    }
    await supabase.rpc('upsert_app_data_item', { target_key: 'post_call_followups', item: followup })
  } catch (e) { console.error('followup upsert', e) }

  // Tag the GHL contact "lead" — the signal the GHL->AxisCare sync watches.
  let tagged = false
  const ghlToken = Deno.env.get('GHL_TOKEN')
  if (contactId && ghlToken) {
    try {
      const r = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/tags`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ghlToken}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: ['lead'] }),
      })
      tagged = r.ok
      if (!r.ok) console.error('ghl tag', r.status, await r.text().catch(() => ''))
    } catch (e) { console.error('ghl tag failed', e) }
  }

  return json({ status: existing ? 'lead updated' : 'lead created', id: lead.id, branch, tagged, reused: !!existing })
})
