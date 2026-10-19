#!/usr/bin/env python3
# Rehearsal of 977 (coaching_calls_977.py, coaching calls part C3): the 969 rehearsal's setup (the real 961 underneath,
# the fake management API and supabase tool), then 969's SQL, then 977. Never touches Supabase.
#   python3 coaching_calls_977_test.py     (CMD=<Desktop .command> also rehearses the launcher with a fake HOME)
import os, json, re, subprocess, hashlib, glob, datetime, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
_src = open(os.path.join(HERE, "coaching_calls_969_test.py")).read()
exec(_src[:_src.index("code, out = run969()")])
res.clear()
FILES977 = ["hr-coach-call/index.ts", "_shared/coaching-calls.ts", "_shared/ghl-call-bridge.ts", "_shared/staff-auth.ts", "_shared/job-auth.ts", "_shared/doc-log.ts"]
SHAS977 = {k: hsha(os.path.join(FNR, k)) for k in FILES977}
def base(live_on=False, c1=True):
    seed961(True); run(); extra(live_on=live_on)
    if c1:
        c = conn(); c.run(open(os.path.join(COPY, "hr_coaching_calls.sql")).read()); c.close()
    for f in glob.glob(os.path.join(TMP, "dep-*")): os.remove(f)
    shutil.rmtree(os.path.join(TMP, "live"), ignore_errors=True)
    open(os.path.join(TMP, "dep-hr-coach-call"), "w").write("969")   # hr-coach-call is live since 969
def run977(shas=None, fresh=True, **kw):
    if fresh: base(**kw)
    M.clear()
    rep = os.path.join(TMP, "r977.txt")
    if os.path.exists(rep): os.remove(rep)
    p = subprocess.run(["python3", os.path.join(COPY, "coaching_calls_977.py")], cwd=COPY, env=dict(ENVF(rep), SB_STEP="977", SB_FN_SHAS=json.dumps(shas or SHAS977)), capture_output=True, text=True, timeout=300)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else "") + p.stdout + p.stderr

code, out = run977()
ck("runs to DONE with no ✗", code == 0 and "RESULT: DONE" in out and "✗" not in out, out[-2500:])
ck("the report never shows a key", "eyJ" not in out and "sbp_test" not in out)
ck("the daily follow-through is scheduled at 8:05 Central and runs SQL directly", q1("select schedule, command from cron.job where jobname = 'hr-coaching-followthrough'") == [["5 13 * * *", "select public.hr_coaching_followthrough();"]])
ck("the proof left nothing behind and the switch is still off", q1("select count(*) from public.hr_coaching where caregiver like 'Probe%' or review_id like 'rev_probe%'") == [[0]] and q1("select data->>'hr_coaching_calls_live' from public.app_data where key = 'ops_settings'") == [["false"]])

# the behaviour, on a clean database with C1 + C3, switched on
base(live_on=True); c = conn(); c.run(open(os.path.join(COPY, "hr_coaching_c3.sql")).read()); c.close()
today = datetime.date.today()
def ins(**kw):
    cols = {"axiscare_caregiver_id": "7", "caregiver": "Pat Sample", "kind": "coaching", "topic": "t", "assigned_to": "krystal@mo-care.com", "assigned_by": "zach@mo-care.com", "due_on": today.isoformat()}; cols.update(kw)
    ks = list(cols); c = conn(); r = c.run(f"insert into public.hr_coaching ({', '.join(ks)}) values ({', '.join(':' + k for k in ks)}) returning id::text", **cols); c.close(); return r[0][0]
def cards(): return {e["id"]: e for e in (q1("select e from public.app_data, jsonb_array_elements(data) e where key = 'ops_items'") and [x[0] for x in q1("select e from public.app_data, jsonb_array_elements(data) e where key = 'ops_items'")])}
def bd_back(n):
    d = today
    while n:
        d -= datetime.timedelta(days=1)
        if d.weekday() < 5: n -= 1
    return d
