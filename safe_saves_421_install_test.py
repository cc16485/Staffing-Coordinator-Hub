#!/usr/bin/env python3
# Rehearsal of 421 (safe_saves_421.py) against a FAKE Supabase management API and a FAKE cc.mo-care.com.
# Never touches a real project.   python3 safe_saves_421_install_test.py
import json, os, re, subprocess, sys, tempfile, threading, http.server, hashlib
HERE = os.path.dirname(os.path.abspath(__file__))
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
SQLT, PROOFT = open(os.path.join(HERE, "safe_saves_2.sql")).read(), open(os.path.join(HERE, "safe_saves_2_proof.sql")).read()
PROBE = {"a": "1", "b": "2", "c": "3", "max_before": 17, "counter_before": 17, "version_before": 5, "version_after": 9,
         "add_ok": True, "new_id": 18, "added_present": True, "put1_ok": True, "rev_before": 0, "rev_after": 1, "put1_rev": 1,
         "stale_ok": False, "stale_reason": "conflict", "stale_conflict_ids": ["1"], "stale_current_rev": 1, "stale_nothing_saved": True,
         "b_ok": True, "c_ok": True, "bulk_ok": False, "bulk_reason": "bulk_remove", "bulk_nothing_saved": True, "anon_refused": True,
         "history": [{"change": "added", "record_id": "18", "actor": "proof-421@invalid.test"}] + [{"change": "changed", "record_id": i, "actor": "proof-421@invalid.test"} for i in "123"],
         "refusals": [{"reason": "conflict", "ids": ["1"], "actor": "proof-421@invalid.test"}, {"reason": "bulk_remove_refused", "ids": ["1", "2", "3"], "actor": "proof-421@invalid.test"}]}
