#!/usr/bin/env python3
# Desktop 281 · READ ONLY · who has an account on the Training Platform, and could anyone outside have signed up?
# Lists every account (created, last sign-in, sign-in method) and the sign-up settings. @mo-care.com addresses are
# shown in full; any other address is shown as its first letter and domain, flagged for Samantha to recognise.
import json, os, re, sys, urllib.request, urllib.error, datetime as dt
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REPORT = os.environ["SB_REPORT"]
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); TP = "rdqujxiycycwhskyvrwa"
lines = []
def say(s=""): s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", str(s)); print(s, flush=True); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
sys.excepthook = lambda t, e, tb: (say(f"✗ The check stopped unexpectedly ({t.__name__}). Nothing was changed."), done(8))
def http(method, url, body=None):
    req = urllib.request.Request(url, data=(json.dumps(body).encode() if body is not None else None), method=method,
                                 headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-training-accounts/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return r.status, json.loads(r.read().decode(errors="replace") or "null")
    except urllib.error.HTTPError as e: return e.code, None
    except Exception: return None, None
say("TRAINING PLATFORM · WHO HAS AN ACCOUNT · READ ONLY, nothing is changed")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
if not TOKEN.startswith("sbp_"): say("✗ That is not a Supabase access token (sbp_...). Nothing was read."); done(1)
s, cfg = http("GET", f"{API}/v1/projects/{TP}/config/auth")
if s != 200 or not isinstance(cfg, dict): say(f"✗ Could not read the sign-in settings (HTTP {s})."); done(2)
say(f"  Anyone can create an account: {'NO' if cfg.get('disable_signup') else 'YES'}")
say(f"  New accounts must confirm their email first: {'no (they are signed in straight away)' if cfg.get('mailer_autoconfirm') else 'yes'}")
say()
s, rows = http("POST", f"{API}/v1/projects/{TP}/database/query", {"query": """select email, created_at, last_sign_in_at, email_confirmed_at is not null as confirmed,
    coalesce(raw_app_meta_data->>'provider', '') as provider, invited_at is not null as invited from auth.users order by created_at"""})
if s not in (200, 201) or not isinstance(rows, list): say(f"✗ Could not read the accounts (HTTP {s})."); done(3)
d = lambda v: str(v or "")[:10] or "never"
staff = [r for r in rows if str(r.get("email") or "").lower().endswith("@mo-care.com")]
other = [r for r in rows if r not in staff]
say(f"  {len(rows)} account(s): {len(staff)} on @mo-care.com, {len(other)} other")
for r in staff: say(f"    ✓ {r['email']:<34} created {d(r['created_at'])}  last sign-in {d(r['last_sign_in_at'])}  {'invited' if r['invited'] else r['provider'] or ''}")
for r in other:
    e = str(r.get("email") or "(no email)"); m = (e[0] + "…@" + e.split("@", 1)[1]) if "@" in e else e
    say(f"    ? {m:<34} created {d(r['created_at'])}  last sign-in {d(r['last_sign_in_at'])}  {'confirmed' if r['confirmed'] else 'not confirmed'}  {'invited' if r['invited'] else r['provider'] or ''}")
say()
say("RESULT: " + ("no account outside @mo-care.com. " if not other else f"{len(other)} account(s) outside @mo-care.com: tell Claude whether you recognise each one. ")
    + "Turning off new sign-ups closes the door either way.")
done(0)
