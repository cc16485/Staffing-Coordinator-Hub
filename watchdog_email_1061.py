#!/usr/bin/env python3
# 1061 · WATCHDOG ALERTS EMAIL SAMANTHA ONLY (2026-10-22, Samantha: "change all hub watchdog notifications to only send to
# samantha@mo-care.com, no text"). The recipient is fixed in automation-watchdog, so watchdog_recipients and the
# applicant_alerts fallback can no longer text or copy anyone.
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the quiet-hours scan still passes for the watchdog.
#  2. Deploys automation-watchdog (gateway setting kept). No database change.
#  3. Proves it: a stranger is refused; one practice run (?dry=1) checks every automation and sends nothing.
# Sends nothing to anyone. Safe to run again.
import json, os, subprocess, shutil
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, deploy, start, check_build, fmeta, MG, API

HUB = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
FN = "automation-watchdog"
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
def keys():
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{HUB}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict) and usable(k.get("api_key", ""))}
        if got.get("service_role"): return got
    return {}

start("WATCHDOG ALERTS EMAIL SAMANTHA ONLY")
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
    c, o = run([NODE, "quiet_hours_425_test.mjs"], cwd=ROOT)
    chk("PASS · scan · automation-watchdog: emails Samantha only and never texts anyone" in o,
        "the watchdog emails samantha@mo-care.com only and has no text path left", "the watchdog scan did not pass: nothing was changed")
    if L.fails: say("  STOP. Nothing was changed."); done(2)
else: say("  · node is not on this Mac, so the scan was not re-run here (it passed when built)")
s_, m = fmeta(HUB, FN)
if s_ != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {FN} is set up live ({s_})", 3)
gate = bool(m["verify_jwt"]); say(f"  · {FN} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gate else 'off'} (kept)")

say(); say("PART 2 · CHANGE")
if not deploy(HUB, FNROOT, FN, gate): say("  STOP. Tell Claude. (Nothing else was changed.)"); done(5)

say(); say("PART 3 · PROOF")
s_, b = http("POST", f"{FNB}/functions/v1/{FN}", {})
chk(s_ in (401, 403), f"{FN}: a caller with no key gets nothing ({s_})", f"{FN} answered a stranger ({s_})")
K = keys(); SERVICE = K.get("service_role", ""); L.HIDE.append(SERVICE)
if not SERVICE: say("  · couldn't read the server key, so the practice run was skipped (the deploy above is done)")
else:
    s3, b3 = http("POST", f"{FNB}/functions/v1/{FN}?dry=1", {}, {"Authorization": "Bearer " + SERVICE, "apikey": SERVICE}, timeout=120)
    try: r = json.loads(b3)
    except Exception: r = {}
    chk(s3 == 200 and r.get("dry") is True and r.get("alerted") == 0,
        f"one practice run (?dry=1, sends nothing): checked {r.get('checked', '?')} automations, {len(r.get('problems') or [])} problem(s) right now",
        f"the practice run did not answer as expected ({s3}): {str(b3)[:200]}")
    for p in (r.get("problems") or [])[:12]: say("    - " + str(p)[:200])
say()
say("  1061: " + ("DONE. Watchdog alerts now go to samantha@mo-care.com by email only, never a text." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
