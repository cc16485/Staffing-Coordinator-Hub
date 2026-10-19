#!/usr/bin/env python3
# 995 · THE DATABASE GUARDS WHO OWNS A LEAD (audit step 8; Samantha 2026-10-18: "Start audit step 8: database-enforced owner
# changes, built switched off").
#  · the Hub already lets only Samantha or Zachary change a lead's owner while lead turns are on. This adds the same rule
#    to the database (lead_owner_guard_995.sql), so no page or tool signed in as someone else can do it either, and a
#    lead's first owner (who a bonus goes to) never changes from a browser.
#  · it waits for ops_settings.owner_guard_live (Settings > Leads > Lead turns), so today every save goes through as before.
#  · then it acts AS a Care Coordinator and AS an owner with the guard switched on, inside transactions that are always
#    undone, to prove the rule (nothing they try is kept, and the switch stays as it was).
#  No GRANT or REVOKE. No data changes. Nothing is texted, emailed or called. Undo: lead_owner_guard_995_rollback.sql.
import json, os, re
os.environ.setdefault("SB_STEP", "995")
import cc_step_lib as L
from cc_step_lib import say, bad, done, sql, start, lit

REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
HERE = os.path.dirname(os.path.abspath(__file__))
OWNER_EMAIL = os.environ.get("SB_OWNER_EMAIL", "samantha@mo-care.com")
ok = lambda s: say("  ✓ " + s)
def stop(msg): bad(msg); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(2)
def one(q, what):
    good, rows = sql(REF, q)
    if not good: stop(f"could not read {what}: {rows}")
    v = rows[0]["r"] if rows else None
    return json.loads(v) if isinstance(v, str) else v

start("THE DATABASE GUARDS WHO OWNS A LEAD")
say("PART 1 · READ ONLY (nothing changes)")
X = one("""select jsonb_build_object(
  'rls', (select relrowsecurity from pg_class where oid = 'public.app_data'::regclass),
  'owner_fn', (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'desk_is_owner'),
  'upsert_definer', (select bool_or(prosecdef) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'upsert_app_data_item'),
  'trigger', (select count(*) from pg_trigger where tgname = 'lead_owner_guard' and not tgisinternal),
  'guard', (select data->'owner_guard_live' from public.app_data where key = 'ops_settings'),
  'turns', (select data->'lead_rotation_live' from public.app_data where key = 'ops_settings'),
  'leads', (select jsonb_array_length(coalesce(data, '[]'::jsonb)) from public.app_data where key = 'leads'),
  'owned', (select count(*) from public.app_data a, jsonb_array_elements(coalesce(a.data, '[]'::jsonb)) x where a.key = 'leads' and coalesce(x->>'assigned_coordinator', '') <> ''),
  'people', (select coalesce(jsonb_agg(jsonb_build_object('name', p.full_name, 'email', lower(coalesce(p.primary_email, '')),
       'uid', (select ai.auth_user_id from public.auth_identities ai join auth.users u on u.id = ai.auth_user_id
                where ai.person_id = p.person_id and u.banned_until is null order by ai.auth_user_id limit 1),
       'roles', coalesce((select jsonb_agg(r.role) from public.staff_roles r where r.person_id = p.person_id and r.entity = 'cc_ihs'), '[]'::jsonb))), '[]'::jsonb)
     from public.persons p where p.active)) as r""", "how leads are saved")
if not X["rls"]: stop("row security is off on app_data, which is not its usual state")
if not X["owner_fn"]: stop("the owner test My Desk uses (desk_is_owner) is missing")
if X["upsert_definer"] is None: stop("the save function upsert_app_data_item is missing")
if X["upsert_definer"]: stop("the save function runs as its owner, so the guard could not tell who is saving")
ok("leads are saved as the person saving, so the database can tell an owner from anyone else")
say(f"  · {X['leads'] or 0} leads on file, {X['owned'] or 0} with an owner; the guard is {'already installed (this refreshes it)' if X['trigger'] else 'not installed yet'}")
say(f"  · the guard switch: {'ON' if X['guard'] is True else 'off, so every save goes through as today'}; lead turns: {'ON' if X['turns'] is True else 'off'} (both unchanged by this step)")
PPL = X["people"] or []
CC = next((p for p in PPL if p["uid"] and "care_coordinator" in (p["roles"] or []) and "owner_admin" not in (p["roles"] or [])), None)
OW = next((p for p in PPL if p["uid"] and p["email"] == OWNER_EMAIL and "owner_admin" in (p["roles"] or [])), None)
if not OW: stop(f"{OWNER_EMAIL} is not an owner with a working sign-in to test with")
if not X["owned"]: say("  · no lead has an owner yet, so the proof below uses the rehearsal only")
say()

