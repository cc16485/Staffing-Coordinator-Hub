#!/usr/bin/env python3
# N3 · TELL THE FAMILY FROM A FLAGGED SHIFT NOTE (Desktop 339). circle-send can now reach the specific Family Circle
# members a coordinator picks, only people with permission to discuss the client, with the coordinator's own words
# (recorded as a care-note message); care-notes adds a suggested one-line sentence for the family to each new flag.
# Nothing is ever sent without a person pressing Send in the Hub.
# (Adapted from the S5 installer.)
# S5 · STAFF ACTIONS NEED A SIGN-IN (Desktop 331). The public page token used to let anyone email a HomeTogether
# applicant a $45 link (even "a family would like to move forward with you"), run their background screen, change their
# status, learn whether an address applied, or send a Caregivers Corner reply email. Now those need a signed-in office
# staff member; the caregiver's own "Pay now" still opens checkout; typing an email emails the link to the address on
# file instead of showing it.
# Part 1 (read only): both functions are the reviewed builds; the live Hub and hire.html already send the sign-in /
#   understand the new answer (so nothing breaks); gateway settings read and kept; whether the Checkr check key is set.
# Part 2: deploy ht-local and cc-corner.
# Part 3 (sends nothing): the page token alone is refused for each staff action before any lookup; the public doors
#   still answer (a made-up caregiver id is "not found"; the Corner feed loads).
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, time
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); SUPA = os.environ.get("SB_SUPA_CLI", "")
FNB = os.environ.get("SB_FN_BASE", "")   # tests only: one base for both projects
SHAS = json.loads(os.environ["SB_FN_SHAS"])
P = os.environ.get("SB_PROJECTS_DIR", "/Users/samantha/Claude/Projects")
REF = os.environ.get("SB_REF_HUB", "zngsgedlsxinbygwmxwn"); ROOT = os.path.join(P, "Staffing-Coordinator-Hub")
FNS = ["circle-send", "care-notes"]
HUB_PAGE = os.environ.get("SB_HUB_PAGE", "https://cc.mo-care.com/index.html"); HIRE_PAGE = os.environ.get("SB_HIRE_PAGE", "https://tryhometogether.com/hire.html")
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE: s = s.replace(v, "(hidden)")
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-n3/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=90) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
def meta(ref, fn):
    s, b = http("GET", f"{API}/v1/projects/{ref}/functions/{fn}", headers={"Authorization": "Bearer " + TOKEN})
    try: m = json.loads(b) if s == 200 else None
    except Exception: m = None
    return m if isinstance(m, dict) and isinstance(m.get("verify_jwt"), bool) else None

say("N3 · TELL THE FAMILY FROM A FLAGGED SHIFT NOTE"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY")
before = {}
for fn in FNS:
    got = hashlib.sha256(open(os.path.join(ROOT, "supabase", "functions", fn, "index.ts"), "rb").read()).hexdigest()
    if got != SHAS.get(fn): bad(f"{fn} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
    m = meta(REF, fn)
    if not m: bad(f"could not read {fn}. Nothing was changed."); done(4)
    before[fn] = m
say("  ✓ circle-send and care-notes are the reviewed builds · gateway settings read and kept")
s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers={"Authorization": "Bearer " + TOKEN})
try: ANON = {k.get("name"): k.get("api_key", "") for k in json.loads(b)}.get("anon", "")
except Exception: ANON = ""
if ANON: HIDE.append(ANON)

say(); say("PART 2 · CHANGE")
for fn in FNS:
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if before[fn]["verify_jwt"] else ["--no-verify-jwt"]),
                       cwd=ROOT, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: bad(f"{fn} deploy failed: " + (p.stderr or p.stdout)[-240:]); say("  STOP. Functions above this line run the new code; the rest are unchanged."); done(6)
    say(f"  ✓ {fn} deployed")

say(); say("PART 3 · CHECK (sends nothing)")
time.sleep(float(os.environ.get("SB_SETTLE", "6")))
base = FNB or f"https://{REF}.supabase.co"
for fn in FNS:
    m = meta(REF, fn) or {}
    kept = m.get("verify_jwt") == before[fn]["verify_jwt"]
    newer = isinstance(m.get("version"), int) and isinstance(before[fn].get("version"), int) and m["version"] > before[fn]["version"]
    (say if kept and newer else bad)(("  ✓ " if kept and newer else "") + f"{fn}: gateway setting kept: {'yes' if kept else 'NO'} · now running version {m.get('version')} (was {before[fn].get('version')})")
body = {"circle_id": "0", "purpose": "care_note", "contact_ids": ["0"], "body": "check"}
r0 = http("POST", f"{base}/functions/v1/circle-send", body, {})[0]
r1 = http("POST", f"{base}/functions/v1/circle-send", body, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0] if ANON else None
ok = r0 == 401 and r1 in (401, 403)
(say if ok else bad)(("  ✓ " if ok else "") + f"telling family: no sign-in {r0}, the public key {r1} → refused before anything is read (only signed-in office staff)")
r2 = http("POST", f"{base}/functions/v1/care-notes?flag=1", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0] if ANON else None
(say if r2 == 401 else bad)(("  ✓ " if r2 == 401 else "") + f"the flagging run with the public key → refused ({r2}); its own schedule keeps running")
say()
say("RESULT: " + ("DONE · merge the Hub change and each flagged shift note gets Tell the family." if not fails else "CHECK THE ✗ LINES."))
say("Nothing was sent. Rollback if ever needed: redeploy both functions from the commit before this one.")
done(0 if not fails else 7)