a1 = ins(due_on=(today - datetime.timedelta(days=1)).isoformat()); a3 = ins(due_on=bd_back(3).isoformat(), caregiver="Lee Late")
q1("select public.hr_coaching_followthrough()")
cs = cards()
ck("past due: Zach gets a private card with first name + last initial", cs.get("ops_coach_late_" + a1, {}).get("owner") == "zach@mo-care.com" and cs["ops_coach_late_" + a1]["sensitive"] is True and cs["ops_coach_late_" + a1]["title"] == "Coaching overdue: Pat S.", cs.get("ops_coach_late_" + a1))
ck("...a day late is not yet Samantha's", "ops_coach_late2_" + a1 not in cs)
ck("3 business days late: Samantha gets one too", cs.get("ops_coach_late2_" + a3, {}).get("owner") == "samantha@mo-care.com" and cs["ops_coach_late2_" + a3]["sensitive"] is True)
q1("select public.hr_coaching_followthrough()")
ck("the next day's run doesn't make them again", len([k for k in cards() if k.startswith("ops_coach_late")]) == 3)
q1("update public.hr_coaching set status = 'withdrawn' where id = cast(:i as uuid)", i=a3); q1("select public.hr_coaching_card(c) from public.hr_coaching c where id = cast(:i as uuid)", i=a3)
ck("when the coaching closes, its overdue cards close themselves", cards()["ops_coach_late_" + a3]["status"] == "done" and cards()["ops_coach_late2_" + a3]["status"] == "done")
b1 = ins(status="done", held_on=(today - datetime.timedelta(days=30)).isoformat(), check_on=today.isoformat(), caregiver="Kim Check")
q1("select public.hr_coaching_followthrough()")
ck("the follow-up date: the card comes back to the coach", cards().get("ops_coach_check_" + b1, {}).get("owner") == "krystal@mo-care.com" and cards()["ops_coach_check_" + b1]["status"] == "open")
r = A(KRY, b1, "improved", {"improved": "false", "note": "still late"})
q1("select public.hr_coaching_followthrough()")
ck("\"not yet\": the check card closes and Zach gets one", cards()["ops_coach_check_" + b1]["status"] == "done" and cards().get("ops_coach_notyet_" + b1, {}).get("owner") == "zach@mo-care.com", r)
# office coaching from a team review
c = conn(); c.run("insert into public.app_data(key, data) values ('coordinator_staff', cast(:d as jsonb)) on conflict (key) do update set data = excluded.data", d=json.dumps([{"email": "casey@mo-care.com", "name": "Casey Office", "phone": "4175550123"}])); c.close()
REV = {"id": "rev_casey_x", "person": "Casey", "status": "coaching", "opened_on": today.isoformat(), "items": [{"kind": "first_call", "client": "a family", "day": today.isoformat()}],
       "history": [{"at": "x", "by": "zach@mo-care.com", "by_name": "Zach", "action": "decide", "from": "open", "to": "coaching", "why": "Training"}], "coaching": {"owner": "zach@mo-care.com", "deadline": (today + datetime.timedelta(days=5)).isoformat(), "plan": "Walk through follow-ups"}}
