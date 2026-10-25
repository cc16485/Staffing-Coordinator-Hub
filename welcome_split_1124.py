#!/usr/bin/env python3
# 1124 · TWO WELCOME EMAILS (2026-10-25, Samantha: "please seperate the emails, the one to access axiscare should go
# automatically to everyone in the family circle....the booking app should only be sent manually to those client who we think
# would be interested or be able to turn off the booking app and that means it takes it off the email").
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data only).
#  2. Database: the AxisCare welcome's own record on each family member (people who already got the old welcome with the
#     AxisCare steps count as sent), the client's Booking App on/off, and the switch family_axis_welcome_auto (OFF).
#  3. Deploys family-app-office (the two emails, the Booking App switch) and family-offer (the automatic AxisCare send), each
#     keeping its gateway setting.
#  4. Proof: the doors still refuse strangers, the switch is still off, and a dry run lists who WOULD get the AxisCare email
#     the moment the switch goes on (names only; nothing is sent).
# Sends nothing. Every other switch left as it is. Safe to run again.
import json, os, subprocess, shutil
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta

HUB = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNS = ["family-app-office", "family-offer"]
TESTS = ("family_welcome_alert_test.mjs", "family_app_1a_test.mjs", "family_app_flex_test.mjs", "brands_test.mjs", "app_profile_test.mjs", "family_signin_test.mjs", "audience_guard_test.mjs")
ok = lambda s: say("  ✓ " + s)
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
def switch():
    okq, st = sql(HUB, "select data->>'family_axis_welcome_auto' as v from app_data where key = 'ops_settings'")
    return None if not okq else (st[0]["v"] if st else None)

start("TWO WELCOME EMAILS")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
files = sorted(set().union(*[L.need(FNROOT, fn) for fn in FNS]) | {"welcome_split_1124.sql"})
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
if switch() == "true": stop("the switch family_axis_welcome_auto is already ON. This step only installs with it off. Tell Claude.", 3)
gate = {}
for fn in FNS:
    s, m = fmeta(HUB, fn)
    if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s})", 3)
    gate[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gate[fn] else 'off'} (kept)")

say(); say("PART 2 · CHANGE")
say(); say("1 · THE DATABASE")
okd, out = sql(HUB, open(os.path.join(ROOT, "welcome_split_1124.sql")).read())
if not okd: stop("the database step didn't go in: " + str(out)[:200], 4)
okv, chk = sql(HUB, "select (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'circle_contacts' and column_name like 'axis_welcome_%') as cols, "
    "(select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'care_circles' and column_name like 'booking_app_off_%') as kcols, "
    "(select count(*) from circle_contacts where axis_welcome_sent_at is not null) as already, "
    "(select count(*) from circle_contacts where welcome_sent_at is not null and axis_welcome_sent_at is null) as app_only")
c = (chk or [{}])[0] if okv else {}
(ok if okv and int(c.get("cols", 0)) == 5 and int(c.get("kcols", 0)) == 3 else bad)("the new columns are there (5 on family members, 3 on the client's circle)")
if okv: say(f"  · {c.get('already')} people already had the AxisCare steps in their first welcome (they won't get it again); {c.get('app_only')} got a welcome without them")
(ok if switch() == "false" else bad)("the switch family_axis_welcome_auto is there and OFF")
if L.fails: say("  STOP. Tell Claude. (Only new empty columns so far; nothing uses them yet.)"); done(4)
say(); say("2 · THE SERVER PIECES")
for fn in FNS:
    if not deploy(HUB, FNROOT, fn, gate[fn]): say("  STOP. Tell Claude. (Anything above this line is in; the rest is unchanged.)"); done(5)

say(); say("PART 3 · PROOF")
s, b = http("POST", f"https://{HUB}.supabase.co/functions/v1/family-app-office", {"action": "list"})
(ok if s in (401, 403) else bad)(f"family-app-office: a caller with no sign-in gets nothing ({s})")
s, b = http("POST", f"https://{HUB}.supabase.co/functions/v1/family-offer", {"o": "1", "e": "1", "t": "x", "action": "view"})
(ok if s in (400, 401, 403, 404) else bad)(f"family-offer: a made-up offer link opens nothing ({s})")
(ok if switch() == "false" else bad)("the switch family_axis_welcome_auto is still off (no AxisCare email goes on its own yet)")
# Who would get it the moment the switch goes on: the same rule the run uses, read from the database (nothing is sent)
okw, rows = sql(HUB, "select c.name, k.client_name from circle_contacts c join care_circles k on k.id::text = c.circle_id::text "
    "where c.email is not null and c.email <> '' and c.axis_welcome_sent_at is null and c.welcome_skip_at is null and c.stopped_at is null and c.axiscare_removed_at is null "
    "and k.active is not false and k.axiscare_client_id is not null "
    "and (c.source = 'axiscare' or lower(coalesce(c.relationship, '')) = 'client') "
    "and (c.hipaa_authorized is true or (c.hipaa_authorized is not false and c.hipaa_office_ok_at is not null) or lower(coalesce(c.relationship, '')) = 'client') "
    "and not (k.axiscare_client_id = any (select jsonb_array_elements_text(coalesce(data->'family_welcome_skip_clients', '[]'::jsonb)) from app_data where key = 'ops_settings')) "
    "order by k.client_name, c.name")
if okw:
    say(f"  · When you turn the switch on, up to {len(rows)} people would get the AxisCare email (only those whose client is active in AxisCare):")
    for r in rows[:40]: say(f"      {r.get('name')} ({r.get('client_name')})")
else: say("  · couldn't list who would get it (not a problem for the install)")
say()
say("  1124: " + ("DONE. Two separate emails are in, with the automatic AxisCare email switched off. Next: look at the list above, then turn on family_axis_welcome_auto." if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
done(0 if not L.fails else 1)