S = {}; MODE = {}
def reset(**m): S.clear(); S.update(sql=[], gets=[]); MODE.clear(); MODE.update(dict(page="old", proof="ok", installed=False, callout=False, dup=False, sqlfail=False), **m)
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj, ctype="application/json"):
        b = obj.encode() if isinstance(obj, str) else json.dumps(obj).encode()
        self.send_response(code); self.send_header("Content-Type", ctype); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        S["gets"].append(self.path)
        if self.path.startswith("/cc/caregivers-engine.js"):
            return self._send(200, "async function x(){ await sb.rpc('app_data_items_apply', {}) }" if MODE["page"] == "new" else "function syncToSupabase(){}", "text/javascript")
        self._send(404, {})
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); body = json.loads(self.rfile.read(n) or b"{}")
        if not re.match(r"/v1/projects/\w+/database/query", self.path): return self._send(404, {})
        q = body["query"]; S["sql"].append(q)
        if "column_name = 'version') as v" in q: return self._send(200, [{"v": MODE["installed"], "f": MODE["installed"]}])
        if "jsonb_array_length(case when" in q:
            r = [{"key": "candidates", "n": 9, "u": "2026-10-02 14:00:00+00", "maxid": 17, "odd": 0, "revd": 0}, {"key": "caregivers", "n": 61, "u": "2026-10-01 10:00:00+00", "maxid": 70, "odd": 1, "revd": 0}]
            if MODE["installed"]:
                for x in r: x["version"] = 3
            return self._send(200, r)
        if "having count(*) > 1" in q: return self._send(200, [{"key": "candidates", "id": "10", "n": 2}] if MODE["dup"] else [])
        if "from pg_trigger t join pg_proc" in q:
            t = [{"tgname": "app_data_item_change_t", "proname": "app_data_item_change_capture", "calls_out": False}, {"tgname": "lead_change_capture_t", "proname": "lead_change_capture", "calls_out": False}]
            if MODE["callout"]: t.append({"tgname": "notify_t", "proname": "notify", "calls_out": True})
            return self._send(200, t)
        if q == SQLT: return self._send(400, {"message": "ERROR: 55P03: lock timeout"}) if MODE["sqlfail"] else self._send(201, [])
        if "tgname = 'app_data_version_t')::int as t" in q:
            return self._send(200, [{"t": 1, "definer": True, "save_definer": False, "anon_can": False, "staff_can": True, "counters": {"candidates": 25, "caregivers": 70}}])
        if q == PROOFT:
            if MODE["proof"] == "denied": return self._send(400, {"message": "Failed to run sql query: ERROR: 42501: permission denied to set role \"authenticated\""})
            return self._send(400, {"message": "Failed to run sql query: ERROR:  P0001: PROBE_RESULT: " + json.dumps(PROBE) + "\nCONTEXT:  PL/pgSQL function inline_code_block line 80 at RAISE\n"})
        if "as hmax" in q:
            r = {"m": "abc", "v": 5, "u": "2026-10-02 14:00:00+00", "h": 40, "l": 0, "c": 25, "hmax": 40}
            if "proof_left" in q: r.update(proof_left=0, proof_log_left=0)
            return self._send(200, [r])
        return self._send(400, {"message": "unexpected query " + q[:120]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
tmp = tempfile.mkdtemp(prefix="t421-")
FAKEBIN = os.path.join(tmp, "bin"); os.makedirs(FAKEBIN)
open(os.path.join(FAKEBIN, "node"), "w").write("#!/bin/sh\necho '70/70 passed'\n"); os.chmod(os.path.join(FAKEBIN, "node"), 0o755)
def run(sql_sha=None, **mode):
    reset(**mode); rep = os.path.join(tmp, "r.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_CC_ENGINE_URL=URL + "/cc/caregivers-engine.js", SB_HUB_ROOT=HERE,
               SB_SQL_SHA=sql_sha or sha(os.path.join(HERE, "safe_saves_2.sql")), SB_PROOF_SHA=sha(os.path.join(HERE, "safe_saves_2_proof.sql")),
               PATH=FAKEBIN + os.pathsep + os.environ.get("PATH", ""))
    p = subprocess.run([sys.executable, os.path.join(HERE, "safe_saves_421.py")], env=env, capture_output=True, text=True, timeout=120)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else "") + p.stderr

code, out = run()
ck("a good run ends DONE (exit 0)", code == 0 and "RESULT: DONE" in out, out)
ck("Part 1: counts, highest numbers, a record without a plain number", "candidates: 9 people, highest number 17" in out and "caregivers: 61 people, highest number 70" in out and "1 record(s) without a plain number" in out, out)
ck("Part 1: no shared numbers today", "no number is shared by two people" in out, out)
ck("nothing but reads before the SQL", all(not re.search(r"\b(insert|update|delete|alter|create|drop|grant|revoke)\b", q, re.I) or "pg_" in q or "information_schema" in q
   for q in S["sql"][:S["sql"].index(SQLT)]), S["sql"])
ck("the SQL runs exactly once, as the reviewed file", S["sql"].count(SQLT) == 1)
ck("Part 2: installed + the counters reported", "installed: the version counter" in out and "candidates 25, caregivers 70" in out, out)
ck("Part 3: every proof line passes", all(s in out for s in ("fresh number from the database (18", "saved (its _rev went 0 to 1)", "REFUSED, nothing saved, the current record", "both saved",
   "removing 3 people in one save: REFUSED", "anon (the public key): refused", "once per saved change (4)", "recorded the added person and the 3 changes", "recorded the stale change and the bulk removal",
   "no proof line in the history", "exactly as before")), out)
ck("the proof runs once, as the reviewed file", S["sql"].count(PROOFT) == 1)
ck("the Hub not merged yet: says to merge safe-saves-2 (not a failure)", "merge the Hub branch safe-saves-2" in out, out)
ck("never prints an email other than the proof identity, or a key", not re.search(r"@(?!invalid\.test)", out) and "sbp_test" not in out, out)
ck("nothing is sent: no function was called", not any("/functions/v1/" in g for g in S["gets"]))

code, out = run(page="new", installed=True)
ck("already installed + the Hub merged: says both, DONE", code == 0 and "already there (running the SQL again is safe)" in out and "version 3" in out and "one person at a time" in out, out)
code, out = run(dup=True)
ck("a number shared by two people today is reported (number and count only) and noted at the end, still DONE", code == 0 and "candidates: number 10 is shared by 2 records" in out and "NOTE: 1 number(s) shared" in out, out)
code, out = run(proof="denied")
ck("the proof refused: reported, PARTLY DONE", code == 1 and "the proof didn't give a result" in out and "PARTLY DONE" in out, out)
code, out = run(callout=True)
ck("a trigger that calls out: the live proof is NOT run", code == 1 and PROOFT not in S["sql"] and "was NOT run" in out, out)
code, out = run(sqlfail=True)
ck("the SQL fails (e.g. lock timeout): stops, nothing else claimed, no proof", code == 4 and "didn't install" in out and PROOFT not in S["sql"], out)
code, out = run(sql_sha="0" * 64)
ck("a changed SQL file: stops before anything runs", code == 2 and not S["sql"] and "not the reviewed version" in out, out)
CMD = "/Users/samantha/Desktop/421 Safe Saving.command"
if os.path.exists(CMD):
    c = open(CMD).read()
    ck("the Desktop 421 wrapper pins exactly these SQL and proof files", sha(os.path.join(HERE, "safe_saves_2.sql")) in c and sha(os.path.join(HERE, "safe_saves_2_proof.sql")) in c and "safe_saves_421.py" in c)
DASH = re.compile("[—―]")
ck("no em dash in the installer's words or its report", not DASH.search(open(os.path.join(HERE, "safe_saves_421.py")).read()) and not DASH.search(out))

srv.shutdown()
bad = [r for r in res if not r[1]]
for n, ok_, note in res: print(("PASS  " if ok_ else "FAIL  ") + n + ("" if ok_ else "\n      " + note))
print(f"\n{len(res) - len(bad)}/{len(res)} passed" + (" · FAIL" if bad else ""))
sys.exit(1 if bad else 0)
