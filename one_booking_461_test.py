#!/usr/bin/env python3
# Rehearsal of 461 against a FAKE Supabase project and a fake supabase CLI, run from a FRESH copy of this repository (as
# the Desktop step runs). "Live" starts as the GitHub version 461 was built on. Never touches a real project.
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); REF = "zngsgedlsxinbygwmxwn"
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
BASE = os.environ.get("HUB_BASE") or "f36900b73660f14fda47b4d2be907680ad33963f"   # the base 461 pins
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
SVCK, ANONK = "eyJsvc" + REF, "eyJanon" + REF
RULES = ["interview_book", "interview_mine", "interview_cancel", "interview_reschedule", "interview_self_changes"]
BODY = re.compile(r"create\s+or\s+replace\s+function\s+(?:public\.)?(\w+)\s*\([^)]*\)[\s\S]*?\bas\s+(\$\w*\$)([\s\S]*?)\2", re.I)
def bodies(p): return {m.group(1): m.group(3) for m in BODY.finditer(open(p).read()) if m.group(1) in RULES}
OLD, NEW = bodies(os.path.join(HERE, "interview_person_461_rollback.sql")), bodies(os.path.join(HERE, "interview_person_461.sql"))
M = {}; SEEN = []; CALLS = []
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path
        m = re.match(r"/v1/projects/(\w+)/functions/([\w-]+)$", p)
        if m: return self._send(200, {"verify_jwt": False, "version": 7})
        if re.match(r"/v1/projects/\w+/api-keys", p): return self._send(200, [{"name": "anon", "api_key": ANONK}, {"name": "service_role", "api_key": SVCK}])
        self._send(404, {})
    def do_PATCH(self): self._send(200, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); raw = self.rfile.read(n) or b"{}"; p = self.path; auth = self.headers.get("Authorization", "")
        if p.endswith("/database/query"):
            q = json.loads(raw)["query"]; SEEN.append(q)
            if "create or replace function public.applicant_review_reason" in q:
                if M.get("sqlfail"): return self._send(400, {"message": "syntax error"})
                M["applied"] = True; return self._send(201, [])
            if "from pg_proc" in q:
                src = NEW if M.get("applied") else OLD
                rows = [{"name": r, "src": src[r] + (" -- hand edit" if M.get("hand") == r else "")} for r in RULES]
                return self._send(201, rows)
            if "has_function_privilege" in q: return self._send(201, [{"a1": False, "a2": False, "s1": True, "a3": True, "a4": True}])
            if "from public.coordinator_busy" in q: return self._send(201, [{"n": 0 if M.get("applied") else 3}])
            if "from public.interview_bookings where status = 'booked'" in q: return self._send(201, [{"n": 5}])
            if "applicant_review_reason(a.id)" in q: return self._send(201, [{"f": "Amy", "l": "P", "why": "dnr", "booked": True}, {"f": "Dee", "l": "T", "why": "declined", "booked": False}])
            return self._send(201, [])
        CALLS.append((p, auth))
        if p.startswith("/functions/v1/interview-messages?dry=1"):
            return self._send(200, {"ok": True, "dry": True, "would": {"held": ["Amy: on the do-not-rehire list", "Shak: already booked under another application"]}})
        self._send(404, {})
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
tmp = tempfile.mkdtemp(prefix="t461-"); LOG = os.path.join(tmp, "log"); STATE = os.path.join(tmp, "state"); CLI = os.path.join(tmp, "supabase")
WH = os.path.join(tmp, "wt", "hub"); WB = os.path.join(tmp, "wt", "base")
subprocess.run(["git", "worktree", "add", "-q", "--detach", WH, "HEAD"], cwd=HERE, check=True)
subprocess.run(["git", "worktree", "add", "-q", "--detach", WB, BASE], cwd=HERE, check=True)
open(CLI, "w").write(f"""#!/bin/sh
cmd="$2"; fn="$3"
echo "$*" >> "{LOG}.args"
if [ "$cmd" = "download" ]; then
  SRC="{WB}"; grep -qx "$fn" "{STATE}" 2>/dev/null && SRC="{WH}"
  [ -f "$SRC/supabase/functions/$fn/index.ts" ] || exit 1
  mkdir -p "supabase/functions/$fn" "supabase/functions/_shared"
  cp "$SRC/supabase/functions/$fn/index.ts" "supabase/functions/$fn/index.ts"; cp "$SRC"/supabase/functions/_shared/*.ts supabase/functions/_shared/
  if [ "$BAD_LIVE" = "$fn" ] && [ "$SRC" != "{WH}" ]; then echo "// hand edit" >> "supabase/functions/$fn/index.ts"; fi
  exit 0
fi
if [ "$cmd" = "deploy" ]; then echo "$fn" >> "{LOG}"; echo "$fn" >> "{STATE}"; exit 0; fi
exit 1
""")
os.chmod(CLI, 0o755)
HS = {"interview-messages": sha(os.path.join(HERE, "supabase/functions/interview-messages/index.ts"))}
SQLSHA, RBSHA = sha(os.path.join(HERE, "interview_person_461.sql")), sha(os.path.join(HERE, "interview_person_461_rollback.sql"))
def run(keep=False, mode=None, **over):
    if not keep: M.clear()
    M.update(mode or {}); SEEN.clear(); CALLS.clear(); open(LOG, "w").close(); open(LOG + ".args", "w").close()
    if not keep: open(STATE, "w").close()
    rep = os.path.join(tmp, "r.txt")
    if os.path.exists(rep): os.unlink(rep)
    env = dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_SUPA_CLI=CLI, SB_API_BASE=URL, SB_REPO=WH, SB_BASE=BASE,
               SB_SHAS=json.dumps(HS), SB_SQL_SHA=SQLSHA, SB_RB_SHA=RBSHA, SB_FN_BASE=URL, SB_SETTLE="0")
    env.update(over)
    p = subprocess.run([sys.executable, os.path.join(WH, "one_booking_461.py")], env=env, capture_output=True, text=True)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr), open(LOG).read().split(), open(LOG + ".args").read()
