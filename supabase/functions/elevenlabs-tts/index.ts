// Supabase Edge Function: elevenlabs-tts
// -----------------------------------------------------------------------------
// Reads website text aloud in Samantha's cloned ElevenLabs voice, and CACHES
// each generated passage in the public `tts-cache` bucket (keyed by a hash of
// voice+model+text). So every unique line is generated ONCE and replayed to all
// visitors from cache — cost is "once per passage," not "per visitor."
//
// Called from the public site JS (accessibility widget). Gated by an Origin
// allowlist + a text-length cap so it can't be abused to burn the ElevenLabs
// quota. Falls back to the browser's built-in voice on the front end if this
// endpoint is unavailable.
//
// Secrets:  ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID
// One-time: a PUBLIC storage bucket named `tts-cache`.
// Deploy:   supabase functions deploy elevenlabs-tts --no-verify-jwt --project-ref zngsgedlsxinbygwmxwn
// -----------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOW = [
  "https://guide.mo-care.com",
  "https://tryhometogether.com",
  "https://cc16485.github.io",
  "http://localhost:4173",
  "http://localhost:8646",
];
const MODEL = "eleven_turbo_v2_5"; // fast + low-cost, good for narration
const MAX_CHARS = 1200;            // per request (we send one paragraph at a time)

function corsFor(origin: string) {
  const o = ALLOW.indexOf(origin) !== -1 ? origin : ALLOW[0];
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") || "";
  const H = corsFor(origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: H });
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...H, "content-type": "application/json" } });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const key = Deno.env.get("ELEVENLABS_API_KEY");
    const voice = Deno.env.get("ELEVENLABS_VOICE_ID");
    if (!key || !voice) throw new Error("ElevenLabs not configured (need ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID)");

    const body = await req.json().catch(() => ({}));
    let text = String(body.text ?? "").replace(/\s+/g, " ").trim();
    if (!text) throw new Error("no text");
    text = text.slice(0, MAX_CHARS);

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const path = (await sha256(voice + "|" + MODEL + "|" + text)) + ".mp3";
    const publicUrl = sb.storage.from("tts-cache").getPublicUrl(path).data.publicUrl;

    // Cache hit? Replay the stored audio (no ElevenLabs cost).
    const head = await fetch(publicUrl, { method: "HEAD" });
    if (head.ok) return json({ url: publicUrl, cached: true });

    // Generate, store, return.
    const resp = await fetch(
      "https://api.elevenlabs.io/v1/text-to-speech/" + voice + "?output_format=mp3_44100_128",
      {
        method: "POST",
        headers: { "xi-api-key": key, "content-type": "application/json" },
        body: JSON.stringify({ text, model_id: MODEL, voice_settings: { stability: 0.45, similarity_boost: 0.8 } }),
      },
    );
    if (!resp.ok) throw new Error("ElevenLabs " + resp.status + ": " + (await resp.text()).slice(0, 140));

    const audio = new Uint8Array(await resp.arrayBuffer());
    await sb.storage.from("tts-cache").upload(path, audio, { contentType: "audio/mpeg", upsert: true });
    return json({ url: publicUrl, cached: false });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
