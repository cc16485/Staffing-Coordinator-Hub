#!/usr/bin/env python3
# 1123 · THE FAMILY'S OWN PROFILE + THE CLIENT'S PHOTO + THE BOOKING APP PAGE (2026-10-25, Samantha: "the family who signs up for the app has access
# to make their profile"; "if the office makes changes to our profile that we use for shifts, dont make it auto change the
# families profile they made for booking app"; "i want a good view of everything that happens in the app"). Staffing #636 merged.
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data only); the switches
#     family_profile_live, client_photo_live and app_activity_live are not on.
#  2. Database: two new tables, family_client_profile and family_app_activity, and a private photo store client-photos
#     (server only; no browser access).
#  3. Deploys the server pieces that use the changed files, each keeping its gateway setting (one never put live is left alone).
#  4. Proves the doors still refuse strangers, and both switches are still off.
# Sends nothing. Every switch left as it is. From now on the Hub records when a family member opens the app (for the page).
# Safe to run again.
import json, os, subprocess, shutil
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta

HUB = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNS = ["caregiver-preview", "family-gateway", "family-offer", "family-app-office", "family-fee-check", "pilot-readiness"]
# (caregiver_preview_test and cara_p1_test read a Hub folder beside this one, so they run when built, not here)
TESTS = ("family_profile_test.mjs", "app_profile_test.mjs", "family_app_1a_test.mjs", "family_app_flex_test.mjs", "brands_test.mjs", "family_signin_test.mjs")
ok = lambda s: say("  ✓ " + s)
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
LAST = {"why": ""}
def switch_on():
    okq, st = sql(HUB, "select coalesce(data->>'family_profile_live', '') || '|' || coalesce(data->>'app_activity_live', '') || '|' || coalesce(data->>'client_photo_live', '') as v from app_data where key = 'ops_settings'")
    if not okq: LAST["why"] = str(st)[:200]
    return None if not okq else "true" in (st[0]["v"] if st else "")

start("THE FAMILY'S OWN PROFILE + THE BOOKING APP PAGE")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
files = sorted(set().union(*[L.need(FNROOT, fn) for fn in FNS]) | {"family_profile_1123.sql"})
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
if on is None: stop("couldn't read the Hub settings. Supabase answered: " + (LAST["why"] or "nothing") + ". If it mentions the token (unauthorized, invalid or expired), make a new access token and run again.", 3)
if on: stop("family_profile_live, client_photo_live or app_activity_live is already ON. This step only installs with them off. Tell Claude.", 3)
ok("family_profile_live, client_photo_live and app_activity_live are off (nobody sees a change until you turn them on)")
gate = {}
for fn in FNS:
    s, m = fmeta(HUB, fn)
    if s == 404: say(f"  · {fn} isn't live (never put live), so it is left alone"); continue
    if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s})", 3)
    gate[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gate[fn] else 'off'} (kept)")

say(); say("PART 2 · CHANGE")
say(); say("1 · THE DATABASE")
okd, out = sql(HUB, open(os.path.join(ROOT, "family_profile_1123.sql")).read())
if not okd: stop("the new tables weren't made: " + str(out)[:200], 4)
for t in ("family_client_profile", "family_app_activity"):
    okv, chk = sql(HUB, f"select (select count(*) from information_schema.tables where table_schema = 'public' and table_name = '{t}') as made, "
        f"(select relrowsecurity from pg_class where oid = 'public.{t}'::regclass) as rls, "
        f"(select count(*) from information_schema.role_table_grants where table_name = '{t}' and grantee in ('anon', 'authenticated')) as open_grants")
    c = (chk or [{}])[0] if okv else {}
    (ok if okv and int(c.get("made", 0)) == 1 and c.get("rls") is True and int(c.get("open_grants", 1)) == 0 else bad)(f"{t} made; locked to the server (no browser access)")
okb, bk = sql(HUB, "select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'client-photos'")
b0 = (bk or [{}])[0] if okb else {}
(ok if okb and b0.get("public") is False and int(b0.get("file_size_limit") or 0) == 409600 else bad)("client-photos photo store made; private (no public links)")
okc, cols = sql(HUB, "select count(*) as n from information_schema.columns where table_name = 'family_client_profile' and column_name like 'photo_%'")
(ok if okc and int((cols or [{}])[0].get("n", 0)) == 5 else bad)("the photo columns are on family_client_profile")
if L.fails: say("  STOP. Tell Claude. (The tables are the only change so far; nothing uses them yet.)"); done(4)
say(); say("2 · THE SERVER PIECES")
for fn in [f for f in FNS if f in gate]:
    if not deploy(HUB, FNROOT, fn, gate[fn]): say("  STOP. Tell Claude. (Anything above this line is in; the rest is unchanged.)"); done(5)

say(); say("PART 3 · PROOF")
for fn in [f for f in FNS if f in gate]:
    s, b = http("POST", f"https://{HUB}.supabase.co/functions/v1/{fn}", {"action": "list"})
    (ok if s in (401, 403) else bad)(f"{fn}: a caller with no sign-in gets nothing ({s})")
s, b = http("POST", f"https://{HUB}.supabase.co/functions/v1/family-offer", {"o": "1", "e": "1", "t": "x", "action": "view"})
(ok if s in (400, 401, 403, 404) else bad)(f"family-offer: a made-up offer link opens nothing ({s})")
(ok if switch_on() is False else bad)("family_profile_live, client_photo_live and app_activity_live are still off")
say()
say("  1123: " + ("DONE. Installed with all three switches off. Next: turn on app_activity_live to see the Booking App page (owners see it already), family_profile_live when you want families to write their profile, and client_photo_live for photos." if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
done(0 if not L.fails else 1)
