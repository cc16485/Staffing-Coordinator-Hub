#!/usr/bin/env python3
# 891 · THE PILOT WELCOME (2026-10-17, Samantha: "The welcome wording is approved (keep the pilot line)"; draft
# https://claude.ai/artifact/A292b1bNQCicg4Yy7id8dS). Deploys family-app-office: the Hub's invite preview now shows the approved
# welcome ("request an extra one", how requests work, and in the email the pilot line). The office still reads it and presses
# Send for each family; nothing goes out by itself. No database change. Safe to run again.
import json, os, subprocess, shutil
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, deploy, start, check_build, fmeta

HUB = "zngsgedlsxinbygwmxwn"; FN = "family-app-office"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
ok = lambda s: say("  ✓ " + s)
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)

start("THE PILOT WELCOME")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = []
for k in sorted(L.need(FNROOT, FN)):
    c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
    if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE:
    for t in ("brands_test.mjs", "family_app_1a_test.mjs"):
        p = subprocess.run([NODE, t], cwd=ROOT, capture_output=True, text=True)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0: stop(f"{t} failed: {last}")
        ok(f"{t}: {last.strip()} (fake data only; includes your approved words, word for word)")
s, m = fmeta(HUB, FN)
if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {FN} is set up live ({s})", 3)
gate = bool(m["verify_jwt"]); say(f"  · {FN} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gate else 'off'} (kept)")

say(); say("PART 2 · CHANGE")
if not deploy(HUB, FNROOT, FN, gate): say("  STOP. Tell Claude."); done(5)

say(); say("PART 3 · PROOF")
s, b = http("POST", f"{FNB}/functions/v1/{FN}", {"action": "list"})
(ok if s in (401, 403) else bad)(f"{FN}: a caller with no Hub sign-in gets nothing ({s})")
say()
say("  891: " + ("DONE. Invite a family from their Care circle card: the preview shows the approved welcome; read it, then press Send." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
