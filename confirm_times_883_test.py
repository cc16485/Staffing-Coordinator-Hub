#!/usr/bin/env python3
# Rehearsal of 883 (confirm_times_883.py, the EVV form retired): a FAKE management API whose database queries run in a
# throwaway LOCAL Postgres (pgserver) set up like the live tables, a FAKE supabase CLI and fake function doors. Never
# touches GitHub, Supabase, GoHighLevel or AxisCare. Runs from a fresh copy of this folder's committed build (her rule).
#   python3 confirm_times_883_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil, glob, datetime
import pgserver
from pg8000.native import Connection, DatabaseError
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1600]))
TMP = tempfile.mkdtemp(prefix="t883-"); BIN = os.path.join(TMP, "bin"); os.makedirs(BIN)
COPY = os.path.join(TMP, "hub")
subprocess.run(["git", "clone", "-q", HERE, COPY], check=True)
HEAD = subprocess.run(["git", "-C", HERE, "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
subprocess.run(["git", "-C", COPY, "checkout", "-q", HEAD], check=True)
FNROOT = os.path.join(COPY, "supabase", "functions")
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
FN_FILES = ("timekeeper-watch/index.ts", "coverage-watch/index.ts", "clockin-alert/index.ts", "_shared/confirm-times.ts", "_shared/duty.ts")
SHAS = {k: sha(os.path.join(FNROOT, k)) for k in FN_FILES}

# ── the local Postgres ──
D = os.path.join(TMP, "pg"); os.makedirs(D)
srvpg = pgserver.get_server(D)
host = [kv[5:] for kv in srvpg.get_uri().split("?", 1)[1].split("&") if kv.startswith("host=")][0]
SOCK = [p for p in glob.glob(os.path.join(host, ".s.PGSQL.*")) if not p.endswith(".lock")][0]
conn = lambda: Connection(user="postgres", database="postgres", unix_sock=SOCK)
def seed(forms=True, fix=True, msg_out="Hi {first_name}, clock out please. Form: sc.mo-care.com/evv-correction-form", sop_draft=True, switches=True):
    c = conn()
    c.run("drop schema if exists public cascade; create schema public")
    c.run("create table public.app_data(key text primary key, data jsonb, updated_at timestamptz default now())")
    c.run("""create function public.upsert_app_data_item(target_key text, item jsonb) returns void language plpgsql security invoker as $$
declare d jsonb; begin
  select data into d from app_data where key = target_key for update;
  if d is null then insert into app_data(key, data) values (target_key, jsonb_build_array(item)); return; end if;
  update app_data set data = (select coalesce(jsonb_agg(case when x->>'id' = item->>'id' then item else x end), '[]'::jsonb) from jsonb_array_elements(d) x)
       || case when exists (select 1 from jsonb_array_elements(d) x where x->>'id' = item->>'id') then '[]'::jsonb else jsonb_build_array(item) end
   where key = target_key; end $$""")
    c.run("create table public.evv_submissions(id bigint primary key, attendant text, consumer text, visitdate date, new_in text, new_out text, processed boolean default false, "
          "client_sig_status text, caregiver_axiscare_id text, client_axiscare_id text, caregiver_linked_name text, client_linked_name text, axiscare_visit_id text)")
    st = {"coverage_alert_admins": ["sam@mo-care.com"], "timekeeper_watch_live": switches, "loops_close_live": switches, "evv_next_visit_live": True, "evv_chase_live": True, "other_setting": 7}
    if msg_out: st["timekeeper_msg_out"] = msg_out
    ops = [{"id": "ops_keep_1", "kind": "staffing_issue", "status": "open", "title": "unrelated"}]
    if fix: ops += [{"id": "ops_evvfix_9301", "kind": "evv_fix", "status": "open", "visit_id": "9301", "shift_date": "2026-10-15", "shift_time": "09:00", "about": "Maria Lopez",
                     "title": "EVV fix needed: Maria Lopez, Ruth's 9am shift (2026-10-15) had no clock-in"}]
    ops += [{"id": "ops_cft_9555", "kind": "confirm_times", "status": "done", "title": "already done"}]
    tk = [{"id": "tk_9301", "visit_id": "9301", "evv_fix_item": "ops_evvfix_9301", "client_first": "Ruth", "client_axiscare_id": "701", "caregiver": "Maria Lopez", "caregiver_axiscare_id": "501"}]
    sop = [{"id": "sop_no_clock", "slot": "no_clock", "status": "draft", "title": "A caregiver didn't clock in or out"}] if sop_draft else []
    for k, v in (("ops_settings", st), ("ops_items", ops), ("timekeeper_cases", tk), ("sop_library", sop)): c.run("insert into public.app_data(key, data) values (:k, cast(:d as jsonb))", k=k, d=json.dumps(v))
    if forms:
        c.run("insert into public.evv_submissions values (12, 'Ann Cole', 'Ted Burns', '2026-10-14', '14:00', '16:05', false, 'waiting', '502', '702', null, 'Ted Burns', null)")
        c.run("insert into public.evv_submissions values (13, 'Joyce Kim', 'Lou Park', '2026-10-13', '08:00', '', false, 'signed', null, null, null, null, '9555')")
        c.run("insert into public.evv_submissions values (14, 'Old Done', 'X', '2026-10-01', '08:00', '09:00', true, 'signed', null, null, null, null, null)")
    c.close()
def app(k):
    c = conn(); r = c.run("select data from public.app_data where key = :k", k=k); c.close(); return r[0][0] if r else None

M = {}; CALLS = []
def reset(**m):
    M.clear(); M.update(dict(fail_deploy=None, no_key=False, dry_bad=False, gates={"timekeeper-watch": False, "coverage-watch": False, "clockin-alert": False}), **m); CALLS.clear()
    p = os.path.join(TMP, "deploys")
    if os.path.exists(p): os.remove(p)
    open(os.path.join(TMP, "mode.json"), "w").write(json.dumps(M))
def deployed():
    p = os.path.join(TMP, "deploys")
    return [json.loads(l) for l in open(p).read().splitlines()] if os.path.exists(p) else []
def jsonable(v):
    if isinstance(v, (datetime.date, datetime.datetime)): return v.isoformat()
    return v
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj): b = json.dumps(obj, default=str).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_OPTIONS(self): CALLS.append(("OPTIONS", self.path)); self._send(200, {})
    def do_GET(self):
        CALLS.append(("GET", self.path))
        if "/api-keys" in self.path: return self._send(200, [] if M["no_key"] else [{"name": "service_role", "api_key": "eyJfake"}])
        m = re.match(r"/v1/projects/\w+/functions/([\w-]+)$", self.path)
        if m:
            d = [x for x in deployed() if x[0] == m.group(1)]
            return self._send(200, {"verify_jwt": (not d[-1][1]) if d else M["gates"].get(m.group(1), False), "version": 10 + len(d)})
        self._send(404, {})
    def do_PATCH(self): CALLS.append(("PATCH", self.path)); self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); raw = self.rfile.read(n); b = json.loads(raw or b"null"); CALLS.append(("POST", self.path, b))
        if self.path.startswith("/functions/v1/timekeeper-watch"):
            if M["dry_bad"]: return self._send(500, {"error": "boom"})
            return self._send(200, {"mode": "DRY RUN", "confirm_times": {"live": False, "out_after_min": 30}, "evv_next_visit": {"retired": "2026-10-17"}})
        if self.path.endswith("/database/query"):
            c = conn()
            try:
                rows = c.run(b["query"]); cols = [d_["name"] for d_ in (c.columns or [])]
                return self._send(201, [dict(zip(cols, [jsonable(v) for v in r])) for r in (rows or [])])
            except DatabaseError as e: return self._send(400, {"message": str(e)[:300]})
            finally: c.close()
        self._send(404, {})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
