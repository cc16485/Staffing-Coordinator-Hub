#!/usr/bin/env python3
# C2b · NOTES INTO AXISCARE WITH YOUR OWN SIGN-IN · install.
# Part 1 (read only): the reviewed builds; the data access rule and the staff sign-in check exist; not installed yet.
# Part 2: install the append-only AxisCare change record (one transaction, own self-check); deploy axiscare-note.
# Part 3: prove it without sending anything to AxisCare: a browser preflight answers; no sign-in and the Hub's public key
#   are refused (status codes only); the record door writes a line and refuses a bad one, inside a transaction that is
#   always rolled back.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys
MIG = open(os.environ["SB_MIGFILE"], "rb").read(); EXPECTED_SHA = os.environ["SB_EXPECTED_SHA"]
FNROOT = os.environ.get("SB_FNROOT", ""); FN_SHA = os.environ.get("SB_FN_SHA", ""); REPORT = os.environ["SB_REPORT"]
LOCAL = os.environ.get("SB_LOCAL_SOCK"); SKIP_FN = os.environ.get("SB_SKIP_FUNCTION") == "1"
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn"); SUPA = os.environ.get("SB_SUPA_CLI", "")
lines = []
def say(s=""): print(s); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:300]); say("  If this stopped before PART 2, nothing was changed.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def sql(q):
    if LOCAL:
        from pg8000.native import Connection, DatabaseError
        c = Connection(user="postgres", database="postgres", unix_sock=LOCAL)
        try:
            rows = c.run(q); cols = [d["name"] for d in (c.columns or [])]
            return True, [dict(zip(cols, r)) for r in (rows or [])]
        except DatabaseError as e:
            d = e.args[0] if e.args and isinstance(e.args[0], dict) else {}
            return False, str(d.get("M", e))
        finally:
            try: c.close()
            except Exception: pass
    req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{REF}/database/query",
        data=json.dumps({"query": q}).encode(), method="POST",
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-spam-install/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r: return True, json.loads(r.read().decode(errors="replace"))
    except urllib.error.HTTPError as e: return False, "HTTP %s: %s" % (e.code, e.read().decode(errors="replace")[:600])
    except Exception as e: return False, "%s: %s" % (type(e).__name__, e)
def api_get(path):
    req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{REF}{path}", headers={"Authorization": "Bearer " + TOKEN, "User-Agent": "cc-spam-install/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return r.status, json.loads(r.read().decode(errors="replace"))
    except urllib.error.HTTPError as e: return e.code, None
    except Exception: return None, None
def http(method, url, body=None):
    req = urllib.request.Request(url, data=body, method=method,
        headers={"Origin": "https://hub.mo-care.com", "Access-Control-Request-Method": "POST", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r: return r.status, dict(r.headers)
    except urllib.error.HTTPError as e: return e.code, dict(e.headers)
    except Exception as e: return None, {"error": str(e)}

say("C2b · NOTES INTO AXISCARE WITH YOUR OWN SIGN-IN · INSTALL")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC") + ("   (DISPOSABLE TEST TARGET)" if LOCAL else ""))
say(); say("PART 1 · READ ONLY")
sha = hashlib.sha256(MIG).hexdigest()
say("  axiscare-change-log.sql sha256 " + sha + ("  ✓ the proven build" if sha == EXPECTED_SHA else "  ✗ NOT the proven build"))
if sha != EXPECTED_SHA: say("  STOP. Nothing was run."); done(2)
if not SKIP_FN:
    got = hashlib.sha256(open(os.path.join(FNROOT, "axiscare-note", "index.ts"), "rb").read()).hexdigest()
    say("  axiscare-note function sha256 " + got + ("  ✓ the reviewed source" if got == FN_SHA else "  ✗ differs"))
    if got != FN_SHA: say("  STOP. Nothing was run."); done(2)
ok, r = sql("""select to_regprocedure('public.can_access_data_key(text)') is not null as rule, to_regclass('public.axiscare_change_log') is not null as already,
  to_regclass('public.auth_identities') is not null and to_regclass('public.staff_roles') is not null as staff_check""")
if not ok: say("  ✗ STOP: could not read the database: " + str(r)[:300]); done(3)
r = r[0]
checks = [("the data access rule exists", r["rule"]), ("the staff sign-in check's tables exist", r["staff_check"]), ("not installed yet", not r["already"])]
for label, good in checks: say(("  ✓ " if good else "  ✗ ") + label)
if not all(g for _, g in checks): say("  STOP. Nothing was changed."); done(4)
say(); say("PART 2 · INSTALL")
ok, res = sql(MIG.decode())
if not ok: say("  ✗ STOPPED: the install did not complete, nothing changed: " + str(res)[:400]); done(5)
say("  ✓ the AxisCare change record is in, in one transaction; its self-check passed (append-only, one door, no browser can write it)")
fn_ok = True
if SKIP_FN: say("  (test target: function deploy skipped)")
else:
    p = subprocess.run([SUPA, "functions", "deploy", "axiscare-note", "--project-ref", REF, "--use-api"],
                       cwd=os.path.dirname(os.path.dirname(FNROOT)), env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    fn_ok = p.returncode == 0
    say("  axiscare-note deploy: " + ("✓" if fn_ok else "✗ " + (p.stderr or p.stdout)[-400:]))
    if fn_ok:
        url = f"https://{REF}.supabase.co/functions/v1/axiscare-note"
        st, keys = None, None
        try:
            rq = urllib.request.Request(f"https://api.supabase.com/v1/projects/{REF}/api-keys?reveal=true", headers={"Authorization": "Bearer " + TOKEN, "User-Agent": "cc-c2b/1.0"})
            with urllib.request.urlopen(rq, timeout=60) as rr: keys = json.loads(rr.read().decode())
        except Exception: keys = []
        if isinstance(keys, dict): keys = keys.get("keys") or []
        anon = next((str(k.get("api_key") or "") for k in keys if isinstance(k, dict) and k.get("name") == "anon"), "")
        s1, h1 = http("OPTIONS", url); s2, _ = http("POST", url, b'{"action":"client_note"}')
        s3 = None
        if anon:
            q = urllib.request.Request(url, data=b'{"action":"client_note","axiscare_client_id":"0","note":"x"}', method="POST",
                                       headers={"apikey": anon, "Authorization": "Bearer " + anon, "Content-Type": "application/json"})
            try:
                with urllib.request.urlopen(q, timeout=60) as rr: rr.read(); s3 = rr.status
            except urllib.error.HTTPError as e: s3 = e.code
            except Exception: s3 = None
        cors = s1 == 200 and any(k.lower() == "access-control-allow-origin" for k in h1)
        say("    browser check: " + ("✓ OPTIONS answers with CORS headers" if cors else f"✗ OPTIONS answered {s1}") + " · " + ("✓ no sign-in is refused (" + str(s2) + ")" if s2 in (401, 403) else f"✗ answered {s2}")
            + " · " + ("✓ the Hub's public key is refused (" + str(s3) + ")" if s3 in (401, 403) else f"✗ public key answered {s3}"))
        fn_ok = cors and s2 in (401, 403) and s3 in (401, 403)
say(); say("PART 3 · LIVE PROOF OF THE RECORD (inside a transaction that is always rolled back; nothing is sent to AxisCare)")
PROOF = """do $p$ declare a jsonb; b jsonb; n int; begin
  a := public.axiscare_change_record('client_note','client','1',null,'sent','install proof, 0 characters',null,'install-proof','axiscare-note');
  b := public.axiscare_change_record('client_note','client','Ruth',null,'sent','x',null,'install-proof','axiscare-note');
  select count(*) into n from public.axiscare_change_log where by_who = 'install-proof';
  raise exception 'C2B_PROOF good=% bad=% lines=%', a->>'outcome', b->>'outcome', n;
end $p$;"""
ok, res = sql(PROOF)
m = re.search(r"C2B_PROOF good=(\w+) bad=(\w+) lines=(\d+)", str(res))
proof = bool(m) and m.groups() == ("recorded", "refused", "1")
say("  " + ("✓ a line was recorded, a line naming a client instead of an AxisCare number was refused (then undone)" if proof else "✗ " + str(res)[:300]))
ok, z = sql("select (select count(*) from public.axiscare_change_log) n")
clean = ok and z and z[0]["n"] == 0
say("  " + ("✓ nothing was left behind (the record is empty)" if clean else "✗ something remained: " + json.dumps(z, default=str)))
say()
allok = proof and clean and fn_ok
say("RESULT: " + ("INSTALLED · notes can go to AxisCare with each person's own sign-in, and every one is recorded. The Hub updates can go live next." if allok
                 else "CHECK THE ✗ LINES. axiscare-change-log-rollback.sql removes the record while it is empty."))
done(0 if allok else 6)
