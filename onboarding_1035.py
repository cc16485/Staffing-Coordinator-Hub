#!/usr/bin/env python3
# 1035 · LEAVING ONBOARDING (Samantha 2026-10-21: "We need a clear way to take someone out of onboarding if they ghost, or
# let us know that they took another position, etc.")
# Part 1 (read only): the reviewed build; 1033 is in; every function this step replaces is live as main had it before this
#   build (or carries only older copies of shared files, which this build brings up to date).
# Part 2: leave-1035.sql (closed_at / closed_reason on reference requests; leave_patch, the server's door for the leave
#   fields), then the functions whose files changed: caregiver-journey (leave and come_back; the sweep skips anyone who
#   left), step2-handoff (no reminder, invitation text, profile reminder or card for them; the office actions refuse),
#   welcome-call (never an invitation or the welcome message), reference-chase (closed requests are never chased),
#   reference-send (a closed request is not sent).
# Part 3 (proof): one readiness sweep and reference-chase's practice run answer as expected. Nothing is sent; no switch
#   is needed (leave and come_back only stop things).
import os, json, subprocess
os.environ.setdefault("SB_STEP", "1035")
from cc_step_lib import *
import hashlib, subprocess
REF = "zngsgedlsxinbygwmxwn"
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
HERE = os.path.dirname(os.path.abspath(__file__))
BASE_ROOT = os.environ.get("SB_BASE_ROOT", "")   # a checkout of main as it was before this build (the launcher makes it)
ALL = ["caregiver-journey", "step2-handoff", "welcome-call", "reference-chase", "reference-send", "caregiver-export", "hire-profile", "bg-review", "offer-sign"]
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

start("LEAVING ONBOARDING")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
ok, st = sql(REF, "select to_regclass('public.caregiver_level_evidence') is not null as c1033, (select count(*) from public.reference_requests where responded_at is null)::int as open_refs, (select count(*) from public.client_journey where subject = 'caregiver' and status = 'open')::int as open_cards")
if not ok or not st: bad(f"could not read the database: {st}")
else:
    x = st[0]
    if x["c1033"] is not True: bad("1033 is not in yet. Run 1031, 1032 and 1033 first.")
    if not fails: say(f"  ✓ 1033 is in · {x['open_cards']} open onboarding card(s) and {x['open_refs']} unanswered reference request(s), none changed by this step")
if not BASE_ROOT or not os.path.isdir(BASE_ROOT): bad("the launcher did not set up main as it was before this build. Tell Claude.")
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
        elif livef == mine: say(f"  ✓ the live {fn} is already this build (an earlier run of 1035)")
        elif livef != want and not older_copies(livef, want): bad(f"the live {fn} is not what main had before this build ({len(set(livef.items()) ^ set(want.items()))} difference(s)), so nothing was replaced. Tell Claude.")
        elif livef != want: say(f"  ✓ the live {fn} carries an older copy of {', '.join(k.split('/')[-1] for k in older_copies(livef, want))} from an earlier deploy; this build brings it up to date")
        else: say(f"  ✓ the live {fn} is main as Claude read it (gateway sign-in check {'on' if GATES[fn] else 'off'}, kept)")
K = keys(); SVC = K.get("service_role", ""); HIDE.append(SVC)
if not SVC: bad("could not read the project's server key (the proof needs it)")
say(f"  · what changes: two columns on reference requests and the leave door, {len(FNS)} service(s): {', '.join(FNS)}. Nothing is sent.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
good, r = sql(REF, "begin;\n" + open(os.path.join(HERE, "supabase", "leave-1035.sql")).read() + "\ncommit;")
if not good: bad(f"the leave columns did not go in, so nothing changed: {str(r)[:300]}"); say("  RESULT: STOPPED. Tell Claude."); done(5)
say("  ✓ reference requests can be closed when someone leaves, with leave_patch for the leave fields")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, GATES[fn]):
        say(f"  RESULT: STOPPED at {fn}. The two columns are in (harmless while empty). Tell Claude."); done(6)

say(); say("PART 3 · PROOF (nothing sent)")
s, b = http("POST", f"{FNB}/functions/v1/caregiver-journey", {"action": "sweep"}, {"Authorization": "Bearer " + SVC, "apikey": SVC, "Content-Type": "application/json"})
try: j = json.loads(b)
except Exception: j = {}
if s == 200 and j.get("ok"): say(f"  ✓ the readiness sweep ran: {j.get('looked_at', 0)} open card(s), {j.get('skipped_left', 0)} skipped because they left")
else: bad(f"the readiness sweep did not answer as expected ({s}): {str(b)[:200]}")
s, b = http("POST", f"{FNB}/functions/v1/reference-chase?dry=1", {}, {"Authorization": "Bearer " + SVC, "apikey": SVC, "Content-Type": "application/json"})
try: j = json.loads(b)
except Exception: j = {}
if s == 200 and j.get("ok"): say("  ✓ reference-chase answered its practice run (closed requests are left out)" if j.get("dry") else f"  ✓ reference-chase answered outside its hours ({j.get('skipped')}); nothing was sent")
else: bad(f"reference-chase did not answer as expected ({s}): {str(b)[:200]}")
say()
if fails: say("  RESULT: DONE WITH PROBLEMS above. Tell Claude."); done(7)
say("  RESULT: DONE. The office can take someone out of onboarding (Stopped answering, Took another job, Changed their mind,")
say("  We decided not to hire), and an owner or the Approve to Work list can bring them back. Nothing else changes until they do.")
done(0)
