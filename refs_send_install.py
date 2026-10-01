#!/usr/bin/env python3
# 377 · SEND A REFERENCE THE FORM (email now, or text after a recorded verbal OK). Samantha approved 2026-10-01 ("yes to all").
# Part 1 (read only): reviewed builds; GHL keys there. Part 2: refs_send.sql; deploy reference-send (sign-in check on).
# Part 3 (proof; nothing is sent): refuses the public key and the server key (staff only); the reference table isn't public.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, time, tempfile, shutil
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPO = os.path.dirname(os.path.dirname(FNROOT))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
POLL = float(os.environ.get("SB_POLL", "2")); POLL_MAX = float(os.environ.get("SB_POLL_MAX", "40"))
JOB = "reference-send"
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE:
        if v: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s); s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=150):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-377/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def lit(v): return "'" + str(v).replace("'", "''") + "'"
def fmeta(fn):
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
    try: return s, (json.loads(b) if s == 200 else None)
    except Exception: return s, None
def jget(b, k):
    try: return json.loads(b).get(k)
    except Exception: return None
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
def src_path(name):
    if name.startswith("_shared/"): return os.path.join(FNROOT, name + ".ts")
    if name.endswith((".sql", ".json")): return os.path.join(REPO, name)
    return os.path.join(FNROOT, name, "index.ts")

say("377 · SEND A REFERENCE THE FORM"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
for name, want in SHAS.items():
    if sha(src_path(name)) != want: bad(f"{name} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
if not {"reference-send", "_shared/outreach", "_shared/staff-auth", "refs_send.sql"} <= set(SHAS): bad("the reviewed list is incomplete"); done(2)
say("  ✓ the send step, the shared texting door, the staff check and the record are the reviewed builds")
s, b = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
try: names = {x.get("name") for x in json.loads(b)} if s == 200 else set()
except Exception: names = set()
if not {"GHL_TOKEN", "GHL_LOCATION_ID"} <= names: bad("the texting service keys aren't there. Nothing was changed."); done(4)
sR, _ = fmeta(JOB)
say(f"  ✓ the texting service keys are there · the send function is {'already there (an earlier run)' if sR == 200 else 'new'}")

say(); say("PART 2 · CHANGE")
ok, r = sql("begin;\n" + open(os.path.join(REPO, "refs_send.sql")).read() + "\ncommit;")
if not ok: bad("the database change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
say("  ✓ the reference record can hold the verbal OK to text and who sent the form")
p = subprocess.run([SUPA, "functions", "deploy", JOB, "--project-ref", REF, "--use-api"], cwd=REPO, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if p.returncode != 0: bad("deploy failed: " + (p.stderr or p.stdout)[-240:]); say("  STOP. Tell Claude."); done(6)
sN, mN = fmeta(JOB)
if (mN or {}).get("verify_jwt") is not True: bad(f"its sign-in check isn't on ({(mN or {}).get('verify_jwt')})")
else: say("  ✓ the send function deployed (sign-in check on)")

say(); say("PART 3 · PROOF (nothing is sent to anyone)")
s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
try: keys = {k.get("name"): k.get("api_key", "") for k in json.loads(kb)}
except Exception: keys = {}
ANON, SVC = keys.get("anon", ""), keys.get("service_role", ""); HIDE += [ANON, SVC]
URL = f"{FNB}/functions/v1/{JOB}"
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
probe = {"action": "email", "id": "00000000-0000-0000-0000-000000000000", "email": "proof@example.invalid"}
a1 = http("POST", URL, probe, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
(say if a1 in (401, 403) else bad)(("  ✓ " if a1 in (401, 403) else "") + f"it refuses the public key ({a1})")
a2 = http("POST", URL, probe, {"apikey": SVC, "Authorization": "Bearer " + SVC})[0]
(say if a2 in (401, 403) else bad)(("  ✓ " if a2 in (401, 403) else "") + f"it refuses anything that isn't a signed-in office staff member, even the server key ({a2})")
sC, bC = http("GET", f"{FNB}/rest/v1/reference_requests?select=id&limit=1", None, {"apikey": ANON, "Authorization": "Bearer " + ANON})
g = sC != 200 or bC.strip() in ("[]", "")
(say if g else bad)(("  ✓ " if g else "") + f"the public can't read the record ({sC})")
ok, c = sql("select count(*)::int as n from public.reference_requests where office_emailed_at > now() - interval '10 minutes' and ref_email = 'proof@example.invalid'")
g = ok and c and c[0]["n"] == 0
(say if g else bad)(("  ✓ " if g else "") + "nothing was sent or recorded by the proof")
say()
say("RESULT: " + ("DONE · the office can email a reference the form, or text it after recording their OK by phone (buttons arrive with the Hub update)." if not fails else "CHECK THE ✗ LINES."))
say("Rollback: Claude can delete the reference-send function; the new columns stay (they only hold what was sent).")
done(0 if not fails else 8)
