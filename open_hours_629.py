#!/usr/bin/env python3
# 629 · OPEN HOURS: ASK THE WHOLE TEAM, THE AI SORTS THE ANSWERS (Samantha 2026-10-12: "we just need a way to send
# message to all caregivers about a set of recurring shifts ... have the ai help put the answers into three boxes" and
# "yes to all" to the plan). Installs coverage-run (the whole-team text from a Team Builder plan) and coverage-reply
# (the AI reads each answer into green with days / yellow / red). All three switches stay OFF; she turns them on from
# the Owners Hub Admin page. Nothing is sent by this step.
import os, json
os.environ.setdefault("SB_STEP", "629")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FNS = ["coverage-run", "coverage-reply"]
start("OPEN HOURS: ASK THE WHOLE TEAM, THE AI SORTS THE ANSWERS")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
ok, r = sql(REF, "select coalesce(data->>'open_hours_live','off') as a, coalesce(data->>'open_hours_ai_live','off') as b, coalesce(data->>'open_hours_ack_live','off') as c, coalesce(data->>'coverage_send_live','off') as d from public.app_data where key = 'ops_settings'")
if ok and r:
    x = r[0]; say(f"  · switches: text the whole team {x['a']}, AI sorting {x['b']}, thank-you {x['c']} (this step leaves them as they are); Cara's open-shift texts {x['d']}")
s0, b0 = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
try: names = {str(k.get("name")) for k in json.loads(b0)} if s0 == 200 else set()
except Exception: names = set()
say("  ✓ the AI key is on the project (the running-late reader uses the same one)") if "ANTHROPIC_API_KEY" in names else say("  · the AI key isn't on the project: answers will be sorted by their words only until it is")
meta = {}
for fn in FNS:
    sx, mx = fmeta(REF, fn); meta[fn] = mx if isinstance(mx, dict) else {}
    say(f"  · {fn} is live at version {meta[fn].get('version', '?')}; replaced by this build") if sx == 200 else bad(f"{fn} is not live: {sx}")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, meta[fn].get("verify_jwt", True)): say("  RESULT: STOPPED. Tell Claude."); done(6)
say(); say("PART 3 · PROOF (nothing is sent)")
for fn in FNS:
    okl, livef = live_files(REF, fn)
    say(f"  ✓ {fn} is live as tested") if okl and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in need(FNROOT, fn)) else bad(f"{fn}: the live copy is not this build")
s2, b2 = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG()); SVC = ""
try:
    arr = json.loads(b2) if s2 == 200 else []
    if isinstance(arr, dict): arr = arr.get("keys") or []
    SVC = next((str(k.get("api_key")) for k in arr if isinstance(k, dict) and k.get("name") == "service_role" and str(k.get("api_key", "")).startswith("eyJ")), "")
except Exception: SVC = ""
s4, b4 = http("POST", f"https://{REF}.supabase.co/functions/v1/coverage-run", {"action": "open_hours", "plan_id": "no-such-plan-629"}, {"apikey": SVC, "Authorization": "Bearer " + SVC}) if SVC else (None, "no key")
say("  ✓ the whole-team ask is live: asked about a plan that doesn't exist, it says so and sends nothing") if s4 == 404 and "no such Team Builder plan" in str(b4) else bad(f"the whole-team ask did not answer as expected: {s4} {str(b4)[:200]}")
s5, b5 = http("POST", f"https://{REF}.supabase.co/functions/v1/coverage-run", {"action": "open_hours", "plan_id": "x"}, {})
say(f"  ✓ it refuses anyone not signed in ({s5})") if s5 in (401, 403) else bad(f"it answered someone not signed in: {s5}")
say("  · next: on the Owners Hub Admin page, turn on \"Open hours: text the whole team\" (and the AI sorting, and the thank-you, when you want them). Then on a Team Builder plan: \"See the text and who gets it\".")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · open hours installed; every switch is as it was (off until you turn it on). Nothing was sent."); done(0)
