#!/usr/bin/env python3
# 489 · NO DAY 1 / DAY 3 NUDGES (Samantha 2026-10-07: "i dont like the day 1 and day 3 nudge, in home care every situation is so different").
#  · deploys lead-followup without the two timed "is there a good time to call?" texts. The acknowledgment retry is unchanged.
#  · nothing else is deployed; no setting changes; the acknowledgment switch is not touched. Nothing is texted or emailed by this script.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}"))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); NODE = os.environ.get("SB_NODE", "node")
ROOT = os.path.dirname(os.path.dirname(FNROOT)); FN = "lead-followup"
lines = []; fails = []
def say(s=""):
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", str(s)); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=400):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-489/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, b[:200]
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def fmeta(fn):
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
    try: return s, (json.loads(b) if s == 200 else None)
    except Exception: return s, None
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)
sha = lambda p_: hashlib.sha256(open(p_, "rb").read()).hexdigest()
lit = lambda v: "'" + str(v).replace("'", "''") + "'"
def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", open(path).read()):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
def need(fn):
    s = set(); deps(os.path.join(FNROOT, fn, "index.ts"), s)
    return {os.path.relpath(x, ROOT).replace(os.sep, "/") for x in s}
def live_files(fn):
    tmp = tempfile.mkdtemp(prefix="cc489-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
    d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    live = {}
    for r, _, files in os.walk(tmp):
        for f in files:
            lp = os.path.join(r, f).replace(os.sep, "/")
            if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
    shutil.rmtree(tmp, ignore_errors=True)
    return d.returncode == 0, live
def blob(k):
    ok, r = sql(f"select data from public.app_data where key = {lit(k)}")
    d = r[0]["data"] if ok and r else None
    return json.loads(d) if isinstance(d, str) else d

say("489 · NO DAY 1 / DAY 3 NUDGES TO FAMILIES (lead-followup without them)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for name, want in SHAS.items():
    p_ = os.path.join(FNROOT, "_shared", name.split("/", 1)[1]) if name.startswith("_shared/") else os.path.join(FNROOT, name, "index.ts")
    have = sha(p_) if os.path.exists(p_) else "(missing)"
    chk(have == want, f"{name} is the reviewed build" if have == want else f"{name} is not the reviewed build: nothing runs")
if fails: say(); say("  RESULT: STOPPED before anything changed."); done(2)
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); say("  RESULT: STOPPED before anything changed."); done(2)
lf = open(os.path.join(FNROOT, "lead-followup", "index.ts")).read()
chk("nudge_1_at" not in lf and "good time to call" not in lf and "removed on her word" in lf, "lead-followup on disk has no Day 1 / Day 3 nudge left (her word, 2026-10-07)")
ops = blob("ops_settings") or {}
say("  the acknowledgment switch (inquiry_ack_live) is " + ("ON" if ops.get("inquiry_ack_live") is True else "OFF") + " and stays that way")
sM, mM = fmeta(FN)
chk(sM == 200 and mM is not None, f"lead-followup is live now (version {(mM or {}).get('version', '?')}, gateway sign-in check {'on' if (mM or {}).get('verify_jwt') else 'off'})")
if fails: say(); say("  RESULT: STOPPED before anything changed."); done(3)

say(); say("PART 2 · CHANGE")
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api"], cwd=ROOT, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
okd, live = live_files(FN)
good = p.returncode == 0 and okd and all(k in live and live[k] == sha(os.path.join(ROOT, k)) for k in need(FN))
chk(good, "lead-followup deployed: the live copy is this reviewed build, every shared file included" if good else "lead-followup did not deploy cleanly: " + (p.stderr or p.stdout)[-200:])
if fails: say("  RESULT: STOPPED."); done(6)
sN, mN = fmeta(FN)
chk((mN or {}).get("verify_jwt") is True, f"version {(mN or {}).get('version', '?')}, sign-in check on")

say(); say("PART 3 · PROOF")
okd2, live2 = live_files(FN)
chk(okd2 and live2.get("supabase/functions/lead-followup/index.ts") == sha(os.path.join(FNROOT, "lead-followup", "index.ts")), "the live lead-followup is the nudge-free build")
ops2 = blob("ops_settings") or {}
chk(ops2.get("inquiry_ack_live") == ops.get("inquiry_ack_live"), "the acknowledgment switch is as it was")
say(); say("  RESULT: " + ("DONE · no timed nudges go to families any more" if not fails else "DONE WITH PROBLEMS, tell Claude")); done(0 if not fails else 7)
