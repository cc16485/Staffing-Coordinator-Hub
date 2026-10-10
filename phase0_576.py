#!/usr/bin/env python3
# 576 · PHASE 0 SECURITY (Samantha approved the eight P0 fixes, 2026-10-10: "keep the fixes narrowly scoped, test them, and
# document the results. Do not change operational permissions or deploy new AI autonomy"). Hub project.
#
# What this step does, and only this:
#   · transcribe-recording, ai-ltc-policy: answer only a signed-in office member (the public key alone used to be enough).
#   · oig-check, ghl-attach-doc: moved onto the Hub's own project with the same staff check; ghl-attach-doc writes one
#     op_events row per filing. The Training-project copy of ghl-attach-doc (the retired shared-key version) is removed
#     only if it is exactly that old build.
#   · caregiver-intro: the office-role check every other family sender uses (it accepted any signed-in account).
#   · shift-confirm, ops-escalate: answer only their own schedule (vault secret) or the owner key; the URL token is gone.
#     Their schedules are re-pointed to carry the vault secret in the same run, so the morning shift text keeps going.
#     If the vault secret is missing, these two are NOT deployed and nothing about them changes.
#   · ht-local: a Checkr result with no webhook secret configured is refused. Deployed only when the secret exists,
#     otherwise skipped and said so (current behaviour stays until the secret is set).
#   · owner_keys_lock_576.sql: the Owners Hub's finance, budget, offboarding and file-audit keys readable and writable
#     only by an owner_admin, enforced in the database. Applied only when both owners resolve to owner_admin with Hub
#     access; otherwise skipped and said so.
# Nothing is sent. No switch changes. No permission is widened. Rollback lines are at the end of the report.
import os, json, re, time, shutil, subprocess
os.environ.setdefault("SB_STEP", "576")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"; TR = "rdqujxiycycwhskyvrwa"; BASE = f"https://{REF}.supabase.co"
OWNERS = ["samantha@mo-care.com", "zach@mo-care.com"]
OLD_ATTACH_SHA = "5d550335395d7da08e3a755fe0d100eebaae21261a0ad0ece139dfe851e7da65"  # the shared-key build on the Training project
STAFF_FNS = ["transcribe-recording", "ai-ltc-policy", "caregiver-intro", "oig-check", "ghl-attach-doc"]
JOB_FNS = ["shift-confirm", "ops-escalate"]
start("PHASE 0 SECURITY: EIGHT P0 FIXES")
say("PART 1 · READ ONLY (nothing changes)")
if not (SUPA and os.path.exists(SUPA)): bad("supabase CLI not found"); done(2)
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
NODE = shutil.which("node") or next((p for p in ("/opt/homebrew/bin/node", "/usr/local/bin/node") if os.path.exists(p)), "")
if NODE:
    p = subprocess.run([NODE, "phase0_576_test.mjs"], cwd=ROOT, capture_output=True, text=True)
    last = (p.stdout.strip().splitlines() or ["(no output)"])[-1]
    if p.returncode != 0 or re.search(r"^FAIL", p.stdout, re.M): bad(f"phase0_576_test.mjs failed: {last}"); say("  STOP. Nothing was changed."); done(2)
    say(f"  ✓ phase0_576_test.mjs: {last.strip()}")
else: say("  · node is not on this Mac, so the tests were not re-run here (32/32 passed when built)")

def secret_names(ref):
    s, b = http("GET", f"{API}/v1/projects/{ref}/secrets", headers=MG())
    try: return {x.get("name") for x in json.loads(b)} if s == 200 else None
    except Exception: return None
SEC = secret_names(REF)
if SEC is None: bad("could not list the Hub project's secrets"); done(3)
for n, why in (("HUB_JOB_SECRET", "the job secret"), ("GHL_TOKEN", "GoHighLevel"), ("GHL_LOCATION_ID", "GoHighLevel location"), ("ELEVENLABS_API_KEY", "the transcriber"), ("ANTHROPIC_API_KEY", "the model")):
    say(f"  {'✓' if n in SEC or (n == 'GHL_TOKEN' and 'GHL_API_KEY' in SEC) else '·'} {why} secret is {'set' if n in SEC or (n == 'GHL_TOKEN' and 'GHL_API_KEY' in SEC) else 'NOT set'} on the Hub project")
