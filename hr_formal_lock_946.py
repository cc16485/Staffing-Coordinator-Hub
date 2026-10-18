#!/usr/bin/env python3
# 946 · WRITE-UPS ARE SAMANTHA AND ZACH'S ONLY, IN THE DATABASE (HR Agent build step 1; Samantha's HR decisions 2026-10-18:
# Zach is the HR lead and owns formal corrective action; Samantha and Zach see all confidential HR records; Krystal and
# Angiel see only what they need to coach and staff; enforced in the database, not just on screen).
#  · every write-up sits in ONE app_data slot, 'discipline_actions'. Today every Care Coordinator, Staffing and Team Hub
#    sign-in can read and change it (576 left it open on purpose, because coordinators approved write-ups then).
#  · this step adds four RESTRICTIVE rules: a signed-in page reads, saves or deletes 'discipline_actions' only when the
#    caller holds the owner_admin role (the same owner test My Desk and 576 use). They AND with the existing rules.
#  · the list itself does not move or change. A copy is kept whole in 'discipline_actions_946_previous', a slot no
#    browser can read (no key map row, fail closed).
#  · attendance ('attendance_events') is NOT touched: coordinators still log and read attendance.
#  · the server's own jobs (missed shift notes, reports) keep working: they run as the service role, which row security
#    does not apply to (app_data's row security is not forced; checked below).
#  · then it acts AS an owner, Zach, and a Care Coordinator, inside transactions that are always undone.
#  No GRANT or REVOKE. Nothing is texted, emailed or called. Safe to run again. Undo: hr_formal_lock_946_rollback.sql.
import json, os, re
os.environ.setdefault("SB_STEP", "946")
import cc_step_lib as L
from cc_step_lib import say, bad, done, sql, start, lit

REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
KEY, PREV, ATT = "discipline_actions", "discipline_actions_946_previous", "attendance_events"
OWNER_EMAIL = os.environ.get("SB_OWNER_EMAIL", "samantha@mo-care.com")
HR_EMAIL = os.environ.get("SB_HR_EMAIL", "zach@mo-care.com")
ok = lambda s: say("  ✓ " + s)
def stop(msg): bad(msg); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(2)
def one(q, what):
    good, rows = sql(REF, q)
    if not good: stop(f"could not read {what}: {rows}")
    v = rows[0]["r"] if rows else None
    return json.loads(v) if isinstance(v, str) else v

start("WRITE-UPS ARE SAMANTHA AND ZACH'S ONLY, IN THE DATABASE")
say("PART 1 · READ ONLY (nothing changes)")
X = one(f"""select jsonb_build_object(
  'rls', (select relrowsecurity from pg_class where oid = 'public.app_data'::regclass),
  'forced', (select relforcerowsecurity from pg_class where oid = 'public.app_data'::regclass),
  'funcs', (select coalesce(jsonb_agg(proname), '[]'::jsonb) from pg_proc where pronamespace = 'public'::regnamespace
                and proname in ('desk_is_owner', 'desk_hub_ok', 'desk_me')),
  'upsert_definer', (select bool_or(prosecdef) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'upsert_app_data_item'),
  'map', (select coalesce(jsonb_agg(hub_slug order by hub_slug), '[]'::jsonb) from public.app_data_key_hub_map where data_key = {lit(KEY)}),
  'map_prev', (select count(*) from public.app_data_key_hub_map where data_key = {lit(PREV)}),
  'list', (select data from public.app_data where key = {lit(KEY)}),
  'prev', (select data from public.app_data where key = {lit(PREV)}),
  'people', (select coalesce(jsonb_agg(jsonb_build_object('id', p.person_id, 'name', p.full_name, 'email', lower(coalesce(p.primary_email, '')),
       'uid', (select ai.auth_user_id from public.auth_identities ai join auth.users u on u.id = ai.auth_user_id
                where ai.person_id = p.person_id and u.banned_until is null order by ai.auth_user_id limit 1),
       'roles', coalesce((select jsonb_agg(r.role) from public.staff_roles r where r.person_id = p.person_id and r.entity = 'cc_ihs'), '[]'::jsonb))), '[]'::jsonb)
     from public.persons p where p.active)) as r""", "how app_data is protected")
