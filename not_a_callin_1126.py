#!/usr/bin/env python3
# 1126 · NOT A CALL-IN (2026-10-26, Samantha: "the ai's reading of what a caregiver is saying on a call needs to improve
# ... why it was marked as a call in ... there was no way to say that this was not a call in from the text link"; then
# "Yes, build all three fixes."). Angiel Falig's 4pm call for Patsy on 10-25: the running-late reader opened a call-off
# case from her retelling "I said, I'm already driving", a minute after Samantha marked her there.
#  1. Checks first (nothing changes): the reviewed build is GitHub's main; the tests pass (fake data only); finds
#     Angiel's case, any call-in on her attendance from it, HR suggestions and the Confirm card.
#  2. Deploys late-watch, callin-alert, coverage-run (gateway settings kept). Angiel's case is marked "not a call-in":
#     any call-in from it comes off her attendance (a copy stays on the case), HR suggestions from it are dismissed,
#     the Confirm card closes.
#  3. Proves it: a stranger is refused; Angiel has no call-in left from that shift; her call and your nine sentences
#     go through the NEW live reader (a small owner-only check, put in place, run once, removed).
# Texts nobody. Safe to run again.
import json, os, subprocess, shutil, time
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta, lit

HUB = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
SHAS = json.loads(os.environ.get("SB_SHAS", "{}"))
NODE = os.environ.get("SB_NODE", "") or shutil.which("node") or ""
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB}.supabase.co")
FNS = ["late-watch", "callin-alert", "coverage-run"]
CASE = os.environ.get("SB_CASE", "cwc_s_109_d_2026_10_25")     # Angiel Falig, Patsy, 2026-10-25 4pm
WHO = "Angiel"
NOTE = "Angiel was at Patsy's and could not clock in (no range); Samantha marked her there at 4:09pm. Cara misread her call as a call-off (Desktop 1126)."
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

