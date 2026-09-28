#!/usr/bin/env python3
# Security slice (Desktop 280, 2026-09-27): close the public senders found in 0c, across three projects.
#   Hub:               resend-relay accepts only a server-only RELAY_SECRET (was the public page key).
#   HomeTogether Hire: htl-founding-emails uses that secret and its any-address test mode is gone; htl-notify invites
#                      come only from the organizer's own pending invite (address, link, name from the database) and
#                      document notices only to a caregiver the family is in contact with.
#   Training:          send-invite, send-reminder, sync-axiscare, monthly-backup, send-certificate need signed-in staff
#                      (or the caregiver's own link / the nightly sync's server key / the scheduled jobs' secret);
#                      certificate emails carry only our own link and escaped wording.
#   Part 1 READ ONLY · Part 2 install (secrets never printed or saved on this Mac) · Part 3 live proof, nothing sent.
import json, os, re, time, secrets as pysecrets, hashlib, subprocess, urllib.request, urllib.error, datetime as dt
REPORT = os.environ["SB_REPORT"]; TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'")
SHAS = json.loads(os.environ["SB_SHAS"]); SUPA = os.environ.get("SB_SUPA_CLI", ""); SKIP_FN = os.environ.get("SB_SKIP_FUNCTION") == "1"
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", "")   # test: one fake host for all
POLL = float(os.environ.get("SB_POLL_SEC", "2")); POLL_MAX = float(os.environ.get("SB_POLL_MAX", "60"))
HUB, TP, HT = "zngsgedlsxinbygwmxwn", "rdqujxiycycwhskyvrwa", "lrlczrpehjpncqixubuk"
ROOTS = {HUB: os.environ["SB_ROOT_HUB"], TP: os.environ["SB_ROOT_TP"], HT: os.environ["SB_ROOT_HT"]}
DEPLOY = {HUB: ["resend-relay"], HT: ["htl-founding-emails", "htl-notify"], TP: ["send-certificate", "send-invite", "send-reminder", "monthly-backup", "sync-axiscare"]}
JOBS = {"nightly-axiscare-sync": "sync-axiscare", "monthly-training-backup": "monthly-backup"}; VAULT = "training_cron_secret"
NAMES = {HUB: "Hub", TP: "Training Platform", HT: "HomeTogether Hire"}
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|htorder_|htlpub_)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def http(method, url, body=None, headers=None, timeout=120, raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-public-senders/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, "%s: %s" % (type(e).__name__, e)
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def jl(b):
    try: return json.loads(b)
    except Exception: return {}
def sql(ref, q):
    s, b = http("POST", f"{API}/v1/projects/{ref}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, f"HTTP {s}: {b[:200]}"
    return True, jl(b)
def lit(v): return "'" + str(v).replace("'", "''") + "'"
def vjwt(ref, fn):
    s, b = http("GET", f"{API}/v1/projects/{ref}/functions/{fn}", headers=MG())
    v = jl(b).get("verify_jwt") if s == 200 else None
    return v if isinstance(v, bool) else None
def keys(ref):
    s, b = http("GET", f"{API}/v1/projects/{ref}/api-keys", headers=MG()); k = jl(b)
    return {x.get("name"): x.get("api_key", "") for x in (k if isinstance(k, list) else []) if isinstance(x, dict)}
fnbase = lambda ref: FNB or f"https://{ref}.supabase.co"

say("SECURITY SLICE · THE PUBLIC SENDERS FOUND IN 0c (Hub, HomeTogether Hire, Training Platform)")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")); say()
if not TOKEN.startswith("sbp_"): say("✗ That is not a Supabase access token (sbp_...). Nothing was changed."); done(1)

say("PART 1 · READ ONLY")
s, b = http("GET", f"{API}/v1/projects/{TP}/config/auth", headers=MG()); ds = jl(b).get("disable_signup") if s == 200 else None
if ds is not True:
    say(f"✗ STOP: the Training Platform {'allows anyone to create an account' if ds is False else 'sign-up setting could not be read'} (disable_signup = {ds}).")
    say("  The new check treats a signed-in Training account as staff, which is only safe when accounts are created by an admin. Nothing was changed. Tell Claude."); done(2)
say("  ✓ Training Platform: self-signup is OFF, so every signed-in account was created by an admin")
before = {}
for ref, fns in DEPLOY.items():
    for fn in fns:
        before[(ref, fn)] = vjwt(ref, fn)
if any(v is None for v in before.values()): say("✗ STOP: could not read how these functions check callers: " + ", ".join(f"{NAMES[r]} {f}" for (r, f), v in before.items() if v is None) + ". Nothing was changed."); done(3)
say("  how each checks callers today (kept exactly): " + "; ".join(f"{NAMES[r]} {f} {'ON' if v else 'off'}" for (r, f), v in before.items()))
ok, jobs = sql(TP, "select jobid, jobname, schedule, active, command from cron.job where jobname in ('nightly-axiscare-sync','monthly-training-backup')")
if not ok or len(jobs or []) != 2: say(f"✗ STOP: the two Training scheduled jobs were not both found: {str(jobs)[:120]}. Nothing was changed."); done(3)
for j in jobs:
    m = re.search(r"url\s*:=\s*'([^']+)'", j["command"] or "")
    if not m or f"/functions/v1/{JOBS[j['jobname']]}" not in m.group(1): say(f"✗ STOP: {j['jobname']} does not call {JOBS[j['jobname']]} the way expected. Nothing was changed."); done(3)
    j["url"] = m.group(1)
    say(f"  {j['jobname']}: {j['schedule']} · {'active' if j['active'] else 'PAUSED'} · calls {JOBS[j['jobname']]}")
ok, vx = sql(TP, "select to_regclass('vault.decrypted_secrets') is not null as v, exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'net' and p.proname = 'http_post') as n")
if not ok or not vx[0]["v"] or not vx[0]["n"]: say("✗ STOP: Vault or pg_net is not available in the Training project. Nothing was changed."); done(3)
ok, ht = sql(HT, "select to_regclass('public.htl_family_members') is not null as t")
if not ok or not ht[0]["t"]: say("✗ STOP: HomeTogether Hire's family members table was not found. Nothing was changed."); done(3)
say()

say("PART 2 · INSTALL")
for f, want in SHAS.items():
    ref, rel = f.split(":", 1)
    if hashlib.sha256(open(os.path.join(ROOTS[ref], "supabase/functions", rel), "rb").read()).hexdigest() != want:
        say(f"  ✗ {NAMES[ref]} {rel} is not the reviewed build. STOP. Nothing was changed."); done(4)
say(f"  ✓ all {len(SHAS)} source files are the reviewed builds")
kt, kh = keys(TP), keys(HUB); TP_ANON, HUB_ANON, HUB_SVC = kt.get("anon", ""), kh.get("anon", ""), kh.get("service_role", "")
kht = keys(HT); HT_ANON = kht.get("anon", ""); HIDE += [TP_ANON, HUB_ANON, HUB_SVC, HT_ANON]
if not TP_ANON or not HUB_ANON or not HT_ANON: say("  ✗ STOP: could not read the project keys. Nothing was changed."); done(4)
RELAY, CRON = pysecrets.token_urlsafe(48), pysecrets.token_urlsafe(48); HIDE += [RELAY, CRON]
for ref, name, val in ((HUB, "RELAY_SECRET", RELAY), (HT, "RELAY_SECRET", RELAY), (TP, "TRAINING_CRON_SECRET", CRON)):
    s, _ = http("POST", f"{API}/v1/projects/{ref}/secrets", headers=MG(), raw=json.dumps([{"name": name, "value": val}]).encode())
    if s not in (200, 201): bad(f"could not set {name} in {NAMES[ref]} (HTTP {s})"); say("  STOP. No function was deployed yet."); done(5)
say("  ✓ new server-only secrets set: the relay secret (Hub and HomeTogether Hire, same value) and the Training scheduled-job secret (not shown)")
ok, _ = sql(TP, f"""do $v$ begin
  if exists (select 1 from vault.secrets where name = {lit(VAULT)}) then perform vault.update_secret((select id from vault.secrets where name = {lit(VAULT)}), {lit(CRON)});
  else perform vault.create_secret({lit(CRON)}, {lit(VAULT)}, 'Training scheduled jobs: server-only secret (security slice 2026-09-27)'); end if; end $v$""")
ok2, vv = sql(TP, f"select count(*)::int as n, bool_and(decrypted_secret = {lit(CRON)}) as same from vault.decrypted_secrets where name = {lit(VAULT)}")
if not ok or not ok2 or vv[0]["n"] != 1 or vv[0]["same"] is not True: bad("the Training secret could not be stored in Vault"); say("  STOP. No function was deployed yet."); done(5)
say("  ✓ the same Training secret stored in the Training project's Vault for its scheduled jobs")
ok, _ = sql(HT, "alter table public.htl_family_members add column if not exists invite_emailed_at timestamptz")
if not ok: bad("could not add invite_emailed_at to htl_family_members"); done(5)
say("  ✓ HomeTogether Hire: htl_family_members.invite_emailed_at in place (each invite emailed at most once a day)")
for ref, fns in DEPLOY.items():
    for fn in fns:
        vj = before[(ref, fn)]
        if SKIP_FN: say(f"  (test target) would deploy {NAMES[ref]} {fn}" + ("" if vj else " --no-verify-jwt")); continue
        p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", ref, "--use-api"] + ([] if vj else ["--no-verify-jwt"]),
                           cwd=ROOTS[ref], env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
        if p.returncode != 0: bad(f"{NAMES[ref]} {fn} deploy failed: " + (p.stderr or p.stdout)[-240:]); say("  STOP. Functions above this line run the new code. Tell Claude today."); done(6)
        say(f"  ✓ {NAMES[ref]} {fn} deployed")
after = {k: vjwt(*k) for k in before}
if after != before: bad("how a function checks callers changed")
else: say("  ✓ every function checks callers at the platform exactly as before")
for j in jobs:
    cmd = ("select net.http_post(url := " + lit(j["url"]) + ", headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', "
           + lit("Bearer " + TP_ANON) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT) + ")), body := '{}'::jsonb, timeout_milliseconds := 300000);")
    ok, r = sql(TP, f"select cron.schedule({lit(j['jobname'])}, {lit(j['schedule'])}, {lit(cmd)}) as id")
    if ok and r and j["active"] is False: sql(TP, f"select cron.alter_job({int(r[0]['id'])}, active := false)")
    ok2, c2 = sql(TP, f"select schedule, active, command from cron.job where jobname = {lit(j['jobname'])}")
    c2 = (c2 or [{}])[0] if ok2 else {}
    if ok and c2.get("schedule") == j["schedule"] and c2.get("active") == j["active"] and "vault.decrypted_secrets" in (c2.get("command") or "") and CRON not in (c2.get("command") or ""):
        say(f"  ✓ {j['jobname']} now carries its secret from Vault: same schedule, {'active' if j['active'] else 'paused'} as before, the secret itself not in the job")
    else: bad(f"{j['jobname']} does not look as intended after the update")
say()

say("PART 3 · LIVE PROOF (nothing is sent: each probe is refused, has no real recipient, or is check-only)")
def post(ref, fn, body, headers=None, q=""):
    return http("POST", f"{fnbase(ref)}/functions/v1/{fn}{q}", body, headers or {}, timeout=60)
s, _ = post(HUB, "resend-relay", {"token": os.environ.get("SB_PUBLIC_ORDER_TOKEN", ""), "from": "HomeTogether <support@tryhometogether.com>", "to": "nobody@invalid.invalid", "subject": "proof", "html": "proof"}, {"apikey": HUB_ANON, "Authorization": "Bearer " + HUB_ANON})
if s == 401: say("  ✓ resend-relay with the public page key: refused, 401")
else: bad(f"resend-relay with the public page key answered {s}: the relay may still be open")
s, _ = post(HT, "htl-founding-emails", {"token": os.environ.get("SB_PUBLIC_HTL_TOKEN", ""), "test": "proof-no-address"}, {"apikey": HT_ANON, "Authorization": "Bearer " + HT_ANON})
say("  ✓ founding-emails test mode with the public key: refused, 400 (the mode is gone)") if s == 400 else bad(f"founding-emails test mode answered {s}")
s, _ = post(HT, "htl-notify", {"action": "invite", "invite_code": "0000000000000000"}, {"apikey": HT_ANON}, q="?token=" + os.environ.get("SB_PUBLIC_HTL_TOKEN", ""))
say("  ✓ HomeTogether invite email without a signed-in family: refused, 401") if s == 401 else bad(f"htl-notify invite without sign-in answered {s}")
for fn, body in (("send-invite", {"caregiver_id": "00000000-0000-0000-0000-000000000000"}), ("send-reminder", {"caregiver_id": "00000000-0000-0000-0000-000000000000"}),
                 ("send-certificate", {"caregiver_id": "00000000-0000-0000-0000-000000000000", "course_title": "proof", "url": "https://invalid.invalid"}),
                 ("sync-axiscare", {"auth_check": True}), ("monthly-backup", {"auth_check": True})):
    s, _ = post(TP, fn, body, {"apikey": TP_ANON, "Authorization": "Bearer " + TP_ANON})
    say(f"  ✓ Training {fn} with only the public key: refused, 401") if s == 401 else bad(f"Training {fn} with only the public key answered {s}")
got = {}
for fn in ("sync-axiscare", "monthly-backup"):
    ok, rq = sql(TP, "select net.http_post(url := " + lit(f"{fnbase(TP)}/functions/v1/{fn}") + ", headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', "
                 + lit("Bearer " + TP_ANON) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT) + ")), body := '{\"auth_check\": true}'::jsonb) as id")
    waited = 0.0
    while ok and rq and waited <= POLL_MAX:
        ok3, rr = sql(TP, f"select status_code, content from net._http_response where id = {int(rq[0]['id'])}")
        if ok3 and rr: got[fn] = rr[0]; break
        time.sleep(POLL); waited += POLL
    g = got.get(fn)
    if g and g["status_code"] == 200 and jl(g["content"]).get("authorized") == "cron": say(f"  ✓ from the Training database, the way its {fn} job calls, with the Vault secret: accepted (check only; nothing ran)")
    else: bad(f"the {fn} scheduled path was not accepted (" + (f"HTTP {g['status_code']}" if g else "no answer") + ")")
say("  ○ a signed-in family's invite, a staff certificate and the relay with the right secret are proven in the test harness (30/30); live they would email real people")
say()
say("RESULT: " + ("CLOSED · none of these can be used by a stranger to email or text anyone; the Training scheduled jobs carry their own secret" if not fails else "CHECK THE ✗ LINES ABOVE"))
done(0 if not fails else 9)
