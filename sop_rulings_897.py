#!/usr/bin/env python3
# 897 · SOP RULINGS 8 AND 9: WHO OWNS EACH WORK AREA, AND THE SPRINGFIELD LEAD (Samantha 2026-10-17: "I agree with your
# recommendation on all 10 decisions"; plan https://claude.ai/artifact/AEmDHvr1Cvk8setJ4GYupb).
#  · work areas (domains): Field Quality and Payer Programs move to Krystal; a backup still pointing at someone with no
#    sign-in (Cierra, Angiel) is cleared; escalation is Samantha for Money, Incidents and Program administration, and for
#    any area Krystal owns herself (so it never escalates to the person who owns it); Krystal for every other area.
#  · the Springfield lead: a new staff role 'springfield_lead', given to Krystal. It lets her give and remove Hub access
#    for anyone who is not an owner (the hub-access function, redeployed here) and read the Team list
#    (staff_access_overview). Switches, rates, roles and settings stay with owners.
#  · the old values are kept in ops_settings.sop_rulings_897_previous, so it can be put back exactly.
#  Nothing is texted, emailed or called by this step.
import json, os, re, subprocess, datetime as dt
os.environ.setdefault("SB_STEP", "897")
import cc_step_lib as L
from cc_step_lib import say, bad, done, http, sql, deploy, start, check_build, fmeta, lit

REF = "zngsgedlsxinbygwmxwn"
FNROOT = L.FNROOT; ROOT = L.ROOT
FNB = os.environ.get("SB_FN_BASE", f"https://{REF}.supabase.co")
FN = "hub-access"
LEAD_EMAIL = os.environ.get("SB_LEAD_EMAIL", "krystal@mo-care.com")
OWNER_EMAIL = os.environ.get("SB_OWNER_EMAIL", "samantha@mo-care.com")
TO_KRYSTAL = ("field_quality", "payer_programs")
OWNER_AREAS = ("money", "incidents", "program_administration")
OLD = "and r.role = 'owner_admin'"
NEW = "and r.role in ('owner_admin', 'springfield_lead')"
ok = lambda s: say("  ✓ " + s)
def run(args): p = subprocess.run(args, capture_output=True, text=True, cwd=ROOT); return p.returncode, (p.stdout or ""), (p.stderr or "")
def stop(msg): bad(msg); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(2)
def jlit(o): return "$cc897$" + json.dumps(o) + "$cc897$::jsonb"
NOW = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")

start("SOP RULINGS 8 AND 9: WORK AREA OWNERS AND THE SPRINGFIELD LEAD")
say("PART 1 · READ ONLY (nothing changes)")
check_build(FNROOT, json.loads(os.environ.get("SB_FN_SHAS", "{}")))
MAIN = os.environ.get("SB_MAIN_REF", "origin/main")
if MAIN.startswith("origin/"): run(["git", "-C", ROOT, "fetch", "-q", "origin", "main"])
drift = [k for k in sorted(L.need(FNROOT, FN)) if (lambda c: c[0] != 0 or c[1] != open(os.path.join(ROOT, k)).read())(run(["git", "-C", ROOT, "show", f"{MAIN}:{k}"]))]
if drift: stop(f"{FN} isn't the same as GitHub's main yet (merge the pull request first): " + ", ".join(drift)[:240])
ok(f"{FN}: the reviewed build is what is on GitHub's main")
s0, m0 = fmeta(REF, FN)
if s0 != 200 or not m0 or "verify_jwt" not in m0: stop(f"couldn't read how {FN} is set up live ({s0})")
GATE = bool(m0["verify_jwt"]); say(f"  · {FN} is live as version {m0.get('version', '?')}, gateway sign-in check {'on' if GATE else 'off'} (kept)")

ok1, r1 = sql(REF, """select coalesce(jsonb_agg(jsonb_build_object('code', d.code, 'label', d.label, 'active', d.active,
    'owner', d.owner_person, 'backup', d.backup_person, 'escalation', d.escalation_person) order by d.sort_order), '[]'::jsonb) as doms
  from public.domains d where d.entity = 'cc_ihs'""")