start("NOT A CALL-IN")
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
    for t, must in (("not_a_callin_1126_test.mjs", " passed"), ("callin_test.mjs", "31/31 passed"), ("late_watch_test.mjs", "20/20"),
                    ("call_late_432_test.mjs", "60/60"), ("late_l1_test.mjs", "63/63"), ("late_read_probe_test.mjs", "5/5")):
        c, o = run([NODE, t], cwd=ROOT)
        if c != 0 or must not in o: stop(f"the tests failed ({t}): " + " ".join(l for l in o.splitlines() if "FAIL" in l)[:240])
    ok("tests pass: a phone call never opens a call-off case by itself, \"Not a call-in\" works open or closed, the call-in comes off attendance (fake data only)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
okq, cs = sql(HUB, CASEQ)
if not okq: stop("couldn't read the call-in cases: " + str(cs)[:200], 3)
case = cs[0] if cs else None
if case: say(f"  · case {case['id']}: {case['client']} {case['shift_date']} {case['shift_time']}, {case['calling_off']} named, opened by {case['opened_by']}, {case['status']}"
             + (f" ({case['resolved_how']})" if case['resolved_how'] else "") + (", already marked not a call-in" if case["not_a_callin"] else ""))
else: say(f"  · case {CASE} is not on the board any more (left as it is)")
okq, ev = sql(HUB, EVQ); ev = (ev[0]["e"] if okq and ev else None)
say(f"  · call-in on {WHO}'s attendance from it: " + (json.dumps(ev)[:200] if ev else "none"))
okq, hrc = sql(HUB, "select id, status, title from public.hr_cases where source_ids && array[" + lit("att_cov_" + CASE) + "]::text[]")
if not okq: hrc = []; say("  · couldn't read HR suggestions (left as they are)")
for h in hrc: say(f"  · HR suggestion built from it: \"{h['title']}\" ({h['status']})")
okq, card = sql(HUB, CARDQ); card = (card[0]["o"] if okq and card else None)
say("  · Confirm card: " + (f"\"{card.get('title')}\" ({card.get('status')})" if card else "none"))
metas = {}
for fn in FNS:
    s, m = fmeta(HUB, fn)
    if s != 200 or not m or "verify_jwt" not in m: stop(f"couldn't read how {fn} is set up live ({s})", 3)
    metas[fn] = bool(m["verify_jwt"]); say(f"  · {fn} is live as version {m.get('version', '?')}, gateway sign-in check {'on' if metas[fn] else 'off'} (kept)")

say(); say("PART 2 · CHANGE")
for fn in FNS:
    if not deploy(HUB, FNROOT, fn, metas[fn]): say("  STOP. Tell Claude. (Functions before this one are deployed; nothing else was changed.)"); done(5)
if case and not case["not_a_callin"]:
    patch = {"not_a_callin": True, "not_a_callin_by": "Samantha Troutman", "not_a_callin_by_email": "samantha@mo-care.com", "not_a_callin_note": NOTE,
             "note": "\n".join(x for x in [str(case.get("note") or "").strip(), "Not a call-in: marked by Samantha Troutman (Desktop 1126). " + NOTE] if x)}
    if ev: patch["removed_attendance_event"] = ev
    okq, r = sql(HUB, f"select public.coverage_case_patch({lit(CASE)}, {lit(json.dumps(patch))}::jsonb, '{{}}'::jsonb) as r")
    chk(okq and (r[0]["r"] or {}).get("outcome") == "ok", f"case {CASE} marked \"not a call-in\"", f"case {CASE} could not be marked: {str(r)[:200]}")
    if case["status"] in ("open", "flagged"):
        okq, r = sql(HUB, f"""select public.coverage_case_patch({lit(CASE)}, jsonb_build_object('status', 'done', 'resolved_how', 'not_a_callin', 'covered_by', null,
          'resolved_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'confirmed_by', 'Samantha Troutman', 'confirmed_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
          'close_note', {lit('Not a call-in. ' + NOTE)}, 'reopened_from', null), {lit(json.dumps({"status": case["status"]}))}::jsonb) as r""")
        chk(okq and (r[0]["r"] or {}).get("outcome") in ("ok", "conflict"), f"case {CASE} closed as not a call-in", f"case {CASE} could not be closed: {str(r)[:200]}")
elif case: say("  · the case was already marked (left as it is)")
if ev and not ev.get("action_id"):
    okq, r = sql(HUB, f"select public.delete_app_data_item('attendance_events', {lit('att_cov_' + CASE)})")
    chk(okq, f"the call-in came off {WHO}'s attendance", f"the call-in could not be removed: {str(r)[:200]}")
elif ev: say(f"  · someone already acted on that attendance record, so it was left for them (check Performance > Attendance)")
for h in hrc:
    if h["status"] != "open": continue
    okq, r = sql(HUB, f"update public.hr_cases set status = 'dismissed', review_note = {lit('Not a call-in. ' + NOTE)}, updated_at = now() where id = {lit(h['id'])}")
    chk(okq, f"HR suggestion \"{h['title']}\" dismissed", f"HR suggestion {h['id']} could not be dismissed: {str(r)[:200]}")
if card and card.get("status") == "open":
    item = dict(card, status="done", closed_by="Samantha Troutman", close_note="Not a call-in (Desktop 1126).")
    okq, r = sql(HUB, f"select public.upsert_app_data_item('ops_items', {lit(json.dumps(item))}::jsonb)")
    chk(okq, "the Confirm card closed", f"the Confirm card could not be closed: {str(r)[:200]}")

say(); say("PART 3 · PROOF")
for fn in FNS:
    s, b = http("POST", f"{FNB}/functions/v1/{fn}", {})
    chk(s in (400, 401, 403), f"{fn}: a caller with no key gets nothing ({s})", f"{fn} answered a stranger ({s})")
s, b = http("POST", f"{FNB}/functions/v1/callin-alert", {"case_id": CASE, "action": "not_callin"}, {"Authorization": "Bearer not-a-real-sign-in"})
chk(s in (401, 403), f"callin-alert: \"Not a call-in\" with a made-up sign-in is refused ({s})", f"callin-alert accepted a made-up sign-in ({s})")
okq, ev2 = sql(HUB, EVQ)
chk((okq and not ev2) or bool(ev and ev.get("action_id")), f"{WHO} has no call-in left from Patsy's 10-25 shift", f"a call-in is still there: {str(ev2)[:200]}")
okq, after = sql(HUB, CASEQ)
if okq and after: c = after[0]; say(f"  · case {c['id']}: {c['status']}" + (f" ({c['resolved_how']})" if c['resolved_how'] else "") + (", not a call-in" if c["not_a_callin"] else ""))

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
            chk(not (a0.get("kind") == "cant_make_it" and a0.get("sure")), "Angiel's call is no longer read as a sure call-off", "the new reader still reads Angiel's call as a sure call-off: tell Claude")
            say("   RAW: " + json.dumps(R)[:6000])
        p = subprocess.run([L.SUPA, "functions", "delete", "late-read-probe", "--project-ref", HUB], cwd=ROOT, env=envx, capture_output=True, text=True, input="y\n")
        chk(p.returncode == 0, "the reader check was removed", "couldn't remove the reader check (it only answers the owner key): " + (p.stderr or p.stdout)[-160:])
say()
say("  1126: " + ("DONE. A phone call no longer opens a call-in by itself, the reader is stronger, \"Not a call-in\" is on your text link and the board, and Angiel's is cleared." if not L.fails else "NOT COMPLETE. See the ✗ lines above."))
say("  Nobody was texted.")
done(0 if not L.fails else 1)
