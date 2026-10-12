#!/usr/bin/env python3
# 642 · THE NIGHTLY FAMILY CIRCLE SYNC, BACK. Samantha, 2026-10-12: "check the family circles sync", then "yes build it".
#   Found: the nightly sync lived inside identity-backfill (?circles=1). 441 took identity-backfill down on purpose (her
#   safe saves decision 3) and removed its schedule, which WAS this nightly sync: Family Circles have not synced from
#   AxisCare since 2026-10-04, and the "⇄ Sync" button calls a function that is gone.
#   circles-sync (new): ONLY the Family Circle part, moved out unchanged. Its 4am schedule, the owner's key or office staff
#     (the Sync button) may call it. It never sets texting consent, never changes a contact typed in the office, marks
#     (never deletes) people AxisCare no longer lists, gives past clients no new circle, never touches caregiver lists.
#   identity-backfill STAYS down: this step checks that before and after, and never deploys it.
# Part 1 (read only): the reviewed build; the test passes here; circles-sync is new (or this build); identity-backfill is
#   still down; the jobs' secret is there. Part 2: deploy, catch up now, the 4am schedule. Part 3 (proof).
# Prints counts only: no name, number, email, key or secret.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil, time
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
HUB_REF = "zngsgedlsxinbygwmxwn"
HUB = os.environ["SB_REPO"]; HUB_BASE = os.environ.get("SB_BASE", "")
HUB_SHAS = json.loads(os.environ["SB_SHAS"])
FNB = os.environ.get("SB_FN_BASE", f"https://{HUB_REF}.supabase.co")
VAULT_NAME = "hub_job_secret"; SCHEDULE = "0 9 * * *"; FN = "circles-sync"; GONE = "identity-backfill"; JOB = "circles-sync-nightly"
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
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-642/1.0"}, **(headers or {})))
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
    tmp = tempfile.mkdtemp(prefix="cs642-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
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


def jcall(url, key, timeout=290):
    s, b = http("POST", url, {}, {"apikey": key, "Authorization": "Bearer " + key}, timeout)
    try: return s, json.loads(b)
    except Exception: return s, {}

say("642 · THE NIGHTLY FAMILY CIRCLE SYNC, BACK"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
reviewed(HUB, HUB_BASE, HUB_SHAS, "the Hub server")
pinned = {pinpath(k) for k in HUB_SHAS}
other = sorted(k for k in need(HUB, FN) if k not in pinned and base_sha(HUB, HUB_BASE, k) != sha(os.path.join(HUB, k)))
if other: bad(f"other changes merged since the review touch {FN} ({', '.join(other)[:200]}). Ask Claude to refresh 642."); say("  STOP. Nothing was run."); done(2)
say("  ✓ circles-sync is the reviewed build")
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if NODE:
    p = subprocess.run([NODE, "circles_sync_test.mjs"], cwd=HUB, capture_output=True, text=True)
    last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
    if p.returncode != 0 or re.search(r"^FAIL", p.stdout, re.M): bad(f"circles_sync_test.mjs failed: {last}"); say("  STOP. Nothing was changed."); done(2)
    say(f"  ✓ circles_sync_test.mjs: {last.strip()}")
else: say("  · node is not on this Mac, so the test was not re-run here (it passed when built)")
gs, _ = fmeta(HUB_REF, GONE)
if gs != 404: bad(f"identity-backfill is expected to be down (441) but the server answered {gs}. Nothing was changed. Tell Claude."); done(3)
say("  ✓ identity-backfill is still down, as 441 left it (this step never deploys it)")
st, vj = state(HUB_REF, HUB, HUB_BASE, FN, pinned)
if st not in ("new", "this"): bad(f"a {FN} function already exists and isn't this build ({st}). Nothing was changed. Tell Claude."); done(3)
say(f"  ✓ {FN}: " + ("is new" if st == "new" else "already this build"))
hs = secrets(HUB_REF)
ok, stt = sql(f"select (select count(*) from vault.decrypted_secrets where name = {lit(VAULT_NAME)})::int as vault, (select count(*) from cron.job where jobname = {lit(JOB)})::int as job")
if not ok or not stt: bad("couldn't read the database. Nothing was changed."); done(3)
if stt[0]["vault"] != 1 or "HUB_JOB_SECRET" not in hs: bad("the jobs' secret isn't there. Nothing was changed."); done(3)
say("  ✓ the jobs' secret is there; the old nightly schedule is " + ("still listed (it will be replaced)" if stt[0]["job"] else "gone, as 441 left it"))
K = keys(HUB_REF); ANON, SERVICE = K.get("anon", ""), K.get("service_role", ""); HIDE += [ANON, SERVICE]
if not ANON or not SERVICE: bad("couldn't read the Hub's keys. Nothing was changed."); done(3)
HB = "select e->>'at' as at from app_data, jsonb_array_elements(case when jsonb_typeof(data) = 'array' then data else '[]'::jsonb end) e where key = 'automation_heartbeats' and e->>'id' = 'hb_circles-sync'"
ok, h0 = sql(HB)
say("  · the last Family Circle sync on record: " + ((h0[0]["at"] or "")[:16].replace("T", " ") + " UTC" if ok and h0 else "none"))

say(); say("PART 2 · CHANGE")
if st == "this": say(f"  ✓ {FN} already had it")
elif not deploy(HUB_REF, HUB, FN, True, "Hub"): say("  STOP. Tell Claude."); done(6)
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
URL = f"{FNB}/functions/v1/{FN}"
sC, j = jcall(URL, SERVICE)
if sC == 200 and j.get("ok") is True:
    say(f"  ✓ caught up now: {j.get('clients', '?')} clients looked at ({j.get('skipped_past', 0)} past, left alone)")
    say(f"    {j.get('circles_created', 0)} new circle(s), {j.get('contacts_added', 0)} family member(s) added, {j.get('contacts_updated', 0)} updated from AxisCare, "
        f"{j.get('contacts_marked_removed', 0)} no longer on AxisCare's list (kept, marked), {j.get('manual_untouched', 0)} typed in the office (untouched)")
    if j.get("waiting_for_person_link"): say(f"  · {j['waiting_for_person_link']} circle(s) are waiting for a person to link them to their client (as before)")
else: bad(f"the catch-up didn't answer as expected ({sC}): " + str(j.get("error") or j)[:200])
sql(f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
ok, r = sql(f"select cron.schedule({lit(JOB)}, {lit(SCHEDULE)}, {lit(command(URL, ANON))}) as id")
ok2, jb = sql(f"select schedule, command from cron.job where jobname = {lit(JOB)}")
chk(ok and ok2 and jb and jb[0]["schedule"] == SCHEDULE and "x-cron-secret" in jb[0]["command"] and "vault.decrypted_secrets" in jb[0]["command"] and "/functions/v1/circles-sync" in jb[0]["command"],
    "the nightly sync: 4am Central every night, carrying the jobs' secret from the vault")

say(); say("PART 3 · PROOF")
okd, live = live_files(HUB_REF, FN)
chk(okd and all(k in live and live[k] == sha(os.path.join(HUB, k)) for k in need(HUB, FN)), f"{FN}: the live copy is exactly the reviewed build")
d1 = http("POST", URL, {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
chk(d1 in (401, 403), f"it refuses the public key ({d1})")
c1 = http("OPTIONS", URL, None, {"Origin": "https://cc.mo-care.com", "Access-Control-Request-Method": "POST"})[0]
chk(c1 == 200, f"the Sync button can reach it ({c1})")
ok, rq = sql(command(URL + "?auth_check=1", ANON).rstrip(";") + " as id")
got = None; waited = 0.0
while ok and rq and waited <= POLL_MAX:
    ok3, rr = sql(f"select status_code, content from net._http_response where id = {int(rq[0]['id'])}")
    if ok3 and rr: got = rr[0]; break
    time.sleep(POLL); waited += POLL
chk(got and got["status_code"] == 200 and jget(got["content"], "caller") == "cron", "its schedule gets in" + ("" if got and got["status_code"] == 200 else f" ({got['status_code'] if got else 'no answer'})"))
sD, j2 = jcall(URL + "?dry=1", SERVICE)
chk(sD == 200 and j2.get("contacts_added") == 0 and j2.get("circles_created") == 0, f"a second look finds nothing new ({j2.get('contacts_added', '?')} to add)")
ok, h1 = sql(HB)
chk(ok and h1 and h1[0]["at"] and (not h0 or h1[0]["at"] > (h0[0]["at"] or "")), "the Hub's 'last synced' line has a fresh run to show")
chk(fmeta(HUB_REF, GONE)[0] == 404, "identity-backfill is still down")
say()
say("RESULT: " + ("DONE · Family Circles are caught up and sync every night at 4am again. The Sync button works once Claude merges the Hub side." if not fails else "PARTLY DONE · the ✗ lines above need Claude."))
say("Nothing was texted or emailed. No texting consent was set; no contact typed in the office was changed; nobody was deleted.")
say("Rollback: Claude unschedules circles-sync-nightly.")
done(0 if not fails else 8)