q1("select public.upsert_app_data_item('cc_reviews', cast(:i as jsonb))", i=json.dumps(REV))
off = q1("select id::text, subject_type, subject_email, caregiver, assigned_to, due_on::text, talking_points from public.hr_coaching where review_id = 'rev_casey_x'")
ck("a review decided as Coaching becomes an office coaching record for Casey, coached by Zach", off and off[0][1:] == ["office", "casey@mo-care.com", "Casey Office", "zach@mo-care.com", REV["coaching"]["deadline"], "Walk through follow-ups"], off)
oid = off[0][0]
ck("...its card is private and says office coaching", cards()["ops_coach_" + oid]["sensitive"] is True and cards()["ops_coach_" + oid]["title"] == "Office coaching due: Casey O.")
ck("...Krystal can't see it (coordinators see caregiver coaching only); Zach can", act(KRY, "select count(*) from public.hr_coaching where subject_type = 'office'") == [[0]] and act(ZAC, "select count(*) from public.hr_coaching where subject_type = 'office'") == [[1]])
ck("...and caregiver coaching is still visible to Krystal", act(KRY, "select count(*) from public.hr_coaching where subject_type = 'caregiver'")[0][0] >= 1)
q1("select public.upsert_app_data_item('cc_reviews', cast(:i as jsonb))", i=json.dumps(REV))
ck("saving the review again doesn't make a second record", q1("select count(*) from public.hr_coaching where review_id = 'rev_casey_x'") == [[1]])
q1("update public.hr_coaching set status = 'done', discussed = 'Went through the follow-up list', closed_by = 'zach@mo-care.com', closed_at = now() where id = cast(:i as uuid)", i=oid)
rv = q1("select e from public.app_data, jsonb_array_elements(data) e where key = 'cc_reviews' and e->>'id' = 'rev_casey_x'")[0][0]
ck("finished here: the review is done with the note, done by Zach, one more history entry in the agreed form", rv["status"] == "done" and rv["coaching"]["done_note"] == "Went through the follow-up list" and rv["coaching"]["done_by"] == "zach@mo-care.com"
   and len(rv["history"]) == 2 and set(rv["history"][-1]) == {"at", "by", "by_name", "action", "from", "to", "why"} and rv["history"][-1]["action"] == "coaching_done", rv)
REV2 = dict(REV, id="rev_casey_y"); q1("select public.upsert_app_data_item('cc_reviews', cast(:i as jsonb))", i=json.dumps(REV2))
q1("select public.upsert_app_data_item('cc_reviews', cast(:i as jsonb))", i=json.dumps(dict(REV2, status="no_action")))
ck("a review no longer in coaching (decided otherwise) withdraws its record", q1("select status from public.hr_coaching where review_id = 'rev_casey_y'") == [["withdrawn"]])
REV3 = dict(REV, id="rev_casey_z"); q1("select public.upsert_app_data_item('cc_reviews', cast(:i as jsonb))", i=json.dumps(REV3))
q1("select public.upsert_app_data_item('cc_reviews', cast(:i as jsonb))", i=json.dumps(dict(REV3, status="done", coaching=dict(REV3["coaching"], done_note="done on the Team page", done_by="zach@mo-care.com", done_at=datetime.datetime.now().isoformat()))))
z = q1("select status, discussed, close_note from public.hr_coaching where review_id = 'rev_casey_z'")
ck("finished on the Team page: the record closes with its note, never left overdue", z == [["done", "done on the Team page", "Finished on the Team page."]], z)
rz = q1("select e->>'status', jsonb_array_length(e->'history') from public.app_data, jsonb_array_elements(data) e where key = 'cc_reviews' and e->>'id' = 'rev_casey_z'")
ck("...and the review it came from is left exactly as the Team page saved it (no second write)", rz == [["done", 1]], rz)
q1("update public.hr_coaching set status = 'open' where review_id = 'rev_casey_x'")
q1("select public.upsert_app_data_item('cc_reviews', cast(:i as jsonb))", i=json.dumps(dict(REV, status="no_action")))
q1("update public.hr_coaching set status = 'done' where review_id = 'rev_casey_x'")
ck("write-back only while the review is still in coaching (a later decision is never overwritten)", q1("select e->>'status' from public.app_data, jsonb_array_elements(data) e where key = 'cc_reviews' and e->>'id' = 'rev_casey_x'") == [["no_action"]])
# switched off: nothing happens
base(live_on=False); c = conn(); c.run(open(os.path.join(COPY, "hr_coaching_c3.sql")).read()); c.close()
x1 = ins(due_on=bd_back(4).isoformat())
r = q1("select public.hr_coaching_followthrough()")[0][0]
ck("switched off: the daily run only counts (no cards, nothing marked)", r.get("live") is False and r.get("overdue_to_zach") == 1 and not any(k.startswith("ops_coach_late") for k in cards()) and q1("select escalated_zach_at is null from public.hr_coaching where id = cast(:i as uuid)", i=x1) == [[True]], r)
q1("select public.upsert_app_data_item('cc_reviews', cast(:i as jsonb))", i=json.dumps(REV))
ck("switched off: a review in coaching makes no office record", q1("select count(*) from public.hr_coaching where subject_type = 'office'") == [[0]])
# stops
code2, out2 = run977(c1=False)
ck("without part C1 (969): stops, nothing changed", code2 == 3 and "969" in out2 and q1("select count(*) from information_schema.columns where table_name = 'hr_coaching' and column_name = 'review_id'") == [[0]], out2[-600:])
code3, out3 = run977(live_on=True)
ck("switched on already: stops", code3 == 3 and "already switched on" in out3, out3[-400:])
code4, out4 = run977(shas={"hr-coach-call/index.ts": "0" * 64})
ck("not the reviewed build: stops before anything", code4 == 2, out4[-300:])
code5, out5 = run977(fresh=False)
ck("run again: DONE", code5 == 0 and "RESULT: DONE" in out5, out5[-800:])
body = open(os.path.join(COPY, "coaching_calls_977.py")).read() + open(os.path.join(COPY, "hr_coaching_c3.sql")).read()
ck("no em dashes", "—" not in body)

