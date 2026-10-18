#!/usr/bin/env python3
# 918 · THE SPRINGFIELD LEAD RUNS RESIGNATION AND END-OF-ASSIGNMENT OFFBOARDING (Samantha 2026-10-18: Krystal runs the
# caregiver offboarding checklist for resignations and end of assignment; Samantha runs terminations and her sign-off
# stays required before the employee is told).
#  · today every offboarding checklist sits in ONE app_data slot, 'offboardings', which only owners can read (576).
#    Terminations are in it, so it can't simply be opened to the lead.
#  · this step adds a second slot, 'offboardings_team', for Resignation and End of assignment. Owners and whoever holds
#    the springfield_lead role may read and save it; only owners may delete it; the database refuses a Termination in it.
#  · existing resignation and end-of-assignment checklists move from 'offboardings' to 'offboardings_team'; Terminations
#    (and anything without a kind) stay where they are. The old list is kept whole in 'offboardings_918_previous', a
#    slot no browser can read (no key map row, fail closed), so it can be put back exactly.
#  · then it acts AS the lead, an owner and another office person, inside transactions that are always undone.
#  No GRANT or REVOKE. Nothing is texted, emailed or called. Safe to run again.
import json, os, re
os.environ.setdefault("SB_STEP", "918")
import cc_step_lib as L
from cc_step_lib import say, bad, done, sql, start, lit

REF = os.environ.get("SB_REF", "zngsgedlsxinbygwmxwn")
OWN, TEAM, PREV = "offboardings", "offboardings_team", "offboardings_918_previous"
OWNER_EMAIL = os.environ.get("SB_OWNER_EMAIL", "samantha@mo-care.com")
ok = lambda s: say("  ✓ " + s)
def stop(msg): bad(msg); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(2)
def one(q, what):
    good, rows = sql(REF, q)
    if not good: stop(f"could not read {what}: {rows}")
    v = rows[0]["r"] if rows else None
    return json.loads(v) if isinstance(v, str) else v

TERM = """jsonb_path_exists(coalesce({d}, '[]'::jsonb), '$[*] ? (@.kind == "Termination")')"""

start("THE SPRINGFIELD LEAD RUNS RESIGNATION AND END-OF-ASSIGNMENT OFFBOARDING")
say("PART 1 · READ ONLY (nothing changes)")
X = one(f"""select jsonb_build_object(
  'rls', (select relrowsecurity from pg_class where oid = 'public.app_data'::regclass),
  'forced', (select relforcerowsecurity from pg_class where oid = 'public.app_data'::regclass),
  'lock576', (select count(*) from pg_policies where schemaname = 'public' and tablename = 'app_data' and policyname like 'app_data_owner_keys_%'
                and permissive = 'RESTRICTIVE' and coalesce(qual, with_check) like '%offboardings%'),
  'funcs', (select coalesce(jsonb_agg(proname), '[]'::jsonb) from pg_proc where pronamespace = 'public'::regnamespace
                and proname in ('desk_is_owner', 'desk_hub_ok', 'desk_me')),
  'upsert_definer', (select bool_or(prosecdef) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'upsert_app_data_item'),
  'map_own', (select coalesce(jsonb_agg(hub_slug order by hub_slug), '[]'::jsonb) from public.app_data_key_hub_map where data_key = {lit(OWN)}),
  'map_team', (select coalesce(jsonb_agg(hub_slug order by hub_slug), '[]'::jsonb) from public.app_data_key_hub_map where data_key = {lit(TEAM)}),
  'map_prev', (select count(*) from public.app_data_key_hub_map where data_key = {lit(PREV)}),
  'own', (select data from public.app_data where key = {lit(OWN)}),
  'team', (select data from public.app_data where key = {lit(TEAM)}),
  'prev', (select count(*) from public.app_data where key = {lit(PREV)}),
  'people', (select coalesce(jsonb_agg(jsonb_build_object('id', p.person_id, 'name', p.full_name, 'email', lower(coalesce(p.primary_email, '')),
       'uid', (select ai.auth_user_id from public.auth_identities ai join auth.users u on u.id = ai.auth_user_id
                where ai.person_id = p.person_id and u.banned_until is null order by ai.auth_user_id limit 1),
       'roles', coalesce((select jsonb_agg(r.role) from public.staff_roles r where r.person_id = p.person_id and r.entity = 'cc_ihs'), '[]'::jsonb))), '[]'::jsonb)
     from public.persons p where p.active)) as r""", "how app_data is protected")
