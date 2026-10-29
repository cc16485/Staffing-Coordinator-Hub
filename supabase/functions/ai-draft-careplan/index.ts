// Supabase Edge Function: ai-draft-careplan (shared hub project)
// Replaces the never-configured Zapier care-plan webhook: reads an in-home
// assessment transcript (pasted text) + visit facts and returns a DRAFT care
// plan (ADLs, IADLs, conditions, meds, safety, goals, services, frequency,
// hours) for the coordinator to review and edit in the plan form. Same auth
// as ai-draft-followup: the coordinator's own session token; ANTHROPIC_API_KEY
// stays server-side. Nothing is saved here — the browser gets a suggestion.
// 2026-10-14 (her "start drafting... we will add to it after the home visit"): the draft the phone calls started
// (lead.care_plan_draft) comes in as `earlier`; the visit keeps what still holds, adds what it found and corrects what it
// contradicts. New field: narrative.
// 2026-10-29 Care plan Stage 1 (Samantha approved Stage 1 of "From Visit to First Shift"): mode 'visit'. Finishing the iPad
// home visit sends EVERY visit answer (path, label, value), the phone-call draft and the earlier plan; this reads the visit's
// recording parts that have consent and are written out (with the person's own sign-in, so the office-only rule applies), and
// the stronger model drafts the plan and each AxisCare task's six parts under _shared/careplan-draft.ts. Every line must name
// a source that checks out; anything else comes back empty and marked "Ask before approving". Still saves nothing.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { adlCatalog } from '../_shared/axiscare-adls.ts'
import { buildPrompt, cleanFacts, PLAN_FIELDS, scheduleDays, transcriptText, verify, type Part } from '../_shared/careplan-draft.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const jerr = (msg: string, status: number) =>
  new Response(JSON.stringify({ error: msg }), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })

const AI_MODEL = 'claude-haiku-4-5-20251001'
const VISIT_MODEL = Deno.env.get('CAREPLAN_VISIT_MODEL') || 'claude-opus-5-5'
const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })

/* mode 'visit': the draft from the whole home visit (Stage 1) */
// deno-lint-ignore no-explicit-any
async function fromVisit(sb: any, body: any, apiKey: string): Promise<Response> {
  const id = String(body.assessment_id || '').trim()
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) return jerr('which visit?', 400)
  const facts = cleanFacts(body.facts)
  if (facts.length < 3) return jerr('The visit has almost nothing filled in yet, so there is nothing to draft from.', 400)
  const call: Record<string, string> = {}
  for (const k of PLAN_FIELDS) { const v = String(body.call?.[k] ?? '').trim(); if (v) call[k] = v.slice(0, 2000) }
  const earlier = String(body.earlier || '').trim().slice(0, 12000)
  const { data: recs, error: rErr } = await sb.from('recordings').select('id, created_at, status, consent_given, turns, session_id, part, offset_seconds')
    .eq('kind', 'assessment').eq('subject_id', id).order('created_at')
  if (rErr) return jerr('Could not read the visit recording: ' + rErr.message, 500)
  // deno-lint-ignore no-explicit-any
  const all = (recs || []).slice().sort((x: any, y: any) => (String(x.session_id || x.id) === String(y.session_id || y.id) ? (x.part || 0) - (y.part || 0) : String(x.created_at).localeCompare(String(y.created_at))))
  // deno-lint-ignore no-explicit-any
  const usable = all.filter((r: any) => r.consent_given === true && r.status === 'done' && Array.isArray(r.turns) && r.turns.length)
  // deno-lint-ignore no-explicit-any
  const parts: Part[] = usable.map((r: any, i: number) => ({ rec: String(r.id), part: i + 1, offset: Number(r.offset_seconds) || 0, turns: r.turns }))
  const cat = await adlCatalog()
  if (cat.error || !cat.list.length) return jerr("Could not read AxisCare's task list (" + (cat.error || 'empty') + '). Nothing changed; try again.', 502)
  const days = scheduleDays(body.week)
  const prompt = buildPrompt({ client: String(body.client || '').slice(0, 60), facts, call, earlier, transcript: transcriptText(parts), adls: cat.list, days })
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: VISIT_MODEL, max_tokens: 16000, messages: [{ role: 'user', content: prompt }] }),
  }).catch((e) => ({ ok: false, status: 0, json: async () => ({ error: { message: String(e) } }) }) as unknown as Response)
  // deno-lint-ignore no-explicit-any
  const out: any = await r.json().catch(() => ({}))
  if (!r.ok) return jerr('The drafting service did not answer: ' + (out?.error?.message || r.status) + '. Nothing changed; try again.', 502)
  const raw = (out.content ?? []).map((c: { text?: string }) => c.text ?? '').join('')
  const m = raw.match(/\{[\s\S]*\}/)
  // deno-lint-ignore no-explicit-any
  let parsed: any = null
  try { parsed = m ? JSON.parse(m[0]) : null } catch { parsed = null }
  if (!parsed) return jerr('The draft came back in a form that could not be read. Nothing changed; try again.', 502)
  const v = verify(parsed, { paths: new Set(facts.map((f) => f.path)), call: new Set(Object.keys(call)), earlier: !!earlier, parts, adls: cat.list, days })
  // deno-lint-ignore no-explicit-any
  const waiting = all.filter((x: any) => x.consent_given === true && x.status !== 'done' && x.status !== 'failed').length
  return ok({ ok: true, mode: 'visit', model: VISIT_MODEL, at: new Date().toISOString(), ...v, parts: parts.map((p) => ({ rec: p.rec, part: p.part })), parts_waiting: waiting })
}

