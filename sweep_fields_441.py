#!/usr/bin/env python3
# 441 · SAFE SAVES STEP 4. Samantha approved the safe saves plan 2026-10-04 ("yes to all"; decision 3: take the identity
# backfill down). https://claude.ai/artifact/Y8Kmn4hR7rmWt9keXG6uGd
# The eligibility sweep (switched off today) saved each caregiver's WHOLE record from the copy it read at the start of a
# run, so an office edit made meanwhile was undone. Now it saves only the five fields it owns, on the record as it read
# it, or works them out again on the current record (caregiver_sweep_patch, server only). The identity backfill, a
# one-time tool that rewrote the whole caregiver list, is taken down (its source stays in GitHub to put back for a run).
# Part 1 (read only): the reviewed build (pinned); the live sweep is exactly GitHub's copy before this change (or already
#   this one); the tests pass here. Part 2: sweep_fields.sql; the sweep redeployed (gateway setting kept); the identity
#   backfill taken down (and unscheduled if it had a schedule). Part 3 (proof; nothing written): the live sweep is the
#   reviewed build and refuses the public key; a practice run (its default) reads only; the backfill is gone. Counts only.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil, time
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); REF = "zngsgedlsxinbygwmxwn"
ROOT = os.environ["SB_REPO"]; BASE = os.environ.get("SB_BASE", ""); SHAS = json.loads(os.environ["SB_SHAS"])
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co"); HUB = os.environ.get("SB_HUB_BASE", "https://cc.mo-care.com/")
FN = "eligibility-sweep"; BACKFILL = "identity-backfill"
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for h in HIDE:
        if h: s = s.replace(h, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", s); s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=200, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-441/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            b = r.read(); return r.status, (b if raw else b.decode(errors="replace"))
    except urllib.error.HTTPError as e: return e.code, (b"" if raw else e.read().decode(errors="replace"))
    except Exception as e: return None, (b"" if raw else type(e).__name__)
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def lit(v): return "'" + str(v).replace("'", "''") + "'"
def fmeta(fn):
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
    try: return s, (json.loads(b) if s == 200 else None)
    except Exception: return s, None
def keys():
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_publishable_") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict)}
        got = {k: v for k, v in got.items() if usable(v)}
        if got.get("anon"): return got
    return {}
shab = lambda b: hashlib.sha256(b).hexdigest()
sha = lambda p: shab(open(p, "rb").read())
def git(*a): return subprocess.run(["git", *a], cwd=ROOT, capture_output=True)
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)
pinpath = lambda k: f"supabase/functions/{k}.ts" if k.startswith("_shared/") else f"supabase/functions/{k}/index.ts"
def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", open(path).read()):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
def need():
    s = set(); deps(os.path.join(ROOT, f"supabase/functions/{FN}/index.ts"), s)
    return {os.path.relpath(x, ROOT).replace(os.sep, "/") for x in s}
