#!/usr/bin/env python3
# Rehearses Desktop 636 (read only) on PGlite with a small Training schema + Hub roster. PGLITE=<path> python3 training_look_636_test.py
import os, json, subprocess, runpy, tempfile, socket
ROOT = os.path.dirname(os.path.abspath(__file__))
s = socket.socket(); s.bind(("127.0.0.1", 0)); PORT = s.getsockname()[1]; s.close()
srv = subprocess.Popen(["node", os.path.join(ROOT, "practice_run_pgbridge.mjs"), str(PORT)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=os.environ)
assert srv.stdout.readline().strip() == b"ready"
T = tempfile.mkdtemp()
os.environ.update({"SB_API_BASE": f"http://127.0.0.1:{PORT}", "SB_TOKEN": "sbp_test", "SB_SUPA_CLI": "/bin/ls", "SB_FNROOT": os.path.join(ROOT, "supabase", "functions"), "SB_REPORT": T + "/r.txt", "SB_STEP": "636"})
import cc_step_lib as L
def q(x, ref="zngsgedlsxinbygwmxwn"):
    out = None
    for stmt in [t.strip() for t in x.split(";") if t.strip()]:
        ok, out = L.sql(ref, stmt); assert ok or str(out) in ("{}", "[]"), (stmt[:80], out)   # DDL answers with no rows
    return out
q("""create schema if not exists storage; drop table if exists storage.objects; create table storage.objects (bucket_id text, name text);
drop table if exists public.enrollments, public.courses, public.caregivers, public.inservice_records cascade;
create table public.caregivers (id uuid primary key, axiscare_id text, active boolean default true);
create table public.courses (id uuid primary key, slug text, title text, hours numeric);
create table public.enrollments (caregiver_id uuid, course_id uuid, status text, completed_at timestamptz, completion_note text, completion_doc_path text, signed_form_path text);
create table public.inservice_records (id serial, doc_path text);
insert into public.caregivers values ('00000000-0000-0000-0000-000000000001','11',true),('00000000-0000-0000-0000-000000000002','12',true),('00000000-0000-0000-0000-000000000003',null,true),('00000000-0000-0000-0000-000000000004','99',false);
insert into public.courses values ('10000000-0000-0000-0000-000000000001','agency-orientation','Agency orientation',2),('10000000-0000-0000-0000-000000000002','dementia-care','Dementia care',4);
insert into public.enrollments values ('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','complete',now(),null,null,null),
 ('00000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','complete',now(),'from WellSky','prior/x.pdf',null),
 ('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','in_progress',null,null,null,null);
insert into storage.objects values ('waiver-docs','certificates/00000000-0000-0000-0000-000000000001/agency-orientation.pdf');
insert into public.inservice_records (doc_path) values ('inservice/a.pdf'),(null);""", "rdqujxiycycwhskyvrwa")
q("delete from public.app_data where key in ('caregivers','ops_settings')")
roster = [{"axiscare_id": "11", "orient_date": "2026-09-01", "orient_proof": "https://training.mo-care.com", "th_synced": "2026-10-01"}, {"axiscare_id": "50", "alz_proof": "training/50/alz.pdf", "alz_date": "2026-08-01"}, {"name": "no id"}]
q(f"insert into public.app_data (key, data) values ('caregivers', '{json.dumps(roster)}'::jsonb), ('ops_settings', '{{\"training_sync_live\": false}}'::jsonb)")
before = q("select md5(string_agg(key || data::text, ',' order by key)) as h from public.app_data")[0]["h"]
try: runpy.run_path(os.path.join(ROOT, "training_look_636.py"), run_name="__main__")
except SystemExit as e: code = e.code
txt = open(T + "/r.txt").read()
after = q("select md5(string_agg(key || data::text, ',' order by key)) as h from public.app_data")[0]["h"]
res = [("finishes", code == 0), ("Training caregivers counted", "caregivers: 3 active (2 with an AxisCare number), 4 in all" in txt),
  ("orientation: 2 complete, 1 certificate, 1 entered after with a document", "Agency orientation (agency-orientation, 2 h): 2 complete (2 by active caregivers) · certificate PDF saved: 1 · entered after the fact: 1 (with a document: 1)" in txt),
  ("dementia: 0 complete, 1 active not finished", "Dementia care (dementia-care, 4 h): 0 complete" in txt and "active not finished yet: 1" in txt),
  ("in-service and certificate store counted", "annual in-service records: 2 (1 with a document)" in txt and "certificate files in the store: 1" in txt),
  ("Hub switch and roster read", "training_sync_live): false" in txt and "roster: 3 caregivers (2 with an AxisCare number" in txt and "orientation 1, dementia 1" in txt and "ever synced from Training: 1" in txt),
  ("proof kinds", "from the Training Platform 0, a plain link 1, uploaded in the Hub 1" in txt),
  ("match by AxisCare number", "in both: 1 · only in Training: 1 · only in the Hub: 1" in txt), ("changes nothing", before == after)]
srv.terminate()
for n, ok in res: print(("PASS  " if ok else "FAIL  ") + n)
print(txt)
print(f"{sum(ok for _, ok in res)}/{len(res)} passed")
