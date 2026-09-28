#!/usr/bin/env python3
# K1 · ONE RECORD OF EVERY CALL · install (Desktop 319)
# Part 1 (read only): the SQL and both functions are the reviewed builds; the record is not installed yet (or already
#   is, from an earlier run); each function's gateway setting is read so the redeploy keeps it.
# Part 2: install call-record.sql (one transaction, self-checked); redeploy call-disposition and call-followup.
# Part 3 (read back, status codes only): the record and its door exist and only the server can write; each function
#   still turns away a caller without its token. No call is placed and nothing is written by the check.
import json, os, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys
FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPORT = os.environ["SB_REPORT"]
SQL = os.environ["SB_SQL"]; SQL_SHA = os.environ["SB_SQL_SHA"]; SHARED_SHA = os.environ.get("SB_SHARED_SHA", "")
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
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
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-k1/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return r.status, json.loads(r.read().decode(errors="replace") or "null")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode(errors="replace") or "null")
        except Exception: return e.code, None
    except Exception: return None, None
def sql(q):
    st, out = api("/database/query", "POST", {"query": q}); return st in (200, 201), out
def status(name, token_param):
    req = urllib.request.Request(FNB + f"/functions/v1/{name}?token={token_param}", data=b"{}", method="POST", headers={"Content-Type": "application/json", "User-Agent": "cc-k1/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r: r.read(); return r.status
    except urllib.error.HTTPError as e: return e.code
    except Exception: return None

say("K1 · ONE RECORD OF EVERY CALL · INSTALL"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY")
bad = False
got = hashlib.sha256(open(SQL, "rb").read()).hexdigest()
say(("  ✓ " if got == SQL_SHA else "  ✗ ") + "the call record script is the reviewed build"); bad = bad or got != SQL_SHA
for fn, want in SHAS.items():
    got = hashlib.sha256(open(os.path.join(FNROOT, fn, "index.ts"), "rb").read()).hexdigest()
    say(("  ✓ " if got == want else "  ✗ ") + f"{fn} is the reviewed build"); bad = bad or got != want
if SHARED_SHA:
    got = hashlib.sha256(open(os.path.join(FNROOT, "_shared", "call-record.ts"), "rb").read()).hexdigest()
    say(("  ✓ " if got == SHARED_SHA else "  ✗ ") + "the shared recorder is the reviewed build"); bad = bad or got != SHARED_SHA
if bad: say("  STOP. Nothing was run."); done(2)
ok, r = sql("select to_regclass('public.call_record') is not null as present")
if not ok or not r: say("  ✗ could not read the database. Nothing was changed."); done(4)
present = r[0]["present"]; say("  · the call record is " + ("already installed (an earlier run); it will not be installed again" if present else "not installed yet"))
setting = {}
for fn in SHAS:
    st, meta = api(f"/functions/{fn}")
    if st == 200 and isinstance(meta, dict) and "verify_jwt" in meta: setting[fn] = bool(meta["verify_jwt"])
    say(("  ✓ " if fn in setting else "  ✗ ") + f"{fn}: " + (("gateway sign-in required; kept" if setting[fn] else "called by GoHighLevel without a sign-in (its own token); kept that way") if fn in setting else f"could not read its setting ({st})"))
if len(setting) != len(SHAS): say("  STOP. Nothing was changed."); done(4)

say(); say("PART 2 · CHANGE")
if not present:
    ok, out = sql(open(SQL).read())
    say(("  ✓ " if ok else "  ✗ ") + "the call record is installed (one transaction, self-checked)" + ("" if ok else ": " + str(out)[:240]))
    if not ok: say("  STOP. Nothing changed (the install undid itself); the functions were not touched."); done(5)
for fn in SHAS:
    args = [SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if setting[fn] else ["--no-verify-jwt"])
    p = subprocess.run(args, cwd=os.path.dirname(os.path.dirname(FNROOT)), env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    good = p.returncode == 0; say(("  ✓ " if good else "  ✗ ") + fn + " redeployed" + ("" if good else ": " + (p.stderr or p.stdout)[-300:]))
    if not good: say("  STOP. The record is installed; functions above this line are redeployed, the rest unchanged (calls still route as before)."); done(6)

say(); say("PART 3 · CHECK (read back; status codes only)")
allok = True
ok, r = sql("""select to_regclass('public.call_record') is not null as t,
  to_regprocedure('public.call_record_add(text,text,text,text,text,text,text,text,text,text,text)') is not null as d,
  has_function_privilege('service_role','public.call_record_add(text,text,text,text,text,text,text,text,text,text,text)','execute') as svc,
  not has_function_privilege('authenticated','public.call_record_add(text,text,text,text,text,text,text,text,text,text,text)','execute')
  and not has_function_privilege('anon','public.call_record_add(text,text,text,text,text,text,text,text,text,text,text)','execute') as browsers_out""")
g = r[0] if ok and r else {}
good = all(g.get(k) is True for k in ("t", "d", "svc", "browsers_out")); allok = allok and good
say(("  ✓ " if good else "  ✗ ") + "the record and its door are in place; only our server can write to it")
for fn in SHAS:
    st, meta = api(f"/functions/{fn}"); kept = st == 200 and isinstance(meta, dict) and bool(meta.get("verify_jwt")) == setting[fn]
    s1 = status(fn, "wrong-token")
    ok2 = kept and s1 in (401, 403); allok = allok and ok2
    say(("  ✓ " if ok2 else "  ✗ ") + f"{fn}: gateway setting kept: {'yes' if kept else 'NO'} · a caller without its token is turned away ({s1})")
say()
say("RESULT: " + ("INSTALLED · from the next call, every outcome tapped, every GoHighLevel summary and every AI reading is kept, with who it was with decided by the number (one person or none)."
                  if allok else "CHECK THE ✗ LINES."))
say("Rollback if ever needed: call-record-rollback.sql (only while the record is empty); the functions from the commit before K1.")
done(0 if allok else 7)
