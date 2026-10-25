#!/usr/bin/env python3
# 1122 · THE CLIENT PROFILE IN THE BOOKING APP (2026-10-25, Samantha: "Ideally the app works like the client profiles we are
# building to use for call ins/new client shifts... and the family who is using the booking app can see what the caregiver
# sees in a preview as well"; her yes to the picks the same day: Suggest a change goes to the Caregiver Preview tab for
# approval; no approved profile = the basics, never held). Staffing #633 merged.
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data only); the switch
#     app_profile_live is not on.
#  2. Database: one new table, client_profile_suggestions (service role only; no browser access).
#  3. Deploys the six server pieces that use the changed files, each keeping its gateway setting.
#  4. Proves the doors still refuse strangers, and the switch is still off.
# Sends nothing. Every switch left as it is. Safe to run again.
import json, os, subprocess, shutil
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta

HUB = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNS = ["caregiver-preview", "family-gateway", "family-offer", "family-app-office", "family-fee-check", "pilot-readiness"]
TESTS = ("app_profile_test.mjs", "family_app_1a_test.mjs", "family_app_flex_test.mjs", "brands_test.mjs", "caregiver_preview_test.mjs", "cara_p1_test.mjs", "family_signin_test.mjs")
ok = lambda s: say("  ✓ " + s)
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
def switch_on():
    okq, st = sql(HUB, "select data->>'app_profile_live' as v from app_data where key = 'ops_settings'")
    return None if not okq else (st[0]["v"] if st else None) == "true"

start("THE CLIENT PROFILE IN THE BOOKING APP")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
files = sorted(set().union(*[L.need(FNROOT, fn) for fn in FNS]) | {"app_profile_1122.sql"})
drift = [k for k in files if run(["git", "-C", ROOT, "show", f"origin/main:{k}"])[1] != open(os.path.join(ROOT, k)).read()]
if drift: stop("this isn't the same as GitHub's main (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + "). Tell Claude.")
ok("the reviewed build is what is on GitHub's main")
if NODE:
    for t in TESTS:
        c, o = run([NODE, t], cwd=ROOT)
        last = (o.strip().splitlines() or ["(no output)"])[-1]
        if c != 0: stop(f"{t} failed: {last}")
        ok(f"{t}: {last.strip()} (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
on = switch_on()
if on is None: stop("couldn't read the Hub settings", 3)
if on: stop("the switch app_profile_live is already ON. This step only installs with it off. Tell Claude.", 3)
ok("the switch app_profile_live is off (families and caregivers see no change until you turn it on)")
gate = {}
for fn in FNS:
    s, m = fmeta(HUB, fn)
    if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s})", 3)
    gate[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gate[fn] else 'off'} (kept)")

say(); say("PART 2 · CHANGE")
say(); say("1 · THE DATABASE")
okd, out = sql(HUB, open(os.path.join(ROOT, "app_profile_1122.sql")).read())
if not okd: stop("the new table wasn't made: " + str(out)[:200], 4)
okv, chk = sql(HUB, "select (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'client_profile_suggestions') as made, "
    "(select relrowsecurity from pg_class where oid = 'public.client_profile_suggestions'::regclass) as rls, "
    "(select count(*) from information_schema.role_table_grants where table_name = 'client_profile_suggestions' and grantee in ('anon', 'authenticated')) as open_grants")
c = (chk or [{}])[0] if okv else {}
(ok if okv and int(c.get("made", 0)) == 1 and c.get("rls") is True and int(c.get("open_grants", 1)) == 0 else bad)("client_profile_suggestions made; locked to the server (no browser access)")
if L.fails: say("  STOP. Tell Claude. (The table is the only change so far; nothing uses it yet.)"); done(4)
say(); say("2 · THE SERVER PIECES")
for fn in FNS:
    if not deploy(HUB, FNROOT, fn, gate[fn]): say("  STOP. Tell Claude. (Anything above this line is in; the rest is unchanged.)"); done(5)

say(); say("PART 3 · PROOF")
for fn in FNS:
    s, b = http("POST", f"https://{HUB}.supabase.co/functions/v1/{fn}", {"action": "list"})
    (ok if s in (401, 403) else bad)(f"{fn}: a caller with no sign-in gets nothing ({s})")
s, b = http("POST", f"https://{HUB}.supabase.co/functions/v1/family-offer", {"o": "1", "e": "1", "t": "x", "action": "view"})
(ok if s in (400, 401, 403, 404) else bad)(f"family-offer: a made-up offer link opens nothing ({s})")
(ok if switch_on() is False else bad)("the switch app_profile_live is still off")
say()
say("  1122: " + ("DONE. Installed with the switch off: nothing changes for families or caregivers yet. Next: try it in practice, then turn on app_profile_live." if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
done(0 if not L.fails else 1)