CMD = os.environ.get("CMD", "")
if CMD:
    src = open(CMD).read()
    P = re.search(r'^P="([^"]+)"', src, re.M).group(1); PIN = re.search(r'^PIN="([0-9a-f]{40})"', src, re.M).group(1)
    FH = os.path.join(TMP, "home977"); os.makedirs(os.path.join(FH, ".local", "bin"), exist_ok=True); os.makedirs(os.path.join(FH, "Desktop"), exist_ok=True)
    try: os.symlink(os.path.join(FAKEBIN, "supabase"), os.path.join(FH, ".local", "bin", "supabase"))
    except FileExistsError: pass
    FB = os.path.join(TMP, "fakebin977"); os.makedirs(FB, exist_ok=True); open(os.path.join(FB, "open"), "w").write("#!/bin/sh\nexit 0\n"); os.chmod(os.path.join(FB, "open"), 0o755)
    REPO = os.path.join(TMP, "repo977"); subprocess.run(["git", "clone", "-q", HERE, REPO], check=True)
    s2 = src.replace(P, REPO).replace("/Users/samantha/Desktop", os.path.join(FH, "Desktop"))
    ck("the launcher pins a commit that exists", subprocess.run(["git", "-C", REPO, "cat-file", "-e", PIN + "^{commit}"]).returncode == 0, PIN)
    LC = os.path.join(TMP, "launch977.command"); open(LC, "w").write(s2); os.chmod(LC, 0o755)
    base(); M.clear()
    env = dict(ENVF(""), HOME=FH, PATH=FB + ":" + os.environ["PATH"]); [env.pop(k) for k in ("SB_REPORT", "SB_FNROOT", "SB_TOKEN", "SB_LIVE_SHAS")]
    p = subprocess.run(["zsh", LC], input="sbp_fake_token\n\n", env=env, capture_output=True, text=True, timeout=300)
    reps = sorted(glob.glob(os.path.join(FH, "Desktop", "977 *report*.txt")))
    rep = open(reps[-1]).read() if reps else ""
    ck("the launcher runs the reviewed build to DONE", "RESULT: DONE" in rep and "✗" not in rep, p.stdout[-1500:] + p.stderr[-800:] + rep[-800:])

for n_, okk, note in res: print(("PASS  " if okk else "FAIL  ") + n_ + ("" if okk else "\n      " + str(note).replace("\n", "\n      ")))
print(f"{sum(1 for _, o, _ in res if o)}/{len(res)} passed"); raise SystemExit(0 if all(o for _, o, _ in res) else 1)