if not ok1: stop(f"could not read the work areas: {r1}")
DOMS = r1[0]["doms"] if isinstance(r1[0]["doms"], list) else json.loads(r1[0]["doms"])
ok2, r2 = sql(REF, """select coalesce(jsonb_agg(jsonb_build_object('id', p.person_id, 'name', p.full_name, 'email', lower(coalesce(p.primary_email, '')),
    'active', p.active, 'can_sign_in', exists (select 1 from public.auth_identities ai join auth.users u on u.id = ai.auth_user_id
      where ai.person_id = p.person_id and (u.email_confirmed_at is not null or u.last_sign_in_at is not null) and u.banned_until is null),
    'roles', coalesce((select jsonb_agg(r.role) from public.staff_roles r where r.person_id = p.person_id and r.entity = 'cc_ihs'), '[]'::jsonb))), '[]'::jsonb) as ppl
  from public.persons p""")
if not ok2: stop(f"could not read the people: {r2}")
PPL = {p["id"]: p for p in (r2[0]["ppl"] if isinstance(r2[0]["ppl"], list) else json.loads(r2[0]["ppl"]))}
nm = lambda pid: (PPL.get(pid) or {}).get("name") or ("nobody" if not pid else "an unknown person")
by_email = {p["email"]: p for p in PPL.values() if p["email"]}
K = by_email.get(LEAD_EMAIL); S = by_email.get(OWNER_EMAIL)
if not K or not K["active"]: stop(f"{LEAD_EMAIL} is not an active person record")
if not S or "owner_admin" not in S["roles"]: stop(f"{OWNER_EMAIL} is not an owner in staff_roles")
if not K["can_sign_in"]: stop(f"{K['name']} has no working sign-in, so the Springfield lead role would do nothing yet")
if "owner_admin" in K["roles"]: stop(f"{K['name']} is already an owner, which this step did not expect")
say(f"  · {K['name']}: roles {', '.join(K['roles']) or 'none'}; can sign in")
say("  · work areas now:")
for d in DOMS: say(f"      {d['label']}: owner {nm(d['owner'])}, backup {nm(d['backup'])}, escalation {nm(d['escalation'])}" + ("" if d["active"] else " (not active)"))
codes = {d["code"] for d in DOMS}
for c in TO_KRYSTAL + OWNER_AREAS:
    if c not in codes: stop(f"the work area '{c}' is not there")

# the plan, worked out from what is there now
PLAN = []
for d in DOMS:
    new = dict(owner=d["owner"], backup=d["backup"], escalation=d["escalation"])
    if d["code"] in TO_KRYSTAL: new["owner"] = K["id"]
    if new["backup"] and (new["backup"] == new["owner"] or not (PPL.get(new["backup"]) or {}).get("can_sign_in")): new["backup"] = None
    new["escalation"] = S["id"] if (d["code"] in OWNER_AREAS or new["owner"] == K["id"]) else K["id"]
    if new["escalation"] == new["owner"] and d["code"] not in OWNER_AREAS: new["escalation"] = S["id"]
    if new != dict(owner=d["owner"], backup=d["backup"], escalation=d["escalation"]): PLAN.append((d, new))
say(f"  · work areas that change: {len(PLAN)}")
for d, n in PLAN:
    parts = [f"{w} {nm(d[w])} → {nm(n[w])}" for w in ("owner", "backup", "escalation") if d[w] != n[w]]
    say(f"      {d['label']}: " + "; ".join(parts))

ok3, r3 = sql(REF, """select pg_get_functiondef('public.staff_access_overview()'::regprocedure) as def,
  exists (select 1 from public.staff_role_types where role = 'springfield_lead') as has_type,
  (select data from public.app_data where key = 'role_permissions') as rp,
  (select data from public.app_data where key = 'ops_settings') ? 'sop_rulings_897_previous' as ran_before""")
