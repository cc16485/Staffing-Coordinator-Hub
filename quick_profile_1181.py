#!/usr/bin/env python3
# 1181 · STAFFING SERVER · QUICK CAREGIVER PROFILE (Samantha, 2026-10-29). Adds 8 empty fields to caregiver_profiles
# (quick_profile_1181.sql), then deploys caregiver-profile only, keeping its gateway setting; stops if the live copy changed
# since the reviewed main. Nothing is texted or emailed by this step.
import json, os, re, subprocess, urllib.request, urllib.error, datetime as dt, sys, hashlib, tempfile, shutil, time
REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); BASE = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
SUPA = os.environ.get("SB_SUPA_CLI", ""); FNROOT = os.environ.get("SB_FNROOT", ""); SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}")); BASEP = json.loads(os.environ.get("SB_BASE_SHAS", "{}"))
ROOT = os.path.dirname(os.path.dirname(FNROOT)) if FNROOT else ""; FNS = ["caregiver-profile"]
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for h in HIDE:
        if h: s = s.replace(h, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=120):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-1181/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
jl = lambda b: (lambda: json.loads(b))() if b and b[:1] in "[{" else {}
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, b[:300]
    try: return True, json.loads(b)
    except Exception: return False, b[:300]
lit = lambda v: "null" if v is None else "'" + str(v).replace("'", "''") + "'"
sha = lambda p_: hashlib.sha256(open(p_, "rb").read()).hexdigest()
def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", open(path).read()):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
def need(fn):
    s = set(); deps(os.path.join(FNROOT, fn, "index.ts"), s)
    return {os.path.relpath(x, ROOT).replace(os.sep, "/") for x in s}
def fmeta(fn):
    s = None
    for i in range(4):
        s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
        if s == 200:
            try: return s, json.loads(b)
            except Exception: pass
        if s == 404: return s, None
        time.sleep(3 * (i + 1))
    return s, None
