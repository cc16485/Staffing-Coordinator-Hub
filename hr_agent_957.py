#!/usr/bin/env python3
# 957 · THE HR AGENT, IN PRACTICE (HR Agent build step 4; Samantha 2026-10-18: "start step 4 now").
# Part 1 (read only): the reviewed build; the jobs' secret; whether the case table and the job are already there.
# Part 2: the case table hr_cases (only Samantha and Zach can read it or mark a case agree / disagree; nobody else can
#   read it; only the server writes cases); deploy hr-agent (sign-in check on); its morning schedule (7am CDT / 6am CST).
# Part 3 (proof; nothing is sent): the job refuses the public key and lets its schedule in; a practice run saves today's
#   cases with practice = true; acting as Krystal she sees none; acting as Zach he sees them and can mark one but can't
#   add one (all undone).
# The agent stays in PRACTICE until ops_settings.hr_agent_live is true (build step 10). Nothing is texted or emailed.
# Prints counts only: no name, number, email, key or secret.
import os, json, re
os.environ.setdefault("SB_STEP", "957")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
NEW = "hr-agent"; VAULT_NAME = "hub_job_secret"; SCHEDULE = "0 12 * * *"
HR_EMAIL = os.environ.get("SB_HR_EMAIL", "zach@mo-care.com"); CC_EMAIL = os.environ.get("SB_CC_EMAIL", "krystal@mo-care.com")
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
def jget(b, k):
    try: return json.loads(b).get(k)
    except Exception: return None
def command(url, anon):
    return ("select net.http_post(url := " + lit(url) + ", headers := jsonb_build_object('Content-Type', 'application/json', "
            "'Authorization', " + lit("Bearer " + anon) + ", 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")), "
            "body := '{}'::jsonb, timeout_milliseconds := 120000);")

TABLE = """
create table if not exists public.hr_cases (
  id text primary key,
  axiscare_caregiver_id text not null,
  caregiver text not null,
  kind text not null check (kind in ('recognition','coaching','recurring','serious')),
  rule text not null,
  title text not null,
  facts jsonb not null default '[]'::jsonb,
  handbook text not null default '',
  source_ids text[] not null default '{}',
  practice boolean not null default true,
  status text not null default 'open' check (status in ('open','reviewed','dismissed','done')),
  review text check (review in ('agree','disagree')),
  review_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.hr_cases is '957 (2026-10-18): the HR agent''s cases. Written by the server only; Samantha and Zach (owner_admin) read them and mark them agree or disagree. Practice until ops_settings.hr_agent_live.';
create index if not exists hr_cases_cg_rule on public.hr_cases (axiscare_caregiver_id, rule, created_at);
alter table public.hr_cases enable row level security;
revoke all on public.hr_cases from anon, authenticated;
grant select on public.hr_cases to authenticated;
grant update (status, review, review_note, reviewed_by, reviewed_at, updated_at) on public.hr_cases to authenticated;
grant all on public.hr_cases to service_role;
drop policy if exists hr_cases_owner_read on public.hr_cases;
drop policy if exists hr_cases_owner_mark on public.hr_cases;
create policy hr_cases_owner_read on public.hr_cases for select to authenticated using (public.desk_is_owner());
create policy hr_cases_owner_mark on public.hr_cases for update to authenticated using (public.desk_is_owner()) with check (public.desk_is_owner());
do $v$ begin
  if not (select relrowsecurity from pg_class where oid = 'public.hr_cases'::regclass) then raise exception '957 self-check: row security is off'; end if;
  if (select count(*) from pg_policies where tablename = 'hr_cases') <> 2 then raise exception '957 self-check: the two rules are not both there'; end if;
  if has_table_privilege('anon', 'public.hr_cases', 'select') then raise exception '957 self-check: the public key can read cases'; end if;
  if has_table_privilege('authenticated', 'public.hr_cases', 'insert') or has_table_privilege('authenticated', 'public.hr_cases', 'delete') then raise exception '957 self-check: a signed-in page could add or delete cases'; end if;
end $v$;"""

start("THE HR AGENT, IN PRACTICE")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
sN, mN = fmeta(REF, NEW)
ok, st = sql(REF, "select (select count(*) from vault.decrypted_secrets where name = " + lit(VAULT_NAME) + ")::int as vault, "
                  "(select count(*) from cron.job where jobname = " + lit(NEW) + ")::int as job, "
                  "(to_regclass('public.hr_cases') is not null) as tbl, "
                  "(select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'desk_is_owner')::int as owner_test")
if not ok or not st: bad(f"could not read the database: {st}")
else:
    if st[0]["vault"] != 1: bad("the jobs' secret is not in the vault")
    if st[0]["owner_test"] != 1: bad("the owner test My Desk uses (desk_is_owner) is missing")
    if not fails: say(f"  ✓ the jobs' secret and the owner test are there · the case table is {'already there (an earlier run)' if st[0]['tbl'] else 'new'} · the job is {'already there' if sN == 200 else 'new'}")