CHECKR = "CHECKR_WEBHOOK_SECRET" in SEC
say(f"  {'✓' if CHECKR else '·'} CHECKR_WEBHOOK_SECRET is {'set: ht-local goes out with the fail-closed check' if CHECKR else 'NOT set: ht-local is SKIPPED this run (a Checkr result would otherwise be refused from now on). Set it in Checkr → Webhooks and in Supabase secrets, then run 576 again.'}")

ok_, vlt = sql(REF, "select count(*)::int as n from vault.decrypted_secrets where name = 'hub_job_secret'")
VAULT = bool(ok_ and vlt and vlt[0]["n"] == 1)
say(f"  {'✓' if VAULT else '✗'} the vault secret hub_job_secret {'exists' if VAULT else 'is missing: shift-confirm and ops-escalate are NOT touched this run'}")
ok_, jobs = sql(REF, "select jobid, jobname, schedule, active, command from cron.job where command ilike '%shift-confirm%' or command ilike '%ops-escalate%' order by jobname")
if not ok_: bad(f"could not read the schedules: {jobs}"); done(3)
JOBS = jobs or []
for j in JOBS:
    has = "x-cron-secret" in (j["command"] or "")
    say(f"  · schedule '{j['jobname']}' ({j['schedule']}, {'active' if j['active'] else 'paused'}) calls {'shift-confirm' if 'shift-confirm' in j['command'] else 'ops-escalate'} {'already with the vault secret' if has else 'WITHOUT the vault secret → re-pointed in Part 2'}")
if not any("shift-confirm" in (j["command"] or "") for j in JOBS): say("  · no schedule calls shift-confirm (the morning shift text is not scheduled on this project)")
if not any("ops-escalate" in (j["command"] or "") for j in JOBS): say("  · no schedule calls ops-escalate (it does not run on its own today; the auth change only closes a door)")

VJ = {}
for fn in STAFF_FNS + JOB_FNS + ["ht-local"]:
    sx, mx = fmeta(REF, fn)
    if sx == 200 and mx and isinstance(mx.get("verify_jwt"), bool): VJ[fn] = mx["verify_jwt"]; say(f"  ✓ {fn} is live at version {mx.get('version', '?')} (gateway sign-in check {'on' if VJ[fn] else 'off'}, kept)")
    elif sx == 404 and fn in ("oig-check", "ghl-attach-doc"): VJ[fn] = True; say(f"  · {fn} is not on the Hub project yet: it will be created (gateway sign-in check on)")
    else: bad(f"{fn} is not live or unreadable: {sx}")
for fn in ("ghl-attach-doc", "oig-check", "ai-ltc-policy"):
    sx, mx = fmeta(TR, fn)
    say(f"  · Training project: {fn} is {'live (version ' + str((mx or {}).get('version', '?')) + ')' if sx == 200 else 'not there'}")
TR_ATTACH_OLD = False
sx, _ = fmeta(TR, "ghl-attach-doc")
if sx == 200:
    okd, lf = live_files(TR, "ghl-attach-doc")
    TR_ATTACH_OLD = okd and lf.get("supabase/functions/ghl-attach-doc/index.ts") == OLD_ATTACH_SHA
    say(f"  {'✓' if TR_ATTACH_OLD else '·'} Training project's ghl-attach-doc is {'exactly the retired shared-key build → removed in Part 2' if TR_ATTACH_OLD else 'NOT the build this step knows → left alone; tell Claude'}")
sx, mx = fmeta(REF, "axiscare-push-note")
say(f"  · axiscare-push-note (the New Clients schedule-note call the scan flagged) is {'LIVE on the Hub project (version ' + str((mx or {}).get('version', '?')) + ') though it is in no repo: listed for your automation review, untouched here' if sx == 200 else 'not deployed: the Hub call to it fails quietly today; clean-up item, untouched here'}")

