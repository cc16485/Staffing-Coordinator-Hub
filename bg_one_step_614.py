#!/usr/bin/env python3
# 614 · THE BACKGROUND NOTICE, ONE STEP (Samantha 2026-10-11: "we are not required to make the background check a two step
# process", then "cut the background notice to one step"). Deploys bg-review: the office picks the review result and sends
# ONE notice; "Something came up" and the 5 business day response period are retired (those actions refuse and send
# nothing). Waiting on a Good Cause Waiver still holds the notice. Replaced only when the live copy is main's build or an
# older version of it. Nothing is sent; no record changes.
import os, json, subprocess, hashlib
os.environ.setdefault("SB_STEP", "614")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FN = "bg-review"
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
start("THE BACKGROUND NOTICE, ONE STEP")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
sx, mx = fmeta(REF, FN); VJ = None
if sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool):
    VJ = mx["verify_jwt"]; okl, livef = live_files(REF, FN)
    differ = [k for k in need(FNROOT, FN) if livef.get(k) != sha(os.path.join(ROOT, k))] if okl else []
    unknown = [k for k in differ if livef.get(k) is not None and not in_history(k, livef.get(k))]
    if not okl: bad("could not read bg-review's live files")
    elif unknown: bad(f"bg-review's live copy holds {', '.join(unknown[:3])} in a version that was never on main (someone's unmerged work). Tell Claude.")
    else: say(f"  ✓ bg-review is live at version {mx.get('version', '?')}" + (f": brought up to main ({', '.join(k.split('/')[-1] for k in differ[:4])})" if differ else ": already this build"))
else: bad(f"bg-review is not live or unreadable: {sx}")
ok_, r_ = sql(REF, "select count(*) filter (where status in ('open','waiting_waiver'))::int as open_n, count(*) filter (where status in ('open','waiting_waiver') and (step1_at is not null or step1_told_at is not null))::int as told_n from public.bg_reviews")
if ok_ and r_: say(f"  · background reviews open now: {r_[0]['open_n']} ({r_[0]['told_n']} already told under the old two steps; their notice is available as soon as a result is picked)")
say("  · what changes: one notice per review. \"Something came up\" and the 5 business day wait are retired. Nothing is sent by this step; no record changes.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, FN, VJ): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent)")
okl, livef = live_files(REF, FN)
say("  ✓ bg-review is live with the one-step notice") if okl and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in need(FNROOT, FN)) else bad("the live copy is not this build")
s_, b_ = http("POST", f"https://{REF}.supabase.co/functions/v1/bg-review", {"action": "step1", "id": "x"}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ bg-review answers ({s_})") if s_ and s_ < 500 else bad(f"bg-review answered {s_}")
say("  · tested before deploying: bg-review 67 checks (one step: the notice right after a result, Something came up refuses, waiver hold, no texts, GoHighLevel down, double press).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the background notice is one step. Nothing was sent."); done(0)
