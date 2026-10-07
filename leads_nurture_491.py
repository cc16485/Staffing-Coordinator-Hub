#!/usr/bin/env python3
# 491 · RETIRE THE NURTURE DRIPS (clean-up 6.3; Samantha 2026-10-07 "do the rest", after "in home care every situation is so different").
#  · unschedules the daily lead-nurture job (the not-ready 4-touch drip and the 90-day lost text)
#  · stops every running sequence on the leads (nurture_stopped_at, reason "retired 2026-10-07"), listing who was on one
#  · deletes the lead-nurture function from Supabase (the code stays in the repo as history)
# The acknowledgment switch is not touched. Nothing is texted or emailed by this script. Safe to run twice.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}"))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); NODE = os.environ.get("SB_NODE", "node")
ROOT = os.path.dirname(os.path.dirname(FNROOT)); FN = "lead-nurture"
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
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-491/1.0"}, **(headers or {})))
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
    tmp = tempfile.mkdtemp(prefix="cc491-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
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

say("491 · RETIRE THE NURTURE DRIPS (no timed family sequences, anywhere)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for name, want in SHAS.items():
    p_ = os.path.join(FNROOT, "_shared", name.split("/", 1)[1]) if name.startswith("_shared/") else os.path.join(FNROOT, name, "index.ts")
    have = sha(p_) if os.path.exists(p_) else "(missing)"
    chk(have == want, f"{name} is the reviewed build" if have == want else f"{name} is not the reviewed build: nothing runs")
if fails: say(); say("  RESULT: STOPPED before anything changed."); done(2)
nf = open(os.path.join(FNROOT, "lead-nurture", "index.ts")).read()
chk(nf.startswith("// RETIRED 2026-10-07"), "the repo marks lead-nurture retired (history only)")
okj, jobs = sql("select jobname from cron.job where command like '%lead-nurture%'")
jobs = [r["jobname"] for r in (jobs or [])] if okj else []
say("  scheduled jobs calling lead-nurture: " + (", ".join(jobs) if jobs else "none"))
def blob(k):
    ok, r = sql(f"select data from public.app_data where key = {lit(k)}")
    d = r[0]["data"] if ok and r else None
    return json.loads(d) if isinstance(d, str) else d
leads = [l for l in (blob("leads") or []) if isinstance(l, dict) and l.get("id")]
running = [l for l in leads if l.get("nurture_sequence") and not l.get("nurture_stopped_at")]
nm = lambda l: (str(l.get("client_first_name") or "") + " " + str(l.get("client_last_name") or "")).strip() or (str(l.get("first_name") or "") + " " + str(l.get("last_name") or "")).strip() or "(no name)"
say(f"  {len(running)} lead(s) on a running sequence" + (": " + ", ".join(nm(l) + " (" + str(l.get("nurture_sequence")) + ", step " + str(l.get("nurture_step") or 0) + ")" for l in running) if running else ""))
sM, mM = fmeta(FN)
say("  lead-nurture is " + (f"live now (version {(mM or {}).get('version', '?')})" if sM == 200 and mM else "not deployed any more"))
ops = blob("ops_settings") or {}
say("  the acknowledgment switch (inquiry_ack_live) is " + ("ON" if ops.get("inquiry_ack_live") is True else "OFF") + " and stays that way")
if fails: say(); say("  RESULT: STOPPED before anything changed."); done(3)

say(); say("PART 2 · CHANGE")
for jn in jobs:
    oku, ru = sql("select cron.unschedule(" + lit(jn) + ") as ok")
    chk(oku, f"job {jn} unscheduled")
if not jobs: say("  ✓ no job to unschedule")
if running:
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    cases = " ".join("when x->>'id' = " + lit(l["id"]) + " then x || " + lit(json.dumps({"nurture_stopped_at": now, "nurture_stop_reason": "retired 2026-10-07: no timed family sequences"})) + "::jsonb" for l in running)
    okw, rw = sql("update public.app_data set data = (select jsonb_agg(case " + cases + " else x end order by o) from jsonb_array_elements(data) with ordinality t(x, o)) where key = 'leads' returning 1")
    chk(okw and rw, f"{len(running)} running sequence(s) stopped on the leads (kept as history)")
else: say("  ✓ no running sequence to stop")
if fails: say("  RESULT: STOPPED."); done(5)
if sM == 200 and mM:
    sD, bD = http("DELETE", f"{API}/v1/projects/{REF}/functions/{FN}", headers=MG())
    chk(sD in (200, 204), "lead-nurture deleted from Supabase" if sD in (200, 204) else f"could not delete lead-nurture (HTTP {sD}): " + str(bD)[:160])
else: say("  ✓ lead-nurture was already gone")

say(); say("PART 3 · PROOF")
okj2, jobs2 = sql("select count(*)::int as n from cron.job where command like '%lead-nurture%'")
chk(okj2 and jobs2 and jobs2[0]["n"] == 0, "no scheduled job calls lead-nurture")
leads2 = [l for l in (blob("leads") or []) if isinstance(l, dict)]
chk(not any(l.get("nurture_sequence") and not l.get("nurture_stopped_at") for l in leads2), "no lead is on a running sequence")
sP, mP = fmeta(FN)
chk(sP == 404 or mP is None, "lead-nurture is gone from Supabase")
ops2 = blob("ops_settings") or {}
chk(ops2.get("inquiry_ack_live") == ops.get("inquiry_ack_live"), "the acknowledgment switch is as it was")
say(); say("  RESULT: " + ("DONE · no timed family sequence exists anywhere now" if not fails else "DONE WITH PROBLEMS, tell Claude")); done(0 if not fails else 7)
