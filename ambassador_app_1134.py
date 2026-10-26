#!/usr/bin/env python3
# 1134 · STAFFING SERVER · COMMUNITY AMBASSADOR APPLICATIONS (Samantha approved step 1, 2026-10-26).
# lead-intake learns the mo-care.com/ambassadors application: it becomes ONE Referral Partner Desk record (type Community
# Ambassador, status applied), never a lead; healthcare work is flagged for the owners; the owners get one email.
# Nothing is sent to the applicant, no mailing address is kept, and nothing is about money.
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; lists any other merged files the live
#     lead-intake will pick up; the tests pass (fake data only); how many partners have a code yet (none until the Hub step).
#  2. Re-deploys lead-intake only, gateway setting kept (off: the public form can't sign in). No database change.
#  3. Proves it: a caller with the wrong key gets nothing; a bot submission saves nothing; no inquiry was added.
# Safe to run again.
import json, os, subprocess, shutil, time, hashlib
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta, live_files

REF = HUB = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
BASE = os.environ.get("SB_BASE", "")            # the main commit this was built on
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
if NODE == "none": NODE = ""
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
FN = "lead-intake"
CHANGED = {"supabase/functions/lead-intake/index.ts", "supabase/functions/_shared/ambassador-app.ts"}
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None, env=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True, env=env); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
def lead_count():
    okq, r = sql(HUB, "select coalesce(jsonb_array_length(data), 0) as n from app_data where key = 'leads'")
    return int(r[0]["n"]) if okq and r else None

start("STAFFING SERVER · COMMUNITY AMBASSADOR APPLICATIONS (never a lead)")
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
    for t, must in (("ambassador_app_test.mjs", "21/21"), ("partner_links_test.mjs", "33/33"), ("referral_intake_test.mjs", "21/21"), ("app_signup_intake_test.mjs", "6/6")):
        c, o = run([NODE, t], cwd=ROOT)
        if c != 0 or must not in o or "✗" in o: stop(f"the tests failed ({t}): " + " ".join(l.strip() for l in o.splitlines() if "✗" in l)[:240])
    ok("the ambassador application, partner link, web referral and app sign-up tests pass (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
s_, m = fmeta(HUB, FN)
if s_ != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {FN} is set up live ({s_})", 3)
gate = bool(m["verify_jwt"]); say(f"  · {FN} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gate else 'off'} (kept)")
okl, livef = live_files(HUB, FN)
if not okl: stop(f"couldn't download the live {FN} to compare it", 3)
if BASE:
    newer = []
    for k, h in sorted(livef.items()):
        if k in CHANGED: continue                       # this step's own files
        g = subprocess.run(["git", "-C", ROOT, "show", f"{BASE}:{k}"], capture_output=True)
        if g.returncode != 0 or hashlib.sha256(g.stdout).hexdigest() != h: newer.append(k)
    if newer: say("  · the live lead-intake will also pick up these already-merged files from main: " + ", ".join(newer)[:300])
    else: ok("the live lead-intake is the version this step was built on; only this step's files change")
def amb_count():
    okq, pc = sql(HUB, "select count(*) filter (where x->>'program_track' = 'ambassador') as amb from app_data, jsonb_array_elements(case when jsonb_typeof(data) = 'array' then data else '[]'::jsonb end) x where key = 'referral_orgs'")
    return int(pc[0]["amb"]) if okq and pc else None
a0 = amb_count()
say(f"  · ambassador applications saved now: {a0 if a0 is not None else '?'}")
n0 = lead_count()
if n0 is None: stop("couldn't count the inquiries (read only)", 3)
say(f"  · inquiries saved now: {n0}")

say(); say("PART 2 · CHANGE")
if not deploy(HUB, FNROOT, FN, gate): say(f"  STOP at {FN}. Tell Claude."); done(5)

say(); say("PART 3 · PROOF")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
s1, _ = http("POST", f"{FNB}/functions/v1/{FN}?token=wrong", {"kind": "ambassador_application", "first_name": "Proof"})
chk(s1 == 401, f"a caller with the wrong key gets nothing ({s1})", f"{FN} answered a wrong key with {s1}")
tok = os.environ.get("SB_FORM_TOKEN", "")
if tok:
    s2, b2 = http("POST", f"{FNB}/functions/v1/{FN}?token={tok}", {"kind": "ambassador_application", "first_name": "Proof", "last_name": "Bot", "email": "proof@example.com", "town": "Nixa", "website": "bot",
        "agree": {"adult": True, "guidelines": True, "volunteer": True, "privacy": True}})
    chk(s2 == 200 and "lead created" in (b2 or ""), "a bot application is answered politely and dropped", f"the bot proof answered {s2}")
time.sleep(2)
n1 = lead_count()
chk(n1 == n0, f"no inquiry was added by this step ({n1})", f"the inquiry count moved from {n0} to {n1}: tell Claude (a real family may have written in during the step)")
a1 = amb_count()
chk(a1 == a0, f"no ambassador application was added by this step ({a1})", f"the application count moved from {a0} to {a1}: tell Claude")
say()
say("  1134: " + ("DONE. The server takes ambassador applications (never as leads). Next: Claude merges the Hub approval step, then the website page." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
