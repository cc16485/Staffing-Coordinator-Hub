// Supabase Edge Function: ai-draft-followup
// Caring Companions In-Home Senior Care — Care Coordinator's Hub
//
// =============================================================================
// WHAT THIS IS
// =============================================================================
// This is the real AI backend for two buttons in Care_Coordinator_Hub.html:
//   1. "🤖 Suggest with AI" (Lead modal → Follow-Up Routing) — mode: 'branch'
//   2. "🤖 Draft / Regenerate with AI" (Post-Call Follow-Up modal) — mode: 'draft'
// Both call the SAME function with a different `mode`, so there's only one
// thing to deploy and one secret to manage.
//
// It reads a lead's call notes (interest_notes) and other intake fields, asks
// Anthropic's Claude API to analyze them, and returns either a suggested
// follow-up branch + intent tags, or a drafted email + SMS follow-up — never
// both unless mode:'both' is requested. The AI's output is always a
// SUGGESTION: the coordinator reviews and explicitly saves it from the hub's
// UI. Nothing here sends an email or text — see "What this does NOT do" below.
//
// =============================================================================
// WHY THIS HAS TO BE AN EDGE FUNCTION, NOT BROWSER JS
// =============================================================================
// Care_Coordinator_Hub.html is a static page (GitHub Pages, no server of its
// own). Anthropic's API key is a real secret — anyone can open view-source on
// a static page, so the key can never be embedded in the page's JS. This
// function holds ANTHROPIC_API_KEY server-side (as a Supabase secret) and is
// the only thing that ever talks to Anthropic. The browser calls THIS
// function instead, authenticated with the coordinator's own Supabase login
// session — same pattern already used for axiscare-push-note in Staffing Hub.
//
// =============================================================================
// ⚠️ PHI / HIPAA NOTE — READ BEFORE DEPLOYING
// =============================================================================
// Call notes for a home-care lead can include health information (diagnoses,
// mobility, medications) — potentially PHI if Caring Companions is a HIPAA
// covered entity or business associate. Sending that text to a third-party AI
// API (Anthropic) means Anthropic is processing it. Before turning this on
// with real client data:
//   - Check whether a Business Associate Agreement (BAA) is required for your
//     situation, and whether Anthropic's API terms support one at your plan
//     tier (Anthropic does offer BAAs on qualifying plans — confirm current
//     terms directly with Anthropic, not from this comment).
//   - Consider whether call notes should be scrubbed of identifying detail
//     before sending, if a BAA isn't in place yet.
// This function does not add any special handling for this today — it sends
// the notes as typed. That's a business/compliance decision, not a coding
// one, so it's flagged here rather than silently assumed away.
//
// =============================================================================
// WHAT THIS DOES NOT DO
// =============================================================================
// - Does NOT send any email or SMS. It only drafts text. Sending is still a
//   fully manual, human step (see the hub's "Mark as Sent" button).
// - Does NOT write anything to the database itself. The browser receives the
//   suggestion and the coordinator decides whether to save it.
// - Does NOT auto-apply a branch to a lead. The coordinator sees the
//   suggestion in the form and clicks Save Lead themselves.
//
// =============================================================================
// DEPLOYMENT STEPS
// =============================================================================
// 1. Install the Supabase CLI if you don't have it: npm install -g supabase
// 2. From your project folder:
//      supabase functions new ai-draft-followup
//    Replace the generated index.ts with this file's contents (rename this
//    file to index.ts inside supabase/functions/ai-draft-followup/).
// 3. Get an Anthropic API key: https://console.anthropic.com/settings/keys
//    (Create Key → copy it — you won't be able to see it again.)
// 4. Set it as a secret on your Supabase project (never in the browser code):
//      supabase secrets set ANTHROPIC_API_KEY=sk-ant-your-key-here
// 5. Deploy:
//      supabase functions deploy ai-draft-followup
// 6. Test it's live (replace YOUR_ACCESS_TOKEN with a real signed-in
//    coordinator's session access_token, e.g. from the browser console after
//    signing into Care Coordinator's Hub: (await sb.auth.getSession()).data.session.access_token):
//      curl -X POST https://zngsgedlsxinbygwmxwn.supabase.co/functions/v1/ai-draft-followup \
//        -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
//        -H "Content-Type: application/json" \
//        -d '{"mode":"branch","lead":{"first_name":"Test","interest_notes":"Daughter called about mom, wants to think it over with her brother this week."}}'
//    A working response looks like:
//      {"branch":"family-decision","intent_tags":["family deciding","no urgency stated"],...}
//
// No other setup is needed — Care_Coordinator_Hub.html already calls this
// function's real URL (built from CONFIG.supabase_url) once it's deployed.
// Until you deploy it, the hub's AI buttons will show a clear "not deployed
// yet" error instead of failing silently.
//
// =============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Cheap + fast is the right default for structured drafting like this.
// Bump to 'claude-sonnet-5' if you want noticeably richer email copy and
// don't mind the higher per-call cost.
const AI_MODEL = 'claude-haiku-4-5-20251001';

