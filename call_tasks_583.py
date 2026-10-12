#!/usr/bin/env python3
# 583 · CALL FOLLOW-UP CARDS, PRACTICE (slice A; Samantha approved 2026-10-12, "yes to all four, build"). Hub project.
#   PART 1 (read only): the reviewed build (fingerprints), the tests on her Mac, the secrets and the vault secret the
#     reader needs, the pieces it stands on (call_pull_seen, the identity layer, the office test), call-pull's gateway.
#   PART 2 (one transaction): call_tasks_583.sql: the readings table (append-only, office read) and call_who().
#   PART 3: call-tasks deployed, fingerprint-checked, with call-pull's gateway setting.
#   PART 4: practice ON (ops_settings.call_tasks_practice, the Owners Hub switch), reading from 3 days ago, and the
#     10-minute schedule (5 minutes after call-pull) with the jobs' vault secret.
#   PART 5 (proof): the public key is refused; its schedule gets in; a first run reads the last 3 days of calls; what it
#     would have made is listed below; NOTHING was added to Work; no transcript, phone or email is kept.
# Nothing is sent to anyone. No card is made. Each call read costs a few cents (Claude Sonnet 5.5).
import os, json, re, shutil, subprocess, time, datetime as dt
os.environ.setdefault("SB_STEP", "583")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; BASE = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
JOB = "call-tasks"; SCHEDULE = "5-59/10 * * * *"; VAULT = "hub_job_secret"
POLL, POLL_MAX = float(os.environ.get("SB_POLL", "2")), float(os.environ.get("SB_POLL_MAX", "40"))
def command(url, anon):
    return ("select net.http_post(url := " + lit(url) + ", headers := jsonb_build_object('Content-Type', 'application/json', "
            "'Authorization', " + lit("Bearer " + anon) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT) + ")), "
            "body := '{}'::jsonb, timeout_milliseconds := 150000);")
def jl(b):
    try: return json.loads(b)
    except Exception: return {}
start("CALL FOLLOW-UP CARDS, PRACTICE")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
for f, want in json.loads(os.environ.get("SB_SQL_SHAS", "{}")).items():
    p_ = os.path.join(ROOT, f)
    (say if os.path.exists(p_) and sha(p_) == want else bad)((f"  ✓ {f} is the reviewed version") if os.path.exists(p_) and sha(p_) == want else f"{f} is not the reviewed version: nothing runs")
if fails or not os.environ.get("SB_SQL_SHAS"): say("  RESULT: STOPPED before anything changed."); done(2)
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if NODE:
    p = subprocess.run([NODE, "call_tasks_583_test.mjs"], cwd=ROOT, capture_output=True, text=True)
    last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
    if p.returncode != 0 or re.search(r"^FAIL", p.stdout, re.M): bad(f"call_tasks_583_test.mjs failed: {last}"); say("  STOP. Nothing was changed."); done(2)
    say(f"  ✓ call_tasks_583_test.mjs: {last.strip()}")
else: say("  · node is not on this Mac, so the tests were not re-run here (they passed when built)")
s_, b_ = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
names = {x.get("name") for x in (jl(b_) if s_ == 200 and isinstance(jl(b_), list) else [])}
need = {"ANTHROPIC_API_KEY", "GHL_LOCATION_ID", "HUB_JOB_SECRET"}
ok_, vs = sql(REF, f"select count(*)::int as n from vault.decrypted_secrets where name = {lit(VAULT)}")
if not need <= names or not ({"GHL_TOKEN", "GHL_API_KEY"} & names) or not (ok_ and vs and vs[0]["n"] == 1):
    bad("a needed secret is missing (" + ", ".join(sorted((need | {"GHL_TOKEN"}) - names)) + ("" if ok_ and vs and vs[0]["n"] == 1 else ", the jobs' vault secret") + "). Nothing was changed."); done(3)
say("  ✓ the AI key, the GoHighLevel key and location, and the jobs' secret (function and vault) are there")
ok_, pre = sql(REF, "select to_regclass('public.call_pull_seen') is not null as seen, to_regclass('public.phone_index') is not null and to_regclass('public.person_identity') is not null as ident, "
               "to_regprocedure('public.hub_office_ok()') is not null as office, (select count(*)::int from public.call_pull_seen where call_at > now() - interval '3 days' and stage in ('done','practice')) as recent, "
               "to_regclass('public.call_task_reading') is not null as already")
