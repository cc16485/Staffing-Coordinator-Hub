#!/usr/bin/env python3
# Desktop 351 · EMAIL: mo-care.com proves its email, and Hub sign-in emails go out properly (E1 check + E2 + E3).
# Samantha approved 2026-09-29 ("yes to all": Resend with a send-only key, noreply@mo-care.com, she adds the DNS
# records in Cloudflare, DMARC watch-only for two weeks).
# Part 1 (read only): public DNS lookups (Cloudflare's resolver) confirm the records she added: SPF for Google, Google's
#   DKIM, DMARC in watch-only mode, and Resend's records (MX + SPF on send.mo-care.com, resend._domainkey). If any is
#   missing, it stops before changing anything and says which.
# Part 2: she pastes the Resend send-only key into the prompt (never printed or saved to disk). Supabase's sign-in
#   email setting is switched to Resend (smtp.resend.com, as "Caring Companions <noreply@mo-care.com>"), the hourly
#   limit goes 2 → 30, and the invitation and reset emails get her wording (email/invite.html, email/recovery.html).
# Part 3: read back the setting (the key itself is never read back); one test reset email to the address she types
#   (her own), which she confirms arrived and wasn't in spam.
import json, os, re, hashlib, urllib.request, urllib.error, urllib.parse, datetime as dt, sys, getpass
REPORT = os.environ["SB_REPORT"]; REPO = os.environ["SB_REPO"]; SHAS = json.loads(os.environ["SB_FILE_SHAS"])
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
DOH = os.environ.get("SB_DOH", "https://cloudflare-dns.com/dns-query"); DOMAIN = "mo-care.com"
ASK = os.environ.get("SB_ASK", "1") == "1"
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE:
        if v: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|re_)[A-Za-z0-9._\-]{6,}", "(hidden)", s)
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def http(method, url, body=None, headers=None, timeout=60):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-351/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def dns(name, typ):
    s, b = http("GET", f"{DOH}?name={urllib.parse.quote(name)}&type={typ}", headers={"Accept": "application/dns-json"})
    try: ans = json.loads(b).get("Answer", []) if s == 200 else []
    except Exception: ans = []
    want = {"TXT": 16, "MX": 15, "CNAME": 5}[typ]
    return [a.get("data", "").replace('" "', "").strip('"') for a in ans if a.get("type") == want]
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()

