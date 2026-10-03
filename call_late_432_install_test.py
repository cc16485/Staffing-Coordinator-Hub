#!/usr/bin/env python3
# Rehearsal of 432 against a FAKE Supabase (management API, SQL, the four functions) and a FAKE supabase CLI. Never
# touches a real project and sends nothing. Run from the branch with the 432 commit:  python3 call_late_432_install_test.py
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib
HERE = os.path.dirname(os.path.abspath(__file__))
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
git = lambda *a: subprocess.run(["git", *a], cwd=HERE, capture_output=True, text=True).stdout.strip()
BASE = git("merge-base", "HEAD", "origin/main")
CHANGED = [x for x in git("diff", "--name-only", BASE, "HEAD", "--", "supabase/functions").split() if x.endswith(".ts")]
key = lambda rel: rel.split("supabase/functions/", 1)[1][:-3] if "/_shared/" in rel else rel.split("/")[2]
SHAS = {key(r): sha(os.path.join(HERE, r)) for r in CHANGED}
SQL_SHA = sha(os.path.join(HERE, "call_late_432.sql"))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1200]))
S = {}; MODE = {}
SW0 = {"late_watch_live": False, "late_cg_reply_live": None, "late_admin_live": None, "late_call_live": None, "late_family_min": None, "timekeeper_watch_live": True,
       "timekeeper_text_live": True, "timekeeper_admin_loop_live": True, "timekeeper_admin_max_texts": None, "missed_clockin_after_hours": None, "call_pull_live": True}
def reset(): S.clear(); S.update(sql=[], fncalls=[], patches=[], applied=False, notices=3, sw=dict(SW0))
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if m := re.match(r"/v1/projects/(\w+)/functions/([\w-]+)$", p): return self._send(200, {"verify_jwt": MODE.get("vj", {}).get(m.group(2), True), "version": 9})
        if m := re.match(r"/v1/projects/(\w+)/api-keys(\?reveal=true)?$", p): return self._send(200, [{"name": "anon", "api_key": "eyJanonK"}, {"name": "service_role", "api_key": "eyJsvcK"}])
        if re.match(r"/v1/projects/(\w+)/secrets$", p):
            names = ["GHL_TOKEN", "GHL_LOCATION_ID", "HUB_JOB_SECRET"] + ([] if MODE.get("no_ai") else ["ANTHROPIC_API_KEY"])
            return self._send(200, [{"name": n, "value": "x"} for n in names])
        self._send(404, {})
    def do_PATCH(self): S["patches"].append(self.path); self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); raw = self.rfile.read(n) or b"{}"; p = self.path
        if p.startswith("/fn/functions/v1/"):
            fn = p.split("/fn/functions/v1/", 1)[1]; auth = self.headers.get("Authorization", "")
            S["fncalls"].append((fn, auth, json.loads(raw)))
            if "?dry=1" in fn and auth == "Bearer eyJsvcK":
                if fn.startswith("late-watch"): return self._send(200, {"ok": True, "dry": True, "live": False, "calls_live": True, "caregivers_watched": 2, "calls_read": 1, "notices_new": 1, "cg_texts": 0, "admin_texts": 0,
                                                                      **({"transcripts": "No transcript from GoHighLevel for 2 answered call(s)"} if MODE.get("tr_off") else {})})
                if fn.startswith("timekeeper-watch"): return self._send(200, {"mode": "DRY RUN", "held_running_late": 0})
            return self._send(401, {"error": "not allowed"})
        if re.match(r"/v1/projects/(\w+)/database/query", p):
            q = json.loads(raw)["query"]; S["sql"].append(q)
            if "alter table public.late_notices" in q:
                if MODE.get("sql_fail"): return self._send(400, {"message": "boom"})
                S["applied"] = True; return self._send(201, [])
            if "to_regclass('public.late_notices')" in q: return self._send(201, [{"t": not MODE.get("no_table"), "cols": 7 if S["applied"] else 0}])
            if "information_schema.columns" in q: return self._send(201, [{"n": 7 if S["applied"] else 0}])
            if "from cron.job" in q: return self._send(201, [{"jobname": "late-watch-every-5-min", "schedule": "*/5 * * * *", "active": True}, {"jobname": "timekeeper-watch", "schedule": "*/2 * * * *", "active": True}])
            if q.startswith("select data->'late_watch_live'"): return self._send(201, [dict(S["sw"])])
            if "count(*)::int as n, coalesce(max(updated_at)" in q:
                if MODE.get("writes"): S["notices"] += 1
                return self._send(201, [{"n": S["notices"], "last": "x"}])
            return self._send(400, {"message": "unexpected: " + q[:80]})
        self._send(404, {})
