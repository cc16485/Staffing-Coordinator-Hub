#!/usr/bin/env python3
# 504a · PAST FAMILIES: LOOK ONLY (Samantha 2026-10-08: past families as a referral source; text and/or email, each approved
# and sent by a person; she or Krystal picks who; once a year; never a deceased client's family). Deploys the temporary
# past-families-look function, runs it once and DELETES it again. It reads the Hub's past clients and AxisCare's contacts by
# client number only, and reports counts and yes/no flags, never a phone number or an email address. Nothing is written,
# texted or emailed.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, time
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}"))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); BASE = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
ROOT = os.path.dirname(os.path.dirname(FNROOT)); FN = "past-families-look"
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for h in HIDE:
        if h: s = s.replace(h, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def http(method, url, body=None, headers=None, timeout=120):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-504a/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
jl = lambda b: (lambda: json.loads(b))() if b and b[:1] in "[{" else {}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, b[:300]
    try: return True, json.loads(b)
    except Exception: return False, b[:300]
def fmeta():
    s = None
    for i in range(4):
        s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
        if s in (200, 404): return s
        time.sleep(3 * (i + 1))
    return s
def remove_fn():
    http("DELETE", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
    gone = fmeta() == 404
    say("  ✓ the temporary look function was deleted again (nothing stays live)") if gone else bad("the temporary look function could not be deleted; tell Claude (it answers only the server key)")
    return gone
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200])
    try: remove_fn()
    except Exception: pass
    say("  Tell Claude."); open(REPORT, "w").write("\n".join(lines) + "\n")
sys.excepthook = _crash
sha = lambda p_: hashlib.sha256(open(p_, "rb").read()).hexdigest()
names = lambda xs: ", ".join(f"{x['name']} ({x.get('label', '')})" for x in xs) or "none"


say("504a · PAST FAMILIES: LOOK ONLY"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"))
say("Nothing is written, texted or emailed. No phone number or email address appears here, only whether one exists."); say()
say("PART 1 · READ ONLY")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for name, want in SHAS.items():
    p_ = os.path.join(FNROOT, name); have = sha(p_) if os.path.exists(p_) else "(missing)"
    say(f"  ✓ {name} is the reviewed build") if have == want else bad(f"{name} is not the reviewed build: nothing runs")
if fails: say(); say("  RESULT: STOPPED before anything ran."); done(2)
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
st = fmeta()
if st == 200: say("  · a copy of the look function was left from an earlier run; it is replaced by this reviewed build and deleted after")
elif st != 404: bad(f"could not check for the look function ({st})"); done(2)
s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG()); k = jl(kb)
keys = {x.get("name"): x.get("api_key", "") for x in (k if isinstance(k, list) else []) if isinstance(x, dict)}
SVC = keys.get("service_role", ""); HIDE.append(SVC)
if not SVC: bad("the server key could not be read: nothing runs"); done(2)
say(); say("PART 2 · LOOK (the function reads the Hub and AxisCare, writes nothing)")
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api", "--no-verify-jwt"], cwd=ROOT, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if p.returncode != 0: bad("the look function did not deploy: " + (p.stderr or p.stdout)[-200:]); remove_fn(); done(5)
say("  ✓ the temporary look function is up (it answers only the server key)")
j = {}; s = None; b = ""
for i in range(3):
    s, b = http("GET", f"{BASE}/functions/v1/{FN}", headers={"Authorization": "Bearer " + SVC, "apikey": SVC}, timeout=400); j = jl(b)
    if s == 200 and j.get("mode") == "look": break
    if s in (401, 500): break
    time.sleep(5)
SVC = ""
remove_fn()
if not (s == 200 and j.get("mode") == "look"): bad(f"the look answered {s}: {str(j.get('error') or b)[:300]}"); say("  RESULT: STOPPED. Nothing was written."); done(6)
say(f"  · past clients in the Hub: {j['past_total']}")
say(f"      never: {j['deceased']} deceased (their families are never contacted)")
say(f"      not now: {j['ended_last_30_days']} ended in the last 30 days (this includes imported clients still showing 'on or before Oct 7, 2026' until their real end date is entered), {j['ended_over_3_years']} ended over 3 years ago" + (f", {j['no_end_date']} with no end date" if j.get('no_end_date') else ""))
say(f"  · eligible (ended 1 month to 3 years ago): {j['eligible']}")
say(f"      reachable: {j['reachable']} · by text (a mobile number): {j['by_text']} · by email: {j['by_email']} · nobody to reach: {j['unreachable']}")
if j.get("family_contact_only_self"): say(f"      {j['family_contact_only_self']} have no family listed in AxisCare, only the client's own number or email")
if j.get("axiscare_errors"): say(f"      ○ AxisCare still didn't answer for {j['axiscare_errors']} of them after waiting and retrying ({', '.join(f'{v}× {k}' for k, v in (j.get('axiscare_answers') or {}).items())}); they're listed as \"not checked\", not as unreachable")
say(); say(f"  THE ELIGIBLE PAST FAMILIES ({len(j['list'])}): client · care ended · who we could reach")
for x in j["list"]:
    how = []
    if x["family"]: how.append(f"{x['family']} family contact(s): {x['family_mobile']} mobile, {x['family_email']} email")
    if x["own_mobile"] or x["own_email"]: how.append("the client's own " + " and ".join(w for w, v in (("mobile", x["own_mobile"]), ("email", x["own_email"])) if v))
    say(f"      {x['name']} · {x['ended_at']} · " + ("not checked (AxisCare didn't answer)" if x.get("unknown") else "; ".join(how) if x["reachable"] else "nobody to reach"))
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say(f"RESULT: LOOK DONE · {j['reachable']} of {j['eligible']} eligible past families could be reached ({j['by_text']} by text, {j['by_email']} by email). Nothing was written, texted or emailed. Tell Claude \"ran 504a\".")
done(0)
