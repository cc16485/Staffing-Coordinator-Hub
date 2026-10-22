#!/usr/bin/env python3
# 1073 · QUIETER COVERAGE CARDS, SERVER HALF (2026-10-22, Samantha: "build the server side: stop making EVV review cards,
# coverage checks close themselves from AxisCare, and a weekly Make it official list. Switched off, show me first").
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the coverage tests pass (fake data only).
#  2. Deploys coverage-watch (gateway setting kept). No database change. Everything new waits behind
#     Settings > Tidier My Work (ops_settings.mywork_tidy_live), which this step does not touch: coverage-watch keeps making the
#     same cards until she turns that switch on.
#  3. Proves it: a stranger is refused; the server key is let in (a sign-in check only, the watcher is not run by hand).
# Sends nothing to anyone. Safe to run again.
import json, os, subprocess, shutil, time
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta

REF = HUB = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
FN = "coverage-watch"
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
def keys():
    """the project's service key, read with the access token (masked values are skipped)"""
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q_ in ("?reveal=true", ""):
        s_, b_ = http("GET", f"{L.API}/v1/projects/{REF}/api-keys{q_}", headers=L.MG())
        if s_ != 200: continue
        try: arr = json.loads(b_)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict) and usable(k.get("api_key", ""))}
        if got.get("service_role"): return got
    return {}

start("QUIETER COVERAGE CARDS (server half)")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = []
for k in sorted(L.need(FNROOT, FN)):
    c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
    if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE:
    for t, must in (("quiet_cards_test.mjs", "ALL PASSED"), ("loops_phase2_test.mjs", "62/62"), ("open_shift_cards_test.mjs", "ALL GREEN")):
        c, o = run([NODE, t], cwd=ROOT)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "FAIL" in l)[:240])
    ok("coverage tests pass, including no EVV card, checks closing from AxisCare and one weekly list (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
okq, st = sql(HUB, "select coalesce(data->>'mywork_tidy_live', 'false') as quiet, data->>'loops_close_live' as loops from app_data where key = 'ops_settings'")
if okq and st: say(f"  · Tidier My Work (and the quieter cards) on: {st[0]['quiet'] or 'false'} · coverage checks close themselves (loops) on: {st[0]['loops'] or 'false'} (this step changes neither)")
s_, m = fmeta(HUB, FN)
if s_ != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {FN} is set up live ({s_})", 3)
gate = bool(m["verify_jwt"]); say(f"  · {FN} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gate else 'off'} (kept)")

say(); say("PART 2 · CHANGE")
if not deploy(HUB, FNROOT, FN, gate): say("  STOP. Tell Claude. (Nothing else was changed.)"); done(5)

say(); say("PART 3 · PROOF")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
s_, _ = http("POST", f"{FNB}/functions/v1/{FN}", {}, {"Content-Type": "application/json"})
chk(s_ is not None and s_ != 200 and s_ < 500, f"{FN}: a caller with no key gets nothing ({s_})", f"{FN} answered a caller with no key ({s_})")
K = keys(); SERVICE = (K or {}).get("service_role", "")
if SERVICE:
    L.HIDE.append(SERVICE)
    s_, b = http("POST", f"{FNB}/functions/v1/{FN}?auth_check=1", {}, {"Authorization": "Bearer " + SERVICE, "Content-Type": "application/json"})
    try: j = json.loads(b) if s_ == 200 else {}
    except Exception: j = {}
    chk(s_ == 200 and j.get("ok") is True, f"{FN}: the server key is let in (sign-in check only; nothing ran)", f"{FN}: the server key was not let in ({s_})")
else: say("  · couldn't read the server key, so the sign-in check was skipped (its 5-minute schedule runs it)")
say()
say("  1073: " + ("DONE. Quieter coverage cards are installed. They start when Settings > Tidier My Work is on." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
