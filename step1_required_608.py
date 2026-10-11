#!/usr/bin/env python3
# 608 · STEP 1: EVERY MATCHING ANSWER REQUIRED (Samantha 2026-10-11, station 2: "everything needs to be required"). Deploys
# step1-sign: a form signs only when every row of the two yes/no grids (client population, comfortable with) is answered,
# every day of the week has a time or Not available, a shift choice is made, the nights are given when overnights are
# chosen, and the other language is named when chosen. Answers already saved stay. Replaced only when the live copy is
# main's build or an older version of it. Nothing is sent; no record changes.
import os, json, subprocess, hashlib
os.environ.setdefault("SB_STEP", "608")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FN = "step1-sign"
_HIST = {}
def in_history(rel, live_sha):
    if not live_sha: return False
    if rel not in _HIST:
        shas = set()
        try:
            for c in subprocess.run(["git", "-C", ROOT, "log", "--format=%H", "--", rel], capture_output=True, text=True, timeout=120).stdout.split():
                b = subprocess.run(["git", "-C", ROOT, "show", f"{c}:{rel}"], capture_output=True, timeout=60).stdout
                if b: shas.add(hashlib.sha256(b).hexdigest())
        except Exception: pass
        _HIST[rel] = shas
    return live_sha in _HIST[rel]
start("STEP 1: EVERY MATCHING ANSWER REQUIRED")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
sx, mx = fmeta(REF, FN); VJ = None
if sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool):
    VJ = mx["verify_jwt"]; okl, livef = live_files(REF, FN)
    differ = [k for k in need(FNROOT, FN) if livef.get(k) != sha(os.path.join(ROOT, k))] if okl else []
    unknown = [k for k in differ if livef.get(k) is not None and not in_history(k, livef.get(k))]
    if not okl: bad("could not read step1-sign's live files")
    elif unknown: bad(f"step1-sign's live copy holds {', '.join(unknown[:3])} in a version that was never on main (someone's unmerged work). Tell Claude.")
    else: say(f"  ✓ step1-sign is live at version {mx.get('version', '?')}" + (f": brought up to main ({', '.join(k.split('/')[-1] for k in differ[:4])})" if differ else ": already this build"))
else: bad(f"step1-sign is not live or unreadable: {sx}")
say("  · what changes: step1-sign requires every row, every day and a shift choice before the availability and experience forms sign. Nothing is sent; no record changes.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, FN, VJ): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent)")
okl, livef = live_files(REF, FN)
say("  ✓ step1-sign is live with the every-answer rule") if okl and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in need(FNROOT, FN)) else bad("the live copy is not this build")
s_, b_ = http("POST", f"https://{REF}.supabase.co/functions/v1/step1-sign", {"action": "view", "o": "x", "e": 1, "t": "x"}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ step1-sign answers ({s_})") if s_ and s_ < 500 else bad(f"step1-sign answered {s_}")
say("  · tested before deploying: Step 1 signing (72: partial week, overnights without nights, and one row of each grid all refused; the full form signs), the practice SSN (5), the main profile (14), the training walkthrough (35).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the availability and experience forms now need every answer before they sign. Nothing was sent."); done(0)
