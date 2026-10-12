#!/usr/bin/env python3
# Rehearses Desktop 627 against a real Postgres (practice_run_pgbridge.mjs): archived sweep cases, a fresh dark report
# (stood in), and the watcher's dry run (stood in). PGLITE=<path> python3 restore_open_shifts_627_test.py
import os, json, subprocess, runpy, tempfile, socket, datetime as dt
ROOT = os.path.dirname(os.path.abspath(__file__)); FNROOT = os.path.join(ROOT, "supabase", "functions")
s = socket.socket(); s.bind(("127.0.0.1", 0)); PORT = s.getsockname()[1]; s.close()
srv = subprocess.Popen(["node", os.path.join(ROOT, "practice_run_pgbridge.mjs"), str(PORT)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=os.environ)
assert srv.stdout.readline().strip() == b"ready"
TMP = tempfile.mkdtemp()
os.environ.update({"SB_API_BASE": f"http://127.0.0.1:{PORT}", "SB_TOKEN": "sbp_test", "SB_SUPA_CLI": "/bin/ls", "SB_FNROOT": FNROOT, "SB_REPORT": os.path.join(TMP, "r.txt"), "SB_STEP": "627"})
import cc_step_lib as L
res = []
def ck(n, c, note=""): res.append((n, bool(c), "" if c else str(note)[:600]))
def q(x): ok, r = L.sql("zngsgedlsxinbygwmxwn", x); assert ok, r; return r
CHI = dt.timezone(dt.timedelta(hours=-5)); T = dt.datetime.now(CHI).date()
d = lambda n: (T + dt.timedelta(days=n)).isoformat()
A = "Samantha (Desktop 626)"
def sw(i, sched, first, fut, asked=0, client="Ed Client"):
    return {"id": f"cwo_s{sched}", "client": client, "axiscare_visit_id": f"s={sched}:d={first}", "shift_date": first, "shift_time": "09:00-14:00", "reason": "open",
            "status": "open", "opened_by": "ongoing-sweep", "opened_at": "2026-10-10T00:00:00Z", "asked": [{"name": "x"}] * asked,
            "shift_pattern": {"v": 2, "kind": "open_ongoing", "schedule_id": sched, "future_dates": fut}, "archived_at": "2026-10-12T05:51:00Z", "archived_by": A, "archived_reason": "testing"}
arch = [sw(1, "11", d(-1), [d(-1), d(1), d(2)], asked=3),            # first date past, d1 staffed now, d2 open -> back at d2
        sw(2, "22", d(1), [d(1), d(2)], client="Steve Client"),       # all staffed -> stays
        sw(3, "33", d(-3), [d(-3), d(-2)], client="Old Client"),      # nothing upcoming -> stays
        sw(4, "44", d(3), [d(3)], client="Live Client"),              # schedule already has a live open case -> stays
        {"id": "cw_lee", "client": "LeeAnn Walker", "axiscare_visit_id": f"s=9:d={d(0)}", "status": "open", "opened_by": "axiscare-watch", "archived_by": A},
        {"id": "cw_old625", "status": "resolved", "opened_by": "ongoing-sweep", "archived_by": "Samantha (Desktop 625)"}]
cases = [{"id": "cw_live44", "axiscare_visit_id": f"s=44:d={d(3)}", "status": "open"}]
rows = [{"visit_id": f"s=11:d={d(1)}", "caregiver": "Amy"}, {"visit_id": f"v=7:s=22:d={d(1)}", "caregiver": "Bo"}, {"visit_id": f"s=22:d={d(2)}", "caregiver": "Cy"}]
def seed(r=rows):
    q("delete from public.app_data where key in ('coverage_cases','coverage_cases_archive','match_dark_report','ops_settings')")
    for k, v in [("coverage_cases", cases), ("coverage_cases_archive", arch), ("match_dark_report", {"rows": r}), ("ops_settings", {"coverage_send_live": True})]:
        q(f"insert into public.app_data (key, data) values ('{k}', '{json.dumps(v)}'::jsonb)")
DUP = [False]; DARK = [True]; calls = []
real_http = L.http
def fake_http(m, url, body=None, headers=None, timeout=120):
    if "/api-keys" in url: return 200, json.dumps([{"name": "service_role", "api_key": "eyJsvc"}])
    if "/functions/v1/match-dark" in url: calls.append("dark"); return (200, json.dumps({"ok": True, "counts": {"visits": 3, "open_visits": 5}})) if DARK[0] else (502, "AxisCare responded 401")
    if "/functions/v1/coverage-watch" in url:
        calls.append(url); return 200, json.dumps({"unassigned_detail": [], "ongoing_sweep": {"ran": True, "would_open": [{"schedule_id": "11"}] if DUP[0] else [{"schedule_id": "99"}]}})
    return real_http(m, url, body, headers, timeout)
L.http = fake_http
def run():
    L.lines.clear(); L.fails.clear()
    try: runpy.run_path(os.path.join(ROOT, "restore_open_shifts_627.py"), run_name="__main__")
    except SystemExit as e: return e.code, open(os.environ["SB_REPORT"]).read()
seed(); code, txt = run()
ck("627 finishes", code == 0, txt[-900:])
ck("AxisCare is read fresh first", calls and calls[0] == "dark" and "AxisCare read fresh" in txt, calls)
ck("Part 1 says Cara's texts are on", "texts are ON" in txt, txt[:800])
ca = q("select data::jsonb as d from public.app_data where key = 'coverage_cases'")[0]["d"]; ar = q("select data::jsonb as d from public.app_data where key = 'coverage_cases_archive'")[0]["d"]
b = next((x for x in ca if x["id"] == "cwo_s11"), None)
ck("the schedule with an open upcoming date is back, open, moved to that date, asks kept, archive stamps gone",
   b and b["status"] == "open" and b["shift_date"] == d(2) and b["axiscare_visit_id"] == f"s=11:d={d(2)}" and b["shift_pattern"]["future_dates"] == [d(2)] and len(b["asked"]) == 3 and "archived_by" not in b and b["restored_by"].startswith("Samantha (Desktop 627)"), b)
ck("only that one came back; the live case stays", sorted(x["id"] for x in ca) == ["cw_live44", "cwo_s11"], [x["id"] for x in ca])
ck("fully staffed, no upcoming dates, already-live schedule, LeeAnn's test and 625's stay archived", sorted(x["id"] for x in ar) == ["cw_lee", "cw_old625", "cwo_s22", "cwo_s33", "cwo_s44"], [x["id"] for x in ar])
ck("the report names why each stays", "every upcoming date now has a caregiver" in txt and "no upcoming dates left" in txt and "already has an open case" in txt, txt[:2000])
ck("proof: back on the board, watcher would open no second case", "1 open on Cara's board" in txt and "no second case would open" in txt and "dry=1" in calls[-1], txt[-800:])
seed(); DUP[0] = True; code, txt = run()
ck("if the watcher would open a second case, the step says so", code == 9 and "would open a second case" in txt, txt[-500:])
DUP[0] = False; seed(); DARK[0] = False; code, txt = run()
ck("if AxisCare cannot be read fresh, nothing moves", code == 3 and "STOPPED before anything changed" in txt and len(q("select data::jsonb as d from public.app_data where key = 'coverage_cases'")[0]["d"]) == 1, txt[-400:])
srv.terminate()
for n, ok, note in res: print(("PASS  " if ok else "FAIL  ") + n + ("" if ok else "  " + note))
print(f"{sum(1 for r in res if r[1])}/{len(res)} passed")