const BRANCH_KEYS = ['call-back-next-week', 'family-decision', 'ready-to-start', 'cold-lead', 'soft-check-in'];

const BRANCH_GUIDE = `
- call-back-next-week: the contact asked to be called back at a specific future time/window, or gave a clear "not now, but later" timeline.
- family-decision: the decision involves other family members (spouse, siblings, adult children) who haven't weighed in yet, or the contact explicitly said they need to discuss it with someone.
- ready-to-start: strong, immediate intent — urgency is high (today/48 hours), and/or the contact used language like "let's move forward," "when can we start," asked about paperwork/next steps.
- cold-lead: contact expressed disinterest, said they chose a different agency, budget is a clear mismatch with no flexibility, or the conversation reads as a dead end.
- soft-check-in: none of the above clearly applies — general interest with no strong signal either way, or "just researching."
`.trim();

const RESPONSE_SCHEMA = {
  name: 'submit_followup_analysis',
  description: 'Submit the follow-up branch suggestion and/or drafted follow-up messages for a senior home care lead.',
  input_schema: {
    type: 'object',
    properties: {
      branch: { type: 'string', enum: BRANCH_KEYS, description: 'Best-fit follow-up branch for this lead, based on the call notes.' },
      confidence_note: { type: 'string', description: 'One short sentence explaining why this branch fits — shown to the coordinator, not saved.' },
      intent_tags: { type: 'array', items: { type: 'string' }, maxItems: 5, description: 'Up to 5 short phrases capturing key signals from the notes (e.g. "price sensitive", "ready this week", "comparing agencies").' },
      email_subject: { type: 'string', description: 'Warm, personal subject line for a follow-up recap email.' },
      email_body: { type: 'string', description: "Full follow-up email body in Caring Companions' warm, personal voice: recap what was discussed (client name/situation, care type, schedule, rate if known), mention the attached Service Guide if relevant, invite next steps (a complimentary in-home assessment), and sign off warmly. If no email address was collected on the call, gently ask for one instead." },
      sms_draft: { type: 'string', description: 'Short, warm SMS version (under 320 characters) recapping the call and next step.' },
      rate_discussed: { type: 'string', description: 'The hourly/daily rate mentioned in the notes, if any (e.g. "$28/hr"). Empty string if none was mentioned.' },
      email_collected_on_call: { type: 'boolean', description: 'True if the notes indicate an email address was already collected/known for this contact.' },
      attach_service_guide: { type: 'boolean', description: 'True if the email should reference/attach the Service Guide (usually true unless the lead is clearly cold).' },
      include_website: { type: 'boolean', description: 'True if the email should include the agency website link (usually true).' },
      needs_summary: { type: 'string', description: "2-3 plain sentences summarizing the client's likely care needs (who needs care, what kind, frequency/hours if inferable, key risks). Written for a coordinator scanning the lead profile. Empty string unless mode summary was requested." },
      care_flags: { type: 'array', items: { type: 'string' }, maxItems: 6, description: 'Short care-risk/need flags for the profile page, e.g. "Fall Risk", "Dementia", "Transfer Assist", "Lives Alone". Empty unless mode summary was requested.' },
    },
    required: ['branch', 'confidence_note', 'intent_tags', 'email_subject', 'email_body', 'sms_draft', 'rate_discussed', 'email_collected_on_call', 'attach_service_guide', 'include_website'],
  },
};

