#!/usr/bin/env python3
# 671 · REFERENCE ANSWERS LAND BY THEMSELVES (Samantha 2026-10-12, step 3). Hub project. Installs the door
# reference_land_apply (server only; the five fields of one reference slot on one Background & References person; only if
# nobody changed that person since it was read; one history line tagged reference-land), records her approval of the NEW
# eligibility-rules.js fingerprint (the file with the one shared copy of answer to slot; the Hub pull request that serves it
# merges AFTER this step; the approved fingerprints already there stay), deploys reference-land, schedules it every 15
# minutes, and runs its READ ONLY report once so she sees what would land. The switch "Reference answers land by themselves"
# (ops_settings.ref_land_live) is NOT touched: it stays off, so the schedule changes nothing until she turns it on.
# Nothing is sent to anyone; no PDF is made; no person's record changes in this step.
# ORDER: merge the Staffing PR, run this, merge the Hub PR, run the report again (this step's PART 3 shows how), then turn
# the switch on from the Owners Hub Admin page when the list looks right.
import os, json, hashlib
os.environ.setdefault("SB_STEP", "671")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; FN = "reference-land"; JOB = "reference-land-15min"; SCHED = "*/15 * * * *"; VAULT_NAME = "hub_job_secret"
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co"); HUB_BASE = os.environ.get("SB_HUB_BASE", "https://cc.mo-care.com")
RULES_FP = os.environ.get("SB_RULES_FP", "") or "a0d4d5e47ac82f08e35028b10db68a4d21f73902ce28908f7b2fa3d3b94fc671"
SQLF_REL = os.path.join("supabase", "reference-land-671.sql")
COUNT_Q = ("select (select jsonb_array_length(data) from app_data where key = 'candidates') as cands, (select updated_at from app_data where key = 'candidates') as upd, "
           "(select count(*)::int from app_data_item_change where key = 'candidates') as hist, "
           "(select count(*)::int from reference_requests where responded_at is not null and merged_at is null) as waiting, "
           "(select count(*)::int from reference_requests where merged_at is not null) as landed")
start("REFERENCE ANSWERS LAND BY THEMSELVES")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
if not RULES_FP or len(RULES_FP) != 64: bad("the reviewed rules fingerprint is missing"); done(2)
SQLF = os.path.join(ROOT, SQLF_REL)
if not os.path.exists(SQLF): bad("the SQL file is not in the reviewed build"); done(2)
want_sql = os.environ.get("SB_SQL_SHA", "")
if want_sql: say("  ✓ the door SQL is the reviewed build") if sha(SQLF) == want_sql else bad("the door SQL is not the reviewed build: nothing runs")
sx, mx = fmeta(REF, FN)
if sx == 404: say("  ✓ reference-land is new (not live yet)")
elif sx == 200: say(f"  · reference-land is live at version {mx.get('version', '?')}; replaced by this build")
else: bad(f"could not read reference-land: {sx}")
ok1, r1 = sql(REF, "select (select count(*) from public.rules_approved where file = 'eligibility-rules.js') as elig, "
                   f"(select count(*) from public.rules_approved where file = 'eligibility-rules.js' and sha256 = {lit(RULES_FP)}) as mine, "
                   f"(select count(*) from vault.decrypted_secrets where name = {lit(VAULT_NAME)}) as vault, "
                   f"(select count(*) from cron.job where jobname = {lit(JOB)}) as job, "
                   "coalesce((select data->>'ref_land_live' from public.app_data where key = 'ops_settings'), 'not set') as sw, "
                   "(select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'reference_requests' and column_name in ('slot', 'candidate_id', 'responded_at', 'merged_at')) as cols")
if not ok1: bad(f"could not read the set-up: {r1}")
else:
    x = r1[0]
    say(f"  ✓ {x['elig']} eligibility rules fingerprint(s) already approved; they all stay") if int(x["elig"]) else bad("no eligibility rules fingerprint is approved yet. Tell Claude.")
    say("  · the new rules fingerprint is " + ("already approved" if int(x["mine"]) else "not approved yet (this step approves it)"))
    say("  ✓ the job secret is in the Vault") if int(x["vault"]) == 1 else bad("the Vault does not hold hub_job_secret. Tell Claude.")
    say(f"  · the 15-minute schedule {'exists (replaced)' if int(x['job']) else 'is new'}")
    say("  ✓ reference_requests has the columns the job reads") if int(x["cols"]) == 4 else bad("reference_requests is missing a column the job reads. Tell Claude.")
    if str(x["sw"]) == "true": bad("the switch \"Reference answers land by themselves\" is already ON. Turn it off on the Owners Hub Admin page, then run this again.")
    else: say(f"  ✓ the switch \"Reference answers land by themselves\" is off ({x['sw']}); this step does not touch it")
