#!/usr/bin/env python3
# 880 · FAMILY APP RELEASE 1: HONEST REQUESTS (2026-10-17, Samantha: "Approve decisions 1 to 7 as recommended, office help
# Monday to Friday only, and the confirmation text until 9 PM. Start Release 1."
# Decisions https://claude.ai/artifact/AS6GbybmUqC47WKPto44p8).
#  1. Database: when the family hears back (answer-by), the two stages for visits more than 7 days ahead, the new status
#     "not filled", her approval of the "not filled" family message recorded, "Let me choose" paused.
#  2. Deploys family-gateway (the app's door), family-offer (the 10-minute caregiver run) and family-app-office (the Hub's
#     buttons). From now on an app request is a REQUEST: nothing goes on AxisCare until a caregiver accepts; the family is told
#     by when they'll hear; nobody accepted = the family hears "nothing was scheduled and there's no charge".
#  3. Proves it: every door still refuses strangers, and a dry run of the caregiver run sends nothing.
# The app site (family.mo-care.com) is published separately right after. Texts and emails nobody itself. Safe to run again.
import json, os, subprocess, shutil, time
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, MG, sql, deploy, start, check_build, fmeta

HUB = "zngsgedlsxinbygwmxwn"; APP = "https://family.mo-care.com"
FNROOT = L.FNROOT; ROOT = L.ROOT; API = L.API
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
FNS = ["family-gateway", "family-offer", "family-app-office"]   # this order: the door first, so every new request carries its answer-by
SQLF = "family_app_release1.sql"
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

start("FAMILY APP RELEASE 1: HONEST REQUESTS")
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
    for t in ("answer_by_test.mjs", "family_app_1a_test.mjs", "family_app_flex_test.mjs", "family_app_fee_test.mjs", "brands_test.mjs"):
        p = subprocess.run([NODE, t], cwd=ROOT, capture_output=True, text=True)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0: stop(f"{t} failed: {last}")
        ok(f"{t}: {last.strip()} (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
good, r = sql(HUB, """select to_regclass('public.family_bookings') is not null as tbl,
  coalesce((select data->>'family_app_live' from app_data where key = 'ops_settings'), 'not set') as live,
  coalesce((select data->>'family_offer_live' from app_data where key = 'ops_settings'), 'not set') as offers,
  (select data->'family_offer_msg_pick' is not null or data->'family_offer_msg_team' is not null from app_data where key = 'ops_settings') as own_words""")
if not good or not r: stop(f"couldn't read the Hub ({str(r)[:160]})", 3)
r = r[0]
if not r["tbl"]: stop("family_bookings isn't there (801 first)", 3)
say(f"  · the family app is {'LIVE' if r['live'] == 'true' else 'in PRACTICE mode'}; caregiver offers are {'ON' if r['offers'] == 'true' else 'OFF'} (both stay as they are)")
good, w = sql(HUB, "select count(*)::int as n, count(*) filter (where axiscare_visit_id is not null)::int as on_axis from public.family_bookings where status in ('received', 'waiting_for_caregiver', 'needs_office') and caregiver_axiscare_id is null and visit_date >= (now() at time zone 'America/Chicago')::date")
if good and w: say(f"  · {w[0]['n']} request(s) waiting for a caregiver today; {w[0]['on_axis']} of them have an empty visit on AxisCare from before (removed if nobody accepts)")
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
    and column_name in ('answer_by', 'team_from', 'asking_from', 'two_stage', 'all_asked_at', 'ended_at', 'ended_why', 'family_unfilled_pending', 'family_unfilled_at', 'family_unfilled_how')) as cols,
  (select bool_or(pg_get_constraintdef(oid) ilike '%not_filled%') from pg_constraint where conrelid = 'public.family_bookings'::regclass and contype = 'c') as status_ok,
  (select data->'family_unfilled_text_approved'->>'by' from app_data where key = 'ops_settings') as approved,
  (select data->>'family_choose_live' from app_data where key = 'ops_settings') as choose""")
c = (c or [{}])[0] if good else {}
chk(c.get("cols") == 10 and c.get("status_ok") is True, "family_bookings has the answer-by and \"not filled\" fields", f"the database change didn't land as expected: {c}")
chk(c.get("approved") == "Samantha", "your approval of the \"not filled\" message is recorded", f"approval not recorded: {c}")
chk(c.get("choose") == "false", "\"Let me choose\" is paused (the code stays)", f"Let me choose is still on: {c}")
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
s, b = http("POST", f"{FNB}/functions/v1/family-app-office", {"action": "list"})
chk(s in (401, 403), f"family-app-office: a caller with no Hub sign-in gets nothing ({s})", f"family-app-office answered a stranger ({s})")
if SERVICE:
    s, b = http("POST", f"{FNB}/functions/v1/family-offer?dry=1", {}, {"Authorization": "Bearer " + SERVICE, "apikey": SERVICE})
    try: d = json.loads(b)
    except Exception: d = {}
    chk(s == 200 and d.get("ok") is True, "family-offer dry run answers and sends nothing" + (f" ({d.get('held')})" if d.get("held") else ""), f"family-offer dry run: {s} {b[:200]}")
else: say("  · couldn't read the Hub's server key, so the dry run was skipped (the doors above are proven)")
say()
say("  880: " + ("DONE. App requests now stay requests until a caregiver accepts (nothing on AxisCare before that), the family is told when they'll hear back, and a request nobody takes ends with \"Nothing was scheduled and there's no charge.\" Let me choose is paused. Next: Claude publishes the matching app screens to family.mo-care.com." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
if r.get("own_words"): say("  NOTE: the Hub has its own caregiver offer wording saved (family_offer_msg_pick / _team), so the new \"confirmed shift\" words are NOT used until that is cleared. Tell Claude.")
done(0 if not L.fails else 1)
