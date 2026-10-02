#!/usr/bin/env python3
# 412 · 2C-T: A NEW HIRE IS TOLD "YOU ARE CLEARED" (AND SWITCHED TO ACTIVE IN AXISCARE) ONLY ONCE THEIR CAREGIVER
# PROFILE IS PUBLISHED. Samantha 2026-10-01: "Wait for the profile". Training done + profile published = cleared.
# New hires only (hire date on or after 2026-10-02, or the Hub sees a welcome call / promotion on or after it).
# Current caregivers are never held back.
# Two projects, one Supabase access token (it is account-wide):
#   THE HUB (zngsgedlsxinbygwmxwn): outreach-check gains one server-door answer, { profile_check, axiscare_id } ->
#     { published, new_hire }, behind the same OUTREACH_SECRET the Training senders already use. Nothing public.
#   THE TRAINING PLATFORM (rdqujxiycycwhskyvrwa): three columns on caregivers; notify-cleared asks the Hub before the
#     cleared text and the Active switch; sync-axiscare's rehire reset clears the new stamps; one scheduled job
#     (cleared-profile-wait, hourly, acts only 8am to 6pm Central) clears held new hires once their profile is published.
# Part 1 (read only): reviewed builds (pinned) in both projects, the tests pass, the Training secrets and Vault entry
#   the new code needs are there, and a count of who would be held today.
# Part 2, in this order (each step only if the one before it worked): Hub outreach-check; Training columns (one
#   transaction); Training notify-cleared + sync-axiscare; the hourly job. Each function only if its live copy is known
#   code, each keeping its own gateway (sign-in check) setting.
# Part 3 (proof, NO message is sent, nobody is switched in AxisCare): the Hub refuses the question without the secret;
#   notify-cleared's proof mode asks the Hub about a made-up AxisCare number through the real secret (answer: not
#   published, not a new hire) and counts who is waiting; the hourly pass refuses callers without the job secret; no held
#   person has been texted or switched.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, tempfile, shutil
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com")
HUB, TP = "zngsgedlsxinbygwmxwn", "rdqujxiycycwhskyvrwa"
ROOTS = {HUB: os.environ["SB_HUB_ROOT"], TP: os.environ["SB_TR_ROOT"]}
BASES = {HUB: os.environ.get("SB_HUB_BASE", ""), TP: os.environ.get("SB_TR_BASE", "")}
SHAS = {HUB: json.loads(os.environ["SB_HUB_SHAS"]), TP: json.loads(os.environ["SB_TR_SHAS"])}
SQL_SHA = os.environ.get("SB_TR_SQL_SHA", "")
NAMES = {HUB: "Hub", TP: "Training"}
FNB = {HUB: os.environ.get("SB_HUB_FN_BASE", f"https://{HUB}.supabase.co"), TP: os.environ.get("SB_TR_FN_BASE", f"https://{TP}.supabase.co")}
JOB, VAULT, SCHED = "cleared-profile-wait", "training_cron_secret", "30 13-23 * * *"
LINE = "2026-10-02"
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for h in HIDE:
        if h: s = s.replace(h, "(hidden)")
    s = re.sub(r"(sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s); s = re.sub(r"[\w.%+\-]+@[\w.\-]+\.[A-Za-z]{2,}", "(an email)", s)
    print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(c): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(c)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Anything done above stays done; nothing after it ran. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=150):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-cleared412/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(ref, q):
    s, b = http("POST", f"{API}/v1/projects/{ref}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def fmeta(ref, fn):
    s, b = http("GET", f"{API}/v1/projects/{ref}/functions/{fn}", headers=MG())
    try: return s, (json.loads(b) if s == 200 else None)
    except Exception: return s, None
def keys(ref):
    s, b = http("GET", f"{API}/v1/projects/{ref}/api-keys", headers=MG())
    try: return {k.get("name"): k.get("api_key", "") for k in json.loads(b)} if s == 200 else {}
    except Exception: return {}
lit = lambda v: "'" + str(v).replace("'", "''") + "'"
shab = lambda b: hashlib.sha256(b).hexdigest()
sha = lambda p: shab(open(p, "rb").read())
def git(ref, *a): return subprocess.run(["git", *a], cwd=ROOTS[ref], capture_output=True)
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)

def deps(path, seen):
    if path in seen or not os.path.exists(path): return
    seen.add(path)
    for m in re.findall(r"""from\s+['"](\.{1,2}/[^'"]+)['"]|import\s+['"](\.{1,2}/[^'"]+)['"]""", open(path).read()):
        deps(os.path.normpath(os.path.join(os.path.dirname(path), m[0] or m[1])), seen)
