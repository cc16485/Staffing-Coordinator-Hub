#!/usr/bin/env python3
# Rehearsal of 821 (family_app_test_login_821.py) against a FAKE Supabase. Never touches a real project.
#   python3 family_app_test_login_821_test.py
import json, os, re, subprocess, tempfile, threading, http.server
HERE = os.path.dirname(os.path.abspath(__file__))
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1200]))
S = {}; M = {}
E = "stroutman2011@gmail.com"; UID = "11111111-2222-3333-4444-555555555555"
def reset(**m):
    S.clear(); S.update(users=[], circles=[], contacts=[], calls=[], bans={}, sql=[])
    M.clear(); M.update(dict(extra_required=[], user_exists=False, circle_exists=False, contact_exists=False, create_fail=False, sqlfail=False), **m)
    if M["user_exists"]: S["users"].append({"id": UID, "email": E})
    if M["circle_exists"]: S["circles"].append({"id": 7, "client_name": "Test Client 5", "active": True, "ax": "290"})
    if M["contact_exists"]: S["contacts"].append({"id": 70, "circle_id": 7, "email": E, "app_status": "revoked", "app_can_book": False, "app_user_id": None})
def read_rows():
    out = []
    for c in S["contacts"]:
        k = next((x for x in S["circles"] if x["id"] == c["circle_id"] and x["ax"] == "290"), None)
        if k and c["email"].lower() == E: out.append({"circle_id": str(k["id"]), "client_name": k["client_name"], "active": k["active"], "contact_id": str(c["id"]),
                                                        "app_status": c["app_status"], "app_can_book": c["app_can_book"], "app_user_id": c["app_user_id"]})
    return out
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(b)
    def _body(self):
        n = int(self.headers.get("Content-Length") or 0); return json.loads(self.rfile.read(n) or b"null")
    def do_GET(self):
        p = self.path; S["calls"].append(("GET", p))
        if p == "/v1/projects": return self._send(200, [{"id": "zngsgedlsxinbygwmxwn", "name": "hub"}, {"id": "famref", "name": "cc-family-app"}])
        if p.startswith("/v1/projects/famref/api-keys"): return self._send(200, [{"name": "anon", "api_key": "eyJanonfam"}, {"name": "service_role", "api_key": "eyJsvcfam"}])
        if p.startswith("/auth/v1/admin/users"): return self._send(200, {"users": S["users"]})
        self._send(404, {})
    def do_PUT(self):
        b = self._body(); S["calls"].append(("PUT", self.path, b))
        if m := re.match(r"/auth/v1/admin/users/(.+)$", self.path): S["bans"][m.group(1)] = b.get("ban_duration"); return self._send(200, {})
        self._send(404, {})
    def do_POST(self):
        b = self._body(); p = self.path; S["calls"].append(("POST", p, b))
        if p == "/auth/v1/admin/users":
            if M["create_fail"]: return self._send(422, {"msg": "nope"})
            u = {"id": UID, "email": b["email"]}; S["users"].append(u); return self._send(200, u)
        if p == "/v1/projects/zngsgedlsxinbygwmxwn/database/query":
            q = b["query"]; S["sql"].append(q)
            if "information_schema.columns" in q:
                return self._send(200, [{"table_name": "circle_contacts", "column_name": "id"}, {"table_name": "circle_contacts", "column_name": "circle_id"}]
                                  + [{"table_name": t, "column_name": c} for t, c in M["extra_required"]])
            if q.startswith("begin;"):
                if M["sqlfail"]: return self._send(400, {"message": "boom"})
                uid = re.search(r"app_user_id = '([0-9a-f\-]+)'::uuid", q).group(1)
                k = next((x for x in S["circles"] if x["ax"] == "290" and x["active"] is not False), None)
                if not k: k = {"id": 8, "client_name": "Test Client 5", "active": True, "ax": "290"}; S["circles"].append(k)
                c = next((x for x in S["contacts"] if x["circle_id"] == k["id"] and x["email"] == E), None)
                if not c: c = {"id": 80, "circle_id": k["id"], "email": E, "app_status": None, "app_can_book": False, "app_user_id": None}; S["contacts"].append(c)
                c.update(app_status="active", app_can_book=True, app_user_id=uid)
                return self._send(201, read_rows())
            if q.startswith("update public.circle_contacts c set app_status = 'revoked'"):
                for c in S["contacts"]:
                    if c["email"] == E: c["app_status"] = "revoked"
                return self._send(201, read_rows())
            if q.startswith("select k.id::text"): return self._send(201, read_rows())
            return self._send(400, {"message": "unexpected"})
        self._send(404, {})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"; TMP = tempfile.mkdtemp(prefix="t821-")