K = keys(); ANON, SVC = K.get("anon", ""), K.get("service_role", ""); HIDE.extend([ANON, SVC])
if not (ANON and SVC): bad("could not read the project's keys (the schedule and the proofs need them)")
say("  · what changes: 1 new table, 1 new service, its morning schedule. No text, no email, no switch.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
ok, r = sql(REF, "begin;" + TABLE + "\ncommit;")
if not ok: bad(f"the case table did not go in, so nothing changed: {str(r)[:300]}"); say("  RESULT: STOPPED. Tell Claude."); done(5)
say("  ✓ the case table is in: Samantha and Zach read and mark cases; nobody else reads them; only the server adds them")
if not deploy(REF, FNROOT, NEW, True): say("  RESULT: STOPPED at the deploy. The table is in (harmless, empty). Tell Claude."); done(6)
URL = f"{FNB}/functions/v1/{NEW}"
sql(REF, f"select cron.unschedule({lit(NEW)}) where exists (select 1 from cron.job where jobname = {lit(NEW)})")
ok, r = sql(REF, f"select cron.schedule({lit(NEW)}, {lit(SCHEDULE)}, {lit(command(URL, ANON))}) as id")
ok2, jb = sql(REF, f"select schedule, command from cron.job where jobname = {lit(NEW)}")
g = ok and ok2 and jb and jb[0]["schedule"] == SCHEDULE and "x-cron-secret" in jb[0]["command"] and "vault.decrypted_secrets" in jb[0]["command"]
say("  ✓ its schedule: every morning at 7am CDT (6am in winter), carrying the jobs' secret from the vault") if g else bad("the schedule did not go in")

say(); say("PART 3 · PROOF (nothing is sent)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
VIS = {"apikey": ANON, "Authorization": "Bearer " + ANON}
OWN = {"apikey": SVC, "Authorization": "Bearer " + SVC}
a1 = http("POST", URL + "?auth_check=1", {}, VIS)[0]
say(f"  ✓ the job refuses the public key ({a1})") if a1 == 401 else bad(f"the job let the public key in ({a1})")
ok, rq = sql(REF, command(URL + "?auth_check=1", ANON).rstrip(";") + " as id")
got = None; waited = 0.0
while ok and rq and waited <= 40:
    ok3, rr = sql(REF, f"select status_code, content from net._http_response where id = {int(rq[0]['id'])}")
    if ok3 and rr: got = rr[0]; break
    time.sleep(2); waited += 2
g = got and got["status_code"] == 200 and jget(got["content"], "caller") == "cron"
say("  ✓ its schedule gets in") if g else bad(f"its schedule was not let in ({got['status_code'] if got else 'no answer'})")
sD, bD = http("POST", URL, {}, OWN, 200)
try: j = json.loads(bD)
except Exception: j = {}
if sD == 200 and j.get("ok") and j.get("live") is False:
    bk = j.get("by_kind") or {}
    say(f"  ✓ the first practice run: {j.get('found', 0)} case(s) saved for review ({bk.get('coaching', 0)} coaching, {bk.get('recurring', 0)} recurring, "
        f"{bk.get('serious', 0)} serious, {bk.get('recognition', 0)} recognition), all marked practice")
elif sD == 200 and j.get("live"): bad("the agent says it is LIVE; it should be practice until build step 10 (ops_settings.hr_agent_live)")
else: bad(f"the practice run answered {sD}: {str(bD)[:200]}")
ok, pr = sql(REF, "select count(*)::int as n, count(*) filter (where not practice)::int as live_n from public.hr_cases")
if ok and pr and pr[0]["live_n"] == 0: say(f"  ✓ {pr[0]['n']} case(s) on file, every one practice")
else: bad(f"cases on file not all practice: {pr}")
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
STEPS = """select count(*) into n from public.hr_cases; res := res || 'see=' || n || ';';
      begin update public.hr_cases set review = 'agree', reviewed_by = 'probe', reviewed_at = now() where id = (select id from public.hr_cases limit 1); get diagnostics n = row_count; res := res || 'mark=' || n || ';';
      exception when others then res := res || 'mark=0;'; end;
      begin insert into public.hr_cases (id, axiscare_caregiver_id, caregiver, kind, rule, title) values ('probe957', '0', 'probe', 'coaching', 'w06', 'probe'); res := res || 'add=1;';
      exception when others then res := res || 'add=0;'; end;"""
total = pr[0]["n"] if ok and pr else 0
z = probe(HR_EMAIL, STEPS)
if z is None or z.get("nouser"): bad("could not test as Zach")
elif z.get("see") == str(total) and z.get("add") == "0" and (total == 0 or z.get("mark") == "1"):
    say(f"  ✓ acting as Zach (undone after): sees all {total}; can mark one agree; can't add a case")
else: bad(f"acting as Zach: {z}")
k = probe(CC_EMAIL, STEPS)
if k is None or k.get("nouser"): say("  · could not test as Krystal (no sign-in found); the rehearsal covers it")
elif k.get("see") == "0" and k.get("add") == "0" and k.get("mark") in ("0", None): say("  ✓ acting as Krystal (undone after): sees none, can't mark or add")
else: bad(f"acting as Krystal: {k}")
say("  · tested before this ran: the rules 31, this step against a local copy of the database (see hr_agent_957_test.py).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE. Tell Claude."); done(9)
say("RESULT: DONE · The HR agent runs every morning in practice. Its cases are on the HR page (Zach's dashboard, Agent practice) for you and Zach to mark. Nothing was sent.")
say("Undo: unschedule hr-agent; the table can stay (only owners can read it). Claude can.")
done(0)
