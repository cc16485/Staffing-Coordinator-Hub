#!/usr/bin/env python3
# J1 (Desktop 341) / J2 (Desktop 342) · SCHEDULED JOBS ANSWER ONLY THEIR SCHEDULE. SB_GROUP = J1 | J2.
# Each job used to run for anyone holding the Hub's public key (three with no key at all). Now it answers only its own
# schedule (the S3 secret kept in the database's vault), the owner's server key, and, where a Hub button uses it,
# active office staff. Samantha approved J1-J3 on 2026-09-29.
# Part 1 (read only, nothing changes): the reviewed builds; the S3 vault secret and pg_net are there; for each job its
#   gateway setting is read (and kept), the LIVE copy is downloaded and compared with GitHub (job_locks_accept.json),
#   and its schedules are found and read. A job whose live copy differs, or whose schedule can't be read exactly, is
#   left completely alone (schedule and code) and reported: nothing is overwritten on a surprise.
# Part 2: per job, its schedules are rebuilt to send the vault secret (same name, time, on/off, address, body,
#   timeout), THEN the job deploys with its gateway setting. The old code ignores the extra header, so the order never
#   breaks a run. J1 also makes the interview-audio keep setting server-only (j1_recordings_setting.sql).
# Part 3 (proof, auth checks only: no job runs, nothing is sent, read or deleted): each job refuses no key, the public
#   key, a wrong schedule secret and a forged server token; accepts the owner's key; each schedule's exact call from the
#   database is accepted as the schedule. J2 also shows the caregiver census schedule's recent answers (codes only).
# Never prints a key, secret, token, name, number or email.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, time, tempfile, shutil, base64
GROUP = os.environ.get("SB_GROUP", "J1"); REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]
SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPO = os.path.dirname(os.path.dirname(FNROOT))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
POLL = float(os.environ.get("SB_POLL", "2")); POLL_MAX = float(os.environ.get("SB_POLL_MAX", "40"))
KEEP = os.environ.get("SB_KEEP_DIR", os.path.expanduser(f"~/Claude/{GROUP.lower()}-live-copies"))
VAULT_NAME = "hub_job_secret"; FN_SECRET = "HUB_JOB_SECRET"
GROUPS = {
    "J1": {"title": "J1 · THE 11 JOBS THAT CONTACT PEOPLE OR DELETE THINGS",
           "fns": ["lead-nurture", "lead-followup", "ghe-reminders", "carematch-watch", "interview-messages", "coverage-run",
                   "timekeeper-watch", "lead-digest", "automation-watchdog", "purge-recordings", "lead-docs-retention"],
           "sql": "j1_recordings_setting.sql"},
    "J1b": {"title": "J1b · GHE REMINDERS (the one job 341 left alone)",
            "fns": ["ghe-reminders"], "sql": None},
    "G1": {"title": "G1 · THE TWO RULE JOBS THAT WEREN'T LOCKED",
           "fns": ["obligations-run", "eligibility-sweep"], "sql": None, "unscheduled": True},
    "G2": {"title": "G2 · THE SERVER RUNS ONLY RULES YOU APPROVED",
           "fns": ["client-start-run", "promise-run", "launch-evidence", "obligations-run", "eligibility-sweep"],
           "sql": "g2_rules_approved.sql", "sql_first": True, "accept": "rules_gate_accept.json",
           "unscheduled": ["obligations-run", "eligibility-sweep"], "after": "Rule jobs locked report.txt",
           "rules": {"client-start-run": ["client-start.js"], "promise-run": ["promise-engine.js"], "launch-evidence": ["launch-evidence.js"],
                     "obligations-run": ["obligations.js", "eligibility-rules.js"], "eligibility-sweep": ["eligibility-rules.js"]}},
    "O1": {"title": "O1 · THREE SENDERS PICK UP THE OFFICE-HOURS FIX",
           "fns": ["reference-chase", "campaign-auto", "applicant-reengage"], "sql": None, "accept": "outreach_redeploy_accept.json",
           "keep_schedules": True, "auth_check": ["reference-chase"]},
    "J2": {"title": "J2 · THE 7 JOBS THAT ONLY UPDATE THE HUB",
           "fns": ["coverage-watch", "client-status-observe", "client-status-review", "launch-evidence", "client-start-run",
                   "promise-run", "caregiver-census-observe"],
           "sql": None},
}
G = GROUPS[GROUP]; FNS = G["fns"]
UNSCHED = set(FNS) if G.get("unscheduled") is True else set(G.get("unscheduled") or [])
HUBROOT = os.environ.get("SB_HUBROOT", ""); SITE = os.environ.get("SB_SITE_BASE", "https://cc.mo-care.com/")
lines = []; fails = []; HIDE = []
def scrub(s):
    s = str(s)
    for v in HIDE:
        if v: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s)
    return re.sub(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}", "(an email)", s)
