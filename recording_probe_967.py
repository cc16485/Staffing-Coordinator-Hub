#!/usr/bin/env python3
# 967 · READ ONLY: can the Hub actually get GoHighLevel call recordings? (Samantha 2026-10-18: "verify that our GoHighLevel
# integration can actually retrieve and associate call recordings before building this functionality. Do not assume that
# every call has a recording.")
#  Part 1: the probe is the reviewed build (GitHub's main) and its test passes on fake data.
#  Part 2: puts up the TEMPORARY read-only probe (call-recording-probe; owner key only, checked inside).
#  Part 3: asks it once and writes counts only (day, in/out, seconds, recording yes/no; never names, numbers or audio),
#          then DELETES the probe and confirms it's gone, even if something above went wrong.
# Nothing is written anywhere; every GoHighLevel request is a read. Nothing is texted, emailed or called.
import json, os, subprocess, shutil, time
os.environ.setdefault("SB_STEP", "967")
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, start, check_build, deploy

REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FN = "call-recording-probe"
ok = lambda s: say("  ✓ " + s)
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was put up."); done(code)
def keys():
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_publishable_") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q_ in ("?reveal=true", ""):
        s_, b_ = http("GET", f"{L.API}/v1/projects/{REF}/api-keys{q_}", headers=L.MG())
        if s_ != 200: continue
        try: arr = json.loads(b_)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict)}
        got = {k: v for k, v in got.items() if usable(v)}
        if got.get("anon"): return got
    return {}
def remove_probe():
    http("DELETE", f"{L.API}/v1/projects/{REF}/functions/{FN}", headers=L.MG())
    s2, _ = http("GET", f"{L.API}/v1/projects/{REF}/functions/{FN}", headers=L.MG())
    (ok("the temporary probe is removed") if s2 == 404 else bad(f"the temporary probe is still there ({s2}). Tell Claude."))

start("CAN THE HUB GET GOHIGHLEVEL CALL RECORDINGS? (read only)")
say("PART 1 · READ ONLY")
check_build(FNROOT, SHAS)
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = [k for k in sorted(L.need(FNROOT, FN)) if (lambda c: c[0] != 0 or c[1] != open(os.path.join(ROOT, k)).read())(run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"]))]
if drift: stop("this isn't the same as GitHub's main yet (" + ", ".join(drift)[:200] + "). Tell Claude.")
ok("the probe is the reviewed build on GitHub's main")
if NODE:
    c, o = run([NODE, "recording_probe_967_test.mjs"], cwd=ROOT)
    last = (o.strip().splitlines() or ["(no output)"])[-1]
    if c != 0: stop(f"the probe's test failed: {last}")
    ok(f"recording_probe_967_test.mjs: {last.strip()} (fake data only)")
say()
say("PART 2 · PUT UP THE TEMPORARY PROBE")
if not deploy(REF, FNROOT, FN, False): remove_probe(); say("  RESULT: STOPPED. Tell Claude."); done(4)
K = keys(); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); L.HIDE.extend([ANON, SVC])
try:
    time.sleep(float(os.environ.get("SB_SETTLE", "10")))
    say(); say("PART 3 · THE ANSWER")
    if not SVC: bad("couldn't read the server key, so the probe was not asked")
    else:
        a = http("POST", f"{FNB}/functions/v1/{FN}", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0] if ANON else None
        (ok(f"it refuses the public key ({a})") if a == 401 else bad(f"it did not refuse the public key ({a})"))
        s, b = http("POST", f"{FNB}/functions/v1/{FN}", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, timeout=300)
        try: j = json.loads(b)
        except Exception: j = {}
        if s != 200 or not j.get("ok"): bad(f"the probe didn't answer as expected ({s}): " + str(j.get("error") or b)[:200])
        else:
            say(f"  A · ANSWERED CALLS (last {j['days']} days): {j['calls']} call(s), {j['answered']} answered, {j['missed']} missed.")
            say(f"      Checked the {j['checked']} most recent answered call(s): GoHighLevel returned the audio for {j['with_recording']}.")
            say("      GoHighLevel's answers to 'give me this call's recording': " + (", ".join(f"{n} × {c}" for c, n in sorted(j["recording_answers"].items())) or "none"))
            for r in j["rows"]: say(f"        {r['day']:>7} · {r['direction']:>3} · {r['seconds']:>5}s · {r['status']:<12} · recording: {r['recording']} ({r['answered_with']}) · names who placed it: {'yes' if r['names_user'] else 'no'}")
            say(f"  B · MISSED CALLS: checked {j['missed_checked']}; recordings found: {j['missed_with_recording']}.")
            say(f"  C · 'CALL RINGS YOUR PHONE FIRST' TAPS (last {j['bridge_days']} days): {j['bridge_taps']} tap(s); call found afterward: {j['bridge_found']}; with a recording: {j['bridge_with_recording']}.")
            for r in j["bridge_rows"]: say(f"        {r['day']:>7} · found: {r['found']} · {('' if r['minutes_after_tap'] is None else str(r['minutes_after_tap']) + ' min after the tap · ')}{('' if r['seconds'] is None else str(r['seconds']) + 's · ')}recording: {r['recording']}")
            say("  Call statuses GoHighLevel uses: " + (", ".join(f"{k} × {v}" for k, v in sorted(j["call_statuses"].items())) or "none"))
            say("  Call details GoHighLevel sends: " + (", ".join(j["call_fields"]) or "none"))
            say()
            ra = set(j["recording_answers"])
            if j["checked"] == 0: say("  MEANING (A): no answered calls in the last two weeks to check. Make one real test call on the office line and run 967 again.")
            elif j["with_recording"] == 0 and ra <= {"401", "403"}: say("  MEANING (A): GoHighLevel refused the question itself: the Hub's GoHighLevel key isn't allowed to read recordings. That has to be fixed before coaching calls can be built.")
            elif j["with_recording"] == j["checked"]: say("  MEANING (A): GoHighLevel returned the actual recording for every answered call checked. The Hub can link a coaching call to its recording by its call ID.")
            elif j["with_recording"] == 0: say("  MEANING (A): GoHighLevel returned no recordings. Call recording may be off on the office line (GoHighLevel: Settings, Phone numbers). Coaching calls can't be built until it is on.")
            else: say(f"  MEANING (A): {j['checked'] - j['with_recording']} of {j['checked']} answered calls have no recording. The Hub must check each call and never assume (as planned).")
            say("  MEANING (B): " + ("missed calls have no recording, and the Hub can tell them apart." if j["missed_with_recording"] == 0 else "some missed calls have audio (likely voicemails). The qualifying check must also use talk time and the manager's yes."))
            if j["bridge_taps"] == 0: say("  MEANING (C): nobody used 'Call rings your phone first' in 30 days, so bridged calls are still untested. Tap Call on a test contact (your own cell), talk 30 seconds, and run 967 again.")
            elif j["bridge_found"] == j["bridge_taps"] and j["bridge_with_recording"] == j["bridge_found"]: say("  MEANING (C): every bridged call was found afterward, and each has a recording. Linking a coaching call to its recording works.")
            else: say("  MEANING (C): some bridged calls weren't found or have no recording (an unanswered tap shows as not found). Claude will look at which before building.")
finally:
    remove_probe()
say()
say("RESULT: " + ("DONE · read only; the probe is gone. Tell Claude what the MEANING lines say." if not L.fails else "CHECK THE ✗ LINES ABOVE. Tell Claude."))
done(0 if not L.fails else 8)