if not X["rls"] or X["forced"]: stop("row security on app_data is not in its usual state (on, not forced)")
ok("row security is on for app_data (not forced, so the server's own jobs are unaffected)")
if set(X["funcs"] or []) != {"desk_is_owner", "desk_hub_ok", "desk_me"}: stop("the owner and sign-in tests My Desk uses (463) are not all there")
if X["upsert_definer"] is None: stop("the save function upsert_app_data_item is missing")
if X["upsert_definer"]: stop("the save function runs as its owner, so database rules would not apply to saves")
ok("saves go through upsert_app_data_item as the person saving, so the database rules apply to them")
if X["map_prev"]: stop(f"'{PREV}' has a key map row, so a browser could read the backup")
if X["list"] is not None and not isinstance(X["list"], list): stop("the write-up list is not a list")
LIST = X["list"] if isinstance(X["list"], list) else []
levels = {}
for a in LIST: levels[a.get("level") or "(no level)"] = levels.get(a.get("level") or "(no level)", 0) + 1
say(f"  · the write-up list holds {len(LIST)} write-up(s): " + (", ".join(f"{n} {k}" for k, n in sorted(levels.items())) or "none"))
say(f"  · today it is open to the hub(s): {', '.join(X['map'] or []) or 'none'}. That stays; the new rules narrow it to owners.")
PPL = X["people"] or []
OWNERP = next((p for p in PPL if p["email"] == OWNER_EMAIL and "owner_admin" in (p["roles"] or []) and p["uid"]), None)
if not OWNERP: stop(f"{OWNER_EMAIL} is not an owner with a working sign-in to test with")
HRP = next((p for p in PPL if p["email"] == HR_EMAIL and "owner_admin" in (p["roles"] or []) and p["uid"]), None)
if not HRP: stop(f"{HR_EMAIL} (Zach) does not hold the owner role with a working sign-in, so he would lose the write-ups too")
ok(f"{OWNERP['name']} and {HRP['name']} both hold the owner role, so both keep full access")
COORD = [p for p in PPL if p["uid"] and "care_coordinator" in (p["roles"] or []) and "owner_admin" not in (p["roles"] or [])]
if not COORD: say("  · no Care Coordinator sign-in to test the 'not allowed' side with; the rehearsal covers it")
say()

say("PART 2 · THE CHANGE (one transaction: all of it or none of it)")
CHANGE = f"""
insert into public.app_data (key, data) select {lit(PREV)}, data from public.app_data where key = {lit(KEY)} on conflict (key) do nothing;
drop policy if exists app_data_hr_formal_sel on public.app_data;
drop policy if exists app_data_hr_formal_ins on public.app_data;
drop policy if exists app_data_hr_formal_upd on public.app_data;
drop policy if exists app_data_hr_formal_del on public.app_data;
create policy app_data_hr_formal_sel on public.app_data as restrictive for select to authenticated, anon
  using (key <> {lit(KEY)} or public.desk_is_owner());
create policy app_data_hr_formal_ins on public.app_data as restrictive for insert to authenticated, anon
  with check (key <> {lit(KEY)} or public.desk_is_owner());
create policy app_data_hr_formal_upd on public.app_data as restrictive for update to authenticated, anon
  using (key <> {lit(KEY)} or public.desk_is_owner())
  with check (key <> {lit(KEY)} or public.desk_is_owner());
create policy app_data_hr_formal_del on public.app_data as restrictive for delete to authenticated, anon
  using (key <> {lit(KEY)} or public.desk_is_owner());
do $v$ declare n_before int := {len(LIST)}; n_after int; begin
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'app_data' and policyname like 'app_data_hr_formal_%' and permissive = 'RESTRICTIVE') <> 4 then
    raise exception '946 self-check: the four rules are not all in place'; end if;
  if exists (select 1 from public.app_data_key_hub_map where data_key = {lit(PREV)}) then raise exception '946 self-check: the backup is readable'; end if;
  select jsonb_array_length(coalesce(data, '[]'::jsonb)) into n_after from public.app_data where key = {lit(KEY)};
  if coalesce(n_after, 0) <> n_before then raise exception '946 self-check: % write-ups before, % after', n_before, coalesce(n_after, 0); end if;
end $v$;"""
good, r = sql(REF, CHANGE)
if not good: bad(f"the database change did not go through, so nothing changed: {str(r)[:400]}"); say("  RESULT: STOPPED. Tell Claude."); done(8)
ok(f"the four owner-only rules are in place; all {len(LIST)} write-up(s) untouched; a copy is kept in {PREV}")
say()

