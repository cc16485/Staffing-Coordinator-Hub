#!/usr/bin/env python3
# 965 · ZACH'S ALERTS (HR Agent build step 7; Samantha 2026-10-18: "step 7").
# Part 1 (read only): the reviewed build; the jobs' secret; the HR agent and coaching tables (957, 961); the GoHighLevel
#   keys; Zach's phone and email addresses (given by the Desktop launcher, never stored in the public repo).
# Part 2: hr_alert_state, a server-only table holding where Zach's alerts go and which items he has been told about;
#   deploy hr-alerts (sign-in check on); its schedule, every 30 minutes (it only sends Monday to Friday, 8am to 6pm).
# Part 3 (proof): the job refuses the public key and lets its schedule in; a count of what is waiting (nothing sent);
#   the public key, Krystal and Zach's own sign-in can't read where alerts go; the public key reads no HR item; the
#   Hub link opens on the sign-in screen. Then, ONLY if Samantha answered yes in the launcher, one test text and email.
# The alerts stay in PRACTICE until ops_settings.hr_alerts_live is true (build step 10): the job writes down the alert
# it would have sent and sends nothing. Prints counts only: no name, number, email, key or secret.
import os, json, re
os.environ.setdefault("SB_STEP", "965")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
HUB = os.environ.get("SB_HUB_BASE", "https://cc.mo-care.com")
NEW = "hr-alerts"; VAULT_NAME = "hub_job_secret"; SCHEDULE = "*/30 * * * *"
HR_EMAIL = os.environ.get("SB_HR_EMAIL", "zach@mo-care.com"); CC_EMAIL = os.environ.get("SB_CC_EMAIL", "krystal@mo-care.com")
PHONE = re.sub(r"\D", "", os.environ.get("SB_HR_ALERT_PHONE", ""))
EMAILS = sorted({e.strip().lower() for e in os.environ.get("SB_HR_ALERT_EMAILS", "").split(",") if re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", e.strip())})
SEND_TEST = os.environ.get("SB_SEND_TEST", "") == "1"
HIDE.extend([PHONE] + EMAILS)
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
            "body := '{}'::jsonb, timeout_milliseconds := 120000);")

TABLE = """
create table if not exists public.hr_alert_state (
  id text primary key,
  to_phone text,
  to_emails text[] not null default '{}',
  seen text[] not null default '{}',
  practice_log jsonb not null default '[]'::jsonb,
  last_sent_at timestamptz,
  updated_at timestamptz not null default now()
);
comment on table public.hr_alert_state is '965 (2026-10-18): where Zach''s HR alerts go and which waiting items he has been told about. Server only: no page reads or writes it.';
alter table public.hr_alert_state enable row level security;
revoke all on public.hr_alert_state from anon, authenticated;
grant all on public.hr_alert_state to service_role;
do $v$ begin
  if not (select relrowsecurity from pg_class where oid = 'public.hr_alert_state'::regclass) then raise exception '965 self-check: row security is off'; end if;
  if has_table_privilege('anon', 'public.hr_alert_state', 'select') or has_table_privilege('authenticated', 'public.hr_alert_state', 'select')
     or has_table_privilege('authenticated', 'public.hr_alert_state', 'update') then raise exception '965 self-check: a page could read or change it'; end if;
end $v$;"""

start("ZACH'S ALERTS")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
sN, mN = fmeta(REF, NEW)
ok, st = sql(REF, "select (select count(*) from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")::int as vault, "
                  "(to_regclass('public.hr_cases') is not null) as cases, (to_regclass('public.hr_coaching') is not null) as coaching, "
                  "(to_regclass('public.hr_alert_state') is not null) as tbl, "
                  "coalesce((select data->>'hr_alerts_live' from public.app_data where key = 'ops_settings'), '') as live")
if not ok or not st: bad(f"could not read the database: {st}")
else:
    x = st[0]
    if x["vault"] != 1: bad("the jobs' secret is not in the vault")
    if not x["cases"]: bad("the HR agent's case table is not there (Desktop 957)")
    if not x["coaching"]: bad("the coaching tracker is not there (Desktop 961)")
    if not fails: say(f"  ✓ the jobs' secret, the HR agent (957) and the coaching tracker (961) are there · the alert table is {'already there (an earlier run)' if x['tbl'] else 'new'} · the job is {'already there' if sN == 200 else 'new'}")
