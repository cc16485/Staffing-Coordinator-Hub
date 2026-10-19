#!/usr/bin/env python3
# Rehearsal of 990 (hr_sop_990.py, SOP reminders, HR step 9): the 977 rehearsal's setup (961, 969 and 977 underneath, the
# fake management API and supabase tool), a local copy of the write-ups (with the 946 lock and the audit trail), then 990.
# Never touches Supabase.   python3 hr_sop_990_test.py     (CMD=<Desktop .command> also rehearses the launcher)
import os, json, re, subprocess, hashlib, glob, datetime, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
_src = open(os.path.join(HERE, "coaching_calls_977_test.py")).read()
exec(_src[:_src.index("code, out = run977()")])
res.clear()
FILES990 = ["hr-alerts/index.ts", "_shared/hr-alert-rules.ts"]
SHAS990 = {k: hsha(os.path.join(FNR, k)) for k in FILES990}
t_ = os.path.join(TMP, "ls-hr-alerts"); shutil.rmtree(t_, ignore_errors=True); fake_live("hr-alerts", t_); LIVE990 = bundle_shas(t_)
WU = [{"id": "w1", "caregiver": "Pat Sample", "level": "Verbal Warning", "status": "draft", "created_at": "2026-10-01T15:00:00Z"}]
def base990(live_on=False, c3=True, wu=True):
    base()
    c = conn()
    if c3: c.run(open(os.path.join(COPY, "hr_coaching_c3.sql")).read())
    for op, cmd in (("sel", "select"), ("ins", "insert"), ("upd", "update"), ("del", "delete")):
        c.run(f"drop policy if exists app_data_hr_formal_{op} on public.app_data")
        c.run(f"create policy app_data_hr_formal_{op} on public.app_data as restrictive for {cmd} to authenticated {'with check' if op == 'ins' else 'using'} (key <> 'discipline_actions' or public.desk_is_owner())")
    if wu: c.run("insert into public.app_data(key, data) values ('discipline_actions', cast(:d as jsonb)) on conflict (key) do update set data = excluded.data", d=json.dumps(WU))
    c.run("insert into public.app_data(key, data) values ('ops_items', '[]'::jsonb) on conflict (key) do nothing")
    if live_on: c.run("update public.app_data set data = data || '{\"hr_sop_reminders_live\": true}'::jsonb where key = 'ops_settings'")
    c.close()
    open(os.path.join(TMP, "dep-hr-alerts"), "w").write("965")
def run990(shas=None, fresh=True, live_shas=None, **kw):
    if fresh: base990(**kw)
    M.clear(); GATES["hr-alerts"] = True
    rep = os.path.join(TMP, "r990.txt")
    if os.path.exists(rep): os.remove(rep)
    p = subprocess.run(["python3", os.path.join(COPY, "hr_sop_990.py")], cwd=COPY, env=dict(ENVF(rep), SB_STEP="990", SB_FN_SHAS=json.dumps(shas or SHAS990), SB_LIVE_SHAS=json.dumps(live_shas or LIVE990)), capture_output=True, text=True, timeout=300)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else "") + p.stdout + p.stderr
_orig_get = F.do_GET
def _get(self):
    if self.path.endswith("/functions/hr-alerts"): return self._send(200, {"version": 2, "verify_jwt": True})
    return _orig_get(self)
F.do_GET = _get
_orig_post = F.do_POST
def _post(self):
    if self.path.startswith("/functions/v1/hr-alerts"):
        return self._send(200, {"ok": True, "live": False, "dry": True, "waiting": 1, "new": 0}) if "svc" in self.headers.get("Authorization", "") else self._send(401, {})
    return _orig_post(self)
F.do_POST = _post

