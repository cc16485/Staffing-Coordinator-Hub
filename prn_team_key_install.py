#!/usr/bin/env python3
# Desktop 359 · the PRN Team step recognises the owner's server key (Samantha asked 2026-09-29: "fix the PRN team server
# key check"). 356 found the key the Management API hands out didn't match the function's copy character for character,
# so the read-only AxisCare class check was refused. prn-team now recognises it the way the scheduled jobs do.
# Part 1 (read only): the reviewed build; the live prn-team is exactly GitHub (stops and keeps a copy otherwise).
# Part 2: deploy prn-team (sign-in check kept on). Part 3 (read only; nothing changes in AxisCare): the server key can ask
#   which classes exist and nothing else; the public key is refused; whether PRN Team and CNA exist in AxisCare yet.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, time, tempfile, shutil
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPO = os.path.dirname(os.path.dirname(FNROOT))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
KEEP = os.environ.get("SB_KEEP_DIR", os.path.expanduser("~/Claude/prn-team-live-copy")); FN = "prn-team"
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE:
        if v: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s); s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def http(method, url, body=None, headers=None, timeout=120):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
                                 headers=dict({"Content-Type": "application/json", "User-Agent": "cc-359/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def fmeta(fn):
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
    try: return s, (json.loads(b) if s == 200 else None)
    except Exception: return s, None
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
def src_path(n): return os.path.join(FNROOT, n + ".ts") if n.startswith("_shared/") else (os.path.join(REPO, n) if n.endswith(".json") else os.path.join(FNROOT, n, "index.ts"))

say(os.environ.get("SB_TITLE", "359 · THE PRN TEAM STEP RECOGNISES THE OWNER'S KEY")); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
for name, want in SHAS.items():
    if sha(src_path(name)) != want: bad(f"{name} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
if not {FN, "prn_team_key_accept.json"} <= set(SHAS): bad("the reviewed list is incomplete"); done(2)
s1, m1 = fmeta(FN)
if s1 != 200 or not isinstance((m1 or {}).get("verify_jwt"), bool): bad("could not read the PRN Team step's settings. Nothing was changed."); done(4)
ACC = json.load(open(os.path.join(REPO, "prn_team_key_accept.json")))[FN]["files"]
tmp = tempfile.mkdtemp(prefix="p359-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
d = subprocess.run([SUPA, "functions", "download", FN, "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if d.returncode != 0: bad("could not download the live PRN Team step to compare. Nothing was changed."); done(4)
diff, seen = [], set()
for root, _, files in os.walk(tmp):
    for f in files:
        if not f.endswith(".ts"): continue
        lp = os.path.join(root, f); tail = "/".join(os.path.relpath(lp, tmp).replace(os.sep, "/").split("/")[-2:])
        hits = [r for r in ACC if r.endswith(tail)]
        if len(hits) != 1: diff.append(tail + " (not expected)"); continue
        seen.add(hits[0])
        if sha(lp) not in (ACC[hits[0]]["base"], ACC[hits[0]]["deploy"]): diff.append(hits[0])
for r in ACC:
    if r not in seen and not r.endswith("job-auth.ts"): diff.append(r + " (not found live)")
if diff:
    shutil.rmtree(KEEP, ignore_errors=True); shutil.copytree(tmp, KEEP)
    bad("the live PRN Team step is NOT the version on GitHub (" + ", ".join(sorted(set(diff))) + f"). Nothing was changed; the live copy is kept at {KEEP} for Claude."); done(5)
shutil.rmtree(tmp, ignore_errors=True)
say(f"  ✓ the reviewed build · the live PRN Team step is exactly GitHub's · sign-in check {'on' if m1['verify_jwt'] else 'off'} (kept)")

say(); say("PART 2 · CHANGE")
VJ = m1["verify_jwt"]
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api"] + ([] if VJ else ["--no-verify-jwt"]), cwd=REPO, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if p.returncode != 0: bad("deploy failed: " + (p.stderr or p.stdout)[-240:]); done(6)
s2, m2 = fmeta(FN)
if (m2 or {}).get("verify_jwt") != VJ: bad(f"its sign-in check isn't as intended ({(m2 or {}).get('verify_jwt')})")
say(f"  ✓ the PRN Team step deployed, now version {(m2 or {}).get('version')} (was {m1.get('version')}), sign-in check kept")

say(); say("PART 3 · PROOF (read only; nothing changes in AxisCare)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
try: keys = {k.get("name"): k.get("api_key", "") for k in json.loads(kb)}
except Exception: keys = {}
ANON, SVC = keys.get("anon", ""), keys.get("service_role", ""); HIDE += [ANON, SVC]
U = f"{FNB}/functions/v1/{FN}"
n1 = http("POST", U, {"action": "list"}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
n2 = http("POST", U, {"action": "move", "applicant_id": "00000000-0000-0000-0000-000000000000", "to": "ongoing"}, {"apikey": SVC, "Authorization": "Bearer " + SVC})[0]
g = n1 == 401 and n2 == 403
(say if g else bad)(("  ✓ " if g else "") + f"the public key is refused ({n1}); the server key may not move anyone ({n2})")
sV, bV = http("POST", U, {"action": "vocab"}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
try: jv = json.loads(bV)
except Exception: jv = {}
if sV == 200 and not jv.get("error"):
    say("  ✓ the server key can now ask the read-only question")
    say(f"  · AxisCare: PRN Team class {'✓ ' + str(jv.get('prn')) if jv.get('prn') else 'NOT there yet'} · CNA class {'✓ ' + str(jv.get('cna')) if jv.get('cna') else 'NOT there yet'}")
    if jv.get("why"): say("    " + "; ".join(jv["why"]) + ". Create them in AxisCare (Settings, Classes) before the office uses \"Mark as PRN Team in AxisCare\".")
elif sV == 200: say(f"  · the server key got in, but AxisCare's class list couldn't be read: {str(jv.get('error'))[:160]}")
else: bad(f"the server key still can't ask ({sV})")
say()
say("RESULT: " + (os.environ.get("SB_DONE", "DONE · the PRN Team step recognises the owner's key for its one read-only question.") if not fails else "CHECK THE ✗ LINES."))
say("Rollback: redeploy prn-team from the commit before this one (Claude can).")
done(0 if not fails else 8)
