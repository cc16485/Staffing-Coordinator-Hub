#!/usr/bin/env python3
# 1205 · STAFFING SERVER · GOHIGHLEVEL READER: REAL KINDS, CALLS, RECORDINGS (2026-10-30, Samantha: "instead of pointing to
# go highlevel only, can you put the text, boicemail, etc right there in the communication tab?")
# Found: ghl-thread read GoHighLevel's message numbers one off, so calls showed as blank texts, texts as emails and emails as
# voicemails. It now reads GoHighLevel's own name for each kind, gives calls their status and length, and lets office staff
# play a call's recording and read its words, for the client profile's Communication tab (and the applicant and caregiver
# texts boxes show the right kinds too).
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the reader's test passes; the gateway setting is read.
#  2. Deploys ghl-thread only.
#  3. Proof: it still refuses anyone not signed in to the office, for messages, recordings and words alike.
# Read only toward GoHighLevel: it never sends, changes or deletes anything there. Texts nobody. Safe to run again.
import json, os, subprocess, shutil, time
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, deploy, start, check_build, fmeta, MG, API

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
if NODE == "none": NODE = ""
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FN = "ghl-thread"
ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpuZ3NnZWRsc3hpbmJ5Z3dteHduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NDIzNDQsImV4cCI6MjA5ODExODM0NH0.L_31_UKdccyRH9n7p1GaBlZTqcJipB008H-GIvxwLxM"
ok = lambda s: say("  ✓ " + s)
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)

start("STAFFING SERVER · GOHIGHLEVEL READER (real kinds, calls, recordings)")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")   # the rehearsal points this at its own commit
if MAIN == "origin/main": run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = [k for k in sorted(set(L.need(FNROOT, FN)))
         if (lambda r: r[0] != 0 or r[1] != open(os.path.join(ROOT, k)).read())(run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"]))]
if drift: stop("this isn't the same as GitHub's main yet (newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE:
    c, o = run([NODE, "ghl_thread_inline_test.mjs"], cwd=ROOT)
    if c != 0 or "19/19" not in o: stop("the reader's test failed: " + " ".join(l.strip() for l in o.splitlines() if "FAIL" in l)[:240])
    ok("the reader's test passes (a fake GoHighLevel only): real kinds, calls, recordings, office staff only")
else: say("  · node is not on this Mac, so the test was not re-run here (19/19 when built)")
s_, m_ = fmeta(REF, FN)
if s_ != 200 or not m_ or "verify_jwt" not in m_: stop(f"couldn't read how {FN} is set up live ({s_})", 3)
VJ = bool(m_["verify_jwt"])
ok(f"the gateway setting is read, so it is kept: {'on' if VJ else 'off'}")

say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, FN, VJ): say("  STOP. Tell Claude. (The texts boxes work as before.)"); done(6)

say(); say("PART 3 · PROOF")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
for label, body in (("messages", {"phone": "4175550100"}), ("a recording", {"recording": "proofonly123"}), ("a call's words", {"transcription": "proofonly123"})):
    s1 = http("POST", f"{FNB}/functions/v1/{FN}", body, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
    (ok if s1 in (401, 403) else bad)(f"it refuses anyone not signed in to the office, for {label} ({s1})")
say()
say("  1205: " + ("DONE. The Communication tab can now play family calls and voicemails and show their words. Tell Claude, and Claude checks it on a real client."
    if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
done(0 if not L.fails else 1)
