#!/usr/bin/env python3
# Security slice (Desktop 274, 2026-09-27): close the public-token exposure on campaign audiences, manual campaign
# send and Family Circle send.
#   Part 1 READ ONLY: who holds which staff role (first names only), how each function checks callers today, and how
#     the daily campaign job calls in (URL parameter NAMES and header NAMES only; no values are printed).
#   Part 2: sha-checked sources; a new server-only secret for the daily job (generated here, never printed, never
#     written to disk: it goes only to Supabase as a function secret and into Supabase Vault); deploy the three
#     functions exactly as they check callers today; point the daily job at the Vault secret instead of the token.
#   Part 3 LIVE PROOF without reading or printing any client, family or audience data:
#     refusals with no sign-in, with the old public token, and with the public anon key; the scheduled path refused
#     for a wrong secret and for the public token, and accepted from the database through Vault; the Hub no longer
#     sends the token; and a permission CHECK (reads nothing, sends nothing) as you, signed in for under a minute
#     through a one-time sign-in link that is never emailed, then signed out.
# Nothing here sends a message. Response bodies are never printed; only status codes and yes/no answers.
import json, os, re, time, secrets as pysecrets, hashlib, subprocess, urllib.request, urllib.error, datetime as dt
FNROOT = os.environ["SB_FNROOT"]; FN_SHAS = json.loads(os.environ["SB_FN_SHAS"]); REPORT = os.environ["SB_REPORT"]
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "")
SUPA = os.environ.get("SB_SUPA_CLI", ""); SKIP_FN = os.environ.get("SB_SKIP_FUNCTION") == "1"
API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
HUB_FILE = os.environ["SB_HUB_FILE"]; HUB_URL = os.environ.get("SB_HUB_URL", "https://cc.mo-care.com/")
PROOF_EMAIL = os.environ.get("SB_PROOF_EMAIL", "").strip().lower()
POLL = float(os.environ.get("SB_POLL_SEC", "2")); POLL_MAX = float(os.environ.get("SB_POLL_MAX", "60"))
DEPLOY = ["campaign-auto", "campaign-send", "circle-send"]; JOB = "daily-campaign-auto"; VAULT_NAME = "campaign_cron_secret"
lines = []; fails = []; SECRET_VALUES = []
def scrub(s):
    s = str(s)
    for v in SECRET_VALUES:
        if v: s = s.replace(v, "(hidden)")
    return re.sub(r"(htorder_|sbp_|eyJ)[A-Za-z0-9._\-]+", "(hidden)", s)