open(os.path.join(BIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, json, os, shutil
a = sys.argv[1:]; M = json.load(open({os.path.join(TMP, 'mode.json')!r}))
if os.environ.get('SUPABASE_ACCESS_TOKEN') != 'sbp_test': sys.exit(1)
if a[:2] == ['functions', 'deploy']:
    if M.get('fail_deploy') == a[2]: print('deploy failed: boom', file=sys.stderr); sys.exit(1)
    open({os.path.join(TMP, 'deploys')!r}, 'a').write(json.dumps([a[2], '--no-verify-jwt' in a]) + '\\n'); sys.exit(0)
if a[:2] == ['functions', 'download']:
    shutil.copytree({FNROOT!r}, os.path.join(os.getcwd(), 'supabase', 'functions'), dirs_exist_ok=True); sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(BIN, "supabase"), 0o755)
def run(shas=SHAS, main=HEAD, seedargs=None, reseed=True, **mode):
    if reseed: seed(**(seedargs or {}))
    reset(**mode); rep = os.path.join(TMP, "r.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_STEP="883", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_MAIN_REF=main,
               SB_SUPA_CLI=os.path.join(BIN, "supabase"), SB_FNROOT=FNROOT, SB_FN_SHAS=json.dumps(shas))
    env.pop("SUPABASE_ACCESS_TOKEN", None)
    p = subprocess.run(["python3", os.path.join(COPY, "confirm_times_883.py")], cwd=COPY, env=env, capture_output=True, text=True, timeout=600)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
item = lambda i: next((x for x in app("ops_items") if x.get("id") == i), None)
writes = lambda: [x for x in CALLS if x[0] == "POST" and x[1].endswith("/database/query") and re.search(r"\b(update|upsert_app_data_item)\b", x[2]["query"], re.I)]

c, out = run()
ck("1 good run: three functions deployed (gateway settings kept), DONE, nothing sent", c == 0 and "RESULT: DONE" in out and "✗" not in out
   and deployed() == [["timekeeper-watch", True], ["coverage-watch", True], ["clockin-alert", True]] and not any(x[0] == "POST" and "/conversations" in x[1] for x in CALLS), out)
st = app("ops_settings")
ck("2 settings: next-visit text and Saturday reminder off; the form-link wording removed; old values kept; other settings untouched",
   st["evv_next_visit_live"] is False and st["evv_chase_live"] is False and "timekeeper_msg_out" not in st and st["other_setting"] == 7
   and st["confirm_times_previous"]["timekeeper_msg_out"].endswith("evv-correction-form") and st["confirm_times_previous"]["evv_next_visit_live"] is True, st)
f12 = item("ops_cft_form_12")
ck("3 a waiting form becomes ONE Call card: Ted, Ann, the times on the form, from the form, owned by the first admin", f12 and f12["kind"] == "confirm_times" and f12["status"] == "open"
   and re.match(r"^Call Ted to confirm Ann's arrival and departure times \(Wednesday, Oct 14, 2 PM to 4:05 PM\)$", f12["title"]) and f12["client_axiscare_id"] == "702"
   and "asked for on the form 2 PM to 4:05 PM" in f12["detail"] and f12["detail"].startswith("From an EVV correction form Ann Cole sent") and f12["owner"] == "sam@mo-care.com" and f12["from_evv_form"] == "12", f12)
ck("4 a form for a visit that already has a Call card (done) gets no second card; a processed form is left alone", not item("ops_cft_9555") or item("ops_cft_9555")["status"] == "done"
   and not item("ops_cft_form_14") and not item("ops_cft_form_13"), [i["id"] for i in app("ops_items")])
fx = item("ops_cft_9301"); old = item("ops_evvfix_9301")
ck("5 an open EVV fix card becomes a Call card for the same visit (client from its alert), and the old card closes", fx and fx["client_first"] == "Ruth" and fx["client_axiscare_id"] == "701"
   and fx["missing"] == "both" and fx["from_evv_fix"] == "ops_evvfix_9301" and old["status"] == "resolved" and old["resolved_how"] == "became_confirm_times", [fx, old])
ck("6 nothing else in Needs Attention changed", item("ops_keep_1") == {"id": "ops_keep_1", "kind": "staffing_issue", "status": "open", "title": "unrelated"})
sop = [d for d in app("sop_library") if d["id"] == "sop_no_clock"]
ck("7 the approved procedure replaces the draft and is published", len(sop) == 1 and sop[0]["status"] == "published" and sop[0]["title"] == "Missed clock-in or clock-out: confirm the times with the client"
   and len(sop[0]["steps"]) == 7 and "approved in chat" in sop[0]["reviewed_by"], sop)
ck("8 the report lists each card it made and the practice run", "Call Ted to confirm Ann's" in out and "Call Ruth to confirm Maria's" in out and "practice run of the watcher" in out, out)
c, out = run(seedargs=dict(msg_out="Hi {first_name}, please clock out for {client}."))
ck("9 her own wording without the form link is kept", c == 0 and app("ops_settings")["timekeeper_msg_out"] == "Hi {first_name}, please clock out for {client}.", out)
c, out = run(seedargs=dict(forms=False, fix=False, sop_draft=False, msg_out=""))
ck("10 nothing waiting: no cards, the procedure is added, DONE", c == 0 and "Call cards to make: 0" in out and len([i for i in app("ops_items") if i.get("kind") == "confirm_times" and i.get("status") == "open"]) == 0
   and [d["status"] for d in app("sop_library")] == ["published"], out)
c, out = run(seedargs=dict(switches=False))
ck("11 a switch off is pointed out in the report (cards then only listed by the watcher)", c == 0 and "NOTE: with either switch off" in out, out)
c, out = run(shas=dict(SHAS, **{"_shared/confirm-times.ts": "0" * 64}))
ck("12 not the reviewed build: stopped before any change", c != 0 and not deployed() and not writes() and app("ops_settings")["evv_next_visit_live"] is True, out)
BEFORE = subprocess.run(["git", "-C", HERE, "merge-base", "HEAD", "origin/main"], capture_output=True, text=True).stdout.strip()
c, out = run(main=BEFORE)
ck("13 not merged to GitHub's main yet: stopped before any change", c != 0 and "merge the pull request first" in out and not deployed() and not writes(), out)
c, out = run(fail_deploy="coverage-watch")
ck("14 a deploy fails: stopped, says which; settings, cards and procedure untouched", c == 7 and "STOPPED at coverage-watch" in out and not writes() and app("ops_settings")["evv_next_visit_live"] is True and not item("ops_cft_form_12"), out)
c, out = run(dry_bad=True)
ck("15 the practice run answering wrong is a ✗ line, not DONE", c == 9 and "RESULT: CHECK" in out, out)
c, out = run(); n1 = len(app("ops_items")); c2, out2 = run(reseed=False)
ck("16 running it twice is safe: the second run makes no second card and says the visits already have one", c == 0 and c2 == 0 and len(app("ops_items")) == n1 and "Call cards to make: 0" in out2, out2)
shutil.rmtree(TMP, ignore_errors=True); srv.shutdown()
bad = [r for r in res if not r[1]]
for n, okk, d in res: print(("PASS " if okk else "FAIL ") + n + ("\n     " + d if d else ""))
print(f"\n{len(res) - len(bad)}/{len(res)} passed"); raise SystemExit(1 if bad else 0)
