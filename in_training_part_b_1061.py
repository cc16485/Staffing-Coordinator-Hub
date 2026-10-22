#!/usr/bin/env python3
# 1061 · IN TRAINING PLAN v2, PART B (Samantha approved 2026-10-22: "Yes, start building Part B"). Three new things, each behind
# its own Admin switch, ALL LEFT OFF by this step:
#   - Send orientation information (orientation_button_live): Step 2 checked opens "Add to AxisCare as In Training"; one button
#     checks AxisCare's zip code and birth date against Step 1, then sends ONE message with the orientation link inside.
#   - Approve to Work by itself (auto_approve_work_live): when the last required step is done (usually orientation).
#   - The check-in call (checkin_call_live): opened when AxisCare reads back Active; shift texts wait until it is ticked done.
# Also: the cleared text now says orientation, links the AxisCare app guide and says the Staffing Coordinator will call.
#  1. Checks first (nothing changes): both reviewed builds are GitHub's main (Hub server and Training Platform); the tests pass
#     (fake data only); how each service is set up live; the AxisCare row's how-to as it is now (saved in this report).
#  2. Training Platform: job-offer (the link-only door). Hub: the catalog row (SQL), then the 10 services.
#  3. Proves it: strangers get nothing; the catalog row is in; the three switches are still off.
# Sends nothing. Safe to run again.
import json, os, subprocess, shutil
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta, lit

HUB = "zngsgedlsxinbygwmxwn"; TRAIN = "rdqujxiycycwhskyvrwa"
FNROOT = L.FNROOT; ROOT = L.ROOT
TRN_FNROOT = os.environ.get("SB_TRN_FNROOT", ""); TRN_ROOT = os.path.dirname(os.path.dirname(TRN_FNROOT)) if TRN_FNROOT else ""
SHAS = json.loads(os.environ.get("SB_SHAS", "{}")); TRN_SHAS = json.loads(os.environ.get("SB_TRN_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co"); TRN_FNB = os.environ.get("SB_TRN_FN_BASE", f"https://{TRAIN}.supabase.co")
FNS = ["step2-handoff", "caregiver-journey", "coverage-run", "coverage-shifts", "schedule-push", "match-dark", "onboard-goal-watch", "team-ask", "family-offer", "family-gateway"]
TRN_FNS = ["job-offer"]
SWITCHES = ["orientation_button_live", "auto_approve_work_live", "checkin_call_live"]
SQLF = "supabase/in-training-part-b-1061.sql"
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
def drift(root, fnroot, fns, extra=()):
    main = os.environ.get("SB_MAIN_REF", "origin/main")
    if main.startswith("origin/"): run(["git", "-C", root, "fetch", "-q", "origin", "main"])
    out = []
    for k in sorted({k for fn in fns for k in L.need(fnroot, fn)} | set(extra)):
        c2, b2 = run(["git", "-C", root, "show", f"{main}:{k}"])
        if c2 != 0 or b2 != open(os.path.join(root, k)).read(): out.append(k)
    return out
def switches():
    okq, r = sql(HUB, "select " + ", ".join(f"coalesce((data::jsonb->>'{k}')::boolean, false) as {k}" for k in SWITCHES) + " from public.app_data where key = 'ops_settings'")
    return r[0] if okq and r else None

start("IN TRAINING PLAN v2, PART B")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
if not TRN_FNROOT or not os.path.isdir(TRN_FNROOT): stop("the Training Platform build is not here")
check_build(TRN_FNROOT, TRN_SHAS)
d1 = drift(ROOT, FNROOT, FNS, [SQLF]); d2 = drift(TRN_ROOT, TRN_FNROOT, TRN_FNS)
if d1 or d2: stop("this isn't the same as GitHub's main yet (merge both pull requests first, or newer work landed since: " + ", ".join(d1 + d2)[:260] + ")")
ok("both reviewed builds are what is on GitHub's main (Hub server and Training Platform)")
if NODE:
    for root, t, must in ((ROOT, "in_training_part_b_test.mjs", "15/15 passed"), (ROOT, "caregiver_journey_6_test.mjs", "127/127 passed"), (ROOT, "step2_handoff_575_test.mjs", "58/58 passed"),
                          (ROOT, "in_training_test.mjs", "21/21 passed"), (ROOT, "callin_plan_harness.mjs", "ALL 20 CHECKS PASS"), (ROOT, "team_pool_test.mjs", "5/5 passed"),
                          (ROOT, "schedule_push_harness.mjs", "33/33 passed"), (TRN_ROOT, "orientation_link_test.mjs", "67/67 passed")):
        c, o = run([NODE, t], cwd=root)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l for l in o.splitlines() if "FAIL" in l or "✗" in l)[:240])
    ok("tests pass: the AxisCare check refuses a missing or wrong zip code or birth date, the link comes back without Training sending anything, Approve to Work by itself, the check-in call holds shift texts until done (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
sw = switches()
if sw is None: stop("couldn't read the Hub settings", 3)
say("  · switches now: " + ", ".join(f"{k} {'ON' if sw[k] else 'off'}" for k in SWITCHES) + " (this step leaves them as they are)")
okq, old = sql(HUB, "select def->'howto' as howto from public.client_journey_step_def where key = 'cg.axiscare.in_training'")
if not okq or not old: stop("couldn't read the AxisCare row", 3)
say("  · the AxisCare row's how-to before this step (for the rollback): " + json.dumps(old[0]["howto"])[:1500])
metas = {}
for ref, fns in ((TRAIN, TRN_FNS), (HUB, FNS)):
    for fn in fns:
        s, m = fmeta(ref, fn)
        if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s})", 3)
        metas[(ref, fn)] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if metas[(ref, fn)] else 'off'} (kept)")

