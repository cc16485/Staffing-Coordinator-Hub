// Supabase Edge Function: lead-docs-retention  (shared hub project)
// -----------------------------------------------------------------------------
// Auto-deletes visitor-uploaded LTC policy files (slot LTC_POLICY) from the
// `lead-docs` bucket once they're older than LTC_RETENTION_DAYS (default 90).
// This keeps sensitive documents from lingering. It ONLY touches LTC_POLICY-*
// files — EMOMED / FUSION / General docs that coordinators manage are left alone.
//
// Deploy:
//   supabase functions deploy lead-docs-retention --project-ref zngsgedlsxinbygwmxwn
//   supabase secrets set LTC_RETENTION_DAYS=90   (optional; default 90)
// Schedule daily (Supabase Dashboard → Edge Functions → this function → Cron,
//   or pg_cron). A daily 8am run is plenty.
//
// The upload path is `{leadId}/LTC_POLICY-{timestamp}-{filename}`, so the file's
// own name carries the upload time — no database read needed to judge age.
//
// SLICE 9 (Samantha "yes to all", 2026-10-11): PAUSED behind the Admin switch lead_docs_purge_live (ops_settings), OFF by
// default. Her rule: nothing is purged until the retention period is verified. While it is off, each run only LISTS the
// files it would delete (in the automation log, with the count and the first 50 paths) and deletes nothing.
// -----------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jobCaller } from "../_shared/job-auth.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  /* J1 (2026-09-29): only its daily schedule or the owner's server key. It used to run for any web request, with no
     key at all. Everyone else is refused before anything is listed or deleted. */
  const caller = await jobCaller(req);
  if (!caller) return json({ error: "not allowed" }, 401);
  if (new URL(req.url).searchParams.get("auth_check") === "1") return json({ ok: true, caller });
  const RETENTION_DAYS = Number(Deno.env.get("LTC_RETENTION_DAYS") ?? "90");
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Top level of the bucket = one folder per lead (named by lead id).
  const { data: folders, error } = await supabase.storage.from("lead-docs").list("", { limit: 2000 });
  if (error) return json({ error: error.message }, 500);

  /* SLICE 9: the switch. Anything other than an explicit true is practice (list only). */
  const { data: st } = await supabase.from("app_data").select("data").eq("key", "ops_settings").maybeSingle();
  const live = !!(st?.data && typeof st.data === "object" && (st.data as Record<string, unknown>).lead_docs_purge_live === true);
  const wouldDelete: string[] = [];

  let scanned = 0, deleted = 0;
  for (const folder of folders ?? []) {
    if (!folder.name) continue;
    const { data: files } = await supabase.storage.from("lead-docs").list(folder.name, { limit: 2000 });
    const toDelete: string[] = [];
    for (const file of files ?? []) {
      if (!file.name.startsWith("LTC_POLICY-")) continue; // only the visitor-uploaded policies
      scanned++;
      const ts = Number(file.name.split("-")[1]); // LTC_POLICY-{timestamp}-{name}
      if (Number.isFinite(ts) && ts < cutoff) toDelete.push(`${folder.name}/${file.name}`);
    }
    if (toDelete.length && !live) { wouldDelete.push(...toDelete); continue; }
    if (toDelete.length) {
      const { error: delErr } = await supabase.storage.from("lead-docs").remove(toDelete);
      if (!delErr) deleted += toDelete.length;
    }
  }

  const out = { ok: true, live, retention_days: RETENTION_DAYS, scanned, deleted, would_delete: wouldDelete.length, would_delete_paths: wouldDelete.slice(0, 50) };
  try {
    await supabase.rpc("upsert_app_data_item", { target_key: "automation_log", item: { id: "auto_srv_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      at: new Date().toISOString(), automation: "lead_docs_retention", ran_by: "server", ok: true, dry: !live,
      summary: { scanned, deleted, would_delete: wouldDelete.length, would_delete_paths: wouldDelete.slice(0, 50), retention_days: RETENTION_DAYS }, errors: 0, error: null } });
  } catch { /* the log must not take the run down */ }
  return json(out);
});
