#!/usr/bin/env python3
# K3 · CALLS NOBODY COULD MATCH · install (Desktop 320)
# Part 1 (read only): the SQL and the new call-place function are the reviewed builds; the call record (K1) is installed.
# Part 2: install call-place.sql (one transaction, self-checked); deploy call-place (gateway sign-in on).
# Part 3 (read back, status codes only): the placement record and its door exist and only our server can write; the
#   function answers a browser and turns away a caller with no sign-in. Nothing is placed by the check.
import json, os, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys
FNROOT = os.environ["SB_FNROOT"]; FN_SHA = os.environ["SB_FN_SHA"]; REPORT = os.environ["SB_REPORT"]
SQL = os.environ["SB_SQL"]; SQL_SHA = os.environ["SB_SQL_SHA"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FN = "call-place"
lines = []
def say(s=""): print(s); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:300]); say("  Anything done above stays done; nothing after it ran.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def api(path, method="GET", body=None):
    req = urllib.request.Request(API + f"/v1/projects/{REF}" + path, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-k3/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return r.status, json.loads(r.read().decode(errors="replace") or "null")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode(errors="replace") or "null")
        except Exception: return e.code, None
    except Exception: return None, None
def sql(q):
    st, out = api("/database/query", "POST", {"query": q}); return st in (200, 201), out
def call(method, headers=None):
    req = urllib.request.Request(FNB + f"/functions/v1/{FN}", data=b"{}" if method == "POST" else None, method=method,
        headers=dict({"Content-Type": "application/json", "Origin": "https://cc.mo-care.com", "Access-Control-Request-Method": "POST", "User-Agent": "cc-k3/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=60) as r: r.read(); return r.status
    except urllib.error.HTTPError as e: return e.code
    except Exception: return None

say("K3 · CALLS NOBODY COULD MATCH · INSTALL"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY")
bad = False
got = hashlib.sha256(open(SQL, "rb").read()).hexdigest(); say(("  ✓ " if got == SQL_SHA else "  ✗ ") + "the placement script is the reviewed build"); bad = bad or got != SQL_SHA
got = hashlib.sha256(open(os.path.join(FNROOT, FN, "index.ts"), "rb").read()).hexdigest(); say(("  ✓ " if got == FN_SHA else "  ✗ ") + "call-place is the reviewed build"); bad = bad or got != FN_SHA
if bad: say("  STOP. Nothing was run."); done(2)
ok, r = sql("select to_regclass('public.call_record') is not null as k1, to_regclass('public.call_placement') is not null as k3")
if not ok or not r: say("  ✗ could not read the database. Nothing was changed."); done(4)
if not r[0]["k1"]: say("  ✗ the call record (K1, Desktop 319) is not installed. Nothing was changed."); done(4)
present = r[0]["k3"]; say("  ✓ the call record (K1) is installed · the placement record is " + ("already installed (an earlier run)" if present else "not installed yet"))

say(); say("PART 2 · CHANGE")
if not present:
    ok, out = sql(open(SQL).read())
    say(("  ✓ " if ok else "  ✗ ") + "the placement record is installed (one transaction, self-checked)" + ("" if ok else ": " + str(out)[:240]))
    if not ok: say("  STOP. Nothing changed (the install undid itself)."); done(5)
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api"], cwd=os.path.dirname(os.path.dirname(FNROOT)),
                   env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
good = p.returncode == 0; say(("  ✓ " if good else "  ✗ ") + "call-place deployed (gateway sign-in on)" + ("" if good else ": " + (p.stderr or p.stdout)[-300:]))
if not good: say("  STOP. The placement record is installed; the Hub's list stays hidden until the function is deployed."); done(6)

say(); say("PART 3 · CHECK (read back; status codes only)")
allok = True
ok, r = sql("""select to_regclass('public.call_placement') is not null as t,
  has_function_privilege('service_role','public.call_record_place(bigint[],text,text,uuid,text,text,text)','execute') as svc,
  not has_function_privilege('authenticated','public.call_record_place(bigint[],text,text,uuid,text,text,text)','execute')
  and not has_function_privilege('anon','public.call_record_place(bigint[],text,text,uuid,text,text,text)','execute') as browsers_out""")
g = r[0] if ok and r else {}
good = all(g.get(k) is True for k in ("t", "svc", "browsers_out")); allok = allok and good
say(("  ✓ " if good else "  ✗ ") + "the placement record and its door are in place; only our server can place a call")
st, meta = api(f"/functions/{FN}"); jwt = st == 200 and isinstance(meta, dict) and meta.get("verify_jwt") is True
s0 = call("OPTIONS"); s1 = call("POST")
ok2 = jwt and s0 == 200 and s1 == 401; allok = allok and ok2
say(("  ✓ " if ok2 else "  ✗ ") + f"call-place: gateway sign-in on: {'yes' if jwt else 'NO'} · a browser is answered ({s0}) · no sign-in turned away ({s1})")
say()
say("RESULT: " + ("INSTALLED · office staff can say who an unmatched call was with; it joins that profile, marked with who placed it." if allok else "CHECK THE ✗ LINES."))
say("Rollback if ever needed: call-place-rollback.sql (only while nothing has been placed); delete the call-place function.")
done(0 if allok else 7)
