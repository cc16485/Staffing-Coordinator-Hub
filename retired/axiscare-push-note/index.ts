// Supabase Edge Function: axiscare-push-note
// Called by the hub when a client's scheduling checklist is marked complete.
// Builds a formatted summary note and POSTs it to the AxisCare client profile.
//
// Environment variables (shared with axiscare-client-webhook):
//   AXISCARE_API_KEY  — AxisCare API token (axc_...)
//   AXISCARE_SITE     — AxisCare site number (e.g. 16485)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AXISCARE_API_KEY          = Deno.env.get("AXISCARE_API_KEY")!;
const AXISCARE_SITE             = Deno.env.get("AXISCARE_SITE")!;

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// "Jun 29, 2026 2:14 PM"
function fmtDT(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
    timeZone: "America/Chicago",  // Central Time — adjust if needed
  });
}

// AxisCare requires "YYYY-MM-DDTHH:mm:ss" (no timezone)
function toACDateTime(iso: string): string {
  const d = new Date(iso);
  // Convert to Central Time offset manually for accuracy
  const ct = new Date(d.toLocaleString("en-US", { timeZone: "America/Chicago" }));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${ct.getFullYear()}-${pad(ct.getMonth()+1)}-${pad(ct.getDate())}` +
         `T${pad(ct.getHours())}:${pad(ct.getMinutes())}:${pad(ct.getSeconds())}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const { client_queue_id } = await req.json();
    if (!client_queue_id) {
      return new Response(JSON.stringify({ error: "Missing client_queue_id" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // ── Fetch the completed client queue record ─────────────────────────
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: c, error } = await sb
      .from("client_queue")
      .select("*")
      .eq("id", client_queue_id)
      .single();

    if (error || !c) {
      console.error("client_queue fetch error:", error);
      return new Response(JSON.stringify({ error: "Client record not found" }),
        { status: 404, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    if (!c.axiscare_client_id) {
      return new Response(
        JSON.stringify({ error: "No AxisCare client ID on this record — note not pushed" }),
        { status: 422, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // ── Build the formatted note ────────────────────────────────────────
    const completedAt = fmtDT(c.completed_at || new Date().toISOString());

    const lines: string[] = [
      `Scheduling Complete — ${completedAt}`,
      ``,
      `Step 1: Caregiver Assigned in AxisCare`,
      `  Completed: ${fmtDT(c.caregiver_assigned_at)}`,
    ];
    if (c.caregiver_assigned_name) lines.push(`  Caregiver: ${c.caregiver_assigned_name}`);

    lines.push(
      ``,
      `Step 2: Caregiver Called & Briefed`,
      `  Completed: ${fmtDT(c.caregiver_called_at)}`,
    );
    if (c.caregiver_call_notes?.trim()) {
      lines.push(`  Notes: ${c.caregiver_call_notes.trim()}`);
    }

    lines.push(
      ``,
      `Step 3: Client Called & Schedule Confirmed`,
      `  Completed: ${fmtDT(c.client_called_at)}`,
    );
    if (c.client_call_notes?.trim()) {
      lines.push(`  Notes: ${c.client_call_notes.trim()}`);
    }

    lines.push(
      ``,
      `Step 4: Schedule Added to AxisCare`,
      `  Completed: ${fmtDT(c.schedule_added_at)}`,
    );

    if (c.completed_by) {
      lines.push(``, `Completed by: ${c.completed_by}`);
    }

    const noteText = lines.join("\n");
    const noteDT   = toACDateTime(c.completed_at || new Date().toISOString());

    console.log(`Pushing note to AxisCare client ${c.axiscare_client_id}:`, noteText);

    // ── POST note to AxisCare ───────────────────────────────────────────
    const acUrl = `https://${AXISCARE_SITE}.axiscare.com/api/notes/client/${c.axiscare_client_id}`;
    const acRes = await fetch(acUrl, {
      method: "POST",
      headers: {
        "Authorization":          `Bearer ${AXISCARE_API_KEY}`,
        "X-AxisCare-Api-Version": "2023-10-01",
        "Content-Type":           "application/json",
        "Accept":                 "application/json",
      },
      body: JSON.stringify({ note: noteText, dateTime: noteDT, important: false }),
    });

    const bodyText = await acRes.text();
    console.log(`AxisCare response ${acRes.status}:`, bodyText.substring(0, 300));

    if (!acRes.ok) {
      console.error("AxisCare notes API error:", acRes.status, bodyText);
      return new Response(
        JSON.stringify({ error: "AxisCare API error", status: acRes.status, detail: bodyText }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const result = JSON.parse(bodyText);
    const noteId = result.results?.id;
    console.log(`✅ Note created on AxisCare client ${c.axiscare_client_id}, note ID: ${noteId}`);

    // Store the AxisCare note ID back on the queue record for reference
    if (noteId) {
      await sb.from("client_queue").update({ axiscare_note_id: String(noteId) }).eq("id", client_queue_id);
    }

    return new Response(
      JSON.stringify({ success: true, note_id: noteId }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("Edge function error:", err);
    return new Response(JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
