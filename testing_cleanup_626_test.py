#!/usr/bin/env python3
# Rehearses Desktop 626 against a real Postgres (practice_run_pgbridge.mjs) with test call-offs, office to-dos and a stored
# dark report; the function deploy and the live functions are stood in. PGLITE=<path> python3 testing_cleanup_626_test.py
import os, sys, json, subprocess, runpy, tempfile, socket
ROOT = os.path.dirname(os.path.abspath(__file__)); FNROOT = os.path.join(ROOT, "supabase", "functions")
s = socket.socket(); s.bind(("127.0.0.1", 0)); PORT = s.getsockname()[1]; s.close()
srv = subprocess.Popen(["node", os.path.join(ROOT, "practice_run_pgbridge.mjs"), str(PORT)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=os.environ)
assert srv.stdout.readline().strip() == b"ready"
TMP = tempfile.mkdtemp()
os.environ.update({"SB_API_BASE": f"http://127.0.0.1:{PORT}", "SB_TOKEN": "sbp_test", "SB_SUPA_CLI": "/bin/ls", "SB_FNROOT": FNROOT, "SB_REPORT": os.path.join(TMP, "r.txt"), "SB_STEP": "626"})
import cc_step_lib as L
res = []
def ck(n, c, note=""): res.append((n, bool(c), "" if c else str(note)[:500]))
def q(x): ok, r = L.sql("zngsgedlsxinbygwmxwn", x); assert ok, r; return r
cases = [{"id": "cw_s1_d13_g1", "axiscare_visit_id": "s=1:d=2026-10-13", "status": "open", "shift_date": "2026-10-13", "shift_time": "09:00-14:00", "client": "Ed Client", "opened_at": "2026-10-10T12:00:00Z", "opened_by": "coverage-watch"},
         {"id": "cw_s2_d12_g1", "axiscare_visit_id": "v=9:s=2:d=2026-10-12", "status": "by_hand", "shift_date": "2026-10-12", "client": "Lee Client", "calling_off": "Dee", "opened_at": "2026-10-09T12:00:00Z"},
         {"id": "cw_new", "axiscare_visit_id": "s=3:d=2026-10-14", "status": "open", "shift_date": "2026-10-14", "client": "New Client", "opened_at": "2026-10-12T09:00:00Z"}]
arch = [{"id": "cw_old", "status": "resolved", "archived_at": "2026-10-12T05:39:00Z"}]
ops = [{"id": "o1", "case_id": "cw_s1_d13_g1", "kind": "coverage_outcome", "status": "open", "title": "Was it covered?"},
       {"id": "o2", "case_id": "cw_old", "kind": "family_call", "status": "open", "title": "Call the family"},
       {"id": "o3", "case_id": "cw_new", "kind": "coverage_outcome", "status": "open", "title": "keep me"},
       {"id": "o4", "case_id": "cw_s2_d12_g1", "status": "resolved", "resolved_by": "Krystal"},
       {"id": "o5", "kind": "other", "status": "open"}]
rows = [{"visit_id": "s=2:d=2026-10-12", "caregiver": "Real Carer"}]
def seed():
    q("delete from public.app_data where key in ('coverage_cases','coverage_cases_archive','ops_items','match_dark_report','ops_settings')")
    for k, v in [("coverage_cases", cases), ("coverage_cases_archive", arch), ("ops_items", ops), ("match_dark_report", {"rows": rows, "at": "2026-10-12T05:39:00Z"}), ("ops_settings", {"coverage_watch_live": True, "coverage_send_live": True})]:
        q(f"insert into public.app_data (key, data) values ('{k}', '{json.dumps(v)}'::jsonb)")
L.fmeta = lambda ref, fn: (200, {"version": 40, "verify_jwt": True})
deployed = []
L.deploy = lambda *a: (deployed.append((a[2], q("select jsonb_array_length(data::jsonb) as n from public.app_data where key = 'coverage_cases'")[0]["n"])) or True)
L.live_files = lambda ref, fn: (True, {k: L.sha(os.path.join(L.ROOT, k)) for k in L.need(FNROOT, fn)})
REOPEN = [False]; calls = []
real_http = L.http
def fake_http(m, url, body=None, headers=None, timeout=120):
    if "/api-keys" in url: return 200, json.dumps([{"name": "service_role", "api_key": "eyJsvc"}])
    if "/functions/v1/coverage-watch" in url:
        calls.append(url)
        d = [{"visit": "s=1:d=2026-10-13", "verdict": "opens a case" if REOPEN[0] else "held: a person closed the last case and the shift hasn't changed since"}, {"visit": "s=9:d=2026-10-13", "verdict": "opens a case"}]
        return 200, json.dumps({"unassigned_detail": d, "ongoing_sweep": {"ran": True, "would_open": []}})
    if "/functions/v1/match-dark" in url: return 200, json.dumps({"ok": True, "counts": {"visits": 9, "likely_fit": 9}, "replay": 0})
    return real_http(m, url, body, headers, timeout)
L.http = fake_http
def run():
    L.lines.clear(); L.fails.clear()
    try: runpy.run_path(os.path.join(ROOT, "testing_cleanup_626.py"), run_name="__main__")
    except SystemExit as e: return e.code, open(os.environ["SB_REPORT"]).read()
seed(); code, txt = run()
ck("626 finishes", code == 0, txt[-900:])
ck("Part 1 shows Cara's switches, the two to archive and the newer one kept", "open-shift texts True" in txt and "2 opened before 625 ran" in txt and "1 opened since (kept)" in txt and "kept: 2026-10-14" in txt, txt[:1500])
ck("Part 1 says who AxisCare has on each shift now (v= ids matched)", "Real Carer is on it" in txt and "AxisCare now: no caregiver" in txt, txt[:1500])
ck("coverage-watch deployed BEFORE any call-off moved", deployed == [("coverage-watch", 3)], deployed)
ca = q("select data::jsonb as d from public.app_data where key = 'coverage_cases'")[0]["d"]; ar = q("select data::jsonb as d from public.app_data where key = 'coverage_cases_archive'")[0]["d"]
ck("the two old call-offs archived and stamped; the newer one stays active; nothing deleted", [x["id"] for x in ca] == ["cw_new"] and sorted(x["id"] for x in ar) == ["cw_old", "cw_s1_d13_g1", "cw_s2_d12_g1"] and all(x.get("archived_by", "").startswith("Samantha (Desktop 626)") for x in ar if x["id"] != "cw_old"), (ca, ar))
o = {x["id"]: x for x in q("select data::jsonb as d from public.app_data where key = 'ops_items'")[0]["d"]}
ck("office to-dos for archived call-offs (this step's and 625's) closed and stamped; others untouched", o["o1"]["status"] == "resolved" and o["o2"]["status"] == "resolved" and o["o1"]["resolved_by"].startswith("Samantha") and o["o3"]["status"] == "open" and o["o4"]["resolved_by"] == "Krystal" and o["o5"]["status"] == "open" and len(o) == 5, o)
ck("the watcher was asked in a dry run with the sweep", calls and "dry=1" in calls[0] and "sweep=1" in calls[0], calls)
ck("the proof: none would open again (another shift opening is not ours)", "none of the archived call-offs would open again" in txt and "1 active, 3 in the archive" in txt and "to-dos still open for archived call-offs: 0" in txt, txt[-1200:])
seed(); REOPEN[0] = True; code, txt = run()
ck("if the watcher would open an archived one again, the step says so", code == 9 and "would open these again" in txt, txt[-600:])
srv.terminate()
for n, ok, note in res: print(("PASS  " if ok else "FAIL  ") + n + ("" if ok else "  " + note))
print(f"{sum(1 for r in res if r[1])}/{len(res)} passed")
