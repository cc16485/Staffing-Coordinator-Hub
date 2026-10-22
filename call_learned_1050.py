#!/usr/bin/env python3
# 1050 · LEARNED ON THIS CALL, STEP 1 (PRACTICE). Samantha 2026-10-22: "dont lose any info"; approved mockup
#   https://claude.ai/artifact/BapTUgrqCvdYjjjvgFRDDR, her yes to all 5 decisions and "Build step 1 in practice".
#   Part 1 (read only): reviewed builds, tests, secrets, counts. Part 2: call_learned_1050.sql; ops_settings call_learn_since
#   (3 days back) + call_learn_live false, only if missing; deploy call-learn (new); every-5-minutes schedule, two minutes
#   after the call recorder. Part 3: refusals, the schedule gets in, one call read as proof, no lead changed.
#   PRACTICE: the Hub shows the box to owners only, adding off. Counts only. Never texts or emails anyone.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil, time
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
HUB_REF = "zngsgedlsxinbygwmxwn"
HUB = os.environ["SB_REPO"]; HUB_BASE = os.environ.get("SB_BASE", "")
HUB_SHAS = json.loads(os.environ["SB_SHAS"])
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB_REF}.supabase.co")
POLL = float(os.environ.get("SB_POLL", "2")); POLL_MAX = float(os.environ.get("SB_POLL_MAX", "40"))
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-1050/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            b = r.read(); return r.status, (b if raw else b.decode(errors="replace"))
    except urllib.error.HTTPError as e: return e.code, (b"" if raw else e.read().decode(errors="replace"))
    except Exception as e: return None, (b"" if raw else type(e).__name__)
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{HUB_REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def fmeta(ref, fn):
    s, b = http("GET", f"{API}/v1/projects/{ref}/functions/{fn}", headers=MG())
    try: return s, (json.loads(b) if s == 200 else None)
    except Exception: return s, None
def secrets(ref):
    s, b = http("GET", f"{API}/v1/projects/{ref}/secrets", headers=MG())
    try: return {x.get("name") for x in json.loads(b)} if s == 200 else set()
    except Exception: return set()
def keys(ref):
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_publishable_") or v.startswith("sb_secret_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{ref}/api-keys{q}", headers=MG())
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
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)
pinpath = lambda k: f"supabase/functions/{k}.ts" if k.startswith("_shared/") else f"supabase/functions/{k}/index.ts"
def git(root, *a): return subprocess.run(["git", *a], cwd=root, capture_output=True)
def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", open(path).read()):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
def need(root, fn):
    s = set(); deps(os.path.join(root, f"supabase/functions/{fn}/index.ts"), s)
    return {os.path.relpath(x, root).replace(os.sep, "/") for x in s}