say(); say("PART 2 · CHANGE")
for fn in TRN_FNS:
    if not deploy(TRAIN, TRN_FNROOT, fn, metas[(TRAIN, fn)]): say("  STOP. Tell Claude. (Nothing on the Hub was changed.)"); done(5)
okq, r = sql(HUB, open(os.path.join(ROOT, SQLF)).read())
if not okq: say("  ✗ the catalog change did not go in: " + str(r)[:300]); say("  STOP. Tell Claude. (The Training Platform's link-only door is in; it sends nothing by itself.)"); done(5)
ok("the catalog: the check-in call row is in, and the AxisCare row's how-to says the new order")
for fn in FNS:
    if not deploy(HUB, FNROOT, fn, metas[(HUB, fn)]): say("  STOP. Tell Claude. (Services before this one are deployed; the switches were not touched.)"); done(5)

say(); say("PART 3 · PROOF")
for fn in FNS:
    s, b = http("POST", f"{FNB}/functions/v1/{fn}", {})
    chk(s in (400, 401, 403), f"{fn}: a caller with no key gets nothing ({s})", f"{fn} answered a stranger ({s})")
s, b = http("POST", f"{TRN_FNB}/functions/v1/job-offer", {"action": "orientation_link", "link_only": True, "phone": "4175550000"}, {"x-outreach-secret": "not-the-secret"})
chk(s in (401, 403), f"Training job-offer: the link-only door refuses a wrong server secret ({s})", f"Training job-offer answered a wrong secret ({s})")
okq, r = sql(HUB, "select count(*)::int as n from public.client_journey_step_def where key = 'cg.checkin.call' and active")
chk(okq and r and r[0]["n"] == 1, "the check-in call row is active in the catalog", "the check-in call row is not there: " + str(r)[:160])
after = switches()
chk(after == sw, "the three switches are as they were (" + ", ".join(f"{k} {'ON' if (after or {}).get(k) else 'off'}" for k in SWITCHES) + ")", f"a switch changed: {sw} -> {after}")
say()
if not L.fails:
    say("  1061: DONE. Part B is in, with its three switches off: nothing works differently until you turn them on")
    say("  (Owners Hub > Admin: \"Send orientation information button\", \"Approve to Work by itself\", \"Check-in call after orientation\").")
else: say("  1061: NOT COMPLETE. See the ✗ lines above.")
done(0 if not L.fails else 1)
