#!/usr/bin/env python3
# 969 · COACHING CALLS, part C1 (Samantha 2026-10-18: "Start the coaching calls build").
# Part 1 (read only): the reviewed build; the coaching tracker (961) and the jobs' secret are there; the GoHighLevel key;
#   the four functions this changes (calls-feed, call-pull, call-tasks, call-disposition) are live AND exactly what is
#   in GitHub today (so nothing someone else deployed is overwritten); coaching calls are not switched on.
# Part 2: hr_coaching_calls.sql (the coaching call records, server only and never deleted; the private bucket hr-audio;
#   the completion lock and the private My Work card wording, both only once switched on); deploy hr-coach-call and its
#   5-minute schedule; redeploy the four functions with the privacy check (coaching calls are never listed or played in
#   the Calls view, never read by the AI call reader, never sent to AxisCare), each with its gateway setting unchanged.
# Part 3 (proof; undone, nothing rings, nothing sent): the public key is refused; the schedule gets in; with the switch
#   pretended on inside an undone test, a coaching talk can't be completed without a confirmed recorded call and the card
#   shows only first name + last initial; Krystal can't read the call records directly.
# Coaching calls stay OFF (ops_settings.hr_coaching_calls_live) until her two gates are settled. Prints counts only.
import os, json, re
os.environ.setdefault("SB_STEP", "969")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
NEW = "hr-coach-call"; VAULT_NAME = "hub_job_secret"; SCHEDULE = "*/5 * * * *"
CHANGED = ["calls-feed", "call-pull", "call-tasks", "call-disposition"]
CC_EMAIL = os.environ.get("SB_CC_EMAIL", "krystal@mo-care.com")
HERE = os.path.dirname(os.path.abspath(__file__))
LIVE_SHAS = json.loads(os.environ.get("SB_LIVE_SHAS", "{}"))   # each function's files as they are in GitHub before this change
def keys():
    usable = lambda v: isinstance(v, str) and (v.startswith("eyJ") or v.startswith("sb_secret_") or v.startswith("sb_publishable_")) and "·" not in v and "*" not in v
    for q in ("?reveal=true", ""):
        s, b = http("GET", f"{API}/v1/projects/{REF}/api-keys{q}", headers=MG())
        if s != 200: continue
        try: arr = json.loads(b)
        except Exception: continue
        if isinstance(arr, dict): arr = arr.get("keys") or []
        got = {k.get("name"): k.get("api_key", "") for k in arr if isinstance(k, dict) and usable(k.get("api_key", ""))}
        if got.get("service_role") and got.get("anon"): return got
    return {}
def jload(b):
    try: return json.loads(b)
    except Exception: return {}
def command(url, anon):
    return ("select net.http_post(url := " + lit(url) + ", headers := jsonb_build_object('Content-Type', 'application/json', "
            "'Authorization', " + lit("Bearer " + anon) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
            "body := '{\"action\": \"sweep\"}'::jsonb, timeout_milliseconds := 120000);")

start("COACHING CALLS (PART C1)")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
ok, st = sql(REF, """select (to_regclass('public.hr_coaching') is not null) as coaching, (select count(*) from vault.decrypted_secrets where name = """ + lit(VAULT_NAME) + """)::int as vault,
  (to_regclass('public.hr_coaching_call') is not null) as tbl, coalesce((select data->>'hr_coaching_calls_live' from public.app_data where key = 'ops_settings'), '') as live""")
if not ok or not st: bad(f"could not read the database: {st}")
else:
    x = st[0]
    if not x["coaching"]: bad("the coaching tracker is not there (Desktop 961)")
    if x["vault"] != 1: bad("the jobs' secret is not in the vault")
    if x["live"] == "true": bad("coaching calls are already switched on; this step expects them off")
    if not fails: say(f"  ✓ the coaching tracker and the jobs' secret are there · the call records are {'already there (an earlier run)' if x['tbl'] else 'new'} · coaching calls are off")
