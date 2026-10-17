#!/usr/bin/env python3
# 899 · THE CARING COMPANIONS BOOKING APP, BY NAME; FAMILY CIRCLE PEOPLE MATCHED BY EMAIL FIRST (2026-10-17, Samantha: "rename it to
# the Caring Companions Booking App everywhere, and match Family Circle people by email first, then name").
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass; the Hub's renamed Care circle screen is live.
#  2. The sign-in email (cc-family-app): subject "Your Caring Companions Booking App sign-in code" and the renamed email. Nothing
#     else about sign-in is touched (who can sign in, the sender, the 15 minutes all stay as they are).
#  3. Deploys the seven server pieces that use the changed files: circles-sync and client-agreement (email first, then name: a
#     renamed AxisCare contact with the same email stays one person), and family-gateway, family-offer, family-app-office,
#     family-fee-check and pilot-readiness (the family messages say "the Booking App"). Each keeps its gateway setting.
#  4. Proves the doors still refuse strangers.
# Sends nothing. No database change. Safe to run again.
import json, os, subprocess, shutil, time
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, MG, deploy, start, check_build, fmeta

HUB = "zngsgedlsxinbygwmxwn"; FAM_NAME = "cc-family-app"
FNROOT = L.FNROOT; ROOT = L.ROOT; API = L.API
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
HUB_SITE = os.environ.get("SB_HUB_SITE", "https://cc.mo-care.com")
FNS = ["circles-sync", "client-agreement", "family-gateway", "family-offer", "family-app-office", "family-fee-check", "pilot-readiness"]
TPL = "family-app/email/code.html"
SUBJECT = "Your Caring Companions Booking App sign-in code"
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
def j(b):
    try: return json.loads(b)
    except Exception: return None

start("THE CARING COMPANIONS BOOKING APP, BY NAME; PEOPLE MATCHED BY EMAIL FIRST")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = []
for k in sorted(set().union(*[L.need(FNROOT, fn) for fn in FNS]) | {TPL}):
    c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
    if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
tpl = open(os.path.join(ROOT, TPL)).read()
if "{{ .Token }}" not in tpl or "Caring Companions Booking App" not in tpl: stop("the sign-in email in the build is missing the code or the app's name")
if NODE:
    for t in ("person_match_test.mjs", "circles_sync_664_test.mjs", "family_app_1a_test.mjs", "family_app_flex_test.mjs", "family_sync_test.mjs", "family_review_test.mjs", "family_app_fee_test.mjs", "brands_test.mjs"):
        c, o = run([NODE, t], cwd=ROOT)
        last = (o.strip().splitlines() or ["(no output)"])[-1]
        if c != 0: stop(f"{t} failed: {last}")
        ok(f"{t}: {last.strip()} (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
ps, pb = http("GET", f"{HUB_SITE}/family-app-panel.js?v={int(time.time())}")
if ps != 200 or "Booking App: on" not in (pb or ""): stop("the Hub's renamed Care circle screen isn't live yet (merge the Hub pull request, wait a minute, run again)", 2)
ok("the Hub's Care circle screen says Booking App")
gate = {}
for fn in FNS:
    s, m = fmeta(HUB, fn)
    if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s})", 3)
    gate[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gate[fn] else 'off'} (kept)")
s, b = http("GET", f"{API}/v1/projects", headers=MG())
fam = next((x for x in (j(b) or []) if isinstance(x, dict) and x.get("name") == FAM_NAME), None) if s == 200 else None
if not fam: stop(f"couldn't find the Booking App's sign-in project ({FAM_NAME}, {s})", 3)
FREF = fam.get("id") or fam.get("ref")
s, b = http("GET", f"{API}/v1/projects/{FREF}/config/auth", headers=MG()); before = j(b) or {}
if s != 200: stop(f"couldn't read the Booking App's sign-in settings ({s})", 3)
say(f"  · the sign-in email's subject today: \"{before.get('mailer_subjects_magic_link')}\"")

say(); say("PART 2 · CHANGE")
say(); say("1 · THE SIGN-IN EMAIL")
s, b = http("PATCH", f"{API}/v1/projects/{FREF}/config/auth", {"mailer_subjects_magic_link": SUBJECT, "mailer_templates_magic_link_content": tpl}, MG())
s2, b2 = http("GET", f"{API}/v1/projects/{FREF}/config/auth", headers=MG()); c = j(b2) or {}
chk(s in (200, 201) and c.get("mailer_subjects_magic_link") == SUBJECT and c.get("mailer_templates_magic_link_content") == tpl,
    f"subject \"{SUBJECT}\"; the email says Caring Companions Booking App", f"the sign-in email wasn't saved ({s}: {str(b)[:200]})")
same = all(c.get(k) == before.get(k) for k in ("disable_signup", "site_url", "mailer_otp_exp", "mailer_otp_length", "smtp_host", "smtp_admin_email"))
chk(same and c.get("disable_signup") is True, "nothing else about sign-in changed (sign-up still off, same sender, same code length and time)", "another sign-in setting looks different now: tell Claude")
if L.fails: say("  STOP. The doors are unchanged. Tell Claude."); done(4)
say(); say("2 · THE DOORS")
for fn in FNS:
    if not deploy(HUB, FNROOT, fn, gate[fn]): say("  STOP. Tell Claude. (Anything above this line is in; the rest is unchanged.)"); done(5)

say(); say("PART 3 · PROOF")
s, b = http("POST", f"{FNB}/functions/v1/family-gateway", {"action": "me"})
chk(s == 401, f"family-gateway: no family sign-in, refused ({s})", f"family-gateway answered a stranger ({s})")
for fn in FNS[:2] + FNS[3:]:
    s, b = http("POST", f"{FNB}/functions/v1/{fn}", {"action": "list"})
    chk(s in (401, 403), f"{fn}: a caller with no sign-in gets nothing ({s})", f"{fn} answered a stranger ({s})")
say()
say("  899: " + ("DONE. Family messages and the sign-in email now say the Caring Companions Booking App, and a Family Circle person is matched by email first. Next: Claude publishes the renamed app screens (with your OK)." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
