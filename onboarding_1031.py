#!/usr/bin/env python3
# 1031 · ONBOARDING RULE FIXES (Samantha approved the onboarding design 2026-10-21: "I approve the onboarding design with your
# recommended answers to decisions 2 to 6. Go ahead and build it.")
# Part 1 (read only): the reviewed build; the two new switches are off; every function this step replaces is live exactly
#   as main had it before this build (so nothing someone else deployed is overwritten).
# Part 2: onboarding-1031.sql (no fingerprint row; dementia optional and out of Approve to Work; Case.net can be reviewed;
#   the Hub may read the OIG search results), then seven functions redeployed: caregiver-journey (the reference rule the
#   same as the Hub's, Approve to Advance by itself and the OIG search on arrival, both in PRACTICE), step1-sign (no
#   fingerprint flag), welcome-call (the invitation waits for Step 2 checked), bg-review (Case.net), references-run,
#   hire-profile and caregiver-export (the same shared rules).
# Part 3 (proof): one readiness sweep, the one that runs every ten minutes anyway: both new parts answer in practice. No
#   switch is turned on; nothing is sent.
import os, json, subprocess
os.environ.setdefault("SB_STEP", "1031")
from cc_step_lib import *
import hashlib, subprocess
REF = "zngsgedlsxinbygwmxwn"
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
HERE = os.path.dirname(os.path.abspath(__file__))
BASE_ROOT = os.environ.get("SB_BASE_ROOT", "")   # a checkout of main as it was before this build (the launcher makes it)
FNS = ["caregiver-journey", "step1-sign", "welcome-call", "bg-review", "references-run", "hire-profile", "caregiver-export"]
def keys():
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict) and usable(k.get("api_key", ""))}
        if got.get("service_role"): return got
    return {}


def older_copies(livef, want):
    """1031b (2026-10-21): the live copy can carry an OLDER version of a shared file (a function deployed before a later
    change to that file, e.g. send-problems.ts before the HR alert line). That is nobody's own work, so it is safe to
    replace. Returns the paths that differ when every one of them is a version from the Staffing history; else []."""
    if set(livef) != set(want): return []
    diff = [k for k in want if livef.get(k) != want[k]]
    for k in diff:
        revs = subprocess.run(["git", "-C", BASE_ROOT, "log", "--format=%H", "HEAD", "--", k], capture_output=True, text=True).stdout.split()
        if not any(hashlib.sha256(subprocess.run(["git", "-C", BASE_ROOT, "show", f"{r}:{k}"], capture_output=True).stdout).hexdigest() == livef[k] for r in revs[:300]): return []
    return diff

start("ONBOARDING RULE FIXES")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
ok, st = sql(REF, """select coalesce((select data->>'approve_advance_auto_live' from public.app_data where key = 'ops_settings'), '') as adv,
  coalesce((select data->>'oig_auto_search_live' from public.app_data where key = 'ops_settings'), '') as oig,
  (select count(*) from public.client_journey_step_def where key in ('cg.check.fingerprints', 'cg.training.dementia', 'cg.approve.work', 'cg.approve.advance'))::int as rows,
  (select count(*) from public.bg_reviews)::int as reviews""")
if not ok or not st: bad(f"could not read the database: {st}")
else:
    x = st[0]
    if x["adv"] == "true" or x["oig"] == "true": bad("a new switch is already on; this step expects both off")
    if x["rows"] != 4: bad(f"the readiness catalog is not as expected ({x['rows']} of the 4 rows found)")
    if not fails: say(f"  ✓ both new switches are off · the four catalog rows are there · {x['reviews']} background review(s) on file, none changed")
GATES = {}
if not BASE_ROOT or not os.path.isdir(BASE_ROOT): bad("the launcher did not set up main as it was before this build. Tell Claude.")
else:
    for fn in FNS:
        sF, mF = fmeta(REF, fn)
        if sF != 200: bad(f"{fn} is not live"); continue
        GATES[fn] = bool((mF or {}).get("verify_jwt"))
        okL, livef = live_files(REF, fn)
        want = {k: sha(os.path.join(BASE_ROOT, k)) for k in need(os.path.join(BASE_ROOT, "supabase", "functions"), fn)}
        mine = {k: sha(os.path.join(ROOT, k)) for k in need(FNROOT, fn)}
        if not okL: bad(f"could not read the live {fn}")
        elif livef == mine: say(f"  ✓ the live {fn} is already this build (an earlier run of 1031)")
        elif livef != want and not older_copies(livef, want): bad(f"the live {fn} is not what main had before this build ({len(set(livef.items()) ^ set(want.items()))} difference(s)), so nothing was replaced. Tell Claude.")
        elif livef != want: say(f"  ✓ the live {fn} carries an older copy of {', '.join(k.split('/')[-1] for k in older_copies(livef, want))} from an earlier deploy; this build brings it up to date")
        else: say(f"  ✓ the live {fn} is main as Claude read it (gateway sign-in check {'on' if GATES[fn] else 'off'}, kept)")
K = keys(); SVC = K.get("service_role", ""); HIDE.append(SVC)
if not SVC: bad("could not read the project's server key (the proof needs it)")
say("  · what changes: the readiness catalog (four rows), the review table, seven functions. No switch is turned on; nothing is sent.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
good, r = sql(REF, "begin;\n" + open(os.path.join(HERE, "supabase", "onboarding-1031.sql")).read() + "\ncommit;")
if not good: bad(f"the catalog change did not go in, so nothing changed: {str(r)[:300]}"); say("  RESULT: STOPPED. Tell Claude."); done(5)
say("  ✓ no fingerprint row · dementia optional and out of Approve to Work · Case.net can be reviewed · the Hub may read OIG searches")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, GATES[fn]):
        say(f"  RESULT: STOPPED at {fn}. The catalog change is in (onboarding-1031-rollback.sql undoes it). Tell Claude."); done(6)

say(); say("PART 3 · PROOF (practice; nothing sent)")
s, b = http("POST", f"{FNB}/functions/v1/caregiver-journey", {"action": "sweep"}, {"Authorization": "Bearer " + SVC, "apikey": SVC, "Content-Type": "application/json"})
try: j = json.loads(b)
except Exception: j = {}
if s == 200 and j.get("ok") and j.get("advance", {}).get("live") is False and j.get("oig_search", {}).get("live") is False:
    say(f"  ✓ the readiness sweep ran: {j.get('looked_at', 0)} card(s) looked at · Approve to Advance would complete itself for {j['advance'].get('would', 0)} · the OIG search would run for {j['oig_search'].get('would', 0)} (practice)")
else: bad(f"the readiness sweep did not answer as expected ({s}): {str(b)[:200]}")
ok, fp = sql(REF, "select count(*)::int as n from public.client_journey_step s join public.client_journey j using (journey_id) where s.step_key = 'cg.check.fingerprints' and j.status = 'open' and s.state not in ('complete','not_needed','exception')")
if ok and fp: say(f"  · {fp[0]['n']} open card(s) still hold an old fingerprint row; it no longer counts anywhere (the code and the catalog both drop it)")
say()
if fails: say("  RESULT: DONE WITH PROBLEMS above. Tell Claude."); done(7)
say("  RESULT: DONE. Fingerprints are gone, dementia is optional, Case.net can be reviewed. Approve to Advance by itself and the")
say("  OIG search on arrival are in PRACTICE: ops_settings approve_advance_auto_live and oig_auto_search_live turn them on.")
done(0)