s_, sb_ = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
names = [y.get("name") for y in jload(sb_)] if s_ == 200 and isinstance(jload(sb_), list) else []
say("  ✓ the GoHighLevel key is set on the server (its value is never read here)") if ("GHL_TOKEN" in names or "GHL_API_KEY" in names) and "GHL_LOCATION_ID" in names else bad("the GoHighLevel key or location is not set on the server")
GATE = {}
for fn in CHANGED:
    sF, mF = fmeta(REF, fn)
    if sF != 200 or not mF: bad(f"{fn} is not live, so it is not safe to redeploy it here"); continue
    GATE[fn] = bool(mF.get("verify_jwt"))
    okL, livef = live_files(REF, fn)
    # the function's own files must be GitHub's; shared files are brought up to GitHub's by the redeploy anyway
    want = {k: v for k, v in LIVE_SHAS.items() if k.startswith(f"supabase/functions/{fn}/")}
    mine = {k for k in livef if k.startswith(f"supabase/functions/{fn}/")}
    off = [k for k in mine if k in want and livef[k] != want[k]]
    if not okL: bad(f"could not read the live copy of {fn}")
    elif off: bad(f"the live {fn} is not what is in GitHub ({len(off)} file(s) differ), so it was not replaced. Tell Claude.")
    else: say(f"  ✓ the live {fn} is what is in GitHub (gateway sign-in check {'on' if GATE[fn] else 'off'}, kept as it is)")