def say(s=""): s = scrub(s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done (each job above this line is complete); nothing after it ran. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=120):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-joblocks/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, f"HTTP {s}: {b[:200]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def lit(v): return "'" + str(v).replace("'", "''") + "'"
def fmeta(fn):
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MG())
    try: j = json.loads(b) if s == 200 else {}
    except Exception: j = {}
    return j if isinstance(j, dict) else {}
def keys():
    s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MG())
    try: return {k.get("name"): k.get("api_key", "") for k in json.loads(b) if isinstance(k, dict)}
    except Exception: return {}
def jget(b, k):
    try: return json.loads(b).get(k)
    except Exception: return None
sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()

# ── the one way a schedule command is written (used for the schedule itself AND its proof call) ──
def command(url, body, timeout, anon):
    return ("select net.http_post(url := " + lit(url) + ", headers := jsonb_build_object('Content-Type', 'application/json', "
            "'Authorization', " + lit("Bearer " + anon) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
            "body := " + lit(body) + "::jsonb" + (f", timeout_milliseconds := {timeout}" if timeout else "") + ");")
def parse_job(fn, cmd):
    """(url, body, timeout) when the command is exactly one call of this job's address with a literal body; else None."""
    if cmd.count("http_post") != 1: return None
    m = re.search(r"url\s*:=\s*'([^']+)'", cmd)
    if not m: return None
    url = m.group(1); head = f"{FNB}/functions/v1/{fn}"
    if not (url == head or url.startswith(head + "?")): return None
    bm = re.search(r"body\s*:=\s*'((?:[^']|'')*)'\s*::\s*jsonb", cmd)
    if "body" in re.sub(r"'(?:[^']|'')*'", "''", cmd) and not bm: return None
    body = bm.group(1).replace("''", "'") if bm else "{}"
    try: json.loads(body)
    except Exception: return None
    to = re.search(r"timeout_milliseconds\s*:=\s*(\d+)", cmd)
    return url, body, (int(to.group(1)) if to else None)
def with_param(url, p): return url + ("&" if "?" in url else "?") + p

say(G["title"]); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
ACCEPT_PATH = os.path.join(REPO, G.get("accept", "job_locks_accept.json"))
badb = False
for name, want in SHAS.items():
    if name.endswith(".json") or name.endswith(".sql"): path = os.path.join(REPO, name)
    elif name.startswith("_shared/"): path = os.path.join(FNROOT, name + ".ts")
    else: path = os.path.join(FNROOT, name, "index.ts")
    if not os.path.exists(path) or sha(path) != want: bad(f"{name} is not the reviewed build"); badb = True
