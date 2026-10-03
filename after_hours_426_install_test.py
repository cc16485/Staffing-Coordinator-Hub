#!/usr/bin/env python3
# Rehearsal of 426 against a FAKE Supabase (management API + the timekeeper function) and a FAKE supabase CLI. Never
# touches a real project. Run from the branch with the 426 commit:  python3 after_hours_426_install_test.py
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib
HERE = os.path.dirname(os.path.abspath(__file__))
REF = "zngsgedlsxinbygwmxwn"
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
git = lambda *a: subprocess.run(["git", *a], cwd=HERE, capture_output=True, text=True).stdout.strip()
BASE = git("merge-base", "HEAD", "origin/main")
CHANGED = [x for x in git("diff", "--name-only", BASE, "HEAD", "--", "supabase/functions").split() if x.endswith(".ts")]
key = lambda rel: rel.split("supabase/functions/", 1)[1][:-3] if "/_shared/" in rel else rel.split("/")[2]
SHAS = {key(r): sha(os.path.join(HERE, r)) for r in CHANGED}
NOJWT = {"ops-escalate", "lead-intake", "coverage-reply"}
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
S = {}; MODE = {}
SW0 = {"timekeeper_admin_loop_live": False, "timekeeper_watch_live": True, "timekeeper_text_live": True, "late_watch_live": None, "late_admin_live": None,
       "coverage_send_live": True, "evv_chase_live": True, "live": True, "office_quiet_start": None, "office_quiet_end": None, "timekeeper_admin_max_texts": None,
       "missed_clockin_after_hours": None, "callin_after_hours": None}
def reset(): S.clear(); S.update(sql=[], fncalls=[], keyq=[], swreads=0)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj): b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        if m := re.match(r"/v1/projects/(\w+)/functions/([\w-]+)$", p): return self._send(200, {"verify_jwt": m.group(2) not in NOJWT, "version": 50})
        if m := re.match(r"/v1/projects/(\w+)/api-keys(\?reveal=true)?$", p):
            S["keyq"].append(p)
            return self._send(200, [{"name": "anon", "api_key": "eyJanon" + m.group(1)}, {"name": "service_role", "api_key": "eyJsvc" + m.group(1)}])
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); raw = self.rfile.read(n) or b"{}"; p = self.path
        if p.startswith("/fn/functions/v1/timekeeper-watch"):
            auth = self.headers.get("Authorization", ""); S["fncalls"].append((p, auth))
            if auth != "Bearer eyJsvc" + REF: return self._send(401, {"error": "not allowed"})
            if "auth_check=1" in p: return self._send(200, {"ok": True, "caller": "owner"})
            if "dry=1" in p: return self._send(200, {"mode": "DRY RUN", "visits_seen": 12, "texts_sent": 0, "would_text": [{"caregiver": "Hidden Name"}],
                                                      "admin_loop": {"live": False, "texts": 0, "quiet_hours": {"now": True, "hours": "8pm to 7am", "missed_clockin_after_hours": True, "loop_quiet": False}, "max_texts_each": 6}})
            return self._send(400, {"error": "unexpected"})
        body = json.loads(raw)
        if re.match(r"/v1/projects/(\w+)/database/query", p):
            q = body["query"]; S["sql"].append(q)
            if q.startswith("select data->'timekeeper_admin_loop_live'"):
                S["swreads"] += 1; sw = dict(SW0)
                if MODE.get("flip") and S["swreads"] > 1: sw["timekeeper_admin_loop_live"] = True
                return self._send(200, [sw])
            return self._send(400, {"message": "unexpected query " + q[:80]})
        self._send(404, {})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
