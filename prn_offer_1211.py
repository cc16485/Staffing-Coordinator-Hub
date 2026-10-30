#!/usr/bin/env python3
# 1211 · PRN TEAM ON ANY OFFER (Samantha 2026-10-30, after an interview: "There will be times someone comes in
# through a different prescreener but we actually want them on the PRN team"). prn-team's start now takes the team picked on
# the offer form, so the pay track starts whichever prescreener they came in through; the history says which one.
#  1. Redeploys prn-team (its gateway sign-in setting kept).
#  No database changes. Nothing is sent, nothing in AxisCare. Without a team picked, start works exactly as before.
#  Undo: redeploy the previous prn-team.
import json, os, hashlib, re, subprocess
os.environ.setdefault("SB_STEP", "1211")
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta, live_files, sha

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FN = "prn-team"
ok = lambda s: say("  ✓ " + s)
def run(args): p = subprocess.run(args, capture_output=True, text=True); return p.returncode, (p.stdout or ""), (p.stderr or "")
def stop(msg): bad(msg); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(2)

start("PRN TEAM ON ANY OFFER")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
MAIN = os.environ.get("SB_MAIN_REF", "origin/main"); BASE = os.environ.get("SB_BASE", "")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
files = sorted(L.need(FNROOT, FN))
drift = [k for k in files if (lambda c: c[0] != 0 or c[1] != open(os.path.join(ROOT, k)).read())(run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"]))]
if drift: stop("this build isn't the same as GitHub's main (newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the build is what is on GitHub's main")
_mv = {}
def merged_versions(k):
    """every version of file k that was ever on GitHub's main"""
    if k not in _mv:
        rc, out, _ = run(["git", "-C", ROOT, "log", "--format=%H", MAIN, "--", k]); vs = set()
        for h in out.split():
            r2, src, _ = run(["git", "-C", ROOT, "show", f"{h}:{k}"])
            if r2 == 0: vs.add(hashlib.sha256(src.encode()).hexdigest())
        _mv[k] = vs
    return _mv[k]
s, m = fmeta(REF, FN)
if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {FN} is set up live ({s})")
gate = bool(m["verify_jwt"])
okl, live = live_files(REF, FN)
if not okl: stop(f"couldn't download the live {FN} to compare")
odd, older = [], []
for k in files:
    rc, was, _ = run(["git", "-C", ROOT, "show", f"{BASE}:{k}"])
    base_sha = hashlib.sha256(was.encode()).hexdigest() if rc == 0 else None
    if live.get(k) is None and rc != 0: continue   # a file the earlier build never had is not live yet: expected
    if live.get(k) in (base_sha, sha(os.path.join(ROOT, k))): continue
    if live.get(k) in merged_versions(k): older.append(k.rsplit("/", 1)[-1]); continue
    odd.append(k)
if odd: stop(f"the live {FN} has code that was never on GitHub's main (someone else's unreleased change): " + ", ".join(odd)[:240])
say(f"  · {FN}: live version {m.get('version', '?')} is merged code" + (f" (brings forward already-merged updates to {', '.join(older)})" if older else "") + f", gateway sign-in check {'on' if gate else 'off'} (kept)")
ok1, r1 = sql(REF, "select count(*) filter (where track = 'prn_team') as prn, count(*) as all_tracks from public.pay_tracks")
if not ok1: stop(f"could not read the database: {r1}")
say(f"  · pay tracks today: {r1[0]['prn']} on a PRN team, {r1[0]['all_tracks']} in all (this step changes none of them)")
say("  · what changes: 1 function redeployed. No database changes. Nothing sent, nothing in AxisCare.")
if L.fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, FN, gate):
    say("  RESULT: STOPPED. The old prn-team is still live, which is safe. Running this step again finishes it. Tell Claude."); done(7)

say(); say("PART 3 · PROOF (nothing is sent)")
s2, m2 = fmeta(REF, FN)
ok(f"{FN} is live as version {m2.get('version', '?')}, gateway sign-in check {'on' if gate else 'off'} as before") if s2 == 200 and m2 and bool(m2.get("verify_jwt")) == gate else bad(f"{FN} did not read back as expected ({s2}): {m2}")
okl2, live2 = live_files(REF, FN)
ok("the live prn-team is the reviewed build, file for file") if okl2 and all(live2.get(k) == sha(os.path.join(ROOT, k)) for k in files) else bad("the live prn-team does not match the reviewed build")
s1, _ = http("OPTIONS", f"{FNB}/functions/v1/{FN}"); ok(f"the Hub pages can reach {FN}") if s1 == 200 else bad(f"{FN}: the browser check answered {s1}")
s3, b3 = http("POST", f"{FNB}/functions/v1/{FN}", {"action": "start", "applicant_id": "00000000-0000-4000-8000-000000000000", "team": "cna"})
ok(f"starting a pay track refuses anyone not signed in to the Hub ({s3})") if s3 in (401, 403) else bad(f"prn-team answered a stranger {s3}: {b3[:120]}")
say("  · tested before deploying: the Hub's offer form against a fake server (pick a team, the team's rate and notes, the pay track starts with that team; Not on a PRN team starts none).")
say()
if L.fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · Once the Hub's offer form update is merged, reload the Hub: an offer can pick PRN CNA Team or PRN Caregiver Team for anyone. Nothing was sent by this step."); done(0)