const SCHEMA = {
  name: 'submit_care_plan_draft',
  description: 'Submit the drafted in-home care plan fields extracted from the assessment transcript.',
  input_schema: {
    type: 'object',
    properties: {
      adl_needs: { type: 'string', description: 'ADL needs observed/discussed: bathing, dressing, toileting, transfers, mobility, eating. Plain sentences.' },
      iadl_needs: { type: 'string', description: 'IADL needs: meal prep, housekeeping, laundry, transportation, errands, medication reminders.' },
      medical_conditions: { type: 'string', description: 'Diagnoses/conditions mentioned (as stated; do not infer diagnoses not mentioned).' },
      medications: { type: 'string', description: 'Medications mentioned, with dosing details only if stated. Empty string if none discussed.' },
      safety_concerns: { type: 'string', description: 'Fall risks, home hazards, wandering, smoking, oxygen, pets underfoot, etc.' },
      client_goals: { type: 'string', description: "Client/family goals in their own spirit: what a good outcome looks like to them." },
      services_recommended: { type: 'string', description: 'Concrete services the agency should provide, mapped to the needs above.' },
      recommended_frequency: { type: 'string', description: 'e.g. "5x/week", "Mon/Wed/Fri", "daily mornings".' },
      recommended_hours_per_week: { type: 'number', description: 'Whole number of hours/week that fits the frequency and needs.' },
      narrative: { type: 'string', description: 'The care plan narrative in plain sentences, 1 to 3 short paragraphs: who the client is, their home and family, what they need help with and when, what matters to them, and what a caregiver should know on day one.' },
      confidence_note: { type: 'string', description: 'One sentence flagging anything uncertain or missing the coordinator should verify.' },
    },
    required: ['adl_needs','iadl_needs','medical_conditions','medications','safety_concerns','client_goals','services_recommended','recommended_frequency','recommended_hours_per_week','narrative','confidence_note'],
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
    if (!Array.isArray(hubAccess) || !hubAccess.includes('care_coordinator')) {   // 760b: no list = no hub
      return jerr("You don't have Care Coordinator's Hub access.", 403)
    }

    const body = await req.json().catch(() => null)
    if (body?.mode === 'visit') {
      const key = Deno.env.get('ANTHROPIC_API_KEY')
      if (!key) return jerr('ANTHROPIC_API_KEY is not set on this Supabase project.', 500)
      return await fromVisit(sb, body, key)
    }
    const transcript = body?.transcript_text ? String(body.transcript_text).trim() : ''
    if (!transcript) return jerr('Paste the assessment transcript text first. The AI needs something to read.', 400)
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!apiKey) return jerr('ANTHROPIC_API_KEY is not set on this Supabase project.', 500)

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 3000,
        system:
          'You draft in-home senior care plans for Caring Companions (non-medical home care, Missouri). ' +
          'You read a raw in-home assessment transcript and extract a structured DRAFT care plan. ' +
          'Only state what the transcript supports. Never invent diagnoses, medications, or family facts. ' +
          'The coordinator reviews and edits everything. Always call the submit_care_plan_draft tool; never reply in plain text.',
        messages: [{
          role: 'user',
          content:
            `Client: ${body.client_name || '(unknown)'}\n` +
            (body.visit_date ? `Visit date: ${body.visit_date}\n` : '') +
            (body.earlier && typeof body.earlier === 'object' ? `What the phone calls already told us (reported by the family, before the visit). Keep what the visit does not contradict, add what the visit found, correct what it contradicts:\n"""\n${JSON.stringify(body.earlier).slice(0, 8000)}\n"""\n` : '') +
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
