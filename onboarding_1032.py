#!/usr/bin/env python3
# 1032 · REFERENCE TEXTS + THE ONE WELCOME MESSAGE (Samantha 2026-10-21: "the Hub texts each reference automatically from the
# office line (with STOP to opt out), and the office calls when needed", and the approved onboarding design, stops 5 and 6)
# Part 1 (read only): the reviewed build; 1031 is in; the four new switches are off; every function this step replaces is live
#   exactly as 1031 left it.
# Part 2: messages-1032.sql (two columns on reference_requests), then the functions whose files changed since 1031:
#   reference-chase (reference texts from the office line), welcome-call + step2-handoff (the one welcome message and the
#   profile reminders), caregiver-journey (the badge card), and any other service that shares a changed file.
# Part 3 (proof): reference-chase's practice run (?dry=1) says who would be texted, and one readiness sweep says whose references
#   the Hub would ask by itself (refs_auto_ask_live) and how many rows it would make; nothing is sent. No switch is turned on.
import os, json, subprocess
os.environ.setdefault("SB_STEP", "1032")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
HERE = os.path.dirname(os.path.abspath(__file__))
BASE_ROOT = os.environ.get("SB_BASE_ROOT", "")   # a checkout of the 1031 build (the launcher makes it)
ALL = ["reference-chase", "welcome-call", "step2-handoff", "caregiver-journey", "caregiver-export", "hire-profile", "bg-review", "offer-sign", "reference-send"]
def keys():
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict) and usable(k.get("api_key", ""))}
        if got.get("service_role"): return got
    return {}

start("REFERENCE TEXTS + THE ONE WELCOME MESSAGE")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
SW = ["ref_auto_text_live", "welcome_message_live", "profile_reminders_live", "badge_cards_live", "refs_auto_ask_live"]
ok, st = sql(REF, "select " + ", ".join(f"coalesce((select data->>{lit(k)} from public.app_data where key = 'ops_settings'), '') as {k}" for k in SW)
  + ", (select active from public.client_journey_step_def where key = 'cg.check.fingerprints') as fp, (select count(*) from public.reference_requests where responded_at is null)::int as open_refs")
if not ok or not st: bad(f"could not read the database: {st}")
else:
    x = st[0]
    if any(x[k] == "true" for k in SW): bad("a new switch is already on; this step expects all five off")
    if x["fp"] is not False: bad("1031 is not in yet (the fingerprint row is still on). Run 1031 first.")
    if not fails: say(f"  ✓ 1031 is in · the five new switches are off · {x['open_refs']} reference request(s) waiting, none changed")
if not BASE_ROOT or not os.path.isdir(BASE_ROOT): bad("the launcher did not set up the 1031 build. Tell Claude.")
FNS, GATES = [], {}
if not fails:
    for fn in ALL:
        mine = {k: sha(os.path.join(ROOT, k)) for k in need(FNROOT, fn)}
        want = {k: sha(os.path.join(BASE_ROOT, k)) for k in need(os.path.join(BASE_ROOT, "supabase", "functions"), fn)}
        if mine == want: continue
        FNS.append(fn)
        sF, mF = fmeta(REF, fn)
        if sF != 200: bad(f"{fn} is not live"); continue
        GATES[fn] = bool((mF or {}).get("verify_jwt"))
        okL, livef = live_files(REF, fn)
        if not okL: bad(f"could not read the live {fn}")
        elif livef == mine: say(f"  ✓ the live {fn} is already this build (an earlier run of 1032)")
        elif livef != want: bad(f"the live {fn} is not what 1031 left ({len(set(livef.items()) ^ set(want.items()))} difference(s)), so nothing was replaced. Tell Claude.")
        else: say(f"  ✓ the live {fn} is the 1031 build (gateway sign-in check {'on' if GATES[fn] else 'off'}, kept)")
K = keys(); SVC = K.get("service_role", ""); HIDE.append(SVC)
if not SVC: bad("could not read the project's server key (the proof needs it)")
say(f"  · what changes: two columns on reference requests, {len(FNS)} service(s): {', '.join(FNS)}. No switch is turned on; nothing is sent.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
good, r = sql(REF, "begin;\n" + open(os.path.join(HERE, "supabase", "messages-1032.sql")).read() + "\ncommit;")
if not good: bad(f"the columns did not go in, so nothing changed: {str(r)[:300]}"); say("  RESULT: STOPPED. Tell Claude."); done(5)
say("  ✓ reference requests can record when a reference was texted")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, GATES[fn]):
        say(f"  RESULT: STOPPED at {fn}. The two columns are in (harmless while empty). Tell Claude."); done(6)

say(); say("PART 3 · PROOF (practice; nothing sent)")
s, b = http("POST", f"{FNB}/functions/v1/reference-chase?dry=1", {}, {"Authorization": "Bearer " + SVC, "apikey": SVC, "Content-Type": "application/json"})
try: j = json.loads(b)
except Exception: j = {}
if s == 200 and j.get("ok") and (j.get("dry") is True or j.get("skipped")):
    say(f"  ✓ reference-chase practice run: texts {j.get('texts', 'practice')}, {j.get('would_text', 0)} reference(s) would get a text with the switch on" if j.get("dry") else f"  ✓ reference-chase answered outside its hours ({j.get('skipped')}); nothing was sent")
else: bad(f"reference-chase did not answer as expected ({s}): {str(b)[:200]}")
s, b = http("POST", f"{FNB}/functions/v1/caregiver-journey", {"action": "sweep"}, {"Authorization": "Bearer " + SVC, "apikey": SVC, "Content-Type": "application/json"})
try: j = json.loads(b)
except Exception: j = {}
A = j.get("auto_ask") or {}
if s == 200 and j.get("ok") and A.get("live") is False:
    say(f"  ✓ references asked by themselves (practice): the Hub would make {A.get('would', 0)} reference request(s)" + (" for " + ", ".join(A.get("people") or []) if A.get("people") else ""))
else: bad(f"the readiness sweep did not answer as expected ({s}): {str(b)[:200]}")
say()
if fails: say("  RESULT: DONE WITH PROBLEMS above. Tell Claude."); done(7)
say("  RESULT: DONE. Everything new is in PRACTICE. To turn them on (ops_settings): ref_auto_text_live (reference texts),")
say("  welcome_message_live (the one welcome message), profile_reminders_live (profile reminders), badge_cards_live (badge cards),")
say("  refs_auto_ask_live (references asked by themselves once Step 1 is complete).")
done(0)
