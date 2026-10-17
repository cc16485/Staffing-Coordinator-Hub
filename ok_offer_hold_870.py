#!/usr/bin/env python3
# 870 · OKLAHOMA OFFERS HELD BY THE SERVER (2026-10-16, Samantha: "Approve the Oklahoma hiring plan with all 9 decisions as you
# recommended." Plan https://claude.ai/artifact/PisCGB4DRxT7Z9Za2AoMup, build step 1).
# Today only the Hub's button stops an Oklahoma offer; the Training Platform's job-offer would save and send a Missouri-law
# offer if it were ever called directly. This step:
#  1. Deploys outreach-check (Hub): its onboarding-path answer now says which office (MO or OK) the person's latest
#     application belongs to, by the same rule as the Oklahoma message hold.
#  2. Deploys job-offer (Training Platform): it names the person when it asks, and refuses an Oklahoma offer
#     (nothing saved, nothing sent, nothing in AxisCare). The Hub goes first, so job-offer is never live without its answer.
#  3. Proves both live copies are the reviewed build and both doors still refuse strangers.
# No database change. No switch. Turns NOTHING on. Missouri offers work exactly as before. Safe to run again.
import json, os, subprocess, shutil
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sha, deploy, start, check_build, fmeta

HUB = "zngsgedlsxinbygwmxwn"; TRAIN = "rdqujxiycycwhskyvrwa"
FNROOT = L.FNROOT; ROOT = L.ROOT
TFNROOT = os.environ.get("SB_TRAIN_FNROOT", ""); TROOT = os.path.dirname(os.path.dirname(TFNROOT)) if TFNROOT else ""
SHAS = json.loads(os.environ.get("SB_SHAS", "{}")); TSHAS = json.loads(os.environ.get("SB_TRAIN_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
HUB_FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co"); TRAIN_FNB = os.environ.get("SB_TRAIN_FN_BASE", f"https://{TRAIN}.supabase.co")
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg): bad(msg); say("  STOP. Nothing was changed."); done(2)

start("OKLAHOMA OFFERS HELD BY THE SERVER")
say("PART 1 · READ ONLY (nothing changes)")
if not TFNROOT or not os.path.isdir(TFNROOT): stop("the Training Platform build isn't on this Mac")
check_build(FNROOT, SHAS); check_build(TFNROOT, TSHAS)
# Run only once both pull requests are merged: every file each function uses must match GitHub's main, so nobody's newer work is undone.
for root, fn, ref_env in ((ROOT, "outreach-check", "SB_MAIN_REF"), (TROOT, "job-offer", "SB_TRAIN_MAIN_REF")):
    MAIN = os.environ.get(ref_env, "origin/main")   # rehearsals point this at the rehearsal copy's own commit
    if MAIN.startswith("origin/"): run(["git", "-C", root, "fetch", "-q", "origin", "main"])
    drift = []
    for k in sorted(L.need(os.path.join(root, "supabase", "functions"), fn)):
        c2, b2 = run(["git", "-C", root, "show", f"{MAIN}:{k}"])
        if c2 != 0 or b2 != open(os.path.join(root, k)).read(): drift.append(k)
    if drift: stop(f"{fn} isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
    ok(f"{fn}: the reviewed build is what is on GitHub's main")
if NODE:
    for root, t in ((ROOT, "ok_offer_hold_test.mjs"), (TROOT, "ok_offer_hold_test.mjs"), (TROOT, "lpn_hiring_709_test.mjs"), (TROOT, "job_offer_1c_test.mjs")):
        p = subprocess.run([NODE, t], cwd=root, capture_output=True, text=True)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0: stop(f"{t} failed: {last}")
        ok(f"{os.path.basename(root) if root == TROOT else 'Hub'} {t}: {last.strip()} (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
# keep each function's gateway setting exactly as it is live today
gate = {}
for ref, fn in ((HUB, "outreach-check"), (TRAIN, "job-offer")):
    s, m = fmeta(ref, fn)
    if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s})")
    gate[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gate[fn] else 'off'} (kept)")

say(); say("PART 2 · CHANGE")
say(); say("1 · THE HUB'S ANSWER (outreach-check), FIRST")
if not deploy(HUB, FNROOT, "outreach-check", gate["outreach-check"]): say("  STOP. Nothing else was changed; job-offer is untouched. Tell Claude."); done(5)
say(); say("2 · THE OFFER DOOR (Training Platform job-offer)")
if not deploy(TRAIN, TFNROOT, "job-offer", gate["job-offer"]):
    say("  STOP. The Hub's answer is in (harmless on its own: it only adds the office to an answer); job-offer is unchanged. Tell Claude."); done(5)

say(); say("PART 3 · PROOF")
s, b = http("POST", f"{HUB_FNB}/functions/v1/outreach-check", {"onboarding_path": True, "phone": "4055550180"})
chk(s == 401, "outreach-check: a caller with no Hub sign-in gets nothing (401)", f"outreach-check answered a stranger ({s})")
s, b = http("POST", f"{TRAIN_FNB}/functions/v1/job-offer", {"offer": {"first_name": "X", "last_name": "Y", "phone": "4055550180"}})
chk(s in (401, 403), f"job-offer: a caller with no sign-in gets nothing ({s})", f"job-offer answered a stranger ({s})")
say()
say("  870: " + ("DONE. An Oklahoma applicant now gets no offer even if the Hub button were bypassed: \"Oklahoma offers are not set up yet\". Missouri offers are unchanged. Nothing was switched on or sent." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