function fieldSummary(lead) {
  const client = lead.client_name_not_provided
    ? 'not provided yet'
    : [lead.client_first_name, lead.client_last_name].filter(Boolean).join(' ') || 'not provided yet';
  const lines = [
    `Contact: ${[lead.first_name, lead.last_name].filter(Boolean).join(' ') || '(unknown)'}${lead.relationship ? ' (' + lead.relationship + ')' : ''}`,
    `Client needing care: ${client}`,
    lead.urgency ? `Urgency: ${lead.urgency}` : null,
    Array.isArray(lead.needs) && lead.needs.length ? `Needs: ${lead.needs.join(', ')}` : null,
    Array.isArray(lead.medical_conditions) && lead.medical_conditions.length ? `Medical conditions mentioned: ${lead.medical_conditions.join(', ')}` : null,
    lead.mobility ? `Mobility: ${lead.mobility}` : null,
    lead.funding_source ? `Funding source: ${lead.funding_source}` : null,
    lead.price_quoted ? `Price quoted: ${lead.quoted_price_amount || '(amount not recorded)'}` : null,
    lead.days_needed ? `Days needed: ${lead.days_needed}` : null,
    lead.times_needed ? `Times needed: ${lead.times_needed}` : null,
    lead.number_of_hours ? `Hours/week: ${lead.number_of_hours}` : null,
    lead.email ? `Email on file: ${lead.email}` : 'No email on file yet.',
    lead.phone ? `Phone: ${lead.phone}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }

  try {
    // ---- 1. Authenticate the caller (their own Supabase session, not a service key) ----
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header.' }), { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const sb = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await sb.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Not signed in or session expired.' }), { status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }

    // Defense in depth — same grandfathering rule as the hub's client-side
    // hasHubAccess(): a missing hub_access claim means an account predates
    // the access-control system, so it's allowed rather than denied.
    const hubAccess = userData.user.app_metadata?.hub_access;
    if (Array.isArray(hubAccess) && !hubAccess.includes('care_coordinator')) {
      return new Response(JSON.stringify({ error: "You don't have Care Coordinator's Hub access." }), { status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }

    // ---- 2. Parse + validate input ----
    const body = await req.json().catch(() => null);
    if (!body || !body.lead) {
      return new Response(JSON.stringify({ error: 'Request must include a "lead" object.' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }
    const mode = ['branch', 'draft', 'both', 'summary'].includes(body.mode) ? body.mode : 'both';
    const lead = body.lead;
    if (!lead.interest_notes || !String(lead.interest_notes).trim()) {
      return new Response(JSON.stringify({ error: 'This lead has no call notes to analyze yet.' }), { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY is not set on this Supabase project. Run: supabase secrets set ANTHROPIC_API_KEY=...' }), { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }

    // ---- 3. Build the prompt ----
    const systemPrompt = `You are an assistant for Caring Companions In-Home Senior Care, helping a care coordinator handle post-call follow-ups with prospective clients (leads). You read raw call notes and produce two kinds of output depending on what's asked: (a) which of five follow-up branches best fits the lead, or (b) a warm, personal follow-up email + SMS draft. Your tone in drafted messages is warm, empathetic, and personal — never generic or salesy — matching a small family-owned home care agency, not a call center. Always call the submit_followup_analysis tool with your answer; never reply in plain text.

Follow-up branch definitions:
${BRANCH_GUIDE}`;

    const userPrompt = `Mode requested: ${mode}

Lead intake summary:
${fieldSummary(lead)}

Raw call notes (this is the primary thing to analyze):
"""
${lead.interest_notes}
"""

${mode === 'branch' ? 'Focus on branch, confidence_note, and intent_tags — you may leave draft fields minimal.' : ''}
${mode === 'draft' ? 'Focus on email_subject, email_body, sms_draft, rate_discussed, email_collected_on_call, attach_service_guide, include_website — you may give your best-guess branch too, but drafting is the priority.' : ''}
${mode === 'summary' ? 'Focus on needs_summary and care_flags for the lead profile page — fill the other required fields minimally (best-guess branch, empty-string drafts are fine).' : ''}
Sign follow-up emails/SMS as "Caring Companions" unless a specific coordinator name is given in the notes.`;

    // ---- 4. Call Anthropic, forcing structured tool-call output ----
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        tools: [RESPONSE_SCHEMA],
        tool_choice: { type: 'tool', name: 'submit_followup_analysis' },
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text().catch(() => '');
      console.error('Anthropic API error', aiRes.status, errText);
      return new Response(JSON.stringify({ error: 'AI service error (' + aiRes.status + '). Try again in a moment.' }), { status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }

    const aiJson = await aiRes.json();
    const toolUse = (aiJson.content || []).find((b) => b.type === 'tool_use' && b.name === 'submit_followup_analysis');
    if (!toolUse) {
      console.error('No tool_use block in Anthropic response', JSON.stringify(aiJson));
      return new Response(JSON.stringify({ error: 'AI did not return a structured answer. Try again.' }), { status: 502, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
    }

    // ---- 5. Return the suggestion to the browser — nothing is saved here ----
    return new Response(JSON.stringify(toolUse.input), { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('ai-draft-followup unexpected error', e);
    return new Response(JSON.stringify({ error: 'Unexpected server error.' }), { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });
  }
});
