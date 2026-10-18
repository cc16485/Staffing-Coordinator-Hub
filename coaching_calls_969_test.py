#!/usr/bin/env python3
# Rehearsal of 969 (coaching_calls_969.py, coaching calls part C1): the 961 rehearsal's local database (pgserver) with the
# coaching tracker installed by the real 961 step, then 969 on top, through a FAKE management API and a fake supabase
# tool whose "live" functions are GitHub main's until this step deploys them. Never touches Supabase or GoHighLevel.
#   python3 coaching_calls_969_test.py      (CMD=<Desktop .command> also rehearses the launcher with a fake HOME)
import os, json, re, subprocess, hashlib, glob, http.server, threading, datetime, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
_src = open(os.path.join(HERE, "hr_coaching_961_test.py")).read()
exec(_src[:_src.index("# 1 · the installer")])          # seed(), seed961(), act(), A(), card(), run() = the real 961, conn(), q1(), COPY, TMP ...
code961, out961 = run()
assert code961 == 0, out961[-800:]
res.clear()
MAIN = os.path.join(TMP, "main")
subprocess.run(["git", "clone", "-q", HERE, MAIN], check=True)
subprocess.run(["git", "-C", MAIN, "checkout", "-q", subprocess.run(["git", "-C", HERE, "rev-parse", "origin/main"], capture_output=True, text=True).stdout.strip()], check=True)
CHANGED = ["calls-feed", "call-pull", "call-tasks", "call-disposition"]
hsha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
def own_files(root, fn):
    d = os.path.join(root, "supabase", "functions", fn); out = {}
    for r_, _, fs in os.walk(d):
        for f in fs:
            p = os.path.join(r_, f); out["supabase/functions/" + os.path.relpath(p, os.path.join(root, "supabase", "functions")).replace(os.sep, "/")] = hsha(p)
    return out
LIVE_SHAS = {}
for fn in CHANGED: LIVE_SHAS.update(own_files(MAIN, fn))
FNR = os.path.join(COPY, "supabase", "functions")
FILES = ["hr-coach-call/index.ts", "_shared/coaching-calls.ts", "calls-feed/index.ts", "call-pull/index.ts", "call-tasks/index.ts", "call-disposition/index.ts", "_shared/ghl-call-bridge.ts", "_shared/staff-auth.ts", "_shared/job-auth.ts", "_shared/doc-log.ts"]
SHAS = {k: hsha(os.path.join(FNR, k)) for k in FILES}

def extra(storage=True, live_on=False):
    c = conn()
    c.run("drop schema if exists cron cascade; drop schema if exists vault cascade; drop schema if exists net cascade; drop schema if exists storage cascade")
    c.run("create schema cron; create schema vault; create schema net; create schema storage")
    c.run("create table cron.job(jobid serial, jobname text unique, schedule text, command text)")
    c.run("create function cron.schedule(n text, s text, cmd text) returns bigint language sql as $$ insert into cron.job(jobname, schedule, command) values (n, s, cmd) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$")
    c.run("create function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n returning true $$")
    c.run("create table vault.decrypted_secrets(name text, decrypted_secret text)"); c.run("insert into vault.decrypted_secrets values ('hub_job_secret', 'sekret')")
    c.run("create table net._http_response(id bigserial primary key, status_code int, content text)")
    c.run("""create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) returns bigint language sql as $$ insert into net._http_response(status_code, content) values (200, '{"ok": true, "looked": 0}') returning id $$""")
    c.run("create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[])")
    c.run("create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text)")
    c.run("insert into public.app_data(key, data) values ('ops_settings', cast(:d as jsonb)) on conflict (key) do update set data = excluded.data", d=json.dumps({"hr_coaching_calls_live": live_on}))
    c.close()
