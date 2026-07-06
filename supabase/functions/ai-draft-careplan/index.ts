// Supabase Edge Function: ai-draft-careplan (shared hub project)
// Replaces the never-configured Zapier care-plan webhook: reads an in-home
// assessment transcript (pasted text) + visit facts and returns a DRAFT care
// plan (ADLs, IADLs, conditions, meds, safety, goals, services, frequency,
// hours) for the coordinator to review and edit in the plan form. Same auth
// as ai-draft-followup: the coordinator's own session token; ANTHROPIC_API_KEY
// stays server-side. Nothing is saved here — the browser gets a suggestion.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const jerr = (msg: string, status: number) =>
  new Response(JSON.stringify({ error: msg }), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })

const AI_MODEL = 'claude-haiku-4-5-20251001'

const SCHEMA = {
  name: 'submit_care_plan_draft',
  description: 'Submit the drafted in-home care plan fields extracted from the assessment transcript.',
  input_schema: {
    type: 'object',
    properties: {
      adl_needs: { type: 'string', description: 'ADL needs observed/discussed: bathing, dressing, toileting, transfers, mobility, eating. Plain sentences.' },
      iadl_needs: { type: 'string', description: 'IADL needs: meal prep, housekeeping, laundry, transportation, errands, medication reminders.' },
      medical_conditions: { type: 'string', description: 'Diagnoses/conditions mentioned (as stated — do not infer diagnoses not mentioned).' },
      medications: { type: 'string', description: 'Medications mentioned, with dosing details only if stated. Empty string if none discussed.' },
      safety_concerns: { type: 'string', description: 'Fall risks, home hazards, wandering, smoking, oxygen, pets underfoot, etc.' },
      client_goals: { type: 'string', description: "Client/family goals in their own spirit — what a good outcome looks like to them." },
      services_recommended: { type: 'string', description: 'Concrete services the agency should provide, mapped to the needs above.' },
      recommended_frequency: { type: 'string', description: 'e.g. "5x/week", "Mon/Wed/Fri", "daily mornings".' },
      recommended_hours_per_week: { type: 'number', description: 'Whole number of hours/week that fits the frequency and needs.' },
      confidence_note: { type: 'string', description: 'One sentence flagging anything uncertain or missing the coordinator should verify.' },
    },
    required: ['adl_needs','iadl_needs','medical_conditions','medications','safety_concerns','client_goals','services_recommended','recommended_frequency','recommended_hours_per_week','confidence_note'],
  },
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS })
  if (req.method !== 'POST') return jerr('Method not allowed', 405)
  try {
    const authHeader = req.headers.get('Authorization') || ''
    if (!authHeader.startsWith('Bearer ')) return jerr('Missing Authorization header.', 401)
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userErr } = await sb.auth.getUser()
    if (userErr || !userData?.user) return jerr('Not signed in or session expired.', 401)
    const hubAccess = userData.user.app_metadata?.hub_access
    if (Array.isArray(hubAccess) && !hubAccess.includes('care_coordinator')) {
      return jerr("You don't have Care Coordinator's Hub access.", 403)
    }

    const body = await req.json().catch(() => null)
    const transcript = body?.transcript_text ? String(body.transcript_text).trim() : ''
    if (!transcript) return jerr('Paste the assessment transcript text first — the AI needs something to read.', 400)
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) return jerr('ANTHROPIC_API_KEY is not set on this Supabase project.', 500)

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 1500,
        system:
          'You draft in-home senior care plans for Caring Companions (non-medical home care, Missouri). ' +
          'You read a raw in-home assessment transcript and extract a structured DRAFT care plan. ' +
          'Only state what the transcript supports — never invent diagnoses, medications, or family facts. ' +
          'The coordinator reviews and edits everything. Always call the submit_care_plan_draft tool; never reply in plain text.',
        messages: [{
          role: 'user',
          content:
            `Client: ${body.client_name || '(unknown)'}\n` +
            (body.visit_date ? `Visit date: ${body.visit_date}\n` : '') +
            `Assessment transcript:\n"""\n${transcript.slice(0, 24000)}\n"""`,
        }],
        tools: [SCHEMA],
        tool_choice: { type: 'tool', name: 'submit_care_plan_draft' },
      }),
    })
    if (!aiRes.ok) return jerr('AI service error (' + aiRes.status + '). Try again in a moment.', 502)
    const aiJson = await aiRes.json()
    // deno-lint-ignore no-explicit-any
    const toolUse = (aiJson.content || []).find((b: any) => b.type === 'tool_use' && b.name === 'submit_care_plan_draft')
    if (!toolUse) return jerr('AI did not return a structured draft. Try again.', 502)
    return new Response(JSON.stringify(toolUse.input), { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
  } catch {
    return jerr('Unexpected server error.', 500)
  }
})
