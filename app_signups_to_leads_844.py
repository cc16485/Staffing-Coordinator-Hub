#!/usr/bin/env python3
# 844 · MO-CARE.COM/APP SIGN-UPS INTO LEADS. Samantha 2026-10-16: "send mo-care.com/app sign-ups into the Leads Intake Desk
# tagged 'wants the app'".
#  1. Updates lead-intake (the door every mo-care.com care form uses) so an /app sign-up becomes a care lead tagged
#     "wants the app", with the usual acknowledgment and follow-up clock. Same public door, same token, as today.
#  2. Moves each EARLIER /app sign-up (sitting in the early-access list) into Leads once, tagged, with NO message sent.
# The website change (the form posting to lead-intake) goes live when its pull request is merged, after this step.
import json, os, re, subprocess, sys, time, hashlib, urllib.request, urllib.error
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); SUPA = os.environ.get("SB_SUPA_CLI", "")
REPO = os.environ["SB_REPO"]; PINS = json.loads(os.environ["SB_PINS"]); HUB = "zngsgedlsxinbygwmxwn"
lines = []; fails = []
def say(s=""):
    s = re.sub(r"(sbp_|eyJ|sb_secret_|cclead_)[A-Za-z0-9._\-]{6,}", "(hidden)", str(s)); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def ok(s): say("  ✓ " + s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def http(method, url, body=None, headers=None, timeout=120):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-844/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{HUB}/database/query", {"query": q}, {"Authorization": "Bearer " + TOKEN})
    try: out = json.loads(b)
    except Exception: out = None
    return (s in (200, 201)), (out if s in (200, 201) else f"HTTP {s}: {str(b)[:300]}"), s
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
say("844 · MO-CARE.COM/APP SIGN-UPS INTO LEADS"); say(time.strftime("%Y-%m-%d %H:%M")); say()
for rel, want in PINS.items():
    p = os.path.join(REPO, rel)
    if not os.path.exists(p) or sha(p) != want: bad(f"{rel} is not the reviewed build"); say("  STOP. Nothing was changed."); done(2)
good, rows, s = sql("select count(*)::int as n from public.early_interest where site = 'missouri' and kind = 'family' and 'app-early-access' = any(coalesce(interests, '{}'))"
                    " and (to_jsonb(early_interest)->>'lead_id') is null")
if s == 401: bad("Supabase didn't accept that access token"); say("  STOP. Nothing was changed."); done(2)
if not good: bad(f"couldn't read the early-access list ({rows})"); say("  STOP. Nothing was changed."); done(1)
waiting = int(rows[0]["n"]); say(f"  · earlier /app sign-ups not yet in Leads: {waiting}")
say(); say("1 · THE LEAD DOOR")
p = subprocess.run([SUPA, "functions", "deploy", "lead-intake", "--project-ref", HUB, "--use-api", "--no-verify-jwt"], cwd=REPO, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
s, b = http("GET", f"{API}/v1/projects/{HUB}/functions/lead-intake", headers={"Authorization": "Bearer " + TOKEN})
try: vj = json.loads(b).get("verify_jwt")
except Exception: vj = None
if p.returncode == 0 and s == 200 and vj is False: ok("lead-intake updated: an /app sign-up becomes a care lead tagged \"wants the app\" (the web form still needs no sign-in)")
else: bad(f"lead-intake didn't deploy cleanly ({(p.stderr or p.stdout)[-200:]} / verify_jwt {vj})"); say("  STOP before moving anyone."); done(1)
say(); say("2 · EARLIER /APP SIGN-UPS")
good, out, _ = sql(open(os.path.join(REPO, "app_signups_to_leads.sql")).read())
if not good: bad(f"the move was refused, nothing moved: {out}"); done(1)
good, rows, _ = sql("select count(*)::int as n from public.early_interest where lead_id is not null and site = 'missouri'")
moved = int(rows[0]["n"]) if good else -1
good2, rows2, _ = sql("select count(*)::int as n from public.app_data, jsonb_array_elements(data) l where key = 'leads' and l->'intent_tags' ? 'wants the app'")
tagged = int(rows2[0]["n"]) if good2 else -1
(ok if moved >= waiting and tagged >= moved else bad)(f"{waiting} earlier sign-up{'s' if waiting != 1 else ''} moved into Leads, tagged \"wants the app\" (no message sent); Leads now has {tagged} tagged")
say(); say("  844: " + ("DONE. Next: Claude merges the mo-care.com change so the /app form uses the lead door." if not fails else "NOT COMPLETE. See the ✗ lines above.")); done(0 if not fails else 1)