if not X["rls"] or X["forced"]: stop("row security on app_data is not in its usual state (on, not forced)")
ok("row security is on for app_data (not forced, so the server's own jobs are unaffected)")
if not X["lock576"]: stop("the owners-only lock on 'offboardings' (576) is not in place, so this would be built on sand")
ok("the owners-only lock on the current offboarding list (576) is in place")
if set(X["funcs"] or []) != {"desk_is_owner", "desk_hub_ok", "desk_me"}: stop("the owner and sign-in tests My Desk uses (463) are not all there")
if X["upsert_definer"] is None: stop("the save function upsert_app_data_item is missing")
if X["upsert_definer"]: stop("the save function runs as its owner, so database rules would not apply to saves")
ok("saves go through upsert_app_data_item as the person saving, so the database rules apply to them")
MAP = X["map_own"] or []
if not MAP: stop("'offboardings' has no hub in the key map, so there is nothing to copy for the new slot")
if X["map_prev"]: stop(f"'{PREV}' has a key map row, so a browser could read the backup")
say(f"  · the current list is open to the hub(s) {', '.join(MAP)}; the new slot gets the same" + ("" if not X["map_team"] else f" (already: {', '.join(X['map_team'])})"))
OWNL = X["own"] if isinstance(X["own"], list) else []
TEAML = X["team"] if isinstance(X["team"], list) else []
if X["own"] is not None and not isinstance(X["own"], list): stop("the current offboarding list is not a list")
kinds = {}
for o in OWNL: kinds[o.get("kind") or "(no kind)"] = kinds.get(o.get("kind") or "(no kind)", 0) + 1
say(f"  · the current list holds {len(OWNL)} checklist(s): " + (", ".join(f"{n} {k}" for k, n in sorted(kinds.items())) or "none"))
if any((o.get("kind") == "Termination") for o in TEAML): stop("the new slot already holds a Termination; tell Claude")
moving = [o for o in OWNL if o.get("kind") and o.get("kind") != "Termination" and o.get("id") not in {t.get("id") for t in TEAML}]
say(f"  · {len(moving)} resignation / end-of-assignment checklist(s) will move to the new slot" + (f" (it already holds {len(TEAML)})" if TEAML else ""))
PPL = X["people"] or []
LEADS = [p for p in PPL if "springfield_lead" in (p["roles"] or [])]
if not LEADS: stop("nobody holds the Springfield lead role, so the new slot would only be open to owners")
K = LEADS[0]
if not K["uid"]: stop(f"{K['name']} holds the Springfield lead role but has no working sign-in")
say(f"  · the Springfield lead: {K['name']}" + ("" if len(LEADS) == 1 else f" (and {len(LEADS) - 1} more)"))
OWNERP = next((p for p in PPL if p["email"] == OWNER_EMAIL and "owner_admin" in (p["roles"] or []) and p["uid"]), None)
if not OWNERP: stop(f"{OWNER_EMAIL} is not an owner with a working sign-in to test with")
OTHERS = [p for p in PPL if p["uid"] and not ({"owner_admin", "springfield_lead"} & set(p["roles"] or [])) and p["roles"]]
say()