s_, sb_ = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
names = [y.get("name") for y in jload(sb_)] if s_ == 200 and isinstance(jload(sb_), list) else []
if "GHL_TOKEN" in names and "GHL_LOCATION_ID" in names: say("  ✓ the GoHighLevel keys are set on the server (their values are never read here)")
else: bad("the GoHighLevel keys (GHL_TOKEN, GHL_LOCATION_ID) are not both set on the server")
if len(PHONE) == 10 or (len(PHONE) == 11 and PHONE[0] == "1"): say("  ✓ Zach's cell number came from the launcher")
else: bad("Zach's cell number did not come through from the launcher (10 digits)")
if EMAILS: say(f"  ✓ {len(EMAILS)} email address(es) for Zach came from the launcher")
else: bad("no email address for Zach came through from the launcher")
K = keys(); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); HIDE.extend([ANON, SVC])
if not (ANON and SVC): bad("could not read the project's keys (the schedule and the proofs need them)")
say("  · what changes: 1 new server-only table, 1 new service, its 30-minute schedule. No switch is turned on.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
ROW = (f"insert into public.hr_alert_state (id, to_phone, to_emails) values ('zach', {lit(PHONE)}, {lit('{' + ','.join(EMAILS) + '}')}::text[]) "
       "on conflict (id) do update set to_phone = excluded.to_phone, to_emails = excluded.to_emails, updated_at = now();")
ok, r = sql(REF, "begin;" + TABLE + "\n" + ROW + "\ncommit;")
if not ok: bad(f"the alert table did not go in, so nothing changed: {str(r)[:300]}"); say("  RESULT: STOPPED. Tell Claude."); done(5)
say(f"  ✓ the alert table is in, server only, with Zach's cell and {len(EMAILS)} email address(es)")
if not deploy(REF, FNROOT, NEW, True): say("  RESULT: STOPPED at the deploy. The table is in (harmless; nothing reads it yet). Tell Claude."); done(6)
URL = f"{FNB}/functions/v1/{NEW}"
sql(REF, f"select cron.unschedule({lit(NEW)}) where exists (select 1 from cron.job where jobname = {lit(NEW)})")
ok, r = sql(REF, f"select cron.schedule({lit(NEW)}, {lit(SCHEDULE)}, {lit(command(URL, ANON))}) as id")
ok2, jb = sql(REF, f"select schedule, command from cron.job where jobname = {lit(NEW)}")
g = ok and ok2 and jb and jb[0]["schedule"] == SCHEDULE and "x-cron-secret" in jb[0]["command"] and "vault.decrypted_secrets" in jb[0]["command"]
say("  ✓ its schedule: every 30 minutes, carrying the jobs' secret from the vault (it only sends Monday to Friday, 8am to 6pm)") if g else bad("the schedule did not go in")

say(); say("PART 3 · PROOF")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
VIS = {"apikey": ANON, "Authorization": "Bearer " + ANON}
OWN = {"apikey": SVC, "Authorization": "Bearer " + SVC}
a1 = http("POST", URL + "?auth_check=1", {}, VIS)[0]
say(f"  ✓ the job refuses the public key ({a1})") if a1 == 401 else bad(f"the job let the public key in ({a1})")
a2 = http("POST", URL + "?test=1", {}, VIS)[0]
say(f"  ✓ nobody but you can ask it for a test alert ({a2})") if a2 == 401 else bad(f"the public key could ask for a test alert ({a2})")
ok, rq = sql(REF, command(URL + "?auth_check=1", ANON).rstrip(";") + " as id")
got = None; waited = 0.0
while ok and rq and waited <= 40:
    ok3, rr = sql(REF, f"select status_code, content from net._http_response where id = {int(rq[0]['id'])}")
    if ok3 and rr: got = rr[0]; break
    time.sleep(2); waited += 2
g = got and got["status_code"] == 200 and jload(got["content"]).get("caller") == "cron"
say("  ✓ its schedule gets in") if g else bad(f"its schedule was not let in ({got['status_code'] if got else 'no answer'})")
sD, bD = http("POST", URL + "?dry=1", {}, OWN, 120); j = jload(bD)
if sD == 200 and j.get("ok"):
    say(f"  ✓ a look (nothing sent, nothing marked): {j.get('waiting', 0)} HR item(s) waiting for Zach right now · it would text {1 if j.get('would_text') else 0} phone and email {j.get('would_email', 0)} address(es)")
    say("  · mode: PRACTICE (it writes down the alert it would send and sends nothing until build step 10)") if not j.get("live") else say("  · mode: LIVE (ops_settings.hr_alerts_live is on)")
else: bad(f"the look answered {sD}: {str(bD)[:200]}")
def probe(email, steps):
    good, r = sql(REF, f"""do $p$ declare uid uuid; meta jsonb; res text := ''; n int; begin
      select u.id, coalesce(u.raw_app_meta_data, '{{}}'::jsonb) into uid, meta from auth.users u where lower(u.email) = {lit(email)} and u.banned_until is null;
      if uid is null then raise exception 'PROBE_RESULT:nouser=1'; end if;
      perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated', 'app_metadata', meta)::text, true);
      perform set_config('request.jwt.claim.sub', uid::text, true);
      set local role authenticated;
      {steps}
      raise exception 'PROBE_RESULT:%', res; end $p$;""")
    m_ = re.search(r"PROBE_RESULT:([a-z0-9_=; ]*)", str(r)) if not good else None
    return dict(kv.split("=") for kv in m_.group(1).split(";") if "=" in kv) if m_ else None
STEPS = """begin select count(*) into n from public.hr_alert_state; res := res || 'read=1;'; exception when others then res := res || 'read=0;'; end;"""
for who, em in (("Zach", HR_EMAIL), ("Krystal", CC_EMAIL)):
    p = probe(em, STEPS)
    if p is None or p.get("nouser"): say(f"  · could not test as {who} (no sign-in found); the rehearsal covers it")
    elif p.get("read") == "0": say(f"  ✓ acting as {who} (undone after): can't read where the alerts go")
    else: bad(f"acting as {who}, the alert table could be read")
leak = []
for path in ("hr_alert_state?select=id", "hr_cases?select=id", "hr_coaching?select=id", "app_data?select=key&key=eq.discipline_actions"):
    s3, b3 = http("GET", f"{FNB}/rest/v1/{path}", None, VIS)
    if s3 == 200 and jload(b3) not in ([], None, {}): leak.append(path.split("?")[0])
say("  ✓ the public key (anyone holding the link) reads no HR item and not where alerts go") if not leak else bad(f"the public key could read: {', '.join(leak)}")
s4, b4 = http("GET", HUB + "/", None, {})
if s4 == 200 and 'id="signinScreen"' in b4 and 'id="loginPassword"' in b4: say("  ✓ the link in the alert opens the Hub's sign-in screen first")
else: bad(f"could not confirm the Hub opens on its sign-in screen ({s4})")
if SEND_TEST:
    sT, bT = http("POST", URL + "?test=1", {}, OWN, 120); jt = jload(bT)
    if sT == 200 and jt.get("ok"):
        tx, em_ = int(jt.get("texts") or 0), int(jt.get("emails") or 0)
        msg = f"the test alert: {tx} text and {em_} of {len(EMAILS)} email(s) accepted by GoHighLevel"
        say(f"  ✓ {msg}. Ask Zach what came through.") if tx == 1 and em_ == len(EMAILS) else bad(msg + " (a card on Needs Attention says why)")
    elif sT == 409: say("  · the test alert was not sent: it is quiet hours. Run this again in the daytime to send one.")
    else: bad(f"the test alert answered {sT}: {str(bT)[:200]}")
else: say("  · no test alert was sent (you answered no in the launcher)")
say("  · tested before this ran: the rules and the job (43 checks), this step against a local copy of the database (see hr_alerts_965_test.py).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE. Tell Claude."); done(9)
say("RESULT: DONE · Zach's alerts check every 30 minutes, in practice (nothing sent until build step 10). Tell Claude.")
say("Undo: unschedule hr-alerts; the table can stay (only the server reads it). Claude can.")
done(0)