need = set(FNS) | {"_shared/job-auth", G.get("accept", "job_locks_accept.json")} | ({"_shared/approved-rules"} if G.get("rules") else set()) | ({"_shared/outreach"} if GROUP in ("J1", "J1b") else set()) | ({G["sql"]} if G["sql"] else set())
if badb or not need <= set(SHAS): say("  STOP. Nothing was run."); done(2)
say(f"  ✓ the {len(FNS)} jobs, the shared lock and the comparison list are the reviewed builds")
def j1_clean():
    """341 said DONE; or its only ✗ was ghe-reminders being left alone and 341b (J1b) then said DONE."""
    rd = lambda n: open(os.path.expanduser("~/Desktop/" + n)).read() if os.path.exists(os.path.expanduser("~/Desktop/" + n)) else ""
    j1, j1b = rd("Job locks J1 report.txt"), rd("Job locks J1b report.txt")
    if "RESULT: DONE" in j1: return "341 (J1) finished cleanly"
    xs = [l for l in j1.splitlines() if l.strip().startswith("✗")]
    if j1 and xs and all(l.strip().startswith("✗ ghe-reminders: the live copy is NOT the version on GitHub") for l in xs) \
       and "Left exactly as they were: ghe-reminders." in j1 and "RESULT: DONE" in j1b:
        return "341 (J1) finished with only ghe-reminders left alone, and 341b (J1b) then finished cleanly"
    return None
if GROUP == "J2":
    why = j1_clean()
    if not why: bad("341 (J1) has not finished cleanly on this Mac (its report doesn't say DONE, nor 341 + 341b). Nothing was changed."); done(3)
    say("  ✓ " + why)
if G.get("after"):
    prev = os.path.expanduser("~/Desktop/" + G["after"]); txt = open(prev).read() if os.path.exists(prev) else ""
    if "RESULT: DONE" not in txt: bad("344 has not finished cleanly on this Mac (its report doesn't say DONE). Nothing was changed."); done(3)
    say("  ✓ 344 finished cleanly")
RULE_FPS = {}
if G.get("rules"):
    files = sorted({f for fs in G["rules"].values() for f in fs})
    for f in files:
        lp = os.path.join(HUBROOT, f)
        if not HUBROOT or not os.path.exists(lp): bad(f"{f}: the Hub folder's copy isn't here, so it can't be compared. Nothing was changed."); done(4)
        try:
            req = urllib.request.Request(SITE + f + "?nocache=" + str(int(time.time())), headers={"User-Agent": "cc-rules/1.0", "Cache-Control": "no-cache"})
            with urllib.request.urlopen(req, timeout=60) as r: served = r.read()
        except Exception as e: bad(f"{f}: could not download it from the Hub site ({type(e).__name__}). Nothing was changed."); done(4)
        fs_, fl = hashlib.sha256(served).hexdigest(), sha(lp)
        if fs_ != fl: bad(f"{f}: what cc.mo-care.com serves right now is NOT the file on GitHub (site {fs_[:12]}, GitHub {fl[:12]}). Nothing was changed: approving it would approve something unreviewed."); done(4)
        RULE_FPS[f] = fs_
    say("  ✓ the Hub site serves exactly GitHub's rules files: " + " · ".join(f"{f} {RULE_FPS[f][:12]}" for f in files))
if GROUP == "J1b":
    j1 = open(os.path.expanduser("~/Desktop/Job locks J1 report.txt")).read() if os.path.exists(os.path.expanduser("~/Desktop/Job locks J1 report.txt")) else ""
    if "Left exactly as they were: ghe-reminders." not in j1: bad("341's report on this Mac doesn't show ghe-reminders left alone, so 341b has nothing to do. Nothing was changed."); done(3)
    say("  ✓ 341 left ghe-reminders alone; this finishes it")
ACC = json.load(open(ACCEPT_PATH))
ok, vx = sql(f"""select (select count(*)::int from vault.decrypted_secrets where name = {lit(VAULT_NAME)}) as v,
                        exists (select 1 from pg_extension where extname = 'pg_net') as n, exists (select 1 from pg_extension where extname = 'pg_cron') as c""")
