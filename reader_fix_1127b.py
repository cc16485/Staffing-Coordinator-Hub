#!/usr/bin/env python3
# 1127b · THE RUNNING-LATE READER, FIXED (2026-10-26). 1127 put the stronger reader live, but this model refuses a
# "temperature" setting, so the reader answered none of the 10 sentences and late-watch could read no texts or calls.
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data only).
#  2. Deploys late-watch (gateway setting kept).
#  3. Proves it: a stranger is refused; Angiel's call and your nine sentences go through the live reader (a small
#     owner-only check, put in place, run once, removed), and EVERY one must get an answer.
# Texts nobody. Safe to run again.
import json, os, subprocess, shutil, time
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta, lit

HUB = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
FNS = ["late-watch"]
CASE = os.environ.get("SB_CASE", "cwc_s_109_d_2026_10_25")     # Angiel Falig, Patsy, 2026-10-25 4pm
WHO = "Angiel"
NOTE = "Angiel was at Patsy's and could not clock in (no range); Samantha marked her there at 4:09pm. Cara misread her call as a call-off (Desktop 1127)."
ok = lambda s: say("  ✓ " + s)
def chk(good, msg, badmsg=None): (ok(msg) if good else bad(badmsg or msg))
def run(args, cwd=None): p = subprocess.run(args, cwd=cwd, capture_output=True, text=True); return p.returncode, (p.stdout or "") + (p.stderr or "")
def stop(msg, code=2): bad(msg); say("  STOP. Nothing was changed."); done(code)
ARR = lambda key: f"jsonb_array_elements(coalesce((select case when jsonb_typeof(data::jsonb) = 'array' then data::jsonb else '[]'::jsonb end from public.app_data where key = '{key}'), '[]'::jsonb))"
CASEQ = f"""select c->>'id' as id, c->>'client' as client, c->>'shift_date' as shift_date, c->>'shift_time' as shift_time, c->>'calling_off' as calling_off,
  c->>'opened_by' as opened_by, c->>'status' as status, c->>'resolved_how' as resolved_how, coalesce((c->>'not_a_callin')::boolean, false) as not_a_callin, c->>'note' as note
  from {ARR('coverage_cases')} c where c->>'id' = {lit(CASE)}"""
EVQ = f"select e from {ARR('attendance_events')} e where e->>'id' = {lit('att_cov_' + CASE)}"
CARD = "ops_attc_" + "".join(ch if ch.isalnum() else "_" for ch in CASE)[-80:]
CARDQ = f"select o from {ARR('ops_items')} o where o->>'id' = {lit(CARD)}"

start("THE RUNNING-LATE READER, FIXED")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, SHAS)
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = []
for fn in FNS + ["late-read-probe"]:
    for k in sorted(L.need(FNROOT, fn)):
        c2, b2 = run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"])
        if c2 != 0 or b2 != open(os.path.join(ROOT, k)).read(): drift.append(k)
if drift: stop("this isn't the same as GitHub's main yet (merge the pull request first, or newer work landed since: " + ", ".join(sorted(set(drift)))[:240] + ")")
ok("the reviewed build is what is on GitHub's main")
if NODE:
    for t, must in (("not_a_callin_1127_test.mjs", " passed"), ("callin_test.mjs", "31/31 passed"), ("late_watch_test.mjs", "20/20"),
                    ("call_late_432_test.mjs", "60/60"), ("late_l1_test.mjs", "63/63"), ("late_read_probe_test.mjs", "5/5")):
        c, o = run([NODE, t], cwd=ROOT)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l for l in o.splitlines() if "FAIL" in l)[:240])
    ok("tests pass: a phone call never opens a call-off case by itself, \"Not a call-in\" works open or closed, the call-in comes off attendance (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
metas = {}
for fn in FNS:
    s, m = fmeta(HUB, fn)
    if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s})", 3)
    metas[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if metas[fn] else 'off'} (kept)")

say(); say("PART 2 · CHANGE")
for fn in FNS:
    if not deploy(HUB, FNROOT, fn, metas[fn]): say("  STOP. Tell Claude. (Functions before this one are deployed; nothing else was changed.)"); done(5)
say(); say("PART 3 · PROOF")
for fn in FNS:
    s, b = http("POST", f"{FNB}/functions/v1/{fn}", {})
    chk(s in (400, 401, 403), f"{fn}: a caller with no key gets nothing ({s})", f"{fn} answered a stranger ({s})")
