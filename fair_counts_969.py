#!/usr/bin/env python3
# 969 · TIME OFF AND COVERAGE NEVER COUNT, THE SERVER HALF (audit step 2; Samantha 2026-10-18: "I ran 960. Merge step 2
# (switched off) and set up the Desktop step that redeploys lead-watch and cc-team").
#  1. Checks first (nothing changes): the reviewed build is GitHub's main (Staffing #546 merged); the tests pass on fake data;
#     reads whether "time off and coverage never count" is on (it should be OFF until Samantha or Zachary turns it on).
#  2. Redeploys lead-watch and cc-team with the same lead-rules.js the Hub already runs (care-coordinator-hub #529). Each
#     keeps its gateway setting. A piece that is not live is left off, never re-created.
#  3. Proves each still refuses a caller with no key.
# While ops_settings.fair_counts_live is off, both behave exactly as before. Sends nothing. No database change. Safe to run again.
import json, os, subprocess, shutil
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, deploy, start, check_build, fmeta, sql

HUB = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
FNS = ["lead-watch", "cc-team"]
TESTS = ("fair_counts_test.mjs", "cc_team_960_test.mjs", "lead_turns_stage1_test.mjs", "lead_watch_494_test.mjs", "routine_notices_test.mjs")
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)

start("TIME OFF AND COVERAGE NEVER COUNT, THE SERVER HALF")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = []
for k in sorted(set().union(*[L.need(FNROOT, fn) for fn in FNS])):
    c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
    if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
if drift: stop("this isn't the same as GitHub's main yet (newer work landed since: " + ", ".join(drift)[:240] + "). Tell Claude.")
ok("the reviewed build is what is on GitHub's main")
if NODE:
    for t in TESTS:
        c, o = run([NODE, t], cwd=ROOT)
        last = (o.strip().splitlines() or ["(no output)"])[-1]
        if c != 0: stop(f"{t} failed: {last}")
        ok(f"{t}: {last.strip()} (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")

okw, rows = sql(HUB, """select jsonb_build_object(
  'fair', (select data->'fair_counts_live' from public.app_data where key = 'ops_settings'),
  'team', (select data->'team_live' from public.app_data where key = 'ops_settings'),
  'rungs', (select data->'lead_rungs_live' from public.app_data where key = 'ops_settings')) as s""")
if not okw: stop(f"couldn't read the settings ({str(rows)[:200]})", 3)
S = rows[0]["s"] if isinstance(rows[0]["s"], dict) else json.loads(rows[0]["s"])
say(f"  · time off and coverage never count: {'ON' if S.get('fair') is True else 'off, so lead-watch and cc-team keep working exactly as before'}")
say(f"  · team numbers and reviews: {'ON' if S.get('team') is True else 'off'}; speed to lead: {'ON' if S.get('rungs') is True else 'off'} (both unchanged by this step)")
gate = {}; skipped = []
for fn in FNS:
    s, m = fmeta(HUB, fn)
    if s == 404: skipped.append(fn); say(f"  · {fn} is not live, so it is left off (not deployed)"); continue
    if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s})", 3)
    gate[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gate[fn] else 'off'} (kept)")

LIVE = [fn for fn in FNS if fn not in skipped]
say(); say("PART 2 · CHANGE")
for fn in LIVE:
    if not deploy(HUB, FNROOT, fn, gate[fn]): say("  STOP. Tell Claude. (Anything above this line is in; the rest is unchanged.)"); done(5)

say(); say("PART 3 · PROOF")
for fn in LIVE:
    s, b = http("POST", f"{FNB}/functions/v1/{fn}", {})
    chk(s is not None and s != 200 and s < 500, f"{fn}: a caller with no key gets nothing ({s})", f"{fn} answered a caller with no key ({s})")
say()
say("  969: " + ("DONE. lead-watch and cc-team know about time off. It stays off until Samantha or Zachary turns it on in the Hub (Settings > Leads > Time off and coverage never count). Nothing was sent." if not L.fails
                 else "FINISHED WITH PROBLEMS above. Tell Claude."))
done(0 if not L.fails else 1)
