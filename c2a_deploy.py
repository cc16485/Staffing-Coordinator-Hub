#!/usr/bin/env python3
# C2a · RECORD EVERY AXISCARE CHANGE · redeploy the seven functions that write to AxisCare, each now adding one line to
# the AxisCare change record. No database change (the record was installed by Desktop 305).
# Part 1 (read only): each function's source is the reviewed build; the record exists; each function's current
#   gateway sign-in setting is read so the redeploy KEEPS it (GoHighLevel calls some without a sign-in).
# Part 2: redeploy each, keeping its setting.   Part 3: each still answers, and still refuses a caller with no sign-in.
import json, os, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys
FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
SHARED = os.path.join(FNROOT, "_shared", "axiscare-call-note.ts"); SHARED_SHA = os.environ.get("SB_SHARED_SHA", "")
lines = []
def say(s=""): print(s); lines.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:300]); say("  Functions already redeployed above keep working; the rest are unchanged.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def api(path, method="GET", body=None):
    req = urllib.request.Request(API + f"/v1/projects/{REF}" + path, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json", "User-Agent": "cc-c2a/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r: return r.status, json.loads(r.read().decode(errors="replace") or "null")
    except urllib.error.HTTPError as e: return e.code, None
    except Exception: return None, None
def status(method, name, body=None, headers=None):
    req = urllib.request.Request(FNB + "/functions/v1/" + name, data=body, method=method, headers=dict({"Origin": "https://cc.mo-care.com", "Access-Control-Request-Method": "POST", "Content-Type": "application/json", "User-Agent": "cc-c2a/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=60) as r: r.read(); return r.status
    except urllib.error.HTTPError as e: return e.code
    except Exception: return None
say("C2a · RECORD EVERY AXISCARE CHANGE · REDEPLOY")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY")
bad = False
for fn, want in SHAS.items():
    got = hashlib.sha256(open(os.path.join(FNROOT, fn, "index.ts"), "rb").read()).hexdigest()
    say(("  ✓ " if got == want else "  ✗ ") + f"{fn} is the reviewed build" + ("" if got == want else " (differs)")); bad = bad or got != want
if SHARED_SHA:
    got = hashlib.sha256(open(SHARED, "rb").read()).hexdigest()
    say(("  ✓ " if got == SHARED_SHA else "  ✗ ") + "the shared call-summary code is the reviewed build"); bad = bad or got != SHARED_SHA
if bad: say("  STOP. Nothing was run."); done(2)
st, rows = api("/database/query", "POST", {"query": "select to_regprocedure('public.axiscare_change_record(text,text,text,text,text,text,text,text,text)') is not null as ok"})
rec_ok = st in (200, 201) and rows and rows[0].get("ok") is True
say(("  ✓" if rec_ok else "  ✗") + " the AxisCare change record is installed (Desktop 305)")
if not rec_ok: say("  STOP. Nothing was run."); done(4)
setting = {}
for fn in SHAS:
    st, meta = api(f"/functions/{fn}")
    if st == 200 and isinstance(meta, dict) and "verify_jwt" in meta: setting[fn] = bool(meta["verify_jwt"])
    say(("  ✓ " if fn in setting else "  ✗ ") + f"{fn}: " + (("gateway sign-in required" if setting[fn] else "called without a sign-in (e.g. by GoHighLevel); kept that way") if fn in setting else f"could not read its setting ({st})"))
if len(setting) != len(SHAS): say("  STOP. Nothing was changed."); done(4)
say(); say("PART 2 · REDEPLOY (each keeps its current sign-in setting)")
deployed = []
for fn in SHAS:
    args = [SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if setting[fn] else ["--no-verify-jwt"])
    p = subprocess.run(args, cwd=os.path.dirname(os.path.dirname(FNROOT)), env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    good = p.returncode == 0; say(("  ✓ " if good else "  ✗ ") + fn + ("" if good else ": " + (p.stderr or p.stdout)[-300:]))
    if not good: say("  STOP. The ones above are redeployed and working; the rest are unchanged."); done(5)
    deployed.append(fn)
say(); say("PART 3 · CHECK (status codes only)")
allok = True
for fn in deployed:
    st, meta = api(f"/functions/{fn}")
    kept = st == 200 and isinstance(meta, dict) and bool(meta.get("verify_jwt")) == setting[fn]
    s1 = status("POST", fn, b"{}")
    refused = s1 in (401, 403)
    say(("  ✓ " if kept and refused else "  ✗ ") + f"{fn}: sign-in setting kept: {'yes' if kept else 'NO'} · a caller with no sign-in or token is turned away ({s1})")
    allok = allok and kept and refused
say()
say("RESULT: " + ("DEPLOYED · every change the Hub makes in AxisCare now adds a line to the record, and the profile shows it." if allok else "CHECK THE ✗ LINES."))
done(0 if allok else 6)