def live_files(fn):
    for i in range(3):
        tmp = tempfile.mkdtemp(prefix="cc1181-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
        d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
        live = {}
        for r_, _, files in os.walk(tmp):
            for f in files:
                lp = os.path.join(r_, f).replace(os.sep, "/")
                if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
        shutil.rmtree(tmp, ignore_errors=True)
        if d.returncode == 0 and live: return True, live
        time.sleep(3 * (i + 1))
    return False, {}

SQLFILE = "quick_profile_1181.sql"; SQLSHAS = json.loads(os.environ.get("SB_SQL_SHAS", "{}"))
NEWCOLS = ["quick", "quick_answers", "approval_sent_at", "approval_words", "approved_at", "approved_by", "change_request", "change_request_at"]
say("1181 · STAFFING SERVER · QUICK CAREGIVER PROFILE"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for name, want in SHAS.items():
    p_ = os.path.join(FNROOT, name); have_ = sha(p_) if os.path.exists(p_) else "(missing)"
    say(f"  ✓ {name} is the reviewed build") if have_ == want else bad(f"{name} is not the reviewed build: nothing runs")
sq = os.path.join(ROOT, SQLFILE)
say(f"  ✓ {SQLFILE} is the reviewed change") if os.path.exists(sq) and sha(sq) == SQLSHAS.get(SQLFILE) else bad(f"{SQLFILE} is not the reviewed change: nothing runs")
if fails: say(); say("  RESULT: STOPPED before anything changed."); done(2)
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
VJ = {}
for fn in FNS:   # nobody else's unreleased work goes out: live must match the reviewed main, or this build
    sx, mx = fmeta(fn)
    if not (sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool)): bad(f"{fn} could not be read ({sx})"); continue
    VJ[fn] = mx["verify_jwt"]; okd, livef = live_files(fn)
    if not okd: bad(f"{fn}: the live copy could not be downloaded"); continue
    # a live file may be today's main, this build, or any earlier version that was on main (a function deployed before a
    # shared file changed): all reviewed. Only a file that was never on main stops the step.
    okv = lambda k: livef.get(k) == sha(os.path.join(ROOT, k)) or livef.get(k) in (BASEP.get(k) if isinstance(BASEP.get(k), list) else [BASEP.get(k)])
    odd = [k for k in need(fn) if not okv(k)]
    older = [k for k in need(fn) if livef.get(k) != sha(os.path.join(ROOT, k))]
    say(f"  ✓ {fn} (version {mx.get('version', '?')}): the live copy is reviewed code" + (f" (an earlier main version of {', '.join(older)}; this deploy brings it up to date)" if older else " (today's main), so only this change goes out")) if not odd else bad(f"{fn}: the live copy has a file that was never on main ({', '.join(odd)[:200]}); nothing runs")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
ok, r = sql("select count(*)::int as n, count(*) filter (where published)::int as pub, count(*) filter (where self_complete and not published and status <> 'withdrawn')::int as waiting from public.caregiver_profiles")
say(f"  · caregiver profiles now: {r[0]['n']} ({r[0]['pub']} published; {r[0]['waiting']} current caregivers not published yet)") if ok and r else bad("could not count the profiles: " + str(r)[:200])
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
ok, r = sql(open(sq).read())
ok2, cols = sql("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'caregiver_profiles' and column_name in (" + ",".join(lit(c) for c in NEWCOLS) + ")")
have = {c["column_name"] for c in (cols if ok2 and isinstance(cols, list) else [])}
say(f"  ✓ the 8 new fields are on caregiver_profiles (empty for everyone)") if ok and set(NEWCOLS) <= have else bad("the new fields did not all go in: " + (str(r)[:200] if not ok else "missing " + ", ".join(sorted(set(NEWCOLS) - have))))
if fails: say("  RESULT: STOPPED (nothing was deployed). Tell Claude."); done(5)
for fn in FNS:
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if VJ[fn] else ["--no-verify-jwt"]), cwd=ROOT, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    okd, livef = live_files(fn)
    good = p.returncode == 0 and okd and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in need(fn))
    say(f"  ✓ {fn} deployed: the live copy is this reviewed build") if good else bad(f"{fn} did not deploy cleanly: " + (p.stderr or p.stdout)[-200:])
    if fails: say("  RESULT: STOPPED (what deployed above stays). Tell Claude."); done(6)
    sN, mN = fmeta(fn)
    if (mN or {}).get("verify_jwt") != VJ[fn]:
        http("PATCH", f"{API}/v1/projects/{REF}/functions/{fn}", {"verify_jwt": VJ[fn]}, MG()); sN, mN = fmeta(fn)
    say(f"  ✓ {fn}: version {(mN or {}).get('version', '?')}, gateway sign-in check {'on' if VJ[fn] else 'off'} as before") if (mN or {}).get("verify_jwt") == VJ[fn] else bad(f"{fn}: the gateway setting did not come back")
say(); say("PART 3 · PROOF (nothing is texted or emailed)")
s_, b_ = http("POST", f"{BASE}/functions/v1/caregiver-profile", {"action": "mine", "t": "00000000-0000-4000-8000-000000000000"}, {"apikey": "", "Authorization": "Bearer "})
say("  ✓ the live function answers (a made-up link is told it was not found, as it should be)") if s_ == 404 else bad(f"the live function did not answer as expected ({s_})")
ok, r = sql("select count(*) filter (where quick)::int as q, count(*)::int as n from public.caregiver_profiles")
say(f"  ✓ no profile was changed: {r[0]['q']} of {r[0]['n']} are marked quick (0 until the office sends quick links)") if ok and r and r[0]['q'] == 0 else bad("unexpected count of quick profiles: " + str(r)[:200])
say("  · tested before deploying with 31 checks on the real code (the quick link, the answers, Beef it up from the answers, the OK message, Looks good, Change something, They said OK, publishing only the words they OK'd)")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the server side of the quick profile is in. Next: tell Claude \"ran 1181\" so the Hub part is merged. Nothing was texted or emailed by this step.")
done(0)