tmp = tempfile.mkdtemp(prefix="t432-"); LOG = os.path.join(tmp, "cli.log"); STATE = os.path.join(tmp, "deployed")
open(STATE, "w").close()
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
CLI = os.path.join(tmp, "supabase")
open(CLI, "w").write(f"""#!/bin/sh
# fake CLI: download gives the reviewed starting point's copy until a deploy, then the local build.
# BAD_LIVE=<fn>: that function's live code is unknown. FAIL_DEPLOY=<fn>: its deploy fails.
cmd="$2"; fn="$3"; root="{HERE}"; base="{BASE}"
if [ "$cmd" = "download" ]; then
  mkdir -p "supabase/functions/$fn" "supabase/functions/_shared"
  if grep -qx "$fn" "{STATE}" 2>/dev/null; then
    cp "$root/supabase/functions/$fn/index.ts" "supabase/functions/$fn/index.ts"; cp "$root"/supabase/functions/_shared/*.ts supabase/functions/_shared/
    rm -f supabase/functions/_shared/_*.ts
  else
    git -C "$root" show "$base:supabase/functions/$fn/index.ts" > "supabase/functions/$fn/index.ts"
    for f in $(git -C "$root" ls-tree --name-only "$base" supabase/functions/_shared/); do git -C "$root" show "$base:$f" > "$f"; done
    if [ "$BAD_LIVE" = "$fn" ]; then echo "// hand edit" >> "supabase/functions/$fn/index.ts"; fi
  fi
  exit 0
fi
if [ "$cmd" = "deploy" ]; then [ "$FAIL_DEPLOY" = "$fn" ] && {{ echo "boom" >&2; exit 1; }}; echo "$fn $*" >> "{LOG}"; echo "$fn" >> "{STATE}"; exit 0; fi
exit 1
""")
os.chmod(CLI, 0o755)
FAKEBIN = os.path.join(tmp, "bin"); os.makedirs(FAKEBIN)
open(os.path.join(FAKEBIN, "node"), "w").write("#!/bin/sh\necho 'PASS · fake'\necho '1/1'\n"); os.chmod(os.path.join(FAKEBIN, "node"), 0o755)

def run(real_node=False, **over):
    reset(); open(LOG, "w").close(); open(STATE, "w").close(); rep = os.path.join(tmp, "report.txt")
    if os.path.exists(rep): os.unlink(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_SUPA_CLI=CLI, SB_API_BASE=URL, SB_REPO=HERE, SB_BASE=BASE,
               SB_SHAS=json.dumps(SHAS), SB_SQL_SHA=SQL_SHA, SB_FN_BASE=URL + "/fn")
    if not real_node: env["PATH"] = FAKEBIN + ":" + env.get("PATH", "")
    env.update(over)
    p = subprocess.run([sys.executable, os.path.join(HERE, "call_late_432.py")], env=env, capture_output=True, text=True)
    dep = [l.split()[0] for l in open(LOG).read().splitlines()]
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), dep, open(LOG).read().splitlines()

ck("the reviewed files are the five 432 files", set(SHAS) == {"_shared/late-notice", "timekeeper-watch", "clockin-alert", "late-alert", "late-watch"}, SHAS)
code, rep, dep, L = run(real_node=True)
open(os.environ.get("REHEARSAL_OUT", "/dev/null"), "w").write(rep)
ck("rehearsal: DONE, exit 0", code == 0 and "RESULT: DONE" in rep, rep[-2500:])
ck("the 10 test files ran for real and passed inside the installer", rep.count("(run here, against fakes; nothing sent)") == 10, rep[:3500])
ck("the SQL goes in BEFORE any function, and the columns are checked", S["sql"].index(next(q for q in S["sql"] if "alter table public.late_notices" in q)) < len(S["sql"]) and "late_notices has the 7 call columns" in rep, S["sql"][:6])
ck("order: timekeeper-watch first (the new hold rule), late-watch last", dep == ["timekeeper-watch", "clockin-alert", "late-alert", "late-watch"], dep)
ck("every deploy keeps the gateway setting (no --no-verify-jwt when it was on)", all("--no-verify-jwt" not in l for l in L), L)
calls = S["fncalls"]
ck("proof: public key refused by late-watch and timekeeper-watch; made-up links refused by both pages; then ONE dry run each with the server key",
   [c[0] for c in calls] == ["late-watch", "timekeeper-watch", "clockin-alert", "clockin-alert", "late-alert", "late-alert", "late-watch?dry=1", "timekeeper-watch?dry=1"]
   and all(c[1] == "Bearer eyJanonK" for c in calls[:6]) and calls[6][1] == "Bearer eyJsvcK", [c[:2] for c in calls])
