#!/usr/bin/env python3
# 1090 · MEDICAID GOES TO CDS, THE SERVER HALF (2026-10-26, her rule and wording: anywhere Caring Companions mentions
# Medicaid, point to Caring Companions Consumer Directed Services, caringcds.com, 417-218-2888).
#  1. Checks first (nothing changes): the reviewed build is GitHub's main.
#  2. Applies medicaid_cds_1090.sql: the intake payer step's how-to gets her staff script (options stay as 910 set them),
#     and Cara's CDS answer N001 names the sister company's number. Deploys lead-nurture (day-260 email). Gateway kept.
#  3. Proves it by reading the live rows back.
# Sends nothing to anyone. The CC Hub switch "Medicaid goes to CDS" stays OFF. Safe to run again.
import json, os, subprocess
import cc_step_lib as L
from cc_step_lib import say, bad, done, start, check_build, fmeta, deploy, sql

HUB = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
FN = "lead-nurture"
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)

start("MEDICAID GOES TO CDS, THE SERVER HALF")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = []
for k in sorted(L.need(FNROOT, FN) | {"medicaid_cds_1090.sql"}):
    c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
    if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
good, r = sql(HUB, "select count(*)::int n from public.client_journey_step_def where key='intake.payer'")
if not good or not r or r[0]["n"] != 1: stop("couldn't find the intake payer step live")
s_, m = fmeta(HUB, FN)
if s_ != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {FN} is set up live ({s_})", 3)
gate = bool(m["verify_jwt"]); say(f"  · {FN} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gate else 'off'} (kept)")

say(); say("PART 2 · CHANGE")
good, r = sql(HUB, open(os.path.join(ROOT, "medicaid_cds_1090.sql")).read())
chk(good, "the payer step how-to and Cara's CDS answer updated", "the SQL did not apply: " + str(r)[:300])
if L.fails: say("  STOP. Nothing else was changed. Tell Claude."); done(4)
if not deploy(HUB, FNROOT, FN, gate): say("  STOP. Tell Claude. (The SQL above is applied; it is safe to run 1090 again.)"); done(5)

say(); say("PART 3 · PROOF")
good, r = sql(HUB, "select def->'howto'->>1 h, def::text like '%Medicaid IHS / HCBS%' old from public.client_journey_step_def where key='intake.payer'")
chk(good and r and "Caring Companions Consumer Directed Services" in (r[0]["h"] or "") and not r[0]["old"], "the payer step shows her script and offers no Medicaid IHS")
good, r = sql(HUB, "select answer from public.kb_items where id='N001'")
if good and r: chk("(417) 218-2888" in r[0]["answer"], "Cara's CDS answer names (417) 218-2888")
else: say("  · Cara's answer N001 isn't in this database (nothing to change)")
say("  · The CC Hub switch 'Medicaid goes to CDS' was not touched. Turn it on in the Hub: Settings, beside Returning clients.")
say(); say("✓ DONE" if not L.fails else "✗ " + str(len(L.fails)) + " problem(s) above. Tell Claude.")
done(0 if not L.fails else 1)
