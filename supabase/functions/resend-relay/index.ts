import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { mayContact } from '../_shared/optout.ts'
// Shared-project mail relay: lets sibling projects (HomeTogether Hire) send
// via this project's verified Resend key. Token-gated with HT_ORDER_TOKEN.
// Only sends FROM our own verified domain addresses.
const RESEND = Deno.env.get("RESEND_API_KEY") ?? "";
const TOKEN = Deno.env.get("HT_SUPPORT_TOKEN") ?? Deno.env.get("HT_ORDER_TOKEN") ?? "";
const ALLOWED_FROM = /@tryhometogether\.com>?$/;

Deno.serve(async (req) => {
  try {
    const b = await req.json().catch(() => ({}));
    if (!TOKEN || b.token !== TOKEN) return new Response(JSON.stringify({ error: "bad token" }), { status: 401 });
    const from = String(b.from ?? "HomeTogether <support@tryhometogether.com>");
    if (!ALLOWED_FROM.test(from.trim())) return new Response(JSON.stringify({ error: "from not allowed" }), { status: 400 });
    if (!b.to || !b.subject || !b.html) return new Response(JSON.stringify({ error: "to/subject/html required" }), { status: 400 });
    /* 0b-3: the universal opt-out check before anything is relayed (Resend, not GHL: the Hub's opt-out record and
       inquiry do-not-contact). A refusal is an answer, not an error: 200 with ok false. */
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    if (!(await mayContact(db, "resend-relay", { channel: "email", email: String(b.to), viaGhl: false })))
      return new Response(JSON.stringify({ ok: false, opted_out: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [String(b.to)], reply_to: b.reply_to ?? "support@tryhometogether.com", subject: String(b.subject), html: String(b.html) }),
    });
    const txt = await r.text();
    return new Response(JSON.stringify({ ok: r.ok, status: r.status, body: txt.slice(0, 200) }), { status: r.ok ? 200 : 502, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e).slice(0, 200) }), { status: 500 });
  }
});