def say(s=""): s = scrub(s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def http(method, url, body=None, headers=None, timeout=240, raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(url, data=data, method=method, headers=dict({"Content-Type": "application/json", "User-Agent": "cc-security-slice/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, "%s: %s" % (type(e).__name__, e)
MGMT = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MGMT())
    if s not in (200, 201): return False, f"HTTP {s}: {b[:300]}"
    try: return True, json.loads(b)
    except Exception: return False, b[:300]
def lit(v): return "'" + str(v).replace("'", "''") + "'"
def verify_jwt(fn):
    s, b = http("GET", f"{API}/v1/projects/{REF}/functions/{fn}", headers=MGMT())
    try: v = json.loads(b).get("verify_jwt") if s == 200 else None
    except Exception: v = None
    return v if isinstance(v, bool) else None
def keys():
    s, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys", headers=MGMT())
    try: return {k.get("name"): k.get("api_key", "") for k in json.loads(kb) if isinstance(k, dict)}
    except Exception: return {}
def jget(b, *path):
    try:
        d = json.loads(b)
        for p in path: d = d.get(p) if isinstance(d, dict) else None
        return d
    except Exception: return None

say("SECURITY SLICE · CAMPAIGNS AND FAMILY CIRCLE · INSTALL")
say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")); say()
if not TOKEN.startswith("sbp_"): say("✗ That is not a Supabase access token (sbp_...). Nothing was changed."); done(1)
if not PROOF_EMAIL: say("✗ No proof sign-in address was given. Nothing was changed."); done(1)

# ── Part 1 · read only ─────────────────────────────────────────────────────────
say("PART 1 · READ ONLY")
ok, staff = sql("""select split_part(p.full_name, ' ', 1) as first, p.active,
    coalesce(m.active, false) and m.ended_at is null as member,
    exists (select 1 from auth_identities ai where ai.person_id = p.person_id and ai.project_ref = 'zngsgedlsxinbygwmxwn' and ai.auth_user_id is not null) as sign_in,
    (select u.raw_app_meta_data->'hub_access' from auth.users u join auth_identities ai on ai.auth_user_id = u.id
      where ai.person_id = p.person_id and ai.project_ref = 'zngsgedlsxinbygwmxwn' limit 1) as hubs,
    (select string_agg(r.role, ', ' order by r.role) from staff_roles r where r.person_id = p.person_id and r.entity = 'cc_ihs') as roles
  from persons p left join entity_memberships m on m.person_id = p.person_id and m.entity = 'cc_ihs'
  where exists (select 1 from staff_roles r where r.person_id = p.person_id and r.entity = 'cc_ihs') order by 1""")
if not ok: say("✗ STOP: could not read the staff roles: " + str(staff)[:200] + ". Nothing was changed."); done(2)
def can(row, allowed):
    hubs = row.get("hubs"); hubs = json.loads(hubs) if isinstance(hubs, str) else hubs
    hub_ok = not isinstance(hubs, list) or "care_coordinator" in hubs
    return bool(row["active"] and row["member"] and row["sign_in"] and hub_ok and any(r in allowed for r in (row["roles"] or "").split(", ")))
say("  1a. Staff roles, and what each person will be able to do after this change:")
for r in staff:
    say(f"    {r['first']:<10} roles: {r['roles'] or '-':<45} campaigns: {'yes' if can(r, ['owner_admin']) else 'no ':<4} Family Circle send: {'yes' if can(r, ['owner_admin', 'care_coordinator']) else 'no'}"
        + ("" if r["active"] and r["member"] and r["sign_in"] else "   (" + ", ".join(x for x, v in (("inactive", not r["active"]), ("not an active member", not r["member"]), ("no sign-in linked", not r["sign_in"])) if v) + ")"))
if not any(can(r, ["owner_admin"]) for r in staff): say("✗ STOP: nobody would be able to use campaigns. Nothing was changed."); done(2)
before = {fn: verify_jwt(fn) for fn in DEPLOY}
say("  1b. How each function checks callers today (kept exactly): " + ", ".join(f"{fn} {'platform sign-in check ON' if v else 'OFF' if v is False else 'UNREADABLE'}" for fn, v in before.items()))
if any(v is None for v in before.values()): say("✗ STOP: could not read how the functions check callers. Nothing was changed."); done(3)
ok, job = sql(f"select jobid, schedule, active, command from cron.job where jobname = {lit(JOB)}")
if not ok or not job: say(f"✗ STOP: the daily campaign job ({JOB}) was not found: {str(job)[:160]}. Nothing was changed."); done(4)
job = job[0]; m = re.search(r"url\s*:=\s*'([^']+)'", job["command"] or "")
if not m or "/functions/v1/campaign-auto" not in m.group(1): say("✗ STOP: the daily campaign job does not call campaign-auto the way this installer expects. Nothing was changed."); done(4)
old_url = m.group(1); params = [p.split("=")[0] for p in (old_url.split("?", 1)[1].split("&") if "?" in old_url else [])]
hdrs = re.findall(r"'([A-Za-z-]+)'\s*,", job["command"] or "")
say(f"  1c. {JOB}: schedule {job['schedule']} · {'active' if job['active'] else 'PAUSED'} · URL parameters: {', '.join(params) or 'none'} · header names: {', '.join(sorted(set(hdrs))) or 'none'}")
ok, vx = sql("""select to_regclass('vault.decrypted_secrets') is not null and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'vault' and p.proname = 'create_secret') as v,
                  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'net' and p.proname = 'http_post') as n""")
if not ok or not vx[0]["v"] or not vx[0]["n"]: say("✗ STOP: Supabase Vault or pg_net is not available here. Nothing was changed."); done(4)
say("  1d. Supabase Vault and pg_net are available")
try: hub_src = open(HUB_FILE).read()
except Exception: hub_src = ""
pub = re.search(r"htorder_[0-9a-f]{20,}", hub_src); PUBLIC = pub.group(0) if pub else ""
if not PUBLIC: say("✗ STOP: could not find the public page token in the Hub source to prove it is refused. Nothing was changed."); done(4)
SECRET_VALUES.append(PUBLIC)
say()

# ── Part 2 · install ───────────────────────────────────────────────────────────
say("PART 2 · INSTALL")
for fn, want in FN_SHAS.items():
    path = os.path.join(FNROOT, fn) if fn.endswith(".ts") else os.path.join(FNROOT, fn, "index.ts")
    got = hashlib.sha256(open(path, "rb").read()).hexdigest()
    say(f"  {fn} sha256 {got[:16]}…" + ("  ✓ reviewed source" if got == want else "  ✗ differs"))
    if got != want: say("  STOP. Nothing was changed."); done(5)
k = keys(); SVC = k.get("service_role", ""); ANON = k.get("anon", "")
if not SVC or not ANON: say("  ✗ STOP: could not read the project keys. Nothing was changed."); done(5)
SECRET_VALUES += [SVC, ANON]
CRON_SECRET = pysecrets.token_urlsafe(48); SECRET_VALUES.append(CRON_SECRET)
s, b = http("POST", f"{API}/v1/projects/{REF}/secrets", raw=json.dumps([{"name": "CAMPAIGN_CRON_SECRET", "value": CRON_SECRET}]).encode(), headers=MGMT())
if s not in (200, 201): say(f"  ✗ STOP: the server-only secret could not be set (HTTP {s}). Nothing else was changed."); done(6)
say("  ✓ new server-only secret set for the functions (not shown)")
ok, r = sql(f"""do $v$ begin
                 if exists (select 1 from vault.secrets where name = {lit(VAULT_NAME)}) then
                   perform vault.update_secret((select id from vault.secrets where name = {lit(VAULT_NAME)}), {lit(CRON_SECRET)});
                 else
                   perform vault.create_secret({lit(CRON_SECRET)}, {lit(VAULT_NAME)}, 'daily campaign job: server-only secret (security slice 2026-09-27)');
                 end if; end $v$""")
ok2, rv = sql(f"select count(*)::int as n, bool_and(decrypted_secret = {lit(CRON_SECRET)}) as same from vault.decrypted_secrets where name = {lit(VAULT_NAME)}")
if not ok or not ok2 or not rv or rv[0]["n"] != 1 or rv[0]["same"] is not True: say("  ✗ STOP: the secret could not be stored in Vault. Functions were not deployed."); done(6)
say("  ✓ the same secret stored in Supabase Vault for the daily job (not shown)")
for fn in DEPLOY:
    if SKIP_FN: say(f"  (test target) would deploy {fn}" + ("" if before[fn] else " --no-verify-jwt")); continue
    p = subprocess.run([SUPA, "functions", "deploy", fn, "--project-ref", REF, "--use-api"] + ([] if before[fn] else ["--no-verify-jwt"]),
                       cwd=os.path.dirname(os.path.dirname(FNROOT)), env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
    if p.returncode != 0: bad(f"{fn} deploy failed: " + (p.stderr or p.stdout)[-300:]); say("  STOP. Tell Claude today."); done(7)
    say(f"  ✓ {fn} deployed")
after = {fn: verify_jwt(fn) for fn in DEPLOY}
if after != before: bad("how a function checks callers changed: " + str(after)); done(7)
say("  ✓ all three check callers at the platform exactly as before")
new_url = old_url.split("?", 1)[0]
keep = [p for p in (old_url.split("?", 1)[1].split("&") if "?" in old_url else []) if p and not p.startswith("token=")]
if keep: new_url += "?" + "&".join(keep)
command = ("select net.http_post(url := " + lit(new_url) + ", headers := jsonb_build_object('Content-Type', 'application/json', "
           "'Authorization', " + lit("Bearer " + ANON) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
           "body := '{}'::jsonb, timeout_milliseconds := 120000);")
ok, r = sql(f"select cron.schedule({lit(JOB)}, {lit(job['schedule'])}, {lit(command)}) as id")
if ok and r and job["active"] is False: sql(f"select cron.alter_job({int(r[0]['id'])}, active := false)")   # a paused job stays paused
ok2, j2 = sql(f"select schedule, active, command from cron.job where jobname = {lit(JOB)}")
if not ok or not ok2 or not j2: bad("the daily job could not be updated: " + str(r)[:200]); done(8)
j2 = j2[0]; cmd = j2["command"] or ""
if j2["schedule"] == job["schedule"] and j2["active"] == job["active"] and "vault.decrypted_secrets" in cmd and "x-cron-secret" in cmd and "token=" not in cmd and CRON_SECRET not in cmd:
    say(f"  ✓ {JOB} now reads its secret from Vault at run time: same schedule ({j2['schedule']}), {'active' if j2['active'] else 'paused'} as before, no token in its URL, the secret itself not in the job")
else: bad(f"{JOB} does not look as intended after the update")
say()

# ── Part 3 · live proof ────────────────────────────────────────────────────────
say("PART 3 · LIVE PROOF (no client, family or audience data is read or printed; nothing is sent)")
F = lambda fn, q="": f"{FNB}/functions/v1/{fn}{q}"
def call(fn, q="", body=None, auth=None, extra=None):
    h = {"apikey": ANON}
    if auth: h["Authorization"] = "Bearer " + auth
    h.update(extra or {})
    s, b = http("POST", F(fn, q), body if body is not None else {}, h, timeout=60)
    return s, b
def expect(label, s, b, codes, key=None, val=None):
    good = s in codes and (key is None or jget(b, key) == val)
    leaked = any(x in (b or "") for x in ('"recipients"', '"would_reach"', '"results"'))
    if good and not leaked: say(f"  ✓ {label}: {s}")
    else: bad(f"{label}: got {s}" + (" and the answer contained data" if leaked else ""))
ok, circ = sql("select id::text as id from care_circles where active limit 1")
CIRCLE = circ[0]["id"] if ok and circ else "00000000-0000-0000-0000-000000000000"
say("  Audience lookup (campaign-auto)")
s, b = call("campaign-auto", "?resolve=__proof_nonexistent__"); expect("no sign-in → refused", s, b, (401,))
s, b = call("campaign-auto", "?token=" + PUBLIC + "&resolve=__proof_nonexistent__"); expect("old public page token → refused", s, b, (401,))
s, b = call("campaign-auto", "?token=" + PUBLIC + "&resolve=__proof_nonexistent__", auth=ANON); expect("public anon key as a sign-in → refused", s, b, (401,))
say("  Manual campaign send (campaign-send)")
probe_body = {"auth_check": True, "subject": "", "html": "", "recipients": []}   # even an old build would refuse this empty send
s, b = call("campaign-send", "", probe_body); expect("no sign-in → refused (not usable as an email relay)", s, b, (401,))
s, b = call("campaign-send", "?token=" + PUBLIC, probe_body); expect("old public page token → refused", s, b, (401,))
s, b = call("campaign-send", "?token=" + PUBLIC, probe_body, auth=ANON); expect("public anon key as a sign-in → refused", s, b, (401,))
say("  Family Circle (circle-send), using a REAL circle id (not printed)")
cb = {"circle_id": CIRCLE, "auth_check": True, "dry": True}
s, b = call("circle-send", "", cb); expect("no sign-in, knowing the circle id → refused", s, b, (401,))
s, b = call("circle-send", "?token=" + PUBLIC, cb); expect("old public page token → refused", s, b, (401,))
s, b = call("circle-send", "", cb, auth=ANON); expect("public anon key as a sign-in → refused", s, b, (401,))
say("  Scheduled campaign (server-only path)")
s, b = call("campaign-auto", "?auth_check=1", extra={"x-cron-secret": "x" * 64}); expect("a wrong server secret → refused", s, b, (401,))
s, b = call("campaign-auto", "?auth_check=1", extra={"x-cron-secret": PUBLIC}); expect("the public page token as the server secret → refused", s, b, (401,))
ok, rq = sql("select net.http_post(url := " + lit(F("campaign-auto", "?auth_check=1")) + ", headers := jsonb_build_object('Content-Type', 'application/json', "
             "'Authorization', " + lit("Bearer " + ANON) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), body := '{}'::jsonb) as id")
got = None; waited = 0.0
while ok and rq and waited <= POLL_MAX:
    ok3, rr = sql(f"select status_code, content from net._http_response where id = {int(rq[0]['id'])}")
    if ok3 and rr: got = rr[0]; break
    time.sleep(POLL); waited += POLL
if got and got["status_code"] == 200 and jget(got["content"], "authorized") == "server":
    say("  ✓ from the database, the way the daily job calls, with the Vault secret → accepted as the scheduled run (check only; nothing ran)")
else: bad("the scheduled path from the database was not accepted: " + (f"HTTP {got['status_code']}" if got else "no answer"))
say("  The Hub")
s, live = http("GET", HUB_URL, headers={"Cache-Control": "no-cache"}, timeout=60)
if CRON_SECRET in (live or "") or CRON_SECRET in hub_src: bad("the server-only secret appears in the Hub page")
else: say("  ✓ the server-only secret is not in the Hub (live page or source); it exists only in Vault and the function secrets")
if "campaign-send?token" in (live or ""): say("  ○ the live Hub page still sends the public token to campaign-send: the Hub update has not reached the site yet (the server already refuses it)")
elif s == 200: say("  ✓ the live Hub no longer sends the public token to the campaign tools")
else: say(f"  ○ could not load the live Hub page (HTTP {s}); the server-side refusals above are the real boundary")
say("  As you, signed in for under a minute (a one-time sign-in link, never emailed)")
s, b = http("POST", f"{FNB}/auth/v1/admin/generate_link", {"type": "magiclink", "email": PROOF_EMAIL}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
th = jget(b, "hashed_token") or jget(b, "properties", "hashed_token")
at = None
for typ in ("magiclink", "email"):
    if at or not th: break
    s2, b2 = http("POST", f"{FNB}/auth/v1/verify", {"type": typ, "token_hash": th}, {"apikey": ANON})
    at = jget(b2, "access_token")
if not at: bad(f"could not sign in as you for the permission check (HTTP {s}); the refusals above still stand")
else:
    SECRET_VALUES.append(at)
    s, b = call("campaign-auto", "?auth_check=1", auth=at); expect("audience lookup check as you (owner/admin) → permitted, nothing read", s, b, (200,), "authorized", "staff")
    s, b = call("campaign-send", "", {"auth_check": True}, auth=at); expect("manual send check as you → permitted, nothing sent", s, b, (200,), "authorized", True)
    s, b = call("circle-send", "", {"circle_id": CIRCLE, "auth_check": True}, auth=at); expect("Family Circle check as you → permitted, nothing sent", s, b, (200,), "authorized", True)
    s, b = call("campaign-auto", "", auth=at); expect("even you cannot run the scheduled SEND from outside the schedule → refused", s, b, (403,))
    s, _ = http("POST", f"{FNB}/auth/v1/logout?scope=local", {}, {"apikey": ANON, "Authorization": "Bearer " + at})
    say("  ✓ that sign-in was signed out" if s in (200, 204) else f"  ○ sign-out answered HTTP {s}; that session expires on its own within the hour")
say("  ○ a signed-in account WITHOUT the role is proven refused in the test harness (33/33); proving it live would need a")
say("    temporary account or signing in as a coworker, which this does not do")
say()
say("RESULT: " + ("CLOSED · the public token no longer opens campaign audiences, campaign sending or Family Circle sending" if not fails else "CHECK THE ✗ LINES ABOVE"))
done(0 if not fails else 9)
