#!/usr/bin/env python3
# 600 · STAFF TRAINING WALKTHROUGH (Samantha 2026-10-11: "I would like for our staff to also put their info in to experience it,
# as a training, set up inside the applicant journey tab"; "yes to all": any office staff, through the welcome call, ends by
# itself after 14 days, records shown with "(TRAINING)"). Hub project. Adds three server-only database doors (the test list in one
# statement, and the Hub side of ending a walkthrough), deploys the new training-walkthrough service and step1-sign (its card says
# TRAINING), and schedules the daily sweep that ends walkthroughs after 14 days. Needs 598 and 601 first (the test list is how a
# walkthrough's messages reach the staff member). Nothing is sent; no existing record changes; nobody is on a walkthrough yet.
import os, json, subprocess, hashlib
os.environ.setdefault("SB_STEP", "600")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FNS = ["training-walkthrough", "step1-sign"]
JOB = "training-walkthrough-sweep"; SCHEDULE = "0 14 * * *"; VAULT_NAME = "hub_job_secret"
_HIST = {}
def in_history(rel, live_sha):
    if not live_sha: return False
    if rel not in _HIST:
        shas = set()
        try:
            for c in subprocess.run(["git", "-C", ROOT, "log", "--format=%H", "--", rel], capture_output=True, text=True, timeout=120).stdout.split():
                b = subprocess.run(["git", "-C", ROOT, "show", f"{c}:{rel}"], capture_output=True, timeout=60).stdout
                if b: shas.add(hashlib.sha256(b).hexdigest())
        except Exception: pass
        _HIST[rel] = shas
    return live_sha in _HIST[rel]
short = lambda ks: ', '.join(d.split('/')[-2] + '/' + d.split('/')[-1] for d in ks[:4])
def lit(v): return "'" + str(v).replace("'", "''") + "'"
start("STAFF TRAINING WALKTHROUGH")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
VJ = {}
for fn in FNS:
    sx, mx = fmeta(REF, fn)
    if sx == 404 and fn == "training-walkthrough": VJ[fn] = True; say(f"  · {fn} is new; deployed with the gateway sign-in check on (the Hub calls it with your sign-in; the sweep with the job secret)"); continue
    if not (sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool)): bad(f"{fn} is not live or unreadable: {sx}"); continue
    VJ[fn] = mx["verify_jwt"]
    okl, livef = live_files(REF, fn)
    if not okl: bad(f"could not read {fn}'s live files"); continue
    differ = [k for k in need(FNROOT, fn) if livef.get(k) != sha(os.path.join(ROOT, k))]
    unknown = [k for k in differ if livef.get(k) is not None and not in_history(k, livef.get(k))]
    if unknown: bad(f"{fn}'s live copy holds {short(unknown)} in a version that was never on main (someone's unmerged work); deploying would overwrite it. Tell Claude.")
    else: say(f"  ✓ {fn} is live at version {mx.get('version', '?')}" + (f": brought up to main ({short(differ)})" if differ else ""))
okl, livef = live_files(REF, "outreach-check")
if okl and any(k.endswith("_shared/test-people.ts") for k in livef): say("  ✓ 598 is in (the Hub tells Training the test list)")
else: bad("598 has not run yet (outreach-check does not know the test list). Run 598 first.")
ok_, st = sql(REF, "select coalesce(data->'test_people', '{}'::jsonb) as tp, (select count(*)::int from vault.decrypted_secrets where name = 'hub_job_secret') as vault from public.app_data where key = 'ops_settings'")
if ok_ and st:
    say(f"  · the test list now: {len(st[0]['tp'].get('phones') or [])} phone(s), {len(st[0]['tp'].get('emails') or [])} email(s) (each walkthrough adds its own and takes it off again)")
    say("  ✓ the job secret is in the Vault") if int(st[0]['vault']) == 1 else bad("the Vault does not hold hub_job_secret (tell Claude)")
else: bad(f"could not read the settings: {st}")
s_, b_ = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
try: names = {x.get("name") for x in (json.loads(b_) if s_ == 200 else [])}
except Exception: names = set()
miss = [n for n in ("OFFERS_PROJECT_URL", "OFFERS_SERVICE_ROLE_KEY", "HUB_JOB_SECRET") if n not in names]
say("  ✓ the service's settings are there (the Training connection and the job secret; values not read)") if not miss else bad(f"the project is missing the setting(s) {', '.join(miss)} (tell Claude)")
SQLF = os.path.join(ROOT, "supabase", "training-walkthrough.sql")
if not os.path.exists(SQLF): bad("the SQL file is not in the reviewed build")
s_, b_ = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG()); ANON = ""
try:
    arr = json.loads(b_) if s_ == 200 else []
    if isinstance(arr, dict): arr = arr.get("keys") or []
    ANON = next((k.get("api_key") for k in arr if isinstance(k, dict) and k.get("name") == "anon" and str(k.get("api_key", "")).startswith("eyJ")), "")
