#!/usr/bin/env python3
# 598 · TEST PEOPLE, THE HUB HALF (Samantha 2026-10-11: "Pat Practice should have my phone number and email so I can see what
# happens"; "send everything to me"). Hub project. Deploys outreach-check (tells Training the test list with the switches),
# step2-handoff (the Step 2 message, receipt, reminders and the automatic welcome call invitation) and caregiver-journey (the
# cleared text): each lets a person reachable ONLY at the Admin page's test phones and emails through even while its switch is
# off. Each only when its live copy is main's build or an older version of it. Nobody is on the list yet (599 adds you after
# Training has its half), so nothing changes for anyone today. Nothing is sent.
import os, json, subprocess, hashlib
os.environ.setdefault("SB_STEP", "598")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FNS = ["outreach-check", "step2-handoff", "caregiver-journey"]
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
short = lambda ks: ', '.join(d.split('/')[-2] + '/' + d.split('/')[-1] for d in ks[:4])
start("TEST PEOPLE: THE HUB HALF")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
VJ = {}
for fn in FNS:
    sx, mx = fmeta(REF, fn)
    if not (sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool)): bad(f"{fn} is not live or unreadable: {sx}"); continue
    VJ[fn] = mx["verify_jwt"]
    okl, livef = live_files(REF, fn)
    if not okl: bad(f"could not read {fn}'s live files"); continue
    differ = [k for k in need(FNROOT, fn) if livef.get(k) != sha(os.path.join(ROOT, k))]
    unknown = [k for k in differ if livef.get(k) is not None and not in_history(k, livef.get(k))]
    if unknown: bad(f"{fn}'s live copy holds {short(unknown)} in a version that was never on main (someone's unmerged work); deploying would overwrite it. Tell Claude.")
    else: say(f"  ✓ {fn} is live at version {mx.get('version', '?')}" + (f": brought up to main ({short(differ)})" if differ else ""))
ok_, st = sql(REF, "select coalesce(data->'test_people', '{}'::jsonb) as tp from public.app_data where key = 'ops_settings'")
if ok_ and st: say(f"  · the test list now: {json.dumps(st[0]['tp'])} (599 adds yours)")
say("  · what changes: three services learn the test list. Nothing is sent; no record changes.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, VJ[fn]): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF")
FNB = f"https://{REF}.supabase.co"
s_, b_ = http("POST", f"{FNB}/functions/v1/step2-handoff", {"action": "sent", "candidate_id": "1"}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ Step 2 still refuses a caller with no sign-in ({s_})") if s_ in (401, 403) else bad(f"step2-handoff without a sign-in answered {s_}")
say("  · tested before deploying: the rule (10 checks), Step 2 (46), the readiness server (88), the outreach answers (20 and 10).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the Hub half is in. Run 599 next (Training's half, then your phone and email on the list and on Pat). Nothing was sent."); done(0)
