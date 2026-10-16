#!/usr/bin/env python3
# Rehearsal of 840 (live test on Test Client 5) and 841 (turn on live booking) against a FAKE Supabase, family sign-in,
# family door and AxisCare. Never touches a real project.   python3 family_app_live_840_841_test.py
import json, os, re, subprocess, tempfile, threading, http.server, hashlib
HERE = os.path.dirname(os.path.abspath(__file__))
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
res = []; ck = lambda n, c, note="": res.append((n, bool(c), "" if c else str(note)[:1500]))
S = {}; M = {}
def reset(**m):
    S.clear(); S.update(settings={"family_app_live": "false", "family_fee_check_ready": "true", "family_offer_live": "false", "live_clients": []},
                        visits=[], bookings={}, cards={}, deployed=[], sql=[], calls=[], lc_history=[])
    M.clear(); M.update(dict(signin=True, state="MO", axis_refuse=False, cancel_fail=False, deploy_fail=False, passed_test=0), **m)
    if "settings" in m: S["settings"].update(m["settings"])
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
        self._send(404, {})
    def do_POST(self):
        b = self._body(); p = self.path; S["calls"].append(("POST", p, b))
        st = S["settings"]
        if p == "/v1/projects/zngsgedlsxinbygwmxwn/database/query":
            q = b["query"]; S["sql"].append(q)
            if q.startswith("select data->>'family_app_live' as live"): return self._send(200, [{"live": st["family_app_live"], "ready": st["family_fee_check_ready"], "offers": st["family_offer_live"]}])
            if "jsonb_build_object('family_app_live_clients'" in q:
                lc = json.loads(re.search(r"'(\[.*?\])'::jsonb", q).group(1)); st["live_clients"] = lc; S["lc_history"].append(lc)
                return self._send(201, [{"lc": lc, "live": st["family_app_live"], "ready": st["family_fee_check_ready"], "offers": st["family_offer_live"]}])
            if q.startswith("select status, axiscare_visit_id, error from public.family_bookings"):
                bid = re.search(r"id = '([^']+)'", q).group(1); bk = S["bookings"].get(bid, {}); return self._send(201, [{"status": bk.get("status"), "axiscare_visit_id": bk.get("vid"), "error": bk.get("error")}])
            if q.startswith("select status, error from public.family_bookings"):
                bid = re.search(r"id = '([^']+)'", q).group(1); bk = S["bookings"].get(bid, {}); return self._send(201, [{"status": bk.get("status"), "error": bk.get("error")}])
            if "jsonb_array_elements(data)" in q and "'ops_items'" in q:
                ids = re.findall(r"'(fam_(?:book|cancel)_[^']+)'", q)
                return self._send(201, [{"id": i, "st": S["cards"][i], "title": "Place a caregiver: Test Client 5", "status": S["cards"][i]} for i in ids if i in S["cards"]] if "as id" in q else
                                  [{"st": S["cards"][i], "title": "Place a caregiver: Test Client 5"} for i in ids if i in S["cards"]])
            if q.startswith("select count(*)::int as n from public.family_bookings"): return self._send(201, [{"n": M["passed_test"]}])
            if q.startswith("update public.app_data set data = data || '{\"family_app_live\": true"):
                st["family_app_live"] = "true"; st["live_clients"] = []; return self._send(201, [{"live": "true", "ready": st["family_fee_check_ready"], "offers": st["family_offer_live"]}])
            if q.startswith("update public.app_data set data = data || '{\"family_app_live\": false"):
                st["family_app_live"] = "false"; st["live_clients"] = []; return self._send(201, [{"live": "false"}])
            return self._send(400, {"message": "unexpected: " + q[:80]})
        if p == "/auth/v1/admin/generate_link":
            return self._send(200, {"properties": {"hashed_token": "hh"}}) if M["signin"] else self._send(404, {"msg": "User not found"})
        if p == "/auth/v1/verify": return self._send(200, {"access_token": "eyJfamilytoken"}) if b.get("token_hash") == "hh" and b.get("type") == "magiclink" else self._send(400, {})
        if p == "/functions/v1/family-gateway":
            if self.headers.get("Authorization") != "Bearer eyJfamilytoken": return self._send(401, {"error": "Please sign in again."})
            a = b.get("action"); live = st["family_app_live"] == "true" or "290" in st["live_clients"]
            if a == "me": return self._send(200, {"name": "Samantha (test login)", "clients": [{"id": "290", "name": "Test Client 5", "can_book": True}]})
            if a == "home": return self._send(200, {"client": {"id": "290", "state": M["state"]}, "visits": [dict(v) for v in S["visits"]]})
            if a == "book":
                bid = f"bk{len(S['bookings']) + 1}"
                if not live: S["bookings"][bid] = {"status": "practice"}; return self._send(200, {"ok": True, "booking_id": bid, "status": "practice"})
                if M["axis_refuse"]: S["bookings"][bid] = {"status": "needs_office", "error": "AxisCare said no (service)"}; return self._send(200, {"ok": True, "booking_id": bid, "status": "needs_office"})
                S["visits"].append({"id": "v9", "date": b["date"], "start": b["start"], "end": b["end"], "caregiver": None})
                S["bookings"][bid] = {"status": "waiting_for_caregiver", "vid": "v9"}; S["cards"][f"fam_book_{bid}"] = "open"
                return self._send(200, {"ok": True, "booking_id": bid, "status": "waiting_for_caregiver"})
            if a == "cancel":
                bk = S["bookings"][b["booking_id"]]
                if M["cancel_fail"]: bk.update(status="cancelled", error="AxisCare remove refused"); S["cards"][f"fam_cancel_{b['booking_id']}"] = "open"
                else: S["visits"] = [v for v in S["visits"] if v["id"] != bk.get("vid")]; bk["status"] = "cancelled"
                if f"fam_book_{b['booking_id']}" in S["cards"]: S["cards"][f"fam_book_{b['booking_id']}"] = "done"
                return self._send(200, {"ok": True, "late": False, "message": "Cancelled. Nothing is charged for it."})
        self._send(404, {})
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_address[1]}"
TMP = tempfile.mkdtemp(prefix="t840-"); BIN = os.path.join(TMP, "supabase")
FILES = ["supabase/functions/family-gateway/index.ts", "supabase/functions/_shared/family-app.ts", "supabase/functions/_shared/family-signin.ts"]
PINS = {f: sha(os.path.join(HERE, f)) for f in FILES}
def run(script, mode="", pins=PINS, **m):
    reset(**m); rep = os.path.join(TMP, "r.txt")
    if os.path.exists(rep): os.remove(rep)
    open(BIN, "w").write("#!/bin/sh\nexit %d\n" % (1 if M["deploy_fail"] else 0)); os.chmod(BIN, 0o755)
    env = dict(os.environ, SB_TOKEN="sbp_test", SB_REPORT=rep, SB_API_BASE=URL, SB_FN_BASE=URL, SB_FAM_BASE=URL, SB_SUPA_CLI=BIN, SB_REPO=HERE,
               SB_PINS=json.dumps(pins), SB_SETTLE="0", SB_TODAY="2026-10-16", SB_MODE=mode)
    p = subprocess.run(["python3", os.path.join(HERE, script)], env=env, capture_output=True, text=True, timeout=60)
    return p.returncode, (open(rep).read() if os.path.exists(rep) else p.stdout + p.stderr)
