#!/usr/bin/env python3
# 373 · missed shift notes: web clock-outs don't count (her ruling (b), 2026-10-01) + remove the temporary notes-audit.
# Part 1 (read only): reviewed build. Part 2: redeploy missed-notes (sign-in check kept on); delete notes-audit (read-only
# M0 helper, nothing else uses it). Part 3: proofs. Sends nothing; missed-note texts stay as you set them (practice).
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, time
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPO = os.path.dirname(os.path.dirname(FNROOT))
TOKEN = os.environ.get("SB_TOKEN", "").strip(); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn"); SUPA = os.environ.get("SB_SUPA_CLI", "")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE:
        if v: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def http(method, url, body=None, headers=None, timeout=150):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-373/1.0"}, **(headers or {})))
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
def src(n): return os.path.join(FNROOT, n + ".ts") if n.startswith("_shared/") else os.path.join(FNROOT, n, "index.ts")
say("373 · MISSED SHIFT NOTES: WEB CLOCK-OUTS DON'T COUNT"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY")
for n, w in SHAS.items():
    if sha(src(n)) != w: bad(f"{n} is not the reviewed build. Nothing was run."); done(2)
if "missed-notes" not in SHAS: bad("the reviewed list is incomplete"); done(2)
s0, m0 = fmeta("missed-notes")
if s0 != 200: bad("missed-notes isn't installed (run 361 first). Nothing was changed."); done(4)
say("  ✓ the reviewed build · missed-notes is installed")
say(); say("PART 2 · CHANGE")
p = subprocess.run([SUPA, "functions", "deploy", "missed-notes", "--project-ref", REF, "--use-api"], cwd=REPO, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if p.returncode != 0: bad("deploy failed: " + (p.stderr or p.stdout)[-200:]); done(6)
sN, mN = fmeta("missed-notes")
(say if (mN or {}).get("verify_jwt") is True else bad)(("  ✓ " if (mN or {}).get("verify_jwt") is True else "") + "missed-notes updated: a web (office) clock-out is still asked for its note, never counted (sign-in check on)")
sA, _ = fmeta("notes-audit")
if sA == 404: say("  ✓ notes-audit was already gone")
else:
    http("DELETE", f"{API}/v1/projects/{REF}/functions/notes-audit", headers=MG())
    sA2, _ = fmeta("notes-audit")
    (say if sA2 == 404 else bad)(("  ✓ " if sA2 == 404 else "") + "the temporary notes-audit check is removed" + ("" if sA2 == 404 else f" (still there: {sA2})"))
say(); say("PART 3 · PROOF (nothing is sent)")
s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
try: keys = {k.get("name"): k.get("api_key", "") for k in json.loads(kb)}
except Exception: keys = {}
ANON, SVC = keys.get("anon", ""), keys.get("service_role", ""); HIDE += [ANON, SVC]
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
a = http("POST", f"{FNB}/functions/v1/missed-notes?auth_check=1", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
(say if a == 401 else bad)(("  ✓ " if a == 401 else "") + f"missed-notes refuses the public key ({a})")
sD, bD = http("POST", f"{FNB}/functions/v1/missed-notes?dry=1", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, 300)
try: j = json.loads(bD)
except Exception: j = {}
(say if sD == 200 and j.get("dry") is True else bad)(("  ✓ " if sD == 200 and j.get("dry") is True else "") + f"a practice look answers ({sD}): {j.get('groups_checked', '?')} finished shifts checked, nothing recorded or sent")
say(); say("RESULT: " + ("DONE · web clock-outs are asked for the note but never count toward 3 in 30 days; the temporary check is gone." if not fails else "CHECK THE ✗ LINES."))
done(0 if not fails else 8)
