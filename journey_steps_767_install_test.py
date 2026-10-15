#!/usr/bin/env python3
# Rehearsal of 767 (journey_steps_767.py) against a FAKE database that keeps the step catalog like the real table and
# applies the installer's statements, from a fresh worktree of this commit. Never touches a real project.
#   python3 journey_steps_767_install_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib, shutil, copy
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:900]))
CAT = {d["key"]: d for d in json.load(open(os.path.join(HERE, "client-journey/catalog-v1.json")))["steps"]}
A5 = json.load(open(os.path.join(HERE, "client-journey/catalog-a5-767.json")))
DB = {}; LOG = []; MODE = {}
def seed(**m):
    DB.clear(); LOG.clear(); MODE.clear(); MODE.update(m)
    for k, d in CAT.items(): DB[k] = {"key": k, "def": copy.deepcopy(d), "active": True}
def apply(stmt):
    if m := re.match(r"insert into public.client_journey_step_def \(key, catalog_version, def, active, updated_by\) values \('([^']+)', 3, '(.*)'::jsonb, true, '767'\)$", stmt, re.S):
        if m.group(1) in DB: raise ValueError("duplicate key")
        DB[m.group(1)] = {"key": m.group(1), "def": json.loads(m.group(2).replace("''", "'")), "active": True}; return
    if m := re.match(r"update public.client_journey_step_def set def = def \|\| '(.*)'::jsonb, updated_at = now\(\), updated_by = '767' where key = 'fw.first_visit'$", stmt, re.S):
        DB["fw.first_visit"]["def"].update(json.loads(m.group(1).replace("''", "'"))); return
    if m := re.match(r"update public.client_journey_step_def set def = jsonb_set\(def, '\{after\}', coalesce\(def->'after', '\[\]'::jsonb\) \|\| '(.*)'::jsonb\), updated_at = now\(\), updated_by = '767' where key = 'active.complete'$", stmt, re.S):
        DB["active.complete"]["def"]["after"] += json.loads(m.group(1)); return
    raise ValueError("unexpected statement " + stmt[:120])
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        q = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)))["query"]; LOG.append(q)
        if q.startswith("select key, def, active from public.client_journey_step_def"):
            ks = re.findall(r"'([^']+)'", q.split(" in (", 1)[1]); return self._send(200, [copy.deepcopy(DB[k]) for k in ks if k in DB])
        if "count(*) from j" in q: return self._send(200, [{"open": 12, "yes": 1, "ax": 0, "fv": 0}])
        if q.startswith("begin;"):
            if MODE.get("fail"): return self._send(400, {"message": "ERROR: injected"})
            snap = copy.deepcopy(DB)
            try:
                for st in [x.strip() for x in q[len("begin;"):].rsplit("commit;", 1)[0].split(";\n") if x.strip()]: apply(st.rstrip(";"))
            except Exception as e:
                DB.clear(); DB.update(snap); return self._send(400, {"message": str(e)})
            return self._send(200, [])
        return self._send(400, {"message": "unexpected query " + q[:100]})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t767-"); WT = os.path.join(TMP, "wt")
subprocess.run(["git", "-C", HERE, "worktree", "add", "-q", "--detach", WT, "HEAD"], check=True)
SHA = hashlib.sha256(open(os.path.join(WT, "client-journey/catalog-a5-767.json"), "rb").read()).hexdigest()
def run(env_over=None, **m):
    rep = os.path.join(TMP, "r.txt"); os.path.exists(rep) and os.remove(rep)
    env = dict(os.environ, SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_REPO=WT, SB_A5_SHA=SHA); env.update(env_over or {})
    p = subprocess.run(["python3", os.path.join(WT, "journey_steps_767.py")], env=env, capture_output=True, text=True, timeout=120)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
changes = lambda: [q for q in LOG if q.startswith("begin;")]
try:
    seed(); c, out = run()
    ck("clean run from a fresh copy: exit 0, DONE", c == 0 and "RESULT: DONE" in out, out)
    ck("...the three steps are in the catalog exactly as reviewed", all(DB.get(d["key"], {}).get("def") == d for d in A5["add"]))
    ck("...Complete start of care waits for them, and nothing it waited for before is lost", DB["active.complete"]["def"]["after"] == CAT["active.complete"]["after"] + A5["complete_after"])
    ck("...the First visit instructions changed and nothing else on that step", DB["fw.first_visit"]["def"] == {**CAT["fw.first_visit"], **A5["patch"]["fw.first_visit"]})
    ck("...one transaction", len(changes()) == 1, LOG)
    ck("...it says how many journeys will show each new step", "12 open client journeys" in out and "1 will show Welcome call" in out, out)
    c, out = run()
    ck("run again: nothing to change, DONE (safe to re-run)", c == 0 and len(changes()) == 1 and "nothing to change" in out and "RESULT: DONE" in out, out)
    seed(); DB["fw.evv"] = {"key": "fw.evv", "def": {"title": "someone else's step", "stage": "firstweek"}, "active": True}; c, out = run()
    ck("a different step already named fw.evv: STOP, nothing changed", c == 3 and not changes() and DB["fw.evv"]["def"]["title"] == "someone else's step", out)
    seed(); DB["fw.first_visit"]["def"]["howto"] = ["edited by someone"]; c, out = run()
    ck("First visit instructions edited by someone else: STOP, nothing changed", c == 3 and not changes() and "signed.welcome" not in DB, out)
    seed(fail=True); before = copy.deepcopy(DB); c, out = run()
    ck("the database refuses the change: STOP, and the catalog is as it was", c == 6 and DB == before and "nothing in it was saved" in out, out)
    seed(); c, out = run(env_over={"SB_A5_SHA": "0" * 64})
    ck("a step file that is not the reviewed one: STOP, nothing run", c == 2 and not LOG, out)
    seed(); c, out = run(env_over={"SB_TOKEN": "x"})
    ck("no token: nothing run", c == 2 and not LOG, out)
    ck("no em dash in what she reads", "—" not in open(os.path.join(WT, "journey_steps_767.py")).read())
finally:
    subprocess.run(["git", "-C", HERE, "worktree", "remove", "--force", WT]); shutil.rmtree(TMP, ignore_errors=True); srv.shutdown()
f = 0
for n, ok, note in res: print(("  ✓ " if ok else "  ✗ ") + n + ("" if ok else "\n      " + note)); f += 0 if ok else 1
print(f"\n{len(res) - f}/{len(res)} passed"); raise SystemExit(1 if f else 0)