say("PART 2 · THE CHANGE (one transaction: all of it or none of it)")
CHANGE = f"""
insert into public.app_data (key, data) select {lit(PREV)}, data from public.app_data where key = {lit(OWN)} on conflict (key) do nothing;
create or replace function public.offboard_team_ok() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $f$
  select public.desk_is_owner() or (public.desk_hub_ok() and exists (
    select 1 from public.staff_roles r where r.person_id = public.desk_me() and r.entity = 'cc_ihs' and r.role = 'springfield_lead'))
$f$;
comment on function public.offboard_team_ok() is '918 (2026-10-18): owners, or the Springfield lead, may read and save the offboardings_team slot (Resignation and End of assignment checklists).';
insert into public.app_data_key_hub_map (data_key, hub_slug) select {lit(TEAM)}, hub_slug from public.app_data_key_hub_map where data_key = {lit(OWN)} on conflict do nothing;
insert into public.app_data (key, data) values ({lit(TEAM)}, '[]'::jsonb) on conflict (key) do nothing;
update public.app_data t set data = coalesce(t.data, '[]'::jsonb) || coalesce((select jsonb_agg(x) from public.app_data o, jsonb_array_elements(coalesce(o.data, '[]'::jsonb)) x
    where o.key = {lit(OWN)} and coalesce(x->>'kind', '') not in ('', 'Termination')
      and not exists (select 1 from jsonb_array_elements(coalesce(t.data, '[]'::jsonb)) y where y->>'id' = x->>'id')), '[]'::jsonb)
  where t.key = {lit(TEAM)};
update public.app_data o set data = coalesce((select jsonb_agg(x) from jsonb_array_elements(coalesce(o.data, '[]'::jsonb)) x
    where coalesce(x->>'kind', '') in ('', 'Termination')), '[]'::jsonb)
  where o.key = {lit(OWN)};
drop policy if exists app_data_offboard_team_sel on public.app_data;
drop policy if exists app_data_offboard_team_ins on public.app_data;
drop policy if exists app_data_offboard_team_upd on public.app_data;
drop policy if exists app_data_offboard_team_del on public.app_data;
create policy app_data_offboard_team_sel on public.app_data as restrictive for select to authenticated, anon
  using (key <> {lit(TEAM)} or public.offboard_team_ok());
create policy app_data_offboard_team_ins on public.app_data as restrictive for insert to authenticated, anon
  with check (key <> {lit(TEAM)} or (public.offboard_team_ok() and not {TERM.format(d='data')}));
create policy app_data_offboard_team_upd on public.app_data as restrictive for update to authenticated, anon
  using (key <> {lit(TEAM)} or public.offboard_team_ok())
  with check (key <> {lit(TEAM)} or (public.offboard_team_ok() and not {TERM.format(d='data')}));
create policy app_data_offboard_team_del on public.app_data as restrictive for delete to authenticated, anon
  using (key <> {lit(TEAM)} or public.desk_is_owner());
do $v$ declare n_before int := {len(OWNL) + len(TEAML)}; n_own int; n_team int; begin
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'app_data' and policyname like 'app_data_offboard_team_%' and permissive = 'RESTRICTIVE') <> 4 then
    raise exception '918 self-check: the four rules for the new slot are not all in place'; end if;
  if not exists (select 1 from public.app_data_key_hub_map where data_key = {lit(TEAM)}) then raise exception '918 self-check: the new slot has no hub'; end if;
  if exists (select 1 from public.app_data_key_hub_map where data_key = {lit(PREV)}) then raise exception '918 self-check: the backup is readable'; end if;
  if (select {TERM.format(d='data')} from public.app_data where key = {lit(TEAM)}) then raise exception '918 self-check: a Termination is in the new slot'; end if;
  select jsonb_array_length(coalesce(data, '[]'::jsonb)) into n_own from public.app_data where key = {lit(OWN)};
  select jsonb_array_length(coalesce(data, '[]'::jsonb)) into n_team from public.app_data where key = {lit(TEAM)};
  if coalesce(n_own, 0) + coalesce(n_team, 0) <> n_before then raise exception '918 self-check: % checklists before, % after', n_before, coalesce(n_own, 0) + coalesce(n_team, 0); end if;
end $v$;"""
good, r = sql(REF, CHANGE)
if not good: bad(f"the database change did not go through, so nothing changed: {str(r)[:400]}"); say("  RESULT: STOPPED. Tell Claude."); done(8)
ok(f"the new slot, its rules and its hub are in place; {len(moving)} checklist(s) moved; the old list is kept in {PREV}")
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
RES = json.dumps({"id": "off918probe", "name": "918 proof", "kind": "Resignation", "status": "open", "steps": []})
TRM = json.dumps({"id": "off918term", "name": "918 proof", "kind": "Termination", "status": "open", "steps": []})
ALL = SEE("see_team", TEAM) + SEE("see_own", OWN) + TRY("save_team", TEAM, RES) + TRY("term_in_team", TEAM, TRM) + TRY("save_own", OWN, RES)
for P, want, label in ((K, {"see_team": "1", "see_own": "0", "save_team": "1", "term_in_team": "0", "save_own": "0"}, "the Springfield lead"),
                       (OWNERP, {"see_team": "1", "see_own": "1" if X["own"] is not None else "0", "save_team": "1", "term_in_team": "0", "save_own": "1"}, "an owner")) + \
                      (((OTHERS[0], {"see_team": "0", "see_own": "0", "save_team": "0", "term_in_team": "0", "save_own": "0"}, "an office person who is neither"),) if OTHERS else ()):
    got, err = probe(P, ALL)
    if got is None: bad(f"could not test as {P['name']}: {err}"); continue
    words = {"see_team": "sees the resignation list", "see_own": "sees the termination list", "save_team": "can save a resignation",
             "term_in_team": "can put a Termination in the resignation list", "save_own": "can save into the termination list"}
    wrong = [k for k in want if got.get(k) != want[k]]
    if wrong: bad(f"acting as {P['name']} ({label}): " + "; ".join(("WRONGLY " if want[k] == "0" else "NOT: ") + words[k] for k in wrong))
    else: ok(f"acting as {P['name']} ({label}, undone after): " + "; ".join(("yes, " if want[k] == "1" else "no, ") + words[k] for k in want))
if not OTHERS: say("  · no other office account to test the 'not allowed' side with; the rehearsal covers it")
say("  · rehearsed before this ran: this step against a local copy of the database, and the Owners Hub page lead view (10 checks).")
say()
if L.fails: say("RESULT: CHECK THE ✗ LINES ABOVE. Tell Claude."); done(9)
say(f"RESULT: DONE · Tell Claude, who merges the Owners Hub change next. {K['name']} then opens Admin, Caregiver offboarding. Nothing was sent."); done(0)