def live_files(ref, fn):
    tmp = tempfile.mkdtemp(prefix="cl1050-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
    d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", ref, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    live = {}
    for r, _, files in os.walk(tmp):
        for f in files:
            lp = os.path.join(r, f).replace(os.sep, "/")
            if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
    shutil.rmtree(tmp, ignore_errors=True)
    return d.returncode == 0, live
def base_sha(root, base, rel):
    b = git(root, "show", f"{base}:{rel}")
    return shab(b.stdout) if b.returncode == 0 else None
def reviewed(root, base, shas, label, extra=()):
    if not base or git(root, "cat-file", "-e", base + "^{commit}").returncode != 0: bad(f"the reviewed starting point isn't in the {label} history"); say("  STOP. Nothing was run."); done(2)
    changed = set(git(root, "diff", "--name-only", base, "HEAD").stdout.decode().split())
    for rel, want in [(pinpath(k), v) for k, v in shas.items()] + list(extra):
        if rel not in changed or not os.path.exists(os.path.join(root, rel)) or sha(os.path.join(root, rel)) != want:
            bad(f"{label}: {rel.split('functions/')[-1]} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
    return changed
def state(ref, root, base, fn, pinned):
    """'new' | 'base' | 'this' | 'other' for one live function, with its gateway setting."""
    s, m = fmeta(ref, fn)
    if s == 404: return "new", None
    vj = (m or {}).get("verify_jwt")
    okd, live = live_files(ref, fn)
    if not okd or not isinstance(vj, bool): return "unreadable", vj
    nd = need(root, fn)
    if all(k in live and live[k] == sha(os.path.join(root, k)) for k in nd): return "this", vj
    if all((k in live and live[k] == base_sha(root, base, k)) or (k not in live and base_sha(root, base, k) is None and k in pinned) for k in nd): return "base", vj
    return "other", vj
def deploy(ref, root, fn, vj, label):
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", ref, "--use-api"] + ([] if vj in (True, None) else ["--no-verify-jwt"]), cwd=root, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    okd, live = live_files(ref, fn)
    good = okd and all(k in live and live[k] == sha(os.path.join(root, k)) for k in need(root, fn))
    if not good: bad(f"{label} {fn} didn't deploy: " + (p.stderr or p.stdout)[-200:]); return False
    want = True if vj is None else vj
    sN, mN = fmeta(ref, fn)
    if (mN or {}).get("verify_jwt") != want:
        http("PATCH", f"{API}/v1/projects/{ref}/functions/{fn}", {"verify_jwt": want}, MG()); sN, mN = fmeta(ref, fn)
    chk((mN or {}).get("verify_jwt") == want, f"{label}: {fn} deployed, version {(mN or {}).get('version', '?')} (gateway sign-in check {'on' if want else 'off'})")
    return True
def lit(v): return "'" + str(v).replace("'", "''") + "'"
FN = "call-learn"; JOB = "call-learn"; SCHEDULE = "4-59/5 * * * *"; VAULT_NAME = "hub_job_secret"
SQLF = "call_learned_1050.sql"; SQL_SHA = os.environ.get("SB_SQL_SHA", "")
TESTS = [("call_learn_test.mjs", {}), ("call_learned_1050_test.mjs", "pglite"), ("lead_record_test.mjs", {})]
def command(url, anon):
    return ("select net.http_post(url := " + lit(url) + ", headers := jsonb_build_object('Content-Type', 'application/json', "
            "'Authorization', " + lit("Bearer " + anon) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
            "body := '{}'::jsonb, timeout_milliseconds := 150000);")
def jget(b, k):
    try: return json.loads(b).get(k)
    except Exception: return None
COUNT = """select (select md5(data::text) from public.app_data where key = 'leads') as leads_hash,
  (select count(*) from public.lead_record_seen where mode = 'live' and kind = 'call' and status in ('recorded', 'already') and lead_id is not null and msg_at > now() - interval '3 days')::int as calls,
  (select count(*) from vault.decrypted_secrets where name = 'hub_job_secret')::int as vault"""
LEARNED = "select status, count(*)::int as n from public.call_learned group by status order by status"

say("1050 · LEARNED ON THIS CALL (step 1, practice)"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
if not SQL_SHA or not os.path.exists(os.path.join(HUB, SQLF)) or sha(os.path.join(HUB, SQLF)) != SQL_SHA: bad("the database change is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
reviewed(HUB, HUB_BASE, HUB_SHAS, "the Hub server")
pinned = {pinpath(k) for k in HUB_SHAS}
other = sorted(k for k in need(HUB, FN) if k not in pinned and base_sha(HUB, HUB_BASE, k) != sha(os.path.join(HUB, k)))
if other: bad(f"other changes merged since the review touch {FN} ({', '.join(other)[:200]}). Ask Claude to refresh 1050."); say("  STOP. Nothing was run."); done(2)
say("  ✓ the call reader job and its database change are the reviewed builds")
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
pg = os.environ.get("PGLITE") or os.path.expanduser("~/Claude/Projects/.pglite/node_modules/@electric-sql/pglite/dist/index.js")
if NODE:
    for t, kind in TESTS:
        if kind == "pglite" and not os.path.exists(pg): say(f"  · the test database is not on this Mac, so {t} was not re-run here (it passed when built)"); continue
        p = subprocess.run([NODE, t], cwd=HUB, capture_output=True, text=True, env=dict(os.environ, PGLITE=pg))
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0: bad(f"{t} failed: {last}"); say("  STOP. Nothing was changed."); done(2)
        say(f"  ✓ {t}: {last.strip()}")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
st, vj = state(HUB_REF, HUB, HUB_BASE, FN, pinned)
if st not in ("new", "this"): bad(f"{FN} is already on the server and is not this build ({st}). Nothing was changed. Tell Claude."); done(3)
say(f"  ✓ {FN}: " + {"new": "not on the server yet (new)", "this": "already this build"}[st])
names = secrets(HUB_REF)
if "HUB_JOB_SECRET" not in names or "GHL_LOCATION_ID" not in names or not ({"GHL_TOKEN", "GHL_API_KEY"} & names) or "ANTHROPIC_API_KEY" not in names: bad("the jobs' secret, the GoHighLevel key or the AI key isn't there. Nothing was changed."); done(4)
ok, c0 = sql(COUNT)
if not ok or not c0: bad("couldn't read the leads. Nothing was changed."); done(3)
c0 = c0[0]
if c0["vault"] != 1: bad("the jobs' secret isn't in the database vault. Nothing was changed."); done(4)
say("  ✓ the jobs' secret, the GoHighLevel key and the AI key are there")
say(f"  · {c0['calls']} answered call(s) on leads in the last 3 days for it to read")
K = keys(HUB_REF); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); HIDE += [ANON, SVC]
if not ANON or not SVC: bad("couldn't read the Hub's keys. Nothing was changed."); done(3)

say(); say("PART 2 · CHANGE")
ok, r = sql("begin;\n" + open(os.path.join(HUB, SQLF)).read() + "\ncommit;")
if not ok: bad("the database change didn't go in, and was undone as a whole: " + str(r)[:240]); say("  STOP. Tell Claude."); done(6)
say("  ✓ the record of what each call taught us (call_learned) and its one 'added / wrong' mark are in place")
ok, r = sql("""update public.app_data set data = jsonb_build_object('call_learn_since', to_char((now() - interval '3 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'call_learn_live', false) || data
  where key = 'ops_settings' and jsonb_typeof(data) = 'object' returning data->>'call_learn_since' as since, data->>'call_learn_live' as live""")
if not ok or not r: bad("couldn't set its start date: " + str(r)[:200]); say("  STOP. Tell Claude."); done(6)
say(f"  ✓ it reads calls from {r[0]['since'][:10]} on (the last 3 days, so this week's calls show up) · " + ("LIVE" if r[0]["live"] == "true" else "PRACTICE (owners see the box, nothing can be added)"))
if st != "this" and not deploy(HUB_REF, HUB, FN, True, "Hub"): say("  STOP. Tell Claude."); done(6)
if st == "this": say(f"  ✓ {FN} already had it")
URL = f"{FNB}/functions/v1/{JOB}"
ok, r = sql(f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
ok, r = sql(f"select cron.schedule({lit(JOB)}, {lit(SCHEDULE)}, {lit(command(URL, ANON))}) as id")
ok2, jb = sql(f"select schedule, command from cron.job where jobname = {lit(JOB)}")
chk(ok and ok2 and jb and jb[0]["schedule"] == SCHEDULE and "x-cron-secret" in jb[0]["command"], "its schedule: every 5 minutes, two minutes after the call recorder, carrying the jobs' secret from the vault")

say(); say("PART 3 · PROOF (no lead changes, nothing is sent)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
okd, live = live_files(HUB_REF, FN)
chk(okd and all(k in live and live[k] == sha(os.path.join(HUB, k)) for k in need(HUB, FN)), f"{FN}: the live copy is exactly the reviewed build")
a1 = http("POST", URL + "?auth_check=1", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
chk(a1 == 401, f"it refuses the public key ({a1})")
ok, rq = sql(command(URL + "?auth_check=1", ANON).rstrip(";") + " as id")
got = None; waited = 0.0
while ok and rq and waited <= POLL_MAX:
    ok3, rr = sql(f"select status_code, content from net._http_response where id = {int(rq[0]['id'])}")
    if ok3 and rr: got = rr[0]; break
    time.sleep(POLL); waited += POLL
chk(got and got["status_code"] == 200 and jget(got["content"], "caller") == "cron", "its schedule gets in" + ("" if got else " (no answer)"))
sD, bD = http("POST", URL + "?limit=1", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, 300)
try: j = json.loads(bD)
except Exception: j = {}
if sD == 200 and j.get("ok"):
    if j.get("looked_at"): say(f"  ✓ one call read as proof: read {j.get('read', 0)}, waiting for a transcript {j.get('waiting', 0)}, no transcript {j.get('no_transcript', 0)}, too short {j.get('skipped', 0)}")
    else: say("  ✓ it ran; there was no answered call on a lead to read yet (the schedule picks them up as they come)")
    if j.get("errors"): bad(f"the proof run hit {j['errors']} error(s): {j.get('save_failed') or 'see the lead box'}. Tell Claude.")
else: bad(f"the proof run didn't answer as expected ({sD}): " + str(j.get("error") or bD)[:160])
ok, c1 = sql(COUNT)
chk(ok and c1 and c1[0]["leads_hash"] == c0["leads_hash"], "no lead was changed")
ok, lr = sql(LEARNED)
if ok and lr: say("  · read so far: " + ", ".join(f"{x['status']} {x['n']}" for x in lr))
sC, bC = http("GET", f"{FNB}/rest/v1/call_learned?select=message_id&limit=1", None, {"apikey": ANON, "Authorization": "Bearer " + ANON})
chk(sC != 200 or bC.strip() in ("[]", ""), f"the public can't read what was learned ({sC})")
say()
say("RESULT: " + ("DONE · every 5 minutes each answered call with a lead is read once, and a lead's Overview shows owners \"Learned on this call\" in PRACTICE (nothing can be added). Check a few against the calls, then tell Claude to switch it on." if not fails else "PARTLY DONE · the ✗ lines above need Claude."))
say("Nothing was texted or emailed. No lead was changed.")
say("Rollback: unschedule call-learn (Claude can). What it read stays in call_learned; it changes nothing on its own.")
done(0 if not fails else 8)
