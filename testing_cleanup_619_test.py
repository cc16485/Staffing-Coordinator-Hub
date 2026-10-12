#!/usr/bin/env python3
# Rehearses Desktop 619 against a real Postgres (practice_run_pgbridge.mjs) with a test Do Not Return entry, test call-offs
# and a stored dark report; the function deploy and the live report run are stood in. PGLITE=<path> python3 testing_cleanup_619_test.py
import os, sys, json, subprocess, runpy, tempfile, socket
ROOT = os.path.dirname(os.path.abspath(__file__)); FNROOT = os.path.join(ROOT, "supabase", "functions")
s = socket.socket(); s.bind(("127.0.0.1", 0)); PORT = s.getsockname()[1]; s.close()
srv = subprocess.Popen(["node", os.path.join(ROOT, "practice_run_pgbridge.mjs"), str(PORT)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=os.environ)
assert srv.stdout.readline().strip() == b"ready"
TMP = tempfile.mkdtemp()
os.environ.update({"SB_API_BASE": f"http://127.0.0.1:{PORT}", "SB_TOKEN": "sbp_test", "SB_SUPA_CLI": "/bin/ls", "SB_FNROOT": FNROOT, "SB_REPORT": os.path.join(TMP, "r.txt"), "SB_STEP": "619"})
import cc_step_lib as L
res = []
def ck(n, c, note=""): res.append((n, bool(c), "" if c else str(note)[:400]))
def q(x): ok, r = L.sql("zngsgedlsxinbygwmxwn", x); assert ok, r; return r
dnr = [{"client": "Hal Client", "axiscare_client_id": "22", "caregiver": "Bo Bright", "reason": "testing", "logged_at": "2026-10-01"}, {"client": "Ida Client", "caregiver": "Real Person", "reason": "real"}]
rows = [{"visit_id": "v1", "client": "Hal Client", "client_id": "22", "caregiver": "Bo Bright", "caregiver_id": "12", "group": "not_for_visit", "reason": "Do Not Return for this client"}]
cases = [{"id": "c1", "status": "resolved"}, {"id": "c2", "status": "open"}]
q("delete from public.app_data where key in ('dnr_log','coverage_cases','match_dark_report','ops_settings','dnr_log_cleared','coverage_cases_archive')")
for k, v in [("dnr_log", dnr), ("coverage_cases", cases), ("match_dark_report", {"rows": rows}), ("ops_settings", {"coverage_send_live": False})]:
    q(f"insert into public.app_data (key, data) values ('{k}', '{json.dumps(v)}'::jsonb)")
L.fmeta = lambda ref, fn: (200, {"version": 1, "verify_jwt": True})
L.deploy = lambda *a: True
L.live_files = lambda ref, fn: (True, {k: L.sha(os.path.join(L.ROOT, k)) for k in L.need(FNROOT, fn)})
real_http = L.http
def fake_http(m, url, body=None, headers=None, timeout=120):
    if "/api-keys" in url: return 200, json.dumps([{"name": "service_role", "api_key": "eyJsvc"}])
    if "/functions/v1/match-dark" in url:
        q("update public.app_data set data = jsonb_set(data::jsonb, '{rows}', '[]'::jsonb) where key = 'match_dark_report'")
        return 200, json.dumps({"ok": True, "counts": {"visits": 1, "ready": 0, "likely_fit": 1, "one_more_step": 0, "not_for_visit": 0}, "replay": 0})
    return real_http(m, url, body, headers, timeout)
L.http = fake_http
def run():
    L.lines.clear(); L.fails.clear()
    try: runpy.run_path(os.path.join(ROOT, "testing_cleanup_619.py"), run_name="__main__")
    except SystemExit as e: return e.code, open(os.environ["SB_REPORT"]).read()
code, txt = run()
ck("619 finishes", code == 0, txt[-600:])
ck("Part 1 names the test entry (Bo Bright for Hal Client) and leaves the real one", "Bo Bright for Hal Client" in txt and "1 cleared by this step" in txt, txt[:900])
a = q("select data::jsonb as d from public.app_data where key = 'dnr_log'")[0]["d"]; c = q("select data::jsonb as d from public.app_data where key = 'dnr_log_cleared'")[0]["d"]
ck("the test entry moved to dnr_log_cleared with who, when and why; the real one stays active", len(a) == 1 and a[0]["caregiver"] == "Real Person" and len(c) == 1 and c[0]["caregiver"] == "Bo Bright" and c[0]["cleared_by"].startswith("Samantha") and c[0]["cleared_at"] != "now", (a, c))
ca = q("select data::jsonb as d from public.app_data where key = 'coverage_cases'")[0]["d"]; ar = q("select data::jsonb as d from public.app_data where key = 'coverage_cases_archive'")[0]["d"]
ck("every call-off moved to the archive, stamped; none left active; nothing deleted", ca == [] and len(ar) == 2 and all(x.get("archived_by", "").startswith("Samantha") and x.get("archived_at") for x in ar), (ca, ar))
ck("the proof shows the counts and no Do Not Return visit left", "0 active, 2 in the archive" in txt and "no visit shows Do Not Return now" in txt, txt[-900:])
# Cara live with an open case: stops before any change
for k, v in [("dnr_log", dnr), ("coverage_cases", cases), ("match_dark_report", {"rows": rows}), ("ops_settings", {"coverage_send_live": True})]:
    q(f"delete from public.app_data where key = '{k}'"); q(f"insert into public.app_data (key, data) values ('{k}', '{json.dumps(v)}'::jsonb)")
q("delete from public.app_data where key in ('dnr_log_cleared','coverage_cases_archive')")
code, txt = run()
ck("Cara's texts on while a case is open: STOPPED before anything changed", code == 3 and "STOPPED" in txt and len(q("select data::jsonb as d from public.app_data where key = 'coverage_cases'")[0]["d"]) == 2 and not q("select 1 from public.app_data where key = 'coverage_cases_archive'"), txt[-400:])
srv.terminate()
for n, ok, note in res: print(("PASS  " if ok else "FAIL  ") + n + ("" if ok else "  " + note))
print(f"{sum(1 for r in res if r[1])}/{len(res)} passed")