HIST = {}
def history(ref, rel):  # every committed version of one file, so "known code" can be told from unknown
    k = (ref, rel)
    if k not in HIST:
        hs = set()
        for c in git(ref, "log", "--format=%H", "--", rel).stdout.decode().split():
            b = git(ref, "show", f"{c}:{rel}")
            if b.returncode == 0: hs.add(shab(b.stdout))
        if os.path.exists(os.path.join(ROOTS[ref], rel)): hs.add(sha(os.path.join(ROOTS[ref], rel)))
        HIST[k] = hs
    return HIST[k]

def reviewed(ref):
    """The changed function files since the reviewed starting point are exactly the pinned builds. Returns the
    functions that are or include a changed file."""
    R, BASE = ROOTS[ref], BASES[ref]
    if not BASE or git(ref, "cat-file", "-e", BASE + "^{commit}").returncode != 0: bad(f"{NAMES[ref]}: the reviewed starting point isn't in this folder's history"); say("  STOP. Nothing was run."); done(2)
    changed = sorted(x for x in git(ref, "diff", "--name-only", BASE, "HEAD", "--", "supabase/functions").stdout.decode().split() if x.endswith(".ts") and os.path.exists(os.path.join(R, x)))
    pinned = {(f"supabase/functions/{k}.ts" if k.startswith("_shared/") else f"supabase/functions/{k}/index.ts"): v for k, v in SHAS[ref].items()}
    if set(changed) != set(pinned): bad(f"{NAMES[ref]}: the list of changed files isn't the reviewed list ({', '.join(changed)[:200]})"); say("  STOP. Nothing was run."); done(2)
    for rel, want in pinned.items():
        if sha(os.path.join(R, rel)) != want: bad(f"{NAMES[ref]} {rel.split('functions/')[1]} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
    users = []
    fnroot = os.path.join(R, "supabase/functions")
    for fn in sorted(os.listdir(fnroot)):
        p = os.path.join(fnroot, fn, "index.ts")
        if fn.startswith("_") or not os.path.exists(p): continue
        s = set(); deps(p, s)
        if any(os.path.normpath(os.path.join(R, c)) in s for c in changed): users.append(fn)
    say(f"  ✓ {NAMES[ref]}: the {len(changed)} changed files are the reviewed builds; functions to update: {', '.join(users)}")
    return users

def deploy(ref, users):
    """One function at a time; only if its live copy is known code; its gateway setting kept. Returns True if all went."""
    R = ROOTS[ref]; ok_all = True
    for fn in users:
        sM, m = fmeta(ref, fn)
        if sM == 404: bad(f"{NAMES[ref]} {fn} is not deployed there. Tell Claude."); ok_all = False; continue
        vj = (m or {}).get("verify_jwt")
        if not isinstance(vj, bool): bad(f"{NAMES[ref]} {fn}: couldn't read its gateway setting, NOT changed"); ok_all = False; continue
        tmp = tempfile.mkdtemp(prefix="cl412-"); os.makedirs(os.path.join(tmp, "supabase"), exist_ok=True)
        d = subprocess.run([SUPA, "functions", "download", fn, "--project-ref", ref, "--use-api"], cwd=tmp, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
        live = {}
        for root, _, files in os.walk(tmp):
            for f in files:
                lp = os.path.join(root, f).replace(os.sep, "/")
                if "/functions/" in lp: live["supabase/functions/" + lp.split("/functions/", 1)[1]] = sha(lp)
        shutil.rmtree(tmp, ignore_errors=True)
        mine = f"supabase/functions/{fn}/index.ts"
        if d.returncode != 0 or mine not in live: bad(f"{NAMES[ref]} {fn}: couldn't read its live copy, NOT changed"); ok_all = False; continue
        if all(os.path.exists(os.path.join(R, k)) and h == sha(os.path.join(R, k)) for k, h in live.items()):
            say(f"  ✓ {NAMES[ref]} {fn} already had it"); continue
        if live[mine] not in history(ref, mine): bad(f"{NAMES[ref]} {fn}: its live code is not a reviewed GitHub version, NOT changed"); ok_all = False; continue
        unknown = [k.split("supabase/functions/", 1)[1] for k, h in live.items() if k != mine and h not in history(ref, k)]
        if unknown: bad(f"{NAMES[ref]} {fn}: live code not in GitHub ({', '.join(sorted(unknown))[:160]}), NOT changed"); ok_all = False; continue
        p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", ref, "--use-api"] + ([] if vj else ["--no-verify-jwt"]),
                           cwd=R, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
        if p.returncode != 0: bad(f"{NAMES[ref]} {fn} didn't deploy: " + (p.stderr or p.stdout)[-200:]); ok_all = False; continue
        sN, mN = fmeta(ref, fn)
        if (mN or {}).get("verify_jwt") != vj:
            http("PATCH", f"{API}/v1/projects/{ref}/functions/{fn}", {"verify_jwt": vj}, MG()); sN, mN = fmeta(ref, fn)
            if (mN or {}).get("verify_jwt") != vj: bad(f"{NAMES[ref]} {fn}: its gateway setting changed and couldn't be put back. Tell Claude."); ok_all = False; continue
        say(f"  ✓ {NAMES[ref]} {fn} deployed (gateway setting kept)")
    return ok_all

say("412 · NEW HIRES: \"YOU ARE CLEARED\" WAITS FOR A PUBLISHED CAREGIVER PROFILE"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
hub_users = reviewed(HUB); tr_users = reviewed(TP)
if hub_users != ["outreach-check"]: bad("Hub: only outreach-check should change"); say("  STOP. Nothing was run."); done(2)
if sorted(tr_users) != ["notify-cleared", "sync-axiscare"]: bad("Training: only notify-cleared and sync-axiscare should change"); say("  STOP. Nothing was run."); done(2)
SQLF = os.path.join(ROOTS[TP], "supabase/profile-before-cleared.sql")
if not os.path.exists(SQLF) or sha(SQLF) != SQL_SHA: bad("profile-before-cleared.sql is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
say("  ✓ the Training database change is the reviewed build (three new columns, nothing else)")
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if NODE:
    for ref, t in ((HUB, "profile_cleared_check_hub_test.mjs"), (HUB, "training_texts_hub_test.mjs"), (TP, "profile_before_cleared_test.mjs"), (TP, "training_texts_test.mjs")):
        p = subprocess.run([NODE, t], cwd=ROOTS[ref], capture_output=True, text=True)
        last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
        if p.returncode != 0 or "FAIL" in last: bad(f"{NAMES[ref]} {t} failed: {last}"); say("  STOP. Nothing was run."); done(2)
        say(f"  ✓ {NAMES[ref]} {t}: {last} (run here, against fakes; nothing sent)")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
s_, sb = http("GET", f"{API}/v1/projects/{TP}/secrets", headers=MG())
try: names = {x.get("name") for x in json.loads(sb)} if s_ == 200 else set()
except Exception: names = set()
need = {"OUTREACH_SECRET", "HUB_ANON_KEY", "TRAINING_CRON_SECRET"}
if not need <= names: bad("Training is missing a secret the new code needs: " + ", ".join(sorted(need - names)) + ". Nothing was changed. Tell Claude."); done(3)
say("  ✓ Training has the Hub door secret, the Hub's public key and the scheduled-job secret (values not read)")
ok, vx = sql(TP, f"select exists (select 1 from vault.decrypted_secrets where name = {lit(VAULT)}) as v, "
                 "exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'net' and p.proname = 'http_post') as n, "
                 "exists (select 1 from pg_namespace where nspname = 'cron') as c")
if not ok or not vx or not (vx[0]["v"] and vx[0]["n"] and vx[0]["c"]): bad("Training's Vault secret / scheduled jobs aren't as expected. Nothing was changed. Tell Claude: " + str(vx)[:160]); done(3)
ok, jb = sql(TP, f"select jobname, schedule, active from cron.job where jobname in ('nightly-axiscare-sync', {lit(JOB)})")
jobs = {j["jobname"]: j for j in (jb or [])} if ok else {}
say(f"  ✓ the 9am nightly sync is {'there (' + jobs['nightly-axiscare-sync']['schedule'] + ', ' + ('active' if jobs['nightly-axiscare-sync']['active'] else 'PAUSED') + ')' if 'nightly-axiscare-sync' in jobs else 'NOT FOUND'}"
    + ("; the hourly job already exists (it is replaced with the reviewed one)" if JOB in jobs else ""))
ok, pv = sql(TP, f"""select count(*)::int as n,
  count(*) filter (where c.hire_date >= {lit(LINE)})::int as newhires
  from caregivers c where c.active and c.status_label = 'In Training' and c.cleared_notified_at is null
  and exists (select 1 from enrollments e where e.caregiver_id = c.id and e.requirement = 'pre_service')
  and not exists (select 1 from enrollments e where e.caregiver_id = c.id and e.requirement = 'pre_service' and e.status <> 'complete')""")
if ok and pv: say(f"  · today: {pv[0]['n']} In Training with all pre-service training done and not yet told they're cleared; "
                   f"{pv[0]['newhires']} of them hired on or after {LINE} (those wait for a published profile)")
kt, kh = keys(TP), keys(HUB)
TP_ANON, TP_SVC, HUB_ANON = kt.get("anon", ""), kt.get("service_role", ""), kh.get("anon", "")
HIDE += [TP_ANON, TP_SVC, HUB_ANON]
if not TP_ANON or not TP_SVC or not HUB_ANON: bad("couldn't read the project keys. Nothing was changed."); done(3)

say(); say("PART 2 · CHANGE (in order; each step only if the one before it worked)")
if not deploy(HUB, hub_users): say("  STOP. The Training Platform was not changed. Tell Claude."); done(4)
s1, b1 = http("POST", f"{FNB[HUB]}/functions/v1/outreach-check", {"profile_check": True, "axiscare_id": "999999999"},
              {"Authorization": "Bearer " + HUB_ANON, "apikey": HUB_ANON, "x-outreach-secret": "wrong-" + "x" * 40})
chk(s1 == 401 and "published" not in (b1 or ""), f"the Hub refuses the profile question without the right server secret ({s1})")
if fails: say("  STOP. The Training Platform was not changed. Tell Claude."); done(4)
ok, r = sql(TP, "begin;\n" + open(SQLF).read() + "\ncommit;")
if not ok: bad("the Training columns didn't go in (undone as a whole): " + str(r)[:240]); say("  STOP. Training functions were not changed. Tell Claude."); done(5)
ok, cols = sql(TP, "select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'caregivers' "
                   "and column_name in ('cleared_waiting_profile_at', 'cleared_hold_note', 'axiscare_active_at')")
if not ok or cols[0]["n"] != 3: bad("the three Training columns aren't all there. Training functions were not changed. Tell Claude."); done(5)
say("  ✓ Training: caregivers has cleared_waiting_profile_at, cleared_hold_note, axiscare_active_at")
if not deploy(TP, ["notify-cleared", "sync-axiscare"]): say("  STOP. The hourly job was not added. Tell Claude."); done(6)
cmd = ("select net.http_post(url := " + lit(f"{FNB[TP]}/functions/v1/notify-cleared") + ", headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', "
       + lit("Bearer " + TP_ANON) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT) + ")), "
       + "body := '{\"sweep\": true}'::jsonb, timeout_milliseconds := 120000);")
ok, r = sql(TP, f"select cron.schedule({lit(JOB)}, {lit(SCHED)}, {lit(cmd)}) as id")
ok2, c2 = sql(TP, f"select schedule, active, command from cron.job where jobname = {lit(JOB)}")
c2 = (c2 or [{}])[0] if ok2 and c2 else {}
chk(ok and c2.get("schedule") == SCHED and c2.get("active") is True and "vault.decrypted_secrets" in (c2.get("command") or "") and '"sweep": true' in (c2.get("command") or ""),
    f"Training: the hourly job {JOB} is in ({SCHED} UTC; it only acts 8am to 6pm Central), its secret read from Vault, not written in the job")

say(); say("PART 3 · PROOF (no message is sent, nobody is switched in AxisCare)")
NC = f"{FNB[TP]}/functions/v1/notify-cleared"
s2, b2 = http("POST", NC, {"proof": True}, {"Authorization": "Bearer " + TP_SVC, "apikey": TP_ANON})
try: j2 = json.loads(b2)
except Exception: j2 = {}
h = j2.get("hub") or {}
chk(s2 == 200 and h.get("ok") is True and h.get("published") is False and h.get("new_hire") is False and j2.get("sent") == 0,
    f"Training asked the Hub, through the real server secret, about a made-up AxisCare number: not published, not a new hire ({s2}" + ("" if h.get("ok") else f": {h.get('why', b2[:160])}") + ")")
if s2 == 200: say(f"  · new hires waiting for their profile right now: {j2.get('waiting')}")
s3, b3 = http("POST", NC, {"sweep": True}, {"Authorization": "Bearer " + TP_ANON, "apikey": TP_ANON})
chk(s3 == 401, f"the hourly pass refuses a caller without the scheduled-job secret ({s3})")
s4, b4 = http("POST", NC, {"proof": True}, {"Authorization": "Bearer " + TP_ANON, "apikey": TP_ANON})
chk(s4 == 401, f"the proof mode refuses a caller without the server key ({s4})")
ok, hl = sql(TP, "select count(*)::int as n from caregivers where cleared_waiting_profile_at is not null and status_label = 'In Training' "
                 "and (cleared_notified_at is not null or axiscare_active_at is not null) and cleared_hold_note is not null")
chk(ok and hl and hl[0]["n"] == 0, "no one held for a profile has been texted or switched to Active")
say()
if fails: say("RESULT: PARTLY DONE · the ✗ lines above need Claude.")
else: say("RESULT: DONE · new hires now wait for a published caregiver profile before \"you are cleared\" and the switch to Active. "
          "Merge the Training Platform branch next (the roster shows \"Training done, waiting for caregiver profile\").")
say("Nothing was texted or emailed and no one was switched in AxisCare by this installer.")
say("Rollback: Claude redeploys the previous outreach-check, notify-cleared and sync-axiscare, and runs select cron.unschedule('cleared-profile-wait') in Training; the three columns can stay.")
done(1 if fails else 0)
