#!/usr/bin/env python3
# Rehearsal of 469 from a FRESH copy of this repository at the commit being tested, against a FAKE Supabase (throwaway local Postgres).
import json, os, subprocess, sys, tempfile, threading, http.server, shutil, datetime as dt
HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "my_desk_463_sql_test.py")).read()
exec(src[:src.index("c = conn(); setup(c)")])
from pg8000.native import DatabaseError
REF = "zngsgedlsxinbygwmxwn"; COMMIT = os.environ.get("REHEARSE_COMMIT") or subprocess.run(["git", "rev-parse", "HEAD"], cwd=HERE, capture_output=True, text=True).stdout.strip()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
class Hd(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body):
        b = json.dumps(body).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0) or 0))
        if self.headers.get("Authorization") != "Bearer sbp_fake": return self._send(401, {"message": "bad token"})
        q = json.loads(raw)["query"]; cc = conn()
        try:
            rows = cc.run(q); cols = [c["name"] for c in (cc.columns or [])]
            return self._send(201, [dict(zip(cols, r)) for r in (rows or [])])
        except DatabaseError as e:
            try: cc.run("rollback")
            except Exception: pass
            return self._send(400, {"message": str(e)[:200]})
        finally: cc.close()
H = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Hd); threading.Thread(target=H.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{H.server_address[1]}"
T = tempfile.mkdtemp(prefix="reh469-"); W = os.path.join(T, "hub")
subprocess.run(["git", "worktree", "add", "-q", "--detach", W, COMMIT], cwd=HERE, check=True)
now = dt.datetime.now(dt.timezone.utc); I = lambda h: (now + dt.timedelta(hours=h)).isoformat().replace("+00:00", "Z")
ITEMS = [{"id": "ops_ref_r1", "kind": "request", "source_id": "ref_r1", "title": "No email for this reference: matilda for Katie Parker", "status": "open", "due": I(-24 * 11)},
         {"id": "ops_ref_r2", "kind": "request", "source_id": "ref_r2", "title": "Reference has not replied: Joe for Ann", "status": "open", "due": I(-24 * 10), "history": [{"at": "x", "by": "y", "text": "z"}]},
         {"id": "ops_ref_r3", "kind": "request", "source_id": "ref_r3", "title": "No email for this reference: new", "status": "open", "due": I(-24 * 2)},
         {"id": "ops_ref_c9", "kind": "reference", "title": "2 more reference(s) needed: Bo", "status": "open", "due": I(-24 * 12)},
         {"id": "ops_issue_x", "kind": "client_issue", "title": "Client issue", "status": "open", "due": I(-24 * 12)},
         {"id": "old_train", "kind": "request", "title": "Verify training", "status": "done", "fresh_start": "fs_468_x", "due": I(-24 * 19)}]
def fresh_db(last):
    c = conn(); setup(c)
    c.run("create table public.app_data(key text primary key, data jsonb, version int default 1)")
    c.run("insert into public.app_data values ('ops_items', :d::jsonb, 1), ('ops_settings', :o::jsonb, 1)", d=json.dumps(ITEMS), o=json.dumps({"x": 1, "fresh_start_last": last}))
    c.close()
def run():
    rep = os.path.join(T, "report.txt")
    if os.path.exists(rep): os.remove(rep)
    p = subprocess.run([sys.executable, os.path.join(W, "refs_469.py")], env=dict(os.environ, SB_REPORT=rep, SB_TOKEN="sbp_fake", SB_API_BASE=URL), capture_output=True, text=True, timeout=300)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
def get(key):
    c = conn()
    try: d = c.run("select data from app_data where key = :k", k=key)[0][0]
    finally: c.close()
    return json.loads(d) if isinstance(d, str) else d
try:
    fresh_db({"id": "fs_468_x", "at": I(-1), "ids": ["old_train"]}); code, out = run(); it = {i["id"]: i for i in get("ops_items")}; o = get("ops_settings")
    ck("happy path: DONE", code == 0 and "RESULT: DONE" in out, out)
    ck("...the two old reference-chase cards close, into 468's batch", it["ops_ref_r1"]["status"] == "done" and it["ops_ref_r2"]["status"] == "done" and it["ops_ref_r1"]["fresh_start"] == "fs_468_x" and len(it["ops_ref_r2"]["history"]) == 2, [it["ops_ref_r1"], it["ops_ref_r2"]])
    ck("...left open: a newer reference card, a references-run card, a client issue", it["ops_ref_r3"]["status"] == "open" and it["ops_ref_c9"]["status"] == "open" and it["ops_issue_x"]["status"] == "open")
    ck("...one Undo covers 468 and 469", o["fresh_start_last"]["id"] == "fs_468_x" and o["fresh_start_last"]["ids"] == ["old_train", "ops_ref_r1", "ops_ref_r2"] and o["x"] == 1 and "fresh_start_prev" not in o, o)
    ck("...the report lists what stays open, without phone numbers or emails", "2 more reference(s) needed: Bo" in out and "Client issue" in out and "to close: 2 (1 no email, 1 no reply)" in out and "@" not in out.replace("(an email)", ""), out)
    code, out = run()
    ck("run again: nothing to close", code == 0 and "no old reference cards to close" in out, out)
    fresh_db({"id": "fs_other", "at": I(-1), "ids": ["a"]}); code, out = run(); o = get("ops_settings")
    ck("468's batch not the latest: its own batch, the other kept as fresh_start_prev", code == 0 and o["fresh_start_last"]["id"].startswith("fs_469_") and o["fresh_start_prev"]["id"] == "fs_other", o)
finally:
    subprocess.run(["git", "worktree", "remove", "--force", W], cwd=HERE); shutil.rmtree(T, ignore_errors=True); H.shutdown()
for n, okk, d in res: print(("PASS" if okk else "FAIL"), "·", n, d)
print(f"{sum(1 for x in res if x[1])} passed, {sum(1 for x in res if not x[1])} failed")
raise SystemExit(0 if all(x[1] for x in res) else 1)
