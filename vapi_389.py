#!/usr/bin/env python3
# 389 · BRING THE AI PHONE INTERVIEW (vapi-interview) UP TO GITHUB. 388 found the live copy is GitHub 75ae506 (2026-07-21).
# Since then: fail closed when VAPI_SECRET is unset (security, 2026-08-14), the scoring rubric is saved, "HT Hire"
# wording, and a failed alert email raises a "Didn't go through" card.
# Part 1 (read only): reviewed build; VAPI_SECRET must exist (or the new version would refuse every real call) and the
#   live copy must be exactly 75ae506's index.ts with every other file a GitHub version. Otherwise NOTHING changes.
# Part 2: deploy, keeping the gateway setting. Part 3 (proof; nothing is written): a call with no secret and one with a
#   wrong secret are both refused (401). Prints function names and yes/no only.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPO = os.path.dirname(os.path.dirname(FNROOT))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
FIRST = ["outreach-check", "interview-messages", "reference-chase", "send-candidate-message", "applicant-invite", "reference-send"]
lines = []; fails = []
def say(s=""):
    s = str(s); s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s); s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-vapi389/1.0"}, **(headers or {})))
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
def fmeta(fn):
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
    try: return s, (json.loads(b) if s == 200 else None)
    except Exception: return s, None
shab = lambda b: hashlib.sha256(b).hexdigest()
sha = lambda p: shab(open(p, "rb").read())
def git(*a): return subprocess.run(["git", *a], cwd=REPO, capture_output=True)

def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", open(path).read()):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
HIST = {}
def history(rel):  # every committed version of one file (sha256 of its bytes), so "known code" can be told from unknown
    if rel not in HIST:
        hs = set()
        for c in git("log", "--format=%H", "--", rel).stdout.decode().split():
            b = git("show", f"{c}:{rel}")
            if b.returncode == 0: hs.add(shab(b.stdout))
        if os.path.exists(os.path.join(REPO, rel)): hs.add(sha(os.path.join(REPO, rel)))
        HIST[rel] = hs
    return HIST[rel]

FN = "vapi-interview"; OLD = "75ae506"; FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
say("389 · THE AI PHONE INTERVIEW"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
for name in ("vapi-interview", "_shared/send-problems"):
    p = os.path.join(FNROOT, name + ".ts") if name.startswith("_shared/") else os.path.join(FNROOT, name, "index.ts")
    if sha(p) != SHAS.get(name): bad(f"{name} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
say("  ✓ the reviewed build")
s, b = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
try: names = {x.get("name") for x in json.loads(b)} if s == 200 else None
except Exception: names = None
if names is None: bad("couldn't read the secret names. Nothing was changed."); done(4)
if "VAPI_SECRET" not in names:
    bad("VAPI_SECRET is NOT saved on the Hub, so the new version would refuse every real interview call. Nothing was changed. Tell Claude."); done(4)
say("  ✓ the interview password (VAPI_SECRET) is saved, so real calls keep working")
sM, m = fmeta(FN); vj = (m or {}).get("verify_jwt")
if sM != 200 or not isinstance(vj, bool): bad("couldn't read the live function. Nothing was changed."); done(4)
tmp = tempfile.mkdtemp(prefix="vapi389-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
d = subprocess.run([SUPA, "functions", "download", FN, "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
live = {}
for root, _, files in os.walk(tmp):
    for f in files:
        lp = os.path.join(root, f).replace(os.sep, "/")
        if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
shutil.rmtree(tmp, ignore_errors=True)
mine = f"supabase/functions/{FN}/index.ts"; ob = git("show", f"{OLD}:{mine}")
if d.returncode != 0 or mine not in live: bad("couldn't read the live copy. Nothing was changed."); done(4)
if live[mine] == sha(os.path.join(REPO, mine)): say("  ✓ it is already GitHub's current version (nothing to do)"); done(0)
if ob.returncode != 0 or live[mine] != shab(ob.stdout): bad("the live copy is no longer the version 388 saw. Nothing was changed. Tell Claude."); done(4)
unknown = [k for k, h in live.items() if k != mine and h not in history(k)]
if unknown: bad("the live copy has code not in GitHub. Nothing was changed."); done(4)
say("  ✓ the live copy is exactly the July 21 version 388 found")

say(); say("PART 2 · CHANGE")
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api"] + ([] if vj else ["--no-verify-jwt"]),
                   cwd=REPO, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
sN, mN = fmeta(FN)
if p.returncode != 0: bad("it didn't deploy: " + (p.stderr or p.stdout)[-200:]); done(6)
if (mN or {}).get("verify_jwt") != vj:
    http("PATCH", f"{API}/v1/projects/{REF}/functions/{FN}", {"verify_jwt": vj}, MG()); sN, mN = fmeta(FN)
    if (mN or {}).get("verify_jwt") != vj: bad("its gateway setting changed and couldn't be put back. Tell Claude."); done(6)
say("  ✓ the AI phone interview is GitHub's current version (gateway setting kept)")

say(); say("PART 3 · PROOF (nothing is written)")
s_, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
try: keys = {k.get("name"): k.get("api_key", "") for k in json.loads(kb)}
except Exception: keys = {}
ANON = keys.get("anon", ""); H = {"Authorization": "Bearer " + ANON, "apikey": ANON} if ANON else {}
fake = {"message": {"type": "end-of-call-report", "call": {"customer": {"number": "+10000000000"}}}}
s1, _ = http("POST", f"{FNB}/functions/v1/{FN}?src=vapi", fake, H)
s2, _ = http("POST", f"{FNB}/functions/v1/{FN}?src=vapi", fake, dict(H, **{"x-vapi-secret": "wrong"}))
(say if s1 == 401 else bad)(("  ✓ " if s1 == 401 else "") + f"a call with no password is refused ({s1})")
(say if s2 == 401 else bad)(("  ✓ " if s2 == 401 else "") + f"a call with a wrong password is refused ({s2})")
say()
say("RESULT: " + ("PARTLY DONE · see the ✗ lines. Tell Claude." if fails else "DONE · the AI phone interview is up to date and fails closed."))
say("Rollback: Claude can redeploy the July 21 version (75ae506).")
done(1 if fails else 0)
