#!/usr/bin/env python3
# 615 · THE MAIN PROFILE: WHERE THEY ARE (Samantha 2026-10-11: "which steps have been completed, which step the applicant is
# currently on, what information they've submitted, which forms are signed or still outstanding, any missing information or
# required follow-up, what happens next and who is responsible"). Deploys hire-profile with a read-only status built from
# the records it already reads, plus the interview booking. Office staff only, by their own sign-in. It writes nothing and
# sends nothing. Replaced only when the live copy is main's build or an older version of it.
import os, json, subprocess, hashlib
os.environ.setdefault("SB_STEP", "615")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FN = "hire-profile"
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
start("THE MAIN PROFILE: WHERE THEY ARE (READ ONLY)")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
sx, mx = fmeta(REF, FN); VJ = None
if sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool):
    VJ = mx["verify_jwt"]; okl, livef = live_files(REF, FN)
    differ = [k for k in need(FNROOT, FN) if livef.get(k) != sha(os.path.join(ROOT, k))] if okl else []
    unknown = [k for k in differ if livef.get(k) is not None and not in_history(k, livef.get(k))]
    if not okl: bad("could not read hire-profile's live files")
    elif unknown: bad(f"hire-profile's live copy holds {', '.join(unknown[:3])} in a version that was never on main (someone's unmerged work). Tell Claude.")
    else: say(f"  ✓ hire-profile is live at version {mx.get('version', '?')}" + (f": brought up to main ({', '.join(k.split('/')[-1] for k in differ[:4])})" if differ else ": already this build"))
else: bad(f"hire-profile is not live or unreadable: {sx}")
say("  · what changes: hire-profile adds the read-only Their journey status to every main profile. Nothing is sent; no record changes.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, FN, VJ): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent)")
okl, livef = live_files(REF, FN)
say("  ✓ hire-profile is live as tested") if okl and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in need(FNROOT, FN)) else bad("the live copy is not this build")
s_, b_ = http("POST", f"https://{REF}.supabase.co/functions/v1/hire-profile", {"action": "get", "offer_id": "x"}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ hire-profile still answers only office staff signed in ({s_})") if s_ in (401, 403) else bad(f"hire-profile answered {s_} without a sign-in")
say("  · tested before deploying: the status (19: every stage, a no-show, the pool, a declined offer, the old process, a blank never done), the main profile (15), the ten practice applicants (48), and the card offline (9: mid Step 1, Background & References with the readiness card winning, a declined offer).")
say("  · to see it: open any person's 👤 Profile in the Hub; Their journey is the first card.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · every main profile now shows Their journey. Nothing was sent; no record changed."); done(0)
