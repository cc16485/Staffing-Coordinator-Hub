#!/usr/bin/env python3
# 601 · ORIENTATION VIDEO CALL (Samantha 2026-10-11 chose the name for the hiring "welcome call"). Puts the new words live in
# the texts and emails: the Hub's welcome-call (invite, moved, missed, opening now), interview-messages (booked, day-before,
# hour-before), step2-handoff (the Step 2 message and receipt), caregiver-profile, hire-profile, outreach-check and
# caregiver-journey, and Training's job-offer (the Step 1 receipt and the start welcome). Wording only: no rule, switch, schedule
# or record changes; links already sent keep working. Run after the Hub change is merged (the journey check reads the live Hub
# pages). Each service is replaced only when its live copy is main's build or an older version of it. Nothing is sent.
import os, json, subprocess, hashlib, tempfile, time, shutil, re
os.environ.setdefault("SB_STEP", "601")
from cc_step_lib import *
HUB = "zngsgedlsxinbygwmxwn"; TRN = "rdqujxiycycwhskyvrwa"; HUBWEB = "https://cc.mo-care.com/"
FNS = ["welcome-call", "interview-messages", "step2-handoff", "caregiver-profile", "hire-profile", "outreach-check", "caregiver-journey"]
TR_FNROOT = os.environ.get("SB_TR_FNROOT", ""); TR_ROOT = os.path.dirname(os.path.dirname(TR_FNROOT)) if TR_FNROOT else ""
_HIST = {}
def in_history(root, rel, live_sha):
    if not live_sha: return False
    key = (root, rel)
    if key not in _HIST:
        shas = set()
        try:
            for c in subprocess.run(["git", "-C", root, "log", "--format=%H", "--", rel], capture_output=True, text=True, timeout=120).stdout.split():
                b = subprocess.run(["git", "-C", root, "show", f"{c}:{rel}"], capture_output=True, timeout=60).stdout
                if b: shas.add(hashlib.sha256(b).hexdigest())
        except Exception: pass
        _HIST[key] = shas
    return live_sha in _HIST[key]
short = lambda ks: ', '.join(d.split('/')[-2] + '/' + d.split('/')[-1] for d in ks[:4])
start("ORIENTATION VIDEO CALL: THE NEW WORDS IN THE MESSAGES")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
if not (TR_FNROOT and os.path.isdir(TR_FNROOT)): bad("the Training Platform's reviewed copy is missing"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
check_build(TR_FNROOT, json.loads(os.environ.get("SB_TR_SHAS", "{}")))
PLAN = []
for ref, fnroot, root, fn in [(HUB, FNROOT, ROOT, f) for f in FNS] + [(TRN, TR_FNROOT, TR_ROOT, "job-offer")]:
    where = "Training" if ref == TRN else "Hub"
    sx, mx = fmeta(ref, fn)
    if not (sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool)): bad(f"{where} {fn} is not live or unreadable: {sx}"); continue
    okl, livef = live_files(ref, fn)
    if not okl: bad(f"could not read {where} {fn}'s live files"); continue
    differ = [k for k in need(fnroot, fn) if livef.get(k) != sha(os.path.join(root, k))]
    unknown = [k for k in differ if livef.get(k) is not None and not in_history(root, k, livef.get(k))]
    if unknown: bad(f"{where} {fn}'s live copy holds {short(unknown)} in a version that was never on main (someone's unmerged work); replacing it would overwrite that. Tell Claude."); continue
    PLAN.append((ref, fnroot, fn, mx["verify_jwt"], where))
    say(f"  ✓ {where} {fn} is live at version {mx.get('version', '?')}" + (f": brought up to main ({short(differ)})" if differ else ": already this build"))
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if NODE and not fails:
    tmpd = tempfile.mkdtemp(prefix="ovc601-"); got = {}
    for name in ("applicant-journey.js", "index.html", "caregivers-engine.js", "welcome.html", "tests/journey-check.mjs"):
        s_, b_ = http("GET", HUBWEB + name + "?v=" + str(int(time.time())))
        if s_ != 200: bad(f"couldn't download {name} from the Hub ({s_}). Merge the Hub change first. Nothing was changed."); done(2)
        dst = os.path.join(tmpd, name); os.makedirs(os.path.dirname(dst), exist_ok=True); open(dst, "w", encoding="utf-8").write(b_); got[name] = dst
    if "Orientation Video Call" not in open(got["welcome.html"], encoding="utf-8").read(): bad("the live booking page does not say Orientation Video Call yet: merge the Hub change (and give it a minute), then run this again."); done(2)
    env = dict(os.environ, JC_JOURNEY=got["applicant-journey.js"], JC_SOURCES=":".join([got["index.html"], got["caregivers-engine.js"],
               os.path.join(FNROOT), os.path.join(ROOT, "orientation-booking.html"), TR_FNROOT]))
    p = subprocess.run([NODE, got["tests/journey-check.mjs"]], cwd=tmpd, capture_output=True, text=True, env=env)
    last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
    if p.returncode != 0: bad("the journey check failed: " + " | ".join(l.strip() for l in p.stdout.splitlines() if l.strip())[:600]); say("  STOP. Nothing was changed."); done(2)
    say(f"  ✓ the journey check: {last.strip()} (the Applicant journey page matches every real message; no em dashes)")
elif not NODE: say("  · node is not on this Mac, so the journey check was not re-run here (it passed when built)")
say("  · what changes: the words in eight services' messages. No rule, switch, schedule or record changes. Nothing is sent.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
for ref, fnroot, fn, vj, where in PLAN:
    if not deploy(ref, fnroot, fn, vj): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent)")
FNB = f"https://{HUB}.supabase.co"
s_, b_ = http("POST", f"{FNB}/functions/v1/welcome-call", {"action": "list"}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ the Orientation Video Call service still refuses a caller with no sign-in ({s_})") if s_ in (401, 403) else bad(f"welcome-call without a sign-in answered {s_}")
for ref, fnroot, fn, vj, where in PLAN:
    okl, livef = live_files(ref, fn); root = os.path.dirname(os.path.dirname(fnroot))
    good = okl and all(livef.get(k) == sha(os.path.join(root, k)) for k in need(fnroot, fn))
    say(f"  ✓ {where} {fn} is live with the new words") if good else bad(f"{where} {fn}: the live copy is not this build")
say("  · tested before deploying: the journey check (4 of 4), the Hub server tests touching these messages (992 checks, same as before the change), Training's texts, orientation link and profile tests (164), the Hub page tests (1297, same as before) and the Owners Hub switches.")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · new hires now read Orientation Video Call in every text and email. Nothing was sent; nothing else changed."); done(0)