def run(mode="add", **m):
    reset(**m); rep = os.path.join(TMP, "r.txt")
    if os.path.exists(rep): os.remove(rep)
    env = dict(os.environ, SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FAM_BASE=URL, SB_MODE=mode)
    p = subprocess.run(["python3", os.path.join(HERE, "family_app_test_login_821.py")], env=env, capture_output=True, text=True, timeout=60)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
hub_writes = lambda: [q for q in S["sql"] if q.startswith("begin;") or q.startswith("update")]

c, out = run()
ck("1 fresh: login made, circle + contact made, app on + booking on", c == 0 and "821: DONE" in out and S["users"] and read_rows() == [{"circle_id": "8", "client_name": "Test Client 5", "active": True, "contact_id": "80", "app_status": "active", "app_can_book": True, "app_user_id": UID}], (out, read_rows()))
ck("1b login made with email confirmed, no email sent (no otp/invite call)", any(x[0] == "POST" and x[1] == "/auth/v1/admin/users" and x[2].get("email_confirm") is True for x in S["calls"]) and not any("/otp" in x[1] or "/invite" in x[1] for x in S["calls"]), S["calls"])
ck("1c the Hub write is one all-or-nothing block, only this address on client 290", len(hub_writes()) == 1 and hub_writes()[0].rstrip().endswith("order by c.id") and "commit;" in hub_writes()[0] and "'290'" in hub_writes()[0], hub_writes())
ck("1d no key or token printed", not re.search(r"eyJ\w|sbp_test", out), out)
c, out = run(user_exists=True, circle_exists=True, contact_exists=True)
ck("2 run again / existing revoked row: reuses everything, unblocks, turns it back on", c == 0 and len(S["users"]) == 1 and len(S["circles"]) == 1 and read_rows()[0]["app_status"] == "active" and S["bans"].get(UID) == "none", (out, S))
c, out = run(circle_exists=True)
ck("3 circle already there: adds the contact to it, makes no second circle", c == 0 and len(S["circles"]) == 1 and read_rows()[0]["circle_id"] == "7", (out, S["circles"]))
c, out = run(extra_required=[("circle_contacts", "created_by")])
ck("4 tables need a field we don't fill: stops before the login or any Hub change", c == 1 and "created_by" in out and not S["users"] and not hub_writes(), out)
c, out = run(create_fail=True)
ck("5 login not made: stops, Hub untouched", c == 1 and "wasn't made" in out and not hub_writes(), out)
c, out = run(sqlfail=True)
ck("6 Hub write refused: reported as not complete", c == 1 and "not saved" in out and "NOT COMPLETE" in out, out)
c, out = run(mode="remove", user_exists=True, circle_exists=True, contact_exists=True)
ck("7 remove: row revoked + login blocked", c == 0 and read_rows()[0]["app_status"] == "revoked" and S["bans"].get(UID) == "876000h" and "REMOVE: DONE" in out, (out, S["bans"]))

for n, okk, note in res: print(("  ✓ " if okk else "  ✗ ") + n + ("" if okk else "\n" + note))
print(f"\n  821 rehearsal: {sum(1 for r in res if r[1])}/{len(res)} passed")
raise SystemExit(0 if all(r[1] for r in res) else 1)