if not ok3: stop(f"could not read the Team list function: {r3}")
x = r3[0]; FDEF = x["def"] or ""
if FDEF.count(OLD) != 1 and FDEF.count(NEW) != 1: stop("the Team list function is not the one this step was written for (its owner check is different); nothing changed")
FN_NEEDS = FDEF.count(OLD) == 1
say("  · Team list function: " + ("owner check found once, it will also allow the Springfield lead" if FN_NEEDS else "already allows the Springfield lead"))
say("  · the Springfield lead role: " + ("already in the role list" if x["has_type"] else "not there yet, it will be added") + "; " + K["name"] + (" already holds it" if "springfield_lead" in K["roles"] else " will be given it"))
RP = x["rp"] if isinstance(x["rp"], (list, type(None))) else json.loads(x["rp"])
RP_MAP = next((r for r in (RP or []) if isinstance(r, dict) and r.get("id") == "map"), None)
RP_NEEDS = bool(RP_MAP and isinstance(RP_MAP.get("perms"), dict) and "manage_access" not in (RP_MAP["perms"].get("springfield_lead") or []))
say("  · the Hub's saved role permissions: " + ("none saved, the Hub's built-in list already gives the Springfield lead Hub access" if not RP_MAP
    else ("the Springfield lead will be given Hub access in it" if RP_NEEDS else "already gives the Springfield lead Hub access")))
if x["ran_before"]: say("  · NOTE: this step ran before; the first run's old values are kept, not overwritten")
say(f"  · what changes: {FN} redeployed, {len(PLAN)} work area(s), the Springfield lead role, the Team list function. Nothing is sent.")
if L.fails: say(); say("  RESULT: STOPPED before anything changed. Tell Claude which line."); done(3)

say(); say("PART 2 · CHANGE")
if not deploy(REF, FNROOT, FN, GATE): say(f"  RESULT: STOPPED at {FN}. Tell Claude. (The database was not changed.)"); done(7)
prev = {"at": NOW, "domains": [{"code": d["code"], "owner": d["owner"], "backup": d["backup"], "escalation": d["escalation"]} for d, _ in PLAN],
        "lead_role_added_to": K["id"] if "springfield_lead" not in K["roles"] else None, "role_type_added": not x["has_type"],
        "staff_access_overview_def": FDEF if FN_NEEDS else None, "role_permissions_map": RP_MAP if RP_NEEDS else None}
stmts = ["begin;",
  f"""update public.app_data set data = coalesce(data, '{{}}'::jsonb) || jsonb_build_object('sop_rulings_897_previous', {jlit(prev)}), updated_at = now()
      where key = 'ops_settings' and not (coalesce(data, '{{}}'::jsonb) ? 'sop_rulings_897_previous');""",
  """insert into public.staff_role_types (role, label, description, sort, active) values ('springfield_lead', 'Springfield lead',
      'Runs the Springfield office day to day. Adds Hub access (give and remove) for anyone who is not an owner. Held on top of an office role.', 25, true)
      on conflict (role) do nothing;""",
  f"""insert into public.staff_roles (person_id, entity, role, granted_by) values ({lit(K['id'])}::uuid, 'cc_ihs', 'springfield_lead', '897 installer (Samantha, SOP ruling 9, 2026-10-17)')
      on conflict do nothing;""",
  f"""insert into public.staff_role_audit (actor_email, subject_email, person_id, action, role, note)
      select {lit(OWNER_EMAIL)}, {lit(LEAD_EMAIL)}, {lit(K['id'])}::uuid, 'grant', 'springfield_lead', 'Desktop 897: SOP ruling 9, approved 2026-10-17'
      where {'true' if 'springfield_lead' not in K['roles'] else 'false'};"""]
for d, n in PLAN:
    stmts.append(f"""update public.domains set owner_person = {lit(n['owner'])}::uuid, backup_person = {lit(n['backup'])}::uuid, escalation_person = {lit(n['escalation'])}::uuid
      where entity = 'cc_ihs' and code = {lit(d['code'])};""")
if FN_NEEDS: stmts.append(FDEF.replace(OLD, NEW).rstrip().rstrip(";") + ";")
if RP_NEEDS:
    nm_ = dict(RP_MAP); nm_["perms"] = dict(RP_MAP["perms"]); nm_["perms"]["springfield_lead"] = sorted(set((RP_MAP["perms"].get("springfield_lead") or []) + ["manage_access"]))
    stmts.append(f"select public.upsert_app_data_item('role_permissions', {jlit(nm_)});")
