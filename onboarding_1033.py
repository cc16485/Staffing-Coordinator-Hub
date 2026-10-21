#!/usr/bin/env python3
# 1033 · LEVEL OF CARE VERIFICATION (Samantha's approved design of 2026-10-08, design doc ed1f68c2, tab "Level of Care
# Verification"; decision 4 of the onboarding design 2026-10-21: the approvers are the Approve to Work list)
# Part 1 (read only): the reviewed build; 1032 is in; the two new switches are off; caregiver-journey and reference-tasks are
#   live exactly as 1032 left them.
# Part 2: level-1033.sql (the evidence table, server only; level_patch, the door for the approved level), then
#   caregiver-journey (level_get / level_evidence / level_approve; reference answers become evidence in PRACTICE) and
#   reference-tasks (the task-by-task questions for every real work reference, behind reference_tasks_all_live).
# Part 3 (proof): one readiness sweep: the reference evidence answers in practice. No switch is turned on; nothing is sent.
import os, json, subprocess
os.environ.setdefault("SB_STEP", "1033")
from cc_step_lib import *
import hashlib, subprocess
REF = "zngsgedlsxinbygwmxwn"
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
HERE = os.path.dirname(os.path.abspath(__file__))
BASE_ROOT = os.environ.get("SB_BASE_ROOT", "")   # a checkout of the 1032 build (the launcher makes it)
ALL = ["caregiver-journey", "reference-tasks"]
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

start("LEVEL OF CARE VERIFICATION")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
SW = ["level_from_refs_live", "reference_tasks_all_live"]
ok, st = sql(REF, "select " + ", ".join(f"coalesce((select data->>{lit(k)} from public.app_data where key = 'ops_settings'), '') as {k}" for k in SW)
  + ", (select count(*) from information_schema.columns where table_name = 'reference_requests' and column_name = 'texted_at')::int as c1032, (select count(*) from public.reference_requests where task_confirm is not null)::int as answered")
if not ok or not st: bad(f"could not read the database: {st}")
else:
    x = st[0]
    if any(x[k] == "true" for k in SW): bad("a new switch is already on; this step expects both off")
    if x["c1032"] != 1: bad("1032 is not in yet. Run 1031 and 1032 first.")
    if not fails: say(f"  ✓ 1032 is in · the two new switches are off · {x['answered']} reference(s) answered task by task so far, none changed")
if not BASE_ROOT or not os.path.isdir(BASE_ROOT): bad("the launcher did not set up the 1032 build. Tell Claude.")
FNS, GATES = [], {}
if not fails:
    for fn in ALL:
        mine = {k: sha(os.path.join(ROOT, k)) for k in need(FNROOT, fn)}
        want = {k: sha(os.path.join(BASE_ROOT, k)) for k in need(os.path.join(BASE_ROOT, "supabase", "functions"), fn)}
        if mine == want: continue
        FNS.append(fn)
        sF, mF = fmeta(REF, fn)
        if sF != 200: bad(f"{fn} is not live"); continue
        GATES[fn] = bool((mF or {}).get("verify_jwt"))
        okL, livef = live_files(REF, fn)
        if not okL: bad(f"could not read the live {fn}")
        elif livef == mine: say(f"  ✓ the live {fn} is already this build (an earlier run of 1033)")
        elif livef != want and not older_copies(livef, want): bad(f"the live {fn} is not what 1032 left ({len(set(livef.items()) ^ set(want.items()))} difference(s)), so nothing was replaced. Tell Claude.")
        elif livef != want: say(f"  ✓ the live {fn} carries an older copy of {', '.join(k.split('/')[-1] for k in older_copies(livef, want))} from an earlier deploy; this build brings it up to date")
        else: say(f"  ✓ the live {fn} is the 1032 build (gateway sign-in check {'on' if GATES[fn] else 'off'}, kept)")
K = keys(); SVC = K.get("service_role", ""); HIDE.append(SVC)
if not SVC: bad("could not read the project's server key (the proof needs it)")
say(f"  · what changes: the Level of Care evidence table and its door, {len(FNS)} service(s): {', '.join(FNS)}. No switch is turned on; nothing is sent.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
good, r = sql(REF, "begin;\n" + open(os.path.join(HERE, "supabase", "level-1033.sql")).read() + "\ncommit;")
if not good: bad(f"the evidence table did not go in, so nothing changed: {str(r)[:300]}"); say("  RESULT: STOPPED. Tell Claude."); done(5)
say("  ✓ the Level of Care evidence table is in (server only), with level_patch for the approved level")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, GATES[fn]):
        say(f"  RESULT: STOPPED at {fn}. The evidence table is in (harmless while empty). Tell Claude."); done(6)

say(); say("PART 3 · PROOF (practice; nothing sent)")
s, b = http("POST", f"{FNB}/functions/v1/caregiver-journey", {"action": "sweep"}, {"Authorization": "Bearer " + SVC, "apikey": SVC, "Content-Type": "application/json"})
try: j = json.loads(b)
except Exception: j = {}
L = j.get("level_refs") or {}
if s == 200 and j.get("ok") and L.get("live") is False: say(f"  ✓ the readiness sweep ran: {L.get('would', 0)} reference answer(s) would become Level evidence (practice)")
else: bad(f"the readiness sweep did not answer as expected ({s}): {str(b)[:200]}")
say()
if fails: say("  RESULT: DONE WITH PROBLEMS above. Tell Claude."); done(7)
say("  RESULT: DONE. The Level of Care card can record proof and Samantha or Zachary can approve a level now. In PRACTICE until")
say("  turned on (ops_settings): reference_tasks_all_live (work references asked task by task), level_from_refs_live (their")
say("  \"I saw it myself\" answers become Level evidence).")
done(0)
