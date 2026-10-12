#!/usr/bin/env python3
# 633 · THREE WATCHERS CHECK THE CALLER FIRST (Samantha 2026-10-12: "go ahead and fix older tests"). The J1 lock test
# found carematch-watch, coverage-watch and timekeeper-watch read the paused/ended client list BEFORE checking who was
# calling (since Pause care, 498). A refused caller got nothing back, but the rule is: refused before anything is read.
# The one line now runs after the check. This step puts ONLY that change live: if the live copy differs from what main
# had before the change in any other way, it stops (nothing unreleased goes out by accident). Nothing is sent.
import os, json
os.environ.setdefault("SB_STEP", "633")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FNS = ["carematch-watch", "coverage-watch", "timekeeper-watch"]
BEFORE = json.loads(os.environ.get("SB_BEFORE_SHAS", "{}"))
KNOWN_578 = {"_shared/events.ts", "_shared/verbs.js"}
start("THREE WATCHERS CHECK THE CALLER FIRST")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
meta = {}
for fn in FNS:
    sx, mx = fmeta(REF, fn); meta[fn] = mx if isinstance(mx, dict) else {}
    if sx != 200: bad(f"{fn} is not live: {sx}"); continue
    okl, livef = live_files(REF, fn)
    if not okl: bad(f"{fn}: could not read the live copy"); continue
    drift = [k for k, h in livef.items() if BEFORE.get(f"{fn}::{k}") and BEFORE[f"{fn}::{k}"] != h]
    extra = [k for k in livef if f"{fn}::{k}" not in BEFORE]
    # the one known difference: 578's shared record helper (events.ts + verbs.js), live in 11 functions since Oct 11
    # (Desktop 578 ran 2026-10-11 02:43 UTC); a function 578 didn't redeploy still carries the older one
    known = [k for k in drift + extra if k in KNOWN_578]
    drift = [k for k in drift if k not in KNOWN_578]; extra = [k for k in extra if k not in KNOWN_578]
    if known and not (drift or extra): say(f"  · {fn} also brings the shared record helper from 578 ({', '.join(known)}), live in 11 other functions since Oct 11")
    if drift or extra: bad(f"{fn}: the live copy is not what main had before this change ({', '.join(drift + extra)[:200]}); stopping so nothing unreleased goes live")
    else: say(f"  ✓ {fn} (version {meta[fn].get('version', '?')}) matches main before this change; {'the moved line and the 578 helper go live' if known else 'only the moved line goes live'}")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, meta[fn].get("verify_jwt", True)): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent)")
for fn in FNS:
    okl, livef = live_files(REF, fn)
    say(f"  ✓ {fn} is live as tested") if okl and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in need(FNROOT, fn)) else bad(f"{fn}: the live copy is not this build")
    s4, b4 = http("POST", f"https://{REF}.supabase.co/functions/v1/{fn}?dry=1", {}, {})
    say(f"  ✓ {fn} refuses a stranger ({s4})") if s4 in (401, 403) else bad(f"{fn} answered a stranger: {s4}")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the three watchers check who is calling before they read anything. Nothing was sent."); done(0)