M = {}
GATES = {"calls-feed": True, "call-pull": True, "call-tasks": True, "call-disposition": False}
class F(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj): b = json.dumps(obj, default=str).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if "/api-keys" in self.path: return self._send(200, [{"name": "anon", "api_key": "eyJanonKEY"}, {"name": "service_role", "api_key": "eyJsvcKEY"}])
        if self.path.endswith("/secrets"): return self._send(200, [{"name": "GHL_TOKEN"}, {"name": "GHL_LOCATION_ID"}])
        m = re.search(r"/functions/([a-z-]+)$", self.path)
        if m:
            fn = m.group(1)
            if fn == "hr-coach-call": return self._send(200, {"version": 1, "verify_jwt": True}) if os.path.exists(os.path.join(TMP, "dep-" + fn)) else self._send(404, {})
            if fn in GATES and not (M.get("missing") == fn): return self._send(200, {"version": 3, "verify_jwt": M.get("gate_" + fn, GATES[fn])})
            return self._send(404, {})
        self._send(404, {})
    def do_PATCH(self):
        n = int(self.headers.get("Content-Length") or 0); b = json.loads(self.rfile.read(n) or b"null")
        m = re.search(r"/functions/([a-z-]+)$", self.path)
        if m: M["gate_" + m.group(1)] = b.get("verify_jwt"); M.setdefault("patched", []).append(m.group(1))
        self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); b = json.loads(self.rfile.read(n) or b"null")
        if self.path.endswith("/database/query"):
            c = conn()
            try:
                rows = c.run(b["query"]); cols = [d_["name"] for d_ in (c.columns or [])]
                return self._send(201, [dict(zip(cols, [jsonable(v) for v in r])) for r in (rows or [])])
            except DatabaseError as e:
                try: c.run("rollback")
                except Exception: pass
                return self._send(400, {"message": str(e)[:600]})
            finally: c.close()
        if self.path.startswith("/functions/v1/"): return self._send(401, {"error": "not allowed"})
        self._send(404, {})
fsrv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), F); threading.Thread(target=fsrv.serve_forever, daemon=True).start()
FURL = f"http://127.0.0.1:{fsrv.server_address[1]}"
FAKEBIN = os.path.join(TMP, "bin2"); os.makedirs(FAKEBIN, exist_ok=True)
open(os.path.join(FAKEBIN, "supabase"), "w").write(f"""#!/usr/bin/env python3
import sys, os, shutil
a = sys.argv[1:]
if a[:2] == ['functions', 'deploy']:
    open(os.path.join({TMP!r}, 'dep-' + a[2]), 'w').write(' '.join(a)); sys.exit(0)
if a[:2] == ['functions', 'download']:
    fn = a[2]; src = {COPY!r} if os.path.exists(os.path.join({TMP!r}, 'dep-' + fn)) else ({MAIN!r} if not os.path.exists(os.path.join({TMP!r}, 'drift')) else {COPY!r})
    os.makedirs(os.path.join(os.getcwd(), 'supabase', 'functions'), exist_ok=True)
    shutil.copytree(os.path.join(src, 'supabase', 'functions', fn), os.path.join(os.getcwd(), 'supabase', 'functions', fn), dirs_exist_ok=True)
    shutil.copytree(os.path.join(src, 'supabase', 'functions', '_shared'), os.path.join(os.getcwd(), 'supabase', 'functions', '_shared'), dirs_exist_ok=True); sys.exit(0)
sys.exit(1)
""")
os.chmod(os.path.join(FAKEBIN, "supabase"), 0o755)
ENVF = lambda rep: dict(os.environ, SB_STEP="969", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=FURL, SB_FN_BASE=FURL, SB_SUPA_CLI=os.path.join(FAKEBIN, "supabase"),
                        SB_FNROOT=FNR, SB_SETTLE="0", SB_CC_EMAIL="krystal@mo-care.com", SB_LIVE_SHAS=json.dumps(LIVE_SHAS))
def run969(shas=None, fresh=True, drift=False, live_on=False, **m):
    if fresh:
        seed961(True); r_ = run()  # the real 961 again on a clean database
    extra(live_on=live_on); M.clear(); M.update(m)
    for f in glob.glob(os.path.join(TMP, "dep-*")) + glob.glob(os.path.join(TMP, "drift")): os.remove(f)
    if drift: open(os.path.join(TMP, "drift"), "w").write("x")
    rep = os.path.join(TMP, "r969.txt")
    if os.path.exists(rep): os.remove(rep)
    p = subprocess.run(["python3", os.path.join(COPY, "coaching_calls_969.py")], cwd=COPY, env=dict(ENVF(rep), SB_FN_SHAS=json.dumps(shas or SHAS)), capture_output=True, text=True, timeout=300)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else "") + p.stdout + p.stderr

code, out = run969()
ck("runs to DONE with no ✗", code == 0 and "RESULT: DONE" in out and "✗" not in out, out)
ck("the report never shows a key", "eyJ" not in out and "sbp_test" not in out, out)
ck("all five services deployed, the four with their gateway setting kept (call-disposition stays off)", all(os.path.exists(os.path.join(TMP, "dep-" + f)) for f in CHANGED + ["hr-coach-call"])
   and "--no-verify-jwt" in open(os.path.join(TMP, "dep-call-disposition")).read() and "--no-verify-jwt" not in open(os.path.join(TMP, "dep-calls-feed")).read() and not M.get("patched"), M)