ok_, pol = sql(REF, "select policyname, cmd, permissive from pg_policies where schemaname = 'public' and tablename = 'app_data' order by policyname")
say(f"  · app_data has {len(pol) if ok_ else '?'} row-security rules today" + (f" ({sum(1 for x in pol if x['permissive'] == 'RESTRICTIVE')} restrictive)" if ok_ else ""))
ok_, own = sql(REF, "select lower(u.email) as email, (u.raw_app_meta_data->'hub_access') as hub_access, exists (select 1 from public.auth_identities i join public.staff_roles r on r.person_id = i.person_id and r.entity = 'cc_ihs' and r.role = 'owner_admin' where i.auth_user_id = u.id and i.project_ref = " + lit(REF) + ") as owner from auth.users u where lower(u.email) in (" + ", ".join(lit(e) for e in OWNERS) + ")")
ok2, fn_ = sql(REF, "select prosecdef from pg_proc where proname = 'desk_is_owner' and pronamespace = 'public'::regnamespace")
LOCK_OK = bool(ok_ and ok2 and fn_ and fn_[0]["prosecdef"])
if ok_:
    found = {r["email"]: r for r in (own or [])}
    for e in OWNERS:
        r = found.get(e)
        hub_ok = r is not None and (r["hub_access"] is None or "care_coordinator" in (r["hub_access"] or []))
        good = r is not None and r["owner"] and hub_ok
        LOCK_OK = LOCK_OK and good
        say(f"  {'✓' if good else '✗'} owner {e.split('@')[0]}: " + ("owner_admin with Hub access" if good else "NO sign-in" if r is None else "not owner_admin in staff_roles" if not r["owner"] else "no Care Coordinator Hub access"))
say(f"  {'✓' if LOCK_OK else '✗'} the owner-keys rule {'can be applied' if LOCK_OK else 'is SKIPPED this run (both owners must be owner_admin with Hub access, and desk_is_owner() must exist), nothing about app_data changes'}")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)
say("  · what changes: " + ", ".join(STAFF_FNS + (JOB_FNS if VAULT else []) + (["ht-local"] if CHECKR else [])) + (" + the owner-keys rule" if LOCK_OK else "") + (" + the Training-project copy of ghl-attach-doc removed" if TR_ATTACH_OLD else "") + ". Nothing is sent; no switch changes.")

say(); say("PART 2 · CHANGE")
for fn in STAFF_FNS:
    if not deploy(REF, FNROOT, fn, VJ[fn]): say("  RESULT: STOPPED. Tell Claude."); done(6)
if VAULT:
    for fn in JOB_FNS:
        if not deploy(REF, FNROOT, fn, VJ[fn]): say("  RESULT: STOPPED. Tell Claude."); done(6)
    for j in JOBS:
        if "x-cron-secret" in (j["command"] or ""): continue
        m = re.search(r"url\s*:=\s*'([^']+)'", j["command"] or "")
        if not m: bad(f"schedule '{j['jobname']}': could not read its URL; left as is"); continue
        url = re.sub(r"[?&]token=[^&']*", "", m.group(1)).replace("?&", "?").rstrip("?")
        am = re.search(r"'Authorization',\s*'Bearer ([^']+)'", j["command"] or "")
        bearer = am.group(1) if am else ""
        cmd = ("select net.http_post(url := " + lit(url) + ", headers := jsonb_build_object('Content-Type', 'application/json'"
               + (", 'Authorization', " + lit("Bearer " + bearer) if bearer else "")
               + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'hub_job_secret')), body := '{}'::jsonb);")
        okr, r_ = sql(REF, "select cron.unschedule(" + lit(j["jobname"]) + "); select cron.schedule(" + lit(j["jobname"]) + ", " + lit(j["schedule"]) + ", " + lit(cmd) + ");")
        say(f"  ✓ schedule '{j['jobname']}' re-pointed to carry the vault secret (same {j['schedule']})") if okr else bad(f"schedule '{j['jobname']}' could not be re-pointed: {r_}")
else: say("  · shift-confirm and ops-escalate: not deployed (vault secret missing)")
if CHECKR:
    if not deploy(REF, FNROOT, "ht-local", VJ["ht-local"]): say("  RESULT: STOPPED. Tell Claude."); done(6)
else: say("  · ht-local: skipped (no CHECKR_WEBHOOK_SECRET yet)")
if LOCK_OK:
    okr, r_ = sql(REF, open(os.path.join(ROOT, "owner_keys_lock_576.sql")).read())
    say("  ✓ the owner-keys rule is in place (finance, budget, offboarding, file audits: owners only, in the database)") if okr else bad(f"owner-keys rule: {r_}")