if not ok or not vx or vx[0]["v"] != 1 or not vx[0]["n"] or not vx[0]["c"]: bad("the schedules' vault secret (S3), pg_net or pg_cron is not there. Nothing was changed."); done(4)
s, b = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
try: names = {x.get("name") for x in json.loads(b)} if s == 200 else set()
except Exception: names = set()
if FN_SECRET not in names: bad("the jobs' secret is not in the function settings (S3). Nothing was changed."); done(4)
say("  ✓ the schedules' secret from S3 is in the vault and the function settings (not shown); pg_net and pg_cron are on")
k = keys(); ANON = k.get("anon", ""); SVC = k.get("service_role", "")
if not ANON or not SVC: bad("could not read the project's keys. Nothing was changed."); done(4)
HIDE += [ANON, SVC]
ok, alljobs = sql("select jobid, jobname, schedule, active, command from cron.job order by jobid")
if not ok: bad("could not read the schedules. Nothing was changed."); done(4)

plan = {}; skipped = []
os.makedirs(KEEP, exist_ok=True)
for fn in FNS:
    why = None; m = fmeta(fn); vj = m.get("verify_jwt")
    if not isinstance(vj, bool): why = "could not read its gateway setting"
    jobs = []
    if not why and G.get("keep_schedules"):   # their schedules are already right (and campaign-auto's uses its own secret): never touched
        for j in alljobs:
            if not re.search(r"/functions/v1/" + re.escape(fn) + r"(?![A-Za-z0-9_-])", j.get("command") or ""): continue
            pj = parse_job(fn, j.get("command") or "")
            jobs.append({"name": j["jobname"], "schedule": j["schedule"], "active": j["active"], "keep": True,
                         **({"url": pj[0], "body": pj[1], "timeout": pj[2]} if pj and "vault.decrypted_secrets where name = 'hub_job_secret'" in (j.get("command") or "") else {"noproof": True})})
    elif not why:
        for j in alljobs:
            c = j.get("command") or ""
            if re.search(r"/functions/v1/" + re.escape(fn) + r"(?![A-Za-z0-9_-])", c):
                p = parse_job(fn, c)
                if not p: why = f"its schedule '{j['jobname']}' is not a single plain call of its address, so it was not touched"; break
                jobs.append({"name": j["jobname"], "schedule": j["schedule"], "active": j["active"], "url": p[0], "body": p[1], "timeout": p[2]})
        if not why and not jobs and fn not in UNSCHED: why = "no schedule calls it (unexpected), so it was not touched"
        if not why and jobs and fn in UNSCHED: why = "a schedule calls it (unexpected: it should only be started by your Desktop scripts), so it was not touched"
    if not why:
        tmp = tempfile.mkdtemp(prefix="jl-live-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
        d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", REF, "--use-api"], cwd=tmp,
                           env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
        if d.returncode != 0: why = "could not download the live copy to compare"
        else:
            live = {}
            for root, _, files in os.walk(tmp):
                for f in files:
                    if f.endswith(".ts"): live[os.path.relpath(os.path.join(root, f), tmp).replace(os.sep, "/")] = os.path.join(root, f)
            want = ACC[fn]["files"]; older = []; diff = []; seen = set()
            for lk, lp in live.items():
                tail = "/".join(lk.split("/")[-2:]); hits = [r for r in want if r.endswith(tail)]
                if len(hits) != 1: diff.append(tail + " (not expected)"); continue
                r = hits[0]; seen.add(r); h = sha(lp)
                if h == want[r]["base"]: continue
                if want[r]["deploy"] and h == want[r]["deploy"]: older.append(r.split("/")[-1]); continue
                diff.append(r)
            for r, w in want.items():   # a file GitHub has but the live copy lacks: fine only if the last deploy didn't have it either
                if r not in seen and not (r.startswith("_shared/") and w["deploy"] is None and r in ACC[fn]["only_at_base"]): diff.append(r + " (not found live)")
            if diff:
                dest = os.path.join(KEEP, fn); shutil.rmtree(dest, ignore_errors=True); shutil.copytree(tmp, dest)
                why = "the live copy is NOT the version on GitHub (" + ", ".join(sorted(set(diff))) + "); kept for Claude at " + dest
            else:
                plan[fn] = {"vj": vj, "version": m.get("version"), "jobs": jobs, "older": sorted(set(older))}
        shutil.rmtree(tmp, ignore_errors=True)
    if why: bad(f"{fn}: {why}. This job is left exactly as it is."); skipped.append(fn); continue
    p = plan[fn]
    say(f"  ✓ {fn}: live copy matches GitHub" + ((" (it is the reviewed Aug 13 GitHub version: its own code without the heartbeat, and the Aug 13 shared helper)" if "index.ts" in p["older"]
        else f" (its {', '.join(p['older'])} is the earlier reviewed copy from its last deploy)") if p["older"] else "")
        + f" · gateway sign-in check {'on' if vj else 'off'} (kept) · " + ("no schedule (started by hand: your Desktop scripts or the Hub)" if not jobs else f"{len(jobs)} schedule{'s' if len(jobs) != 1 else ''}: "
        + "; ".join(f"{j['schedule']}, {'on' if j['active'] else 'paused'}" for j in jobs)))
if GROUP == "J2" and "caregiver-census-observe" in plan:
    ok, cr = sql("""select count(*)::int as n from cron.job_run_details d join cron.job j on j.jobid = d.jobid
                    where j.command like '%/functions/v1/caregiver-census-observe%' and d.start_time > now() - interval '14 days'""")
    ok2, st = sql("""select (select x->>'last_run' from jsonb_array_elements(case when jsonb_typeof(data) = 'array' then data else '[]'::jsonb end) x
                     where x->>'id' = 'state' limit 1) as last_run from app_data where key = 'caregiver_census_state'""")
    say(f"  · caregiver census: its schedule started {cr[0]['n'] if ok and cr else '?'} time(s) in 14 days; its own record of the last run that got in: "
        + ((st[0]['last_run'] or 'none') if ok2 and st else 'unreadable') + " (a run turned away leaves no record)")
if GROUP == "J1":
    ok, rs = sql("""select (select keep_audio_days from public.recordings_settings where id = 1) as days,
                    has_table_privilege('authenticated', 'public.recordings_settings', 'UPDATE') as upd""")
    if not ok or not rs: bad("could not read the interview-audio keep setting. It will not be changed.")
    else: say(f"  · interview audio: kept {rs[0]['days']} days · signed-in accounts can change it: {'yes' if rs[0]['upd'] else 'no'}")
if not plan: bad("no job can be changed safely. Nothing was changed."); done(5)

say(); say("PART 2 · CHANGE")
deployed = []
if G.get("sql_first"):
    ok, _ = sql(open(os.path.join(REPO, G["sql"])).read())
    vals = ", ".join(f"({lit(f)}, {lit(h)}, {lit('G2 first approval: the file cc.mo-care.com served on ' + dt.date.today().isoformat() + ', same as GitHub')})" for f, h in RULE_FPS.items())
    ok2, _ = sql(f"insert into public.rules_approved (file, sha256, note) values {vals} on conflict (file, sha256) do nothing")
    ok3, rv = sql(f"""select (select count(*)::int from public.rules_approved where (file, sha256) in ({', '.join(f'({lit(f)}, {lit(h)})' for f, h in RULE_FPS.items())})) as n,
                      has_table_privilege('anon', 'public.rules_approved', 'SELECT') or has_table_privilege('anon', 'public.rules_approved', 'INSERT')
                      or has_table_privilege('anon', 'public.rules_approved', 'UPDATE') or has_table_privilege('anon', 'public.rules_approved', 'DELETE') as anon_any,
                      has_table_privilege('authenticated', 'public.rules_approved', 'SELECT') or has_table_privilege('authenticated', 'public.rules_approved', 'INSERT')
                      or has_table_privilege('authenticated', 'public.rules_approved', 'UPDATE') or has_table_privilege('authenticated', 'public.rules_approved', 'DELETE') as auth_any""")
    if not (ok and ok2 and ok3 and rv and rv[0]["n"] == len(RULE_FPS) and rv[0]["anon_any"] is False and rv[0]["auth_any"] is False):
        bad("the approved-rules list could not be set up exactly (" + str(rv)[:160] + "). No job was deployed."); done(5)
    say(f"  ✓ the approved-rules list exists, only the server can read or change it, and holds today's {len(RULE_FPS)} files")
for fn in FNS:
    if fn not in plan: continue
    p = plan[fn]; good = True
    for j in [x for x in p["jobs"] if not x.get("keep")]:
        c = command(j["url"], j["body"], j["timeout"], ANON)
        ok, r = sql(f"select cron.schedule({lit(j['name'])}, {lit(j['schedule'])}, {lit(c)}) as id")
        if ok and r and j["active"] is False: sql(f"select cron.alter_job({int(r[0]['id'])}, active := false)")
        ok2, r2 = sql(f"select schedule, active, command from cron.job where jobname = {lit(j['name'])}")
        cc = (r2[0]["command"] or "") if ok2 and r2 else ""
        pj = parse_job(fn, cc) if cc else None
        if not (ok and ok2 and r2 and len(r2) == 1 and r2[0]["schedule"] == j["schedule"] and r2[0]["active"] == j["active"]
                and "x-cron-secret" in cc and "vault.decrypted_secrets" in cc and pj == (j["url"], j["body"], j["timeout"])):
            bad(f"{fn}: its schedule '{j['name']}' could not be updated exactly. The job was NOT deployed (its old code ignores the new header, so nothing is broken)."); good = False; break
    if not good: skipped.append(fn); continue
    d = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if p["vj"] else ["--no-verify-jwt"]),
                       cwd=REPO, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if d.returncode != 0:
        bad(f"{fn}: deploy failed: " + (d.stderr or d.stdout)[-240:]); say("  STOP. Jobs above this line have the lock; the rest run as before. Tell Claude."); done(7)
    after = fmeta(fn)
    if after.get("verify_jwt") != p["vj"]: bad(f"{fn}: its gateway setting changed ({after.get('verify_jwt')}). Tell Claude.")
    deployed.append(fn)
    say(f"  ✓ {fn}: " + ("its schedule left exactly as it was · " if G.get("keep_schedules") and p["jobs"] else f"{len(p['jobs'])} schedule{'s' if len(p['jobs']) != 1 else ''} now send{'s' if len(p['jobs']) == 1 else ''} the secret from the vault (same time and on/off) · " if p["jobs"] else "")
        + f"deployed, now version {after.get('version')} (was {p['version']}), gateway setting kept")