code, out = run990()
ck("runs to DONE with no ✗", code == 0 and "RESULT: DONE" in out and "✗" not in out, out[-2500:])
ck("the report never shows a key", "eyJ" not in out and "sbp_test" not in out)
ck("the daily reminder is scheduled at 7:55 Central, running SQL", q1("select schedule, command from cron.job where jobname = 'hr-sop-reminders'") == [["55 12 * * *", "select public.hr_sop_reminders();"]])
ck("hr-alerts went out as the reviewed build with its gateway setting", os.path.exists(os.path.join(TMP, "dep-hr-alerts")) and "--no-verify-jwt" not in open(os.path.join(TMP, "dep-hr-alerts")).read())
ck("off: the first run only counts (the old draft is overdue), no card made", "1 overdue" in out and q1("select count(*) from public.app_data, jsonb_array_elements(data) e where key = 'ops_items' and e->>'id' like 'ops_wu_step_%'") == [[0]], out[-1500:])
ck("the proof left the write-ups and the switch as they were", q1("select data from public.app_data where key = 'discipline_actions'")[0][0] == WU and q1("select coalesce(data->>'hr_sop_reminders_live','') from public.app_data where key = 'ops_settings'") == [[""]])
# switched on, a real save: an owner saves and the card follows at once
base990(live_on=True); c = conn(); c.run(open(os.path.join(COPY, "hr_sop_reminders.sql")).read()); c.close()
q1("select public.hr_sop_reminders()")
card = lambda: (q1("select e from public.app_data, jsonb_array_elements(data) e where key = 'ops_items' and e->>'id' = 'ops_wu_step_w1'") or [[None]])[0][0]
ck("on: the old draft's reminder is a private card for Zach, overdue", card() and card()["owner"] == "zach@mo-care.com" and card()["sensitive"] is True and card()["urgency"] == "today" and card()["title"] == "Write-up, check the facts: Pat S.", card())
r = act(ZAC, "select public.upsert_app_data_item('discipline_actions', cast(:i as jsonb))", i=json.dumps(dict(WU[0], facts_checked_at="2026-10-02T15:00:00Z")))
ck("Zach checks the facts: on save the reminder moves to the next step at once", card()["title"] == "Write-up, decide it: Pat S." and card()["status"] == "open", (r, card()))
r = act(ZAC, "select public.upsert_app_data_item('discipline_actions', cast(:i as jsonb))", i=json.dumps(dict(WU[0], facts_checked_at="x", status="approved", approved_at=datetime.datetime.utcnow().isoformat())))
ck("approved today: the reminder closes (the meeting isn't due for 5 business days)", card()["status"] == "done", card())
q1("select public.hr_sop_reminders()"); q1("select public.hr_sop_reminders()")
ck("running again changes nothing (no duplicate, still closed)", q1("select count(*) from public.app_data, jsonb_array_elements(data) e where key = 'ops_items' and e->>'id' = 'ops_wu_step_w1'") == [[1]] and card()["status"] == "done")
ck("business days: Friday + 1 is Monday; Wednesday + 3 is Monday", q1("select public.hr_add_business_days('2026-10-16', 1)::text, public.hr_add_business_days('2026-10-14', 3)::text") == [["2026-10-19", "2026-10-19"]])
ck("Krystal can't run the reminder or see the cards' write-ups", str(act(KRY, "select public.hr_sop_reminders()")).startswith("ERR"))
# stops
code2, out2 = run990(c3=False)
ck("without part C3 (977): stops, nothing changed", code2 == 3 and "977" in out2 and q1("select count(*) from pg_proc where proname = 'hr_sop_reminders'") == [[0]], out2[-500:])
code3, out3 = run990(live_on=True)
ck("reminders already on: stops", code3 == 3 and "already switched on" in out3, out3[-400:])
code4, out4 = run990(live_shas={"supabase/functions/hr-alerts/index.ts": "0" * 64})
ck("the live hr-alerts is not what was reviewed: stops before anything", code4 == 3 and "not what Claude reviewed" in out4, out4[-400:])
code5, out5 = run990(shas={"hr-alerts/index.ts": "0" * 64})
ck("not the reviewed build: stops before anything", code5 == 2, out5[-300:])
code6, out6 = run990(fresh=False)
ck("run again: DONE", code6 == 0 and "RESULT: DONE" in out6, out6[-800:])
body = open(os.path.join(COPY, "hr_sop_990.py")).read() + open(os.path.join(COPY, "hr_sop_reminders.sql")).read()
ck("no em dashes", "—" not in body)

CMD = os.environ.get("CMD", "")
if CMD:
    src = open(CMD).read()
    P = re.search(r'^P="([^"]+)"', src, re.M).group(1); PIN = re.search(r'^PIN="([0-9a-f]{40})"', src, re.M).group(1)
    FH = os.path.join(TMP, "home990"); os.makedirs(os.path.join(FH, ".local", "bin"), exist_ok=True); os.makedirs(os.path.join(FH, "Desktop"), exist_ok=True)
    try: os.symlink(os.path.join(FAKEBIN, "supabase"), os.path.join(FH, ".local", "bin", "supabase"))
    except FileExistsError: pass
    FB = os.path.join(TMP, "fakebin990"); os.makedirs(FB, exist_ok=True); open(os.path.join(FB, "open"), "w").write("#!/bin/sh\nexit 0\n"); os.chmod(os.path.join(FB, "open"), 0o755)
    REPO = os.path.join(TMP, "repo990"); subprocess.run(["git", "clone", "-q", HERE, REPO], check=True)
    s2 = src.replace(P, REPO).replace("/Users/samantha/Desktop", os.path.join(FH, "Desktop"))
    ck("the launcher pins a commit that exists", subprocess.run(["git", "-C", REPO, "cat-file", "-e", PIN + "^{commit}"]).returncode == 0, PIN)
    LC = os.path.join(TMP, "launch990.command"); open(LC, "w").write(s2); os.chmod(LC, 0o755)
    base990(); M.clear()
    shutil.rmtree(os.path.join(TMP, "live"), ignore_errors=True)
    env = dict(ENVF(""), HOME=FH, PATH=FB + ":" + os.environ["PATH"]); [env.pop(k) for k in ("SB_REPORT", "SB_FNROOT", "SB_TOKEN", "SB_LIVE_SHAS")]
    env["REAL_LIVE"] = os.environ.get("REAL_LIVE", "")
    p = subprocess.run(["zsh", LC], input="sbp_fake_token\n\n", env=env, capture_output=True, text=True, timeout=300)
    reps = sorted(glob.glob(os.path.join(FH, "Desktop", "990 *report*.txt")))
    rep = open(reps[-1]).read() if reps else ""
    ck("the launcher runs the reviewed build to DONE", "RESULT: DONE" in rep and "✗" not in rep, p.stdout[-1500:] + p.stderr[-800:] + rep[-800:])

for n_, okk, note in res: print(("PASS  " if okk else "FAIL  ") + n_ + ("" if okk else "\n      " + str(note).replace("\n", "\n      ")))
print(f"{sum(1 for _, o, _ in res if o)}/{len(res)} passed"); raise SystemExit(0 if all(o for _, o, _ in res) else 1)