say("PART 2 · THE CHANGE (one transaction: all of it or none of it)")
CHANGE = open(os.path.join(HERE, "lead_owner_guard_995.sql")).read() + """
do $v$ begin
  if (select count(*) from pg_trigger where tgname = 'lead_owner_guard' and not tgisinternal) <> 1 then raise exception '995 self-check: the guard is not in place exactly once'; end if;
  if not (select prosecdef from pg_proc where proname = 'lead_owner_guard' and pronamespace = 'public'::regnamespace) then raise exception '995 self-check: the guard does not run as its owner'; end if;
end $v$;"""
good, r = sql(REF, CHANGE)
if not good: bad(f"the database change did not go through, so nothing changed: {str(r)[:400]}"); say("  RESULT: STOPPED. Tell Claude."); done(8)
ok("the guard is in place, waiting for its switch")
say()

say("PART 3 · PROOF (acting as each person with the guard switched on, always undone)")
def probe(P):
    good, r = sql(REF, f"""do $p$ declare uid uuid := {lit(P['uid'])}::uuid; meta jsonb; res text := ''; it jsonb; begin
      update public.app_data set data = data || '{{"owner_guard_live": true, "lead_rotation_live": true}}'::jsonb where key = 'ops_settings';
      select x into it from public.app_data a, jsonb_array_elements(coalesce(a.data, '[]'::jsonb)) x where a.key = 'leads' and coalesce(x->>'assigned_coordinator', '') <> '' limit 1;
      if it is null then raise exception 'PROBE_RESULT:none=1'; end if;
      if coalesce(it #>> '{{original_owner,name}}', '') = '' then   /* a lead from before turns has no first owner yet: give the test copy one (undone with the rest) */
        it := jsonb_set(it, '{{original_owner}}', jsonb_build_object('name', split_part(btrim(it->>'assigned_coordinator'), ' ', 1)));
        perform public.upsert_app_data_item('leads', it); end if;
      select coalesce(raw_app_meta_data, '{{}}'::jsonb) into meta from auth.users where id = uid;
      perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated', 'app_metadata', meta)::text, true);
      perform set_config('request.jwt.claim.sub', uid::text, true);
      set local role authenticated;
      begin perform public.upsert_app_data_item('leads', it); res := res || 'same=1;'; exception when others then res := res || 'same=0;'; end;
      begin perform public.upsert_app_data_item('leads', jsonb_set(it, '{{assigned_coordinator}}', '"Proof995"'::jsonb)); res := res || 'move=1;';
        exception when others then res := res || 'move=0;' || case when sqlerrm like 'LEAD_OWNER_GUARD%' then 'said=1;' else 'said=0;' end; end;
      begin perform public.upsert_app_data_item('leads', jsonb_set(it, '{{original_owner}}', '{{"name": "Proof995"}}'::jsonb)); res := res || 'first=1;';
        exception when others then res := res || 'first=0;'; end;
      raise exception 'PROBE_RESULT:%', res; end $p$;""")
    m_ = re.search(r"PROBE_RESULT:([a-z0-9_=; ]*)", str(r)) if not good else None
    if not m_: return None, str(r)[:300]
    return dict(kv.split("=") for kv in m_.group(1).split(";") if "=" in kv), None
WORDS = {"same": "an ordinary save of a lead goes through", "move": "can move a lead to someone else", "first": "can change a lead's first owner"}
for P, want, label in (((CC, {"same": "1", "move": "0", "first": "0"}, "a Care Coordinator"),) if CC else ()) + ((OW, {"same": "1", "move": "1", "first": "0"}, "an owner"),):
    got, err = probe(P)
    if got is None: bad(f"could not test as {P['name']}: {err}"); continue
    if got.get("none"): say(f"  · {P['name']}: no lead with an owner to test on (the rehearsal covers it)"); continue
    wrong = [k for k in want if got.get(k) != want[k]]
    if wrong: bad(f"acting as {P['name']} ({label}): " + "; ".join(("WRONGLY " if want[k] == "0" else "NOT: ") + WORDS[k] for k in wrong))
    else: ok(f"acting as {P['name']} ({label}, undone after): " + "; ".join(("yes, " if want[k] == "1" else "no, ") + WORDS[k] for k in want))
    if label == "a Care Coordinator" and got.get("said") == "1": ok("the refusal says why (Only Samantha or Zachary can change who owns a lead)")
if not CC: say("  · no Care Coordinator account to test the refused side with; the rehearsal covers it")
G = one("select jsonb_build_object('guard', (select data->'owner_guard_live' from public.app_data where key = 'ops_settings')) as r", "the switch after the proof")
if G["guard"] == X["guard"]: ok("the switch is exactly as it was before the proof")
else: bad("the switch changed during the proof; tell Claude")
say("  · rehearsed before this ran: this step's SQL against a local copy of the database (lead_owner_guard_995_test.py, 17 checks).")
say()
if L.fails: say("RESULT: CHECK THE ✗ LINES ABOVE. Tell Claude."); done(9)
say("RESULT: DONE · The guard is in place and switched off. Samantha or Zachary turns it on in the Hub (Settings > Leads > Lead turns). Nothing was sent."); done(0)
