#!/usr/bin/env python3
# Rehearsal of 998 (office_script_998.py): the 977 rehearsal's setup (961, 969 underneath; 977's SQL applied), then 998.
# Never touches Supabase.   python3 office_script_998_test.py    (CMD=<Desktop .command> also rehearses the launcher)
import os, json, re, subprocess, glob, datetime, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
_src = open(os.path.join(HERE, "coaching_calls_977_test.py")).read()
exec(_src[:_src.index("code, out = run977()")])
res.clear()
def base998(live_on=False, c3=True):
    base(live_on=live_on)
    if c3:
        c = conn(); c.run(open(os.path.join(COPY, "hr_coaching_c3.sql")).read()); c.close()
def run998(fresh=True, **kw):
    if fresh: base998(**kw)
    rep = os.path.join(TMP, "r998.txt")
    if os.path.exists(rep): os.remove(rep)
    p = subprocess.run(["python3", os.path.join(COPY, "office_script_998.py")], cwd=COPY, env=dict(ENVF(rep), SB_STEP="998", SB_HR_EMAIL="zach@mo-care.com"), capture_output=True, text=True, timeout=300)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else "") + p.stdout + p.stderr
code, out = run998()
ck("runs to DONE with no ✗", code == 0 and "RESULT: DONE" in out and "✗" not in out, out[-2500:])
today = datetime.date.today()
# the script itself, switched on, against the real review flow
c = conn(); c.run("update public.app_data set data = data || '{\"hr_coaching_calls_live\": true}'::jsonb where key = 'ops_settings'")
c.run("insert into public.app_data(key, data) values ('coordinator_staff', cast(:d as jsonb)) on conflict (key) do update set data = excluded.data", d=json.dumps([{"email": "casey@mo-care.com", "name": "Casey Office"}])); c.close()
REV = {"id": "rev_x", "person": "Casey", "status": "coaching", "cause": "training", "opened_on": today.isoformat(), "history": [],
       "items": [{"kind": "first_call", "client": "the Smith family", "day": (today - datetime.timedelta(days=2)).isoformat()}],
       "coaching": {"owner": "zach@mo-care.com", "deadline": (today + datetime.timedelta(days=5)).isoformat(), "plan": "Lead steps refresher"}}
q1("select public.upsert_app_data_item('cc_reviews', cast(:i as jsonb))", i=json.dumps(REV))
tp = q1("select talking_points from public.hr_coaching where review_id = 'rev_x'")[0][0]
ck("the script names Casey and Zach (from the staff list and the coach's record)", tp.startswith("Hi Casey, it's Zach. This call is being recorded for our coaching records."), tp[:120])
ck("...lists the follow-ups with their families and days", "the first call for the Smith family (" in tp, tp)
ck("...has the two STOPs the HR page turns into STOP boxes", tp.count("[STOP: let them answer. Write down what they say.]") == 2)
ck("...the note for the cause chosen (training) and the plan, as notes for the coach", "[NOTE: The review says training. Book the refresher before the call ends, with a date.]" in tp and "[NOTE: The plan from the review: Lead steps refresher]" in tp)
chk = (today + datetime.timedelta(days=35)).strftime("%B ") + str((today + datetime.timedelta(days=35)).day)
ck("...the check-in date is 30 days after the coaching is due", f"I'll check in with you on {chk}." in tp, tp[-400:])
ck("...and no em dashes", "—" not in tp)
ck("the HR page's STOP marker is the same text as the script's", "[STOP: let them answer. Write down what they say.]" in open(os.path.join(os.path.expanduser("~/Claude/Projects/cc2-hub"), "hr.js")).read())
code2, out2 = run998(c3=False)
ck("without part C3 (977): stops, nothing changed", code2 == 3 and "977" in out2, out2[-400:])
code3, out3 = run998(live_on=True)
ck("coaching calls already on: stops", code3 == 3 and "already switched on" in out3, out3[-400:])
code4, out4 = run998(fresh=False)
ck("run again: DONE", code4 == 0 and "RESULT: DONE" in out4, out4[-600:])
ck("no em dashes in the installer or its SQL", "—" not in open(os.path.join(COPY, "office_script_998.py")).read() + open(os.path.join(COPY, "hr_coaching_office_script.sql")).read())
CMD = os.environ.get("CMD", "")
if CMD:
    src = open(CMD).read()
    P = re.search(r'^P="([^"]+)"', src, re.M).group(1); PIN = re.search(r'^PIN="([0-9a-f]{40})"', src, re.M).group(1)
    FH = os.path.join(TMP, "home998"); os.makedirs(os.path.join(FH, ".local", "bin"), exist_ok=True); os.makedirs(os.path.join(FH, "Desktop"), exist_ok=True)
    try: os.symlink(os.path.join(FAKEBIN, "supabase"), os.path.join(FH, ".local", "bin", "supabase"))
    except FileExistsError: pass
    FB = os.path.join(TMP, "fakebin998"); os.makedirs(FB, exist_ok=True); open(os.path.join(FB, "open"), "w").write("#!/bin/sh\nexit 0\n"); os.chmod(os.path.join(FB, "open"), 0o755)
    REPO = os.path.join(TMP, "repo998"); subprocess.run(["git", "clone", "-q", HERE, REPO], check=True)
    s2 = src.replace(P, REPO).replace("/Users/samantha/Desktop", os.path.join(FH, "Desktop"))
    ck("the launcher pins a commit that exists", subprocess.run(["git", "-C", REPO, "cat-file", "-e", PIN + "^{commit}"]).returncode == 0, PIN)
    LC = os.path.join(TMP, "launch998.command"); open(LC, "w").write(s2); os.chmod(LC, 0o755)
    base998()
    env = dict(ENVF(""), HOME=FH, PATH=FB + ":" + os.environ["PATH"]); [env.pop(k) for k in ("SB_REPORT", "SB_FNROOT", "SB_TOKEN", "SB_LIVE_SHAS")]
    p = subprocess.run(["zsh", LC], input="sbp_fake_token\n\n", env=env, capture_output=True, text=True, timeout=300)
    reps = sorted(glob.glob(os.path.join(FH, "Desktop", "998 *report*.txt")))
    rep = open(reps[-1]).read() if reps else ""
    ck("the launcher runs the reviewed build to DONE", "RESULT: DONE" in rep and "✗" not in rep, p.stdout[-1500:] + p.stderr[-800:] + rep[-800:])
for n_, okk, note in res: print(("PASS  " if okk else "FAIL  ") + n_ + ("" if okk else "\n      " + str(note).replace("\n", "\n      ")))
print(f"{sum(1 for _, o, _ in res if o)}/{len(res)} passed"); raise SystemExit(0 if all(o for _, o, _ in res) else 1)