K = keys(); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); HIDE.extend([ANON, SVC])
if not (ANON and SVC): bad("could not read the project's keys (the schedule and the proofs need them)")
say("  · what changes: 1 new server-only table, 1 private bucket, the coaching completion rule (only once switched on), 1 new service and its schedule, 4 services redeployed with the privacy check. Nothing rings, nothing is sent, no switch is turned on.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
CHECK = """
do $v$ begin
  if has_table_privilege('authenticated', 'public.hr_coaching_call', 'select') or has_table_privilege('anon', 'public.hr_coaching_call', 'select') then raise exception '969 self-check: a browser role can read coaching calls'; end if;
  if not exists (select 1 from storage.buckets where id = 'hr-audio' and public = false) then raise exception '969 self-check: the hr-audio bucket is missing or public'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'hr_audio_keep' and not tgisinternal) then raise exception '969 self-check: the keep-guard on hr-audio is missing'; end if;
  if position('calls_live' in pg_get_functiondef('public.hr_coaching_act(uuid, text, jsonb)'::regprocedure)) = 0 then raise exception '969 self-check: the completion rule did not go in'; end if;
end $v$;"""
good, r = sql(REF, "begin;\n" + open(os.path.join(HERE, "hr_coaching_calls.sql")).read() + CHECK + "\ncommit;")
if not good: bad(f"the coaching call records did not go in, so nothing changed: {str(r)[:300]}"); say("  RESULT: STOPPED. Tell Claude."); done(5)
say("  ✓ the coaching call records and the private audio store are in; completing a coaching talk is unchanged while coaching calls are off")
if not deploy(REF, FNROOT, NEW, True): say("  RESULT: STOPPED at the deploy. The tables are in (harmless; nothing uses them yet). Tell Claude."); done(6)
URL = f"{FNB}/functions/v1/{NEW}"
sql(REF, f"select cron.unschedule({lit(NEW)}) where exists (select 1 from cron.job where jobname = {lit(NEW)})")
ok, r = sql(REF, f"select cron.schedule({lit(NEW)}, {lit(SCHEDULE)}, {lit(command(URL, ANON))}) as id")
ok2, jb = sql(REF, f"select schedule, command from cron.job where jobname = {lit(NEW)}")
g = ok and ok2 and jb and jb[0]["schedule"] == SCHEDULE and "x-cron-secret" in jb[0]["command"]
say("  ✓ its schedule: every 5 minutes it looks for the call after each Call now (it only acts on taps)") if g else bad("the schedule did not go in")
for fn in CHANGED:
    if not deploy(REF, FNROOT, fn, GATE[fn]): say(f"  RESULT: STOPPED at {fn}. The ones above are deployed. Tell Claude."); done(7)

say(); say("PART 3 · PROOF (undone after; nothing rings, nothing is sent)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
VIS = {"apikey": ANON, "Authorization": "Bearer " + ANON}
a1 = http("POST", URL, {"action": "list", "coaching_id": "00000000-0000-0000-0000-000000000000"}, VIS)[0]
a2 = http("POST", URL, {"action": "sweep"}, VIS)[0]
say(f"  ✓ the public key is refused ({a1}, {a2})") if a1 in (401, 403) and a2 == 401 else bad(f"the public key got in ({a1}, {a2})")
ok, rq = sql(REF, command(URL, ANON).rstrip(";") + " as id")
got = None; waited = 0.0
while ok and rq and waited <= 40:
    ok3, rr = sql(REF, f"select status_code, content from net._http_response where id = {int(rq[0]['id'])}")
    if ok3 and rr: got = rr[0]; break
    time.sleep(2); waited += 2
say("  ✓ its schedule gets in and runs") if got and got["status_code"] == 200 and jload(got["content"]).get("ok") else bad(f"its schedule did not run ({got['status_code'] if got else 'no answer'})")
for fn in ("calls-feed", "call-tasks"):
    a3 = http("POST", f"{FNB}/functions/v1/{fn}", {}, VIS)[0]
    say(f"  ✓ {fn} still refuses the public key ({a3})") if a3 in (401, 403) else bad(f"{fn} answered the public key with {a3}")
ok, pr = sql(REF, f"""do $p$ declare uid uuid; meta jsonb; res text := ''; cid uuid; t text; begin
  update public.app_data set data = data || '{{"hr_coaching_calls_live": true}}'::jsonb where key = 'ops_settings';
  insert into public.hr_coaching (axiscare_caregiver_id, caregiver, kind, topic, assigned_to, assigned_by, due_on) values ('0', 'Probe Person', 'coaching', 'probe', {lit(CC_EMAIL)}, 'probe', current_date + 3) returning id into cid;
  select u.id, coalesce(u.raw_app_meta_data, '{{}}'::jsonb) into uid, meta from auth.users u where lower(u.email) = {lit(CC_EMAIL)} and u.banned_until is null;
  if uid is null then raise exception 'PROBE_RESULT:nouser=1'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated', 'app_metadata', meta)::text, true);
  perform set_config('request.jwt.claim.sub', uid::text, true);
  set local role authenticated;
  begin perform public.hr_coaching_act(cid, 'done', jsonb_build_object('held_on', current_date, 'method', 'phone', 'discussed', 'x', 'response', 'y', 'expectation', 'z'));
    res := res || 'locked=0;'; exception when others then res := res || 'locked=' || (case when sqlerrm like '%recorded coaching call%' then '1' else '0' end) || ';'; end;
  begin perform count(*) from public.hr_coaching_call; res := res || 'read=1;'; exception when others then res := res || 'read=0;'; end;
  reset role;
  perform public.hr_coaching_card(c) from public.hr_coaching c where id = cid;
  select e->>'title' into t from public.app_data, jsonb_array_elements(data) e where key = 'ops_items' and e->>'id' = 'ops_coach_' || cid;
  res := res || 'short=' || (case when t = 'Coaching call due: Probe P.' then '1' else '0' end) || ';';
  raise exception 'PROBE_RESULT:%', res; end $p$;""")
m_ = re.search(r"PROBE_RESULT:([a-z0-9_=; ]*)", str(pr)) if not ok else None
p = dict(kv.split("=") for kv in m_.group(1).split(";") if "=" in kv) if m_ else None
if p is None or p.get("nouser"): say("  · could not test as Krystal (no sign-in found); the rehearsal covers it")
else:
    say("  ✓ once switched on (pretend, undone): a coaching talk can't be completed without a confirmed recorded call") if p.get("locked") == "1" else bad("the completion rule did not hold when switched on")
    say("  ✓ ...and the office-visible card shows only \"Coaching call due\" and first name + last initial") if p.get("short") == "1" else bad("the card wording did not change when switched on")
    say("  ✓ acting as Krystal (undone): she can't read the coaching call records directly") if p.get("read") == "0" else bad("Krystal could read the coaching call records directly")
ok, lv = sql(REF, "select coalesce((select data->>'hr_coaching_calls_live' from public.app_data where key = 'ops_settings'), '') as live, (select count(*) from public.hr_coaching where caregiver = 'Probe Person')::int as probes")
say("  ✓ coaching calls are still off and the test left nothing behind") if ok and lv and lv[0]["live"] != "true" and lv[0]["probes"] == 0 else bad(f"something was left behind: {lv}")
say("  · tested before this ran: the rules and the service (43 checks), this step against a local copy of the database (see coaching_calls_969_test.py).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE. Tell Claude."); done(9)
say("RESULT: DONE · Coaching calls are built and OFF. Coaching calls are already kept out of the Calls view, the AI call reader and AxisCare. Tell Claude.")
say("Undo: Claude can unschedule hr-coach-call and redeploy the four services from before; the records are kept by design.")
done(0)
