#!/usr/bin/env python3
# 875 · CLIENT CARE AGREEMENT, STAGE 4: THE HUB TICKS THE AGREEMENT STEPS (Samantha 2026-10-17: "continue to stage 4"; her
# answers "Yes, tick them", "Keep paper as a backup", and the GoHighLevel clean-up on her list).
#  Redeploys client-agreement: countersigning now ticks Start of Care "Care Agreement provided" + "Signed Care Agreement
#  received" (conflict-safe, never over a person's tick) and the journey's "Service agreement signed and on file". The
#  AxisCare upload stays a person's tick. No database change. Nothing is sent.
import json, os, hashlib, subprocess
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FNS = ("client-agreement",)
NEW: set = set()
ok = lambda s: say("  ✓ " + s)
def run(args): p = subprocess.run(args, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg): bad(msg); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(2)

start("CLIENT CARE AGREEMENT, STAGE 4: THE HUB TICKS THE AGREEMENT STEPS")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
# every file each function uses must match GitHub's main, so nobody's newer work is undone (run after the PR is merged)
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
for fn in FNS:
    drift = []
    for k in sorted(L.need(FNROOT, fn)):
        c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
        if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
    if drift: stop(f"{fn} isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
    ok(f"{fn}: the reviewed build is what is on GitHub's main")
ok1, r1 = sql(REF, """select to_regclass('public.client_agreement_links') is not null as stage3, to_regproc('public.lead_put_if_same') is not null as safe_write,
  to_regclass('public.client_journey_step') is not null as journeys""")
if not ok1: stop(f"could not read the database: {r1}")
x = r1[0]
if not x["stage3"]: stop("signing from home is not there (step 874 first)")
if not x["safe_write"] or not x["journeys"]: stop(f"the conflict-safe lead save or the journey tables are missing: {x}. Tell Claude.")
ok("874 is in; the conflict-safe lead save and the journey tables are there")
gate = {}
for fn in FNS:
    s, m = fmeta(REF, fn)
    if fn in NEW:
        if s == 404: gate[fn] = False; say(f"  · {fn} is new: it will be deployed with the gateway sign-in check off (a public door; the link and the code are its lock)")
        elif s == 200: stop(f"a {fn} function is already deployed. Tell Claude.")
        else: stop(f"couldn't check the functions ({s})")
        continue
    if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s})")
    gate[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gate[fn] else 'off'} (kept)")
say("  · what changes: client-agreement redeployed. No database change. Nothing sent, nothing in AxisCare.")
if L.fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
for i, fn in enumerate(FNS):
    if not deploy(REF, FNROOT, fn, gate[fn]):
        say("  RESULT: STOPPED. Nothing changed: the live client-agreement is the one from 874. Tell Claude."); done(6)

say(); say("PART 3 · PROOF (nothing is sent)")
U = f"{FNB}/functions/v1/client-agreement"
s1, _ = http("OPTIONS", U); ok("the Hub page can reach client-agreement") if s1 == 200 else bad(f"the browser check answered {s1}")
s2, b2 = http("POST", U, {"action": "countersign", "id": "00000000-0000-4000-8000-000000000000", "signature": "x"})
ok("countersigning refuses anyone not signed in to the Hub (401)") if s2 == 401 else bad(f"countersign answered a stranger {s2}: {b2[:120]}")
say("  · tested before deploying: the step ticks against a fake database (18 checks: p1 and p2 ticked as Automatic, p3 and billing left for a person, a person's tick kept, someone else's change never overwritten, Medicaid and set-aside starts untouched, a completed paper journey step kept, closed journeys not reopened, the countersign never blocked), all earlier agreement checks again (148), and the Hub screens (182).")
say()
if L.fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · Merge the Hub pull request next. Then do the GoHighLevel clean-up list. Nothing was sent by this step."); done(0)
