#!/usr/bin/env python3
# Rehearsal of 412 against a FAKE Supabase (management API, both projects' functions) and a FAKE supabase CLI.
# Never touches a real project. Needs the Training Platform checked out at the reviewed build:
#   SB_TR_ROOT=/path/to/training python3 profile_cleared_412_test.py
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); TR = os.environ.get("SB_TR_ROOT", "")
if not TR or not os.path.exists(os.path.join(TR, "supabase/profile-before-cleared.sql")): print("SKIP: set SB_TR_ROOT to the Training Platform at the reviewed build"); sys.exit(0)
HUB, TP = "zngsgedlsxinbygwmxwn", "rdqujxiycycwhskyvrwa"
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
git = lambda root, *a: subprocess.run(["git", *a], cwd=root, capture_output=True, text=True).stdout.strip()
HUB_BASE, TR_BASE = git(HERE, "merge-base", "HEAD", "origin/main"), git(TR, "merge-base", "HEAD", "origin/main")
HUB_SHAS = {"outreach-check": sha(os.path.join(HERE, "supabase/functions/outreach-check/index.ts"))}
TR_SHAS = {k: sha(os.path.join(TR, "supabase/functions", (k + ".ts") if k.startswith("_shared/") else (k + "/index.ts"))) for k in ("notify-cleared", "sync-axiscare", "_shared/profile-check")}
SQL_SHA = sha(os.path.join(TR, "supabase/profile-before-cleared.sql"))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:600]))

S = {}
def reset(): S.clear(); S.update(sql=[], cron_cmd=None, deploys=[], fncalls=[])
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if m := re.match(r"/v1/projects/(\w+)/functions/([\w-]+)$", p): return self._send(200, {"verify_jwt": m.group(2) != "outreach-check"})
        if p.endswith("/secrets"): return self._send(200, [{"name": n} for n in ("OUTREACH_SECRET", "HUB_ANON_KEY", "TRAINING_CRON_SECRET", "GHL_TOKEN")])
        if m := re.match(r"/v1/projects/(\w+)/api-keys", p): return self._send(200, [{"name": "anon", "api_key": "eyJanon" + m.group(1)}, {"name": "service_role", "api_key": "eyJsvc" + m.group(1)}])
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if m := re.match(r"/v1/projects/(\w+)/database/query", p):
            q = body["query"]; S["sql"].append((m.group(1), q))
            if "vault.decrypted_secrets where name" in q and "pg_proc" in q: return self._send(200, [{"v": True, "n": True, "c": True}])
            if "from cron.job where jobname in" in q: return self._send(200, [{"jobname": "nightly-axiscare-sync", "schedule": "0 14 * * *", "active": True}])
            if "filter (where c.hire_date" in q: return self._send(200, [{"n": 2, "newhires": 1}])
            if q.startswith("begin;"): return self._send(201, [])
            if "information_schema.columns" in q: return self._send(200, [{"n": 3}])
            if "cron.schedule(" in q:
                S["cron_cmd"] = re.search(r"cron\.schedule\('cleared-profile-wait', '30 13-23 \* \* \*', '(.*)'\) as id$", q, re.S).group(1).replace("''", "'"); return self._send(200, [{"id": 9}])
            if "select schedule, active, command from cron.job" in q: return self._send(200, [{"schedule": "30 13-23 * * *", "active": True, "command": S["cron_cmd"]}])
            if "cleared_waiting_profile_at is not null" in q: return self._send(200, [{"n": 0}])
            return self._send(400, {"message": "unexpected query " + q[:80]})
        if p == "/hub/functions/v1/outreach-check":
            S["fncalls"].append(("hub", body)); ok = self.headers.get("x-outreach-secret") == "real"
            return self._send(200 if ok else 401, {"published": False} if ok else {"error": "unauthorized"})
        if p == "/tp/functions/v1/notify-cleared":
            S["fncalls"].append(("tp", body)); svc = self.headers.get("Authorization") == "Bearer eyJsvc" + TP
            if body.get("proof") and svc: return self._send(200, {"proof": True, "hub": {"ok": True, "published": False, "new_hire": False}, "waiting": 0, "sent": 0})
            return self._send(401, {"error": "server only"})
        self._send(404, {})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"

tmp = tempfile.mkdtemp(prefix="t412-"); LOG = os.path.join(tmp, "cli.log")
CLI = os.path.join(tmp, "supabase")
open(CLI, "w").write(f"""#!/bin/sh
# fake CLI: download writes the reviewed starting point's copy (known code); deploy is logged
cmd="$2"; fn="$3"; ref="$5"
if [ "$ref" = "{HUB}" ]; then root="{HERE}"; base="{HUB_BASE}"; else root="{TR}"; base="{TR_BASE}"; fi
if [ "$cmd" = "download" ]; then mkdir -p "supabase/functions/$fn"; git -C "$root" show "$base:supabase/functions/$fn/index.ts" > "supabase/functions/$fn/index.ts"; exit 0; fi
if [ "$cmd" = "deploy" ]; then echo "$ref $fn $*" >> "{LOG}"; exit 0; fi
exit 1
""")
os.chmod(CLI, 0o755)

