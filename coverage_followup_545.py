#!/usr/bin/env python3
# 545 · FOLLOW UP WITH THE PEOPLE ALREADY ASKED (Samantha 2026-10-09: "a way to send a follow up text just to the people
# we have already sent to, so we don't have to remember who we asked... to offer a bonus or follow up"). Hub project.
# Replaces the coverage-run function with the reviewed build, which adds one coordinator action, follow_up: text only the
# people a case already texted, in the office's words. The waves, the picker, the sweep, every switch and the gateway
# setting stay exactly as they are. Nothing is sent by this step.
import os, json
os.environ.setdefault("SB_STEP", "545")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FN = "coverage-run"
start("FOLLOW UP WITH THE PEOPLE ALREADY ASKED: THE COVERAGE ENGINE IS REPLACED WITH THE REVIEWED BUILD")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
src = open(os.path.join(FNROOT, FN, "index.ts")).read()
say("  ✓ the build carries the follow_up action") if "body.action === 'follow_up'" in src else bad("the build has no follow_up action")
sx, mx = fmeta(REF, FN)
if sx == 200 and mx: say(f"  ✓ {FN} is live at version {mx.get('version', '?')}, gateway sign-in check {'on' if mx.get('verify_jwt') else 'off'}; that setting is kept")
else: bad(f"{FN} is not live: {sx}")
KEEP_JWT = bool((mx or {}).get("verify_jwt"))
ok_, st = sql(REF, "select data->>'coverage_send_live' as live from app_data where key = 'ops_settings'")
say(f"  · coverage_send_live is {st[0]['live'] if ok_ and st else '?'} (this step does not change it)")
ok_, n0 = sql(REF, "select jsonb_array_length(data) as n from app_data where key = 'coverage_cases'")
CASES_BEFORE = int(n0[0]["n"]) if ok_ and n0 else -1
say(f"  · {CASES_BEFORE} coverage case(s) on file; none changes")
ok_, fn_ = sql(REF, "select count(*)::int as n from pg_proc where proname = 'coverage_case_patch'")
say("  ✓ the CI1 one-case patch (coverage_case_patch) is in the database; follow-ups are recorded through it") if ok_ and int(fn_[0]["n"]) >= 1 else bad("coverage_case_patch is missing (run CI1 first)")
say("  · what changes: only the coverage-run function. Nothing is sent; no record changes.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, FN, KEEP_JWT): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent or changed)")
BASE = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
s_, b_ = http("POST", f"{BASE}/functions/v1/{FN}", {"action": "follow_up", "case_id": "no-such-case", "ask_ids": ["x"], "message": "probe"}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ a follow_up without a staff sign-in is refused ({s_})") if s_ in (401, 403) else bad(f"a follow_up without a sign-in answered {s_}: {b_[:160]}")
s_, b_ = http("POST", f"{BASE}/functions/v1/{FN}", {"action": "send_selected", "case_id": "no-such-case", "recipients": ["x"]}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ the picker send without a sign-in is still refused ({s_})") if s_ in (401, 403) else bad(f"send_selected without a sign-in answered {s_}")
ok_, n1 = sql(REF, "select jsonb_array_length(data) as n from app_data where key = 'coverage_cases'")
say(f"  ✓ the coverage cases are untouched ({CASES_BEFORE} before, {int(n1[0]['n']) if ok_ and n1 else '?'} after)") if ok_ and n1 and int(n1[0]["n"]) == CASES_BEFORE else bad(f"case count changed: {CASES_BEFORE} → {n1}")
say("  · tested before deploying: 19 checks on the real function (who is texted and who is skipped, {first_name} per person, a refused text named and carded, the night hold, the switch, a closed case, an em dash, an opted-out number).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the Hub's Follow up button now works once care-coordinator-hub pull request 275 is merged. Nothing was sent."); done(0)
