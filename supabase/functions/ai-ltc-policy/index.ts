// Supabase Edge Function: ai-ltc-policy
// -----------------------------------------------------------------------------
// Reads a long-term care (LTC) insurance policy and returns a structured
// breakdown for a care coordinator. Powers the "Analyze policy" button on the
// Care Coordinator Hub's 🛡 LTC Policy tab.
//
// DEPLOY (from the hub repo, with the Supabase CLI):
//   supabase functions deploy ai-ltc-policy --project-ref rdqujxiycycwhskyvrwa
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   (once)
//
// The hub calls it with the coordinator's session token:
//   POST /functions/v1/ai-ltc-policy   { policy_text, client_name }
// and renders the JSON `fields` it returns.
// -----------------------------------------------------------------------------

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const MODEL = "claude-sonnet-5";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM = `You are a senior long-term care (LTC) insurance claims specialist at a home care agency. You read LTC policies and benefits summaries and explain them to care coordinators who are NOT insurance experts. Be accurate and conservative: if a value is not stated in the text, use "Not stated — confirm with carrier". Never invent numbers or coverage.`;

// Ask Claude to return exactly this shape so the hub can render it.
const SCHEMA_INSTRUCTIONS = `Return ONLY a JSON object (no markdown, no prose outside the JSON) with these keys:
{
  "carrier": string,
  "policy_number": string,
  "tax_qualified": string,
  "elimination_period": string,            // e.g. "90 calendar days, one-time"
  "daily_maximum": string,                 // "$" amount or "Not stated..."
  "monthly_maximum": string,
  "benefit_period": string,                // e.g. "3 years"
  "lifetime_maximum": string,              // total pool "$"
  "home_care_covered": string,             // does it cover home care from a licensed AGENCY?
  "benefit_triggers": string,              // ADLs count + cognitive
  "inflation_protection": string,
  "waiver_of_premium": string,
  "assignment_of_benefits": string,        // can benefits be paid directly to the agency?
  "exclusions": string[],                  // key exclusions/limits
  "summary": string,                       // 3-4 plain-English sentences on what it realistically pays for home care
  "red_flags": string[],                   // missing info the coordinator MUST confirm with the carrier
  "next_steps": string[]                   // exact steps to open the claim
}`;

async function analyze(policyText: string, clientName: string) {
  const userMsg =
    `${SCHEMA_INSTRUCTIONS}\n\n` +
    (clientName ? `Client: ${clientName}\n\n` : "") +
    `POLICY TEXT:\n<<<\n${policyText}\n>>>`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1800,
      system: SYSTEM,
      messages: [{ role: "user", content: userMsg }],
    }),
  });

  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`Anthropic ${resp.status}: ${detail.slice(0, 300)}`);
  }
  const data = await resp.json();
  const text: string = (data?.content?.[0]?.text ?? "").trim();

  // Pull the JSON object out of the reply (handles stray text just in case).
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON in model reply");
  return JSON.parse(text.slice(start, end + 1));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405,
      headers: { ...CORS, "content-type": "application/json" },
    });
  }
  try {
    if (!ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY not set");
    const body = await req.json().catch(() => ({}));
    const policyText = String(body.policy_text ?? "").trim();
    const clientName = String(body.client_name ?? "").trim();
    if (policyText.length < 40) throw new Error("policy_text too short");

    const fields = await analyze(policyText, clientName);
    return new Response(JSON.stringify({ fields }), {
      headers: { ...CORS, "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e?.message ?? e) }), {
      status: 500,
      headers: { ...CORS, "content-type": "application/json" },
    });
  }
});
