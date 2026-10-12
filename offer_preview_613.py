#!/usr/bin/env python3
# 613 · THE OFFER PAGE PREVIEW (Samantha 2026-10-11: the whole applicant experience in Applicants Journey, "the actual
# applicant-facing screens"). Deploys offer-sign with one new, public, read-only action, "preview": the real offer letter and
# position description for the made-up Pat Preview, with an example rate. It reads and writes no offer and sends nothing.
# Every real offer action is unchanged. Replaced only when the live copy is main's build or an older version of it.
import os, json, subprocess, hashlib
os.environ.setdefault("SB_STEP", "613")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FN = "offer-sign"
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
start("THE OFFER PAGE PREVIEW (READ ONLY, MADE-UP PAT PREVIEW)")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
sx, mx = fmeta(REF, FN); VJ = None
if sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool):
    VJ = mx["verify_jwt"]; okl, livef = live_files(REF, FN)
    differ = [k for k in need(FNROOT, FN) if livef.get(k) != sha(os.path.join(ROOT, k))] if okl else []
    unknown = [k for k in differ if livef.get(k) is not None and not in_history(k, livef.get(k))]
    if not okl: bad("could not read offer-sign's live files")
    elif unknown: bad(f"offer-sign's live copy holds {', '.join(unknown[:3])} in a version that was never on main (someone's unmerged work). Tell Claude.")
    else: say(f"  ✓ offer-sign is live at version {mx.get('version', '?')}" + (f": brought up to main ({', '.join(k.split('/')[-1] for k in differ[:4])})" if differ else ": already this build"))
else: bad(f"offer-sign is not live or unreadable: {sx}")
say("  · what changes: offer-sign gains the read-only preview action the Applicants Journey walkthrough uses. Nothing is sent; no offer changes.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, FN, VJ): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent, nothing is written)")
okl, livef = live_files(REF, FN)
say("  ✓ offer-sign is live as tested") if okl and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in need(FNROOT, FN)) else bad("the live copy is not this build")
def anon():
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        for k in arr:
            v = k.get("api_key", "") if isinstance(k, dict) else ""
            if k.get("name") == "anon" and isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_publishable_")) and "*" not in v: return v
    return ""
A = anon()
if not A: bad("could not read the public key for the proof")
else:
    H = {"apikey": A, "Authorization": "Bearer " + A}
    TRN = "rdqujxiycycwhskyvrwa"
    ok0, r0 = sql(TRN, "select (select count(*) from public.job_offers) as offers, (select count(*) from public.offer_events) as events")
    s1, b1 = http("POST", f"https://{REF}.supabase.co/functions/v1/offer-sign", {"action": "preview"}, H)
    try: j1 = json.loads(b1)
    except Exception: j1 = {}
    say(f"  ✓ the preview answers: the offer letter ({len(j1.get('offer', []))} parts) and position description ({len(j1.get('pd', []))} parts) for {j1.get('first', '?')}") if s1 == 200 and j1.get("preview") and len(j1.get("offer", [])) > 5 and len(j1.get("pd", [])) > 5 else bad(f"the preview answered {s1}: {b1[:160]}")
    ok4, r4 = sql(TRN, "select (select count(*) from public.job_offers) as offers, (select count(*) from public.offer_events) as events")
    say(f"  ✓ no offer or offer event was made or changed ({r4[0]['offers']} offers, {r4[0]['events']} events, before and after)") if ok0 and ok4 and r0 == r4 else bad("the offers or their events changed during the proof")
s_, b_ = http("POST", f"https://{REF}.supabase.co/functions/v1/offer-sign", {"action": "view", "o": "x", "e": 1, "t": "x"}, {"apikey": A, "Authorization": "Bearer " + A} if A else {})
say(f"  ✓ a real offer link is still required for everything else ({s_})") if s_ in (401, 404) else bad(f"a bad link answered {s_}")
say("  · tested before deploying: the offer page server and its preview (33), and the whole walkthrough offline: twelve stages, the offer signed, Step 2 tapped and a call booked inside the previews, only preview actions called (21).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the offer page preview is live (the Applicants Journey walkthrough, once the Hub pull request is merged). Nothing was sent; no offer changed."); done(0)