ck("the schedule is every 5 minutes with the vault secret, as a sweep", q1("select schedule, command like '%vault.decrypted_secrets%' and command like '%sweep%' from cron.job where jobname = 'hr-coach-call'") == [["*/5 * * * *", True]])
ck("the proof's pretend switch and probe left nothing behind", q1("select data->>'hr_coaching_calls_live' from public.app_data where key = 'ops_settings'") == [["false"]] and q1("select count(*) from public.hr_coaching where caregiver = 'Probe Person'") == [[0]])
ck("the bucket is private with its keep-guard", q1("select public from storage.buckets where id = 'hr-audio'") == [[False]] and q1("select count(*) from pg_trigger where tgname = 'hr_audio_keep'") == [[1]])
# the coaching tracker itself, after 969
seed961(True); run(); extra()
c = conn(); c.run(open(os.path.join(COPY, "hr_coaching_calls.sql")).read()); c.close()
r = act(ZAC, "select public.hr_coaching_act(null, 'assign', cast(:p as jsonb))->>'id'", p=json.dumps({"case_id": "k0", "assigned_to": "krystal@mo-care.com", "due_on": due(5)}))
cid = r[0][0] if isinstance(r, list) else None
ck("switched off: coaching still completes exactly as today (in person, no call)", A(KRY, cid, "done", {"held_on": datetime.date.today().isoformat(), "method": "in_person", "discussed": "a", "response": "b", "expectation": "c"}) == [["done"]])
ck("...and the card keeps its full title while off", (card(cid) or {}).get("title") == "Coaching talk with Pat Sample")
seed961(True); run(); extra(live_on=True)
c = conn(); c.run(open(os.path.join(COPY, "hr_coaching_calls.sql")).read()); c.close()
r = act(ZAC, "select public.hr_coaching_act(null, 'assign', cast(:p as jsonb))->>'id'", p=json.dumps({"case_id": "k0", "assigned_to": "krystal@mo-care.com", "due_on": due(5)})); cid = r[0][0]
ck("switched on: the card says only 'Coaching call due' with first name + last initial, no topic", (card(cid) or {}).get("title") == "Coaching call due: Pat S." and card(cid).get("detail") == "Open it on the HR page.", card(cid))
full = {"discussed": "a", "response": "b", "expectation": "c", "help_agreed": "earlier shift", "followup": "check in Friday", "warning_given": "true"}
ck("switched on: no confirmed recorded call, no completion", "recorded coaching call" in str(A(KRY, cid, "done", full)))
c = conn(); c.run("insert into public.hr_coaching_call (coaching_id, practice, matched_by, tapped_by, tap_at, ghl_message_id, call_at, seconds, call_status, recording_ok, state) values (cast(:c as uuid), true, 'tap', 'krystal@mo-care.com', now(), 'pm1', now(), 300, 'completed', true, 'confirmed')", c=cid); c.close()
ck("...a PRACTICE call never counts", "recorded coaching call" in str(A(KRY, cid, "done", full)))
c = conn(); c.run("insert into public.hr_coaching_call (coaching_id, practice, matched_by, tapped_by, tap_at, ghl_message_id, call_at, seconds, call_status, recording_ok, state, confirmed_at) values (cast(:c as uuid), false, 'tap', 'krystal@mo-care.com', now(), 'lm1', now() - interval '1 hour', 300, 'completed', true, 'confirmed', now())", c=cid); c.close()
ck("...with a confirmed call, the write-up is still all required (help agreed, follow-up actions, the warning tick)", "help agreed" in str(A(KRY, cid, "done", {**full, "help_agreed": ""})) and "Tick that you told them" in str(A(KRY, cid, "done", {**full, "warning_given": "false"})))
ck("...a follow-up date sooner than a week is refused", "1 week and 90 days" in str(A(KRY, cid, "done", {**full, "check_on": datetime.date.today().isoformat()})))
ck("...then it completes: by phone, the call's date, linked to the call, follow-up in 30 days", A(KRY, cid, "done", full) == [["done"]]
   and q1("select method, call_id is not null, help_agreed, warning_given, check_on - held_on from public.hr_coaching where id = cast(:c as uuid)", c=cid) == [["phone", True, "earlier shift", True, 30]])
