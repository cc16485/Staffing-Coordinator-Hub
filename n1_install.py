#!/usr/bin/env python3
# N1 · CARE NOTES ON THE PROFILE (Desktop 334). Updates the read-only care-notes function so signed-in office staff
# can read one client's last 14 days of shift notes (the Hub's profile asks it; nothing is stored or sent).
# Part 1 (read only): the reviewed builds.  Part 2: deploy (gateway sign-in check ON).
# Part 3: the profile read refuses no key, the public key and the server key (it is for staff sign-ins only); the
#   owner's counts-only probe still answers. No note's words, name or number is printed.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, time
FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FN = "care-notes"
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=150):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-n1/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}

say("N1 · CARE NOTES ON THE PROFILE"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY")
for name, want in SHAS.items():
    p = os.path.join(FNROOT, "_shared", "job-auth.ts") if name == "_shared/job-auth" else os.path.join(FNROOT, name, "index.ts")
    if hashlib.sha256(open(p, "rb").read()).hexdigest() != want: bad(f"{name} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
say("  ✓ the function and the shared lock are the reviewed builds")
s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
try: keys = {k.get("name"): k.get("api_key", "") for k in json.loads(b)}
except Exception: keys = {}
ANON, SVC = keys.get("anon", ""), keys.get("service_role", "")
if not ANON or not SVC: bad("could not read the project's keys. Nothing was changed."); done(4)
HIDE += [ANON, SVC]
s, _ = http("GET", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
say("  · the care-notes function " + ("already exists (an earlier run); it will be updated" if s == 200 else "is new"))

say(); say("PART 2 · CHANGE")
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api"], cwd=os.path.dirname(os.path.dirname(FNROOT)),
                   env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if p.returncode != 0: bad("deploy failed: " + (p.stderr or p.stdout)[-240:]); done(6)
say("  ✓ care-notes deployed (read only; gateway sign-in check on)")

say(); say("PART 3 · CHECK (nothing is read into this report)")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
U = f"{FNB}/functions/v1/{FN}"
body = {"axiscare_client_id": "0"}
r0 = http("POST", U, body, {})[0]
r1 = http("POST", U, body, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
r2 = http("POST", U, body, {"apikey": SVC, "Authorization": "Bearer " + SVC})[0]
ok = r0 == 401 and r1 in (401, 403) and r2 in (401, 403)
(say if ok else bad)(("  ✓ " if ok else "") + f"a client's notes: no key {r0}, the public key {r1}, the server key {r2} → refused (only a signed-in office staff member gets them)")
s, b = http("POST", U + "?probe=1", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
try: j = json.loads(b)
except Exception: j = None
good = s == 200 and isinstance(j, dict) and (j.get("visits_read") or 0) > 0
(say if good else bad)(("  ✓ " if good else "") + f"the owner's counts-only probe still answers: {j.get('with_care_note') if isinstance(j, dict) else '?'} care notes on {j.get('visits_read') if isinstance(j, dict) else '?'} visits read (one per caregiver per Central-time day)")
say()
say("RESULT: " + ("DONE · merge the Hub change and each client's Care section shows From the shifts." if not fails else "CHECK THE ✗ LINES."))
say("No note's words, name or number was printed. Rollback: redeploy care-notes from the commit before this one.")
done(0 if not fails else 8)
