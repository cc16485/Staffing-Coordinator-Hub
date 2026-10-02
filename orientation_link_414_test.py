#!/usr/bin/env python3
# Rehearsal of 414 against a FAKE Supabase (management API, both projects' functions) and a FAKE supabase CLI.
# Never touches a real project. Needs the Training Platform checked out at the reviewed build:
#   SB_TR_ROOT=/path/to/training python3 orientation_link_414_test.py
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib
HERE = os.path.dirname(os.path.abspath(__file__)); TR = os.path.abspath(os.environ["SB_TR_ROOT"]) if os.environ.get("SB_TR_ROOT") else ""
if not TR or not os.path.exists(os.path.join(TR, "supabase/functions/_shared/welcome.ts")): print("SKIP: set SB_TR_ROOT to the Training Platform at the reviewed build"); sys.exit(0)
HUB, TP = "zngsgedlsxinbygwmxwn", "rdqujxiycycwhskyvrwa"
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
git = lambda root, *a: subprocess.run(["git", *a], cwd=root, capture_output=True, text=True).stdout.strip()
HUB_BASE, TR_BASE = git(HERE, "merge-base", "HEAD", "origin/main"), git(TR, "merge-base", "HEAD", "origin/main")
HUB_SHAS = {"outreach-check": sha(os.path.join(HERE, "supabase/functions/outreach-check/index.ts"))}
TR_SHAS = {k: sha(os.path.join(TR, "supabase/functions", (k + ".ts") if k.startswith("_shared/") else (k + "/index.ts"))) for k in ("job-offer", "sync-axiscare", "_shared/welcome")}
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:700]))

S = {}
def reset(): S.clear(); S.update(sql=[], fncalls=[], keyq=[])
MODE = {"keys": "ok"}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if m := re.match(r"/v1/projects/(\w+)/functions/([\w-]+)$", p): return self._send(200, {"verify_jwt": m.group(2) not in ("outreach-check", "job-offer")})
        if p.endswith("/secrets"): return self._send(200, [{"name": n} for n in ("OUTREACH_SECRET", "HUB_ANON_KEY", "TRAINING_CRON_SECRET", "GHL_TOKEN", "GHL_LOCATION_ID", "AXISCARE_TOKEN", "AXISCARE_SITE_NUMBER")])
        if m := re.match(r"/v1/projects/(\w+)/api-keys(\?reveal=true)?$", p):
            S["keyq"].append(p)
            if MODE["keys"] == "no-reveal" and m.group(2): return self._send(400, {"message": "unknown param"})
            if MODE["keys"] == "masked" and not m.group(2): return self._send(200, [{"name": "anon", "api_key": "eyJ·····"}])
            return self._send(200, [{"name": "anon", "api_key": "eyJanon" + m.group(1)}, {"name": "service_role", "api_key": "eyJsvc" + m.group(1)}])
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if m := re.match(r"/v1/projects/(\w+)/database/query", p):
            q = body["query"]; S["sql"].append((m.group(1), q))
            if "table_name = 'app_settings'" in q: return self._send(200, [{"n": 2}])
            if "welcome_sent_at is null and access_token is not null" in q: return self._send(200, [{"n": 3, "nocontact": 1}])
            if "from job_offers where matched_caregiver_id is null" in q: return self._send(200, [{"n": 7}])
            return self._send(400, {"message": "unexpected query " + q[:80]})
        if p == "/hub/functions/v1/outreach-check":
            S["fncalls"].append(("hub", body)); ok = self.headers.get("x-outreach-secret") == "real"
            return self._send(200 if ok else 401, {"reported": True} if ok else {"error": "unauthorized"})
        if p == "/tp/functions/v1/job-offer":
            S["fncalls"].append(("tp-job-offer", body, self.headers.get("x-hub-token")))
            return self._send(401, {"error": "Sign in to the Hub first."})
        if p == "/tp/functions/v1/sync-axiscare":
            S["fncalls"].append(("tp-sync", body)); return self._send(401, {"error": "Sign in as staff."})
        self._send(404, {})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"

tmp = tempfile.mkdtemp(prefix="t414-"); LOG = os.path.join(tmp, "cli.log"); STATE = os.path.join(tmp, "deployed")
CLI = os.path.join(tmp, "supabase")
open(CLI, "w").write(f"""#!/bin/sh
# fake CLI: download gives the reviewed starting point's copy (known GitHub code) until a deploy, then the local build;
# deploy is logged. BAD_LIVE=1 makes the live copy unknown code.
cmd="$2"; fn="$3"; ref="$5"
if [ "$ref" = "{HUB}" ]; then root="{HERE}"; base="{HUB_BASE}"; else root="{TR}"; base="{TR_BASE}"; fi
if [ "$cmd" = "download" ]; then
  mkdir -p "supabase/functions/$fn" "supabase/functions/_shared"
  if grep -qx "$ref $fn" "{STATE}" 2>/dev/null; then
    cp "$root/supabase/functions/$fn/index.ts" "supabase/functions/$fn/index.ts"; cp "$root"/supabase/functions/_shared/*.ts supabase/functions/_shared/
  else
    git -C "$root" show "$base:supabase/functions/$fn/index.ts" > "supabase/functions/$fn/index.ts"
    if [ -n "$BAD_LIVE" ]; then echo "// hand edit" >> "supabase/functions/$fn/index.ts"; fi
  fi
  exit 0
fi
if [ "$cmd" = "deploy" ]; then echo "$ref $fn $*" >> "{LOG}"; echo "$ref $fn" >> "{STATE}"; exit 0; fi
exit 1
""")
os.chmod(CLI, 0o755)