c = conn()
try: c.run("delete from public.hr_coaching_call"); gone = True
except DatabaseError: gone = False
c.close(); ck("a coaching call record can't be deleted", not gone)
c = conn()
try: c.run("update public.hr_coaching_call set ghl_message_id = 'other' where ghl_message_id = 'lm1'"); moved = True
except DatabaseError: moved = False
c.close(); ck("a linked call can't be swapped for another", not moved)
c = conn()
try: c.run("insert into public.hr_coaching_call (coaching_id, practice, matched_by, tapped_by, ghl_message_id, state) values (cast(:c as uuid), false, 'pick', 'x', 'lm1', 'attempt')", c=cid); dup = True
except DatabaseError: dup = False
c.close(); ck("one call, one record: the same call can't be linked twice", not dup)
ck("Krystal can't read the call records directly", str(act(KRY, "select count(*) from public.hr_coaching_call")).startswith("ERR"))
# stops
code2, out2 = run969(drift=True)
ck("if a live function is not what is in GitHub: stops before anything changes", code2 == 3 and "is not what is in GitHub" in out2 and q1("select to_regclass('public.hr_coaching_call') is null") == [[True]], out2[-1200:])
code3, out3 = run969(live_on=True)
ck("if coaching calls are already on: stops", code3 == 3 and "already switched on" in out3, out3[-600:])
code4, out4 = run969(missing="call-pull")
ck("if one of the four is not live: stops", code4 == 3 and "call-pull is not live" in out4, out4[-600:])
code5, out5 = run969(shas={"hr-coach-call/index.ts": "0" * 64})
ck("not the reviewed build: stops before anything", code5 == 2, out5[-400:])
code6, out6 = run969(fresh=False)
ck("run again: DONE (safe to run twice)", code6 == 0 and "RESULT: DONE" in out6, out6[-800:])
body = open(os.path.join(COPY, "coaching_calls_969.py")).read() + open(os.path.join(COPY, "hr_coaching_calls.sql")).read()
ck("no em dashes", "—" not in body)

CMD = os.environ.get("CMD", "")
if CMD:
    src = open(CMD).read()
    P = re.search(r'^P="([^"]+)"', src, re.M).group(1); PIN = re.search(r'^PIN="([0-9a-f]{40})"', src, re.M).group(1)
    FH = os.path.join(TMP, "home"); os.makedirs(os.path.join(FH, ".local", "bin"), exist_ok=True); os.makedirs(os.path.join(FH, "Desktop"), exist_ok=True)
    try: os.symlink(os.path.join(FAKEBIN, "supabase"), os.path.join(FH, ".local", "bin", "supabase"))
    except FileExistsError: pass
    FB = os.path.join(TMP, "fakebin3"); os.makedirs(FB, exist_ok=True); open(os.path.join(FB, "open"), "w").write("#!/bin/sh\nexit 0\n"); os.chmod(os.path.join(FB, "open"), 0o755)
    REPO = os.path.join(TMP, "repo"); subprocess.run(["git", "clone", "-q", HERE, REPO], check=True)
    s2 = src.replace(P, REPO).replace("/Users/samantha/Desktop", os.path.join(FH, "Desktop"))
    ck("the launcher pins a commit that exists", subprocess.run(["git", "-C", REPO, "cat-file", "-e", PIN + "^{commit}"]).returncode == 0, PIN)
    LC = os.path.join(TMP, "launch.command"); open(LC, "w").write(s2); os.chmod(LC, 0o755)
    seed961(True); run(); extra(); M.clear()
    for f in glob.glob(os.path.join(TMP, "dep-*")): os.remove(f)
    env = dict(ENVF(""), HOME=FH, PATH=FB + ":" + os.environ["PATH"]); [env.pop(k) for k in ("SB_REPORT", "SB_FNROOT", "SB_TOKEN", "SB_LIVE_SHAS")]
    p = subprocess.run(["zsh", LC], input="sbp_fake_token\n\n", env=env, capture_output=True, text=True, timeout=300)
    reps = sorted(glob.glob(os.path.join(FH, "Desktop", "969 *report*.txt")))
    rep = open(reps[-1]).read() if reps else ""
    ck("the launcher runs the reviewed build to DONE", "RESULT: DONE" in rep and "✗" not in rep, p.stdout[-1500:] + p.stderr[-800:] + rep[-800:])

for n_, okk, note in res: print(("PASS  " if okk else "FAIL  ") + n_ + ("" if okk else "\n      " + note.replace("\n", "\n      ")))
print(f"{sum(1 for _, o, _ in res if o)}/{len(res)} passed"); raise SystemExit(0 if all(o for _, o, _ in res) else 1)
