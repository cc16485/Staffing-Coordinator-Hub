#!/usr/bin/env python3
# 482 · CLIENT JOURNEY, INSTALLED AND SWITCHED OFF, WITH THREE TEST CLIENTS (Stages 1-3, Samantha approved 2026-10-06).
# Installs the ONE journey per person: the step catalog (data, editable later), the journey tables, the permanent
# history, the private proof-file store, and the client-journey service that every change goes through. Schedules its
# 10-minute check (it does nothing while the switch is off). Adds three made-up TEST clients assigned to Samantha
# (Linda Boyd, Medicaid · Pat Pay, Private Pay · Vic Vet, VA) so she can try the whole experience before anyone else.
# The switch client_journey_live stays OFF: Care Coordinators see nothing new; only an owner, only on a TEST client.
# Part 1 (read only): the reviewed build; the vault secret; what is there. Part 2: install. Part 3: proof.
# Nothing is texted or emailed. Nothing in AxisCare changes. No real lead or client gets a journey yet.
import json, os, re, hashlib, subprocess, urllib.request, urllib.error, datetime as dt, sys, time
REPORT = os.environ["SB_REPORT"]; FNROOT = os.environ["SB_FNROOT"]; SHAS = json.loads(os.environ.get("SB_FN_SHAS", "{}"))
TOKEN = os.environ.get("SB_TOKEN", "").strip().strip('"').strip("'"); REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
SUPA = os.environ.get("SB_SUPA_CLI", ""); API = os.environ.get("SB_API_BASE", "https://api.supabase.com"); FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
lines = []; fails = []; HIDE = []
def say(s=""):
    s = str(s)
    for v in HIDE: s = s.replace(v, "(hidden)")
    s = re.sub(r"(sbp_|eyJ|sb_secret_|sb_publishable_)[A-Za-z0-9._\-]+", "(hidden)", s); print(s, flush=True); lines.append(s)
def bad(s): say("  ✗ " + s); fails.append(s)
def done(code): open(REPORT, "w").write("\n".join(lines) + "\n"); raise SystemExit(code)
def _crash(t, e, tb):
    say(); say("  ✗ STOPPED unexpectedly: " + type(e).__name__ + ": " + str(e)[:200]); say("  Nothing was sent to anyone. Tell Claude.")
    try: open(REPORT, "w").write("\n".join(lines) + "\n")
    except Exception: pass
sys.excepthook = _crash
def http(method, url, body=None, headers=None, timeout=400):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method,
        headers=dict({"Content-Type": "application/json", "User-Agent": "cc-473/1.0"}, **(headers or {})))
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r: return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e: return e.code, e.read().decode(errors="replace")
    except Exception as e: return None, type(e).__name__
MG = lambda: {"Authorization": "Bearer " + TOKEN}
def sql(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    if s not in (200, 201): return False, b[:200]
    try: return True, json.loads(b)
    except Exception: return False, b[:200]
def probe(q):
    s, b = http("POST", f"{API}/v1/projects/{REF}/database/query", {"query": q}, MG())
    texts = []
    try:
        j = json.loads(b); texts.append(j.get("message") if isinstance(j, dict) else str(j))
    except Exception: pass
    texts.append(b.replace('\\"', '"'))
    for t in texts:
        if not t or "PROBE_RESULT: " not in t: continue
        try: return json.JSONDecoder().raw_decode(t[t.index("PROBE_RESULT: ") + len("PROBE_RESULT: "):])[0], None
        except Exception: continue
    return None, f"HTTP {s}: {b[:240]}"
def keys():
    s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG())
    try: return {k.get("name"): k.get("api_key", "") for k in json.loads(b)}
    except Exception: return {}
def chk(good, msg): (say if good else bad)(("  ✓ " if good else "") + msg)

