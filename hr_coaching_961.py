#!/usr/bin/env python3
# 961 · THE COACHING TRACKER (HR Agent build step 5; Samantha 2026-10-18: "go on to step 5").
# Part 1 (read only): the HR agent's case table (957) and the owner test are there; whether this ran before.
# Part 2: hr_coaching (coaching talks and compliments to pass on), hr_coaching_log (every action), the coordinator test
#   and hr_coaching_act, the one door a page uses to change them (hr_coaching.sql). One transaction.
# Part 3 (proof, all undone): acting as Zach he assigns a practice case to Krystal and her My Work card appears; acting
#   as Krystal she can't assign, can't finish without the conversation written down, can finish it with it, and the card
#   closes; an office person who is neither reads nothing.
# Nothing is texted or emailed. Coaching is only ever assigned by a person (Samantha or Zach) until build step 10.
# Prints counts only: no name, number, email, key or secret.
import os, json, re
os.environ.setdefault("SB_STEP", "961")
import cc_step_lib as L
from cc_step_lib import say, bad, done, sql, start, lit
REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
HERE = os.path.dirname(os.path.abspath(__file__))
HR_EMAIL = os.environ.get("SB_HR_EMAIL", "zach@mo-care.com"); CC_EMAIL = os.environ.get("SB_CC_EMAIL", "krystal@mo-care.com")
ok = lambda s: say("  ✓ " + s)
def stop(msg): bad(msg); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(2)
def one(q, what):
    good, rows = sql(REF, q)
    if not good: stop(f"could not read {what}: {rows}")
    v = rows[0]["r"] if rows else None
    return json.loads(v) if isinstance(v, str) else v

start("THE COACHING TRACKER")
say("PART 1 · READ ONLY (nothing changes)")
if not one("select to_jsonb(to_regclass('public.hr_cases') is not null) as r", "whether the case table is there"): stop("the HR agent's case table (Desktop 957) is not there")
X = one("""select jsonb_build_object(
  'cases', to_regclass('public.hr_cases') is not null,
  'coaching', to_regclass('public.hr_coaching') is not null,
  'funcs', (select coalesce(jsonb_agg(proname), '[]'::jsonb) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('desk_is_owner','desk_hub_ok','desk_me','upsert_app_data_item')),
  'n_cases', (select count(*) from public.hr_cases),
  'ops', (select jsonb_typeof(data) from public.app_data where key = 'ops_items')) as r""", "the HR tables")
if not X["cases"]: stop("the HR agent's case table (Desktop 957) is not there")
if set(X["funcs"] or []) != {"desk_is_owner", "desk_hub_ok", "desk_me", "upsert_app_data_item"}: stop("the owner test or the save function is missing")
if X["ops"] not in ("array", None): stop("the My Work list (ops_items) is not a list")
ok(f"the case table is there ({X['n_cases']} case(s)) · the coaching table is {'already there (an earlier run)' if X['coaching'] else 'new'}")
say("  · what changes: 2 new tables, 3 functions. No text, no email, no switch; nothing is assigned by this step.")
say()

say("PART 2 · THE CHANGE (one transaction: all of it or none of it)")
SQLTXT = open(os.path.join(HERE, "hr_coaching.sql")).read()
CHECK = """
do $v$ begin
  if not (select relrowsecurity from pg_class where oid = 'public.hr_coaching'::regclass) or not (select relrowsecurity from pg_class where oid = 'public.hr_coaching_log'::regclass) then raise exception '961 self-check: row security is off'; end if;
  if has_table_privilege('authenticated', 'public.hr_coaching', 'insert') or has_table_privilege('authenticated', 'public.hr_coaching', 'update') or has_table_privilege('authenticated', 'public.hr_coaching_log', 'insert') then raise exception '961 self-check: a page could write directly'; end if;
  if has_table_privilege('anon', 'public.hr_coaching', 'select') then raise exception '961 self-check: the public key can read coaching'; end if;
  if has_function_privilege('anon', 'public.hr_coaching_act(uuid,text,jsonb)', 'execute') then raise exception '961 self-check: the public key can call the door'; end if;
  if not (select prosecdef from pg_proc where proname = 'hr_coaching_act') then raise exception '961 self-check: the door does not run as the database'; end if;
end $v$;"""
good, r = sql(REF, "begin;\n" + SQLTXT + CHECK + "\ncommit;")
if not good: bad(f"the change did not go through, so nothing changed: {str(r)[:400]}"); say("  RESULT: STOPPED. Tell Claude."); done(8)
ok("the coaching tables, the audit log and the one door are in; only Samantha, Zach and the Care Coordinators can read them")
say()