T840, T841 = "family_app_live_test_840.py", "family_app_go_live_841.py"
books = lambda: [c[2] for c in S["calls"] if c[0] == "POST" and c[1] == "/functions/v1/family-gateway" and c[2].get("action") == "book"]

c, out = run(T840)
ck("840-1 good run: PASSED, every step ticked", c == 0 and "840: PASSED" in out and "✗" not in out and out.count("✓") >= 11, out)
ck("840-1b ONLY #290 made live, then back to practice; the app switch never touched", S["lc_history"] == [["290"], []] and S["settings"]["family_app_live"] == "false", S["lc_history"])
bk = books()[0] if books() else {}
ck("840-1c books a weekday 8+ days out (2026-10-26, a Monday), 10 to 12, marked as a test", bk.get("date") == "2026-10-26" and bk.get("start") == "10:00" and bk.get("end") == "12:00" and "Live test by 840" in bk.get("note", ""), bk)
ck("840-1d no email sent (sign-in made on the server), no keys printed", not any("/otp" in str(x[1]) or "/invite" in str(x[1]) for x in S["calls"]) and not re.search(r"eyJ\w|sbp_test", out), out)
ck("840-1e family door deployed before going live", S["sql"].index(next(q for q in S["sql"] if "family_app_live_clients" in q)) >= 0)
c, out = run(T840, axis_refuse=True)
ck("840-2 AxisCare refuses the visit: NOT PASSED, still cancelled + back to practice", c == 1 and "AxisCare didn't take the visit" in out and S["lc_history"][-1] == [] and S["bookings"]["bk1"]["status"] == "cancelled", out)
c, out = run(T840, cancel_fail=True)
ck("840-3 AxisCare won't remove it: NOT PASSED, tells her which visit to delete, back to practice", c == 1 and "Please delete Test Client 5's 2026-10-26 10:00 visit" in out and S["lc_history"][-1] == [], out)
c, out = run(T840, state=None)
ck("840-4 Test Client 5 has no Missouri address: says how to fix, books nothing, back to practice", c == 1 and "Missouri residential address" in out and not books() and S["lc_history"][-1] == [], out)
c, out = run(T840, signin=False)
ck("840-5 test login missing: asks about 821, books nothing, back to practice", c == 1 and "Was 821 run?" in out and not books() and S["lc_history"][-1] == [], out)
c, out = run(T840, settings={"family_offer_live": "true"})
ck("840-6 caregiver offers ON: stops before anything (no texts in a test)", c == 2 and not S["lc_history"] and not books(), out)
c, out = run(T840, settings={"family_app_live": "true"})
ck("840-7 already live for everyone: stops, nothing changed", c == 2 and not S["lc_history"], out)
c, out = run(T840, settings={"family_fee_check_ready": "false"})
ck("840-8 fee check not installed: stops, nothing changed", c == 2 and not S["lc_history"], out)
c, out = run(T840, deploy_fail=True)
ck("840-9 family door won't deploy: stops before going live", c == 1 and not S["lc_history"] and not books(), out)
c, out = run(T840, pins={**PINS, FILES[0]: "0" * 64})
ck("840-10 not the reviewed build: stops before anything", c == 2 and not S["calls"], out)
c, out = run(T840, passed_test=0);
c, out = run(T841, passed_test=1)
ck("841-1 after a passed test: live ON, test list emptied, says how to go back", c == 0 and S["settings"]["family_app_live"] == "true" and S["settings"]["live_clients"] == [] and "LIVE BOOKING IS ON" in out and "841b" in out, out)
c, out = run(T841, passed_test=0)
ck("841-2 no passed live test: refuses, nothing changed", c == 2 and S["settings"]["family_app_live"] == "false" and "Run 840 first" in out, out)
c, out = run(T841, passed_test=1, settings={"family_fee_check_ready": "false"})
ck("841-3 fee check not installed: refuses (her rule)", c == 2 and S["settings"]["family_app_live"] == "false", out)
c, out = run(T841, mode="off", settings={"family_app_live": "true"})
ck("841-4 841b turns it back OFF", c == 0 and S["settings"]["family_app_live"] == "false" and "OFF" in out, out)

for n, okk, note in res: print(("  ✓ " if okk else "  ✗ ") + n + ("" if okk else "\n" + note))
print(f"\n  840/841 rehearsal: {sum(1 for r in res if r[1])}/{len(res)} passed")
raise SystemExit(0 if all(r[1] for r in res) else 1)