lit = lambda v: "'" + str(v).replace("'", "''") + "'"
FN = "client-journey"; JOB = "client-journey-sweep"; SCHEDULE = "*/10 * * * *"; VAULT_NAME = "hub_job_secret"
ROOT = os.path.dirname(os.path.dirname(FNROOT)); CJDIR = os.path.join(ROOT, "client-journey")
SAM = "samantha@mo-care.com"
TEST_LEADS = [
  {"id": "TEST-J1", "is_test": True, "first_name": "Pamela", "last_name": "Boyd", "relationship": "Daughter", "client_first_name": "Linda", "client_last_name": "Boyd (TEST)",
   "funding_source": "medicaid", "client_dob": "1940-02-02", "client_address": "100 Test Street", "client_city": "Springfield", "client_state": "MO", "client_zip": "65802",
   "phone": "0000000000", "status": "Contacted", "assigned_coordinator": SAM, "source": "Test", "interest_notes": "Made-up client for trying the client journey. Nobody is contacted."},
  {"id": "TEST-J2", "is_test": True, "client_first_name": "Pat", "client_last_name": "Pay (TEST)", "funding_source": "private", "status": "New", "assigned_coordinator": SAM, "source": "Test",
   "interest_notes": "Made-up client for trying the client journey. Nobody is contacted."},
  {"id": "TEST-J3", "is_test": True, "client_first_name": "Vic", "client_last_name": "Vet (TEST)", "funding_source": "va", "status": "New", "assigned_coordinator": SAM, "source": "Test",
   "interest_notes": "Made-up client for trying the client journey. Nobody is contacted."}]