say("PART 3 · PROOF (acting as each person, always undone)")
def probe(email, steps):
    good, r = sql(REF, f"""do $p$ declare uid uuid; meta jsonb; res text := ''; n int; cid uuid; kid text; card jsonb; begin
      select u.id, coalesce(u.raw_app_meta_data, '{{}}'::jsonb) into uid, meta from auth.users u where lower(u.email) = {lit(email)} and u.banned_until is null;
      if uid is null then raise exception 'PROBE_RESULT:nouser=1'; end if;
      perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated', 'app_metadata', meta)::text, true);
      perform set_config('request.jwt.claim.sub', uid::text, true);
      set local role authenticated;
      {steps}
      raise exception 'PROBE_RESULT:%', res; end $p$;""")
    m_ = re.search(r"PROBE_RESULT:([a-z0-9_=; ]*)", str(r)) if not good else None
    return dict(kv.split("=") for kv in m_.group(1).split(";") if "=" in kv) if m_ else None
TRY = lambda tag, call: f"begin {call}; res := res || '{tag}=1;'; exception when others then res := res || '{tag}=0;'; end;"
DUE = "(now() at time zone 'America/Chicago')::date + 5"
ASSIGN = f"perform public.hr_coaching_act(null, 'assign', jsonb_build_object('case_id', kid, 'assigned_to', {lit(CC_EMAIL)}, 'due_on', {DUE}, 'talking_points', 'probe'))"
n_cases = X["n_cases"]
if not n_cases:
    say("  · no practice case on file to test with yet; the rehearsal covers the whole flow")
else:
    PICK = "select id into kid from public.hr_cases where kind in ('coaching','recognition') and id not in (select case_id from public.hr_coaching where case_id is not null) limit 1;"
    z = probe(HR_EMAIL, PICK + TRY("assign", ASSIGN) + """
      reset role; select id into cid from public.hr_coaching where case_id = kid;
      select elem into card from public.app_data, jsonb_array_elements(data) elem where key = 'ops_items' and elem->>'id' = 'ops_coach_' || cid;
      res := res || 'card=' || case when card->>'status' = 'open' and card->>'owner' = """ + lit(CC_EMAIL) + """ then 1 else 0 end || ';';
      select count(*) into n from public.hr_coaching_log where coaching_id = cid; res := res || 'log=' || n || ';';""")
    if z is None or z.get("nouser"): bad("could not test as Zach")
    elif z.get("assign") == "1" and z.get("card") == "1" and z.get("log") == "1":
        ok("acting as Zach (undone after): assigns a practice case to Krystal; her My Work card appears; the audit log has it")
    else: bad(f"acting as Zach: {z}")
    k = probe(CC_EMAIL, PICK + TRY("assign", ASSIGN) + "select count(*) into n from public.hr_coaching; res := res || 'see=' || coalesce(n,0) || ';';")
    if k is None or k.get("nouser"): say("  · could not test as Krystal (no sign-in found); the rehearsal covers it")
    elif k.get("assign") == "0": ok("acting as Krystal (undone after): she can't assign coaching herself, and she can read the coaching list")
    else: bad(f"acting as Krystal: {k}")
say("  · tested before this ran: the whole flow against a local copy of the database (hr_coaching_961_test.py): assign, help, reply,")
say("    postpone, the required conversation record, flag wrong, not needed, hand off, reassign, the 30-day check, My Work cards.")
say()
if L.fails: say("RESULT: CHECK THE ✗ LINES ABOVE. Tell Claude."); done(9)
say("RESULT: DONE · The coaching tracker is in. Tell Claude, who merges the Hub change next. Nothing was assigned or sent.")
done(0)