else: say("  · owner-keys rule: skipped")
if TR_ATTACH_OLD:
    s_, b_ = http("DELETE", f"{API}/v1/projects/{TR}/functions/ghl-attach-doc", headers=MG())
    sx, _ = fmeta(TR, "ghl-attach-doc")
    say("  ✓ the retired shared-key copy of ghl-attach-doc is gone from the Training project") if sx == 404 else bad(f"Training project's ghl-attach-doc did not go ({s_})")

say(); say("PART 3 · PROOF (nothing is sent or changed)")
time.sleep(float(os.environ.get("SB_SETTLE", "8")))
NOAUTH = {"apikey": "", "Authorization": "Bearer "}
for fn, body in (("transcribe-recording", {"recording_id": "00000000-0000-0000-0000-000000000000"}), ("ai-ltc-policy", {"policy_text": "x" * 80}), ("caregiver-intro", {"profile_id": "x", "client_name": "x"}), ("oig-check", {"first": "a", "last": "b"}), ("ghl-attach-doc", {"first": "a", "last": "b", "email": "a@b.c", "label": "x", "file_url": "https://x/y"})):
    s_, _ = http("POST", f"{BASE}/functions/v1/{fn}", body, NOAUTH)
    say(f"  ✓ {fn} refuses a caller with no sign-in ({s_})") if s_ in (401, 403) else bad(f"{fn} answered {s_} without a sign-in")
if VAULT:
    for fn in JOB_FNS:
        s_, _ = http("POST", f"{BASE}/functions/v1/{fn}?auth_check=1", {}, NOAUTH)
        say(f"  ✓ {fn} refuses a caller with no secret ({s_})") if s_ == 401 else bad(f"{fn} answered {s_} to a caller with no secret")
        s_, _ = http("POST", f"{BASE}/functions/v1/{fn}?auth_check=1&token=anything", {}, NOAUTH)
        say(f"  ✓ {fn} refuses a token in the URL ({s_})") if s_ == 401 else bad(f"{fn} answered {s_} to a URL token")
        am = next((re.search(r"'Authorization',\s*'Bearer ([^']+)'", j["command"] or "") for j in JOBS if fn in (j["command"] or "")), None)
        bearer = am.group(1) if am else ""
        ok_, rq = sql(REF, "select net.http_post(url := " + lit(f"{BASE}/functions/v1/{fn}?auth_check=1") + ", headers := jsonb_build_object('Content-Type', 'application/json'" + (", 'Authorization', " + lit("Bearer " + bearer) if bearer else "") + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'hub_job_secret')), body := '{}'::jsonb) as id")
        got = None; waited = 0.0
        while ok_ and rq and waited <= 40:
            ok3, rr = sql(REF, f"select status_code, content from net._http_response where id = {int(rq[0]['id'])}")
            if ok3 and rr: got = rr[0]; break
            time.sleep(2); waited += 2
        try: caller = json.loads(got["content"]).get("caller") if got else None
        except Exception: caller = None
        say(f"  ✓ {fn}: its schedule, carrying the vault secret, still gets in (as cron)") if got and got["status_code"] == 200 and caller == "cron" else bad(f"{fn}: the schedule's call did not get in ({got['status_code'] if got else 'no answer'})")
if LOCK_OK:
    ok_, n_ = sql(REF, "select count(*)::int as n from pg_policies where schemaname = 'public' and tablename = 'app_data' and policyname like 'app_data_owner_keys_%' and permissive = 'RESTRICTIVE'")
    say("  ✓ the four owner-keys rules are on app_data") if ok_ and n_ and n_[0]["n"] == 4 else bad("the owner-keys rules did not all land")
say("  · tested before deploying: 32 checks (no sign-in, public key, non-office role refused on five functions; shift-confirm and ops-escalate refuse the public key and the URL token and accept only the vault secret or the owner key; a Checkr result with no secret is refused, a forged signature is refused, a real one passes; filing a document writes one op_events row without the email or phone).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say("RESULT: DONE · Phase 0 fixes are live. Nothing was sent; no switch changed; no permission was widened.")
say("Rollback: Claude redeploys the previous build of any function (git history); owner_keys_lock_576_rollback.sql removes the four rules; a re-pointed schedule keeps working with either build.")
done(0)