tmp = tempfile.mkdtemp(prefix="t426-"); LOG = os.path.join(tmp, "cli.log"); STATE = os.path.join(tmp, "deployed")
CLI = os.path.join(tmp, "supabase")
open(CLI, "w").write(f"""#!/bin/sh
# fake CLI: download gives the reviewed starting point's copy until a deploy, then the local build.
# BAD_LIVE=<fn>: that function's live code is unknown. DEPLOY_500=<fn>: its deploy answers an error but goes through.
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
if [ "$cmd" = "deploy" ]; then echo "$fn $*" >> "{LOG}"; echo "$fn" >> "{STATE}"; if [ "$DEPLOY_500" = "$fn" ]; then echo "500 internal error" >&2; exit 1; fi; exit 0; fi
exit 1
""")
os.chmod(CLI, 0o755)
FAKEBIN = os.path.join(tmp, "bin"); os.makedirs(FAKEBIN)
open(os.path.join(FAKEBIN, "node"), "w").write("#!/bin/sh\necho 'PASS · fake'\necho '1/1'\n"); os.chmod(os.path.join(FAKEBIN, "node"), 0o755)

def run(real_node=False, **over):
    reset(); open(LOG, "w").close(); open(STATE, "w").close(); rep = os.path.join(tmp, "report.txt")
    if os.path.exists(rep): os.unlink(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_SUPA_CLI=CLI, SB_API_BASE=URL, SB_REPO=HERE, SB_BASE=BASE,
               SB_SHAS=json.dumps(SHAS), SB_FN_BASE=URL + "/fn")
    if not real_node: env["PATH"] = FAKEBIN + ":" + env.get("PATH", "")
    env.update(over)
    p = subprocess.run([sys.executable, os.path.join(HERE, "after_hours_426.py")], env=env, capture_output=True, text=True)
    deps = [l.split()[0] for l in open(LOG).read().splitlines()]
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), deps, open(LOG).read().splitlines()

code, rep, dep, L = run(real_node=True)
open(os.environ.get("REHEARSAL_OUT", "/dev/null"), "w").write(rep)
ck("rehearsal: DONE, exit 0", code == 0 and "RESULT: DONE" in rep, rep[-2500:])
ck("the 13 test files ran for real and passed inside the installer", rep.count("(run here, against fakes; nothing sent)") == 13, rep[:3000])
FIRST = ["timekeeper-watch", "clockin-alert", "coverage-run", "late-watch", "late-alert"]
ck("every function that uses a changed file is updated (26), the three that change first, then the clockin-admins users", len(dep) == 26 and dep[:5] == FIRST and len(set(dep)) == 26, dep)
ck("the other 21 are the ones that use the shared outreach / quiet-hours files", set(dep[5:]) == {"applicant-invite", "applicant-noshow", "applicant-reengage", "automation-watchdog", "campaign-auto", "caregiver-availability", "caregiver-intro",
   "carematch-watch", "circle-send", "coverage-reply", "ghe-reminders", "lead-followup", "lead-intake", "lead-nurture", "missed-notes", "ops-escalate", "prn-reconfirm", "reference-chase", "reference-send", "shift-confirm", "team-ask"}, dep[5:])
ck("each keeps its gateway setting (off only where it was off: ops-escalate, lead-intake, coverage-reply)",
   all(("--no-verify-jwt" in l) == (l.split()[0] in NOJWT) for l in L), [l for l in L if ("--no-verify-jwt" in l) != (l.split()[0] in NOJWT)])
ck("NO writing SQL at all (no setting is changed; only the switches are read, before and after)",
   S["sql"] and all(q.startswith("select ") for q in S["sql"]) and not any(re.search(r"\b(insert|update|delete|alter|create|drop|grant|truncate)\b", q, re.I) for q in S["sql"]) and S["swreads"] == 2, S["sql"])
ck("the admin texts switch is reported OFF and unchanged", "missed clock-in admin texts (timekeeper_admin_loop_live): off. This installer does not change it." in rep
   and "every switch is exactly as it was; the missed clock-in admin texts are still off" in rep, rep)
ck("the quiet hours setting is reported (not set: 8pm to 7am)", "office quiet hours setting: not set, so 8pm to 7am Central" in rep, rep)
ck("the two after-hours switches are reported (not set, so ON)", "missed clock-ins text admins after hours (missed_clockin_after_hours): not set, so ON (the default)" in rep
   and "call-ins text admins after hours (callin_after_hours): not set, so ON (the default)" in rep, rep)