pre = pre[0] if ok_ and pre else {}
(say if pre.get("seen") and pre.get("ident") and pre.get("office") else bad)(("  ✓ the calls the Hub already fetched, the identity layer and the office test are there" ) if pre.get("seen") and pre.get("ident") and pre.get("office") else f"a piece it stands on is missing: {pre}")
say(f"  · answered calls in the last 3 days, ready to read: {pre.get('recent', '?')}" + ("; 583 ran before (running it again is safe)" if pre.get("already") else ""))
ok_, lv = sql(REF, "select data->>'call_tasks_live' as live from public.app_data where key = 'ops_settings'")
if ok_ and lv and lv[0]["live"] == "true": bad("call_tasks_live is on, but nothing reads it yet; it should be off until slice C (turn it off, then run this again)")
sP, mP = fmeta(REF, "call-pull")
VJ = (mP or {}).get("verify_jwt")
(say if sP == 200 and isinstance(VJ, bool) else bad)((f"  ✓ call-pull is live (gateway sign-in check {'on' if VJ else 'off'}); call-tasks gets the same") if sP == 200 and isinstance(VJ, bool) else f"call-pull is not readable ({sP})")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE (one transaction)")
okr, r_ = sql(REF, open(os.path.join(ROOT, "call_tasks_583.sql")).read())
if not okr: bad(f"the readings table could not be installed (one transaction, so nothing changed): {str(r_)[:300]}"); say("  RESULT: STOPPED. Tell Claude."); done(5)
say("  ✓ the readings table (append-only, office read) and the number lookup are in place")

say(); say("PART 3 · THE READER")
if not deploy(REF, FNROOT, JOB, VJ): say("  RESULT: STOPPED. The table stays (harmless); nothing reads calls yet. Tell Claude."); done(6)

say(); say("PART 4 · PRACTICE ON, AND ITS SCHEDULE")
since = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=3)).strftime("%Y-%m-%dT%H:%M:%SZ")
ok_, st = sql(REF, "update public.app_data set data = data || jsonb_build_object('call_tasks_practice', true) || "
              "case when data ? 'call_tasks_since' then '{}'::jsonb else jsonb_build_object('call_tasks_since', " + lit(since) + ") end "
              "where key = 'ops_settings' returning data->>'call_tasks_practice' as p, data->>'call_tasks_since' as s, data->>'call_tasks_live' as live")
