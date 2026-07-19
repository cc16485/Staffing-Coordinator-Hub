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
// -----------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async () => {
  const RETENTION_DAYS = Number(Deno.env.get("LTC_RETENTION_DAYS") ?? "90");
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Top level of the bucket = one folder per lead (named by lead id).
  const { data: folders, error } = await supabase.storage.from("lead-docs").list("", { limit: 2000 });
  if (error) return json({ error: error.message }, 500);

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
    if (toDelete.length) {
      const { error: delErr } = await supabase.storage.from("lead-docs").remove(toDelete);
      if (!delErr) deleted += toDelete.length;
    }
  }

  return json({ ok: true, retention_days: RETENTION_DAYS, scanned, deleted });
});