say("PART 3 · PROOF (acting as each person, always undone)")
def probe(P, steps):
    """Run steps as person P (claims built like a real sign-in) and return the PROBE_RESULT text. Everything is undone."""
    good, r = sql(REF, f"""do $p$ declare uid uuid := {lit(P['uid'])}::uuid; meta jsonb; res text := ''; n int; b boolean; begin
      select coalesce(raw_app_meta_data, '{{}}'::jsonb) into meta from auth.users where id = uid;
      perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'role', 'authenticated', 'app_metadata', meta)::text, true);
      perform set_config('request.jwt.claim.sub', uid::text, true);
      set local role authenticated;
      {steps}
      raise exception 'PROBE_RESULT:%', res; end $p$;""")
    m_ = re.search(r"PROBE_RESULT:([a-z0-9_=; ]*)", str(r)) if not good else None
    if not m_: return None, str(r)[:300]
    return dict(kv.split("=") for kv in m_.group(1).split(";") if "=" in kv), None
SEE = lambda tag, key: f"select count(*) into n from public.app_data where key = {lit(key)}; res := res || '{tag}=' || n || ';';"
def TRY(tag, key, item):
    pid = json.loads(item)["id"]
    return f"""begin perform public.upsert_app_data_item({lit(key)}, {lit(item)}::jsonb); exception when others then null; end;
      reset role; select exists (select 1 from public.app_data a, jsonb_array_elements(coalesce(a.data, '[]'::jsonb)) x where a.key = {lit(key)} and x->>'id' = {lit(pid)}) into b;
      set local role authenticated; res := res || '{tag}=' || case when b then 1 else 0 end || ';';"""
WU = json.dumps({"id": "dw946probe", "caregiver": "946 proof", "level": "Verbal Warning", "status": "draft"})
AE = json.dumps({"id": "ae946probe", "caregiver": "946 proof", "type": "tardy", "shift_date": "2026-10-18"})
HAS_ATT = one(f"select to_jsonb(exists (select 1 from public.app_data where key = {lit(ATT)})) as r", "whether attendance exists")
ALL = SEE("see_wu", KEY) + TRY("save_wu", KEY, WU) + SEE("see_att", ATT) + TRY("save_att", ATT, AE)
has = "1" if X["list"] is not None else "0"; att = "1" if HAS_ATT else "0"
words = {"see_wu": "sees the write-ups", "save_wu": "can save a write-up", "see_att": "sees attendance", "save_att": "can log attendance"}
for P, want, label in ((OWNERP, {"see_wu": has, "save_wu": "1", "see_att": att, "save_att": "1"}, "an owner"),
                       (HRP, {"see_wu": has, "save_wu": "1", "see_att": att, "save_att": "1"}, "the HR lead")) + \
                      (((COORD[0], {"see_wu": "0", "save_wu": "0", "see_att": att, "save_att": "1"}, "a Care Coordinator"),) if COORD else ()):
    got, err = probe(P, ALL)
    if got is None: bad(f"could not test as {P['name']}: {err}"); continue
    wrong = [k for k in want if got.get(k) != want[k]]
    if wrong: bad(f"acting as {P['name']} ({label}): " + "; ".join(("WRONGLY " if want[k] == "0" else "NOT: ") + words[k] for k in wrong))
    else: ok(f"acting as {P['name']} ({label}, undone after): " + "; ".join(("yes, " if want[k] == "1" else "no, ") + words[k] for k in want))
say("  · rehearsed before this ran: this step against a local copy of the database (see hr_formal_lock_946_test.py).")
say()
if L.fails: say("RESULT: CHECK THE ✗ LINES ABOVE. Tell Claude."); done(9)
say("RESULT: DONE · Tell Claude, who checks the live pages next. Krystal no longer sees write-ups; Zach and Samantha do. Nothing was sent."); done(0)
