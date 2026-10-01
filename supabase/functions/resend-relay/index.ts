import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { mayContact } from '../_shared/optout.ts'
import { reportSendProblem } from '../_shared/send-problems.ts'
// Shared-project mail relay: lets sibling projects (HomeTogether Hire) send
// via this project's verified Resend key. Only sends FROM our own verified domain addresses.
// Security slice 2026-09-27: it used to accept the public page-source token (in any page's code), which made it an
// open relay for any email to any address. It now accepts only the server-only RELAY_SECRET in the x-relay-secret
// header (the same value is a secret in the HomeTogether Hire project, for htl-founding-emails; never in code).
const RESEND = Deno.env.get("RESEND_API_KEY") ?? "";
const SECRET = Deno.env.get("RELAY_SECRET") ?? "";
const same = (a: string, b: string) => {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};
const ALLOWED_FROM = /@tryhometogether\.com>?$/;

Deno.serve(async (req) => {
  try {
    const b = await req.json().catch(() => ({}));
    if (SECRET.length < 32 || !same(req.headers.get("x-relay-secret") ?? "", SECRET))
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    const from = String(b.from ?? "HomeTogether <support@tryhometogether.com>");
    if (!ALLOWED_FROM.test(from.trim())) return new Response(JSON.stringify({ error: "from not allowed" }), { status: 400 });
    if (!b.to || !b.subject || !b.html) return new Response(JSON.stringify({ error: "to/subject/html required" }), { status: 400 });
    /* 0b-3: the universal opt-out check before anything is relayed (Resend, not GHL: the Hub's opt-out record and
       inquiry do-not-contact). A refusal is an answer, not an error: 200 with ok false. */
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    if (!(await mayContact(db, "resend-relay", { channel: "email", email: String(b.to), viaGhl: false })))
      return new Response(JSON.stringify({ ok: false, opted_out: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    /* NO SILENT FAILURES (2026-10-01): the relay is called by jobs (htl-founding-emails) with nobody watching, so a
       relay Resend refuses, or that could not be tried, raises a Needs Attention card ('resend-relay') AND still
       answers the caller with its error, exactly as before. */
    const lost = (why: string) => reportSendProblem(db, { sender: "resend-relay", channel: "email", address: String(b.to), reasons: [why], failed: true,
      note: "Subject: " + String(b.subject).slice(0, 120) });
    let r: Response;
    try {
      r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [String(b.to)], reply_to: b.reply_to ?? "support@tryhometogether.com", subject: String(b.subject), html: String(b.html) }),
      });
    } catch (e) {
      await lost("Resend could not be reached: " + String((e as Error)?.message ?? e).slice(0, 80));
      throw e;
    }
    const txt = await r.text().catch(() => "");
    if (!r.ok) {
      let m = ""; try { m = String(JSON.parse(txt)?.message ?? ""); } catch { m = txt; }
      await lost("Resend error " + r.status + (m ? ": " + m.slice(0, 100) : ""));
    }
    return new Response(JSON.stringify({ ok: r.ok, status: r.status, body: txt.slice(0, 200) }), { status: r.ok ? 200 : 502, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e).slice(0, 200) }), { status: 500 });
  }
});