stmts += ["""comment on function public.staff_access_overview() is 'Read-only Staff & Access. Owner/Admin or Springfield lead only, enforced inside the function. Returns an empty set to anyone else. Writes nothing.';""",
  "notify pgrst, 'reload schema';", "commit;"]
okC, rC = sql(REF, "\n".join(stmts))
if not okC: bad(f"the database change did not go through, so nothing in the database changed: {rC}"); say("  RESULT: STOPPED. Tell Claude. (hub-access was redeployed; it changes nothing until the role exists.)"); done(8)
ok("work areas, the Springfield lead role and the Team list function changed in one go (old values kept in ops_settings.sop_rulings_897_previous)")

say(); say("PART 3 · PROOF (nothing is sent)")
ok4, r4 = sql(REF, """select coalesce(jsonb_agg(jsonb_build_object('code', code, 'label', label, 'owner', owner_person, 'backup', backup_person, 'escalation', escalation_person) order by sort_order), '[]'::jsonb) as doms
  from public.domains where entity = 'cc_ihs'""")
if ok4:
    after = {d["code"]: d for d in (r4[0]["doms"] if isinstance(r4[0]["doms"], list) else json.loads(r4[0]["doms"]))}
    wrong = [d["label"] for d, n in PLAN if any(after[d["code"]][w] != n[w] for w in ("owner", "backup", "escalation"))]
    if wrong: bad("these work areas did not read back as planned: " + ", ".join(wrong))
    else:
        ok("work areas read back:")
        for d in after.values(): say(f"      {d['label']}: owner {nm(d['owner'])}, backup {nm(d['backup'])}, escalation {nm(d['escalation'])}")
else: bad(f"could not read the work areas back: {r4}")
# acting AS each person inside a transaction that is always undone: the lead sees the Team list, a plain office person does not
others = [p for p in PPL.values() if p["active"] and p["can_sign_in"] and not ({"owner_admin", "springfield_lead"} & set(p["roles"])) and p["id"] != K["id"]]
probe_people = [(K, True)] + ([(others[0], False)] if others else [])
for P, want in probe_people:
    okP, rP = sql(REF, f"""do $$ declare uid uuid; n int; begin
      select ai.auth_user_id into uid from public.auth_identities ai where ai.person_id = {lit(P['id'])}::uuid limit 1;
      if uid is null then raise exception 'PROBE_RESULT: -1'; end if;
      perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
      perform set_config('request.jwt.claim.sub', uid::text, true);
      set local role authenticated;
      select count(*) into n from public.staff_access_overview();
      raise exception 'PROBE_RESULT: %', n; end $$;""")
    m_ = re.search(r"PROBE_RESULT: (-?\d+)", str(rP)) if not okP else None
    got = int(m_.group(1)) if m_ else None
    if got == -1: bad(f"{P['name']} has no linked sign-in to test with"); continue
    if got is None: bad(f"could not test the Team list as {P['name']}: {str(rP)[:200]}")
    elif want and got > 0: ok(f"acting as {P['name']} (undone after): the Team list shows {got} people")
    elif not want and got == 0: ok(f"acting as {P['name']}, who is not an owner or the lead (undone after): the Team list shows nobody")
    else: bad(f"acting as {P['name']}: the Team list showed {got}, which is not right")
if not others: say("  · no other office account to test the 'not allowed' side with; the function test before deploying covers it")
s5, _ = http("OPTIONS", f"{FNB}/functions/v1/hub-access"); ok("the Hub can still reach hub-access") if s5 == 200 else bad(f"hub-access: the browser check answered {s5}")
say("  · tested before deploying: hub-access against fakes (the lead 12 checks, the existing 13 + 18 still pass) and the Admin page lead view (7 checks).")
say()
if L.fails: say("RESULT: CHECK THE ✗ LINES ABOVE"); done(9)
say(f"RESULT: DONE · Merge the Owners Hub pull request next (the Admin page lead view). {K['name']} can then open hub.mo-care.com/admin.html. Nothing was sent."); done(0)
