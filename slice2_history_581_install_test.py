#!/usr/bin/env python3
# Rehearsal of 581 (slice2_history_581.py) against a FAKE Supabase management API. Never touches a real project.
#   python3 slice2_history_581_install_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
KEYS = ["candidates", "caregivers", "ops_items", "leads", "coverage_cases", "timekeeper_cases", "staffing_plans", "visit_changes", "ops_settings"]
S = {}; M = {}
def reset(**m):
    S.clear(); S.update(sql=[]); M.clear(); M.update(dict(installed418=True, live581=False, callout=False, slow=None, nolines=None, proof="ok", install="ok"), **m)
def times():
    t = {k: {"before_med": 8.1, "before_max": 9.0, "after_med": 11.2, "after_max": 14.9, "lines": 0 if M["nolines"] == k else 10} for k in KEYS}
    if M["slow"]: t[M["slow"]]["after_max"] = 612.4
    return t
PROOF = {"item_rows": [{"change": "changed", "fields_changed": ["_proof_581"], "actor": "proof-581@invalid.test", "role": "authenticated", "origin": "https://proof-581.invalid", "same_record": True, "has_name": False}],
         "settings_rows": [{"change": "changed", "fields_changed": ["_proof_581"], "actor": "proof-581@invalid.test", "record_id": None}],
         "server_rows": [{"change": "changed", "fields_changed": ["_proof_581"], "actor": "server", "role": "service_role"}], "error_saved": True, "error_rows": 1}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0); q = json.loads(self.rfile.read(n) or b"{}")["query"]; S["sql"].append(q)
        raise_ = lambda obj: self._send(400, {"message": "Failed to run sql query: ERROR:  P0001: PROBE_RESULT: " + json.dumps(obj) + "\nCONTEXT:  PL/pgSQL function inline_code_block line 60 at RAISE\n"})
        if "from pg_trigger t join pg_proc" in q:
            t = [{"tgname": "app_data_version_t", "calls_out": False}]
            if M["installed418"]: t += [{"tgname": "app_data_item_change_t", "calls_out": False}, {"tgname": "app_data_item_change_del_t", "calls_out": False}]
            if M["callout"]: t.append({"tgname": "notify_t", "calls_out": True})
            return self._send(200, t)
        if "pg_get_triggerdef(oid) as d" in q:
            d = "CREATE TRIGGER app_data_item_change_t AFTER INSERT OR UPDATE OF data ON public.app_data WHEN (new.key = ANY (ARRAY['candidates'::text, 'caregivers'::text" + ("".join(f", '{k}'::text" for k in KEYS[2:]) if M["live581"] else "") + "]))"
            return self._send(200, [{"d": d}])
        if "pg_column_size(data) as bytes" in q:
            return self._send(200, [{"key": k, "n": None if k == "ops_settings" else 120, "bytes": 250000, "u": "2026-10-11 03:00:00+00", "version": 40} for k in KEYS if k != "staffing_plans"])
        if "as maxid, count(*)::int as n" in q: return self._send(200, [{"maxid": 900, "n": 900}])
        if q.lstrip().startswith("-- 581 · speed probe"):
            if "-- 581 INSTALL GOES HERE" in q or "create or replace function public.app_data_item_change_capture" not in q or re.search(r"(?m)^(begin|commit);\s*$", q):
                return self._send(400, {"message": "bad splice"})
            return raise_({"sizes": {}, "times": times()})
        if q.lstrip().startswith("-- ====") and "581 · PHASE 1 SLICE 2" in q:
            if M["install"] == "fail": return self._send(400, {"message": "ERROR: 581 self-check: x"})
            M["live581"] = True; return self._send(201, [])
        if "select count(*)::int as n from public.app_data_item_change" in q: return self._send(200, [{"n": 905}])
        if "proof_left" in q: return self._send(200, [{"proof_left": 0, "rule_left": 0, "s": "abc"}])
        if q.lstrip().startswith("-- 581 · proof"):
            if M["proof"] == "skip": return raise_({"skipped": "fewer than 2 work items with an id"})
            if M["proof"] == "noactor": return raise_(dict(PROOF, item_rows=[dict(PROOF["item_rows"][0], actor="server")]))
            return raise_(PROOF)
        return self._send(400, {"message": "unexpected query " + q[:120]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
tmp = tempfile.mkdtemp(prefix="t581-")
FAKEBIN = os.path.join(tmp, "bin"); os.makedirs(FAKEBIN)
open(os.path.join(FAKEBIN, "node"), "w").write("#!/bin/sh\necho '40/40 passed'\n"); os.chmod(os.path.join(FAKEBIN, "node"), 0o755)
FILES = ["app_data_history_581.sql", "app_data_history_581_proof.sql", "app_data_history_581_speed.sql", "app_data_history_581_rollback.sql"]
SH = {f: sha(os.path.join(HERE, f)) for f in FILES}
def run(env_over=None, **mode):
    reset(**mode); rep = os.path.join(tmp, "r.txt")
    env = dict(os.environ, PATH=FAKEBIN + ":/usr/bin:/bin", SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_HUB_ROOT=HERE,
               SB_SQL_SHA=SH[FILES[0]], SB_PROOF_SHA=SH[FILES[1]], SB_SPEED_SHA=SH[FILES[2]], SB_ROLLBACK_SHA=SH[FILES[3]])
    env.update(env_over or {})
    p = subprocess.run(["python3", os.path.join(HERE, "slice2_history_581.py")], env=env, capture_output=True, text=True, timeout=60)
    return p.returncode, open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr
installed = lambda: any(q.lstrip().startswith("-- ====") and "581 · PHASE 1 SLICE 2" in q for q in S["sql"])

c, out = run()
ck("happy path: exit 0, RESULT: DONE", c == 0 and "RESULT: DONE" in out, out)
ck("it reports each watched key's size and that staffing plans has no row yet", "work items (ops_items): 120 records, 244 KB" in out and "settings record (ops_settings): one record" in out and "staffing plans (staffing_plans): no row yet" in out, out)
ck("it reports before / after save times for every key and the gate", "work items: a save took 8.1 ms (slowest 9.0) today, 11.2 ms (slowest 14.9) with the history" in out and "GATE: every save stays under half a second" in out, out)
ck("the speed probe was sent with the 581 body spliced in, without its begin/commit (checked by the fake)", "the speed probe gave no result" not in out, out)
ck("order: speed probe, then install, then proof", [i for i, q in enumerate(S["sql"]) if q.lstrip().startswith(("-- 581 · speed", "-- ====", "-- 581 · proof"))] == sorted(i for i, q in enumerate(S["sql"]) if q.lstrip().startswith(("-- 581 · speed", "-- ====", "-- 581 · proof")))
   and [q.lstrip()[:12] for q in S["sql"] if q.lstrip().startswith(("-- 581 · speed", "-- ====", "-- 581 · proof"))] == ["-- 581 · spe", "-- =========", "-- 581 · pro"], [q[:20] for q in S["sql"]])
ck("the proof lines are reported (the Slice 2 gate wording)", "left ONE history line: that record, the field name only, the person who saved" in out and "as \"server\"" in out, out)
ck("no token or email is printed", "sbp_test" not in out and "@example" not in out, out)

c, out = run(slow="ops_items")
ck("GATE: a save of 612 ms with the history STOPS before the install; nothing installed", c == 3 and "GATE: with the history a save of work items took half a second or more" in out and "Nothing was installed" in out and not installed(), out)
c, out = run(nolines="leads")
ck("a key the trial watcher wrote no line for STOPS before the install", c == 3 and "wrote no line for: leads" in out and not installed(), out)
c, out = run(installed418=False)
ck("418 not installed: STOP, nothing run", c == 2 and "418 change history is not installed" in out and not installed() and not any("speed probe" in q for q in S["sql"]), out)
c, out = run(callout=True)
ck("a trigger that calls out over the network: STOP before any timed save", c == 2 and "notify_t" in out and not any(q.lstrip().startswith("-- 581 · speed") for q in S["sql"]), out)
c, out = run(env_over={"SB_SPEED_SHA": "0" * 64})
ck("a file that is not the reviewed version: STOP, no query at all", c == 2 and "app_data_history_581_speed.sql is not the reviewed version" in out and not S["sql"], out)
c, out = run(env_over={"SB_TOKEN": "nope"})
ck("no access token: STOP", c == 2 and "no Supabase access token" in out, out)
c, out = run(install="fail")
ck("install refused by its self-check: STOP, reported, no proof run", c == 4 and "581 didn't install" in out and not any(q.lstrip().startswith("-- 581 · proof") for q in S["sql"]), out)
c, out = run(proof="noactor")
ck("a proof line without the person: PARTLY DONE (not silently passed)", c == 1 and "PARTLY DONE" in out, out)
c, out = run(proof="skip")
ck("proof skipped when there are fewer than 2 work items: still DONE, says so", c == 0 and "proof skipped" in out, out)
c, out = run(live581=True)
ck("already installed: says so, runs safely again", c == 0 and "581 is already installed" in out and "RESULT: DONE" in out, out)

shutil.rmtree(tmp, ignore_errors=True)
failed = [r for r in res if not r[1]]
for n, ok, note in res: print(("PASS  " if ok else "FAIL  ") + n + ("" if ok else "\n      " + note))
print(f"\n{len(res) - len(failed)}/{len(res)} passed" + (" · FAIL" if failed else ""))
raise SystemExit(1 if failed else 0)
