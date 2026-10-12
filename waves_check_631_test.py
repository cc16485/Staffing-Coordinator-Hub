#!/usr/bin/env python3
# Rehearses Desktop 631 (read only) against a real Postgres (practice_run_pgbridge.mjs). PGLITE=<path> python3 waves_check_631_test.py
import os, json, subprocess, runpy, tempfile, socket
ROOT = os.path.dirname(os.path.abspath(__file__))
s = socket.socket(); s.bind(("127.0.0.1", 0)); PORT = s.getsockname()[1]; s.close()
srv = subprocess.Popen(["node", os.path.join(ROOT, "practice_run_pgbridge.mjs"), str(PORT)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=os.environ)
assert srv.stdout.readline().strip() == b"ready"
TMP = tempfile.mkdtemp()
os.environ.update({"SB_API_BASE": f"http://127.0.0.1:{PORT}", "SB_TOKEN": "sbp_test", "SB_SUPA_CLI": "/bin/ls", "SB_FNROOT": os.path.join(ROOT, "supabase", "functions"), "SB_REPORT": os.path.join(TMP, "r.txt"), "SB_STEP": "631"})
import cc_step_lib as L
def q(x): ok, r = L.sql("zngsgedlsxinbygwmxwn", x); assert ok, r; return r
q("delete from public.app_data where key in ('ops_settings','coverage_cases','coverage_cases_archive')")
cases = [{"id": "a", "asked": [{"auto": True, "at": "2026-09-16T17:00:00Z"}, {"picked_by_coordinator": True, "at": "2026-10-11T10:00:00Z"}]}]
arch = [{"id": "b", "asked": [{"auto": True, "at": "2026-09-14T10:00:00Z"}, {"picked_by_coordinator": True, "at": "2026-09-20T10:00:00Z"}]}]
for k, v in [("ops_settings", {"coverage_send_live": True, "coverage_manual_select": True}), ("coverage_cases", cases), ("coverage_cases_archive", arch)]:
    q(f"insert into public.app_data (key, data) values ('{k}', '{json.dumps(v)}'::jsonb)")
before = q("select md5(string_agg(key || data::text, ',' order by key)) as h from public.app_data")[0]["h"]
try: runpy.run_path(os.path.join(ROOT, "waves_check_631.py"), run_name="__main__")
except SystemExit as e: code = e.code
txt = open(os.environ["SB_REPORT"]).read(); after = q("select md5(string_agg(key || data::text, ',' order by key)) as h from public.app_data")[0]["h"]
res = [("finishes", code == 0), ("reads the switches", "manual select): true" in txt), ("counts automatic asks, both lists, last date", "automatic waves: 2 in all" in txt and "2026-09-16T17:00" in txt),
       ("counts picked asks", "picked by a person: 2 in all" in txt and "2026-10-11T10:00" in txt), ("changes nothing", before == after)]
srv.terminate()
for n, ok in res: print(("PASS  " if ok else "FAIL  ") + n)
if not all(ok for _, ok in res): print(txt)
print(f"{sum(ok for _, ok in res)}/{len(res)} passed")