def live_files():
    tmp = tempfile.mkdtemp(prefix="sw441-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
    d = subprocess.run([SUPA, "functions", "download", FN, "--project-ref", REF, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    live = {}
    for root, _, files in os.walk(tmp):
        for f in files:
            lp = os.path.join(root, f).replace(os.sep, "/")
            if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
    shutil.rmtree(tmp, ignore_errors=True)
    return d.returncode == 0, live
def base_sha(rel):
    b = git("show", f"{BASE}:{rel}")
    return shab(b.stdout) if b.returncode == 0 else None

say("441 · SAFE SAVES STEP 4 (the eligibility sweep; the identity backfill)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
if not BASE or git("cat-file", "-e", BASE + "^{commit}").returncode != 0: bad("the reviewed starting point isn't in this folder's history"); say("  STOP. Nothing was run."); done(2)
changed = set(git("diff", "--name-only", BASE, "HEAD").stdout.decode().split())
pinned = {pinpath(k): v for k, v in SHAS.items()}
for rel, want in list(pinned.items()) + [("sweep_fields.sql", os.environ.get("SB_SQL_SHA", ""))]:
    if rel not in changed or sha(os.path.join(ROOT, rel)) != want: bad(f"{rel.split('functions/')[-1]} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
other = sorted(k for k in need() if k not in pinned and k in changed)
if other: bad(f"other changes merged since the review touch the sweep ({', '.join(other)[:200]}). Ask Claude to refresh 441."); say("  STOP. Nothing was run."); done(2)
say("  ✓ the sweep, its new shared piece and the database change are the reviewed build")
sF, mF = fmeta(FN); vj = (mF or {}).get("verify_jwt")
if sF != 200 or not isinstance(vj, bool): bad("the eligibility sweep isn't there or its gateway setting can't be read. Nothing was changed."); done(3)
okd, live = live_files()
if not okd: bad("couldn't read the live eligibility sweep. Nothing was changed."); done(3)
nd = need()
already = all(k in live and live[k] == sha(os.path.join(ROOT, k)) for k in nd)
isbase = all((k in live and live[k] == base_sha(k)) or (k not in live and base_sha(k) is None and k in pinned) for k in nd)
if not already and not isbase:
    off = sorted(k.split("functions/", 1)[1] for k in nd if live.get(k) not in (base_sha(k), sha(os.path.join(ROOT, k))))
    bad(f"the live eligibility sweep is neither GitHub's copy nor this build ({', '.join(off)[:160]}), so it was NOT changed. Tell Claude."); done(3)
say("  ✓ the live sweep is " + ("already this build" if already else "exactly GitHub's copy before this change"))
ok, st = sql("""select coalesce((select data->>'eligibility_sweep_live' from app_data where key = 'ops_settings'), '') as live,
  (select count(*) from cron.job where command ilike '%eligibility-sweep%')::int as sched, (select count(*) from cron.job where command ilike '%identity-backfill%')::int as bsched""")
if ok and st:
    say(f"  · the sweep's switch is {'ON' if st[0]['live'] == 'true' else 'off'}; {'it has a schedule' if st[0]['sched'] else 'it has no schedule (it runs only when started by hand)'}")
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if NODE:
    for t in ("sweep_patch_test.mjs", "g1_rule_jobs_test.mjs", "g2_approved_rules_test.mjs"):
        p = subprocess.run([NODE, t], cwd=ROOT, capture_output=True, text=True)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0 or re.search(r"^FAIL", p.stdout, re.M): bad(f"{t} failed: {last}"); say("  STOP. Nothing was changed."); done(2)
        say(f"  ✓ {t}: {last.strip()}")
try:
    if os.environ.get("SB_REHEARSAL_SKIP_SQL_TEST") == "1": raise ImportError
    import pgserver  # noqa: F401
    p = subprocess.run([sys.executable, "sweep_fields_sql_test.py"], cwd=ROOT, capture_output=True, text=True, timeout=600)
    last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
    if p.returncode != 0 or re.search(r"^FAIL", p.stdout, re.M): bad(f"sweep_fields_sql_test.py failed: {last}"); say("  STOP. Nothing was changed."); done(2)
    say(f"  ✓ sweep_fields_sql_test.py: {last.strip()} (on a throwaway database on this Mac)")
except ImportError: say("  · the database tests were not re-run here (they passed when built)")
K = keys(); ANON, SERVICE = K.get("anon", ""), K.get("service_role", ""); HIDE += [ANON, SERVICE]
if not ANON or not SERVICE: bad("couldn't read the project's keys. Nothing was changed."); done(3)
sB, _ = fmeta(BACKFILL)
say(f"  · the identity backfill is {'up' if sB == 200 else 'already down'}")

say(); say("PART 2 · CHANGE")
ok, r = sql("begin;\n" + open(os.path.join(ROOT, "sweep_fields.sql")).read() + "\ncommit;")
if not ok: bad("the database change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
say("  ✓ the sweep's field-only save is in place (server only)")
if already: say("  ✓ the eligibility sweep already had it")
else:
    p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api"] + ([] if vj else ["--no-verify-jwt"]), cwd=ROOT, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    okd, live = live_files()
    if not (okd and all(k in live and live[k] == sha(os.path.join(ROOT, k)) for k in nd)): bad("the eligibility sweep didn't deploy: " + (p.stderr or p.stdout)[-200:]); say("  STOP. Tell Claude."); done(6)
    sN, mN = fmeta(FN)
    if (mN or {}).get("verify_jwt") != vj:
        http("PATCH", f"{API}/v1/projects/{REF}/functions/{FN}", {"verify_jwt": vj}, MG()); sN, mN = fmeta(FN)
    chk((mN or {}).get("verify_jwt") == vj, f"the eligibility sweep deployed, now version {(mN or {}).get('version', '?')} (gateway setting kept {'on' if vj else 'off'})")
if ok and st and st[0]["bsched"]:
    sql("select cron.unschedule(jobid) from cron.job where command ilike '%identity-backfill%'")
    say("  ✓ the identity backfill's schedule is removed")
if sB == 200:
    http("DELETE", f"{API}/v1/projects/{REF}/functions/{BACKFILL}", headers=MG())
sB2, _ = fmeta(BACKFILL)
chk(sB2 == 404, "the identity backfill is taken down (its code stays in GitHub to put back for a one-off run)" + ("" if sB2 == 404 else f" (still there: {sB2})"))

say(); say("PART 3 · PROOF (nothing written)")
okd, live = live_files()
chk(okd and all(k in live and live[k] == sha(os.path.join(ROOT, k)) for k in nd), "the eligibility sweep: the live copy is exactly the reviewed build")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
URL = f"{FNB}/functions/v1/{FN}"
a1 = http("POST", URL, {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
chk(a1 == 401, f"it still refuses the public key ({a1})")
if ok and st and st[0]["live"] == "true":
    say("  · its switch is ON, so the proof does not start a run (it would write). Tell Claude.")
else:
    sD, bD = http("POST", URL, {}, {"apikey": SERVICE, "Authorization": "Bearer " + SERVICE}, 300)
    try: j = json.loads(bD)
    except Exception: j = {}
    g = sD == 200 and str(j.get("mode", "")).startswith("DRY")
    chk(g, "a practice run (reads only): " + (f"{(j.get('would') or {}).get('caregiver_records_written', '?')} caregiver record(s) it would update (only their eligibility fields)" if g else f"didn't answer as expected ({sD}): " + str(j.get('error') or bD)[:160]))
ok3, cz = sql("select count(*)::int as n from cron.job where command ilike '%identity-backfill%'")
chk(ok3 and cz and cz[0]["n"] == 0, "no schedule starts the identity backfill")
say()
say("RESULT: " + ("DONE · the sweep can only ever change its own five fields on a caregiver, and the identity backfill is down." if not fails else "PARTLY DONE · the ✗ lines above need Claude."))
say("Nothing was texted or emailed, nothing was written to AxisCare, and no caregiver record was changed.")
say("Rollback: Claude redeploys the sweep from GitHub's earlier copy, or puts the identity backfill back for a run.")
done(0 if not fails else 8)