if GROUP == "J1" and G["sql"] and not G.get("sql_first"):
    ok, _ = sql(open(os.path.join(REPO, G["sql"])).read())
    ok2, rs2 = sql("""select (select keep_audio_days from public.recordings_settings where id = 1) as days,
                      has_table_privilege('authenticated', 'public.recordings_settings', 'UPDATE') as upd,
                      has_table_privilege('authenticated', 'public.recordings_settings', 'SELECT') as sel,
                      has_table_privilege('service_role', 'public.recordings_settings', 'UPDATE') as svc,
                      (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'recordings_settings' and cmd <> 'SELECT') as wpol""")
    if ok and ok2 and rs2 and rs2[0]["upd"] is False and rs2[0]["sel"] is True and rs2[0]["svc"] is True and rs2[0]["wpol"] == 0 and (not rs or rs2[0]["days"] == rs[0]["days"]):
        say(f"  ✓ interview audio: only the server can change how long it's kept now (still {rs2[0]['days']} days, unchanged)")
    else: bad("the interview-audio keep setting was not locked as expected: " + str(rs2)[:200])

say(); say("PART 3 · PROOF (checks who may start each job; no job runs, nothing is sent, read or deleted)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
b64 = lambda o: base64.urlsafe_b64encode(json.dumps(o).encode()).decode().rstrip("=")
FORGED = b64({"alg": "HS256", "typ": "JWT"}) + "." + b64({"role": "service_role", "iss": "supabase", "ref": REF}) + "." + "x" * 43
for fn in deployed:
    if G.get("auth_check") is not None and fn not in G["auth_check"]:
        # no auth_check door: an empty call with no key or the public key must be refused before anything runs
        r0 = http("POST", f"{FNB}/functions/v1/{fn}", {}, {})[0]; r1 = http("POST", f"{FNB}/functions/v1/{fn}", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
        good = r0 in (401, 403) and r1 in (401, 403)
        (say if good else bad)(("  ✓ " if good else "") + f"{fn}: no key {r0}, public key {r1} → refused (its schedule's own secret and staff sign-in are unchanged)")
        continue
    U = f"{FNB}/functions/v1/{fn}?auth_check=1"
    r0 = http("POST", U, {}, {})[0]
    r1 = http("POST", U, {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
    r2 = http("POST", U, {}, {"apikey": ANON, "Authorization": "Bearer " + ANON, "x-cron-secret": "x" * 64})[0]
    r3 = http("POST", U, {}, {"apikey": ANON, "Authorization": "Bearer " + FORGED})[0]
    s4, b4 = http("POST", U, {}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
    good = all(x == 401 for x in (r0, r1, r2, r3)) and s4 == 200 and jget(b4, "caller") == "owner"
    (say if good else bad)(("  ✓ " if good else "") + f"{fn}: no key {r0}, public key {r1}, wrong secret {r2}, forged server token {r3} → refused · your server key {s4} → accepted")
    for j in [x for x in plan[fn]["jobs"] if not x.get("noproof")]:
        ok, rq = sql("select " + command(with_param(j["url"], "auth_check=1"), j["body"], None, ANON).replace("select ", "", 1).rstrip(";") + " as id")
        got = None; waited = 0.0
        while ok and rq and waited <= POLL_MAX:
            ok3, rr = sql(f"select status_code, content from net._http_response where id = {int(rq[0]['id'])}")
            if ok3 and rr: got = rr[0]; break
            time.sleep(POLL); waited += POLL
        if got and got["status_code"] == 200 and jget(got["content"], "caller") == "cron": say(f"    ✓ its schedule '{j['name']}': the exact call from the database is accepted as the schedule (check only; nothing ran)")
        else: bad(f"{fn}: its schedule '{j['name']}' was NOT accepted (" + (f"HTTP {got['status_code']}" if got else "no answer") + "). Tell Claude: its next run would be refused.")
    if G.get("rules"):
        s5, b5 = http("POST", f"{FNB}/functions/v1/{fn}?rules_check=1", {}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
        try: rc_ = json.loads(b5)
        except Exception: rc_ = {}
        good = s5 == 200 and rc_.get("all_approved") is True and [x.get("file") for x in rc_.get("rules_check", [])] == G["rules"][fn] \
            and all(RULE_FPS.get(x["file"], "")[:12] == x.get("fingerprint") for x in rc_["rules_check"])
        (say if good else bad)(("    ✓ " if good else "") + f"{fn} runs only approved rules: " + ", ".join(f"{x.get('file')} {x.get('fingerprint')} {'approved' if x.get('approved') else 'NOT approved'}" for x in rc_.get("rules_check", [])) + ("" if good else f" (HTTP {s5})"))
    if fn in UNSCHED:   # it has no schedule, so even the schedules' own secret must not start it
        ok, rq = sql("select " + command(U, "{}", None, ANON).replace("select ", "", 1).rstrip(";") + " as id")
        got = None; waited = 0.0
        while ok and rq and waited <= POLL_MAX:
            ok3, rr = sql(f"select status_code, content from net._http_response where id = {int(rq[0]['id'])}")
            if ok3 and rr: got = rr[0]; break
            time.sleep(POLL); waited += POLL
        if got and got["status_code"] == 401: say("    ✓ even the schedules' secret from the database is refused (it has no schedule; only your key starts it)")
        else: bad(f"{fn}: the schedules' secret was not refused (" + (f"HTTP {got['status_code']}" if got else "no answer") + ")")
# the Hub-button doors
extra = []
if "coverage-run" in deployed:
    a = http("POST", f"{FNB}/functions/v1/coverage-run", {"action": "candidates", "case_id": "none"}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
    f_ = http("POST", f"{FNB}/functions/v1/coverage-run", {"action": "send_selected", "case_id": "none", "recipients": ["x"]}, {"apikey": ANON, "Authorization": "Bearer " + FORGED})[0]
    extra.append(("the coverage picker: the public key and a forged token → refused", a == 401 and f_ == 401, f"{a}, {f_}"))
if "lead-digest" in deployed:
    a = http("GET", f"{FNB}/functions/v1/lead-digest?force=1", None, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
    extra.append(("the morning brief's test send with the public key → refused", a == 401, a))
if "lead-docs-retention" in deployed:
    a = http("GET", f"{FNB}/functions/v1/lead-docs-retention", None, {})[0]
    extra.append(("the old policy-file cleanup: a bare web request with no key → refused (it used to delete)", a == 401, a))
for fn_, act in (("client-status-review", "decide"), ("launch-evidence", "record")):
    if fn_ in deployed:
        a = http("POST", f"{FNB}/functions/v1/{fn_}", {"action": act}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
        f_ = http("POST", f"{FNB}/functions/v1/{fn_}", {"action": act}, {"apikey": ANON, "Authorization": "Bearer " + FORGED})[0]
        extra.append((f"{fn_}'s Hub button ({act}): the public key and a forged token → refused", a in (401, 403) and f_ == 401, f"{a}, {f_}"))
if G.get("rules"):
    a, _ = http("GET", f"{FNB}/rest/v1/rules_approved?select=file", None, {"apikey": ANON, "Authorization": "Bearer " + ANON})
    extra.append(("the approved-rules list: the public key can't read it", a in (401, 403, 404), a))
for label, good, got in extra: (say if good else bad)(("  ✓ " if good else "") + label + ("" if good else f" (got {got})"))

say()
if fails: say("RESULT: CHECK THE ✗ LINES." + (f" Left exactly as they were: {', '.join(skipped)}." if skipped else ""))
elif GROUP == "O1": say("RESULT: DONE · the three senders now keep their office hours even when a request says it is a practice run.")
elif GROUP == "G2": say("RESULT: DONE · the five jobs run a rules file from the Hub site only if you approved that exact version; today's five are approved.")
elif GROUP == "G1": say("RESULT: DONE · the obligations runner and the eligibility sweep answer only your server key, checked before anything else.")
elif GROUP == "J1b": say("RESULT: DONE · ghe-reminders answers only its schedule and your server key, and now tells the watchdog each day it runs.")
else: say(f"RESULT: DONE · the {len(deployed)} jobs answer only their schedules, your server key" + (" and, for Hub buttons, active office staff." if GROUP == "J1" else ", and active office staff for the Hub buttons."))
say("No key, secret, token, name, number or email was printed. Rollback if ever needed: redeploy a job from the commit before this one"
    " (its schedule can stay: the old code ignores the header)" + ("; the audio setting: the rollback lines at the top of j1_recordings_setting.sql." if GROUP == "J1" else "."))
done(0 if not fails else 8)
