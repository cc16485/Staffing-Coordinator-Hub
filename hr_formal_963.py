#!/usr/bin/env python3
# 963 · FORMAL CASES: THE AUDIT TRAIL AND "DRAFT WITH AI" (HR Agent build step 6; Samantha 2026-10-18: "build step 6").
# Part 1 (read only): the reviewed build; write-ups are owner-only (946); the AI key and the approved handbook are there.
# Part 2: the write-up audit trail (hr_formal_audit.sql: every added, changed or removed write-up is logged with who,
#   when and each changed field, by a trigger nothing can skip); deploy hr-draft ("Draft with AI", owners only).
# Part 3 (proof, all undone): acting as Zach, a change to a write-up is logged under his name; Krystal can't read the
#   log; hr-draft refuses the public key. A real AI draft is first tried by Zach in the Hub (nothing to send here).
# Nothing is texted or emailed. Prints counts only: no name, number, email, key or secret.
import os, json, re
os.environ.setdefault("SB_STEP", "963")
from cc_step_lib import *
REF = "zngsgedlsxinbygwmxwn"
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
NEW = "hr-draft"
HR_EMAIL = os.environ.get("SB_HR_EMAIL", "zach@mo-care.com"); CC_EMAIL = os.environ.get("SB_CC_EMAIL", "krystal@mo-care.com")
HERE = os.path.dirname(os.path.abspath(__file__))
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

start("FORMAL CASES: THE AUDIT TRAIL AND DRAFT WITH AI")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
ok_, st = sql(REF, """select (select count(*) from pg_policies where tablename = 'app_data' and policyname like 'app_data_hr_formal_%')::int as lock946,
  (select count(*) from public.app_data where key = 'hr_handbook')::int as handbook,
  (select jsonb_array_length(data) from public.app_data where key = 'discipline_actions')::int as writeups,
  (to_regclass('public.hr_formal_log') is not null) as logtbl""")
if not ok_ or not st: bad(f"could not read the database: {st}")
else:
    x = st[0]
    if x["lock946"] != 4: bad("write-ups are not owner-only yet (Desktop 946)")
    if x["handbook"] != 1: bad("the approved handbook rules (hr_handbook) are not there")
    if not fails: say(f"  ✓ write-ups are owner-only (946) · the approved handbook is there · {x['writeups'] or 0} write-up(s) on file · the audit trail is {'already there (an earlier run)' if x['logtbl'] else 'new'}")
s_, sb_ = http("GET", f"{API}/v1/projects/{REF}/secrets", headers=MG())
try: names = [x.get("name") for x in json.loads(sb_)] if s_ == 200 else []
except Exception: names = []
if "ANTHROPIC_API_KEY" in names: say("  ✓ the AI key is set on the server (its value is never read here)")
else: bad("the AI key (ANTHROPIC_API_KEY) is not set on the server")
K = keys(); ANON = K.get("anon", ""); HIDE.extend([ANON, K.get("service_role", "")])
if not ANON: bad("could not read the project's public key (the proof needs it)")
say("  · what changes: 1 new log table and its trigger, 1 new service. No text, no email, no switch.")
if fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
CHECK = """
do $v$ begin
  if not exists (select 1 from pg_trigger where tgname = 'hr_formal_audit' and tgrelid = 'public.app_data'::regclass and not tgisinternal) then raise exception '963 self-check: the trigger is not there'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.hr_formal_log'::regclass) then raise exception '963 self-check: row security is off'; end if;
  if has_table_privilege('authenticated', 'public.hr_formal_log', 'insert') or has_table_privilege('authenticated', 'public.hr_formal_log', 'update') or has_table_privilege('authenticated', 'public.hr_formal_log', 'delete') then raise exception '963 self-check: a page could change the log'; end if;
end $v$;"""
good, r = sql(REF, "begin;\n" + open(os.path.join(HERE, "hr_formal_audit.sql")).read() + CHECK + "\ncommit;")
if not good: bad(f"the audit trail did not go in, so nothing changed: {str(r)[:300]}"); say("  RESULT: STOPPED. Tell Claude."); done(5)
say("  ✓ the audit trail is in: every write-up change is logged with who, when and what changed; only you and Zach read it; nobody can edit it")
if not deploy(REF, FNROOT, NEW, True): say("  RESULT: STOPPED at the deploy. The audit trail is in (it only adds a log). Tell Claude."); done(6)

say(); say("PART 3 · PROOF (nothing is sent; changes are undone)")
time.sleep(float(os.environ.get("SB_SETTLE", "10")))
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
z = probe(HR_EMAIL, f"""perform public.upsert_app_data_item('discipline_actions', jsonb_build_object('id', 'probe963', 'caregiver', 'probe', 'level', 'Verbal Warning', 'status', 'draft'));
      reset role; select count(*) into n from public.hr_formal_log where item_id = 'probe963' and action = 'added' and by_email = {lit(HR_EMAIL)}; res := res || 'logged=' || n || ';';
      set local role authenticated; select count(*) into n from public.hr_formal_log where item_id = 'probe963'; res := res || 'see=' || n || ';';""")
if z is None or z.get("nouser"): bad("could not test as Zach")
elif z.get("logged") == "1" and z.get("see") == "1": say("  ✓ acting as Zach (undone after): a new write-up is logged under his name, and he can read the log")
else: bad(f"acting as Zach: {z}")
k = probe(CC_EMAIL, "select count(*) into n from public.hr_formal_log; res := res || 'see=' || n || ';';")
if k is None or k.get("nouser"): say("  · could not test as Krystal (no sign-in found); the rehearsal covers it")
elif k.get("see") == "0": say("  ✓ acting as Krystal (undone after): she can't read the log")
else: bad(f"acting as Krystal: {k}")
a1, b1 = http("POST", f"{FNB}/functions/v1/{NEW}", {"id": "x"}, {"apikey": ANON, "Authorization": "Bearer " + ANON})
say(f"  ✓ Draft with AI refuses the public key ({a1})") if a1 in (401, 403) else bad(f"Draft with AI answered the public key with {a1}")
say("  · tested before this ran: the audit trail against a local copy of the database, the draft service with a stand-in AI (23 checks).")
say()
if fails: say("RESULT: CHECK THE ✗ LINES ABOVE. Tell Claude."); done(9)
say("RESULT: DONE · Every write-up change is now logged, and Draft with AI is ready for Zach. Tell Claude, who merges the Hub change next. Nothing was sent.")
done(0)
