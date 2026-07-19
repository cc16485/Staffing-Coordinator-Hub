// Supabase Edge Function: ltc-policy-intake  (shared hub project)
// -----------------------------------------------------------------------------
// Public webhook for the website's "Free LTC policy review" form. It:
//   1. creates a lead in the CC Hub pipeline (like lead-intake), and
//   2. if the visitor attached their policy, stores the file in the `lead-docs`
//      bucket and attaches it to that lead (slot "LTC_POLICY"), so a coordinator
//      sees + opens it right on the lead's Documents card.
// The new lead's follow_up_due = today, so it surfaces in Today / the follow-up
// queue / the 7am digest — that's the coordinator alert.
//
// Deploy (no sign-in for public forms; gated by the ?token= in the URL):
//   supabase functions deploy ltc-policy-intake --no-verify-jwt --project-ref zngsgedlsxinbygwmxwn
// Reuses the existing LEAD_INTAKE_TOKEN secret. Bucket `lead-docs` must exist
// (same one the hub's lead documents already use).
// -----------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MAX_BYTES = 12 * 1024 * 1024; // 12 MB decoded

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);
  const expected = Deno.env.get("LEAD_INTAKE_TOKEN");
  if (!expected || url.searchParams.get("token") !== expected) return json({ error: "unauthorized" }, 401);

  // deno-lint-ignore no-explicit-any
  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { return json({ error: "expected JSON" }, 400); }

  const s = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 800) : "");
  const fullName = s(body.name);
  let first = s(body.first_name), last = s(body.last_name);
  if (!first && fullName) { const p = fullName.split(/\s+/); first = p[0]; last = p.slice(1).join(" "); }
  const phone = s(body.phone), email = s(body.email);
  if (!first && !phone && !email) return json({ error: "need a name, phone or email" }, 400);

  const notes = [
    "\u{1F4C4} LTC POLICY REVIEW requested via website.",
    s(body.carrier) ? "Carrier: " + s(body.carrier) : "",
    s(body.pay_pref) ? "Payment preference: " + s(body.pay_pref) : "",
    s(body.message) ? "Notes: " + s(body.message) : "",
  ].filter(Boolean).join("\n");

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  // deno-lint-ignore no-explicit-any
  const lead: Record<string, any> = {
    id: crypto.randomUUID(),
    first_name: first || "(website lead)",
    last_name: last,
    phone,
    email,
    source: "Website",
    status: "New",
    interest_notes: notes,
    follow_up_due: today,
    created_at: new Date().toISOString(),
  };

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Optional attached policy: { file: { name, type, data_base64 } }
  let uploaded = false;
  const file = body.file;
  if (file && typeof file.data_base64 === "string" && file.data_base64.length) {
    try {
      const raw = file.data_base64.includes(",") ? file.data_base64.split(",").pop()! : file.data_base64;
      const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
      if (bytes.byteLength > MAX_BYTES) return json({ error: "file too large (max 12 MB)" }, 413);
      const safe = s(file.name || "policy").replace(/[^a-zA-Z0-9._-]/g, "_") || "policy";
      const path = `${lead.id}/LTC_POLICY-${Date.now()}-${safe}`;
      const up = await supabase.storage.from("lead-docs").upload(path, bytes, {
        contentType: typeof file.type === "string" && file.type ? file.type : "application/octet-stream",
        upsert: false,
      });
      if (up.error) throw up.error;
      lead.docs = [{ slot: "LTC_POLICY", name: s(file.name || "policy"), path, size: bytes.byteLength, at: new Date().toISOString() }];
      uploaded = true;
    } catch (e) {
      // Don't lose the lead if the upload fails — record it in the notes instead.
      lead.interest_notes += `\n⚠ Policy upload failed (${String((e as Error)?.message ?? e)}); ask the family to email it.`;
    }
  }

  const { error } = await supabase.rpc("upsert_app_data_item", { target_key: "leads", item: lead });
  if (error) return json({ error: error.message }, 500);
  return json({ status: "lead created", id: lead.id, uploaded });
});