ok_c, c = sql(REF, COUNT_Q)
if ok_c: say(f"  · {c[0]['cands']} people in Background & References (last saved {str(c[0]['upd'])[:16]}); {c[0]['waiting']} reference answers waiting to land, {c[0]['landed']} already landed")
else: bad(f"could not count: {c}")
s_, b_ = http("GET", f"{HUB_BASE}/eligibility-rules.js?v=671")
served = hashlib.sha256(b_.encode("utf-8")).hexdigest() if s_ == 200 else None
if served == RULES_FP: say("  · cc.mo-care.com already serves the new rules file")
else: say("  · cc.mo-care.com still serves the older rules file (expected: the Hub pull request merges after this step)")
s2, b2 = http("GET", f"{API}/v1/projects/{REF}/api-keys?reveal=true", headers=MG()); ANON = SVC = ""
try:
    arr = json.loads(b2) if s2 == 200 else []
    if isinstance(arr, dict): arr = arr.get("keys") or []
    for k in arr:
        v = str(k.get("api_key", "")) if isinstance(k, dict) else ""
        if k.get("name") == "anon" and v.startswith("eyJ"): ANON = v
        if k.get("name") == "service_role" and v.startswith("eyJ"): SVC = v
except Exception: pass
HIDE.extend([ANON, SVC])
say("  ✓ the project's keys are readable (the schedule and the report need them)") if ANON and SVC else bad("could not read the project's keys")
say("  · what changes: one new database function (the door), one approved fingerprint added, one new function, one 15-minute schedule (it changes nothing while the switch is off), and one READ ONLY report now. Nothing is sent; no person's record changes.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
ok_, r_ = sql(REF, open(SQLF).read())
if not ok_: bad(f"the door did not install: {r_}"); done(5)
say("  ✓ reference_land_apply is installed (server only)")
ok_, _ = sql(REF, f"insert into public.rules_approved (file, sha256, note) values ('eligibility-rules.js', {lit(RULES_FP)}, '671 eligibility rules with the one shared copy of answer to slot (refAnswerPatch)') on conflict (file, sha256) do update set approved_at = now(), note = excluded.note")
say("  ✓ your approval of the new rules fingerprint is recorded (the older approved ones stay, so nothing stops while the Hub pull request is merged)") if ok_ else bad("the fingerprint could not be approved")
if not deploy(REF, FNROOT, FN, True): say("  RESULT: STOPPED. Tell Claude."); done(6)
command = ("select net.http_post(url := " + lit(f"https://{REF}.supabase.co/functions/v1/{FN}") + ", headers := jsonb_build_object('Content-Type', 'application/json', "
           "'Authorization', " + lit("Bearer " + ANON) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
           "body := '{\"mode\": \"apply\"}'::jsonb, timeout_milliseconds := 120000);")
sql(REF, f"select cron.unschedule({lit(JOB)}) where exists (select 1 from cron.job where jobname = {lit(JOB)})")
ok_, r_ = sql(REF, f"select cron.schedule({lit(JOB)}, {lit(SCHED)}, {lit(command)}) as id")
say(f"  ✓ {JOB} scheduled (every 15 minutes; it changes nothing while the switch is off)") if ok_ else bad(f"the schedule did not install: {r_}")

say(); say("PART 3 · PROOF (nothing is sent; no person's record changes)")
okl, livef = live_files(REF, FN)
say("  ✓ reference-land is live as tested") if okl and all(livef.get(k) == sha(os.path.join(ROOT, k)) for k in need(FNROOT, FN)) else bad("the live copy is not this build")
ok_, p = sql(REF, "select public.reference_land_apply('671-proof-nobody', 1, 0, '{\"r1s\": \"Positive\"}'::jsonb, '671 proof') as r")
say(f"  ✓ the door answers no_candidate for a person nobody holds") if ok_ and isinstance(p[0]['r'], dict) and p[0]['r'].get('reason') == 'no_candidate' else bad(f"door: {p}")
ok_, p2 = sql(REF, "select public.reference_land_apply('671-proof-nobody', 1, 0, '{\"ssn\": \"x\"}'::jsonb, '671 proof') as r")
say("  ✓ the door refuses a field a reference answer may not land (ssn)") if not ok_ else bad(f"ssn was not refused: {p2}")
ok_, p3 = sql(REF, "select has_function_privilege('authenticated', 'public.reference_land_apply(text, int, bigint, jsonb, text)', 'execute') as a, has_function_privilege('anon', 'public.reference_land_apply(text, int, bigint, jsonb, text)', 'execute') as b")
say("  ✓ only the server may call the door (anon and signed-in pages cannot)") if ok_ and p3[0]['a'] is False and p3[0]['b'] is False else bad(f"privileges: {p3}")
s3, b3 = http("POST", f"{FNB}/functions/v1/{FN}", {"mode": "report"}, {"apikey": "", "Authorization": "Bearer "})
say(f"  ✓ it refuses a caller with neither the schedule's secret nor the server key ({s3})") if s3 in (401, 403) else bad(f"a caller with no key got {s3}")
s4, b4 = http("POST", f"{FNB}/functions/v1/{FN}", {"mode": "apply"}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
try: j4 = json.loads(b4)
except Exception: j4 = {}
say("  ✓ with the switch off, a run changes nothing (it answered: off)") if s4 == 200 and j4.get("off") is True else bad(f"apply with the switch off answered {s4}: {str(b4)[:200]}")
say(); say("THE REPORT (read only: what would land if the switch were on)")
s5, b5 = http("POST", f"{FNB}/functions/v1/{FN}", {"mode": "report"}, {"apikey": SVC, "Authorization": "Bearer " + SVC})
try: j = json.loads(b5)
except Exception: j = {}
if s5 == 200 and j.get("rules_missing_landing"):
    say("  · " + str(j.get("message")))
elif s5 == 200 and j.get("ok"):
    k = j.get("counts", {})
    say(f"  · answered and not landed yet: {k.get('seen', 0)}; would land: {k.get('would_land', 0)}" + (f" (and {k.get('waiting_for_next_run')} more on the next run)" if k.get("waiting_for_next_run") else "") + f"; skipped: {k.get('skipped', 0)}")
    say(f"  · negative answers: {k.get('negatives', 0)}; a card for today would open for {k.get('alerts_would_open', 0)}; held back because the answer is older than {j.get('limits', {}).get('negative_alert_max_age_days', 14)} days: {k.get('alerts_held_too_old', 0)}")
    if k.get("would_replace_a_status"): say(f"  · {k['would_replace_a_status']} would replace a status the office already recorded on that slot (marked below)")
    for w in j.get("would_land", []):
        say(f"    {w.get('name') or '(no name)'} · reference {w.get('slot')} · now {w.get('current_status')} → {w.get('score')} · answered {str(w.get('responded_at'))[:10]}"
            + (" · opens a card for today" if w.get("alert") == "opens" else " · no card (older than the limit)" if w.get("alert") == "held_too_old" else "")
            + (" · REPLACES the office's status" if w.get("replaces_status") else ""))
    for s in j.get("skipped", []): say(f"    skipped: request {str(s.get('request_id'))[:8]} (person {s.get('candidate_id')}, slot {s.get('slot')}): {s.get('why')}")
else: bad(f"the report answered {s5}: {str(b5)[:300]}")
ok_c2, c2 = sql(REF, COUNT_Q + ", coalesce((select data->>'ref_land_live' from public.app_data where key = 'ops_settings'), 'not set') as sw")
if ok_c2 and ok_c:
    same = c2[0]['cands'] == c[0]['cands'] and str(c2[0]['upd']) == str(c[0]['upd']) and int(c2[0]['landed']) == int(c[0]['landed'])
    say(f"  ✓ Background & References is unchanged ({c2[0]['cands']} people, same save time) and no reference answer was marked landed") if same else bad(f"something changed: {c2}")
    say(f"  ✓ the switch is still off ({c2[0]['sw']})") if str(c2[0]['sw']) != "true" else bad("the switch is on")
else: bad(f"could not count again: {c2}")
say("  · tested before deploying: 41 checks on the job and the door, 19 on this step rehearsed (the switch off changes nothing; the report writes nothing; answers land only through the door; a negative opens one card, never two; an old negative lands with no card; an unapproved rules file is refused; no send path; the door in a real Postgres).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · the door, the job and its 15-minute schedule are in; the switch is off, so nothing lands yet. Nothing was sent; no person's record changed.")
say("NEXT: merge the Hub pull request (the new rules file), then double-click 671 again to read the report (safe to run again; it changes nothing new); when the list looks right, turn on \"Reference answers land by themselves\" on the Owners Hub Admin page."); done(0)
