#!/usr/bin/env python3
# 1160 · THE WHAT TO EXPECT TEXT AFTER A LEAD CALL (2026-10-28, Samantha: "Approved as an exception to my rule: send the
# what-to-expect text automatically when a coordinator makes a call into a lead, using the safer wording, holding it during
# quiet hours, once per lead.")
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data only).
#  2. Database: the one-per-lead record (app_data what_to_expect_sends, empty) and her approval, in her words
#     (ops_settings.what_to_expect_text_approved). Deploys lead-followup (the 15-minute lead job), keeping its gateway setting.
#  3. Proof: a practice run (nothing sent), then the switch goes ON from now: only leads made from a call FROM NOW ON get the
#     text, 7 AM to 8 PM, once each. Leads made before this step are never texted. A second practice run proves it reads it.
# The Hub's Settings, Leads, "What to expect text after a lead call" turns it off. Safe to run again.
import json, os, subprocess, shutil, time
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta, API, MG, HIDE

HUB = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FN = "lead-followup"
TESTS = ("what_to_expect_test.mjs", "optout_0b2_test.mjs", "late_l1_test.mjs", "future_saved_771_test.mjs", "family_welcome_alert_test.mjs")
WORDS = ("Approved as an exception to my rule: send the what-to-expect text automatically when a coordinator makes a call into a lead, "
         "using the safer wording, holding it during quiet hours, once per lead.")
ok = lambda s: say("  ✓ " + s)
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
def setting(k):
    okq, st = sql(HUB, f"select data->'{k}' as v from app_data where key = 'ops_settings'")
    return (st[0]["v"] if st else None) if okq else "?"
def keys():
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{HUB}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict) and usable(k.get("api_key", ""))}
        if got.get("service_role"): return got
    return {}
def practice():
    s, b = http("POST", f"https://{HUB}.supabase.co/functions/v1/{FN}?dry=1", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, 300)
    try: j = json.loads(b)
    except Exception: j = {}
    return s, j

start("THE WHAT TO EXPECT TEXT AFTER A LEAD CALL")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
files = sorted(L.need(FNROOT, FN))
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
s, m = fmeta(HUB, FN)
if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {FN} is set up live ({s})", 3)
gate = bool(m["verify_jwt"]); say(f"  · {FN} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if gate else 'off'} (kept)")
K = keys(); SVC = K.get("service_role", ""); HIDE.append(SVC)
if not SVC: stop("couldn't read the Hub's server key (needed for the practice run)", 3)

say(); say("PART 2 · CHANGE")
say(); say("1 · THE DATABASE")
okd, out = sql(HUB, "insert into public.app_data (key, data) values ('what_to_expect_sends', '[]'::jsonb) on conflict (key) do nothing")
okc, c = sql(HUB, "select jsonb_typeof(data) as t, jsonb_array_length(data) as n from app_data where key = 'what_to_expect_sends'")
(ok if okd and okc and c and c[0]["t"] == "array" else bad)("the one-text-per-lead record is there" + (f" ({c[0]['n']} sent so far)" if okc and c else ""))
appr = json.dumps({"by": "Samantha Troutman", "at": "2026-10-28", "words": WORDS})
oka, a = sql(HUB, "update public.app_data set data = data || jsonb_build_object('what_to_expect_text_approved', " + L.lit(appr) + "::jsonb) "
    "where key = 'ops_settings' and jsonb_typeof(data) = 'object' and not (data ? 'what_to_expect_text_approved') returning 1 as n")
v = setting("what_to_expect_text_approved")
(ok if isinstance(v, dict) and v.get("by") else bad)("your approval is on record, in your words" + ("" if oka and a else " (it already was)"))
if L.fails: say("  STOP. Tell Claude. (Only an empty record and your approval so far; nothing uses them yet.)"); done(4)
say(); say("2 · THE SERVER PIECE")
if not deploy(HUB, FNROOT, FN, gate): say("  STOP. Tell Claude. (The record and approval are in; the server is unchanged.)"); done(5)

say(); say("PART 3 · PROOF, THEN ON")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
a1 = http("POST", f"https://{HUB}.supabase.co/functions/v1/{FN}?dry=1", {}, {})[0]
(ok if a1 in (401, 403) else bad)(f"{FN}: a caller with no sign-in gets nothing ({a1})")
s1, j1 = practice()
w1 = j1.get("what_to_expect") if isinstance(j1, dict) else None
(ok if s1 == 200 and isinstance(w1, dict) and not w1.get("error") else bad)("practice run: the 15-minute job runs the new step without an error" + ("" if s1 == 200 else f" ({s1})"))
if L.fails: say("  STOP. Tell Claude. The switch stays OFF, so nothing is sent."); done(6)
okl, r = sql(HUB, "update public.app_data set data = data || jsonb_build_object('what_to_expect_text_live', true, 'what_to_expect_text_live_since', "
    "to_char(now() at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')) where key = 'ops_settings' and jsonb_typeof(data) = 'object' "
    "and not (data ? 'what_to_expect_text_live_since') returning data->>'what_to_expect_text_live_since' as since")
since = setting("what_to_expect_text_live_since"); live = setting("what_to_expect_text_live")
(ok if live is True and since else bad)(f"the switch is ON from {str(since)[:16].replace('T', ' ')} UTC" + ("" if okl and r else " (it already was; the start time is unchanged)"))
s2, j2 = practice()
w2 = j2.get("what_to_expect") if isinstance(j2, dict) else None
(ok if s2 == 200 and isinstance(w2, dict) and w2.get("live") is True and not w2.get("error") else bad)("a second practice run reads it as on" + (f": {len(w2.get('would', []))} lead(s) would get it right now" if isinstance(w2, dict) else ""))
for x in (w2 or {}).get("would", [])[:10]: say(f"      {x.get('name')}")
say()
say("  1160: " + ("DONE. From now on, each lead made from a call gets one what to expect text (7 AM to 8 PM; at night it waits for 7 AM). "
    "Turn it off any time: Hub Settings, Leads, \"What to expect text after a lead call\"." if not L.fails else "NOT COMPLETE. See the ✗ lines above. Tell Claude."))
done(0 if not L.fails else 1)
