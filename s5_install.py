#!/usr/bin/env python3
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
FNS = ["ht-local", "cc-corner"]
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
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-s5/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=90) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
def meta(ref, fn):
    s, b = http("GET", f"{API}/v1/projects/{ref}/functions/{fn}", headers={"Authorization": "Bearer " + TOKEN})
    try: m = json.loads(b) if s == 200 else None
    except Exception: m = None
    return m if isinstance(m, dict) and isinstance(m.get("verify_jwt"), bool) else None

say("S5 · STAFF ACTIONS NEED A SIGN-IN"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY")
before = {}
for fn in FNS:
    got = hashlib.sha256(open(os.path.join(ROOT, "supabase", "functions", fn, "index.ts"), "rb").read()).hexdigest()
    if got != SHAS.get(fn): bad(f"{fn} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
    m = meta(REF, fn)
    if not m: bad(f"could not read {fn}. Nothing was changed."); done(4)
    before[fn] = m
say("  ✓ ht-local and cc-corner are the reviewed builds · gateway settings read and kept")
s1, hub = http("GET", HUB_PAGE + "?v=" + str(int(time.time())), headers={"Cache-Control": "no-cache"})
s2, hire = http("GET", HIRE_PAGE + "?v=" + str(int(time.time())), headers={"Cache-Control": "no-cache"})
hub_ok = s1 == 200 and "headers:await cmpAuthHeaders(),body:JSON.stringify({kind:'paylink'" in hub and "headers:await cmpAuthHeaders(),body:JSON.stringify({action:'notify'" in hub
hire_ok = s2 == 200 and "d.emailed" in hire
if not hub_ok: bad("the live Hub does not send your sign-in with these buttons yet (merge the Hub change and wait for it to go live). Nothing was changed."); done(3)
if not hire_ok: bad("the live hire page does not understand the new answer yet (merge the HomeTogether page change). Nothing was changed."); done(3)
say("  ✓ the live Hub sends your sign-in with the pay link, screen and Corner buttons · the live hire page understands the emailed answer")
pubtok = (re.findall(r"htorder_[A-Za-z0-9]+", hub) or [""])[0]
if pubtok: HIDE.append(pubtok)
s, b = http("GET", f"{API}/v1/projects/{REF}/secrets", headers={"Authorization": "Bearer " + TOKEN})
try: names = {x.get("name") for x in json.loads(b)} if s == 200 else set()
except Exception: names = set()
say("  · the screening company's check key (CHECKR_WEBHOOK_SECRET) is " + ("set" if "CHECKR_WEBHOOK_SECRET" in names else "NOT set: \"check cleared\" messages are accepted without proof they came from Checkr (see the note below)"))

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
if not pubtok: bad("the public page token was not found in the live Hub, so the door checks could not run")
else:
    made_up = "check-" + str(int(time.time()))
    HL = f"{base}/functions/v1/ht-local?token={pubtok}"; CC = f"{base}/functions/v1/cc-corner?token={pubtok}"
    for label, url, body, want in [
        ("emailing a pay link", HL, {"kind": "paylink", "caregiver_id": made_up}, 401),
        ("the \"a family wants you\" email", HL, {"kind": "paylink", "caregiver_id": made_up, "direct": True, "family_interested": True}, 401),
        ("the background screen", HL, {"kind": "oig", "caregiver_id": made_up}, 401),
        ("a Corner reply email", CC, {"action": "notify", "post_id": made_up, "reply_id": made_up}, 401),
        ("the caregiver's own Pay now (a made-up id: not found)", HL, {"kind": "paylink", "caregiver_id": made_up, "direct": True}, 404)]:
        s, _ = http("POST", url, body)
        ok = s == want
        (say if ok else bad)(("  ✓ " if ok else "") + f"with only the page token, {label}: {s}" + (" (refused before anything is looked up)" if want == 401 else " (the public door still answers)"))
    s, _ = http("GET", CC + "&action=feed")
    (say if s == 200 else bad)(("  ✓ " if s == 200 else "") + f"the public Caregivers Corner feed still loads ({s})")
say()
say("RESULT: " + ("DONE · the pay link email, the background screen and Corner reply emails need a signed-in office staff member; the public pages work as before." if not fails else "CHECK THE ✗ LINES."))
if "CHECKR_WEBHOOK_SECRET" not in names:
    say("NOTE: to close the last gap, a small Desktop step can ask you to paste the webhook signing secret from Checkr (Account Settings, Developer, Webhooks) and save it. Ask Claude for it; never paste the secret into chat.")
say("No token, name or address was printed. Rollback if ever needed: redeploy both functions from the commit before this one.")
done(0 if not fails else 7)
