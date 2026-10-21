#!/usr/bin/env python3
# 1037 · THE PRN CAREGIVER TEAM (Samantha 2026-10-21: "Yes to all 8 PRN Caregiver recommendations. Use 10 as the starting team
# goal." Design: https://claude.ai/artifact/YTpYS2zWUWHjLjwr1Rm6Da)
# Part 1 (read only): the reviewed build; every function this step replaces is live as main had it before this build (or
#   carries only older copies of shared files, which this build brings up to date); the PRN CNA Team role is there.
# Part 2: prn-caregiver-1037.sql (the role prn_caregiver "PRN Caregiver Team", requires_cna and pay_note, the screen asking CNA
#   only when the role needs it, pay_tracks.team and its two doors, the team goal 10, the always-on posting as a DRAFT), then
#   every function whose files changed: prn-team (two teams, to_cna_team), interview-messages (each PRN team in its own name)
#   and the services that share applicant-words.ts or hepb.ts.
# Part 3 (proof, read only): AxisCare's class list: whether "PRN TEAM - CAREGIVER" exists yet (if not, add it once in AxisCare,
#   Settings, Classes; the Hub never creates it). Nothing is sent; the posting stays a draft until it is published on Recruit.
import os, json, subprocess
os.environ.setdefault("SB_STEP", "1037")
from cc_step_lib import *
import hashlib, subprocess
REF = "zngsgedlsxinbygwmxwn"
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
HERE = os.path.dirname(os.path.abspath(__file__))
BASE_ROOT = os.environ.get("SB_BASE_ROOT", "")   # a checkout of main as it was before this build (the launcher makes it)
ALL = sorted(d for d in os.listdir(FNROOT) if os.path.isfile(os.path.join(FNROOT, d, "index.ts")))
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

start("THE PRN CAREGIVER TEAM")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
ok, st = sql(REF, "select (select count(*) from public.job_positions where key = 'prn_cna' and track = 'prn')::int as cna_role, (select count(*) from public.job_positions where key = 'prn_caregiver')::int as cg_role, (select count(*) from public.pay_tracks)::int as tracks")
if not ok or not st: bad(f"could not read the database: {st}")
else:
    x = st[0]
    if x["cna_role"] != 1: bad("the PRN CNA Team role is not as expected (Desktop 352)")
    if not fails: say(f"  ✓ the PRN CNA Team role is there · the PRN Caregiver Team role is {'already in (an earlier run)' if x['cg_role'] else 'new'} · {x['tracks']} pay track(s), none changed")
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
        elif livef == mine: say(f"  ✓ the live {fn} is already this build (an earlier run of 1037)")
        elif livef != want and not older_copies(livef, want): bad(f"the live {fn} is not what main had before this build ({len(set(livef.items()) ^ set(want.items()))} difference(s)), so nothing was replaced. Tell Claude.")
        elif livef != want: say(f"  ✓ the live {fn} carries an older copy of {', '.join(k.split('/')[-1] for k in older_copies(livef, want))} from an earlier deploy; this build brings it up to date")
        else: say(f"  ✓ the live {fn} is main as Claude read it (gateway sign-in check {'on' if GATES[fn] else 'off'}, kept)")
K = keys(); SVC = K.get("service_role", ""); HIDE.append(SVC)
if not SVC: bad("could not read the project's server key (the proof needs it)")
say(f"  · what changes: the PRN Caregiver Team role, the screen, the team column and its doors, the goal, a draft posting; {len(FNS)} service(s): {', '.join(FNS)}. Nothing is sent.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
good, r = sql(REF, "begin;\n" + open(os.path.join(HERE, "supabase", "prn-caregiver-1037.sql")).read() + "\ncommit;")
if not good: bad(f"the PRN Caregiver Team did not go in, so nothing changed: {str(r)[:300]}"); say("  RESULT: STOPPED. Tell Claude."); done(5)
say("  ✓ the PRN Caregiver Team role ($18, no CNA needed, PRN-PAY-2026-10C), the screen, pay_tracks.team, the goal 10, the draft posting")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, GATES[fn]):
        say(f"  RESULT: STOPPED at {fn}. The SQL is in (prn-caregiver-1037-rollback.sql undoes the role and the posting). Tell Claude."); done(6)

say(); say("PART 3 · PROOF (read only; nothing sent)")
s, b = http("POST", f"{FNB}/functions/v1/prn-team", {"action": "vocab"}, {"Authorization": "Bearer " + SVC, "apikey": SVC, "Content-Type": "application/json"})
try: j = json.loads(b)
except Exception: j = {}
AX_MISSING = False
if s == 200 and "prn_caregiver" in j:
    say(f"  ✓ AxisCare: the PRN CNA Team class is {j.get('prn') or 'MISSING'}; the PRN Caregiver Team class is {j.get('prn_caregiver') or 'not there yet'}")
    if not j.get("prn_caregiver"): AX_MISSING = True; say("  · ONE THING FOR YOU: in AxisCare, Settings, Classes, add a caregiver class named exactly PRN TEAM - CAREGIVER. The Hub never creates it.")
else: bad(f"prn-team did not answer as expected ({s}): {str(b)[:200]}")
ok, ps = sql(REF, "select status, title from public.job_postings where slug = 'prn-caregiver-springfield'")
if ok and ps: say(f"  ✓ the posting {ps[0]['title']} is {ps[0]['status']} (publish it on Recruit, Job postings, to put it on mo-care.com)")
say()
if fails: say("  RESULT: DONE WITH PROBLEMS above. Tell Claude."); done(7)
say("  RESULT: DONE. The PRN Caregiver Team is in: $18 PRN, $16 ongoing, no CNA needed, team goal 10. A PRN Caregiver who earns a CNA")
say("  moves to the PRN CNA Team ($20) by the office's deliberate step." + (" Add the AxisCare class above first." if AX_MISSING else ""))
done(0)