say("351 · EMAIL THAT GETS DELIVERED"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (the records you added, as the world sees them)")
for name, want in SHAS.items():
    if sha(os.path.join(REPO, name)) != want: bad(f"{name} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
root = dns(DOMAIN, "TXT"); spf = [t for t in root if t.lower().startswith("v=spf1")]
checks = [
    ("SPF: Google may send for mo-care.com", len(spf) == 1 and "include:_spf.google.com" in spf[0], "one TXT at mo-care.com starting v=spf1 and including _spf.google.com" + (f" (found {len(spf)})" if len(spf) != 1 else "")),
    ("DKIM: Google's signature", any(t.startswith("v=DKIM1") and "p=" in t for t in dns("google._domainkey." + DOMAIN, "TXT")), "the TXT from Google Admin at google._domainkey"),
    ("DMARC: watch-only, reports to you", any(t.startswith("v=DMARC1") and re.search(r"p=none", t) for t in dns("_dmarc." + DOMAIN, "TXT")), "TXT at _dmarc starting v=DMARC1; p=none"),
    ("Resend: DKIM", any("p=" in t for t in dns("resend._domainkey." + DOMAIN, "TXT")), "the resend._domainkey TXT from Resend"),
    ("Resend: bounce address (MX on send.mo-care.com)", any("amazonses.com" in m or "resend" in m for m in dns("send." + DOMAIN, "MX")), "the MX record on send from Resend"),
    ("Resend: SPF on send.mo-care.com", any(t.startswith("v=spf1") and "amazonses.com" in t for t in dns("send." + DOMAIN, "TXT")), "the TXT on send from Resend"),
]
missing = []
for label, ok, need in checks:
    (say if ok else bad)(("  ✓ " if ok else "") + label + ("" if ok else f": not found yet ({need})"))
    if not ok: missing.append(label)
if dns(DOMAIN, "MX") and not any("google" in m for m in dns(DOMAIN, "MX")): bad("mo-care.com's mail servers aren't Google any more (unexpected). Nothing was changed.")
if missing or fails:
    say(); say("RESULT: NOT YET · nothing was changed. Add the missing records in Cloudflare (DNS can take a few minutes to show), then run 351 again."); done(3)
s, b = http("GET", f"{API}/v1/projects/{REF}/config/auth", headers=MG())
try: cfg = json.loads(b) if s == 200 else None
except Exception: cfg = None
if not cfg: bad("could not read Supabase's sign-in email setting. Nothing was changed."); done(4)
say(f"  · Supabase sign-in emails now: {'our own mail server' if cfg.get('smtp_host') else 'the built-in sender'} · {cfg.get('rate_limit_email_sent')} an hour")

say(); say("PART 2 · CHANGE")
key = os.environ.get("SB_RESEND_KEY", "") or (getpass.getpass("  Paste the Resend send-only key (starts with re_), then Enter: ").strip() if ASK else "")
if not key.startswith("re_") or len(key) < 20: bad("That isn't a Resend key (they start with re_). Nothing was changed."); done(5)
HIDE.append(key)
invite = open(os.path.join(REPO, "email/invite.html")).read(); recovery = open(os.path.join(REPO, "email/recovery.html")).read()
patch = {"smtp_host": "smtp.resend.com", "smtp_port": "465", "smtp_user": "resend", "smtp_pass": key,
         "smtp_admin_email": "noreply@" + DOMAIN, "smtp_sender_name": "Caring Companions", "rate_limit_email_sent": 30,
         "mailer_subjects_invite": "You're invited to the Caring Companions Hub", "mailer_templates_invite_content": invite,
         "mailer_subjects_recovery": "Set a new password for the Caring Companions Hub", "mailer_templates_recovery_content": recovery}
s, b = http("PATCH", f"{API}/v1/projects/{REF}/config/auth", patch, MG())
if s not in (200, 201): bad(f"Supabase didn't take the setting (HTTP {s}). Nothing else was changed; sign-in emails still use the built-in sender."); done(6)
say("  ✓ sign-in emails now go through Resend as \"Caring Companions <noreply@mo-care.com>\" · up to 30 an hour · the invitation and reset emails in your words")

say(); say("PART 3 · PROOF")
s, b = http("GET", f"{API}/v1/projects/{REF}/config/auth", headers=MG())
try: c2 = json.loads(b) if s == 200 else {}
except Exception: c2 = {}
good = c2.get("smtp_host") == "smtp.resend.com" and str(c2.get("smtp_port")) == "465" and c2.get("smtp_admin_email") == "noreply@" + DOMAIN and c2.get("rate_limit_email_sent") == 30 \
    and "Caring Companions Hub" in str(c2.get("mailer_subjects_invite")) and "ConfirmationURL" in str(c2.get("mailer_templates_recovery_content"))
(say if good else bad)(("  ✓ " if good else "") + "read back: the new sender, the limit and both emails are in place (the key is never read back)")
to = os.environ.get("SB_TEST_EMAIL", "") or (input("  Type YOUR email address for one test reset email, then Enter: ").strip() if ASK else "")
if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[a-z]{2,}", to or "", re.I): bad("no test address given, so no test email was sent")
else:
    HIDE.append(to)
    k = {}
    s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
    try: k = {x.get("name"): x.get("api_key", "") for x in json.loads(kb)}
    except Exception: pass
    anon = k.get("anon", ""); HIDE.append(anon)
    s, _ = http("POST", f"{FNB}/auth/v1/recover", {"email": to}, {"apikey": anon})
    if s in (200, 204): say("  ✓ a test \"set a new password\" email was sent to the address you typed (not shown)")
    else: bad(f"the test email didn't go (HTTP {s}). Tell Claude; sign-in emails may need switching back.")
    if ASK and s in (200, 204):
        ans = input("  Check that inbox (and spam). Did it arrive, from Caring Companions, not in spam? Type yes or no, then Enter: ").strip().lower()
        (say if ans.startswith("y") else bad)(("  ✓ " if ans.startswith("y") else "") + ("you confirmed it arrived, not in spam" if ans.startswith("y") else "you said it didn't arrive properly. Tell Claude before sending any invitations."))
say()
say("RESULT: " + ("DONE · mo-care.com's email carries its proof, and Hub sign-in emails go out properly." if not fails else "CHECK THE ✗ LINES."))
say("No key or address was printed. Rollback: Supabase → Authentication → Emails → turn off custom SMTP (Claude can do it with a Desktop step).")
done(0 if not fails else 8)