def run(**over):
    reset(); open(LOG, "w").close(); open(STATE, "w").close(); rep = os.path.join(tmp, "report.txt")
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_SUPA_CLI=CLI, SB_API_BASE=URL, SB_HUB_ROOT=HERE, SB_TR_ROOT=TR,
               SB_HUB_BASE=HUB_BASE, SB_TR_BASE=TR_BASE, SB_HUB_SHAS=json.dumps(HUB_SHAS), SB_TR_SHAS=json.dumps(TR_SHAS),
               SB_HUB_FN_BASE=URL + "/hub", SB_TR_FN_BASE=URL + "/tp")
    env.update(over)
    p = subprocess.run([sys.executable, os.path.join(HERE, "orientation_link_414.py")], env=env, capture_output=True, text=True)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), [l.split()[:2] for l in open(LOG).read().splitlines()]

code, rep, dep = run()
ck("rehearsal: DONE, exit 0", code == 0 and "RESULT: DONE" in rep, rep[-1800:])
ck("deploys exactly: Hub outreach-check, then Training job-offer, sync-axiscare", dep == [[HUB, "outreach-check"], [TP, "job-offer"], [TP, "sync-axiscare"]], dep)
L = open(LOG).read().splitlines()
ck("each keeps its gateway setting (outreach-check and job-offer off, sync-axiscare on)", "--no-verify-jwt" in L[0] and "--no-verify-jwt" in L[1] and "--no-verify-jwt" not in L[2], L)
ck("no SQL on the Hub; only read-only SQL on Training (no begin/insert/update/delete/alter/create)",
   not [q for r, q in S["sql"] if r == HUB] and not [q for r, q in S["sql"] if re.search(r"\b(begin|insert|update|delete|alter|create|drop|grant)\b", q, re.I)], [q[:80] for _, q in S["sql"]])
ck("proof: the live copies are exactly the reviewed builds (incl. _shared/welcome.ts)", rep.count("the live copy is now exactly the reviewed build") == 3 and "✗" not in rep, rep[-1500:])
calls = S["fncalls"]
ck("proof calls only: a wrong-secret Hub report, job-offer without a sign-in, with a made-up one, sync without a secret",
   [c[0] for c in calls] == ["hub", "tp-job-offer", "tp-job-offer", "tp-sync"] and calls[1][2] is None and calls[2][2] == "not-a-real-hub-session" and calls[1][1]["action"] == "orientation_link", calls)
ck("the report hides keys", not re.search(r"eyJ\w|sbp_\w", rep), re.findall(r"(eyJ\w+|sbp_\w+)", rep))
ck("the report shows today's counts", "3 In Training not yet welcomed" in rep and "1 of them have no phone and no email" in rep and "7 job offers not yet linked" in rep, rep)
ck("keys asked with ?reveal=true first", S["keyq"] and S["keyq"][0].endswith("?reveal=true"), S["keyq"])

MODE["keys"] = "no-reveal"
code, rep, dep = run()
ck("if the key list refuses ?reveal=true, it asks again without it and carries on (the 412 lesson)", code == 0 and "RESULT: DONE" in rep and any(not k.endswith("reveal=true") for k in S["keyq"]), [code, S["keyq"], rep[-500:]])
MODE["keys"] = "ok"

code, rep, dep = run(BAD_LIVE="1")
ck("a live copy that is not GitHub code: NOT changed, PARTLY DONE / STOP", code != 0 and [HUB, "outreach-check"] not in dep and "not a reviewed GitHub version" in rep, [code, dep, rep[-600:]])
S_bad = dict(TR_SHAS); S_bad["_shared/welcome"] = "0" * 64
code, rep, dep = run(SB_TR_SHAS=json.dumps(S_bad))
ck("a Training file that isn't the reviewed build: STOP before anything changes", code == 2 and not dep, [code, dep, rep[-400:]])
S_less = {k: v for k, v in TR_SHAS.items() if k != "_shared/welcome"}
code, rep, dep = run(SB_TR_SHAS=json.dumps(S_less))
ck("an unpinned changed file (welcome.ts): STOP", code == 2 and not dep and "isn't the reviewed list" in rep, [code, rep[-300:]])
code, rep, dep = run(SB_HUB_BASE="")
ck("no reviewed starting point: STOP", code == 2 and not dep, [code, dep])
src = open(os.path.join(HERE, "orientation_link_414.py")).read()
ck("no em dash in the installer's words", "—" not in src, re.findall(r".{30}—.{30}", src)[:3])

srv.shutdown()
allok = True; print("\n414 · INSTALLER REHEARSAL (fake Supabase, fake CLI)\n" + "=" * 50)
for n, g, note in res: allok &= g; print(("PASS  " if g else "FAIL  ") + n + ("" if g else "\n   └─ " + note))
print(f"ALL {len(res)} CHECKS PASS" if allok else "FAILED"); sys.exit(0 if allok else 1)
