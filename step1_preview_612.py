#!/usr/bin/env python3
# 612 · THE STEP 1 PREVIEW (Samantha 2026-10-11: "click through the screens as though I were the caregiver, using practice
# data, before approving them for real hires"). Deploys step1-sign with one new, public, read-only action, "preview": the
# forms as a caregiver sees them for the made-up Pat Preview, the same required-answer check, and preview PDFs marked
# PREVIEW ONLY. It reads and writes no record and sends nothing. Every real Step 1 action is unchanged. Replaced only when
# the live copy is main's build or an older version of it.
import os, json, subprocess, hashlib
os.environ.setdefault("SB_STEP", "612")
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
start("THE STEP 1 PREVIEW (READ ONLY, MADE-UP PAT PREVIEW)")
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
say("  · what changes: step1-sign gains the read-only preview action the Applicants Journey tab uses. Nothing is sent; no record changes.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, FN, VJ): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent, nothing is written)")
okl, livef = live_files(REF, FN)
say("  ✓ step1-sign is live as tested") if okl and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in need(FNROOT, FN)) else bad("the live copy is not this build")
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
    ok0, r0 = sql(REF, "select count(*) as n from public.step1_forms")
    s1, b1 = http("POST", f"https://{REF}.supabase.co/functions/v1/step1-sign", {"action": "preview"}, H)
    try: j1 = json.loads(b1)
    except Exception: j1 = {}
    say(f"  ✓ the preview answers: {len(j1.get('forms', []))} forms for {j1.get('who', {}).get('first', '?')} {j1.get('who', {}).get('last', '?')}") if s1 == 200 and j1.get("preview") and len(j1.get("forms", [])) == 7 else bad(f"the preview answered {s1}: {b1[:160]}")
    s2, b2 = http("POST", f"https://{REF}.supabase.co/functions/v1/step1-sign", {"action": "preview", "check": True, "form": "employee_application", "answers": {}}, H)
    try: j2 = json.loads(b2)
    except Exception: j2 = {}
    say(f"  ✓ the preview check lists {len(j2.get('missing', []))} unanswered questions on an empty application") if s2 == 200 and len(j2.get("missing", [])) > 3 else bad(f"the preview check answered {s2}: {b2[:160]}")
    s3, b3 = http("POST", f"https://{REF}.supabase.co/functions/v1/step1-sign", {"action": "preview", "pdf": True, "form": "fcra_disclosure", "answers": {}}, H)
    try: j3 = json.loads(b3)
    except Exception: j3 = {}
    say("  ✓ a preview PDF comes back") if s3 == 200 and str(j3.get("pdf_base64", "")).startswith("JVBER") else bad(f"the preview PDF answered {s3}")
    ok4, r4 = sql(REF, "select count(*) as n from public.step1_forms")
    say(f"  ✓ no Step 1 record was made or changed ({r4[0]['n']} before and after)") if ok0 and ok4 and r0[0]["n"] == r4[0]["n"] else bad("the Step 1 record count changed during the proof")
s_, b_ = http("POST", f"https://{REF}.supabase.co/functions/v1/step1-sign", {"action": "view", "o": "x", "e": 1, "t": "x"}, {"apikey": A, "Authorization": "Bearer " + A} if A else {})
say(f"  ✓ a real Step 1 link is still required for everything else ({s_})") if s_ in (401, 404) else bad(f"a bad link answered {s_}")
say("  · tested before deploying: Step 1 signing and the preview (79), Step 1 experience and references (46), the forms (25), and on a phone: every preview screen filled, signed and its PDF (10), the Step 1 screens (27, 19, 8).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the Step 1 preview is live (Applicants Journey tab, once the Hub pull request is merged). Nothing was sent; no record changed."); done(0)