say("482 · CLIENT JOURNEY, INSTALLED AND SWITCHED OFF, WITH THREE TEST CLIENTS"); say("Report " + dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")); say()
say("PART 1 · READ ONLY (nothing changes)")
if not TOKEN.startswith("sbp_"): bad("no Supabase access token"); done(2)
for name, want in SHAS.items():
    p_ = os.path.join(CJDIR, name.split("/", 1)[1]) if name.startswith("client-journey/") else os.path.join(FNROOT, "_shared", name.split("/", 1)[1]) if name.startswith("_shared/") else os.path.join(FNROOT, name, "index.ts")
    if hashlib.sha256(open(p_, "rb").read()).hexdigest() != want: bad(f"{name} is not the reviewed build"); say("  STOP. Nothing was run."); done(2)
say("  ✓ the reviewed build (service, rules file, tables, catalog)")
k = keys(); ANON, SVC = k.get("anon", ""), k.get("service_role", "")
if not ANON or not SVC: bad("could not read the project's keys. Nothing was changed."); done(4)
HIDE += [ANON, SVC]
ok, r = sql(f"select count(*)::int as n from vault.decrypted_secrets where name = {lit(VAULT_NAME)}")
if not ok or not r or r[0]["n"] != 1: bad("the scheduled jobs' secret isn't in the vault. Nothing was changed."); done(4)
ok, r = sql("select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name = 'client_journey'")
had = bool(ok and r and r[0]["n"])
say("  · client journey tables: " + ("already there (kept; nothing is wiped)" if had else "new"))
ok, r = sql("select coalesce((data->>'client_journey_live')::boolean, false) as live from public.app_data where key = 'ops_settings'")
live = bool(ok and r and r[0]["live"])
say("  · the switch: " + ("ON (left as it is)" if live else "OFF (stays off: only an owner can try it, only on a TEST client)"))
cat = json.load(open(os.path.join(CJDIR, "catalog-v1.json")))["steps"]
say(f"  · the first catalog: {len(cat)} steps, intake to Active")

say(); say("PART 2 · CHANGE")
ok, r = sql(open(os.path.join(CJDIR, "client-journey.sql")).read())
if not ok: bad("the tables didn't install: " + str(r)[:240]); say("  STOP. Nothing else was changed."); done(5)
say("  ✓ tables, permanent history and the private proof store")
vals = ", ".join(f"({lit(d['key'])}, 1, {lit(json.dumps(d))}::jsonb, true, 'Desktop 482')" for d in cat)
ok, r = sql(f"with ins as (insert into public.client_journey_step_def (key, catalog_version, def, active, updated_by) values {vals} on conflict (key) do nothing returning 1) select count(*)::int as n from ins")
if not ok: bad("the catalog didn't load: " + str(r)[:240]); done(5)
say(f"  ✓ catalog: {r[0]['n']} step(s) added" + (f", {len(cat) - r[0]['n']} already there and kept as they are" if r[0]['n'] < len(cat) else ""))
p = subprocess.run([SUPA, "functions", "deploy", FN, "--project-ref", REF, "--use-api"], cwd=ROOT, env=dict(os.environ, SUPABASE_ACCESS_TOKEN=TOKEN), capture_output=True, text=True)
if p.returncode != 0: bad("deploy failed: " + (p.stderr or p.stdout)[-240:]); say("  STOP."); done(6)
say("  ✓ client-journey service installed (office staff only; every change goes through it)")
command = ("select net.http_post(url := " + lit(f"{FNB}/functions/v1/{FN}") + ", headers := jsonb_build_object('Content-Type', 'application/json', "
           "'Authorization', " + lit("Bearer " + ANON) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
           "body := '{\"action\": \"sweep\"}'::jsonb, timeout_milliseconds := 120000);")
sql(f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
ok, r = sql(f"select cron.schedule({lit(JOB)}, {lit(SCHEDULE)}, {lit(command)}) as id")
chk(ok, "the 10-minute check is scheduled (verifies steps, brings back check-back dates, refreshes My Work; nothing while off)")
ok, r = sql("select data from public.app_data where key = 'leads'")
leads = r[0]["data"] if ok and r else []
leads = json.loads(leads) if isinstance(leads, str) else (leads or [])
new = [l for l in TEST_LEADS if not any(str(x.get("id")) == l["id"] for x in leads if isinstance(x, dict))]
now = dt.datetime.now(dt.timezone.utc).isoformat()
for l in new:
    l = dict(l, created_at=now, updated_at=now)
    ok, r = sql(f"select public.upsert_app_data_item('leads', {lit(json.dumps(l))}::jsonb)")
    if not ok: bad(f"couldn't add the TEST client {l['client_first_name']}: " + str(r)[:160])
say(f"  ✓ TEST clients: {len(new)} added" + (f", {len(TEST_LEADS) - len(new)} already there" if len(new) < len(TEST_LEADS) else "") + " (Linda Boyd · Pat Pay · Vic Vet, each marked TEST, assigned to Samantha)")

say(); say("PART 3 · PROOF (nothing is texted or emailed)")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
s1, _ = http("POST", f"{FNB}/functions/v1/{FN}", {"action": "list"}, {"apikey": ANON, "Authorization": "Bearer " + ANON})
chk(s1 in (401, 403), f"a page without a staff sign-in is refused ({s1})")
s2, _ = http("OPTIONS", f"{FNB}/functions/v1/{FN}", None, {"Origin": "https://cc.mo-care.com", "Access-Control-Request-Method": "POST"})
chk(s2 in (200, 204), f"the browser's preflight is answered ({s2})")
s3, b3 = http("POST", f"{FNB}/functions/v1/{FN}", {"action": "sweep"}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
try: j3 = json.loads(b3)
except Exception: j3 = {}
chk(s3 == 200 and (j3.get("live") is False or live), "the 10-minute check answers, and does nothing while the switch is off")
ok, r = sql("select count(*)::int as n from information_schema.role_table_grants where grantee in ('anon', 'authenticated') and table_name like 'client_journey%'")
chk(ok and r and r[0]["n"] == 0, "nobody signed in to the Hub can read or change the journey tables directly")
ok, r = sql("select count(*)::int as n from public.client_journey_step_def where active")
chk(ok and r and r[0]["n"] >= len(cat), f"the catalog reads back ({r[0]['n'] if ok and r else '?'} steps)")
ok, r = sql("select count(*)::int as n from public.client_journey where not is_test")
chk(ok and r and r[0]["n"] == 0, "no real lead or client has a journey yet")
say()
say("RESULT: " + ("DONE · Open Leads, find Linda Boyd (TEST), Pat Pay (TEST) or Vic Vet (TEST), and tap Start a TEST journey." if not fails else "CHECK THE ✗ LINES."))
say("The switch is off: Care Coordinators see nothing new until the move-over step. Nothing was texted or emailed.")
done(0 if not fails else 8)
