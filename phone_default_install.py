#!/usr/bin/env python3
# A NUMBER IS NEVER SAFE TO TEXT BY DEFAULT · install (Desktop 326)
# Part 1 (read only): the SQL and identity-backfill are the reviewed builds; the current default; how many numbers
#   there are by trust and source (counts only); identity-backfill's gateway setting, kept on redeploy.
# Part 2: redeploy identity-backfill (client numbers from AxisCare now say so), THEN phone-default.sql.
# Part 3 (read back): the default is probable; existing numbers unchanged; identity-backfill turns away a caller
#   without the server key. Nothing is texted, synced or written by the check.
import json, os, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys
FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPORT = os.environ["SB_REPORT"]
SQL = os.environ["SB_SQL"]; SQL_SHA = os.environ["SB_SQL_SHA"]; 
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
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-phone/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return r.status, json.loads(r.read().decode(errors="replace") or "null")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read().decode(errors="replace") or "null")
        except Exception: return e.code, None
    except Exception: return None, None
def sql(q):
    st, out = api("/database/query", "POST", {"query": q}); return st in (200, 201), out
def status(name, token_param):
    req = urllib.request.Request(FNB + f"/functions/v1/{name}?token={token_param}", data=b"{}", method="POST", headers={"Content-Type": "application/json", "User-Agent": "cc-phone/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r: r.read(); return r.status
    except urllib.error.HTTPError as e: return e.code
    except Exception: return None

FN = "identity-backfill"
COUNTS = """select confidence, coalesce(source_system, 'not recorded') as src, count(*) as n from public.phone_index group by 1, 2 order by 1, 2"""
DEF = """select column_default as d from information_schema.columns where table_schema = 'public' and table_name = 'phone_index' and column_name = 'confidence'"""
fmt = lambda rows: ", ".join(f"{x['n']} {x['confidence']} from {x['src']}" for x in rows) or "none"
say("A NUMBER IS NEVER SAFE TO TEXT BY DEFAULT"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY")
bad = False
got = hashlib.sha256(open(SQL, "rb").read()).hexdigest()
say(("  ✓ " if got == SQL_SHA else "  ✗ ") + "the change is the reviewed script"); bad = bad or got != SQL_SHA
got = hashlib.sha256(open(os.path.join(FNROOT, FN, "index.ts"), "rb").read()).hexdigest()
say(("  ✓ " if got == SHAS[FN] else "  ✗ ") + f"{FN} is the reviewed build"); bad = bad or got != SHAS[FN]
if bad: say("  STOP. Nothing was run."); done(2)
ok, r = sql(DEF)
if not ok or not r: say("  ✗ could not read the database. Nothing was changed."); done(4)
already = "probable" in str(r[0]["d"])
say("  · the default today: " + ("probable (an earlier run); it will not be changed again" if already else str(r[0]["d"]).split("::")[0] + " (a number saved without a source is treated as safe to text)"))
ok, before = sql(COUNTS)
if not ok: say("  ✗ could not count the numbers. Nothing was changed."); done(4)
say("  · numbers on file: " + fmt(before))
st, meta = api(f"/functions/{FN}")
if not (st == 200 and isinstance(meta, dict) and "verify_jwt" in meta): say(f"  ✗ could not read {FN}'s setting ({st}). Nothing was changed."); done(4)
vj = bool(meta["verify_jwt"]); say(f"  ✓ {FN}: gateway setting read; kept on redeploy")
say(); say("PART 2 · CHANGE")
args = [SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api"] + ([] if vj else ["--no-verify-jwt"])
p = subprocess.run(args, cwd=os.path.dirname(os.path.dirname(FNROOT)), env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
good = p.returncode == 0; say(("  ✓ " if good else "  ✗ ") + f"{FN} redeployed: client numbers from AxisCare now say where they came from" + ("" if good else ": " + (p.stderr or p.stdout)[-300:]))
if not good: say("  STOP. Nothing else was changed."); done(6)
if not already:
    ok, out = sql(open(SQL).read())
    say(("  ✓ " if ok else "  ✗ ") + "the default is changed (one transaction, self-checked)" + ("" if ok else ": " + str(out)[:240]))
    if not ok: say("  STOP. The default is unchanged (the change undid itself); identity-backfill's update is harmless on its own."); done(5)
else: say("  · the default was already probable")
say(); say("PART 3 · CHECK (read back)")
ok, r = sql(DEF); d_ok = ok and r and "probable" in str(r[0]["d"])
say(("  ✓ " if d_ok else "  ✗ ") + "a number saved without saying where it came from is now probable (never texted automatically)")
ok, after = sql(COUNTS); same = ok and after == before
say(("  ✓ " if same else "  ✗ ") + "the numbers already on file are unchanged: " + (fmt(after) if ok else "could not read"))
st, meta = api(f"/functions/{FN}"); kept = st == 200 and isinstance(meta, dict) and bool(meta.get("verify_jwt")) == vj
s1 = status(FN, "none")
f_ok = kept and s1 in (401, 403)
say(("  ✓ " if f_ok else "  ✗ ") + f"{FN}: gateway setting kept: {'yes' if kept else 'NO'} · a caller without the server key is turned away ({s1})")
allok = bool(d_ok and same and f_ok)
say()
say("RESULT: " + ("DONE · trust has to be stated from now on. Nothing that works today changes." if allok else "CHECK THE ✗ LINES."))
say("Rollback if ever needed: phone-default-rollback.sql; identity-backfill from the commit before this one.")
done(0 if allok else 7)
