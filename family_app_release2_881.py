#!/usr/bin/env python3
# 881 · FAMILY APP RELEASE 2: STAYS ACCURATE (2026-10-17, Samantha: "Start Release 2."; plan approved the same day,
# https://claude.ai/artifact/AS6GbybmUqC47WKPto44p8).
#  1. Database: where the 10-minute AxisCare check keeps what it found, and her approval of the two change messages recorded
#     (caregiver changed: decision 5; time changed: "Yes (Recommended)", 8 AM to 8 PM).
#  2. Deploys family-gateway (the app shows "Sarah can't come, our office is arranging another caregiver" and "cancelled by
#     us", with no late charge when nobody is on the visit) and family-offer (its 10-minute run now also reads AxisCare for
#     every confirmed app visit in the next 14 days).
#  3. Proves it: every door still refuses strangers, and a dry run of the check reads AxisCare and changes and sends nothing.
# Coverage Help stays the one voice for call-offs. The app site is published separately right after. Safe to run again.
import json, os, subprocess, shutil, time
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, MG, sql, deploy, start, check_build, fmeta

HUB = "zngsgedlsxinbygwmxwn"; APP = "https://family.mo-care.com"
FNROOT = L.FNROOT; ROOT = L.ROOT; API = L.API
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
FNS = ["family-gateway", "family-offer"]   # the door first, so the app can show what the check finds
SQLF = "family_app_release2.sql"
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
def keys(ref):
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{ref}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict) and usable(k.get("api_key", ""))}
        if got.get("service_role"): return got
    return {}

start("FAMILY APP RELEASE 2: STAYS ACCURATE")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
# Run only once both pull requests are merged: every file these doors use must match GitHub's main, so nobody's newer work is undone.
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")   # rehearsals point this at the rehearsal copy's own commit
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = []
for k in sorted(set().union(*[L.need(FNROOT, fn) for fn in FNS]) | {SQLF}):
    c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
    if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(drift)[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE:
    for t in ("family_sync_test.mjs", "answer_by_test.mjs", "family_app_1a_test.mjs", "family_app_flex_test.mjs", "family_app_fee_test.mjs", "brands_test.mjs"):
        p = subprocess.run([NODE, t], cwd=ROOT, capture_output=True, text=True)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0: stop(f"{t} failed: {last}")
        ok(f"{t}: {last.strip()} (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
good, r = sql(HUB, """select to_regclass('public.family_bookings') is not null as tbl,
  coalesce((select data->>'family_app_live' from app_data where key = 'ops_settings'), 'not set') as live,
  coalesce((select data->>'family_offer_live' from app_data where key = 'ops_settings'), 'not set') as offers""")
if not good or not r: stop(f"couldn't read the Hub ({str(r)[:160]})", 3)
r = r[0]
if not r["tbl"]: stop("family_bookings isn't there (801 first)", 3)
say(f"  · the family app is {'LIVE' if r['live'] == 'true' else 'in PRACTICE mode'}; caregiver offers are {'ON' if r['offers'] == 'true' else 'OFF'} (both stay as they are)")
good, w = sql(HUB, "select count(*)::int as n from public.family_bookings where status = 'placed' and axiscare_visit_id is not null and visit_date between (now() at time zone 'America/Chicago')::date and (now() at time zone 'America/Chicago')::date + 14")
if good and w: say(f"  · {w[0]['n']} confirmed app visit(s) in the next 14 days will be checked against AxisCare every 10 minutes")
gate = {}
for fn in FNS:
    s, m = fmeta(HUB, fn)
    if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s})", 3)
    gate[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gate[fn] else 'off'} (kept)")
K = keys(HUB); SERVICE = K.get("service_role", ""); L.HIDE += [SERVICE]

say(); say("PART 2 · CHANGE")
say(); say("1 · THE DATABASE")
good, r2 = sql(HUB, open(os.path.join(ROOT, SQLF)).read())
if not good: stop(f"the database change was refused (nothing in it was kept): {str(r2)[:200]}", 4)
good, c = sql(HUB, """select (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'family_bookings'
    and column_name in ('ax_checked_at', 'sync_state', 'sync_note', 'cancel_source', 'family_change_pending', 'family_change_at', 'family_change_from', 'family_change_kind', 'family_change_how')) as cols,
  (select data->'family_cgchange_text_approved'->>'by' from app_data where key = 'ops_settings') as cg,
  (select data->'family_timechange_text_approved'->>'by' from app_data where key = 'ops_settings') as tm""")
c = (c or [{}])[0] if good else {}
chk(c.get("cols") == 9, "family_bookings has the AxisCare check fields", f"the database change didn't land as expected: {c}")
chk(c.get("cg") == "Samantha" and c.get("tm") == "Samantha", "your approvals of the caregiver-changed and time-changed messages are recorded", f"approvals not recorded: {c}")
if L.fails: say("  STOP. The doors are unchanged. Tell Claude."); done(4)
say(); say("2 · THE DOORS")
for fn in FNS:
    if not deploy(HUB, FNROOT, fn, gate[fn]): say("  STOP. Tell Claude. (Anything above this line is in; the rest is unchanged.)"); done(5)

say(); say("PART 3 · PROOF")
s, b = http("POST", f"{FNB}/functions/v1/family-gateway", {"action": "home"})
chk(s == 401, "family-gateway: a caller with no sign-in gets nothing (401)", f"family-gateway answered a stranger ({s})")
s, b = http("OPTIONS", f"{FNB}/functions/v1/family-gateway", headers={"Origin": APP, "Access-Control-Request-Method": "POST"})
chk(s == 200, "the app's address may still call the family door", f"the app can't reach the family door ({s})")
s, b = http("POST", f"{FNB}/functions/v1/family-offer", {})
chk(s == 401, "family-offer: a caller with no key gets nothing (401)", f"family-offer answered a stranger ({s})")
s, b = http("POST", f"{FNB}/functions/v1/family-offer", {"o": "00000000-0000-0000-0000-000000000000", "e": int(time.time()) + 3600, "t": "A" * 43})
chk(s == 403, "family-offer: a forged offer link gets nothing (403)", f"a forged link was not refused ({s})")
if SERVICE:
    s, b = http("POST", f"{FNB}/functions/v1/family-offer?dry=1", {}, {"Authorization": "Bearer " + SERVICE, "apikey": SERVICE})
    try: d = json.loads(b)
    except Exception: d = {}
    sy = d.get("sync") if isinstance(d.get("sync"), dict) else {}
    chk(s == 200 and d.get("ok") is True and "checked" in sy and not sy.get("error"), f"dry run: the AxisCare check read {sy.get('checked', 0)} confirmed app visit(s), {sy.get('same', 0)} unchanged, {len(sy.get('would') or [])} it would update; nothing changed or sent" + (f" ({sy.get('held')})" if sy.get("held") else ""), f"family-offer dry run: {s} {b[:200]}")
    if sy.get("unreadable"): say(f"  · AxisCare didn't answer for {sy['unreadable']} visit(s) this time; those are simply checked again in 10 minutes")
else: say("  · couldn't read the Hub's server key, so the dry run was skipped (the doors above are proven)")
say()
say("  881: " + ("DONE. Every 10 minutes the Hub now reads AxisCare for each confirmed app visit in the next 14 days, and the app follows it: another caregiver or a new time shows in the app and the family gets one message (8 AM to 8 PM), a call-off shows \"our office is arranging another caregiver\" (Coverage Help speaks to the family), and a visit removed in AxisCare shows \"cancelled by us\" with a card for the office. Next: Claude publishes the matching app screens." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
done(0 if not L.fails else 1)
