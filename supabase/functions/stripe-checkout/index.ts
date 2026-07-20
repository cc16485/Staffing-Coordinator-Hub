// Supabase Edge Function: stripe-checkout
// -----------------------------------------------------------------------------
// Creates a Stripe Checkout Session for the HomeTogether subscription and
// returns the hosted checkout URL. The site's "Start free trial" button calls
// this and redirects the customer to Stripe's secure checkout page.
//
//   $149/mo  (plan: "standard")   |   $75/mo  (plan: "families")
//   30-day free trial on both. Promo codes allowed.
//
// The secret key lives ONLY here, server-side — it is never sent to the browser.
// Secret:   STRIPE_SECRET_KEY   (Samantha sets this in Supabase → Edge Functions → Secrets)
// Optional: STRIPE_SUCCESS_URL, STRIPE_CANCEL_URL (defaults below)
// Deploy:   supabase functions deploy stripe-checkout --no-verify-jwt --project-ref zngsgedlsxinbygwmxwn
// -----------------------------------------------------------------------------

const ALLOW = [
  "https://tryhometogether.com",
  "https://www.tryhometogether.com",
  "https://cc16485.github.io",
  "https://guide.mo-care.com",
  "http://localhost:8646",
];
const PLANS: Record<string, number> = { standard: 14900, families: 7500 }; // cents
const TRIAL_DAYS = 30;

function corsFor(origin: string) {
  const o = ALLOW.indexOf(origin) !== -1 ? origin : ALLOW[0];
  return { "Access-Control-Allow-Origin": o, "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin" };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const H = corsFor(origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: H });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...H, "content-type": "application/json" } });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const key = Deno.env.get("STRIPE_SECRET_KEY");
    if (!key) throw new Error("Stripe not configured (set STRIPE_SECRET_KEY in Supabase secrets)");

    const body = await req.json().catch(() => ({}));
    const plan = body.plan === "families" ? "families" : "standard";
    const amount = PLANS[plan];
    const success = Deno.env.get("STRIPE_SUCCESS_URL") || "https://tryhometogether.com/thank-you.html";
    const cancel = Deno.env.get("STRIPE_CANCEL_URL") || "https://tryhometogether.com/";

    // Stripe Checkout Session (subscription, inline price, free trial).
    const form = new URLSearchParams();
    form.set("mode", "subscription");
    form.set("line_items[0][quantity]", "1");
    form.set("line_items[0][price_data][currency]", "usd");
    form.set("line_items[0][price_data][unit_amount]", String(amount));
    form.set("line_items[0][price_data][recurring][interval]", "month");
    form.set("line_items[0][price_data][product_data][name]", "HomeTogether" + (plan === "families" ? " (Caring Companions families)" : ""));
    form.set("subscription_data[trial_period_days]", String(TRIAL_DAYS));
    form.set("allow_promotion_codes", "true");
    form.set("billing_address_collection", "auto");
    form.set("success_url", success + (success.indexOf("?") === -1 ? "?" : "&") + "session_id={CHECKOUT_SESSION_ID}");
    form.set("cancel_url", cancel);

    const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
    const d = await r.json();
    if (!r.ok) throw new Error((d && d.error && d.error.message) || ("Stripe " + r.status));
    return json({ url: d.url });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