def run(**over):
    reset(); open(LOG, "w").close(); rep = os.path.join(tmp, "report.txt")
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_SUPA_CLI=CLI, SB_API_BASE=URL, SB_HUB_ROOT=HERE, SB_TR_ROOT=TR,
               SB_HUB_BASE=HUB_BASE, SB_TR_BASE=TR_BASE, SB_HUB_SHAS=json.dumps(HUB_SHAS), SB_TR_SHAS=json.dumps(TR_SHAS), SB_TR_SQL_SHA=SQL_SHA,
               SB_HUB_FN_BASE=URL + "/hub", SB_TR_FN_BASE=URL + "/tp")
    env.update(over)
    p = subprocess.run([sys.executable, os.path.join(HERE, "profile_cleared_412.py")], env=env, capture_output=True, text=True)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), [l.split()[:2] for l in open(LOG).read().splitlines()]

code, rep, dep = run()
ck("rehearsal: DONE, exit 0", code == 0 and "RESULT: DONE" in rep, rep[-1500:])
ck("deploys exactly: Hub outreach-check, then Training notify-cleared, sync-axiscare", dep == [[HUB, "outreach-check"], [TP, "notify-cleared"], [TP, "sync-axiscare"]], dep)
ck("Hub outreach-check keeps its gateway OFF (--no-verify-jwt); Training ones keep theirs ON", "--no-verify-jwt" in open(LOG).read().splitlines()[0] and all("--no-verify-jwt" not in l for l in open(LOG).read().splitlines()[1:]), open(LOG).read())
order = [q[:12] for ref, q in S["sql"] if ref == TP]
ck("the Training columns go in (one transaction) before the Training functions deploy", any(q.startswith("begin;") for q in order))
ck("every SQL the installer runs on the Hub: none", not [q for ref, q in S["sql"] if ref == HUB], [q[:80] for ref, q in S["sql"] if ref == HUB])
cmd = S["cron_cmd"] or ""
ck("the hourly job reads its secret from Vault, posts {sweep:true} to notify-cleared, no secret in the job", "vault.decrypted_secrets" in cmd and "'training_cron_secret'" in cmd and '"sweep": true' in cmd and "/tp/functions/v1/notify-cleared" in cmd and "eyJsvc" not in cmd, cmd)
ck("proof calls: only the wrong-secret Hub question, proof (server key), sweep without secret, proof without key; no real sweep",
   [(w, sorted(b)) for w, b in S["fncalls"]] == [("hub", ["axiscare_id", "profile_check"]), ("tp", ["proof"]), ("tp", ["sweep"]), ("tp", ["proof"])], S["fncalls"])
ck("the report hides keys", "eyJ" not in rep and "sbp_" not in rep, re.findall(r"(eyJ\w+|sbp_\w+)", rep))
ck("the report shows today's count", "2 In Training with all pre-service training done" in rep and "1 of them hired on or after 2026-10-02" in rep, rep)

S_bad = dict(TR_SHAS); S_bad["notify-cleared"] = "0" * 64
code, rep, dep = run(SB_TR_SHAS=json.dumps(S_bad))
ck("a Training file that isn't the reviewed build: STOP before anything changes", code == 2 and not dep and not any(q.startswith("begin;") for _, q in S["sql"]), [code, dep, rep[-400:]])
code, rep, dep = run(SB_TR_SQL_SHA="0" * 64)
ck("SQL not the reviewed build: STOP before anything changes", code == 2 and not dep, [code, dep])
code, rep, dep = run(SB_HUB_BASE="")
ck("no reviewed starting point: STOP", code == 2 and not dep, [code, dep])

# proof failure: the Hub unreachable from Training is reported as a ✗ (exit 1), not hidden
def run_fail():
    orig = H.do_POST
    def patched(self):
        if self.path == "/tp/functions/v1/notify-cleared":
            n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); S["fncalls"].append(("tp", body))
            if body.get("proof") and self.headers.get("Authorization") == "Bearer eyJsvc" + TP: return self._send(200, {"proof": True, "hub": {"ok": False, "why": "could not reach the Hub"}, "waiting": 0, "sent": 0})
            return self._send(401, {})
        return orig(self)
    H.do_POST = patched
    try: return run()
    finally: H.do_POST = orig
code, rep, dep = run_fail()
ck("proof fails (Training can't reach the Hub): PARTLY DONE with the reason, exit 1", code == 1 and "PARTLY DONE" in rep and "could not reach the Hub" in rep, rep[-800:])

srv.shutdown()
allok = True; print("\n412 · INSTALLER REHEARSAL (fake Supabase, fake CLI)\n" + "=" * 50)
for n, g, note in res: allok &= g; print(("PASS  " if g else "FAIL  ") + n + ("" if g else "\n   └─ " + note))
print(f"ALL {len(res)} CHECKS PASS" if allok else "FAILED"); sys.exit(0 if allok else 1)