(say if ok_ and st and st[0]["p"] == "true" else bad)((f"  ✓ practice reading is ON (Owners Hub Admin page, Calls); it reads from {str(st[0]['s'])[:16]} UTC on. Cards in Work: OFF (that is slice C)") if ok_ and st and st[0]["p"] == "true" else f"could not turn practice on: {st}")
s_, kb = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG())
keys = {k.get("name"): k.get("api_key", "") for k in (jl(kb) if isinstance(jl(kb), list) else [])}
ANON, SVC = keys.get("anon", ""), keys.get("service_role", ""); HIDE += [ANON, SVC]
URL = f"{BASE}/functions/v1/{JOB}"
sql(REF, f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
ok_, r_ = sql(REF, f"select cron.schedule({lit(JOB)}, {lit(SCHEDULE)}, {lit(command(URL, ANON))}) as id")
ok2, jb = sql(REF, f"select schedule, command from cron.job where jobname = {lit(JOB)}")
g = ok_ and ok2 and jb and jb[0]["schedule"] == SCHEDULE and "x-cron-secret" in jb[0]["command"]
(say if g else bad)(("  ✓ " if g else "") + "its schedule: every 10 minutes, 5 minutes after call-pull, carrying the jobs' secret from the vault")
if fails: say("  RESULT: STOPPED. Tell Claude."); done(7)

say(); say("PART 5 · PROOF AND THE FIRST READING (nothing is created or sent)")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
ok_, ops0 = sql(REF, "select md5(data::text) as m, jsonb_array_length(data) as n from public.app_data where key = 'ops_items'")
a1 = http("POST", URL + "?auth_check=1", {}, {"apikey": ANON, "Authorization": "Bearer " + ANON})[0]
(say if a1 == 401 else bad)(("  ✓ " if a1 == 401 else "") + f"the reader refuses the public key ({a1})")
ok_, rq = sql(REF, command(URL + "?auth_check=1", ANON).rstrip(";") + " as id")
got = None; waited = 0.0
while ok_ and rq and waited <= POLL_MAX:
    ok3, rr = sql(REF, f"select status_code, content from net._http_response where id = {int(rq[0]['id'])}")
    if ok3 and rr: got = rr[0]; break
    time.sleep(POLL); waited += POLL
g = got and got["status_code"] == 200 and jl(got["content"]).get("caller") == "cron"
(say if g else bad)(("  ✓ " if g else "") + "its schedule gets in" + ("" if g else f" ({got['status_code'] if got else 'no answer'})"))
total = {"read": 0, "cards": 0, "errors": 0}
for i in range(12):   # the last 3 days, 6 calls a run (each run stays well inside the function's time limit)
    sR, bR = http("POST", URL, {"limit": 6}, {"apikey": SVC, "Authorization": "Bearer " + SVC}, 300)
    j = jl(bR)
    if sR != 200 or not j.get("ok"): bad(f"a reading run did not answer as expected ({sR}): {str(j.get('error') or bR)[:160]}"); break
    for k in total: total[k] += int(j.get(k, 0) or 0)
    if not j.get("read"): break
say(f"  ✓ first reading: {total['read']} call(s) read, {total['cards']} card(s) it would have made" + (f", {total['errors']} could not be read (listed below)" if total["errors"] else ""))
ok_, rows = sql(REF, "select to_char(call_at at time zone 'America/Chicago', 'Dy Mon DD HH12:MI am') as t, direction, caller, who_name, call_type, tasks, no_task_reason, error, resolves "
                "from public.call_task_reading where version = (select max(version) from public.call_task_reading) order by call_at")
for r in rows or []:
    who = r["who_name"] or r["caller"] or "unknown number"
    say(f"    {r['t']} · {'they called' if r['direction'] == 'in' else 'we called'} · {who} ({r['call_type']})")
    if r["error"]: say(f"        could not read: {r['error']}")
    for t_ in r["tasks"] or []: say(f"        WOULD MAKE: {t_.get('title')}" + (f"  (due {t_.get('due')})" if t_.get("due") else ""))
    if not (r["tasks"] or r["error"]): say(f"        no card: {r['no_task_reason'] or ''}")
    if r["resolves"]: say(f"        answers {len(r['resolves'])} earlier card(s)")
ok_, ops1 = sql(REF, "select md5(data::text) as m, jsonb_array_length(data) as n from public.app_data where key = 'ops_items'")
ok4, mine = sql(REF, "select count(*)::int as n from public.app_data a, jsonb_array_elements(a.data) x where a.key = 'ops_items' and (x->>'created_by' = 'call-tasks' or x->>'kind' = 'call_followup')")
g = ok4 and mine and mine[0]["n"] == 0
(say if g else bad)(("  ✓ " if g else "") + ("NOTHING was added to Work by the reader (no call follow-up card exists)" if g else f"{mine[0]['n'] if mine else '?'} call follow-up card(s) exist in Work: tell Claude"))
if ok_ and ops0 and ops1 and ops0[0]["m"] != ops1[0]["m"]: say(f"  · Work changed while this ran ({ops0[0]['n']} to {ops1[0]['n']} cards): the office or the other jobs; none are from the reader (above)")
ok5, leak = sql(REF, "select count(*)::int as n from public.call_task_reading where tasks::text ~ '\\d{3}[\\s.-]?\\d{3}[\\s.-]?\\d{4}' or tasks::text ~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}'")
(say if ok5 and leak and leak[0]["n"] == 0 else bad)(("  ✓ no phone number or email is kept in any reading" if ok5 and leak and leak[0]["n"] == 0 else f"a reading holds a phone number or email ({leak}): tell Claude"))
sC, bC = http("GET", f"{BASE}/rest/v1/call_task_reading?select=message_id&limit=1", None, {"apikey": ANON, "Authorization": "Bearer " + ANON})
g = sC != 200 or bC.strip() in ("[]", "")
(say if g else bad)(("  ✓ " if g else "") + f"the public cannot read the readings ({sC})")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · practice is on. Open the Hub, My Work, \"Call follow-ups (practice)\" (once the Hub update is live) to compare the AI's cards with the ones people made. After a week, tell Claude what you see.")
say("Rollback (only if ever needed): turn practice off on the Owners Hub Admin page (Calls), Claude unschedules call-tasks, then call_tasks_583_rollback.sql.")
done(0)