say(); say("  THE NEW LIVE READER (a small owner-only check, run once, then removed; reads only these sentences)")
s, b = http("GET", f"{L.API}/v1/projects/{HUB}/api-keys?reveal=true", headers=L.MG())
try: K = {k.get("name"): k.get("api_key", "") for k in json.loads(b)}
except Exception: K = {}
SVC = K.get("service_role", ""); L.HIDE.append(SVC)
ANGIEL = ("(phone call) Speaker 1: Hi, it's Angiel. I'm at Patsy's for her birthday party, and the app won't let me clock in, there's no range out here. "
          "Speaker 2: Oh no, okay. What time did you get there? Speaker 1: I was like, I I don't think I can do it this early before four. Yeah. "
          "And I was like, oh, and I said, I'm already driving. Speaker 2: Okay, I'll clock you in for two. Speaker 1: Thank you.")
SENTENCES = [ANGIEL, "I can't make it today.", "I'm sick and can't work.", "My car broke down, I can't get there.", "I won't be coming tonight.",
  "I need to call off.", "I can't cover my shift.", "I'll be 30 minutes late.", "I can't make it by 8, but I'll be there at 8:30.", "I'm not sure I can make it."]
EXPECT = ["something else (she was there)"] + ["can't make it"] * 6 + ["running late (8:30)", "running late (8:30)", "not sure"]
WORDS = {"cant_make_it": "can't make it", "late": "running late", "other": "something else"}
if not SVC: bad("could not read the owner key, so the reader check was skipped")
else:
    envx = dict(os.environ, SUPABASE_ACCESS_TOKEN=L.TOKEN)
    p = subprocess.run([L.SUPA, "functions", "deploy", "late-read-probe", "--project-ref", HUB, "--use-api"], cwd=ROOT, env=envx, capture_output=True, text=True)
    if p.returncode != 0: bad("could not put the reader check in place: " + (p.stderr or p.stdout)[-200:])
    else:
        time.sleep(float(os.environ.get("SB_SETTLE", "8")))
        s1, b1 = http("POST", f"{FNB}/functions/v1/late-read-probe", {"sentences": SENTENCES, "shift": "16:00", "before_min": 30, "after_min": 7},
                      {"apikey": SVC, "Authorization": "Bearer " + SVC}, timeout=400)
        try: R = json.loads(b1)
        except Exception: R = None
        if s1 != 200 or not isinstance(R, dict) or not R.get("results"): bad(f"the reader check didn't answer ({s1}): {str(b1)[:200]}")
        else:
            for i, r in enumerate(R["results"]):
                x = r.get("reply") or {}
                said = "Angiel's 4pm call (the words Cara misread)" if i == 0 else f"\"{r['sentence']}\""
                got = "the reader did not answer" if x.get("failed") else WORDS.get(x.get("kind"), x.get("kind")) + (f", arriving {x['eta']}" if x.get("eta") else "") + ("" if x.get("sure") else ", NOT SURE")
                say(f"   {i + 1}. {said}: {got}   (expected: {EXPECT[i]})")
            a0 = (R["results"][0].get("reply") or {})
            nofail = [i + 1 for i, r in enumerate(R["results"]) for x in (r.get("before") or {}, r.get("reply") or {}) if x.get("failed")]
            chk(not nofail, "the reader answered every sentence, both ways", "the reader did not answer sentence(s) " + ", ".join(map(str, sorted(set(nofail)))) + ": tell Claude")
            chk(not a0.get("failed") and not (a0.get("kind") == "cant_make_it" and a0.get("sure")), "Angiel's call is read and is NOT a sure call-off", "Angiel's call: " + ("no answer" if a0.get("failed") else "still a sure call-off") + ": tell Claude")
            say("   RAW: " + json.dumps(R)[:6000])
        p = subprocess.run([L.SUPA, "functions", "delete", "late-read-probe", "--project-ref", HUB], cwd=ROOT, env=envx, capture_output=True, text=True, input="y\n")
        chk(p.returncode == 0, "the reader check was removed", "couldn't remove the reader check (it only answers the owner key): " + (p.stderr or p.stdout)[-160:])
say()
say("  1127b: " + ("DONE. The running-late reader answers again, with the stronger model." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
say("  Nobody was texted.")
done(0 if not L.fails else 1)