rc, r, d, args = run(); print(r)
ck("DONE: the booking rules, then the reminders deployed, from a fresh copy", rc == 0 and "RESULT: DONE" in r and d == ["interview-messages"] and "✗" not in r, r)
ck("the live rules were checked against the ones it was built on before anything changed",
   SEEN.index(next(q for q in SEEN if "from pg_proc" in q)) < SEEN.index(next(q for q in SEEN if "applicant_review_reason(p uuid)" in q)))
ck("the reminders keep their gateway setting (off: the timer calls it)", re.search(r"deploy interview-messages .*--no-verify-jwt", args), args)
ck("the tests ran here, from a fresh copy (fake data only)", all(t_ in r for t_ in ("one_booking_461_messages_test.mjs: ALL 11 CHECKS PASS", "prn1_messages_test.mjs: 15/15", "noshow_test.mjs: ALL 16", "quiet_hours_425_test.mjs: 109/109", "staff_alerts_one_contact_test.mjs: ALL 62")), r)
ck("the report says how many stale holds were freed, and who now waits for the office (Amy still booked, left for the office)",
   "leftover holds freed: 3" in r and "Amy P. · on the do-not-rehire list · STILL HAS A BOOKED INTERVIEW" in r and "Dee T. · applied again after not moving forward" in r, r)
ck("the only function call is the reminders' practice run (?dry=1, nothing sent)", [c_[0] for c_ in CALLS] == ["/functions/v1/interview-messages?dry=1"], CALLS)
ck("...and it lists what it would hold back", "reminders it would now hold back: 2" in r and "Amy: on the do-not-rehire list" in r, r)
ck("no booking is cancelled or moved by the step itself (only the SQL file changes anything)", not any(re.search(r"\b(update|insert|delete)\b", q, re.I) for q in SEEN if "applicant_review_reason(p uuid)" not in q), [q[:120] for q in SEEN if re.search(r"\b(update|insert|delete)\b", q, re.I)])
ck("...and no keys or tokens in the report", not re.search(r"eyJ|sbp_|@", r), r)
rc, r, d, _ = run(keep=True); ck("run again: rules already in, reminders not redeployed, still DONE", rc == 0 and "already this build" in r and "already had it" in r and not d and "RESULT: DONE" in r, r)
rc, r, d, _ = run(mode={"hand": "interview_cancel"}); ck("a live booking rule changed by hand: nothing is changed at all", rc != 0 and "interview_cancel: changed by hand" in r and not d and not any("applicant_review_reason(p uuid)" in q for q in SEEN), r)
rc, r, d, _ = run(BAD_LIVE="interview-messages"); ck("live reminders that aren't on GitHub: nothing is changed at all", rc != 0 and "isn't what this was built on" in r and not d and not any("applicant_review_reason(p uuid)" in q for q in SEEN), r)
rc, r, d, _ = run(mode={"sqlfail": True}); ck("if the rules can't go in: stops, the reminders are not deployed", rc != 0 and "didn't go in" in r and not d, r)
bad = dict(HS); bad["interview-messages"] = "0" * 64
rc, r, d, _ = run(SB_SHAS=json.dumps(bad)); ck("reminders that aren't the reviewed ones: stops before anything", rc != 0 and "not the reviewed build" in r and not d and not SEEN, r)
rc, r, d, _ = run(SB_SQL_SHA="0" * 64); ck("rules file that isn't the reviewed one: stops before anything", rc != 0 and "not the reviewed build" in r and not SEEN, r)
H.shutdown()
for w in (WH, WB): subprocess.run(["git", "worktree", "remove", "--force", w], cwd=HERE)
shutil.rmtree(tmp, ignore_errors=True)
for n, ok, note in res: print(("PASS " if ok else "FAIL ") + n + ("" if ok else "\n      " + note))
print("ALL %d CHECKS PASS" % len(res) if all(x[1] for x in res) else "FAILED"); sys.exit(0 if all(x[1] for x in res) else 1)
