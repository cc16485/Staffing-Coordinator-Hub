#!/usr/bin/env python3
# 641 · CLIENTS DIRECTORY + THE CLIENT SYNC. Samantha, 2026-10-12: "Clients need to have a directory just like
# caregivers" and "dan has not been pulled over from Axiscare!", then yes to the plan.
#   Why Dan was missing: clients only reached the Hub through Convert or the one-time ?clients=1 run (Desktop 122);
#   nothing ran it again, so anyone added straight into AxisCare after September never arrived.
#   client-sync (new): the client part of identity-backfill, on its own. identity-backfill itself was taken down on
#     purpose by 441 (safe saves decision 3) and STAYS down: this step checks that and never deploys it. client-sync adds
#     each ACTIVE AxisCare client the Hub doesn't have yet. Never re-activates a past client, never creates beside a
#     same-name person, never ends anyone, never touches the caregiver or candidate lists.
#   client-census-report (new): the Clients directory's read of AxisCare (office staff only, read only, no phones).
# Part 1 (read only): the reviewed build; the tests pass here; both functions are new (or this build); identity-backfill is still down;
#   the jobs' secret is there. Part 2: deploy both, catch up now (adds the missing clients), schedule every 6 hours.
#   Part 3 (proof): live copies are the reviewed build; both refuse outsiders; the schedule gets in; a second look adds nobody.
# Prints counts only: no name, number, email, key or secret.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil, time
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
HUB_REF = "zngsgedlsxinbygwmxwn"
HUB = os.environ["SB_REPO"]; HUB_BASE = os.environ.get("SB_BASE", "")
HUB_SHAS = json.loads(os.environ["SB_SHAS"])
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB_REF}.supabase.co")
VAULT_NAME = "hub_job_secret"; SCHEDULE = "17 */6 * * *"; SYNC = "client-sync"; GONE = "identity-backfill"; CENSUS = "client-census-report"; JOB = "client-sync"
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-641/1.0"}, **(headers or {})))
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
    tmp = tempfile.mkdtemp(prefix="cd641-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
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
def jget(b, k):
    try: return json.loads(b).get(k)
    except Exception: return None
def command(url, anon):
    return ("select net.http_post(url := " + lit(url) + ", headers := jsonb_build_object('Content-Type', 'application/json', "
            "'Authorization', " + lit("Bearer " + anon) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
            "body := '{}'::jsonb, timeout_milliseconds := 120000);")


def jcall(url, key, timeout=200):
    s, b = http("POST", url, {}, {"apikey": key, "Authorization": "Bearer " + key}, timeout)
    try: return s, json.loads(b)
    except Exception: return s, {}

say("641 · CLIENTS DIRECTORY + THE CLIENT SYNC"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
reviewed(HUB, HUB_BASE, HUB_SHAS, "the Hub server")
pinned = {pinpath(k) for k in HUB_SHAS}
for fn in (SYNC, CENSUS):
    other = sorted(k for k in need(HUB, fn) if k not in pinned and base_sha(HUB, HUB_BASE, k) != sha(os.path.join(HUB, k)))
    if other: bad(f"other changes merged since the review touch {fn} ({', '.join(other)[:200]}). Ask Claude to refresh 641."); say("  STOP. Nothing was run."); done(2)
say("  ✓ both functions are the reviewed build")
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if NODE:
    for t in ("client_census_test.mjs", "client_sync_test.mjs"):
        p = subprocess.run([NODE, t], cwd=HUB, capture_output=True, text=True)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0 or re.search(r"^FAIL", p.stdout, re.M): bad(f"{t} failed: {last}"); say("  STOP. Nothing was changed."); done(2)
        say(f"  ✓ {t}: {last.strip()}")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
gs, _ = fmeta(HUB_REF, GONE)
if gs != 404: bad(f"identity-backfill is expected to be down (441) but the server answered {gs}. Nothing was changed. Tell Claude."); done(3)
say("  ✓ identity-backfill is still down, as 441 left it (this step never deploys it)")
st1, vj1 = state(HUB_REF, HUB, HUB_BASE, SYNC, pinned)
if st1 not in ("new", "this"): bad(f"a {SYNC} function already exists and isn't this build ({st1}). Nothing was changed. Tell Claude."); done(3)
say(f"  ✓ {SYNC}: " + ("is new" if st1 == "new" else "already this build"))
st2, vj2 = state(HUB_REF, HUB, HUB_BASE, CENSUS, pinned)
if st2 not in ("new", "this"): bad(f"a {CENSUS} function already exists and isn't this build. Nothing was changed. Tell Claude."); done(3)
say(f"  ✓ {CENSUS}: " + ("is new" if st2 == "new" else "already this build"))
hs = secrets(HUB_REF)
ok, stt = sql(f"select (select count(*) from vault.decrypted_secrets where name = {lit(VAULT_NAME)})::int as vault")
if not ok or not stt: bad("couldn't read the database. Nothing was changed."); done(3)
if stt[0]["vault"] != 1 or "HUB_JOB_SECRET" not in hs: bad("the jobs' secret isn't there. Nothing was changed."); done(3)
say("  ✓ the jobs' secret is there")
K = keys(HUB_REF); ANON, SERVICE = K.get("anon", ""), K.get("service_role", ""); HIDE += [ANON, SERVICE]
if not ANON or not SERVICE: bad("couldn't read the Hub's keys. Nothing was changed."); done(3)
CNT = "select (select count(*) from person_role where role = 'client' and status = 'active')::int as a, (select count(*) from person_role where role = 'client')::int as r"
ok, c0 = sql(CNT)
if ok and c0: say(f"  · before: {c0[0]['a']} current client(s) in the Hub")

say(); say("PART 2 · CHANGE")
if st1 == "this": say(f"  ✓ {SYNC} already had it")
elif not deploy(HUB_REF, HUB, SYNC, True, "Hub"): say("  STOP. Tell Claude."); done(6)
if st2 == "this": say(f"  ✓ {CENSUS} already had it")
elif not deploy(HUB_REF, HUB, CENSUS, True, "Hub"): say("  STOP. Tell Claude."); done(6)
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
SYNC_URL = f"{FNB}/functions/v1/{SYNC}"
sC, j = jcall(SYNC_URL, SERVICE)
if sC == 200 and j.get("ok") is True:
    say(f"  ✓ caught up now: {j.get('axiscare_active_clients', '?')} active in AxisCare, {j.get('already_linked', 0)} already in the Hub, {j.get('created', 0)} added")
    if j.get("name_coincidences"): say(f"  · {j['name_coincidences']} share a name with someone already in the Hub, so they were left for a person to connect (they show on the Clients tab as not connected yet)")
    if j.get("past_left_for_a_person"): say(f"  · {j['past_left_for_a_person']} are Active in AxisCare but ended in the Hub; the status review card decides those, not this")
else: bad(f"the catch-up didn't answer as expected ({sC}): " + str(j.get("error") or j)[:200])
sql(f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
ok, r = sql(f"select cron.schedule({lit(JOB)}, {lit(SCHEDULE)}, {lit(command(SYNC_URL, ANON))}) as id")
ok2, jb = sql(f"select schedule, command from cron.job where jobname = {lit(JOB)}")
chk(ok and ok2 and jb and jb[0]["schedule"] == SCHEDULE and "x-cron-secret" in jb[0]["command"] and "vault.decrypted_secrets" in jb[0]["command"] and "/functions/v1/client-sync" in jb[0]["command"],
    "the client sync: every 6 hours, carrying the jobs' secret from the vault")

say(); say("PART 3 · PROOF")
for fn in (SYNC, CENSUS):
    okd, live = live_files(HUB_REF, fn)
    chk(okd and all(k in live and live[k] == sha(os.path.join(HUB, k)) for k in need(HUB, fn)), f"{fn}: the live copy is exactly the reviewed build")
A = {"apikey": ANON, "Authorization": "Bearer " + ANON}
CEN_URL = f"{FNB}/functions/v1/{CENSUS}"
d1 = http("POST", CEN_URL, {}, A)[0]; d2 = http("POST", SYNC_URL, {}, A)[0]
chk(d1 in (401, 403) and d2 == 401, f"both refuse the public key (census {d1}, sync {d2})")
c1 = http("OPTIONS", CEN_URL, None, {"Origin": "https://cc.mo-care.com", "Access-Control-Request-Method": "POST"})[0]
chk(c1 == 200, f"the Clients tab can reach the census ({c1})")
ok, rq = sql(command(SYNC_URL + "?auth_check=1", ANON).rstrip(";") + " as id")
got = None; waited = 0.0
while ok and rq and waited <= POLL_MAX:
    ok3, rr = sql(f"select status_code, content from net._http_response where id = {int(rq[0]['id'])}")
    if ok3 and rr: got = rr[0]; break
    time.sleep(POLL); waited += POLL
chk(got and got["status_code"] == 200 and jget(got["content"], "caller") == "cron", "its schedule gets in" + ("" if got and got["status_code"] == 200 else f" ({got['status_code'] if got else 'no answer'})"))
sD, j2 = jcall(SYNC_URL + "?dry=1", SERVICE)
chk(sD == 200 and j2.get("created") == 0, f"a second look finds nobody missing ({j2.get('created', '?')} to add)")
ok, hb = sql("select count(*)::int as n from app_data, jsonb_array_elements(case when jsonb_typeof(data) = 'array' then data else '[]'::jsonb end) e where key = 'automation_heartbeats' and e->>'id' = 'hb_client-sync'")
chk(ok and hb and hb[0]["n"] == 1, "it left a heartbeat the watchdog can read")
chk(fmeta(HUB_REF, GONE)[0] == 404, "identity-backfill is still down")
ok, c1 = sql(CNT)
if ok and c1 and c0: say(f"  · after: {c1[0]['a']} current client(s) in the Hub (was {c0[0]['a']})")
say()
say("RESULT: " + ("DONE · missing AxisCare clients are in the Hub now, and new ones arrive every 6 hours. The Clients directory goes live when Claude merges the Hub side." if not fails else "PARTLY DONE · the ✗ lines above need Claude."))
say("Nothing was texted or emailed. No past client was made current again; nobody was ended.")
say("Rollback: Claude unschedules client-sync. People it added stay (they are real AxisCare clients).")
done(0 if not fails else 8)