ck("proof: every live copy is the reviewed build, no notice written, every switch unchanged", rep.count(": the live copy is exactly the reviewed build") == 4 and "no running-late notice was written" in rep
   and "every switch is exactly as it was (late_call_live not set = ON" in rep and "✗" not in rep, rep[-2000:])
ck("the report explains the new switch's default (not set = ON, how to turn it off)", "late_call_live is not set, which means ON" in rep and "Turn off calls" in rep, rep[:3000])
ck("the report states the family rule: only a person's tap, never the client, no automatic family text", "only ever by a person's tap" in rep and "The client is never texted" in rep and "There is no automatic family text" in rep, rep[-1200:])
ck("the report hides keys and emails", not re.search(r"eyJ\w|sbp_\w|@mo-care", rep), rep)
ck("the installer never writes a setting (no SQL touching ops_settings except reading it)", not any(re.search(r"(?i)update public\.app_data|upsert_app_data_item|jsonb_set", q) for q in S["sql"]), S["sql"])

code, rep, dep, L = run(BAD_LIVE="timekeeper-watch")
ck("timekeeper-watch live is not today's main: NOTHING after it is deployed (so a call can never silence a missed clock-in on the old rule)", code == 1 and dep == [] and "timekeeper-watch: its live code is not today's GitHub main" in rep and "PARTLY DONE" in rep, [code, dep, rep[-900:]])
code, rep, dep, L = run(BAD_LIVE="late-alert")
ck("late-alert live unknown: stops there; late-watch NOT deployed", code == 1 and dep == ["timekeeper-watch", "clockin-alert"], [dep, rep[-600:]])
code, rep, dep, L = run(FAIL_DEPLOY="clockin-alert")
ck("a deploy that fails stops the rest", code == 1 and dep == ["timekeeper-watch"] and "clockin-alert didn't deploy" in rep, [dep, rep[-600:]])
MODE["vj"] = {"late-watch": False, "timekeeper-watch": False}; code, rep, dep, L = run(); MODE.clear()
ck("a function with the gateway check off keeps it off (--no-verify-jwt passed for those two only)", code == 0 and sum("--no-verify-jwt" in l for l in L) == 2 and all(("--no-verify-jwt" in l) == (l.split()[0] in ("late-watch", "timekeeper-watch")) for l in L), L)
MODE["sql_fail"] = True; code, rep, dep, L = run(); MODE.clear()
ck("the SQL fails: STOP, no function changed", code == 4 and not dep, [code, rep[-400:]])
MODE["no_table"] = True; code, rep, dep, L = run(); MODE.clear()
ck("no running-late table (363 not run): STOP before anything changes", code == 3 and not dep and not any("alter table" in q for q in S["sql"]), [code, rep[-300:]])
MODE["no_ai"] = True; code, rep, dep, L = run(); MODE.clear()
ck("no AI key: STOP before anything changes", code == 3 and not dep, [code, rep[-300:]])
MODE["writes"] = True; code, rep, dep, L = run(); MODE.clear()
ck("a practice run that wrote a notice is flagged", code == 1 and "✗ no running-late notice was written" in rep, rep[-800:])
MODE["tr_off"] = True; code, rep, dep, L = run(); MODE.clear()
ck("transcripts off in GoHighLevel: the report says so", code == 0 and "ATTENTION: No transcript from GoHighLevel" in rep, rep[-1200:])
code, rep, dep, L = run(SB_SHAS=json.dumps({**SHAS, "late-watch": "0" * 64}))
ck("a file that isn't the reviewed build: STOP before anything changes", code == 2 and not dep and not S["sql"], [code, rep[-300:]])
code, rep, dep, L = run(SB_SQL_SHA="0" * 64)
ck("the SQL isn't the reviewed version: STOP", code == 2 and not dep and not S["sql"], [code, rep[-300:]])
code, rep, dep, L = run(SB_BASE="")
ck("no reviewed starting point: STOP", code == 2 and not dep, [code, dep])
code, rep, dep, L = run(SB_TOKEN="nope")
ck("no token: STOP", code == 2 and not dep, [code, dep])
src = open(os.path.join(HERE, "call_late_432.py")).read() + open(os.path.join(HERE, "call_late_432.sql")).read()
ck("no em dash in the installer's or the SQL's words", "—" not in src)
ck("the installer never posts to GoHighLevel or AxisCare", not re.search(r"leadconnectorhq|axiscare\.com", open(os.path.join(HERE, "call_late_432.py")).read()))

srv.shutdown()
allok = True; print("\n432 · INSTALLER REHEARSAL (fake Supabase, fake CLI)\n" + "=" * 50)
for n, g, note in res: allok &= g; print(("PASS  " if g else "FAIL  ") + n + ("" if g else "\n   └─ " + note))
print(f"ALL {len(res)} CHECKS PASS" if allok else "FAILED"); sys.exit(0 if allok else 1)
