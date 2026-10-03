#!/usr/bin/env python3
# Rehearsal of 418 (safe_saves_418.py) against a FAKE Supabase (management API, storage) and a FAKE sc.mo-care.com.
# Never touches a real project.   python3 safe_saves_418_install_test.py
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib
HERE = os.path.dirname(os.path.abspath(__file__))
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
F1, F2 = "aaaaaaaa-0000-4000-8000-000000000001", "aaaaaaaa-0000-4000-8000-000000000002"
PHONE, EMAIL = "(417) 555-0199", "Aimee.D@Example.com"
P = lambda i, **o: dict({"id": i, "first": f"First{i}", "last": f"Last{i}", "phone": f"41755500{i:02d}", "email": f"p{i}@example.org"}, **o)
HER_OLD = P(41, first="Aimee", last="Driggers", phone="", email="aimee.d@example.com")
HER_NEW = P(77, first="Aimee", last="Driggers", intake_id=F2, phone="417-555-0199", email="")
base = [P(i) for i in range(1, 11)]
SNAP = {
    "2026-09-14": [{"key": "candidates", "data": base, "updated_at": "2026-09-13T10:00:00+00:00"}, {"key": "caregivers", "data": [P(90)], "updated_at": "2026-09-01T00:00:00+00:00"}],
    "2026-09-21": [{"key": "candidates", "data": base + [HER_OLD], "updated_at": "2026-09-20T15:00:00+00:00"}, {"key": "caregivers", "data": [P(90)]}, {"key": "settings", "data": {}}],
    "2026-09-28": [{"key": "candidates", "data": base[:5], "updated_at": "2026-09-26T09:30:00+00:00"}, {"key": "caregivers", "data": [P(90)]}],
}
LIVE = [{"key": "candidates", "data": base[:5] + [HER_NEW], "updated_at": "2026-10-02T14:00:00+00:00"}, {"key": "caregivers", "data": [P(90)], "updated_at": "2026-09-30T00:00:00+00:00"}]
PROBE = {"changed_id": "1", "removed_ids": ["3", "4", "77"], "saved": 1, "leak": False, "error_saved": 1, "error_save_kept": True,
         "error_rows": [{"change": "trigger_error", "actor": "proof-418@invalid.test", "has_error_text": True}],
         "rows": [{"change": "changed", "record_id": "1", "fields_changed": ["_proof_418"], "bulk_removed": False, "actor": "proof-418@invalid.test", "role": "authenticated", "origin": "https://proof-418.invalid", "names": "false"},
                  {"change": "added", "record_id": "proof-418-added", "fields_changed": None, "bulk_removed": False, "actor": "proof-418@invalid.test", "role": "authenticated", "origin": "https://proof-418.invalid", "names": "Proof Added"}]
         + [{"change": "removed", "record_id": r, "fields_changed": None, "bulk_removed": True, "actor": "proof-418@invalid.test", "role": "authenticated", "origin": "https://proof-418.invalid", "names": "true"} for r in ("3", "4", "77")]}