ck("the result says the admin loop is still off and needs her switch", "Missed clock-ins will too, once the missed clock-in admin texts are switched on (they are off now" in rep, rep[-900:])
calls = S["fncalls"]
ck("proof calls only: the public key (refused), auth_check and ONE practice run (?dry=1), all with no 'to=' or force",
   len(calls) == 3 and calls[0][1].startswith("Bearer eyJanon") and "auth_check=1" in calls[1][0] and "dry=1" in calls[2][0] and all("to=" not in c[0] and "force" not in c[0] for c in calls), calls)
ck("the practice run's quiet hours are shown, and no names from it", "office quiet hours 8pm to 7am, quiet right now: yes; missed clock-in texts after hours: ON; at most 6 admin texts per alert" in rep and "Hidden Name" not in rep, rep[-2500:])
ck("proof: every live copy is exactly the reviewed build", rep.count(": the live copy is exactly the reviewed build") == 26 and "✗" not in rep, rep[-1500:])
ck("the report hides keys and says nothing was sent and no setting changed", not re.search(r"eyJ\w|sbp_\w", rep) and "Nothing was texted or emailed by this installer, and no setting was changed" in rep)
ck("keys asked with ?reveal=true first", S["keyq"] and S["keyq"][0].endswith("?reveal=true"), S["keyq"])

code, rep, dep, L = run(BAD_LIVE="coverage-run")
ck("one live copy that is not today's GitHub main: that one NOT deployed and named, the rest go, PARTLY DONE",
   code == 1 and "coverage-run" not in dep and len(dep) == 25 and "coverage-run: its live code is not today's GitHub main" in rep and "PARTLY DONE" in rep, [code, dep, rep[-800:]])
code, rep, dep, L = run(DEPLOY_500="late-watch")
ck("a deploy that answers 500 but went through is checked and counted as done (lesson from 394)", code == 0 and "late-watch: the deploy answered with an error, but the live copy IS the reviewed build" in rep, rep[-1500:])
MODE["flip"] = True; code, rep, dep, L = run(); MODE.clear()
ck("a switch that changed during the run is flagged, never hidden", code == 1 and "✗ every switch is exactly as it was" in rep, rep[-800:])
code, rep, dep, L = run(SB_SHAS=json.dumps({**SHAS, "timekeeper-watch": "0" * 64}))
ck("a function file that isn't the reviewed build: STOP before anything changes", code == 2 and not dep, [code, rep[-300:]])
code, rep, dep, L = run(SB_SHAS=json.dumps({**SHAS, "shift-confirm": SHAS["timekeeper-watch"]}))
ck("a pinned file that isn't changed here: STOP", code == 2 and not dep, [code, rep[-300:]])
code, rep, dep, L = run(SB_BASE="")
ck("no reviewed starting point: STOP", code == 2 and not dep, [code, dep])
code, rep, dep, L = run(SB_TOKEN="nope")
ck("no token: STOP", code == 2 and not dep, [code, dep])
src = open(os.path.join(HERE, "after_hours_426.py")).read()
ck("no em dash in the installer's words", "—" not in src, re.findall(r".{30}—.{30}", src)[:3])
ck("the installer never writes a setting (no upsert, no update, no ops_settings write)", not re.search(r"(?i)\b(update|upsert|insert)\b[^\n]*ops_settings|upsert_app_data_item", src))
ck("the installer never mentions turning the admin loop on (no write of timekeeper_admin_loop_live)", not re.search(r"timekeeper_admin_loop_live['\"]?\s*[:=]\s*(true|True)", src))

srv.shutdown()
allok = True; print("\n426 · INSTALLER REHEARSAL (fake Supabase, fake CLI)\n" + "=" * 50)
for n, g, note in res: allok &= g; print(("PASS  " if g else "FAIL  ") + n + ("" if g else "\n   └─ " + note))
print(f"ALL {len(res)} CHECKS PASS" if allok else "FAILED"); sys.exit(0 if allok else 1)
