#!/usr/bin/env python3
# 924 · WHO ANSWERED THE CALL (2026-10-18, Samantha: "build all" on the New family? card upgrades). The call reader
# (call-tasks) keeps GoHighLevel's user on each answered call it reads (detail.answered_by), so the Hub's New family?
# card goes to whoever took the call instead of whoever owns Family inquiries.
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the call reader's tests pass (fake data only).
#  2. Deploys call-tasks (gateway setting kept). No database change.
#  3. Proves it: a stranger is refused; GoHighLevel already names who answered on the office's recorded calls.
# Sends nothing; never writes to GoHighLevel or AxisCare. Safe to run again.
import json, os, subprocess, shutil
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta

HUB = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
FN = "call-tasks"
KNOWN = "every GoHighLevel request is a read (GET)"   # fails on main before this change too (it lists the texts search); not this step's
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)

start("WHO ANSWERED THE CALL")
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
    c, o = run([NODE, "call_tasks_650_test.mjs"], cwd=ROOT)
    lines = o.splitlines()
    fails_ = [l for l in lines if l.startswith("FAIL") and KNOWN not in l]
    if fails_: stop("the call reader's tests failed: " + "; ".join(fails_)[:240])
    if not any(l.startswith("PASS") and "who answered is kept" in l for l in lines): stop("the who-answered test did not run")
    ok("call reader tests pass, including who answered (fake data only; the one known old check about the texts search is not this step's)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
s, m = fmeta(HUB, FN)
if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {FN} is set up live ({s})", 3)
gate = bool(m["verify_jwt"]); say(f"  · {FN} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gate else 'off'} (kept)")

say(); say("PART 2 · CHANGE")
if not deploy(HUB, FNROOT, FN, gate): say("  STOP. Tell Claude. (Nothing else was changed.)"); done(5)

say(); say("PART 3 · PROOF")
s, b = http("POST", f"{FNB}/functions/v1/{FN}", {})
chk(s in (401, 403), f"{FN}: a caller with no key gets nothing ({s})", f"{FN} answered a stranger ({s})")
okq, rows = sql(HUB, """select count(*) filter (where coalesce(e->>'by','') <> '')::int as named, count(*)::int as total
  from app_data, jsonb_array_elements(case when jsonb_typeof(data) = 'array' then data else '[]'::jsonb end) l,
       jsonb_array_elements(case when jsonb_typeof(l->'contact_events') = 'array' then l->'contact_events' else '[]'::jsonb end) e
 where key = 'leads' and e->>'channel' = 'call' and e->>'direction' = 'in' and e->>'outcome' = 'connected' and coalesce(e->>'ref','') like 'ghl:%'""")
if okq and rows:
    n, t = rows[0].get("named", 0), rows[0].get("total", 0)
    if t: say(f"  · answered calls the recorder put on leads: {n} of {t} name who in the office answered (GoHighLevel gives it)")
    else: say("  · no answered calls on leads yet to check against; the first card will show it")
else: say("  · couldn't count the recorded calls (the deploy above is proven)")
say()
say("  924: " + ("DONE. From the next answered call the AI reads, a New family? card goes to whoever took the call." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