except Exception: ANON = ""
if ANON: HIDE.append(ANON); say("  ✓ the project's public key is readable (the schedule needs it)")
else: bad("could not read the project's public key for the schedule")
ok_, c = sql(REF, "select (select count(*)::int from public.client_journey) as j, (select count(*)::int from public.welcome_calls) as w, (select jsonb_array_length(data) from public.app_data where key = 'candidates') as cands")
say("  · what changes: three database doors, one new service, step1-sign updated, one daily schedule. Nothing is sent; no record changes.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say(); say("PART 2 · CHANGE")
ok_, r_ = sql(REF, open(SQLF).read())
if not ok_: bad(f"the database doors did not install: {r_}"); done(5)
say("  ✓ the database doors are in (server only; a browser cannot call them)")
for fn in FNS:
    if not deploy(REF, FNROOT, fn, VJ[fn]): say("  RESULT: STOPPED. Tell Claude."); done(6)
FNB = f"https://{REF}.supabase.co"
command = ("select net.http_post(url := " + lit(f"{FNB}/functions/v1/training-walkthrough") + ", headers := jsonb_build_object('Content-Type', 'application/json', "
           "'Authorization', " + lit("Bearer " + ANON) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
           "body := '{\"action\": \"sweep\"}'::jsonb, timeout_milliseconds := 120000);")
sql(REF, f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
ok_, r_ = sql(REF, f"select cron.schedule({lit(JOB)}, {lit(SCHEDULE)}, {lit(command)}) as id")
say(f"  ✓ {JOB} scheduled ({SCHEDULE} UTC, about 9am Central): it ends any walkthrough past its 14 days") if ok_ else bad(f"the schedule did not install: {r_}")
say(); say("PART 3 · PROOF (nothing is sent or changed)")
s_, b_ = http("POST", f"{FNB}/functions/v1/training-walkthrough", {"action": "list"}, {"apikey": ANON, "Authorization": "Bearer " + ANON})
say(f"  ✓ the walkthrough service refuses a caller who is not signed-in staff ({s_})") if s_ in (401, 403) else bad(f"list without a staff sign-in answered {s_}")
s_, b_ = http("POST", f"{FNB}/functions/v1/training-walkthrough", {"action": "sweep"}, {"apikey": ANON, "Authorization": "Bearer " + ANON})
say(f"  ✓ the sweep refuses a caller without the job secret ({s_})") if s_ in (401, 403) else bad(f"sweep without the secret answered {s_}")
s_, b_ = http("POST", f"{FNB}/functions/v1/step1-sign", {"action": "progress"}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ step1-sign answers ({s_})") if s_ and s_ < 500 else bad(f"step1-sign answered {s_}")
ok_, pr = sql(REF, "select count(*)::int as n from information_schema.routine_privileges where routine_schema = 'public' and routine_name in ('test_people_add', 'test_people_remove', 'training_walkthrough_close', 'tw_card_hit') and grantee in ('anon', 'authenticated', 'PUBLIC')")
say("  ✓ no browser can call the database doors") if ok_ and int(pr[0]['n']) == 0 else bad(f"door privileges: {pr}")
ok_, j = sql(REF, f"select schedule, active from cron.job where jobname = {lit(JOB)}")
say(f"  ✓ the schedule is on ({j[0]['schedule']})") if ok_ and j and j[0]['active'] else bad(f"schedule: {j}")
ok_, c2 = sql(REF, "select (select count(*)::int from public.client_journey) as j, (select count(*)::int from public.welcome_calls) as w, (select jsonb_array_length(data) from public.app_data where key = 'candidates') as cands")
say(f"  ✓ nothing else changed (readiness cards {c[0]['j']} → {c2[0]['j']}, welcome calls {c[0]['w']} → {c2[0]['w']}, applicant records {c[0]['cands']} → {c2[0]['cands']})") if ok_ and c2[0] == c[0] else bad(f"after: {c2}")
say("  · tested before deploying: the database doors (17 checks in a real Postgres), the service (35: start, its refusals, end, the owner, the 14-day sweep, only what it added comes off the test list, never another offer), Step 1 signing (67) and the Hub card (12).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the service is in. When the Hub change is merged, the Applicant journey tab shows 'Try the new-hire journey yourself'. Nothing was sent."); done(0)