S = {}; MODE = {}
def reset(**m): S.clear(); S.update(sql=[], gets=[]); MODE.clear(); MODE.update(dict(page="new", keys="ok", proof="ok", installed=False, callout=False), **m)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj, ctype="application/json"):
        b = obj.encode() if isinstance(obj, str) else json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", ctype); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        p = self.path; S["gets"].append((p, dict(self.headers)))
        if m := re.match(r"/v1/projects/\w+/api-keys(\?reveal=true)?$", p):
            if MODE["keys"] == "none": return self._send(200, [{"name": "anon", "api_key": "eyJanon"}])
            if MODE["keys"] == "secret-only": return self._send(200, [{"name": "default", "api_key": "sb_secret_abc"}])
            return self._send(200, [{"name": "anon", "api_key": "eyJanon"}, {"name": "service_role", "api_key": "eyJsvcKEY"}])
        if m := re.match(r"/storage/v1/object/backups/(\d{4}-\d\d-\d\d)/app_data\.json$", p):
            if MODE["keys"] == "secret-only" and self.headers.get("Authorization"): return self._send(400, {"error": "Invalid JWT"})
            if self.headers.get("apikey") not in ("eyJsvcKEY", "sb_secret_abc"): return self._send(401, {})
            return self._send(200, SNAP[m.group(1)])
        if p.startswith("/sc/"):
            page = '<html><div class="sc-ro-banner" data-sc-readonly="418">x</div></html>' if MODE["page"] == "new" else "<html>old</html>"
            return self._send(200, page, "text/html")
        self._send(404, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}"); p = self.path
        if not re.match(r"/v1/projects/\w+/database/query", p): return self._send(404, {})
        q = body["query"]; S["sql"].append(q)
        if "proname in ('upsert_app_data_item'" in q: return self._send(200, [{"proname": "delete_app_data_item", "args": "target_key text, item_id text", "prosecdef": False, "owner": "postgres"},
                                                                          {"proname": "upsert_app_data_item", "args": "target_key text, item jsonb", "prosecdef": False, "owner": "postgres"}])
        if "from pg_policies" in q: return self._send(200, [{"policyname": "Hub-scoped read/write", "permissive": "PERMISSIVE", "cmd": "ALL", "roles": "{authenticated}", "using_": "can_access_data_key(key)", "check_": "can_access_data_key(key)"}])
        if "relforcerowsecurity" in q: return self._send(200, [{"on_": True, "forced": False}])
        if "role_table_grants" in q: return self._send(200, [{"grantee": "authenticated", "privs": "DELETE, INSERT, SELECT, UPDATE"}])
        if "from pg_trigger t join pg_proc" in q:
            t = [{"tgname": "lead_change_capture_t", "proname": "lead_change_capture", "def": "x", "calls_out": False}]
            if MODE["installed"]: t.append({"tgname": "app_data_item_change_t", "proname": "app_data_item_change_capture", "def": "x", "calls_out": False})
            if MODE["callout"]: t.append({"tgname": "notify_t", "proname": "notify", "def": "x", "calls_out": True})
            return self._send(200, t)
        if "from public.hire_intake" in q:
            return self._send(200, [{"id": F1, "created_at": "2026-09-19T18:00:00+00:00", "candidate_id": 41, "seen_at": "2026-09-20T15:00:00+00:00", "first_name": "Aimee", "last_name": "Driggers", "phone": PHONE, "email": EMAIL},
                                    {"id": F2, "created_at": "2026-10-02T13:00:00+00:00", "candidate_id": 77, "seen_at": None, "first_name": "Aimee", "last_name": "Driggers", "phone": PHONE, "email": EMAIL}])
        if "from public.app_data where key in ('candidates', 'caregivers')" in q: return self._send(200, LIVE)
        if "from storage.objects" in q: return self._send(200, [{"name": d + "/app_data.json", "created_at": d} for d in sorted(SNAP)])
        if "from public.reference_requests" in q:
            return self._send(200, [{"candidate_id": 41, "slot": s, "created_at": "2026-09-20T15:05:00+00:00", "sent_at": "2026-09-20T15:06:00+00:00", "responded_at": None} for s in (1, 2)])
        if q.lstrip().startswith("-- ====") and "app_data_item_change" in q: return self._send(201, [])
        if "tgname in ('app_data_item_change_t', 'app_data_item_change_del_t'))::int as t" in q: return self._send(200, [{"t": 2, "rls": True, "definer": True, "n": 0}])
        if q.lstrip().startswith("-- 418 · proof"):
            if MODE["proof"] == "denied": return self._send(400, {"message": "Failed to run sql query: ERROR: 42501: permission denied to set role \"authenticated\""})
            return self._send(400, {"message": "Failed to run sql query: ERROR:  P0001: PROBE_RESULT: " + json.dumps(PROBE) + "\nCONTEXT:  PL/pgSQL function inline_code_block line 60 at RAISE\n"})
        if "as maxid" in q:
            r = {"maxid": 5, "n": 5, "u": "2026-10-02 14:00:00+00", "m": "abc"}
            if "proof_left" in q: r.update(proof_left=0, rule_left=0)
            return self._send(200, [r])
        return self._send(400, {"message": "unexpected query " + q[:120]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
tmp = tempfile.mkdtemp(prefix="t418-")
FAKEBIN = os.path.join(tmp, "bin"); os.makedirs(FAKEBIN)   # a fake node so the rehearsal doesn't re-run the page tests
open(os.path.join(FAKEBIN, "node"), "w").write("#!/bin/sh\necho '50/50 passed'\n"); os.chmod(os.path.join(FAKEBIN, "node"), 0o755)
def run(sql_sha=None, **mode):
    reset(**mode); rep = os.path.join(tmp, "r.txt")
    env = dict(os.environ, SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_HUB_FN_BASE=URL, SB_SC_URL=URL + "/sc/", SB_HUB_ROOT=HERE,
               SB_SQL_SHA=sql_sha or sha(os.path.join(HERE, "app_data_history.sql")), SB_PROOF_SHA=sha(os.path.join(HERE, "app_data_history_proof.sql")),
               PATH=FAKEBIN + os.pathsep + os.environ.get("PATH", ""))
    p = subprocess.run([sys.executable, os.path.join(HERE, "safe_saves_418.py")], env=env, capture_output=True, text=True, timeout=120)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else "") + p.stderr

code, out = run()
ck("a good run ends DONE (exit 0)", code == 0 and "RESULT: DONE" in out, out)
ck("never prints her phone or email (any spelling), nor anyone else's", not re.search(r"555-?0199|4175550199|aimee\.d@|example\.(com|org)|41755500", out, re.I), out)
ck("never reads the SSN column (hire_intake is read by named columns only)", not any("ssn" in q.lower() for q in S["sql"] if "hire_intake" in q) and not any("to_jsonb(h" in q for q in S["sql"]))
ck("start forms reported: two, with their candidate numbers", "start forms (hire_intake) for her: 2" in out and "linked candidate number 41" in out and "linked candidate number 77" in out, out)
ck("now: candidates saved time + count + her current number (matched by form)", "candidates last saved 2026-10-02T14:00 UTC, 6 people" in out and "1 person" in out and "number(s) 77 (matched by form)" in out, out)
ck("09-14: 10 candidates, not her", re.search(r"2026-09-14: 10 candidates \(last saved 2026-09-13T10:00\); HER: no;", out), out)
ck("09-21: 11 candidates, her as 41 matched by email (case ignored)", re.search(r"2026-09-21: 11 candidates .*HER: yes, number 41 \(email\); 0 candidate\(s\) gone", out), out)
ck("09-28: many gone at once flagged as an old list saved over it, and she was one of them", re.search(r"2026-09-28: 5 candidates .*HER: no; 6 candidate\(s\) gone since the backup before \(MANY AT ONCE.*\) \(she was one of them\)", out), out)
ck("the lost window is named", "she was lost between 2026-09-21 and 2026-09-28" in out, out)
ck("reference requests: both slots, pointing at 41, which is NOT in candidates now and was only in the 09-21 backup",
   out.count("for candidate number 41") == 2 and "is in candidates NOW: NO; in backups: 2026-09-21" in out, out)
ck("facts: both save functions run as the caller; app_data rules, grants and triggers listed",
   "upsert_app_data_item(target_key text, item jsonb): owner postgres, runs as THE CALLER" in out and "Hub-scoped read/write" in out and "grant on app_data to authenticated" in out and "lead_change_capture_t" in out, out)
ck("the SQL runs exactly once, as the reviewed file", sum(1 for q in S["sql"] if q == open(os.path.join(HERE, "app_data_history.sql")).read()) == 1)
ck("the proof runs once, as the reviewed file, and its result is read", sum(1 for q in S["sql"] if q == open(os.path.join(HERE, "app_data_history_proof.sql")).read()) == 1
   and "it left exactly: 1 changed, 1 added, 3 removed" in out and "the save STILL went through" in out and "no proof line and no temporary rule exist" in out, out)
ck("nothing but reads before the SQL (no write statement in Part 1)", all(not re.search(r"\b(insert|update|delete|alter|create|drop|grant|revoke)\b", q, re.I) or q.lstrip().startswith(("-- ====", "-- 418")) or "pg_" in q or "information_schema" in q or "storage.objects" in q
   for q in S["sql"][:S["sql"].index(open(os.path.join(HERE, "app_data_history.sql")).read())]), S["sql"])
ck("the backups were opened with the server key (never printed)", any("/storage/v1/object/backups/" in g[0] for g in S["gets"]) and "eyJsvc" not in out, out)
ck("sc.mo-care.com: says the read-only page is live", "sc.mo-care.com now serves the read-only page" in out, out)
ck("nothing is sent: no function was called", not any("/functions/v1/" in g[0] for g in S["gets"]))

code, out = run(page="old")
ck("old page still live: says so and to merge the branch (not a failure)", code == 0 and "still serves the OLD page" in out and "safe-saves-1" in out, out)
code, out = run(keys="secret-only")
ck("a new-style secret key still opens the backups (apikey header only)", code == 0 and "3 found, 3 opened" in out, out)
code, out = run(keys="none")
ck("no server key: the backups are reported unreadable, the history and proof still run, PARTLY DONE", code == 1 and "server key" in out and "PARTLY DONE" in out and "it left exactly" in out, out)
code, out = run(proof="denied")
ck("the proof refused (e.g. cannot act as a browser): reported, PARTLY DONE, nothing else claimed", code == 1 and "the proof didn't give a result" in out and "it left exactly" not in out, out)
code, out = run(callout=True)
ck("another trigger that calls out: the live proof is NOT run", code == 1 and not any(q.lstrip().startswith("-- 418 · proof") for q in S["sql"]) and "was NOT run" in out, out)
code, out = run(installed=True)
ck("already installed: says so and re-runs safely", code == 0 and "already installed" in out, out)
code, out = run(sql_sha="0" * 64)
ck("a changed SQL file: stops before anything runs", code == 2 and not S["sql"] and "not the reviewed version" in out, out)
DASH = re.compile("[—―]")
ck("no em dash in the installer's words or its report", not DASH.search(open(os.path.join(HERE, "safe_saves_418.py")).read()) and not DASH.search(out))

srv.shutdown()
bad = [r for r in res if not r[1]]
for n, ok_, note in res: print(("PASS  " if ok_ else "FAIL  ") + n + ("" if ok_ else "\n      " + note))
print(f"\n{len(res) - len(bad)}/{len(res)} passed" + (" · FAIL" if bad else ""))
sys.exit(1 if bad else 0)
